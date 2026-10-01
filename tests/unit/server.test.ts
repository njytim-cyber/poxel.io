// The real network server (server/node.ts) against bad input: broken addresses, files outside the game,
// garbage and oversized messages, floods, too many connections, connections that skip Cloudflare, and a
// damaged save. Each test starts its own server on a free port with a throwaway data folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, writeFileSync, readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { WebSocket } from 'ws';

let nextPort = 8300 + Math.floor(Math.random() * 500);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function startServer(env: Record<string, string> = {}, dataDir = mkdtempSync(join(tmpdir(), 'poxel-srv-'))) {
  const port = nextPort++;
  let out = '';
  const proc: ChildProcess = spawn(process.execPath, ['server/node.ts'], { env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout!.on('data', d => { out += d; });
  proc.stderr!.on('data', d => { out += d; });
  for (let i = 0; i < 100; i++) { if ((await get(port, '/health').catch(() => null))?.status === 200) break; await sleep(100); }
  return { port, dataDir, proc, log: () => out, stop: () => proc.kill() };
}
function get(port: number, path: string): Promise<{ status: number; body: string; headers: Record<string, any> }> {
  return new Promise((res, rej) => {
    const r = request({ host: '127.0.0.1', port, path, method: 'GET' }, resp => {
      let body = ''; resp.on('data', d => { body += d; }); resp.on('end', () => res({ status: resp.statusCode!, body, headers: resp.headers }));
    });
    r.on('error', rej); r.end();
  });
}
// Connects and resolves with how it ended: the first message type seen ("welcome"), or "closed <code> <reason>"
function connect(port: number, opts: { headers?: Record<string, string>; hello?: boolean; send?: (ws: WebSocket) => void } = {}): Promise<string> {
  return new Promise(res => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: opts.headers });
    const done = (r: string) => { try { ws.terminate(); } catch { /* gone */ } res(r); };
    ws.on('open', () => {
      if (opts.hello !== false) ws.send(JSON.stringify({ t: 'hello', v: 1, name: 'Tester' + Math.floor(Math.random() * 1e4), look: {}, token: 't' + Math.random() }));
      opts.send?.(ws); // after the hello (unless hello: false)
    });
    ws.on('message', d => { const s = d.toString(); if (s.startsWith('{') && JSON.parse(s).t === 'welcome') done('welcome'); });
    ws.on('close', (code, reason) => done(`closed ${code} ${reason}`));
    ws.on('error', e => done('error ' + e.message));
    setTimeout(() => done('timeout'), 8000);
  });
}

test('http: health, the game page, and bad or sneaky addresses', async () => {
  const s = await startServer();
  try {
    const health = await get(s.port, '/health');
    assert.equal(health.status, 200);
    assert.equal(JSON.parse(health.body).ok, true);
    const root = await get(s.port, '/');
    assert.equal(root.status, 302, 'the root sends you to the game');
    assert.equal(root.headers.location, '/poxel.io/');
    assert.equal((await get(s.port, '/poxel.io/%E0%A4%A')).status, 400, 'a broken address is refused, not a crash');
    const sneaky = await get(s.port, '/poxel.io/../package.json');
    assert.ok(!sneaky.body.includes('"devDependencies"'), 'no files from outside the game folder');
    const other = await get(s.port, '/nothing-here');
    assert.match(other.body, /game server is running/);
    assert.equal((await get(s.port, '/health')).status, 200, 'still up after all that');
  } finally { s.stop(); }
});

