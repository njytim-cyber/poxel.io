// Poxel multiplayer server (Node.js). Run: node server/node.ts
//   PORT=8080  DATA_DIR=./data  MAX_PLAYERS=16  SEED=<number>
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, renameSync, existsSync, openSync, writeSync, fsyncSync, closeSync, copyFileSync } from 'node:fs';
import { join, normalize, extname, sep } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { Game, type Storage, type WorldSave, type PlayerSave, type Player } from './core/game.ts';
import { encodeSnap, decodeBinary, TICK_RATE, type ClientMsg, type ServerMsg } from '../shared/protocol.ts';

const PORT = Number(process.env.PORT) || 8080;
const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data');
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS) || 16;
const MAX_MESSAGE = 32 * 1024;
const RATE_PER_SEC = 80;       // messages/second allowed per client (moves are 20/s)
const RATE_BURST = 160;
const HELLO_TIMEOUT = 10_000;
const log = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`);

// ------------------------------------------------------------------ Storage (atomic JSON files)

mkdirSync(join(DATA_DIR, 'players'), { recursive: true });

// Reads a save. A damaged file is moved aside (never overwritten) and the last good backup is used instead.
function readJson<T>(file: string): T | null {
  for (const candidate of [file, `${file}.bak`]) {
    if (!existsSync(candidate)) continue;
    try {
      const data = JSON.parse(readFileSync(candidate, 'utf8')) as T;
      if (candidate !== file) log(`Recovered ${file} from its backup`);
      return data;
    } catch (e) {
      const aside = `${candidate}.corrupt-${Date.now()}`;
      try { renameSync(candidate, aside); } catch { /* keep going */ }
      log(`WARNING: ${candidate} was damaged (${(e as Error).message}); moved it to ${aside}`);
    }
  }
  return null;
}

// Crash-safe write: write + flush a temp file, keep the previous version as .bak, then swap it in.
function writeJson(file: string, data: unknown) {
  const tmp = `${file}.tmp`;
  const fd = openSync(tmp, 'w');
  try {
    writeSync(fd, JSON.stringify(data));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  if (existsSync(file)) { try { copyFileSync(file, `${file}.bak`); } catch { /* backup is best effort */ } }
  // Windows can briefly lock files (antivirus/indexer): retry the rename a few times
  for (let attempt = 0; ; attempt++) {
    try { renameSync(tmp, file); return; } catch (e) {
      if (attempt >= 4) throw e;
      const until = Date.now() + 20 * (attempt + 1);
      while (Date.now() < until) { /* short wait */ }
    }
  }
}

const playerFile = (name: string) => join(DATA_DIR, 'players', `${name.toLowerCase().replace(/[^a-z0-9_]/g, '')}.json`);

const storage: Storage = {
  loadWorld: () => readJson<WorldSave>(join(DATA_DIR, 'world.json')),
  saveWorld: s => writeJson(join(DATA_DIR, 'world.json'), s),
  loadPlayer: name => readJson<PlayerSave>(playerFile(name)),
  savePlayer: (name, s) => writeJson(playerFile(name), s),
};

const game = new Game(storage, { seed: process.env.SEED ? Number(process.env.SEED) : undefined, log, maxPlayers: MAX_PLAYERS });

// ------------------------------------------------------------------ HTTP (health check) + WebSocket

// Serves the built game (dist/) so one link gives friends both the page and the server
const DIST = join(process.cwd(), 'dist');
const BASE = '/poxel.io/';
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};
function serveStatic(url: string, res: import('node:http').ServerResponse): boolean {
  if (!existsSync(DIST)) return false;
  let path: string;
  try { path = decodeURIComponent(url.split('?')[0]); } catch { res.writeHead(400); res.end(); return true; }
  if (path === '/' || path === '/poxel.io') { res.writeHead(302, { location: BASE }); res.end(); return true; }
  if (!path.startsWith(BASE)) return false;
  path = path.slice(BASE.length) || 'index.html';
  const file = normalize(join(DIST, path));
  if (!file.startsWith(DIST + sep) || !existsSync(file)) return false; // no path traversal
  try {
    const body = readFileSync(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': path.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' });
    res.end(body);
    return true;
  } catch { return false; }
}

const http = createServer((req, res) => {
  if (req.url && req.method === 'GET' && serveStatic(req.url, res)) return;
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ ok: true, ...game.stats(), rssMB: Math.round(process.memoryUsage().rss / 1e6), uptimeS: Math.round(process.uptime()) }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('Poxel.io game server is running. Connect from the game\'s Multiplayer menu.\n');
});

const wss = new WebSocketServer({ server: http, maxPayload: MAX_MESSAGE, perMessageDeflate: false });

interface Client { ws: WebSocket; ip: string; player: Player | null; tokens: number; lastRefill: number; strikes: number; alive: boolean; pingSent: number }
const clients = new Set<Client>();
const MAX_PER_IP = Number(process.env.MAX_PER_IP) || 4;

function send(c: Client, msg: ServerMsg) {
  const ws = c.ws;
  if (ws.readyState !== ws.OPEN) return;
  // Slow connection: skip position snapshots rather than queueing them forever
  if (msg.t === 'snap') {
    if (ws.bufferedAmount > 512 * 1024) return;
    ws.send(encodeSnap(msg.ents));
    return;
  }
  // Welcome carries the whole world's edit list and may be large; everything else is small.
  if (msg.t !== 'welcome' && ws.bufferedAmount > 16 * 1024 * 1024) { ws.terminate(); return; }
  ws.send(JSON.stringify(msg));
}

function allow(c: Client): boolean {
  const now = Date.now();
  c.tokens = Math.min(RATE_BURST, c.tokens + ((now - c.lastRefill) / 1000) * RATE_PER_SEC);
  c.lastRefill = now;
  if (c.tokens >= 1) { c.tokens--; c.strikes = Math.max(0, c.strikes - 0.05); return true; }
  if (++c.strikes > 200) { c.ws.close(4008, 'Too many messages'); }
  return false;
}

wss.on('connection', (ws, req) => {
  const ip = (req.headers['fly-client-ip'] || req.headers['cf-connecting-ip'] || req.socket.remoteAddress || '?') as string;
  // One household/host can't take every slot
  if ([...clients].filter(o => o.ip === ip).length >= MAX_PER_IP) { ws.close(4000, 'Too many connections from your network'); return; }
  const c: Client = { ws, ip, player: null, tokens: RATE_BURST, lastRefill: Date.now(), strikes: 0, alive: true, pingSent: 0 };
  clients.add(c);
  const helloTimer = setTimeout(() => { if (!c.player) ws.close(4001, 'No hello'); }, HELLO_TIMEOUT);

  ws.on('pong', () => {
    c.alive = true;
    if (c.player && c.pingSent) game.setPing(c.player, Date.now() - c.pingSent);
  });

  ws.on('message', (data, isBinary) => {
    if (!allow(c)) return;
    let msg: ClientMsg | null = null;
    try {
      if (isBinary) {
        const buf = Buffer.isBuffer(data) ? data : Buffer.concat(data as Buffer[]);
        msg = decodeBinary(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer) as ClientMsg | null;
      } else {
        msg = JSON.parse(data.toString());
      }
    } catch {
      return; // malformed: ignore
    }
    if (!msg || typeof msg !== 'object') return;
    try {
      if (!c.player) {
        c.player = game.join({ send: m => send(c, m), close: reason => ws.close(4000, reason.slice(0, 120)) }, msg);
        if (c.player) { clearTimeout(helloTimer); log(`${c.player.name} connected from ${ip}`); }
        return;
      }
      game.handle(c.player, msg);
    } catch (e) {
      log(`Error handling ${(msg as any).t} from ${c.player?.name ?? ip}: ${(e as Error).stack || e}`);
    }
  });

  ws.on('close', () => {
    clearTimeout(helloTimer);
    clients.delete(c);
    if (c.player) {
      try { game.leave(c.player); } catch (e) { log(`Error on leave: ${e}`); }
    }
  });
  ws.on('error', e => log(`Socket error (${ip}): ${e.message}`));
});

// Heartbeat: drop connections that stop answering pings (sleeping laptops, dead networks)
setInterval(() => {
  for (const c of clients) {
    if (!c.alive) { c.ws.terminate(); continue; }
    c.alive = false;
    c.pingSent = Date.now();
    try { c.ws.ping(); } catch { /* socket already closing */ }
  }
}, 10_000);

// ------------------------------------------------------------------ Game loop

let last = performance.now();
setInterval(() => {
  const now = performance.now();
  const dt = (now - last) / 1000;
  last = now;
  try {
    game.tick(dt);
  } catch (e) {
    log(`Tick error (server keeps running): ${(e as Error).stack || e}`);
  }
}, 1000 / TICK_RATE);

// Save changes every 10s (only writes the world when something changed) so a crash loses very little
setInterval(() => {
  try { game.saveAll(); } catch (e) { log(`Autosave failed: ${e}`); }
}, 10_000);

function shutdown(signal: string) {
  log(`${signal} received, saving and shutting down`);
  try {
    game.broadcast({ t: 'kick', reason: 'Server is restarting. Reconnecting shortly...' });
    game.saveAll(true);
  } catch (e) { log(`Save on shutdown failed: ${e}`); }
  wss.close();
  http.close();
  setTimeout(() => process.exit(0), 300);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', e => log(`Uncaught exception (server keeps running): ${e.stack || e}`));
process.on('unhandledRejection', e => log(`Unhandled rejection: ${e}`));

// If the port is taken (e.g. the server is already running), stop instead of lingering as a zombie
http.on('error', e => {
  log(`Could not start: ${(e as Error).message}${(e as any).code === 'EADDRINUSE' ? ` (is another Poxel server already running on port ${PORT}?)` : ''}`);
  process.exit(1);
});
http.listen(PORT, () => log(`Poxel server listening on :${PORT} (data: ${DATA_DIR}, max ${MAX_PLAYERS} players)`));
