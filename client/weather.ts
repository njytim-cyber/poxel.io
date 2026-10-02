// Weather you can see: rain (snow where it's cold) when the server says so, a thunderstorm's lightning, and each
// Elemental World biome's own: snow in the Frosted Lands, ash in the Volcano, a warm drizzle in the jungle.
// Drops only fall where there's open sky above them (never under a roof or in a cave).
import * as THREE from 'three';
import type { Weather } from '../shared/protocol.ts';
import { surfaceHeight, getSeed } from './world';
import { isRobotic } from '../shared/robotic.ts';
import { isElemental, elementalBiome } from '../shared/elemental.ts';
import { columnInfo } from '../shared/worldgen.ts';
import { burst } from './particles';

type Fall = 'rain' | 'snow' | 'ash' | null;
const N = 1400, BOX = 22, TOP = 14;
let scene: THREE.Scene;
let weather: Weather = 'clear';
export let rainAmount = 0; // 0..1, eases in and out: the sky darkens with it (see sky.ts)

const drops = new Float32Array(N * 3), speed = new Float32Array(N), alive = new Uint8Array(N);
// Rain: short streaks
const rainPos = new Float32Array(N * 6);
const rainGeo = new THREE.BufferGeometry();
rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
const rainLines = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xa8c0e0, transparent: true, opacity: 0.55, depthWrite: false }));
// Snow and ash: soft flakes
const flakePos = new Float32Array(N * 3);
const flakeGeo = new THREE.BufferGeometry();
flakeGeo.setAttribute('position', new THREE.BufferAttribute(flakePos, 3));
// (soft round flakes, not squares)
const flakeTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 16;
  const g = c.getContext('2d')!, grad = g.createRadialGradient(8, 8, 0, 8, 8, 8);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.5, 'rgba(255,255,255,0.8)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 16, 16);
  return new THREE.CanvasTexture(c);
})();
const flakeMat = new THREE.PointsMaterial({ size: 0.12, map: flakeTex, color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false });
const flakes = new THREE.Points(flakeGeo, flakeMat);
rainLines.frustumCulled = flakes.frustumCulled = false;

export function initWeather(s: THREE.Scene) { scene = s; scene.add(rainLines, flakes); }
export function setWeather(w: Weather) { weather = w; }

// What falls here: the server's weather in the Overworld (snow where it's cold, nothing in the desert); each
// Elemental World biome its own; nothing in the Robotic World's smog
function fallAt(x: number, z: number): { fall: Fall; amount: number } {
  if (isRobotic(x)) return { fall: null, amount: 0 };
  if (isElemental(x)) {
    const b = elementalBiome(x, z, getSeed());
    return b === 'frost' ? { fall: 'snow', amount: 0.6 } : b === 'volcano' ? { fall: 'ash', amount: 0.5 } : b === 'jungle' ? { fall: 'rain', amount: 0.35 } : { fall: null, amount: 0 };
  }
  if (weather === 'clear') return { fall: null, amount: 0 };
  const biome = columnInfo(x, z, getSeed()).biome;
  if (biome === 'desert') return { fall: null, amount: 0 };
  return { fall: biome === 'snowy' || biome === 'mountains' ? 'snow' : 'rain', amount: weather === 'thunder' ? 1 : 0.7 };
}

let current: Fall = null;
function respawn(i: number, cam: THREE.Vector3, fall: Fall, anywhere: boolean) {
  const x = cam.x + (Math.random() - 0.5) * BOX * 2, z = cam.z + (Math.random() - 0.5) * BOX * 2;
  const ground = surfaceHeight(Math.floor(x), Math.floor(z)) + 1;
  const top = cam.y + TOP;
  if (ground > top) { alive[i] = 0; return; } // under a roof here: no drop
  drops[i * 3] = x; drops[i * 3 + 2] = z;
  drops[i * 3 + 1] = anywhere ? ground + Math.random() * (top - ground) : top;
  speed[i] = fall === 'rain' ? 22 + Math.random() * 6 : fall === 'snow' ? 1.8 + Math.random() : 1 + Math.random() * 0.8;
  alive[i] = 1;
}

