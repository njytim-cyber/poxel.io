import * as THREE from 'three';
import { worldMaterials, worldGroup, updateWorld, chunkCount, biomeAt, getBlock, setBlock, loadAreaNow, surfaceHeight, benchmarkWorld, resetWorld, workerStatus, raycast, setRenderDistance, RENDER_DIST } from './world';
import { setupInput, isMobile, actions, releaseAllKeys, keys } from './input';
import { initPlayer, updatePlayer, controls, updateLocalLook, body, handScene, handCamera, headInWater, headInLava, headInOil,
  isDead, health, MAX_HEALTH, setYawPitch, setPlayerFeet, getYawPitch, aimTarget, wearsWaterHelmet, getMaxHealth } from './player';
import { applyHairGeometry, addBigEyes, savedLook } from './avatar';
import { initInventory, inventory, setSelectedSlot } from './inventory';
import { getSaveMeta, getSaveTime, readSave, writeSave, deleteSave, initSaves, savesSettled, storageUsage } from './saves';
import { store } from './store';
import { profileName, canCarry, stopCarry, carryDebug } from './character';
import { initRemote, updateRemote, entityCounts, entityList } from './remote';
import { initParticles, updateParticles } from './particles';
import { initWeather, updateWeather } from './weather';
import { initSky, updateSky, getDaylight, getTimeOfDay } from './sky';
import { preloadIcons } from './textures';
import { onServerMessage, startLocal, startRemote, send, disconnect, requestLocalSave, setLocalPaused, isMultiplayer, type LocalSave } from './net';
import { handleServerMessage, onReady, resetSession, markPingSent, pingMs, onlinePlayers } from './session';
import * as ui from './ui';
import { initMultiplayer, onMultiplayerMessage, onJoinedWorld, playerToken } from './multiplayer';
import { showWorldLoading, worldLoadingReady } from './worldLoading';
import { boxIntersectsSolid } from '../shared/physics.ts';
import { BLOCK_ID } from '../shared/blocks.ts';


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
initParticles(scene);
initWeather(scene);
initPlayer(perspectiveCamera, scene);
initInventory();
// Item icons are drawn a few at a time while idle (they're needed only once an inventory shows)
preloadIcons();
// Background world behind the main menu (no server needed just to look at it). It streams in on the
// worker threads like the rest of the world, so the menu shows straight away on slow phones.
resetWorld(1337);
warmUpShaders();

// Compiles every kind of material the game draws (terrain, water, mobs, players, name tags, items, hand)
// while the menu is up. Otherwise each is compiled the first time it appears on screen, e.g. the first mob,
// and that froze a frame for 50-150 ms mid-game.
function warmUpShaders() {
  const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  tex.needsUpdate = true;
  const box = new THREE.BoxGeometry(0.1, 0.1, 0.1);
  const mats: THREE.Material[] = [
    ...worldMaterials,
    new THREE.MeshLambertMaterial({ color: 0xffffff }),
    new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide }),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
    new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.2, depthWrite: false }),
  ];
  const warm = new THREE.Group();
  for (const m of mats) warm.add(new THREE.Mesh(box, m));
  warm.add(new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true })));
  warm.add(new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, alphaTest: 0.5 })));
  warm.add(new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: 0, transparent: true, opacity: 0.7 })));
  const handWarm = new THREE.Group();
  handWarm.add(new THREE.Mesh(box, mats[2]), new THREE.Mesh(box, mats[3]));
  try {
    scene.add(warm); handScene.add(handWarm);
    renderer.compile(scene, perspectiveCamera);
    renderer.compile(handScene, handCamera);
  } catch (e) { console.warn('Shader warm-up failed (the game still works):', e); }
  scene.remove(warm); handScene.remove(handWarm);
  box.dispose();
}
setPlayerFeet({ x: 0.5, y: surfaceHeight(0, 0) + 1, z: 0.5 });
ui.renderHealth(MAX_HEALTH, MAX_HEALTH);

