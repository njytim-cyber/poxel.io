import * as THREE from 'three';
import { worldGroup, updateWorld, chunkCount, biomeAt, getBlock, setBlock, loadAreaNow, surfaceHeight, benchmarkWorld, resetWorld, workerStatus, raycast } from './world';
import { setupInput, isMobile, actions, releaseAllKeys, keys } from './input';
import { initPlayer, updatePlayer, controls, updateLocalLook, body, handScene, handCamera, headInWater, headInLava,
  isDead, health, MAX_HEALTH, setYawPitch, setPlayerFeet, getYawPitch } from './player';
import { applyHairGeometry, addBigEyes, savedLook } from './avatar';
import { initInventory, inventory, setSelectedSlot } from './inventory';
import { getSaveMeta, readSave, writeSave, SP_NAME } from './saves';
import { initRemote, updateRemote, entityCounts } from './remote';
import { initSky, updateSky, getDaylight, getTimeOfDay } from './sky';
import { preloadIcons } from './textures';
import { onServerMessage, onNetStatus, startLocal, startRemote, send, disconnect, requestLocalSave, setLocalPaused, isMultiplayer, type LocalSave } from './net';
import { handleServerMessage, onReady, resetSession, markPingSent, pingMs, onlinePlayers } from './session';
import * as ui from './ui';

// ------------------------------------------------------------------ Storage (blocked/full storage must not break the game)
const store = {
  get(k: string): string | null { try { return store.get(k); } catch { return null; } },
  set(k: string, v: string) { try { store.set(k, v); } catch { /* full or blocked: settings just aren't remembered */ } },
  remove(k: string) { try { store.remove(k); } catch { /* ignore */ } },
};

// ------------------------------------------------------------------ Crash protection
let lastErrorShown = 0;
function reportError(err: unknown) {
  console.error(err);
  const msg = err instanceof Error ? err.message : String(err);
  if (/pointer ?lock/i.test(msg)) return; // browsers reject re-locking right after Esc; harmless
  if (performance.now() - lastErrorShown > 5000) {
    lastErrorShown = performance.now();
    ui.showError(`Something went wrong (the game kept running): ${msg}`);
  }
}
window.addEventListener('error', e => reportError(e.error || e.message));
window.addEventListener('unhandledrejection', e => reportError(e.reason));

// ------------------------------------------------------------------ Renderer & scene
const scene = new THREE.Scene();
const perspectiveCamera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 1000);

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1 : 1.5));
document.body.appendChild(renderer.domElement);

const ambientLight = new THREE.AmbientLight(0xffffff, 1);
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
scene.add(directionalLight);

scene.add(worldGroup);
initSky(scene, ambientLight, directionalLight);
setupInput();
initRemote(scene);
initPlayer(perspectiveCamera, scene);
initInventory();
preloadIcons();
// Background world behind the main menu (no server needed just to look at it)
resetWorld(1337);
loadAreaNow(0, 0, 1);
setPlayerFeet({ x: 0.5, y: surfaceHeight(0, 0) + 1, z: 0.5 });
ui.renderHealth(MAX_HEALTH, MAX_HEALTH);

window.addEventListener('resize', onWindowResize, false);
function onWindowResize() {
  perspectiveCamera.aspect = window.innerWidth / window.innerHeight;
  perspectiveCamera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  const shopPreview = document.querySelector('.shop-preview');
  if (shopPreview) {
    const rect = shopPreview.getBoundingClientRect();
    if (rect.width > 0) {
      shopCamera.aspect = rect.width / rect.height;
      shopCamera.updateProjectionMatrix();
      shopRenderer.setSize(rect.width, rect.height);
    }
  }
}

// ------------------------------------------------------------------ Menus

const mainMenu = document.getElementById('main-menu');
const menuMainScreen = document.getElementById('menu-screen-main');
const menuLoadScreen = document.getElementById('save-slots-container');
const menuShopScreen = document.getElementById('shop-screen');

