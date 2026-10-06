import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudTransport } from '../public/cloud-transport.js';

const config = { backend: 'supabase', supabaseUrl: 'https://garden.supabase.co', publishableKey: 'sb_publishable_fixture' };
const view = { code: 'ABC123', revision: 4, status: 'lobby', you: 'seat-7', players: [] };
const session = { access_token: 'user-jwt', user: { id: 'auth-user-1' } };
function response(status, body) { return { status, ok: status >= 200 && status < 300, json: async () => body }; }
function fixture({ savedSession = session, responses = [], userError = null } = {}) {
  let currentSession = savedSession && structuredClone(savedSession), nextId = 0, timerId = 0;
  const requests = [], channels = [], removed = [], sleeps = [], timers = new Map();
  const authCalls = { anonymous: 0, refreshed: 0, verified: [] };
  const sdk = {
    auth: {
      async getSession() { return { data: { session: currentSession }, error: null }; },
      async signInAnonymously() {
        authCalls.anonymous++;
        currentSession = structuredClone(session);
        return { data: { session: currentSession }, error: null };
      },
      async getUser(token) {
        authCalls.verified.push(token);
        return { data: { user: userError ? null : { id: currentSession.user.id } }, error: userError };
      },
      async refreshSession() {
        authCalls.refreshed++;
        currentSession = { ...currentSession, access_token: 'refreshed-user-jwt' };
        return { data: { session: currentSession }, error: null };
      },
    },
    channel(name) {
      const channel = {
        name,
        on(event, filter, callback) { this.event = event; this.filter = filter; this.receive = callback; return this; },
        subscribe(callback) { this.status = callback; return this; },
      };
      channels.push(channel);
      return channel;
    },
    async removeChannel(channel) { removed.push(channel); channel.status('CLOSED'); },
  };
  return {
    requests, channels, removed, sleeps, timers, authCalls,
    async create(settings = config) {
      return createCloudTransport(settings, {
        createClient(url, key, options) {
          assert.equal(url, config.supabaseUrl);
          assert.equal(key, config.publishableKey);
          assert.deepEqual(options.auth, { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false });
          return sdk;
        },
        async fetch(url, options) {
          requests.push({ url, ...options });
          const result = responses.shift() ?? response(200, view);
          if (result instanceof Error) throw result;
          return result;
        },
        randomUUID: () => `request-${++nextId}`,
        async sleep(milliseconds) { sleeps.push(milliseconds); },
        setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
        clearTimeout(id) { timers.delete(id); },
      });
    },
    async timer(delay) {
      const entry = [...timers].find(([, timer]) => timer.delay === delay);
      assert.ok(entry, `A ${delay}ms timer must be scheduled.`);
      timers.delete(entry[0]);
      await entry[1].callback();
      await new Promise(resolve => setImmediate(resolve));
    },
  };
}

test('anonymous identity is created once, restored and verified separately from the game seat', async () => {
  const result = { code: view.code, playerId: view.you, view };
  const env = fixture({ savedSession: null, responses: [response(201, result)] });
  const transport = await env.create();
  assert.equal(transport.userId, 'auth-user-1');
  assert.equal(env.authCalls.anonymous, 1);
  assert.deepEqual(await transport.api('/api/rooms', { method: 'POST', body: JSON.stringify({ name: 'Ala' }) }), result);
  const request = env.requests[0];
  assert.equal(request.url, 'https://garden.supabase.co/functions/v1/game-api');
  assert.equal(request.method, 'POST');
  assert.equal(request.headers.Authorization, 'Bearer user-jwt');
  assert.equal(request.headers.apikey, config.publishableKey);
  assert.deepEqual(JSON.parse(request.body), { path: '/api/rooms', method: 'POST', body: { name: 'Ala' }, requestId: 'request-1' });
  assert.notEqual(result.playerId, transport.userId);
  await env.create();
  assert.equal(env.authCalls.anonymous, 1);
  assert.deepEqual(env.authCalls.verified, ['user-jwt', 'user-jwt']);
});

test('network and server retries preserve the exact mutation and idempotency key', async () => {
  const env = fixture({ responses: [new TypeError('Failed to fetch'), response(503, { error: 'Unavailable' }), response(200, view)] });
  const transport = await env.create();
  const action = { type: 'place', tileId: 'tile-1-6-1', index: 3, rotation: 1 };
  assert.deepEqual(await transport.api('/api/rooms/ABC123/actions', { method: 'POST', body: JSON.stringify({ action, revision: 3 }) }), view);
  assert.equal(env.requests.length, 3);
  assert.equal(new Set(env.requests.map(request => request.body)).size, 1);
  assert.deepEqual(JSON.parse(env.requests[0].body), { path: '/api/rooms/ABC123/actions', method: 'POST', body: { action, revision: 3 }, requestId: 'request-1' });
  assert.deepEqual(env.sleeps, [400, 800]);
  assert.equal(env.timers.size, 0);
});

