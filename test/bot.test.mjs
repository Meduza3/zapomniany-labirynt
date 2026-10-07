import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyAction, viewFor } from '../src/engine.mjs';
import { chooseBotAction } from '../src/bot.mjs';

const players = ['Ala', 'Bartek', 'Celina', 'Darek'].map((name, index) => ({ id: `p${index}`, name }));
let serial = 0;
function tile(kind = 'straight', rotation = 0, ability = null) {
  return { id: `bot-fixture-${++serial}`, kind, rotation, ability, asset: 'tile-1-3-1.webp' };
}
function scene(position = 12) {
  const game = createGame(players, { seed: 123 });
  game.board = Array(25).fill(null);
  game.board[position] = { ...tile('garden'), color: 'green' };
  game.players.forEach(player => { player.position = position; player.entry = null; });
  game.players[0].hand = [tile()];
  return game;
}
function choose(game, playerId = game.currentPlayerId) { return chooseBotAction(viewFor(game, playerId)); }
function advance(game) {
  const action = choose(game);
  assert.ok(action, `Bot must have an action on turn ${game.turnNumber}`);
  return applyAction(game, game.currentPlayerId, action);
}

test('bots do nothing outside their own active turn or after the game ends', () => {
  const game = createGame(players, { seed: 1 });
  assert.equal(choose(game, 'p1'), null);
  assert.equal(choose(game, 'unknown'), null);
  game.status = 'finished';
  assert.equal(choose(game), null);
  assert.equal(chooseBotAction(null), null);
});

test('a bot collects an available missing flower before spending its tile action', () => {
  let game = scene();
  game.board[13] = { ...tile('garden'), color: 'yellow' };
  game.board[11] = { ...tile('garden'), color: 'red' };
  game.players[0].flowers = ['red'];
  game.players[0].hand = [tile(), tile(), tile()];
  const beforeDeck = game.deck.length;
  assert.deepEqual(choose(game), { type: 'move', index: 13 });
  const moved = advance(game);
  assert.deepEqual(moved.players[0].flowers, ['red', 'yellow']);
  assert.equal(moved.turn.placed, false);
  assert.equal(moved.turn.pending, null);
  assert.equal(moved.players[0].hand.length, 3);
  assert.equal(choose(moved).type, 'place');
  game = advance(moved);
  assert.equal(game.currentPlayerId, 'p1');
  assert.equal(game.players[0].hand.length, 2);
  assert.equal(game.deck.length, beforeDeck);
});

test('a bot takes an immediate third-flower win and recognizes flowers crossed en route', () => {
  const game = scene(0);
  game.board[1] = tile();
  game.board[2] = { ...tile('garden'), color: 'yellow' };
  game.board[3] = tile();
  game.board[4] = tile();
  game.players[0].flowers = ['blue', 'red'];
  const action = choose(game);
  assert.equal(action.type, 'move');
  assert.ok([2, 3, 4].includes(action.index));
  const finished = advance(game);
  assert.equal(finished.status, 'finished');
  assert.equal(finished.winnerId, 'p0');
  assert.equal(finished.players[0].position, 2);
});

test('a bot places a missing path before moving over it into a garden', () => {
  let game = scene(0);
  game.board[2] = { ...tile('garden'), color: 'yellow' };
  const action = choose(game);
  assert.equal(action.type, 'place');
  assert.equal(action.index, 1);
  assert.ok([0, 2].includes(action.rotation));
  const beforeDeck = game.deck.length;
  game = advance(game);
  assert.equal(game.players[0].hand.length, 0);
  assert.equal(game.deck.length, beforeDeck);
  assert.deepEqual(choose(game), { type: 'move', index: 2 });
  game = advance(game);
  assert.deepEqual(game.players[0].flowers, ['yellow']);
  assert.equal(game.turn.pending, null);
  assert.equal(game.currentPlayerId, 'p1');
  assert.equal(game.turnNumber, 2);
  assert.equal(game.players[0].hand.length, 3);
  assert.equal(game.deck.length, beforeDeck - 3);
});

test('a bot can move before placing when its next turn of the path is already available', () => {
  const game = scene();
  game.board[13] = tile('corner', 1);
  game.board[18] = { ...tile('garden'), color: 'yellow' };
  assert.deepEqual(choose(game), { type: 'move', index: 13 });
});

