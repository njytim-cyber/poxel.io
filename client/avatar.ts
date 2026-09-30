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
      (mat as any).map?.dispose?.();
      mat.dispose();
    }
  });
}

// A held item: small block for blocks, flat sprite-like plane for tools/items
export function makeHeldMesh(type: string, blockSize: number, planeSize: number): THREE.Object3D {
  if (!isFlatItem(type)) return new THREE.Mesh(blockGeometry(itemDef(type).block!, blockSize), blockEntityMaterial);
  return new THREE.Mesh(new THREE.PlaneGeometry(planeSize, planeSize), itemPlaneMat(type));
}

const ARMOR_COLORS: Record<string, number> = { wood: 0xa07844, iron: 0xd8d8d8, gold: 0xfad64a, diamond: 0x33ebcb, moonstone: 0xd6d0f5, etherite: 0x3a3448, tungsten: 0xa4aec2, obitite: 0xd0304a };
const armorMats = new Map<string, THREE.MeshLambertMaterial>();
function armorMat(type: string | null | undefined): THREE.MeshLambertMaterial | null {
  if (!type) return null;
  const tier = type.split('_')[0];
  const col = ARMOR_COLORS[tier];
  if (col === undefined) return null;
  let m = armorMats.get(tier);
  if (!m) { m = new THREE.MeshLambertMaterial({ color: col }); armorMats.set(tier, m); }
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
    const helm = armorMat(armor[0]), chest = armorMat(armor[1]), legs = armorMat(armor[2]), boots = armorMat(armor[3]), hands = armorMat(armor[4]);
    head.material = helm || skin;
    hair.visible = !helm;
    torso.material = chest || shirt;
    lArmMesh.material = rArmMesh.material = chest || skin;
    lLegMesh.material = rLegMesh.material = legs || pants;
    lShoe.material = rShoe.material = boots || shoes;
    lGlove.visible = rGlove.visible = !!hands;
    if (hands) lGlove.material = rGlove.material = hands;
  };

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
