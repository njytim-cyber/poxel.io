// Local player: input, predicted movement, camera, first-person hand and block targeting.
// The server is authoritative for everything that changes the world or your stats; this file
// predicts the obvious results (movement, block breaks/placements) so the game feels instant.
import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { crackMaterials } from './textures';
import { keys, isMobile, touchLookDelta, actions } from './input';
import { getBlock, setBlock, raycast, facing, isLoaded, type RayHit } from './world';
import { BLOCKS, BLOCK_ID, WATER, LAVA, isFacingBlock, isPlant, itemDef, miningInfo } from '../shared/blocks.ts';
import { makeBody, moveBody, boxIntersectsSolid, hasGroundBelow, PLAYER_EYE, PLAYER_HALF_WIDTH, PLAYER_HEIGHT, GRAVITY } from '../shared/physics.ts';
import { MF_GROUND, MF_SNEAK, MF_WATER, MF_LAVA } from '../shared/protocol.ts';
import { inventory, selectedSlotIndex, getSelectedItem, onInventoryChange, predictUseSelected } from './inventory';
import { createAvatar, makeHeldMesh, savedLook, disposeOwned, type Avatar } from './avatar';
import { isFlatItem } from './textures';
import { rayHitEntity, entityInBlock } from './remote';
import { send } from './net';
import type { Look } from '../shared/protocol.ts';
import * as ui from './ui';

export const EYE_HEIGHT = PLAYER_EYE;
const HALF_WIDTH = PLAYER_HALF_WIDTH;
const HEIGHT = PLAYER_HEIGHT;
export const MAX_HEALTH = 20; // 10 hearts
const WALK_SPEED = 5.0;
const RUN_SPEED = 6.3;
const SNEAK_SPEED = 1.7;
const JUMP_VELOCITY = 9.2;
const REACH = 5;

const world = (x: number, y: number, z: number) => getBlock(x, y, z);

export let controls: PointerLockControls;
let cameraRef: THREE.PerspectiveCamera;
let pivot: THREE.Object3D;
export const body = makeBody(HALF_WIDTH, HEIGHT, new THREE.Vector3(), new THREE.Vector3()) as ReturnType<typeof makeBody> & { pos: THREE.Vector3; vel: THREE.Vector3 };

export let health = MAX_HEALTH;
let dead = false;
export let headInWater = false;
export let headInLava = false;
let wasOnGround = true;

// ------------------------------------------------------------------ Avatar (third person)

export let playerAvatar: Avatar;

export function updateLocalLook(look: Look) {
  playerAvatar?.setLook(look);
}

function refreshEquipment() {
  if (!playerAvatar) return;
  playerAvatar.setArmor(inventory.slice(55, 60).map(s => s?.type || null));
  const held = getSelectedItem()?.type || '';
  playerAvatar.setHeld(held);
  refreshHeldItem(held);
  handArm.material = inventory[59] ? gauntletHandMat : playerAvatar.skinMat;
}

// ------------------------------------------------------------------ First-person hand

export const handScene = new THREE.Scene();
export const handCamera = new THREE.PerspectiveCamera(70, 1, 0.01, 10);
handScene.add(new THREE.AmbientLight(0xffffff, 1.6));
const handDir = new THREE.DirectionalLight(0xffffff, 1.2);
handDir.position.set(1, 2, 1);
handScene.add(handDir);
const handGroup = new THREE.Group();
handScene.add(handGroup);
const handArm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.6), new THREE.MeshLambertMaterial({ color: 0xffcc99 }));
const gauntletHandMat = new THREE.MeshLambertMaterial({ color: 0xcccccc });
let handItem: THREE.Object3D | null = null;
let handItemType = '';
let swingTime = 1;
let walkPhase = 0;

