import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { CloudError } from './cloud-room.mjs';

export function database() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new CloudError(503, 'Brak konfiguracji serwera gry.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function cors(request: Request) {
  const origin = request.headers.get('origin');
  const allowed = (Deno.env.get('ALLOWED_ORIGINS') ?? '*').split(',').map(value => value.trim()).filter(Boolean);
  if (origin && !allowed.includes('*') && !allowed.includes(origin)) throw new CloudError(403, 'Ta strona nie ma dostępu do gry.');
  return { 'Access-Control-Allow-Origin': allowed.includes('*') ? '*' : origin ?? allowed[0] ?? 'null', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' };
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

export function failure(error: unknown, headers: Record<string, string> = {}) {
  if (error instanceof CloudError) return json({ error: error.message }, error.status, headers);
  console.error('Cloud game request failed', error instanceof Error ? error.message : 'unknown');
  return json({ error: 'Nie udało się zapisać gry. Spróbuj ponownie.' }, 500, headers);
}

export async function readBody(request: Request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new CloudError(415, 'Wyślij dane w formacie JSON.');
  const reader = request.body?.getReader();
  if (!reader) throw new CloudError(400, 'Brak danych żądania.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 16_384) {
      await reader.cancel();
      throw new CloudError(413, 'Żądanie jest zbyt duże.');
    }
    chunks.push(value);
  }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)); }
  catch { throw new CloudError(400, 'Nieprawidłowy JSON.'); }
}

export async function hash(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function databaseError(error: { code?: string; message: string }) {
  const status = /^PT(400|403|404|409|429)$/.exec(error.code ?? '');
  if (status) return new CloudError(Number(status[1]), error.message);
  return new Error(`Database operation failed (${error.code ?? 'unknown'})`);
}

export async function rpc(db: ReturnType<typeof database>, name: string, args: Record<string, unknown>) {
  const result = await db.rpc(name, args);
  if (result.error) throw databaseError(result.error);
  return result.data;
}

export async function receipt(db: ReturnType<typeof database>, actor: string, requestId: string, requestHash: string) {
  const { data, error } = await db.from('commands').select('request_hash,response').eq('actor_id', actor).eq('request_id', requestId).maybeSingle();
  if (error) throw databaseError(error);
  if (data && data.request_hash !== requestHash) throw new CloudError(409, 'Identyfikator żądania został już użyty dla innych danych.');
  return data?.response ?? null;
}
