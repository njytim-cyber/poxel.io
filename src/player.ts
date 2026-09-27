import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { crackMaterials, blockGeometry, blockEntityMaterial, getIconCanvas, isFlatItem } from './textures';
import { keys, isMobile, touchLookDelta, actions } from './input';
import { getBlock, setBlock, raycast, facing, loadAreaNow, type RayHit } from './world';
import { BLOCKS, BLOCK_ID, WATER, LAVA, isFacingBlock, isPlant, itemDef, miningInfo } from './blocks';
import { inventory, selectedSlotIndex, addItem, removeItem, getSelectedItem, clearInventory, setDropHandler, onInventoryChange } from './inventory';
import { makeBody, moveBody, boxIntersectsSolid, hasGroundBelow, isHeadInWater } from './physics';
import { spawnItem } from './entities';
import { rayHitMob, damageMob, mobInBlock } from './mobs';
import { furnaces } from './furnace';
import * as ui from './ui';

// Hitbox: 0.72 wide x 1.8 tall, same size as the visible model. Eyes 1.62 above the feet.
export const EYE_HEIGHT = 1.62;
const HALF_WIDTH = 0.36;
const HEIGHT = 1.8;
export const MAX_HEALTH = 20; // 10 hearts
const WALK_SPEED = 5.0;
const RUN_SPEED = 6.3;
const SNEAK_SPEED = 1.7;
const JUMP_VELOCITY = 9.2;
const GRAVITY = 30;
const REACH = 5;

export let controls: PointerLockControls;
let cameraRef: THREE.PerspectiveCamera;
let pivot: THREE.Object3D;
export const body = makeBody(HALF_WIDTH, HEIGHT);

export let health = MAX_HEALTH;
let invulnerable = 0;
let sinceDamage = 0;
let regenTimer = 0;
let lavaTimer = 0;
let cactusTimer = 0;
let fallStartY = 0;
let wasOnGround = true;
let dead = false;
export let headInWater = false;
export let headInLava = false;
let spawnPoint = new THREE.Vector3(0.5, 20, 0.5);

export const homes: { x: number; y: number; z: number; name: string }[] = [];
export let equippedEtherite = 0;

// ------------------------------------------------------------------ Avatar (bloxd.io style, big eyes)

const defaultSkin = localStorage.getItem('poxel_skin') || '#ffcc99';
const defaultShirt = localStorage.getItem('poxel_shirt') || '#00aaff';
const defaultPants = localStorage.getItem('poxel_pants') || '#0000aa';
const matShirt = new THREE.MeshLambertMaterial({ color: defaultShirt });
const matSkin = new THREE.MeshLambertMaterial({ color: defaultSkin });
const matPants = new THREE.MeshLambertMaterial({ color: defaultPants });
const matShoes = new THREE.MeshLambertMaterial({ color: 0x3a2a1a });
const matHair = new THREE.MeshLambertMaterial({ color: localStorage.getItem('poxel_hair') || '#6b4423' });
const eyeMat = new THREE.MeshBasicMaterial({ color: localStorage.getItem('poxel_eye') || '#000000' });
const eyeWhite = new THREE.MeshBasicMaterial({ color: 0xffffff });
const currentHairStyleId = parseInt(localStorage.getItem('poxel_style') || '0');

export function applyHairGeometry(styleId: number, hair: THREE.Mesh) {
  if (styleId === 1) { hair.geometry = new THREE.BoxGeometry(0.4, 0.25, 0.4); hair.position.set(0, 0.35, 0); }
  else if (styleId === 2) { hair.geometry = new THREE.BoxGeometry(0.52, 0.3, 0.52); hair.position.set(0, 0.35, 0.02); }
  else { hair.geometry = new THREE.BoxGeometry(0.52, 0.12, 0.52); hair.position.set(0, 0.22, 0.01); }
}

// Adds big bloxd-style eyes to a 0.5 head whose front faces -z
export function addBigEyes(head: THREE.Object3D, pupilMat: THREE.Material) {
  const group = new THREE.Group();
  for (const sx of [-1, 1]) {
    const white = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.16, 0.01), eyeWhite);
    white.position.set(sx * 0.11, -0.01, -0.253);
    const pupil = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, 0.012), pupilMat);
    pupil.position.set(sx * 0.11 - sx * 0.025, -0.03, -0.255);
    const shine = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.03, 0.013), eyeWhite);
    shine.position.set(sx * 0.11 - sx * 0.04, 0.0, -0.256);
    group.add(white, pupil, shine);
  }
  head.add(group);
  return group;
}

