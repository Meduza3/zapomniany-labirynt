const TRACKS = {
  straight: [[1, 3]], corner: [[1, 2]], doubleCorner: [[0, 1], [2, 3]],
  oneway: [[1, 3]], tree: [[0, 1, 2, 3]], bridge: [[0, 2], [1, 3]],
  tee: [[1, 2, 3]], garden: [[0, 1, 2, 3]],
};
const TILE_VALUES = { straight: 3, corner: 5, doubleCorner: 3.5, oneway: 1, tree: 6, bridge: 4, tee: 7 };

function opposite(direction) { return (direction + 2) % 4; }
function neighbor(index, direction) {
  if (direction === 0) return index >= 5 ? index - 5 : null;
  if (direction === 1) return index % 5 < 4 ? index + 1 : null;
  if (direction === 2) return index < 20 ? index + 5 : null;
  return index % 5 > 0 ? index - 1 : null;
}
function tileTracks(tile) {
  return (TRACKS[tile.kind] ?? []).map(path => path.map(direction => (direction + tile.rotation) % 4));
}
function lane(tile, entry) {
  if (!tile) return [0, 1, 2, 3];
  const paths = tileTracks(tile);
  return paths.find(path => path.includes(entry)) ?? paths.flat();
}
function exits(tile, entry) {
  return tile?.kind === 'oneway' ? [(1 + tile.rotation) % 4] : lane(tile, entry);
}
function canEnter(tile, direction) {
  return !tile || (tileTracks(tile).some(path => path.includes(opposite(direction))) && (tile.kind !== 'oneway' || direction === (1 + tile.rotation) % 4));
}
function manhattan(left, right) { return Math.abs(Math.floor(left / 5) - Math.floor(right / 5)) + Math.abs(left % 5 - right % 5); }
function targets(board, player) {
  return board.flatMap((tile, index) => tile?.kind === 'garden' && tile.color !== player.color && !player.flowers.includes(tile.color) ? [index] : []);
}
function routeCost(board, player) {
  const goals = targets(board, player);
  if (!goals.length) return 0;
  const distances = Array(125).fill(Infinity), visited = new Set();
  distances[player.position * 5 + (player.entry ?? 4)] = 0;
  for (let count = 0; count < 125; count++) {
    let state = -1, cost = Infinity;
    for (let candidate = 0; candidate < 125; candidate++) {
      if (!visited.has(candidate) && distances[candidate] < cost) { state = candidate; cost = distances[candidate]; }
    }
    if (state < 0) break;
    const index = Math.floor(state / 5), entry = state % 5;
    if (goals.includes(index)) return cost;
    visited.add(state);
    for (const direction of exits(board[index], entry)) {
      const next = neighbor(index, direction);
      if (next === null || !canEnter(board[next], direction)) continue;
      const nextState = next * 5 + opposite(direction);
      const stepCost = board[next] ? 1 : 2.6;
      distances[nextState] = Math.min(distances[nextState], cost + stepCost);
    }
  }
  return 36 + Math.min(...goals.map(index => manhattan(index, player.position)));
}
function reachable(board, player) {
  const result = [];
  for (const direction of exits(board[player.position], player.entry)) {
    let index = player.position;
    const traversed = [];
    while ((index = neighbor(index, direction)) !== null) {
      const tile = board[index];
      if (!tile || !canEnter(tile, direction)) break;
      traversed.push(index);
      result.push({ index, direction, traversed: [...traversed] });
      if (tile.kind === 'tree' || !lane(tile, opposite(direction)).includes(direction)) break;
    }
  }
  return result;
}
function rememberedBoard(board, players) {
  const visible = new Set();
  for (const player of players) {
    if (!board[player.position]) continue;
    visible.add(player.position);
    for (const direction of lane(board[player.position], player.entry)) {
      let index = player.position;
      while ((index = neighbor(index, direction)) !== null) {
        const tile = board[index];
        if (!tile) break;
        const path = tileTracks(tile).find(track => track.includes(opposite(direction)));
        if (!path) break;
        visible.add(index);
        if (tile.kind === 'tree' || !path.includes(direction)) break;
      }
    }
  }
  return board.map((tile, index) => tile?.kind === 'garden' || visible.has(index) ? tile : null);
}
function positionValue(board, player) {
  const openDirections = exits(board[player.position], player.entry).filter(direction => {
    const index = neighbor(player.position, direction);
    return index !== null && canEnter(board[index], direction);
  }).length;
  return -routeCost(board, player) * 12 + openDirections * 0.6;
}
function moveEvaluation(view, player, board, path) {
  const moved = { ...player, position: path.index, entry: opposite(path.direction), flowers: [...player.flowers] };
  let collected = 0;
  for (const index of path.traversed) {
    const tile = board[index];
    if (tile?.kind !== 'garden' || tile.color === player.color || moved.flowers.includes(tile.color)) continue;
    moved.flowers.push(tile.color);
    collected++;
    if (moved.flowers.length === 3) return { score: 100000, collected, win: true };
  }
  const projectedPlayers = view.players.map(item => item.id === player.id ? moved : item);
  const remembered = rememberedBoard(board, projectedPlayers);
  return { score: collected * 10000 + positionValue(remembered, moved), collected, win: false };
}
function boardValue(view, player, board) {
  const remembered = rememberedBoard(board, view.players);
  let score = positionValue(remembered, player);
  for (const opponent of view.players) {
    if (opponent.id !== player.id) score += routeCost(remembered, opponent) * (opponent.flowers.length === 2 ? 1.4 : 0.35);
  }
  return score;
}
function tieBreak(view, action) {
  let value = view.turnNumber >>> 0;
  for (const character of JSON.stringify(action)) value = Math.imul(value ^ character.charCodeAt(0), 16777619) >>> 0;
  return value % 1000 / 10000;
}
function best(candidates) {
  return candidates.reduce((chosen, candidate) => !chosen || candidate.score > chosen.score ? candidate : chosen, null);
}
function tileValue(tile) {
  return (TILE_VALUES[tile.kind] ?? 0) + (tile.ability === 'shovel' ? 2 : tile.ability === 'rotate' ? 1 : tile.ability === 'prune' ? 0.5 : 0);
}

