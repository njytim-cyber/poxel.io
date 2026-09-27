import * as THREE from 'three';
import { makeBody, moveBody, boxIntersectsSolid, type Body } from './physics';
import { getBlock, surfaceHeight, isLoaded, MIN_Y } from './world';
import { isSolid, BLOCK_ID } from './blocks';
import { spawnItem } from './entities';

export type MobKind = 'pig' | 'cow' | 'chicken' | 'zombie';

interface Part { mesh: THREE.Mesh; swing: number } // swing: leg/arm phase multiplier

export interface Mob {
  kind: MobKind;
  body: Body;
  group: THREE.Group;
  model: THREE.Group;
  parts: Part[];
  mats: THREE.MeshLambertMaterial[];
  health: number;
  yaw: number;
  targetYaw: number;
  wanderTime: number;
  moving: boolean;
  hurtTime: number;
  fleeTime: number;
  attackCooldown: number;
  deathTime: number;
  walkPhase: number;
  burnTimer: number;
  lavaTimer: number;
}

interface MobSpec {
  halfW: number; height: number; health: number; speed: number; hostile: boolean;
  drops: () => [string, number][];
}

const rnd = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));

// Hitbox (halfW/height) matches each model's outer size below
const SPECS: Record<MobKind, MobSpec> = {
  pig: { halfW: 0.5, height: 0.9, health: 10, speed: 1.4, hostile: false, drops: () => [['porkchop', rnd(1, 3)]] },
  cow: { halfW: 0.58, height: 1.4, health: 10, speed: 1.2, hostile: false, drops: () => [['beef', rnd(1, 3)]] },
  chicken: { halfW: 0.25, height: 0.7, health: 4, speed: 1.3, hostile: false, drops: () => [['chicken', 1], ['feather', rnd(0, 2)]] },
  zombie: { halfW: 0.36, height: 1.8, health: 20, speed: 2.4, hostile: true, drops: () => [['rotten_flesh', rnd(0, 2)], ...(Math.random() < 0.3 ? [['bone', 1] as [string, number]] : [])] },
};

export const mobs: Mob[] = [];
let scene: THREE.Scene;
export function initMobs(s: THREE.Scene) { scene = s; }

// ------------------------------------------------------------------ Models