test('a legacy flower discard chooses a legal own tile and retains the more flexible tile', () => {
  let game = scene();
  game.board[13] = { ...tile('garden'), color: 'yellow' };
  const oneWay = tile('oneway');
  game.players[0].hand = [tile('tee'), tile('corner'), oneWay, tile('straight', 0, 'shovel')];
  game.players[0].position = 13;
  game.players[0].flowers = ['yellow'];
  game.turn = { moved: true, placed: false, pending: { kind: 'discard', index: 13 } };
  assert.deepEqual(choose(game), { type: 'discard', tileId: oneWay.id });
  game = advance(game);
  assert.equal(game.players[0].hand.length, 3);
  assert.ok(game.players[0].hand.some(item => item.kind === 'tee'));
});

test('optional tools use only their supplied targets and may safely be skipped', () => {
  for (const ability of ['prune', 'rotate']) {
    let game = scene();
    game.board[13] = tile('tee');
    game.board[7] = tile('tee');
    game.board[14] = { ...tile('garden'), color: 'yellow' };
    game.players[1].position = 13;
    const tool = tile('straight', 0, ability);
    game.players[0].hand = [tool];
    game = applyAction(game, 'p0', { type: 'place', tileId: tool.id, index: 11, rotation: 0 });
    const view = viewFor(game, 'p0'), action = chooseBotAction(view);
    assert.ok(['ability', 'skipAbility'].includes(action.type));
    assert.notEqual(action.index, 13);
    assert.doesNotThrow(() => applyAction(game, 'p0', action));
  }
});

test('bots continue with the next player immediately after a final forced removal', () => {
  let game = scene();
  game.board[12] = tile('corner');
  game.board[13] = tile('tree');
  game.board[17] = tile('tree');
  game.turn.moved = true;
  assert.equal(choose(game).type, 'remove');
  game = advance(game);
  assert.equal(game.currentPlayerId, 'p1');
  assert.equal(game.turnNumber, 2);
  assert.equal(choose(game, 'p0'), null);
  assert.ok(choose(game, 'p1'));
});

test('bots still complete legacy blocked or ready turns without advancing twice', () => {
  let game = scene();
  game.turn.placed = true;
  assert.deepEqual(choose(game), { type: 'skipMove' });
  game = advance(game);
  assert.equal(game.currentPlayerId, 'p1');
  assert.equal(game.turnNumber, 2);
  game = scene();
  game.turn = { moved: true, placed: true, pending: null };
  assert.deepEqual(choose(game), { type: 'endTurn' });
  game = advance(game);
  assert.equal(game.currentPlayerId, 'p1');
  assert.equal(game.turnNumber, 2);
  game = scene();
  game.turn.placed = true;
  game.settings.allowBlockedMoveSkip = false;
  assert.equal(choose(game), null);
});

test('bots resume movement after tools without targets are automatically skipped', () => {
  for (const ability of ['prune', 'rotate']) {
    let game = scene();
    const tool = tile('straight', 0, ability);
    game.players[0].hand = [tool];
    game = applyAction(game, 'p0', { type: 'place', tileId: tool.id, index: 11, rotation: 0 });
    assert.equal(game.turn.pending, null);
    assert.deepEqual(choose(game), { type: 'move', index: 11 });
    game = advance(game);
    assert.equal(game.currentPlayerId, 'p1');
  }
});

test('planning never mutates the sanitized view or reads deck and opponent hands', () => {
  const game = createGame(players, { seed: 3 }), view = viewFor(game, 'p0');
  const before = structuredClone(view);
  for (const key of ['deck', 'discard', 'rngState']) {
    Object.defineProperty(view, key, { get() { throw new Error(`Private ${key} was accessed`); } });
  }
  for (const opponent of view.players.slice(1)) {
    Object.defineProperty(opponent, 'hand', { get() { throw new Error('Opponent hand was accessed'); } });
  }
  const first = chooseBotAction(view), second = chooseBotAction(view);
  assert.deepEqual(first, second);
  assert.deepEqual(JSON.parse(JSON.stringify(view)), before);
  assert.doesNotThrow(() => applyAction(game, 'p0', first));
});

test('bots follow authoritative legal actions through complete seeded games', () => {
  let wins = 0, actions = 0;
  for (const seed of [1, 7, 42]) {
    let game = createGame(players, { seed });
    for (let count = 0; count < 700 && game.status === 'playing'; count++) {
      const view = viewFor(game, game.currentPlayerId);
      assert.ok(view.players.filter(player => Array.isArray(player.hand)).length === 1);
      const action = chooseBotAction(view);
      assert.ok(action, `Seed ${seed}, turn ${game.turnNumber} must progress`);
      assert.notEqual(action.type, 'endTurn');
      assert.notEqual(action.type, 'skipMove');
      game = applyAction(game, game.currentPlayerId, action);
      actions++;
    }
    if (game.status === 'finished') wins++;
  }
  assert.equal(wins, 3);
  assert.ok(actions > 40);
});
