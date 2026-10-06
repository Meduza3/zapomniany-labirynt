import { CloudError, prepareCloudBot, cloudPlayerViews } from '../_shared/cloud-room.mjs';
import { database, json, failure, readBody, hash, rpc } from '../_shared/backend.ts';

Deno.serve(async request => {
  try {
    if (request.method !== 'POST') throw new CloudError(405, 'Niedozwolona metoda.');
    const secret = Deno.env.get('LABIRYNT_BOT_SECRET');
    if (!secret || secret.length < 32) throw new CloudError(503, 'Brak konfiguracji bota.');
    const supplied = request.headers.get('x-bot-secret') ?? '';
    const left = await hash(secret);
    const right = await hash(supplied);
    let difference = 0;
    for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
    if (difference !== 0) throw new CloudError(401, 'Brak uprawnień.');
    const body = await readBody(request);
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'roomCode') || (body.roomCode !== undefined && !/^[A-Z2-9]{6}$/.test(body.roomCode))) throw new CloudError(400, 'Nieprawidłowe dane zadania.');
    const db = database();
    await new Promise(resolve => setTimeout(resolve, 700));
    let processed = 0;
    for (let index = 0; index < (body.roomCode ? 1 : 8); index += 1) {
      const job = await rpc(db, 'claim_cloud_bot_job', { p_room_code: body.roomCode ?? null });
      if (!job) break;
      try {
        const original = await rpc(db, 'load_cloud_room', { p_code: job.room_code });
        const prepared = prepareCloudBot(original, job);
        if (!prepared) {
          await rpc(db, 'release_cloud_bot_job', { p_job_id: job.id, p_lease_token: job.lease_token });
          continue;
        }
        await rpc(db, 'commit_cloud_room', {
          p_room: prepared.room, p_expected_revision: prepared.expectedRevision,
          p_actor_id: job.player_id, p_request_id: `bot:${job.id}`,
          p_request_hash: await hash(JSON.stringify({ job: job.id, revision: job.expected_revision })),
          p_response: prepared.response, p_views: cloudPlayerViews(prepared.room),
          p_bot_job_id: job.id, p_lease_token: job.lease_token,
        });
        processed += 1;
      } catch (error) {
        console.error('Bot job failed', job.id, error instanceof Error ? error.message : 'unknown');
        await rpc(db, 'release_cloud_bot_job', { p_job_id: job.id, p_lease_token: job.lease_token, p_error: error instanceof Error ? error.message : 'unknown' });
      }
    }
    return json({ ok: true, processed });
  } catch (error) { return failure(error); }
});
