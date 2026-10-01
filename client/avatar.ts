// bloxd.io-style character model (big eyes), used for the local player and every other player.
import * as THREE from 'three';
import { blockGeometry, blockEntityMaterial, getIconCanvas, isFlatItem } from './textures';
import { itemDef } from '../shared/blocks.ts';
import type { Look } from '../shared/protocol.ts';

export const DEFAULT_LOOK: Look = { skin: '#ffcc99', shirt: '#00aaff', pants: '#0000aa', hair: '#6b4423', eye: '#000000', style: 0, super: 'none' };

export function savedLook(): Look {
  const g = (k: string, d: string) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
  return {
    skin: g('poxel_skin', DEFAULT_LOOK.skin), shirt: g('poxel_shirt', DEFAULT_LOOK.shirt), pants: g('poxel_pants', DEFAULT_LOOK.pants),
    hair: g('poxel_hair', DEFAULT_LOOK.hair), eye: g('poxel_eye', DEFAULT_LOOK.eye),
    style: parseInt(g('poxel_style', '0')) || 0, super: g('poxel_super', 'none'),
  };
}

const eyeWhite = new THREE.MeshBasicMaterial({ color: 0xffffff });

export function applyHairGeometry(styleId: number, hair: THREE.Mesh) {
  hair.geometry.dispose(); // replaced below; free the old GPU buffers
  if (styleId === 1) { hair.geometry = new THREE.BoxGeometry(0.4, 0.25, 0.4); hair.position.set(0, 0.35, 0); }
  else if (styleId === 2) { hair.geometry = new THREE.BoxGeometry(0.52, 0.3, 0.52); hair.position.set(0, 0.35, 0.02); }
  else { hair.geometry = new THREE.BoxGeometry(0.52, 0.12, 0.52); hair.position.set(0, 0.22, 0.01); }
}

// Big bloxd-style eyes on a 0.5 head whose front faces -z
export function addBigEyes(head: THREE.Object3D, pupilMat: THREE.Material) {
  const group = new THREE.Group();
  for (const sx of [-1, 1]) {
    const white = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.16, 0.01), eyeWhite);
    white.position.set(sx * 0.11, -0.01, -0.253);
    const pupil = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, 0.012), pupilMat);
    pupil.position.set(sx * 0.11 - sx * 0.025, -0.03, -0.255);
    const shine = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.03, 0.013), eyeWhite);
    shine.position.set(sx * 0.11 - sx * 0.04, 0.0, -0.256);
    group.add(white, pupil, shine);
  }
  head.add(group);
  return group;
}

const itemPlaneMats = new Map<string, THREE.MeshLambertMaterial>();
function itemPlaneMat(type: string) {
  let mat = itemPlaneMats.get(type);
  if (!mat) {
    const tex = new THREE.CanvasTexture(getIconCanvas(type));
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.colorSpace = THREE.SRGBColorSpace;
    mat = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide });
    itemPlaneMats.set(type, mat);
  }
  return mat;
}

// Frees GPU resources owned by one object tree (cached/shared geometries and materials are skipped)
export function disposeOwned(root: THREE.Object3D) {
  root.traverse(o => {
    const m = o as THREE.Mesh;
    if (m.geometry && !(m.geometry as any).__shared && !(o as any).isSprite) m.geometry.dispose();
    const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
    for (const mat of mats) {
      if (!mat.userData.owned) continue;
      if (!mat.userData.sharedMap) (mat as any).map?.dispose?.(); // (a texture shared by many, like the projectiles' glow, stays)
      mat.dispose();
    }
  });
}

// A held item: small block for blocks, flat sprite-like plane for tools/items
export function makeHeldMesh(type: string, blockSize: number, planeSize: number): THREE.Object3D {
  if (!isFlatItem(type)) return new THREE.Mesh(blockGeometry(itemDef(type).block!, blockSize), blockEntityMaterial);
  return new THREE.Mesh(new THREE.PlaneGeometry(planeSize, planeSize), itemPlaneMat(type));
}

