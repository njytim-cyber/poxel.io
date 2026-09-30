// Renders server-owned entities (other players, mobs, dropped items) with snapshot interpolation.
import * as THREE from 'three';
import { createAvatar, disposeOwned, type Avatar } from './avatar';
import { blockGeometry, blockEntityMaterial, getIconCanvas, isFlatItem } from './textures';
import { itemDef } from '../shared/blocks.ts';
import { MOB_SPECS } from '../shared/mobs.ts';
import { PLAYER_HALF_WIDTH, PLAYER_HEIGHT, rayHitsBox, type Vec3 } from '../shared/physics.ts';
import { EF_SNEAK, EF_HURT, EF_DYING, EF_SWING, EF_DOWNED, type SpawnInfo, type EntityKind, type MobKind } from '../shared/protocol.ts';

const INTERP_DELAY = 110; // ms behind the newest snapshot, smooths out network jitter

interface Sample { t: number; x: number; y: number; z: number; yaw: number; pitch: number; flags: number }
interface MobModel { model: THREE.Group; parts: { mesh: THREE.Mesh; swing: number }[]; mats: THREE.MeshLambertMaterial[] }
interface View {
  eid: number; kind: EntityKind; obj: THREE.Object3D; samples: Sample[];
  pos: THREE.Vector3; yaw: number; pitch: number; flags: number; hspeed: number;
  avatar?: Avatar; mob?: MobModel; name?: string; owner?: string;
  swing: number; walk: number; age: number; dying: number;
}

let scene: THREE.Scene;
const views = new Map<number, View>();
export function initRemote(s: THREE.Scene) { scene = s; }

export function clearRemote() {
  for (const v of views.values()) removeView(v);
  views.clear();
}

function removeView(v: View) {
  scene.remove(v.obj);
  disposeOwned(v.obj);
}

// ------------------------------------------------------------------ Models

function nametag(text: string): THREE.Sprite {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  ctx.font = 'bold 32px Courier New, monospace';
  const w = Math.ceil(ctx.measureText(text).width) + 20;
  c.width = w; c.height = 44;
  ctx.font = 'bold 32px Courier New, monospace';
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, w, 44);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 10, 23);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  mat.userData.owned = true; // texture + material freed when the player leaves view
  const s = new THREE.Sprite(mat);
  s.scale.set(w / 110, 0.4, 1);
  s.renderOrder = 10;
  return s;
}

