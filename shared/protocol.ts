// Messages between the game client and the (local or remote) server.
// JSON objects for everything except the two high-frequency messages (player move, entity snapshot),
// which have a compact binary encoding for WebSockets.
import type { InvAction, Stack } from './inventory.ts';
import type { FurnaceState } from './furnace.ts';

export const PROTOCOL_VERSION = 1;
export const TICK_RATE = 20;
export const MAX_PLAYERS = 16;

export type MobKind = 'pig' | 'cow' | 'chicken' | 'zombie';
export type EntityKind = 'player' | 'item' | MobKind;

export interface Look {
  skin: string; shirt: string; pants: string; hair: string; eye: string; style: number; super: string;
}

export interface PlayerInfo { name: string; look: Look }

// Sent once per entity when it comes into view
export interface SpawnInfo {
  eid: number;
  kind: EntityKind;
  x: number; y: number; z: number;
  player?: PlayerInfo & { held: string; armor: (string | null)[] };
  item?: { type: string; count: number };
}

// ack = last inventory action (seq) the server has applied, so the client knows when its prediction is confirmed
export interface InvState { slots: Stack[]; cursor: Stack; selected: number; ack?: number }

// ------------------------------------------------------------------ Client -> server

export type ClientMsg =
  | { t: 'hello'; v: number; name: string; look: Look; token?: string }
  | { t: 'move'; x: number; y: number; z: number; yaw: number; pitch: number; flags: number }
  | { t: 'dig'; x: number; y: number; z: number }
  | { t: 'place'; x: number; y: number; z: number; nx: number; ny: number; nz: number; facing: number }
  | { t: 'open'; x: number; y: number; z: number } // crafting table / furnace
  | { t: 'screen'; mode: 'inventory' | null }      // open/close the plain inventory
  | { t: 'inv'; action: InvAction; seq: number }
  | { t: 'select'; slot: number }
  | { t: 'eat' }
  | { t: 'drop'; all: boolean }
  | { t: 'attack'; eid: number }
  | { t: 'swing' }
  | { t: 'chat'; text: string }
  | { t: 'respawn' }
  | { t: 'sethome' }
  | { t: 'gohome'; i: number }
  | { t: 'ping'; ts: number };

// Move flags
export const MF_GROUND = 1, MF_SNEAK = 2, MF_WATER = 4, MF_LAVA = 8;

// ------------------------------------------------------------------ Server -> client

export type ServerMsg =
  | { t: 'welcome'; eid: number; seed: number; time: number; edits: number[]; facing: number[];
      you: { x: number; y: number; z: number; yaw: number; pitch: number; health: number; inv: InvState; spawn: [number, number, number] } }
  | { t: 'snap'; ents: number[] }                 // [eid, x, y, z, yaw, pitch, flags] * n
  | { t: 'spawn'; ents: SpawnInfo[] }
  | { t: 'despawn'; eids: number[] }
  | { t: 'blocks'; list: number[] }               // [x, y, z, id, facing(-1 none)] * n
  | { t: 'inv'; inv: InvState }
  | { t: 'screen'; mode: 'inventory' | 'table' | 'furnace' | null; furnace?: FurnaceState }
  | { t: 'furnace'; state: FurnaceState }
  | { t: 'health'; hp: number }
  | { t: 'hurt'; from: [number, number, number] | null; knock: number }
  | { t: 'death'; msg: string }
  | { t: 'pos'; x: number; y: number; z: number } // server-side correction / respawn / teleport
  | { t: 'equip'; eid: number; held: string; armor: (string | null)[] }
  | { t: 'anim'; eid: number; a: 'swing' | 'hurt' }
  | { t: 'chat'; from: string | null; text: string }
  | { t: 'time'; time: number }
  | { t: 'players'; list: { eid: number; name: string; ping: number }[] }
  | { t: 'toast'; text: string }
  | { t: 'homes'; list: { x: number; y: number; z: number; name: string }[]; slots: number }
  | { t: 'kick'; reason: string }
  | { t: 'pong'; ts: number };

