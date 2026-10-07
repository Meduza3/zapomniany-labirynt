const COLORS = ['green', 'yellow', 'blue', 'red'];
const STARTS = [2, 14, 22, 10];
const COLOR_NAMES = { green: 'zielony', yellow: 'żółty', blue: 'niebieski', red: 'czerwony' };
const BASE_TRACKS = {
  straight: [[1, 3]], corner: [[1, 2]], doubleCorner: [[0, 1], [2, 3]],
  oneway: [[1, 3]], tree: [[0, 1, 2, 3]], bridge: [[0, 2], [1, 3]],
  tee: [[1, 2, 3]], garden: [[0, 1, 2, 3]],
};

const catalog = [];
function catalogTile(page, row, column, kind, ability = null) {
  const id = `tile-${page}-${row}-${column}`;
  catalog.push(Object.freeze({ id, kind, rotation: 0, ability, asset: `${id}.webp` }));
}
for (let row = 1; row <= 8; row++) {
  for (let column = 1; column <= 5; column++) {
    let kind = row <= 3 ? 'straight' : 'corner';
    let ability = null;
    if (row === 1) ability = column <= 4 ? 'prune' : 'shovel';
    if (row === 2) ability = column <= 4 ? 'rotate' : 'shovel';
    if (row === 4) ability = column === 1 ? 'prune' : column === 2 ? 'shovel' : 'rotate';
    if ((row === 5 || row === 6) && column >= 3) ability = 'rotate';
    if (row === 7 && column >= 4) kind = 'doubleCorner';
    if (row === 8) kind = column <= 4 ? 'oneway' : 'doubleCorner';
    catalogTile(1, row, column, kind, ability);
  }
}
for (let row = 1; row <= 4; row++) {
  for (let column = 1; column <= 5; column++) {
    const kind = row <= 2 ? (column <= 3 ? 'tree' : row === 2 && column === 5 ? 'doubleCorner' : 'bridge') : 'tee';
    const ability = row === 3 ? (column === 1 ? 'prune' : column <= 3 ? 'shovel' : 'rotate') : null;
    catalogTile(3, row, column, kind, ability);
  }
}
export const TILE_CATALOG = Object.freeze(catalog);

