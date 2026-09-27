// Single-player save slots in localStorage. The local server produces the save data; this file
// just stores it, and converts saves from older versions of the game.
import { BLOCK_ID } from '../shared/blocks.ts';
import { sanitizeInv } from '../shared/inventory.ts';
import type { LocalSave } from './net';
import type { WorldSave, PlayerSave } from '../server/core/game.ts';

export const SP_NAME = 'Player';
const key = (slot: number) => `poxel_save_${slot}`;
const metaKey = (slot: number) => `poxel_meta_${slot}`;

export function getSaveMeta(slot: number): string | null {
  try { return localStorage.getItem(metaKey(slot)); } catch { return null; }
}

export function deleteSave(slot: number) {
  try { localStorage.removeItem(key(slot)); localStorage.removeItem(metaKey(slot)); } catch { /* storage blocked */ }
}

export function writeSave(slot: number, save: LocalSave): boolean {
  try {
    localStorage.setItem(key(slot), JSON.stringify({ v: 3, ...save }));
    localStorage.setItem(metaKey(slot), new Date().toLocaleString());
    return true;
  } catch (e) {
    console.error('Save failed (storage full or blocked?)', e);
    return false;
  }
}

export function readSave(slot: number): LocalSave | null {
  let raw: string | null = null;
  try { raw = localStorage.getItem(key(slot)); } catch { return null; }
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (data.v === 3) return { world: data.world || null, players: data.players || {} };
    return migrateOldSave(data);
  } catch (e) {
    console.error('Could not read save', slot, e);
    return null;
  }
}

// Saves from before the multiplayer rewrite: block names, one player, eye-height positions (v1)
function migrateOldSave(d: any): LocalSave {
  const edits: number[] = [];
  for (const [k, name] of Object.entries(d.worldEdits || {})) {
    const [x, y, z] = k.split(',').map(Number);
    const id = name === 'air' ? 0 : BLOCK_ID[name as string];
    if (id !== undefined && [x, y, z].every(Number.isInteger)) edits.push(x, y, z, id);
  }
  const facing: number[] = [];
  for (const [k, f] of Object.entries(d.facing || {})) { const [x, y, z] = k.split(',').map(Number); facing.push(x, y, z, Number(f) & 3); }
  const world: WorldSave = {
    v: 1, seed: d.seed ?? 1337, time: typeof d.time === 'number' ? d.time : 0.3, edits, facing,
    furnaces: d.furnaces || {}, spawn: d.spawn ? [d.spawn.x, d.spawn.y, d.spawn.z] : undefined as unknown as [number, number, number],
  };
  const p = d.position || {};
  const player: PlayerSave = {
    x: p.x, y: d.feet ? p.y : p.y - 1.62, z: p.z, yaw: p.ry || 0, pitch: p.rx || 0,
    health: d.health ?? 20, inv: { ...sanitizeInv(d.inventoryArr || []), cursor: null },
    homes: Array.isArray(d.homesArr) ? d.homesArr : [],
  };
  return { world, players: { [SP_NAME]: player } };
}
