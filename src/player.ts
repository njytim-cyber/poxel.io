import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { crackMaterials, materials } from './textures';
import { keys, isMobile, touchLookDelta } from './input';
import { removeBlock, placeBlock, chunkGroup, blocks, worldData, updateRenderedBlocks, getSpawnY, getBlockType } from './world';
import { inventory, selectedSlotIndex, addItem, removeItem, setCraftingMode } from './inventory';

document.addEventListener('contextmenu', e => e.preventDefault());

export let controls: PointerLockControls;
let raycaster: THREE.Raycaster;
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();
let prevTime = performance.now();

export const homes: {x: number, y: number, z: number, name: string}[] = [];
export let equippedEtherite = 0;

let isMouseDown = false;
let mouseDownTime = 0;
let canJump = false;
let blockMined = false;
let targetBlockPos: string | null = null;
const MINING_TIME = 600;



export const crackOverlay = new THREE.Mesh(
  new THREE.BoxGeometry(1.002, 1.002, 1.002),
  crackMaterials[0]
);
crackOverlay.visible = false;

function checkCollision(pos: THREE.Vector3) {
  const width = 0.6;
  const depth = 0.6;
  // visual legs end at -1.25, visual head center at 0.5 = 1.75 total from eyes to feet
  const feetY = pos.y - 1.75;
  const headY = pos.y + 0.25;

  const minX = Math.floor(pos.x - width/2 + 0.5);
  const maxX = Math.floor(pos.x + width/2 + 0.5);
  const minY = Math.floor(feetY + 0.5);
  const maxY = Math.floor(headY + 0.5);
  const minZ = Math.floor(pos.z - depth/2 + 0.5);
  const maxZ = Math.floor(pos.z + depth/2 + 0.5);

  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        if (getBlockType(x,y,z) || blocks.has(`${x},${y},${z}`)) return true;
      }
    }
  }
  return false;
}

function isPlayerInBlock(placePos: THREE.Vector3) {
  const pos = controls.object.position;
  const width = 0.6;
  const depth = 0.6;
  const feetY = pos.y - 1.75;
  const headY = pos.y + 0.25;

  const playerMinX = pos.x - width/2;
  const playerMaxX = pos.x + width/2;
  const playerMinY = feetY;
  const playerMaxY = headY;
  const playerMinZ = pos.z - depth/2;
  const playerMaxZ = pos.z + depth/2;

  const blockMinX = placePos.x - 0.5;
  const blockMaxX = placePos.x + 0.5;
  const blockMinY = placePos.y - 0.5;
  const blockMaxY = placePos.y + 0.5;
  const blockMinZ = placePos.z - 0.5;
  const blockMaxZ = placePos.z + 0.5;

  return (playerMinX < blockMaxX && playerMaxX > blockMinX) &&
         (playerMinY < blockMaxY && playerMaxY > blockMinY) &&
         (playerMinZ < blockMaxZ && playerMaxZ > blockMinZ);
}

let cameraRef: THREE.Camera;
let playerPivot: THREE.Object3D;
export let playerAvatar: THREE.Group;
let cameraViewMode = 0; // 0 = 1st, 1 = 3rd back, 2 = 3rd front

let hairMesh: THREE.Mesh;
let leftEye: THREE.Group;
let rightEye: THREE.Group;



// Avatar Materials
const defaultSkin = localStorage.getItem('poxel_skin') || '#ffcc99';
const defaultShirt = localStorage.getItem('poxel_shirt') || '#00aaff';
const defaultPants = localStorage.getItem('poxel_pants') || '#0000aa';

const matShirt = new THREE.MeshLambertMaterial({ color: defaultShirt });
const matSkin = new THREE.MeshLambertMaterial({ color: defaultSkin });
const matPants = new THREE.MeshLambertMaterial({ color: defaultPants });
const matHair = new THREE.MeshLambertMaterial({ color: localStorage.getItem('poxel_hair') || '#6b4423' });
const currentEyeColor = localStorage.getItem('poxel_eye') || '#000000';
const currentHairStyleId = parseInt(localStorage.getItem('poxel_style') || '0');

