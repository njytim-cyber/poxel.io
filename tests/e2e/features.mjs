// The newer features, played in the browser (single player, dev build): put up a banner, tame a robot and
// give it orders in the squad panel (G), die and use a moonstone orb to go back, and light the secret
// Frost World portal and walk through it to meet the Frost Wraith. Screenshots in tests/e2e/out/features-*.png.
import { OUT, launch, openGame, sleep, suite } from './lib.mjs';
const browser = await launch();
const page = await openGame(browser);
const { check, info, watch, finish } = suite('features');
watch(page);
const ev = (f, ...a) => page.evaluate(f, ...a);
const give = (type, count = 1) => ev((t, c) => window.poxel.send({ t: 'dev', give: t, count: c }), type, count);
const hold = type => ev(t => { const i = window.poxel.inv.findIndex(s => s && s.type === t); if (i >= 0 && i < 9) window.poxel.select(i); return i; }, type);
const aimAt = async (x, y, z) => { await page.mouse.move(640, 360); await ev(({ x, y, z }) => {
  const b = window.poxel.body.pos; const dx = x - b.x, dy = y - (b.y + 1.62), dz = z - b.z;
  window.poxel.setYawPitch(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
}, { x, y, z }); await sleep(150); };
const rightClick = async () => { await page.mouse.click(640, 360, { button: 'right' }); await sleep(600); };
const pos = () => ev(() => ({ ...window.poxel.body.pos }));
const block = (x, y, z) => ev(({ x, y, z }) => window.poxel.getBlock(x, y, z), { x, y, z });
const id = name => ev(n => window.poxel.blockId(n), name);
const visible = sel => ev(s => { const el = document.querySelector(s); return !!el && getComputedStyle(el).display !== 'none'; }, sel);
const isFrost = x => x >= -130000 && x < -70000;
// Clears a flat floor (stone) around a spot, with air above
const clearFloor = (c, r = 4, h = 6) => ev(({ c, r, h }) => {
  const list = [];
  for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
    list.push(c.x + dx, c.y - 1, c.z + dz, window.poxel.blockId('stone'));
    for (let dy = 0; dy < h; dy++) list.push(c.x + dx, c.y + dy, c.z + dz, 0);
  }
  window.poxel.send({ t: 'dev', blocks: list });
}, { c, r, h });

