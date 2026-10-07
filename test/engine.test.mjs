import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyAction, viewFor, TILE_CATALOG } from '../src/engine.mjs';

const players = ['Ala', 'Bartek', 'Celina', 'Darek'].map((name, index) => ({ id: `p${index}`, name }));
let serial = 0;
function tile(kind = 'straight', rotation = 0, ability = null) {
  return { id: `fixture-${++serial}`, kind, rotation, ability, asset: 'tile-1-3-1.webp' };
}
function scene(position = 12, originKind = 'garden') {
  const game = createGame(players, { seed: 123 });
  game.board = Array(25).fill(null);
  game.board[position] = { ...tile(originKind), color: 'green' };
  game.players.forEach(player => { player.position = position; player.entry = null; });
  game.players[0].hand = [tile()];
  return game;
}
function actor(game) { return game.players[0]; }
function legal(game) { return viewFor(game, 'p0').legal; }
function act(game, action) { return applyAction(game, 'p0', action); }
function put(game, index, kind = 'straight', rotation = 0, ability = null) {
  game.board[index] = tile(kind, rotation, ability);
  return game.board[index];
}
function place(game, index, rotation = 0) {
  return act(game, { type: 'place', tileId: actor(game).hand[0].id, index, rotation });
}
function nextMove(game) {
  game.turn = { moved: false, placed: false, pending: null };
  return game;
}

test('the 60 printed tile fronts have the exact shapes and tools', () => {
  const expected = {
    straight: { null: 5, prune: 4, shovel: 2, rotate: 4 },
    corner: { null: 7, prune: 1, shovel: 1, rotate: 9 },
    doubleCorner: { null: 4 }, oneway: { null: 4 }, tree: { null: 6 }, bridge: { null: 3 },
    tee: { null: 5, prune: 1, shovel: 2, rotate: 2 },
  };
  const actual = {};
  for (const item of TILE_CATALOG) {
    actual[item.kind] ??= {};
    actual[item.kind][item.ability] = (actual[item.kind][item.ability] ?? 0) + 1;
  }
  assert.deepEqual(actual, expected);
  assert.equal(new Set(TILE_CATALOG.map(item => item.id)).size, 60);
  assert.equal(TILE_CATALOG.find(item => item.id === 'tile-3-2-5').kind, 'doubleCorner');
});

test('four gardeners start in the printed gardens with four random tiles each', () => {
  const game = createGame(players, { seed: 456 });
  assert.deepEqual(game.players.map(player => player.position), [2, 14, 22, 10]);
  assert.deepEqual(game.players.map(player => player.color), ['green', 'yellow', 'blue', 'red']);
  assert.ok(game.players.every(player => player.hand.length === 4 && player.flowers.length === 0));
  assert.equal(game.deck.length, 44);
  assert.equal(game.board.filter(Boolean).length, 4);
  assert.deepEqual(createGame(players, { seed: 456 }), game);
  assert.notDeepEqual(createGame(players, { seed: 457 }).deck, game.deck);
  assert.throws(() => createGame(players.slice(0, 3)), /czterech/);
  assert.throws(() => createGame([players[0], ...players.slice(0, 3)]), /różne/);
});

test('chosen colors start in their matching gardens without changing player order', () => {
  const colors = ['red', 'blue', 'green', 'yellow'];
  const chosen = players.map((player, index) => ({ ...player, color: colors[index] }));
  const original = structuredClone(chosen);
  const game = createGame(chosen, { seed: 456 });
  assert.deepEqual(game.players.map(player => player.id), players.map(player => player.id));
  assert.deepEqual(game.players.map(player => player.color), colors);
  assert.deepEqual(game.players.map(player => player.position), [10, 22, 2, 14]);
  assert.equal(game.currentPlayerId, 'p0');
  assert.equal(game.board.filter(Boolean).length, 4);
  for (const player of game.players) {
    assert.equal(game.board[player.position].color, player.color);
    assert.equal(game.board[player.position].asset, `garden-${player.color}.webp`);
    const own = viewFor(game, player.id).players.find(item => item.id === player.id);
    assert.equal(own.color, player.color);
    assert.equal(own.position, player.position);
    assert.equal(own.hand.length, 4);
  }
  assert.deepEqual(chosen, original);
});