export let playerAvatar: THREE.Group;
let headPivot: THREE.Group, head: THREE.Mesh, hairMesh: THREE.Mesh, eyes: THREE.Group;
let torso: THREE.Mesh, leftArm: THREE.Group, rightArm: THREE.Group, leftLeg: THREE.Group, rightLeg: THREE.Group;
let armMeshes: THREE.Mesh[] = [], legMeshes: THREE.Mesh[] = [];
let heldItem3p: THREE.Object3D | null = null;
let playerTopHat: THREE.Mesh, playerBackpack: THREE.Mesh, playerNinjaMask: THREE.Mesh;

function limb(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, extra?: THREE.Material): [THREE.Group, THREE.Mesh] {
  const g = new THREE.Group();
  g.position.set(x, y, 0);
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.translate(0, -h / 2, 0);
  const m = new THREE.Mesh(geo, mat);
  g.add(m);
  if (extra) { // shoes / sleeve cuff at the end of the limb
    const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.01, 0.12, d + 0.01), extra);
    cap.position.y = -h + 0.06;
    g.add(cap);
  }
  return [g, m];
}

function buildAvatar(): THREE.Group {
  // Unscaled model is 2.0 tall and 0.8 wide; scaled by 0.9 it matches the 1.8 x 0.72 hitbox
  const root = new THREE.Group();
  const model = new THREE.Group();
  model.scale.setScalar(0.9);
  root.add(model);

  headPivot = new THREE.Group();
  headPivot.position.y = 1.5;
  head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), matSkin);
  head.position.y = 0.25;
  headPivot.add(head);
  hairMesh = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.12, 0.52), matHair);
  applyHairGeometry(currentHairStyleId, hairMesh);
  head.add(hairMesh);
  eyes = addBigEyes(head, eyeMat);
  model.add(headPivot);

  torso = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.75, 0.25), matShirt);
  torso.position.y = 1.125;
  model.add(torso);

  let m: THREE.Mesh;
  // Arms carry a gauntlet cuff (children[1]) that shows when gauntlets are equipped
  [leftArm, m] = limb(0.18, 0.75, 0.18, matSkin, -0.31, 1.5, matSkin); armMeshes.push(m);
  [rightArm, m] = limb(0.18, 0.75, 0.18, matSkin, 0.31, 1.5, matSkin); armMeshes.push(m);
  for (const g of [leftArm, rightArm]) {
    const glove = g.children[1] as THREE.Mesh;
    glove.geometry = new THREE.BoxGeometry(0.2, 0.26, 0.2);
    glove.position.y = -0.75 + 0.13;
    glove.visible = false;
  }
  [leftLeg, m] = limb(0.22, 0.75, 0.22, matPants, -0.11, 0.75, matShoes); legMeshes.push(m);
  [rightLeg, m] = limb(0.22, 0.75, 0.22, matPants, 0.11, 0.75, matShoes); legMeshes.push(m);
  model.add(leftArm, rightArm, leftLeg, rightLeg);
  return root;
}

export function updateAvatarColors(skin: string, shirt: string, pants: string, hairColor?: string, eyeColor?: string, hairStyle?: number, superCosmetic?: string) {
  if (skin) matSkin.color.set(skin);
  if (shirt) matShirt.color.set(shirt);
  if (pants) matPants.color.set(pants);
  if (hairColor) matHair.color.set(hairColor);
  if (eyeColor) eyeMat.color.set(eyeColor);
  if (hairStyle !== undefined && hairMesh) applyHairGeometry(hairStyle, hairMesh);
  if (superCosmetic !== undefined && head && torso) {
    if (!playerTopHat) {
      playerTopHat = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.4), new THREE.MeshLambertMaterial({ color: 0x111111 }));
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.05), new THREE.MeshLambertMaterial({ color: 0x111111 }));
      brim.position.y = -0.2; playerTopHat.add(brim);
      playerTopHat.position.y = 0.45;
      head.add(playerTopHat);
      playerBackpack = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.15), new THREE.MeshLambertMaterial({ color: 0xaa2222 }));
      playerBackpack.position.set(0, 0, 0.2);
      torso.add(playerBackpack);
      playerNinjaMask = new THREE.Mesh(new THREE.BoxGeometry(0.51, 0.51, 0.51), new THREE.MeshLambertMaterial({ color: 0x111111 }));
      const slit = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.52), new THREE.MeshLambertMaterial({ color: 0xffcc99 }));
      slit.position.set(0, 0.1, 0);
      playerNinjaMask.add(slit);
      head.add(playerNinjaMask);
    }
    playerTopHat.visible = superCosmetic === 'tophat';
    playerBackpack.visible = superCosmetic === 'backpack';
    playerNinjaMask.visible = superCosmetic === 'ninja';
  }
  updateArmorVisuals();
}