let leInnerMat = new THREE.MeshBasicMaterial({ color: currentEyeColor });
let reInnerMat = new THREE.MeshBasicMaterial({ color: currentEyeColor });

export function applyHairGeometry(styleId: number, hair: THREE.Mesh) {
    if (styleId === 0) {
        hair.geometry = new THREE.BoxGeometry(0.52, 0.1, 0.52);
        hair.position.set(0, 0.22, 0);
    } else if (styleId === 1) { // Spike
        hair.geometry = new THREE.BoxGeometry(0.4, 0.25, 0.4);
        hair.position.set(0, 0.35, 0);
    } else if (styleId === 2) { // Tall
        hair.geometry = new THREE.BoxGeometry(0.52, 0.3, 0.52);
        hair.position.set(0, 0.35, 0);
    }
}

let playerTopHat: THREE.Mesh;
let playerBackpack: THREE.Mesh;
let playerNinjaMask: THREE.Mesh;

export function updateAvatarColors(skin: string, shirt: string, pants: string, hairColor?: string, eyeColor?: string, hairStyle?: number, superCosmetic?: string) {
    if (skin) matSkin.color.set(skin);
    if (shirt) matShirt.color.set(shirt);
    if (pants) matPants.color.set(pants);
    if (hairColor) matHair.color.set(hairColor);
    if (eyeColor) {
        leInnerMat.color.set(eyeColor);
        reInnerMat.color.set(eyeColor);
    }
    if (hairStyle !== undefined && hairMesh) {
        applyHairGeometry(hairStyle, hairMesh);
    }
    if (superCosmetic !== undefined && head && body) {
        if (!playerTopHat) {
           playerTopHat = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.4), new THREE.MeshLambertMaterial({color: 0x111111}));
           const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.05), new THREE.MeshLambertMaterial({color: 0x111111}));
           brim.position.y = -0.2; playerTopHat.add(brim);
           playerTopHat.position.y = 0.45;
           head.add(playerTopHat);

           playerBackpack = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.15), new THREE.MeshLambertMaterial({color: 0xaa2222}));
           playerBackpack.position.set(0, 0, 0.2);
           body.add(playerBackpack);

           playerNinjaMask = new THREE.Mesh(new THREE.BoxGeometry(0.51, 0.51, 0.51), new THREE.MeshLambertMaterial({color: 0x111111}));
           const eyeSlit = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.52), new THREE.MeshLambertMaterial({color: 0xffcc99}));
           eyeSlit.position.set(0, 0.1, 0);
           playerNinjaMask.add(eyeSlit);
           head.add(playerNinjaMask);
        }
        playerTopHat.visible = superCosmetic === 'tophat';
        playerBackpack.visible = superCosmetic === 'backpack';
        playerNinjaMask.visible = superCosmetic === 'ninja';
    }
    updateArmorVisuals();
}
const matIron = new THREE.MeshLambertMaterial({ color: 0xcccccc });
const matDiamond = new THREE.MeshLambertMaterial({ color: 0x00ffff });
const matGold = new THREE.MeshLambertMaterial({ color: 0xffd700 });
const matMoonstone = new THREE.MeshLambertMaterial({ color: 0xe6e6fa });
const matEtherite = new THREE.MeshLambertMaterial({ color: 0x2c2c38 });

// Avatar Meshes
let head: THREE.Mesh;
let body: THREE.Mesh;
let leftArm: THREE.Mesh;
let rightArm: THREE.Mesh;
let leftLeg: THREE.Mesh;
let rightLeg: THREE.Mesh;