test('omitted colors take the first unused color after reserving explicit choices', () => {
  const chosen = players.map(player => ({ ...player }));
  chosen[1].color = 'red';
  chosen[3].color = 'green';
  const game = createGame(chosen, { seed: 456 });
  assert.deepEqual(game.players.map(player => player.color), ['yellow', 'red', 'blue', 'green']);
  assert.deepEqual(game.players.map(player => player.position), [14, 10, 22, 2]);
});

test('unknown colors cannot start a game', () => {
  for (const color of ['purple', '', null, 7]) {
    assert.throws(() => createGame([{ ...players[0], color }, ...players.slice(1)]), /Nieprawidłowy kolor/);
  }
});

test('duplicate color choices cannot start a game', () => {
  const chosen = players.map((player, index) => index < 2 ? { ...player, color: 'red' } : player);
  assert.throws(() => createGame(chosen), /Kolory graczy muszą być różne/);
});

test('views reveal only the requesting player hand and cannot mutate the game', () => {
  const game = createGame(players, { seed: 456 }), view = viewFor(game, 'p0');
  assert.equal(view.players[0].hand.length, 4);
  assert.ok(view.players.slice(1).every(player => !Object.hasOwn(player, 'hand') && player.handCount === 4));
  for (const key of ['deck', 'discard', 'rngState']) assert.equal(Object.hasOwn(view, key), false);
  assert.equal(viewFor(game, 'p1').legal.placements.length, 0);
  assert.ok(viewFor(game, 'unknown').players.every(player => !Object.hasOwn(player, 'hand')));
  view.players[0].hand.pop();
  view.board[2].rotation = 3;
  assert.equal(game.players[0].hand.length, 4);
  assert.equal(game.board[2].rotation, 0);
});

test('replacement tiles arrive only when movement and placement finish in either order', () => {
  for (const moveFirst of [false, true]) {
    let game = scene();
    put(game, 13);
    actor(game).hand = [tile(), tile(), tile(), tile()];
    const original = structuredClone(game);
    if (moveFirst) game = act(game, { type: 'move', index: 13 });
    const beforeDeck = game.deck.length;
    game = place(game, 14);
    assert.equal(actor(game).hand.length, moveFirst ? 4 : 3);
    assert.equal(game.deck.length, beforeDeck - (moveFirst ? 1 : 0));
    assert.equal(original.board[14], null);
    if (!moveFirst) {
      assert.equal(game.currentPlayerId, 'p0');
      assert.throws(() => place(game, 11), /nie można/);
      game = act(game, { type: 'move', index: 14 });
    }
    assert.equal(game.currentPlayerId, 'p1');
    assert.equal(game.turnNumber, 2);
    assert.deepEqual(game.turn, { moved: false, placed: false, pending: null });
    assert.equal(actor(game).hand.length, 4);
    assert.equal(game.deck.length, beforeDeck - 1);
    assert.throws(() => act(game, { type: 'endTurn' }), /swoją turę/);
  }
});

test('a connected tile just placed remains a movement destination after resolving an optional tool', () => {
  for (const ability of ['prune', 'rotate']) {
    for (const useTool of [false, true]) {
      let game = scene();
      put(game, 11, 'tee');
      actor(game).hand = [tile('straight', 0, ability)];
      const beforeDeck = game.deck.length;
      assert.equal(legal(game).moves.includes(13), false);
      game = place(game, 13);
      assert.equal(actor(game).hand.length, 0);
      assert.equal(game.deck.length, beforeDeck);
      assert.equal(game.turn.moved, false);
      assert.deepEqual(legal(game).moves, []);
      game = act(game, useTool
        ? { type: 'ability', index: 11, ...(ability === 'rotate' ? { rotation: 3 } : {}) }
        : { type: 'skipAbility' });
      assert.ok(legal(game).moves.includes(13));
      assert.equal(actor(game).hand.length, 0);
      assert.equal(game.deck.length, beforeDeck);
      game = act(game, { type: 'move', index: 13 });
      assert.equal(actor(game).position, 13);
      assert.equal(game.currentPlayerId, 'p1');
      assert.equal(game.turnNumber, 2);
      assert.equal(actor(game).hand.length, 4);
      assert.throws(() => act(game, { type: 'move', index: 12 }), /swoją turę/);
    }
  }
});

