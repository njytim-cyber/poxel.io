// Shared helpers for the end-to-end suites: paths, browser launch, checks and exit codes.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer-core';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const OUT = process.env.POXEL_OUT || join(ROOT, 'tests', 'e2e', 'out');
mkdirSync(OUT, { recursive: true });

// The Vite dev client (window.poxel hooks only exist in dev builds)
export const BASE = process.env.POXEL_URL || 'http://localhost:5173/poxel.io/';
// The multiplayer server the suites join (run.mjs starts an isolated one and sets this)
export const WS = process.env.POXEL_WS || 'ws://localhost:8080';
export const BUDGETS = JSON.parse(readFileSync(join(ROOT, 'tests', 'e2e', 'budgets.json'), 'utf8'));

export const sleep = ms => new Promise(r => setTimeout(r, ms));
// Player names are claimed per server by a browser token, so every run needs fresh ones
export const RUN = Date.now().toString(36).slice(-4);
export const uniqueName = base => `${base}${RUN}`.slice(0, 16);

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const found = candidates.find(p => existsSync(p));
  if (!found) throw new Error('Chrome not found. Set CHROME_PATH to your Chrome/Chromium executable.');
  return found;
}

export const GPU_ARGS = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'];
// Needed when several tabs must keep running at full speed (background tabs throttle rAF and timers)
export const NO_THROTTLE_ARGS = ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'];

export function launch({ args = GPU_ARGS, viewport = { width: 1280, height: 720 } } = {}) {
  return puppeteer.launch({ executablePath: findChrome(), headless: 'new', args, defaultViewport: viewport });
}

// Records PASS/FAIL lines and uncaught page errors; finish() prints them and sets the exit code.
export function suite(name) {
  const results = [], errors = [];
  return {
    results, errors,
    check(label, ok, info = '') {
      const line = `${ok ? 'PASS' : 'FAIL'} ${label} ${info}`.trimEnd();
      results.push(line);
      console.log(line);
    },
    info(line) { console.log('INFO ' + line); },
    watch(page, tag = '') {
      const p = tag ? `[${tag}] ` : '';
      page.on('pageerror', e => errors.push(`${p}PAGEERROR ${e.message}`));
      page.on('console', m => { if (m.type() === 'error' && !m.text().includes('404') && !/pointer ?lock/i.test(m.text())) errors.push(`${p}console.error ${m.text()}`); });
    },
    finish() {
      const fails = results.filter(r => r.startsWith('FAIL')).length;
      const pageErrors = errors.filter(e => e.includes('PAGEERROR')).length;
      if (errors.length) console.log('ERRORS:\n' + errors.join('\n'));
      console.log(`\n${name}: ${results.length - fails}/${results.length} passed${pageErrors ? `, ${pageErrors} uncaught page errors` : ''}`);
      process.exitCode = fails || pageErrors ? 1 : 0;
      return fails + pageErrors;
    },
  };
}

export async function openGame(browser, { ctx = false } = {}) {
  const context = ctx ? await browser.createBrowserContext() : browser;
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.poxel, { timeout: 15000 }).catch(() => {
    throw new Error(`window.poxel hooks missing at ${BASE}. The suites need the Vite dev client (npm run dev).`);
  });
  await sleep(500);
  return page;
}

// Starts a game server on its own port and data folder, and waits until /health answers.
export async function startServer({ port, dataDir = join(tmpdir(), `poxel-e2e-${port}`), env = {}, stdio = 'ignore' }) {
  const proc = spawn(process.execPath, ['server/node.ts'], { cwd: ROOT, env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, ...env }, stdio });
  for (let i = 0; i < 100; i++) {
    try { if ((await (await fetch(`http://localhost:${port}/health`)).json()).ok) return proc; } catch { /* not up yet */ }
    if (proc.exitCode !== null) throw new Error(`Game server on :${port} exited with code ${proc.exitCode}`);
    await sleep(100);
  }
  proc.kill();
  throw new Error(`Game server on :${port} did not start`);
}