window.addEventListener('resize', onWindowResize, false);
function onWindowResize() {
  perspectiveCamera.aspect = window.innerWidth / window.innerHeight;
  perspectiveCamera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  const shopPreview = document.querySelector('.shop-stage');
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
const ASSET_BASE = (import.meta as any).env?.BASE_URL || '/';
const shopCanvas = document.getElementById('shop-canvas') as HTMLCanvasElement;
const shopScene = new THREE.Scene();
export const shopCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
shopCamera.position.set(0, 0, 4);
export const shopRenderer = new THREE.WebGLRenderer({ canvas: shopCanvas, alpha: true, antialias: true });
shopRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // sharp enough; 3x phones would draw 9x the pixels
// Soft key light from the front, a cool rim light from behind so the voxel edges read against the sky
shopScene.add(new THREE.AmbientLight(0xffffff, 1.05));
const shopDirLight = new THREE.DirectionalLight(0xffffff, 1.5);
shopDirLight.position.set(3, 6, 6);
shopScene.add(shopDirLight);
const shopRimLight = new THREE.DirectionalLight(0x9d8cff, 2.2);
shopRimLight.position.set(-4, 3, -5);
shopScene.add(shopRimLight);
const shopWarmRim = new THREE.DirectionalLight(0xffc860, 1.2);
shopWarmRim.position.set(5, 1, -4);
shopScene.add(shopWarmRim);

// Greyscale pixel textures, tinted by each material's colour: shading, seams and creases
function shopTexture(draw: (px: (x: number, y: number, v: number) => void) => void, grain = 20): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 16;
  const g = c.getContext('2d')!;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const v = 256 - grain + Math.floor(rnd() * grain); // fine cloth/skin noise
    g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, y, 1, 1);
  }
  draw((x, y, v) => { g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, y, 1, 1); });
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const row = (px: (x: number, y: number, v: number) => void, y: number, v: number) => { for (let x = 0; x < 16; x++) px(x, y, v); };
const texSkin = shopTexture(px => { row(px, 15, 214); row(px, 14, 232); }, 6);
const texFace = shopTexture(px => { row(px, 15, 214); row(px, 14, 234); for (let y = 0; y < 16; y++) { px(0, y, 236); px(15, y, 236); } px(7, 10, 228); px(8, 10, 228); }, 4);
const texArm = shopTexture(px => { row(px, 0, 206); row(px, 1, 228); row(px, 8, 230); row(px, 15, 216); }, 6);
const texShirt = shopTexture(px => {
  row(px, 0, 190); for (let x = 5; x < 11; x++) { px(x, 1, 200); } // collar shadow under the chin
  row(px, 15, 205); row(px, 14, 225);                               // hem
  for (let y = 2; y < 14; y++) { px(0, y, 220); px(15, y, 220); }   // side seams where the arms meet
});
const texPants = shopTexture(px => {
  row(px, 0, 175); row(px, 1, 200);                                 // belt
  row(px, 7, 216);                                                  // knee crease
  for (let y = 12; y < 16; y++) row(px, y, y === 12 ? 150 : 128);  // shoes
});
const texHair = shopTexture(px => { for (let x = 0; x < 16; x += 3) for (let y = 0; y < 16; y++) px(x, y, 214); });
const texStone = shopTexture(px => {
  for (let i = 0; i < 40; i++) px((i * 7) % 16, (i * 11) % 16, 200 + (i % 3) * 10);
  row(px, 0, 255); row(px, 15, 170);
});

const shopAvatar = new THREE.Group();
const shopMatSkin = new THREE.MeshLambertMaterial({ color: store.get('poxel_skin') || '#ffcc99', map: texSkin });
const shopMatFace = new THREE.MeshLambertMaterial({ map: texFace });
const shopMatArm = new THREE.MeshLambertMaterial({ map: texArm });
const shopMatShirt = new THREE.MeshLambertMaterial({ color: store.get('poxel_shirt') || '#00aaff', map: texShirt });
const shopMatPants = new THREE.MeshLambertMaterial({ color: store.get('poxel_pants') || '#0000aa', map: texPants });
const shopMatHair = new THREE.MeshLambertMaterial({ color: store.get('poxel_hair') || '#6b4423', map: texHair });
const shopEyeMat = new THREE.MeshBasicMaterial({ color: store.get('poxel_eye') || '#000000' });
// The face and arms share the skin colour
const syncSkin = () => { shopMatFace.color.copy(shopMatSkin.color); shopMatArm.color.copy(shopMatSkin.color); };
syncSkin();
let currentHairStyle = parseInt(store.get('poxel_style') || '0');

const shopHead = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), [shopMatSkin, shopMatSkin, shopMatSkin, shopMatSkin, shopMatSkin, shopMatFace]);
shopHead.position.y = 0.52;
const shopHair = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.1, 0.52), shopMatHair);
applyHairGeometry(currentHairStyle, shopHair);
shopHead.add(shopHair);
addBigEyes(shopHead, shopEyeMat);
shopAvatar.add(shopHead);
const shopNeck = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.16), shopMatArm);
shopNeck.position.y = 0.26;
shopAvatar.add(shopNeck);
const shopBody = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.75, 0.25), shopMatShirt);
shopBody.position.y = -0.125;
shopAvatar.add(shopBody);
// Arms hang from the shoulders, angled a little away from the body
const shopArms: THREE.Group[] = [];
for (const x of [-0.31, 0.31]) {
  const shoulder = new THREE.Group();
  shoulder.position.set(x, 0.24, 0);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.75, 0.18), shopMatArm);
  arm.position.y = -0.37;
  shoulder.add(arm);
  shoulder.rotation.z = Math.sign(x) * 0.09;
  shopAvatar.add(shoulder);
  shopArms.push(shoulder);
}
// Two legs with a gap between them; the weight rests on one
const shopLegs: THREE.Mesh[] = [];
for (const x of [-0.112, 0.112]) {
  const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.75, 0.22), shopMatPants);
  leg.position.set(x, -0.875, 0);
  shopAvatar.add(leg);
  shopLegs.push(leg);
}
// A voxel plinth: dark stone with a gold trim, turning with the character
const shopPlinth = new THREE.Group();
// Stone on top (the feet rest on it at y -1.25), a gold band under it, a wider dark base
const plinthStone = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.22, 1.0), new THREE.MeshLambertMaterial({ color: 0x5a4f96, map: texStone }));
plinthStone.position.y = -1.36;
const plinthTrim = new THREE.Mesh(new THREE.BoxGeometry(1.08, 0.06, 1.08), new THREE.MeshLambertMaterial({ color: 0xffd23f, emissive: 0x3a2a00 }));
plinthTrim.position.y = -1.5;
const plinthBase = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.12, 1.2), new THREE.MeshLambertMaterial({ color: 0x2c2450, map: texStone }));
plinthBase.position.y = -1.59;
shopPlinth.add(plinthStone, plinthTrim, plinthBase);
shopAvatar.add(shopPlinth);
shopAvatar.position.y = 0.32;
shopAvatar.rotation.y = Math.PI; // face the camera
shopScene.add(shopAvatar);

