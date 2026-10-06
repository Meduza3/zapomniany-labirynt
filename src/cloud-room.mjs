import { createGame, applyAction, viewFor } from './engine.mjs';
import { chooseBotAction } from './bot.mjs';

const COLORS = ['green', 'yellow', 'blue', 'red'];
const BOT_NAMES = ['Bot Zielony', 'Bot Żółty', 'Bot Niebieski', 'Bot Czerwony'];
export const RULES_VERSION = 1;

export class CloudError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function fail(status, message) { throw new CloudError(status, message); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function fields(value, allowed, required = allowed) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) fail(400, 'Nieprawidłowy format żądania.');
}
function name(value) {
  if (typeof value !== 'string') fail(400, 'Podaj imię gracza.');
  const result = value.trim().normalize('NFC');
  if (!result || [...result].length > 24 || /[\u0000-\u001f\u007f]/u.test(result)) fail(400, 'Imię musi mieć od 1 do 24 znaków.');
  return result;
}
function freeColor(players) { return COLORS.find(color => !players.some(player => player.color === color)); }

export function validateEnvelope(value) {
  fields(value, ['path', 'method', 'body', 'requestId'], ['path', 'method']);
  if (!['GET', 'POST', 'DELETE'].includes(value.method) || typeof value.path !== 'string') fail(400, 'Nieprawidłowy adres lub metoda.');
  const match = /^\/api\/rooms(?:\/([A-Z2-9]{6})(?:\/(join|color|bots|start|actions))?)?$/.exec(value.path);
  if (!match && value.path !== '/api/health') fail(404, 'Nie znaleziono adresu.');
  if (value.method !== 'GET' && (typeof value.requestId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value.requestId))) fail(400, 'Żądanie zmiany wymaga identyfikatora requestId.');
  if (value.body !== undefined && !object(value.body)) fail(400, 'Nieprawidłowe dane żądania.');
  return { path: value.path, method: value.method, body: value.body ?? {}, requestId: value.requestId, code: match?.[1] ?? null, operation: match?.[2] ?? null };
}

export function canonicalRequest(request) {
  const sort = value => Array.isArray(value) ? value.map(sort) : object(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])])) : value;
  return JSON.stringify(sort({ path: request.path, method: request.method, body: request.body }));
}

function checkedAction(body) {
  fields(body, ['action', 'revision']);
  if (!Number.isSafeInteger(body.revision) || body.revision < 0) fail(400, 'Nieprawidłowa wersja gry.');
  const action = body.action;
  if (!object(action)) fail(400, 'Nieprawidłowa akcja.');
  const shapes = {
    move: [['type', 'index'], ['type', 'index']],
    place: [['type', 'tileId', 'index', 'rotation'], ['type', 'tileId', 'index', 'rotation']],
    remove: [['type', 'index'], ['type', 'index']],
    ability: [['type', 'index', 'rotation'], ['type', 'index']],
    discard: [['type', 'tileId'], ['type', 'tileId']],
    skipAbility: [['type'], ['type']], skipMove: [['type'], ['type']], endTurn: [['type'], ['type']],
  };
  if (!Object.hasOwn(shapes, action.type)) fail(400, 'Nieznana akcja.');
  fields(action, ...shapes[action.type]);
  if ('index' in action && (!Number.isInteger(action.index) || action.index < 0 || action.index > 24)) fail(400, 'Nieprawidłowe pole planszy.');
  if ('rotation' in action && (!Number.isInteger(action.rotation) || action.rotation < 0 || action.rotation > 3)) fail(400, 'Nieprawidłowy obrót kafelka.');
  if ('tileId' in action && (typeof action.tileId !== 'string' || !action.tileId || action.tileId.length > 120)) fail(400, 'Nieprawidłowy kafelek.');
  return action;
}

function viewForPlayer(room, playerId) {
  const game = room.game ? viewFor(room.game, playerId) : null;
  if (game) game.players = game.players.map(player => ({ ...player, isBot: room.players.find(member => member.id === player.id)?.isBot === true }));
  return {
    code: room.code, revision: room.revision, status: room.status, hostId: room.hostId, you: playerId,
    players: room.players.map(({ id, name, color, isBot }) => ({ id, name, color, isBot: isBot === true, connected: isBot === true })),
    game,
  };
}

export function cloudRoomView(room, userId) {
  const member = room.players.find(player => player.userId === userId && !player.isBot);
  if (!member) fail(403, 'Nie należysz do tego pokoju.');
  return viewForPlayer(room, member.id);
}

export function cloudPlayerViews(room) {
  return room.players.filter(player => !player.isBot).map(player => ({ room_code: room.code, user_id: player.userId, revision: room.revision, view: viewForPlayer(room, player.id) }));
}