try {
  await ev(() => { window.poxel.deleteSave(4); window.poxel.startSingle(4242, 'easy'); });
  await sleep(4000);
  await ev(() => window.poxel.ui.forcePlaying());
  const p0 = await pos();
  const home = { x: Math.floor(p0.x), y: Math.floor(p0.y), z: Math.floor(p0.z) };
  await clearFloor(home, 6);
  await sleep(800);

  // ---- 1. A banner: placed on the ground in front of us, facing us
  await give('cyan_banner', 2);
  await sleep(500);
  await hold('cyan_banner');
  await aimAt(home.x + 0.5, home.y - 0.05, home.z - 2.5);
  await rightClick();
  check('a banner stands where we placed it', (await block(home.x, home.y, home.z - 3)) === (await id('cyan_banner')), `${await block(home.x, home.y, home.z - 3)}`);
  await ev(() => window.poxel.setYawPitch(0, -0.25));
  await sleep(600);
  await page.screenshot({ path: `${OUT}/features-banner.png` });

  // ---- 2. Robot squad: tame a robot, press G, order it to guard
  await give('tungsten_ingot', 1);
  await ev(() => window.poxel.send({ t: 'chat', text: '/gamemode creative' })); // so the robot doesn't shoot while we tame it
  await sleep(400);
  await ev(() => window.poxel.send({ t: 'dev', spawn: 'robot' }));
  await sleep(1200);
  const robot = await ev(() => window.poxel.entities().find(e => e.kind === 'robot' && !e.owner));
  check('a robot appears', !!robot);
  if (robot) {
    // Walk up to it and tame it (it may wander off, so try a few times)
    await hold('tungsten_ingot');
    for (let k = 0; k < 5; k++) {
      const r2 = await ev(eid => window.poxel.entities().find(e => e.eid === eid), robot.eid);
      if (!r2 || r2.owner) break;
      await ev(r => window.poxel.glide(r.x + 2, r.y + 0.1, r.z), r2);
      const r3 = await ev(eid => window.poxel.entities().find(e => e.eid === eid), robot.eid);
      await aimAt(r3.x, r3.y + 1.2, r3.z);
      await rightClick();
      await sleep(800);
    }
  }
  const tamed = await ev(() => window.poxel.entities().some(e => e.kind === 'robot' && e.owner));
  check('the robot is tamed', tamed);
  await page.keyboard.press('KeyG');
  await sleep(700);
  check('G opens the robot squad panel', await visible('#squad-modal'));
  check('it lists the robot', await ev(() => document.querySelectorAll('#squad-list .squad-row').length === 1));
  await page.screenshot({ path: `${OUT}/features-squad.png` });
  await ev(() => [...document.querySelectorAll('#squad-list .squad-orders .menu-btn')].find(b => b.textContent === 'Guard')?.click());
  await sleep(600);
  check('the Guard order is shown as active', await ev(() => document.querySelector('#squad-list .menu-btn.active')?.textContent === 'Guard'));
  await page.keyboard.press('Escape');
  await sleep(400);
  check('Esc closes the panel', !(await visible('#squad-modal')));
  await ev(() => window.poxel.ui.forcePlaying());
  await ev(() => window.poxel.send({ t: 'chat', text: '/gamemode survival' }));
  await sleep(300);

  // ---- 3. Moonstone orb: die, respawn, and use the orb to go back where we died
  const deathAt = await pos();
  await ev(() => window.poxel.send({ t: 'chat', text: '/kill' }));
  await sleep(1200);
  await ev(() => document.getElementById('btn-respawn').click());
  await sleep(1500);
  await ev(() => window.poxel.ui.forcePlaying());
  await ev(p => window.poxel.glide(p.x + 30, p.y + 2, p.z, 20), deathAt); // move well away first
  await sleep(500);
  const away = await pos();
  await give('moonstone_orb', 1); // (after dying: death drops everything)
  await sleep(500);
  await hold('moonstone_orb');
  await page.mouse.move(640, 360);
  await ev(() => window.poxel.setYawPitch(0, 0.6)); // at the sky: nothing to place on
  await rightClick();
  await sleep(600);
  check('using the orb opens its menu', await visible('#orb-modal'));
  const choices = await ev(() => [...document.querySelectorAll('#orb-list .menu-btn')].map(b => b.textContent));
  check('it offers where we died', choices.some(c => /died/.test(c)), JSON.stringify(choices));
  await page.screenshot({ path: `${OUT}/features-orb.png` });
  await ev(() => [...document.querySelectorAll('#orb-list .menu-btn')].find(b => /died/.test(b.textContent)).click());
  await sleep(1500);
  const back = await pos();
  check('the orb takes us back', Math.hypot(back.x - deathAt.x, back.z - deathAt.z) < 2, `from ${away.x.toFixed(1)} to ${back.x.toFixed(1)},${back.z.toFixed(1)}; died at ${deathAt.x.toFixed(1)},${deathAt.z.toFixed(1)}`);
  check('the orb is used up', (await ev(() => window.poxel.inv.filter(s => s && s.type === 'moonstone_orb').length)) === 0);
  await ev(() => window.poxel.ui.forcePlaying());

  // ---- 4. The secret: a moonstone frame with robot eyes inside becomes a portal to the Frost World
  const here = await pos();
  const f = { x: Math.floor(here.x) + 2, y: Math.floor(here.y), z: Math.floor(here.z) - 4 };
  await clearFloor({ x: f.x, y: f.y, z: f.z }, 5, 7);
  await sleep(500);
  await ev(c => {
    const M = window.poxel.blockId('moonstone_block'), E = window.poxel.blockId('robot_eye'), list = [];
    for (const i of [0, 1]) list.push(c.x + i, c.y, c.z, M, c.x + i, c.y + 4, c.z, M);
    for (let j = 1; j <= 3; j++) list.push(c.x - 1, c.y + j, c.z, M, c.x + 2, c.y + j, c.z, M);
    for (const [i, j] of [[0, 1], [1, 1], [0, 2], [1, 2], [0, 3]]) list.push(c.x + i, c.y + j, c.z, E);
    window.poxel.send({ t: 'dev', blocks: list });
  }, f);
  await ev(p => window.poxel.glide(p.x + 1, p.y, p.z + 3.5, 8), f);
  await sleep(800);
  await give('robot_eye', 1);
  await sleep(400);
  await hold('robot_eye');
  // Place the last eye: click the frame's top from below-front so the eye goes into the empty top-right cell
  await aimAt(f.x + 1.5, f.y + 3.99, f.z + 0.6);
  const target = await ev(() => window.poxel.aimTarget());
  info(`aiming at ${JSON.stringify(target)}`);
  await rightClick();
  await sleep(800);
  const portalId = await id('frost_portal');
  check('the eyes turn into a portal', (await block(f.x, f.y + 1, f.z)) === portalId && (await block(f.x + 1, f.y + 3, f.z)) === portalId,
    `${await block(f.x, f.y + 1, f.z)} ${await block(f.x + 1, f.y + 3, f.z)}`);
  await aimAt(f.x + 1, f.y + 2.5, f.z + 0.5);
  await page.screenshot({ path: `${OUT}/features-portal.png` });
  await ev(p => window.poxel.glide(p.x + 1, p.y + 1, p.z + 0.5, 4), f);
  await sleep(4000);
  const there = await pos();
  check('walking in takes us to the Frost World', isFrost(there.x), `x=${there.x.toFixed(1)}`);
  await ev(() => window.poxel.setYawPitch(0.4, -0.1));
  await sleep(2500);
  await page.screenshot({ path: `${OUT}/features-frost.png` });
  const kinds = await ev(p => {
    const seen = new Set();
    for (let dx = -10; dx <= 10; dx++) for (let dz = -10; dz <= 10; dz++) for (let dy = -6; dy <= 3; dy++) seen.add(window.poxel.getBlock(Math.floor(p.x) + dx, Math.floor(p.y) + dy, Math.floor(p.z) + dz));
    return [...seen];
  }, there);
  check('snow and ice all around', kinds.includes(await id('snow_block')) || kinds.includes(await id('packed_ice')), JSON.stringify(kinds));
  check('a return portal beside us', kinds.includes(portalId));
  // The Frost Wraith
  await ev(() => window.poxel.send({ t: 'chat', text: '/gamemode creative' }));
  await ev(p => window.poxel.glide(p.x, p.y + 3, p.z + 6, 6), there); // away from the portal, so it isn't in the picture
  await ev(() => window.poxel.setYawPitch(Math.PI, 0));
  await sleep(500);
  await ev(() => window.poxel.send({ t: 'dev', spawn: 'frost_wraith' }));
  await sleep(1500);
  const wraith = await ev(() => window.poxel.entities().find(e => e.kind === 'frost_wraith'));
  check('the Frost Wraith can appear', !!wraith);
  if (wraith) { await aimAt(wraith.x, wraith.y + 2, wraith.z); await sleep(500); await page.screenshot({ path: `${OUT}/features-wraith.png` }); }
} catch (e) {
  check('suite completed without a script error', false, e.message);
} finally {
  await browser.close();
}
finish();
