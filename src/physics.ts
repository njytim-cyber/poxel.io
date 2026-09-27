import * as THREE from 'three';
import { getBlock } from './world';
import { isSolid, WATER, LAVA } from './blocks';

// Axis-aligned box described by its feet position (bottom centre), half width and height.
export interface Body {
  pos: THREE.Vector3;   // feet
  vel: THREE.Vector3;
  halfW: number;
  height: number;
  onGround: boolean;
  hitWall: boolean;
  inWater: boolean;
  inLava: boolean;
}

export function makeBody(halfW: number, height: number): Body {
  return { pos: new THREE.Vector3(), vel: new THREE.Vector3(), halfW, height, onGround: false, hitWall: false, inWater: false, inLava: false };
}

const EPS = 1e-4;

export function boxIntersectsSolid(px: number, py: number, pz: number, halfW: number, height: number): boolean {
  const x0 = Math.floor(px - halfW), x1 = Math.floor(px + halfW - 1e-7);
  const y0 = Math.floor(py), y1 = Math.floor(py + height - 1e-7);
  const z0 = Math.floor(pz - halfW), z1 = Math.floor(pz + halfW - 1e-7);
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
    if (isSolid(getBlock(x, y, z))) return true;
  }
  return false;
}

function liquidAt(b: Body, id: number): boolean {
  const x0 = Math.floor(b.pos.x - b.halfW), x1 = Math.floor(b.pos.x + b.halfW - 1e-7);
  const z0 = Math.floor(b.pos.z - b.halfW), z1 = Math.floor(b.pos.z + b.halfW - 1e-7);
  const y0 = Math.floor(b.pos.y + 0.1), y1 = Math.floor(b.pos.y + b.height * 0.6);
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
    if (getBlock(x, y, z) === id) return true;
  }
  return false;
}

// Moves the body by vel*dt, resolving collisions one axis at a time (Y first).
// Sub-steps keep fast falls from tunnelling through thin floors.
export function moveBody(b: Body, dt: number) {
  b.hitWall = false;
  const wasGround = b.onGround;
  b.onGround = false;
  for (const axis of ['y', 'x', 'z'] as const) {
    let remaining = b.vel[axis] * dt;
    while (Math.abs(remaining) > 1e-9) {
      const step = Math.sign(remaining) * Math.min(Math.abs(remaining), 0.45);
      remaining -= step;
      const before = b.pos[axis];
      b.pos[axis] += step;
      if (boxIntersectsSolid(b.pos.x, b.pos.y, b.pos.z, b.halfW, b.height)) {
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
        if (boxIntersectsSolid(b.pos.x, b.pos.y, b.pos.z, b.halfW, b.height)) b.pos[axis] = before;
        b.vel[axis] = 0;
        break;
      }
    }
  }
  // Resting contact: vel.y was 0 but we're standing on something
  if (!b.onGround && b.vel.y <= 0 && boxIntersectsSolid(b.pos.x, b.pos.y - 0.01, b.pos.z, b.halfW, b.height)) b.onGround = true;
  void wasGround;
  b.inWater = liquidAt(b, WATER);
  b.inLava = liquidAt(b, LAVA);
}

// True when the body stands on something at the given x/z (used for sneaking at ledges)
export function hasGroundBelow(b: Body, px: number, pz: number): boolean {
  return boxIntersectsSolid(px, b.pos.y - 0.1, pz, b.halfW, 0.1);
}

export function isHeadInWater(eye: THREE.Vector3): boolean {
  return getBlock(Math.floor(eye.x), Math.floor(eye.y), Math.floor(eye.z)) === WATER;
}
