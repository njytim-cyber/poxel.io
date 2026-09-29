// Axis-aligned box physics shared by client (prediction) and server (mobs, items, validation).
// Worlds are passed in as a block lookup so this runs anywhere.
import { isSolid, WATER, LAVA, POWDER_SNOW, BLOCKS } from './blocks.ts';

export interface Vec3 { x: number; y: number; z: number }
export type BlockSource = (x: number, y: number, z: number) => number;

// Player hitbox: 0.72 wide x 1.8 tall, eyes 1.62 above the feet (matches the visible model)
export const PLAYER_HALF_WIDTH = 0.36;
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_EYE = 1.62;
export const GRAVITY = 30;

// A box described by its feet position (bottom centre), half width and height.
export interface Body {
  pos: Vec3;
  vel: Vec3;
  halfW: number;
  height: number;
  onGround: boolean;
  hitWall: boolean;
  inWater: boolean;
  inLava: boolean;
  inSnow: boolean;   // sinking in powder snow
  slip: number;      // slipperiness of the block underfoot (0 = normal grip, ~1 = ice)
}

export function makeBody(halfW: number, height: number, pos?: Vec3, vel?: Vec3): Body {
  return {
    pos: pos || { x: 0, y: 0, z: 0 }, vel: vel || { x: 0, y: 0, z: 0 },
    halfW, height, onGround: false, hitWall: false, inWater: false, inLava: false, inSnow: false, slip: 0,
  };
}

const EPS = 1e-4;

export function boxIntersectsSolid(world: BlockSource, px: number, py: number, pz: number, halfW: number, height: number): boolean {
  const x0 = Math.floor(px - halfW), x1 = Math.floor(px + halfW - 1e-7);
  const y0 = Math.floor(py), y1 = Math.floor(py + height - 1e-7);
  const z0 = Math.floor(pz - halfW), z1 = Math.floor(pz + halfW - 1e-7);
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
    if (isSolid(world(x, y, z))) return true;
  }
  return false;
}

export function boxTouchesBlock(world: BlockSource, b: Body, id: number, margin = 0.05): boolean {
  const p = b.pos;
  for (let x = Math.floor(p.x - b.halfW - margin); x <= Math.floor(p.x + b.halfW + margin); x++)
    for (let y = Math.floor(p.y); y <= Math.floor(p.y + b.height - 0.01); y++)
      for (let z = Math.floor(p.z - b.halfW - margin); z <= Math.floor(p.z + b.halfW + margin); z++)
        if (world(x, y, z) === id) return true;
  return false;
}

function liquidAt(world: BlockSource, b: Body, id: number): boolean {
  const x0 = Math.floor(b.pos.x - b.halfW), x1 = Math.floor(b.pos.x + b.halfW - 1e-7);
  const z0 = Math.floor(b.pos.z - b.halfW), z1 = Math.floor(b.pos.z + b.halfW - 1e-7);
  const y0 = Math.floor(b.pos.y + 0.1), y1 = Math.floor(b.pos.y + b.height * 0.6);
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
    if (world(x, y, z) === id) return true;
  }
  return false;
}

const AXES = ['y', 'x', 'z'] as const;