test('a turn cannot end early, move twice, act out of turn, or accept malformed actions', () => {
  const game = scene();
  put(game, 13);
  assert.throws(() => act(game, { type: 'endTurn' }), /Przed końcem/);
  assert.throws(() => applyAction(game, 'p1', { type: 'move', index: 13 }), /swoją turę/);
  assert.throws(() => act(game, { type: 'move', index: '13' }), /Nie możesz/);
  assert.throws(() => act(game, { type: 'move', index: 37 }), /Nie możesz/);
  assert.throws(() => act(game, { type: 'invent' }), /Nieznany/);
  assert.throws(() => act(game, null), /Nieprawidłowa/);
  const moved = act(game, { type: 'move', index: 13 });
  assert.throws(() => act(moved, { type: 'move', index: 12 }), /Nie możesz/);
});

test('a completed turn waits for an available optional tool to be used or skipped', () => {
  for (const ability of ['prune', 'rotate']) {
    for (const useTool of [false, true]) {
      let game = scene();
      put(game, 11, 'tee');
      put(game, 13);
      actor(game).hand = [tile('straight', 0, ability)];
      const beforeDeck = game.deck.length;
      game = act(game, { type: 'move', index: 13 });
      game = place(game, 14);
      assert.equal(game.currentPlayerId, 'p0');
      assert.equal(game.turnNumber, 1);
      assert.equal(game.turn.pending.kind, ability);
      assert.equal(actor(game).hand.length, 0);
      assert.equal(game.deck.length, beforeDeck);
      assert.equal(legal(game).canEnd, false);
      assert.throws(() => act(game, { type: 'endTurn' }), /Najpierw/);
      game = act(game, useTool
        ? { type: 'ability', index: 11, ...(ability === 'rotate' ? { rotation: 3 } : {}) }
        : { type: 'skipAbility' });
      assert.equal(game.currentPlayerId, 'p1');
      assert.equal(game.turnNumber, 2);
      assert.equal(game.turn.pending, null);
      assert.equal(game.board[11] === null, useTool && ability === 'prune');
      assert.equal(actor(game).hand.length, 4);
      assert.equal(game.deck.length, beforeDeck - 4);
    }
  }
});

test('tools with no targets are skipped automatically without losing an unused move', () => {
  for (const ability of ['prune', 'rotate']) {
    for (const moved of [false, true]) {
      let game = scene();
      actor(game).hand = [tile('straight', 0, ability)];
      if (moved) {
        put(game, 13);
        game = act(game, { type: 'move', index: 13 });
      }
      game = place(game, moved ? 14 : 13);
      assert.equal(game.turn.pending, null);
      assert.equal(game.currentPlayerId, moved ? 'p1' : 'p0');
      assert.equal(game.turnNumber, moved ? 2 : 1);
      if (!moved) assert.ok(legal(game).moves.includes(13));
    }
  }
});

test('a blocked move ends the turn after placing only when skipping is enabled', () => {
  for (const allowed of [false, true]) {
    let game = scene();
    game.settings.allowBlockedMoveSkip = allowed;
    game.board[0] = { ...tile('garden'), color: 'red' };
    game.players[3].position = 0;
    assert.equal(legal(game).moves.length, 0);
    assert.equal(game.currentPlayerId, 'p0');
    const beforeDeck = game.deck.length;
    game = place(game, 1);
    assert.equal(game.currentPlayerId, allowed ? 'p1' : 'p0');
    assert.equal(game.turnNumber, allowed ? 2 : 1);
    assert.equal(game.log.some(item => /pomija ruch/.test(item.text)), allowed);
    assert.equal(actor(game).hand.length, allowed ? 4 : 0);
    assert.equal(game.deck.length, beforeDeck - (allowed ? 4 : 0));
    if (!allowed) assert.equal(game.turn.placed, true);
  }
});

