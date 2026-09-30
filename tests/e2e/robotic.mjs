// The Robotic World, played in the browser (single player, dev build): build a portal, travel there,
// meet a robot, tame it with tungsten, and travel home with it. Screenshots in tests/e2e/out/robotic-*.png.
import { OUT, launch, openGame, sleep, suite } from './lib.mjs';
const browser = await launch();
const page = await openGame(browser);
const { check, info, watch, finish } = suite('robotic');
watch(page);
const ev = (f, ...a) => page.evaluate(f, ...a);
const give = (type, count = 1) => ev((t, c) => window.poxel.send({ t: 'dev', give: t, count: c }), type, count);
const hold = type => ev(t => { const i = window.poxel.inv.findIndex(s => s && s.type === t); if (i >= 0 && i < 9) window.poxel.select(i); return i; }, type);
const aimAt = async (x, y, z) => { await page.mouse.move(640, 360); await ev(({ x, y, z }) => {
  const b = window.poxel.body.pos; const dx = x - b.x, dy = y - (b.y + 1.62), dz = z - b.z;
  window.poxel.setYawPitch(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
}, { x, y, z }); await sleep(120); };
const rightClick = async () => { await page.mouse.click(640, 360, { button: 'right' }); await sleep(600); };
const pos = () => ev(() => ({ ...window.poxel.body.pos }));
const inRobotic = x => x >= 70000 && x < 130000;

try {
  await ev(() => { window.poxel.deleteSave(4); window.poxel.startSingle(12345, 'easy'); });
  await sleep(4000);
  await ev(() => window.poxel.ui.forcePlaying());

  // 1. A portal: four etherite blocks around a gold block, on the ground in front of us
  const p0 = await pos();
  const portal = { x: Math.floor(p0.x) + 3, y: Math.floor(p0.y), z: Math.floor(p0.z) };
  await ev(c => {
    const list = [c.x, c.y, c.z, window.poxel.blockId('gold_block')];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) list.push(c.x + dx, c.y, c.z + dz, window.poxel.blockId('etherite_block'));
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let dy = 1; dy <= 2; dy++) list.push(c.x + dx, c.y + dy, c.z + dz, 0);
    window.poxel.send({ t: 'dev', blocks: list });
  }, portal);
  await sleep(800);
  await aimAt(portal.x + 0.5, portal.y + 1, portal.z + 0.5);
  await rightClick();
  await sleep(3500);
  const p1 = await pos();
  check('right-clicking the portal takes you to the Robotic World', inRobotic(p1.x), `x=${p1.x.toFixed(1)}`);
  await ev(() => window.poxel.setYawPitch(0.6, -0.15));
  await sleep(1500);
  await page.screenshot({ path: `${OUT}/robotic-arrival.png` });
  const findCore = () => ev(() => {
    const b = window.poxel.body.pos, want = window.poxel.blockId('portal_core');
    for (let dx = -5; dx <= 5; dx++) for (let dz = -5; dz <= 5; dz++) for (let dy = -4; dy <= 2; dy++) {
      const x = Math.floor(b.x) + dx, y = Math.floor(b.y) + dy, z = Math.floor(b.z) + dz;
      if (window.poxel.getBlock(x, y, z) === want) return { x, y, z };
    }
    return null;
  });
  const core = await findCore();
  check('you arrive beside a return portal', !!core, JSON.stringify(p1));
  const kinds = await ev(p => {
    const seen = new Set();
    for (let dx = -12; dx <= 12; dx++) for (let dz = -12; dz <= 12; dz++) for (let dy = -6; dy <= 3; dy++) seen.add(window.poxel.getBlock(Math.floor(p.x) + dx, Math.floor(p.y) + dy, Math.floor(p.z) + dz));
    return [...seen];
  }, p1);
  check('the ground is rust and scrap', kinds.includes(await ev(() => window.poxel.blockId('rust_rock'))) || kinds.includes(await ev(() => window.poxel.blockId('scrap_ground'))), JSON.stringify(kinds));

  // 2. A robot, and taming it with a tungsten ingot
  await give('tungsten_ingot', 3);
  await sleep(500);
  await ev(() => window.poxel.send({ t: 'dev', spawn: 'robot' }));
  await sleep(1500);
  const robot = await ev(() => window.poxel.entities().find(e => e.kind === 'robot' && !e.owner));
  check('a robot appears', !!robot, JSON.stringify(robot));
  if (robot) {
    await aimAt(robot.x, robot.y + 1.6, robot.z);
    await sleep(400);
    await page.screenshot({ path: `${OUT}/robotic-robot.png` });
    // Creative from here on: robots ignore you (so it wanders instead of backing away, and nobody gets shot)
    await ev(() => window.poxel.send({ t: 'chat', text: '/gamemode creative' }));
    await sleep(500);
    // Walk up to it and tame it (it may wander off, so try a few times)
    await hold('tungsten_ingot');
    for (let k = 0; k < 4; k++) {
      const r2 = await ev(eid => window.poxel.entities().find(e => e.eid === eid), robot.eid);
      if (r2.owner) break;
      await ev(r => window.poxel.glide(r.x + 2, r.y + 0.1, r.z), r2);
      const r3 = await ev(eid => window.poxel.entities().find(e => e.eid === eid), robot.eid);
      await aimAt(r3.x, r3.y + 1.2, r3.z);
      await rightClick();
      await sleep(800);
    }
    const tamed = await ev(eid => window.poxel.entities().find(e => e.eid === eid), robot.eid);
    check('a tungsten ingot tames it', tamed?.owner === (await ev(() => localStorage.getItem('poxel_name'))), JSON.stringify(tamed));
    check('taming used an ingot', (await ev(() => window.poxel.inv.filter(s => s && s.type === 'tungsten_ingot').reduce((a, s) => a + s.count, 0))) === 2);
    await aimAt(tamed.x, tamed.y + 1.4, tamed.z);
    await sleep(500);
    await page.screenshot({ path: `${OUT}/robotic-tamed.png` });
  }

  // 2b. The Robot Titan (summoned here for the picture) and its health bar
  await ev(() => window.poxel.send({ t: 'dev', spawn: 'robot_titan' }));
  await sleep(2000);
  const titan = await ev(() => window.poxel.entities().find(e => e.kind === 'robot_titan'));
  check('the Robot Titan appears', !!titan, JSON.stringify(titan));
  check('its health bar shows', await ev(() => document.getElementById('boss-bar').style.display === 'block' && document.getElementById('boss-name').textContent === 'Robot Titan'));
  if (titan) { await aimAt(titan.x, titan.y + 3, titan.z); await sleep(1500); }
  await page.screenshot({ path: `${OUT}/robotic-titan.png` });

  // 3. Home again, with the robot
  const coreAt = (await findCore()) || core;
  await ev(c => window.poxel.glide(c.x + 0.5, c.y + 1, c.z + 1.5), coreAt);
  await sleep(4000); // portal cooldown
  await aimAt(coreAt.x + 0.5, coreAt.y + 1, coreAt.z + 0.5);
  await rightClick();
  await sleep(3500);
  const p2 = await pos();
  check('the return portal takes you home', !inRobotic(p2.x) && Math.hypot(p2.x - p0.x, p2.z - p0.z) < 8, `x=${p2.x.toFixed(1)} z=${p2.z.toFixed(1)}`);
  if (robot) {
    await sleep(1500);
    const pet = await ev(() => window.poxel.entities().find(e => e.kind === 'robot' && e.owner));
    check('your robot comes with you', !!pet && Math.hypot(pet.x - p2.x, pet.z - p2.z) < 6, JSON.stringify(pet));
  }
} catch (e) {
  check('suite completed without a script error', false, e.message);
} finally {
  await browser.close();
}
finish();
