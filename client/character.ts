// Your character across saves and servers: one profile name, and (optionally) the character of a
// single-player save taken into a multiplayer server. What happens to it there (items found, items
// lost on death, health) is written back into that save, so it's the same character everywhere.
import { addItem, sanitizeInv } from '../shared/inventory.ts';
import type { InvState, ServerMsg } from '../shared/protocol.ts';
import type { PlayerSave } from '../server/core/game.ts';
import { readSave, writeSave, SP_NAME } from './saves';
import { store } from './store';

const MAX_HEALTH = 20;

// ------------------------------------------------------------------ Profile name

export const cleanName = (raw: string) => raw.trim().replace(/[^A-Za-z0-9_]/g, '').slice(0, 16);

export function profileName(): string {
  let n = cleanName(store.get('poxel_name') || '');
  if (!n) { n = `Player${Math.floor(Math.random() * 900 + 100)}`; store.set('poxel_name', n); }
  return n;
}

// The name last used on each server: when the profile name changes, the server is asked to rename
// (it moves the character and the name lock over, if the new name is free there)
function namesByServer(): Record<string, string> {
  try { return JSON.parse(store.get('poxel_server_names') || '{}'); } catch { return {}; }
}
export function previousNameOn(server: string): string | undefined {
  return namesByServer()[server];
}
export function rememberNameOn(server: string, name: string) {
  const all = namesByServer();
  all[server] = name;
  store.set('poxel_server_names', JSON.stringify(all));
}

// ------------------------------------------------------------------ Carrying a save's character

// A save whose character used /give, creative mode or dev tools stays in single player
export function canCarry(slot: number): boolean {
  return !readSave(slot)?.players[SP_NAME]?.cheated;
}

export function carryFrom(slot: number): { inv: InvState; health: number; food?: number } | undefined {
  const p = readSave(slot)?.players[SP_NAME];
  if (p?.cheated) return undefined;
  if (!p) return { inv: { slots: [], cursor: null, selected: 0, ack: 0 }, health: MAX_HEALTH }; // new save: empty-handed
  return { inv: { ...p.inv, cursor: null }, health: p.health ?? MAX_HEALTH, food: p.food ?? 20 };
}

let carrySlot = -1;       // save slot being played in multiplayer, or -1
let accepted = false;     // the server took the character (servers can turn this off)
let lastInv: InvState | null = null;
let lastHealth = MAX_HEALTH;
let lastFood: number | undefined;
let downed = false;       // leaving while downed counts as dying there (the server drops the items)
let writeTimer: ReturnType<typeof setTimeout> | undefined;

export function startCarry(slot: number) {
  carrySlot = slot; accepted = false; lastInv = null; lastHealth = MAX_HEALTH; downed = false;
}
export function stopCarry() {
  flushCarry();
  carrySlot = -1; accepted = false;
}

// Called for every server message while in multiplayer
export function onCarryMessage(m: ServerMsg) {
  if (carrySlot < 0) return;
  if (m.t === 'welcome') {
    accepted = !!m.carried;
    lastInv = m.you.inv; lastHealth = m.you.health; lastFood = m.you.food; downed = false;
  } else if (m.t === 'inv') lastInv = m.inv;
  else if (m.t === 'downed') downed = true;
  else if (m.t === 'revived') downed = false;
  else if (m.t === 'death') { downed = false; lastHealth = 0; }
  else if (m.t === 'health') lastHealth = m.hp;
  else if (m.t === 'food') lastFood = m.food;
  else return;
  if (!accepted) return;
  clearTimeout(writeTimer);
  writeTimer = setTimeout(flushCarry, 400);
}

export function flushCarry() {
  clearTimeout(writeTimer);
  if (carrySlot < 0 || !accepted || !lastInv) return;
  const save = readSave(carrySlot) || { world: null, players: {} };
  // Gone while downed: the server finishes you off and drops everything, so the save loses it too
  const dead = lastHealth <= 0 || downed;
  const inv = dead ? sanitizeInv(null) : sanitizeInv(lastInv);
  if (!dead && lastInv.cursor) addItem(inv, lastInv.cursor.type, lastInv.cursor.count); // an item held on the cursor isn't lost
  const prev = save.players[SP_NAME];
  const updated: PlayerSave = {
    ...(prev || { x: undefined as unknown as number, y: undefined as unknown as number, z: undefined as unknown as number, yaw: 0, pitch: 0 }),
    // Dead in multiplayer: the items are gone (dropped there); you come back with full health, like a respawn
    health: dead ? MAX_HEALTH : lastHealth,
    food: dead ? 20 : lastFood ?? prev?.food,
    inv: { slots: inv.slots, cursor: null, selected: inv.selected },
  };
  save.players[SP_NAME] = updated;
  writeSave(carrySlot, save).then(ok => { if (!ok) console.error('Could not update the save with the multiplayer character'); });
}

export const carryDebug = () => ({ carrySlot, accepted, lastInv, lastHealth });