function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D, pivotTop = false) {
  const geo = new THREE.BoxGeometry(w, h, d);
  if (pivotTop) geo.translate(0, -h / 2, 0); // rotate legs around the hip
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

function eyes(parent: THREE.Object3D, z: number, y: number, spread: number, size: number, pupil = 0x111111) {
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const black = new THREE.MeshBasicMaterial({ color: pupil });
  for (const sx of [-1, 1]) {
    box(size, size, 0.02, white, sx * spread, y, z, parent);
    box(size * 0.5, size * 0.6, 0.03, black, sx * spread + (sx > 0 ? -size * 0.2 : size * 0.2), y - size * 0.15, z, parent);
  }
}

function buildModel(kind: MobKind): { model: THREE.Group; parts: Part[]; mats: THREE.MeshLambertMaterial[] } {
  const model = new THREE.Group();
  const parts: Part[] = [];
  const mats: THREE.MeshLambertMaterial[] = [];
  const mat = (c: number) => { const m = new THREE.MeshLambertMaterial({ color: c }); mats.push(m); return m; };
  // Models face -z (forward); y=0 at the feet
  if (kind === 'pig') {
    const pink = mat(0xf0a0a8), dark = mat(0xd88088);
    box(0.6, 0.5, 0.7, pink, 0, 0.6, 0.12, model);
    const head = box(0.5, 0.4, 0.36, pink, 0, 0.7, -0.4, model);
    box(0.24, 0.16, 0.06, dark, 0, -0.08, -0.22, head);
    eyes(head, -0.205, 0.08, 0.13, 0.09);
    for (const [x, z, s] of [[-0.18, -0.2, 1], [0.18, -0.2, -1], [-0.18, 0.35, -1], [0.18, 0.35, 1]])
      parts.push({ mesh: box(0.2, 0.35, 0.2, pink, x, 0.35, z, model, true), swing: s });
  } else if (kind === 'cow') {
    const brown = mat(0x5a3a22), white = mat(0xe8e0d8), horn = mat(0xd8d0b0);
    box(0.8, 0.7, 0.85, brown, 0, 0.95, 0.1, model);
    box(0.5, 0.4, 0.3, white, 0.16, 1.05, 0.2, model).scale.set(1, 1, 1.5);
    const head = box(0.5, 0.5, 0.35, brown, 0, 1.15, -0.5, model);
    box(0.3, 0.2, 0.06, white, 0, -0.12, -0.19, head);
    box(0.08, 0.14, 0.08, horn, -0.22, 0.28, 0, head); box(0.08, 0.14, 0.08, horn, 0.22, 0.28, 0, head);
    eyes(head, -0.18, 0.08, 0.14, 0.1);
    for (const [x, z, s] of [[-0.25, -0.2, 1], [0.25, -0.2, -1], [-0.25, 0.4, -1], [0.25, 0.4, 1]])
      parts.push({ mesh: box(0.24, 0.6, 0.24, brown, x, 0.6, z, model, true), swing: s });
  } else if (kind === 'chicken') {
    const white = mat(0xf8f8f8), beak = mat(0xf0a020), red = mat(0xd02020), legC = mat(0xe0a020);
    box(0.4, 0.35, 0.45, white, 0, 0.4, 0.05, model);
    const head = box(0.3, 0.32, 0.25, white, 0, 0.62, -0.2, model);
    box(0.14, 0.08, 0.12, beak, 0, -0.02, -0.18, head);
    box(0.08, 0.1, 0.06, red, 0, -0.11, -0.14, head);
    eyes(head, -0.13, 0.06, 0.09, 0.06);
    box(0.06, 0.25, 0.3, white, -0.22, 0.42, 0.05, model); box(0.06, 0.25, 0.3, white, 0.22, 0.42, 0.05, model);
    for (const [x, s] of [[-0.1, 1], [0.1, -1]]) parts.push({ mesh: box(0.06, 0.22, 0.06, legC, x, 0.22, 0.05, model, true), swing: s });
  } else {
    // Zombie: same proportions as the player (0.72 wide, 1.8 tall)
    const skin = mat(0x5a9a4a), shirt = mat(0x2a8a9a), pants = mat(0x2a3a8a);
    const head = box(0.45, 0.45, 0.45, skin, 0, 1.575, 0, model);
    eyes(head, -0.23, 0.02, 0.1, 0.11, 0x000000);
    box(0.4, 0.675, 0.22, shirt, 0, 1.0125, 0, model);
    for (const [x, s] of [[-0.29, 1], [0.29, -1]]) {
      const arm = box(0.16, 0.675, 0.16, skin, x, 1.35, 0, model, true);
      arm.rotation.x = Math.PI / 2; // arms out in front (-z)
      parts.push({ mesh: arm, swing: s * 0.3 });
    }
    for (const [x, s] of [[-0.1, -1], [0.1, 1]]) parts.push({ mesh: box(0.2, 0.675, 0.2, pants, x, 0.675, 0, model, true), swing: s });
  }
  return { model, parts, mats };
}

// ------------------------------------------------------------------ Spawning

export function spawnMob(kind: MobKind, x: number, y: number, z: number): Mob {
  const spec = SPECS[kind];
  const body = makeBody(spec.halfW, spec.height);
  body.pos.set(x, y, z);
  const group = new THREE.Group();
  const { model, parts, mats } = buildModel(kind);
  group.add(model);
  scene.add(group);
  const yaw = Math.random() * Math.PI * 2;
  const m: Mob = { kind, body, group, model, parts, mats, health: spec.health, yaw, targetYaw: yaw, wanderTime: 0, moving: false,
    hurtTime: 0, fleeTime: 0, attackCooldown: 0, deathTime: -1, walkPhase: 0, burnTimer: 0, lavaTimer: 0 };
  mobs.push(m);
  return m;
}

function removeMob(i: number) {
  const m = mobs[i];
  scene.remove(m.group);
  m.group.traverse(o => { if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose(); });
  mobs.splice(i, 1);
}

export function clearMobs() {
  for (let i = mobs.length - 1; i >= 0; i--) removeMob(i);
}

let spawnTimer = 0;
function trySpawn(player: THREE.Vector3, daylight: number) {
  const passive = mobs.filter(m => !SPECS[m.kind].hostile).length;
  const hostile = mobs.length - passive;

  if (passive < 10 && daylight > 0.3) {
    const a = Math.random() * Math.PI * 2, r = 20 + Math.random() * 28;
    const x = Math.floor(player.x + Math.cos(a) * r), z = Math.floor(player.z + Math.sin(a) * r);
    if (isLoaded(x, z)) {
      const h = surfaceHeight(x, z);
      if (getBlock(x, h, z) === BLOCK_ID.grass || getBlock(x, h, z) === BLOCK_ID.snowy_grass) {
        const kind = (['pig', 'cow', 'chicken'] as MobKind[])[Math.floor(Math.random() * 3)];
        const n = 1 + Math.floor(Math.random() * 3);
        for (let k = 0; k < n; k++) {
          const sx = x + 0.5 + (Math.random() - 0.5) * 2, sz = z + 0.5 + (Math.random() - 0.5) * 2;
          if (!boxIntersectsSolid(sx, h + 1, sz, SPECS[kind].halfW, SPECS[kind].height)) spawnMob(kind, sx, h + 1, sz);
        }
      }
    }
  }

  if (hostile < 8) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const a = Math.random() * Math.PI * 2, r = 14 + Math.random() * 22;
      const x = Math.floor(player.x + Math.cos(a) * r), z = Math.floor(player.z + Math.sin(a) * r);
      if (!isLoaded(x, z)) continue;
      const top = surfaceHeight(x, z);
      let y: number;
      if (daylight < 0.35 && Math.random() < 0.5) y = top + 1; // night: on the surface
      else {
        // Dark cave spot near the player's depth
        y = Math.floor(player.y + (Math.random() - 0.5) * 20);
        if (y > top - 4 || y < MIN_Y + 6) continue;
      }
      if (getBlock(x, y, z) !== 0 || getBlock(x, y + 1, z) !== 0 || !isSolid(getBlock(x, y - 1, z))) continue;
      if (boxIntersectsSolid(x + 0.5, y, z + 0.5, SPECS.zombie.halfW, SPECS.zombie.height)) continue;
      spawnMob('zombie', x + 0.5, y, z + 0.5);
      break;
    }
  }
}

