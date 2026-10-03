// Single-player save slots in IndexedDB (localStorage's ~5 MB quota is too small for big worlds).
// All slots are loaded into memory once at startup (initSaves), so reads stay synchronous; writes
// update memory straight away and reach the database in the background (savesSettled waits for them).
// Saves from older versions in localStorage are moved over on first start. The local server produces
// the save data; this file just stores it, and converts saves from older versions of the game.
import { BLOCK_ID } from '../shared/blocks.ts';
import { sanitizeInv } from '../shared/inventory.ts';
import type { LocalSave } from './net';
import type { WorldSave, PlayerSave } from '../server/core/game.ts';

export const SP_NAME = 'Player';
export const SAVE_SLOTS = 5;
const key = (slot: number) => `poxel_save_${slot}`;
const metaKey = (slot: number) => `poxel_meta_${slot}`;

interface Stored { save: LocalSave; meta: string; at?: number } // at: when it was written (ms)
const cache = new Map<number, Stored>();
let db: IDBDatabase | null = null;          // null: IndexedDB unavailable, fall back to localStorage
let lastWrite: Promise<boolean> = Promise.resolve(true);

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('poxel', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('saves');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('database blocked by another tab'));
    setTimeout(() => reject(new Error('timed out opening the database')), 4000);
  });
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db!.transaction('saves', mode);
    const req = run(t.objectStore('saves'));
    t.oncomplete = () => resolve(req.result);
    t.onerror = t.onabort = () => reject(t.error || req.error);
  });
}

function parseLegacy(raw: string): LocalSave | null {
  try {
    const data = JSON.parse(raw);
    if (data.v === 3) return { world: data.world || null, players: data.players || {} };
    return migrateOldSave(data);
  } catch (e) {
    console.error('Could not read an old save', e);
    return null;
  }
}

// When a localStorage save was written (0: by an older version, before times were kept)
function savedAt(raw: string): number {
  const m = /^\{"v":3,"at":(\d+)/.exec(raw);
  return m ? Number(m[1]) : 0;
}

function lsGet(k: string) { try { return localStorage.getItem(k); } catch { return null; } }

// Loads every slot. Call once (and await it) before using the other functions.
export async function initSaves() {
  try {
    db = await openDb();
    for (let slot = 0; slot < SAVE_SLOTS; slot++) {
      const got = await tx<Stored | undefined>('readonly', s => s.get(slot));
      // A save in localStorage is either from an older version, or was written by a session that couldn't
      // open IndexedDB: use it if it's newer than the database copy
      const raw = lsGet(key(slot));
      const lsAt = raw ? savedAt(raw) : 0;
      const save = raw && (!got?.save || lsAt > (got.at || 0)) ? parseLegacy(raw) : null;
      if (!save) {
        if (got?.save) cache.set(slot, got);
        if (raw) try { localStorage.removeItem(key(slot)); localStorage.removeItem(metaKey(slot)); } catch { /* ignore */ }
        continue;
      }
      const moved: Stored = { save, meta: lsGet(metaKey(slot)) || new Date().toLocaleString(), at: lsAt || Date.now() };
      await tx('readwrite', s => s.put(moved, slot));
      cache.set(slot, moved);
      try { localStorage.removeItem(key(slot)); localStorage.removeItem(metaKey(slot)); } catch { /* ignore */ }
    }
    navigator.storage?.persist?.().catch(() => {}); // ask the browser not to clear saves under storage pressure
  } catch (e) {
    console.warn('IndexedDB unavailable, saving to localStorage instead', e);
    db = null;
    for (let slot = 0; slot < SAVE_SLOTS; slot++) {
      const raw = lsGet(key(slot));
      const save = raw && parseLegacy(raw);
      if (save) cache.set(slot, { save, meta: lsGet(metaKey(slot)) || '', at: savedAt(raw!) });
    }
  }
}

export function getSaveMeta(slot: number): string | null {
  return cache.get(slot)?.meta ?? null;
}

// When the slot was last written (ms since 1970), or 0 if unknown
export function getSaveTime(slot: number): number {
  return cache.get(slot)?.at ?? 0;
}

export function readSave(slot: number): LocalSave | null {
  return cache.get(slot)?.save ?? null;
}

export function deleteSave(slot: number) {
  cache.delete(slot);
  if (db) lastWrite = lastWrite.then(() => tx('readwrite', s => s.delete(slot))).then(() => true, () => false);
  try { localStorage.removeItem(key(slot)); localStorage.removeItem(metaKey(slot)); } catch { /* storage blocked */ }
}

// Resolves to false when the browser refused to store it (storage full or blocked)
export function writeSave(slot: number, save: LocalSave): Promise<boolean> {
  const stored: Stored = { save, meta: new Date().toLocaleString(), at: Date.now() };
  cache.set(slot, stored);
  if (!db) {
    try {
      localStorage.setItem(key(slot), JSON.stringify({ v: 3, at: stored.at, ...save }));
      localStorage.setItem(metaKey(slot), stored.meta);
      return lastWrite = Promise.resolve(true);
    } catch (e) {
      console.error('Save failed (storage full or blocked?)', e);
      return lastWrite = Promise.resolve(false);
    }
  }
  // Chained so writes land in order and a slow one is never overtaken by an older one
  return lastWrite = lastWrite.then(() => tx('readwrite', s => s.put(stored, slot))).then(() => true, e => {
    console.error('Save failed (storage full or blocked?)', e);
    return false;
  });
}

// Resolves when every write so far has been stored; false if the last one failed
export function savesSettled(): Promise<boolean> { return lastWrite; }

// "12.3 MB used of 2.1 GB", or null when the browser won't say
export async function storageUsage(): Promise<string | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    if (!e || e.usage === undefined || !e.quota) return null;
    const mb = (n: number) => n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${(n / 1e6).toFixed(1)} MB`;
    return `${mb(e.usage)} used of ${mb(e.quota)}`;
  } catch { return null; }
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