const ARMOR_COLORS: Record<string, number> = { wood: 0xa07844, iron: 0xd8d8d8, gold: 0xfad64a, diamond: 0x33ebcb, moonstone: 0xd6d0f5, etherite: 0x3a3448 };
const armorMats = new Map<string, THREE.MeshLambertMaterial>();
const armorMat = (type: string | undefined): THREE.MeshLambertMaterial | null => {
  if (!type) return null;
  const tier = type.split('_')[0];
  const col = ARMOR_COLORS[tier];
  if (col === undefined) return null;
  let m = armorMats.get(tier);
  if (!m) { m = new THREE.MeshLambertMaterial({ color: col }); armorMats.set(tier, m); }
  return m;
};

export function updateArmorVisuals() {
  if (!head) return;
  const prev = equippedEtherite;
  equippedEtherite = [55, 56, 57, 58].filter(i => inventory[i]?.type.startsWith('etherite_')).length;
  const helm = armorMat(inventory[55]?.type), chest = armorMat(inventory[56]?.type);
  const legs = armorMat(inventory[57]?.type), boots = armorMat(inventory[58]?.type);
  head.material = helm || matSkin;
  if (hairMesh) hairMesh.visible = !helm;
  if (eyes) eyes.visible = true;
  torso.material = chest || matShirt;
  for (const m of armMeshes) m.material = chest || matSkin;
  for (const m of legMeshes) m.material = legs || matPants;
  for (const g of [leftLeg, rightLeg]) (g.children[1] as THREE.Mesh).material = boots || matShoes;
  const hands = armorMat(inventory[59]?.type);
  for (const g of [leftArm, rightArm]) {
    const glove = g.children[1] as THREE.Mesh;
    glove.visible = !!hands;
    if (hands) glove.material = hands;
  }
  handArm.material = hands || matSkin;
  if (prev !== equippedEtherite) renderHomesSidebar();
}

function armorPoints(): number {
  let pts = 0;
  for (let i = 55; i <= 59; i++) { const it = inventory[i]; if (it) pts += itemDef(it.type).armor?.points || 0; }
  return pts;
}

// Extra damage from gauntlets
function gauntletAttack(): number {
  const g = inventory[59];
  return g ? itemDef(g.type).armor?.attack || 0 : 0;
}

// ------------------------------------------------------------------ First-person hand

export const handScene = new THREE.Scene();
export const handCamera = new THREE.PerspectiveCamera(70, 1, 0.01, 10);
const handLight = new THREE.AmbientLight(0xffffff, 1.6);
handScene.add(handLight);
const handDir = new THREE.DirectionalLight(0xffffff, 1.2);
handDir.position.set(1, 2, 1);
handScene.add(handDir);
const handGroup = new THREE.Group();
handScene.add(handGroup);
const handArm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.6), matSkin);
let handItem: THREE.Object3D | null = null;
let handItemType = '';
let swingTime = 1;
const itemPlaneMats = new Map<string, THREE.MeshLambertMaterial>();

function itemPlaneMat(type: string) {
  let mat = itemPlaneMats.get(type);
  if (!mat) {
    const tex = new THREE.CanvasTexture(getIconCanvas(type));
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.colorSpace = THREE.SRGBColorSpace;
    mat = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide });
    itemPlaneMats.set(type, mat);
  }
  return mat;
}

function makeHeldMesh(type: string, blockSize: number, planeSize: number): THREE.Object3D {
  if (!isFlatItem(type)) return new THREE.Mesh(blockGeometry(itemDef(type).block!, blockSize), blockEntityMaterial);
  return new THREE.Mesh(new THREE.PlaneGeometry(planeSize, planeSize), itemPlaneMat(type));
}

function refreshHeldItem() {
  const it = getSelectedItem();
  const type = it?.type || '';
  if (type === handItemType) return;
  handItemType = type;
  if (handItem) { handGroup.remove(handItem); handItem = null; }
  if (heldItem3p) { rightArm.remove(heldItem3p); heldItem3p = null; }
  if (!type) { handArm.visible = true; return; }
  handArm.visible = false;
  handItem = makeHeldMesh(type, 0.2, 0.34);
  if (isFlatItem(type)) handItem.rotation.set(0, -Math.PI / 2.4, 0.2);
  else handItem.rotation.set(0.2, 0.7, 0);
  handGroup.add(handItem);
  heldItem3p = makeHeldMesh(type, 0.25, 0.45);
  heldItem3p.position.set(0, -0.78, -0.15);
  if (isFlatItem(type)) heldItem3p.rotation.set(0, Math.PI / 2, -Math.PI / 4);
  rightArm.add(heldItem3p);
}