test('websocket: garbage is ignored, a real hello still joins; oversized messages close the connection', async () => {
  const s = await startServer();
  try {
    // Before the hello: unreadable messages are ignored, anything else is refused with a clear reason
    assert.equal(await connect(s.port, { hello: false, send: ws => { ws.send('not json {'); ws.send('null'); ws.send(JSON.stringify({ t: 'move' })); } }), 'closed 4000 Expected a hello first');
    assert.equal(await connect(s.port, { hello: false, send: ws => ws.send(JSON.stringify({ t: 'hello', v: 999 })) }), 'closed 4000 Version mismatch: please refresh the page');
    // After joining: garbage doesn't get you kicked or crash the server
    const ws = new WebSocket(`ws://127.0.0.1:${s.port}`);
    await new Promise(r => ws.on('open', r));
    ws.send(JSON.stringify({ t: 'hello', v: 1, name: 'Garbler', look: {}, token: 'g' }));
    for (const junk of ['not json {', 'null', '[]', '{"t":"nope"}', '{"t":"dig","x":"a"}', '{"t":"__proto__"}']) ws.send(junk);
    ws.send(Buffer.from([7, 7, 7])); ws.send(Buffer.from([1, 2, 3, 250, 255]));
    await sleep(500);
    assert.equal(ws.readyState, WebSocket.OPEN, 'still connected after the garbage');
    ws.terminate();
    const big = await connect(s.port, { hello: false, send: ws => ws.send('x'.repeat(40 * 1024)) });
    assert.match(big, /^closed 1009/, big);
    assert.equal((await get(s.port, '/health')).status, 200);
  } finally { s.stop(); }
});

test('websocket: floods are cut off, and one network cannot take every slot', async () => {
  const s = await startServer({ MAX_PER_IP: '2' });
  try {
    // A client spamming messages (way past the burst allowance) is disconnected
    const fl = new WebSocket(`ws://127.0.0.1:${s.port}`);
    await new Promise(r => fl.on('open', r));
    fl.send(JSON.stringify({ t: 'hello', v: 1, name: 'Flooder', look: {}, token: 'f' }));
    const closed = new Promise<string>(r => fl.on('close', (code, reason) => r(`${code} ${reason}`)));
    for (let i = 0; i < 1000; i++) fl.send(JSON.stringify({ t: 'ping', ts: i }));
    assert.equal(await Promise.race([closed, sleep(5000).then(() => 'still open')]), '4008 Too many messages');
    // Two connections stay open; the third from the same address is refused
    const a = new WebSocket(`ws://127.0.0.1:${s.port}`), b = new WebSocket(`ws://127.0.0.1:${s.port}`);
    await Promise.all([a, b].map(w => new Promise(r => w.on('open', r))));
    const third = await connect(s.port);
    assert.equal(third, 'closed 4000 Too many connections from your network');
    a.terminate(); b.terminate();
  } finally { s.stop(); }
});

test('behind the Cloudflare Worker: only connections with the shared secret get in, with the real player address', async () => {
  const s = await startServer({ ORIGIN_SECRET: 'sekrit' });
  try {
    assert.equal(await connect(s.port), "closed 4003 Join through the game's website");
    assert.equal(await connect(s.port, { headers: { 'x-poxel-secret': 'wrong!' } }), "closed 4003 Join through the game's website");
    assert.equal(await connect(s.port, { headers: { 'x-poxel-secret': 'sekrit', 'x-poxel-client-ip': '203.0.113.7' } }), 'welcome');
    await sleep(200);
    assert.match(s.log(), /connected from 203\.0\.113\.7/);
  } finally { s.stop(); }
});

test('a damaged save is moved aside and the backup is used', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'poxel-srv-'));
  const first = await startServer({ SEED: '4242' }, dir);
  await sleep(300);
  first.stop();
  await sleep(500);
  const good = readFileSync(join(dir, 'world.json'), 'utf8');
  writeFileSync(join(dir, 'world.json.bak'), good);
  writeFileSync(join(dir, 'world.json'), '{ this is not json');
  mkdirSync(join(dir, 'players'), { recursive: true });
  writeFileSync(join(dir, 'players', 'broken.json'), '{{{');
  const second = await startServer({}, dir);
  try {
    await sleep(300);
    assert.match(second.log(), /Recovered .*world\.json from its backup/);
    assert.match(second.log(), /World seed 4242/, 'the same world, not a new one');
    assert.ok(readdirSync(dir).some(f => f.startsWith('world.json.corrupt-')), 'the damaged file is kept for inspection');
    // A damaged player file: that player can still join (with a fresh character), and the server stays up
    assert.equal(await connect(second.port, { send: ws => ws.send(JSON.stringify({ t: 'hello', v: 1, name: 'broken', look: {}, token: 'x' })) , hello: false }), 'welcome');
  } finally { second.stop(); }
});
