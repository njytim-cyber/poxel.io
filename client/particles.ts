// Particles and one-off effects: fireball trails, explosions, shockwave rings, warning marks on the ground,
// bosses' auras. One pooled point cloud for all the little bits (cheap), plus a few short-lived meshes for rings.
import * as THREE from 'three';
import type { ServerMsg } from '../shared/protocol.ts';

const MAX = 3000;
let scene: THREE.Scene;
const pos = new Float32Array(MAX * 3), col = new Float32Array(MAX * 3);
const vel = new Float32Array(MAX * 3), life = new Float32Array(MAX), maxLife = new Float32Array(MAX), grav = new Float32Array(MAX);
const baseCol = new Float32Array(MAX * 3);
let next = 0;
const geo = new THREE.BufferGeometry();
geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
// Soft round dots that add up into a glow
const dot = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d')!, grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.4, 'rgba(255,255,255,0.7)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
})();
const glowMat = new THREE.PointsMaterial({ size: 0.22, opacity: 0.85, map: dot, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
const points = new THREE.Points(geo, glowMat);
points.frustumCulled = false;

export function initParticles(s: THREE.Scene) { scene = s; scene.add(points); for (let i = 0; i < MAX; i++) pos[i * 3 + 1] = -9999; }

const tmp = new THREE.Color();
// One particle: where, how fast, which colour, how long, and how much it falls (negative: rises)
export function emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: number, seconds: number, gravity = 0) {
  const i = next; next = (next + 1) % MAX;
  pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
  vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz;
  tmp.setHex(color);
  baseCol[i * 3] = tmp.r; baseCol[i * 3 + 1] = tmp.g; baseCol[i * 3 + 2] = tmp.b;
  life[i] = maxLife[i] = seconds; grav[i] = gravity;
}
// A burst in every direction
export function burst(x: number, y: number, z: number, n: number, speed: number, colors: number[], seconds: number, gravity = 0) {
  for (let k = 0; k < n; k++) {
    const a = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1, s = speed * (0.4 + Math.random() * 0.6), r = Math.sqrt(1 - u * u);
    emit(x, y, z, Math.cos(a) * r * s, u * s, Math.sin(a) * r * s, colors[k % colors.length], seconds * (0.6 + Math.random() * 0.6), gravity);
  }
}

// ------------------------------------------------------------------ Rings and marks (short-lived meshes)

interface Ring { mesh: THREE.Mesh; life: number; max: number; grow: number; fade: boolean }
const rings: Ring[] = [];
function ring(x: number, y: number, z: number, radius: number, color: number, seconds: number, opts: { grow?: boolean; thick?: number; fill?: boolean } = {}) {
  const g = opts.fill ? new THREE.CircleGeometry(radius, 32) : new THREE.RingGeometry(radius * (1 - (opts.thick ?? 0.12)), radius, 48);
  const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  const mesh = new THREE.Mesh(g, m);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, y + 0.06, z);
  if (opts.grow) mesh.scale.setScalar(0.05);
  scene.add(mesh);
  rings.push({ mesh, life: seconds, max: seconds, grow: opts.grow ? 1 : 0, fade: true });
}

// A beam of light (a glowing column) between two heights, that fades
interface Pillar { mesh: THREE.Mesh; life: number; max: number; grow: boolean }
const pillars: Pillar[] = [];
function pillar(x: number, y0: number, z: number, y1: number, radius: number, color: number, seconds: number, tilt = { x: 0, z: 0 }, grow = false) {
  const h = Math.abs(y1 - y0);
  const g = new THREE.CylinderGeometry(radius, radius, h, 10, 1, true);
  const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(x, (y0 + y1) / 2, z);
  mesh.rotation.set(tilt.x, 0, tilt.z);
  if (grow) mesh.scale.y = 0.01;
  scene.add(mesh);
  pillars.push({ mesh, life: seconds, max: seconds, grow });
}

// A red warning symbol on the ground: a circle, a cross and a pulsing fill (where something is about to land)
function warnSymbol(x: number, y: number, z: number, r: number, seconds: number) {
  ring(x, y, z, r, 0xff2020, seconds, { thick: 0.18 });
  ring(x, y, z, r * 0.92, 0xff4040, seconds, { fill: true });
  for (const rot of [Math.PI / 4, -Math.PI / 4]) {
    const g = new THREE.PlaneGeometry(r * 1.6, r * 0.18);
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xff1010, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
    mesh.rotation.set(-Math.PI / 2, 0, rot);
    mesh.position.set(x, y + 0.08, z);
    scene.add(mesh);
    rings.push({ mesh, life: seconds, max: seconds, grow: 0, fade: true });
  }
  pillar(x, y, z, y + 30, r * 0.15, 0xff2020, seconds); // (visible from afar)
}

// ------------------------------------------------------------------ Server effects