test('pruning the last available route automatically skips movement and advances once', () => {
  let game = scene();
  game.board[0] = { ...tile('garden'), color: 'red' };
  game.players[3].position = 0;
  const route = put(game, 13);
  actor(game).hand = [tile('straight', 0, 'prune')];
  game = place(game, 1);
  assert.equal(game.currentPlayerId, 'p0');
  assert.equal(game.turn.pending.kind, 'prune');
  game = act(game, { type: 'ability', index: 13 });
  assert.equal(game.board[13], null);
  assert.ok(game.discard.some(item => item.id === route.id));
  assert.equal(game.currentPlayerId, 'p1');
  assert.equal(game.turnNumber, 2);
  assert.ok(game.log.some(item => /pomija ruch/.test(item.text)));
});

test('the last flower discard ends a completed turn only after all excess tiles are chosen', () => {
  let game = scene();
  game.board[13] = { ...tile('garden'), color: 'yellow' };
  game.board[14] = { ...tile('garden'), color: 'blue' };
  actor(game).hand = [tile(), tile(), tile(), tile()];
  game.turn.placed = true;
  game = act(game, { type: 'move', index: 14 });
  assert.deepEqual(actor(game).flowers, ['yellow', 'blue']);
  assert.equal(game.turn.pending.kind, 'discard');
  assert.equal(game.currentPlayerId, 'p0');
  const chosen = actor(game).hand.slice(0, 2).map(item => item.id);
  game = act(game, { type: 'discard', tileId: chosen[0] });
  assert.equal(game.currentPlayerId, 'p0');
  assert.equal(game.turn.pending.kind, 'discard');
  assert.equal(actor(game).hand.length, 3);
  game = act(game, { type: 'discard', tileId: chosen[1] });
  assert.equal(game.currentPlayerId, 'p1');
  assert.equal(game.turnNumber, 2);
  assert.equal(game.turn.pending, null);
  assert.equal(actor(game).hand.length, 2);
  assert.ok(chosen.every(id => game.discard.some(item => item.id === id)));
});

test('multiple flowers can leave a discard choice only after the placement and its power', () => {
  let game = scene();
  game.board[13] = { ...tile('garden'), color: 'yellow' };
  game.board[14] = { ...tile('garden'), color: 'blue' };
  const tool = tile('straight', 0, 'prune');
  actor(game).hand = [tool, tile(), tile(), tile()];
  put(game, 11);
  const beforeDeck = game.deck.length;
  game = act(game, { type: 'move', index: 14 });
  assert.equal(game.turn.pending, null);
  assert.equal(actor(game).hand.length, 4);
  game = act(game, { type: 'place', tileId: tool.id, index: 10, rotation: 0 });
  assert.equal(game.turn.pending.kind, 'prune');
  assert.equal(actor(game).hand.length, 3);
  game = act(game, { type: 'skipAbility' });
  assert.equal(game.currentPlayerId, 'p0');
  assert.equal(game.turn.pending.kind, 'discard');
  assert.equal(game.deck.length, beforeDeck);
  const chosen = actor(game).hand[0].id;
  game = act(game, { type: 'discard', tileId: chosen });
  assert.equal(game.currentPlayerId, 'p1');
  assert.equal(actor(game).hand.length, 2);
  assert.ok(game.discard.some(item => item.id === chosen));
  assert.equal(game.deck.length, beforeDeck);
});

test('legacy discard choices remain playable before an unfinished tile action', () => {
  let game = scene();
  actor(game).flowers = ['yellow'];
  actor(game).hand = [tile(), tile(), tile(), tile()];
  game.turn = { moved: true, placed: false, pending: { kind: 'discard', index: 12 } };
  const beforeDeck = game.deck.length;
  const chosen = actor(game).hand[0].id;
  game = act(game, { type: 'discard', tileId: chosen });
  assert.equal(game.turn.pending, null);
  assert.equal(game.currentPlayerId, 'p0');
  assert.equal(actor(game).hand.length, 3);
  assert.equal(game.deck.length, beforeDeck);
  game = place(game, 13);
  assert.equal(game.currentPlayerId, 'p1');
  assert.equal(actor(game).hand.length, 3);
  assert.equal(game.deck.length, beforeDeck - 1);
});

