// Hosts multiplayer from this PC through Cloudflare, for free: players always use the Cloudflare site
// (SITE below). Starts the game server (only connections through the Cloudflare Worker get in), a
// Cloudflare quick tunnel to it, and points the Worker at the tunnel. A quick tunnel gets a new address
// every time it starts, so the Worker is updated each time (also when the tunnel has to restart).
// Usage: npm run host:cf      (Ctrl+C stops the server; it saves the world first)
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.PORT || '8080';
const SITE = process.env.SITE || 'https://poxel.njytim.workers.dev';
const CLOUDFLARED = process.env.CLOUDFLARED || join(homedir(), '.cloudflared-bin', 'cloudflared.exe');
const WRANGLER = join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const log = msg => console.log(`[host] ${msg}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// A new shared secret every run: the game server and the Worker both get it
const secret = randomBytes(32).toString('hex');
let stopping = false;

const server = spawn(process.execPath, ['server/node.ts'], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, PORT, ORIGIN_SECRET: secret } });
server.on('exit', code => { stopping = true; tunnel?.kill(); log(`Game server stopped (${code ?? 'signal'})`); process.exit(code ?? 0); });

// Ctrl+C reaches the game server too (same console) and it saves before exiting; just close the tunnel
process.on('SIGINT', () => { stopping = true; tunnel?.kill(); });

// Points the Worker at the tunnel (secrets, so no redeploy is needed)
async function pointWorkerAt(url) {
  const file = join(tmpdir(), `poxel-origin-${process.pid}.json`);
  writeFileSync(file, JSON.stringify({ ORIGIN_URL: url, ORIGIN_SECRET: secret }));
  try {
    const code = await new Promise(res => {
      const w = spawn(process.execPath, [WRANGLER, 'secret', 'bulk', file, '--config', 'cloudflare/wrangler.jsonc'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
      w.on('exit', c => res(c ?? 1));
    });
    if (code !== 0) { log('Could not update the Cloudflare Worker (is wrangler logged in? npx.cmd wrangler login)'); return; }
  } finally { rmSync(file, { force: true }); }
  // A brand-new tunnel takes a few seconds to become reachable
  for (let i = 0; i < 30 && !stopping; i++) {
    try { if ((await fetch(`${SITE}/health`)).ok) { log(`Multiplayer is live: ${SITE}  (press Play Online)`); return; } } catch { /* not yet */ }
    await sleep(2000);
  }
  log(`The tunnel is up but ${SITE}/health isn't answering yet; give it a minute.`);
}

let tunnel = null;
function startTunnel() {
  if (stopping) return;
  log('Starting a Cloudflare quick tunnel...');
  tunnel = spawn(CLOUDFLARED, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  let found = false;
  const scan = chunk => {
    const m = !found && String(chunk).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m) { found = true; pointWorkerAt(m[0]); }
  };
  tunnel.stdout.on('data', scan);
  tunnel.stderr.on('data', scan);
  tunnel.on('error', e => log(`cloudflared failed to start: ${e.message} (${CLOUDFLARED})`));
  // Quick tunnels can end without warning: start a new one (new address) and point the Worker at it
  tunnel.on('exit', () => { if (!stopping) { log('The tunnel closed; starting a new one.'); setTimeout(startTunnel, 2000); } });
}
startTunnel();
