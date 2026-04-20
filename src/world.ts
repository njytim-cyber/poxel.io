import * as THREE from 'three';
import { getGrassMaterials, getCraftingTableMaterials, materials } from './textures';

export const chunkGroup = new THREE.Group();
const boxGeometry = new THREE.BoxGeometry(1, 1, 1);

// Logic state
export const worldData = new Map<string, string>(); 
export const worldModifications = new Map<string, string>(); // Only tracks player changes for Save state
export const chunkData = new Map<string, {x: number, y: number, z: number, type: 'grass'|'stone'|'wood'|'leaves'|'dirt'|'bedrock'|'crafting_table'|'iron_ore'|'diamond_ore'|'gold_ore'|'moonstone_ore'|'etherite_ore'}[]>();

// Visuals for PLACED dynamic blocks
export const blocks = new Map<string, THREE.Mesh>(); 

// Render chunks only within radius (48 blocks)
const maxBlocks = 150000; 
const _mat4 = new THREE.Matrix4();

export const instancedMeshes = {
    grass: new THREE.InstancedMesh(boxGeometry, getGrassMaterials() as any, maxBlocks),
    stone: new THREE.InstancedMesh(boxGeometry, materials.stone, maxBlocks),
    wood: new THREE.InstancedMesh(boxGeometry, materials.wood, maxBlocks),
    leaves: new THREE.InstancedMesh(boxGeometry, materials.leaves, maxBlocks),
    dirt: new THREE.InstancedMesh(boxGeometry, materials.dirt, maxBlocks),
    bedrock: new THREE.InstancedMesh(boxGeometry, materials.bedrock, maxBlocks),
    crafting_table: new THREE.InstancedMesh(boxGeometry, getCraftingTableMaterials() as any, maxBlocks),
    iron_ore: new THREE.InstancedMesh(boxGeometry, materials.iron_ore, maxBlocks),
    diamond_ore: new THREE.InstancedMesh(boxGeometry, materials.diamond_ore, maxBlocks),
    gold_ore: new THREE.InstancedMesh(boxGeometry, materials.gold_ore, maxBlocks),
    moonstone_ore: new THREE.InstancedMesh(boxGeometry, materials.moonstone_ore, maxBlocks),
    etherite_ore: new THREE.InstancedMesh(boxGeometry, materials.etherite_ore, maxBlocks)
};

// Fix THREE.JS frustum culling bug where instanced meshes disappear near the player
// Also fix raycasting aborting because boundingSphere is centered at 0!
Object.values(instancedMeshes).forEach(mesh => {
    mesh.frustumCulled = false;
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), Infinity);
});

const instanceCounts = {
    grass: 0,
    stone: 0,
    wood: 0,
    leaves: 0,
    dirt: 0,
    bedrock: 0,
    crafting_table: 0,
    iron_ore: 0,
    diamond_ore: 0,
    gold_ore: 0,
    moonstone_ore: 0,
    etherite_ore: 0
};

let lastRenderedChunk = '';
let lastPlayerPos = new THREE.Vector3(0, 0, 0);

export function updateRenderedBlocks(pos: THREE.Vector3, force = false) {
    lastPlayerPos.copy(pos);
    const chunkX = Math.floor(pos.x / 16);
    const chunkZ = Math.floor(pos.z / 16);
    const ck = `${chunkX},${chunkZ}`;
    if (!force && lastRenderedChunk === ck) return;
    lastRenderedChunk = ck;
    
    const types = Object.keys(instanceCounts) as (keyof typeof instanceCounts)[];
    for (let t = 0; t < types.length; t++) instanceCounts[types[t]] = 0;
    
    const radius = 3; 
    
    for (let cx = chunkX - radius; cx <= chunkX + radius; cx++) {
        for (let cz = chunkZ - radius; cz <= chunkZ + radius; cz++) {
            const chunkKey = `${cx},${cz}`;
            if (!generatedChunks.has(chunkKey)) {
                generateChunkRegion(cx, cz);
            }
            const arr = chunkData.get(chunkKey);
            if (!arr) continue;
            for (let i = 0, len = arr.length; i < len; i++) {
                const b = arr[i];
                const type = worldData.get(`${b.x},${b.y},${b.z}`);
                if (!type || type === 'air') continue;
                
                _mat4.makeTranslation(b.x, b.y, b.z);
                instancedMeshes[b.type].setMatrixAt(instanceCounts[b.type]++, _mat4);
            }
        }
    }
    
    for (let t = 0; t < types.length; t++) {
        const key = types[t];
        instancedMeshes[key].count = instanceCounts[key];
        instancedMeshes[key].instanceMatrix.needsUpdate = true;
    }
}

