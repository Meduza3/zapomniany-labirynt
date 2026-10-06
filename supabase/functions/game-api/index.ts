import { CloudError, validateEnvelope, canonicalRequest, prepareCloudCommand, cloudPlayerViews } from '../_shared/cloud-room.mjs';
import { database, cors, json, failure, readBody, hash, databaseError, rpc, receipt } from '../_shared/backend.ts';

function roomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return [...crypto.getRandomValues(new Uint8Array(6))].map(byte => alphabet[byte % alphabet.length]).join('');
}

Deno.serve(async request => {
  let headers: Record<string, string> = {};
  try {
    headers = cors(request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') throw new CloudError(405, 'Wyślij żądanie metodą POST.');
    const authorization = /^Bearer ([^\s]+)$/i.exec(request.headers.get('authorization') ?? '');
    if (!authorization) throw new CloudError(401, 'Zaloguj się ponownie, aby wejść do gry.');
    const db = database();
    const { data: auth, error: authError } = await db.auth.getUser(authorization[1]);
    if (authError || !auth.user) throw new CloudError(401, 'Sesja wygasła. Zaloguj się ponownie.');
    const command = validateEnvelope(await readBody(request));
    const actor = auth.user.id;
    const requestHash = await hash(canonicalRequest(command));
    const replay = async () => command.method === 'GET' ? null : await receipt(db, actor, command.requestId, requestHash);
    const previous = await replay();
    if (previous) return json(previous.body, previous.status, headers);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const original = command.code ? await rpc(db, 'load_cloud_room', { p_code: command.code }) : null;
      let prepared;
      try {
        prepared = prepareCloudCommand(original, actor, command, { code: roomCode(), seed: crypto.getRandomValues(new Uint32Array(1))[0] });
      } catch (error) {
        const accepted = await replay();
        if (accepted) return json(accepted.body, accepted.status, headers);
        throw error;
      }
      if (!prepared.room) return json(prepared.response.body, prepared.response.status, headers);
      const { data, error } = await db.rpc('commit_cloud_room', {
        p_room: prepared.room, p_expected_revision: prepared.expectedRevision,
        p_actor_id: actor, p_request_id: command.requestId, p_request_hash: requestHash,
        p_response: prepared.response, p_views: cloudPlayerViews(prepared.room),
      });
      if (!error) return json(data.body, data.status, headers);
      const accepted = await replay();
      if (accepted) return json(accepted.body, accepted.status, headers);
      if (attempt < 3 && (error.code === '23505' || (error.code === 'PT409' && command.operation !== 'actions'))) continue;
      throw databaseError(error);
    }
    throw new CloudError(409, 'Pokój zmienił się. Spróbuj ponownie.');
  } catch (error) { return failure(error, headers); }
});