// Idle: breathing, a slow sway, and the weight shifting between the legs
function animateShopAvatar(t: number) {
  const breathe = Math.sin(t * 2.2);
  shopBody.scale.y = 1 + breathe * 0.012;
  shopHead.position.y = 0.52 + breathe * 0.006;
  shopHead.rotation.z = Math.sin(t * 0.7) * 0.03;
  shopArms.forEach((a, i) => { a.rotation.z = (i ? 1 : -1) * (0.09 + Math.sin(t * 1.3 + i) * 0.025); a.rotation.x = Math.sin(t * 0.9 + i * 2) * 0.04; });
  const shift = Math.sin(t * 0.5) * 0.5 + 0.5;
  shopLegs[0].position.y = -0.875 + shift * 0.012;
  shopLegs[1].position.y = -0.875 + (1 - shift) * 0.012;
  shopBody.rotation.z = (shift - 0.5) * 0.025;
}

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

// Turning the character: drag with a mouse or a finger, or the 360° handle under the stage
let isShopDrag = false, shopPX = 0, shopPY = 0, shopTurn = 0;
const shopTurnInput = document.getElementById('shop-turn') as HTMLInputElement | null;
function setShopTurn(deg: number) {
  shopTurn = ((deg % 360) + 360) % 360;
  shopAvatar.rotation.set(0, Math.PI + (shopTurn * Math.PI) / 180, 0);
  if (shopTurnInput && Number(shopTurnInput.value) !== Math.round(shopTurn)) shopTurnInput.value = String(Math.round(shopTurn));
}
shopTurnInput?.addEventListener('input', () => setShopTurn(Number(shopTurnInput.value)));
const shopStage = document.querySelector('.shop-stage') as HTMLElement | null;
if (shopStage) {
  shopStage.addEventListener('pointerdown', e => {
    if ((e.target as HTMLElement).closest('.shop-turn')) return; // the handle turns it by itself
    isShopDrag = true; shopPX = e.clientX; shopPY = e.clientY;
    shopStage.setPointerCapture(e.pointerId);
  });
  shopStage.addEventListener('pointermove', e => {
    if (!isShopDrag) return;
    setShopTurn(shopTurn + (e.clientX - shopPX) * 0.7);
    shopPX = e.clientX; shopPY = e.clientY;
  });
  const stop = () => { isShopDrag = false; };
  shopStage.addEventListener('pointerup', stop);
  shopStage.addEventListener('pointercancel', stop);
  // The preview follows the stage's size (it changes with the window and the phone layout)
  new ResizeObserver(() => onWindowResize()).observe(shopStage);
}

let currentSkin = shopMatSkin.color.getHexString();
let currentShirt = shopMatShirt.color.getHexString();
let currentPants = shopMatPants.color.getHexString();
let currentHairHex = shopMatHair.color.getHexString();
let currentEyeColorState = shopEyeMat.color.getHexString();

type LookPart = 'skin' | 'shirt' | 'pants' | 'hair' | 'eye';
const PALETTES: Record<LookPart, string[]> = {
  skin: ['#ffdbb5', '#ffcc99', '#f2d3ab', '#e0ac69', '#c68642', '#a0663a', '#8d5524', '#5c3a21', '#3d2c23'],
  shirt: ['#00aaff', '#3fb4ff', '#1a6fd1', '#33cc33', '#1f7d3a', '#ff3333', '#c23a10', '#ff9900', '#ffd23f', '#ffff33',
    '#aa00aa', '#7b4dff', '#ff66b2', '#ffffff', '#b0b0b0', '#555555', '#111111', '#8d5524'],
  pants: ['#0000aa', '#2b3a8f', '#0055ff', '#00aa00', '#556b2f', '#aa0000', '#5c1a1a', '#aaaa00', '#8d5524', '#ffffff', '#666666', '#222222'],
  hair: ['#6b4423', '#3b2414', '#111111', '#ddbb55', '#ffe680', '#aa5500', '#cc3333', '#ff66b2', '#7b4dff', '#3333cc', '#3fc25a', '#e6e6fa', '#ffffff'],
  eye: ['#000000', '#3b2414', '#8d5524', '#0055ff', '#3fb4ff', '#00aa00', '#3fc25a', '#aa0000', '#aa00aa', '#ffd23f', '#ffffff'],
};
const PART_GRID: Record<LookPart, string> = { skin: 'grid-skin', shirt: 'grid-shirt', pants: 'grid-pants', hair: 'grid-hair', eye: 'grid-eyes' };