// Armour is worn over the body as plates (like real armour), not painted onto the skin. Each material gets a texture:
// its colour, darker edges, a highlight and rivets; helmets have an opening for the face. Elemental pieces carry their
// element's trim: waves (water), glowing cracks (lava), vines and flowers (earth), gold swirls (wind).
const ARMOR_COLORS: Record<string, string> = { wood: '#a07844', iron: '#d8d8d8', gold: '#fad64a', diamond: '#33ebcb', moonstone: '#d6d0f5', etherite: '#4a4458',
  tungsten: '#a4aec2', obitite: '#d0304a', water: '#2a78e0', lava: '#5a2a1a', earth: '#5a7a2a', wind: '#e8f0f8' };
const armorTex = new Map<string, THREE.MeshLambertMaterial>();
function shade(hex: string, f: number) { const c = new THREE.Color(hex); c.multiplyScalar(f); return `#${c.getHexString()}`; }
function armorMat(type: string | null | undefined, face = false): THREE.MeshLambertMaterial | null {
  if (!type) return null;
  const tier = type.split('_')[0];
  const base = ARMOR_COLORS[tier];
  if (!base) return null;
  const key = tier + (face ? ':face' : '');
  let m = armorTex.get(key);
  if (m) return m;
  const c = document.createElement('canvas'); c.width = c.height = 16;
  const g = c.getContext('2d')!;
  const px = (x: number, y: number, col: string) => { g.fillStyle = col; g.fillRect(x, y, 1, 1); };
  let seed = tier.length * 97;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(x, y, shade(base, 0.9 + rnd() * 0.2));
  for (let i = 0; i < 16; i++) { px(i, 0, shade(base, 1.25)); px(0, i, shade(base, 1.2)); px(i, 15, shade(base, 0.55)); px(15, i, shade(base, 0.6)); }
  for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]]) px(x, y, shade(base, 0.5));
  for (let i = 2; i < 7; i++) px(i, 8 - i, shade(base, 1.35)); // a shine
  const trims: Record<string, (x: number, y: number) => string | null> = {
    water: (x, y) => (y === Math.round(3 + Math.sin(x * 0.8) * 1.2) || y === Math.round(12 + Math.sin(x * 0.8 + 2) * 1.2) ? (x % 3 ? '#9ef4ff' : '#ffffff') : null),
    lava: (x, y) => (Math.abs(Math.sin(x * 0.9 + y * 0.5) + Math.cos(y * 1.3 - x * 0.4)) < 0.28 ? (rnd() < 0.5 ? '#ffd040' : '#ff6a10') : null),
    earth: (x, y) => ((x === 1 || x === 14) && y % 2 === 0 ? '#3a8a22' : (x === 1 || x === 14) && y % 4 === 1 ? '#f04080' : (y === 1 || y === 14) && x % 3 === 0 ? '#6ad040' : null),
    wind: (x, y) => { const d = Math.hypot(x - 7.5, y - 7.5), a = Math.atan2(y - 7.5, x - 7.5); return Math.abs(((a + d * 0.55) % 1.6 + 1.6) % 1.6 - 0.8) < 0.18 && d > 2 && d < 7.5 ? '#ffc830' : null; },
  };
  const trim: ((x: number, y: number) => string | null) | undefined = trims[tier];
  if (trim) for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const t = trim(x, y); if (t) px(x, y, t); }
  if (face) g.clearRect(3, 5, 10, 7); // the face shows through the helmet
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.colorSpace = THREE.SRGBColorSpace;
  m = new THREE.MeshLambertMaterial({ map: tex, transparent: face, alphaTest: face ? 0.5 : 0 });
  if (tier in trims) { m.emissive.set(tier === 'lava' ? '#401000' : tier === 'water' ? '#001830' : '#101008'); }
  armorTex.set(key, m);
  return m;
}

