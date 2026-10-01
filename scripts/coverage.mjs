// Test coverage across everything: unit tests + browser suites.
//   Server and shared code: which lines ran in the unit tests and the test game servers (Node's V8 coverage, via c8)
//   Client code: which named functions ran on any test page in Chrome (with their .ts line). Line-level
//   numbers aren't reported for the client: they come from Vite's compiled code and don't map back reliably.
// Usage: npm run coverage               (full; line-by-line HTML report for server/shared in coverage/server)
//        npm run coverage -- unit       (unit tests only, quick)
//        npm run coverage -- sp mp      (unit tests + just these browser suites)
// perf and mpcuj are left out by default (see below).
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'coverage', 'raw');
const unitOnly = process.argv.includes('unit');
const picked = process.argv.slice(2).filter(a => a !== 'unit');
// The standard set (tests/e2e/run.mjs) without perf (coverage slows the game past its frame budgets) and
// mpcuj (under coverage its Save & Quit reload hangs the page: "detached Frame"; it passes without coverage)
const suites = picked.length ? picked : ['-perf', '-mpcuj'];
rmSync(join(ROOT, 'coverage'), { recursive: true, force: true });
mkdirSync(join(RAW, 'server'), { recursive: true });

const run = (args, env) => new Promise(res => {
  const p = spawn(process.execPath, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } });
  p.on('exit', code => res(code ?? 1));
});

console.log('\n=== Unit tests (with coverage) ===');
const unitCode = await run(['--test', 'tests/unit/*.test.ts'], { NODE_V8_COVERAGE: join(RAW, 'server') });
let e2eCode = 0;
if (!unitOnly) {
  console.log('\n=== Browser suites (with coverage) ===');
  e2eCode = await run(['tests/e2e/run.mjs', ...suites], { POXEL_COVERAGE: RAW });
}

console.log('\n=== Server and shared code: lines that ran ===');
await run([join(ROOT, 'node_modules', 'c8', 'bin', 'c8.js'), 'report', '--temp-directory', join(RAW, 'server'), '--reports-dir', join(ROOT, 'coverage', 'server'),
  '--include', 'server/**', '--include', 'shared/**', '--reporter', 'text', '--reporter', 'html', '--all', '--src', ROOT]);

if (!unitOnly) {
  console.log('\n=== Client code (in the browser): named functions that ran ===');
  const SOURCE_MAP = /\/\/# sourceMappingURL=data:application\/json(?:;charset=[^;,]+)?;base64,([A-Za-z0-9+/=]+)\s*$/;
  const files = new Map(); // file -> Map(key -> { name, line, ran })
  const dir = join(RAW, 'client');
  // Snapshots carry each script's source only once (per test process): collect those first
  const snapshots = readdirSync(dir).filter(n => n.endsWith('.json')).map(f => JSON.parse(readFileSync(join(dir, f), 'utf8')));
  const texts = new Map();
  for (const snap of snapshots) for (const e of snap) if (e.text) texts.set(e.url, e.text);
  for (const snap of snapshots) {
    for (const e of snap) {
      e.text ??= texts.get(e.url);
      if (!e.text) continue;
      const file = new URL(e.url).pathname.replace(/^\/poxel\.io\//, '').replace(/^\//, '');
      if (!/^(client|shared)\/[^/]+\.ts$/.test(file)) continue;
      const m = e.text.match(SOURCE_MAP);
      const map = m ? new TraceMap(JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'))) : null;
      const lineStarts = [0];
      for (let i = 0; i < e.text.length; i++) if (e.text[i] === '\n') lineStarts.push(i + 1);
      const positionOf = off => {
        let lo = 0, hi = lineStarts.length - 1;
        while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= off) lo = mid; else hi = mid - 1; }
        return { line: lo + 1, column: off - lineStarts[lo] };
      };
      const fns = files.get(file) || new Map();
      files.set(file, fns);
      for (const fn of e.functions) {
        if (!fn.functionName) continue; // anonymous callbacks and the module body: too noisy to list
        const at = positionOf(fn.ranges[0].startOffset);
        const line = (map && originalPositionFor(map, at).line) || at.line;
        const key = `${fn.functionName}@${fn.ranges[0].startOffset}`;
        const ran = fn.ranges[0].count > 0;
        const cur = fns.get(key);
        if (cur) cur.ran ||= ran; else fns.set(key, { name: fn.functionName, line, ran });
      }
    }
  }
  let all = 0, ran = 0;
  for (const [file, fns] of [...files].sort()) {
    const list = [...fns.values()];
    const done = list.filter(x => x.ran).length;
    all += list.length; ran += done;
    const missing = list.filter(x => !x.ran).sort((a, b) => a.line - b.line).map(x => `${x.name}:${x.line}`);
    console.log(`${file.padEnd(24)} ${String(Math.round(done / Math.max(1, list.length) * 100)).padStart(3)}%  (${done}/${list.length})${missing.length ? '   never ran: ' + missing.join(', ') : ''}`);
  }
  console.log(`${'All (in the browser)'.padEnd(24)} ${String(Math.round(ran / Math.max(1, all) * 100)).padStart(3)}%  (${ran}/${all} named functions ran)`);
}
console.log('\nLine-by-line report for server and shared code: coverage/server/index.html');
if (unitCode || e2eCode) { console.log(`Some tests failed (unit ${unitCode}, browser ${e2eCode}): coverage counts only what ran.`); process.exit(1); }