function updateHand(dt: number, moving: number) {
  swingTime = Math.min(1, swingTime + dt / 0.28);
  const s = Math.sin(swingTime * Math.PI);
  const bob = Math.sin(walkPhase * 2) * 0.02 * moving;
  handGroup.position.set(0.5 - s * 0.12, -0.46 + bob - s * 0.05, -0.8 - s * 0.1);
  handGroup.rotation.set(-s * 0.9, s * 0.3, 0);
  handArm.position.set(0.05, -0.05, 0.1);
  handArm.rotation.set(0.2, -0.3, 0);
  if (handItem) handItem.position.set(-0.05, 0.05, -0.05);
  handCamera.aspect = cameraRef.aspect;
  handCamera.fov = cameraRef.fov;
  handCamera.updateProjectionMatrix();
  handGroup.visible = cameraViewMode === 0 && !dead;
}

function swing() { if (swingTime > 0.5) swingTime = 0; }

// ------------------------------------------------------------------ Target highlight & crack

const highlight = new THREE.Group();
{
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)),
    new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.7 }));
  const glow = new THREE.Mesh(new THREE.BoxGeometry(1.006, 1.006, 1.006),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  highlight.add(edges, glow);
  highlight.visible = false;
}
export const crackOverlay = new THREE.Mesh(new THREE.BoxGeometry(1.008, 1.008, 1.008), crackMaterials[0]);
crackOverlay.visible = false;

// ------------------------------------------------------------------ Camera

let cameraViewMode = 0; // 0 first person, 1 behind, 2 in front
const _dir = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _q = new THREE.Quaternion();

function lookDir(out: THREE.Vector3) {
  return out.set(0, 0, -1).applyQuaternion(pivot.quaternion);
}

function updateCamera() {
  if (cameraViewMode === 0) { cameraRef.position.set(0, 0, 0); cameraRef.rotation.set(0, 0, 0); return; }
  // Pull the third-person camera in when a wall is between it and the player
  const back = cameraViewMode === 1 ? 1 : -1;
  _dir.set(0, 0, back).applyQuaternion(pivot.quaternion);
  const hit = raycast(pivot.position, _dir, 4.5);
  const dist = hit ? Math.max(0.3, hit.dist - 0.3) : 4;
  cameraRef.position.set(0, 0, back * Math.min(4, dist));
  cameraRef.rotation.set(0, cameraViewMode === 2 ? Math.PI : 0, 0);
}

// ------------------------------------------------------------------ Init

export function initPlayer(camera: THREE.PerspectiveCamera, scene: THREE.Scene) {
  cameraRef = camera;
  pivot = new THREE.Object3D();
  pivot.add(camera);
  controls = new PointerLockControls(pivot as unknown as THREE.Camera, document.body);
  scene.add(pivot);
  scene.add(crackOverlay);
  scene.add(highlight);

  playerAvatar = buildAvatar();
  playerAvatar.visible = false;
  scene.add(playerAvatar);
  handGroup.add(handArm);
  handCamera.position.set(0, 0, 0);

  ui.initUI(controls);
  ui.setRespawnHandler(respawn);
  setDropHandler((type, count) => dropStack(type, count));
  onInventoryChange(() => { refreshHeldItem(); updateArmorVisuals(); });
  refreshHeldItem();

  actions.primaryDown = () => { if (ui.isPlaying()) onPrimaryDown(); };
  actions.primaryUp = () => { primaryHeld = false; };
  actions.secondaryDown = () => { if (ui.isPlaying()) { secondaryHeld = true; useTimer = 0.25; useItem(); } };
  actions.secondaryUp = () => { secondaryHeld = false; };
  actions.inventory = () => {
    if (ui.state === 'screen') ui.closeGameScreen();
    else if (ui.state === 'playing') ui.toggleScreen('inventory');
  };
  actions.escape = () => {
    if (ui.state === 'screen') ui.closeGameScreen();
    else if (ui.state === 'playing' && isMobile) ui.pause();
    else if (ui.state === 'paused' && isMobile) ui.resume();
  };
  actions.drop = (all) => {
    if (!ui.isPlaying()) return;
    const it = getSelectedItem();
    if (!it) return;
    const n = all ? it.count : 1;
    const type = it.type;
    removeItem(selectedSlotIndex, n);
    dropStack(type, n);
    swing();
  };
  actions.toggleView = () => { cameraViewMode = (cameraViewMode + 1) % 3; };
  actions.setHome = setHome;

  setPlayerFeet(spawnPoint);
}

export function setSpawnPoint(p: THREE.Vector3) { spawnPoint = p.clone(); }

export function setPlayerFeet(p: THREE.Vector3) {
  body.pos.copy(p);
  body.vel.set(0, 0, 0);
  fallStartY = p.y;
  pivot.position.set(p.x, p.y + EYE_HEIGHT, p.z);
}

export function getYawPitch() {
  const e = new THREE.Euler().setFromQuaternion(pivot.quaternion, 'YXZ');
  return { yaw: e.y, pitch: e.x };
}