// Shop Scene Setup
const shopCanvas = document.getElementById('shop-canvas') as HTMLCanvasElement;
const shopScene = new THREE.Scene();
export const shopCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
shopCamera.position.set(0, 0, 4);
export const shopRenderer = new THREE.WebGLRenderer({ canvas: shopCanvas, alpha: true, antialias: true });
shopRenderer.setPixelRatio(window.devicePixelRatio);
shopScene.add(new THREE.AmbientLight(0xffffff, 1.6));
const shopDirLight = new THREE.DirectionalLight(0xffffff, 1.2);
shopDirLight.position.set(5, 10, 5);
shopScene.add(shopDirLight);

const shopAvatar = new THREE.Group();
const shopMatSkin = new THREE.MeshLambertMaterial({ color: store.get('poxel_skin') || '#ffcc99' });
const shopMatShirt = new THREE.MeshLambertMaterial({ color: store.get('poxel_shirt') || '#00aaff' });
const shopMatPants = new THREE.MeshLambertMaterial({ color: store.get('poxel_pants') || '#0000aa' });
const shopMatHair = new THREE.MeshLambertMaterial({ color: store.get('poxel_hair') || '#6b4423' });
const shopEyeMat = new THREE.MeshBasicMaterial({ color: store.get('poxel_eye') || '#000000' });
let currentHairStyle = parseInt(store.get('poxel_style') || '0');

const shopHead = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), shopMatSkin);
shopHead.position.y = 0.5;
const shopHair = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.1, 0.52), shopMatHair);
applyHairGeometry(currentHairStyle, shopHair);
shopHead.add(shopHair);
addBigEyes(shopHead, shopEyeMat);
shopAvatar.add(shopHead);
const shopBody = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.75, 0.25), shopMatShirt);
shopBody.position.y = -0.125;
shopAvatar.add(shopBody);
for (const x of [-0.31, 0.31]) {
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.75, 0.18), shopMatSkin);
  arm.position.set(x, -0.125, 0);
  shopAvatar.add(arm);
}
for (const x of [-0.11, 0.11]) {
  const leg = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.75, 0.22), shopMatPants);
  leg.position.set(x, -0.875, 0);
  shopAvatar.add(leg);
}
shopAvatar.position.y = 0.25;
shopAvatar.rotation.y = Math.PI; // face the camera
shopScene.add(shopAvatar);

let activeSuperCosmetic = store.get('poxel_super') || 'none';

function buildCosmetics(headAnchor: THREE.Mesh, bodyAnchor: THREE.Mesh) {
  const tophat = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.4), new THREE.MeshLambertMaterial({ color: 0x111111 }));
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.05), new THREE.MeshLambertMaterial({ color: 0x111111 }));
  brim.position.y = -0.2; tophat.add(brim);
  tophat.position.y = 0.45;
  headAnchor.add(tophat);
  const backpack = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.15), new THREE.MeshLambertMaterial({ color: 0xaa2222 }));
  backpack.position.set(0, 0, 0.2);
  bodyAnchor.add(backpack);
  const ninja = new THREE.Mesh(new THREE.BoxGeometry(0.51, 0.51, 0.51), new THREE.MeshLambertMaterial({ color: 0x111111 }));
  const eyeSlit = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.52), new THREE.MeshLambertMaterial({ color: 0xffcc99 }));
  eyeSlit.position.set(0, 0.1, 0);
  ninja.add(eyeSlit);
  headAnchor.add(ninja);
  return { tophat, backpack, ninja };
}
const shopCosmetics = buildCosmetics(shopHead, shopBody);
function applySuperCosmetic(id: string, c: typeof shopCosmetics) {
  c.tophat.visible = id === 'tophat';
  c.backpack.visible = id === 'backpack';
  c.ninja.visible = id === 'ninja';
}
applySuperCosmetic(activeSuperCosmetic, shopCosmetics);

let isShopDrag = false, shopPX = 0, shopPY = 0;
const previewBox = document.querySelector('.shop-preview') as HTMLElement;
if (previewBox) {
  previewBox.addEventListener('mousedown', e => { isShopDrag = true; shopPX = e.clientX; shopPY = e.clientY; });
  window.addEventListener('mouseup', () => (isShopDrag = false));
  window.addEventListener('mousemove', e => {
    if (!isShopDrag) return;
    shopAvatar.rotation.y += (e.clientX - shopPX) * 0.01;
    shopAvatar.rotation.x = Math.max(-0.5, Math.min(0.5, shopAvatar.rotation.x + (e.clientY - shopPY) * 0.01));
    shopPX = e.clientX; shopPY = e.clientY;
  });
}

