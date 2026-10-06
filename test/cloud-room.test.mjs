import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { validateEnvelope, canonicalRequest, prepareCloudCommand, prepareCloudBot, cloudRoomView, cloudPlayerViews } from '../src/cloud-room.mjs';
import { chooseBotAction } from '../src/bot.mjs';

function command(path, body = {}, method = 'POST') {
  return validateEnvelope({ path, method, body, requestId: randomUUID() });
}
function lobby() {
  return prepareCloudCommand(null, 'host-auth', command('/api/rooms', { name: 'Ala' }), { code: 'ABC234', now: 1000 }).room;
}
function change(room, user, operation, body = {}, method = 'POST') {
  return prepareCloudCommand(room, user, command(`/api/rooms/${room.code}/${operation}`, body, method), { seed: 123, now: 2000 });
}
function botsGame() {
  let room = lobby();
  room = change(room, 'host-auth', 'bots', { count: 3 }).room;
  return change(room, 'host-auth', 'start').room;
}
function status(expected) { return error => error.status === expected; }

test('cloud envelope rejects identity injection and gives equivalent requests the same fingerprint', () => {
  assert.throws(() => validateEnvelope({ path: '/api/rooms', method: 'POST', body: {} }), status(400));
  assert.throws(() => validateEnvelope({ ...command('/api/rooms'), userId: 'victim' }), status(400));
  assert.throws(() => validateEnvelope({ path: '/api/rooms/ABC234/actions', method: 'PUT' }), status(400));
  assert.throws(() => validateEnvelope({ path: '/api/rooms/ABC234/../commands', method: 'GET' }), status(404));
  const first = command('/api/rooms/ABC234/actions', { revision: 1, action: { type: 'move', index: 2 } });
  const second = command('/api/rooms/ABC234/actions', { action: { index: 2, type: 'move' }, revision: 1 });
  assert.equal(canonicalRequest(first), canonicalRequest(second));
  assert.notEqual(canonicalRequest(first), canonicalRequest(command(first.path, { revision: 2, action: { type: 'move', index: 2 } })));
});

test('verified cloud user membership owns the seat and repeated joins preserve identity', () => {
  const room = lobby();
  assert.notEqual(room.players[0].id, room.players[0].userId);
  assert.throws(() => cloudRoomView(room, 'outsider'), status(403));
  assert.throws(() => change(room, 'outsider', 'color', { color: 'red' }), status(403));
  assert.throws(() => change(room, 'host-auth', 'join', { name: 'Ala', userId: 'victim' }), status(400));
  const joined = change(room, 'guest-auth', 'join', { name: 'Bartek' });
  const repeated = change(joined.room, 'guest-auth', 'join', { name: 'Nowe imię' });
  assert.equal(repeated.room.revision, joined.room.revision);
  assert.deepEqual(repeated.room.players, joined.room.players);
  assert.equal(repeated.response.body.playerId, joined.response.body.playerId);
  assert.equal(room.players.length, 1);
});

test('cloud colors remain unique across manual changes, bot removal, and a later join', () => {
  let room = lobby();
  room = change(room, 'host-auth', 'color', { color: 'red' }).room;
  const same = change(room, 'host-auth', 'color', { color: 'red' });
  assert.equal(same.room.revision, room.revision);
  room = change(room, 'host-auth', 'bots', { count: 2 }).room;
  assert.deepEqual(room.players.map(player => player.color), ['red', 'green', 'yellow']);
  assert.throws(() => change(room, 'host-auth', 'color', { color: 'green' }), status(409));
  room = change(room, 'guest-auth', 'join', { name: 'Bartek' }).room;
  assert.throws(() => change(room, 'guest-auth', 'bots', {}, 'DELETE'), status(403));
  room = change(room, 'host-auth', 'bots', {}, 'DELETE').room;
  assert.deepEqual(room.players.map(player => player.color), ['red', 'blue']);
  assert.deepEqual(room.players.map(player => player.seat), [0, 1]);
  room = change(room, 'third-auth', 'join', { name: 'Celina' }).room;
  assert.equal(room.players[2].color, 'green');
  assert.equal(new Set(room.players.map(player => player.color)).size, 3);
});

