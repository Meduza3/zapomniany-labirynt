import http from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, realpath, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createGame, applyAction, viewFor } from './src/engine.mjs';
import { chooseBotAction } from './src/bot.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const colors = ['green', 'yellow', 'blue', 'red'];
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.pdf': 'application/pdf',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function fail(status, message) {
  throw new RequestError(status, message);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fields(value, allowed, required = allowed) {
  if (!isObject(value) || Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !(key in value))) {
    fail(400, 'Nieprawidłowy format żądania.');
  }
}

function playerName(value) {
  if (typeof value !== 'string') fail(400, 'Podaj imię gracza.');
  const name = value.trim().normalize('NFC');
  if (!name || [...name].length > 24 || /[\u0000-\u001f\u007f]/u.test(name)) {
    fail(400, 'Imię musi mieć od 1 do 24 znaków.');
  }
  return name;
}

function actionPayload(value) {
  fields(value, ['action', 'revision']);
  if (!Number.isSafeInteger(value.revision) || value.revision < 0) fail(400, 'Nieprawidłowa wersja gry.');
  const action = value.action;
  if (!isObject(action)) fail(400, 'Nieprawidłowa akcja.');
  const shapes = {
    move: [['type', 'index'], ['type', 'index']],
    place: [['type', 'tileId', 'index', 'rotation'], ['type', 'tileId', 'index', 'rotation']],
    remove: [['type', 'index'], ['type', 'index']],
    ability: [['type', 'index', 'rotation'], ['type', 'index']],
    discard: [['type', 'tileId'], ['type', 'tileId']],
    skipAbility: [['type'], ['type']],
    skipMove: [['type'], ['type']],
    endTurn: [['type'], ['type']],
  };
  if (typeof action.type !== 'string' || !Object.hasOwn(shapes, action.type)) fail(400, 'Nieznana akcja.');
  fields(action, ...shapes[action.type]);
  if ('index' in action && (!Number.isInteger(action.index) || action.index < 0 || action.index > 24)) fail(400, 'Nieprawidłowe pole planszy.');
  if ('rotation' in action && (!Number.isInteger(action.rotation) || action.rotation < 0 || action.rotation > 3)) fail(400, 'Nieprawidłowy obrót kafelka.');
  if ('tileId' in action && (typeof action.tileId !== 'string' || !action.tileId || action.tileId.length > 120)) fail(400, 'Nieprawidłowy kafelek.');
  return value;
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function unusedColor(players) {
  return colors.find(color => !players.some(player => player.color === color));
}

function newPlayer(name, color) {
  const token = randomBytes(32).toString('base64url');
  return { token, player: { id: randomUUID(), name, color, isBot: false, tokenHash: hashToken(token) } };
}

function validSavedPlayer(player) {
  if (!isObject(player) || typeof player.id !== 'string' || typeof player.name !== 'string' || !colors.includes(player.color)) return false;
  if (player.isBot !== undefined && typeof player.isBot !== 'boolean') return false;
  if (player.isBot) return !Object.hasOwn(player, 'tokenHash') && !Object.hasOwn(player, 'token');
  return /^[a-f0-9]{64}$/.test(player.tokenHash);
}

function completedResult(room) {
  if (room.status !== 'finished' || room.game?.status !== 'finished') return null;
  const game = room.game;
  return {
    room_code: room.code,
    room_created_at: new Date(room.createdAt).toISOString(),
    finished_at: new Date(room.lastActivity).toISOString(),
    turn_count: game.turnNumber,
    players: game.players.map(({ id, name, color, flowers }) => ({ id, name, color, isBot: room.players.find(player => player.id === id)?.isBot === true, flowers: [...flowers] })),
    starter_id: game.players[0].id,
    winner_id: game.winnerId,
    first_player_won: game.winnerId === game.players[0].id,
  };
}

function resultKey(result) {
  return JSON.stringify([result.room_code, result.room_created_at]);
}

function validSavedResult(result) {
  const keys = ['room_code', 'room_created_at', 'finished_at', 'turn_count', 'players', 'starter_id', 'winner_id', 'first_player_won'];
  if (!isObject(result) || Object.keys(result).length !== keys.length || keys.some(key => !Object.hasOwn(result, key))) return false;
  if (!/^[A-Z2-9]{6}$/.test(result.room_code) || !Number.isFinite(Date.parse(result.room_created_at)) || !Number.isFinite(Date.parse(result.finished_at)) || !Number.isSafeInteger(result.turn_count) || result.turn_count < 1 || !Array.isArray(result.players) || result.players.length !== 4) return false;
  if (result.players.some(player => !isObject(player) || Object.keys(player).length !== 5 || ['id', 'name', 'color', 'isBot', 'flowers'].some(key => !Object.hasOwn(player, key)) || typeof player.id !== 'string' || typeof player.name !== 'string' || !colors.includes(player.color) || typeof player.isBot !== 'boolean' || !Array.isArray(player.flowers) || player.flowers.some(color => !colors.includes(color) || color === player.color) || new Set(player.flowers).size !== player.flowers.length)) return false;
  return result.starter_id === result.players[0].id && result.players.some(player => player.id === result.winner_id && player.flowers.length === 3) && result.first_player_won === (result.starter_id === result.winner_id);
}

function readBody(req, maxBodyBytes) {
  const type = req.headers['content-type']?.split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') {
    req.resume();
    fail(415, 'Żądanie musi zawierać dane JSON.');
  }
  return new Promise((resolve, reject) => {
    let total = 0;
    let chunks = [];
    let settled = false;
    const rejectOnce = error => {
      if (settled) return;
      settled = true;
      chunks = [];
      reject(error);
    };
    req.on('data', chunk => {
      if (settled) return;
      total += chunk.length;
      if (total > maxBodyBytes) return rejectOnce(new RequestError(413, 'Żądanie jest zbyt duże.'));
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        settled = true;
        resolve(parsed);
      } catch {
        rejectOnce(new RequestError(400, 'Nieprawidłowy JSON.'));
      }
    });
    req.on('error', rejectOnce);
    req.on('aborted', () => rejectOnce(new RequestError(400, 'Żądanie zostało przerwane.')));
  });
}