function refreshHeldItem(type: string) {
  if (type === handItemType) return;
  handItemType = type;
  if (handItem) { handGroup.remove(handItem); disposeOwned(handItem); handItem = null; }
  handArm.visible = !type;
  if (!type) return;
  handItem = makeHeldMesh(type, 0.2, 0.34);
  if (isFlatItem(type)) handItem.rotation.set(0, -Math.PI / 2.4, 0.2);
  else handItem.rotation.set(0.2, 0.7, 0);
  handGroup.add(handItem);
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

function swing() {
  if (swingTime > 0.5) { swingTime = 0; send({ t: 'swing' }); }
}

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

function lookDir(out: THREE.Vector3) { return out.set(0, 0, -1).applyQuaternion(pivot.quaternion); }
function eyePos() { return _eye.copy(pivot.position); }

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

  playerAvatar = createAvatar(savedLook());
  playerAvatar.root.visible = false;
  scene.add(playerAvatar.root);
  handArm.material = playerAvatar.skinMat;
  handGroup.add(handArm);

  ui.initUI(controls);
  // Leave the death screen right away (inside the click, so the mouse can be captured again);
  // the server moves us to spawn and restores health
  ui.setRespawnHandler(() => { send({ t: 'respawn' }); ui.resume(); });
  onInventoryChange(refreshEquipment);

  actions.primaryDown = () => { if (ui.isPlaying()) onPrimaryDown(); };
  actions.primaryUp = () => { primaryHeld = false; };
  actions.secondaryDown = () => { if (ui.isPlaying()) { secondaryHeld = true; useTimer = 0.25; useItem(); } };
  actions.secondaryUp = () => { secondaryHeld = false; };
  actions.inventory = () => {
    if (ui.state === 'screen') ui.closeGameScreen();
    else if (ui.state === 'playing') ui.openGameScreen('inventory');
  };
  actions.escape = () => {
    if (ui.state === 'screen') ui.closeGameScreen();
    else if (ui.state === 'chat') ui.closeChat();
    else if (ui.state === 'playing' && isMobile) ui.pause();
    else if (ui.state === 'paused' && isMobile) ui.resume();
  };
  actions.drop = all => {
    if (!ui.isPlaying() || !getSelectedItem()) return;
    send({ t: 'drop', all });
    swing();
  };
  actions.toggleView = () => { cameraViewMode = (cameraViewMode + 1) % 3; };
  actions.setHome = () => { if (ui.isPlaying()) send({ t: 'sethome' }); };
  actions.chat = (prefill: string) => ui.openChat(prefill);
}

export function setPlayerFeet(p: { x: number; y: number; z: number }) {
  body.pos.set(p.x, p.y, p.z);
  body.vel.set(0, 0, 0);
  pivot.position.set(p.x, p.y + EYE_HEIGHT, p.z);
  lastSent.x = NaN;
}

export function getYawPitch() {
  const e = new THREE.Euler().setFromQuaternion(pivot.quaternion, 'YXZ');
  return { yaw: e.y, pitch: e.x };
}

export function setYawPitch(yaw: number, pitch: number) {
  pivot.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
}

// ------------------------------------------------------------------ Server events

export function onHealth(hp: number) {
  const wasDead = dead;
  health = hp;
  if (hp > 0 && wasDead) dead = false;
  ui.renderHealth(health, MAX_HEALTH);
}

export function onHurt(from: [number, number, number] | null, knock: number) {
  ui.flashHurt();
  hurtTilt = 1;
  if (from && knock) {
    const dx = body.pos.x - from[0], dz = body.pos.z - from[2], d = Math.hypot(dx, dz) || 1;
    body.vel.x += (dx / d) * knock; body.vel.z += (dz / d) * knock; body.vel.y = Math.max(body.vel.y, 5);
  }
}

export function onDeath(msg: string) {
  dead = true;
  primaryHeld = secondaryHeld = false;
  ui.showDeath(msg);
}

export function resetPlayerState(hp: number) {
  dead = false;
  health = hp;
  cameraViewMode = 0;
  ui.renderHealth(health, MAX_HEALTH);
}