export function initWorld(scene: THREE.Scene) {
  scene.add(chunkGroup);
  scene.add(instancedMeshes.grass);
  scene.add(instancedMeshes.stone);
  scene.add(instancedMeshes.wood);
  scene.add(instancedMeshes.leaves);
  scene.add(instancedMeshes.dirt);
  scene.add(instancedMeshes.bedrock);
  scene.add(instancedMeshes.crafting_table);
  scene.add(instancedMeshes.iron_ore);
  scene.add(instancedMeshes.diamond_ore);
  scene.add(instancedMeshes.gold_ore);
  scene.add(instancedMeshes.moonstone_ore);
  scene.add(instancedMeshes.etherite_ore);
  
  chunkGroup.add(instancedMeshes.grass);
  chunkGroup.add(instancedMeshes.stone);
  chunkGroup.add(instancedMeshes.wood);
  chunkGroup.add(instancedMeshes.leaves);
  chunkGroup.add(instancedMeshes.dirt);
  chunkGroup.add(instancedMeshes.bedrock);
  chunkGroup.add(instancedMeshes.crafting_table);
  chunkGroup.add(instancedMeshes.iron_ore);
  chunkGroup.add(instancedMeshes.diamond_ore);
  chunkGroup.add(instancedMeshes.gold_ore);
  chunkGroup.add(instancedMeshes.moonstone_ore);
  chunkGroup.add(instancedMeshes.etherite_ore);

  generateChunk();
}

function addStaticBlock(x: number, y: number, z: number, type: 'grass' | 'stone' | 'wood' | 'leaves' | 'dirt' | 'bedrock' | 'iron_ore' | 'diamond_ore' | 'gold_ore' | 'moonstone_ore' | 'etherite_ore') {
    worldData.set(`${x},${y},${z}`, type);
    
    // We do NOT add air to chunkData for rendering, as it's transparent
    if (type === 'air' as any) return;
    
    const cx = Math.floor(x / 16);
    const cz = Math.floor(z / 16);
    const cKey = `${cx},${cz}`;
    if (!chunkData.has(cKey)) chunkData.set(cKey, []);
    chunkData.get(cKey)!.push({x, y, z, type});
}

export function getSpawnY(): number {
    const x = 0, z = 0;
    const octave1 = Math.sin(x/15) * Math.cos(z/15) * 5;
    const octave2 = Math.sin(x/5) * 2 + Math.cos(z/5) * 2;
    const octave3 = Math.sin((x+z)/3) * 1;
    const yLevel = Math.floor(octave1 + octave2 + octave3);
    return yLevel + 3.5; // Offset to sit exactly standing on grass surface
}

