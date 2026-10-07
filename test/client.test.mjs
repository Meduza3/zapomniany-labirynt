import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { createGame, applyAction, viewFor, TILE_CATALOG } from '../src/engine.mjs';

const [source, page, styles] = await Promise.all([
  readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/style.css', import.meta.url), 'utf8'),
]);
const rulesContent = page.match(/<div\b[^>]*id="rules-content"[^>]*>([\s\S]*?)<\/div>\s*<\/dialog>/)?.[1] ?? '';
const players = ['Ala', 'Bartek', 'Celina', 'Darek'].map((name, index) => ({ id: `p${index}`, name }));
const pathTile = { id: 'visible-path', kind: 'straight', rotation: 1, ability: null, asset: 'tile-1-3-1.webp' };

function roomView() {
  const game = createGame(players, { seed: 1 });
  game.board[7] = { ...pathTile };
  game.board[8] = { ...pathTile, id: 'second-path', rotation: 3 };
  return { code: 'ABC123', revision: 1, status: 'playing', hostId: 'p0', you: 'p0', players: game.players.map(({ id, name, color }) => ({ id, name, color })), game: viewFor(game, 'p0') };
}
function changed(view, revision, cells) {
  const result = structuredClone(view);
  result.revision = revision;
  for (const [index, tile] of Object.entries(cells)) result.game.board[Number(index)] = tile;
  return result;
}
function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
}
function browser({ reducedMotion = false, random = () => 0, tabStorage = storage(), durableStorage = storage(), pathname = '/', config, geometry = {} } = {}) {
  let now = 10000, timerId = 0;
  const timers = new Map(), requests = [], requestLog = [], mediaListeners = new Set(), documentListeners = new Map(), navigations = [], copiedInvites = [];
  function element() {
    const listeners = new Map();
    return {
      innerHTML: '', textContent: '', hidden: false, disabled: false, open: false, style: {}, listeners,
      classList: { toggle() {}, add() {}, remove() {} },
      addEventListener(type, callback) { listeners.set(type, callback); },
      querySelector() { return null; }, contains() { return false; },
      focus() { this.focused = true; }, scrollIntoView() { this.scrolled = true; },
      showModal() { this.open = true; }, close() { this.open = false; },
    };
  }
  const main = element(), connection = element(), span = element(), inlineRules = element(), sharedRules = element();
  sharedRules.innerHTML = rulesContent;
  const fields = new Map(), motionStyles = new Map();
  main.querySelector = selector => {
    if (selector === '#landing-rules' && main.innerHTML.includes('id="landing-rules"')) return inlineRules;
    if (fields.has(selector)) return fields.get(selector);
    if (Object.hasOwn(geometry, selector)) return { getBoundingClientRect: () => geometry[selector], style: {} };
    const motionId = selector.match(/^\[data-motion-id="([^"]+)"\]$/)?.[1];
    if (motionId && main.innerHTML.includes(`data-motion-id="${motionId}"`)) {
      if (!motionStyles.has(motionId)) motionStyles.set(motionId, {});
      return { style: motionStyles.get(motionId) };
    }
    return null;
  };
  connection.querySelector = () => span;
  const elements = new Map([['#main', main], ['#connection', connection], ['#toast', element()], ['#rules-dialog', element()], ['#rules-content', sharedRules], ['#rules-open', element()], ['[data-close-dialog]', element()]]);
  const media = {
    matches: reducedMotion,
    addEventListener(type, callback) { if (type === 'change') mediaListeners.add(callback); },
    removeEventListener(type, callback) { if (type === 'change') mediaListeners.delete(callback); },
  };
  const context = createContext({
    document: { querySelector: selector => elements.get(selector) ?? main.querySelector(selector), activeElement: null, addEventListener: (type, callback) => documentListeners.set(type, callback) },
    window: { matchMedia: () => media, scrollTo() {}, LABIRYNT_CONFIG: config },
    location: { search: '', origin: 'https://garden.example', pathname }, history: { replaceState(state, title, url) { navigations.push(url); } },
    navigator: { clipboard: { async writeText(value) { copiedInvites.push(value); } } },
    localStorage: durableStorage, sessionStorage: tabStorage,
    Math: Object.assign(Object.create(Math), { random }),
    performance: { now: () => now }, Date: class extends Date { static now() { return now; } },
    setTimeout(callback, delay = 0) { const id = ++timerId; timers.set(id, { callback, due: now + Number(delay) }); return id; },
    clearTimeout(id) { timers.delete(id); },
    fetch: (url, options = {}) => { requestLog.push({ url, ...options }); return new Promise(resolve => requests.push(resolve)); },
    URLSearchParams, URL, AbortController, TextDecoder, CSS: { escape: value => String(value) }, console,
  });
  runInContext(source, context, { filename: 'public/app.js' });
  function cellTarget(index) {
    const opening = main.innerHTML.match(new RegExp(`<button[^>]*data-cell="${index}"[^>]*>`))?.[0];
    assert.ok(opening, `Cell ${index} must be rendered before interacting.`);
    const button = {
      disabled: /\bdisabled\b/.test(opening), dataset: { cell: String(index) },
      hasAttribute: name => name === 'data-cell', contains: other => other === button,
      closest: selector => selector === 'button' || selector.includes('data-cell') || selector === '.board-cell' ? button : null,
    };
    return button;
  }
  function authenticate() {
    runInContext('persistSession({code:room.code,token:"fixture-token",playerId:room.you})', context);
  }
  return {
    accept(view) { context.incomingView = view; runInContext('acceptView(incomingView)', context); },
    render() { runInContext('render()', context); },
    home() { runInContext('home()', context); },
    share() { return runInContext('copyInvite()', context); },
    openRules() { elements.get('#rules-open').listeners.get('click')(); },
    closeRules() { elements.get('[data-close-dialog]').listeners.get('click')(); },
    typeName(value) { fields.set('#player-name', { value }); },
    form(mode) {
      const button = { disabled: false, dataset: { formMode: mode }, hasAttribute: () => false };
      main.listeners.get('click')({ target: { closest: () => button } });
    },
    select(tileId) {
      const button = { disabled: false, dataset: { tile: tileId }, hasAttribute: name => name === 'data-tile' };
      main.listeners.get('click')({ target: { closest: () => button } });
    },
    chooseColor(color) {
      const opening = main.innerHTML.match(new RegExp(`<button[^>]*data-color-choice="${color}"[^>]*>`))?.[0];
      assert.ok(opening, `Color ${color} must be rendered before choosing it.`);
      const button = { disabled: /\bdisabled\b/.test(opening), dataset: { colorChoice: color }, hasAttribute: name => name === 'data-color-choice' };
      main.listeners.get('click')({ target: { closest: () => button } });
    },
    authenticate,
    cellEvent(type, index, properties = {}) {
      let prevented = false;
      const callback = main.listeners.get(type);
      assert.ok(callback, `The app must handle ${type} events.`);
      callback({ target: cellTarget(index), relatedTarget: null, preventDefault() { prevented = true; }, ...properties });
      return prevented;
    },
    key(key, targetCell = null) {
      documentListeners.get('keydown')({ key, target: targetCell === null ? { closest: () => null } : cellTarget(targetCell), preventDefault() {} });
    },
    startAction(action) {
      context.requestedAction = action;
      authenticate();
      return runInContext('performAction(requestedAction)', context);
    },
    respond(view) {
      const resolve = requests.shift();
      assert.ok(resolve, 'A real app request must be waiting.');
      resolve({ ok: true, status: 200, json: async () => view });
    },
    motion(matches) {
      media.matches = matches;
      for (const callback of mediaListeners) callback({ matches });
    },
    advance(milliseconds) {
      const until = now + milliseconds;
      for (let count = 0; count < 1000; count++) {
        const next = [...timers].filter(([, timer]) => timer.due <= until).sort((left, right) => left[1].due - right[1].due)[0];
        if (!next) { now = until; return; }
        now = next[1].due;
        timers.delete(next[0]);
        next[1].callback();
      }
      assert.fail('The app scheduled an unbounded timer loop.');
    },
    cell(index) {
      const match = main.innerHTML.match(new RegExp(`<button[^>]*data-cell="${index}"[^>]*>[\\s\\S]*?<\\/button>`));
      assert.ok(match, `Cell ${index} must be rendered.`);
      return match[0];
    },
    get html() { return main.innerHTML; },
    get tabStorage() { return tabStorage; },
    get durableStorage() { return durableStorage; },
    get navigations() { return navigations; },
    get copiedInvites() { return copiedInvites; },
    get pendingTimers() { return timers.size; },
    get requests() { return requestLog; },
    get motionStyles() { return motionStyles; },
    get rulesNavigation() { return { focused: !!inlineRules.focused, scrolled: !!inlineRules.scrolled, modal: elements.get('#rules-dialog').open }; },
  };
}
function assertGrowing(client, index, elapsed) {
  const cell = client.cell(index);
  const wrapper = cell.match(/<span\b[^>]*class="[^"]*\bforgotten-tile\b[^"]*"[^>]*>/)?.[0];
  assert.ok(wrapper, 'The forgotten tile must have an overlay wrapper.');
  assert.match(wrapper, /aria-hidden="true"/);
  assert.match(wrapper, new RegExp(`--forget-delay:-${elapsed}ms`));
  assert.match(wrapper, /--forget-duration:1400ms/);
  return cell;
}
function assertSettled(client, index) {
  const cell = client.cell(index);
  assert.doesNotMatch(cell, /forgotten-tile/);
  assert.match(cell, /assets\/hedge\.webp/);
}