test('forced removal keeps a genuine hand overflow for an explicit final discard', () => {
  let game = scene();
  game.board[12] = tile('corner');
  game.board[13] = tile('tree');
  game.board[17] = tile('tree');
  actor(game).flowers = ['yellow'];
  actor(game).hand = [tile(), tile(), tile(), tile()];
  game.turn.moved = true;
  const beforeDeck = game.deck.length;
  assert.deepEqual(legal(game).placements, []);
  game = act(game, { type: 'remove', index: 13 });
  assert.equal(game.currentPlayerId, 'p0');
  assert.equal(game.turn.pending.kind, 'discard');
  assert.equal(actor(game).hand.length, 4);
  const chosen = actor(game).hand[0].id;
  game = act(game, { type: 'discard', tileId: chosen });
  assert.equal(game.currentPlayerId, 'p1');
  assert.equal(actor(game).hand.length, 3);
  assert.equal(game.deck.length, beforeDeck);
});

test('visibility includes a bend or tree and ends there; movement cannot turn in one action', () => {
  for (const shape of ['corner', 'tree']) {
    const game = scene();
    put(game, 13, shape, shape === 'corner' ? 1 : 0);
    put(game, 14);
    put(game, 18, 'straight', 1);
    const view = viewFor(game, 'p0');
    assert.ok(view.visible.includes(13));
    assert.equal(view.visible.includes(14), false);
    assert.equal(view.visible.includes(18), false);
    assert.deepEqual(view.legal.moves, [13]);
    assert.throws(() => act(game, { type: 'move', index: 18 }), /widocznej prostej/);
  }
});

test('straight sight reaches only the first empty square and cannot cross hedges', () => {
  const game = scene();
  put(game, 13, 'straight', 1);
  put(game, 14);
  const view = viewFor(game, 'p0');
  assert.equal(view.visible.includes(13), false);
  assert.equal(view.visible.includes(14), false);
  assert.ok(view.frontier.includes(7));
  assert.equal(view.frontier.includes(2), false);
  assert.equal(view.legal.placements.some(item => item.index === 2), false);
  assert.throws(() => place(game, 7, 0), /nie można/);
  assert.ok(view.legal.placements.some(item => item.index === 7 && item.rotation === 1));
});

test('a placement must connect at least one edge and remain visible after placement', () => {
  const game = scene();
  put(game, 8, 'straight', 1);
  const view = viewFor(game, 'p0');
  assert.ok(view.frontier.includes(13));
  assert.equal(view.legal.placements.some(item => item.index === 13 && item.rotation === 1), false);
  assert.ok(view.legal.placements.some(item => item.index === 13 && item.rotation === 0));
  assert.throws(() => place(game, 0), /nie można/);
});

test('bridge lanes transmit straight sight and retain the player lane on the next turn', () => {
  let game = scene();
  put(game, 13, 'bridge');
  put(game, 14);
  assert.ok(legal(game).moves.includes(14));
  game = act(game, { type: 'move', index: 13 });
  nextMove(game);
  put(game, 8, 'straight', 1);
  put(game, 18, 'straight', 1);
  assert.ok(legal(game).moves.includes(14));
  assert.equal(legal(game).moves.includes(8), false);
  assert.equal(legal(game).moves.includes(18), false);
  assert.equal(viewFor(game, 'p0').visible.includes(8), false);
});

test('double bends connect only the entered lane, while tree origins offer every exit', () => {
  let game = scene();
  put(game, 13, 'doubleCorner');
  game = act(game, { type: 'move', index: 13 });
  nextMove(game);
  put(game, 18, 'straight', 1);
  put(game, 8, 'straight', 1);
  put(game, 14);
  assert.ok(legal(game).moves.includes(18));
  assert.equal(legal(game).moves.includes(8), false);
  assert.equal(legal(game).moves.includes(14), false);
  game.board[13] = tile('tree');
  assert.ok(legal(game).moves.includes(18));
  assert.ok(legal(game).moves.includes(8));
  assert.ok(legal(game).moves.includes(14));
});

test('T junctions allow straight passage across the bar but not around the stem', () => {
  const game = scene();
  put(game, 13, 'tee');
  put(game, 14);
  put(game, 18, 'straight', 1);
  assert.ok(legal(game).moves.includes(14));
  assert.equal(legal(game).moves.includes(18), false);
  game.board[13].rotation = 1;
  assert.ok(legal(game).moves.includes(13));
  assert.equal(legal(game).moves.includes(14), false);
});

