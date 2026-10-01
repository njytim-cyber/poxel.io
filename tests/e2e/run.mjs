// Runs the end-to-end suites. Starts the Vite dev client (if it isn't already running) and an
// isolated game server on port 8099 with a throwaway data folder, so the owner's world is never touched.
// Usage: node tests/e2e/run.mjs [suite...]      (default: the standard set below)
//   node tests/e2e/run.mjs soak                  60s soak, 15 bots
//   SOAK_SECONDS=3600 node tests/e2e/run.mjs soak
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, BASE, sleep, startServer } from './lib.mjs';

const TEST_PORT = 8099;
const SUITES = {
  bot: [], sp: [], cuj: [], respawn: [], mp: [], join: [], carry: [], content: [], robotic: [], crash: [],
  phone: ['mobile.mjs', 'phone'], tablet: ['mobile.mjs', 'tablet'],
  perf: [],
  soak: ['soak.mjs', `ws://localhost:${TEST_PORT}`, process.env.SOAK_BOTS || '15', process.env.SOAK_SECONDS || '60'],
};
const DEFAULT = ['bot', 'sp', 'cuj', 'respawn', 'mp', 'join', 'carry', 'content', 'robotic', 'crash', 'phone', 'tablet', 'perf'];
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT;
for (const w of wanted) if (!SUITES[w]) { console.error(`Unknown suite "${w}". Known: ${Object.keys(SUITES).join(', ')}`); process.exit(2); }

const children = [];
const cleanup = () => { for (const c of children) try { c.kill(); } catch { /* gone */ } };
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

async function reachable(url) { try { return (await fetch(url)).ok; } catch { return false; } }

// 1. Dev client
if (!(await reachable(BASE))) {
  console.log(`Starting Vite dev client for ${BASE} ...`);
  const vite = spawn(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), '--port', '5173', '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  children.push(vite);
  for (let i = 0; i < 150 && !(await reachable(BASE)); i++) await sleep(200);
  if (!(await reachable(BASE))) { console.error('Vite did not start'); process.exit(1); }
}

// 2. Isolated game server
const dataDir = join(tmpdir(), 'poxel-e2e-server');
rmSync(dataDir, { recursive: true, force: true });
children.push(await startServer({ port: TEST_PORT, dataDir, env: { MAX_PER_IP: '100', MAX_PLAYERS: '32', SEED: '12345', DEV_TOOLS: '1' } }));
const env = { ...process.env, POXEL_WS: `ws://localhost:${TEST_PORT}` };

// 3. Suites, one at a time (they share the GPU and the server)
const summary = [];
for (const name of wanted) {
  const [file = `${name}.mjs`, ...args] = SUITES[name];
  console.log(`\n=== ${name} ===`);
  const t0 = Date.now();
  const code = await new Promise(res => {
    const p = spawn(process.execPath, [join(ROOT, 'tests/e2e', file), ...args], { cwd: ROOT, env, stdio: 'inherit' });
    p.on('exit', c => res(c ?? 1));
  });
  summary.push({ name, ok: code === 0, s: Math.round((Date.now() - t0) / 1000) });
}

console.log('\n=== Summary ===');
for (const r of summary) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(8)} ${r.s}s`);
const failed = summary.filter(r => !r.ok).length;
console.log(failed ? `\n${failed} suite(s) failed` : '\nAll suites passed');
cleanup();
process.exit(failed ? 1 : 0);
