import * as THREE from 'three';
import { worldGroup, updateWorld, chunkCount, biomeAt, getBlock, setBlock, loadAreaNow, surfaceHeight } from './world';
import { setupInput, isMobile, actions, releaseAllKeys } from './input';
import { initPlayer, updatePlayer, controls, updateAvatarColors, applyHairGeometry, addBigEyes, body, handScene, handCamera,
  headInWater, headInLava, damagePlayer, isDead, resetPlayer, health, MAX_HEALTH, setYawPitch, setPlayerFeet, setHealth } from './player';
import { initInventory, clearInventory, addItem, isOpen as _isOpen, refreshFurnaceSlots, updateFurnaceGauges, inventory, setSelectedSlot } from './inventory';
import { loadGame, saveGame, getSaveMeta, newWorld } from './saves';
import { initEntities, updateItems } from './entities';
import { initMobs, updateMobs, mobs, spawnMob } from './mobs';
import { tickFurnaces, furnaces } from './furnace';
import { initSky, updateSky, getDaylight, getTimeOfDay } from './sky';
import { preloadIcons } from './textures';
import * as ui from './ui';

void _isOpen;

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
initEntities(scene);
initMobs(scene);
initPlayer(perspectiveCamera, scene);
initInventory();
preloadIcons();
newWorld(1337); // background world behind the main menu
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
let currentSaveSlot = -1;

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
const shopMatSkin = new THREE.MeshLambertMaterial({ color: localStorage.getItem('poxel_skin') || '#ffcc99' });
const shopMatShirt = new THREE.MeshLambertMaterial({ color: localStorage.getItem('poxel_shirt') || '#00aaff' });
const shopMatPants = new THREE.MeshLambertMaterial({ color: localStorage.getItem('poxel_pants') || '#0000aa' });
const shopMatHair = new THREE.MeshLambertMaterial({ color: localStorage.getItem('poxel_hair') || '#6b4423' });
const shopEyeMat = new THREE.MeshBasicMaterial({ color: localStorage.getItem('poxel_eye') || '#000000' });
let currentHairStyle = parseInt(localStorage.getItem('poxel_style') || '0');

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

let activeSuperCosmetic = localStorage.getItem('poxel_super') || 'none';

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

let playTimeSeconds = parseInt(localStorage.getItem('poxel_playtime') || '0');
setInterval(() => {
  if (ui.isPlaying()) {
    playTimeSeconds++;
    if (playTimeSeconds % 10 === 0) localStorage.setItem('poxel_playtime', playTimeSeconds.toString());
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
        localStorage.removeItem(`poxel_save_${slot}`);
        localStorage.removeItem(`poxel_meta_${slot}`);
        refreshSaveLabels();
      });
    }
    del.textContent = '🗑';
    del.classList.remove('armed');
    del.style.visibility = meta ? 'visible' : 'hidden';
  });
}
refreshSaveLabels();

function showMenuScreen(which: 'main' | 'load' | 'shop') {
  if (menuMainScreen) menuMainScreen.style.display = which === 'main' ? 'flex' : 'none';
  if (menuLoadScreen) menuLoadScreen.style.display = which === 'load' ? 'flex' : 'none';
  if (menuShopScreen) menuShopScreen.style.display = which === 'shop' ? 'flex' : 'none';
}

function firstFreeSlot(): number {
  for (let i = 0; i < 5; i++) if (!getSaveMeta(i)) return i;
  return 0;
}

document.getElementById('btn-new-game')?.addEventListener('click', () => {
  currentSaveSlot = firstFreeSlot();
  newWorld((Math.random() * 1e9) | 0);
  clearInventory();
  resetPlayer();
  startGame();
});
document.getElementById('btn-open-load')?.addEventListener('click', () => { refreshSaveLabels(); showMenuScreen('load'); });
document.getElementById('btn-back-load')?.addEventListener('click', () => showMenuScreen('main'));
document.getElementById('btn-shop')?.addEventListener('click', () => {
  populateSuperGrid();
  showMenuScreen('shop');
  setTimeout(onWindowResize, 10);
});
document.getElementById('btn-save-shop')?.addEventListener('click', () => {
  localStorage.setItem('poxel_skin', '#' + currentSkin);
  localStorage.setItem('poxel_shirt', '#' + currentShirt);
  localStorage.setItem('poxel_pants', '#' + currentPants);
  localStorage.setItem('poxel_hair', '#' + currentHairHex);
  localStorage.setItem('poxel_eye', '#' + currentEyeColorState);
  localStorage.setItem('poxel_style', currentHairStyle.toString());
  localStorage.setItem('poxel_super', activeSuperCosmetic);
  updateAvatarColors('#' + currentSkin, '#' + currentShirt, '#' + currentPants, '#' + currentHairHex, '#' + currentEyeColorState, currentHairStyle, activeSuperCosmetic);
  showMenuScreen('main');
});

