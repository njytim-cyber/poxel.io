import * as THREE from 'three';
import { resetWorld, importMods, exportMods, facing, getSeed, loadAreaNow, findSpawn, surfaceHeight } from './world';
import { inventory, setInventoryData } from './inventory';
import { body, homes, health, setHealth, setPlayerFeet, setSpawnPoint, getYawPitch, setYawPitch, updateArmorVisuals, renderHomesSidebar, EYE_HEIGHT } from './player';
import { furnaces, type FurnaceState } from './furnace';
import { boxIntersectsSolid } from './physics';
import { clearItems } from './entities';
import { clearMobs } from './mobs';
import { getTimeOfDay, setTimeOfDay } from './sky';

export interface SaveData {
  version?: number;
  seed?: number;
  worldEdits: Record<string, string>;
  facing?: Record<string, number>;
  furnaces?: Record<string, FurnaceState>;
  inventoryArr: any[];
  position: { x: number; y: number; z: number; ry: number; rx: number };
  feet?: boolean;
  health?: number;
  time?: number;
  spawn?: { x: number; y: number; z: number };
  homesArr: { x: number; y: number; z: number; name: string }[];
}

let spawn = new THREE.Vector3();

export function newWorld(seed: number) {
  clearItems();
  clearMobs();
  resetWorld(seed);
  furnaces.clear();
  spawn = findSpawn();
  setSpawnPoint(spawn);
  setPlayerFeet(spawn);
  setTimeOfDay(0.3);
}

export function saveGame(slotIndex: number): boolean {
  try {
    const { yaw, pitch } = getYawPitch();
    const data: SaveData = {
      version: 2,
      seed: getSeed(),
      worldEdits: exportMods(),
      facing: Object.fromEntries(facing),
      furnaces: Object.fromEntries(furnaces),
      inventoryArr: inventory,
      position: { x: body.pos.x, y: body.pos.y, z: body.pos.z, ry: yaw, rx: pitch },
      feet: true,
      health,
      time: getTimeOfDay(),
      spawn: { x: spawn.x, y: spawn.y, z: spawn.z },
      homesArr: homes,
    };
    localStorage.setItem(`poxel_save_${slotIndex}`, JSON.stringify(data));
    localStorage.setItem(`poxel_meta_${slotIndex}`, new Date().toLocaleString());
    return true;
  } catch (e) {
    console.error('Save failed:', e);
    return false;
  }
}

export function loadGame(slotIndex: number): boolean {
  const raw = localStorage.getItem(`poxel_save_${slotIndex}`);
  if (!raw) return false;
  try {
    const data: SaveData = JSON.parse(raw);
    clearItems();
    clearMobs();
    resetWorld(data.seed ?? 1337);
    importMods(data.worldEdits || {});
    for (const [k, v] of Object.entries(data.facing || {})) facing.set(k, v);
    furnaces.clear();
    for (const [k, v] of Object.entries(data.furnaces || {})) furnaces.set(k, v);

    setInventoryData(data.inventoryArr || []);
    homes.splice(0, homes.length, ...(data.homesArr || []));

    spawn = data.spawn ? new THREE.Vector3(data.spawn.x, data.spawn.y, data.spawn.z) : findSpawn();
    setSpawnPoint(spawn);

    const p = data.position;
    const feet = new THREE.Vector3(p.x, data.feet ? p.y : p.y - EYE_HEIGHT, p.z);
    loadAreaNow(feet.x, feet.z, 1);
    // Old saves (or terrain changes) can put the player inside blocks: lift to the surface
    if (!Number.isFinite(feet.x + feet.y + feet.z) || boxIntersectsSolid(feet.x, feet.y, feet.z, 0.36, 1.8)) {
      if (!Number.isFinite(feet.x + feet.z)) feet.copy(spawn);
      else feet.y = surfaceHeight(Math.floor(feet.x), Math.floor(feet.z)) + 1;
    }
    setPlayerFeet(feet);
    setYawPitch(p.ry || 0, p.rx || 0);
    setHealth(data.health ?? 20);
    if (data.time !== undefined) setTimeOfDay(data.time);
    updateArmorVisuals();
    renderHomesSidebar();
    return true;
  } catch (e) {
    console.error('Failed to load save:', e);
    return false;
  }
}

export function getSaveMeta(slotIndex: number): string | null {
  return localStorage.getItem(`poxel_meta_${slotIndex}`);
}