export function setYawPitch(yaw: number, pitch: number) {
  pivot.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
}

export function setHealth(h: number) {
  health = Math.max(1, Math.min(MAX_HEALTH, Math.round(h)));
  dead = false;
  ui.renderHealth(health, MAX_HEALTH);
}

export function resetPlayer() {
  homes.length = 0;
  setHealth(MAX_HEALTH);
  cameraViewMode = 0;
  renderHomesSidebar();
}

// ------------------------------------------------------------------ Health

export function damagePlayer(amount: number, from: THREE.Vector3 | null, cause: string) {
  if (dead || invulnerable > 0 || amount <= 0) return;
  let dmg = amount;
  if (cause !== 'fall' && cause !== 'lava') dmg *= 1 - Math.min(20, armorPoints()) * 0.04;
  dmg = Math.max(1, Math.round(dmg));
  health = Math.max(0, health - dmg);
  invulnerable = 0.5;
  sinceDamage = 0;
  ui.flashHurt();
  ui.renderHealth(health, MAX_HEALTH);
  hurtTilt = 1;
  if (from) {
    const dx = body.pos.x - from.x, dz = body.pos.z - from.z, d = Math.hypot(dx, dz) || 1;
    body.vel.x += (dx / d) * 7; body.vel.z += (dz / d) * 7; body.vel.y = Math.max(body.vel.y, 5);
  }
  if (health <= 0) die(cause);
}

const DEATH_MESSAGES: Record<string, string> = {
  fall: 'You hit the ground too hard', lava: 'You tried to swim in lava', zombie: 'You were slain by a Zombie',
  cactus: 'You were pricked to death', void: 'You fell out of the world',
};

function die(cause: string) {
  dead = true;
  primaryHeld = secondaryHeld = false;
  // Drop everything where you died
  const at = body.pos.clone().setY(body.pos.y + 1);
  for (let i = 0; i < inventory.length; i++) {
    const it = inventory[i];
    if (it && i !== 54) spawnItem(it.type, it.count, at, new THREE.Vector3((Math.random() - 0.5) * 6, 4, (Math.random() - 0.5) * 6), 1);
  }
  clearInventory();
  ui.showDeath(DEATH_MESSAGES[cause] || 'You died!');
}

function respawn() {
  loadAreaNow(spawnPoint.x, spawnPoint.z, 1);
  setPlayerFeet(spawnPoint);
  setHealth(MAX_HEALTH);
  ui.resume();
}

function eat(type: string): boolean {
  const food = itemDef(type).food;
  if (!food || health >= MAX_HEALTH) return false;
  health = Math.min(MAX_HEALTH, health + food);
  ui.renderHealth(health, MAX_HEALTH);
  removeItem(selectedSlotIndex, 1);
  ui.toast(`Ate ${itemDef(type).name} (+${food / 2} ♥)`);
  return true;
}

// ------------------------------------------------------------------ Mining, attacking, placing

let primaryHeld = false;
let secondaryHeld = false;
let useTimer = 0;
let attackCooldown = 0;
let breakCooldown = 0;
let mineKey = '';
let mineProgress = 0;
let target: RayHit | null = null;

function eyePos() { return _eye.copy(pivot.position); }

function onPrimaryDown() {
  swing();
  lookDir(_dir);
  const eye = eyePos();
  const mobHit = rayHitMob(eye, _dir, 3.5);
  const blockHit = raycast(eye, _dir, REACH);
  if (mobHit && (!blockHit || mobHit.dist < blockHit.dist)) {
    if (attackCooldown <= 0) {
      const held = getSelectedItem();
      const dmg = (held ? itemDef(held.type).damage || 1 : 1) + gauntletAttack();
      damageMob(mobHit.mob, dmg, body.pos);
      attackCooldown = 0.35;
    }
    return;
  }
  primaryHeld = true;
}

function breakBlock(hit: RayHit) {
  const held = getSelectedItem()?.type || null;
  const info = miningInfo(hit.id, held);
  const key = `${hit.x},${hit.y},${hit.z}`;
  setBlock(hit.x, hit.y, hit.z, 0);
  const center = new THREE.Vector3(hit.x + 0.5, hit.y + 0.3, hit.z + 0.5);

  if (hit.id === BLOCK_ID.furnace) {
    const f = furnaces.get(key);
    if (f) for (const s of [f.input, f.fuel, f.output]) if (s) spawnItem(s.type, s.count, center);
    furnaces.delete(key);
  }
  if (info.drops) {
    let drop = BLOCKS[hit.id].drop;
    if (hit.id === BLOCK_ID.gravel && Math.random() < 0.1) drop = 'flint';
    if (hit.id === BLOCK_ID.leaves) drop = Math.random() < 0.05 ? 'apple' : Math.random() < 0.05 ? 'stick' : null;
    if (drop) spawnItem(drop, 1, center);
  } else if (BLOCKS[hit.id].harvestTier >= 0) {
    ui.toast('You need a better pickaxe to get anything from this');
  }

  // Plants on top lose their support
  const above = getBlock(hit.x, hit.y + 1, hit.z);
  if (isPlant(above)) {
    setBlock(hit.x, hit.y + 1, hit.z, 0);
    const d = BLOCKS[above].drop;
    if (d) spawnItem(d, 1, center.clone().setY(center.y + 1));
  }

  // Neighbouring water/lava flows into the hole (and keeps falling)
  flowInto(hit.x, hit.y, hit.z);
}