function partHex(part: LookPart): string {
  return '#' + (part === 'skin' ? currentSkin : part === 'shirt' ? currentShirt : part === 'pants' ? currentPants : part === 'hair' ? currentHairHex : currentEyeColorState);
}
function setPart(part: LookPart, col: string) {
  const hex = col.replace('#', '');
  if (part === 'skin') { currentSkin = hex; shopMatSkin.color.set(col); syncSkin(); }
  if (part === 'shirt') { currentShirt = hex; shopMatShirt.color.set(col); }
  if (part === 'pants') { currentPants = hex; shopMatPants.color.set(col); }
  if (part === 'hair') { currentHairHex = hex; shopMatHair.color.set(col); }
  if (part === 'eye') { currentEyeColorState = hex; shopEyeMat.color.set(col); }
  markSelected(part);
}
function markSelected(part: LookPart) {
  const grid = document.getElementById(PART_GRID[part]);
  const cur = partHex(part).toLowerCase();
  syncCustom(part, cur);
  grid?.querySelectorAll<HTMLElement>('.shop-swatch').forEach(sw => {
    const on = sw.dataset.col === cur;
    sw.classList.toggle('selected', on);
    sw.setAttribute('aria-pressed', String(on));
  });
}
// Custom colour under each palette: hue, saturation and brightness sliders
const customs = new Map<LookPart, { h: HTMLInputElement; s: HTMLInputElement; l: HTMLInputElement; chip: HTMLElement; hex: HTMLElement; box: HTMLElement }>();
const hsl = { h: 0, s: 0, l: 0 };
let customDriving: LookPart | null = null;
function paintCustomTracks(c: NonNullable<ReturnType<typeof customs.get>>) {
  const h = Number(c.h.value), sat = Number(c.s.value), l = Number(c.l.value);
  c.s.style.setProperty('--track', `linear-gradient(90deg, hsl(${h} 0% ${l}%), hsl(${h} 100% ${l}%))`);
  c.l.style.setProperty('--track', `linear-gradient(90deg, #000, hsl(${h} ${sat}% 50%), #fff)`);
}
function syncCustom(part: LookPart, hex: string) {
  const c = customs.get(part);
  if (!c) return;
  c.chip.style.background = hex; c.hex.textContent = hex.toUpperCase();
  // While a slider is moving, leave the sliders where the player put them (a round trip through hex would nudge them)
  if (customDriving === part) { paintCustomTracks(c); return; }
  new THREE.Color(hex).getHSL(hsl, THREE.SRGBColorSpace);
  c.h.value = String(Math.round(hsl.h * 360)); c.s.value = String(Math.round(hsl.s * 100)); c.l.value = String(Math.round(hsl.l * 100));
  c.chip.style.background = hex; c.hex.textContent = hex.toUpperCase();
  paintCustomTracks(c);
}
function buildCustom(part: LookPart, grid: HTMLElement) {
  const box = document.createElement('div');
  box.className = 'shop-custom';
  box.innerHTML = `<h3>Custom</h3><div class="shop-custom-row"><span class="shop-custom-chip"></span><span class="shop-custom-hex"></span></div>` +
    ['Hue', 'Saturation', 'Brightness'].map((n, i) => `<label class="shop-slider"><span>${n}</span><input type="range" min="0" max="${i ? 100 : 359}" data-k="${'hsl'[i]}" /></label>`).join('');
  grid.after(box);
  const [h, sl, l] = Array.from(box.querySelectorAll('input'));
  const c = { h, s: sl, l, chip: box.querySelector('.shop-custom-chip') as HTMLElement, hex: box.querySelector('.shop-custom-hex') as HTMLElement, box };
  customs.set(part, c);
  const apply = () => {
    const col = '#' + new THREE.Color().setHSL(Number(h.value) / 360, Number(sl.value) / 100, Number(l.value) / 100, THREE.SRGBColorSpace).getHexString();
    customDriving = part;
    setPart(part, col);
    customDriving = null;
  };
  [h, sl, l].forEach(inp => inp.addEventListener('input', apply));
}
(Object.keys(PALETTES) as LookPart[]).forEach(part => {
  const grid = document.getElementById(PART_GRID[part]);
  if (!grid) return;
  buildCustom(part, grid);
  grid.innerHTML = '';
  PALETTES[part].forEach(col => {
    const sw = document.createElement('button');
    sw.className = 'shop-swatch';
    sw.dataset.col = col.toLowerCase();
    sw.style.setProperty('--sw', col);
    sw.setAttribute('aria-label', `Colour ${col}`);
    sw.addEventListener('click', () => setPart(part, col));
    grid.appendChild(sw);
  });
  markSelected(part);
});

