// Test coverage across everything: unit tests + all browser suites. Reports which lines of the game ran.
//   Server and shared code: from the unit tests and the test game servers (Node's V8 coverage, via c8)
//   Client code: from every test page in Chrome (mapped back to the .ts files)
// Usage: npm run coverage            (full HTML reports in coverage/server and coverage/client)
//        npm run coverage -- unit    (unit tests only, quick)
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import v8toIstanbul from 'v8-to-istanbul';
import libCoverage from 'istanbul-lib-coverage';
import libReport from 'istanbul-lib-report';
import reports from 'istanbul-reports';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'coverage', 'raw');
const unitOnly = process.argv.includes('unit');
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
  e2eCode = await run(['tests/e2e/run.mjs'], { POXEL_COVERAGE: RAW });
}

console.log('\n=== Server and shared code ===');
await run([join(ROOT, 'node_modules', 'c8', 'bin', 'c8.js'), 'report', '--temp-directory', join(RAW, 'server'), '--reports-dir', join(ROOT, 'coverage', 'server'),
  '--include', 'server/**', '--include', 'shared/**', '--reporter', 'text', '--reporter', 'html', '--all', '--src', ROOT]);

if (!unitOnly) {
  console.log('\n=== Client code (in the browser) ===');
  const map = libCoverage.createCoverageMap({});
  const dir = join(RAW, 'client');
  for (const f of readdirSync(dir).filter(n => n.endsWith('.json'))) {
    for (const e of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
      const path = new URL(e.url).pathname.replace(/^\/poxel\.io\//, '').replace(/^\//, '');
      const conv = v8toIstanbul(join(ROOT, path), 0, { source: e.text });
      try { await conv.load(); } catch { continue; } // no source map: skip
      conv.applyCoverage(e.functions);
      map.merge(conv.toIstanbul());
    }
  }
  // Only the game's own files (not dependencies)
  map.filter(file => /[\\/](client|shared)[\\/][^\\/]+\.ts$/.test(file) && file.startsWith(ROOT));
  const context = libReport.createContext({ dir: join(ROOT, 'coverage', 'client'), coverageMap: map });
  reports.create('text').execute(context);
  reports.create('html').execute(context);
}
console.log(`\nHTML reports: coverage/server/index.html${unitOnly ? '' : ' and coverage/client/index.html'}`);
if (unitCode || e2eCode) { console.log(`Some tests failed (unit ${unitCode}, browser ${e2eCode}): coverage counts only what ran.`); process.exit(1); }