function flowInto(x: number, y: number, z: number) {
  const nbs = [getBlock(x, y + 1, z), getBlock(x + 1, y, z), getBlock(x - 1, y, z), getBlock(x, y, z + 1), getBlock(x, y, z - 1)];
  const liquid = nbs.includes(LAVA) ? LAVA : nbs.includes(WATER) ? WATER : 0;
  if (!liquid) return;
  let yy = y;
  for (let i = 0; i < 24 && getBlock(x, yy, z) === 0; i++, yy--) setBlock(x, yy, z, liquid);
}

function playerOverlapsBlock(x: number, y: number, z: number) {
  const p = body.pos;
  return p.x + HALF_WIDTH > x && p.x - HALF_WIDTH < x + 1 && p.z + HALF_WIDTH > z && p.z - HALF_WIDTH < z + 1 &&
    p.y + HEIGHT > y && p.y < y + 1;
}

function useItem() {
  swing();
  lookDir(_dir);
  const hit = raycast(eyePos(), _dir, REACH);
  const held = getSelectedItem();

  if (hit && !keys.shift) {
    if (hit.id === BLOCK_ID.crafting_table) { secondaryHeld = false; ui.toggleScreen('table'); return; }
    if (hit.id === BLOCK_ID.furnace) { secondaryHeld = false; ui.toggleScreen('furnace', `${hit.x},${hit.y},${hit.z}`); return; }
  }
  if (!held) return;
  const def = itemDef(held.type);
  if (def.food) { eat(held.type); return; }
  if (def.block === undefined || !hit) return;

  // Clicking a plant replaces it (like Minecraft) instead of stacking on its neighbour
  const replacePlant = isPlant(hit.id);
  const px = replacePlant ? hit.x : hit.x + hit.nx, py = replacePlant ? hit.y : hit.y + hit.ny, pz = replacePlant ? hit.z : hit.z + hit.nz;
  const existing = getBlock(px, py, pz);
  if (existing !== 0 && existing !== WATER && existing !== LAVA && !isPlant(existing)) return;
  if (BLOCKS[def.block].plant) {
    const below = getBlock(px, py - 1, pz);
    if (below !== BLOCK_ID.grass && below !== BLOCK_ID.dirt && below !== BLOCK_ID.snowy_grass) return;
  } else if (playerOverlapsBlock(px, py, pz) || mobInBlock(px, py, pz)) return;
  if (isFacingBlock(def.block)) {
    // Front faces the player
    const { yaw } = getYawPitch();
    const lx = -Math.sin(yaw), lz = -Math.cos(yaw);
    const f = Math.abs(lx) > Math.abs(lz) ? (lx > 0 ? 3 : 1) : (lz > 0 ? 2 : 0);
    facing.set(`${px},${py},${pz}`, f);
  }
  setBlock(px, py, pz, def.block);
  removeItem(selectedSlotIndex, 1);
}

function dropStack(type: string, count: number) {
  lookDir(_dir);
  const from = eyePos().clone().addScaledVector(_dir, 0.4);
  from.y -= 0.3;
  spawnItem(type, count, from, _dir.clone().multiplyScalar(6).add(new THREE.Vector3(0, 2, 0)), 1.5);
}

function updateTargeting(dt: number) {
  lookDir(_dir);
  target = ui.isPlaying() ? raycast(eyePos(), _dir, REACH) : null;
  if (target) {
    highlight.visible = true;
    highlight.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5);
  } else highlight.visible = false;

  breakCooldown = Math.max(0, breakCooldown - dt);
  attackCooldown = Math.max(0, attackCooldown - dt);
  if (!primaryHeld || !target || breakCooldown > 0) { crackOverlay.visible = false; if (!primaryHeld) mineKey = ''; return; }

  const key = `${target.x},${target.y},${target.z}`;
  if (key !== mineKey) { mineKey = key; mineProgress = 0; }
  const info = miningInfo(target.id, getSelectedItem()?.type || null);
  if (info.time === Infinity) { crackOverlay.visible = false; return; }
  mineProgress += dt / info.time;
  if (swingTime >= 1) swing();
  crackOverlay.visible = true;
  crackOverlay.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5);
  crackOverlay.material = crackMaterials[Math.min(10, Math.floor(mineProgress * 10))];
  if (mineProgress >= 1) {
    breakBlock(target);
    mineKey = '';
    mineProgress = 0;
    breakCooldown = 0.2;
    crackOverlay.visible = false;
  }
}