function fail(message) { throw new Error(message); }
function opposite(direction) { return (direction + 2) % 4; }
function adjacent(index, direction) {
  const row = Math.floor(index / 5), column = index % 5;
  if (direction === 0) return row > 0 ? index - 5 : null;
  if (direction === 1) return column < 4 ? index + 1 : null;
  if (direction === 2) return row < 4 ? index + 5 : null;
  return column > 0 ? index - 1 : null;
}
function tracks(tile) {
  return BASE_TRACKS[tile.kind].map(track => track.map(direction => (direction + tile.rotation) % 4));
}
function openings(tile) { return tracks(tile).flat(); }
function activeTrack(tile, entry) {
  const paths = tracks(tile);
  return paths.find(path => path.includes(entry)) ?? paths.flat();
}
function random(game) {
  let state = game.rngState | 0;
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  game.rngState = state >>> 0;
  return game.rngState / 4294967296;
}
function shuffle(game, items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random(game) * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}
function refill(game, player) {
  while (player.hand.length < 4 - player.flowers.length) {
    if (!game.deck.length) {
      if (!game.discard.length) break;
      game.deck = shuffle(game, game.discard.splice(0).map(tile => ({ ...tile, rotation: 0 })));
      addLog(game, 'Przetasowano odrzucone kafelki.');
    }
    player.hand.push({ ...game.deck.pop(), rotation: 0 });
  }
}
function addLog(game, text) {
  game.log.push({ text, turn: game.turnNumber });
  if (game.log.length > 100) game.log.splice(0, game.log.length - 100);
}
function sight(game) {
  const visible = new Set(), frontier = new Set();
  for (const player of game.players) {
    const origin = game.board[player.position];
    if (!origin) continue;
    visible.add(player.position);
    for (const direction of activeTrack(origin, player.entry)) {
      let index = player.position;
      while ((index = adjacent(index, direction)) !== null) {
        const tile = game.board[index];
        if (!tile) { frontier.add(index); break; }
        const path = tracks(tile).find(track => track.includes(opposite(direction)));
        if (!path) break;
        visible.add(index);
        if (tile.kind === 'tree' || !path.includes(direction)) break;
      }
    }
  }
  return { visible, frontier };
}
function forget(game) {
  const { visible } = sight(game);
  let count = 0;
  game.board.forEach((tile, index) => {
    if (tile && tile.kind !== 'garden' && !visible.has(index)) {
      game.discard.push(tile);
      game.board[index] = null;
      count++;
    }
  });
  if (count) addLog(game, `Labirynt zapomniał ${count} ${count === 1 ? 'kafelek' : 'kafelki'}.`);
}
function movePaths(game, player) {
  const result = new Map(), origin = game.board[player.position];
  if (!origin) return result;
  let exits = activeTrack(origin, player.entry);
  if (origin.kind === 'oneway') exits = [(1 + origin.rotation) % 4];
  for (const direction of exits) {
    let index = player.position;
    const traversed = [];
    while ((index = adjacent(index, direction)) !== null) {
      const tile = game.board[index];
      if (!tile) break;
      const entry = opposite(direction);
      const path = tracks(tile).find(track => track.includes(entry));
      if (!path || (tile.kind === 'oneway' && direction !== (1 + tile.rotation) % 4)) break;
      traversed.push(index);
      result.set(index, { direction, traversed: [...traversed] });
      if (tile.kind === 'tree' || !path.includes(direction)) break;
    }
  }
  return result;
}
function occupied(game, index) { return game.players.some(player => player.position === index); }
function removable(game, index) {
  return !!game.board[index] && game.board[index].kind !== 'garden' && !occupied(game, index);
}
function validArrow(tile, index) {
  return tile.kind !== 'oneway' || adjacent(index, (1 + tile.rotation) % 4) !== null;
}
function matchesNeighbour(game, tile, index) {
  return openings(tile).some(direction => {
    const neighbor = adjacent(index, direction);
    return neighbor !== null && game.board[neighbor] && openings(game.board[neighbor]).includes(opposite(direction));
  });
}
function canPlace(game, tile, index, rotation, currentSight) {
  const existing = game.board[index];
  if (existing) {
    if (tile.ability !== 'shovel' || !removable(game, index) || !currentSight.visible.has(index)) return false;
  } else if (!currentSight.frontier.has(index)) return false;
  const candidate = { ...tile, rotation };
  if (!validArrow(candidate, index) || !matchesNeighbour(game, candidate, index)) return false;
  const board = [...game.board];
  board[index] = candidate;
  return sight({ ...game, board }).visible.has(index);
}
function placements(game, player) {
  const result = [], currentSight = sight(game);
  for (const tile of player.hand) {
    for (let index = 0; index < 25; index++) {
      for (let rotation = 0; rotation < 4; rotation++) {
        if (canPlace(game, tile, index, rotation, currentSight)) result.push({ tileId: tile.id, index, rotation });
      }
    }
  }
  return result;
}
function rotations(game) {
  const result = [];
  game.board.forEach((tile, index) => {
    if (!removable(game, index) || index === game.turn.pending.index) return;
    for (let rotation = 0; rotation < 4; rotation++) {
      if (rotation === tile.rotation) continue;
      const candidate = { ...tile, rotation };
      if (!validArrow(candidate, index)) continue;
      const board = [...game.board];
      board[index] = candidate;
      if (sight({ ...game, board }).visible.has(index)) result.push({ index, rotation });
    }
  });
  return result;
}
function emptyLegal() {
  return { moves: [], placements: [], removals: [], rotations: [], discardTileIds: [], canEnd: false, canSkipMove: false };
}
function legalFor(game, playerId) {
  const legal = emptyLegal();
  if (game.status !== 'playing' || game.currentPlayerId !== playerId) return legal;
  const player = game.players.find(item => item.id === playerId), pending = game.turn.pending;
  if (pending) {
    if (pending.kind === 'discard') legal.discardTileIds = player.hand.map(tile => tile.id);
    if (pending.kind === 'prune') legal.removals = game.board.flatMap((tile, index) => removable(game, index) && index !== pending.index ? [index] : []);
    if (pending.kind === 'rotate') legal.rotations = rotations(game);
    return legal;
  }
  if (!game.turn.moved) legal.moves = [...movePaths(game, player).keys()];
  if (!game.turn.placed) {
    legal.placements = placements(game, player);
    if (!legal.placements.length) legal.removals = game.board.flatMap((tile, index) => removable(game, index) ? [index] : []);
  }
  legal.canEnd = game.turn.moved && game.turn.placed;
  legal.canSkipMove = game.settings.allowBlockedMoveSkip && game.turn.placed && !game.turn.moved && !legal.moves.length;
  if (game.turn.placed && !game.turn.moved && !legal.moves.length) {
    legal.blockedReason = game.settings.allowBlockedMoveSkip
      ? 'Brak legalnego ruchu. Możesz pominąć ruch po wykonaniu akcji kafelka.'
      : 'Brak legalnego ruchu. Pomijanie ruchu jest wyłączone w ustawieniach tej gry.';
  }
  return legal;
}

