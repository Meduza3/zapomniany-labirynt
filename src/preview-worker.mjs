import { createGame, applyAction, viewFor } from './engine.mjs';
import { chooseBotAction } from './bot.mjs';

const players = [
  { id: 'preview-0', name: 'Bot Zielony', color: 'green' },
  { id: 'preview-1', name: 'Bot Żółty', color: 'yellow' },
  { id: 'preview-2', name: 'Bot Niebieski', color: 'blue' },
  { id: 'preview-3', name: 'Bot Czerwony', color: 'red' },
];

export function createPreviewGame(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Invalid preview seed.');
  let game = createGame(players, { seed });
  for (let index = 0; index < 16 && game.status === 'playing'; index++) game = stepPreviewGame(game).game;
  return game;
}

export function stepPreviewGame(game) {
  if (game.status === 'finished') return { game, action: null };
  const action = chooseBotAction(viewFor(game, game.currentPlayerId));
  if (!action) throw new Error('No legal preview action.');
  return { game: applyAction(game, game.currentPlayerId, action), action };
}

function publicFrame(game) {
  return structuredClone({
    board: game.board,
    players: game.players.map(({ id, name, color, position, entry, flowers }) => ({ id, name, color, position, entry, flowers })),
    currentPlayerId: game.currentPlayerId,
    turnNumber: game.turnNumber,
    status: game.status,
    winnerId: game.winnerId,
  });
}

export function createPreviewDriver(emit) {
  let generation = -1;
  let game = null;
  return message => {
    if (!message || !Number.isSafeInteger(message.generation) || message.generation < 0) return;
    const starting = message.type === 'start';
    if (starting ? message.generation <= generation : message.type !== 'step' || message.generation !== generation || !game) return;
    if (starting) {
      generation = message.generation;
      game = null;
    }
    try {
      const result = starting ? { game: createPreviewGame(message.seed), action: null } : stepPreviewGame(game);
      game = result.game;
      emit({ type: 'frame', generation, frame: publicFrame(game), action: result.action });
    } catch {
      game = null;
      emit({ type: 'error', generation });
    }
  };
}

if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  const handle = createPreviewDriver(message => self.postMessage(message));
  self.onmessage = event => handle(event.data);
}
