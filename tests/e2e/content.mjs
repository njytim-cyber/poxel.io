// New content, played in the browser (single player, dev build): loot chests in structures,
// farming, ice, and the new mobs (screenshots in tests/e2e/out/mobs-*.png).
import { OUT, launch, openGame, sleep, suite } from './lib.mjs';
import { structureInRegion } from '../../shared/worldgen.ts';
const SEED = 12345;
const browser = await launch();
const page = await openGame(browser);
const { check, info, watch, finish } = suite('content');
watch(page);
const ev = (f, ...a) => page.evaluate(f, ...a);
const give = (type, count = 1) => ev((t, c) => window.poxel.send({ t: 'dev', give: t, count: c }), type, count);
const hold = type => ev(t => { const i = window.poxel.inv.findIndex(s => s && s.type === t); if (i >= 0 && i < 9) window.poxel.select(i); return i; }, type);
const aimAt = async (x, y, z) => { await page.mouse.move(640, 360); await ev(({ x, y, z }) => {
  const b = window.poxel.body.pos; const dx = x - b.x, dy = y - (b.y + 1.62), dz = z - b.z;
  window.poxel.setYawPitch(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
}, { x, y, z }); await sleep(120); };
const rightClick = async () => { await page.mouse.click(640, 360, { button: 'right' }); await sleep(600); };
const walkTo = async (x, y, z) => { for (let i = 0; i < 12; i++) { const d = await ev(t => window.poxel.glide(t.x, t.y, t.z).then(() => { const b = window.poxel.body.pos; return Math.hypot(b.x - t.x, b.z - t.z); }), { x, y, z }); if (d < 0.6) return true; } return false; };

try {
  await ev(s => { window.poxel.deleteSave(4); localStorage.setItem('poxel_name', 'player9989'); window.poxel.startSingle(s, 'easy'); }, SEED);
  await sleep(4000);
  await ev(() => window.poxel.ui.forcePlaying());

  // ---- Loot chest in the nearest cabin
  let cabin = null;
  for (let r = 1; r < 20 && !cabin; r++) for (let rx = -r; rx <= r && !cabin; rx++) for (const rz of [-r, r]) { const s = structureInRegion(rx, rz, SEED, false); if (s?.kind === 'cabin') { cabin = s; break; } }
  info('cabin ' + JSON.stringify(cabin));
  // Stand in the doorway (the chest is at +2,+1,-2 from the cabin's origin)
  const reached = await walkTo(cabin.x + 0.5, cabin.y + 1.1, cabin.z + 3.5);
  await ev(t => window.poxel.glide(t.x, t.y, t.z), { x: cabin.x + 0.5, y: cabin.y + 1.1, z: cabin.z + 1.5 });
  await sleep(1500);
  check('walked into the cabin', reached, JSON.stringify(await ev(() => window.poxel.body.pos)));
  const chestAt = { x: cabin.x + 2, y: cabin.y + 1, z: cabin.z - 2 };
  check('the cabin has a chest', (await ev(c => window.poxel.getBlock(c.x, c.y, c.z), chestAt)) === 90);
  await ev(() => window.poxel.ui.forcePlaying());
  await aimAt(chestAt.x + 0.5, chestAt.y + 0.8, chestAt.z + 0.5);
  await rightClick();
  check('right-click opens the chest', await ev(() => window.poxel.ui.state === 'screen' && document.getElementById('chest-area').style.display === 'block'));
  const loot = await ev(() => [...document.querySelectorAll('#chest-grid .slot')].filter(s => s.querySelector('img')).map(s => s.title));
  check('the chest holds loot', loot.length > 0, loot.join(', '));
  await page.screenshot({ path: `${OUT}/content-chest.png` });
  // Shift-click the first stack into the inventory
  const firstSlot = await ev(() => { const s = [...document.querySelectorAll('#chest-grid .slot')].find(el => el.querySelector('img')); const r = s.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.keyboard.down('Shift'); await page.mouse.click(firstSlot.x, firstSlot.y); await page.keyboard.up('Shift');
  await sleep(500);
  check('shift-click takes loot into the inventory', (await ev(() => window.poxel.inv.filter(Boolean).length)) > 0, JSON.stringify(await ev(() => window.poxel.inv.filter(Boolean))));
  await page.keyboard.press('Escape');
  await sleep(500);
  await ev(() => window.poxel.ui.forcePlaying());
  await aimAt(chestAt.x + 0.5, chestAt.y + 0.8, chestAt.z + 0.5);
  await rightClick();
  const lootAgain = await ev(() => [...document.querySelectorAll('#chest-grid .slot')].filter(s => s.querySelector('img')).length);
  check('the chest remembers what was taken', lootAgain === loot.length - 1, `${loot.length} -> ${lootAgain}`);
  await page.keyboard.press('Escape');
  await sleep(400);
  await ev(() => window.poxel.ui.forcePlaying());

  // ---- Farming: till grass with a hoe, plant seeds on the farmland
  await give('wooden_hoe'); await give('seeds', 4);
  await sleep(400);
  await walkTo(cabin.x + 0.5, cabin.y + 1.1, cabin.z + 7.5);
  await sleep(800);
  const plot = await ev(() => { const b = window.poxel.body.pos; const x = Math.floor(b.x), z = Math.floor(b.z) + 2; let y = Math.floor(b.y) + 2; while (y > -50 && window.poxel.getBlock(x, y, z) === 0 || [33, 34, 35, 36].includes(window.poxel.getBlock(x, y, z))) y--; return { x, y, z, id: window.poxel.getBlock(x, y, z) }; });
  info('plot ' + JSON.stringify(plot));
  if (await ev(p => [33, 34, 35, 36].includes(window.poxel.getBlock(p.x, p.y + 1, p.z)), plot)) info('plant on the plot');
  await hold('wooden_hoe');
  await aimAt(plot.x + 0.5, plot.y + 1, plot.z + 0.5);
  await rightClick();
  check('a hoe tills grass into farmland', (await ev(p => window.poxel.getBlock(p.x, p.y, p.z), plot)) === 84, `block ${await ev(p => window.poxel.getBlock(p.x, p.y, p.z), plot)} (was ${plot.id})`);
  await hold('seeds');
  await aimAt(plot.x + 0.5, plot.y + 1, plot.z + 0.5);
  await rightClick();
  await sleep(400);
  info('after planting: ' + JSON.stringify(await ev(p => ({ me: window.poxel.body.pos, plot: window.poxel.getBlock(p.x, p.y, p.z), above: window.poxel.getBlock(p.x, p.y + 1, p.z), aim: window.poxel.lookTarget(), held: window.poxel.inv[window.poxel.inv.findIndex(s => s && s.type === 'seeds')] }), plot)));
  check('seeds plant wheat on farmland', (await ev(p => window.poxel.getBlock(p.x, p.y + 1, p.z), plot)) === 85);
  check('planting used a seed', (await ev(() => window.poxel.inv.filter(s => s && s.type === 'seeds').reduce((a, s) => a + s.count, 0))) === 3);

  // ---- Ice: how far you coast after letting go of W, on grass and then on ice
  const coast = async () => {
    await ev(() => window.poxel.setYawPitch(0, 0));
    await page.keyboard.down('KeyW'); await sleep(900); await page.keyboard.up('KeyW');
    const a = await ev(() => ({ ...window.poxel.body.pos }));
    await sleep(1200);
    const b = await ev(() => ({ ...window.poxel.body.pos }));
    return Math.hypot(b.x - a.x, b.z - a.z);
  };
  const grassCoast = await coast();
  const base = await ev(() => { const b = window.poxel.body.pos; return { x: Math.floor(b.x), y: Math.floor(b.y) - 1, z: Math.floor(b.z) }; });
  // An ice runway with clear air above, on the server too (it refuses moves into blocks it still has)
  await ev(b => {
    const list = [];
    for (let k = -1; k < 16; k++) for (const dx of [-1, 0, 1]) { list.push(b.x + dx, b.y, b.z - k, 40); for (let h = 1; h <= 3; h++) list.push(b.x + dx, b.y + h, b.z - k, 0); }
    for (let i = 0; i < list.length; i += 4) window.poxel.setBlock(list[i], list[i + 1], list[i + 2], list[i + 3]);
    window.poxel.send({ t: 'dev', blocks: list });
  }, base);
  await sleep(300);
  const iceCoast = await coast();
  check('you slide much further on ice than on grass', iceCoast > grassCoast * 2 + 0.5, `ice ${iceCoast.toFixed(2)} vs grass ${grassCoast.toFixed(2)} blocks`);

  // ---- Commands (player9989 only) and creative flying
  await ev(() => window.poxel.send({ t: 'chat', text: '/give lantern 7' }));
  await sleep(500);
  check('/give puts items in your inventory', (await ev(() => window.poxel.inv.filter(s => s && s.type === 'lantern').reduce((a, s) => a + s.count, 0))) === 7);
  await ev(() => window.poxel.send({ t: 'chat', text: '/gamemode creative' }));
  await sleep(500);
  check('/gamemode creative hides the health and hunger bars', await ev(() => document.getElementById('status-bars').style.visibility === 'hidden'));
  // Creative: the recipe book is a list of every item, free
  await page.keyboard.press('Tab');
  await sleep(500);
  const listed = await ev(() => document.querySelectorAll('#recipe-grid .recipe-btn').length);
  check('creative: the book lists every item', listed > 150, `${listed} items`);
  await ev(() => { const b = [...document.querySelectorAll('#recipe-grid .recipe-btn')].find(el => el.title === 'Diamond'); b.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })); });
  await sleep(400);
  check('creative: shift-click takes a full stack', await ev(() => { const c = document.getElementById('cursor-item')?.textContent || ''; return c.includes('64'); }), await ev(() => document.getElementById('cursor-item')?.outerHTML.slice(0, 200)));
  await page.screenshot({ path: `${OUT}/content-creative-items.png` });
  await page.keyboard.press('Tab');
  await sleep(500);
  await ev(() => window.poxel.ui.forcePlaying());
  // Fly in the open, away from the cabin roof
  await walkTo(cabin.x + 0.5, cabin.y + 1.1, cabin.z + 14.5);
  await sleep(600);
  const y0 = await ev(() => window.poxel.body.pos.y);
  await ev(() => window.poxel.ui.forcePlaying());
  await page.keyboard.press('Space'); await sleep(120); await page.keyboard.press('Space');
  await sleep(300);
  await page.keyboard.down('Space'); await sleep(900); await page.keyboard.up('Space');
  await sleep(1200);
  const y1 = await ev(() => window.poxel.body.pos.y);
  check('double-tap jump flies (and you hover)', y1 - y0 > 3, `rose ${(y1 - y0).toFixed(1)} blocks and stayed`);
  await ev(() => window.poxel.send({ t: 'chat', text: '/gamemode survival' }));
  await sleep(1500);

  // ---- New mobs: in creative (they ignore you) spawn a lineup at night, step back, take a picture
  await ev(() => window.poxel.send({ t: 'chat', text: '/gamemode creative' }));
  await ev(() => window.poxel.send({ t: 'dev', time: 0.8 }));
  await sleep(400);
  const line = await ev(() => ({ ...window.poxel.body.pos }));
  const kinds = ['spider', 'skeleton', 'husk', 'frostbitten', 'slime'];
  for (let i = 0; i < kinds.length; i++) {
    await ev((p, i) => window.poxel.glide(p.x + (i - 2) * 2.2, p.y + 0.1, p.z), line, i);
    await ev(() => window.poxel.setYawPitch(0, 0));
    await ev(k => window.poxel.send({ t: 'dev', spawn: k }), kinds[i]);
    await sleep(250);
  }
  await ev(p => window.poxel.glide(p.x, p.y + 1.5, p.z + 3), line);
  await ev(() => window.poxel.setYawPitch(0, -0.2));
  await sleep(700);
  await page.screenshot({ path: `${OUT}/mobs-lineup.png` });
  const kindsSeen = await ev(() => window.poxel.counts().mobs);
  check('new mobs appear on screen', kindsSeen >= 5, `${kindsSeen} mobs`);
} catch (e) {
  check('suite completed without a script error', false, e.message);
} finally {
  await browser.close();
}
finish();
