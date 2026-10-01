// Kill the server (hard, no graceful save), restart it, and check nothing about the world changed
// under the players: same seed, saved edits kept, and the reconnected client agrees with the server.
// Starts its own server on port 8097 with a fresh data folder.
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { launch, openGame, startServer, sleep, suite, uniqueName } from './lib.mjs';
const PORT = 8097;
const URL = `ws://localhost:${PORT}`;
const DATA = join(tmpdir(), 'poxel-e2e-crash');
const { check, watch, finish } = suite('crash');

// What a newly joining player is told: the seed and the edit list
const probeWelcome = () => new Promise((res, rej) => {
  const ws = new WebSocket(URL);
  ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', v: 3, name: uniqueName('Probe'), look: {} })));
  ws.on('message', (d, bin) => { if (bin) return; const m = JSON.parse(d.toString()); if (m.t === 'welcome') { ws.close(); res(m); } });
  ws.on('error', rej);
});

rmSync(DATA, { recursive: true, force: true });
const ENV = { SEED: '12345' };
let server = await startServer({ port: PORT, dataDir: DATA, env: ENV });

// 1. A crash seconds after a brand-new world starts (before any autosave) must not change the seed
const seed1 = (await probeWelcome()).seed;
server.kill('SIGKILL');
await sleep(500);
server = await startServer({ port: PORT, dataDir: DATA, env: ENV });
const seed2 = (await probeWelcome()).seed;
check('new world keeps its seed after an early crash', seed1 === seed2, `${seed1} -> ${seed2}`);

const browser = await launch({ viewport: { width: 900, height: 560 } });
const page = await openGame(browser, { ctx: true });
watch(page);
const ev = (f, ...a) => page.evaluate(f, ...a);
try {
  await ev((u, n) => window.poxel.connect(u, n), URL, uniqueName('Crashy'));
  await sleep(3000);
  await ev(() => window.poxel.ui.forcePlaying());

  // 2. Edit 1 is saved (we wait past the 10s autosave). Edit 2 is made right before the crash and may be lost.
  // Two solid ground blocks beside the player: x+1 (dug and saved) and x-1 (dug right before the crash)
  const b = await ev(() => { const p = window.poxel.body.pos; return { x: Math.floor(p.x), y: Math.floor(p.y) - 1, z: Math.floor(p.z) }; });
  for (let dy = 0; dy < 4 && (await ev(t => window.poxel.getBlock(t.x + 1, t.y, t.z) === 0 || window.poxel.getBlock(t.x - 1, t.y, t.z) === 0, b)); dy++) b.y--;
  const orig1 = await ev(t => window.poxel.getBlock(t.x + 1, t.y, t.z), b);
  await ev(t => window.poxel.send({ t: 'dig', x: t.x + 1, y: t.y, z: t.z }), b);
  await sleep(12000);
  await ev(t => window.poxel.send({ t: 'dig', x: t.x - 1, y: t.y, z: t.z }), b);
  await ev(t => { window.poxel.setBlock(t.x - 1, t.y, t.z, 0); }, b); // client prediction shows the hole
  await sleep(300);

  server.kill('SIGKILL');
  await sleep(1500);
  const banner = await ev(() => document.getElementById('net-banner').textContent);
  check('player told the connection dropped', /lost|retry|reconnect/i.test(banner), banner);
  server = await startServer({ port: PORT, dataDir: DATA, env: ENV });
  await sleep(8000);
  const bannerAfter = await ev(() => document.getElementById('net-banner').style.display);
  check('auto-reconnected after restart', bannerAfter === 'none', 'banner display=' + bannerAfter);
  check('still playing (not stuck in a menu)', await ev(() => window.poxel.ui.state === 'playing' || window.poxel.ui.state === 'paused'), await ev(() => window.poxel.ui.state));
  const e1 = await ev(t => window.poxel.getBlock(t.x + 1, t.y, t.z), b);
  check('saved edit survived the crash', orig1 !== 0 && e1 === 0, `block ${orig1} -> ${e1}`);

  // 3. No ghost edits: the reconnected client must see exactly what a freshly joined client sees
  const probe = await openGame(browser, { ctx: true });
  watch(probe, 'probe');
  await probe.evaluate((u, n) => window.poxel.connect(u, n), URL, uniqueName('Fresh'));
  await sleep(4000);
  const dump = p => p.evaluate(a => { const o = []; for (let dx = -8; dx <= 8; dx++) for (let dz = -8; dz <= 8; dz++) for (let y = a.y - 12; y <= a.y + 12; y++) o.push(window.poxel.getBlock(a.x + dx, y, a.z + dz)); return o; }, b);
  const [mine, fresh] = [await dump(page), await dump(probe)];
  const diffs = mine.filter((v, i) => v !== fresh[i]).length;
  check('reconnected client matches the server (no ghost edits)', diffs === 0, `${diffs} of ${mine.length} blocks differ`);
  await probe.browserContext().close();

  // 4. Can keep playing
  const p0 = await ev(() => ({ ...window.poxel.body.pos }));
  await ev(() => window.poxel.ui.forcePlaying());
  await page.keyboard.down('KeyW'); await sleep(700); await page.keyboard.up('KeyW');
  const p1 = await ev(() => ({ ...window.poxel.body.pos }));
  check('can move after reconnect', Math.hypot(p1.x - p0.x, p1.z - p0.z) > 1);
} catch (e) {
  check('suite completed without a script error', false, e.message);
} finally {
  server.kill('SIGKILL');
  await browser.close();
}
finish();