test('one-way arrows restrict entering and leaving but never reverse sight', () => {
  let game = scene();
  put(game, 13, 'oneway', 2);
  put(game, 14);
  assert.ok(viewFor(game, 'p0').visible.includes(14));
  assert.equal(legal(game).moves.includes(13), false);
  game.board[13].rotation = 0;
  game = act(game, { type: 'move', index: 13 });
  nextMove(game);
  assert.deepEqual(legal(game).moves, [14]);
  assert.ok(viewFor(game, 'p0').visible.includes(12));
});

test('a one-way tile may have its entrance outside the board but never its exit', () => {
  const game = scene(23);
  actor(game).hand = [tile('oneway')];
  assert.equal(legal(game).placements.some(item => item.index === 24 && item.rotation === 0), false);
  assert.ok(legal(game).placements.some(item => item.index === 24 && item.rotation === 2));
});

test('unseen paths disappear immediately, but another gardener can preserve them', () => {
  for (const guard of [false, true]) {
    const game = scene(11);
    put(game, 12, 'corner', 1);
    put(game, 17, 'straight', 1);
    put(game, 18);
    actor(game).position = 12;
    actor(game).entry = 3;
    if (guard) game.players[1].position = 17;
    const moved = act(game, { type: 'move', index: 11 });
    assert.equal(moved.board[17] !== null, guard);
    assert.equal(moved.board[18], null);
    assert.ok(moved.discard.some(item => item.id === game.board[18].id));
    assert.ok(moved.board[11]);
  }
});

test('a shovel can replace an unoccupied visible path, never a garden or pawn', () => {
  const game = scene();
  const replaced = put(game, 13);
  actor(game).hand = [tile('straight', 0, 'shovel')];
  const changed = place(game, 13);
  assert.notEqual(changed.board[13].id, replaced.id);
  assert.ok(changed.discard.some(item => item.id === replaced.id));
  assert.equal(changed.turn.pending, null);
  assert.equal(legal(game).placements.some(item => item.index === 12), false);
  game.players[1].position = 13;
  assert.equal(legal(game).placements.some(item => item.index === 13), false);
  actor(game).hand = [tile()];
  game.players[1].position = 12;
  assert.equal(legal(game).placements.some(item => item.index === 13), false);
});

test('pruning is optional and removes other free tiles with the visibility cascade', () => {
  let game = scene();
  const first = put(game, 13), far = put(game, 14);
  actor(game).hand = [tile('straight', 0, 'prune')];
  game = place(game, 11);
  assert.equal(game.turn.pending.kind, 'prune');
  assert.equal(legal(game).removals.includes(11), false);
  assert.equal(legal(game).removals.includes(12), false);
  assert.throws(() => act(game, { type: 'move', index: 13 }), /Najpierw/);
  const skipped = act(game, { type: 'skipAbility' });
  assert.ok(skipped.board[13]);
  assert.equal(skipped.turn.pending, null);
  game = act(game, { type: 'ability', index: 13 });
  assert.equal(game.board[13], null);
  assert.equal(game.board[14], null);
  assert.ok(game.discard.some(item => item.id === first.id));
  assert.ok(game.discard.some(item => item.id === far.id));
  assert.equal(game.turn.pending, null);
});

test('rotation cannot lose sight of its target and can forget paths farther away', () => {
  let game = scene();
  put(game, 13, 'tee');
  put(game, 14);
  actor(game).hand = [tile('straight', 0, 'rotate')];
  game = place(game, 11);
  assert.equal(game.turn.pending.kind, 'rotate');
  assert.equal(legal(game).rotations.some(item => item.index === 11), false);
  assert.equal(legal(game).rotations.some(item => item.index === 12), false);
  assert.equal(legal(game).rotations.some(item => item.index === 13 && item.rotation === 3), false);
  assert.throws(() => act(game, { type: 'ability', index: 13, rotation: 3 }), /linii wzroku/);
  game = act(game, { type: 'ability', index: 13, rotation: 1 });
  assert.equal(game.board[13].rotation, 1);
  assert.equal(game.board[14], null);
});