export function onHomes(list: { x: number; y: number; z: number; name: string }[], slots: number) {
  const sidebar = document.getElementById('homes-sidebar');
  const ul = document.getElementById('homes-list');
  if (!sidebar || !ul) return;
  if (slots <= 0) { sidebar.style.display = 'none'; return; }
  sidebar.style.display = 'block';
  ul.innerHTML = '';
  for (let i = 0; i < slots; i++) {
    const li = document.createElement('li');
    const home = list[i];
    li.className = home ? 'home-point' : 'home-point empty-home';
    li.innerText = home ? home.name : `[Empty Slot ${i + 1}]`;
    if (home) li.onclick = () => send({ t: 'gohome', i });
    ul.appendChild(li);
  }
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

function onPrimaryDown() {
  swing();
  lookDir(_dir);
  const eye = eyePos();
  const entHit = rayHitEntity(eye, _dir, 3.5);
  const blockHit = raycast(eye, _dir, REACH);
  if (entHit && (!blockHit || entHit.dist < blockHit.dist)) {
    if (attackCooldown <= 0) { send({ t: 'attack', eid: entHit.eid }); attackCooldown = 0.3; }
    return;
  }
  primaryHeld = true;
}

function breakBlock(hit: RayHit) {
  // Predict the break; the server spawns drops and corrects us if it disagrees
  setBlock(hit.x, hit.y, hit.z, 0);
  if (isPlant(getBlock(hit.x, hit.y + 1, hit.z))) setBlock(hit.x, hit.y + 1, hit.z, 0);
  send({ t: 'dig', x: hit.x, y: hit.y, z: hit.z });
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

  if (hit && !keys.shift && (hit.id === BLOCK_ID.crafting_table || hit.id === BLOCK_ID.furnace)) {
    secondaryHeld = false;
    ui.expectScreen();
    send({ t: 'open', x: hit.x, y: hit.y, z: hit.z });
    return;
  }
  if (!held) return;
  const def = itemDef(held.type);
  if (def.food) { if (health < MAX_HEALTH) send({ t: 'eat' }); return; }
  if (def.block === undefined || !hit) return;

  // Clicking a plant replaces it instead of stacking on its neighbour
  const replacePlant = isPlant(hit.id);
  const px = replacePlant ? hit.x : hit.x + hit.nx, py = replacePlant ? hit.y : hit.y + hit.ny, pz = replacePlant ? hit.z : hit.z + hit.nz;
  const existing = getBlock(px, py, pz);
  if (existing !== 0 && existing !== WATER && existing !== LAVA && !isPlant(existing)) return;
  if (BLOCKS[def.block].plant) {
    const below = getBlock(px, py - 1, pz);
    if (below !== BLOCK_ID.grass && below !== BLOCK_ID.dirt && below !== BLOCK_ID.snowy_grass) return;
  } else if (playerOverlapsBlock(px, py, pz) || entityInBlock(px, py, pz)) return;
  let f = 0;
  if (isFacingBlock(def.block)) {
    // Front faces the player
    const { yaw } = getYawPitch();
    const lx = -Math.sin(yaw), lz = -Math.cos(yaw);
    f = Math.abs(lx) > Math.abs(lz) ? (lx > 0 ? 3 : 1) : (lz > 0 ? 2 : 0);
    facing.set(`${px},${py},${pz}`, f);
  }
  setBlock(px, py, pz, def.block);
  predictUseSelected();
  send({ t: 'place', x: px, y: py, z: pz, nx: hit.nx, ny: hit.ny, nz: hit.nz, facing: f });
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

// ------------------------------------------------------------------ Update

let hurtTilt = 0;
let moveTimer = 0;
const lastSent = { x: NaN, y: 0, z: 0, yaw: 0, pitch: 0, flags: 0, age: 0 };

function sendMove(dt: number) {
  moveTimer -= dt;
  lastSent.age += dt;
  if (moveTimer > 0) return;
  moveTimer = 0.05; // 20 per second
  const { yaw, pitch } = getYawPitch();
  const b = body;
  const flags = (b.onGround ? MF_GROUND : 0) | (keys.shift ? MF_SNEAK : 0) | (b.inWater ? MF_WATER : 0) | (b.inLava ? MF_LAVA : 0);
  const moved = Math.abs(b.pos.x - lastSent.x) + Math.abs(b.pos.y - lastSent.y) + Math.abs(b.pos.z - lastSent.z) > 0.002 ||
    Math.abs(yaw - lastSent.yaw) + Math.abs(pitch - lastSent.pitch) > 0.002 || flags !== lastSent.flags;
  if (!moved && lastSent.age < 1) return;
  Object.assign(lastSent, { x: b.pos.x, y: b.pos.y, z: b.pos.z, yaw, pitch, flags, age: 0 });
  send({ t: 'move', x: b.pos.x, y: b.pos.y, z: b.pos.z, yaw, pitch, flags });
}

export function updatePlayer(dt: number) {
  const playing = ui.isPlaying();

  if (isMobile && (touchLookDelta.x || touchLookDelta.y)) {
    const e = new THREE.Euler(0, 0, 0, 'YXZ').setFromQuaternion(pivot.quaternion);
    e.y -= touchLookDelta.x * 0.005;
    e.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, e.x - touchLookDelta.y * 0.005));
    pivot.quaternion.setFromEuler(e);
    touchLookDelta.x = touchLookDelta.y = 0;
  }

  const b = body;
  const active = ui.state !== 'menu' && !dead;
  // Physics keeps running while menus are open (the world doesn't pause in multiplayer),
  // but input only counts while actually playing. Wait for terrain before simulating.
  if (active && isLoaded(Math.floor(b.pos.x), Math.floor(b.pos.z))) {
    const { yaw } = getYawPitch();
    const fwd = playing ? Number(keys.forward) - Number(keys.backward) : 0;
    const strafe = playing ? Number(keys.right) - Number(keys.left) : 0;
    const sneak = playing && keys.shift;
    let speed = sneak ? SNEAK_SPEED : keys.run ? RUN_SPEED : WALK_SPEED;
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

    const jump = playing && keys.jump;
    if (b.inWater || b.inLava) {
      b.vel.y = Math.max(b.vel.y - 12 * dt, -(b.inLava ? 2 : 3));
      if (jump) b.vel.y = Math.min(b.vel.y + 30 * dt, b.inLava ? 2.5 : 4);
      if (jump && b.hitWall) b.vel.y = 6.5; // hop out onto a ledge
    } else {
      b.vel.y = Math.max(b.vel.y - GRAVITY * dt, -55);
      if (jump && b.onGround) b.vel.y = JUMP_VELOCITY;
    }
    // Sneaking keeps you from walking off edges
    if (sneak && b.onGround) {
      if (!hasGroundBelow(world, b, b.pos.x + b.vel.x * dt, b.pos.z)) b.vel.x = 0;
      if (!hasGroundBelow(world, b, b.pos.x, b.pos.z + b.vel.z * dt)) b.vel.z = 0;
    }
    const beforeX = b.pos.x, beforeZ = b.pos.z, wantX = b.vel.x, wantZ = b.vel.z;
    moveBody(world, b, dt);
    // Auto step-up (bloxd style) when walking into a 1-block ledge
    if (b.hitWall && b.onGround && !sneak && (fwd || strafe) &&
        !boxIntersectsSolid(world, beforeX + wantX * dt * 3, b.pos.y + 1.05, beforeZ + wantZ * dt * 3, HALF_WIDTH, HEIGHT)) {
      b.vel.y = JUMP_VELOCITY;
    }
    wasOnGround = b.onGround;
    pivot.position.set(b.pos.x, b.pos.y + EYE_HEIGHT, b.pos.z);
    sendMove(dt);
  }
  void wasOnGround;

  headInWater = getBlock(Math.floor(pivot.position.x), Math.floor(pivot.position.y), Math.floor(pivot.position.z)) === WATER;
  headInLava = getBlock(Math.floor(pivot.position.x), Math.floor(pivot.position.y), Math.floor(pivot.position.z)) === LAVA;
  ui.setUnderwater(headInLava ? 'lava' : headInWater ? 'water' : 'none');

  if (playing && secondaryHeld) {
    useTimer -= dt;
    if (useTimer <= 0) { useTimer = 0.22; useItem(); }
  }
  if (playing) updateTargeting(dt);
  else { highlight.visible = false; crackOverlay.visible = false; }

  const hs = Math.hypot(b.vel.x, b.vel.z);
  walkPhase += dt * hs * 1.6;
  const { yaw, pitch } = getYawPitch();
  playerAvatar.root.visible = cameraViewMode !== 0 && ui.state !== 'menu';
  playerAvatar.root.position.copy(b.pos);
  playerAvatar.root.rotation.y = yaw;
  playerAvatar.animate(dt, hs, pitch, keys.shift && playing, swingTime);
  hurtTilt = Math.max(0, hurtTilt - dt * 4);
  updateCamera();
  if (cameraViewMode === 0) cameraRef.rotation.z = Math.sin(hurtTilt * Math.PI) * 0.08;
  updateHand(dt, Math.min(1, hs / 5));

  const targetFov = keys.run && hs > 5.5 ? 80 : 75;
  if (Math.abs(cameraRef.fov - targetFov) > 0.1) { cameraRef.fov += (targetFov - cameraRef.fov) * Math.min(1, dt * 8); cameraRef.updateProjectionMatrix(); }
}

export function isDead() { return dead; }
void selectedSlotIndex;