test('cloud views contain only the requesting hand and no identity mapping or deck', () => {
  let room = lobby();
  for (const [user, name] of [['second', 'B'], ['third', 'C'], ['fourth', 'D']]) room = change(room, user, 'join', { name }).room;
  room = change(room, 'host-auth', 'color', { color: 'green' }).room;
  room = change(room, 'host-auth', 'start').room;
  const views = cloudPlayerViews(room);
  assert.equal(views.length, 4);
  for (const row of views) {
    assert.equal(row.revision, room.revision);
    assert.equal(row.room_code, room.code);
    assert.equal(row.view.players.length, 4);
    assert.equal(row.view.game.players.find(player => player.id === row.view.you).hand.length, 4);
    assert.equal(row.view.game.players.filter(player => Object.hasOwn(player, 'hand')).length, 1);
    for (const forbidden of ['deck', 'discard', 'rngState']) assert.equal(Object.hasOwn(row.view.game, forbidden), false);
    for (const player of row.view.players) {
      assert.equal(Object.hasOwn(player, 'userId'), false);
      assert.equal(Object.hasOwn(player, 'seat'), false);
    }
  }
  assert.equal(room.game.deck.length, 44);
});

test('cloud final actions advance once and reject stale or wrong-player commands', () => {
  let room = botsGame();
  const hostId = room.hostId;
  const initial = structuredClone(room);
  let last;
  for (let index = 0; index < 12 && room.game.currentPlayerId === hostId; index += 1) {
    const view = cloudRoomView(room, 'host-auth');
    const action = chooseBotAction(view.game);
    assert.ok(action);
    last = change(room, 'host-auth', 'actions', { action, revision: room.revision });
    assert.equal(last.room.revision, room.revision + 1);
    assert.equal(last.expectedRevision, room.revision);
    room = last.room;
  }
  assert.notEqual(room.game.currentPlayerId, hostId);
  assert.equal(last.response.body.game.currentPlayerId, room.game.currentPlayerId);
  assert.deepEqual(initial.game.players.find(player => player.id === hostId).flowers, []);
  assert.throws(() => change(room, 'host-auth', 'actions', { action: { type: 'endTurn' }, revision: room.revision - 1 }), status(409));
  assert.throws(() => change(room, 'host-auth', 'actions', { action: { type: 'endTurn' }, revision: room.revision }), status(403));
  assert.throws(() => change(room, 'host-auth', 'color', { color: 'red' }), status(409));
});

test('bot jobs reject stale leases at the rules seam and finish a round through sanitized views', () => {
  let room = botsGame();
  for (let index = 0; index < 12 && room.game.currentPlayerId === room.hostId; index += 1) {
    room = change(room, 'host-auth', 'actions', { action: chooseBotAction(cloudRoomView(room, 'host-auth').game), revision: room.revision }).room;
  }
  assert.notEqual(room.game.currentPlayerId, room.hostId);
  const original = structuredClone(room);
  assert.equal(prepareCloudBot(room, { expected_revision: room.revision - 1, player_id: room.game.currentPlayerId }), null);
  assert.equal(prepareCloudBot(room, { expected_revision: room.revision, player_id: room.hostId }), null);
  let actions = 0;
  while (room.game.currentPlayerId !== room.hostId && room.status === 'playing' && actions < 30) {
    const result = prepareCloudBot(room, { expected_revision: room.revision, player_id: room.game.currentPlayerId }, { now: 3000 });
    assert.ok(result.action);
    assert.equal(result.room.revision, room.revision + 1);
    assert.equal(result.expectedRevision, room.revision);
    room = result.room;
    actions += 1;
  }
  assert.ok(actions >= 3);
  assert.equal(room.game.currentPlayerId, room.hostId);
  assert.equal(room.game.turnNumber, 5);
  assert.equal(original.game.turnNumber, 2);
  assert.equal(cloudPlayerViews(room).length, 1);
});