export function initPlayer(camera: THREE.Camera, scene: THREE.Scene) {
  cameraRef = camera;
  playerPivot = new THREE.Object3D();
  playerPivot.add(camera);
  
  controls = new PointerLockControls(playerPivot as unknown as THREE.Camera, document.body);
  raycaster = new THREE.Raycaster();
  raycaster.near = 0.1;
  raycaster.far = 5; // Mining range limit

  const instructions = document.getElementById('instructions');
  let isInventoryOpen = false;
  
  instructions?.addEventListener('click', () => {
    if (!isInventoryOpen) controls.lock();
  });

  controls.addEventListener('lock', () => {
    if (instructions) instructions.style.display = 'none';
  });

  controls.addEventListener('unlock', () => {
    if (instructions && !isInventoryOpen) instructions.style.display = 'flex';
  });

  scene.add(controls.object);
  scene.add(crackOverlay);
  
  // Init Avatar
  playerAvatar = new THREE.Group();
  
  head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), matSkin);
  head.position.y = 0.5;
  
  // Standard bloxd.io 3D Arthur Face (Hair and Eyes)
  hairMesh = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.1, 0.52), matHair);
  applyHairGeometry(currentHairStyleId, hairMesh);
  head.add(hairMesh);

  leftEye = new THREE.Group();
  leftEye.position.set(-0.1, 0, -0.252);
  const leOuter = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.005), new THREE.MeshBasicMaterial({color: 0xffffff}));
  const leInner = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.08, 0.006), leInnerMat);
  leInner.position.set(0.015, 0, 0);
  leftEye.add(leOuter, leInner);
  head.add(leftEye);

  rightEye = new THREE.Group();
  rightEye.position.set(0.1, 0, -0.252);
  const reOuter = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.005), new THREE.MeshBasicMaterial({color: 0xffffff}));
  const reInner = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.08, 0.006), reInnerMat);
  reInner.position.set(-0.015, 0, 0);
  rightEye.add(reOuter, reInner);
  head.add(rightEye);
  
  playerAvatar.add(head);

  body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.75, 0.25), matShirt);
  body.position.y = -0.125;
  playerAvatar.add(body);

  leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.75, 0.25), matSkin);
  leftArm.position.set(-0.375, -0.125, 0);
  playerAvatar.add(leftArm);

  rightArm = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.75, 0.25), matSkin);
  rightArm.position.set(0.375, -0.125, 0);
  playerAvatar.add(rightArm);

  leftLeg = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.75, 0.25), matPants);
  leftLeg.position.set(-0.125, -0.875, 0);
  playerAvatar.add(leftLeg);

  rightLeg = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.75, 0.25), matPants);
  rightLeg.position.set(0.125, -0.875, 0);
  playerAvatar.add(rightLeg);

  scene.add(playerAvatar);
  playerAvatar.visible = false;
  
  // Start position dynamically synced to fractal generation highest surface grass tile!
  controls.object.position.set(0, getSpawnY(), 0);

  // Mining/Placing listener
  document.addEventListener('mousedown', (e) => {
    if (!controls.isLocked && !isMobile) return;
    
    if (e.button !== 0) return; // Only left click for mining/placing/using
    isMouseDown = true;
    blockMined = false;
    mouseDownTime = performance.now();
    targetBlockPos = null;
  });

  document.addEventListener('mouseup', (e) => {
    if ((!controls.isLocked && !isMobile) || !isMouseDown) return;
    isMouseDown = false;
    crackOverlay.visible = false;
    if (e.button !== 0) return;

    const duration = performance.now() - mouseDownTime;

    // Center of screen raycast
    raycaster.setFromCamera(new THREE.Vector2(0, 0), cameraRef);
    const intersects = raycaster.intersectObjects(chunkGroup.children, false);

    if (intersects.length > 0 && !blockMined && duration < 300) {
      const intersect = intersects[0];
      // Short Click -> Intercept Use OR Place Block
      if (intersect.face) {
        const mesh = intersect.object as THREE.Mesh | THREE.InstancedMesh;
        let blockPos = new THREE.Vector3();
        if (mesh instanceof THREE.InstancedMesh && intersect.instanceId !== undefined) {
             const matrix = new THREE.Matrix4();
             mesh.getMatrixAt(intersect.instanceId, matrix);
             blockPos.setFromMatrixPosition(matrix);
        } else {
             blockPos.copy(mesh.position);
        }
        
        const posKey = `${Math.round(blockPos.x)},${Math.round(blockPos.y)},${Math.round(blockPos.z)}`;
        const blockType = worldData.get(posKey);
        
        // INTERACT
        if (blockType === 'crafting_table') {
           const modal = document.getElementById('full-inventory-modal');
           if (modal) {
               setCraftingMode('3x3');
               isInventoryOpen = true;
               modal.style.display = 'block';
               controls.unlock();
           }
           return;
        }

        // PLACE BLOCK
        const placePos = blockPos.clone().add(intersect.face.normal);
        
        if (!isPlayerInBlock(placePos)) {
            const slot = inventory[selectedSlotIndex];
            if (slot && slot.count > 0) {
               const isToolOrArmor = slot.type === 'stick' || (slot.type.includes('_') && slot.type !== 'crafting_table');
               if (!isToolOrArmor) {
                   placeBlock(placePos, slot.type as any);
                   removeItem(selectedSlotIndex, 1);
               }
            }
        }
      }
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.code === 'F7' || e.code === 'KeyV' || e.code === 'F5') {
       e.preventDefault();
       cameraViewMode = (cameraViewMode + 1) % 3;
       playerAvatar.visible = cameraViewMode !== 0;
       
       if (cameraViewMode === 1) {
           cameraRef.position.set(0, 0, 5); // Shift back
           cameraRef.rotation.y = 0;
           raycaster.far = 10;
       } else if (cameraViewMode === 2) {
           cameraRef.position.set(0, 0, -5); // Shift front
           cameraRef.rotation.y = Math.PI; // Face the player
           raycaster.far = 10;
       } else {
           cameraRef.position.set(0, 0, 0); // Restore 1st person
           cameraRef.rotation.y = 0;
           raycaster.far = 5;
       }
    }

    if (e.code === 'KeyI') {
       const modal = document.getElementById('full-inventory-modal');
       if (modal) {
           if (modal.style.display === 'none') {
               setCraftingMode('2x2');
               isInventoryOpen = true;
               modal.style.display = 'block';
               controls.unlock();
           } else {
               isInventoryOpen = false;
               modal.style.display = 'none';
               controls.lock();
           }
       }
    }
    
    if (e.code === 'KeyH') {
       if (equippedEtherite > 0) {
           if (homes.length < equippedEtherite) {
               homes.push({
                   x: controls.object.position.x,
                   y: controls.object.position.y,
                   z: controls.object.position.z,
                   name: `Home ${homes.length + 1}`
               });
           } else {
               const idx = Math.max(0, homes.length - 1);
               homes[idx] = {
                   x: controls.object.position.x,
                   y: controls.object.position.y,
                   z: controls.object.position.z,
                   name: `Home ${idx + 1}`
               };
           }
           renderHomesSidebar();
       }
    }
  });
}