// ------------------------------------------------------------------ Combat

// Slab test: distance along the ray to the mob's box, or Infinity
export function rayHitMob(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): { mob: Mob; dist: number } | null {
  let best: { mob: Mob; dist: number } | null = null;
  for (const m of mobs) {
    if (m.deathTime >= 0) continue;
    const b = m.body;
    const min = [b.pos.x - b.halfW, b.pos.y, b.pos.z - b.halfW], max = [b.pos.x + b.halfW, b.pos.y + b.height, b.pos.z + b.halfW];
    const o = [origin.x, origin.y, origin.z], d = [dir.x, dir.y, dir.z];
    let t0 = 0, t1 = maxDist;
    for (let a = 0; a < 3; a++) {
      if (Math.abs(d[a]) < 1e-9) { if (o[a] < min[a] || o[a] > max[a]) { t0 = Infinity; break; } continue; }
      let ta = (min[a] - o[a]) / d[a], tb = (max[a] - o[a]) / d[a];
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) { t0 = Infinity; break; }
    }
    if (t0 < Infinity && (!best || t0 < best.dist)) best = { mob: m, dist: t0 };
  }
  return best;
}

export function damageMob(m: Mob, amount: number, from: THREE.Vector3) {
  if (m.deathTime >= 0 || m.hurtTime > 0.35) return;
  m.health -= amount;
  m.hurtTime = 0.5;
  const dx = m.body.pos.x - from.x, dz = m.body.pos.z - from.z;
  const d = Math.hypot(dx, dz) || 1;
  m.body.vel.x = (dx / d) * 6; m.body.vel.z = (dz / d) * 6; m.body.vel.y = 5;
  if (!SPECS[m.kind].hostile) m.fleeTime = 4;
  if (m.health <= 0) m.deathTime = 0;
}

// Any mob box overlapping this block? (blocks can't be placed inside mobs)
export function mobInBlock(x: number, y: number, z: number): boolean {
  for (const m of mobs) {
    const b = m.body;
    if (b.pos.x + b.halfW > x && b.pos.x - b.halfW < x + 1 && b.pos.z + b.halfW > z && b.pos.z - b.halfW < z + 1 &&
        b.pos.y + b.height > y && b.pos.y < y + 1) return true;
  }
  return false;
}

// ------------------------------------------------------------------ Update

export interface MobContext {
  playerFeet: THREE.Vector3;
  daylight: number;
  damagePlayer: (amount: number, from: THREE.Vector3) => void;
  playerAlive: boolean;
}