// Moves the body by vel*dt, resolving collisions one axis at a time (Y first).
// Sub-steps keep fast falls from tunnelling through thin floors.
export function moveBody(world: BlockSource, b: Body, dt: number) {
  b.hitWall = false;
  b.onGround = false;
  for (const axis of AXES) {
    let remaining = b.vel[axis] * dt;
    while (Math.abs(remaining) > 1e-9) {
      const step = Math.sign(remaining) * Math.min(Math.abs(remaining), 0.45);
      remaining -= step;
      const before = b.pos[axis];
      b.pos[axis] += step;
      if (boxIntersectsSolid(world, b.pos.x, b.pos.y, b.pos.z, b.halfW, b.height)) {
        // Snap flush against the block face we ran into
        if (axis === 'y') {
          if (step < 0) { b.pos.y = Math.floor(b.pos.y) + 1 + EPS; b.onGround = true; }
          else b.pos.y = Math.floor(b.pos.y + b.height) - b.height - EPS;
        } else {
          const ext = b.halfW;
          if (step > 0) b.pos[axis] = Math.floor(b.pos[axis] + ext) - ext - EPS;
          else b.pos[axis] = Math.floor(b.pos[axis] - ext) + 1 + ext + EPS;
          b.hitWall = true;
        }
        if (boxIntersectsSolid(world, b.pos.x, b.pos.y, b.pos.z, b.halfW, b.height)) b.pos[axis] = before;
        b.vel[axis] = 0;
        break;
      }
    }
  }
  // Resting contact: vel.y was 0 but we're standing on something
  if (!b.onGround && b.vel.y <= 0 && boxIntersectsSolid(world, b.pos.x, b.pos.y - 0.01, b.pos.z, b.halfW, b.height)) b.onGround = true;
  b.inWater = liquidAt(world, b, WATER);
  b.inLava = liquidAt(world, b, LAVA);
  b.inSnow = liquidAt(world, b, POWDER_SNOW);
  b.slip = b.onGround ? BLOCKS[world(Math.floor(b.pos.x), Math.floor(b.pos.y - 0.05), Math.floor(b.pos.z))]?.slippery || 0 : 0;
}

// True when the body stands on something at the given x/z (used for sneaking at ledges)
export function hasGroundBelow(world: BlockSource, b: Body, px: number, pz: number): boolean {
  return boxIntersectsSolid(world, px, b.pos.y - 0.1, pz, b.halfW, 0.1);
}

// Voxel DDA raycast. Skips air and liquids. Returns the first solid-or-plant block hit.
export interface RayHit { x: number; y: number; z: number; id: number; nx: number; ny: number; nz: number; dist: number }
export function raycastBlocks(world: BlockSource, origin: Vec3, dir: Vec3, maxDist: number, isLoaded?: (x: number, z: number) => boolean): RayHit | null {
  let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
  const sx = Math.sign(dir.x), sy = Math.sign(dir.y), sz = Math.sign(dir.z);
  const tdx = sx ? Math.abs(1 / dir.x) : Infinity, tdy = sy ? Math.abs(1 / dir.y) : Infinity, tdz = sz ? Math.abs(1 / dir.z) : Infinity;
  let tmx = sx > 0 ? (x + 1 - origin.x) * tdx : sx < 0 ? (origin.x - x) * tdx : Infinity;
  let tmy = sy > 0 ? (y + 1 - origin.y) * tdy : sy < 0 ? (origin.y - y) * tdy : Infinity;
  let tmz = sz > 0 ? (z + 1 - origin.z) * tdz : sz < 0 ? (origin.z - z) * tdz : Infinity;
  let nx = 0, ny = 0, nz = 0, t = 0;
  for (let i = 0; i < 256 && t <= maxDist; i++) {
    const id = world(x, y, z);
    if (id !== 0 && id !== WATER && id !== LAVA && (!isLoaded || isLoaded(x, z))) return { x, y, z, id, nx, ny, nz, dist: t };
    if (tmx < tmy && tmx < tmz) { x += sx; t = tmx; tmx += tdx; nx = -sx; ny = 0; nz = 0; }
    else if (tmy < tmz) { y += sy; t = tmy; tmy += tdy; nx = 0; ny = -sy; nz = 0; }
    else { z += sz; t = tmz; tmz += tdz; nx = 0; ny = 0; nz = -sz; }
  }
  return null;
}

// Ray vs axis-aligned box (slab test); distance or null
export function rayHitsBox(origin: Vec3, dir: Vec3, min: Vec3, max: Vec3, maxDist: number): number | null {
  let t0 = 0, t1 = maxDist;
  const o = [origin.x, origin.y, origin.z], d = [dir.x, dir.y, dir.z];
  const lo = [min.x, min.y, min.z], hi = [max.x, max.y, max.z];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) { if (o[a] < lo[a] || o[a] > hi[a]) return null; continue; }
    let ta = (lo[a] - o[a]) / d[a], tb = (hi[a] - o[a]) / d[a];
    if (ta > tb) { const t = ta; ta = tb; tb = t; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  return t0;
}