// ------------------------------------------------------------------ Homes (etherite armor)

function setHome() {
  if (!ui.isPlaying() || equippedEtherite <= 0) return;
  const p = { x: body.pos.x, y: body.pos.y, z: body.pos.z };
  if (homes.length < equippedEtherite) homes.push({ ...p, name: `Home ${homes.length + 1}` });
  else homes[homes.length - 1] = { ...p, name: `Home ${homes.length}` };
  ui.toast('Home set!');
  renderHomesSidebar();
}

export function renderHomesSidebar() {
  const sidebar = document.getElementById('homes-sidebar');
  const list = document.getElementById('homes-list');
  if (!sidebar || !list) return;
  if (equippedEtherite <= 0) { sidebar.style.display = 'none'; return; }
  sidebar.style.display = 'block';
  list.innerHTML = '';
  for (let i = 0; i < equippedEtherite; i++) {
    const li = document.createElement('li');
    const home = homes[i];
    if (home) {
      li.className = 'home-point';
      li.innerText = home.name;
      li.onclick = () => {
        loadAreaNow(home.x, home.z, 1);
        setPlayerFeet(new THREE.Vector3(home.x, home.y, home.z));
      };
    } else {
      li.className = 'home-point empty-home';
      li.innerText = `[Empty Slot ${i + 1}]`;
    }
    list.appendChild(li);
  }
}

// ------------------------------------------------------------------ Update

let walkPhase = 0;
let hurtTilt = 0;

function touchesBlock(id: number): boolean {
  const p = body.pos, e = 0.05;
  for (let x = Math.floor(p.x - HALF_WIDTH - e); x <= Math.floor(p.x + HALF_WIDTH + e); x++)
    for (let y = Math.floor(p.y); y <= Math.floor(p.y + HEIGHT - 0.01); y++)
      for (let z = Math.floor(p.z - HALF_WIDTH - e); z <= Math.floor(p.z + HALF_WIDTH + e); z++)
        if (getBlock(x, y, z) === id) return true;
  return false;
}