function finishExhaustedTurn(game) {
  if (game.status !== 'playing') return;
  const player = game.players.find(item => item.id === game.currentPlayerId);
  const pending = game.turn.pending;
  if (pending?.kind === 'prune' || pending?.kind === 'rotate') {
    const legal = legalFor(game, player.id);
    const targets = pending.kind === 'prune' ? legal.removals : legal.rotations;
    if (!targets.length) {
      game.turn.pending = null;
      addLog(game, `${player.name} pomija zdolność, ponieważ nie ma dostępnego celu.`);
    }
  }
  if (game.turn.pending || !game.turn.placed) return;
  if (!game.turn.moved && game.settings.allowBlockedMoveSkip && !movePaths(game, player).size) {
    game.turn.moved = true;
    addLog(game, `${player.name} pomija ruch, ponieważ nie ma legalnej drogi.`);
  }
  if (!game.turn.moved) return;
  if (player.hand.length > 4 - player.flowers.length) {
    game.turn.pending = { kind: 'discard', index: player.position };
    return;
  }
  refill(game, player);
  const index = game.players.findIndex(item => item.id === player.id);
  const next = game.players[(index + 1) % game.players.length];
  game.currentPlayerId = next.id;
  game.turnNumber++;
  game.turn = { moved: false, placed: false, pending: null };
  addLog(game, `Tura gracza ${next.name}.`);
}

export function createGame(players, options = {}) {
  if (!Array.isArray(players) || players.length !== 4) fail('Gra wymaga dokładnie czterech graczy.');
  if (players.some(player => !player || typeof player.id !== 'string' || !player.id || typeof player.name !== 'string' || !player.name.trim())) fail('Każdy gracz musi mieć identyfikator i imię.');
  if (new Set(players.map(player => player.id)).size !== 4) fail('Identyfikatory graczy muszą być różne.');
  const chosenColors = players.map(player => player.color).filter(color => color !== undefined);
  if (chosenColors.some(color => !COLORS.includes(color))) fail('Nieprawidłowy kolor gracza. Dostępne kolory: green, yellow, blue, red.');
  if (new Set(chosenColors).size !== chosenColors.length) fail('Kolory graczy muszą być różne.');
  const availableColors = COLORS.filter(color => !chosenColors.includes(color));
  const seed = options.seed === undefined ? Math.floor(Math.random() * 4294967296) : options.seed;
  if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) fail('Nieprawidłowe ziarno losowania.');
  const game = {
    status: 'playing', board: Array(25).fill(null),
    players: players.map(player => {
      const color = player.color === undefined ? availableColors.shift() : player.color;
      return { id: player.id, name: player.name.trim(), color, position: STARTS[COLORS.indexOf(color)], entry: null, flowers: [], hand: [] };
    }),
    currentPlayerId: players[0].id, turnNumber: 1, turn: { moved: false, placed: false, pending: null },
    winnerId: null, log: [], deck: [], discard: [], rngState: (seed >>> 0) || 0x9e3779b9,
    settings: { allowBlockedMoveSkip: options.allowBlockedMoveSkip !== false },
  };
  game.players.forEach(player => {
    game.board[player.position] = { id: `garden-${player.color}`, kind: 'garden', rotation: 0, ability: null, color: player.color, asset: `garden-${player.color}.webp` };
  });
  game.deck = shuffle(game, TILE_CATALOG.map(tile => ({ ...tile })));
  game.players.forEach(player => refill(game, player));
  addLog(game, 'Czterej działkowcy zaczynają w swoich ogródkach.');
  return game;
}

