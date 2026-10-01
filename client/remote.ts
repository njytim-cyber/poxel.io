// Renders server-owned entities (other players, mobs, dropped items) with snapshot interpolation.
import * as THREE from 'three';
import { createAvatar, disposeOwned, type Avatar } from './avatar';
import { blockGeometry, blockEntityMaterial, getIconCanvas, isFlatItem } from './textures';
import { emit } from './particles';
import { itemDef } from '../shared/blocks.ts';
import { MOB_SPECS } from '../shared/mobs.ts';
import { PLAYER_HALF_WIDTH, PLAYER_HEIGHT, rayHitsBox, type Vec3 } from '../shared/physics.ts';
import { EF_SNEAK, EF_HURT, EF_DYING, EF_SWING, EF_DOWNED, EF_ANGRY, type SpawnInfo, type EntityKind, type MobKind } from '../shared/protocol.ts';

const INTERP_DELAY = 110; // ms behind the newest snapshot, smooths out network jitter

interface Sample { t: number; x: number; y: number; z: number; yaw: number; pitch: number; flags: number }
interface MobModel {
  model: THREE.Group; parts: { mesh: THREE.Mesh; swing: number }[]; mats: THREE.MeshLambertMaterial[]; grinder?: THREE.Object3D;
  spinners: { obj: THREE.Object3D; speed: number; axis: 'x' | 'y' | 'z' }[]; // parts that keep turning (rings, shards, a core)
  wings: { obj: THREE.Object3D; side: number }[];                           // the Tempest's wings beat
  aura?: { colors: number[]; rise: number; height: number; width: number }; // a boss's particles (more of them when enraged)
}
interface View {
  eid: number; kind: EntityKind; obj: THREE.Object3D; samples: Sample[];
  pos: THREE.Vector3; yaw: number; pitch: number; flags: number; hspeed: number;
  avatar?: Avatar; mob?: MobModel; name?: string; owner?: string; tag?: THREE.Sprite; away?: boolean; itemType?: string;
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
  // Glowing parts (cores, eyes, magma): unlit, so they shine in the dark
  const glowMat = (c: number) => { const m = new THREE.MeshBasicMaterial({ color: c }); m.userData.owned = true; return m; };
  const spinners: MobModel['spinners'] = [], wings: MobModel['wings'] = [];
  let aura: MobModel['aura'];
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
  } else if (kind === 'robot_titan') {
    // The boss: a huge rusted robot with a glowing core, a laser cannon arm and a grinder arm
    const steel = mat(0x6e747c), dark = mat(0x3a3f46), rust = mat(0x7a3a1c);
    const core = new THREE.MeshBasicMaterial({ color: 0xff7a1a }); core.userData.owned = true;
    const eye = new THREE.MeshBasicMaterial({ color: 0xff2020 }); eye.userData.owned = true;
    const head = box(1.1, 0.9, 1.0, steel, 0, 4.5, 0, model);
    box(0.8, 0.16, 0.02, eye, 0, 0.05, -0.51, head);
    box(0.08, 0.5, 0.08, dark, -0.35, 0.7, 0, head); box(0.08, 0.5, 0.08, dark, 0.35, 0.7, 0, head);
    box(1.9, 1.7, 1.1, steel, 0, 3.15, 0, model);                             // body
    box(0.7, 0.5, 0.02, rust, -0.45, 3.6, -0.56, model);
    box(0.5, 0.5, 0.06, core, 0, 3.1, -0.56, model);                           // laser cannon core
    box(0.6, 0.35, 0.8, dark, 0, 2.2, 0, model);                               // waist
    const cannon = box(0.45, 1.6, 0.45, dark, 1.2, 3.9, 0, model, true);        // right arm: laser cannon
    box(0.2, 0.2, 0.06, core, 0, -1.55, -0.2, cannon);
    parts.push({ mesh: cannon, swing: 0.25 });
    const arm = box(0.45, 1.5, 0.45, dark, -1.2, 3.9, 0, model, true);          // left arm: grinder
    parts.push({ mesh: arm, swing: -0.25 });
    const grinder = new THREE.Group();
    grinder.position.set(0, -1.55, -0.25);
    arm.add(grinder);
    const disc = box(0.9, 0.9, 0.12, rust, 0, 0, 0, grinder);
    for (let k = 0; k < 4; k++) { const t = box(0.14, 0.3, 0.14, steel, 0, 0.5, 0, disc); t.position.set(Math.cos(k * 1.57) * 0.5, Math.sin(k * 1.57) * 0.5, 0); t.rotation.z = k * 1.57; }
    for (const [x, s] of [[-0.45, -1], [0.45, 1]]) parts.push({ mesh: box(0.6, 2.0, 0.65, dark, x, 2.0, 0, model, true), swing: s });
    return { model, parts, mats, grinder, spinners, wings };
  } else if (kind === 'magma_colossus') {
    // A walking mountain of basalt, split by rivers of magma, a molten core blazing in its chest, crowned with horns
    const rock = mat(0x34343a), dark = mat(0x222226), horn = mat(0x1a1a1e);
    const lava = glowMat(0xff6a10), core = glowMat(0xffd040);
    const body = box(2.4, 2.0, 1.6, rock, 0, 2.8, 0, model);
    for (const [w, h, x, y] of [[1.4, 0.25, 0, 0.4], [0.25, 1.2, -0.5, -0.1], [0.25, 0.9, 0.6, 0.2], [0.9, 0.2, 0.2, -0.6]]) box(w, h, 0.06, lava, x, y, -0.82, body); // magma veins
    box(0.8, 0.8, 0.1, core, 0, 0.1, -0.84, body);                                   // the core
    spinners.push({ obj: box(0.5, 0.5, 0.12, lava, 0, 0.1, -0.9, body), speed: 3, axis: 'z' });
    for (let k = 0; k < 5; k++) { const s = box(0.35, 0.9 + (k % 2) * 0.5, 0.35, dark, -0.9 + k * 0.45, 1.2, 0.6, body); s.rotation.x = -0.4; } // spikes down its back
    const head = box(1.1, 0.9, 1.0, dark, 0, 4.25, -0.15, model);
    box(0.8, 0.16, 0.02, core, 0, 0.05, -0.51, head);                                // burning eyes
    for (const sx of [-1, 1]) { const h = box(0.18, 0.7, 0.18, horn, sx * 0.5, 0.6, 0, head); h.rotation.z = sx * -0.5; }
    for (const [x, s] of [[-1.55, 0.3], [1.55, -0.3]]) {
      const arm = box(0.75, 2.1, 0.75, rock, x, 3.6, 0, model, true);
      box(0.06, 1.2, 0.3, lava, x < 0 ? -0.4 : 0.4, -0.9, 0, arm);
      box(0.95, 0.7, 0.95, lava, 0, -2.1, 0, arm);                                   // molten fists
      parts.push({ mesh: arm, swing: s });
    }
    for (const [x, s] of [[-0.6, -1], [0.6, 1]]) parts.push({ mesh: box(0.85, 1.8, 0.85, dark, x, 1.8, 0, model, true), swing: s });
    aura = { colors: [0xff7a10, 0xffd040, 0xff3000], rise: 1.5, height: 4.5, width: 1.4 };
  } else if (kind === 'thorn_guardian') {
    // An ancient giant of bark and moss, bristling with thorns, a crown of flowers, eyes like fireflies
    const bark = mat(0x4e3e22), moss = mat(0x4a7a2a), thorn = mat(0xe0d8a8), petal = mat(0xe04080), petal2 = mat(0xf0d030), leaf = mat(0x2e8a22);
    const eye = glowMat(0xc8ff60);
    const body = box(1.8, 1.6, 1.2, bark, 0, 2.2, 0, model);
    box(1.85, 0.5, 1.25, moss, 0, 0.6, 0, body);                                    // moss over its shoulders
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2, t = box(0.12, 0.55, 0.12, thorn, Math.cos(a) * 0.95, (k % 3) * 0.3 - 0.2, Math.sin(a) * 0.65, body);
      t.rotation.set(Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9);
    }
    const head = box(1.0, 0.9, 0.9, bark, 0, 3.4, -0.1, model);
    box(0.16, 0.14, 0.02, eye, -0.22, 0.05, -0.46, head); box(0.16, 0.14, 0.02, eye, 0.22, 0.05, -0.46, head);
    for (let k = 0; k < 7; k++) {                                                     // the crown of flowers
      const a = (k / 7) * Math.PI * 2;
      box(0.22, 0.22, 0.22, k % 2 ? petal : petal2, Math.cos(a) * 0.45, 0.55, Math.sin(a) * 0.4, head);
      box(0.26, 0.08, 0.26, leaf, Math.cos(a) * 0.45, 0.42, Math.sin(a) * 0.4, head);
    }
    for (const [x, s] of [[-1.15, 0.35], [1.15, -0.35]]) {
      const arm = box(0.55, 1.9, 0.55, bark, x, 2.9, 0, model, true);
      box(0.65, 0.4, 0.65, moss, 0, -0.5, 0, arm);
      for (let k = 0; k < 3; k++) { const t = box(0.1, 0.4, 0.1, thorn, 0.3 * (x < 0 ? -1 : 1), -0.9 - k * 0.3, 0, arm); t.rotation.z = x < 0 ? 0.9 : -0.9; }
      parts.push({ mesh: arm, swing: s });
    }
    for (const [x, s] of [[-0.5, -1], [0.5, 1]]) parts.push({ mesh: box(0.7, 1.4, 0.7, bark, x, 1.4, 0, model, true), swing: s });
    aura = { colors: [0x6ad040, 0xc8ff60, 0x2e8a22], rise: 0.6, height: 3.5, width: 1.2 };
  } else if (kind === 'tempest') {
    // The Tempest: a blazing gold core inside spinning gold rings, carried on great white wings; it fires lasers from its core
    const gold = new THREE.MeshLambertMaterial({ color: 0xffc830, emissive: 0x7a5000 }); gold.userData.owned = true; mats.push(gold);
    const white = mat(0xf4f8ff), tip = mat(0xc8d8f0);
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.55), glowMat(0xfff080));
    core.position.y = 1.2; model.add(core);
    spinners.push({ obj: core, speed: 1.5, axis: 'y' });
    const halo = new THREE.Mesh(new THREE.SphereGeometry(0.8, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffd040, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending }));
    (halo.material as THREE.Material).userData.owned = true;
    core.add(halo);
    for (const [r, speed, tilt] of [[1.0, 2.2, 0], [1.25, -1.6, 1.2], [1.5, 1.1, 2.1]] as const) {
      const ringMesh = new THREE.Mesh(new THREE.TorusGeometry(r, 0.06, 6, 40), gold);
      const holder = new THREE.Group(); holder.position.y = 1.2; holder.rotation.x = tilt; holder.add(ringMesh); model.add(holder);
      spinners.push({ obj: ringMesh, speed, axis: 'x' });
    }
    for (const side of [-1, 1]) {
      // Each wing: a fan of long feathers
      const wing = new THREE.Group();
      wing.position.set(side * 0.9, 1.4, 0.3);
      for (let k = 0; k < 6; k++) {
        const f = box(1.9 - k * 0.15, 0.08, 0.32, k > 3 ? tip : white, side * (1.0 - k * 0.05), -k * 0.12, k * 0.26, wing);
        f.rotation.y = side * -k * 0.12;
      }
      model.add(wing);
      wings.push({ obj: wing, side });
    }
    aura = { colors: [0xffd040, 0xffffff, 0xfff080], rise: 0, height: 2.4, width: 1.6 };
  } else if (kind === 'hurricane') {
    // A whirling funnel of wind, wider at the top, with debris caught in it
    for (let k = 0; k < 7; k++) {
      const m = new THREE.MeshBasicMaterial({ color: 0xe8f0f8, transparent: true, opacity: 0.35 - k * 0.02, side: THREE.DoubleSide, depthWrite: false });
      m.userData.owned = true;
      const t = new THREE.Mesh(new THREE.TorusGeometry(0.35 + k * 0.17, 0.08 + k * 0.02, 5, 18), m);
      t.rotation.x = Math.PI / 2; t.position.y = 0.3 + k * 0.55;
      model.add(t);
      spinners.push({ obj: t, speed: 9 - k * 0.6, axis: 'z' });
    }
    aura = { colors: [0xffffff, 0xc8d8e8, 0x9a8a6a], rise: 3, height: 4, width: 1.2 };
  } else if (kind === 'frost_wraith') {
    // The Frost World's boss: a hooded spirit of ice, 3 blocks tall, trailing a ragged robe, a cold heart glowing in its chest,
    // shards of ice circling it (it floats)
    const robe = mat(0xb8d8f0); robe.transparent = true; robe.opacity = 0.85;
    const robe2 = mat(0x8ab8e0); robe2.transparent = true; robe2.opacity = 0.6;
    const dark = mat(0x1a2a48), ice = mat(0x8ae0ff);
    const glow = glowMat(0x9ef4ff);
    for (let i = 0; i < 4; i++) box(0.5 + i * 0.22, 0.45, 0.4 + i * 0.16, robe, 0, 0.35 + (3 - i) * 0.45, 0, model); // widening downwards
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; box(0.25, 0.7, 0.1, robe2, Math.cos(a) * 0.65, 0.2, Math.sin(a) * 0.5, model); } // ragged hem
    box(0.7, 0.6, 0.55, robe, 0, 2.1, 0, model);                               // shoulders
    box(0.25, 0.25, 0.05, glow, 0, 2.0, -0.29, model);                         // its cold heart
    const head = box(0.6, 0.6, 0.6, robe, 0, 2.7, 0, model);                    // hood
    box(0.44, 0.4, 0.06, dark, 0, -0.04, -0.28, head);                          // the dark inside of the hood
    box(0.1, 0.06, 0.02, glow, -0.1, 0, -0.32, head); box(0.1, 0.06, 0.02, glow, 0.1, 0, -0.32, head); // eyes
    for (let k = 0; k < 5; k++) box(0.08, 0.3 + (k % 2) * 0.2, 0.08, ice, -0.24 + k * 0.12, 0.42, 0, head); // a crown of icicles
    for (const [x, s] of [[-0.48, 0.35], [0.48, -0.35]]) {
      const arm = box(0.18, 1.0, 0.18, robe, x, 2.35, 0, model, true);
      box(0.12, 0.3, 0.12, ice, 0, -1.05, 0, arm);                              // icy claws
      arm.rotation.x = Math.PI / 3;
      parts.push({ mesh: arm, swing: s });
    }
    const shards = new THREE.Group(); shards.position.y = 1.6; model.add(shards);
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2, sh = box(0.1, 0.5, 0.1, ice, Math.cos(a) * 1.3, Math.sin(k * 1.7) * 0.4, Math.sin(a) * 1.3, shards); sh.rotation.z = 0.4; }
    spinners.push({ obj: shards, speed: 1.4, axis: 'y' });
    aura = { colors: [0xffffff, 0x9ef4ff, 0xc8e8ff], rise: -0.5, height: 3, width: 1 };
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
  for (const m of mats) m.userData.glow = m.emissive.getHex();
  return { model, parts, mats, spinners, wings, aura };
}

