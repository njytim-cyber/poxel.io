// Server soak/fuzz test: many bots doing legit + hostile things; watches tick time and memory
// and fails if the server breaks the budgets in budgets.json.
// Usage: node tests/e2e/soak.mjs [ws-url] [bots=15] [seconds=60]
// The target server needs MAX_PER_IP >= bots (run.mjs starts one with MAX_PER_IP=100).
import WebSocket from 'ws';
import { WS, BUDGETS, RUN, sleep, suite } from './lib.mjs';
const url = process.argv[2] || WS;
const httpBase = url.replace('ws', 'http');
const BOTS = Number(process.argv[3] || 15);
const SECONDS = Number(process.argv[4] || 60);
const SAMPLE_MS = 5000;
const { check, info, finish } = suite('soak');
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
let sent = 0, recv = 0, closes = 0, kicks = 0;
const closeReasons = {};

const junkValues = [null, undefined, NaN, Infinity, -1, 1e308, -1e308, 'x', '', [], {}, true, 2 ** 53, -0, 0.5, '__proto__', { constructor: 1 }];
function junkMsg() {
  const types = ['move', 'dig', 'place', 'open', 'screen', 'inv', 'select', 'eat', 'drop', 'attack', 'swing', 'chat', 'respawn', 'sethome', 'gohome', 'ping', 'hello', 'nope', '__proto__'];
  const m = { t: pick(types) };
  for (const k of ['x', 'y', 'z', 'yaw', 'pitch', 'flags', 'slot', 'eid', 'i', 'seq', 'mode', 'text', 'all', 'facing', 'nx', 'action', 'ts', 'v', 'name', 'look'])
    if (Math.random() < 0.4) m[k] = pick(junkValues);
  if (Math.random() < 0.3) m.action = { a: pick(['click', 'book', 'outside', 'close', 'zzz']), slot: pick([...junkValues, 0, 45, 54, 59, 100, 101, 102, 999]), button: pick([0, 2, 7, 'x']), shift: pick([true, false, 'y']), result: pick(['planks', 'stick', 'diamond_pickaxe', 'nope', 5]) };
  return m;
}

async function bot(i) {
  while (running) {
    const ws = new WebSocket(url);
    let pos = null;
    const opened = await new Promise(res => { ws.on('open', () => res(true)); ws.on('error', () => res(false)); });
    if (!opened) { await sleep(500); continue; }
    ws.on('message', (d, bin) => {
      recv++;
      if (bin) return;
      const m = JSON.parse(d.toString());
      if (m.t === 'welcome') pos = { ...m.you };
      if (m.t === 'pos') pos = { ...pos, x: m.x, y: m.y, z: m.z };
      if (m.t === 'kick') kicks++;
    });
    ws.on('close', (code, reason) => { closes++; const k = `${code} ${reason}`; closeReasons[k] = (closeReasons[k] || 0) + 1; });
    const send = m => { if (ws.readyState === 1) { ws.send(typeof m === 'string' || Buffer.isBuffer(m) ? m : JSON.stringify(m)); sent++; } };
    send({ t: 'hello', v: 3, name: `Soak${RUN}${i}`.slice(0, 16), look: {} });
    await sleep(800);
    const lifetime = i % 4 === 0 ? rnd(2000, 6000) : 1e9; // a quarter of the bots churn (join/leave repeatedly)
    const born = Date.now();
    let seq = 0;
    while (running && ws.readyState === 1 && Date.now() - born < lifetime) {
      const r = Math.random();
      if (pos && r < 0.45) { // legit walking in a circle
        const a = Date.now() / 3000 + i;
        pos.x += Math.cos(a) * 0.25; pos.z += Math.sin(a) * 0.25;
        send({ t: 'move', x: pos.x, y: pos.y, z: pos.z, yaw: a, pitch: 0, flags: 1 });
      } else if (pos && r < 0.55) {
        send({ t: 'dig', x: Math.floor(pos.x + rnd(-3, 3)), y: Math.floor(pos.y + rnd(-3, 2)), z: Math.floor(pos.z + rnd(-3, 3)) });
      } else if (pos && r < 0.6) {
        send({ t: 'place', x: Math.floor(pos.x + rnd(-3, 3)), y: Math.floor(pos.y + rnd(-1, 3)), z: Math.floor(pos.z + rnd(-3, 3)), nx: 0, ny: 1, nz: 0, facing: 0 });
      } else if (r < 0.66) {
        send({ t: 'screen', mode: 'inventory' });
        send({ t: 'inv', seq: ++seq, action: { a: 'click', slot: Math.floor(rnd(0, 60)), button: pick([0, 2]), shift: Math.random() < 0.3 } });
        send({ t: 'inv', seq: ++seq, action: { a: pick(['outside', 'close']), button: 0 } });
      } else if (r < 0.68) {
        send({ t: 'chat', text: 'x'.repeat(Math.floor(rnd(1, 400))) });
      } else if (r < 0.7) {
        send({ t: 'drop', all: true }); send({ t: 'select', slot: Math.floor(rnd(0, 9)) });
      } else if (r < 0.9) {
        send(junkMsg());
      } else if (r < 0.93) {
        send(Buffer.from(Array.from({ length: Math.floor(rnd(0, 40)) }, () => Math.floor(rnd(0, 256))))); // binary garbage
      } else if (r < 0.95) {
        send('{"t":"move","x":' + '9'.repeat(400) + '}'); // absurd numbers
      } else if (r < 0.96 && pos) {
        send({ t: 'dig', x: 1e9, y: 0, z: 1e9 }); send({ t: 'place', x: -5e8, y: 10, z: 7e8, nx: 0, ny: 0, nz: 0, facing: 1 }); // far-away terrain DoS attempts
      } else {
        send({ t: 'attack', eid: Math.floor(rnd(1, 200)) });
      }
      await sleep(rnd(10, 60));
    }
    ws.close();
    await sleep(300);
  }
}