let lastCheck = 0, wanted = 0;
export function updateWeather(dt: number, cam: THREE.Vector3) {
  // (what falls here only needs checking now and then)
  lastCheck -= dt;
  let { fall, amount } = { fall: current, amount: wanted };
  if (lastCheck <= 0) { lastCheck = 0.5; ({ fall, amount } = fallAt(cam.x, cam.z)); wanted = amount; }
  rainAmount += ((weather !== 'clear' && !isElemental(cam.x) && !isRobotic(cam.x) ? (weather === 'thunder' ? 1 : 0.7) : 0) - rainAmount) * Math.min(1, dt * 0.5);
  if (fall !== current) { current = fall; for (let i = 0; i < N; i++) respawn(i, cam, fall, true); }
  rainLines.visible = current === 'rain';
  flakes.visible = current === 'snow' || current === 'ash';
  if (!current) return;
  flakeMat.color.setHex(current === 'ash' ? 0x5a5458 : 0xffffff);
  flakeMat.size = current === 'ash' ? 0.07 : 0.09;
  const count = Math.floor(N * wanted);
  const t = performance.now() / 1000;
  for (let i = 0; i < N; i++) {
    const o = i * 3;
    if (i >= count) { rainPos[i * 6 + 1] = rainPos[i * 6 + 4] = flakePos[o + 1] = -9999; continue; }
    if (alive[i]) {
      drops[o + 1] -= speed[i] * dt;
      if (current !== 'rain') { drops[o] += Math.sin(t + i) * 0.4 * dt; drops[o + 2] += Math.cos(t * 0.7 + i) * 0.4 * dt; } // flakes drift
    }
    const far = Math.abs(drops[o] - cam.x) > BOX || Math.abs(drops[o + 2] - cam.z) > BOX;
    if (!alive[i] || far || drops[o + 1] < surfaceHeight(Math.floor(drops[o]), Math.floor(drops[o + 2])) + 1) respawn(i, cam, current, far);
    const y = alive[i] ? drops[o + 1] : -9999;
    if (current === 'rain') {
      rainPos[i * 6] = rainPos[i * 6 + 3] = drops[o];
      rainPos[i * 6 + 2] = rainPos[i * 6 + 5] = drops[o + 2];
      rainPos[i * 6 + 1] = y; rainPos[i * 6 + 4] = y + 0.6;
    } else { flakePos[o] = drops[o]; flakePos[o + 1] = y; flakePos[o + 2] = drops[o + 2]; }
  }
  (current === 'rain' ? rainGeo : flakeGeo).attributes.position.needsUpdate = true;
  updateBolts(dt);
}

// ------------------------------------------------------------------ Lightning

const bolts: { line: THREE.LineSegments; life: number }[] = [];
export function strikeLightning(x: number, y: number, z: number, eye: THREE.Vector3) {
  // A jagged bolt from the clouds, with a branch or two
  const pts: number[] = [];
  const zig = (sx: number, sy: number, sz: number, ey: number, spread: number) => {
    let px = sx, py = sy, pz = sz;
    while (py > ey) {
      const nx = px + (Math.random() - 0.5) * spread, ny = py - 2 - Math.random() * 3, nz = pz + (Math.random() - 0.5) * spread;
      pts.push(px, py, pz, nx, Math.max(ey, ny), nz);
      px = nx; py = ny; pz = nz;
      if (Math.random() < 0.08 && spread > 1) zig(px, py, pz, py - 10, spread * 0.7);
    }
  };
  zig(x, y + 60, z, y, 2.5);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const line = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xe8f0ff, transparent: true, opacity: 1, fog: false }));
  scene.add(line);
  bolts.push({ line, life: 0.35 });
  burst(x, y + 0.5, z, 40, 6, [0xffffff, 0xc8e0ff, 0xffd040], 0.5, 6);
  // A white flash over the screen if it's close enough to see
  const d = Math.hypot(eye.x - x, eye.z - z);
  if (d < 90) {
    const el = document.getElementById('lightning-flash');
    if (el) { el.style.transition = 'none'; el.style.opacity = String(Math.max(0.15, 0.7 - d / 140)); void el.offsetWidth; el.style.transition = 'opacity 0.5s'; el.style.opacity = '0'; }
  }
}
function updateBolts(dt: number) {
  for (let k = bolts.length - 1; k >= 0; k--) {
    const b = bolts[k];
    b.life -= dt;
    (b.line.material as THREE.LineBasicMaterial).opacity = Math.max(0, b.life / 0.35) * (Math.random() < 0.3 ? 0.4 : 1); // flickers
    if (b.life <= 0) { scene.remove(b.line); b.line.geometry.dispose(); (b.line.material as THREE.Material).dispose(); bolts.splice(k, 1); }
  }
}
