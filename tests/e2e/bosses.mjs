// The Elemental World's boss fights, seen in the browser (single player, dev build): elemental armour worn (as plates,
// with trims), the ore pictures, and each boss enraged (phase two) using its moves: magma balls and eruptions,
// stomps, icicle rain, hurricanes; fireballs from the lava chestplate. Screenshots in tests/e2e/out/bosses-*.png.
import { OUT, launch, openGame, sleep, suite } from './lib.mjs';
const browser = await launch();
const page = await openGame(browser);
const { check, info, watch, finish } = suite('bosses');
watch(page);
const ev = (f, ...a) => page.evaluate(f, ...a);
const send = m => ev(x => window.poxel.send(x), m);
const pos = () => ev(() => ({ ...window.poxel.body.pos }));
const count = kind => ev(k => window.poxel.entities().filter(e => e.kind === k || (e.kind === 'item' && e.name === k)).length, kind);
const lookAt = (x, y, z) => ev(({ x, y, z }) => { const b = window.poxel.body.pos; const dx = x - b.x, dy = y - (b.y + 1.62), dz = z - b.z; window.poxel.setYawPitch(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))); }, { x, y, z });

try {
  await ev(() => { window.poxel.deleteSave(4); window.poxel.startSingle(777, 'easy'); });
  await sleep(4000);
  await ev(() => window.poxel.ui.forcePlaying());

  // ---- 1. Elemental armour, worn as plates with trims (seen from the front), and the ores' pictures
  await send({ t: 'dev', equip: ['water_helmet', 'lava_chestplate', 'earth_leggings', 'wind_boots'] });
  for (const t of ['water_ore', 'lava_ore', 'earth_ore', 'wind_ore', 'moonstone', 'glacite', 'poison_sword']) await send({ t: 'dev', give: t, count: 3 });
  await sleep(800);
  await page.keyboard.press('KeyV'); await page.keyboard.press('KeyV'); // camera in front of the player
  await ev(() => window.poxel.setYawPitch(0, -0.1));
  await sleep(800);
  await page.screenshot({ path: `${OUT}/bosses-armour.png` });
  check('20 hearts with earth leggings', await ev(() => document.querySelectorAll('#health-bar img').length === 20));
  await page.keyboard.press('KeyV');
  await page.keyboard.press('KeyE');
  await sleep(600);
  await page.screenshot({ path: `${OUT}/bosses-ores.png` });
  await page.keyboard.press('KeyE');
  await sleep(400);
  await ev(() => window.poxel.ui.forcePlaying());

  // ---- 2. The lava chestplate's fireball (the . key)
  await ev(() => window.poxel.setYawPitch(0.3, 0.05));
  await page.keyboard.press('Period');
  await sleep(150);
  check('. shoots a fireball', (await ev(() => window.poxel.entities().filter(e => e.kind === 'item').length)) > 0);
  await page.screenshot({ path: `${OUT}/bosses-fireball.png` });
  await sleep(1500);

  // ---- 3. Into the Elemental World, and each boss enraged
  const here = await pos();
  const ex = Math.floor(here.x) - 100000, ez = Math.floor(here.z);
  await send({ t: 'dev', tp: { x: ex + 0.5, y: 120, z: ez + 0.5 } });
  await ev(p => window.poxel.tp(p.x, p.y, p.z), { x: ex + 0.5, y: 120, z: ez + 0.5 });
  await sleep(4000);
  info(`in the Elemental World at ${JSON.stringify(await pos())}`);
  for (const [kind, waitFor] of [['magma_colossus', 7000], ['thorn_guardian', 6000], ['frost_wraith', 6000], ['tempest', 7000]]) {
    await send({ t: 'dev', heal: true });
    await ev(() => window.poxel.setYawPitch(0, -0.05));
    await send({ t: 'dev', spawn: kind, enraged: true, dist: 9 });
    await sleep(1200);
    const boss = await ev(k => window.poxel.entities().find(e => e.kind === k), kind);
    check(`${kind} appears`, !!boss);
    if (!boss) continue;
    // Watch the fight for a while (keeping ourselves alive), taking pictures of its moves
    const t0 = Date.now();
    let shots = 0;
    while (Date.now() - t0 < waitFor) {
      await send({ t: 'dev', heal: true });
      const b = await ev(k => window.poxel.entities().find(e => e.kind === k), kind);
      if (b) await lookAt(b.x, b.y + 2, b.z);
      await sleep(900);
      if (Date.now() - t0 > waitFor * (shots + 1) / 3) await page.screenshot({ path: `${OUT}/bosses-${kind}-${++shots}.png` });
    }
    const extras = await ev(() => { const c = {}; for (const e of window.poxel.entities()) c[e.kind] = (c[e.kind] || 0) + 1; return c; });
    info(`${kind}: entities around ${JSON.stringify(extras)}`);
    await send({ t: 'dev', clearMobs: true }); // (one boss at a time)
    await ev(() => window.poxel.send({ t: 'chat', text: '/kill' }));
    await sleep(800);
    await ev(() => document.getElementById('btn-respawn')?.click());
    await sleep(1200);
    await send({ t: 'dev', tp: { x: ex + 0.5, y: 120, z: ez + 0.5 } });
    await ev(p => window.poxel.tp(p.x, p.y, p.z), { x: ex + 0.5, y: 120, z: ez + 0.5 });
    await send({ t: 'dev', equip: ['water_helmet', 'lava_chestplate', 'earth_leggings', 'wind_boots'] });
    await ev(() => window.poxel.ui.forcePlaying());
    await sleep(2500);
  }
} catch (e) {
  check('suite completed without a script error', false, e.message);
} finally {
  await browser.close();
}
finish();