function previewGame(html) {
  const game = createGame(players, { seed: 1 });
  const gardens = game.board.filter(tile => tile?.kind === 'garden');
  const cells = [...html.matchAll(/<div\b[^>]*class="[^"]*\bpreview-cell\b[^"]*"[^>]*>([\s\S]*?)<\/div>/g)];
  const pawnColors = { green: '#71b846', yellow: '#f0c62c', blue: '#52abd5', red: '#e06c50' };
  const pawns = [];
  function attribute(tag, name) { return tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1]; }
  assert.equal(cells.length, 25, 'The preview must render all 25 board cells.');
  game.board = cells.map(([cell, contents], index) => {
    const declaredIndex = attribute(cell.split('>')[0], 'data-preview-cell');
    if (declaredIndex !== undefined) assert.equal(Number(declaredIndex), index);
    const image = contents.match(/<img\b[^>]*>/)?.[0];
    assert.ok(image, `Preview cell ${index} must display its tile artwork.`);
    const asset = attribute(image, 'src')?.match(/^assets\/([^/]+\.webp)$/)?.[1];
    const degrees = attribute(image, 'style')?.match(/rotate\((-?\d+)deg\)/)?.[1];
    assert.notEqual(degrees, undefined, `Preview cell ${index} must expose the displayed rotation.`);
    assert.ok([0, 90, 180, 270].includes(Number(degrees)), `Preview cell ${index} must use a quarter-turn rotation.`);
    for (const [pawn] of contents.matchAll(/<span\b[^>]*class="[^"]*\bpreview-pawn\b[^"]*"[^>]*>/g)) {
      const color = attribute(pawn, 'data-color') ?? attribute(pawn, 'data-pawn-color') ?? Object.keys(pawnColors).find(name => attribute(pawn, 'style')?.includes(`--pawn:${pawnColors[name]}`));
      const enteredSide = attribute(pawn, 'data-entry');
      const entry = enteredSide === undefined || enteredSide === '' || enteredSide === 'null' ? null : Number(enteredSide);
      assert.ok(Object.hasOwn(pawnColors, color), `Preview pawn at ${index} must have a known color.`);
      assert.ok(entry === null || [0, 1, 2, 3].includes(entry), `Preview pawn at ${index} must have a valid entered side.`);
      pawns.push({ color, position: index, entry });
    }
    if (asset === 'hedge.webp') return null;
    const tile = gardens.find(item => item.asset === asset) ?? TILE_CATALOG.find(item => item.asset === asset);
    assert.ok(tile, `Preview cell ${index} must use garden or catalog artwork: ${asset}.`);
    return { ...tile, rotation: Number(degrees) / 90 };
  });
  assert.deepEqual(pawns.map(pawn => pawn.color).sort(), game.players.map(player => player.color).sort(), 'The preview must show exactly one pawn for each of the four players.');
  game.players.forEach(player => {
    const pawn = pawns.find(item => item.color === player.color);
    Object.assign(player, pawn);
    const tile = game.board[player.position];
    assert.ok(tile, `The ${player.color} pawn must stand on a tile.`);
    if (tile.kind === 'bridge' || tile.kind === 'doubleCorner') assert.notEqual(player.entry, null, 'A pawn on split paths must retain its entered side.');
  });
  return game;
}

function assertLegalPreview(html) {
  const game = previewGame(html);
  const setup = createGame(players, { seed: 1 });
  const gardenPositions = board => board.flatMap((tile, index) => tile?.kind === 'garden' ? [[index, tile.color]] : []);
  assert.deepEqual(gardenPositions(game.board), gardenPositions(setup.board), 'All four gardens must remain at their printed positions.');
  const visible = new Set(viewFor(game, 'preview-observer').visible);
  const unseen = game.board.flatMap((tile, index) => tile && tile.kind !== 'garden' && !visible.has(index) ? [`${index}: ${tile.asset}`] : []);
  assert.deepEqual(unseen, [], 'Every rendered preview path must be visible to at least one rendered pawn.');
  const physicalTiles = game.board.filter(tile => tile && tile.kind !== 'garden').map(tile => tile.id);
  assert.equal(new Set(physicalTiles).size, physicalTiles.length, 'A physical path tile cannot appear twice in the preview.');
  const centers = [[[65, 35], [65, 35], [35, 65], [35, 65]], [[35, 35], [65, 65], [65, 65], [35, 35]]];
  for (const player of game.players) {
    const tile = game.board[player.position];
    const tag = [...html.matchAll(/<span\b[^>]*class="[^"]*\bpreview-pawn\b[^"]*"[^>]*>/g)].find(([opening]) => opening.includes(`data-color="${player.color}"`))?.[0];
    if (tile.kind !== 'doubleCorner') {
      assert.doesNotMatch(tag, /lane-pawn/);
      continue;
    }
    const [x, y] = centers[tile.rotation % 2][player.entry];
    assert.match(tag, /lane-pawn/);
    assert.match(tag, new RegExp(`--pawn-x:${x}%;--pawn-y:${y}%`));
  }
  return game;
}

function previewState(html) {
  const game = previewGame(html);
  return {
    board: game.board.map(tile => tile && [tile.id, tile.rotation]),
    players: game.players.map(({ color, position, entry }) => ({ color, position, entry })),
  };
}

function lobbyView(code = 'ABC123', revision = 1, occupants = players) {
  return { code, revision, status: 'lobby', hostId: 'p0', you: 'p0', players: occupants, game: null };
}

