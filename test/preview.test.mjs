import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { createGame, applyAction, viewFor, TILE_CATALOG } from '../src/engine.mjs';
import { chooseBotAction } from '../src/bot.mjs';
import { createPreviewGame, stepPreviewGame, createPreviewDriver } from '../src/preview-worker.mjs';
import { buildPreview } from '../scripts/build-preview.mjs';

function assertInventoryAndVisibility(game) {
  const tiles = [...game.deck, ...game.discard, ...game.players.flatMap(player => player.hand), ...game.board.filter(tile => tile && tile.kind !== 'garden')];
  assert.equal(tiles.length, 60);
  assert.deepEqual(tiles.map(tile => tile.id).sort(), TILE_CATALOG.map(tile => tile.id).sort());
  const visible = new Set(viewFor(game, 'preview-observer').visible);
  assert.ok(game.board.every((tile, index) => !tile || tile.kind === 'garden' || visible.has(index)), 'Every displayed path must remain visible under the real rules.');
}
function assertPublicFrame(message) {
  assert.equal(message.type, 'frame');
  assert.deepEqual(Object.keys(message).sort(), ['type', 'generation', 'frame', 'action'].sort());
  assert.deepEqual(Object.keys(message.frame).sort(), ['board', 'players', 'currentPlayerId', 'turnNumber', 'status', 'winnerId'].sort());
  assert.equal(message.frame.board.length, 25);
  assert.equal(message.frame.players.length, 4);
  for (const player of message.frame.players) assert.deepEqual(Object.keys(player).sort(), ['id', 'name', 'color', 'position', 'entry', 'flowers'].sort());
  for (const forbidden of ['hand', 'deck', 'discard', 'rngState', 'token', 'tokenHash', 'userId', 'user_id', 'legal']) assert.doesNotMatch(JSON.stringify(message.frame), new RegExp(`"${forbidden}"\\s*:`));
}
function driver() {
  const messages = [];
  const send = createPreviewDriver(message => messages.push(message));
  return { messages, send, get latest() { return messages.at(-1); } };
}

test('preview games warm up within a bounded number of real actions and preserve the printed inventory', () => {
  const initial = createPreviewGame(42);
  assert.deepEqual(initial, createPreviewGame(42));
  assert.notDeepEqual(initial.board, createPreviewGame(7).board);
  assert.equal(initial.players.length, 4);
  assert.deepEqual(initial.players.map(player => player.color), ['green', 'yellow', 'blue', 'red']);
  assert.equal(new Set(initial.players.map(player => player.id)).size, 4);
  assert.ok(initial.players.every(player => player.name.startsWith('Bot ')));
  let expected = createGame(initial.players.map(({ id, name, color }) => ({ id, name, color })), { seed: 42 });
  for (let index = 0; index < 16; index++) expected = applyAction(expected, expected.currentPlayerId, chooseBotAction(viewFor(expected, expected.currentPlayerId)));
  assert.deepEqual(initial, expected, 'The initial frame must contain exactly sixteen real bot actions.');
  assert.ok(initial.turnNumber > 1 && initial.turnNumber <= 17, 'At most sixteen accepted actions may warm up a preview.');
  assert.ok(initial.board.filter(Boolean).length > 4, 'The first frame should include paths generated through play.');
  assertInventoryAndVisibility(initial);
  for (const seed of [-1, 2 ** 32, .5, undefined, '42']) assert.throws(() => createPreviewGame(seed));
});