saveButtons.forEach(btn => {
  btn.addEventListener('click', e => {
    const slot = parseInt((e.currentTarget as HTMLElement).dataset.slot!);
    currentSaveSlot = slot;
    if (!loadGame(slot)) {
      // Empty slot: start a fresh world that will save here
      newWorld((Math.random() * 1e9) | 0);
      clearInventory();
      resetPlayer();
    }
    startGame();
  });
});

document.getElementById('btn-save-quit')?.addEventListener('click', () => {
  if (currentSaveSlot !== -1) saveGame(currentSaveSlot);
  location.reload();
});

function startGame() {
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
}

// Autosave every minute and when the tab closes, so a crash never loses much progress
setInterval(() => {
  if (currentSaveSlot !== -1 && ui.state !== 'menu' && !isDead()) saveGame(currentSaveSlot);
}, 60000);
window.addEventListener('beforeunload', () => {
  if (currentSaveSlot !== -1 && ui.state !== 'menu' && !isDead()) saveGame(currentSaveSlot);
});

// Show the main menu on mobile when pressing the menu button in the pause state
const debugEl = document.getElementById('debug');
let debugVisible = false;
actions.toggleDebug = () => { debugVisible = !debugVisible; if (debugEl) debugEl.style.display = debugVisible ? 'block' : 'none'; };
if (debugEl) debugEl.style.display = 'none';

// Cheat/test hook for quickly checking the game from the console
(window as any).poxel = {
  give: (t: string, n = 1) => addItem(t, n), scene, body, ui, setYawPitch, getBlock, setBlock, mobs, health: () => health,
  inv: inventory, spawnMob, heal: () => setHealth(MAX_HEALTH), damage: (n: number) => damagePlayer(n, null, 'fall'), furnaces, select: setSelectedSlot,
  tp: (x: number, y: number, z: number) => { loadAreaNow(x, z, 1); setPlayerFeet(new THREE.Vector3(x, y, z)); },
  newGame: () => { currentSaveSlot = 4; newWorld(12345); clearInventory(); resetPlayer(); ui.forcePlaying(); },
};

// ------------------------------------------------------------------ Main loop
let prev = performance.now();
let frames = 0, fpsTime = 0, fps = 0;
let furnaceUiTimer = 0;
const menuSpin = new THREE.Euler(0, 0, 0, 'YXZ');

function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = Math.min(0.05, (now - prev) / 1000);
  prev = now;

  try {
    const playing = ui.isPlaying();
    const inMenu = ui.state === 'menu';

    if (inMenu) {
      menuSpin.setFromQuaternion(controls.object.quaternion);
      menuSpin.y -= dt * 0.05; menuSpin.x = -0.15;
      controls.object.quaternion.setFromEuler(menuSpin);
    }

    updatePlayer(dt);
    updateWorld(body.pos, playing ? 6 : 10);

    // The world keeps running while the inventory/furnace screen is open
    const simulate = playing || ui.state === 'screen';
    if (simulate) {
      updateMobs(dt, {
        playerFeet: body.pos, daylight: getDaylight(), playerAlive: !isDead(),
        damagePlayer: (amount, from) => damagePlayer(amount, from, 'zombie'),
      });
      updateItems(dt, body.pos, (type, count) => (isDead() ? count : addItem(type, count)));
      if (tickFurnaces(dt)) {
        updateFurnaceGauges();
        furnaceUiTimer -= dt;
        if (furnaceUiTimer <= 0) { furnaceUiTimer = 0.25; refreshFurnaceSlots(); }
      }
    }

    const liquid = headInLava ? 'lava' : headInWater ? 'water' : 'none';
    const eye = controls.object.position;
    const depth = surfaceHeight(Math.floor(eye.x), Math.floor(eye.z)) - eye.y;
    updateSky(dt, eye, liquid, simulate, depth);
    handScene.children[0] && ((handScene.children[0] as THREE.AmbientLight).intensity = 0.6 + 1.0 * getDaylight());

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
      debugEl.innerHTML = `FPS: ${fps}<br>XYZ: ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}<br>` +
        `Biome: ${biomeAt(p.x, p.z)} &nbsp; Block below: ${getBlock(Math.floor(p.x), Math.floor(p.y) - 1, Math.floor(p.z))}<br>` +
        `Chunks: ${chunkCount()} &nbsp; Mobs: ${mobs.length}<br>Time: ${hours}:00 &nbsp; HP: ${health}/${MAX_HEALTH}`;
    }
  } catch (err) {
    reportError(err);
  }
}
requestAnimationFrame(frame);