test('assets, invitations and navigation stay inside a GitHub Pages repository path', async () => {
  const client = browser({ pathname: '/labirynt/' });
  const base = 'https://garden.example/labirynt/';
  const resources = [...(page + client.html).matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1]);
  resources.push(...[...styles.matchAll(/url\('([^']+)'\)/g)].map(match => match[1]));
  for (const resource of resources.filter(value => !value.startsWith('data:') && !value.startsWith('#'))) {
    assert.ok(new URL(resource, base).pathname.startsWith('/labirynt/'), `${resource} must resolve under the repository path.`);
  }
  assert.match(page, /<script src="config\.js"><\/script>/);
  client.accept(roomView());
  client.authenticate();
  assert.equal(client.navigations.at(-1), '/labirynt/?room=ABC123');
  await client.share();
  assert.deepEqual(client.copiedInvites, ['https://garden.example/labirynt/?room=ABC123']);
  client.home();
  assert.equal(client.navigations.at(-1), '/labirynt/');
});

test('cloud room markers contain no Node token and are isolated from local server sessions', () => {
  const local = browser();
  local.accept(roomView());
  local.authenticate();
  const config = { backend: 'supabase', supabaseUrl: 'https://garden.supabase.co', publishableKey: 'sb_publishable_fixture' };
  const cloud = browser({ config, pathname: '/labirynt/', tabStorage: local.tabStorage, durableStorage: local.durableStorage });
  assert.match(cloud.html, /class="landing"/);
  assert.equal(cloud.requests.length, 0, 'A Node session must not restore through the cloud backend.');
  cloud.accept(roomView());
  cloud.authenticate();
  const scope = 'cloud:https://garden.supabase.co:/labirynt/:';
  assert.deepEqual(JSON.parse(cloud.tabStorage.getItem(`${scope}labirynt-current`)), { mode: 'supabase', code: 'ABC123', playerId: 'p0' });
  assert.equal(JSON.parse(local.tabStorage.getItem('labirynt-current')).token, 'fixture-token');
  cloud.home();
  assert.equal(cloud.tabStorage.getItem(`${scope}labirynt-current`), null);
  assert.ok(cloud.durableStorage.getItem(`${scope}labirynt-session-ABC123`), 'Returning home must retain the room-specific recovery marker.');
  assert.ok(local.tabStorage.getItem('labirynt-current'));
  const waiting = lobbyView('ABC123', 4, players.slice(0, 2).map(player => ({ ...player, connected: false })));
  local.accept(waiting);
  cloud.accept(waiting);
  assert.match(local.html, /Wraca…/, 'The local server still reports human presence.');
  assert.doesNotMatch(cloud.html, /Wraca…/, 'Cloud rooms do not report human presence.');
});

test('lobby color selection allows an unused color while protecting human and bot seats', async () => {
  const client = browser();
  assert.doesNotMatch(client.html, /data-color-choice=/);
  const occupants = players.slice(0, 3).map((player, index) => ({ ...player, color: ['green', 'yellow', 'blue'][index], isBot: index === 2 }));
  const view = lobbyView('ABC123', 1, occupants);
  client.accept(view);
  client.authenticate();
  const choices = () => [...client.html.matchAll(/<button\b[^>]*data-color-choice="([^"]+)"[^>]*>/g)];
  const choice = color => choices().find(match => match[1] === color)?.[0];
  assert.deepEqual(choices().map(match => match[1]), ['green', 'yellow', 'blue', 'red']);
  assert.match(choice('green'), /aria-pressed="true"/);
  assert.doesNotMatch(choice('green'), /\bdisabled\b/);
  for (const color of ['yellow', 'blue']) {
    assert.match(choice(color), /\bdisabled\b/);
    assert.match(choice(color), /aria-pressed="false"/);
    client.chooseColor(color);
  }
  client.chooseColor('green');
  assert.equal(client.requests.length, 0);
  assert.doesNotMatch(choice('red'), /\bdisabled\b/);
  client.chooseColor('red');
  assert.equal(client.requests.length, 1);
  const request = client.requests[0];
  assert.equal(request.url, '/api/rooms/ABC123/color');
  assert.equal(request.method, 'POST');
  assert.deepEqual(JSON.parse(request.body), { color: 'red' });
  assert.ok(choices().every(([button]) => /\bdisabled\b/.test(button)), 'Choices must be disabled until the server responds.');
  const updated = structuredClone(view);
  updated.revision = 2;
  updated.players[0].color = 'red';
  client.respond(updated);
  await new Promise(resolve => setImmediate(resolve));
  assert.match(choice('red'), /aria-pressed="true"/);
  assert.match(choice('green'), /aria-pressed="false"/);
  assert.doesNotMatch(choice('green'), /\bdisabled\b/);
  for (const color of ['yellow', 'blue']) assert.match(choice(color), /\bdisabled\b/);
  client.accept({ ...roomView(), revision: 3 });
  assert.doesNotMatch(client.html, /data-color-choice=/);
});

test('landing shows the shared rules after the preview and the header keeps room rules in a dialog', () => {
  assert.ok(rulesContent, 'The real page must provide the shared rules content.');
  const client = browser();
  const rulesStart = client.html.indexOf('id="landing-rules"');
  assert.ok(rulesStart > client.html.lastIndexOf('preview-cell'), 'Inline rules must follow the whole landing preview.');
  assert.equal(client.html.split(rulesContent).length, 2, 'The full shared rules must appear exactly once on the landing page.');
  assert.match(client.html.slice(rulesStart), /<details class="rules-defaults">/);
  assert.match(client.html.slice(rulesStart), /href="rules\.pdf"/);
  assert.match(rulesContent, /wyłącznie na końcu tury/);
  assert.doesNotMatch(rulesContent, /Od razu po jego położeniu|od razu po położeniu kafelka/);
  const ids = [...(page + client.html).matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'Copying rule contents must not duplicate document IDs.');
  client.openRules();
  assert.deepEqual(client.rulesNavigation, { focused: true, scrolled: true, modal: false });
  for (const room of [lobbyView(), roomView()]) {
    client.accept(room);
    assert.doesNotMatch(client.html, /id="landing-rules"/);
    client.openRules();
    assert.equal(client.rulesNavigation.modal, true);
    client.closeRules();
  }
});

function placementView({ cornerOfBoard = false } = {}) {
  const game = createGame(players, { seed: 3 });
  if (cornerOfBoard) {
    game.board[0] = { ...TILE_CATALOG.find(tile => tile.kind === 'tree') };
    game.players.forEach(player => { player.position = 0; player.entry = null; });
  }
  const view = { ...roomView(), game: viewFor(game, 'p0') };
  const tile = view.game.players[0].hand.find(item => item.kind === 'corner' && !item.ability);
  assert.ok(tile, 'The real dealt hand must contain the corner used by this fixture.');
  if (!cornerOfBoard) assert.deepEqual(view.game.legal.placements.filter(item => item.tileId === tile.id && item.index === 3).map(item => item.rotation), [1, 2]);
  return { view, tile };
}

function assertPlacement(client, index, tile, rotation) {
  const cell = client.cell(index);
  const preview = cell.match(/<span\b[^>]*class="[^"]*\bplacement-preview\b[^"]*"[^>]*>[\s\S]*?<\/span>/)?.[0];
  assert.ok(preview, `Cell ${index} must preview the selected tile even when its current rotation is illegal here.`);
  assert.match(preview, new RegExp(`src="assets/${tile.asset.replaceAll('.', '\\.')}"`));
  assert.match(preview, new RegExp(`rotate\\(${rotation * 90}deg\\)`));
  assert.match(cell, /aria-label="[^"]*Połóż kafelek tutaj/);
  assert.doesNotMatch(cell.split('>')[0], /\bdisabled\b/);
}