function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D, pivotTop = false) {
  const geo = new THREE.BoxGeometry(w, h, d);
  if (pivotTop) geo.translate(0, -h / 2, 0);
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
const pupilMats = new Map<number, THREE.MeshBasicMaterial>();
function eyes(parent: THREE.Object3D, z: number, y: number, spread: number, size: number, pupil = 0x111111) {
  let black = pupilMats.get(pupil);
  if (!black) { black = new THREE.MeshBasicMaterial({ color: pupil }); pupilMats.set(pupil, black); }
  for (const sx of [-1, 1]) {
    box(size, size, 0.02, white, sx * spread, y, z, parent);
    box(size * 0.5, size * 0.6, 0.03, black, sx * spread + (sx > 0 ? -size * 0.2 : size * 0.2), y - size * 0.15, z, parent);
  }
}

// Models face -z with y=0 at the feet; outer sizes match MOB_SPECS hitboxes
function buildMob(kind: MobKind, owner?: string): MobModel {
  const model = new THREE.Group();
  const parts: MobModel['parts'] = [];
  const mats: THREE.MeshLambertMaterial[] = [];
  const mat = (c: number) => { const m = new THREE.MeshLambertMaterial({ color: c }); m.userData.owned = true; mats.push(m); return m; };
  if (kind === 'pig') {
    const pink = mat(0xf0a0a8), dark = mat(0xd88088);
    box(0.6, 0.5, 0.7, pink, 0, 0.6, 0.12, model);
    const head = box(0.5, 0.4, 0.36, pink, 0, 0.7, -0.4, model);
    box(0.24, 0.16, 0.06, dark, 0, -0.08, -0.2, head);
    eyes(head, -0.185, 0.08, 0.13, 0.09);
    for (const [x, z, s] of [[-0.18, -0.2, 1], [0.18, -0.2, -1], [-0.18, 0.35, -1], [0.18, 0.35, 1]])
      parts.push({ mesh: box(0.2, 0.35, 0.2, pink, x, 0.35, z, model, true), swing: s });
  } else if (kind === 'cow') {
    const brown = mat(0x5a3a22), cream = mat(0xe8e0d8), horn = mat(0xd8d0b0);
    box(0.8, 0.7, 0.85, brown, 0, 0.95, 0.1, model);
    box(0.5, 0.4, 0.45, cream, 0.16, 1.05, 0.2, model);
    const head = box(0.5, 0.5, 0.35, brown, 0, 1.15, -0.5, model);
    box(0.3, 0.2, 0.06, cream, 0, -0.12, -0.19, head);
    box(0.08, 0.14, 0.08, horn, -0.22, 0.28, 0, head); box(0.08, 0.14, 0.08, horn, 0.22, 0.28, 0, head);
    eyes(head, -0.18, 0.08, 0.14, 0.1);
    for (const [x, z, s] of [[-0.25, -0.2, 1], [0.25, -0.2, -1], [-0.25, 0.4, -1], [0.25, 0.4, 1]])
      parts.push({ mesh: box(0.24, 0.6, 0.24, brown, x, 0.6, z, model, true), swing: s });
  } else if (kind === 'chicken') {
    const w = mat(0xf8f8f8), beak = mat(0xf0a020), red = mat(0xd02020), legC = mat(0xe0a020);
    box(0.4, 0.35, 0.45, w, 0, 0.4, 0.05, model);
    const head = box(0.3, 0.32, 0.25, w, 0, 0.62, -0.2, model);
    box(0.14, 0.08, 0.12, beak, 0, -0.02, -0.18, head);
    box(0.08, 0.1, 0.06, red, 0, -0.11, -0.14, head);
    eyes(head, -0.13, 0.06, 0.09, 0.06);
    box(0.06, 0.25, 0.3, w, -0.22, 0.42, 0.05, model); box(0.06, 0.25, 0.3, w, 0.22, 0.42, 0.05, model);
    for (const [x, s] of [[-0.1, 1], [0.1, -1]]) parts.push({ mesh: box(0.06, 0.22, 0.06, legC, x, 0.22, 0.05, model, true), swing: s });
  } else if (kind === 'spider') {
    // Wide and low: body, head with red eyes, four legs a side
    const dark = mat(0x2a2420), mid = mat(0x3a322c);
    box(0.7, 0.45, 0.8, dark, 0, 0.5, 0.25, model);
    const head = box(0.5, 0.4, 0.45, mid, 0, 0.5, -0.35, model);
    eyes(head, -0.23, 0.05, 0.12, 0.08, 0xd01010);
    for (let i = 0; i < 4; i++) for (const side of [-1, 1]) {
      const leg = box(0.7, 0.08, 0.08, dark, side * 0.6, 0.55, -0.25 + i * 0.2, model);
      leg.rotation.z = side * -0.5;
      parts.push({ mesh: leg, swing: (i % 2 ? 0.25 : -0.25) * side });
    }
  } else if (kind === 'skeleton') {
    const bone = mat(0xd8d8cc), shade = mat(0x9a9a8e), bow = mat(0x6a4a24);
    const head = box(0.45, 0.45, 0.45, bone, 0, 1.675, 0, model);
    eyes(head, -0.23, 0.02, 0.1, 0.11, 0x000000);
    box(0.36, 0.7, 0.16, shade, 0, 1.1, 0, model);
    for (const y of [1.3, 1.1, 0.9]) box(0.4, 0.05, 0.18, bone, 0, y, 0, model);
    for (const [x, s] of [[-0.25, 0.3], [0.25, -0.3]]) {
      const arm = box(0.1, 0.7, 0.1, bone, x, 1.42, 0, model, true);
      arm.rotation.x = Math.PI / 2;
      parts.push({ mesh: arm, swing: s });
    }
    box(0.06, 0.6, 0.06, bow, -0.25, 1.42, -0.72, model);
    for (const [x, s] of [[-0.1, -1], [0.1, 1]]) parts.push({ mesh: box(0.1, 0.75, 0.1, bone, x, 0.75, 0, model, true), swing: s });
  } else if (kind === 'slime' || kind === 'slimelet') {
    // A translucent jelly cube with a darker core and eyes
    const s = kind === 'slime' ? 1 : 0.5;
    const jelly = mat(0x70c850); jelly.transparent = true; jelly.opacity = 0.7;
    const core = mat(0x3a8a2a);
    const body = box(s, s, s, jelly, 0, s / 2, 0, model);
    box(s * 0.5, s * 0.5, s * 0.5, core, 0, 0, 0, body);
    eyes(body, -s / 2 - 0.01, s * 0.12, s * 0.2, s * 0.14, 0x1a3a10);
    parts.push({ mesh: body, swing: 0 });
  } else if (kind === 'robot') {
    // A boxy robot, 2 blocks tall, with a laser cannon for a right arm. Tamed: green eyes.
    const steel = mat(0x8a9098), darkSteel = mat(0x4a5058), rust = mat(0x8a4a28);
    const glow = new THREE.MeshBasicMaterial({ color: owner ? 0x40ff60 : 0xff2020 }); glow.userData.owned = true;
    const head = box(0.5, 0.42, 0.46, steel, 0, 1.76, 0, model);
    box(0.34, 0.08, 0.02, glow, 0, 0.02, -0.24, head);                   // visor
    box(0.04, 0.2, 0.04, darkSteel, 0.12, 0.3, 0, head);                  // antenna
    box(0.08, 0.08, 0.08, glow, 0.12, 0.42, 0, head);
    box(0.7, 0.72, 0.42, steel, 0, 1.18, 0, model);                       // body
    box(0.3, 0.2, 0.02, rust, -0.12, 1.3, -0.22, model);                  // a rusty patch
    box(0.12, 0.12, 0.02, glow, 0.18, 1.3, -0.22, model);                 // chest light
    const left = box(0.16, 0.7, 0.16, darkSteel, -0.44, 1.5, 0, model, true);
    parts.push({ mesh: left, swing: 0.4 });
    const cannon = box(0.2, 0.2, 0.62, darkSteel, 0.46, 1.3, -0.2, model); // laser cannon, pointed ahead
    box(0.1, 0.1, 0.04, glow, 0, 0, -0.32, cannon);
    for (const [x, s] of [[-0.17, -1], [0.17, 1]]) parts.push({ mesh: box(0.24, 0.82, 0.26, darkSteel, x, 0.82, 0, model, true), swing: s });
    if (owner) { const tag = nametag(`${owner}'s robot`); tag.position.y = 2.3; tag.scale.multiplyScalar(0.8); model.add(tag); }
  } else {
    // Zombie family: same proportions as the player (0.72 wide, 1.8 tall), arms held out in front
    const [skinC, shirtC, pantsC] = kind === 'husk' ? [0xa89868, 0x8a6a3a, 0x5a4a2a]
      : kind === 'frostbitten' ? [0x8ab8d0, 0x4a6a8a, 0x2a3a5a] : [0x5a9a4a, 0x2a8a9a, 0x2a3a8a];
    const skin = mat(skinC), shirt = mat(shirtC), pants = mat(pantsC);
    const head = box(0.45, 0.45, 0.45, skin, 0, 1.575, 0, model);
    eyes(head, -0.23, 0.02, 0.1, 0.11, kind === 'frostbitten' ? 0x2060ff : 0x000000);
    box(0.4, 0.675, 0.22, shirt, 0, 1.0125, 0, model);
    for (const [x, s] of [[-0.29, 0.3], [0.29, -0.3]]) {
      const arm = box(0.16, 0.675, 0.16, skin, x, 1.35, 0, model, true);
      arm.rotation.x = Math.PI / 2;
      parts.push({ mesh: arm, swing: s });
    }
    for (const [x, s] of [[-0.1, -1], [0.1, 1]]) parts.push({ mesh: box(0.2, 0.675, 0.2, pants, x, 0.675, 0, model, true), swing: s });
  }
  return { model, parts, mats };
}

const spriteMats = new Map<string, THREE.SpriteMaterial>();
function itemMesh(type: string): THREE.Object3D {
  if (!isFlatItem(type)) return new THREE.Mesh(blockGeometry(itemDef(type).block!, 0.25), blockEntityMaterial);
  let mat = spriteMats.get(type);
  if (!mat) {
    const tex = new THREE.CanvasTexture(getIconCanvas(type));
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.colorSpace = THREE.SRGBColorSpace;
    mat = new THREE.SpriteMaterial({ map: tex, alphaTest: 0.5 });
    spriteMats.set(type, mat);
  }
  const s = new THREE.Sprite(mat);
  s.scale.set(0.4, 0.4, 0.4);
  return s;
}

// ------------------------------------------------------------------ Network events

export function onSpawn(list: SpawnInfo[]) {
  for (const s of list) {
    if (views.has(s.eid)) removeView(views.get(s.eid)!);
    let obj: THREE.Object3D;
    const v: View = {
      eid: s.eid, kind: s.kind, obj: null!, samples: [], pos: new THREE.Vector3(s.x, s.y, s.z),
      yaw: 0, pitch: 0, flags: 0, hspeed: 0, swing: 1, walk: 0, age: 0, dying: -1,
    };
    if (s.kind === 'player' && s.player) {
      const av = createAvatar(s.player.look);
      av.setArmor(s.player.armor || []);
      av.setHeld(s.player.held || '');
      const tag = nametag(s.player.name);
      tag.position.y = 2.15;
      av.root.add(tag);
      v.avatar = av; v.name = s.player.name;
      obj = av.root;
    } else if (s.kind === 'item' && s.item) {
      obj = itemMesh(s.item.type);
    } else {
      v.mob = buildMob(s.kind as MobKind, s.owner);
      v.owner = s.owner;
      obj = new THREE.Group();
      obj.add(v.mob.model);
    }
    v.obj = obj;
    obj.position.copy(v.pos);
    scene.add(obj);
    views.set(s.eid, v);
  }
}

export function onDespawn(eids: number[]) {
  for (const id of eids) { const v = views.get(id); if (v) { removeView(v); views.delete(id); } }
}

export function onSnap(ents: number[]) {
  const t = performance.now();
  for (let i = 0; i + 6 < ents.length; i += 7) {
    const v = views.get(ents[i]);
    if (!v) continue;
    v.samples.push({ t, x: ents[i + 1], y: ents[i + 2], z: ents[i + 3], yaw: ents[i + 4], pitch: ents[i + 5], flags: ents[i + 6] });
    if (v.samples.length > 30) v.samples.shift();
  }
}

export function onEquip(eid: number, held: string, armor: (string | null)[]) {
  const v = views.get(eid);
  if (v?.avatar) { v.avatar.setHeld(held); v.avatar.setArmor(armor); }
}

export function onAnim(eid: number, a: 'swing' | 'hurt') {
  const v = views.get(eid);
  if (v && a === 'swing') v.swing = 0;
}

// ------------------------------------------------------------------ Per frame

const lerpAngle = (a: number, b: number, t: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

export function updateRemote(dt: number) {
  updateBeams(dt);
  const renderT = performance.now() - INTERP_DELAY;
  for (const v of views.values()) {
    v.age += dt;
    const s = v.samples;
    if (s.length) {
      // Drop samples we've fully passed (keep one before renderT)
      while (s.length > 2 && s[1].t <= renderT) s.shift();
      const prevX = v.pos.x, prevZ = v.pos.z;
      if (s.length >= 2 && s[0].t <= renderT) {
        const a = s[0], b = s[1];
        const k = Math.min(1, (renderT - a.t) / Math.max(1, b.t - a.t));
        v.pos.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
        v.yaw = lerpAngle(a.yaw, b.yaw, k);
        v.pitch = a.pitch + (b.pitch - a.pitch) * k;
        v.flags = b.flags;
      } else {
        const a = s[0];
        v.pos.set(a.x, a.y, a.z); v.yaw = a.yaw; v.pitch = a.pitch; v.flags = a.flags;
      }
      const inst = dt > 0 ? Math.hypot(v.pos.x - prevX, v.pos.z - prevZ) / dt : 0;
      v.hspeed += (Math.min(inst, 10) - v.hspeed) * Math.min(1, dt * 10);
    }
    v.obj.position.copy(v.pos);

    if (v.kind === 'item') {
      v.obj.position.y += 0.2 + Math.sin(v.age * 3) * 0.06;
      v.obj.rotation.y = v.age * 1.5;
      continue;
    }
    v.obj.rotation.y = v.yaw;
    if (v.flags & EF_SWING && v.swing >= 1) v.swing = 0;
    v.swing = Math.min(1, v.swing + dt / 0.28);
    const hurt = !!(v.flags & EF_HURT);

    if (v.avatar) {
      // Downed players lie face down (crawling)
      const downed = !!(v.flags & EF_DOWNED);
      v.obj.rotation.order = 'YXZ';
      v.obj.rotation.x = downed ? -Math.PI / 2 : 0;
      if (downed) v.obj.position.y += 0.25;
      v.avatar.animate(dt, v.hspeed, v.pitch, !!(v.flags & EF_SNEAK), v.swing);
      v.avatar.hurtFlash(hurt);
    } else if (v.mob) {
      for (const m of v.mob.mats) m.emissive.setHex(hurt ? 0x880000 : 0);
      if (v.flags & EF_DYING) {
        v.dying = v.dying < 0 ? 0 : v.dying + dt;
        v.mob.model.rotation.z = Math.min(1, v.dying / 0.4) * Math.PI / 2;
      }
      v.walk += dt * v.hspeed * 4;
      const sw = Math.sin(v.walk) * Math.min(0.7, v.hspeed * 0.4);
      for (const p of v.mob.parts) {
        if (v.kind === 'zombie' && Math.abs(p.swing) < 1) p.mesh.rotation.x = Math.PI / 2 + sw * p.swing;
        else p.mesh.rotation.x = sw * p.swing;
      }
    }
  }
}

function boxOf(v: View): { halfW: number; height: number } | null {
  if (v.kind === 'item') return null;
  if (v.kind === 'player') return { halfW: PLAYER_HALF_WIDTH, height: PLAYER_HEIGHT };
  return MOB_SPECS[v.kind as MobKind];
}

// Nearest mob/player hit by a ray (for attacking)
export function rayHitEntity(origin: Vec3, dir: Vec3, maxDist: number): { eid: number; dist: number } | null {
  let best: { eid: number; dist: number } | null = null;
  for (const v of views.values()) {
    const b = boxOf(v);
    if (!b || v.flags & EF_DYING) continue;
    const d = rayHitsBox(origin, dir, { x: v.pos.x - b.halfW, y: v.pos.y, z: v.pos.z - b.halfW }, { x: v.pos.x + b.halfW, y: v.pos.y + b.height, z: v.pos.z + b.halfW }, maxDist);
    if (d !== null && (!best || d < best.dist)) best = { eid: v.eid, dist: d };
  }
  return best;
}

// Does any mob/player overlap this block? (placing blocks inside creatures is not allowed)
export function entityInBlock(x: number, y: number, z: number): boolean {
  for (const v of views.values()) {
    const b = boxOf(v);
    if (!b) continue;
    const p = v.pos;
    if (p.x + b.halfW > x && p.x - b.halfW < x + 1 && p.z + b.halfW > z && p.z - b.halfW < z + 1 && p.y + b.height > y && p.y < y + 1) return true;
  }
  return false;
}

// Is this entity a downed player (who can be revived)?
// A wild (untamed) robot: Use on it with a tungsten ingot tames it
export function isWildRobot(eid: number): boolean {
  const v = views.get(eid);
  return !!v && v.kind === 'robot' && !v.owner && !(v.flags & EF_DYING);
}

// A robot's laser: a glowing line that fades out quickly
const beams: { line: THREE.Line; life: number }[] = [];
export function showBeam(a: [number, number, number], b: [number, number, number], pet?: boolean) {
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a), new THREE.Vector3(...b)]);
  const mat = new THREE.LineBasicMaterial({ color: pet ? 0x50ff70 : 0xff3030, transparent: true, opacity: 1, fog: false });
  const line = new THREE.Line(geo, mat);
  scene.add(line);
  beams.push({ line, life: 0.25 });
}
function updateBeams(dt: number) {
  for (let i = beams.length - 1; i >= 0; i--) {
    const bm = beams[i];
    bm.life -= dt;
    (bm.line.material as THREE.LineBasicMaterial).opacity = Math.max(0, bm.life / 0.25);
    if (bm.life <= 0) { scene.remove(bm.line); bm.line.geometry.dispose(); (bm.line.material as THREE.Material).dispose(); beams.splice(i, 1); }
  }
}

export function isDownedPlayer(eid: number): boolean {
  const v = views.get(eid);
  return !!v && v.kind === 'player' && !!(v.flags & EF_DOWNED);
}
export function entityName(eid: number): string {
  return (views.get(eid) as any)?.name || '';
}

// For tests (window.poxel.entities)
export function entityList() {
  return [...views.values()].map(v => ({ eid: v.eid, kind: v.kind, x: v.pos.x, y: v.pos.y, z: v.pos.z, owner: v.owner }));
}

export function entityCounts() {
  let mobs = 0, items = 0, players = 0;
  for (const v of views.values()) { if (v.kind === 'item') items++; else if (v.kind === 'player') players++; else mobs++; }
  return { mobs, items, players };
}