export function getBlockType(x: number, y: number, z: number): string | null {
    const key = `${Math.round(x)},${Math.round(y)},${Math.round(z)}`;
    if (worldData.has(key)) {
        const type = worldData.get(key);
        return type === 'air' ? null : type!;
    }
    
    // Implicit hidden blocks
    const octave1 = Math.sin(x/15) * Math.cos(z/15) * 5;
    const octave2 = Math.sin(x/5) * 2 + Math.cos(z/5) * 2;
    const octave3 = Math.sin((x+z)/3) * 1;
    const yLevel = Math.floor(octave1 + octave2 + octave3);
    
    if (y < yLevel && y >= yLevel - 631) {
        if (y >= yLevel - 3) return 'dirt';
        else if (y > yLevel - 631) {
             let isEtherite = false;
             if (y < yLevel - 300) {
                  const eHash = Math.sin(x * 91.12 + y * 74.233 + z * 101.4) * 93758.5453;
                  isEtherite = (eHash - Math.floor(eHash)) < 0.0025; // 0.25% chance
             }
             if (isEtherite) return 'etherite_ore';
             
             let isMoonstone = false;
             if (y < yLevel - 150) {
                  const mHash = Math.sin(x * 13.12 + y * 51.233 + z * 67.4) * 55758.5453;
                  isMoonstone = (mHash - Math.floor(mHash)) < 0.005; // 0.5% chance
             }
             if (isMoonstone) return 'moonstone_ore';

             let isDiamond = false;
             if (y < yLevel - 50) {
                  const dHash = Math.sin(x * 43.12 + y * 18.233 + z * 97.4) * 83758.5453;
                  isDiamond = (dHash - Math.floor(dHash)) < 0.01; // 1% chance
             }
             if (isDiamond) return 'diamond_ore';

             let isGold = false;
             if (y < yLevel - 30) {
                  const gHash = Math.sin(x * 12.12 + y * 33.233 + z * 11.4) * 11758.5453;
                  isGold = (gHash - Math.floor(gHash)) < 0.015; // 1.5% chance
             }
             if (isGold) return 'gold_ore';

             const hash = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
             const isIron = (hash - Math.floor(hash)) < 0.05; // 5% chance
             return isIron ? 'iron_ore' : 'stone';
        }
        else return 'bedrock';
    }
    return null;
}

const generatedChunks = new Set<string>();

export function generateChunkRegion(cx: number, cz: number) {
    const chunkKey = `${cx},${cz}`;
    if (generatedChunks.has(chunkKey)) return;
    generatedChunks.add(chunkKey);
    
    const startX = cx * 16;
    const startZ = cz * 16;
    
    for (let x = startX; x < startX + 16; x++) {
        for (let z = startZ; z < startZ + 16; z++) {
            const octave1 = Math.sin(x/15) * Math.cos(z/15) * 5;
            const octave2 = Math.sin(x/5) * 2 + Math.cos(z/5) * 2;
            const octave3 = Math.sin((x+z)/3) * 1;
            const yLevel = Math.floor(octave1 + octave2 + octave3);
            
            // Add grass and a thick crust layer to prevent visual slope holes
            if (!worldModifications.has(`${x},${yLevel},${z}`)) {
                addStaticBlock(x, yLevel, z, 'grass');
            }
            if (!worldModifications.has(`${x},${yLevel-1},${z}`)) {
                addStaticBlock(x, yLevel-1, z, 'dirt');
            }
            if (!worldModifications.has(`${x},${yLevel-2},${z}`)) {
                addStaticBlock(x, yLevel-2, z, 'dirt');
            }
            if (!worldModifications.has(`${x},${yLevel-3},${z}`)) {
                addStaticBlock(x, yLevel-3, z, 'stone');
            }
            if (Math.random() < 0.01 && x % 3 === 0 && z % 3 === 0) {
                if (Math.abs(x) <= 3 && Math.abs(z) <= 3) continue; // No trees at spawn
                
                const treeHeight = 3 + Math.floor(Math.random() * 2);
                for(let i=1; i<=treeHeight; i++) {
                    if (!worldModifications.has(`${x},${yLevel + i},${z}`)) addStaticBlock(x, yLevel + i, z, 'wood');
                }
                for(let lx = -1; lx <= 1; lx++) {
                    for(let lz = -1; lz <= 1; lz++) {
                        for(let ly = 0; ly <= 1; ly++) {
                            if (ly === 1 && Math.abs(lx) === 1 && Math.abs(lz) === 1) continue;
                            if (lx === 0 && lz === 0 && ly === 0) continue;
                            if (!worldModifications.has(`${x + lx},${yLevel + treeHeight + ly},${z + lz}`)) addStaticBlock(x + lx, yLevel + treeHeight + ly, z + lz, 'leaves');
                        }
                    }
                }
            }
        }
    }
}