const superItems = [
  { id: 'none', name: 'No set', icon: 'icon-none.svg', rarity: 'common', unlockMin: 0 },
  { id: 'tophat', name: 'Mayor', icon: 'icon-tophat.svg', rarity: 'rare', unlockMin: 5, shirt: '#111111', pants: '#222222' },
  { id: 'backpack', name: 'Explorer', icon: 'icon-backpack.svg', rarity: 'epic', unlockMin: 10, shirt: '#8d5524', pants: '#556b2f' },
  { id: 'ninja', name: 'Ninja', icon: 'icon-ninja.svg', rarity: 'legendary', unlockMin: 15, shirt: '#111111', pants: '#111111', skin: '#f2d3ab' },
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
  const played = Math.floor(playTimeSeconds / 60);
  superItems.forEach(item => {
    const unlocked = played >= item.unlockMin;
    const card = document.createElement('button');
    card.className = `shop-set rarity-${item.rarity}${unlocked ? '' : ' locked'}${activeSuperCosmetic === item.id ? ' selected' : ''}`;
    card.innerHTML = `<img class="shop-set-icon" src="${ASSET_BASE}${unlocked ? item.icon : 'icon-lock.svg'}" alt="" /><span class="shop-set-name">${item.name}</span>` +
      `<span class="shop-set-rarity">${item.id === 'none' ? 'Plain look' : item.rarity}</span>` +
      (unlocked ? '' : `<span class="shop-set-lock">Play ${item.unlockMin} min<span class="shop-set-bar"><i style="width:${Math.min(100, (played / item.unlockMin) * 100)}%"></i></span>${played}/${item.unlockMin} min</span>`);
    if (unlocked) card.addEventListener('click', () => {
      activeSuperCosmetic = item.id;
      applySuperCosmetic(activeSuperCosmetic, shopCosmetics);
      const it = item as any;
      if (it.shirt) setPart('shirt', it.shirt);
      if (it.pants) setPart('pants', it.pants);
      if (it.skin) setPart('skin', it.skin);
      grid.querySelectorAll('.shop-set').forEach(c => c.classList.toggle('selected', c === card));
    });
    else card.disabled = true;
    grid.appendChild(card);
  });
}

const styleBtns = document.querySelectorAll<HTMLElement>('#grid-hair-style .shop-style');
function setHairStyle(id: number) {
  currentHairStyle = id;
  applyHairGeometry(currentHairStyle, shopHair);
  styleBtns.forEach(b => b.classList.toggle('active', Number(b.dataset.style) === id));
}
styleBtns.forEach(btn => btn.addEventListener('click', () => setHairStyle(Number(btn.dataset.style))));
setHairStyle(currentHairStyle);

const shopCats = document.querySelectorAll<HTMLElement>('.shop-cats .shop-cat');
const shopPages = document.querySelectorAll('.shop-page');
function showShopTab(target: string) {
  shopCats.forEach(t => { const on = t.dataset.tab === target; t.classList.toggle('active', on); t.setAttribute('aria-selected', String(on)); });
  shopPages.forEach(pg => pg.classList.toggle('active', pg.id === `tab-${target}`));
}
shopCats.forEach(tab => tab.addEventListener('click', () => showShopTab(tab.dataset.tab || 'skin')));

// Opening the shop shows the saved look; Cancel goes back to it, Save keeps the new one
function loadShopLook() {
  setPart('skin', store.get('poxel_skin') || '#ffcc99');
  setPart('shirt', store.get('poxel_shirt') || '#00aaff');
  setPart('pants', store.get('poxel_pants') || '#0000aa');
  setPart('hair', store.get('poxel_hair') || '#6b4423');
  setPart('eye', store.get('poxel_eye') || '#000000');
  setHairStyle(parseInt(store.get('poxel_style') || '0') || 0);
  activeSuperCosmetic = store.get('poxel_super') || 'none';
  applySuperCosmetic(activeSuperCosmetic, shopCosmetics);
  setShopTurn(0);
}
function pickOne<T>(a: T[]): T { return a[Math.floor(Math.random() * a.length)]; }
document.getElementById('btn-shop-random')?.addEventListener('click', () => {
  (Object.keys(PALETTES) as LookPart[]).forEach(part => setPart(part, pickOne(PALETTES[part])));
  setHairStyle(Math.floor(Math.random() * 3));
});
document.getElementById('btn-cancel-shop')?.addEventListener('click', () => { loadShopLook(); showMenuScreen('main'); });