let currentSkin = shopMatSkin.color.getHexString();
let currentShirt = shopMatShirt.color.getHexString();
let currentPants = shopMatPants.color.getHexString();
let currentHairHex = shopMatHair.color.getHexString();
let currentEyeColorState = shopEyeMat.color.getHexString();

const swatchesSkin = ['#ffcc99', '#f2d3ab', '#e0ac69', '#c68642', '#8d5524', '#3d2c23'];
const swatchesShirt = ['#00aaff', '#33cc33', '#ff3333', '#ffff33', '#ff9900', '#aa00aa', '#ffffff', '#111111', '#555555'];
const swatchesPants = ['#0000aa', '#00aa00', '#aa0000', '#aaaa00', '#222222', '#666666', '#ffffff', '#0055ff'];
const swatchesHair = ['#6b4423', '#111111', '#ddbb55', '#cc3333', '#aa5500', '#3333cc', '#e6e6fa', '#ffffff'];
const swatchesEye = ['#000000', '#0055ff', '#00aa00', '#8d5524', '#aa0000', '#aa00aa', '#ffffff'];

function populateGrid(id: string, colors: string[], type: 'skin' | 'shirt' | 'pants' | 'hair' | 'eye') {
  const grid = document.getElementById(id);
  if (!grid) return;
  grid.innerHTML = '';
  colors.forEach(col => {
    const sw = document.createElement('div');
    sw.className = 'color-swatch';
    sw.style.backgroundColor = col;
    const curHex = '#' + (type === 'skin' ? currentSkin : type === 'shirt' ? currentShirt : type === 'pants' ? currentPants : type === 'hair' ? currentHairHex : currentEyeColorState);
    if (col.toLowerCase() === curHex.toLowerCase()) sw.classList.add('selected');
    sw.addEventListener('click', () => {
      Array.from(grid.children).forEach(c => c.classList.remove('selected'));
      sw.classList.add('selected');
      if (type === 'skin') { currentSkin = col.slice(1); shopMatSkin.color.set(col); }
      if (type === 'shirt') { currentShirt = col.slice(1); shopMatShirt.color.set(col); }
      if (type === 'pants') { currentPants = col.slice(1); shopMatPants.color.set(col); }
      if (type === 'hair') { currentHairHex = col.slice(1); shopMatHair.color.set(col); }
      if (type === 'eye') { currentEyeColorState = col.slice(1); shopEyeMat.color.set(col); }
    });
    grid.appendChild(sw);
  });
}
populateGrid('grid-skin', swatchesSkin, 'skin');
populateGrid('grid-shirt', swatchesShirt, 'shirt');
populateGrid('grid-pants', swatchesPants, 'pants');
populateGrid('grid-hair', swatchesHair, 'hair');
populateGrid('grid-eyes', swatchesEye, 'eye');

const superItems = [
  { id: 'none', name: 'Remove Set', rarity: 'common', unlockMin: 0 },
  { id: 'tophat', name: 'Mayor Set', rarity: 'rare', unlockMin: 5, shirt: '#111111', pants: '#222222' },
  { id: 'backpack', name: 'Explorer Set', rarity: 'epic', unlockMin: 10, shirt: '#8d5524', pants: '#556b2f' },
  { id: 'ninja', name: 'Ninja Set', rarity: 'legendary', unlockMin: 15, shirt: '#111111', pants: '#111111', skin: '#f2d3ab' },
];

let playTimeSeconds = parseInt(store.get('poxel_playtime') || '0');
setInterval(() => {
  if (ui.isPlaying()) {
    playTimeSeconds++;
    if (playTimeSeconds % 10 === 0) store.set('poxel_playtime', playTimeSeconds.toString());
  }
}, 1000);