export function generateChunk() {
  // Let the dynamic system cleanly manage origin
  updateRenderedBlocks(new THREE.Vector3(0, 0, 0), true);
}

function revealImplicitBlock(x: number, y: number, z: number) {
    const rx = Math.round(x);
    const ry = Math.round(y);
    const rz = Math.round(z);

    // Blast a 3x3x3 radius to reveal all diagonal hole walls so we never see x-ray sky!
    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            for (let dz = -1; dz <= 1; dz++) {
                const key = `${rx+dx},${ry+dy},${rz+dz}`;
                if (!worldData.has(key)) {
                    const implicitType = getBlockType(rx+dx, ry+dy, rz+dz);
                    if (implicitType) {
                        addStaticBlock(rx+dx, ry+dy, rz+dz, implicitType as any);
                    }
                }
            }
        }
    }
}

export function removeBlock(mesh: THREE.Mesh | THREE.InstancedMesh, instanceId?: number, key?: string): string | null {
    let blockType: string | null = null;
    if (key) {
        blockType = worldData.get(key) || null;
    }

    if (mesh instanceof THREE.InstancedMesh && instanceId !== undefined) {
        const hideMat = new THREE.Matrix4().makeScale(0, 0, 0).setPosition(0, -9999, 0);
        mesh.setMatrixAt(instanceId, hideMat);
        mesh.instanceMatrix.needsUpdate = true;
        if (key) {
            worldData.set(key, 'air');
            worldModifications.set(key, 'air');
            const [rx, ry, rz] = key.split(',').map(Number);
            revealImplicitBlock(rx, ry, rz);
            updateRenderedBlocks(lastPlayerPos, true);
        }
    } else {
        chunkGroup.remove(mesh);
        if (mesh instanceof THREE.Mesh) {
            let mPos = `${Math.round(mesh.position.x)},${Math.round(mesh.position.y)},${Math.round(mesh.position.z)}`;
            if (key) mPos = key;
            if (!blockType) {
                const t = worldData.get(mPos) || null;
                blockType = t === 'air' ? null : t;
            }
            blocks.delete(mPos);
            worldData.set(mPos, 'air');
            worldModifications.set(mPos, 'air');
        }
    }
    return blockType;
}

export function placeBlock(position: THREE.Vector3, type: 'grass' | 'dirt' | 'stone' | 'wood' | 'leaves' | 'bedrock' | 'crafting_table' | 'iron_ore' | 'diamond_ore' | 'gold_ore' | 'moonstone_ore' | 'entherite_ore' = 'wood') {
  const key = `${Math.round(position.x)},${Math.round(position.y)},${Math.round(position.z)}`;
  const existingBlock = worldData.get(key);
  if ((!existingBlock || existingBlock === 'air') && !blocks.has(key)) {
    let mat: THREE.Material | THREE.Material[] = materials.wood;
    if (type === 'stone') mat = materials.stone;
    if (type === 'dirt') mat = materials.dirt;
    if (type === 'grass') mat = getGrassMaterials();
    if (type === 'leaves') mat = materials.leaves;
    if (type === 'bedrock') mat = materials.bedrock;
    if (type === 'crafting_table') mat = getCraftingTableMaterials();
    if (type === 'iron_ore') mat = materials.iron_ore;
    if (type === 'diamond_ore') mat = materials.diamond_ore;
    if (type === 'gold_ore') mat = materials.gold_ore;
    if (type === 'moonstone_ore') mat = materials.moonstone_ore;
    if (type === 'entherite_ore') mat = materials.entherite_ore;
    
    const mesh = new THREE.Mesh(boxGeometry, mat);
    mesh.position.copy(position);
    chunkGroup.add(mesh);
    blocks.set(key, mesh);
    worldData.set(key, type);
    worldModifications.set(key, type);
  }
}