const saveButtons = document.querySelectorAll<HTMLElement>('.save-slot');
const DIFFICULTY_LOOK: Record<string, { name: string; icon: string; colour: string }> = {
  easy: { name: 'Easy', icon: '/icon-easy.svg', colour: '#3fc25a' },
  medium: { name: 'Medium', icon: '/icon-medium.svg', colour: '#ffd23f' },
  hard: { name: 'Hard', icon: '/icon-hard.svg', colour: '#ff6a2a' },
};
function timeAgo(ms: number, fallback: string): string {
  if (!ms) return fallback ? `Saved ${fallback}` : 'Saved';
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'Saved just now';
  if (s < 3600) return `Saved ${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `Saved ${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return d < 30 ? `Saved ${d} day${d === 1 ? '' : 's'} ago` : `Saved ${new Date(ms).toLocaleDateString()}`;
}
const escapeHtml = (t: string) => t.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
function refreshSaveLabels() {
  const note = document.getElementById('load-note');
  if (note) note.textContent = '';
  saveButtons.forEach(btn => {
    const slot = parseInt((btn as HTMLElement).dataset.slot!);
    const meta = getSaveMeta(slot);
    const save = meta !== null ? readSave(slot) : null;
    btn.classList.toggle('empty', !save);
    if (save) {
      const diff = DIFFICULTY_LOOK[save.world?.difficulty || 'medium'] || DIFFICULTY_LOOK.medium;
      const me = save.players[profileName().toLowerCase()] || save.players[profileName()] || Object.values(save.players)[0];
      const achievements = me?.achievements?.length || 0;
      const t = save.world?.time ?? 0.3;
      const night = t > 0.75 || t < 0.25;
      const hearts = me ? Math.ceil(me.health / 2) : 10;
      btn.style.setProperty('--c', diff.colour);
      btn.innerHTML = `<img class="slot-icon" src="${ASSET_BASE}${diff.icon.slice(1)}" alt="" />` +
        `<span class="slot-text"><span class="slot-name">World ${slot + 1}</span>` +
        `<span class="slot-tags"><span class="slot-diff">${diff.name}</span><span>${night ? '☾ Night' : '☀ Day'}</span><span>♥ ${hearts}</span>` +
        (achievements ? `<span>★ ${achievements}</span>` : '') + `</span>` +
        `<span class="slot-when">${escapeHtml(timeAgo(getSaveTime(slot), meta || ''))}</span></span>` +
        `<span class="slot-play" aria-hidden="true">▶</span>`;
    } else {
      btn.style.removeProperty('--c');
      btn.innerHTML = `<span class="slot-icon slot-plus">+</span><span class="slot-text"><span class="slot-name">Empty slot ${slot + 1}</span>` +
        `<span class="slot-when">Start a new world here</span></span>`;
    }
    // Delete button beside each used slot; first click arms it, second click deletes
    let del = btn.nextElementSibling as HTMLButtonElement | null;
    if (!del || !del.classList.contains('delete-save')) {
      const row = document.createElement('div');
      row.className = 'save-row';
      btn.parentElement!.insertBefore(row, btn);
      row.appendChild(btn);
      del = document.createElement('button');
      del.className = 'delete-save';
      del.title = 'Delete this world';
      row.appendChild(del);
      const d = del;
      d.addEventListener('click', e => {
        e.stopPropagation();
        if (!d.classList.contains('armed')) {
          d.classList.add('armed');
          d.textContent = 'Delete?';
          setTimeout(() => { d.classList.remove('armed'); d.textContent = '🗑'; }, 3000);
          return;
        }
        deleteSave(slot);
        refreshSaveLabels();
      });
    }
    del.textContent = '🗑';
    del.classList.remove('armed');
    del.style.visibility = save ? 'visible' : 'hidden';
  });
  storageUsage().then(u => { const el = document.getElementById('storage-usage'); if (el) el.textContent = u ? `Browser storage: ${u}` : ''; });
}
await initSaves(); // before anything can read a slot, so an existing save is never mistaken for an empty one
refreshSaveLabels();

function showMenuScreen(which: 'main' | 'load' | 'shop' | 'mp' | 'difficulty') {
  if (menuMainScreen) menuMainScreen.style.display = which === 'main' ? 'flex' : 'none';
  if (menuLoadScreen) menuLoadScreen.style.display = which === 'load' ? 'flex' : 'none';
  if (menuShopScreen) menuShopScreen.style.display = which === 'shop' ? 'flex' : 'none';
  const mp = document.getElementById('mp-screen');
  if (mp) mp.style.display = which === 'mp' ? 'flex' : 'none';
  const diff = document.getElementById('difficulty-screen');
  if (diff) diff.style.display = which === 'difficulty' ? 'flex' : 'none';
  if (which === 'mp') refreshCharacterChoices();
}

// Multiplayer "Character": this server's own character, or the character of a single-player save
const mpCharacter = document.getElementById('mp-character') as HTMLSelectElement | null;
const mpCharacterHint = document.getElementById('mp-character-hint');
function refreshCharacterChoices() {
  if (!mpCharacter) return;
  const wanted = store.get('poxel_mp_character') || '-1';
  mpCharacter.innerHTML = '';
  mpCharacter.add(new Option("This server's character", '-1'));
  saveButtons.forEach(btn => {
    const slot = parseInt((btn as HTMLElement).dataset.slot!);
    const meta = getSaveMeta(slot);
    if (!meta) return;
    const opt = new Option(`Save ${slot + 1} (${meta})${canCarry(slot) ? '' : ' - used cheats, single player only'}`, String(slot));
    opt.disabled = !canCarry(slot);
    mpCharacter.add(opt);
  });
  mpCharacter.value = [...mpCharacter.options].some(o => o.value === wanted && !o.disabled) ? wanted : '-1';
  updateCharacterHint();
}
function updateCharacterHint() {
  if (!mpCharacterHint || !mpCharacter) return;
  mpCharacterHint.textContent = mpCharacter.value === '-1'
    ? 'Your inventory on this server is kept by the server.'
    : 'You bring this save’s items and health. What happens on the server (new items, losing everything when you die) is saved back into it.';
}
mpCharacter?.addEventListener('change', updateCharacterHint);

function firstFreeSlot(): number {
  for (let i = 0; i < 5; i++) if (!getSaveMeta(i)) return i;
  return -1;
}

document.getElementById('btn-open-load')?.addEventListener('click', () => { refreshSaveLabels(); showMenuScreen('load'); });
document.getElementById('btn-back-load')?.addEventListener('click', () => showMenuScreen('main'));
document.getElementById('btn-shop')?.addEventListener('click', () => {
  loadShopLook();
  populateSuperGrid();
  showShopTab('skin');
  showMenuScreen('shop');
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

onServerMessage(m => {
  handleServerMessage(m);
  if (mode !== 'multi') return;
  onMultiplayerMessage(m);
});
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
  if (mode === 'multi') onJoinedWorld();
  if (mode === 'single') worldLoadingReady();
});

// View distance (pause menu), remembered per browser. Lower it on slow devices.
{
  const saved = Number(store.get('poxel_view_distance'));
  if (saved) setRenderDistance(saved);
  const slider = document.getElementById('view-distance') as HTMLInputElement | null;
  const label = document.getElementById('view-distance-value');
  const showValue = () => { if (label) label.textContent = `${RENDER_DIST} chunks`; };
  if (slider) {
    slider.value = String(RENDER_DIST);
    slider.addEventListener('input', () => {
      setRenderDistance(Number(slider.value));
      store.set('poxel_view_distance', String(RENDER_DIST));
      showValue();
    });
    slider.addEventListener('change', () => slider.blur()); // or the keys stay with the slider after resuming
  }
  showValue();
}

ui.setPauseHandler(paused => { if (mode === 'single') setLocalPaused(paused); });

initMultiplayer({
  showMenu: which => showMenuScreen(which),
  startMulti: () => { mode = 'multi'; currentSaveSlot = -1; },
  endMulti: () => { mode = 'none'; },
  inMulti: () => mode === 'multi',
  characterSlot: () => mpCharacter ? Number(mpCharacter.value) : -1,
  pingVisible: () => !debugVisible,
});

function startSingle(slot: number, save: LocalSave | null, fixedSeed?: number, difficulty?: string) {
  currentSaveSlot = slot;
  mode = 'single';
  showWorldLoading(!save?.world);
  resetSession();
  const seed = save?.world ? undefined : fixedSeed ?? (Math.random() * 2 ** 31) | 0;
  startLocal(save || { world: null, players: {} }, seed, profileName(), savedLook(), s => {
    writeSave(slot, s).then(ok => {
      lastSaveOk = ok;
      ui.setConnectionBanner(ok ? '' : 'Could not save: browser storage is full. Delete an old save from the Load menu.');
    });
  }, difficulty);
}

document.getElementById('btn-new-game')?.addEventListener('click', () => {
  const slot = firstFreeSlot();
  if (slot < 0) {
    // All slots used: never overwrite a save silently
    refreshSaveLabels();
    showMenuScreen('load');
    const note = document.getElementById('load-note');
    if (note) note.textContent = 'All five slots are full. Delete a world (🗑) or pick one to continue.';
    return;
  }
  // New worlds start with a difficulty choice
  pendingNewSlot = slot;
  showMenuScreen('difficulty');
});
let pendingNewSlot = -1;
document.querySelectorAll('.difficulty-btn').forEach(btn => btn.addEventListener('click', () => {
  if (pendingNewSlot < 0) return;
  const d = (btn as HTMLElement).dataset.difficulty || 'medium';
  store.set('poxel_difficulty', d);
  startSingle(pendingNewSlot, null, undefined, d);
  pendingNewSlot = -1;
}));
document.getElementById('btn-back-difficulty')?.addEventListener('click', () => { pendingNewSlot = -1; showMenuScreen('main'); });

saveButtons.forEach(btn => {
  btn.addEventListener('click', e => {
    const slot = parseInt((e.currentTarget as HTMLElement).dataset.slot!);
    const save = readSave(slot);
    // An empty slot starts a new world there, with the difficulty choice first
    if (!save) { pendingNewSlot = slot; showMenuScreen('difficulty'); return; }
    startSingle(slot, save);
  });
});

// Returns true when the world is safely stored (always true in multiplayer: the server saves)
async function saveNow(): Promise<boolean> {
  if (mode !== 'single' || currentSaveSlot === -1) return true;
  const s = await requestLocalSave();
  return !!s && (lastSaveOk = await savesSettled());
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
  // A carried character's last changes must reach its save before the page goes
  if (mode === 'multi') { stopCarry(); await savesSettled(); }
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

const DEV = !!(import.meta as any).env?.DEV;
const slowFrames: { player: number; world: number; remote: number; render: number; at: number; programs: number }[] = [];

// Test/debug hooks (dev server only)
if ((import.meta as any).env?.DEV) {
  (window as any).__keys = keys;
  (window as any).poxel = {
    scene, body, ui, setYawPitch, getBlock, setBlock, inv: inventory, bench: benchmarkWorld, send,
    select: setSelectedSlot, tp: (x: number, y: number, z: number) => { loadAreaNow(x, z, 1); setPlayerFeet({ x, y, z }); },
    health: () => health, counts: entityCounts, entities: entityList, blockId: (name: string) => BLOCK_ID[name], startSingle: (seed?: number, difficulty?: string) => startSingle(4, null, seed, difficulty),
    connect: (url: string, name: string) => { mode = 'multi'; resetSession(); startRemote(url, name, savedLook(), playerToken()); },
    online: () => onlinePlayers,
    saveNow, readSave, deleteSave, savesSettled,
    drawCalls: () => worldDrawCalls,
    carry: carryDebug,
    mode: () => mode,
    slowFrames,
    // Block under the crosshair (what Mine/Use act on)
    aimTarget,
    lookTarget: () => { const d = new THREE.Vector3(0, 0, -1).applyQuaternion(controls.object.quaternion); return raycast(controls.object.position, d, 5); },
    yaw: () => getYawPitch().yaw,
    // Moves the player smoothly (like fast walking/flying) so the server's movement checks accept it
    // Time-based (blocks per second at any frame rate), under the server's movement limit
    // When the straight line is blocked (the server refuses moves into blocks), it teleports instead,
    // which only servers with dev tools accept (dev single player and the test server).
    glide: (x: number, y: number, z: number, speed = 8) => new Promise<void>(res => {
      const from = { ...body.pos };
      const blocked = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
        for (let t = 0; t <= 1; t += 0.02) {
          if (boxIntersectsSolid(getBlock, ax + (bx - ax) * t, ay + (by - ay) * t + 0.05, az + (bz - az) * t, 0.22, 1.65)) return true;
        }
        return false;
      };
      const route = [{ x, y, z }];
      if (blocked(from.x, from.y, from.z, x, y, z)) {
        send({ t: 'dev', tp: { x, y, z } });
        loadAreaNow(x, z, 1);
        setPlayerFeet({ x, y, z });
        setTimeout(res, 300);
        return;
      }
      const started = performance.now();
      let last = started;
      const step = () => {
        const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        const goal = route[0], p = body.pos, dx = goal.x - p.x, dy = goal.y - p.y, dz = goal.z - p.z, d = Math.hypot(dx, dy, dz);
        if (d < 0.2) route.shift();
        if (!route.length || now - started > 12000) { body.vel.set(0, 0, 0); res(); return; }
        const k = d < 0.2 ? 0 : Math.min(1, (speed * dt) / d);
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
let worldDrawCalls = 0; // draw calls of the world pass alone (the hand pass resets renderer.info)
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

    const t0 = performance.now();
    updatePlayer(dt);
    const t1 = performance.now();
    updateWorld(body.pos);
    const t2 = performance.now();
    updateRemote(dt, controls.object.position);
    updateParticles(dt);
    updateWeather(dt, controls.object.position);
    const t3 = performance.now();

    const liquid = headInLava ? 'lava' : headInOil ? 'oil' : headInWater && !wearsWaterHelmet() ? 'water' : 'none'; // (the water helmet: clear sight underwater)
    const eye = controls.object.position;
    const depth = surfaceHeight(Math.floor(eye.x), Math.floor(eye.z)) - eye.y;
    const worldRunning = !inMenu && !(mode === 'single' && ui.state === 'paused');
    updateSky(dt, eye, liquid, worldRunning, depth);
    (handScene.children[0] as THREE.AmbientLight).intensity = 0.6 + 1.0 * getDaylight();

    renderer.autoClear = true;
    renderer.render(scene, perspectiveCamera);
    worldDrawCalls = renderer.info.render.calls;
    // Where the time of slow frames goes (dev builds; read by the perf test)
    if (DEV) { const t4 = performance.now(); if (t4 - t0 > 30) slowFrames.push({ player: t1 - t0, world: t2 - t1, remote: t3 - t2, render: t4 - t3, at: t0, programs: renderer.info.programs?.length ?? 0 }); if (slowFrames.length > 50) slowFrames.shift(); }
    if (!inMenu) {
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(handScene, handCamera);
    }

    if (menuShopScreen && menuShopScreen.style.display !== 'none') {
      animateShopAvatar(performance.now() / 1000);
      shopRenderer.render(shopScene, shopCamera);
    }

    frames++; fpsTime += dt;
    if (fpsTime >= 0.5) { fps = Math.round(frames / fpsTime); frames = 0; fpsTime = 0; }
    if (debugVisible && debugEl && frames === 0) {
      const p = body.pos;
      const hours = Math.floor(((getTimeOfDay() + 0.25) % 1) * 24);
      const c = entityCounts();
      debugEl.innerHTML = `FPS: ${fps} &nbsp; ${mode === 'multi' ? `Ping: ${pingMs < 0 ? "..." : pingMs + "ms"}` : 'Single player'} (${workerStatus()})<br>` +
        `XYZ: ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}<br>` +
        `Biome: ${biomeAt(p.x, p.z)} &nbsp; Block below: ${getBlock(Math.floor(p.x), Math.floor(p.y) - 1, Math.floor(p.z))}<br>` +
        `Chunks: ${chunkCount()} &nbsp; Mobs: ${c.mobs} &nbsp; Items: ${c.items} &nbsp; Players: ${c.players + 1}<br>` +
        `Time: ${hours}:00 &nbsp; HP: ${health}/${getMaxHealth()}`;
    }
  } catch (err) {
    reportError(err);
  }
}
requestAnimationFrame(frame);
// Menu buttons work from here on (saves are open and every handler is attached)
document.body.dataset.ready = '1';