export async function createServer(options = {}) {
  const dataDir = path.resolve(options.dataDir ?? process.env.DATA_DIR ?? path.join(root, 'data'));
  const publicDir = path.resolve(options.publicDir ?? path.join(root, 'public'));
  const storagePath = path.join(dataDir, 'rooms.json');
  const maxBodyBytes = options.maxBodyBytes ?? 16_384;
  const maxRooms = options.maxRooms ?? 200;
  const heartbeatMs = options.heartbeatMs ?? 15_000;
  const rateWindowMs = options.rateWindowMs ?? 60_000;
  const apiRateLimit = options.apiRateLimit ?? 180;
  const roomRateLimit = options.roomRateLimit ?? 20;
  const botDelayMs = options.botDelayMs ?? 650;
  const streams = new Map();
  const rateBuckets = new Map();
  const botTimers = new Map();
  let rooms = new Map();
  let results = new Map();
  let queue = Promise.resolve();
  let closing = false;
  let closingPromise;

  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  try {
    const stored = JSON.parse(await readFile(storagePath, 'utf8'));
    if (!isObject(stored) || stored.version !== 1 || !Array.isArray(stored.rooms)) throw new Error('Nieobsługiwany format zapisu pokoi.');
    for (const room of stored.rooms) {
      if (!isObject(room) || !/^[A-Z2-9]{6}$/.test(room.code) || !Array.isArray(room.players) || room.players.length < 1 || room.players.length > 4 || !Number.isSafeInteger(room.revision) || !['lobby', 'playing', 'finished'].includes(room.status) || room.players.some(player => !validSavedPlayer(player)) || new Set(room.players.map(player => player.color)).size !== room.players.length || !room.players.some(player => player.id === room.hostId && !player.isBot)) {
        throw new Error('Uszkodzony zapis pokoju.');
      }
      if (rooms.has(room.code)) throw new Error('Powtórzony kod pokoju w zapisie.');
      rooms.set(room.code, room);
    }
    if (stored.results !== undefined && !Array.isArray(stored.results)) throw new Error('Uszkodzony zapis wyników.');
    for (const result of stored.results ?? []) {
      if (!validSavedResult(result) || results.has(resultKey(result))) throw new Error('Uszkodzony zapis wyniku gry.');
      results.set(resultKey(result), result);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Nie można odczytać zapisu gry: ${error.message}`, { cause: error });
  }
  let backfilled = false;
  for (const room of rooms.values()) {
    const result = completedResult(room);
    if (result && !results.has(resultKey(result))) {
      results.set(resultKey(result), result);
      backfilled = true;
    }
  }
  if (backfilled) await persist(rooms, results);

  function json(res, status, value) {
    const data = JSON.stringify(value);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data), 'Cache-Control': 'no-store' });
    res.end(data);
  }

  function rateLimit(req, group, limit) {
    const now = Date.now();
    const key = `${req.socket.remoteAddress}:${group}`;
    let bucket = rateBuckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + rateWindowMs };
      rateBuckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > limit) fail(429, 'Zbyt wiele żądań. Spróbuj ponownie za minutę.');
  }

  function getRoom(code) {
    const room = rooms.get(code);
    if (!room) fail(404, 'Nie znaleziono pokoju. Sprawdź kod.');
    return room;
  }

  function authenticate(req, room) {
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization ?? '');
    if (!match) fail(401, 'Dołącz do pokoju, aby kontynuować.');
    const hash = Buffer.from(hashToken(match[1]), 'hex');
    const player = room.players.find(candidate => !candidate.isBot && timingSafeEqual(hash, Buffer.from(candidate.tokenHash, 'hex')));
    if (!player) fail(401, 'Sesja wygasła lub nie należy do tego pokoju.');
    return player;
  }

  function connected(code, playerId) {
    return [...(streams.get(code) ?? [])].some(stream => stream.playerId === playerId);
  }

  function roomView(room, playerId) {
    const game = room.game ? viewFor(room.game, playerId) : null;
    if (game) game.players = game.players.map(player => ({ ...player, isBot: room.players.find(member => member.id === player.id)?.isBot === true }));
    return {
      code: room.code,
      revision: room.revision,
      status: room.status,
      hostId: room.hostId,
      you: playerId,
      players: room.players.map(({ id, name, color, isBot }) => ({ id, name, color, isBot: isBot === true, connected: isBot === true || connected(room.code, id) })),
      game,
    };
  }

  function sendEvent(stream, room) {
    if (stream.res.destroyed || stream.res.writableEnded) return;
    if (stream.res.writableLength > 256 * 1024) {
      stream.res.destroy();
      return;
    }
    stream.res.write(`data: ${JSON.stringify(roomView(room, stream.playerId))}\n\n`);
  }

  function broadcast(room) {
    for (const stream of streams.get(room.code) ?? []) sendEvent(stream, room);
  }

  async function persist(next, nextResults) {
    const temporary = `${storagePath}.${randomUUID()}.tmp`;
    let handle;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({ version: 1, rooms: [...next.values()], results: [...nextResults.values()] }));
      await handle.sync();
      await handle.close();
      handle = null;
      await rename(temporary, storagePath);
    } catch (error) {
      await handle?.close().catch(() => {});
      await rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
    rooms = next;
    results = nextResults;
  }

  async function commit(room) {
    const next = new Map(rooms);
    next.set(room.code, room);
    const nextResults = new Map(results);
    const result = completedResult(room);
    if (result && !nextResults.has(resultKey(result))) nextResults.set(resultKey(result), result);
    await persist(next, nextResults);
    broadcast(room);
    scheduleBot(room);
  }

  function transaction(fn) {
    const result = queue.then(fn);
    queue = result.catch(() => {});
    return result;
  }

  function scheduleBot(room) {
    const existing = botTimers.get(room.code);
    if (existing) clearTimeout(existing);
    botTimers.delete(room.code);
    if (closing || !server.listening || room.status !== 'playing') return;
    const playerId = room.game.currentPlayerId;
    if (!room.players.some(player => player.id === playerId && player.isBot)) return;
    const revision = room.revision;
    const timer = setTimeout(() => {
      if (botTimers.get(room.code) !== timer) return;
      botTimers.delete(room.code);
      transaction(async () => {
        if (closing || !server.listening) return;
        const current = getRoom(room.code);
        if (current.revision !== revision || current.status !== 'playing' || current.game.currentPlayerId !== playerId || !current.players.some(player => player.id === playerId && player.isBot)) {
          scheduleBot(current);
          return;
        }
        const action = chooseBotAction(viewFor(current.game, playerId));
        if (!action) throw new Error(`Bot w pokoju ${room.code} nie wybrał legalnej akcji.`);
        const updated = structuredClone(current);
        updated.game = applyAction(current.game, playerId, action);
        updated.status = updated.game.status;
        updated.revision += 1;
        updated.lastActivity = Date.now();
        await commit(updated);
      }).catch(error => console.error('Błąd tury bota:', error));
    }, botDelayMs);
    timer.unref();
    botTimers.set(room.code, timer);
  }

  function clearBotTimers() {
    for (const timer of botTimers.values()) clearTimeout(timer);
    botTimers.clear();
  }

  async function staticFile(req, res, pathname) {
    if (!['GET', 'HEAD'].includes(req.method)) fail(405, 'Ta metoda nie jest obsługiwana.');
    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      fail(400, 'Nieprawidłowy adres.');
    }
    if (decoded.includes('\0') || decoded.split('/').some(part => part.startsWith('.')) || decoded.includes('\\')) fail(404, 'Nie znaleziono pliku.');
    const requested = decoded === '/' ? '/index.html' : decoded;
    const resolved = path.resolve(publicDir, `.${requested}`);
    if (!resolved.startsWith(`${publicDir}${path.sep}`)) fail(404, 'Nie znaleziono pliku.');
    let file;
    let info;
    try {
      const actualRoot = await realpath(publicDir);
      file = await realpath(resolved);
      if (!file.startsWith(`${actualRoot}${path.sep}`)) fail(404, 'Nie znaleziono pliku.');
      info = await stat(file);
      if (!info.isFile()) fail(404, 'Nie znaleziono pliku.');
    } catch (error) {
      if (error instanceof RequestError) throw error;
      if (['ENOENT', 'ENOTDIR'].includes(error.code)) fail(404, 'Nie znaleziono pliku.');
      throw error;
    }
    res.writeHead(200, { 'Content-Type': contentTypes[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'Content-Length': info.size, 'Cache-Control': 'no-cache' });
    if (req.method === 'HEAD') return res.end();
    const stream = createReadStream(file);
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  }

  async function route(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'; form-action 'self'");
    if (closing) fail(503, 'Serwer jest ponownie uruchamiany.');
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return staticFile(req, res, url.pathname);
    rateLimit(req, 'api', apiRateLimit);
    if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true });
    if (req.method === 'POST' && url.pathname === '/api/rooms') {
      rateLimit(req, 'room', roomRateLimit);
      const body = await readBody(req, maxBodyBytes);
      fields(body, ['name']);
      const name = playerName(body.name);
      const created = await transaction(async () => {
        if (rooms.size >= maxRooms) fail(503, 'Serwer osiągnął limit pokoi. Skontaktuj się z gospodarzem serwera.');
        let code;
        do {
          code = Array.from(randomBytes(6), value => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[value % 32]).join('');
        } while (rooms.has(code));
        const { player, token } = newPlayer(name, colors[0]);
        const room = { code, revision: 1, status: 'lobby', hostId: player.id, players: [player], game: null, createdAt: Date.now(), lastActivity: Date.now() };
        await commit(room);
        return { code, token, playerId: player.id, view: roomView(room, player.id) };
      });
      return json(res, 201, created);
    }
    const match = /^\/api\/rooms\/([A-Z2-9]{6})(?:\/(join|start|actions|events|bots|color))?$/.exec(url.pathname);
    if (!match) fail(404, 'Nie znaleziono adresu.');
    const [, code, operation] = match;
    const room = getRoom(code);
    if (operation === 'join' && req.method === 'POST') {
      rateLimit(req, 'room', roomRateLimit);
      const body = await readBody(req, maxBodyBytes);
      fields(body, ['name']);
      const name = playerName(body.name);
      const joined = await transaction(async () => {
        const current = structuredClone(getRoom(code));
        if (current.status !== 'lobby') fail(409, 'Rozgrywka już się rozpoczęła.');
        if (current.players.length >= 4) fail(409, 'W pokoju są już cztery osoby.');
        const { player, token } = newPlayer(name, unusedColor(current.players));
        current.players.push(player);
        current.revision += 1;
        current.lastActivity = Date.now();
        await commit(current);
        return { code, token, playerId: player.id, view: roomView(current, player.id) };
      });
      return json(res, 201, joined);
    }
    const player = authenticate(req, room);
    if (!operation && req.method === 'GET') return json(res, 200, roomView(room, player.id));
    if (operation === 'color' && req.method === 'POST') {
      const body = await readBody(req, maxBodyBytes);
      fields(body, ['color']);
      if (!colors.includes(body.color)) fail(400, 'Wybierz jeden z czterech kolorów ogródków.');
      const updated = await transaction(async () => {
        const current = structuredClone(getRoom(code));
        if (current.status !== 'lobby') fail(409, 'Kolor można zmienić tylko przed rozpoczęciem gry.');
        const member = current.players.find(candidate => candidate.id === player.id && !candidate.isBot);
        if (!member) fail(403, 'Możesz zmienić tylko swój kolor.');
        if (member.color === body.color) return roomView(current, player.id);
        if (current.players.some(candidate => candidate.color === body.color)) fail(409, 'Ten kolor jest już zajęty. Wybierz wolny kolor.');
        member.color = body.color;
        current.revision += 1;
        current.lastActivity = Date.now();
        await commit(current);
        return roomView(current, player.id);
      });
      return json(res, 200, updated);
    }
    if (operation === 'bots' && ['POST', 'DELETE'].includes(req.method)) {
      const body = await readBody(req, maxBodyBytes);
      fields(body, req.method === 'POST' ? ['count'] : []);
      if (req.method === 'POST' && (!Number.isInteger(body.count) || body.count < 1 || body.count > 3)) fail(400, 'Wybierz od jednego do trzech botów.');
      const updated = await transaction(async () => {
        const current = structuredClone(getRoom(code));
        if (player.id !== current.hostId) fail(403, 'Tylko gospodarz może zmieniać boty.');
        if (current.status !== 'lobby') fail(409, 'Boty można zmieniać tylko przed rozpoczęciem gry.');
        if (req.method === 'POST') {
          if (current.players.length + body.count > 4) fail(409, 'W pokoju nie ma tylu wolnych miejsc.');
          for (let count = 0; count < body.count; count += 1) {
            const color = unusedColor(current.players);
            current.players.push({ id: randomUUID(), name: ['Bot Zielony', 'Bot Żółty', 'Bot Niebieski', 'Bot Czerwony'][colors.indexOf(color)], color, isBot: true });
          }
        } else {
          current.players = current.players.filter(member => !member.isBot);
        }
        current.revision += 1;
        current.lastActivity = Date.now();
        await commit(current);
        return roomView(current, player.id);
      });
      return json(res, 200, updated);
    }
    if (operation === 'events' && req.method === 'GET') {
      let subscribers = streams.get(code);
      if (!subscribers) {
        subscribers = new Set();
        streams.set(code, subscribers);
      }
      if ([...subscribers].filter(stream => stream.playerId === player.id).length >= 4) fail(429, 'Ta sesja jest już otwarta w czterech kartach.');
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.flushHeaders();
      res.write('retry: 2000\n\n');
      const stream = { playerId: player.id, res };
      subscribers.add(stream);
      broadcast(getRoom(code));
      res.on('close', () => {
        subscribers.delete(stream);
        if (!subscribers.size) streams.delete(code);
        if (!closing) broadcast(getRoom(code));
      });
      return;
    }
    if (operation === 'start' && req.method === 'POST') {
      const body = await readBody(req, maxBodyBytes);
      fields(body, []);
      const updated = await transaction(async () => {
        const current = structuredClone(getRoom(code));
        if (player.id !== current.hostId) fail(403, 'Tylko gospodarz może rozpocząć grę.');
        if (current.status !== 'lobby') fail(409, 'Rozgrywka już się rozpoczęła.');
        if (current.players.length !== 4) fail(400, 'Do gry potrzebne są dokładnie cztery osoby.');
        current.game = createGame(current.players.map(({ id, name, color }) => ({ id, name, color })), { seed: randomBytes(4).readUInt32BE(0), allowBlockedMoveSkip: true });
        current.status = current.game.status;
        current.revision += 1;
        current.lastActivity = Date.now();
        await commit(current);
        return roomView(current, player.id);
      });
      return json(res, 200, updated);
    }
    if (operation === 'actions' && req.method === 'POST') {
      const { action, revision } = actionPayload(await readBody(req, maxBodyBytes));
      const updated = await transaction(async () => {
        const current = structuredClone(getRoom(code));
        if (current.status !== 'playing') fail(409, 'Rozgrywka nie jest aktywna.');
        if (revision !== current.revision) fail(409, 'Plansza zmieniła się. Odświeżono stan; wykonaj ruch ponownie.');
        if (player.id !== current.game.currentPlayerId) fail(403, 'Poczekaj na swoją turę.');
        try {
          current.game = applyAction(current.game, player.id, action);
        } catch (error) {
          fail(400, error.message);
        }
        current.status = current.game.status;
        current.revision += 1;
        current.lastActivity = Date.now();
        await commit(current);
        return roomView(current, player.id);
      });
      return json(res, 200, updated);
    }
    fail(405, 'Ta metoda nie jest obsługiwana.');
  }

  const server = http.createServer((req, res) => {
    route(req, res).catch(error => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (!(error instanceof RequestError)) console.error('Błąd serwera:', error);
      if (error.status === 429) res.setHeader('Retry-After', Math.ceil(rateWindowMs / 1000));
      json(res, error instanceof RequestError ? error.status : 500, { error: error instanceof RequestError ? error.message : 'Nie udało się zapisać lub odczytać gry. Spróbuj ponownie.' });
    });
  });
  server.requestTimeout = 20_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 40;
  server.on('listening', () => {
    for (const room of rooms.values()) scheduleBot(room);
  });
  const heartbeat = setInterval(() => {
    for (const subscribers of streams.values()) {
      for (const stream of subscribers) {
        if (stream.res.writableLength > 256 * 1024) stream.res.destroy();
        else stream.res.write(': heartbeat\n\n');
      }
    }
    const now = Date.now();
    for (const [key, bucket] of rateBuckets) if (now >= bucket.resetAt) rateBuckets.delete(key);
  }, heartbeatMs);
  heartbeat.unref();
  server.once('close', () => {
    clearInterval(heartbeat);
    clearBotTimers();
  });
  server.closeGracefully = () => {
    if (closingPromise) return closingPromise;
    closing = true;
    clearInterval(heartbeat);
    clearBotTimers();
    for (const subscribers of streams.values()) for (const stream of subscribers) stream.res.end();
    streams.clear();
    closingPromise = (async () => {
      await queue;
      if (!server.listening) return;
      await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        server.closeIdleConnections();
      });
    })();
    return closingPromise;
  };
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '0.0.0.0';
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT musi być liczbą od 1 do 65535.');
  const server = await createServer();
  server.listen(port, host, () => console.log(`Zapomniany Labirynt działa na http://${host}:${port}`));
  const shutdown = () => {
    const deadline = setTimeout(() => process.exit(1), 10_000);
    deadline.unref();
    server.closeGracefully().then(() => process.exit(0), error => {
      console.error(error);
      process.exit(1);
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