function isOnSolidGround(pos: THREE.Vector3) {
  const minX = Math.floor(pos.x - 0.3 + 0.5);
  const maxX = Math.floor(pos.x + 0.3 + 0.5);
  const minZ = Math.floor(pos.z - 0.3 + 0.5);
  const maxZ = Math.floor(pos.z + 0.3 + 0.5);
  
  const y = Math.floor(pos.y - 1.75 - 0.1 + 0.5); 
  
  for (let x = minX; x <= maxX; x++) {
    for (let z = minZ; z <= maxZ; z++) {
        if (getBlockType(x,y,z) || blocks.has(`${x},${y},${z}`)) return true;
    }
  }
  return false;
}

export function updateArmorVisuals() {
  const helmetItem = inventory[55];
  equippedEtherite = 0;
  if (helmetItem && helmetItem.type === 'etherite_helmet') equippedEtherite++;
  let isWearingHelmet = false;
  if (helmetItem && helmetItem.type.startsWith('wood')) { head.material = materials.wood; isWearingHelmet = true; }
  else if (helmetItem && helmetItem.type.startsWith('stone')) { head.material = materials.stone; isWearingHelmet = true; }
  else if (helmetItem && helmetItem.type.startsWith('iron')) { head.material = matIron; isWearingHelmet = true; }
  else if (helmetItem && helmetItem.type.startsWith('diamond')) { head.material = matDiamond; isWearingHelmet = true; }
  else if (helmetItem && helmetItem.type.startsWith('gold')) { head.material = matGold; isWearingHelmet = true; }
  else if (helmetItem && helmetItem.type.startsWith('moonstone')) { head.material = matMoonstone; isWearingHelmet = true; }
  else if (helmetItem && helmetItem.type.startsWith('etherite')) { head.material = matEtherite; isWearingHelmet = true; }
  else { head.material = matSkin; }
  
  if (hairMesh) hairMesh.visible = !isWearingHelmet;
  if (leftEye) leftEye.visible = !isWearingHelmet;
  if (rightEye) rightEye.visible = !isWearingHelmet;
  
  const chestItem = inventory[56];
  if (chestItem && chestItem.type === 'etherite_chestplate') equippedEtherite++;
  let chestMat = matShirt;
  if (chestItem && chestItem.type.startsWith('wood')) chestMat = materials.wood as any;
  else if (chestItem && chestItem.type.startsWith('stone')) chestMat = materials.stone as any;
  else if (chestItem && chestItem.type.startsWith('iron')) chestMat = matIron as any;
  else if (chestItem && chestItem.type.startsWith('diamond')) chestMat = matDiamond as any;
  else if (chestItem && chestItem.type.startsWith('gold')) chestMat = matGold as any;
  else if (chestItem && chestItem.type.startsWith('moonstone')) chestMat = matMoonstone as any;
  else if (chestItem && chestItem.type.startsWith('etherite')) chestMat = matEtherite as any;
  body.material = chestMat;
  leftArm.material = chestMat !== matShirt ? chestMat : matSkin;
  rightArm.material = chestMat !== matShirt ? chestMat : matSkin;

  const legItem = inventory[57];
  const bootsItem = inventory[58];
  
  if (legItem && legItem.type === 'etherite_leggings') equippedEtherite++;
  if (bootsItem && bootsItem.type === 'etherite_boots') equippedEtherite++;
  
  let basePants = matPants;
  if (legItem && legItem.type.startsWith('wood')) basePants = materials.wood as any;
  else if (legItem && legItem.type.startsWith('stone')) basePants = materials.stone as any;
  else if (legItem && legItem.type.startsWith('iron')) basePants = matIron as any;
  else if (legItem && legItem.type.startsWith('diamond')) basePants = matDiamond as any;
  else if (legItem && legItem.type.startsWith('gold')) basePants = matGold as any;
  else if (legItem && legItem.type.startsWith('moonstone')) basePants = matMoonstone as any;
  else if (legItem && legItem.type.startsWith('etherite')) basePants = matEtherite as any;
  
  let bootsMat = basePants;
  if (bootsItem && bootsItem.type.startsWith('wood')) bootsMat = materials.wood as any;
  else if (bootsItem && bootsItem.type.startsWith('stone')) bootsMat = materials.stone as any;
  else if (bootsItem && bootsItem.type.startsWith('iron')) bootsMat = matIron as any;
  else if (bootsItem && bootsItem.type.startsWith('diamond')) bootsMat = matDiamond as any;
  else if (bootsItem && bootsItem.type.startsWith('gold')) bootsMat = matGold as any;
  else if (bootsItem && bootsItem.type.startsWith('moonstone')) bootsMat = matMoonstone as any;
  else if (bootsItem && bootsItem.type.startsWith('etherite')) bootsMat = matEtherite as any;

  leftLeg.material = bootsMat;
  rightLeg.material = bootsMat;
  
  renderHomesSidebar();
}