const spriteMats = new Map<string, THREE.SpriteMaterial>();
// Glow halos for projectiles (additive, so they light up whatever is behind them)
const haloTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!, grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.3, 'rgba(255,255,255,0.6)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
function halo(color: number, size: number) {
  const m = new THREE.SpriteMaterial({ map: haloTex, color, transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending });
  m.userData.owned = true; m.userData.sharedMap = true;
  const sp = new THREE.Sprite(m); sp.scale.setScalar(size);
  return sp;
}
// Projectiles in flight: a blazing fireball, a molten magma ball, a long sharp icicle
const PROJECTILES = new Set(['fireball', 'magma_ball', 'icicle']);
function projectileMesh(type: string): THREE.Object3D {
  const g = new THREE.Group();
  const own = <T extends THREE.Material>(m: T) => { m.userData.owned = true; return m; };
  if (type === 'icicle') {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.9, 6), own(new THREE.MeshBasicMaterial({ color: 0xc8f0ff })));
    cone.rotation.x = Math.PI / 2; // points along +z; the group is turned to face where it flies
    g.add(cone, halo(0x9ef4ff, 0.8));
  } else if (type === 'magma_ball') {
    g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 0), own(new THREE.MeshBasicMaterial({ color: 0xff5a10 }))));
    const crust = new THREE.Mesh(new THREE.IcosahedronGeometry(0.46, 0), own(new THREE.MeshBasicMaterial({ color: 0x3a1a10, wireframe: true })));
    g.add(crust, halo(0xff7a10, 1.6));
  } else {
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), own(new THREE.MeshBasicMaterial({ color: 0xfff0a0 }))));
    g.add(halo(0xff7a10, 1.0), halo(0xffd040, 0.5));
  }
  return g;
}
function itemMesh(type: string): THREE.Object3D {
  if (PROJECTILES.has(type)) return projectileMesh(type);
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
      v.avatar = av; v.name = s.player.name;
      setTag(v, awayPlayers.has(s.eid));
      obj = av.root;
    } else if (s.kind === 'item' && s.item) {
      obj = itemMesh(s.item.type);
      v.itemType = s.item.type;
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

// eye: the camera position, so a name tag fades out when its player is right in front of you
export function updateRemote(dt: number, eye?: THREE.Vector3) {
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
    if (v.tag && eye) {
      const d = Math.hypot(v.pos.x - eye.x, v.pos.y + 1.6 - eye.y, v.pos.z - eye.z);
      const fade = Math.min(1, Math.max(0, (d - 1.5) / 1.5)); // gone within 1.5 blocks, full from 3
      v.tag.visible = fade > 0;
      (v.tag.material as THREE.SpriteMaterial).opacity = fade;
    }

    if (v.kind === 'item') {
      if (v.itemType && PROJECTILES.has(v.itemType)) { flyProjectile(v, dt); continue; }
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
      // Hurt: a red flash. Enraged (a boss in phase two): a slow, angry red pulse
      const angry = !!(v.flags & EF_ANGRY) && v.kind !== 'robot_titan';
      const pulse = angry ? Math.round(0x30 + 0x30 * Math.sin(v.age * 6)) << 16 : 0;
      for (const m of v.mob.mats) m.emissive.setHex(hurt ? 0x880000 : (m.userData.glow || 0) | pulse);
      for (const sp of v.mob.spinners) sp.obj.rotation[sp.axis] += dt * sp.speed * (angry ? 2 : 1);
      for (const w of v.mob.wings) w.obj.rotation.z = w.side * Math.sin(v.age * (angry ? 11 : 7)) * 0.5;
      if (v.mob.aura && v.dying < 0) bossAura(v, dt, angry);
      if (v.flags & EF_DYING) {
        v.dying = v.dying < 0 ? 0 : v.dying + dt;
        v.mob.model.rotation.z = Math.min(1, v.dying / 0.4) * Math.PI / 2;
      }
      v.walk += dt * v.hspeed * 4;
      const sw = Math.sin(v.walk) * Math.min(0.7, v.hspeed * 0.4);
      // The Titan's grinder spins (fast while it charges); the Wraith bobs as it floats
      if (v.mob.grinder) v.mob.grinder.rotation.z += dt * (v.flags & EF_ANGRY ? 25 : 2);
      if (v.kind === 'frost_wraith') v.mob.model.position.y = Math.sin(v.age * 2) * 0.15;
      if (v.kind === 'tempest') v.mob.model.position.y = Math.sin(v.age * 3) * 0.3;
      for (const p of v.mob.parts) {
        if (v.kind === 'frost_wraith') p.mesh.rotation.x = Math.PI / 3 + Math.sin(v.age * 3) * p.swing;
        else if (v.kind === 'zombie' && Math.abs(p.swing) < 1) p.mesh.rotation.x = Math.PI / 2 + sw * p.swing;
        else p.mesh.rotation.x = sw * p.swing;
      }
    }
  }
}