function populateSuperGrid() {
  const grid = document.getElementById('grid-super');
  if (!grid) return;
  grid.innerHTML = '';
  superItems.forEach(item => {
    const card = document.createElement('div');
    card.className = `super-item-card rarity-${item.rarity}`;
    if (activeSuperCosmetic === item.id) card.classList.add('selected');
    const unlocked = playTimeSeconds >= item.unlockMin * 60;
    const emoji = item.id === 'tophat' ? '🎩' : item.id === 'backpack' ? '🎒' : item.id === 'ninja' ? '🥷' : '❌';
    if (unlocked) {
      card.innerHTML = `<div style="font-size:50px; margin-bottom:10px;">${emoji}</div><div class="item-name">${item.name}</div>`;
      card.addEventListener('click', () => {
        Array.from(grid.children).forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        activeSuperCosmetic = item.id;
        applySuperCosmetic(activeSuperCosmetic, shopCosmetics);
        const it = item as any;
        if (it.shirt) { currentShirt = it.shirt.slice(1); shopMatShirt.color.set(it.shirt); }
        if (it.pants) { currentPants = it.pants.slice(1); shopMatPants.color.set(it.pants); }
        if (it.skin) { currentSkin = it.skin.slice(1); shopMatSkin.color.set(it.skin); }
      });
    } else {
      card.style.opacity = '0.5';
      const progressMin = Math.floor(playTimeSeconds / 60);
      card.innerHTML = `<div style="font-size:40px; margin-bottom:5px;">🔒</div><div style="font-size:14px; font-weight:bold;">Play ${item.unlockMin}m</div><div class="item-name">${progressMin}/${item.unlockMin}m</div>`;
    }
    grid.appendChild(card);
  });
}

const styleBtns = document.querySelectorAll('#grid-hair-style .shop-tab');
styleBtns.forEach(btn => {
  const styleId = parseInt((btn as HTMLElement).dataset.style || '-1');
  if (styleId === currentHairStyle) { styleBtns.forEach(b => b.classList.remove('active')); btn.classList.add('active'); }
  btn.addEventListener('click', () => {
    styleBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentHairStyle = styleId;
    applyHairGeometry(currentHairStyle, shopHair);
  });
});

const tabs = document.querySelectorAll('.shop-tabs .shop-tab');
const tabContents = document.querySelectorAll('.shop-tab-content');
tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    tabs.forEach(t => t.classList.remove('active'));
    tabContents.forEach(tc => tc.classList.remove('active'));
    tab.classList.add('active');
    const target = (tab as HTMLElement).dataset.tab;
    document.getElementById(`tab-${target}`)?.classList.add('active');
    const shopScreen = document.getElementById('shop-screen');
    if (shopScreen) {
      shopScreen.classList.toggle('super-mode', target === 'super');
      let ticks = 0;
      const resizeInt = setInterval(() => { onWindowResize(); if (++ticks > 15) clearInterval(resizeInt); }, 35);
    }
  });
});

const saveButtons = document.querySelectorAll('.save-slot');
function refreshSaveLabels() {
  saveButtons.forEach(btn => {
    const slot = parseInt((btn as HTMLElement).dataset.slot!);
    const meta = getSaveMeta(slot);
    btn.innerHTML = meta ? `Save ${slot + 1}<br><span style="font-size:12px;color:#ccc">${meta}</span>` : `Empty Slot ${slot + 1}`;
    // Delete button beside each used slot; first click arms it, second click deletes
    let del = btn.nextElementSibling as HTMLButtonElement | null;
    if (!del || !del.classList.contains('delete-save')) {
      const row = document.createElement('div');
      row.className = 'save-row';
      btn.parentElement!.insertBefore(row, btn);
      row.appendChild(btn);
      del = document.createElement('button');
      del.className = 'menu-btn delete-save';
      del.title = 'Delete this save';
      row.appendChild(del);
      const d = del;
      d.addEventListener('click', e => {
        e.stopPropagation();
        if (!d.classList.contains('armed')) {
          d.classList.add('armed');
          d.textContent = 'Sure?';
          setTimeout(() => { d.classList.remove('armed'); d.textContent = '🗑'; }, 3000);
          return;
        }
        store.remove(`poxel_save_${slot}`);
        store.remove(`poxel_meta_${slot}`);
        refreshSaveLabels();
      });
    }
    del.textContent = '🗑';
    del.classList.remove('armed');
    del.style.visibility = meta ? 'visible' : 'hidden';
  });
}
refreshSaveLabels();