export interface Avatar {
  root: THREE.Group;
  head: THREE.Mesh;
  skinMat: THREE.MeshLambertMaterial;
  setLook(look: Look): void;
  setArmor(armor: (string | null)[]): void;
  setHeld(type: string): void;
  // hspeed: horizontal speed, swing: 0..1 progress of the arm swing (1 = idle)
  animate(dt: number, hspeed: number, pitch: number, sneak: boolean, swing: number): void;
  hurtFlash(on: boolean): void;
}

function limb(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, capMat: THREE.Material, capH: number): [THREE.Group, THREE.Mesh, THREE.Mesh] {
  const g = new THREE.Group();
  g.position.set(x, y, 0);
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.translate(0, -h / 2, 0);
  const m = new THREE.Mesh(geo, mat);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, capH, d + 0.02), capMat);
  cap.position.y = -h + capH / 2;
  g.add(m, cap);
  return [g, m, cap];
}

// Unscaled model is 2.0 tall and 0.8 wide; scaled by 0.9 it matches the 1.8 x 0.72 hitbox. Origin at the feet, facing -z.
export function createAvatar(look: Look = DEFAULT_LOOK): Avatar {
  const skin = new THREE.MeshLambertMaterial(), shirt = new THREE.MeshLambertMaterial(), pants = new THREE.MeshLambertMaterial();
  const hairMat = new THREE.MeshLambertMaterial(), eyeMat = new THREE.MeshBasicMaterial();
  const shoes = new THREE.MeshLambertMaterial({ color: 0x3a2a1a });
  const allMats = [skin, shirt, pants, hairMat, shoes];
  for (const m of [...allMats, eyeMat]) m.userData.owned = true; // freed with the avatar

  const root = new THREE.Group();
  const model = new THREE.Group();
  model.scale.setScalar(0.9);
  root.add(model);

  const headPivot = new THREE.Group();
  headPivot.position.y = 1.5;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), skin);
  head.position.y = 0.25;
  headPivot.add(head);
  const hair = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.12, 0.52), hairMat);
  head.add(hair);
  addBigEyes(head, eyeMat);
  model.add(headPivot);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.75, 0.25), shirt);
  torso.position.y = 1.125;
  model.add(torso);
  const [leftArm, lArmMesh, lGlove] = limb(0.18, 0.75, 0.18, skin, -0.31, 1.5, skin, 0.26);
  const [rightArm, rArmMesh, rGlove] = limb(0.18, 0.75, 0.18, skin, 0.31, 1.5, skin, 0.26);
  const [leftLeg, lLegMesh, lShoe] = limb(0.22, 0.75, 0.22, pants, -0.11, 0.75, shoes, 0.12);
  const [rightLeg, rLegMesh, rShoe] = limb(0.22, 0.75, 0.22, pants, 0.11, 0.75, shoes, 0.12);
  lGlove.visible = rGlove.visible = false;
  model.add(leftArm, rightArm, leftLeg, rightLeg);

  // Armour plates, a little bigger than what they cover (shown when worn)
  const plate = (w: number, h: number, d: number, parent: THREE.Object3D, y: number) => {
    const m = new THREE.Mesh<THREE.BoxGeometry, THREE.Material | THREE.Material[]>(new THREE.BoxGeometry(w, h, d), skin);
    m.position.y = y; m.visible = false; parent.add(m);
    return m;
  };
  const helmet = plate(0.58, 0.58, 0.58, head, 0.02);
  const chestPlate = plate(0.5, 0.8, 0.31, torso, 0);
  const shoulders = [plate(0.24, 0.42, 0.24, leftArm, -0.2), plate(0.24, 0.42, 0.24, rightArm, -0.2)];
  const belt = plate(0.5, 0.16, 0.31, torso, -0.32);
  const thighs = [plate(0.27, 0.5, 0.27, leftLeg, -0.25), plate(0.27, 0.5, 0.27, rightLeg, -0.25)];
  const boots = [plate(0.28, 0.27, 0.29, leftLeg, -0.63), plate(0.28, 0.27, 0.29, rightLeg, -0.63)];
  const gloves = [plate(0.23, 0.28, 0.23, leftArm, -0.62), plate(0.23, 0.28, 0.23, rightArm, -0.62)];

  // Super-shop cosmetics
  const black = new THREE.MeshLambertMaterial({ color: 0x111111 });
  black.userData.owned = true;
  const tophat = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.4), black);
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.05), black);
  brim.position.y = -0.2; tophat.add(brim); tophat.position.y = 0.45;
  head.add(tophat);
  const backpack = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.15), new THREE.MeshLambertMaterial({ color: 0xaa2222 }));
  backpack.position.set(0, 0, 0.2);
  torso.add(backpack);
  (backpack.material as THREE.Material).userData.owned = true;
  const ninja = new THREE.Mesh(new THREE.BoxGeometry(0.51, 0.51, 0.51), black);
  const slit = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.52), new THREE.MeshLambertMaterial({ color: 0xffcc99 }));
  slit.position.set(0, 0.1, 0); ninja.add(slit);
  (slit.material as THREE.Material).userData.owned = true;
  head.add(ninja);

  let held: THREE.Object3D | null = null, heldType = '';
  let walkPhase = 0;
  let armor: (string | null)[] = [null, null, null, null, null];

  const applyArmor = () => {
    const wear = (meshes: THREE.Mesh<THREE.BoxGeometry, THREE.Material | THREE.Material[]>[], mat: THREE.Material | null) => { for (const m of meshes) { m.visible = !!mat; if (mat) m.material = mat; } };
    const helm = armorMat(armor[0]);
    helmet.visible = !!helm;
    // (the front of the helmet has the face opening)
    if (helm) helmet.material = [helm, helm, helm, helm, helm, armorMat(armor[0], true)!];
    hair.visible = !helm;
    wear([chestPlate, ...shoulders], armorMat(armor[1]));
    wear([belt, ...thighs], armorMat(armor[2]));
    wear(boots, armorMat(armor[3]));
    wear(gloves, armorMat(armor[4]));
  };
  void lArmMesh; void rArmMesh; void lLegMesh; void rLegMesh; void lShoe; void rShoe;

  const av: Avatar = {
    root, head, skinMat: skin,
    setLook(l) {
      skin.color.set(l.skin); shirt.color.set(l.shirt); pants.color.set(l.pants); hairMat.color.set(l.hair); eyeMat.color.set(l.eye);
      applyHairGeometry(l.style, hair);
      tophat.visible = l.super === 'tophat'; backpack.visible = l.super === 'backpack'; ninja.visible = l.super === 'ninja';
    },
    setArmor(a) { armor = a.slice(0, 5); applyArmor(); },
    setHeld(type) {
      if (type === heldType) return;
      heldType = type;
      if (held) { rightArm.remove(held); disposeOwned(held); held = null; }
      if (!type) return;
      held = makeHeldMesh(type, 0.25, 0.45);
      held.position.set(0, -0.78, -0.15);
      if (isFlatItem(type)) held.rotation.set(0, Math.PI / 2, -Math.PI / 4);
      rightArm.add(held);
    },
    animate(dt, hspeed, pitch, sneak, swing) {
      walkPhase += dt * hspeed * 1.6;
      headPivot.rotation.x = pitch * 0.8;
      const sw = Math.sin(walkPhase * 2) * Math.min(0.8, hspeed * 0.15);
      leftLeg.rotation.x = sw; rightLeg.rotation.x = -sw;
      leftArm.rotation.x = -sw;
      rightArm.rotation.x = sw - Math.sin(Math.min(1, swing) * Math.PI) * 1.4 - (held ? 0.3 : 0);
      torso.position.y = sneak ? 1.08 : 1.125;
      model.rotation.x = sneak ? 0.15 : 0;
    },
    hurtFlash(on) { for (const m of allMats) m.emissive.setHex(on ? 0x770000 : 0); },
  };
  av.setLook(look);
  applyArmor();
  return av;
}
