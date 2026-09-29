// Critical user journey, played with real mouse/keyboard input through the (local) server:
// tree -> planks -> table -> pickaxe -> cobblestone -> Save & Quit -> Load.
import { OUT, launch, openGame, sleep, suite } from './lib.mjs';
const browser = await launch();
const page = await openGame(browser);
const { check, info, watch, finish } = suite('cuj');
watch(page);
const ev = (f, ...a) => page.evaluate(f, ...a);
const count = t => ev(t => window.poxel.inv.filter(s => s && s.type === t).reduce((a, s) => a + s.count, 0), t);
// Park the mouse first: moving it while pointer-locked would turn the camera
const aimAt = async (x, y, z) => { await page.mouse.move(640, 360); await sleep(50); return ev(({ x, y, z }) => {
  const b = window.poxel.body.pos; const ex = b.x, ey = b.y + 1.62, ez = b.z;
  const dx = x - ex, dy = y - ey, dz = z - ez;
  window.poxel.setYawPitch(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
}, { x, y, z }); };
const mine = async ms => { await page.mouse.down(); await sleep(ms); await page.mouse.up(); await sleep(400); };
const bookClick = async (name, shift) => {
  const idx = await ev(n => [...document.querySelectorAll('.recipe-btn')].findIndex(b => b.title.split('\n')[0] === n), name);
  if (idx < 0) return false;
  const r = await ev(i => { const b = document.querySelectorAll('.recipe-btn')[i]; b.scrollIntoView({ block: 'center' }); const q = b.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; }, idx);
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.click(r.x, r.y);
  if (shift) await page.keyboard.up('Shift');
  await sleep(250);
  return true;
};
const clickResult = async shift => {
  const r = await ev(() => { const q = document.querySelector('#crafting-result .slot').getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; });
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.click(r.x, r.y);
  if (shift) await page.keyboard.up('Shift');
  await sleep(300);
};
const LOGS = [5, 23, 37];

try {
  await ev(() => { window.poxel.deleteSave(4); window.poxel.startSingle(12345); });
  await sleep(4500);
  await ev(() => window.poxel.ui.forcePlaying());

  // 1. Find a tree trunk near spawn and walk next to it
  const tree = await ev(() => {
    const b = window.poxel.body.pos; const P = window.poxel;
    let best = null;
    for (let dx = -24; dx <= 24; dx++) for (let dz = -24; dz <= 24; dz++) for (let dy = -6; dy <= 8; dy++) {
      const x = Math.floor(b.x) + dx, y = Math.floor(b.y) + dy, z = Math.floor(b.z) + dz;
      const id = P.getBlock(x, y, z);
      if ((id === 5 || id === 23 || id === 37) && [1, 2, 20].includes(P.getBlock(x, y - 1, z)) && P.getBlock(x + 1, y, z) === 0 && P.getBlock(x + 1, y + 1, z) === 0) {
        const d = dx * dx + dz * dz;
        if (!best || d < best.d) best = { x, y, z, d, id };
      }
    }
    return best;
  });
  check('found a tree near spawn', !!tree, JSON.stringify(tree));
  if (!tree) throw new Error('no tree near spawn');
  await ev(t => window.poxel.glide(t.x + 1.5, t.y + 0.2, t.z + 0.5), tree);
  await sleep(800);

  // 2. Mine up the trunk by hand (and clear leaves in the way) until we hold 3 logs
  const logCount = async () => (await count('wood')) + (await count('birch_wood')) + (await count('spruce_wood'));
  for (let k = 0; k < 6 && (await logCount()) < 3; k++) {
    const id = await ev(t => window.poxel.getBlock(t.x, t.y, t.z), { x: tree.x, y: tree.y + k, z: tree.z });
    if (!LOGS.includes(id)) continue;
    await aimAt(tree.x + 0.5, tree.y + k + 0.5, tree.z + 0.5);
    await sleep(100);
    const hit = await ev(() => window.poxel.lookTarget());
    if (hit && !LOGS.includes(hit.id)) { await mine(1200); await aimAt(tree.x + 0.5, tree.y + k + 0.5, tree.z + 0.5); }
    const hit2 = await ev(() => window.poxel.lookTarget());
    await mine(3600);
    await sleep(1200);
    info(`log ${k}: aimed ${hit2 ? `${hit2.id}@${hit2.x},${hit2.y},${hit2.z}` : 'nothing'} -> ${hit2 ? await ev(h => window.poxel.getBlock(h.x, h.y, h.z), hit2) : '-'}; player ${JSON.stringify(await ev(() => { const b = window.poxel.body.pos; return [b.x.toFixed(1), b.y.toFixed(1), b.z.toFixed(1)]; }))}`);
  }
  // Walk over to where the logs dropped to collect them
  await ev(t => window.poxel.glide(t.x + 0.5, t.y + 0.1, t.z + 0.5), tree);
  await sleep(2500);
  const logs = await logCount();
  check('punched 3 logs and picked them up', logs >= 3, `logs=${logs}`);

  // 3. Craft planks -> sticks -> crafting table from the recipe book
  await page.keyboard.press('Tab');
  await sleep(500);
  check('inventory opened with Tab', await ev(() => window.poxel.ui.state === 'screen'));
  await bookClick('Oak Planks', true);
  await clickResult(true);
  check('crafted planks', (await count('planks')) >= 12, `planks=${await count('planks')}`);
  await bookClick('Stick', false);
  await clickResult(true);
  check('crafted sticks', (await count('stick')) >= 4, `sticks=${await count('stick')}`);
  await bookClick('Crafting Table', false);
  await clickResult(true);
  check('crafted a crafting table', (await count('crafting_table')) === 1);
  await page.screenshot({ path: `${OUT}/cuj-inventory.png` });
  await page.keyboard.press('Tab');
  await sleep(500);

  // 4. Place the table and open it
  const tableSlot = await ev(() => window.poxel.inv.findIndex(s => s && s.type === 'crafting_table'));
  await page.keyboard.press(`Digit${tableSlot + 1}`);
  await sleep(200);
  const ground = await ev(() => { const b = window.poxel.body.pos; return { x: Math.floor(b.x) + 2, y: Math.floor(b.y) - 1, z: Math.floor(b.z) }; });
  await aimAt(ground.x + 0.5, ground.y + 1, ground.z + 0.5);
  await sleep(150);
  const aimed = await ev(() => window.poxel.lookTarget());
  await page.mouse.click(640, 360, { button: 'right' });
  await sleep(700);
  // Aiming at a plant (tall grass/flowers) replaces it; otherwise the block goes against the clicked face
  const isPlantId = id => id >= 33 && id <= 36;
  const tablePos = !aimed ? { x: ground.x, y: ground.y + 1, z: ground.z } : isPlantId(aimed.id) ? { x: aimed.x, y: aimed.y, z: aimed.z } : { x: aimed.x + aimed.nx, y: aimed.y + aimed.ny, z: aimed.z + aimed.nz };
  check('placed the crafting table', (await ev(t => window.poxel.getBlock(t.x, t.y, t.z), tablePos)) === 9);
  // Aim near the top: from above, a ray at the centre can clip the edge of the block in front
  await aimAt(tablePos.x + 0.5, tablePos.y + 0.85, tablePos.z + 0.5);
  await sleep(150);
  info('aiming at table: ' + JSON.stringify(await ev(() => window.poxel.lookTarget())) + ' table at ' + JSON.stringify(tablePos) + ' ui ' + (await ev(() => window.poxel.ui.state)));
  await page.mouse.click(640, 360, { button: 'right' });
  await sleep(800);
  info('after right-click ui ' + (await ev(() => window.poxel.ui.state)) + ' grid ' + (await ev(() => document.getElementById('crafting-grid').className)));
  check('right-click opens the crafting table (3x3)', await ev(() => window.poxel.ui.state === 'screen' && document.getElementById('crafting-grid').className === 'grid-3x3'));

  // 5. Craft a wooden pickaxe
  await bookClick('Wooden Pickaxe', false);
  await clickResult(true);
  check('crafted a wooden pickaxe', (await count('wooden_pickaxe')) === 1);
  await page.keyboard.press('Escape');
  await sleep(500);
  await ev(() => window.poxel.ui.forcePlaying());

  // 6. Dig straight down to stone with the pickaxe and mine cobblestone
  const pickSlot = await ev(() => window.poxel.inv.findIndex(s => s && s.type === 'wooden_pickaxe'));
  await page.keyboard.press(`Digit${pickSlot + 1}`);
  await sleep(200);
  let cobble = 0;
  for (let k = 0; k < 10 && cobble === 0; k++) {
    // Stand exactly in the middle of the block: the hitbox is 0.72 wide, so even 0.15 off-centre it rests
    // on the neighbouring block's edge and never drops into the hole (a tiny move the server accepts)
    await ev(() => { const b = window.poxel.body.pos; window.poxel.tp(Math.floor(b.x) + 0.5, b.y, Math.floor(b.z) + 0.5); });
    for (let i = 0; i < 20 && !(await ev(() => window.poxel.body.onGround)); i++) await sleep(100);
    const t = await ev(() => { const b = window.poxel.body.pos; return { x: Math.floor(b.x), y: Math.floor(b.y) - 1, z: Math.floor(b.z) }; });
    await aimAt(t.x + 0.5, t.y + 0.5, t.z + 0.5);
    await sleep(100);
    const aimedAt = await ev(() => window.poxel.lookTarget());
    await mine(1800);
    await sleep(700);
    cobble = await count('cobblestone');
    info(`dig ${k}: feet y=${t.y + 1} aimed ${aimedAt ? `${aimedAt.id}@${aimedAt.x},${aimedAt.y},${aimedAt.z}` : 'nothing'} -> now ${aimedAt ? await ev(a => window.poxel.getBlock(a.x, a.y, a.z), aimedAt) : '-'}, inv ${await ev(() => window.poxel.inv.filter(Boolean).map(s => s.type + 'x' + s.count).join(' '))}`);
  }
  check('mined stone into cobblestone with the wooden pickaxe', cobble > 0, `cobble=${cobble}`);
  await page.screenshot({ path: `${OUT}/cuj-mining.png` });

  // 7. Save & Quit, reload, load the save: everything still there
  const before = await ev(() => JSON.stringify(window.poxel.inv.filter(Boolean).map(s => s.type + 'x' + s.count).sort()));
  await ev(() => window.poxel.ui.pause());
  await sleep(300);
  await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.click('#btn-save-quit')]);
  await sleep(2000);
  await page.click('#btn-open-load');
  await sleep(300);
  await page.click('.save-slot[data-slot="4"]');
  await sleep(4500);
  const after = await ev(() => JSON.stringify(window.poxel.inv.filter(Boolean).map(s => s.type + 'x' + s.count).sort()));
  check('after Save & Quit and Load, the inventory is the same', before === after, `${before}`);
  const tableStill = await ev(t => window.poxel.getBlock(t.x, t.y, t.z), tablePos);
  check('the placed crafting table is still in the world', tableStill === 9);
} catch (e) {
  check('journey completed without a script error', false, e.message);
} finally {
  await browser.close();
}
finish();
