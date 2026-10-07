import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from '../server.mjs';
import { applyAction, viewFor } from '../src/engine.mjs';

async function fixture(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'zapomniany-labirynt-'));
  const dataDir = path.join(directory, 'data');
  const publicDir = path.join(directory, 'public');
  await mkdir(publicDir);
  await writeFile(path.join(publicDir, 'index.html'), '<!doctype html><title>Labirynt</title>');
  const instances = [];
  t.after(async () => {
    await Promise.all(instances.map(server => server.closeGracefully()));
    await rm(directory, { recursive: true, force: true });
  });
  const state = { directory, dataDir, publicDir };
  state.start = async (overrides = {}) => {
    const server = await createServer({ dataDir, publicDir, heartbeatMs: 100, ...options, ...overrides });
    instances.push(server);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    state.server = server;
    state.base = `http://127.0.0.1:${server.address().port}`;
  };
  state.request = async (route, { method = 'GET', body, token, headers = {} } = {}) => {
    const response = await fetch(`${state.base}${route}`, {
      method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(5_000),
    });
    const text = await response.text();
    const data = response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : text;
    return { status: response.status, data, headers: response.headers };
  };
  await state.start();
  return state;
}

async function createRoom(app, name = 'Ala') {
  const result = await app.request('/api/rooms', { method: 'POST', body: { name } });
  assert.equal(result.status, 201);
  return result.data;
}

async function joinRoom(app, code, name) {
  const result = await app.request(`/api/rooms/${code}/join`, { method: 'POST', body: { name } });
  assert.equal(result.status, 201);
  return result.data;
}

async function activeRoom(app) {
  const host = await createRoom(app);
  const sessions = [host];
  for (const name of ['Bartek', 'Celina', 'Darek']) sessions.push(await joinRoom(app, host.code, name));
  const started = await app.request(`/api/rooms/${host.code}/start`, { method: 'POST', body: {}, token: host.token });
  assert.equal(started.status, 200);
  const current = sessions.find(session => session.playerId === started.data.game.currentPlayerId);
  const currentView = (await app.request(`/api/rooms/${host.code}`, { token: current.token })).data;
  return { code: host.code, host, sessions, current, view: currentView };
}

async function botRoom(app) {
  const host = await createRoom(app);
  const added = await app.request(`/api/rooms/${host.code}/bots`, { method: 'POST', token: host.token, body: { count: 3 } });
  assert.equal(added.status, 200);
  const started = await app.request(`/api/rooms/${host.code}/start`, { method: 'POST', token: host.token, body: {} });
  assert.equal(started.status, 200);
  return { host, view: started.data };
}

async function finishHumanTurn(app, host, initialView) {
  let view = initialView;
  for (let count = 0; count < 12 && view.game.currentPlayerId === host.playerId; count += 1) {
    const { legal, turn } = view.game;
    let action;
    if (turn.pending?.kind === 'discard') action = { type: 'discard', tileId: legal.discardTileIds[0] };
    else if (turn.pending) action = { type: 'skipAbility' };
    else if (legal.placements.length) action = { type: 'place', ...legal.placements[0] };
    else if (!turn.placed && legal.removals.length) action = { type: 'remove', index: legal.removals[0] };
    else if (legal.moves.length) action = { type: 'move', index: legal.moves[0] };
    assert.ok(action, 'The human turn must have a legal action.');
    const result = await app.request(`/api/rooms/${host.code}/actions`, { method: 'POST', token: host.token, body: { action, revision: view.revision } });
    assert.equal(result.status, 200);
    view = result.data;
  }
  assert.notEqual(view.game.currentPlayerId, host.playerId);
  return view;
}

async function waitForView(app, host, predicate) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await app.request(`/api/rooms/${host.code}`, { token: host.token });
    assert.equal(result.status, 200);
    if (predicate(result.data)) return result.data;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  assert.fail('The expected automated turn did not complete within five seconds.');
}

function assertPrivateView(view, playerId) {
  assert.equal(view.you, playerId);
  assert.equal(view.players.length, 4);
  for (const player of view.players) {
    assert.equal(Object.hasOwn(player, 'tokenHash'), false);
    assert.equal(Object.hasOwn(player, 'token'), false);
  }
  assert.equal(Object.hasOwn(view.game, 'deck'), false);
  assert.equal(Object.hasOwn(view.game, 'discard'), false);
  assert.equal(Object.hasOwn(view.game, 'rngState'), false);
  for (const player of view.game.players) {
    if (player.id === playerId) assert.ok(Array.isArray(player.hand));
    else {
      assert.equal(Object.hasOwn(player, 'hand'), false);
      assert.equal(typeof player.handCount, 'number');
    }
  }
}