let shake = 0;
export const takeShake = (dt: number) => { const s = shake; shake = Math.max(0, shake - dt * 2.5); return s; };

export function onFx(m: Extract<ServerMsg, { t: 'fx' }>, eye: THREE.Vector3) {
  const { x, y, z, r } = m;
  const near = (d: number) => Math.hypot(eye.x - x, eye.z - z) < d;
  switch (m.kind) {
    case 'explode':
      burst(x, y, z, 40 + r * 25, 6 + r * 2, [0xffd040, 0xff7a10, 0xff3000, 0xffffa0], 0.7, 4);
      burst(x, y, z, 15, 2, [0x553322, 0x332222], 1.4, -1.5); // smoke
      ring(x, y - 0.5, z, Math.max(1.2, r), 0xff7a10, 0.5, { grow: true, thick: 0.3 });
      if (near(8)) shake = Math.max(shake, 0.35);
      break;
    case 'shatter':
      burst(x, y, z, 30, 5, [0xe8fcff, 0x9ee8ff, 0x5ac4f0], 0.6, 10);
      break;
    case 'stomp':
      ring(x, y, z, r, 0x9a7a4a, 0.7, { grow: true, thick: 0.25 });
      ring(x, y, z, r * 0.7, 0x6ad040, 0.6, { grow: true, thick: 0.15 });
      for (let k = 0; k < 90; k++) { const a = Math.random() * Math.PI * 2, d = Math.random() * r; emit(x + Math.cos(a) * d, y + 0.2, z + Math.sin(a) * d, Math.cos(a) * 3, 4 + Math.random() * 4, Math.sin(a) * 3, k % 3 ? 0x8a6a3a : 0x5a8a2a, 1, 12); }
      if (near(r + 6)) shake = Math.max(shake, 0.9);
      break;
    case 'slam':
      ring(x, y, z, r, 0xff5a10, 0.7, { grow: true, thick: 0.3 });
      for (let k = 0; k < 80; k++) { const a = Math.random() * Math.PI * 2, d = Math.random() * r; emit(x + Math.cos(a) * d, y + 0.2, z + Math.sin(a) * d, Math.cos(a) * 2, 3 + Math.random() * 5, Math.sin(a) * 2, k % 2 ? 0xff7a10 : 0x3a3a3e, 1, 10); }
      if (near(r + 6)) shake = Math.max(shake, 0.8);
      break;
    case 'nova':
      ring(x, y - 0.8, z, r, 0x9ef4ff, 0.8, { grow: true, thick: 0.35 });
      burst(x, y, z, 120, 9, [0xffffff, 0x9ef4ff, 0x5ac4f0], 0.8, 2);
      break;
    case 'mark':
      // Where an icicle will land: a pulsing red-and-white circle on the ground
      ring(x, y, z, 1.1, 0xff4040, 1.4, { thick: 0.25 });
      ring(x, y, z, 0.5, 0xffffff, 1.4, { fill: true });
      break;
    case 'enrage':
      burst(x, y, z, 160, 10, [0xff3030, 0xffd040, 0xffffff], 1.2, 0);
      ring(x, y - r * 0.5, z, r * 3, 0xff3030, 1, { grow: true, thick: 0.2 });
      if (near(30)) shake = Math.max(shake, 0.5);
      break;
    case 'gust':
      ring(x, y - 5, z, r, 0xffffff, 0.8, { grow: true, thick: 0.15 });
      for (let k = 0; k < 100; k++) { const a = Math.random() * Math.PI * 2, d = 1 + Math.random() * 3; emit(x + Math.cos(a) * d, y - Math.random() * 6, z + Math.sin(a) * d, Math.cos(a) * 14, 1, Math.sin(a) * 14, 0xe8f4ff, 0.8, 0); }
      break;
    case 'spores':
      for (let k = 0; k < 160; k++) { const a = Math.random() * Math.PI * 2, d = Math.random() * r; emit(x + Math.cos(a) * d, y + Math.random() * 2, z + Math.sin(a) * d, (Math.random() - 0.5), 0.6 + Math.random(), (Math.random() - 0.5), k % 2 ? 0x8ae040 : 0xc8ff80, 2.5, -0.2); }
      break;
    case 'transform':
      // The Tempest's second form: a blinding burst, rings of light, a column into the sky
      burst(x, y, z, 260, 14, [0xffffff, 0xffd040, 0xfff4a0, 0xc8e8ff], 1.6, 0);
      for (const k of [0, 1, 2]) ring(x, y - 1 - k, z, r * (1 + k * 0.6), 0xffd040, 1.2 + k * 0.3, { grow: true, thick: 0.1 });
      pillar(x, y, z, y + 80, 1.2, 0xfff4a0, 1.5);
      if (near(60)) shake = Math.max(shake, 0.8);
      break;
    case 'gather':
      // The Tempest gathers itself: streams of light pour in towards its core from all around
      for (let k = 0; k < 220; k++) {
        const a = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1, d = r * (0.5 + Math.random() * 0.6), q = Math.sqrt(1 - u * u);
        const t = 0.5 + Math.random() * 1.6, dx = Math.cos(a) * q * d, dy = u * d * 0.6, dz = Math.sin(a) * q * d;
        emit(x + dx, y + dy, z + dz, -dx / t, -dy / t, -dz / t, [0xffffff, 0xffd040, 0xfff4a0][k % 3], t);
      }
      ring(x, y - 1.5, z, r, 0xffd040, 2.2, { thick: 0.06 });
      if (near(50)) shake = Math.max(shake, 0.25);
      break;
    case 'skybeam':
      // Its core splits into five beams shot up into the sky
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        pillar(x + Math.cos(a) * 0.6, y, z + Math.sin(a) * 0.6, y + 90, 0.35, 0xffd040, 1.4, { x: Math.sin(a) * 0.15, z: -Math.cos(a) * 0.15 }, true);
      }
      burst(x, y, z, 120, 10, [0xffffff, 0xffd040], 1, -2);
      if (near(40)) shake = Math.max(shake, 0.4);
      break;
    case 'warn':
      warnSymbol(x, y, z, r, 2);
      break;
    case 'starfall':
      // A beam of light slams down from the sky
      pillar(x, y, z, y + 90, r * 0.55, 0xfff4a0, 0.6);
      pillar(x, y, z, y + 90, r * 0.25, 0xffffff, 0.6);
      ring(x, y, z, r * 1.6, 0xffd040, 0.6, { grow: true, thick: 0.3 });
      burst(x, y + 0.5, z, 90, 9, [0xffffff, 0xffd040, 0xff8040], 0.8, 6);
      if (near(r + 10)) shake = Math.max(shake, 0.9);
      break;
    case 'deflect':
      burst(x, y, z, 40, 7, [0xc8e8ff, 0xffffff, 0xffd040], 0.5, 0);
      ring(x, y - 0.5, z, r, 0xc8e8ff, 0.4, { grow: true });
      break;
    case 'wingcharge':
      // The four-wing charge's wind-up: a golden ring closes in on where you stand
      ring(x, y, z, r, 0xffd040, 1.8, { thick: 0.2 });
      ring(x, y, z, r * 2.5, 0xffffff, 1.8, { thick: 0.05 });
      if (near(10)) shake = Math.max(shake, 0.3);
      break;
    case 'charge':
      // The Thorn Guardian rears up: a warning ring where the stomp will land
      ring(x, y, z, r, 0xffd040, 0.9, { thick: 0.08 });
      burst(x, y + 1, z, 30, 2, [0x8a6a3a, 0x6ad040], 0.8, -2);
      break;
  }
}