function showMenuScreen(which: 'main' | 'load' | 'shop' | 'mp') {
  if (menuMainScreen) menuMainScreen.style.display = which === 'main' ? 'flex' : 'none';
  if (menuLoadScreen) menuLoadScreen.style.display = which === 'load' ? 'flex' : 'none';
  if (menuShopScreen) menuShopScreen.style.display = which === 'shop' ? 'flex' : 'none';
  const mp = document.getElementById('mp-screen');
  if (mp) mp.style.display = which === 'mp' ? 'flex' : 'none';
}

function firstFreeSlot(): number {
  for (let i = 0; i < 5; i++) if (!getSaveMeta(i)) return i;
  return -1;
}

document.getElementById('btn-open-load')?.addEventListener('click', () => { refreshSaveLabels(); showMenuScreen('load'); });
document.getElementById('btn-back-load')?.addEventListener('click', () => showMenuScreen('main'));
document.getElementById('btn-shop')?.addEventListener('click', () => {
  populateSuperGrid();
  showMenuScreen('shop');
  setTimeout(onWindowResize, 10);
});
document.getElementById('btn-save-shop')?.addEventListener('click', () => {
  store.set('poxel_skin', '#' + currentSkin);
  store.set('poxel_shirt', '#' + currentShirt);
  store.set('poxel_pants', '#' + currentPants);
  store.set('poxel_hair', '#' + currentHairHex);
  store.set('poxel_eye', '#' + currentEyeColorState);
  store.set('poxel_style', currentHairStyle.toString());
  store.set('poxel_super', activeSuperCosmetic);
  updateLocalLook(savedLook());
  showMenuScreen('main');
});

// ------------------------------------------------------------------ Starting a game

let currentSaveSlot = -1;
let mode: 'none' | 'single' | 'multi' = 'none';
let lastSaveOk = true;

onServerMessage(handleServerMessage);
onReady(() => {
  const mainMenu = document.getElementById('main-menu');
  if (mainMenu) mainMenu.style.display = 'none';
  releaseAllKeys();
  if (isMobile) {
    try {
      const el = document.documentElement as any;
      if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    } catch { /* ignore */ }
    try { (screen.orientation as any).lock('landscape').catch(() => {}); } catch { /* ignore */ }
  }
  ui.startPlaying();
});

ui.setPauseHandler(paused => { if (mode === 'single') setLocalPaused(paused); });

function startSingle(slot: number, save: LocalSave | null, fixedSeed?: number) {
  currentSaveSlot = slot;
  mode = 'single';
  resetSession();
  const seed = save?.world ? undefined : fixedSeed ?? (Math.random() * 2 ** 31) | 0;
  startLocal(save || { world: null, players: {} }, seed, SP_NAME, savedLook(), s => {
    lastSaveOk = writeSave(slot, s);
    ui.setConnectionBanner(lastSaveOk ? '' : 'Could not save: browser storage is full. Delete an old save from the Load menu.');
  });
}

document.getElementById('btn-new-game')?.addEventListener('click', () => {
  const slot = firstFreeSlot();
  if (slot < 0) {
    // All slots used: never overwrite a save silently
    refreshSaveLabels();
    showMenuScreen('load');
    const title = document.querySelector('#save-slots-container h2');
    if (title) title.textContent = 'All save slots are full. Delete one (🗑) or pick a save to continue.';
    return;
  }
  startSingle(slot, null);
});

saveButtons.forEach(btn => {
  btn.addEventListener('click', e => {
    const slot = parseInt((e.currentTarget as HTMLElement).dataset.slot!);
    startSingle(slot, readSave(slot));
  });
});

