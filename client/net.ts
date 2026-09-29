// Connection to the game server: a local server in a Web Worker (single player) or a remote
// WebSocket server (multiplayer). Everything else talks through send() / onMessage().
import { encodeMove, decodeBinary, PROTOCOL_VERSION, type ClientMsg, type ServerMsg, type Look } from '../shared/protocol.ts';
import type { WorldSave, PlayerSave } from '../server/core/game.ts';

export type NetStatus = 'connecting' | 'online' | 'reconnecting' | 'offline';

interface Connection { kind: 'local' | 'remote'; send(m: ClientMsg): void; close(): void }

let conn: Connection | null = null;
let messageHandler: (m: ServerMsg) => void = () => {};
let statusHandler: (s: NetStatus, detail?: string) => void = () => {};
let seq = 0;

export function onServerMessage(fn: (m: ServerMsg) => void) { messageHandler = fn; }
export function onNetStatus(fn: (s: NetStatus, detail?: string) => void) { statusHandler = fn; }
export function isMultiplayer() { return conn?.kind === 'remote'; }
export function isConnected() { return !!conn; }
export function nextSeq() { return ++seq; }

export function send(m: ClientMsg) {
  conn?.send(m);
}

export function disconnect() {
  conn?.close();
  conn = null;
}

function deliver(m: ServerMsg) {
  try { messageHandler(m); } catch (e) { console.error('Error handling server message', m.t, e); }
}

// ------------------------------------------------------------------ Local (single player)

export interface LocalSave { world: WorldSave | null; players: Record<string, PlayerSave> }
let localWorker: Worker | null = null;
let saveResolvers: ((s: LocalSave) => void)[] = [];

export function startLocal(save: LocalSave, seed: number | undefined, name: string, look: Look, onSave: (s: LocalSave) => void, difficulty?: string) {
  disconnect();
  const worker = new Worker(new URL('./serverWorker.ts', import.meta.url), { type: 'module' });
  localWorker = worker;
  worker.onmessage = e => {
    const d = e.data;
    if (d.type === 'msg') deliver(d.msg);
    else if (d.type === 'save') {
      const s: LocalSave = { world: d.world, players: d.players };
      onSave(s);
      const rs = saveResolvers; saveResolvers = [];
      rs.forEach(r => r(s));
    } else if (d.type === 'error') console.error('Local server error:', d.error);
  };
  worker.onerror = e => { console.error('Local server crashed', e.message); statusHandler('offline', 'The local game server crashed. Your last autosave is safe; reload to continue.'); };
  worker.postMessage({ type: 'init', world: save.world, players: save.players, seed, difficulty });
  conn = {
    kind: 'local',
    send: m => worker.postMessage({ type: 'msg', msg: m }),
    close: () => { worker.terminate(); if (localWorker === worker) localWorker = null; },
  };
  conn.send({ t: 'hello', v: PROTOCOL_VERSION, name, look });
  statusHandler('online');
}

// Pause/resume the local world (single player only)
export function setLocalPaused(paused: boolean) {
  localWorker?.postMessage({ type: 'pause', paused });
}

// Ask the local server to save now; resolves with the save data
export function requestLocalSave(): Promise<LocalSave | null> {
  if (!localWorker) return Promise.resolve(null);
  return new Promise(res => {
    saveResolvers.push(res);
    localWorker!.postMessage({ type: 'save' });
    setTimeout(() => res(null), 3000);
  });
}

// ------------------------------------------------------------------ Remote (multiplayer)

// helloExtra is read at every (re)connect, so a carried character is always the save's latest state
export function startRemote(url: string, name: string, look: Look, token: string, helloExtra: () => Record<string, unknown> = () => ({})) {
  disconnect();
  let ws: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let queue: ClientMsg[] = [];
  let everConnected = false;

  const open = () => {
    statusHandler(everConnected ? 'reconnecting' : 'connecting');
    try {
      ws = new WebSocket(url);
    } catch (e) {
      statusHandler('offline', `Bad server address: ${(e as Error).message}`);
      return;
    }
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      attempt = 0;
      everConnected = true;
      ws!.send(JSON.stringify({ ...helloExtra(), t: 'hello', v: PROTOCOL_VERSION, name, look, token }));
      const q = queue; queue = [];
      for (const m of q) c.send(m);
      statusHandler('online');
    };
    ws.onmessage = e => {
      let m: ServerMsg | null = null;
      try {
        m = typeof e.data === 'string' ? JSON.parse(e.data) : decodeBinary(e.data) as ServerMsg | null;
      } catch { return; }
      if (m) deliver(m);
    };
    ws.onclose = e => {
      if (closed) return;
      // 4000 = the server refused us on purpose (full, wrong version, kicked): don't retry
      if (e.code === 4000 || e.code === 4008) { statusHandler('offline', e.reason || 'Disconnected by the server'); return; }
      if (!everConnected && attempt >= 2) { statusHandler('offline', 'Could not reach the server. Check the address and that the server is running.'); return; }
      const delay = Math.min(10000, 1000 * 2 ** attempt++);
      statusHandler('reconnecting', `Connection lost, retrying in ${Math.round(delay / 1000)}s...`);
      setTimeout(() => { if (!closed) open(); }, delay);
    };
  };

  const c: Connection = {
    kind: 'remote',
    send: m => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        if (m.t === 'move') ws.send(encodeMove(m));
        else ws.send(JSON.stringify(m));
      } else if (m.t === 'chat' && queue.length < 20) queue.push(m); // replay chat after reconnecting; the rest is resynced by the server
    },
    close: () => { closed = true; ws?.close(1000); },
  };
  conn = c;
  open();
}
