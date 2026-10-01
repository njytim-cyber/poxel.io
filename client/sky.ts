import * as THREE from 'three';
import { worldUniforms, RENDER_DIST, getSeed } from './world';
import { isRobotic } from '../shared/robotic.ts';
import { isElemental, elementalBiome } from '../shared/elemental.ts';

// Day/night cycle. time: 0..1, 0.25 = noon, 0.75 = midnight.
const DAY_LENGTH = 600; // seconds for a full cycle
let time = 0.3;

let scene: THREE.Scene;
let ambient: THREE.AmbientLight;
let sunLight: THREE.DirectionalLight;
const sun = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ color: 0xfff2a0, fog: false }));
const moon = new THREE.Mesh(new THREE.PlaneGeometry(26, 26), new THREE.MeshBasicMaterial({ color: 0xe8ecff, fog: false }));

const DAY = new THREE.Color(0x87ceeb), NIGHT = new THREE.Color(0x0a0f24), DUSK = new THREE.Color(0xf08a4a);
const WATER_FOG = new THREE.Color(0x1a3a8a), LAVA_FOG = new THREE.Color(0xc83a00), OIL_FOG = new THREE.Color(0x140e08);
// The Robotic World: always a smoggy, rust-coloured dusk
const ROBO_SKY = new THREE.Color(0x8a5a3c);
// The Elemental World: each biome its own sky (and light, and how close the haze is)
const ELEM_SKY = {
  frost: { sky: new THREE.Color(0x9cb4cc), light: 0.72, fog: 0.2, sun: 0.35 },   // a long, pale polar twilight
  volcano: { sky: new THREE.Color(0x5a2a1a), light: 0.55, fog: 0.15, sun: 0.3 },  // smoke and a red glow
  jungle: { sky: new THREE.Color(0x7a9a6a), light: 0.62, fog: 0.18, sun: 0.4 },   // a green, steamy haze
  clouds: { sky: new THREE.Color(0xa8d0ff), light: 0.95, fog: 0.35, sun: 0.9 },   // bright sky above the clouds
};
const sky = new THREE.Color();
let daylight = 1;

export function initSky(s: THREE.Scene, amb: THREE.AmbientLight, dir: THREE.DirectionalLight) {
  scene = s; ambient = amb; sunLight = dir;
  scene.fog = new THREE.Fog(0x87ceeb, 20, RENDER_DIST * 16);
  scene.background = sky;
  for (const m of [sun, moon]) { m.renderOrder = -1; (m.material as THREE.Material).depthWrite = false; scene.add(m); }
}

export function getDaylight() { return daylight; }
export function getTimeOfDay() { return time; }
export function setTimeOfDay(t: number) { time = ((t % 1) + 1) % 1; }
export function isNight() { return daylight < 0.35; }

const CAVE_DARK = new THREE.Color(0x050507);

// depthBelowSurface: how far the camera is under the terrain surface (caves fade the sky to black)
export function updateSky(dt: number, cameraPos: THREE.Vector3, underwater: 'none' | 'water' | 'lava' | 'oil', advance: boolean, depthBelowSurface = 0) {
  if (advance) time = (time + dt / DAY_LENGTH) % 1;
  const angle = time * Math.PI * 2;
  const sunH = Math.sin(angle);
  const t = THREE.MathUtils.smoothstep(sunH, -0.2, 0.3);
  daylight = 0.2 + 0.8 * t;
  worldUniforms.uDaylight.value = daylight;

  sky.copy(NIGHT).lerp(DAY, t);
  // Orange glow around sunrise/sunset
  const dusk = Math.max(0, 1 - Math.abs(sunH) / 0.25) * 0.5;
  sky.lerp(DUSK, dusk);
  const robotic = isRobotic(cameraPos.x), elem = isElemental(cameraPos.x) ? ELEM_SKY[elementalBiome(cameraPos.x, cameraPos.z, getSeed())] : null;
  if (robotic) { daylight = 0.62; worldUniforms.uDaylight.value = daylight; sky.copy(ROBO_SKY); }
  if (elem) { daylight = elem.light; worldUniforms.uDaylight.value = daylight; sky.copy(elem.sky); }
  sky.lerp(CAVE_DARK, THREE.MathUtils.clamp((depthBelowSurface - 4) / 12, 0, 1));
  sun.visible = moon.visible = depthBelowSurface < 8 && !robotic && !elem;

  const fog = scene.fog as THREE.Fog;
  if (underwater === 'water') { fog.color.copy(WATER_FOG); fog.near = 1; fog.far = 14; scene.background = WATER_FOG; }
  else if (underwater === 'lava') { fog.color.copy(LAVA_FOG); fog.near = 0.2; fog.far = 2.5; scene.background = LAVA_FOG; }
  else if (underwater === 'oil') { fog.color.copy(OIL_FOG); fog.near = 0.2; fog.far = 3; scene.background = OIL_FOG; }
  else if (robotic || elem) { fog.color.copy(sky); fog.near = RENDER_DIST * 16 * (elem ? elem.fog : 0.3); fog.far = RENDER_DIST * 16 - 2; scene.background = sky; }
  else { fog.color.copy(sky); fog.near = RENDER_DIST * 16 * 0.55; fog.far = RENDER_DIST * 16 - 2; scene.background = sky; }

  ambient.intensity = 0.45 + 0.75 * daylight;
  sunLight.intensity = robotic ? 0.25 : elem ? elem.sun : 0.9 * t;
  const dir = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0.25).normalize();
  sunLight.position.copy(dir).multiplyScalar(50);
  sun.position.copy(cameraPos).addScaledVector(dir, 300);
  sun.lookAt(cameraPos);
  moon.position.copy(cameraPos).addScaledVector(dir, -300);
  moon.lookAt(cameraPos);
}