export function renderHomesSidebar() {
   const sidebar = document.getElementById('homes-sidebar');
   const list = document.getElementById('homes-list');
   if (!sidebar || !list) return;
   
   if (equippedEtherite > 0) {
      sidebar.style.display = 'block';
      list.innerHTML = '';
      for (let i = 0; i < equippedEtherite; i++) {
          const li = document.createElement('li');
          const home = homes[i];
          if (home) {
              li.className = 'home-point';
              li.innerText = home.name;
              li.onclick = () => {
                  controls.object.position.set(home.x, home.y, home.z);
                  velocity.set(0, 0, 0); // Reset jump velocity to not fall through floor/ceiling wildly
                  updateRenderedBlocks(controls.object.position, true);
              };
          } else {
              li.className = 'home-point empty-home';
              li.innerText = `[Empty Slot ${i + 1}]`;
          }
          list.appendChild(li);
      }
   } else {
      sidebar.style.display = 'none';
   }
}

export function updatePlayer() {
  const time = performance.now();
  let delta = (time - prevTime) / 1000;
  if (delta > 0.1) delta = 0.1; // Prevent physics tunneling upon lag spikes
  prevTime = time;

  updateArmorVisuals();

  if (!controls.isLocked && !isMobile) return;
  
  if (isMobile) {
      if (touchLookDelta.x !== 0 || touchLookDelta.y !== 0) {
          const euler = new THREE.Euler(0, 0, 0, 'YXZ');
          euler.setFromQuaternion(cameraRef.quaternion);
          
          euler.y -= touchLookDelta.x * 0.005;
          euler.x -= touchLookDelta.y * 0.005;
          euler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, euler.x));
          
          cameraRef.quaternion.setFromEuler(euler);
          
          touchLookDelta.x = 0;
          touchLookDelta.y = 0;
      }
  }
  
  playerAvatar.visible = cameraViewMode !== 0;
  
  // Sync Avatar
  playerAvatar.position.copy(controls.object.position);
  playerAvatar.position.y -= 0.5; // Offset to shoulder level
  
  // Do NOT sync body facing if we are in front view mode, otherwise player spins out of view!
  // Actually, sync body facing to controls.object (our input direction) so the avatar always faces outward forward.
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  euler.setFromQuaternion(controls.object.quaternion);
  playerAvatar.rotation.y = euler.y; // Sync body facing
  
  // Render updates
  updateRenderedBlocks(controls.object.position);
  
  // Raycast logic

  if (isMouseDown) {
      raycaster.setFromCamera(_center, cameraRef);
      const intersects = raycaster.intersectObjects(chunkGroup.children, false);

      if (intersects.length > 0) {
          const intersect = intersects[0];
          const mesh = intersect.object as THREE.Mesh | THREE.InstancedMesh;
          
          _blockPos.set(0, 0, 0);
          let isInstanced = false;
          let instanceId = -1;

          if (mesh instanceof THREE.InstancedMesh && intersect.instanceId !== undefined) {
              isInstanced = true;
              instanceId = intersect.instanceId;
              mesh.getMatrixAt(instanceId, _rayMat);
              _blockPos.setFromMatrixPosition(_rayMat);
          } else {
              _blockPos.copy(mesh.position);
          }
          
          const posKey = `${Math.round(_blockPos.x)},${Math.round(_blockPos.y)},${Math.round(_blockPos.z)}`;
          const blockType = worldData.get(posKey);
          
          let canMine = true;
          if (blockType === 'stone' || blockType === 'iron_ore' || blockType === 'bedrock' || blockType === 'diamond_ore' || blockType === 'gold_ore' || blockType === 'moonstone_ore' || blockType === 'etherite_ore') {
             const tool = inventory[selectedSlotIndex];
             const isPickaxe = tool && tool.type.endsWith('_pickaxe');
             const tierStr = isPickaxe ? tool.type.replace('_pickaxe', '') : '';
             const tier = ['wood', 'stone', 'iron', 'gold', 'diamond', 'moonstone', 'etherite'].indexOf(tierStr);
             
             if (blockType === 'bedrock') canMine = false;
             else if (blockType === 'etherite_ore') canMine = tier >= 5; // moonstone or better
             else if (blockType === 'moonstone_ore') canMine = tier >= 4; // diamond or better
             else if (blockType === 'diamond_ore' || blockType === 'gold_ore') canMine = tier >= 2; // iron or better
             else if (blockType === 'iron_ore') canMine = tier >= 1; // stone or better
             else if (blockType === 'stone') canMine = tier >= 0; // any pickaxe
          }

          if (!canMine) {
             crackOverlay.visible = false;
             targetBlockPos = null;
          } else if (targetBlockPos !== posKey) {
             targetBlockPos = posKey;
             mouseDownTime = time; // Restarts mining delay when pointing at a new block
             crackOverlay.visible = false;
          } else {
             crackOverlay.visible = true;
             crackOverlay.position.copy(_blockPos);
             
             const progress = Math.min((time - mouseDownTime) / MINING_TIME, 1.0);
             const stage = Math.floor(progress * 10);
             crackOverlay.material = crackMaterials[stage];
             
             if (progress >= 1.0) {
                 let minedType = null;
                 if (isInstanced) {
                     minedType = removeBlock(mesh as THREE.InstancedMesh, instanceId, posKey);
                 } else {
                     minedType = removeBlock(mesh as THREE.Mesh, undefined, posKey);
                 }
                 if (minedType) {
                     let dropType = minedType;
                     if (minedType === 'iron_ore') dropType = 'iron_ingot';
                     if (minedType === 'gold_ore') dropType = 'gold_ingot';
                     if (minedType === 'diamond_ore') dropType = 'diamond';
                     if (minedType === 'moonstone_ore') dropType = 'moonstone';
                     if (minedType === 'etherite_ore') dropType = 'etherite';
                     addItem(dropType, 1);
                 }
                 mouseDownTime = time;
                 blockMined = true;
                 crackOverlay.visible = false;
                 targetBlockPos = null;
             }
          }
      } else {
          crackOverlay.visible = false;
          targetBlockPos = null;
      }
  } else {
      crackOverlay.visible = false;
      targetBlockPos = null;
  }

  velocity.x -= velocity.x * 10.0 * delta;
  velocity.z -= velocity.z * 10.0 * delta;
  velocity.y -= 9.8 * 3.0 * delta; // 3.0 is a mass/ gravity scale

  direction.z = Number(keys.forward) - Number(keys.backward);
  direction.x = Number(keys.right) - Number(keys.left);
  direction.normalize(); // consistent movement in all directions

  let speed = keys.run ? 150.0 : 50.0;
  if (keys.shift) speed *= 0.3; // Much slower when sneaking

  // Calculate intended movement velocities based on direction
  if (keys.forward || keys.backward) velocity.z -= direction.z * speed * delta;
  if (keys.left || keys.right) velocity.x -= direction.x * speed * delta;

  // Ledge prevention logic when shifting
  if (keys.shift && canJump) {
      if (velocity.x !== 0) {
          const testX = controls.object.position.clone();
          testX.x += velocity.x * delta;
          if (!isOnSolidGround(testX)) velocity.x = 0;
      }
      if (velocity.z !== 0) {
          const testZ = controls.object.position.clone();
          testZ.z += velocity.z * delta;
          if (!isOnSolidGround(testZ)) velocity.z = 0;
      }
  }

  // Jump logic
  if (keys.jump && canJump) { 
      velocity.y = 10;
      canJump = false;
  }

  const startPos = controls.object.position.clone();
  
  // Apply horizontal movement based on rotation
  controls.moveRight(-velocity.x * delta);
  controls.moveForward(-velocity.z * delta);
  
  const newX = controls.object.position.x;
  const newZ = controls.object.position.z;

  // Resolve X
  controls.object.position.copy(startPos);
  controls.object.position.x = newX;
  if (checkCollision(controls.object.position)) {
      controls.object.position.x = startPos.x; // Blocked
      
      // Auto-jump check
      if (canJump) {
         controls.object.position.y += 1.1; // check 1 block up
         controls.object.position.x = newX;
         if (!checkCollision(controls.object.position)) {
             velocity.y = 10;
             canJump = false;
         }
         controls.object.position.copy(startPos);
      }
      velocity.x = 0;
  }

  // Resolve Z
  controls.object.position.z = newZ;
  if (checkCollision(controls.object.position)) {
      controls.object.position.z = startPos.z; // Blocked

      // Auto-jump check
      if (canJump) {
         controls.object.position.y += 1.1; // check 1 block up
         controls.object.position.z = newZ;
         if (!checkCollision(controls.object.position)) {
             velocity.y = 10;
             canJump = false;
         }
         // X may have moved, so effectively we want to restore Y and Z only if it didn't work.
         // Actually, if we jump, we just leave X and Z as startPos because we haven't cleared the block yet vertically.
         controls.object.position.y = startPos.y;
         controls.object.position.z = startPos.z;
      }
      velocity.z = 0;
  }

  // Resolve Y
  controls.object.position.y += velocity.y * delta;
  if (checkCollision(controls.object.position)) {
      if (velocity.y < 0) { // hit ground
          canJump = true;
      } else { // hit ceiling
          canJump = false;
      }
      controls.object.position.y = startPos.y;
      velocity.y = 0;
  } else {
      canJump = false;
  }

  prevTime = time;
}