export function applyAction(original, playerId, action) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) fail('Nieprawidłowa akcja.');
  if (original.status !== 'playing') fail('Ta gra jest już zakończona.');
  if (original.currentPlayerId !== playerId) fail('Poczekaj na swoją turę.');
  const game = structuredClone(original), player = game.players.find(item => item.id === playerId);
  if (!player) fail('Nie znaleziono gracza.');
  const legal = legalFor(game, playerId), pending = game.turn.pending;
  if (pending && !['ability', 'skipAbility', 'discard'].includes(action.type)) fail('Najpierw rozstrzygnij bieżącą zdolność lub wybierz kafelek do odrzucenia.');
  if (action.type === 'move') {
    if (!Number.isInteger(action.index) || !legal.moves.includes(action.index)) fail('Nie możesz przejść na to pole w jednym ruchu po widocznej prostej ścieżce.');
    const path = movePaths(game, player).get(action.index);
    player.position = action.index;
    player.entry = opposite(path.direction);
    game.turn.moved = true;
    addLog(game, `${player.name} przechodzi na pole ${action.index + 1}.`);
    for (const index of path.traversed) {
      const tile = game.board[index];
      if (tile.kind !== 'garden' || tile.color === player.color || player.flowers.includes(tile.color)) continue;
      player.flowers.push(tile.color);
      addLog(game, `${player.name} zbiera ${COLOR_NAMES[tile.color]} kwiatek.`);
      if (player.flowers.length === 3) {
        player.position = index;
        game.status = 'finished';
        game.winnerId = player.id;
        addLog(game, `${player.name} zdobywa trzeci kwiatek i wygrywa!`);
        break;
      }
    }
    forget(game);
  } else if (action.type === 'place') {
    if (!legal.placements.some(item => item.tileId === action.tileId && item.index === action.index && item.rotation === action.rotation)) fail('Tego kafelka nie można tutaj położyć w tym obrocie.');
    const handIndex = player.hand.findIndex(tile => tile.id === action.tileId), tile = player.hand.splice(handIndex, 1)[0];
    if (game.board[action.index]) game.discard.push(game.board[action.index]);
    game.board[action.index] = { ...tile, rotation: action.rotation };
    game.turn.placed = true;
    addLog(game, `${player.name} kładzie kafelek na polu ${action.index + 1}.`);
    if (tile.ability === 'prune' || tile.ability === 'rotate') game.turn.pending = { kind: tile.ability, index: action.index };
    forget(game);
  } else if (action.type === 'remove') {
    if (pending || !Number.isInteger(action.index) || !legal.removals.includes(action.index)) fail('Usunięcie zastępuje położenie tylko wtedy, gdy żaden kafelek z ręki nie pasuje.');
    game.discard.push(game.board[action.index]);
    game.board[action.index] = null;
    game.turn.placed = true;
    addLog(game, `${player.name} usuwa kafelek z pola ${action.index + 1}, ponieważ nie może dołożyć kafelka.`);
    forget(game);
  } else if (action.type === 'ability') {
    if (!pending || !['prune', 'rotate'].includes(pending.kind)) fail('Nie ma zdolności do wykonania.');
    if (pending.kind === 'prune') {
      if (!Number.isInteger(action.index) || !legal.removals.includes(action.index)) fail('Sekator może usunąć inny kafelek bez gracza.');
      game.discard.push(game.board[action.index]);
      game.board[action.index] = null;
      addLog(game, `${player.name} używa sekatora na polu ${action.index + 1}.`);
    } else {
      if (!legal.rotations.some(item => item.index === action.index && item.rotation === action.rotation)) fail('Obracany kafelek musi być inny, wolny i pozostać w czyjejś linii wzroku.');
      game.board[action.index].rotation = action.rotation;
      addLog(game, `${player.name} obraca kafelek na polu ${action.index + 1}.`);
    }
    game.turn.pending = null;
    forget(game);
  } else if (action.type === 'skipAbility') {
    if (!pending || !['prune', 'rotate'].includes(pending.kind)) fail('Nie ma opcjonalnej zdolności do pominięcia.');
    game.turn.pending = null;
    addLog(game, `${player.name} pomija opcjonalną zdolność.`);
  } else if (action.type === 'discard') {
    if (pending?.kind !== 'discard' || !legal.discardTileIds.includes(action.tileId)) fail('Wybierz swój kafelek do odrzucenia, aby zrobić miejsce na kwiatek.');
    const [tile] = player.hand.splice(player.hand.findIndex(item => item.id === action.tileId), 1);
    game.discard.push(tile);
    if (player.hand.length <= 4 - player.flowers.length) game.turn.pending = null;
    addLog(game, `${player.name} odkłada kafelek, robiąc miejsce na kwiatek.`);
  } else if (action.type === 'skipMove') {
    if (!game.settings.allowBlockedMoveSkip) fail('Pomijanie ruchu jest wyłączone w ustawieniach tej gry.');
    if (!legal.canSkipMove) fail('Nie można pominąć ruchu, dopóki istnieje legalna droga lub akcja kafelka nie została ukończona.');
    game.turn.moved = true;
    addLog(game, `${player.name} pomija ruch, ponieważ nie ma legalnej drogi.`);
  } else if (action.type === 'endTurn') {
    if (!legal.canEnd) fail('Przed końcem tury wykonaj ruch, połóż lub usuń kafelek i rozstrzygnij zdolność.');
  } else fail('Nieznany rodzaj akcji.');
  finishExhaustedTurn(game);
  return game;
}

export function viewFor(game, playerId) {
  const { visible, frontier } = sight(game);
  return structuredClone({
    status: game.status, board: game.board,
    players: game.players.map(player => {
      const { hand, ...rest } = player;
      return player.id === playerId ? { ...rest, hand, handCount: hand.length } : { ...rest, handCount: hand.length };
    }),
    currentPlayerId: game.currentPlayerId, turnNumber: game.turnNumber, turn: game.turn,
    winnerId: game.winnerId, log: game.log, deckCount: game.deck.length, discardCount: game.discard.length,
    settings: game.settings, legal: legalFor(game, playerId), visible: [...visible].sort((a, b) => a - b), frontier: [...frontier].sort((a, b) => a - b),
  });
}