export function updateMobs(dt: number, ctx: MobContext) {
  spawnTimer -= dt;
  if (spawnTimer <= 0) { spawnTimer = 1; trySpawn(ctx.playerFeet, ctx.daylight); }

  for (let i = mobs.length - 1; i >= 0; i--) {
    const m = mobs[i];
    const spec = SPECS[m.kind];
    const b = m.body;
    const dxp = ctx.playerFeet.x - b.pos.x, dzp = ctx.playerFeet.z - b.pos.z;
    const distP = Math.hypot(dxp, dzp);

    if (distP > 90 || (spec.hostile && ctx.daylight > 0.6 && distP > 40 && Math.random() < dt * 0.1)) { removeMob(i); continue; }
    if (!isLoaded(Math.floor(b.pos.x), Math.floor(b.pos.z))) continue; // frozen until terrain streams in

    // Death animation, then drops
    if (m.deathTime >= 0) {
      m.deathTime += dt;
      m.model.rotation.z = Math.min(1, m.deathTime / 0.4) * Math.PI / 2;
      if (m.deathTime > 0.8) {
        for (const [type, n] of spec.drops()) if (n > 0) spawnItem(type, n, b.pos.clone().setY(b.pos.y + 0.5));
        removeMob(i);
      }
      continue;
    }

    m.hurtTime = Math.max(0, m.hurtTime - dt);
    m.fleeTime = Math.max(0, m.fleeTime - dt);
    m.attackCooldown = Math.max(0, m.attackCooldown - dt);
    for (const mat of m.mats) mat.emissive.setHex(m.hurtTime > 0.2 ? 0x880000 : 0x000000);

    // --- AI: pick a direction and whether to move
    let speed = spec.speed;
    const chasing = spec.hostile && ctx.playerAlive && distP < 18 && Math.abs(ctx.playerFeet.y - b.pos.y) < 8;
    if (chasing) {
      m.targetYaw = Math.atan2(-dxp, -dzp);
      m.moving = distP > 0.8;
      if (distP < 1.3 && Math.abs(ctx.playerFeet.y - b.pos.y) < 1.6 && m.attackCooldown <= 0) {
        ctx.damagePlayer(3, b.pos);
        m.attackCooldown = 1;
      }
    } else if (m.fleeTime > 0) {
      speed *= 2.2;
      m.moving = true;
      m.wanderTime -= dt;
      if (m.wanderTime <= 0) { m.targetYaw = Math.atan2(dxp, dzp) + (Math.random() - 0.5); m.wanderTime = 0.8; }
    } else {
      m.wanderTime -= dt;
      if (m.wanderTime <= 0) {
        m.moving = Math.random() < 0.55;
        m.targetYaw = Math.random() * Math.PI * 2;
        m.wanderTime = 2 + Math.random() * 4;
      }
    }

    // Turn smoothly
    let dy = m.targetYaw - m.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    m.yaw += dy * Math.min(1, dt * 6);

    const knockback = m.hurtTime > 0.3;
    if (!knockback) {
      const tx = m.moving ? -Math.sin(m.yaw) * speed : 0, tz = m.moving ? -Math.cos(m.yaw) * speed : 0;
      const k = Math.min(1, dt * (b.onGround ? 10 : 2));
      b.vel.x += (tx - b.vel.x) * k;
      b.vel.z += (tz - b.vel.z) * k;
    }

    // Liquids
    if (b.inWater || b.inLava) {
      b.vel.y = Math.min(b.vel.y + 14 * dt, 2); // bob up to the surface
      b.vel.x *= 0.9; b.vel.z *= 0.9;
    } else b.vel.y = Math.max(b.vel.y - 30 * dt, -50);

    moveBody(b, dt);
    // Hop up single-block steps
    if (b.hitWall && b.onGround && m.moving) b.vel.y = 8.5;

    if (b.inLava) {
      m.lavaTimer -= dt;
      if (m.lavaTimer <= 0) { m.lavaTimer = 0.5; m.hurtTime = 0; damageMob(m, 2, b.pos.clone().add(new THREE.Vector3(0, -1, 0))); }
    }
    // Zombies burn in daylight when exposed to the sky
    if (spec.hostile && ctx.daylight > 0.6 && b.pos.y > surfaceHeight(Math.floor(b.pos.x), Math.floor(b.pos.z))) {
      m.burnTimer -= dt;
      if (m.burnTimer <= 0) { m.burnTimer = 1; m.hurtTime = 0; damageMob(m, 2, b.pos); m.fleeTime = 0; }
    }
    if (b.pos.y < MIN_Y - 10) { removeMob(i); continue; }

    // Visuals
    m.group.position.copy(b.pos);
    m.group.rotation.y = m.yaw;
    const hspeed = Math.hypot(b.vel.x, b.vel.z);
    m.walkPhase += dt * hspeed * 4;
    const swing = Math.sin(m.walkPhase) * Math.min(0.7, hspeed * 0.4);
    for (const p of m.parts) {
      if (m.kind === 'zombie' && Math.abs(p.swing) < 1) p.mesh.rotation.x = Math.PI / 2 + swing * p.swing;
      else p.mesh.rotation.x = swing * p.swing;
    }
  }
}
