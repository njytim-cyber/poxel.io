// Die and respawn, in single player and multiplayer: death screen, full health, back at spawn, can move.
// Usage: node tests/e2e/respawn.mjs [ws-url]
import { WS, launch, openGame, sleep, suite, uniqueName } from './lib.mjs';
const url = process.argv[2] || WS;
const browser = await launch({ viewport: { width: 960, height: 600 } });
const { check, watch, finish } = suite('respawn');

try {
  for (const modeName of ['single', 'multi']) {
    const page = await openGame(browser, { ctx: true });
    watch(page, modeName);
    const ev = (f, ...a) => page.evaluate(f, ...a);
    if (modeName === 'single') await ev(() => window.poxel.startSingle(12345));
    else await ev((u, n) => window.poxel.connect(u, n), url, uniqueName('Deadman'));
    await sleep(3500);
    await ev(() => window.poxel.ui.forcePlaying());
    const spawn = await ev(() => ({ ...window.poxel.body.pos }));
    // Walk away from spawn a bit, then die
    await ev(p => window.poxel.glide(p.x + 6, p.y + 1, p.z), spawn);
    await sleep(500);
    await ev(() => window.poxel.send({ t: 'chat', text: '/kill' }));
    await sleep(1500);
    const dead = await ev(() => window.poxel.ui.state === 'dead' && document.getElementById('death-screen').style.display !== 'none');
    check(`${modeName}: died`, dead, await ev(() => document.getElementById('death-message').textContent));
    await page.click('#btn-respawn');
    await sleep(1500);
    const after = await ev(() => ({
      state: window.poxel.ui.state, screen: document.getElementById('death-screen').style.display,
      hp: window.poxel.health(), pos: { ...window.poxel.body.pos },
    }));
    check(`${modeName}: respawned`, after.screen === 'none' && after.hp === 20 && (after.state === 'playing' || after.state === 'paused'),
      `state=${after.state} hp=${after.hp} deathScreen=${after.screen}`);
    check(`${modeName}: back at spawn`, Math.hypot(after.pos.x - spawn.x, after.pos.z - spawn.z) < 3, `${after.pos.x.toFixed(1)},${after.pos.z.toFixed(1)}`);
    await ev(() => window.poxel.ui.forcePlaying());
    const p0 = await ev(() => ({ ...window.poxel.body.pos }));
    await page.keyboard.down('KeyW'); await sleep(800); await page.keyboard.up('KeyW');
    const p1 = await ev(() => ({ ...window.poxel.body.pos }));
    check(`${modeName}: can move after respawn`, Math.hypot(p1.x - p0.x, p1.z - p0.z) > 1);
    await page.browserContext().close();
  }
} catch (e) {
  check('suite completed without a script error', false, e.message);
} finally {
  await browser.close();
}
finish();