test('pawns occupy only their entered double-corner road at every rotation', () => {
  const cases = [
    { rotation: 0, lanes: [['0-1', 65, 35, ['green', 'yellow']], ['2-3', 35, 65, ['blue', 'red']]] },
    { rotation: 1, lanes: [['0-3', 35, 35, ['green', 'red']], ['1-2', 65, 65, ['yellow', 'blue']]] },
    { rotation: 2, lanes: [['0-1', 65, 35, ['green', 'yellow']], ['2-3', 35, 65, ['blue', 'red']]] },
    { rotation: 3, lanes: [['0-3', 35, 35, ['green', 'red']], ['1-2', 65, 65, ['yellow', 'blue']]] },
  ];
  const client = browser();
  for (const { rotation, lanes } of cases) {
    const view = roomView();
    view.revision = rotation + 1;
    view.game.board[12] = { ...TILE_CATALOG.find(tile => tile.kind === 'doubleCorner'), rotation };
    view.game.players.forEach((player, entry) => { player.position = 12; player.entry = entry; });
    client.accept(view);
    const groups = [...client.cell(12).matchAll(/<span class="pawn-group split-lane"([^>]*)>([\s\S]*?)(?=<span class="pawn-group|<\/button>)/g)];
    assert.equal(groups.length, 2, `Rotation ${rotation} must show two separate roads.`);
    for (const [lane, x, y, colors] of lanes) {
      const group = groups.find(([, attributes]) => attributes.includes(`data-lane="${lane}"`));
      assert.ok(group, `Rotation ${rotation} must show road ${lane}.`);
      assert.match(group[1], new RegExp(`--pawn-x:${x}%;--pawn-y:${y}%`));
      assert.deepEqual([...group[2].matchAll(/data-color="([^"]+)"/g)].map(match => match[1]), colors);
    }
  }
  const ordinary = roomView();
  ordinary.revision = 5;
  ordinary.game.board[12] = { ...TILE_CATALOG.find(tile => tile.kind === 'corner') };
  ordinary.game.players.forEach(player => { player.position = 12; });
  client.accept(ordinary);
  assert.doesNotMatch(client.cell(12), /split-lane/);
  assert.equal([...client.cell(12).matchAll(/class="pawn(?: you)?\s*"/g)].length, 4);
  ordinary.revision = 6;
  ordinary.game.board[12] = { ...TILE_CATALOG.find(tile => tile.kind === 'doubleCorner') };
  ordinary.game.players.forEach(player => { player.entry = null; });
  client.accept(ordinary);
  assert.doesNotMatch(client.cell(12), /split-lane/);
  ordinary.revision = 7;
  ordinary.game.players.forEach(player => { player.entry = 0; });
  client.accept(ordinary);
  assert.equal([...client.cell(12).matchAll(/class="pawn-group split-lane"/g)].length, 1);
  assert.equal([...client.cell(12).matchAll(/class="pawn(?: you)?\s*"/g)].length, 4);
});

test('selecting a corner previews every eligible cell with its own legal rotation', () => {
  const { view, tile } = placementView();
  const client = browser();
  client.accept(view);
  client.select(tile.id);
  assertPlacement(client, 3, tile, 1);
  assertPlacement(client, 1, tile, 0);
  assertPlacement(client, 7, tile, 2);
  assert.doesNotMatch(client.cell(0), /placement-preview/);
  assert.equal(client.requests.length, 0);
});

test('one click places exactly the visible orientation, including touch without prior hover', () => {
  for (const target of [3, 7]) {
    const { view, tile } = placementView();
    const client = browser();
    client.accept(view);
    client.authenticate();
    client.select(tile.id);
    const rotation = target === 3 ? 1 : 2;
    assertPlacement(client, target, tile, rotation);
    assert.equal(client.requests.length, 0);
    client.cellEvent('click', target);
    assert.equal(client.requests.length, 1, 'A single click must submit the placement without a confirmation step.');
    const request = client.requests[0];
    assert.equal(request.url, `/api/rooms/${view.code}/actions`);
    assert.equal(request.method, 'POST');
    assert.deepEqual(JSON.parse(request.body), { action: { type: 'place', index: target, tileId: tile.id, rotation }, revision: view.revision });
    assert.doesNotMatch(client.html, /placement-preview/, 'A submitted placement must remove all ghosts while the request is pending.');
  }
});

test('pointer and keyboard targets cycle only their legal orientations without submitting', () => {
  for (const entry of ['pointerover', 'focusin']) {
    const { view, tile } = placementView();
    const client = browser();
    client.accept(view);
    client.select(tile.id);
    if (entry === 'pointerover') {
      client.cellEvent('focusin', 3);
      client.cellEvent('pointerover', 1);
      client.key('r', 3);
      assertPlacement(client, 1, tile, 3);
      assertPlacement(client, 3, tile, 1);
      client.key('r', 3);
      assertPlacement(client, 1, tile, 0);
    }
    if (entry === 'focusin') {
      client.key('r', 3);
      assertPlacement(client, 3, tile, 2);
      client.key('R', 3);
      assertPlacement(client, 3, tile, 1);
    }
    client.cellEvent(entry, 3);
    assertPlacement(client, 3, tile, 1);
    client.key('r');
    assertPlacement(client, 3, tile, 2);
    assert.match(client.cell(3), /rotating-tile/);
    assert.match(client.html.match(/<button class="hand-tile selected"[\s\S]*?<\/button>/)?.[0] || '', /rotating-tile/);
    client.key('R');
    assertPlacement(client, 3, tile, 1);
    assert.equal(client.cellEvent('wheel', 3, { deltaY: 1 }), true);
    assertPlacement(client, 3, tile, 2);
    client.advance(80);
    assert.equal(client.cellEvent('wheel', 3, { deltaY: 1 }), true);
    assertPlacement(client, 3, tile, 2);
    client.advance(80);
    assert.equal(client.cellEvent('wheel', 3, { deltaY: -1 }), true);
    assertPlacement(client, 3, tile, 1);
    client.advance(160);
    assert.equal(client.cellEvent('wheel', 3, { deltaY: 1, ctrlKey: true }), false);
    assertPlacement(client, 3, tile, 1);
    assert.equal(client.cellEvent('wheel', 3, { deltaY: 0 }), false);
    assertPlacement(client, 3, tile, 1);
    assert.equal(client.cellEvent('wheel', 0, { deltaY: 1 }), false);
    assertPlacement(client, 3, tile, 1);
    assert.equal(client.requests.length, 0);
  }
});

test('rotation without an active target skips orientations unavailable anywhere', () => {
  const { view, tile } = placementView({ cornerOfBoard: true });
  assert.deepEqual([...new Set(view.game.legal.placements.filter(item => item.tileId === tile.id).map(item => item.rotation))].sort(), [1, 2, 3]);
  const client = browser();
  client.accept(view);
  client.select(tile.id);
  for (const rotation of [1, 2, 3, 1]) {
    client.key('r');
    const selected = handSlots(client.html).tiles.find(markup => markup.includes(`data-tile="${tile.id}"`));
    assert.match(selected, new RegExp(`rotate\\(${rotation * 90}deg\\)`));
  }
  assert.equal(client.requests.length, 0);
});

test('placement ghosts disappear when selection, turn, pending choice or navigation invalidates them', () => {
  for (const cancellation of ['deselect', 'escape', 'turn', 'pending', 'removed tile', 'placed', 'home']) {
    const { view, tile } = placementView();
    const client = browser();
    client.accept(view);
    client.select(tile.id);
    assertPlacement(client, 3, tile, 1);
    if (cancellation === 'deselect') client.select(tile.id);
    else if (cancellation === 'escape') client.key('Escape');
    else if (cancellation === 'home') client.home();
    else {
      const next = structuredClone(view);
      next.revision++;
      if (cancellation === 'turn') next.game.currentPlayerId = 'p1';
      if (cancellation === 'pending') next.game.turn.pending = { kind: 'prune', index: 3 };
      if (cancellation === 'removed tile') next.game.players[0].hand = next.game.players[0].hand.filter(item => item.id !== tile.id);
      if (cancellation === 'placed') next.game.turn.placed = true;
      client.accept(next);
    }
    assert.doesNotMatch(client.html, /placement-preview/, `No placement ghost may remain after ${cancellation}.`);
    assert.equal(client.requests.length, 0);
  }
});

function handView(flowers, { tileCount = 4 - flowers.length, pending = false, revision = 1 } = {}) {
  const view = roomView();
  const player = view.game.players[0];
  view.revision = revision;
  player.flowers = flowers;
  player.hand = player.hand.slice(0, tileCount);
  player.handCount = player.hand.length;
  view.game.players[1].flowers = ['green', 'red'];
  if (pending) {
    view.game.turn.pending = { kind: 'discard', index: player.position };
    view.game.legal.discardTileIds = player.hand.map(tile => tile.id);
  }
  if (flowers.length === 3) {
    view.status = view.game.status = 'finished';
    view.game.winnerId = player.id;
  }
  return view;
}

function handSlots(html) {
  const opening = /<div\b[^>]*class="hand-grid"[^>]*>/.exec(html);
  assert.ok(opening, 'The player hand must be rendered.');
  const remaining = html.slice(opening.index + opening[0].length);
  let depth = 1, end;
  for (const match of remaining.matchAll(/<\/?div\b[^>]*>/g)) {
    depth += match[0].startsWith('</') ? -1 : 1;
    if (depth === 0) { end = match.index; break; }
  }
  assert.notEqual(end, undefined, 'The player hand must have a closing boundary.');
  const grid = remaining.slice(0, end);
  return {
    tiles: [...grid.matchAll(/<button\b[^>]*class="[^"]*\bhand-tile\b[^"]*"[^>]*>[\s\S]*?<\/button>/g)].map(match => match[0]),
    flowers: [...grid.matchAll(/<([a-z]+)\b[^>]*class="[^"]*\bhand-flower\b[^"]*"[^>]*>[\s\S]*?<\/\1>/g)].map(match => match[0]),
    empty: [...grid.matchAll(/<[a-z]+\b[^>]*class="[^"]*\bhand-empty-slot\b[^"]*"[^>]*>/g)].map(match => match[0]),
  };
}

function assertHand(html, view, empty = 0) {
  const hand = handSlots(html);
  const player = view.game.players.find(item => item.id === view.you);
  assert.deepEqual(hand.tiles.map(tile => tile.match(/data-tile="([^"]+)"/)?.[1]), player.hand.map(tile => tile.id), 'Every real tile must remain in the hand.');
  assert.deepEqual(hand.flowers.map(slot => slot.match(/data-color="([^"]+)"/)?.[1]), player.flowers, 'The hand must show exactly the local player’s collected flowers.');
  assert.equal(hand.empty.length, empty, 'Unfilled tile capacity must stay visible as empty slots.');
  const names = { green: 'zielony', yellow: 'żółty', blue: 'niebieski', red: 'czerwony' };
  const fills = { green: '#74b343', yellow: '#edc323', blue: '#409dcc', red: '#d85647' };
  hand.flowers.forEach((slot, index) => {
    const color = player.flowers[index];
    assert.match(slot, /role="img"/);
    assert.match(slot, new RegExp(`aria-label="[^"]*(?:[Zz]dobyty|[Zz]ebrany)[^"]*${names[color]}[^"]*"`));
    assert.match(slot, /<svg\b/);
    assert.match(slot, new RegExp(`fill="${fills[color]}"`));
    assert.doesNotMatch(slot, /<(?:button|a)\b|data-tile=|tabindex=|onclick=/, 'Collected flowers must not be playable tiles or interactive controls.');
  });
  return hand;
}

test('zero to three collected flowers replace the local player’s tile slots and persist through updates and restore', async () => {
  const client = browser();
  let latest;
  for (let count = 0; count <= 3; count++) {
    latest = handView(['yellow', 'blue', 'red'].slice(0, count), { revision: count + 1, tileCount: count === 3 ? 2 : 4 - count });
    client.accept(latest);
    const hand = assertHand(client.html, latest);
    assert.doesNotMatch(client.html, /class="activity"|Historia ruchów|class="player-sub"|\d+ \/ \d+ kafelków/);
    assert.equal(hand.tiles.length + hand.flowers.length + hand.empty.length, count === 3 ? 5 : 4);
  }
  const saved = storage();
  saved.setItem('labirynt-current', JSON.stringify({ code: latest.code, token: 'fixture-token', playerId: latest.you }));
  const reloaded = browser({ tabStorage: saved });
  assert.match(reloaded.html, /class="restoring"/);
  reloaded.respond(latest);
  await new Promise(resolve => setImmediate(resolve));
  assertHand(reloaded.html, latest);
});

test('depleted hands retain empty tile slots beside earned flowers', () => {
  for (const tileCount of [1, 0]) {
    const view = handView(['yellow', 'red'], { tileCount });
    view.game.deckCount = 0;
    view.game.discardCount = 0;
    const client = browser();
    client.accept(view);
    const hand = assertHand(client.html, view, 2 - tileCount);
    assert.equal(hand.tiles.length + hand.flowers.length + hand.empty.length, 4);
  }
});

test('pending flower discard retains every eligible tile beside the new flower even above four slots', () => {
  for (const flowers of [['yellow'], ['yellow', 'blue']]) {
    const view = handView(flowers, { tileCount: 5 - flowers.length, pending: true });
    const client = browser();
    client.accept(view);
    const hand = assertHand(client.html, view);
    assert.equal(hand.tiles.length + hand.flowers.length, 5);
    for (const tile of hand.tiles) {
      assert.doesNotMatch(tile.split('>')[0], /\bdisabled\b/, 'Every real tile must remain available to discard.');
      assert.match(tile, /aria-label="Odrzuć:/);
    }
  }
});

test('all 16 landing previews keep every path visible to four distinct player positions', () => {
  const positions = new Set();
  for (let index = 0; index < 16; index++) {
    const client = browser({ random: () => (index + .5) / 16 });
    assert.match(client.html, /class="landing"/);
    const game = assertLegalPreview(client.html);
    positions.add(game.players.map(player => player.position).join(','));
  }
  assert.equal(positions.size, 16, 'Every selectable scene must have different player positions.');
});

test('all 16 lobby previews keep every path visible to their rendered pawns', () => {
  const scenes = Array.from({ length: 16 }, (_, index) => previewState(browser({ random: () => (index + .5) / 16 }).html));
  const positions = new Set();
  for (const target of scenes) {
    const previous = scenes.find(scene => scene.players.every((player, index) => player.position !== target.players[index].position));
    assert.ok(previous, 'Every scene must be reachable from another preview context.');
    const candidates = scenes.filter(scene => scene.players.every((player, index) => player.position !== previous.players[index].position));
    const choices = [(scenes.indexOf(previous) + .5) / 16, (candidates.indexOf(target) + .5) / candidates.length];
    const client = browser({ random: () => choices.shift() ?? 0 });
    client.accept(lobbyView());
    assert.match(client.html, /class="lobby"/);
    assertLegalPreview(client.html);
    assert.deepEqual(previewState(client.html), target);
    positions.add(previewState(client.html).players.map(player => player.position).join(','));
  }
  assert.equal(positions.size, 16);
});

test('preview stays stable while using a screen and changes all four positions on navigation and reload', () => {
  const client = browser();
  const landing = previewState(client.html);
  client.render();
  assert.deepEqual(previewState(client.html), landing);
  client.typeName('Ania');
  client.form('join');
  assert.match(client.html, /value="Ania"/);
  assert.match(client.html, /id="room-input"/);
  assert.deepEqual(previewState(client.html), landing);
  client.form('create');
  assert.doesNotMatch(client.html, /id="room-input"/);
  assert.deepEqual(previewState(client.html), landing);
  let previous = landing;
  function assertNewScene(html) {
    assertLegalPreview(html);
    const next = previewState(html);
    next.players.forEach((player, index) => assert.notEqual(player.position, previous.players[index].position, `The ${player.color} pawn must move in the next preview.`));
    previous = next;
    return next;
  }
  client.accept(lobbyView('ABC123', 1, players.slice(0, 1)));
  const lobby = assertNewScene(client.html);
  client.render();
  assert.deepEqual(previewState(client.html), lobby);
  client.accept(lobbyView('ABC123', 2, players.slice(0, 2)));
  assert.deepEqual(previewState(client.html), lobby);
  client.accept(lobbyView('ABC123', 3, players.slice(0, 2).map(player => ({ ...player, connected: false }))));
  assert.deepEqual(previewState(client.html), lobby);
  client.accept(lobbyView('XYZ789'));
  assertNewScene(client.html);
  client.home();
  assert.match(client.html, /class="landing"/);
  assertNewScene(client.html);
  const reloaded = browser({ tabStorage: client.tabStorage });
  assert.match(reloaded.html, /class="landing"/);
  assertNewScene(reloaded.html);
});

function assertPlaced(client, index, elapsed) {
  const image = client.cell(index).match(/<img\b[^>]*class="placed-tile"[^>]*>/)?.[0];
  assert.ok(image, 'An accepted new tile must animate its actual artwork.');
  assert.match(image, new RegExp(`--place-delay:-${elapsed}ms`));
  assert.match(image, /--place-duration:320ms/);
  return image;
}

test('accepted rotations use the shortest arc, preserve elapsed time and respect reduced motion', () => {
  for (const [from, to, start, end] of [[3, 0, 270, 360], [0, 3, 0, -90]]) {
    const client = browser(), initial = roomView();
    initial.game.board[7].rotation = from;
    client.accept(initial);
    assert.doesNotMatch(client.html, /rotating-tile/);
    const rotated = changed(initial, 2, { 7: { ...initial.game.board[7], rotation: to } });
    client.accept(rotated);
    const image = client.cell(7).match(/<img\b[^>]*class="[^"]*rotating-tile[^"]*"[^>]*>/)?.[0];
    assert.ok(image, 'Accepted tile rotations must animate.');
    assert.match(image, new RegExp(`--rotate-from:${start}deg;--rotate-to:${end}deg`));
    assert.doesNotMatch(client.cell(7), /placed-tile/);
    client.advance(90);
    client.accept(structuredClone(rotated));
    assert.match(client.cell(7), /--rotate-delay:-90ms/);
    client.accept(initial);
    assert.match(client.cell(7), /--rotate-delay:-90ms/);
    client.advance(130);
    assert.doesNotMatch(client.cell(7), /rotating-tile/);
    assert.equal(client.pendingTimers, 0);
    client.accept(changed(rotated, 3, { 7: { ...initial.game.board[7] } }));
    assert.match(client.cell(7), /rotating-tile/);
    client.motion(true);
    assert.doesNotMatch(client.html, /rotating-tile/);
    assert.equal(client.pendingTimers, 0);
  }
  const quiet = browser({ reducedMotion: true }), initial = roomView();
  quiet.accept(initial);
  quiet.accept(changed(initial, 2, { 7: { ...initial.game.board[7], rotation: 2 } }));
  assert.doesNotMatch(quiet.html, /rotating-tile/);
  assert.equal(quiet.pendingTimers, 0);
});

test('accepted local, remote and bot placements animate while initial tiles, previews and rotations do not', () => {
  const client = browser(), initial = roomView();
  client.accept(initial);
  assert.doesNotMatch(client.html, /placed-tile/);
  client.select(initial.game.players[0].hand[0].id);
  assert.doesNotMatch(client.html, /placed-tile/);
  let previous = initial;
  for (const [index, actor] of [{ id: 'p0', isBot: false }, { id: 'p1', isBot: false }, { id: 'p2', isBot: true }].entries()) {
    const next = changed(previous, index + 2, { [6 + index]: { ...pathTile, id: `placed-${actor.id}`, rotation: index } });
    next.game.currentPlayerId = actor.id;
    next.game.players.find(player => player.id === actor.id).isBot = actor.isBot;
    client.accept(next);
    const image = assertPlaced(client, 6 + index, 0);
    assert.match(image, new RegExp(`rotate\\(${index * 90}deg\\)`));
    client.advance(320);
    assert.doesNotMatch(client.html, /placed-tile/);
    previous = next;
  }
  client.accept(changed(previous, 5, { 8: { ...previous.game.board[8], rotation: 3 } }));
  assert.doesNotMatch(client.html, /placed-tile/);
  const fresh = browser();
  fresh.accept(previous);
  assert.doesNotMatch(fresh.html, /placed-tile/);
  assert.equal(fresh.pendingTimers, 0);
});

test('placement animation preserves its deadline across duplicate, stale and HTTP renders', async () => {
  const client = browser(), initial = roomView(), placed = changed(initial, 2, { 6: { ...pathTile, id: 'new-placement' } });
  client.accept(initial);
  client.accept(placed);
  client.advance(100);
  client.accept(structuredClone(placed));
  assertPlaced(client, 6, 100);
  client.select(initial.game.players[0].hand[0].id);
  assertPlaced(client, 6, 100);
  const request = client.startAction({ type: 'move', index: 8 });
  client.advance(80);
  client.accept(initial);
  client.respond(structuredClone(placed));
  await request;
  assertPlaced(client, 6, 180);
  client.advance(139);
  assert.match(client.cell(6), /placed-tile/);
  client.advance(1);
  assert.doesNotMatch(client.cell(6), /placed-tile/);
  assert.equal(client.pendingTimers, 0);
});

test('removal, room changes, home and reduced motion cancel placement animations', () => {
  const initial = roomView(), placed = changed(initial, 2, { 6: { ...pathTile, id: 'new-placement' } });
  for (const cancellation of ['remove', 'room', 'home', 'motion']) {
    const client = browser();
    client.accept(initial);
    client.accept(placed);
    client.advance(80);
    assertPlaced(client, 6, 0);
    if (cancellation === 'remove') client.accept(changed(placed, 3, { 6: null }));
    else if (cancellation === 'room') client.accept({ ...placed, code: 'XYZ789' });
    else if (cancellation === 'home') client.home();
    else client.motion(true);
    assert.doesNotMatch(client.html, /placed-tile/);
    client.advance(1500);
    assert.doesNotMatch(client.html, /placed-tile/);
    assert.equal(client.pendingTimers, 0);
  }
  const quiet = browser({ reducedMotion: true });
  quiet.accept(initial);
  quiet.accept(placed);
  assert.doesNotMatch(quiet.html, /placed-tile/);
  assert.equal(quiet.pendingTimers, 0);
});

test('new removals overgrow the original rotated tile, while initial empty cells and replacements do not', () => {
  const client = browser(), initial = roomView();
  client.accept(initial);
  assert.doesNotMatch(client.html, /forgotten-tile/);
  const replacement = { ...pathTile, id: 'new-corner', kind: 'corner', rotation: 2, asset: 'tile-1-5-1.webp' };
  client.accept(changed(initial, 2, { 7: null, 8: replacement, 2: null }));
  const cell = assertGrowing(client, 7, 0);
  const originalImage = [...cell.matchAll(/<img[^>]*>/g)].map(match => match[0]).find(tag => tag.includes('forgotten-path'));
  assert.ok(originalImage);
  assert.match(originalImage, /tile-1-3-1\.webp/);
  assert.match(originalImage, /rotate\(90deg\)/);
  assert.doesNotMatch(client.cell(8), /forgotten-tile/);
  assert.doesNotMatch(client.cell(2), /forgotten-tile/);
  assertSettled(client, 0);
  const fresh = browser();
  fresh.accept(changed(initial, 2, { 7: null }));
  assertSettled(fresh, 7);
  assert.equal(fresh.pendingTimers, 0);
});

test('duplicate, stale, selection and HTTP busy renders preserve the original animation deadline', async () => {
  const client = browser(), initial = roomView(), removed = changed(initial, 2, { 7: null });
  client.accept(initial);
  client.accept(removed);
  client.advance(240);
  client.accept(structuredClone(removed));
  assertGrowing(client, 7, 240);
  client.advance(160);
  client.select(initial.game.players[0].hand[0].id);
  assertGrowing(client, 7, 400);
  const request = client.startAction({ type: 'move', index: 8 });
  assertGrowing(client, 7, 400);
  client.advance(100);
  client.accept(initial);
  assertGrowing(client, 7, 400);
  client.respond(structuredClone(removed));
  await request;
  assertGrowing(client, 7, 500);
  client.advance(899);
  assert.match(client.cell(7), /forgotten-tile/);
  client.advance(1);
  assertSettled(client, 7);
  assert.equal(client.pendingTimers, 0);
});

test('staggered forgotten tiles expire independently instead of restarting one another', () => {
  const client = browser(), initial = roomView(), first = changed(initial, 2, { 7: null });
  client.accept(initial);
  client.accept(first);
  client.advance(350);
  client.accept(changed(first, 3, { 8: null }));
  assertGrowing(client, 7, 350);
  assertGrowing(client, 8, 0);
  client.advance(1050);
  assertSettled(client, 7);
  assertGrowing(client, 8, 1050);
  client.advance(349);
  assert.match(client.cell(8), /forgotten-tile/);
  client.advance(1);
  assertSettled(client, 8);
  assert.equal(client.pendingTimers, 0);
});

test('replacement, switching rooms and returning home cancel forgotten overlays without resurrection', () => {
  for (const cancellation of ['replacement', 'room', 'home']) {
    const client = browser(), initial = roomView(), removed = changed(initial, 2, { 7: null });
    client.accept(initial);
    client.accept(removed);
    client.advance(200);
    if (cancellation === 'replacement') {
      client.accept(changed(removed, 3, { 7: { ...pathTile, id: 'replacement' } }));
    } else if (cancellation === 'room') {
      client.accept({ ...changed(removed, 1, {}), code: 'XYZ789' });
    } else client.home();
    assert.doesNotMatch(client.html, /forgotten-tile/);
    assert.equal(client.pendingTimers, cancellation === 'replacement' ? 1 : 0);
    if (cancellation === 'replacement') assertPlaced(client, 7, 0);
    client.advance(2000);
    assert.doesNotMatch(client.html, /forgotten-tile/);
    if (cancellation === 'home') assert.match(client.html, /class="landing"/);
    else assert.match(client.html, /class="game-page"/);
  }
});

test('reduced motion shows the final hedge immediately and cancels running animation when enabled', () => {
  const initial = roomView(), removed = changed(initial, 2, { 7: null });
  const quiet = browser({ reducedMotion: true });
  quiet.accept(initial);
  quiet.accept(removed);
  assertSettled(quiet, 7);
  assert.equal(quiet.pendingTimers, 0);
  const client = browser();
  client.accept(initial);
  client.accept(removed);
  client.advance(200);
  client.motion(true);
  assertSettled(client, 7);
  assert.equal(client.pendingTimers, 0);
  client.motion(false);
  client.render();
  assertSettled(client, 7);
  client.advance(2000);
  assertSettled(client, 7);
});

function animationRoom(game, revision = 1) {
  return { code: 'ABC123', revision, status: game.status, hostId: 'p0', you: 'p0', players: game.players.map(({ id, name, color }) => ({ id, name, color })), game: viewFor(game, 'p0') };
}
function rect(left, top, width = 24, height = 24) {
  return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height };
}
function effectTags(html, className) {
  return [...html.matchAll(new RegExp(`<[^/!][^>]*class="[^"]*\\b${className}\\b[^"]*"[^>]*>`, 'g'))].map(match => match[0]);
}

test('a real straight pawn move travels between measured anchors and duplicate updates preserve its deadline', () => {
  let game = createGame(players, { seed: 1 });
  game.board[7] = { ...pathTile };
  game.board[12] = { ...TILE_CATALOG.find(tile => tile.kind === 'tree') };
  const initial = animationRoom(game);
  const geometry = {
    '[data-cell="2"] [data-pawn-id="p0"]': rect(148, 28),
    '[data-cell="12"] [data-pawn-id="p0"]': rect(148, 188),
    '[data-cell="2"]': rect(120, 0, 80, 80),
    '[data-cell="12"]': rect(120, 160, 80, 80),
  };
  const client = browser({ geometry });
  client.accept(initial);
  assert.equal(effectTags(client.html, 'pawn-flight').length, 0);
  game = applyAction(game, 'p0', { type: 'move', index: 12 });
  const moved = animationRoom(game, 2);
  client.accept(moved);
  const flight = effectTags(client.html, 'pawn-flight');
  assert.equal(flight.length, 1, 'An accepted straight move must animate exactly the moved pawn.');
  assert.match(flight[0], /data-player-id="p0"/);
  assert.match(flight[0], /data-from-cell="2"/);
  assert.match(flight[0], /data-to-cell="12"/);
  assert.match(client.cell(12), /pawn-in-transit/);
  const id = flight[0].match(/data-motion-id="([^"]+)"/)?.[1];
  assert.ok(id);
  assert.ok(client.motionStyles.get(id)?.cssText, 'The overlay must be positioned from measured geometry.');
  assert.doesNotMatch(client.motionStyles.get(id).cssText, /NaN|undefined/);
  assert.match(client.motionStyles.get(id).cssText, /M 160 40 L/);
  assert.match(client.motionStyles.get(id).cssText, /160 200"\)/);
  geometry['[data-cell="2"]'] = rect(120, 70, 80, 80);
  geometry['[data-cell="12"]'] = rect(120, 230, 80, 80);
  geometry['[data-cell="12"] [data-pawn-id="p0"]'] = rect(148, 258);
  client.render();
  assert.match(client.motionStyles.get(id).cssText, /M 160 110 L/, 'A layout shift must keep the route anchored to the board.');
  assert.match(client.motionStyles.get(id).cssText, /160 270"\)/);
  client.advance(100);
  client.accept(structuredClone(moved));
  client.accept(initial);
  client.render();
  assert.equal(effectTags(client.html, 'pawn-flight')[0].match(/data-motion-id="([^"]+)"/)?.[1], id);
  client.advance(239);
  assert.equal(effectTags(client.html, 'pawn-flight').length, 1);
  client.advance(1);
  assert.equal(effectTags(client.html, 'pawn-flight').length, 0);
  assert.doesNotMatch(client.cell(12), /pawn-in-transit/);
  client.accept(structuredClone(moved));
  assert.equal(effectTags(client.html, 'pawn-flight').length, 0);
  assert.equal(client.pendingTimers, 0);
});

test('a flower earned before placement stays beside playable tiles and flies to its owner', async () => {
  let game = createGame(players, { seed: 1 });
  game.players[0].position = 13;
  game.board[13] = { ...pathTile, rotation: 0 };
  const initial = animationRoom(game);
  const client = browser({ geometry: {
    '.garden-flowers[data-color="yellow"] .garden-flower-token:last-child': rect(320, 160),
    '.hand-flower[data-color="yellow"] .hand-flower-token': rect(700, 280),
  } });
  client.accept(initial);
  game = applyAction(game, 'p0', { type: 'move', index: 14 });
  const collected = animationRoom(game, 2);
  client.accept(collected);
  assert.equal(effectTags(client.html, 'flower-flight').length, 1);
  assert.match(effectTags(client.html, 'flower-flight')[0], /data-color="yellow"/);
  assert.equal(handSlots(client.html).flowers.length, 1);
  assert.equal(effectTags(client.html, 'drawn-tile').length, 0);
  client.advance(200);
  client.accept(structuredClone(collected));
  client.advance(219);
  assert.equal(effectTags(client.html, 'flower-flight').length, 1);
  client.advance(1);
  assert.equal(effectTags(client.html, 'flower-flight').length, 0);
  const hand = handSlots(client.html);
  assert.equal(hand.tiles.length, 4);
  assert.equal(hand.flowers.length, 1);
  assert.equal(collected.game.turn.pending, null);
  assert.ok(hand.tiles.every(tile => !/\bdisabled\b/.test(tile.split('>')[0])));
  assert.doesNotMatch(client.html, /aria-label="Odrzuć:/);
  assert.match(client.html, /Najpierw dołóż kafelek/);
  const placement = collected.game.legal.placements.find(action => !game.players[0].hand.find(tile => tile.id === action.tileId).ability);
  assert.ok(placement);
  client.authenticate();
  client.select(placement.tileId);
  assert.equal(client.requests.length, 0, 'Selecting a tile after earning a flower must not submit a discard.');
  client.cellEvent('click', placement.index);
  assert.equal(client.requests.length, 1);
  const request = JSON.parse(client.requests[0].body);
  assert.equal(request.action.type, 'place');
  assert.equal(request.action.tileId, placement.tileId);
  game = applyAction(game, 'p0', request.action);
  const ended = animationRoom(game, 3);
  client.respond(ended);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(game.currentPlayerId, 'p1');
  assert.equal(game.players[0].hand.length, 3);
  assert.equal(handSlots(client.html).flowers.length, 1);
  assert.equal(effectTags(client.html, 'drawn-tile').length, 0, 'The flower fills the space left by placement; no replacement is needed.');

  let otherGame = createGame(players, { seed: 1 });
  otherGame.currentPlayerId = 'p1';
  otherGame.players[1].position = 7;
  otherGame.board[7] = { ...pathTile };
  const other = browser({ geometry: {
    '.garden-flowers[data-color="green"] .garden-flower-token:last-child': rect(160, 20),
    '.player-card[data-player-id="p1"] .flower[data-color="green"]': rect(500, 10),
  } });
  other.accept(animationRoom(otherGame));
  otherGame = applyAction(otherGame, 'p1', { type: 'move', index: 2 });
  other.accept(animationRoom(otherGame, 2));
  assert.equal(effectTags(other.html, 'flower-flight').length, 1);
  assert.match(effectTags(other.html, 'flower-flight')[0], /data-color="green"/);
  assert.equal(handSlots(other.html).flowers.length, 0, 'Another player’s flower must not enter the local hand.');
});

test('replacement tiles wait for end of turn and animate after control passes to the next player', () => {
  let game = createGame(players, { seed: 1 });
  const initial = animationRoom(game);
  const placement = initial.game.legal.placements.find(action => action.index === 7 && action.rotation === 1 && game.players[0].hand.find(tile => tile.id === action.tileId).kind === 'tee');
  assert.ok(placement);
  const client = browser();
  client.accept(initial);
  const oldIds = new Set(game.players[0].hand.map(tile => tile.id));
  game = applyAction(game, 'p0', { type: 'place', ...placement });
  const placed = animationRoom(game, 2);
  client.accept(placed);
  assert.equal(game.currentPlayerId, 'p0');
  assert.equal(handSlots(client.html).tiles.length, 3);
  assert.equal(handSlots(client.html).empty.length, 1);
  assert.equal(effectTags(client.html, 'drawn-tile').length, 0);
  assert.ok(placed.game.legal.moves.includes(7));
  game = applyAction(game, 'p0', { type: 'move', index: 7 });
  const ended = animationRoom(game, 3);
  client.accept(ended);
  const newIds = game.players[0].hand.filter(tile => !oldIds.has(tile.id)).map(tile => tile.id);
  assert.equal(game.currentPlayerId, 'p1');
  assert.equal(newIds.length, 1);
  assert.equal(handSlots(client.html).tiles.length, 4);
  assert.equal(handSlots(client.html).empty.length, 0);
  assert.deepEqual(effectTags(client.html, 'drawn-tile').map(tag => tag.match(/data-tile="([^"]+)"/)?.[1]), newIds);
  assert.ok(handSlots(client.html).tiles.every(tile => /\bdisabled\b/.test(tile.split('>')[0])));
  client.advance(100);
  client.accept(structuredClone(ended));
  client.render();
  client.advance(219);
  assert.equal(effectTags(client.html, 'drawn-tile').length, 1);
  client.advance(1);
  assert.equal(effectTags(client.html, 'drawn-tile').length, 0);
});

test('three earned flowers bloom once while initial, missed and reduced-motion updates stay still', () => {
  let game = createGame(players, { seed: 1 });
  game.players[0].position = 11;
  game.players[0].flowers = ['yellow', 'blue'];
  game.players[0].hand = game.players[0].hand.slice(0, 2);
  game.board[11] = { ...pathTile, rotation: 0 };
  const before = animationRoom(game);
  game = applyAction(game, 'p0', { type: 'move', index: 10 });
  const finished = animationRoom(game, 2);
  assert.equal(finished.game.winnerId, 'p0');
  const client = browser();
  client.accept(before);
  client.accept(finished);
  assert.ok(effectTags(client.html, 'victory-flower').length >= 3);
  assert.equal(handSlots(client.html).flowers.filter(slot => /victory-flower/.test(slot)).length, 3);
  client.advance(500);
  client.accept(structuredClone(finished));
  client.render();
  client.accept(before);
  client.advance(399);
  assert.ok(effectTags(client.html, 'victory-flower').length >= 3);
  client.advance(1);
  assert.equal(effectTags(client.html, 'victory-flower').length, 0);
  client.accept(structuredClone(finished));
  client.render();
  assert.equal(effectTags(client.html, 'victory-flower').length, 0);
  assert.equal(client.pendingTimers, 0);
  for (const mode of ['initial', 'gap', 'reduced', 'room']) {
    const quiet = browser({ reducedMotion: mode === 'reduced' });
    if (mode !== 'initial') quiet.accept(before);
    quiet.accept({ ...finished, revision: mode === 'gap' ? 3 : 2, code: mode === 'room' ? 'XYZ789' : finished.code });
    for (const effect of ['pawn-flight', 'flower-flight', 'drawn-tile', 'victory-flower']) assert.equal(effectTags(quiet.html, effect).length, 0, `${mode} must not invent a fresh ${effect} event.`);
    assert.equal(quiet.pendingTimers, 0);
  }
  const cancelled = browser();
  cancelled.accept(before);
  cancelled.accept(finished);
  cancelled.advance(100);
  cancelled.motion(true);
  assert.equal(effectTags(cancelled.html, 'victory-flower').length, 0);
  assert.equal(cancelled.pendingTimers, 0);
  cancelled.motion(false);
  cancelled.render();
  assert.equal(effectTags(cancelled.html, 'victory-flower').length, 0);
});