// Entity snapshot flags
export const EF_SNEAK = 1, EF_HURT = 2, EF_DYING = 4, EF_GROUND = 8, EF_SWING = 16;

// ------------------------------------------------------------------ Binary encoding (WebSocket only)

const BIN_MOVE = 1, BIN_SNAP = 2;

export function encodeMove(m: Extract<ClientMsg, { t: 'move' }>): ArrayBuffer {
  const dv = new DataView(new ArrayBuffer(1 + 4 * 5 + 1));
  dv.setUint8(0, BIN_MOVE);
  dv.setFloat32(1, m.x); dv.setFloat32(5, m.y); dv.setFloat32(9, m.z);
  dv.setFloat32(13, m.yaw); dv.setFloat32(17, m.pitch);
  dv.setUint8(21, m.flags & 255);
  return dv.buffer;
}

export function encodeSnap(ents: number[]): ArrayBuffer {
  const n = ents.length / 7;
  const dv = new DataView(new ArrayBuffer(1 + 2 + n * 20));
  dv.setUint8(0, BIN_SNAP);
  dv.setUint16(1, n);
  let o = 3;
  for (let i = 0; i < ents.length; i += 7) {
    dv.setUint32(o, ents[i]);
    dv.setFloat32(o + 4, ents[i + 1]); dv.setFloat32(o + 8, ents[i + 2]); dv.setFloat32(o + 12, ents[i + 3]);
    dv.setInt16(o + 16, Math.round(wrapAngle(ents[i + 4]) * 10000));
    dv.setInt8(o + 18, Math.round(Math.max(-1.6, Math.min(1.6, ents[i + 5])) * 75));
    dv.setUint8(o + 19, ents[i + 6] & 255);
    o += 20;
  }
  return dv.buffer;
}

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a)); // -PI..PI fits Int16 at 1e-4 precision

// Decodes a binary frame into the equivalent JSON-shaped message; null if malformed
export function decodeBinary(buf: ArrayBuffer): ClientMsg | ServerMsg | null {
  if (buf.byteLength < 1) return null;
  const dv = new DataView(buf);
  const kind = dv.getUint8(0);
  if (kind === BIN_MOVE && buf.byteLength === 22) {
    return { t: 'move', x: dv.getFloat32(1), y: dv.getFloat32(5), z: dv.getFloat32(9), yaw: dv.getFloat32(13), pitch: dv.getFloat32(17), flags: dv.getUint8(21) };
  }
  if (kind === BIN_SNAP && buf.byteLength >= 3) {
    const n = dv.getUint16(1);
    if (buf.byteLength !== 3 + n * 20) return null;
    const ents: number[] = [];
    let o = 3;
    for (let i = 0; i < n; i++, o += 20) {
      ents.push(dv.getUint32(o), dv.getFloat32(o + 4), dv.getFloat32(o + 8), dv.getFloat32(o + 12),
        dv.getInt16(o + 16) / 10000, dv.getInt8(o + 18) / 75, dv.getUint8(o + 19));
    }
    return { t: 'snap', ents };
  }
  return null;
}

// ------------------------------------------------------------------ Validation helpers (server side)

export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export const isInt = (v: unknown): v is number => Number.isInteger(v);

export function sanitizeName(raw: unknown): string {
  const s = String(raw ?? '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 16);
  return s.length >= 1 ? s : 'Player';
}

const HEX = /^#[0-9a-fA-F]{6}$/;
export function sanitizeLook(raw: any): Look {
  const c = (v: unknown, d: string) => (typeof v === 'string' && HEX.test(v) ? v : d);
  return {
    skin: c(raw?.skin, '#ffcc99'), shirt: c(raw?.shirt, '#00aaff'), pants: c(raw?.pants, '#0000aa'),
    hair: c(raw?.hair, '#6b4423'), eye: c(raw?.eye, '#000000'),
    style: [0, 1, 2].includes(raw?.style) ? raw.style : 0,
    super: ['none', 'tophat', 'backpack', 'ninja'].includes(raw?.super) ? raw.super : 'none',
  };
}