export function updateParticles(dt: number) {
  for (let i = 0; i < MAX; i++) {
    if (life[i] <= 0) continue;
    life[i] -= dt;
    const o = i * 3;
    if (life[i] <= 0) { pos[o + 1] = -9999; continue; }
    vel[o + 1] -= grav[i] * dt;
    const drag = 1 - Math.min(1, dt * 1.5);
    vel[o] *= drag; vel[o + 2] *= drag;
    pos[o] += vel[o] * dt; pos[o + 1] += vel[o + 1] * dt; pos[o + 2] += vel[o + 2] * dt;
    const f = life[i] / maxLife[i];
    col[o] = baseCol[o] * f; col[o + 1] = baseCol[o + 1] * f; col[o + 2] = baseCol[o + 2] * f; // fades out (additive: dark = gone)
  }
  (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  (geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  for (let k = pillars.length - 1; k >= 0; k--) {
    const p = pillars[k];
    p.life -= dt;
    const t = 1 - p.life / p.max;
    if (p.grow) p.mesh.scale.y = Math.min(1, t * 4);
    (p.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85 * Math.min(1, (p.life / p.max) * 2);
    if (p.life <= 0) { scene.remove(p.mesh); p.mesh.geometry.dispose(); (p.mesh.material as THREE.Material).dispose(); pillars.splice(k, 1); }
  }
  for (let k = rings.length - 1; k >= 0; k--) {
    const r = rings[k];
    r.life -= dt;
    const t = 1 - r.life / r.max;
    if (r.grow) r.mesh.scale.setScalar(Math.min(1, 0.05 + t * 1.6));
    (r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.8 * (r.grow ? 1 - t : 0.5 + 0.5 * Math.sin(t * 20));
    if (r.life <= 0) { scene.remove(r.mesh); r.mesh.geometry.dispose(); (r.mesh.material as THREE.Material).dispose(); rings.splice(k, 1); }
  }
}
