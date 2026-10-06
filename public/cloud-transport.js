export async function createCloudTransport(config, dependencies = {}) {
  const endpoint = new URL(config.supabaseUrl);
  const key = config.publishableKey;
  if ((endpoint.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)) || !key || key.startsWith('sb_secret_')) throw new Error('Nieprawidłowa konfiguracja serwera gry.');
  if (key.split('.').length === 3) {
    let role;
    try { role = JSON.parse(atob(key.split('.')[1].replaceAll('-', '+').replaceAll('_', '/'))).role; } catch {}
    if (role !== 'anon') throw new Error('Konfiguracja gry wymaga publicznego klucza Supabase.');
  }
  const createClient = dependencies.createClient || (await import('./vendor/supabase.js')).createClient;
  const fetchRequest = dependencies.fetch || globalThis.fetch.bind(globalThis);
  const schedule = dependencies.setTimeout || globalThis.setTimeout.bind(globalThis);
  const cancel = dependencies.clearTimeout || globalThis.clearTimeout.bind(globalThis);
  const pause = dependencies.sleep || (milliseconds => new Promise(resolve => schedule(resolve, milliseconds)));
  const newId = dependencies.randomUUID || (() => globalThis.crypto.randomUUID());
  const client = createClient(endpoint.origin, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  const functionUrl = `${endpoint.origin}/functions/v1/game-api`;
  function failure(message, status) { return Object.assign(new Error(message), { status }); }
  let { data, error } = await client.auth.getSession();
  if (error) throw failure('Nie udało się odtworzyć Twojego miejsca. Odśwież stronę i spróbuj ponownie.', error.status || 503);
  if (!data.session) {
    ({ data, error } = await client.auth.signInAnonymously());
    if (error) throw failure('Nie udało się połączyć z grą. Spróbuj ponownie za chwilę.', error.status || 503);
  }
  if (!data.session?.access_token) throw failure('Nie udało się utworzyć sesji gracza.', 401);
  const identity = await client.auth.getUser(data.session.access_token);
  if (identity.error || !identity.data.user?.id) throw failure('Nie udało się potwierdzić Twojej sesji. Odśwież stronę.', identity.error?.status || 401);
  const userId = identity.data.user.id;

  async function accessToken(refresh = false) {
    const result = refresh ? await client.auth.refreshSession() : await client.auth.getSession();
    if (result.error || !result.data.session?.access_token) throw failure('Twoja sesja wygasła. Odśwież stronę, aby wrócić do gry.', result.error?.status || 401);
    if (result.data.session.user?.id && result.data.session.user.id !== userId) throw failure('Sesja gracza zmieniła się. Odśwież stronę.', 401);
    return result.data.session.access_token;
  }

  async function api(path, options = {}) {
    const method = options.method || 'GET';
    const body = options.body ? (typeof options.body === 'string' ? JSON.parse(options.body) : options.body) : {};
    const payload = JSON.stringify({ path, method, body, requestId: newId() });
    let refreshed = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      const token = await accessToken();
      const controller = new AbortController();
      const timeout = schedule(() => controller.abort(), 15000);
      let response;
      try {
        response = await fetchRequest(functionUrl, {
          method: 'POST', headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${token}` },
          body: payload, signal: controller.signal, cache: 'no-store',
        });
        const result = await response.json().catch(() => ({ error: 'Serwer zwrócił nieczytelną odpowiedź.' }));
        if (response.ok) return result;
        if (response.status === 401 && !refreshed && attempt < 2) {
          refreshed = true;
          await accessToken(true);
          continue;
        }
        throw failure(result.error || `Nie udało się wykonać akcji (${response.status}).`, response.status);
      } catch (requestError) {
        const retryable = !requestError.status || requestError.status === 408 || requestError.status === 429 || requestError.status >= 500;
        if (!retryable || attempt === 2) {
          if (!requestError.status) throw failure('Połączenie zostało przerwane. Spróbuj ponownie.', 503);
          throw requestError;
        }
      } finally {
        cancel(timeout);
      }
      await pause(400 * (2 ** attempt));
    }
  }

  function subscribe(code, { onView, onStatus, onError = () => {} }) {
    let stopped = false, channel = null, retryTimer = null, pollTimer = null, generation = 0, retryDelay = 1000, refreshing = false, live = false;
    function status(text, online) { if (!stopped) onStatus(text, online); }
    async function refresh() {
      if (stopped || refreshing) return;
      refreshing = true;
      try {
        const view = await api(`/api/rooms/${encodeURIComponent(code)}`);
        if (!stopped) {
          onView(view);
          if (live) status('Połączono · na żywo', true);
        }
      } catch (refreshError) {
        if (!stopped) {
          status('Ponowne łączenie…', false);
          onError(refreshError);
        }
      } finally { refreshing = false; }
    }
    function poll() {
      pollTimer = schedule(async () => {
        await refresh();
        if (!stopped) poll();
      }, 15000);
    }
    function reconnect() {
      if (stopped || retryTimer !== null) return;
      retryTimer = schedule(() => {
        retryTimer = null;
        openChannel();
      }, retryDelay);
      retryDelay = Math.min(15000, retryDelay * 2);
    }
    function openChannel() {
      if (stopped) return;
      const current = ++generation;
      live = false;
      if (channel) void client.removeChannel(channel);
      status('Łączenie…', false);
      channel = client.channel(`labirynt:${code}:${newId()}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'player_views', filter: `room_code=eq.${code}` }, payload => {
          if (stopped || current !== generation) return;
          const row = payload.new;
          if (row?.room_code === code && row.user_id === userId && row.view) {
            onView(row.view);
            status('Połączono · na żywo', true);
          }
        })
        .subscribe(state => {
          if (stopped || current !== generation) return;
          if (state === 'SUBSCRIBED') {
            live = true;
            cancel(retryTimer);
            retryTimer = null;
            retryDelay = 1000;
            status('Połączono · na żywo', true);
            void refresh();
          } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(state)) {
            live = false;
            status('Ponowne łączenie…', false);
            reconnect();
          }
        });
    }
    openChannel();
    poll();
    return () => {
      stopped = true;
      generation++;
      cancel(retryTimer);
      cancel(pollTimer);
      if (channel) void client.removeChannel(channel);
    };
  }
  return { api, subscribe, userId };
}