test('four preview bots complete seeded games one authoritative action at a time without inventing tiles or sight', () => {
  for (const seed of [1, 7, 42]) {
    let game = createPreviewGame(seed);
    let actions = 0;
    while (game.status === 'playing' && actions < 700) {
      const before = structuredClone(game);
      const stepped = stepPreviewGame(game);
      assert.ok(stepped.action, 'A running preview bot must choose a legal action.');
      assert.deepEqual(game, before, 'The step must not mutate the previous frame state.');
      assert.deepEqual(stepped.game, applyAction(before, before.currentPlayerId, stepped.action));
      assertInventoryAndVisibility(stepped.game);
      game = stepped.game;
      actions += 1;
    }
    assert.equal(game.status, 'finished', `Seed ${seed} should produce an actual winner.`);
    assert.equal(game.players.find(player => player.id === game.winnerId).flowers.length, 3);
    assert.ok(actions > 1);
    const held = stepPreviewGame(game);
    assert.equal(held.action, null);
    assert.deepEqual(held.game, game, 'A finished game stays visible until the page explicitly restarts it.');
  }
});

test('preview protocol ignores stale generations, restarts deterministically, and never publishes private state', () => {
  const worker = driver();
  worker.send({ type: 'step', generation: 1 });
  assert.equal(worker.messages.length, 0);
  worker.send({ type: 'start', generation: 1, seed: 42 });
  assertPublicFrame(worker.latest);
  assert.equal(worker.latest.action, null);
  const first = structuredClone(worker.latest.frame);
  worker.send({ type: 'step', generation: 1 });
  assertPublicFrame(worker.latest);
  assert.ok(worker.latest.action);
  const active = structuredClone(worker.latest);
  const count = worker.messages.length;
  for (const message of [{ type: 'step', generation: 0 }, { type: 'step', generation: 2 }, { type: 'start', generation: 1, seed: 7 }, { type: 'start', generation: 0, seed: 7 }]) worker.send(message);
  assert.equal(worker.messages.length, count);
  assert.deepEqual(worker.latest, active);
  worker.send({ type: 'start', generation: 2, seed: 42 });
  assert.equal(worker.latest.generation, 2);
  assert.deepEqual(worker.latest.frame, first);
  worker.latest.frame.board.fill(null);
  worker.latest.frame.players[0].flowers.push('invented');
  worker.send({ type: 'step', generation: 2 });
  assert.deepEqual(worker.latest.frame, active.frame, 'Mutating an emitted frame cannot change the private simulation.');
  worker.send({ type: 'start', generation: 3, seed: -1 });
  assert.deepEqual(worker.latest, { type: 'error', generation: 3 });
  worker.send({ type: 'step', generation: 3 });
  assert.deepEqual(worker.latest, { type: 'error', generation: 3 });
  worker.send({ type: 'start', generation: 4, seed: 7 });
  assertPublicFrame(worker.latest);
  assert.notDeepEqual(worker.latest.frame, first);
});

test('the tracked classic-worker bundle matches source and runs without a backend, network, or timers', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'labirynt-preview-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const destination = path.join(directory, 'nested', 'preview-worker.js');
  assert.equal(await buildPreview({ destination }), destination);
  const generated = await readFile(destination, 'utf8');
  assert.equal(generated, await readFile(new URL('../public/preview-worker.js', import.meta.url), 'utf8'), 'Commit a regenerated worker whenever the rules or bot implementation changes.');
  const messages = [];
  const self = { postMessage: message => messages.push(structuredClone(message)) };
  const forbidden = () => { throw new Error('The preview must run entirely inside its worker.'); };
  runInNewContext(generated, { self, structuredClone, fetch: forbidden, XMLHttpRequest: forbidden, WebSocket: forbidden, setTimeout: forbidden, setInterval: forbidden });
  assert.equal(typeof self.onmessage, 'function');
  self.onmessage({ data: { type: 'start', generation: 1, seed: 42 } });
  assert.equal(messages.length, 1);
  assertPublicFrame(messages[0]);
  self.onmessage({ data: { type: 'step', generation: 1 } });
  assert.equal(messages.length, 2);
  assertPublicFrame(messages[1]);
  assert.ok(messages[1].action);
  self.onmessage({ data: { type: 'step', generation: 0 } });
  assert.equal(messages.length, 2);
});