async function eventStream(t, app, session) {
  const abort = new AbortController();
  const response = await fetch(`${app.base}/api/rooms/${session.code}/events`, {
    headers: { Authorization: `Bearer ${session.token}` },
    signal: abort.signal,
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  t.after(() => abort.abort());
  return {
    close() { abort.abort(); },
    async nextView(predicate = () => true) {
      const deadline = setTimeout(() => abort.abort(), 5_000);
      try {
        while (true) {
          const boundary = buffer.indexOf('\n\n');
          if (boundary >= 0) {
            const event = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const data = event.split('\n').find(line => line.startsWith('data: '));
            if (!data) continue;
            const view = JSON.parse(data.slice(6));
            if (predicate(view)) return view;
            continue;
          }
          const next = await reader.read();
          assert.equal(next.done, false, 'The event stream ended before the expected view.');
          buffer += decoder.decode(next.value, { stream: true });
        }
      } finally {
        clearTimeout(deadline);
      }
    },
  };
}

test('only four authenticated players can enter, and only the host starts a full room', async t => {
  const app = await fixture(t);
  const host = await createRoom(app, '  Ala  ');
  assert.equal(host.view.players[0].name, 'Ala');
  assert.equal(host.view.revision, 1);
  assert.match(host.code, /^[A-Z2-9]{6}$/);
  assert.equal((await app.request(`/api/rooms/${host.code}`)).status, 401);
  assert.equal((await app.request(`/api/rooms/${host.code}`, { token: 'x'.repeat(43) })).status, 401);
  assert.equal((await app.request(`/api/rooms/${host.code}/events`)).status, 401);
  assert.equal((await app.request(`/api/rooms/${host.code}/start`, { method: 'POST', body: {}, token: host.token })).status, 400);
  const guest = await joinRoom(app, host.code, 'Bartek');
  assert.equal((await app.request(`/api/rooms/${host.code}/start`, { method: 'POST', body: {}, token: guest.token })).status, 403);
  await joinRoom(app, host.code, 'Celina');
  await joinRoom(app, host.code, 'Darek');
  assert.equal((await app.request(`/api/rooms/${host.code}/join`, { method: 'POST', body: { name: 'Ewa' } })).status, 409);
  const result = await app.request(`/api/rooms/${host.code}/start`, { method: 'POST', body: {}, token: host.token });
  assert.equal(result.status, 200);
  assert.equal(result.data.revision, 5);
  assert.equal(result.data.status, 'playing');
  assertPrivateView(result.data, host.playerId);
  const guestView = (await app.request(`/api/rooms/${host.code}`, { token: guest.token })).data;
  assertPrivateView(guestView, guest.playerId);
  assert.equal((await app.request(`/api/rooms/${host.code}/join`, { method: 'POST', body: { name: 'Ewa' } })).status, 409);
  assert.equal((await app.request(`/api/rooms/${host.code}/start`, { method: 'POST', body: {}, token: host.token })).status, 409);
});

test('the server rejects forged turns and invalid moves without changing persisted state', async t => {
  const app = await fixture(t);
  const { code, sessions, current, view } = await activeRoom(app);
  const other = sessions.find(session => session.playerId !== current.playerId);
  const originalSave = await readFile(path.join(app.dataDir, 'rooms.json'), 'utf8');
  const placement = view.game.legal.placements[0];
  assert.ok(placement, 'The starting player has a legal placement.');
  const wrongPlayer = await app.request(`/api/rooms/${code}/actions`, { method: 'POST', token: other.token, body: { action: { type: 'place', ...placement }, revision: view.revision } });
  assert.equal(wrongPlayer.status, 403);
  const invalidEnd = await app.request(`/api/rooms/${code}/actions`, { method: 'POST', token: current.token, body: { action: { type: 'endTurn' }, revision: view.revision } });
  assert.equal(invalidEnd.status, 400);
  const inventedTile = await app.request(`/api/rooms/${code}/actions`, { method: 'POST', token: current.token, body: { action: { type: 'place', ...placement, tileId: 'tile-that-is-not-in-hand' }, revision: view.revision } });
  assert.equal(inventedTile.status, 400);
  const forgedOwner = await app.request(`/api/rooms/${code}/actions`, { method: 'POST', token: current.token, body: { action: { type: 'move', index: 3, playerId: other.playerId }, revision: view.revision } });
  assert.equal(forgedOwner.status, 400);
  assert.equal(await readFile(path.join(app.dataDir, 'rooms.json'), 'utf8'), originalSave);
  const unchanged = (await app.request(`/api/rooms/${code}`, { token: current.token })).data;
  assert.deepEqual(unchanged, view);
});

test('simultaneous actions at the same revision commit exactly one legal change', async t => {
  const app = await fixture(t);
  const { code, current, view } = await activeRoom(app);
  const original = JSON.parse(await readFile(path.join(app.dataDir, 'rooms.json'), 'utf8')).rooms.find(room => room.code === code);
  const placement = view.game.legal.placements[0];
  assert.ok(placement);
  const request = { method: 'POST', token: current.token, body: { action: { type: 'place', ...placement }, revision: view.revision } };
  const expectedGame = applyAction(original.game, current.playerId, request.body.action);
  const expectedView = viewFor(expectedGame, current.playerId);
  expectedView.players = expectedView.players.map(player => ({ ...player, isBot: false }));
  const results = await Promise.all([app.request(`/api/rooms/${code}/actions`, request), app.request(`/api/rooms/${code}/actions`, request)]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const accepted = results.find(result => result.status === 200).data;
  assert.equal(accepted.revision, view.revision + 1);
  assert.equal(accepted.game.board[placement.index].id, placement.tileId);
  assert.deepEqual(accepted.game, expectedView, 'One accepted placement includes a refill only when it completes the turn.');
  const saved = JSON.parse(await readFile(path.join(app.dataDir, 'rooms.json'), 'utf8'));
  assert.equal(saved.rooms[0].revision, accepted.revision);
  assert.deepEqual(saved.rooms[0].game, expectedGame, 'Competing commands cannot change hidden hands or the draw order twice.');
});

test('SSE delivers player-specific live views, connection presence, and accepted actions', async t => {
  const app = await fixture(t);
  const { code, sessions, current, view } = await activeRoom(app);
  const other = sessions.find(session => session.playerId !== current.playerId);
  const currentStream = await eventStream(t, app, current);
  const first = await currentStream.nextView();
  assertPrivateView(first, current.playerId);
  assert.equal(first.players.find(player => player.id === current.playerId).connected, true);
  const otherStream = await eventStream(t, app, other);
  const otherFirst = await otherStream.nextView();
  assertPrivateView(otherFirst, other.playerId);
  assert.equal(otherFirst.players.find(player => player.id === other.playerId).connected, true);
  const placement = view.game.legal.placements[0];
  const accepted = await app.request(`/api/rooms/${code}/actions`, { method: 'POST', token: current.token, body: { action: { type: 'place', ...placement }, revision: view.revision } });
  assert.equal(accepted.status, 200);
  const liveCurrent = await currentStream.nextView(next => next.revision === accepted.data.revision);
  const liveOther = await otherStream.nextView(next => next.revision === accepted.data.revision);
  assertPrivateView(liveCurrent, current.playerId);
  assertPrivateView(liveOther, other.playerId);
  assert.deepEqual(liveCurrent.game.board, liveOther.game.board);
  assert.equal(liveOther.game.players.find(player => player.id === current.playerId).hand, undefined);
  otherStream.close();
  const disconnected = await currentStream.nextView(next => !next.players.find(player => player.id === other.playerId).connected);
  assert.equal(disconnected.revision, accepted.data.revision);
  currentStream.close();
});

test('the final movement automatically advances, persists, and broadcasts the next turn with one revision', async t => {
  const app = await fixture(t);
  const { code, sessions, current, view } = await activeRoom(app);
  const nextPlayer = sessions[(sessions.indexOf(current) + 1) % sessions.length];
  const stream = await eventStream(t, app, nextPlayer);
  await stream.nextView();
  const hand = view.game.players.find(player => player.id === current.playerId).hand;
  const placement = view.game.legal.placements.find(candidate => candidate.index === 7 && (hand.find(tile => tile.id === candidate.tileId).kind !== 'oneway' || candidate.rotation === 1));
  assert.ok(placement, 'A tile below the starting garden must allow a southward move.');
  let prepared = await app.request(`/api/rooms/${code}/actions`, { method: 'POST', token: current.token, body: { action: { type: 'place', ...placement }, revision: view.revision } });
  assert.equal(prepared.status, 200);
  assert.equal(prepared.data.game.currentPlayerId, current.playerId);
  if (prepared.data.game.turn.pending) {
    prepared = await app.request(`/api/rooms/${code}/actions`, { method: 'POST', token: current.token, body: { action: { type: 'skipAbility' }, revision: prepared.data.revision } });
    assert.equal(prepared.status, 200);
    assert.equal(prepared.data.game.currentPlayerId, current.playerId);
  }
  assert.ok(prepared.data.game.legal.moves.includes(7));
  const finished = await app.request(`/api/rooms/${code}/actions`, { method: 'POST', token: current.token, body: { action: { type: 'move', index: 7 }, revision: prepared.data.revision } });
  assert.equal(finished.status, 200);
  assert.equal(finished.data.revision, prepared.data.revision + 1);
  assert.equal(finished.data.game.currentPlayerId, nextPlayer.playerId);
  assert.equal(finished.data.game.turnNumber, view.game.turnNumber + 1);
  assert.deepEqual(finished.data.game.turn, { moved: false, placed: false, pending: null });
  assert.equal(finished.data.game.legal.moves.length, 0);
  assert.equal(finished.data.game.legal.placements.length, 0);
  const synchronized = await stream.nextView(next => next.revision === finished.data.revision);
  assert.equal(synchronized.game.currentPlayerId, nextPlayer.playerId);
  assert.equal(synchronized.game.turnNumber, finished.data.game.turnNumber);
  assert.deepEqual(synchronized.game.board, finished.data.game.board);
  assertPrivateView(synchronized, nextPlayer.playerId);
  const storagePath = path.join(app.dataDir, 'rooms.json');
  const persistedText = await readFile(storagePath, 'utf8');
  const persisted = JSON.parse(persistedText).rooms[0];
  assert.equal(persisted.revision, finished.data.revision);
  assert.equal(persisted.game.currentPlayerId, nextPlayer.playerId);
  assert.deepEqual(persisted.game.turn, finished.data.game.turn);
  const forbidden = await app.request(`/api/rooms/${code}/actions`, { method: 'POST', token: current.token, body: { action: { type: 'move', index: 7 }, revision: finished.data.revision } });
  assert.equal(forbidden.status, 403);
  assert.equal(await readFile(storagePath, 'utf8'), persistedText);
  stream.close();
});

test('rooms and hashed sessions survive a server restart with the same private views', async t => {
  const app = await fixture(t);
  const { code, current, sessions, view } = await activeRoom(app);
  const placement = view.game.legal.placements[0];
  const accepted = await app.request(`/api/rooms/${code}/actions`, { method: 'POST', token: current.token, body: { action: { type: 'place', ...placement }, revision: view.revision } });
  assert.equal(accepted.status, 200);
  const disk = await readFile(path.join(app.dataDir, 'rooms.json'), 'utf8');
  for (const session of sessions) assert.equal(disk.includes(session.token), false);
  for (const player of JSON.parse(disk).rooms[0].players) assert.match(player.tokenHash, /^[a-f0-9]{64}$/);
  await app.server.closeGracefully();
  await app.start();
  const restored = await app.request(`/api/rooms/${code}`, { token: current.token });
  assert.equal(restored.status, 200);
  assert.deepEqual(restored.data, accepted.data);
  assertPrivateView(restored.data, current.playerId);
  for (const session of sessions) assert.equal((await app.request(`/api/rooms/${code}`, { token: session.token })).status, 200);
});

test('static serving cannot expose saved games, symlinks, or private files', async t => {
  const app = await fixture(t);
  await createRoom(app);
  await symlink(path.join(app.dataDir, 'rooms.json'), path.join(app.publicDir, 'save.json'));
  await writeFile(path.join(app.publicDir, '.private'), 'secret');
  const index = await app.request('/');
  assert.equal(index.status, 200);
  assert.match(index.data, /<title>Labirynt<\/title>/);
  assert.equal(index.headers.get('x-content-type-options'), 'nosniff');
  assert.match(index.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  for (const route of ['/data/rooms.json', '/save.json', '/.private', '/%2e%2e%2fdata%2frooms.json', '/%00']) {
    assert.equal((await app.request(route)).status, 404, route);
  }
});

test('request validation, room limits, and rate limits bound server resources', async t => {
  const app = await fixture(t, { maxBodyBytes: 128, maxRooms: 1, apiRateLimit: 12, roomRateLimit: 20 });
  assert.equal((await app.request('/api/rooms', { method: 'POST', body: { name: 'x'.repeat(200) } })).status, 413);
  assert.equal((await app.request('/api/rooms', { method: 'POST', body: { name: '' } })).status, 400);
  assert.equal((await app.request('/api/rooms', { method: 'POST', body: { name: 'Ala', game: {} } })).status, 400);
  await createRoom(app);
  assert.equal((await app.request('/api/rooms', { method: 'POST', body: { name: 'Bartek' } })).status, 503);
  let limited;
  for (let count = 0; count < 8; count += 1) limited = await app.request('/api/health');
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '60');
});

test('a corrupt save fails startup without silently replacing user games', async t => {
  const app = await fixture(t);
  await app.server.closeGracefully();
  const saved = '{this is not a complete game';
  await writeFile(path.join(app.dataDir, 'rooms.json'), saved);
  await assert.rejects(createServer({ dataDir: app.dataDir, publicDir: app.publicDir }), /Nie można odczytać zapisu gry/);
  assert.equal(await readFile(path.join(app.dataDir, 'rooms.json'), 'utf8'), saved);
});

test('only the host can add or remove lobby bots, and removing them preserves human sessions and seat colors', async t => {
  const app = await fixture(t);
  const host = await createRoom(app);
  const endpoint = `/api/rooms/${host.code}/bots`;
  assert.equal((await app.request(endpoint, { method: 'POST', body: { count: 1 } })).status, 401);
  for (const count of [0, 4, 1.5, '1']) {
    assert.equal((await app.request(endpoint, { method: 'POST', token: host.token, body: { count } })).status, 400);
  }
  const added = await app.request(endpoint, { method: 'POST', token: host.token, body: { count: 1 } });
  assert.equal(added.status, 200);
  assert.equal(added.data.revision, host.view.revision + 1);
  assert.deepEqual(added.data.players.map(player => player.isBot), [false, true]);
  assert.deepEqual(added.data.players.map(player => player.color), ['green', 'yellow']);
  const guest = await joinRoom(app, host.code, 'Bartek');
  assert.equal(guest.view.players.find(player => player.id === guest.playerId).color, 'blue');
  for (const method of ['POST', 'DELETE']) {
    const body = method === 'POST' ? { count: 1 } : {};
    assert.equal((await app.request(endpoint, { method, token: guest.token, body })).status, 403);
  }
  assert.equal((await app.request(endpoint, { method: 'POST', token: host.token, body: { count: 2 } })).status, 409);
  const removed = await app.request(endpoint, { method: 'DELETE', token: host.token, body: {} });
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.data.players.map(player => [player.id, player.name, player.color, player.isBot]), [
    [host.playerId, 'Ala', 'green', false],
    [guest.playerId, 'Bartek', 'blue', false],
  ]);
  assert.equal((await app.request(`/api/rooms/${host.code}`, { token: guest.token })).status, 200);
  await joinRoom(app, host.code, 'Celina');
  const finalBot = await app.request(endpoint, { method: 'POST', token: host.token, body: { count: 1 } });
  assert.equal(finalBot.status, 200);
  assert.equal(finalBot.data.players[3].isBot, true);
  assert.equal(finalBot.data.players[3].color, 'red');
  assert.equal((await app.request(`/api/rooms/${host.code}/join`, { method: 'POST', body: { name: 'Ewa' } })).status, 409);
  assert.equal((await app.request(`/api/rooms/${host.code}/start`, { method: 'POST', token: host.token, body: {} })).status, 200);
  assert.equal((await app.request(endpoint, { method: 'DELETE', token: host.token, body: {} })).status, 409);
  assert.equal((await app.request(endpoint, { method: 'POST', token: host.token, body: { count: 1 } })).status, 409);
});

test('bots have no credentials and human views never expose their private hands', async t => {
  const app = await fixture(t);
  const { host, view } = await botRoom(app);
  assertPrivateView(view, host.playerId);
  assert.deepEqual(view.game.players.map(player => player.isBot), [false, true, true, true]);
  assert.deepEqual(view.players.map(player => player.isBot), [false, true, true, true]);
  const saved = JSON.parse(await readFile(path.join(app.dataDir, 'rooms.json'), 'utf8')).rooms[0];
  for (const bot of saved.players.filter(player => player.isBot)) {
    assert.equal(Object.hasOwn(bot, 'tokenHash'), false);
    assert.equal(Object.hasOwn(bot, 'token'), false);
  }
  assert.equal((await app.request(`/api/rooms/${host.code}`, { token: 'x'.repeat(43) })).status, 401);
  assert.equal((await app.request(`/api/rooms/${host.code}/actions`, {
    method: 'POST', token: host.token,
    body: { action: { type: 'endTurn', playerId: saved.players[1].id }, revision: view.revision },
  })).status, 400);
});

test('three server bots complete real turns, publish private SSE updates, and return control to the human', async t => {
  const app = await fixture(t, { botDelayMs: 5 });
  const { host, view } = await botRoom(app);
  const stream = await eventStream(t, app, host);
  await stream.nextView();
  const firstBotView = await finishHumanTurn(app, host, view);
  const views = [];
  const returned = await stream.nextView(next => {
    if (next.revision >= firstBotView.revision) {
      assertPrivateView(next, host.playerId);
      views.push(next);
    }
    return next.game.turnNumber === 5 && next.game.currentPlayerId === host.playerId;
  });
  assert.ok(returned.revision >= firstBotView.revision + 3);
  assert.deepEqual([...new Set(views.map(next => next.game.turnNumber))], [2, 3, 4, 5]);
  const revisions = views.map(next => next.revision);
  assert.deepEqual(revisions, Array.from({ length: revisions.length }, (_, index) => firstBotView.revision + index));
  assert.ok(returned.game.players.slice(1).every(player => player.handCount === 4 - player.flowers.length));
  const stale = await app.request(`/api/rooms/${host.code}/actions`, { method: 'POST', token: host.token, body: { action: { type: 'endTurn' }, revision: firstBotView.revision } });
  assert.equal(stale.status, 409);
  const saved = JSON.parse(await readFile(path.join(app.dataDir, 'rooms.json'), 'utf8')).rooms[0];
  assert.equal(saved.revision, returned.revision);
  assert.equal(saved.game.currentPlayerId, host.playerId);
  stream.close();
});

test('restart resumes a pending bot turn without a connected human and preserves legacy human saves', async t => {
  const app = await fixture(t, { botDelayMs: 1_000 });
  const { host, view } = await botRoom(app);
  const firstBotView = await finishHumanTurn(app, host, view);
  const forbidden = await app.request(`/api/rooms/${host.code}/actions`, { method: 'POST', token: host.token, body: { action: { type: 'endTurn' }, revision: firstBotView.revision } });
  assert.equal(forbidden.status, 403);
  await app.server.closeGracefully();
  const storagePath = path.join(app.dataDir, 'rooms.json');
  const stored = JSON.parse(await readFile(storagePath, 'utf8'));
  assert.equal(stored.rooms[0].revision, firstBotView.revision);
  delete stored.rooms[0].players[0].isBot;
  await writeFile(storagePath, JSON.stringify(stored));
  await app.start({ botDelayMs: 5 });
  const returned = await waitForView(app, host, next => next.game.turnNumber === 5 && next.game.currentPlayerId === host.playerId);
  assert.equal(returned.players[0].isBot, false);
  assert.equal(returned.players[0].connected, false);
  assertPrivateView(returned, host.playerId);
  assert.ok(returned.revision > firstBotView.revision);
  const disk = JSON.parse(await readFile(storagePath, 'utf8')).rooms[0];
  assert.equal(disk.revision, returned.revision);
  assert.equal(disk.game.currentPlayerId, host.playerId);
});

test('a human can choose an unused lobby color, broadcasting and persisting only their own change', async t => {
  const app = await fixture(t);
  const host = await createRoom(app);
  const guest = await joinRoom(app, host.code, 'Bartek');
  const endpoint = `/api/rooms/${host.code}/color`;
  const storagePath = path.join(app.dataDir, 'rooms.json');
  const before = JSON.parse(await readFile(storagePath, 'utf8')).rooms[0];
  assert.equal((await app.request(endpoint, { method: 'POST', body: { color: 'blue' } })).status, 401);
  for (const body of [{ color: 'purple' }, { color: null }, {}, { color: 'blue', playerId: host.playerId }]) {
    assert.equal((await app.request(endpoint, { method: 'POST', token: guest.token, body })).status, 400);
  }
  assert.deepEqual(JSON.parse(await readFile(storagePath, 'utf8')).rooms[0], before);
  const stream = await eventStream(t, app, host);
  await stream.nextView();
  const changed = await app.request(endpoint, { method: 'POST', token: guest.token, body: { color: 'blue' } });
  assert.equal(changed.status, 200);
  assert.equal(changed.data.revision, before.revision + 1);
  assert.equal(changed.data.you, guest.playerId);
  assert.deepEqual(changed.data.players.map(player => [player.id, player.color]), [[host.playerId, 'green'], [guest.playerId, 'blue']]);
  const synchronized = await stream.nextView(view => view.revision === changed.data.revision);
  assert.equal(synchronized.you, host.playerId);
  assert.deepEqual(synchronized.players, changed.data.players);
  const savedText = await readFile(storagePath, 'utf8');
  const saved = JSON.parse(savedText).rooms[0];
  assert.equal(saved.revision, changed.data.revision);
  assert.equal(saved.players[1].color, 'blue');
  assert.deepEqual(saved.players.map(player => [player.id, player.name, player.tokenHash]), before.players.map(player => [player.id, player.name, player.tokenHash]));
  const repeated = await app.request(endpoint, { method: 'POST', token: guest.token, body: { color: 'blue' } });
  assert.equal(repeated.status, 200);
  assert.equal(repeated.data.revision, changed.data.revision);
  assert.equal(await readFile(storagePath, 'utf8'), savedText);
  const occupied = await app.request(endpoint, { method: 'POST', token: guest.token, body: { color: 'green' } });
  assert.equal(occupied.status, 409);
  assert.equal(await readFile(storagePath, 'utf8'), savedText);
  stream.close();
  await app.server.closeGracefully();
  await app.start();
  const restored = await app.request(`/api/rooms/${host.code}`, { token: guest.token });
  assert.equal(restored.status, 200);
  assert.equal(restored.data.revision, changed.data.revision);
  assert.deepEqual(restored.data.players.map(player => [player.id, player.color]), changed.data.players.map(player => [player.id, player.color]));
});

test('simultaneous lobby color requests cannot assign the same color twice', async t => {
  const app = await fixture(t);
  const host = await createRoom(app);
  const guest = await joinRoom(app, host.code, 'Bartek');
  const endpoint = `/api/rooms/${host.code}/color`;
  const results = await Promise.all([host, guest].map(session => app.request(endpoint, { method: 'POST', token: session.token, body: { color: 'red' } })));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const current = (await app.request(`/api/rooms/${host.code}`, { token: host.token })).data;
  assert.equal(current.revision, guest.view.revision + 1);
  assert.equal(current.players.filter(player => player.color === 'red').length, 1);
  assert.equal(new Set(current.players.map(player => player.color)).size, 2);
  const losingSession = [host, guest][results.findIndex(result => result.status === 409)];
  assert.equal(current.players.find(player => player.id === losingSession.playerId).color, losingSession.playerId === host.playerId ? 'green' : 'yellow');
  const saved = JSON.parse(await readFile(path.join(app.dataDir, 'rooms.json'), 'utf8')).rooms[0];
  assert.deepEqual(saved.players.map(player => [player.id, player.color]), current.players.map(player => [player.id, player.color]));
});

test('joins and bots use remaining colors, bot removal preserves choices, and games start in the chosen gardens', async t => {
  const app = await fixture(t);
  const host = await createRoom(app);
  const endpoint = `/api/rooms/${host.code}/color`;
  assert.equal((await app.request(endpoint, { method: 'POST', token: host.token, body: { color: 'red' } })).status, 200);
  const guest = await joinRoom(app, host.code, 'Bartek');
  assert.equal(guest.view.players.find(player => player.id === guest.playerId).color, 'green');
  const add = await app.request(`/api/rooms/${host.code}/bots`, { method: 'POST', token: host.token, body: { count: 1 } });
  assert.equal(add.status, 200);
  assert.equal(add.data.players[2].color, 'yellow');
  assert.equal(add.data.players[2].name, 'Bot Żółty');
  assert.equal((await app.request(endpoint, { method: 'POST', token: guest.token, body: { color: 'yellow' } })).status, 409);
  const stillOccupied = (await app.request(`/api/rooms/${host.code}`, { token: guest.token })).data;
  assert.equal(stillOccupied.revision, add.data.revision);
  assert.deepEqual(stillOccupied.players.map(player => [player.id, player.color]), add.data.players.map(player => [player.id, player.color]));
  assert.equal((await app.request(endpoint, { method: 'POST', token: host.token, body: { color: 'blue' } })).status, 200);
  const removed = await app.request(`/api/rooms/${host.code}/bots`, { method: 'DELETE', token: host.token, body: {} });
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.data.players.map(player => [player.id, player.color]), [[host.playerId, 'blue'], [guest.playerId, 'green']]);
  assert.equal((await app.request(`/api/rooms/${host.code}/bots`, { method: 'POST', token: host.token, body: { count: 1 } })).status, 200);
  const thirdHuman = await joinRoom(app, host.code, 'Celina');
  assert.equal(thirdHuman.view.players.find(player => player.id === thirdHuman.playerId).color, 'red');
  const chosen = thirdHuman.view.players.map(player => [player.id, player.color]);
  assert.equal(new Set(chosen.map(([, color]) => color)).size, 4);
  const started = await app.request(`/api/rooms/${host.code}/start`, { method: 'POST', token: host.token, body: {} });
  assert.equal(started.status, 200);
  const gardens = { green: 2, yellow: 14, blue: 22, red: 10 };
  for (const [id, color] of chosen) {
    const player = started.data.game.players.find(candidate => candidate.id === id);
    assert.equal(player.color, color);
    assert.equal(player.position, gardens[color]);
    assert.equal(started.data.game.board[player.position].color, color);
  }
  assertPrivateView(started.data, host.playerId);
  const storagePath = path.join(app.dataDir, 'rooms.json');
  const before = await readFile(storagePath, 'utf8');
  assert.equal((await app.request(endpoint, { method: 'POST', token: host.token, body: { color: 'blue' } })).status, 409);
  assert.equal(await readFile(storagePath, 'utf8'), before);
});

async function nearCompletedRoom(app, { winnerSeat = 0, bots = false, turnCount = 17 } = {}) {
  const host = await createRoom(app, 'Pierwszy');
  assert.equal((await app.request(`/api/rooms/${host.code}/color`, { method: 'POST', token: host.token, body: { color: 'red' } })).status, 200);
  const sessions = [host];
  if (bots) assert.equal((await app.request(`/api/rooms/${host.code}/bots`, { method: 'POST', token: host.token, body: { count: 3 } })).status, 200);
  else for (const name of ['Drugi', 'Trzeci', 'Czwarty']) sessions.push(await joinRoom(app, host.code, name));
  assert.equal((await app.request(`/api/rooms/${host.code}/start`, { method: 'POST', token: host.token, body: {} })).status, 200);
  await app.server.closeGracefully();
  const storagePath = path.join(app.dataDir, 'rooms.json');
  const stored = JSON.parse(await readFile(storagePath, 'utf8'));
  const room = stored.rooms.find(item => item.code === host.code);
  const game = room.game;
  const colors = ['green', 'yellow', 'blue', 'red'];
  game.players.forEach((player, index) => {
    player.flowers = colors.filter(color => color !== player.color).slice(0, index % 3);
  });
  const winner = game.players[winnerSeat];
  const targets = colors.filter(color => color !== winner.color);
  winner.flowers = targets.slice(0, 2);
  const destination = game.board.findIndex(tile => tile?.kind === 'garden' && tile.color === targets[2]);
  const origin = { 2: 7, 14: 13, 22: 17, 10: 11 }[destination];
  const tileIndex = game.deck.findIndex(tile => tile.kind === 'straight' && !tile.ability);
  const [tile] = game.deck.splice(tileIndex, 1);
  game.board[origin] = { ...tile, rotation: origin === 7 || origin === 17 ? 1 : 0 };
  winner.position = origin;
  winner.entry = null;
  game.currentPlayerId = winner.id;
  game.turnNumber = turnCount;
  game.turn = { moved: false, placed: false, pending: null };
  room.revision += 1;
  await writeFile(storagePath, JSON.stringify(stored));
  return { host, sessions, storagePath, room, winner, destination };
}

function assertGameResult(result, room) {
  assert.deepEqual(Object.keys(result).sort(), ['room_code', 'room_created_at', 'finished_at', 'turn_count', 'players', 'starter_id', 'winner_id', 'first_player_won'].sort());
  assert.equal(result.room_code, room.code);
  assert.equal(Date.parse(result.room_created_at), room.createdAt);
  assert.equal(Date.parse(result.finished_at), room.lastActivity);
  assert.equal(result.turn_count, room.game.turnNumber);
  assert.equal(result.starter_id, room.game.players[0].id);
  assert.equal(result.winner_id, room.game.winnerId);
  assert.equal(result.first_player_won, room.game.winnerId === room.game.players[0].id);
  assert.deepEqual(result.players, room.game.players.map(({ id, name, color, flowers }) => ({ id, name, color, isBot: room.players.find(player => player.id === id).isBot === true, flowers })));
  for (const player of result.players) assert.deepEqual(Object.keys(player).sort(), ['id', 'name', 'color', 'isBot', 'flowers'].sort());
}

test('a completed human game saves one private result with every flower and preserves it after restart and room cleanup', async t => {
  const app = await fixture(t);
  const { host, storagePath, room, destination } = await nearCompletedRoom(app);
  assert.deepEqual(JSON.parse(await readFile(storagePath, 'utf8')).results ?? [], []);
  await app.start();
  const body = { revision: room.revision, action: { type: 'move', index: destination } };
  const won = await app.request(`/api/rooms/${room.code}/actions`, { method: 'POST', token: host.token, body });
  assert.equal(won.status, 200);
  assert.equal(won.data.status, 'finished');
  const saved = JSON.parse(await readFile(storagePath, 'utf8'));
  assert.equal(saved.results?.length, 1, 'The winning room snapshot must atomically contain exactly one completed-game result.');
  assertGameResult(saved.results[0], saved.rooms[0]);
  assert.equal(saved.results[0].players[0].color, 'red');
  assert.equal(saved.results[0].first_player_won, true);
  assert.equal((await app.request(`/api/rooms/${room.code}/actions`, { method: 'POST', token: host.token, body })).status, 409);
  assert.deepEqual(JSON.parse(await readFile(storagePath, 'utf8')).results, saved.results);
  assert.equal(Object.hasOwn(won.data, 'results'), false);
  assert.equal((await app.request('/api/results', { token: host.token })).status, 404);
  await app.server.closeGracefully();
  await app.start();
  assert.deepEqual(JSON.parse(await readFile(storagePath, 'utf8')).results, saved.results);
  await app.server.closeGracefully();
  await writeFile(storagePath, JSON.stringify({ ...saved, rooms: [] }));
  await app.start();
  await createRoom(app, 'Nowy pokój');
  const retained = JSON.parse(await readFile(storagePath, 'utf8'));
  assert.equal(retained.rooms.length, 1);
  assert.deepEqual(retained.results, saved.results);
});

test('a bot winning a later seat records the same final statistics and does not count as the starting player', async t => {
  const app = await fixture(t, { botDelayMs: 5 });
  const { host, storagePath } = await nearCompletedRoom(app, { winnerSeat: 1, bots: true, turnCount: 26 });
  await app.start();
  const won = await waitForView(app, host, view => view.status === 'finished');
  const saved = JSON.parse(await readFile(storagePath, 'utf8'));
  assert.equal(saved.results?.length, 1);
  assertGameResult(saved.results[0], saved.rooms[0]);
  assert.equal(saved.results[0].first_player_won, false);
  assert.equal(saved.results[0].turn_count, 26);
  assert.equal(saved.results[0].players[1].isBot, true);
  assert.equal(saved.results[0].winner_id, won.game.players[1].id);
  await app.server.closeGracefully();
  await app.start();
  assert.deepEqual(JSON.parse(await readFile(storagePath, 'utf8')).results, saved.results);
});

test('legacy finished rooms are backfilled once and reusing their code creates a separate match result', async t => {
  const app = await fixture(t);
  const { storagePath, room, winner } = await nearCompletedRoom(app, { turnCount: 33 });
  room.status = room.game.status = 'finished';
  room.game.winnerId = winner.id;
  winner.flowers = ['green', 'yellow', 'blue'];
  room.lastActivity = room.createdAt + 5_000;
  await writeFile(storagePath, JSON.stringify({ version: 1, rooms: [room] }));
  await app.start();
  const first = JSON.parse(await readFile(storagePath, 'utf8'));
  assert.equal(first.results?.length, 1);
  assertGameResult(first.results[0], room);
  await app.server.closeGracefully();
  const reused = structuredClone(room);
  reused.createdAt += 10_000;
  reused.lastActivity += 10_000;
  reused.game.turnNumber = 41;
  await writeFile(storagePath, JSON.stringify({ ...first, rooms: [reused] }));
  await app.start();
  const second = JSON.parse(await readFile(storagePath, 'utf8'));
  assert.equal(second.results.length, 2);
  assert.deepEqual(second.results[0], first.results[0]);
  assertGameResult(second.results[1], reused);
  await app.server.closeGracefully();
  await app.start();
  assert.deepEqual(JSON.parse(await readFile(storagePath, 'utf8')).results, second.results);
});
