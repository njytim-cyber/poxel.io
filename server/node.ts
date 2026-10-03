// Riventale multiplayer server (Node.js). Run: node server/node.ts
//   PORT=8080  DATA_DIR=./data  MAX_PLAYERS=16  SEED=<number>
import { createServer, type IncomingMessage } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { takeCoverage } from 'node:v8';
import { mkdirSync, readFileSync, renameSync, existsSync, openSync, writeSync, fsyncSync, closeSync, copyFileSync, appendFileSync, statSync, rmSync } from 'node:fs';
import { join, normalize, extname, sep } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { Game, type Conn, type Storage, type WorldSave, type PlayerSave, type Player } from './core/game.ts';
import { encodeSnap, decodeBinary, TICK_RATE, type ClientMsg, type ServerMsg } from '../shared/protocol.ts';

const PORT = Number(process.env.PORT) || 8080;
const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data');
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS) || 16;
const MAX_MESSAGE = 32 * 1024;
const RATE_PER_SEC = 80;       // messages/second allowed per client (moves are 20/s)
const RATE_BURST = 160;
const HELLO_TIMEOUT = 10_000;
const log = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`);
// Test coverage runs only (NODE_V8_COVERAGE is set by the test tools): tests often kill the server outright,
// which skips the usual write at exit, so save what has run every second
if (process.env.NODE_V8_COVERAGE) setInterval(takeCoverage, 1000).unref();

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
  deletePlayer: name => { for (const f of [playerFile(name), `${playerFile(name)}.bak`]) rmSync(f, { force: true }); },
};

// Operators (/give, /gamemode): OPS=name1,name2, or one name per line in DATA_DIR/ops.txt. Nobody by default.
function readOps(): string[] {
  let list = process.env.OPS || '';
  if (!list) { try { list = readFileSync(join(DATA_DIR, 'ops.txt'), 'utf8'); } catch { /* no file: no operators */ } }
  return list.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
}

const game = new Game(storage, { seed: process.env.SEED ? Number(process.env.SEED) : undefined, log, maxPlayers: MAX_PLAYERS,
  allowCarry: process.env.ALLOW_CARRY !== '0',
  devTools: process.env.DEV_TOOLS === '1', // test servers only: anyone may teleport, give items and spawn mobs
  difficulty: (['easy', 'medium', 'hard'].includes(process.env.DIFFICULTY || '') ? process.env.DIFFICULTY : 'medium') as 'easy' | 'medium' | 'hard', // DIFFICULTY for a new world
  ops: readOps() }); // ALLOW_CARRY=0: players can't bring characters from single-player saves

// ------------------------------------------------------------------ HTTP (health check) + WebSocket

// Serves the built game (dist/) so one link gives friends both the page and the server
const DIST = join(process.cwd(), 'dist');
const BASE = '/riventale/';
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};
function serveStatic(url: string, res: import('node:http').ServerResponse): boolean {
  if (!existsSync(DIST)) return false;
  let path: string;
  try { path = decodeURIComponent(url.split('?')[0]); } catch { res.writeHead(400); res.end(); return true; }
  if (path === '/' || path === '/riventale') { res.writeHead(302, { location: BASE }); res.end(); return true; }
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
  res.end('Riventale game server is running. Connect from the game\'s Multiplayer menu.\n');
});

const wss = new WebSocketServer({ server: http, maxPayload: MAX_MESSAGE, perMessageDeflate: false });

// Shared with the Cloudflare Worker (cloudflare/worker.js), which adds it to every connection it forwards
const ORIGIN_SECRET = process.env.ORIGIN_SECRET || '';
function fromEdge(req: IncomingMessage): boolean {
  const got = Buffer.from(String(req.headers['x-poxel-secret'] || ''));
  const want = Buffer.from(ORIGIN_SECRET);
  return got.length === want.length && timingSafeEqual(got, want);
}

interface Client { ws: WebSocket; conn: Conn; ip: string; player: Player | null; tokens: number; lastRefill: number; strikes: number; alive: boolean; pingSent: number }
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
  // Behind the Cloudflare Worker (ORIGIN_SECRET set): only connections carrying the secret get in, so
  // nobody can go around Cloudflare's protection, and the player's real address comes from the Worker
  if (ORIGIN_SECRET && !fromEdge(req)) { ws.close(4003, 'Join through the game\'s website'); return; }
  // Proxy headers can be forged by anyone who reaches the port directly, so they only count when the
  // connection comes from a proxy on this machine (cloudflared)
  const direct = req.socket.remoteAddress || '?';
  const viaProxy = /^(127\.|::1$|::ffff:127\.)/.test(direct);
  const ip = (ORIGIN_SECRET && req.headers['x-poxel-client-ip'] as string)
    || (viaProxy && req.headers['cf-connecting-ip']) as string || direct;
  // One household/host can't take every slot
  if ([...clients].filter(o => o.ip === ip).length >= MAX_PER_IP) { ws.close(4000, 'Too many connections from your network'); return; }
  const c: Client = { ws, conn: null!, ip, player: null, tokens: RATE_BURST, lastRefill: Date.now(), strikes: 0, alive: true, pingSent: 0 };
  c.conn = { send: m => send(c, m), close: reason => ws.close(4000, reason.slice(0, 120)) };
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
        c.player = game.join(c.conn, msg);
        if (c.player) { clearTimeout(helloTimer); log(`${c.player.name} connected from ${ip}`); }
        return;
      }
      game.handle(c.player, msg);
    } catch (e) {
      log(`Error handling ${(msg as any).t} from ${c.player?.name ?? ip}: ${(e as Error).stack || e}`);
    }
  });

  ws.on('close', code => {
    clearTimeout(helloTimer);
    clients.delete(c);
    if (c.player) {
      // 1000/1001: the player quit or closed the tab, so they leave now. Anything else (network, a proxy
      // restarting, a dead connection) holds their place for a quick reconnect.
      try { game.disconnect(c.player, c.conn, code !== 1000 && code !== 1001); } catch (e) { log(`Error on leave: ${e}`); }
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

// Per-minute health window (see the health log below)
const win = { ticks: 0, tickMsSum: 0, tickMsMax: 0, slowTicks: 0, lagMsMax: 0, saves: 0, saveMsMax: 0 };
const SLOW_TICK_MS = 25;

let last = performance.now();
setInterval(() => {
  const now = performance.now();
  const dt = (now - last) / 1000;
  last = now;
  // Event loop lag: how late this tick started (a blocking save or GC pause shows up here)
  win.lagMsMax = Math.max(win.lagMsMax, dt * 1000 - 1000 / TICK_RATE);
  try {
    game.tick(dt);
  } catch (e) {
    log(`Tick error (server keeps running): ${(e as Error).stack || e}`);
  }
  const ms = performance.now() - now;
  win.ticks++; win.tickMsSum += ms; win.tickMsMax = Math.max(win.tickMsMax, ms);
  if (ms > SLOW_TICK_MS) win.slowTicks++;
}, 1000 / TICK_RATE);

// Save changes every 10s (only writes the world when something changed) so a crash loses very little
setInterval(() => {
  const t0 = performance.now();
  try { game.saveAll(); } catch (e) { log(`Autosave failed: ${e}`); }
  const ms = performance.now() - t0;
  win.saves++; win.saveMsMax = Math.max(win.saveMsMax, ms);
}, 10_000);

// ------------------------------------------------------------------ Health log
// One JSON line per minute in DATA_DIR/health.log (rotated at 5 MB), plus warnings in the main log
// when ticks run slow or memory keeps climbing. Read it with: tail -f data/health.log
const HEALTH_LOG = join(DATA_DIR, 'health.log');
const HEALTH_MAX_BYTES = 5 * 1024 * 1024;
const rssHistory: number[] = []; // one sample per minute, last hour
setInterval(() => {
  const rssMB = Math.round(process.memoryUsage().rss / 1e6);
  const heapMB = Math.round(process.memoryUsage().heapUsed / 1e6);
  const entry = {
    at: new Date().toISOString(), uptimeMin: Math.round(process.uptime() / 60), ...game.stats(),
    tickAvgMs: +(win.tickMsSum / Math.max(1, win.ticks)).toFixed(2), tickMaxMs: +win.tickMsMax.toFixed(1), slowTicks: win.slowTicks,
    lagMaxMs: Math.round(win.lagMsMax), saveMaxMs: Math.round(win.saveMsMax), rssMB, heapMB, sockets: clients.size,
  };
  try {
    if (existsSync(HEALTH_LOG) && statSync(HEALTH_LOG).size > HEALTH_MAX_BYTES) renameSync(HEALTH_LOG, `${HEALTH_LOG}.1`);
    appendFileSync(HEALTH_LOG, JSON.stringify(entry) + '\n');
  } catch (e) { log(`Could not write the health log: ${(e as Error).message}`); }
  if (win.tickMsMax > SLOW_TICK_MS) log(`WARNING: slow ticks in the last minute: worst ${entry.tickMaxMs}ms, ${win.slowTicks} over ${SLOW_TICK_MS}ms (players=${entry.players} mobs=${entry.mobs} items=${entry.items})`);
  if (win.saveMsMax > 100) log(`WARNING: autosave took ${entry.saveMaxMs}ms (the server pauses while saving)`);
  rssHistory.push(rssMB);
  if (rssHistory.length > 60) rssHistory.shift();
  // Memory warning: grew more than 100 MB over the last 30 minutes and is still at its peak
  if (rssHistory.length >= 30) {
    const old = rssHistory[rssHistory.length - 30];
    if (rssMB - old > 100 && rssMB >= Math.max(...rssHistory)) log(`WARNING: memory keeps growing: ${old} MB -> ${rssMB} MB over 30 minutes`);
  }
  Object.assign(win, { ticks: 0, tickMsSum: 0, tickMsMax: 0, slowTicks: 0, lagMsMax: 0, saves: 0, saveMsMax: 0 });
}, 60_000);

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

// If the port is taken (e.g. the server is already running), stop instead of lingering as a zombie.
// The WebSocket server re-emits the HTTP server's errors, and its listener runs first: handle both,
// or the error becomes an "uncaught exception" and the process keeps running without a port.
const onStartError = (e: Error) => {
  log(`Could not start: ${e.message}${(e as any).code === 'EADDRINUSE' ? ` (is another Riventale server already running on port ${PORT}?)` : ''}`);
  process.exit(1);
};
http.on('error', onStartError);
wss.on('error', onStartError);
http.listen(PORT, () => log(`Riventale server listening on :${PORT} (data: ${DATA_DIR}, max ${MAX_PLAYERS} players)`));