export function prepareCloudCommand(original, userId, request, options = {}) {
  const now = options.now ?? Date.now();
  const uuid = options.uuid ?? (() => crypto.randomUUID());
  const body = request.body;
  if (request.path === '/api/health' && request.method === 'GET') return { response: { status: 200, body: { ok: true } } };
  if (request.path === '/api/rooms' && request.method === 'POST') {
    fields(body, ['name']);
    const player = { id: uuid(), userId, name: name(body.name), color: 'green', isBot: false, seat: 0 };
    const room = { code: options.code, revision: 1, status: 'lobby', hostId: player.id, players: [player], game: null, rulesVersion: RULES_VERSION, createdAt: now, lastActivity: now };
    if (!/^[A-Z2-9]{6}$/.test(room.code ?? '')) fail(500, 'Nie udało się utworzyć kodu pokoju.');
    return { room, expectedRevision: 0, response: { status: 201, body: { code: room.code, playerId: player.id, view: cloudRoomView(room, userId) } } };
  }
  if (!original) fail(404, 'Nie znaleziono pokoju. Sprawdź kod.');
  if (original.rulesVersion !== RULES_VERSION) fail(409, 'Ten pokój wymaga innej wersji zasad.');
  if (!request.operation && request.method === 'GET') return { response: { status: 200, body: cloudRoomView(original, userId) } };
  const room = structuredClone(original);
  let member = room.players.find(player => player.userId === userId && !player.isBot);
  let status = 200;
  let changed = true;
  if (request.operation === 'join' && request.method === 'POST') {
    fields(body, ['name']);
    const requestedName = name(body.name);
    if (member) changed = false;
    else {
      if (room.status !== 'lobby') fail(409, 'Rozgrywka już się rozpoczęła.');
      if (room.players.length >= 4) fail(409, 'W pokoju są już cztery osoby.');
      member = { id: uuid(), userId, name: requestedName, color: freeColor(room.players), isBot: false, seat: room.players.length };
      room.players.push(member);
    }
    status = 201;
  } else {
    if (!member) fail(403, 'Nie należysz do tego pokoju.');
    if (request.operation === 'color' && request.method === 'POST') {
      fields(body, ['color']);
      if (!COLORS.includes(body.color)) fail(400, 'Wybierz jeden z czterech kolorów ogródków.');
      if (room.status !== 'lobby') fail(409, 'Kolor można zmienić tylko przed rozpoczęciem gry.');
      if (member.color === body.color) changed = false;
      else {
        if (room.players.some(player => player.color === body.color)) fail(409, 'Ten kolor jest już zajęty. Wybierz wolny kolor.');
        member.color = body.color;
      }
    } else if (request.operation === 'bots' && ['POST', 'DELETE'].includes(request.method)) {
      fields(body, request.method === 'POST' ? ['count'] : []);
      if (member.id !== room.hostId) fail(403, 'Tylko gospodarz może zmieniać boty.');
      if (room.status !== 'lobby') fail(409, 'Boty można zmieniać tylko przed rozpoczęciem gry.');
      if (request.method === 'POST') {
        if (!Number.isInteger(body.count) || body.count < 1 || body.count > 3) fail(400, 'Wybierz od jednego do trzech botów.');
        if (room.players.length + body.count > 4) fail(409, 'W pokoju nie ma tylu wolnych miejsc.');
        for (let index = 0; index < body.count; index += 1) {
          const color = freeColor(room.players);
          room.players.push({ id: uuid(), userId: null, name: BOT_NAMES[COLORS.indexOf(color)], color, isBot: true, seat: room.players.length });
        }
      } else room.players = room.players.filter(player => !player.isBot).map((player, seat) => ({ ...player, seat }));
    } else if (request.operation === 'start' && request.method === 'POST') {
      fields(body, []);
      if (member.id !== room.hostId) fail(403, 'Tylko gospodarz może rozpocząć grę.');
      if (room.status !== 'lobby') fail(409, 'Rozgrywka już się rozpoczęła.');
      if (room.players.length !== 4) fail(400, 'Do gry potrzebne są dokładnie cztery osoby.');
      room.game = createGame(room.players.map(({ id, name, color }) => ({ id, name, color })), { seed: options.seed, allowBlockedMoveSkip: true });
      room.status = room.game.status;
    } else if (request.operation === 'actions' && request.method === 'POST') {
      const action = checkedAction(body);
      if (room.status !== 'playing') fail(409, 'Rozgrywka nie jest aktywna.');
      if (body.revision !== room.revision) fail(409, 'Plansza zmieniła się. Odśwież stan i wykonaj ruch ponownie.');
      if (room.game.currentPlayerId !== member.id) fail(403, 'Poczekaj na swoją turę.');
      try { room.game = applyAction(room.game, member.id, action); }
      catch (error) { fail(400, error.message); }
      room.status = room.game.status;
    } else fail(405, 'Ta metoda nie jest obsługiwana.');
  }
  if (changed) {
    room.revision += 1;
    room.lastActivity = now;
  }
  const view = cloudRoomView(room, userId);
  const result = request.operation === 'join' ? { code: room.code, playerId: member.id, view } : view;
  return { room, expectedRevision: original.revision, response: { status, body: result } };
}

export function prepareCloudBot(original, job, options = {}) {
  if (!original || original.status !== 'playing' || original.rulesVersion !== RULES_VERSION || original.revision !== job.expected_revision || original.game.currentPlayerId !== job.player_id || !original.players.some(player => player.id === job.player_id && player.isBot)) return null;
  const action = chooseBotAction(viewFor(original.game, job.player_id));
  if (!action) fail(409, 'Bot nie znalazł legalnej akcji.');
  const room = structuredClone(original);
  room.game = applyAction(original.game, job.player_id, action);
  room.status = room.game.status;
  room.revision += 1;
  room.lastActivity = options.now ?? Date.now();
  return { room, expectedRevision: original.revision, response: { status: 200, body: { ok: true, revision: room.revision } }, action };
}