export function chooseBotAction(view) {
  if (!view || view.status !== 'playing' || !view.legal) return null;
  const player = view.players.find(item => item.id === view.currentPlayerId && Array.isArray(item.hand));
  if (!player) return null;
  const legal = view.legal, pending = view.turn.pending;
  if (pending?.kind === 'discard') {
    const choices = legal.discardTileIds.flatMap(tileId => {
      const tile = player.hand.find(item => item.id === tileId);
      return tile ? [{ action: { type: 'discard', tileId }, score: -tileValue(tile) }] : [];
    });
    return best(choices)?.action ?? null;
  }
  if (pending?.kind === 'prune' || pending?.kind === 'rotate') {
    const baseline = boardValue(view, player, view.board);
    const choices = [{ action: { type: 'skipAbility' }, score: baseline + 0.15 }];
    const targets = pending.kind === 'prune' ? legal.removals.map(index => ({ index })) : legal.rotations;
    for (const target of targets) {
      const board = [...view.board];
      board[target.index] = pending.kind === 'prune' ? null : { ...board[target.index], rotation: target.rotation };
      const action = { type: 'ability', ...target };
      choices.push({ action, score: boardValue(view, player, board) + tieBreak(view, action) });
    }
    return best(choices).action;
  }
  if (pending) return null;
  if (legal.canEnd) return { type: 'endTurn' };
  const paths = reachable(view.board, player);
  const moveChoices = legal.moves.flatMap(index => {
    const path = paths.find(item => item.index === index);
    const action = { type: 'move', index };
    return path ? [{ action, ...moveEvaluation(view, player, view.board, path) }] : [{ action, score: -1000, collected: 0 }];
  });
  const flowerMove = best(moveChoices.filter(choice => choice.collected > 0));
  if (flowerMove) return flowerMove.action;
  const choices = moveChoices.map(choice => ({ ...choice, score: choice.score + tieBreak(view, choice.action) }));
  for (const placement of legal.placements) {
    const tile = player.hand.find(item => item.id === placement.tileId);
    if (!tile) continue;
    let board = [...view.board];
    board[placement.index] = { ...tile, rotation: placement.rotation };
    board = rememberedBoard(board, view.players);
    let score = positionValue(board, player);
    let extendsMove = false;
    if (!view.turn.moved) {
      const moves = reachable(board, player).map(path => ({ ...moveEvaluation(view, player, board, path), usesPlacement: path.traversed.includes(placement.index) }));
      const projectedMove = best(moves);
      score = projectedMove ? projectedMove.score : score - 80;
      extendsMove = projectedMove?.usesPlacement ?? false;
    }
    const action = { type: 'place', ...placement };
    score += (extendsMove ? 0.4 : -0.4) - manhattan(player.position, placement.index) * 0.025 - tileValue(tile) * 0.008;
    choices.push({ action, score: score + tieBreak(view, action) });
  }
  if (!legal.placements.length) {
    for (const index of legal.removals) {
      const board = [...view.board];
      board[index] = null;
      const action = { type: 'remove', index };
      choices.push({ action, score: boardValue(view, player, board) + tieBreak(view, action) });
    }
  }
  const chosen = best(choices);
  if (chosen) return chosen.action;
  if (legal.canSkipMove) return { type: 'skipMove' };
  return null;
}