let running = true;
const samples = [];
const started = Date.now();
const monitor = (async () => {
  while (running) {
    try {
      const h = await (await fetch(`${httpBase}/health`)).json();
      samples.push({ ...h, at: (Date.now() - started) / 1000 });
      console.log(`t=${Math.round((Date.now() - started) / 1000)}s players=${h.players} mobs=${h.mobs} items=${h.items} chunks=${h.chunks} tick=${h.tickMs}ms max=${h.tickMaxMs}ms rss=${h.rssMB}MB`);
    } catch (e) { console.log('HEALTH CHECK FAILED', e.message); samples.push(null); }
    await sleep(SAMPLE_MS);
  }
})();
const bots = Array.from({ length: BOTS }, (_, i) => bot(i));
await sleep(SECONDS * 1000);
running = false;
await Promise.race([Promise.all(bots), sleep(4000)]);
await monitor;
await sleep(1000);
let alive = false;
try { alive = (await (await fetch(`${httpBase}/health`)).json()).ok; } catch { /* dead */ }
info(`sent=${sent} recv=${recv} closes=${closes} kicks=${kicks}`);
info('close reasons: ' + JSON.stringify(closeReasons));

// ---- Budgets
const B = BUDGETS.server;
const ok = samples.filter(Boolean);
const failures = samples.length - ok.length;
check('server alive after soak', alive);
check('health checks answered', failures <= B.maxHealthFailures, `${failures} failed of ${samples.length}`);
// The first 10s include warm-up (spawn chunk generation), so judge ticks after that
const warm = ok.filter(s => s.at >= 10);
const avgTick = warm.length ? Math.max(...warm.map(s => s.tickMs)) : NaN;
const maxTick = warm.length ? Math.max(...warm.map(s => s.tickMaxMs)) : NaN;
check(`average tick <= ${B.avgTickMs}ms`, avgTick <= B.avgTickMs, `worst rolling average ${avgTick}ms`);
check(`worst tick <= ${B.maxTickMs}ms`, maxTick <= B.maxTickMs, `${maxTick}ms`);
const peakRss = Math.max(...ok.map(s => s.rssMB));
check(`memory <= ${B.maxRssMB}MB`, peakRss <= B.maxRssMB, `peak ${peakRss}MB`);
// Leak check: memory slope over the second half of the run (the first half includes world warm-up)
const half = ok.filter(s => s.at >= SECONDS / 2);
if (half.length >= 4) {
  const n = half.length, mx = half.reduce((a, s) => a + s.at, 0) / n, my = half.reduce((a, s) => a + s.rssMB, 0) / n;
  const slope = half.reduce((a, s) => a + (s.at - mx) * (s.rssMB - my), 0) / half.reduce((a, s) => a + (s.at - mx) ** 2, 0) * 60;
  check(`memory growth <= ${B.maxRssGrowthMBPerMin}MB/min (second half)`, slope <= B.maxRssGrowthMBPerMin, `${slope.toFixed(2)}MB/min`);
} else info('run too short for the memory growth check');
finish();
process.exit();