// A projectile: faces where it's going and leaves a trail (sparks, smoke, frost)
const _prev = new THREE.Vector3();
function flyProjectile(v: View, dt: number) {
  const s = v.samples, a = s.length >= 2 ? s[s.length - 2] : null, b = s[s.length - 1];
  if (a && b) { _prev.set(b.x - a.x, b.y - a.y, b.z - a.z); if (_prev.lengthSq() > 1e-6) v.obj.lookAt(v.pos.x + _prev.x, v.pos.y + _prev.y, v.pos.z + _prev.z); }
  if (v.itemType !== 'icicle') v.obj.rotation.z += dt * 8;
  const p = v.pos, n = v.itemType === 'magma_ball' ? 4 : 3;
  for (let k = 0; k < n; k++) {
    const j = () => (Math.random() - 0.5) * 0.25;
    if (v.itemType === 'icicle') emit(p.x + j(), p.y + j(), p.z + j(), 0, 0, 0, 0x9ef4ff, 0.35);
    else {
      emit(p.x + j(), p.y + j(), p.z + j(), j(), 0.5, j(), k % 2 ? 0xff7a10 : 0xffd040, 0.45, -1);
      if (v.itemType === 'magma_ball') emit(p.x + j(), p.y + j(), p.z + j(), j(), 1, j(), 0x442218, 1.2, -0.5);
    }
  }
}

