// Getting about and the weather, in the browser (single player, dev build): a minecart along rails (a step up and a
// corner), a boat across a pond, rain and a thunderstorm, gliding on Elemental Wings, and summoning the Elemental
// Core at its altar. Screenshots in tests/e2e/out/world-*.png.
import { OUT, launch, openGame, sleep, suite } from './lib.mjs';
const browser = await launch();
const page = await openGame(browser);
const { check, info, watch, finish } = suite('world');
watch(page);
const ev = (f, ...a) => page.evaluate(f, ...a);
const send = m => ev(x => window.poxel.send(x), m);
const pos = () => ev(() => ({ ...window.poxel.body.pos }));
const give = async (type, count = 1) => { await send({ t: 'dev', give: type, count }); await sleep(300); };
const hold = type => ev(t => { const i = window.poxel.inv.findIndex((s, i) => i < 9 && s && s.type === t); if (i >= 0) window.poxel.select(i); return i; }, type);
const aimAt = async (x, y, z) => { await page.mouse.move(640, 360); await ev(({ x, y, z }) => { const b = window.poxel.body.pos; const dx = x - b.x, dy = y - (b.y + 1.62), dz = z - b.z; window.poxel.setYawPitch(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))); }, { x, y, z }); await sleep(150); };
const rightClick = async () => { await page.mouse.click(640, 360, { button: 'right' }); await sleep(600); };
const blocks = list => send({ t: 'dev', blocks: list });
const id = n => ev(x => window.poxel.blockId(x), n);
const has = t => ev(t => window.poxel.inv.some(s => s && s.type === t), t);