export function updatePlayer(dt: number) {
  const playing = ui.isPlaying();

  // Mobile look
  if (isMobile && (touchLookDelta.x || touchLookDelta.y)) {
    const e = new THREE.Euler(0, 0, 0, 'YXZ').setFromQuaternion(pivot.quaternion);
    e.y -= touchLookDelta.x * 0.005;
    e.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, e.x - touchLookDelta.y * 0.005));
    pivot.quaternion.setFromEuler(e);
    touchLookDelta.x = touchLookDelta.y = 0;
  }

  if (!playing) {
    highlight.visible = false;
    crackOverlay.visible = false;
    updateVisuals(dt, 0);
    return;
  }

  const { yaw } = getYawPitch();
  const b = body;

  // --- Horizontal movement
  const fwd = Number(keys.forward) - Number(keys.backward);
  const strafe = Number(keys.right) - Number(keys.left);
  let speed = keys.shift ? SNEAK_SPEED : keys.run ? RUN_SPEED : WALK_SPEED;
  if (b.inWater) speed *= 0.55;
  if (b.inLava) speed *= 0.35;
  let mx = 0, mz = 0;
  if (fwd || strafe) {
    const len = Math.hypot(fwd, strafe);
    const f = fwd / len, s = strafe / len;
    mx = (-Math.sin(yaw) * f + Math.cos(yaw) * s) * speed;
    mz = (-Math.cos(yaw) * f - Math.sin(yaw) * s) * speed;
  }
  const accel = Math.min(1, dt * (b.onGround ? 14 : b.inWater || b.inLava ? 5 : 4));
  b.vel.x += (mx - b.vel.x) * accel;
  b.vel.z += (mz - b.vel.z) * accel;

  // --- Vertical: gravity, jumping, swimming
  if (b.inWater || b.inLava) {
    const sink = b.inLava ? 2 : 3;
    b.vel.y = Math.max(b.vel.y - 12 * dt, -sink);
    if (keys.jump) b.vel.y = Math.min(b.vel.y + 30 * dt, b.inLava ? 2.5 : 4);
    // Hop out onto a ledge when swimming into a wall
    if (keys.jump && b.hitWall) b.vel.y = 6.5;
    fallStartY = b.pos.y;
  } else {
    b.vel.y = Math.max(b.vel.y - GRAVITY * dt, -55);
    if (keys.jump && b.onGround) b.vel.y = JUMP_VELOCITY;
  }

  // Sneaking keeps you from walking off edges
  if (keys.shift && b.onGround) {
    if (!hasGroundBelow(b, b.pos.x + b.vel.x * dt, b.pos.z)) b.vel.x = 0;
    if (!hasGroundBelow(b, b.pos.x, b.pos.z + b.vel.z * dt)) b.vel.z = 0;
  }

  const beforeX = b.pos.x, beforeZ = b.pos.z;
  const wantX = b.vel.x, wantZ = b.vel.z;
  moveBody(b, dt);

  // Auto step-up (bloxd style) when walking into a 1-block ledge
  if (b.hitWall && b.onGround && !keys.shift && (fwd || strafe) &&
      !boxIntersectsSolid(beforeX + wantX * dt * 3, b.pos.y + 1.05, beforeZ + wantZ * dt * 3, HALF_WIDTH, HEIGHT)) {
    b.vel.y = JUMP_VELOCITY;
  }

  // --- Fall damage on landing
  if (!b.onGround && !b.inWater) fallStartY = Math.max(fallStartY, b.pos.y);
  if (b.onGround && !wasOnGround) {
    const fell = fallStartY - b.pos.y;
    if (fell > 3.5) damagePlayer(Math.floor(fell - 3), null, 'fall');
  }
  if (b.onGround || b.inWater) fallStartY = b.pos.y;
  wasOnGround = b.onGround;

  // --- Hazards
  invulnerable = Math.max(0, invulnerable - dt);
  sinceDamage += dt;
  if (b.inLava) {
    lavaTimer -= dt;
    if (lavaTimer <= 0) { lavaTimer = 0.5; invulnerable = 0; damagePlayer(2, null, 'lava'); }
  } else lavaTimer = 0;
  cactusTimer -= dt;
  if (cactusTimer <= 0 && touchesBlock(BLOCK_ID.cactus)) { cactusTimer = 0.5; damagePlayer(1, null, 'cactus'); }
  if (b.pos.y < -140) { invulnerable = 0; damagePlayer(100, null, 'void'); }

  // --- Natural regeneration (no hunger yet)
  if (health < MAX_HEALTH && sinceDamage > 4 && !dead) {
    regenTimer += dt;
    if (regenTimer > 2.5) { regenTimer = 0; health++; ui.renderHealth(health, MAX_HEALTH); }
  }

  pivot.position.set(b.pos.x, b.pos.y + EYE_HEIGHT, b.pos.z);
  headInWater = isHeadInWater(pivot.position);
  headInLava = getBlock(Math.floor(pivot.position.x), Math.floor(pivot.position.y), Math.floor(pivot.position.z)) === LAVA;
  ui.setUnderwater(headInLava ? 'lava' : headInWater ? 'water' : 'none');

  // Hold right click to keep placing (for pillaring up while jumping)
  if (secondaryHeld) {
    useTimer -= dt;
    if (useTimer <= 0) { useTimer = 0.22; useItem(); }
  }

  updateTargeting(dt);
  const hs = Math.hypot(b.vel.x, b.vel.z);
  updateVisuals(dt, hs);

  // Sprint FOV
  const targetFov = keys.run && hs > 5.5 ? 80 : 75;
  if (Math.abs(cameraRef.fov - targetFov) > 0.1) { cameraRef.fov += (targetFov - cameraRef.fov) * Math.min(1, dt * 8); cameraRef.updateProjectionMatrix(); }
}

function updateVisuals(dt: number, hspeed: number) {
  const { yaw, pitch } = getYawPitch();
  walkPhase += dt * hspeed * 1.6;
  playerAvatar.visible = cameraViewMode !== 0;
  playerAvatar.position.copy(body.pos);
  playerAvatar.rotation.y = yaw;
  headPivot.rotation.x = pitch * 0.8;
  const sw = Math.sin(walkPhase * 2) * Math.min(0.8, hspeed * 0.15);
  leftLeg.rotation.x = sw; rightLeg.rotation.x = -sw;
  leftArm.rotation.x = -sw;
  const s = Math.sin(swingTime * Math.PI);
  rightArm.rotation.x = sw - s * 1.4 - (heldItem3p ? 0.3 : 0);
  torso.position.y = keys.shift && ui.isPlaying() ? 1.08 : 1.125;

  refreshHeldItem(); // cheap no-op unless the selected item type changed (slot switch, pickup, craft)
  hurtTilt = Math.max(0, hurtTilt - dt * 4);
  if (cameraViewMode === 0) {
    updateCamera();
    cameraRef.rotation.z = Math.sin(hurtTilt * Math.PI) * 0.08;
  } else updateCamera();
  updateHand(dt, Math.min(1, hspeed / 5));
  void _q;
}

export function isDead() { return dead; }
export { armorPoints };