test('forced removal is unavailable while any tile can be placed and never removes a pawn', () => {
  let game = scene();
  put(game, 13);
  assert.throws(() => act(game, { type: 'remove', index: 13 }), /żaden kafelek/);
  game.board[12] = tile('corner');
  game.board[13] = tile('tree');
  put(game, 17, 'tree');
  assert.deepEqual(legal(game).removals, [13, 17]);
  const count = game.deck.length;
  const removed = act(game, { type: 'remove', index: 13 });
  assert.equal(removed.board[13], null);
  assert.equal(removed.turn.placed, true);
  assert.equal(removed.deck.length, count);
  assert.equal(actor(removed).hand.length, 1);
  game.players[1].position = 13;
  assert.equal(legal(game).removals.includes(13), false);
});

test('flower collection stays distinct and placing a tile makes room without discarding', () => {
  let game = scene();
  game.board[13] = { ...tile('garden'), color: 'yellow' };
  actor(game).hand = [tile(), tile(), tile(), tile()];
  game = act(game, { type: 'move', index: 13 });
  assert.deepEqual(actor(game).flowers, ['yellow']);
  assert.equal(game.turn.pending, null);
  assert.equal(actor(game).hand.length, 4);
  assert.deepEqual(legal(game).discardTileIds, []);
  const collected = structuredClone(game);
  const beforeDeck = game.deck.length;
  const chosen = actor(game).hand[2].id;
  assert.throws(() => act(game, { type: 'discard', tileId: chosen }), /Wybierz swój kafelek/);
  game = act(game, { type: 'place', tileId: chosen, index: 14, rotation: 0 });
  assert.equal(actor(game).hand.length, 3);
  assert.equal(game.board[14].id, chosen);
  assert.equal(game.discard.some(item => item.id === chosen), false);
  assert.equal(game.deck.length, beforeDeck);
  assert.equal(game.currentPlayerId, 'p1');
  assert.equal(game.turn.pending, null);
  game = collected;
  nextMove(game);
  game = act(game, { type: 'move', index: 12 });
  nextMove(game);
  game = act(game, { type: 'move', index: 13 });
  assert.deepEqual(actor(game).flowers, ['yellow']);
  assert.equal(game.turn.pending, null);
});

test('flower capacity is applied when a placement-first turn finishes', () => {
  let game = scene();
  actor(game).hand = [tile(), tile(), tile(), tile()];
  game.board[13] = { ...tile('garden'), color: 'yellow' };
  const beforeDeck = game.deck.length;
  game = place(game, 11);
  assert.equal(actor(game).hand.length, 3);
  assert.equal(game.deck.length, beforeDeck);
  game = act(game, { type: 'move', index: 13 });
  assert.equal(game.currentPlayerId, 'p1');
  assert.equal(game.turn.pending, null);
  assert.deepEqual(actor(game).flowers, ['yellow']);
  assert.equal(actor(game).hand.length, 3);
  assert.equal(game.deck.length, beforeDeck);
});

test('end-of-turn draws fill only the slots not occupied by existing flowers', () => {
  let game = scene();
  actor(game).flowers = ['yellow', 'blue'];
  actor(game).hand = [tile(), tile()];
  put(game, 13);
  const beforeDeck = game.deck.length;
  game = place(game, 11);
  assert.equal(actor(game).hand.length, 1);
  assert.equal(game.deck.length, beforeDeck);
  game = act(game, { type: 'move', index: 13 });
  assert.equal(game.currentPlayerId, 'p1');
  assert.equal(actor(game).hand.length, 2);
  assert.equal(game.deck.length, beforeDeck - 1);
});

test('a third flower wins immediately without drawing or forcing a final discard', () => {
  for (const placeFirst of [false, true]) {
    let game = scene();
    actor(game).flowers = ['yellow', 'blue'];
    actor(game).hand = [tile(), tile()];
    game.board[13] = { ...tile('garden'), color: 'red' };
    const beforeDeck = game.deck.length;
    if (placeFirst) game = place(game, 11);
    game = act(game, { type: 'move', index: 13 });
    assert.equal(game.status, 'finished');
    assert.equal(game.winnerId, 'p0');
    assert.equal(game.currentPlayerId, 'p0');
    assert.equal(game.turnNumber, 1);
    assert.deepEqual(actor(game).flowers, ['yellow', 'blue', 'red']);
    assert.equal(actor(game).hand.length, placeFirst ? 1 : 2);
    assert.equal(game.deck.length, beforeDeck);
    assert.equal(game.turn.pending, null);
    assert.equal(legal(game).canEnd, false);
    assert.throws(() => act(game, { type: 'endTurn' }), /zakończona/);
  }
});

