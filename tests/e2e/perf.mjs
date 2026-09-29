// Client performance: chunk gen/mesh benchmark, then frame times while sprinting across new terrain.
// Fails when a number breaks the client budgets in budgets.json.
// Usage: node tests/e2e/perf.mjs [--swiftshader]
//   --swiftshader uses the software renderer (no GPU): numbers are reported but budgets are not enforced.
import { GPU_ARGS, BUDGETS, launch, openGame, sleep, suite } from './lib.mjs';
const software = process.argv.includes('--swiftshader');
const browser = await launch({ args: software ? ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] : GPU_ARGS });
const page = await openGame(browser);
const { check, info, watch, finish } = suite('perf');
watch(page);
const ev = (fn, ...a) => page.evaluate(fn, ...a);
const B = BUDGETS.client;
const enforce = (label, ok, detail) => software ? info(`${label}: ${detail} (not enforced with --swiftshader)`) : check(label, ok, detail);

try {
  await ev(() => window.poxel.startSingle(12345));
  await sleep(4000);
  await ev(() => window.poxel.ui.forcePlaying());
  await ev(() => window.poxel.bench()); // warm-up (JIT)
  const bench = await ev(() => window.poxel.bench());
  info('bench ' + JSON.stringify(bench));
  enforce(`chunk generation <= ${B.genMs}ms`, bench.genMs <= B.genMs, `${bench.genMs}ms`);
  enforce(`section meshing <= ${B.meshMs}ms per chunk`, bench.meshMs <= B.meshMs, `${bench.meshMs}ms`);

  // Frame-time spikes while running across new terrain (long tasks = stutter)
  await ev(() => {
    window.__frames = [];
    window.__calls = 0;
    let last = performance.now();
    const loop = () => {
      const n = performance.now(); window.__frames.push(n - last); last = n;
      window.__calls = Math.max(window.__calls, window.poxel.drawCalls?.() ?? 0);
      if (window.__frames.length < 100000) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  await page.keyboard.down('KeyW'); await page.keyboard.down('KeyR');
  for (let i = 0; i < 16; i++) { await ev(() => window.poxel.setYawPitch(0, 0)); await sleep(500); }
  await page.keyboard.up('KeyW'); await page.keyboard.up('KeyR');
  const s = await ev(() => {
    let t = 0; const spikes = [];
    window.__frames.forEach(d => { t += d; if (d > 33) spikes.push(`${d.toFixed(0)}ms@${(t / 1000).toFixed(1)}s`); });
    const f = window.__frames.slice(5).sort((a, b) => a - b);
    const p = q => +f[Math.floor(f.length * q)].toFixed(1);
    return { n: f.length, median: p(0.5), p95: p(0.95), p99: p(0.99), max: +f[f.length - 1].toFixed(1), over50: f.filter(x => x > 50).length, drawCalls: window.__calls, spikes: spikes.join(' ') };
  });
  info('frames while running ' + JSON.stringify(s));
  const slow = await ev(() => (window.poxel.slowFrames || []).map(f => `player ${f.player.toFixed(0)} world ${f.world.toFixed(0)} remote ${f.remote.toFixed(0)} render ${f.render.toFixed(0)} programs ${f.programs}`));
  if (slow.length) info('slow frames (ms): ' + slow.join(' | '));
  enforce(`median frame <= ${B.medianFrameMs}ms (60 FPS)`, s.median <= B.medianFrameMs, `${s.median}ms`);
  enforce(`p99 frame <= ${B.p99FrameMs}ms`, s.p99 <= B.p99FrameMs, `${s.p99}ms`);
  enforce(`frames over 50ms <= ${B.maxFramesOver50ms}`, s.over50 <= B.maxFramesOver50ms, `${s.over50} (max ${s.max}ms)`);
  enforce(`draw calls <= ${B.maxDrawCalls}`, s.drawCalls <= B.maxDrawCalls, `${s.drawCalls}`);
  const mem = await ev(() => ({ heapMB: Math.round(performance.memory.usedJSHeapSize / 1e6), meshes: window.poxel.scene.children.find(c => c.type === 'Group').children.length }));
  info('mem ' + JSON.stringify(mem));
} catch (e) {
  check('suite completed without a script error', false, e.message);
} finally {
  await browser.close();
}
finish();
