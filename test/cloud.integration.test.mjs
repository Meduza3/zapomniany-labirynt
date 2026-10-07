import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { cloudPlayerViews, cloudRoomView } from '../src/cloud-room.mjs';
import { applyAction } from '../src/engine.mjs';

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

  await t.test('same-revision actions and accepted retries cannot duplicate a tile or draw', {
    skip: serviceKey || required ? false : 'Set LABIRYNT_SUPABASE_SERVICE_KEY to compare the committed action with its authoritative before-state.',
  }, async () => {
    assert.ok(serviceKey, 'Required concurrency tests need LABIRYNT_SUPABASE_SERVICE_KEY.');
    const view = expectStatus(await api(hostUser, `/api/rooms/${host.code}`), 200, 'Read the current turn');
    assert.equal(view.game.currentPlayerId, host.playerId);
    const original = expectStatus(await admin('/rest/v1/rpc/load_cloud_room', { method: 'POST', body: { p_code: host.code } }), 200, 'Read only the concurrency fixture before-state');
    assert.deepEqual(cloudRoomView(original, hostUser.user.id), view);
    const placement = view.game.legal.placements[0];
    assert.ok(placement);
    const body = { action: { type: 'place', ...placement }, revision: view.revision };
    const expectedGame = applyAction(original.game, host.playerId, body.action);
    const expected = { ...original, revision: original.revision + 1, status: expectedGame.status, game: expectedGame };
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
    assert.deepEqual(accepted, cloudRoomView(expected, hostUser.user.id), 'Exactly one placement must commit, including a refill only when that action completes the turn.');
    const repeated = expectStatus(await api(hostUser, `/api/rooms/${host.code}/actions`, commands[winner]), 200, 'Replay accepted action');
    assert.deepEqual(repeated, accepted);
    assert.deepEqual(expectStatus(await api(hostUser, `/api/rooms/${host.code}`), 200, 'Reload committed action'), accepted);
    const saved = expectStatus(await admin('/rest/v1/rpc/load_cloud_room', { method: 'POST', body: { p_code: host.code } }), 200, 'Read the persisted action after its retry');
    assert.equal(saved.revision, expected.revision);
    assert.deepEqual(saved.game, expectedGame, 'A replay cannot change hidden hands, deck order, or the completed turn.');
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

function prepareFinalTurn(room, winnerSeat, turnCount) {
  const next = structuredClone(room);
  const colors = ['green', 'yellow', 'blue', 'red'];
  next.game.players.forEach((player, index) => {
    player.flowers = colors.filter(color => color !== player.color).slice(0, index % 3);
  });
  const winner = next.game.players[winnerSeat];
  const targets = colors.filter(color => color !== winner.color);
  winner.flowers = targets.slice(0, 2);
  const destination = next.game.board.findIndex(tile => tile?.kind === 'garden' && tile.color === targets[2]);
  const origin = { 2: 7, 14: 13, 22: 17, 10: 11 }[destination];
  const tileIndex = next.game.deck.findIndex(tile => tile.kind === 'straight' && !tile.ability);
  assert.ok(tileIndex >= 0, 'The final-turn fixture needs one real straight tile from its deck.');
  const [tile] = next.game.deck.splice(tileIndex, 1);
  next.game.board[origin] = { ...tile, rotation: origin === 7 || origin === 17 ? 1 : 0 };
  winner.position = origin;
  winner.entry = null;
  next.game.currentPlayerId = winner.id;
  next.game.turnNumber = turnCount;
  next.game.turn = { moved: false, placed: false, pending: null };
  next.revision += 1;
  next.lastActivity = Date.now();
  return { room: next, destination };
}

async function seedFinalTurn(original, user, winnerSeat, turnCount) {
  const prepared = prepareFinalTurn(original, winnerSeat, turnCount);
  const requestId = randomUUID();
  expectStatus(await admin('/rest/v1/rpc/commit_cloud_room', {
    method: 'POST', body: {
      p_room: prepared.room, p_expected_revision: original.revision,
      p_actor_id: user.user.id, p_request_id: requestId,
      p_request_hash: createHash('sha256').update(requestId).digest('hex'),
      p_response: { status: 200, body: {} }, p_views: cloudPlayerViews(prepared.room),
    },
  }), 200, 'Prepare only the isolated statistics fixture through the real commit transaction');
  return prepared;
}

function resultRoute(code, createdAt) {
  return `/rest/v1/game_results?room_code=eq.${encodeURIComponent(code)}${createdAt === undefined ? '' : `&room_created_at=eq.${encodeURIComponent(new Date(createdAt).toISOString())}`}`;
}

function assertCompletedResult(result, room) {
  assert.deepEqual(Object.keys(result).sort(), ['room_code', 'room_created_at', 'finished_at', 'turn_count', 'players', 'starter_id', 'winner_id', 'first_player_won'].sort());
  assert.equal(result.room_code, room.code);
  assert.equal(Date.parse(result.room_created_at), room.createdAt);
  assert.equal(Date.parse(result.finished_at), room.lastActivity);
  assert.equal(result.turn_count, room.game.turnNumber);
  assert.equal(result.starter_id, room.game.players[0].id);
  assert.equal(result.winner_id, room.game.winnerId);
  assert.equal(result.first_player_won, room.game.winnerId === room.game.players[0].id);
  assert.deepEqual(result.players, room.game.players.map(({ id, name, color, flowers }) => ({ id, name, color, isBot: room.players.find(player => player.id === id).isBot, flowers })));
  for (const player of result.players) assert.deepEqual(Object.keys(player).sort(), ['id', 'name', 'color', 'isBot', 'flowers'].sort());
}

test('completed game statistics stay private, survive room cleanup, and record human and bot wins once', {
  skip: configured && serviceKey ? false : 'Set the real Supabase endpoint, publishable key, and service key to verify private statistics.',
  timeout: 180_000,
}, async t => {
  expectStatus(await admin('/rest/v1/game_results?select=*&limit=0'), 200, 'Statistics table must exist before creating fixtures');
  const users = [], roomCodes = new Set(), resultFixtures = [];
  t.after(async () => {
    for (const code of roomCodes) expectStatus(await admin(`/rest/v1/rooms?code=eq.${encodeURIComponent(code)}`, { method: 'DELETE' }), 204, 'Delete only the statistics test room');
    for (const { code, createdAt } of resultFixtures) expectStatus(await admin(resultRoute(code, createdAt), { method: 'DELETE' }), 204, 'Delete only the statistics fixture result');
    for (const user of users) expectStatus(await admin(`/auth/v1/admin/users/${user.user.id}`, { method: 'DELETE' }), 200, 'Delete only the statistics test account');
    t.diagnostic(`Removed ${roomCodes.size} statistics test rooms, ${resultFixtures.length} result fixtures, and ${users.length} anonymous test account.`);
  });
  const user = expectStatus(await request('/auth/v1/signup', { method: 'POST', body: { data: { labirynt_statistics_test: true } } }), 200, 'Create statistics test identity');
  users.push(user);
  const session = expectStatus(await api(user, '/api/rooms', { method: 'POST', body: { name: 'Statistics test host' } }), 201, 'Create statistics test room');
  roomCodes.add(session.code);
  expectStatus(await api(user, `/api/rooms/${session.code}/color`, { method: 'POST', body: { color: 'red' } }), 200, 'Use a non-green starting player');
  expectStatus(await api(user, `/api/rooms/${session.code}/bots`, { method: 'POST', body: { count: 3 } }), 200, 'Add isolated statistics bots');
  expectStatus(await api(user, `/api/rooms/${session.code}/start`, { method: 'POST', body: {} }), 200, 'Start statistics fixture');
  const original = expectStatus(await admin('/rest/v1/rpc/load_cloud_room', { method: 'POST', body: { p_code: session.code } }), 200, 'Load only the statistics fixture');
  resultFixtures.push({ code: session.code, createdAt: original.createdAt });
  assert.deepEqual(expectStatus(await admin(resultRoute(session.code)), 200, 'Unfinished games have no statistics'), []);
  const prepared = await seedFinalTurn(original, user, 0, 17);
  assert.deepEqual(expectStatus(await admin(resultRoute(session.code)), 200, 'A prepared winning opportunity is not a completed game'), []);
  const winningCommand = { method: 'POST', requestId: randomUUID(), body: { action: { type: 'move', index: prepared.destination }, revision: prepared.room.revision } };
  const won = expectStatus(await api(user, `/api/rooms/${session.code}/actions`, winningCommand), 200, 'Complete the human winning move');
  assert.equal(won.status, 'finished');
  const saved = expectStatus(await admin('/rest/v1/rpc/load_cloud_room', { method: 'POST', body: { p_code: session.code } }), 200, 'Read the persisted winning snapshot');
  const rows = expectStatus(await admin(resultRoute(session.code)), 200, 'Read the private completed result');
  assert.equal(rows.length, 1);
  assertCompletedResult(rows[0], saved);
  assert.equal(rows[0].players[0].color, 'red');
  assert.equal(rows[0].first_player_won, true);
  assert.equal(JSON.stringify(rows).includes(user.user.id), false, 'Result records must not retain authentication identities.');
  for (const identity of [undefined, user]) {
    for (const method of ['GET', 'PATCH', 'DELETE']) {
      const denied = await request(resultRoute(session.code), { method, user: identity, ...(method === 'PATCH' ? { body: { turn_count: 1 } } : {}) });
      assert.ok([401, 403].includes(denied.status), `Statistics ${method} must reject ${identity ? 'authenticated guests' : 'API-key-only callers'}: HTTP ${denied.status}`);
    }
  }
  const deniedRpc = await request('/rest/v1/rpc/record_game_result', { method: 'POST', user, body: { p_room: {} } });
  assert.ok([401, 403].includes(deniedRpc.status), 'Players cannot invoke the statistics recorder.');
  assert.deepEqual(expectStatus(await api(user, `/api/rooms/${session.code}/actions`, winningCommand), 200, 'Retry the accepted winning action'), won);
  expectStatus(await api(user, `/api/rooms/${session.code}/actions`, { ...winningCommand, requestId: randomUUID() }), 409, 'A new command cannot win an already finished game again');
  expectStatus(await admin(`/rest/v1/rooms?code=eq.${session.code}`, { method: 'PATCH', body: { revision: saved.revision + 1 } }), 204, 'Repeat a finished-room persistence trigger');
  assert.deepEqual(expectStatus(await admin(resultRoute(session.code)), 200, 'Retries and finished-state persistence keep one original result'), rows);
  expectStatus(await admin(`/rest/v1/rooms?code=eq.${session.code}`, { method: 'DELETE' }), 204, 'Prune only the completed statistics fixture room');
  assert.deepEqual(expectStatus(await admin(resultRoute(session.code)), 200, 'Room cleanup retains the completed result'), rows);

  const reused = structuredClone(original);
  reused.createdAt += 1;
  reused.lastActivity = Date.now();
  reused.revision = 1;
  const requestId = randomUUID();
  resultFixtures.push({ code: reused.code, createdAt: reused.createdAt });
  expectStatus(await admin('/rest/v1/rpc/commit_cloud_room', {
    method: 'POST', body: {
      p_room: reused, p_expected_revision: 0, p_actor_id: user.user.id, p_request_id: requestId,
      p_request_hash: createHash('sha256').update(requestId).digest('hex'), p_response: { status: 200, body: {} }, p_views: cloudPlayerViews(reused),
    },
  }), 200, 'Create a later fixture match with the same room code');
  await seedFinalTurn(reused, user, 1, 26);
  const deadline = Date.now() + 60_000;
  let botFinished;
  while (Date.now() < deadline) {
    const view = expectStatus(await api(user, `/api/rooms/${session.code}`), 200, 'Wait for the persisted bot winning action');
    if (view.status === 'finished') { botFinished = view; break; }
    await new Promise(resolve => setTimeout(resolve, 350));
  }
  assert.ok(botFinished, 'The real bot worker must finish the isolated winning turn.');
  const botSaved = expectStatus(await admin('/rest/v1/rpc/load_cloud_room', { method: 'POST', body: { p_code: session.code } }), 200, 'Load the persisted bot win');
  const allResults = expectStatus(await admin(`${resultRoute(session.code)}&order=room_created_at.asc`), 200, 'Read two distinct matches with the reused code');
  assert.equal(allResults.length, 2);
  assert.deepEqual(allResults[0], rows[0]);
  assertCompletedResult(allResults[1], botSaved);
  assert.equal(allResults[1].first_player_won, false);
  assert.equal(allResults[1].players[1].isBot, true);
  assert.equal(allResults[1].winner_id, allResults[1].players[1].id);
  assert.equal(allResults[1].turn_count, 26);
  expectStatus(await admin(`/rest/v1/rooms?code=eq.${session.code}`, { method: 'DELETE' }), 204, 'Prune the bot fixture room');
  assert.deepEqual(expectStatus(await admin(`${resultRoute(session.code)}&order=room_created_at.asc`), 200, 'Both match results outlive room cleanup'), allResults);
});
