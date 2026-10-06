import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const endpoint = process.env.LABIRYNT_SUPABASE_URL?.replace(/\/$/, '');
const publishableKey = process.env.LABIRYNT_SUPABASE_PUBLISHABLE_KEY;
const serviceKey = process.env.LABIRYNT_SUPABASE_SERVICE_KEY;
const configured = Boolean(endpoint && publishableKey);
const required = process.env.LABIRYNT_REQUIRE_CLOUD_TESTS === 'true';

async function request(route, { method = 'GET', body, user, headers = {} } = {}) {
  const response = await fetch(`${endpoint}${route}`, {
    method,
    headers: {
      apikey: publishableKey,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(user ? { Authorization: `Bearer ${user.access_token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data };
}

function api(user, path, { method = 'GET', body, requestId = randomUUID() } = {}) {
  return request('/functions/v1/game-api', {
    method: 'POST', user, body: { path, method, body, requestId },
  });
}

function admin(route, options = {}) {
  return request(route, {
    ...options,
    headers: {
      apikey: serviceKey,
      ...(serviceKey?.split('.').length === 3 ? { Authorization: `Bearer ${serviceKey}` } : {}),
      ...options.headers,
    },
  });
}

function expectStatus(result, status, operation) {
  const error = result.data?.error_description ?? result.data?.error ?? result.data?.message;
  assert.equal(result.status, status, `${operation}: expected HTTP ${status}, received ${result.status}.${typeof error === 'string' ? ` ${error}` : ''}`);
  return result.data;
}

function assertPrivateView(view, playerId) {
  assert.equal(view.you, playerId);
  for (const player of view.players) {
    for (const key of ['token', 'tokenHash', 'userId', 'user_id']) assert.equal(Object.hasOwn(player, key), false);
  }
  if (!view.game) return;
  for (const key of ['deck', 'discard', 'rngState']) assert.equal(Object.hasOwn(view.game, key), false);
  for (const player of view.game.players) {
    if (player.id === playerId) assert.ok(Array.isArray(player.hand));
    else {
      assert.equal(Object.hasOwn(player, 'hand'), false);
      assert.equal(typeof player.handCount, 'number');
    }
  }
}

function nextAction(view) {
  const { legal, turn } = view.game;
  if (turn.pending?.kind === 'discard') return { type: 'discard', tileId: legal.discardTileIds[0] };
  if (turn.pending) return { type: 'skipAbility' };
  if (legal.placements.length) return { type: 'place', ...legal.placements[0] };
  if (!turn.placed && legal.removals.length) return { type: 'remove', index: legal.removals[0] };
  if (legal.moves.length) return { type: 'move', index: legal.moves[0] };
  if (legal.canSkipMove) return { type: 'skipMove' };
  if (legal.canEnd) return { type: 'endTurn' };
  assert.fail('The current human turn has no legal action.');
}

async function finishHumanTurn(user, session, initialView) {
  let view = initialView;
  for (let count = 0; count < 12 && view.game.currentPlayerId === session.playerId; count++) {
    view = expectStatus(await api(user, `/api/rooms/${session.code}/actions`, {
      method: 'POST', body: { action: nextAction(view), revision: view.revision },
    }), 200, 'Complete the human turn');
  }
  assert.notEqual(view.game.currentPlayerId, session.playerId);
  return view;
}

test('real Supabase authenticates rooms, protects private state, and serializes commands', {
  skip: configured || required ? false : 'Set LABIRYNT_SUPABASE_URL and LABIRYNT_SUPABASE_PUBLISHABLE_KEY for a disposable Supabase project.',
  timeout: 180_000,
}, async t => {
  assert.ok(configured, 'Required cloud tests need LABIRYNT_SUPABASE_URL and LABIRYNT_SUPABASE_PUBLISHABLE_KEY.');
  const users = [];
  const roomCodes = [];
  t.after(async () => {
    if (!serviceKey) {
      t.diagnostic(`Created test rooms: ${roomCodes.join(', ') || 'none'}. Anonymous test user IDs: ${users.map(user => user.user.id).join(', ') || 'none'}.`);
      return;
    }
    for (const code of roomCodes) expectStatus(await admin(`/rest/v1/rooms?code=eq.${encodeURIComponent(code)}`, { method: 'DELETE' }), 204, 'Delete only the test room');
    for (const user of users) expectStatus(await admin(`/auth/v1/admin/users/${user.user.id}`, { method: 'DELETE' }), 200, 'Delete only the test account');
    t.diagnostic(`Removed ${roomCodes.length} test rooms and ${users.length} anonymous test accounts.`);
  });
  for (let index = 0; index < 5; index++) {
    const user = expectStatus(await request('/auth/v1/signup', {
      method: 'POST', body: { data: { labirynt_integration_test: true } },
    }), 200, 'Anonymous sign-in; enable anonymous users and check the signup rate limit');
    assert.equal(typeof user.access_token, 'string');
    assert.equal(typeof user.user?.id, 'string');
    users.push(user);
  }
  const [hostUser, guestUser, thirdUser, fourthUser, outsider] = users;
  const createId = randomUUID();
  const createCommand = { method: 'POST', body: { name: 'Cloud test host' }, requestId: createId };
  const host = expectStatus(await api(hostUser, '/api/rooms', createCommand), 201, 'Create room');
  roomCodes.push(host.code);
  assert.equal(Object.hasOwn(host, 'token'), false);
  assert.notEqual(host.playerId, hostUser.user.id);
  assertPrivateView(host.view, host.playerId);
  let guest;

  await t.test('verified identities, membership, and command receipts survive separate requests', async () => {
    expectStatus(await api(undefined, `/api/rooms/${host.code}`), 401, 'API key without a user session');
    expectStatus(await api({ access_token: 'invalid-token' }, `/api/rooms/${host.code}`), 401, 'Forged user token');
    expectStatus(await api(outsider, `/api/rooms/${host.code}`), 403, 'Non-member room access');
    assert.deepEqual(expectStatus(await api(hostUser, '/api/rooms', createCommand), 201, 'Repeat room creation'), host);
    expectStatus(await api(hostUser, '/api/rooms', { ...createCommand, body: { name: 'Changed payload' } }), 409, 'Reuse an idempotency key for another command');
    guest = expectStatus(await api(guestUser, `/api/rooms/${host.code}/join`, {
      method: 'POST', body: { name: 'Cloud test guest' },
    }), 201, 'Join room');
    assertPrivateView(guest.view, guest.playerId);
    expectStatus(await api(guestUser, `/api/rooms/${host.code}/start`, { method: 'POST', body: {} }), 403, 'A guest cannot start the room');
  });

  await t.test('competing unused-color choices commit only once and remain after reload', async () => {
    const attempts = await Promise.all([hostUser, guestUser].map(user => api(user, `/api/rooms/${host.code}/color`, {
      method: 'POST', body: { color: 'red' },
    })));
    assert.deepEqual(attempts.map(result => result.status).sort(), [200, 409]);
    const view = expectStatus(await api(hostUser, `/api/rooms/${host.code}`), 200, 'Reload chosen colors');
    assert.equal(view.players.filter(player => player.color === 'red').length, 1);
    assert.equal(new Set(view.players.map(player => player.color)).size, 2);
    assert.equal(view.revision, guest.view.revision + 1);
    expectStatus(await api(hostUser, `/api/rooms/${host.code}/color`, {
      method: 'POST', body: { color: 'purple' },
    }), 400, 'Reject an unknown color');
  });

  await t.test('starting preserves chosen gardens and exposes only each member hand', async () => {
    for (const [user, name] of [[thirdUser, 'Cloud test third'], [fourthUser, 'Cloud test fourth']]) {
      expectStatus(await api(user, `/api/rooms/${host.code}/join`, { method: 'POST', body: { name } }), 201, 'Fill the room');
    }
    expectStatus(await api(outsider, `/api/rooms/${host.code}/join`, { method: 'POST', body: { name: 'Fifth player' } }), 409, 'Reject a fifth seat');
    const view = expectStatus(await api(hostUser, `/api/rooms/${host.code}/start`, { method: 'POST', body: {} }), 200, 'Start game');
    assert.equal(view.status, 'playing');
    assertPrivateView(view, host.playerId);
    const starts = { green: 2, yellow: 14, blue: 22, red: 10 };
    for (const player of view.players) {
      const gardener = view.game.players.find(item => item.id === player.id);
      assert.equal(gardener.color, player.color);
      assert.equal(gardener.position, starts[player.color]);
      assert.equal(view.game.board[gardener.position].color, player.color);
    }
    const guestView = expectStatus(await api(guestUser, `/api/rooms/${host.code}`), 200, 'Read guest hand');
    assertPrivateView(guestView, guest.playerId);
    expectStatus(await api(hostUser, `/api/rooms/${host.code}/color`, {
      method: 'POST', body: { color: view.players[0].color },
    }), 409, 'Colors cannot change during play');
  });

  await t.test('Data API grants and row policies block state bypasses and other private views', async () => {
    for (const table of ['rooms', 'members', 'commands', 'bot_jobs']) {
      const result = await request(`/rest/v1/${table}?select=*&limit=1`, { user: hostUser });
      assert.ok([401, 403].includes(result.status), `${table} must not expose authoritative rows: HTTP ${result.status}`);
    }
    const own = expectStatus(await request(`/rest/v1/player_views?room_code=eq.${host.code}&select=*`, { user: hostUser }), 200, 'Read own Realtime view');
    assert.equal(own.length, 1);
    assert.equal(own[0].user_id, hostUser.user.id);
    assertPrivateView(own[0].view, host.playerId);
    const guestRows = expectStatus(await request(`/rest/v1/player_views?room_code=eq.${host.code}&user_id=eq.${guestUser.user.id}&select=*`, { user: hostUser }), 200, 'Filter for another user private view');
    assert.deepEqual(guestRows, []);
    const outsideRows = expectStatus(await request(`/rest/v1/player_views?room_code=eq.${host.code}&select=*`, { user: outsider }), 200, 'Non-member Realtime views');
    assert.deepEqual(outsideRows, []);
    const write = await request(`/rest/v1/player_views?room_code=eq.${host.code}`, {
      method: 'PATCH', user: hostUser, body: { revision: 999_999 },
    });
    assert.ok([401, 403].includes(write.status), 'A member cannot forge a persisted private view.');
    const rpcBodies = {
      load_cloud_room: { p_code: host.code },
      claim_cloud_bot_job: { p_room_code: host.code },
      commit_cloud_room: {
        p_room: { code: host.code }, p_expected_revision: own[0].revision, p_actor_id: hostUser.user.id,
        p_request_id: randomUUID(), p_request_hash: 'a'.repeat(64), p_response: {}, p_views: [],
      },
    };
    for (const [name, body] of Object.entries(rpcBodies)) {
      const result = await request(`/rest/v1/rpc/${name}`, { method: 'POST', user: hostUser, body });
      assert.ok([401, 403].includes(result.status), `${name} must require backend privileges: HTTP ${result.status}`);
    }
    assert.deepEqual(expectStatus(await api(hostUser, `/api/rooms/${host.code}`), 200, 'Forbidden writes preserve the room'), own[0].view);
  });

  await t.test('same-revision actions and accepted retries cannot duplicate a tile or draw', async () => {
    const view = expectStatus(await api(hostUser, `/api/rooms/${host.code}`), 200, 'Read the current turn');
    assert.equal(view.game.currentPlayerId, host.playerId);
    const placement = view.game.legal.placements[0];
    assert.ok(placement);
    const body = { action: { type: 'place', ...placement }, revision: view.revision };
    expectStatus(await api(guestUser, `/api/rooms/${host.code}/actions`, { method: 'POST', body }), 403, 'Reject a forged turn');
    expectStatus(await api(hostUser, `/api/rooms/${host.code}/actions`, {
      method: 'POST', body: { ...body, action: { ...body.action, tileId: 'invented-tile' } },
    }), 400, 'Reject an invented tile');
    assert.deepEqual(expectStatus(await api(hostUser, `/api/rooms/${host.code}`), 200, 'Rejected actions preserve state'), view);
    const commands = [randomUUID(), randomUUID()].map(requestId => ({ method: 'POST', body, requestId }));
    const results = await Promise.all(commands.map(command => api(hostUser, `/api/rooms/${host.code}/actions`, command)));
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
    const winner = results.findIndex(result => result.status === 200);
    const accepted = results[winner].data;
    assert.equal(accepted.revision, view.revision + 1);
    assert.equal(accepted.game.board[placement.index].id, placement.tileId);
    assert.equal(accepted.game.deckCount, view.game.deckCount - 1);
    const repeated = expectStatus(await api(hostUser, `/api/rooms/${host.code}/actions`, commands[winner]), 200, 'Replay accepted action');
    assert.deepEqual(repeated, accepted);
    assert.deepEqual(expectStatus(await api(hostUser, `/api/rooms/${host.code}`), 200, 'Reload committed action'), accepted);
  });

  await t.test('persisted bot work continues after the human finishes and the view reconnects', async () => {
    const session = expectStatus(await api(hostUser, '/api/rooms', { method: 'POST', body: { name: 'Cloud bot host' } }), 201, 'Create bot room');
    roomCodes.push(session.code);
    expectStatus(await api(hostUser, `/api/rooms/${session.code}/bots`, { method: 'POST', body: { count: 3 } }), 200, 'Fill bot seats');
    const started = expectStatus(await api(hostUser, `/api/rooms/${session.code}/start`, { method: 'POST', body: {} }), 200, 'Start bot game');
    assert.equal(started.players.filter(player => player.isBot).length, 3);
    const waiting = await finishHumanTurn(hostUser, session, started);
    const deadline = Date.now() + 60_000;
    let resumed;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 350));
      const view = expectStatus(await api(hostUser, `/api/rooms/${session.code}`), 200, 'Reconnect while bots advance');
      assertPrivateView(view, session.playerId);
      if (view.game.currentPlayerId === session.playerId && view.game.turnNumber >= 5) {
        resumed = view;
        break;
      }
    }
    assert.ok(resumed, 'Persisted bot jobs must return the turn to the human within 60 seconds.');
    assert.ok(resumed.revision > waiting.revision);
    const changed = expectStatus(await api(hostUser, `/api/rooms/${session.code}/actions`, {
      method: 'POST', body: { action: nextAction(resumed), revision: resumed.revision },
    }), 200, 'Human continues after bot turns');
    assert.ok(changed.revision > resumed.revision);
  });

  await t.test('expired bot leases are reclaimed once and stale workers cannot commit or release', {
    skip: serviceKey ? false : 'Set LABIRYNT_SUPABASE_SERVICE_KEY to exercise database leases and clean up this run.',
  }, async () => {
    const before = expectStatus(await api(hostUser, `/api/rooms/${host.code}`), 200, 'Read lease-test control state');
    const oldToken = randomUUID();
    const playerId = randomUUID();
    const inserted = expectStatus(await admin('/rest/v1/bot_jobs', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: {
        room_code: host.code, expected_revision: before.revision, player_id: playerId,
        status: 'running', due_at: new Date(Date.now() + 300_000).toISOString(),
        leased_until: new Date(Date.now() + 300_000).toISOString(), lease_token: oldToken,
      },
    }), 201, 'Create an isolated interrupted lease');
    const jobId = inserted[0].id;
    const claim = () => admin('/rest/v1/rpc/claim_cloud_bot_job', { method: 'POST', body: { p_room_code: host.code } });
    assert.equal(expectStatus(await claim(), 200, 'An unexpired lease excludes other workers'), null);
    expectStatus(await admin(`/rest/v1/bot_jobs?id=eq.${jobId}`, {
      method: 'PATCH', body: { leased_until: new Date(Date.now() - 1_000).toISOString() },
    }), 204, 'Expire only the test lease');
    const claims = await Promise.all([claim(), claim()]);
    claims.forEach(result => expectStatus(result, 200, 'Competing lease claim'));
    assert.equal(claims.filter(result => result.data === null).length, 1);
    const recovered = claims.find(result => result.data !== null).data;
    assert.equal(recovered.id, jobId);
    assert.notEqual(recovered.lease_token, oldToken);
    assert.equal(recovered.attempts, 1);
    expectStatus(await admin('/rest/v1/rpc/commit_cloud_room', {
      method: 'POST', body: {
        p_room: { code: host.code, revision: before.revision + 1 }, p_expected_revision: before.revision,
        p_actor_id: playerId, p_request_id: `bot:${jobId}`, p_request_hash: 'b'.repeat(64),
        p_response: { status: 200, body: {} }, p_views: [], p_bot_job_id: jobId, p_lease_token: oldToken,
      },
    }), 409, 'An expired worker cannot commit');
    expectStatus(await admin('/rest/v1/rpc/release_cloud_bot_job', {
      method: 'POST', body: { p_job_id: jobId, p_lease_token: oldToken, p_error: 'Stale worker' },
    }), 204, 'A stale release is harmless');
    const stillLeased = expectStatus(await admin(`/rest/v1/bot_jobs?id=eq.${jobId}&select=status,lease_token`), 200, 'Read recovered lease');
    assert.deepEqual(stillLeased, [{ status: 'running', lease_token: recovered.lease_token }]);
    expectStatus(await admin('/rest/v1/rpc/release_cloud_bot_job', {
      method: 'POST', body: { p_job_id: jobId, p_lease_token: recovered.lease_token },
    }), 204, 'The current worker can finish its lease');
    const finished = expectStatus(await admin(`/rest/v1/bot_jobs?id=eq.${jobId}&select=status,lease_token`), 200, 'Read completed lease');
    assert.deepEqual(finished, [{ status: 'done', lease_token: null }]);
    assert.deepEqual(expectStatus(await api(hostUser, `/api/rooms/${host.code}`), 200, 'Lease probes preserve game state'), before);
  });
});
