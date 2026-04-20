import { worldModifications, worldData, placeBlock, updateRenderedBlocks } from './world';
import { inventory, setInventoryData } from './inventory';
import { controls, homes, updateArmorVisuals, renderHomesSidebar } from './player';
import * as THREE from 'three';

export interface SaveData {
    worldEdits: Record<string, string>;
    inventoryArr: any[];
    position: { x: number, y: number, z: number, ry: number, rx: number };
    homesArr: { x: number, y: number, z: number, name: string }[];
}

export function saveGame(slotIndex: number) {
    const edits: Record<string, string> = {};
    worldModifications.forEach((val, key) => {
        edits[key] = val;
    });

    const data: SaveData = {
        worldEdits: edits,
        inventoryArr: inventory,
        position: { 
            x: controls.object.position.x, 
            y: controls.object.position.y, 
            z: controls.object.position.z,
            ry: controls.object.rotation.y,
            rx: controls.object.rotation.x
        },
        homesArr: homes
    };

    localStorage.setItem(`poxel_save_${slotIndex}`, JSON.stringify(data));
    localStorage.setItem(`poxel_meta_${slotIndex}`, new Date().toLocaleString());
}

export function loadGame(slotIndex: number): boolean {
    const raw = localStorage.getItem(`poxel_save_${slotIndex}`);
    if (!raw) return false;
    
    try {
        const data: SaveData = JSON.parse(raw);
        
        setInventoryData(data.inventoryArr);
        
        homes.splice(0, homes.length, ...data.homesArr);
        renderHomesSidebar();
        
        worldModifications.clear();
        for (const key of Object.keys(data.worldEdits)) {
            const type = data.worldEdits[key];
            worldModifications.set(key, type);
            worldData.set(key, type);
            
            if (type !== 'air') {
                const [x,y,z] = key.split(',').map(Number);
                placeBlock(new THREE.Vector3(x,y,z), type as any);
            }
        }
        
        controls.object.position.set(data.position.x, data.position.y, data.position.z);
        
        const euler = new THREE.Euler(0, 0, 0, 'YXZ');
        euler.x = data.position.rx;
        euler.y = data.position.ry;
        controls.object.quaternion.setFromEuler(euler);
        
        updateArmorVisuals();
        updateRenderedBlocks(controls.object.position, true);
        return true;
    } catch(e) {
        console.error("Failed to load save:", e);
        return false;
    }
}

export function getSaveMeta(slotIndex: number): string | null {
    return localStorage.getItem(`poxel_meta_${slotIndex}`);
}