test('an expired access token refreshes once with the same mutation key while conflicts are not retried', async () => {
  const env = fixture({ responses: [response(401, { error: 'Expired' }), response(200, view), response(409, { error: 'Ten kolor jest zajęty.' })] });
  const transport = await env.create();
  await transport.api('/api/rooms/ABC123/color', { method: 'POST', body: { color: 'red' } });
  assert.equal(env.authCalls.refreshed, 1);
  assert.deepEqual(env.requests.slice(0, 2).map(request => request.headers.Authorization), ['Bearer user-jwt', 'Bearer refreshed-user-jwt']);
  assert.equal(env.requests[0].body, env.requests[1].body);
  await assert.rejects(transport.api('/api/rooms/ABC123/color', { method: 'POST', body: { color: 'blue' } }), error => error.status === 409 && error.message === 'Ten kolor jest zajęty.');
  assert.equal(env.requests.length, 3);
  assert.notEqual(JSON.parse(env.requests[2].body).requestId, JSON.parse(env.requests[1].body).requestId);
  assert.deepEqual(env.sleeps, []);
});

test('realtime accepts only this account and room, resyncs after reconnect and ignores updates after leaving', async () => {
  const responses = [];
  const env = fixture({ responses });
  const transport = await env.create();
  const views = [], statuses = [];
  const stop = transport.subscribe('ABC123', { onView: incoming => views.push(incoming), onStatus: (text, online) => statuses.push({ text, online }) });
  const first = env.channels[0];
  assert.equal(first.event, 'postgres_changes');
  assert.deepEqual(first.filter, { event: '*', schema: 'public', table: 'player_views', filter: 'room_code=eq.ABC123' });
  first.receive({ new: { room_code: 'ABC123', user_id: 'other-auth-user', view } });
  first.receive({ new: { room_code: 'OTHER1', user_id: 'auth-user-1', view } });
  assert.equal(views.length, 0);
  first.receive({ new: { room_code: 'ABC123', user_id: 'auth-user-1', view } });
  assert.deepEqual(views, [view]);
  first.status('SUBSCRIBED');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(env.requests.length, 1);
  assert.equal(JSON.parse(env.requests[0].body).path, '/api/rooms/ABC123');
  assert.equal(statuses.at(-1).online, true);
  responses.push(...Array.from({ length: 3 }, () => response(503, { error: 'Unavailable' })));
  await env.timer(15000);
  assert.equal(statuses.at(-1).online, false);
  await env.timer(15000);
  assert.equal(statuses.at(-1).online, true, 'A successful resync must restore the online state after a temporary request failure.');
  const requestsBeforeReconnect = env.requests.length;
  first.status('CHANNEL_ERROR');
  assert.equal(statuses.at(-1).online, false);
  await env.timer(1000);
  assert.equal(env.channels.length, 2);
  assert.ok(env.removed.includes(first));
  const count = views.length;
  first.receive({ new: { room_code: 'ABC123', user_id: 'auth-user-1', view } });
  assert.equal(views.length, count);
  env.channels[1].status('SUBSCRIBED');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(env.requests.length, requestsBeforeReconnect + 1);
  await env.timer(15000);
  assert.equal(env.requests.length, requestsBeforeReconnect + 2);
  stop();
  assert.equal(env.timers.size, 0);
  const finalCount = views.length;
  env.channels[1].receive({ new: { room_code: 'ABC123', user_id: 'auth-user-1', view } });
  env.channels[1].status('CHANNEL_ERROR');
  assert.equal(views.length, finalCount);
  assert.equal(env.timers.size, 0);
});

test('invalid saved identity and privileged configuration never silently create a replacement account', async () => {
  const env = fixture({ userError: { status: 401 } });
  await assert.rejects(env.create(), error => error.status === 401);
  assert.equal(env.authCalls.anonymous, 0);
  assert.equal(env.requests.length, 0);
  await assert.rejects(env.create({ ...config, publishableKey: 'sb_secret_forbidden' }), /konfiguracja/);
  const privileged = `header.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.signature`;
  await assert.rejects(env.create({ ...config, publishableKey: privileged }), /publicznego klucza/);
});