// Multiplayer menu
// A random secret kept in this browser: proves you own your player name on a server
function playerToken(): string {
  let t = store.get('poxel_token');
  if (!t) {
    t = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
    store.set('poxel_token', t);
  }
  return t;
}
const mpName = document.getElementById('mp-name') as HTMLInputElement | null;
const mpUrl = document.getElementById('mp-url') as HTMLInputElement | null;
const mpStatus = document.getElementById('mp-status');
// When the page is served by the game server itself (e.g. through a Cloudflare tunnel), join that server
const servedByGameServer = location.port !== '5173' && !location.hostname.endsWith('github.io');
const defaultServer = servedByGameServer ? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`
  : (import.meta as any).env?.VITE_SERVER_URL || (location.hostname === 'localhost' ? 'ws://localhost:8080' : '');
if (mpName) mpName.value = store.get('poxel_name') || `Player${Math.floor(Math.random() * 900 + 100)}`;
if (mpUrl) mpUrl.value = servedByGameServer ? defaultServer : store.get('poxel_server') || defaultServer;

const mpButton = document.getElementById('btn-multiplayer') as HTMLButtonElement | null;
mpButton?.addEventListener('click', () => showMenuScreen('mp'));
document.getElementById('btn-back-mp')?.addEventListener('click', () => showMenuScreen('main'));
document.getElementById('btn-connect')?.addEventListener('click', () => {
  let url = (mpUrl?.value || '').trim();
  const name = (mpName?.value || '').trim().replace(/[^A-Za-z0-9_]/g, '').slice(0, 16) || 'Player';
  if (!url) { if (mpStatus) mpStatus.textContent = 'Enter the server address your host gave you.'; return; }
  // Accept pasted https:// tunnel links and bare hosts
  url = url.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://');
  if (!/^wss?:\/\//.test(url)) url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + url;
  store.set('poxel_name', name);
  store.set('poxel_server', url);
  if (mpName) mpName.value = name;
  if (mpStatus) mpStatus.textContent = 'Connecting...';
  mode = 'multi';
  currentSaveSlot = -1;
  resetSession();
  startRemote(url, name, savedLook(), playerToken());
});

onNetStatus((status, detail) => {
  if (status === 'online') ui.setConnectionBanner('');
  else if (status === 'reconnecting') ui.setConnectionBanner(detail || 'Reconnecting...');
  else if (status === 'offline') {
    ui.setConnectionBanner(detail || 'Disconnected');
    if (mpStatus && ui.state === 'menu') mpStatus.textContent = detail || 'Disconnected';
  }
});

// Returns true when the world is safely stored (always true in multiplayer: the server saves)
async function saveNow(): Promise<boolean> {
  if (mode !== 'single' || currentSaveSlot === -1) return true;
  const s = await requestLocalSave();
  return !!s && lastSaveOk;
}

let quitAnyway = false;
document.getElementById('btn-save-quit')?.addEventListener('click', async () => {
  const btn = document.getElementById('btn-save-quit') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = mode === 'single' ? 'Saving...' : 'Leaving...';
  const ok = quitAnyway || await saveNow();
  if (!ok) {
    // Don't throw away progress: stay in the game and explain
    btn.disabled = false;
    btn.textContent = 'Quit WITHOUT saving';
    quitAnyway = true;
    ui.setConnectionBanner('Saving failed (browser storage full?). Delete an old save, or press the button again to quit without saving.');
    return;
  }
  disconnect();
  location.reload();
});

// The local server also saves by itself every 10s when something changed (see serverWorker.ts)
document.addEventListener('visibilitychange', () => { if (document.hidden && ui.state !== 'menu') saveNow(); });

// Ping the server now and then (shown in F3, and keeps idle connections alive through proxies)
setInterval(() => {
  if (!isMultiplayer()) return;
  const ts = performance.now();
  markPingSent(ts);
  send({ t: 'ping', ts });
}, 5000);

const debugEl = document.getElementById('debug');
let debugVisible = false;
actions.toggleDebug = () => { debugVisible = !debugVisible; if (debugEl) debugEl.style.display = debugVisible ? 'block' : 'none'; };
if (debugEl) debugEl.style.display = 'none';

// Test/debug hooks (dev server only)
if ((import.meta as any).env?.DEV) {
  (window as any).__keys = keys;
  (window as any).poxel = {
    scene, body, ui, setYawPitch, getBlock, setBlock, inv: inventory, bench: benchmarkWorld, send,
    select: setSelectedSlot, tp: (x: number, y: number, z: number) => { loadAreaNow(x, z, 1); setPlayerFeet({ x, y, z }); },
    health: () => health, counts: entityCounts, startSingle: (seed?: number) => startSingle(4, null, seed),
    connect: (url: string, name: string) => { mode = 'multi'; resetSession(); startRemote(url, name, savedLook(), playerToken()); },
    online: () => onlinePlayers,
    saveNow,
    // Block under the crosshair (what Mine/Use act on)
    lookTarget: () => { const d = new THREE.Vector3(0, 0, -1).applyQuaternion(controls.object.quaternion); return raycast(controls.object.position, d, 5); },
    yaw: () => getYawPitch().yaw,
    // Moves the player smoothly (like fast walking/flying) so the server's movement checks accept it
    glide: (x: number, y: number, z: number, speed = 8) => new Promise<void>(res => {
      const started = performance.now();
      const step = () => {
        const p = body.pos, dx = x - p.x, dy = y - p.y, dz = z - p.z, d = Math.hypot(dx, dy, dz);
        if (d < 0.2 || performance.now() - started > 6000) { body.vel.set(0, 0, 0); res(); return; }
        const k = Math.min(1, (speed / 60) / d);
        setPlayerFeet({ x: p.x + dx * k, y: p.y + dy * k, z: p.z + dz * k });
        requestAnimationFrame(step);
      };
      step();
    }),
  };
}

// ------------------------------------------------------------------ Main loop
let prev = performance.now();
let frames = 0, fpsTime = 0, fps = 0;
const menuSpin = new THREE.Euler(0, 0, 0, 'YXZ');

function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = Math.min(0.05, (now - prev) / 1000);
  prev = now;

  try {
    const inMenu = ui.state === 'menu';
    if (inMenu) {
      menuSpin.setFromQuaternion(controls.object.quaternion);
      menuSpin.y -= dt * 0.05; menuSpin.x = -0.15;
      controls.object.quaternion.setFromEuler(menuSpin);
    }

    updatePlayer(dt);
    updateWorld(body.pos);
    updateRemote(dt);

    const liquid = headInLava ? 'lava' : headInWater ? 'water' : 'none';
    const eye = controls.object.position;
    const depth = surfaceHeight(Math.floor(eye.x), Math.floor(eye.z)) - eye.y;
    const worldRunning = !inMenu && !(mode === 'single' && ui.state === 'paused');
    updateSky(dt, eye, liquid, worldRunning, depth);
    (handScene.children[0] as THREE.AmbientLight).intensity = 0.6 + 1.0 * getDaylight();

    renderer.autoClear = true;
    renderer.render(scene, perspectiveCamera);
    if (!inMenu) {
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(handScene, handCamera);
    }

    if (menuShopScreen && menuShopScreen.style.display !== 'none') {
      if (!isShopDrag) shopAvatar.rotation.y += 0.005;
      shopRenderer.render(shopScene, shopCamera);
    }

    frames++; fpsTime += dt;
    if (fpsTime >= 0.5) { fps = Math.round(frames / fpsTime); frames = 0; fpsTime = 0; }
    if (debugVisible && debugEl && frames === 0) {
      const p = body.pos;
      const hours = Math.floor(((getTimeOfDay() + 0.25) % 1) * 24);
      const c = entityCounts();
      debugEl.innerHTML = `FPS: ${fps} &nbsp; ${mode === 'multi' ? `Ping: ${pingMs}ms` : 'Single player'} (${workerStatus()})<br>` +
        `XYZ: ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}<br>` +
        `Biome: ${biomeAt(p.x, p.z)} &nbsp; Block below: ${getBlock(Math.floor(p.x), Math.floor(p.y) - 1, Math.floor(p.z))}<br>` +
        `Chunks: ${chunkCount()} &nbsp; Mobs: ${c.mobs} &nbsp; Items: ${c.items} &nbsp; Players: ${c.players + 1}<br>` +
        `Time: ${hours}:00 &nbsp; HP: ${health}/${MAX_HEALTH}`;
    }
  } catch (err) {
    reportError(err);
  }
}
requestAnimationFrame(frame);