// A boss's aura: embers rising off the Colossus, leaves off the Guardian, snow round the Wraith, sparks round the
// Tempest, dust whirling up a hurricane (twice as many when enraged)
function bossAura(v: View, dt: number, angry: boolean) {
  const au = v.mob!.aura!;
  const n = Math.min(6, Math.floor((angry ? 60 : 25) * dt + Math.random()));
  for (let k = 0; k < n; k++) {
    const a = Math.random() * Math.PI * 2, r = au.width * (0.5 + Math.random() * 0.7);
    const spin = v.kind === 'hurricane' ? 6 : 0;
    emit(v.pos.x + Math.cos(a) * r, v.pos.y + Math.random() * au.height, v.pos.z + Math.sin(a) * r,
      -Math.sin(a) * spin, au.rise, Math.cos(a) * spin, au.colors[k % au.colors.length], 1 + Math.random(), 0);
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
    // Tamed robots can't be hit or tamed, so aiming passes through them (they crowd round their owner)
    if (!b || v.flags & EF_DYING || v.owner) continue;
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
export function showBeam(a: [number, number, number], b: [number, number, number], pet?: boolean, ice?: boolean, color?: number) {
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a), new THREE.Vector3(...b)]);
  const mat = new THREE.LineBasicMaterial({ color: color ?? (ice ? 0x9ef4ff : pet ? 0x50ff70 : 0xff3030), transparent: true, opacity: 1, fog: false });
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
// Players whose connection dropped (the server holds their place): their tag says so
let awayPlayers = new Set<number>();
export function setAwayPlayers(away: Set<number>) {
  awayPlayers = away;
  for (const v of views.values()) if (v.kind === 'player' && v.name && !!v.away !== away.has(v.eid)) setTag(v, away.has(v.eid));
}
function setTag(v: View, away: boolean) {
  if (v.tag) { v.tag.removeFromParent(); (v.tag.material as THREE.SpriteMaterial).map?.dispose(); v.tag.material.dispose(); }
  const tag = nametag(away ? `${v.name} (reconnecting...)` : v.name!);
  tag.position.y = 2.15;
  v.avatar!.root.add(tag);
  v.tag = tag; v.away = away;
}

export function entityList() {
  return [...views.values()].map(v => ({ eid: v.eid, kind: v.kind, x: v.pos.x, y: v.pos.y, z: v.pos.z, owner: v.owner, name: v.name }));
}

export function entityCounts() {
  let mobs = 0, items = 0, players = 0;
  for (const v of views.values()) { if (v.kind === 'item') items++; else if (v.kind === 'player') players++; else mobs++; }
  return { mobs, items, players };
}