try {
  await ev(() => { window.poxel.deleteSave(4); window.poxel.startSingle(31337, 'easy'); });
  await sleep(4000);
  await ev(() => window.poxel.ui.forcePlaying());
  const p0 = await pos();
  const bx = Math.floor(p0.x), by = Math.floor(p0.y) + 20, bz = Math.floor(p0.z);
  // A flat stone stage up in the air (away from trees and hills)
  const stage = [];
  for (let dx = -3; dx <= 16; dx++) for (let dz = -3; dz <= 14; dz++) { stage.push(bx + dx, by - 1, bz + dz, await id('stone')); for (let dy = 0; dy < 4; dy++) stage.push(bx + dx, by + dy, bz + dz, 0); }
  await blocks(stage);
  await send({ t: 'dev', tp: { x: bx + 0.5, y: by, z: bz + 0.5 } });
  await ev(p => window.poxel.tp(p.x, p.y, p.z), { x: bx + 0.5, y: by, z: bz + 0.5 });
  await sleep(1500);

  // ---- 1. A minecart: 8 rails east, a step up, then a corner south for 4 more
  const R = await id('rail'), S = await id('stone');
  const rails = [];
  for (let i = 1; i <= 8; i++) rails.push(bx + i, by, bz, R);
  rails.push(bx + 9, by, bz, S, bx + 9, by + 1, bz, R, bx + 10, by, bz, S, bx + 10, by + 1, bz, R);
  for (let k = 1; k <= 4; k++) rails.push(bx + 10, by, bz + k, S, bx + 10, by + 1, bz + k, R);
  await blocks(rails);
  await give('minecart');
  await hold('minecart');
  await aimAt(bx + 1.5, by + 0.05, bz + 0.5);
  await rightClick();
  check('using a minecart on a rail gets you in', await ev(() => !window.poxel.inv.some(s => s && s.type === 'minecart')));
  await ev(() => window.poxel.setYawPitch(-Math.PI / 2, -0.2)); // facing east, along the rails
  await page.keyboard.press('KeyV');
  await page.keyboard.down('KeyW'); await sleep(2500); await page.keyboard.up('KeyW');
  await sleep(1200);
  await page.screenshot({ path: `${OUT}/world-minecart.png` });
  const c1 = await pos();
  info(`minecart ended at ${JSON.stringify(c1)}`);
  check('the minecart rides along the rails, up the step and round the corner', c1.x > bx + 9.5 && c1.z > bz + 1.5 && c1.y > by + 0.5, JSON.stringify({ dx: c1.x - bx, dy: c1.y - by, dz: c1.z - bz }));
  await page.keyboard.down('ShiftLeft'); await sleep(500); await page.keyboard.up('ShiftLeft');
  await sleep(500);
  check('sneaking gets you out (the minecart comes back)', await has('minecart'));
  await page.keyboard.press('KeyV'); await page.keyboard.press('KeyV');

  // ---- 2. A boat across a pond
  const pond = [];
  for (let dx = 0; dx <= 12; dx++) for (let dz = 6; dz <= 13; dz++) pond.push(bx + dx, by - 1, bz + dz, await id('water'), bx + dx, by - 2, bz + dz, S);
  await blocks(pond);
  await send({ t: 'dev', tp: { x: bx + 0.5, y: by, z: bz + 4.5 } });
  await ev(p => window.poxel.tp(p.x, p.y, p.z), { x: bx + 0.5, y: by, z: bz + 4.5 });
  await sleep(800);
  await give('boat');
  await hold('boat');
  await aimAt(bx + 0.5, by - 0.5, bz + 6.5);
  await rightClick();
  check('using a boat on water gets you in', !(await has('boat')));
  const b0 = await pos();
  await ev(() => window.poxel.setYawPitch(Math.PI, 0)); // facing south, across the pond
  await page.keyboard.down('KeyW'); await sleep(1500); await page.keyboard.up('KeyW');
  await page.keyboard.press('KeyV');
  await sleep(500);
  await page.screenshot({ path: `${OUT}/world-boat.png` });
  const b1 = await pos();
  check('the boat sails', Math.hypot(b1.x - b0.x, b1.z - b0.z) > 4, `${Math.hypot(b1.x - b0.x, b1.z - b0.z).toFixed(1)} blocks`);
  check('and floats (not sinking)', b1.y > by - 1.3, `y ${(b1.y - by).toFixed(2)}`);
  await page.keyboard.down('ShiftLeft'); await sleep(500); await page.keyboard.up('ShiftLeft');
  await sleep(500);
  check('sneaking gets you out of the boat', await has('boat'));
  await page.keyboard.press('KeyV'); await page.keyboard.press('KeyV');

  // ---- 3. The weather: rain, then a thunderstorm
  await send({ t: 'dev', tp: { x: bx + 2.5, y: by, z: bz + 2.5 } });
  await ev(p => window.poxel.tp(p.x, p.y, p.z), { x: bx + 2.5, y: by, z: bz + 2.5 });
  await send({ t: 'dev', weather: 'rain' });
  await ev(() => window.poxel.setYawPitch(0.5, 0.1));
  await sleep(4000);
  await page.screenshot({ path: `${OUT}/world-rain.png` });
  await send({ t: 'dev', weather: 'thunder' });
  let flashed = false;
  for (let i = 0; i < 40 && !flashed; i++) { await sleep(250); flashed = await ev(() => parseFloat(getComputedStyle(document.getElementById('lightning-flash')).opacity) > 0.05); }
  await page.screenshot({ path: `${OUT}/world-thunder.png` });
  check('a thunderstorm brings lightning', flashed);
  await send({ t: 'dev', weather: 'clear' });
  await send({ t: 'dev', heal: true });

  // ---- 4. Elemental Wings: glide down from high up, unhurt
  await send({ t: 'dev', equip: [null, 'elemental_wings', null, null] });
  await sleep(500);
  const hp0 = await ev(() => window.poxel.health());
  await send({ t: 'dev', tp: { x: bx + 0.5, y: by + 40, z: bz + 0.5 } });
  await ev(p => window.poxel.tp(p.x, p.y, p.z), { x: bx + 0.5, y: by + 40, z: bz + 0.5 });
  await sleep(300);
  await ev(() => window.poxel.setYawPitch(-Math.PI / 2, 0));
  await page.keyboard.press('KeyV');
  await page.keyboard.down('Space');
  const g0 = await pos();
  await sleep(1500);
  const g1 = await pos();
  await page.screenshot({ path: `${OUT}/world-glide.png` });
  check('gliding: a slow fall, carried forwards', g0.y - g1.y < 6 && Math.hypot(g1.x - g0.x, g1.z - g0.z) > 6, `fell ${(g0.y - g1.y).toFixed(1)}, flew ${Math.hypot(g1.x - g0.x, g1.z - g0.z).toFixed(1)}`);
  for (let i = 0; i < 40 && !(await ev(() => window.poxel.body.onGround)); i++) await sleep(200);
  await page.keyboard.up('Space');
  await sleep(800);
  check('a glide down does no fall damage', (await ev(() => window.poxel.health())) === hp0);
  await page.keyboard.press('KeyV'); await page.keyboard.press('KeyV');

  // ---- 5. The Elemental Core, summoned at its altar (after the four bosses)
  const ex = bx - 100000;
  await send({ t: 'chat', text: '/gamemode creative' }); // (no fall damage on arrival from high up)
  await sleep(300);
  await send({ t: 'dev', tp: { x: ex + 0.5, y: 120, z: bz + 0.5 } });
  await ev(p => window.poxel.tp(p.x, p.y, p.z), { x: ex + 0.5, y: 120, z: bz + 0.5 });
  await sleep(4000);
  const e0 = await pos();
  const ey = Math.floor(e0.y), ez = Math.floor(e0.z);
  const area = [];
  for (let dx = -6; dx <= 6; dx++) for (let dz = -6; dz <= 6; dz++) { area.push(ex + dx, ey - 1, ez + dz, S); for (let dy = 0; dy < 10; dy++) area.push(ex + dx, ey + dy, ez + dz, 0); }
  area.push(ex, ey, ez - 4, await id('elemental_altar'));
  await blocks(area);
  await send({ t: 'dev', achieve: ['wraith', 'colossus', 'thorn', 'roc'] });
  await sleep(600);
  await aimAt(ex + 0.5, ey + 0.5, ez - 3.5);
  await rightClick();
  await sleep(2500);
  const core = await ev(() => window.poxel.entities().find(e => e.kind === 'elemental_core'));
  check('the Elemental Altar summons the Elemental Core', !!core, await ev(() => document.getElementById('chat-log').textContent.slice(-300)) + ' aim ' + JSON.stringify(await ev(() => window.poxel.aimTarget())));
  if (core) { await send({ t: 'chat', text: '/gamemode creative' }); await aimAt(core.x, core.y + 1.5, core.z); await sleep(1500); await page.screenshot({ path: `${OUT}/world-core.png` }); }

  // ---- 6. The elemental tools' icons
  await send({ t: 'dev', clearMobs: true });
  for (const t of ['blazing_sword', 'tidal_pickaxe', 'quaking_axe', 'gale_shovel', 'elemental_wings', 'boat', 'minecart', 'rail', 'elemental_altar']) await give(t);
  await page.keyboard.press('KeyE');
  await sleep(600);
  await page.screenshot({ path: `${OUT}/world-items.png` });
} catch (e) {
  check('suite completed without a script error', false, e.message);
} finally {
  await browser.close();
}
finish();
