const main = document.querySelector('#main');
const connection = document.querySelector('#connection');
const toastElement = document.querySelector('#toast');
const rulesDialog = document.querySelector('#rules-dialog');
const rulesContent = document.querySelector('#rules-content').innerHTML;
const backendConfig = window.LABIRYNT_CONFIG || { backend: 'local' };
const cloudMode = backendConfig.backend === 'supabase';
const appBase = new URL('./', document.baseURI || `${location.origin}${location.pathname || '/'}`);
const storageScope = cloudMode ? `cloud:${backendConfig.supabaseUrl}:${appBase.pathname}:` : '';
const colors = { green: '#71b846', yellow: '#f0c62c', blue: '#52abd5', red: '#e06c50' };
const gardenTokenColors = { green: ['#74b343', '#3e6e2b'], yellow: ['#edc323', '#a9820f'], blue: ['#409dcc', '#235e8a'], red: ['#d85647', '#983c35'] };
const colorNames = { green: 'zielony', yellow: 'żółty', blue: 'niebieski', red: 'czerwony' };
const tileNames = { straight: 'Prosta ścieżka', corner: 'Zakręt', doubleCorner: 'Podwójny zakręt', oneway: 'Ścieżka jednokierunkowa', tree: 'Skrzyżowanie z drzewem', bridge: 'Most', tee: 'Rozwidlenie', garden: 'Ogródek' };
const abilityNames = { shovel: 'Łopata', prune: 'Sekator', rotate: 'Rotacja' };
const abilityDescriptions = { shovel: 'Możesz zastąpić kafelek na niezajętym polu.', prune: 'Po ułożeniu możesz usunąć inny, niezajęty kafelek.', rotate: 'Po ułożeniu możesz obrócić inny, niezajęty kafelek.' };
const copyIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3"/></svg>';
const PREVIEW_SCENES = [
  {"layout":[null,["tile-3-1-5.webp",2],["garden-green.webp",0],["tile-3-4-1.webp",0],["tile-1-3-2.webp",2],null,null,["tile-1-8-3.webp",3],["tile-3-2-2.webp",0],["tile-1-5-1.webp",1],["garden-red.webp",0],["tile-1-3-4.webp",0],["tile-3-4-5.webp",1],null,["garden-yellow.webp",0],["tile-1-7-5.webp",3],null,["tile-3-1-3.webp",0],null,["tile-1-8-5.webp",3],null,null,["garden-blue.webp",0],null,null],"players":[{"color":"green","position":9,"entry":3,"flowers":[]},{"color":"yellow","position":3,"entry":2,"flowers":[]},{"color":"blue","position":10,"entry":1,"flowers":["red"]},{"color":"red","position":2,"entry":2,"flowers":["green"]}]},
  {"layout":[null,null,["garden-green.webp",0],null,["tile-1-7-2.webp",1],["tile-3-2-5.webp",3],null,["tile-3-2-4.webp",0],null,["tile-1-2-2.webp",1],["garden-red.webp",0],null,["tile-3-4-1.webp",3],["tile-3-4-2.webp",1],["garden-yellow.webp",0],["tile-3-2-1.webp",3],["tile-1-5-3.webp",1],null,null,["tile-1-3-5.webp",1],null,["tile-1-5-1.webp",3],["garden-blue.webp",0],null,["tile-1-5-4.webp",2]],"players":[{"color":"green","position":15,"entry":0,"flowers":["red"]},{"color":"yellow","position":21,"entry":1,"flowers":["blue"]},{"color":"blue","position":9,"entry":2,"flowers":["yellow"]},{"color":"red","position":12,"entry":0,"flowers":["green"]}]},
  {"layout":[null,["tile-3-1-2.webp",0],["garden-green.webp",0],null,null,["tile-1-7-4.webp",1],["tile-3-2-2.webp",1],null,null,["tile-1-7-2.webp",0],["garden-red.webp",0],["tile-3-4-2.webp",2],["tile-1-1-1.webp",0],["tile-3-1-4.webp",2],["garden-yellow.webp",0],null,null,["tile-3-1-3.webp",0],null,["tile-3-2-1.webp",1],null,null,["garden-blue.webp",0],["tile-1-1-3.webp",2],["tile-1-6-1.webp",2]],"players":[{"color":"green","position":22,"entry":0,"flowers":["blue"]},{"color":"yellow","position":10,"entry":1,"flowers":["red"]},{"color":"blue","position":14,"entry":2,"flowers":["yellow"]},{"color":"red","position":1,"entry":2,"flowers":[]}]},
  {"layout":[["tile-3-1-2.webp",1],["tile-1-3-3.webp",0],["garden-green.webp",0],["tile-1-2-4.webp",0],["tile-1-7-5.webp",2],null,null,null,null,["tile-3-3-2.webp",3],["garden-red.webp",0],["tile-3-2-1.webp",2],["tile-1-5-5.webp",1],null,["garden-yellow.webp",0],null,["tile-3-1-1.webp",1],["tile-3-3-5.webp",1],null,["tile-3-1-4.webp",3],null,null,["garden-blue.webp",0],null,["tile-1-5-1.webp",2]],"players":[{"color":"green","position":24,"entry":0,"flowers":["yellow"]},{"color":"yellow","position":0,"entry":1,"flowers":["green"]},{"color":"blue","position":11,"entry":1,"flowers":[]},{"color":"red","position":17,"entry":3,"flowers":[]}]},
  {"layout":[null,null,["garden-green.webp",0],["tile-3-4-2.webp",0],["tile-3-1-1.webp",3],["tile-1-4-3.webp",1],null,["tile-3-3-5.webp",3],["tile-1-1-1.webp",1],null,["garden-red.webp",0],null,["tile-3-3-4.webp",3],["tile-3-2-1.webp",2],["garden-yellow.webp",0],["tile-1-8-1.webp",1],null,["tile-3-4-1.webp",3],["tile-1-7-4.webp",1],["tile-3-2-5.webp",2],["tile-3-2-2.webp",0],null,["garden-blue.webp",0],null,null],"players":[{"color":"green","position":20,"entry":0,"flowers":["red"]},{"color":"yellow","position":2,"entry":1,"flowers":["green"]},{"color":"blue","position":13,"entry":2,"flowers":[]},{"color":"red","position":14,"entry":3,"flowers":["yellow"]}]},
  {"layout":[["tile-3-1-3.webp",2],["tile-3-1-2.webp",0],["garden-green.webp",0],["tile-3-3-1.webp",0],null,["tile-1-4-1.webp",0],null,null,["tile-1-3-5.webp",3],null,["garden-red.webp",0],null,null,["tile-3-1-1.webp",1],["garden-yellow.webp",0],["tile-3-2-3.webp",3],["tile-3-1-4.webp",1],["tile-1-2-5.webp",0],["tile-1-3-2.webp",2],["tile-3-2-1.webp",1],null,null,["garden-blue.webp",0],null,["tile-1-7-1.webp",2]],"players":[{"color":"green","position":19,"entry":3,"flowers":["red"]},{"color":"yellow","position":1,"entry":2,"flowers":["red"]},{"color":"blue","position":5,"entry":2,"flowers":["red"]},{"color":"red","position":13,"entry":1,"flowers":["yellow"]}]},
  {"layout":[null,null,["garden-green.webp",0],null,null,null,null,["tile-1-8-5.webp",2],["tile-1-3-2.webp",3],null,["garden-red.webp",0],["tile-3-4-2.webp",0],["tile-1-1-1.webp",1],["tile-3-1-1.webp",2],["garden-yellow.webp",0],["tile-3-2-4.webp",2],null,["tile-3-4-1.webp",3],["tile-3-2-2.webp",0],["tile-1-4-1.webp",1],["tile-1-6-5.webp",3],["tile-3-1-4.webp",3],["garden-blue.webp",0],null,null],"players":[{"color":"green","position":13,"entry":2,"flowers":["blue"]},{"color":"yellow","position":22,"entry":0,"flowers":["blue"]},{"color":"blue","position":18,"entry":3,"flowers":["green"]},{"color":"red","position":10,"entry":1,"flowers":[]}]},
  {"layout":[null,null,["garden-green.webp",0],null,null,null,null,["tile-1-2-5.webp",3],null,["tile-3-1-2.webp",1],["garden-red.webp",0],["tile-3-3-4.webp",0],["tile-1-1-1.webp",1],null,["garden-yellow.webp",0],null,["tile-3-3-1.webp",1],["tile-3-1-4.webp",2],["tile-3-2-5.webp",0],["tile-3-4-1.webp",1],["tile-3-1-5.webp",0],["tile-3-1-1.webp",0],["garden-blue.webp",0],["tile-1-8-5.webp",2],null],"players":[{"color":"green","position":11,"entry":2,"flowers":["blue"]},{"color":"yellow","position":19,"entry":0,"flowers":[]},{"color":"blue","position":22,"entry":0,"flowers":["green"]},{"color":"red","position":21,"entry":0,"flowers":[]}]},
  {"layout":[null,["tile-1-5-4.webp",0],["garden-green.webp",0],["tile-1-7-3.webp",2],null,null,["tile-1-2-5.webp",3],null,null,null,["garden-red.webp",0],["tile-3-2-2.webp",1],null,["tile-3-1-2.webp",2],["garden-yellow.webp",0],null,["tile-1-6-4.webp",2],null,["tile-3-1-5.webp",1],["tile-3-4-2.webp",1],["tile-1-7-4.webp",3],["tile-3-3-2.webp",2],["garden-blue.webp",0],["tile-3-1-1.webp",3],null],"players":[{"color":"green","position":18,"entry":1,"flowers":["yellow"]},{"color":"yellow","position":11,"entry":0,"flowers":["green"]},{"color":"blue","position":1,"entry":2,"flowers":["red"]},{"color":"red","position":23,"entry":3,"flowers":["blue"]}]},
  {"layout":[null,null,["garden-green.webp",0],["tile-1-7-5.webp",0],["tile-1-7-3.webp",1],null,null,null,["tile-3-4-3.webp",1],["tile-3-1-4.webp",2],["garden-red.webp",0],["tile-1-7-4.webp",2],["tile-1-6-5.webp",1],null,["garden-yellow.webp",0],null,["tile-1-6-4.webp",3],["tile-3-1-1.webp",1],["tile-1-1-1.webp",2],["tile-1-5-2.webp",2],null,null,["garden-blue.webp",0],null,null],"players":[{"color":"green","position":17,"entry":0,"flowers":["red"]},{"color":"yellow","position":16,"entry":1,"flowers":["blue"]},{"color":"blue","position":19,"entry":0,"flowers":["yellow"]},{"color":"red","position":3,"entry":3,"flowers":["green"]}]},
  {"layout":[null,["tile-3-2-2.webp",1],["garden-green.webp",0],null,null,["tile-1-2-1.webp",0],["tile-1-8-1.webp",2],["tile-3-2-1.webp",2],["tile-1-6-2.webp",1],null,["garden-red.webp",0],["tile-3-4-4.webp",2],["tile-3-3-2.webp",0],["tile-1-8-5.webp",3],["garden-yellow.webp",0],null,null,["tile-1-1-3.webp",1],null,null,null,null,["garden-blue.webp",0],["tile-1-6-3.webp",2],null],"players":[{"color":"green","position":12,"entry":2,"flowers":["blue"]},{"color":"yellow","position":7,"entry":1,"flowers":[]},{"color":"blue","position":2,"entry":2,"flowers":["green"]},{"color":"red","position":22,"entry":0,"flowers":["blue"]}]},
  {"layout":[null,["tile-1-7-5.webp",0],["garden-green.webp",0],["tile-1-1-3.webp",2],["tile-1-5-2.webp",1],null,null,["tile-1-4-2.webp",3],null,["tile-3-4-2.webp",1],["garden-red.webp",0],["tile-1-5-3.webp",1],null,null,["garden-yellow.webp",0],["tile-3-2-1.webp",3],["tile-3-3-3.webp",2],["tile-1-8-5.webp",2],null,["tile-3-2-4.webp",2],["tile-1-5-5.webp",3],null,["garden-blue.webp",0],null,null],"players":[{"color":"green","position":14,"entry":0,"flowers":["yellow"]},{"color":"yellow","position":2,"entry":1,"flowers":["green"]},{"color":"blue","position":15,"entry":1,"flowers":[]},{"color":"red","position":16,"entry":0,"flowers":[]}]},
  {"layout":[["tile-1-4-3.webp",0],null,["garden-green.webp",0],null,null,["tile-1-2-2.webp",1],["tile-3-1-4.webp",3],null,["tile-3-3-5.webp",3],null,["garden-red.webp",0],["tile-3-4-1.webp",3],null,["tile-3-4-5.webp",2],["garden-yellow.webp",0],["tile-1-8-2.webp",1],["tile-1-5-5.webp",2],null,null,null,["tile-1-7-3.webp",0],["tile-1-8-3.webp",2],["garden-blue.webp",0],["tile-3-2-1.webp",0],null],"players":[{"color":"green","position":6,"entry":2,"flowers":["yellow"]},{"color":"yellow","position":0,"entry":2,"flowers":["red"]},{"color":"blue","position":20,"entry":1,"flowers":[]},{"color":"red","position":8,"entry":2,"flowers":["yellow"]}]},
  {"layout":[null,null,["garden-green.webp",0],null,null,["tile-1-5-5.webp",0],["tile-1-1-1.webp",0],["tile-3-3-3.webp",2],["tile-1-8-1.webp",0],["tile-3-2-5.webp",0],["garden-red.webp",0],null,["tile-3-1-4.webp",2],["tile-3-1-3.webp",2],["garden-yellow.webp",0],null,null,["tile-3-4-1.webp",3],["tile-3-2-2.webp",0],["tile-1-8-5.webp",3],null,null,["garden-blue.webp",0],null,null],"players":[{"color":"green","position":10,"entry":0,"flowers":["red"]},{"color":"yellow","position":17,"entry":1,"flowers":[]},{"color":"blue","position":18,"entry":3,"flowers":[]},{"color":"red","position":7,"entry":3,"flowers":[]}]},
  {"layout":[null,null,["garden-green.webp",0],["tile-3-4-2.webp",3],["tile-1-4-1.webp",1],null,null,null,null,["tile-1-3-2.webp",1],["garden-red.webp",0],["tile-3-2-1.webp",2],["tile-1-7-5.webp",0],["tile-1-7-2.webp",0],["garden-yellow.webp",0],null,["tile-3-2-3.webp",2],null,null,["tile-3-4-3.webp",1],null,["tile-3-3-2.webp",2],["garden-blue.webp",0],["tile-1-8-4.webp",0],["tile-1-8-1.webp",3]],"players":[{"color":"green","position":4,"entry":3,"flowers":[]},{"color":"yellow","position":14,"entry":2,"flowers":[]},{"color":"blue","position":11,"entry":2,"flowers":[]},{"color":"red","position":21,"entry":0,"flowers":[]}]},
  {"layout":[["tile-1-5-1.webp",0],null,["garden-green.webp",0],["tile-3-4-2.webp",0],["tile-1-6-4.webp",0],["tile-3-1-2.webp",1],null,null,["tile-1-3-2.webp",1],["tile-1-2-2.webp",1],["garden-red.webp",0],null,["tile-1-5-5.webp",0],["tile-3-1-3.webp",2],["garden-yellow.webp",0],null,null,null,["tile-1-3-5.webp",3],["tile-1-2-1.webp",1],null,null,["garden-blue.webp",0],["tile-3-4-5.webp",1],["tile-1-2-3.webp",1]],"players":[{"color":"green","position":23,"entry":0,"flowers":["yellow"]},{"color":"yellow","position":5,"entry":0,"flowers":["red"]},{"color":"blue","position":14,"entry":3,"flowers":["yellow"]},{"color":"red","position":13,"entry":1,"flowers":["yellow"]}]}
];
let previewScene = null;
let previewContext = null;
let room = null;
let session = null;
let selectedTileId = null;
let rotation = 0;
let placementIndex = null;
let rendering = false;
let lastWheelRotationAt = -Infinity;
let mode = 'move';
let powerIndex = null;
let powerRotation = 0;
let lastPlacedIndex = null;
let busy = false;
let streamController = null;
let streamSerial = 0;
let cloudTransportPromise = null;
let stopCloudEvents = null;
let toastTimer = null;
let formMode = new URLSearchParams(location.search).has('room') ? 'join' : 'create';
let formError = '';
let rememberedName = readStorage('labirynt-name') || '';
let inviteCode = (new URLSearchParams(location.search).get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
const travelEffects = new Map();
const drawnTiles = new Map();
let victoryEffect = null;
let gameMotionTimer = null;
const FORGET_DURATION = 1400;
const PLACE_DURATION = 320;
const ROTATE_DURATION = 220;
const tileRotations = new Map();
const rotationFrameKeys = new Set();
let rotationTimer = null;
const placedTiles = new Map();
let placingTimer = null;
const forgottenTiles = new Map();
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let forgettingTimer = null;

function clearGameMotions() {
  clearTimeout(gameMotionTimer);
  gameMotionTimer = null;
  travelEffects.clear();
  drawnTiles.clear();
  victoryEffect = null;
}

function motionRect(selector) {
  const bounds = main.querySelector(selector)?.getBoundingClientRect?.();
  if (!bounds || ![bounds.left, bounds.top, bounds.width, bounds.height].every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0) return null;
  return { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height, right: bounds.left + bounds.width, bottom: bounds.top + bounds.height };
}

function pawnSelector(player) {
  return `[data-cell="${player.position}"] [data-pawn-id="${CSS.escape(player.id)}"]`;
}

function motionRunning(item) {
  return !!item && !reducedMotion.matches && performance.now() - item.startedAt < item.duration;
}

function scheduleGameMotionCleanup() {
  clearTimeout(gameMotionTimer);
  gameMotionTimer = null;
  const running = [...travelEffects.values(), ...drawnTiles.values(), ...(victoryEffect ? [victoryEffect] : [])];
  if (!running.length) return;
  const deadline = Math.min(...running.map(item => item.startedAt + item.duration));
  gameMotionTimer = setTimeout(() => {
    for (const [key, item] of travelEffects) if (!motionRunning(item)) travelEffects.delete(key);
    for (const [key, item] of drawnTiles) if (!motionRunning(item)) drawnTiles.delete(key);
    if (!motionRunning(victoryEffect)) victoryEffect = null;
    render();
    scheduleGameMotionCleanup();
  }, Math.max(1, deadline - performance.now()));
}

function trackGameMotions(previous, next) {
  if (reducedMotion.matches || previous?.code !== next.code || !previous?.game || !next.game || next.revision > previous.revision + 1) {
    clearGameMotions();
    return;
  }
  for (const [key, item] of travelEffects) {
    const player = next.game.players.find(candidate => candidate.id === item.player.id);
    if (!motionRunning(item) || !player || item.type === 'pawn' && player.position !== item.toCell) travelEffects.delete(key);
  }
  const me = next.game.players.find(player => player.id === next.you);
  for (const [id, item] of drawnTiles) if (!motionRunning(item) || !me?.hand?.some(tile => tile.id === id)) drawnTiles.delete(id);
  if (!motionRunning(victoryEffect)) victoryEffect = null;
  if (next.revision !== previous.revision + 1) {
    scheduleGameMotionCleanup();
    return;
  }
  const startedAt = performance.now();
  for (const player of next.game.players) {
    const before = previous.game.players.find(candidate => candidate.id === player.id);
    if (!before) continue;
    if (before.position !== player.position) {
      const sameRow = Math.floor(before.position / 5) === Math.floor(player.position / 5);
      const sameColumn = before.position % 5 === player.position % 5;
      const from = motionRect(pawnSelector(before));
      const origin = motionRect(`[data-cell="${before.position}"]`);
      if ((sameRow || sameColumn) && from && origin) {
        const distance = sameRow ? Math.abs(before.position - player.position) : Math.abs(before.position - player.position) / 5;
        travelEffects.set(`pawn-${player.id}`, { type: 'pawn', player: { ...player }, from, origin, target: pawnSelector(player), fromCell: before.position, toCell: player.position, startedAt, duration: 220 + 60 * distance });
      }
    }
    for (const color of player.flowers || []) {
      if ((before.flowers || []).includes(color)) continue;
      const sourceCell = previous.game.board.findIndex(tile => tile?.kind === 'garden' && tile.color === color);
      const garden = previous.game.board[sourceCell];
      const from = garden && motionRect(`.garden-flowers[data-color="${color}"] .garden-flower-token:last-child`);
      if (!from) continue;
      const target = player.id === next.you ? `.hand-flower[data-color="${color}"] .hand-flower-token` : `.player-card[data-player-id="${CSS.escape(player.id)}"] .flower[data-color="${color}"]`;
      travelEffects.set(`flower-${player.id}-${color}`, { type: 'flower', player: { ...player }, color, from, target, sourceCell, origin: motionRect(`[data-cell="${sourceCell}"]`), startedAt, duration: 420 });
    }
  }
  const beforeMe = previous.game.players.find(player => player.id === next.you);
  if (beforeMe?.hand && me?.hand) {
    const held = new Set(beforeMe.hand.map(tile => tile.id));
    for (const tile of me.hand) if (!held.has(tile.id)) drawnTiles.set(tile.id, { startedAt, duration: 320 });
  }
  if (previous.game.status !== 'finished' && next.game.status === 'finished' && next.game.winnerId) {
    victoryEffect = { playerId: next.game.winnerId, startedAt, duration: 900 };
  }
  scheduleGameMotionCleanup();
}

function victoryAnimation(playerId, index) {
  return motionRunning(victoryEffect) && victoryEffect.playerId === playerId
    ? { className: ' victory-flower', style: `;--bloom-delay:${420 + index * 60 - Math.round(performance.now() - victoryEffect.startedAt)}ms` }
    : { className: '', style: '' };
}

function travelEffectsMarkup() {
  return `<div class="game-effects" aria-hidden="true">${[...travelEffects].filter(([, item]) => motionRunning(item)).map(([id, item]) => {
    const contents = item.type === 'pawn' ? `<span class="pawn ${item.player.id === room.you ? 'you' : ''}" style="--pawn:${colors[item.player.color]}">${escapeHtml(item.player.name.slice(0, 1).toUpperCase())}</span>` : flowerTokenMarkup(item.color, 0, 'flying-flower');
    return `<span class="travel-effect ${item.type}-flight" data-motion-id="${escapeHtml(id)}" data-player-id="${escapeHtml(item.player.id)}"${item.type === 'pawn' ? ` data-from-cell="${item.fromCell}" data-to-cell="${item.toCell}"` : ` data-color="${item.color}"`} style="visibility:hidden">${contents}</span>`;
  }).join('')}</div>`;
}

function positionTravelEffects() {
  for (const [id, item] of travelEffects) {
    if (!motionRunning(item)) continue;
    const element = main.querySelector(`[data-motion-id="${CSS.escape(id)}"]`);
    const target = motionRect(item.target);
    if (!element || !target) continue;
    const currentOrigin = item.origin && motionRect(`[data-cell="${item.type === 'pawn' ? item.fromCell : item.sourceCell}"]`);
    const origin = currentOrigin || item.origin;
    const sourceX = currentOrigin ? currentOrigin.left + (item.from.left + item.from.width / 2 - item.origin.left) * currentOrigin.width / item.origin.width : item.from.left + item.from.width / 2;
    const sourceY = currentOrigin ? currentOrigin.top + (item.from.top + item.from.height / 2 - item.origin.top) * currentOrigin.height / item.origin.height : item.from.top + item.from.height / 2;
    const sourceScale = item.from.width / target.width * (currentOrigin ? currentOrigin.width / item.origin.width : 1);
    const targetX = target.left + target.width / 2, targetY = target.top + target.height / 2;
    let path;
    if (item.type === 'pawn') {
      const destination = motionRect(`[data-cell="${item.toCell}"]`);
      if (!destination) continue;
      const horizontal = Math.floor(item.fromCell / 5) === Math.floor(item.toCell / 5);
      const forward = item.toCell > item.fromCell;
      const lift = target.height * .185;
      const exitX = horizontal ? forward ? origin.right : origin.left : origin.left + origin.width / 2;
      const exitY = horizontal ? origin.top + origin.height / 2 + lift : (forward ? origin.bottom : origin.top) + lift;
      const entryX = horizontal ? forward ? destination.left : destination.right : destination.left + destination.width / 2;
      const entryY = horizontal ? destination.top + destination.height / 2 + lift : (forward ? destination.top : destination.bottom) + lift;
      path = `M ${sourceX} ${sourceY} L ${exitX} ${exitY} L ${entryX} ${entryY} L ${targetX} ${targetY}`;
    } else {
      path = `M ${sourceX} ${sourceY} Q ${(sourceX + targetX) / 2} ${Math.min(sourceY, targetY) - 65} ${targetX} ${targetY}`;
    }
    const elapsed = Math.max(0, Math.round(performance.now() - item.startedAt));
    element.style.cssText = `visibility:visible;width:${target.width}px;height:${target.height}px;offset-path:path("${path}");--travel-duration:${item.duration}ms;--travel-delay:-${elapsed}ms;--travel-scale:${sourceScale};${item.type === 'flower' ? `--token-shadow:${gardenTokenColors[item.color][1]};` : ''}`;
  }
}

function clearTileRotations() {
  clearTimeout(rotationTimer);
  rotationTimer = null;
  tileRotations.clear();
  rotationFrameKeys.clear();
}

function tileRotationAnimation(key, id, angle) {
  rotationFrameKeys.add(key);
  const now = performance.now();
  let item = tileRotations.get(key);
  if (!item || item.id !== id) {
    item = { id, angle, startedAt: null };
    tileRotations.set(key, item);
  } else if (item.angle !== angle) {
    const progress = item.startedAt === null ? 1 : Math.min(1, (now - item.startedAt) / ROTATE_DURATION);
    const from = item.startedAt === null ? item.angle : item.from + (item.to - item.from) * progress;
    const delta = ((angle - from + 540) % 360 + 360) % 360 - 180;
    Object.assign(item, { angle, from, to: from + delta, startedAt: reducedMotion.matches || !delta ? null : now });
  }
  const elapsed = item.startedAt === null ? ROTATE_DURATION : Math.max(0, Math.round(now - item.startedAt));
  if (elapsed >= ROTATE_DURATION || reducedMotion.matches) {
    item.startedAt = null;
    return { className: '', style: '' };
  }
  return { className: 'rotating-tile', style: `;--rotate-from:${item.from}deg;--rotate-to:${item.to}deg;--rotate-delay:-${elapsed}ms;--rotate-duration:${ROTATE_DURATION}ms` };
}

function finishTileRotations() {
  clearTimeout(rotationTimer);
  rotationTimer = null;
  for (const key of tileRotations.keys()) {
    if (!rotationFrameKeys.has(key)) tileRotations.delete(key);
  }
  const running = [...tileRotations.values()].filter(item => item.startedAt !== null);
  if (!running.length) return;
  const deadline = Math.min(...running.map(item => item.startedAt + ROTATE_DURATION));
  rotationTimer = setTimeout(() => {
    const now = performance.now();
    for (const item of tileRotations.values()) {
      if (item.startedAt !== null && now - item.startedAt >= ROTATE_DURATION) item.startedAt = null;
    }
    render();
  }, Math.max(1, deadline - performance.now()));
}

function clearPlacedTiles() {
  clearTimeout(placingTimer);
  placingTimer = null;
  placedTiles.clear();
}

function schedulePlacedCleanup() {
  clearTimeout(placingTimer);
  placingTimer = null;
  if (!placedTiles.size) return;
  const deadline = Math.min(...[...placedTiles.values()].map(item => item.startedAt + PLACE_DURATION));
  placingTimer = setTimeout(() => {
    const now = performance.now();
    for (const [index, item] of placedTiles) {
      if (now - item.startedAt >= PLACE_DURATION) placedTiles.delete(index);
    }
    render();
    schedulePlacedCleanup();
  }, Math.max(1, deadline - performance.now()));
}

function trackPlacedTiles(previous, next) {
  if (reducedMotion.matches || previous?.code !== next.code || !previous?.game || !next.game) {
    clearPlacedTiles();
    return;
  }
  const now = performance.now();
  for (const [index, item] of placedTiles) {
    if (next.game.board[index]?.id !== item.id || now - item.startedAt >= PLACE_DURATION) placedTiles.delete(index);
  }
  if (next.revision > previous.revision) {
    next.game.board.forEach((tile, index) => {
      if (tile && tile.kind !== 'garden' && tile.id !== previous.game.board[index]?.id) {
        placedTiles.set(index, { id: tile.id, startedAt: now });
      }
    });
  }
  schedulePlacedCleanup();
}

function placedTileAnimation(index) {
  const item = placedTiles.get(index);
  const elapsed = item ? Math.max(0, Math.round(performance.now() - item.startedAt)) : PLACE_DURATION;
  return item && !reducedMotion.matches && elapsed < PLACE_DURATION
    ? { className: 'placed-tile', style: `;--place-delay:-${elapsed}ms;--place-duration:${PLACE_DURATION}ms` }
    : { className: '', style: '' };
}

function clearForgottenTiles() {
  clearTimeout(forgettingTimer);
  forgettingTimer = null;
  forgottenTiles.clear();
}

function scheduleForgottenCleanup() {
  clearTimeout(forgettingTimer);
  forgettingTimer = null;
  if (!forgottenTiles.size) return;
  const deadline = Math.min(...[...forgottenTiles.values()].map(item => item.startedAt + FORGET_DURATION));
  forgettingTimer = setTimeout(() => {
    const now = performance.now();
    for (const [index, item] of forgottenTiles) {
      if (now - item.startedAt >= FORGET_DURATION) forgottenTiles.delete(index);
    }
    render();
    scheduleForgottenCleanup();
  }, Math.max(1, deadline - performance.now()));
}

function trackForgottenTiles(previous, next) {
  if (reducedMotion.matches || previous?.code !== next.code || !previous?.game || !next.game) {
    clearForgottenTiles();
    return;
  }
  const now = performance.now();
  for (const [index, item] of forgottenTiles) {
    if (next.game.board[index] || now - item.startedAt >= FORGET_DURATION) forgottenTiles.delete(index);
  }
  if (next.revision > previous.revision) {
    previous.game.board.forEach((tile, index) => {
      if (tile && tile.kind !== 'garden' && !next.game.board[index]) {
        forgottenTiles.set(index, { tile: { ...tile }, startedAt: now });
      }
    });
  }
  scheduleForgottenCleanup();
}

function forgottenTileMarkup(index) {
  const item = forgottenTiles.get(index);
  if (!item || reducedMotion.matches) return '';
  const elapsed = Math.max(0, Math.round(performance.now() - item.startedAt));
  if (elapsed >= FORGET_DURATION) return '';
  const leaves = ['translate(15 69) rotate(-30)', 'translate(27 46) rotate(36)', 'translate(43 30) rotate(-20)', 'translate(79 37) rotate(145)', 'translate(65 57) rotate(210)', 'translate(49 75) rotate(150)'];
  return `<span class="forgotten-tile" aria-hidden="true" style="--forget-delay:-${elapsed}ms;--forget-duration:${FORGET_DURATION}ms"><img class="forgotten-path" src="assets/${escapeHtml(item.tile.asset)}" alt="" draggable="false" style="transform:rotate(${(item.tile.rotation || 0) * 90}deg)">${[1, 2, 3, 4].map(patch => `<span class="overgrowth-patch overgrowth-patch-${patch}"></span>`).join('')}<svg class="overgrowth-vines" viewBox="0 0 100 100" style="transform:rotate(${(index % 4) * 90}deg)" aria-hidden="true" focusable="false"><path class="vine vine-1" pathLength="1" d="M-5 108C18 88 6 71 23 54S29 25 58 12"/><path class="vine vine-2" pathLength="1" d="M106-5C83 10 89 29 72 45S77 75 49 89"/><path class="vine vine-3" pathLength="1" d="M-8 20C16 11 28 24 35 40S55 61 68 66"/>${leaves.map((transform, leaf) => `<g class="leaf leaf-${leaf + 1}" transform="${transform}"><path d="M0 0C-3-13 6-22 17-23C19-12 13-1 0 0Z"/><path class="leaf-vein" d="M1-1L13-18"/></g>`).join('')}</svg></span>`;
}

reducedMotion.addEventListener('change', () => {
  if (reducedMotion.matches && (forgottenTiles.size || placedTiles.size || travelEffects.size || drawnTiles.size || victoryEffect || [...tileRotations.values()].some(item => item.startedAt !== null))) {
    clearForgottenTiles();
    clearPlacedTiles();
    clearTileRotations();
    clearGameMotions();
    render();
  }
});

function readStorage(key, perTab = false) {
  try { return (perTab ? sessionStorage : localStorage).getItem(storageScope + key); } catch { return null; }
}

function writeStorage(key, value, perTab = false) {
  try { (perTab ? sessionStorage : localStorage).setItem(storageScope + key, value); } catch {}
}

function removeStorage(key, perTab = false) {
  try { (perTab ? sessionStorage : localStorage).removeItem(storageScope + key); } catch {}
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function coordinate(index) {
  return `${'ABCDE'[index % 5]}${Math.floor(index / 5) + 1}`;
}

function notify(message, error = false) {
  clearTimeout(toastTimer);
  toastElement.textContent = message;
  toastElement.classList.toggle('error', error);
  toastElement.hidden = false;
  toastTimer = setTimeout(() => { toastElement.hidden = true; }, error ? 7000 : 4000);
}

function setConnection(text, online = true) {
  connection.hidden = !text;
  connection.classList.toggle('offline', !online);
  connection.querySelector('span').textContent = text;
}

async function cloudTransport() {
  if (!cloudTransportPromise) cloudTransportPromise = import('./cloud-transport.js').then(module => module.createCloudTransport(backendConfig)).catch(error => {
    cloudTransportPromise = null;
    throw error;
  });
  return cloudTransportPromise;
}

async function api(path, options = {}) {
  if (cloudMode) return (await cloudTransport()).api(path, options);
  const headers = { ...options.headers };
  if (options.body) headers['Content-Type'] = 'application/json';
  if (session?.token) headers.Authorization = `Bearer ${session.token}`;
  const response = await fetch(path, { ...options, headers, cache: 'no-store' });
  const data = await response.json().catch(() => ({ error: 'Serwer zwrócił nieczytelną odpowiedź.' }));
  if (!response.ok) {
    const error = new Error(data.error || `Nie udało się wykonać akcji (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function flowerTokenMarkup(color, index = 0, className = 'garden-flower-token') {
  const palette = gardenTokenColors[color];
  const petals = [0, 72, 144, 216, 288];
  const body = petals.map(angle => `<circle cx="32" cy="17" r="13" transform="rotate(${angle} 32 32)"/>`).join('');
  const inset = petals.map(angle => `<ellipse cx="32" cy="23" rx="4.7" ry="8.5" transform="rotate(${angle} 32 32)"/>`).join('');
  return `<svg class="${className}" data-token="${index}" viewBox="0 0 64 64" aria-hidden="true" focusable="false"><g fill="${palette[0]}"><circle cx="32" cy="32" r="18"/>${body}</g><g fill="#fffdf0">${inset}</g><circle cx="32" cy="32" r="4" fill="${palette[0]}"/></svg>`;
}

function gardenFlowersMarkup(color, remaining) {
  const palette = gardenTokenColors[color];
  const tokens = Array.from({ length: remaining }, (_, index) => flowerTokenMarkup(color, index)).join('');
  return `<span class="garden-flowers" data-color="${color}" data-remaining="${remaining}" style="--token-shadow:${palette[1]}" role="img" aria-label="Ogródek ${colorNames[color]}: pozostałe kwiaty ${remaining} z 3" title="Pozostałe kwiaty: ${remaining} z 3">${tokens}</span>`;
}

function gardenStock(color, players) {
  return players.filter(player => player.color !== color && !(player.flowers || []).includes(color)).length;
}

function pawnLane(tile, entry) {
  const splitAssets = ['tile-1-7-4.webp', 'tile-1-7-5.webp', 'tile-1-8-5.webp', 'tile-3-2-5.webp'];
  if ((!tile || tile.kind !== 'doubleCorner' && !splitAssets.includes(tile.asset)) || !Number.isInteger(entry) || entry < 0 || entry > 3) return null;
  const paths = tile.rotation % 2 ? [[0, 3], [1, 2]] : [[0, 1], [2, 3]];
  const path = paths.find(sides => sides.includes(entry));
  return { key: path.join('-'), x: path.includes(1) ? 65 : 35, y: path.includes(0) ? 35 : 65 };
}

function previewPawnMarkup(player, tile) {
  const lane = pawnLane(tile && { asset: tile[0], rotation: tile[1] }, player.entry);
  return `<span class="preview-pawn${lane ? ' lane-pawn' : ''}" data-color="${player.color}" data-entry="${player.entry ?? ''}" style="--pawn:${colors[player.color]}${lane ? `;--pawn-x:${lane.x}%;--pawn-y:${lane.y}%` : ''}"></span>`;
}

function boardPawnsMarkup(tile, occupants) {
  const groups = new Map();
  for (const player of occupants) {
    const lane = pawnLane(tile, player.entry);
    const key = lane?.key || 'center';
    if (!groups.has(key)) groups.set(key, { lane, players: [] });
    groups.get(key).players.push(player);
  }
  return [...groups.values()].map(({ lane, players }) => `<span class="pawn-group${lane ? ' split-lane' : ''}"${lane ? ` data-lane="${lane.key}" style="--pawn-x:${lane.x}%;--pawn-y:${lane.y}%"` : ''}>${players.map(player => `<span class="pawn ${player.id === room.you ? 'you' : ''}${motionRunning(travelEffects.get(`pawn-${player.id}`)) ? ' pawn-in-transit' : ''}" data-pawn-id="${escapeHtml(player.id)}" data-color="${player.color}" style="--pawn:${colors[player.color]}" aria-hidden="true">${escapeHtml(player.name.slice(0, 1).toUpperCase())}</span>`).join('')}</span>`).join('');
}

function previewBoard() {
  const context = room?.code ? `lobby:${room.code}` : 'landing';
  if (previewContext !== context) {
    const previous = previewScene || PREVIEW_SCENES[Number.parseInt(readStorage('labirynt-preview', true), 10)];
    const candidates = PREVIEW_SCENES.filter(scene => !previous || scene.players.every((player, index) => player.position !== previous.players[index].position));
    previewScene = candidates[Math.floor(Math.random() * candidates.length)];
    previewContext = context;
    writeStorage('labirynt-preview', PREVIEW_SCENES.indexOf(previewScene), true);
  }
  const { layout, players } = previewScene;
  const gardens = { 2: 'green', 10: 'red', 14: 'yellow', 22: 'blue' };
  return `<div class="preview-shell"><div class="preview-grid">${layout.map((tile, index) => `<div class="preview-cell ${tile ? '' : 'empty'}" data-preview-cell="${index}"><img src="assets/${tile ? tile[0] : 'hedge.webp'}" style="transform:rotate(${tile ? tile[1] * 90 : 0}deg)" alt="" draggable="false">${gardens[index] ? gardenFlowersMarkup(gardens[index], gardenStock(gardens[index], players)) : ''}${players.filter(player => player.position === index).map(player => previewPawnMarkup(player, tile)).join('')}</div>`).join('')}</div></div>`;
}

function renderLanding() {
  setConnection('');
  main.innerHTML = `<section class="landing"><div class="landing-grid"><div class="hero-copy"><form class="room-form" id="room-form"><div class="form-tabs" role="tablist" aria-label="Wybierz sposób dołączenia"><button class="form-tab ${formMode === 'create' ? 'active' : ''}" type="button" role="tab" aria-selected="${formMode === 'create'}" data-form-mode="create">Nowa rozgrywka</button><button class="form-tab ${formMode === 'join' ? 'active' : ''}" type="button" role="tab" aria-selected="${formMode === 'join'}" data-form-mode="join">Dołącz do znajomych</button></div><div class="form-fields"><div class="field"><label for="player-name">Jak Cię nazywać?</label><input id="player-name" name="name" type="text" placeholder="Twoje imię" autocomplete="nickname" maxlength="24" value="${escapeHtml(rememberedName)}" required></div>${formMode === 'join' ? `<div class="field"><label for="room-input">Kod pokoju</label><input id="room-input" name="code" type="text" placeholder="np. ABC123" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="12" value="${escapeHtml(inviteCode)}" required></div>` : ''}</div>${formError ? `<p class="form-error" role="alert">${escapeHtml(formError)}</p>` : ''}<button class="primary-button full" type="submit" ${busy ? 'disabled' : ''}><span>${busy ? 'Łączenie…' : formMode === 'create' ? 'Stwórz pokój' : 'Wejdź do pokoju'}</span><span aria-hidden="true">↗</span></button></form></div><div class="hero-art" aria-label="Przykładowy układ planszy z oryginalnymi kafelkami">${previewBoard()}</div></div><section class="landing-rules panel" id="landing-rules" tabindex="-1" aria-labelledby="landing-rules-title"><h2 id="landing-rules-title">Zasady gry</h2>${rulesContent}</section></section>`;
}

function roomCodeBlock() {
  return `<div class="room-code"><div><small>Twój pokój</small><strong>${escapeHtml(room.code)}</strong></div><button type="button" class="icon-button" data-share aria-label="Kopiuj link zaproszenia" title="Kopiuj link zaproszenia">${copyIcon}</button></div>`;
}

function lobbyColorsMarkup() {
  const me = room.players.find(player => player.id === room.you);
  return `<fieldset class="lobby-colors"><legend>Twój kolor</legend><div class="color-options">${Object.keys(colors).map(color => {
    const taken = room.players.some(player => player.id !== room.you && player.color === color);
    const selected = me?.color === color;
    const label = `${colorNames[color]}${taken ? ' · zajęty' : selected ? ' · wybrany' : ''}`;
    return `<button type="button" class="color-option ${selected ? 'selected' : ''}" data-color-choice="${color}" style="--pawn:${colors[color]}" aria-label="${label}" aria-pressed="${selected}" title="${label}" ${busy || taken ? 'disabled' : ''}><span class="color-swatch" aria-hidden="true">${selected ? '✓' : taken ? '×' : ''}</span><span class="color-name">${colorNames[color]}</span></button>`;
  }).join('')}</div></fieldset>`;
}

function renderLobby() {
  const host = room.hostId === room.you;
  const freeSeats = 4 - room.players.length;
  const botCount = room.players.filter(player => player.isBot).length;
  const botControls = host && (freeSeats || botCount) ? `<div class="bot-controls">${freeSeats ? `<button class="secondary-button" type="button" data-bots="add" ${busy ? 'disabled' : ''}>Uzupełnij botami <span class="bot-count">+${freeSeats}</span></button>` : ''}${botCount ? `<button class="secondary-button" type="button" data-bots="remove" ${busy ? 'disabled' : ''}>Usuń boty</button>` : ''}</div>` : '';
  const seats = Array.from({ length: 4 }, (_, index) => {
    const player = room.players[index];
    const color = player?.color || ['green', 'yellow', 'blue', 'red'][index];
    return player ? `<div class="seat"><span class="seat-avatar" style="--pawn:${colors[color]}">${escapeHtml(player.name.slice(0, 1).toUpperCase())}</span><div><div class="seat-name">${escapeHtml(player.name)} ${player.id === room.you ? '<span class="small-label">(Ty)</span>' : ''}${player.isBot ? '<span class="bot-badge">Bot</span>' : ''}</div><div class="seat-detail">Ogródek ${colorNames[color]}${player.id === room.hostId ? ' · gospodarz' : ''}</div></div><span class="seat-state">${player.isBot ? 'Gotowy do gry' : cloudMode ? 'Zajęte miejsce' : player.connected === false ? 'Wraca…' : 'W pokoju'}</span></div>` : `<div class="seat empty"><span class="seat-avatar">+</span><div><div class="seat-name">Wolny ogródek</div><div class="seat-detail">Czekamy na działkowca nr ${index + 1}</div></div></div>`;
  }).join('');
  main.innerHTML = `<section class="lobby"><div class="room-heading"><div><h1>Pokój gry</h1></div>${roomCodeBlock()}</div><div class="lobby-grid"><section class="panel"><div class="panel-title"><h2>Gracze</h2><span class="small-label">${room.players.length} z 4 graczy</span></div><div class="seat-list">${seats}</div>${lobbyColorsMarkup()}<div class="lobby-start"><button class="secondary-button" type="button" data-share>${copyIcon} Skopiuj zaproszenie</button>${botControls}<button class="primary-button full" type="button" id="start-game" ${!host || room.players.length !== 4 || busy ? 'disabled' : ''}><span>${busy ? 'Zapisywanie…' : 'Rozpocznij grę'}</span><span aria-hidden="true">→</span></button></div></section><aside class="panel lobby-aside"><div class="lobby-art" aria-hidden="true">${previewBoard()}</div><button type="button" class="inline-link" data-rules>Zasady gry</button></aside></div><div class="lobby-foot"><span>Pokój i Twoje miejsce zostają zachowane po odświeżeniu.</span><button class="text-button" data-home type="button">Wróć na stronę główną</button></div></section>`;
}

function flowerMarkup(player) {
  const flowers = player.flowers || [];
  const items = Array.from({ length: 3 }, (_, index) => {
    const color = flowers[index];
    if (!color) return '<span class="flower empty-flower" aria-hidden="true">✿</span>';
    const bloom = player.id === room.you ? { className: '', style: '' } : victoryAnimation(player.id, index);
    const flying = player.id !== room.you && motionRunning(travelEffects.get(`flower-${player.id}-${color}`));
    return `<span class="flower${flying ? ' flower-in-transit' : ''}${bloom.className}" data-color="${color}" style="--flower-color:${colors[color]}${bloom.style}" role="img" aria-label="Kwiat ${colorNames[color]}">✿</span>`;
  }).join('');
  return `<div class="flowers" aria-label="${flowers.length} z 3 kwiatów">${items}</div>`;
}

function myPlayer() {
  return room?.game?.players.find(player => player.id === room.you);
}

function myTurn() {
  return room?.game?.currentPlayerId === room?.you && room?.game?.status !== 'finished';
}

function placementRotationsAt(index) {
  if (!selectedTileId || !room?.game || !myTurn() || busy || room.game.turn?.placed || room.game.turn?.pending) return [];
  return [...new Set((room.game.legal?.placements || []).filter(item => item.tileId === selectedTileId && (index === null || item.index === index)).map(item => item.rotation))];
}

function placementRotationAt(index) {
  const options = placementRotationsAt(index);
  for (let step = 0; step < 4; step++) {
    const candidate = (rotation + step) % 4;
    if (options.includes(candidate)) return candidate;
  }
  return null;
}

function placementPreviewMarkup(index) {
  const previewRotation = placementRotationAt(index);
  const tile = myPlayer()?.hand?.find(item => item.id === selectedTileId);
  if (previewRotation === null || !tile) return '';
  const animation = tileRotationAnimation(`preview:${index}`, tile.id, previewRotation * 90);
  return `<span class="placement-preview" data-rotation="${previewRotation}" aria-hidden="true"><img class="${animation.className}" src="assets/${escapeHtml(tile.asset)}" alt="" draggable="false" style="transform:rotate(${previewRotation * 90}deg)${animation.style}">${placementRotationsAt(index).length > 1 ? '<span class="placement-rotate-hint">↻ R</span>' : ''}</span>`;
}

function boardActionAt(index) {
  if (!myTurn() || busy) return null;
  const game = room.game;
  const legal = game.legal || {};
  const pending = game.turn?.pending;
  if (pending?.kind === 'discard') return null;
  if (pending?.kind === 'prune') return (legal.removals || []).includes(index) ? 'prune' : null;
  if (pending?.kind === 'rotate') return (legal.rotations || []).some(item => item.index === index) ? 'rotate' : null;
  if (selectedTileId && placementRotationAt(index) !== null) return 'place';
  if (mode === 'remove' && (legal.removals || []).includes(index)) return 'remove';
  if (!selectedTileId && mode !== 'remove' && (legal.moves || []).includes(index)) return 'move';
  return null;
}

function boardMarkup() {
  return room.game.board.map((tile, index) => {
    const action = boardActionAt(index);
    const placementAnimation = placedTileAnimation(index);
    const previewRotation = action === 'place' ? placementRotationAt(index) : null;
    const occupants = room.game.players.filter(player => player.position === index);
    const selected = powerIndex === index;
    const displayedRotation = selected && room.game.turn?.pending?.kind === 'rotate' ? powerRotation : (tile?.rotation || 0);
    const tileAnimation = tileRotationAnimation(`board:${index}`, tile?.id || 'empty', displayedRotation * 90);
    const asset = tile?.asset || (tile?.kind === 'garden' ? `garden-${tile.color}.webp` : 'hedge.webp');
    const remainingFlowers = tile?.kind === 'garden' ? gardenStock(tile.color, room.game.players) : null;
    const descriptions = { move: 'Przejdź tutaj', place: 'Połóż kafelek tutaj', prune: 'Usuń sekatorem', remove: 'Usuń kafelek', rotate: 'Wybierz do obrócenia' };
    const label = `${coordinate(index)}: ${tile ? tileNames[tile.kind] || 'Ścieżka' : 'Puste pole'}${remainingFlowers !== null ? ` ${colorNames[tile.color]}; pozostałe kwiaty ${remainingFlowers} z 3` : ''}${occupants.length ? `; ${occupants.map(player => player.name).join(', ')}` : ''}${action ? `; ${descriptions[action]}` : ''}${previewRotation !== null ? `; podgląd ${previewRotation * 90}°${placementRotationsAt(index).length > 1 ? ", R: obróć" : ""}` : ''}`;
    return `<button type="button" class="board-cell ${tile ? '' : 'empty'} ${tile?.kind === 'garden' ? `garden-cell garden-${tile.color}` : ''} ${action ? 'legal' : ''} ${action === 'place' ? 'placement-target' : ''} ${selected ? 'ability-selected' : ''}" data-cell="${index}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}" ${action ? '' : 'disabled'}><img class="${[placementAnimation.className, tileAnimation.className].filter(Boolean).join(' ')}" src="assets/${escapeHtml(asset)}" alt="" style="transform:rotate(${displayedRotation * 90}deg)${placementAnimation.style}${tileAnimation.style}" draggable="false">${forgottenTileMarkup(index)}${placementPreviewMarkup(index)}<span class="cell-label">${coordinate(index)}</span>${remainingFlowers !== null ? gardenFlowersMarkup(tile.color, remainingFlowers) : ''}${action && action !== 'place' && !occupants.length ? `<span class="target-marker" aria-hidden="true">${action === 'move' ? '•' : action === 'rotate' ? '↻' : action === 'remove' || action === 'prune' ? '−' : '+'}</span>` : ''}${boardPawnsMarkup(tile, occupants)}</button>`;
  }).join('');
}

function renderGame() {
  const game = room.game;
  const me = myPlayer();
  const active = game.players.find(player => player.id === game.currentPlayerId);
  const winner = game.players.find(player => player.id === game.winnerId);
  const isMine = myTurn();
  const finished = game.status === 'finished' || room.status === 'finished';
  const legal = game.legal || {};
  const pending = game.turn?.pending;
  const selected = me?.hand?.find(tile => tile.id === selectedTileId);
  const turn = game.turn || {};
  const discard = pending?.kind === 'discard';
  const hasFallback = isMine && !turn.placed && !pending && !(legal.placements || []).length && (legal.removals || []).length > 0;
  const hand = me?.hand || [];
  const flowers = me?.flowers || [];
  const canMoveToNewTile = isMine && !pending && !turn.moved && lastPlacedIndex !== null && (legal.moves || []).includes(lastPlacedIndex);
  const heading = finished ? 'Koniec gry' : isMine ? 'Twoja kolej.' : active?.isBot ? 'Tura bota' : 'Tura przeciwnika';
  let hint = 'Rusz pionkiem i dołóż kafelek w dowolnej kolejności. Tura zakończy się automatycznie.';
  if (finished) hint = 'Trzy różne kwiaty kończą tę rozgrywkę.';
  else if (!isMine) hint = active?.isBot ? `${active.name} rozgrywa turę automatycznie.` : `Trwa tura gracza ${active?.name || 'przeciwnik'}.`;
  else if (discard) hint = 'Zdobyty kwiat zajmuje miejsce. Wybierz kafelek, który odrzucisz z ręki.';
  else if (pending?.kind === 'prune') hint = `Użyj sekatora na zaznaczonym polu lub pomiń zdolność.${!turn.moved ? ' Ruch masz jeszcze do wykorzystania: potem możesz wejść na połączony ścieżką nowy kafelek.' : ' Po rozstrzygnięciu zdolności tura zakończy się automatycznie.'}`;
  else if (pending?.kind === 'rotate') hint = `Wybierz kafelek do obrócenia lub pomiń zdolność.${!turn.moved ? ' Ruch masz jeszcze do wykorzystania: potem możesz wejść na połączony ścieżką nowy kafelek.' : ' Po rozstrzygnięciu zdolności tura zakończy się automatycznie.'}`;
  else if (legal.canEnd) hint = 'Zakończ turę, aby przekazać ruch kolejnej osobie.';
  else if (selected) hint = 'Podgląd pokazuje, jak ułoży się ścieżka. Najedź na pole i obróć kafelek klawiszem R lub kółkiem myszy. Kliknij, aby położyć.';
  else if (hasFallback) hint = 'Nie możesz dołożyć żadnego kafelka. Usuń jeden z zaznaczonych na planszy.';
  else if (turn.moved) hint = 'Dołóż kafelek z ręki. Po ułożeniu i rozstrzygnięciu ewentualnej zdolności tura zakończy się automatycznie.';
  else if (legal.canSkipMove) hint = 'Brak legalnego ruchu. Pomiń go, aby zakończyć turę.';
  else if (canMoveToNewTile) hint = `Ruch masz jeszcze do wykorzystania. Kliknij pole ${coordinate(lastPlacedIndex)}, aby wejść na właśnie położony kafelek, albo wybierz inne podświetlone pole.`;
  else if (turn.placed) hint = 'Ruch masz jeszcze do wykorzystania. Kliknij podświetlone pole — także nowy kafelek, jeśli łączy się z Twoją ścieżką.';
  else if (!(legal.moves || []).length) hint = 'Dołóż kafelek, aby otworzyć drogę. Wybierz go ze swojej ręki, obróć i połóż przy swojej ścieżce.';
  const hintHtml = selected && !pending && isMine && !finished ? `<span class="desktop-placement-tip">${escapeHtml(hint)}</span><span class="touch-placement-tip">Dotknij podglądu, aby położyć kafelek. Przycisk „Obróć kafelek” zmienia ułożenie.</span>` : escapeHtml(hint);
  const cards = game.players.map(player => `<article class="player-card ${player.id === game.currentPlayerId && !finished ? 'active' : ''}" data-player-id="${escapeHtml(player.id)}"><span class="seat-avatar" style="--pawn:${colors[player.color]}">${escapeHtml(player.name.slice(0, 1).toUpperCase())}</span><div class="player-identity"><div class="player-name-row"><div class="player-name" title="${escapeHtml(player.name)}">${escapeHtml(player.name)}${player.id === room.you ? ' · Ty' : ''}</div>${player.isBot ? '<span class="bot-badge">Bot</span>' : ''}</div></div>${flowerMarkup(player)}</article>`).join('');
  const handHtml = hand.map((tile, index) => {
    const canDiscard = !legal.discardTileIds || legal.discardTileIds.includes(tile.id);
    const disabled = busy || !isMine || (discard ? !canDiscard : turn.placed || !!pending);
    const label = `${discard ? 'Odrzuć' : 'Wybierz'}: ${tileNames[tile.kind] || tile.kind}${tile.ability ? `, ${abilityNames[tile.ability]}` : ''}`;
    const tileAngle = (selectedTileId === tile.id ? rotation : tile.rotation || 0) * 90;
    const animation = tileRotationAnimation(`hand:${tile.id}`, tile.id, tileAngle);
    return `<button class="hand-tile ${selectedTileId === tile.id ? 'selected' : ''}${motionRunning(drawnTiles.get(tile.id)) ? ' drawn-tile' : ''}"${motionRunning(drawnTiles.get(tile.id)) ? ` style="--draw-delay:-${Math.max(0, Math.round(performance.now() - drawnTiles.get(tile.id).startedAt))}ms"` : ''} data-tile="${escapeHtml(tile.id)}" aria-label="${escapeHtml(label)}" aria-pressed="${selectedTileId === tile.id}" title="${escapeHtml(label)}" type="button" ${disabled ? 'disabled' : ''}><img class="${animation.className}" src="assets/${escapeHtml(tile.asset)}" alt="" draggable="false" style="transform:rotate(${tileAngle}deg)${animation.style}"><span class="tile-number">${index + 1}</span></button>`;
  }).join('');
  const flowerSlots = flowers.map((color, index) => `<span class="hand-flower${motionRunning(travelEffects.get(`flower-${room.you}-${color}`)) ? ' flower-in-transit' : ''}${victoryAnimation(room.you, index).className}" data-color="${color}" role="img" aria-label="Zdobyty kwiat ${colorNames[color]}" title="Zdobyty kwiat ${colorNames[color]}" style="--token-shadow:${gardenTokenColors[color][1]}${victoryAnimation(room.you, index).style}">${flowerTokenMarkup(color, index, 'hand-flower-token')}</span>`).join('');
  const emptySlots = Array.from({ length: Math.max(0, 4 - hand.length - flowers.length) }, () => '<span class="hand-empty-slot" aria-hidden="true"></span>').join('');
  let inspector = '';
  if (selected && !pending) inspector = `<div class="tile-inspector"><strong>${escapeHtml(tileNames[selected.kind] || selected.kind)}${selected.ability ? ` · ${abilityNames[selected.ability]}` : ''}</strong>${selected.ability ? `<p>${abilityDescriptions[selected.ability]}</p>` : ''}<div class="rotate-row"><button class="rotate-button" data-rotate type="button" ${busy ? 'disabled' : ''}><span aria-hidden="true">↻</span> Obróć kafelek <kbd class="key">R</kbd></button></div><p>${(legal.placements || []).some(item => item.tileId === selectedTileId) ? 'Kliknij podgląd na planszy, aby położyć kafelek.' : 'Brak miejsca na ten kafelek. Wybierz inny.'}</p></div>`;
  if (pending?.kind === 'rotate' && powerIndex !== null) inspector = `<div class="tile-inspector"><strong>Obrót kafelka ${coordinate(powerIndex)}</strong><div class="rotate-row"><button class="rotate-button" data-power-rotate type="button"><span aria-hidden="true">↻</span> Kolejny legalny obrót</button><span>${powerRotation * 90}°</span></div><p>Podgląd na planszy. Potwierdź, aby wykonać obrót.</p></div>`;
  const pendingNotice = pending ? `<div class="power-notice"><strong>${discard ? '✿ Miejsce na kwiat' : pending.kind === 'prune' ? '✂ Sekator' : '↻ Rotacja'}</strong><p>${discard ? 'Kliknij kafelek w ręce, aby go odrzucić.' : pending.kind === 'prune' ? 'Możesz usunąć inny kafelek, na którym nikt nie stoi.' : 'Obrócony kafelek musi pozostać w polu widzenia.'}</p></div>` : '';
  const turnActions = [];
  if (isMine && !finished) {
    if (pending?.kind === 'rotate' && powerIndex !== null) turnActions.push(`<button class="primary-button" type="button" data-confirm-power ${busy ? 'disabled' : ''}>Potwierdź obrót <span>↻</span></button>`);
    if (pending && !discard) turnActions.push(`<button class="secondary-button" type="button" data-action="skipAbility" ${busy ? 'disabled' : ''}>Pomiń zdolność</button>`);
    if (canMoveToNewTile) turnActions.push(`<button class="secondary-button new-tile-move" type="button" data-new-tile="${lastPlacedIndex}" ${busy ? 'disabled' : ''}>Wejdź na nowy kafelek ${coordinate(lastPlacedIndex)} <span aria-hidden="true">→</span></button>`);
    if (hasFallback) turnActions.push(`<button class="secondary-button" type="button" data-mode="remove" ${busy ? 'disabled' : ''}>Wybierz kafelek do usunięcia</button>`);
    if (legal.canSkipMove) turnActions.push(`<button class="secondary-button" type="button" data-action="skipMove" ${busy ? 'disabled' : ''}>Brak drogi · pomiń ruch</button>`);
    if (legal.canEnd) turnActions.push(`<button class="primary-button" type="button" data-action="endTurn" ${busy ? 'disabled' : ''}><span>${busy ? 'Zapisywanie…' : 'Zakończ turę'}</span><span aria-hidden="true">→</span></button>`);
  }
  main.innerHTML = `<section class="game-page"><div class="game-heading"><div><p class="game-meta">Tura ${game.turnNumber || 1} · ${finished ? 'Rozgrywka zakończona' : `Ruch: ${escapeHtml(active?.name || '')}`}</p></div>${roomCodeBlock()}</div>${finished ? `<div class="finished-banner" role="status"><div><h2>${escapeHtml(winner?.name || 'Zwycięzca')} zdobywa trzy kwiaty!</h2></div><span class="finished-icon" aria-hidden="true">✿</span><button type="button" class="secondary-button" data-home>Nowa rozgrywka</button></div>` : ''}<div class="players-strip" aria-label="Gracze">${cards}</div><div class="game-layout"><section class="board-section" aria-label="Plansza labiryntu"><div class="board-topline"><span class="eyebrow">Plansza</span><span>${game.deckCount ?? 0} w talii · ${game.discardCount ?? 0} odrzuconych</span></div><div class="board-shell"><div class="board" aria-label="Plansza 5 na 5">${boardMarkup()}</div></div><div class="board-help"><span class="legend"><i></i>${pending?.kind === 'rotate' ? 'Możliwy obrót' : pending?.kind === 'prune' || mode === 'remove' ? 'Możliwe usunięcie' : selected ? '<span class="desktop-placement-tip">Podgląd ułożenia · R / kółko: obrót</span><span class="touch-placement-tip">Dotknij podglądu, aby położyć</span>' : 'Możliwy ruch'}</span></div></section><aside class="game-sidebar"><section class="panel turn-panel"><div class="turn-summary"><span class="eyebrow">${finished ? 'Koniec rozgrywki' : isMine ? `Ogródek ${colorNames[me?.color]}` : `Tura · ${escapeHtml(active?.name || '')}`}</span><h2>${heading}</h2><p class="turn-hint" aria-live="polite">${hintHtml}</p>${isMine ? `<div class="turn-tasks"><button type="button" class="task-button ${turn.moved ? 'complete' : mode === 'move' && !selectedTileId && !pending ? 'current' : ''}" data-mode="move" ${turn.moved || pending || busy ? 'disabled' : ''}><span class="task-check">${turn.moved ? '✓' : '1'}</span> Rusz pionkiem</button><button type="button" class="task-button ${turn.placed ? 'complete' : selectedTileId || mode === 'place' || mode === 'remove' ? 'current' : ''}" data-mode="place" ${turn.placed || pending || busy ? 'disabled' : ''}><span class="task-check">${turn.placed ? '✓' : '2'}</span> ${hasFallback || mode === 'remove' ? 'Usuń kafelek' : 'Dołóż kafelek'}</button></div>` : ''}${isMine ? pendingNotice : ''}</div><div class="hand-tray ${isMine && !finished ? 'active-tray' : ''}"><div class="hand-heading"><h3>Twoja ręka</h3></div><div class="hand-grid">${handHtml}${emptySlots}${flowerSlots}${!hand.length && !flowers.length ? '<p class="hand-empty">Ręka jest pusta.</p>' : ''}</div>${inspector}${turnActions.length ? `<div class="turn-actions">${turnActions.join('')}</div>` : ''}</div></section></aside></div><footer class="site-footer"><span>Pokój ${escapeHtml(room.code)} · stan zapisuje się automatycznie</span><div class="footer-actions"><button class="inline-link" type="button" data-home>Nowy pokój</button><button class="inline-link" type="button" data-rules>Instrukcja i ustalenia gry</button></div></footer>${travelEffectsMarkup()}</section>`;
}

function render() {
  rendering = true;
  rotationFrameKeys.clear();
  try {
    const focused = document.activeElement;
    const focusAttribute = focused && main.contains(focused) ? [...focused.attributes].find(attribute => attribute.name === 'id' || attribute.name.startsWith('data-')) : null;
    if (!room) renderLanding();
    else if (!room.game || room.status === 'lobby') renderLobby();
    else renderGame();
    if (focusAttribute) {
      const replacement = main.querySelector(`[${focusAttribute.name}="${CSS.escape(focusAttribute.value)}"]`);
      if (replacement && !replacement.disabled) replacement.focus({ preventScroll: true });
    }
  } finally {
    finishTileRotations();
    positionTravelEffects();
    rendering = false;
  }
}

function acceptView(view) {
  if (!view?.code || (room && view.code === room.code && view.revision < room.revision)) return;
  if (room?.code !== view.code || !room?.game || !view.game) clearTileRotations();
  trackForgottenTiles(room, view);
  trackPlacedTiles(room, view);
  trackGameMotions(room, view);
  const previousPlayer = room?.game?.currentPlayerId;
  const previousPending = room?.game?.turn?.pending?.kind;
  if (room?.code !== view.code) placementIndex = null;
  room = view;
  if (selectedTileId && !myPlayer()?.hand?.some(tile => tile.id === selectedTileId)) selectedTileId = null;
  if (previousPlayer !== room.game?.currentPlayerId || !myTurn()) {
    selectedTileId = null;
    lastPlacedIndex = null;
    mode = 'move';
  }
  if (previousPending !== room.game?.turn?.pending?.kind || !room.game?.turn?.pending) powerIndex = null;
  if (room.game?.turn?.placed && !room.game?.turn?.pending) {
    selectedTileId = null;
    mode = 'move';
  }
  if (placementIndex !== null && placementRotationAt(placementIndex) === null) placementIndex = null;
  const legal = room.game?.legal;
  if (myTurn() && !room.game.turn?.pending && !room.game.turn?.placed && !(legal?.placements || []).length && (legal?.removals || []).length) mode = 'remove';
  render();
}

function persistSession(result) {
  session = cloudMode
    ? { mode: 'supabase', code: result.code, playerId: result.playerId || result.view?.you }
    : { code: result.code, token: result.token, playerId: result.playerId };
  writeStorage(`labirynt-session-${result.code}`, JSON.stringify(session));
  writeStorage('labirynt-current', JSON.stringify(session));
  writeStorage('labirynt-current', JSON.stringify(session), true);
  history.replaceState({}, '', `${appBase.pathname}?room=${encodeURIComponent(result.code)}`);
}

async function submitRoom(form) {
  if (busy) return;
  const data = new FormData(form);
  const name = String(data.get('name') || '').trim();
  const code = String(data.get('code') || '').trim().toUpperCase();
  if (!name) {
    formError = 'Wpisz swoje imię.';
    render();
    return;
  }
  rememberedName = name;
  inviteCode = code;
  writeStorage('labirynt-name', name);
  formError = '';
  busy = true;
  render();
  try {
    const result = await api(formMode === 'create' ? '/api/rooms' : `/api/rooms/${encodeURIComponent(code)}/join`, { method: 'POST', body: JSON.stringify({ name }) });
    persistSession(result);
    busy = false;
    acceptView(result.view);
    connectEvents();
  } catch (error) {
    busy = false;
    formError = error.message === 'Failed to fetch' ? 'Nie można połączyć się z serwerem. Sprawdź połączenie i spróbuj ponownie.' : error.message;
    render();
  }
}

async function performAction(action) {
  if (busy || !session || !myTurn()) return;
  busy = true;
  render();
  try {
    const view = await api(`/api/rooms/${session.code}/actions`, { method: 'POST', body: JSON.stringify({ action, revision: room.revision }) });
    busy = false;
    if (action.type === 'place') lastPlacedIndex = action.index;
    if (action.type === 'place' || action.type === 'move' || action.type === 'ability') selectedTileId = null;
    powerIndex = null;
    acceptView(view);
  } catch (error) {
    busy = false;
    if (error.status === 409) {
      try { acceptView(await api(`/api/rooms/${session.code}`)); } catch {}
    }
    notify(error.message === 'Failed to fetch' ? 'Połączenie zostało przerwane. Stan gry zostanie odświeżony po połączeniu.' : error.message, true);
    render();
  }
}

async function startGame() {
  if (busy) return;
  busy = true;
  render();
  try {
    const view = await api(`/api/rooms/${session.code}/start`, { method: 'POST', body: '{}' });
    busy = false;
    acceptView(view);
  } catch (error) {
    busy = false;
    notify(error.message, true);
    render();
  }
}

async function updateBots(remove = false) {
  if (busy || !session || room?.status !== 'lobby' || room.hostId !== room.you) return;
  const count = 4 - room.players.length;
  if (!remove && count <= 0) return;
  busy = true;
  render();
  try {
    const view = await api(`/api/rooms/${session.code}/bots`, { method: remove ? 'DELETE' : 'POST', body: JSON.stringify(remove ? {} : { count }) });
    busy = false;
    acceptView(view);
    notify(remove ? 'Boty opuściły pokój. Możesz zaprosić znajomych.' : 'Wolne ogródki zajęły boty. Możesz rozpocząć grę.');
  } catch (error) {
    busy = false;
    notify(error.message === 'Failed to fetch' ? 'Nie można połączyć się z serwerem. Spróbuj ponownie.' : error.message, true);
    render();
  }
}

async function chooseColor(color) {
  if (busy || !session || room?.status !== 'lobby' || !Object.hasOwn(colors, color)) return;
  if (room.players.some(player => player.color === color)) return;
  busy = true;
  render();
  try {
    const view = await api(`/api/rooms/${session.code}/color`, { method: 'POST', body: JSON.stringify({ color }) });
    busy = false;
    acceptView(view);
  } catch (error) {
    busy = false;
    if (error.status === 409) {
      try { acceptView(await api(`/api/rooms/${session.code}`)); } catch {}
    }
    notify(error.message === 'Failed to fetch' ? 'Nie można połączyć się z serwerem. Spróbuj ponownie.' : error.message, true);
    render();
  }
}

async function copyInvite() {
  const link = new URL(`?room=${encodeURIComponent(room.code)}`, appBase).href;
  try {
    await navigator.clipboard.writeText(link);
    notify('Link skopiowany. Wyślij go pozostałym działkowcom.');
  } catch {
    const input = document.createElement('textarea');
    input.value = link;
    input.setAttribute('aria-label', 'Link zaproszenia');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.append(input);
    input.select();
    const copied = document.execCommand('copy');
    input.remove();
    notify(copied ? 'Link skopiowany. Wyślij go pozostałym działkowcom.' : `Kod pokoju: ${room.code}. Link do zaproszenia znajduje się w pasku adresu.`);
  }
}

async function connectEvents() {
  streamController?.abort();
  stopCloudEvents?.();
  stopCloudEvents = null;
  const serial = ++streamSerial;
  if (cloudMode) {
    const currentSession = session;
    if (!currentSession) return;
    setConnection('Łączenie…', false);
    try {
      const transport = await cloudTransport();
      if (serial !== streamSerial || session?.code !== currentSession.code) return;
      stopCloudEvents = transport.subscribe(currentSession.code, {
        onView(view) { if (serial === streamSerial && session?.code === currentSession.code) acceptView(view); },
        onStatus(text, online) { if (serial === streamSerial) setConnection(text, online); },
        onError(error) {
          if (serial === streamSerial && [401, 403, 404].includes(error.status)) setConnection('Odśwież stronę, aby odzyskać połączenie.', false);
        },
      });
    } catch {
      if (serial === streamSerial) setConnection('Nie można połączyć z serwerem. Odśwież stronę.', false);
    }
    return;
  }
  let delay = 700;
  while (session && serial === streamSerial) {
    const currentSession = session;
    streamController = new AbortController();
    setConnection('Łączenie…', false);
    try {
      const response = await fetch(`/api/rooms/${currentSession.code}/events`, { headers: { Authorization: `Bearer ${currentSession.token}` }, signal: streamController.signal, cache: 'no-store' });
      if (!response.ok || !response.body) throw new Error('Połączenie niedostępne');
      setConnection('Połączono · na żywo');
      delay = 700;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (serial === streamSerial) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
          if (data) {
            try {
              const payload = JSON.parse(data);
              if (serial === streamSerial && session?.code === currentSession.code) acceptView(payload.view || payload);
            } catch {}
          }
        }
      }
    } catch (error) {
      if (error.name === 'AbortError' && serial !== streamSerial) return;
    }
    if (serial !== streamSerial || !session) return;
    setConnection('Ponowne łączenie…', false);
    await new Promise(resolve => setTimeout(resolve, delay));
    delay = Math.min(delay * 1.8, 10000);
  }
}

function home() {
  clearForgottenTiles();
  clearPlacedTiles();
  clearTileRotations();
  clearGameMotions();
  placementIndex = null;
  previewContext = null;
  streamSerial++;
  streamController?.abort();
  stopCloudEvents?.();
  stopCloudEvents = null;
  session = null;
  room = null;
  selectedTileId = null;
  powerIndex = null;
  lastPlacedIndex = null;
  mode = 'move';
  busy = false;
  formError = '';
  inviteCode = '';
  formMode = 'create';
  removeStorage('labirynt-current');
  removeStorage('labirynt-current', true);
  history.replaceState({}, '', appBase.pathname);
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function rotateTile(direction = 1) {
  const options = placementRotationsAt(placementIndex);
  if (options.length < 2) return;
  const current = placementIndex === null ? rotation : placementRotationAt(placementIndex);
  for (let step = 1; step <= 4; step++) {
    const candidate = (current + direction * step + 4) % 4;
    if (options.includes(candidate)) {
      rotation = candidate;
      render();
      return;
    }
  }
}

function setPlacementTarget(event) {
  if (rendering) return;
  const cell = event.target.closest?.('[data-cell]');
  if (!cell && event.type === 'focusin') return;
  const index = cell ? Number(cell.dataset.cell) : null;
  placementIndex = index !== null && placementRotationAt(index) !== null ? index : null;
}

function clearPlacementTarget(event) {
  if (rendering) return;
  const cell = event.target.closest?.('[data-cell]');
  if (!cell || cell.isConnected === false || event.relatedTarget?.closest?.('[data-cell]')?.dataset.cell === cell.dataset.cell) return;
  if (placementIndex === Number(cell.dataset.cell)) placementIndex = null;
}

main.addEventListener('pointerover', setPlacementTarget);
main.addEventListener('pointerout', clearPlacementTarget);
main.addEventListener('focusin', setPlacementTarget);
main.addEventListener('focusout', clearPlacementTarget);
main.addEventListener('wheel', event => {
  if (event.ctrlKey || event.metaKey || !event.deltaY) return;
  const cell = event.target.closest?.('[data-cell]');
  if (!cell || placementRotationsAt(Number(cell.dataset.cell)).length < 2) return;
  event.preventDefault();
  placementIndex = Number(cell.dataset.cell);
  const now = performance.now();
  if (now - lastWheelRotationAt < 160) return;
  lastWheelRotationAt = now;
  rotateTile(Math.sign(event.deltaY));
}, { passive: false });

function rotatePower() {
  if (powerIndex === null || busy) return;
  const options = (room.game.legal?.rotations || []).filter(item => item.index === powerIndex).map(item => item.rotation);
  if (!options.length) return;
  powerRotation = options[(options.indexOf(powerRotation) + 1) % options.length];
  render();
}

function showRules() {
  const inlineRules = !room && main.querySelector('#landing-rules');
  if (inlineRules) {
    inlineRules.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'start' });
    inlineRules.focus({ preventScroll: true });
  } else rulesDialog.showModal();
}

document.querySelector('#rules-open').addEventListener('click', showRules);
document.querySelector('[data-close-dialog]').addEventListener('click', () => rulesDialog.close());
rulesDialog.addEventListener('click', event => {
  if (event.target === rulesDialog) {
    const bounds = rulesDialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) rulesDialog.close();
  }
});

main.addEventListener('submit', event => {
  if (event.target.id === 'room-form') {
    event.preventDefault();
    submitRoom(event.target);
  }
});

main.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  if (button.hasAttribute('data-rules')) return showRules();
  if (button.hasAttribute('data-home')) return home();
  if (button.hasAttribute('data-share')) return void copyInvite();
  if (button.id === 'start-game') return void startGame();
  if (button.dataset.bots) return void updateBots(button.dataset.bots === 'remove');
  if (button.dataset.colorChoice) return void chooseColor(button.dataset.colorChoice);
  if (button.hasAttribute('data-new-tile')) return void performAction({ type: 'move', index: Number(button.dataset.newTile) });
  if (button.dataset.formMode) {
    rememberedName = main.querySelector('#player-name')?.value || rememberedName;
    inviteCode = main.querySelector('#room-input')?.value || inviteCode;
    formMode = button.dataset.formMode;
    formError = '';
    render();
    return;
  }
  if (button.dataset.mode) {
    placementIndex = null;
    mode = button.dataset.mode;
    if (mode === 'place' && !(room.game.legal?.placements || []).length && (room.game.legal?.removals || []).length) mode = 'remove';
    selectedTileId = null;
    render();
    if (mode === 'place') main.querySelector('.hand-tile:not(:disabled)')?.focus();
    return;
  }
  if (button.hasAttribute('data-tile')) {
    placementIndex = null;
    const id = button.dataset.tile;
    if (room.game.turn?.pending?.kind === 'discard') return void performAction({ type: 'discard', tileId: id });
    if (selectedTileId === id) {
      selectedTileId = null;
      mode = 'move';
    } else {
      selectedTileId = id;
      rotation = myPlayer().hand.find(tile => tile.id === id)?.rotation || 0;
      mode = 'place';
    }
    render();
    return;
  }
  if (button.hasAttribute('data-rotate')) return rotateTile();
  if (button.hasAttribute('data-power-rotate')) return rotatePower();
  if (button.hasAttribute('data-confirm-power')) return void performAction({ type: 'ability', index: powerIndex, rotation: powerRotation });
  if (button.dataset.action) return void performAction({ type: button.dataset.action });
  if (button.hasAttribute('data-cell')) {
    const index = Number(button.dataset.cell);
    const action = boardActionAt(index);
    const placementAnimation = placedTileAnimation(index);
    if (action === 'move' || action === 'remove') return void performAction({ type: action, index });
    if (action === 'place') return void performAction({ type: 'place', index, tileId: selectedTileId, rotation: placementRotationAt(index) });
    if (action === 'prune') return void performAction({ type: 'ability', index });
    if (action === 'rotate') {
      powerIndex = index;
      powerRotation = (room.game.legal.rotations || []).find(item => item.index === index).rotation;
      render();
    }
  }
});

document.addEventListener('keydown', event => {
  if (event.target.closest('input, textarea, select') || rulesDialog.open || event.ctrlKey || event.altKey || event.metaKey) return;
  if (event.key.toLowerCase() === 'r' && !event.repeat) {
    if (selectedTileId || powerIndex !== null) event.preventDefault();
    const cell = event.target.closest?.('[data-cell]');
    if (placementIndex === null && cell && placementRotationAt(Number(cell.dataset.cell)) !== null) placementIndex = Number(cell.dataset.cell);
    if (powerIndex !== null) rotatePower();
    else rotateTile();
  }
  if (event.key === 'Escape' && selectedTileId) {
    placementIndex = null;
    selectedTileId = null;
    mode = 'move';
    render();
  }
});

async function initialize() {
  let saved;
  try {
    const savedText = inviteCode ? readStorage(`labirynt-session-${inviteCode}`) : readStorage('labirynt-current', true) || readStorage('labirynt-current');
    saved = savedText ? JSON.parse(savedText) : null;
  } catch {}
  const validSaved = saved?.code && (cloudMode ? saved.mode === 'supabase' : saved.token && saved.mode !== 'supabase');
  const restoreCode = validSaved ? saved.code : cloudMode && inviteCode ? inviteCode : null;
  if (restoreCode) {
    session = validSaved ? saved : { mode: 'supabase', code: restoreCode };
    main.innerHTML = '<div class="restoring"><div class="loading-dot"></div><p>Wracamy do ogródków.</p><span>Odtwarzanie Twojego miejsca przy stole…</span></div>';
    setConnection('Odtwarzanie sesji…', false);
    try {
      const view = await api(`/api/rooms/${encodeURIComponent(restoreCode)}`);
      persistSession({ ...session, playerId: view.you });
      acceptView(view);
      connectEvents();
      return;
    } catch (error) {
      session = null;
      if (error.status === 401 || error.status === 404 || error.status === 403) {
        removeStorage(`labirynt-session-${restoreCode}`);
        removeStorage('labirynt-current');
        removeStorage('labirynt-current', true);
      }
      formError = cloudMode && !validSaved && error.status === 403 ? '' : error.status === 404 ? 'Ten pokój nie jest już dostępny. Możesz rozpocząć nową grę.' : error.status === 401 || error.status === 403 ? 'Nie udało się odzyskać miejsca. Dołącz ponownie do pokoju.' : 'Nie można połączyć się z serwerem. Twoje miejsce jest zapisane; odśwież stronę, gdy połączenie wróci.';
    }
  }
  render();
}

initialize();
