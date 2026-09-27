import * as THREE from 'three';
import { itemDef } from './blocks';
import { blockGeometry, blockEntityMaterial, getIconCanvas, isFlatItem } from './textures';
import { makeBody, moveBody, type Body } from './physics';

// Dropped items floating in the world

interface ItemEntity {
  type: string;
  count: number;
  body: Body;
  mesh: THREE.Object3D;
  age: number;
  pickupDelay: number;
}

let scene: THREE.Scene;
const items: ItemEntity[] = [];
const spriteMats = new Map<string, THREE.SpriteMaterial>();
const MAX_ITEMS = 300;

export function initEntities(s: THREE.Scene) { scene = s; }

function makeMesh(type: string): THREE.Object3D {
  const def = itemDef(type);
  if (!isFlatItem(type)) return new THREE.Mesh(blockGeometry(def.block!, 0.25), blockEntityMaterial);
  let mat = spriteMats.get(type);
  if (!mat) {
    const tex = new THREE.CanvasTexture(getIconCanvas(type));
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    mat = new THREE.SpriteMaterial({ map: tex, alphaTest: 0.5 });
    spriteMats.set(type, mat);
  }
  const s = new THREE.Sprite(mat);
  s.scale.set(0.4, 0.4, 0.4);
  return s;
}

export function spawnItem(type: string, count: number, pos: THREE.Vector3, vel?: THREE.Vector3, pickupDelay = 0.5) {
  if (!scene || count <= 0) return;
  if (items.length >= MAX_ITEMS) removeItemEntity(0);
  const body = makeBody(0.125, 0.25);
  body.pos.copy(pos);
  if (vel) body.vel.copy(vel);
  else body.vel.set((Math.random() - 0.5) * 3, 3.5, (Math.random() - 0.5) * 3);
  const mesh = makeMesh(type);
  scene.add(mesh);
  items.push({ type, count, body, mesh, age: 0, pickupDelay });
}

function removeItemEntity(i: number) {
  scene.remove(items[i].mesh);
  items.splice(i, 1);
}

// pickup returns how many of the stack could NOT be taken
export function updateItems(dt: number, playerFeet: THREE.Vector3, pickup: (type: string, count: number) => number) {
  const center = playerFeet.clone(); center.y += 0.9;
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    it.age += dt;
    if (it.age > 300) { removeItemEntity(i); continue; }
    const b = it.body;
    if (b.inWater) { b.vel.y = Math.min(b.vel.y + 12 * dt, 1.5); }
    else b.vel.y = Math.max(b.vel.y - 22 * dt, -30);
    const drag = b.onGround ? 8 : 1;
    b.vel.x -= b.vel.x * Math.min(1, drag * dt);
    b.vel.z -= b.vel.z * Math.min(1, drag * dt);

    // Pull toward the player when close, like Minecraft's pickup magnet
    const dx = center.x - b.pos.x, dy = center.y - b.pos.y, dz = center.z - b.pos.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (it.age > it.pickupDelay && d2 < 2.5 * 2.5) {
      const d = Math.sqrt(d2) || 1;
      b.vel.x += (dx / d) * 30 * dt; b.vel.y += (dy / d) * 30 * dt; b.vel.z += (dz / d) * 30 * dt;
      if (d2 < 1.1 * 1.1) {
        const left = pickup(it.type, it.count);
        if (left <= 0) { removeItemEntity(i); continue; }
        it.count = left;
      }
    }
    moveBody(b, dt);
    if (b.inLava) { removeItemEntity(i); continue; }

    it.mesh.position.set(b.pos.x, b.pos.y + 0.2 + Math.sin(it.age * 3) * 0.06, b.pos.z);
    it.mesh.rotation.y = it.age * 1.5;
  }
}

export function clearItems() {
  for (let i = items.length - 1; i >= 0; i--) removeItemEntity(i);
}