test('empty draw stock reshuffles spent tiles only when the turn ends', () => {
  let game = scene();
  game.deck = [];
  const spent = [tile('corner'), tile('tee'), tile('bridge'), tile('tree')];
  game.discard = structuredClone(spent);
  game = place(game, 13);
  assert.equal(actor(game).hand.length, 0);
  assert.equal(game.discard.length, 4);
  assert.equal(game.log.some(item => /Przetasowano/.test(item.text)), false);
  const changed = act(game, { type: 'move', index: 13 });
  assert.equal(actor(changed).hand.length, 4);
  assert.deepEqual(new Set(actor(changed).hand.map(item => item.id)), new Set(spent.map(item => item.id)));
  assert.equal(changed.discard.length, 0);
  assert.equal(changed.deck.length, 0);
  assert.ok(changed.log.some(item => /Przetasowano/.test(item.text)));
});

test('an exhausted draw and discard stock does not invent replacement tiles', () => {
  const game = scene();
  game.deck = [];
  game.discard = [];
  const changed = place(game, 13);
  assert.equal(actor(changed).hand.length, 0);
  assert.equal(changed.board[13].kind, 'straight');
  const finished = act(changed, { type: 'move', index: 13 });
  assert.equal(finished.currentPlayerId, 'p1');
  assert.equal(actor(finished).hand.length, 0);
});

test('blocked movement can be skipped only after placing and only when no move exists', () => {
  const game = scene();
  assert.equal(legal(game).canSkipMove, false);
  game.turn.placed = true;
  assert.equal(legal(game).canSkipMove, true);
  const skipped = act(game, { type: 'skipMove' });
  assert.equal(skipped.currentPlayerId, 'p1');
  assert.equal(skipped.turnNumber, 2);
  put(game, 13);
  assert.equal(legal(game).canSkipMove, false);
  assert.throws(() => act(game, { type: 'skipMove' }), /istnieje legalna droga/);
  game.board[13] = null;
  game.settings.allowBlockedMoveSkip = false;
  assert.equal(legal(game).canSkipMove, false);
  assert.match(legal(game).blockedReason, /wyłączone w ustawieniach/);
  assert.throws(() => act(game, { type: 'skipMove' }), /wyłączone w ustawieniach/);
});

test('passing through a garden collects its flower, and a third flower ends movement there', () => {
  for (const alreadyHasTwo of [false, true]) {
    let game = scene(0);
    put(game, 1);
    game.board[2] = { ...tile('garden'), color: 'yellow' };
    put(game, 3);
    put(game, 4);
    if (alreadyHasTwo) actor(game).flowers = ['red', 'blue'];
    game = act(game, { type: 'move', index: 4 });
    assert.ok(actor(game).flowers.includes('yellow'));
    assert.equal(actor(game).position, alreadyHasTwo ? 2 : 4);
    assert.equal(game.status, alreadyHasTwo ? 'finished' : 'playing');
    assert.equal(game.winnerId, alreadyHasTwo ? 'p0' : null);
  }
});

test('special powers cannot affect occupied tiles and another player protects sight after pruning', () => {
  for (const ability of ['prune', 'rotate']) {
    let game = scene();
    put(game, 13, 'tee');
    put(game, 14);
    game.players[1].position = 14;
    actor(game).hand = [tile('straight', 0, ability)];
    game = place(game, 11);
    assert.equal(legal(game).removals.includes(14), false);
    assert.equal(legal(game).rotations.some(item => item.index === 14), false);
    if (ability === 'prune') {
      game = act(game, { type: 'ability', index: 13 });
      assert.ok(game.board[14]);
    }
  }
});

test('valid and rejected actions leave the caller state untouched', () => {
  const game = scene(), before = structuredClone(game);
  const changed = place(game, 13);
  assert.deepEqual(game, before);
  changed.board[13].rotation = 2;
  assert.equal(game.board[13], null);
  assert.throws(() => place(game, 24), /nie można/);
  assert.deepEqual(game, before);
});
