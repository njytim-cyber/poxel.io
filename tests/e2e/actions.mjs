// Player actions the other suites don't reach, played with real input: the furnace screen (smelt and take
// the ingots), the long-press stack split, dropping with Q, eating, setting a home with H (and its toast),
// a critical hit, resizing the window, and (single player) creative flying.
// Usage: node tests/e2e/actions.mjs [ws-url]
import { OUT, WS, GPU_ARGS, NO_THROTTLE_ARGS, launch, openGame, sleep, suite, uniqueName } from './lib.mjs';
const url = process.argv[2] || WS;
const browser = await launch({ args: [...GPU_ARGS, ...NO_THROTTLE_ARGS], viewport: { width: 1280, height: 720 } });
const { check, info, watch, finish } = suite('actions');

const page = await openGame(browser);
watch(page);
const ev = (f, ...a) => page.evaluate(f, ...a);
const give = (type, count = 1) => ev((t, c) => window.poxel.send({ t: 'dev', give: t, count: c }), type, count);
const count = t => ev(t => window.poxel.inv.reduce((n, s) => n + (s && s.type === t ? s.count : 0), 0), t);
const slotOf = t => ev(t => window.poxel.inv.findIndex((s, i) => i < 45 && s && s.type === t), t);
const center = sel => ev(s => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, sel);
const visible = sel => ev(s => { const el = document.querySelector(s); return !!el && getComputedStyle(el).display !== 'none'; }, sel);
const aimAt = async (x, y, z) => { await page.mouse.move(640, 360); await ev(({ x, y, z }) => { const b = window.poxel.body.pos; const dx = x - b.x, dy = y - (b.y + 1.62), dz = z - b.z; window.poxel.setYawPitch(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))); }, { x, y, z }); };
const chatLog = () => ev(() => document.getElementById('chat-log').textContent);
const playing = () => ev(() => window.poxel.ui.forcePlaying());

try {
  await ev((u, n) => window.poxel.connect(u, n), url, uniqueName('Doer'));
  await sleep(3000);
  await playing();
  const me = await ev(() => { const b = window.poxel.body.pos; return { x: Math.floor(b.x), y: Math.floor(b.y), z: Math.floor(b.z) }; });

  // ---- 1. Furnace screen: place a furnace, open it, shift-click ore and coal in, wait, take the ingots
  // A clear line to the furnace (terrain may have a step in the way)
  await ev(p => window.poxel.send({ t: 'dev', blocks: [p.x + 1, p.y, p.z, 0, p.x + 1, p.y + 1, p.z, 0, p.x + 2, p.y, p.z, window.poxel.blockId('furnace'), p.x + 2, p.y + 1, p.z, 0, p.x + 1, p.y - 1, p.z, window.poxel.blockId('stone')] }), me);
  await give('iron_ore', 2); await give('coal', 1);
  await sleep(600);
  await aimAt(me.x + 2.5, me.y + 0.5, me.z + 0.5);
  await page.mouse.down({ button: 'right' }); await sleep(80); await page.mouse.up({ button: 'right' });
  await sleep(800);
  check('furnace screen opens', await visible('#furnace-area'));
  for (const t of ['iron_ore', 'coal']) {
    const c = await center(`#full-inventory-grid .slot[data-slot="${await slotOf(t)}"], #hotbar-grid .slot[data-slot="${await slotOf(t)}"], .slot[data-slot="${await slotOf(t)}"]`);
    await page.keyboard.down('Shift'); await page.mouse.click(c.x, c.y); await page.keyboard.up('Shift');
    await sleep(300);
  }
  // (one coal is burned straight away once there's ore: the fuel slot empties and the flame lights)
  const inFurnace = () => ev(() => ({ input: document.querySelector('#furnace-input .slot')?.title, flame: parseFloat(document.getElementById('furnace-flame').style.height) || 0 }));
  for (let i = 0; i < 20 && !((await inFurnace()).input === 'Iron Ore' && (await inFurnace()).flame > 0); i++) await sleep(100);
  const fs = await inFurnace();
  check('ore in the furnace and the coal burning', fs.input === 'Iron Ore' && fs.flame > 0, JSON.stringify(fs));
  await page.screenshot({ path: `${OUT}/actions-furnace.png` });
  for (let i = 0; i < 30 && !(await ev(() => /2/.test(document.querySelector('#furnace-output .slot')?.textContent || ''))); i++) await sleep(500);
  const out = await center('#furnace-output .slot');
  await page.keyboard.down('Shift'); await page.mouse.click(out.x, out.y); await page.keyboard.up('Shift');
  await sleep(500);
  check('two iron ingots smelted and taken', (await count('iron_ingot')) === 2, `${await count('iron_ingot')} ingots`);
  await page.keyboard.press('Escape');
  await sleep(400);
  await playing();

  // ---- 2. Long press on a stack splits it in half (the touch way to right-click)
  await give('dirt', 10);
  await sleep(500);
  await page.keyboard.press('KeyE');
  await sleep(500);
  const dirtSlot = await slotOf('dirt');
  const d = await center(`.slot[data-slot="${dirtSlot}"]`);
  await page.mouse.move(d.x, d.y); await page.mouse.down(); await sleep(600); await page.mouse.up();
  await sleep(200);
  check('long press takes half the stack', (await ev(i => window.poxel.inv[i]?.count, dirtSlot)) === 5);
  await page.screenshot({ path: `${OUT}/actions-split.png` });
  const empty = await ev(() => window.poxel.inv.findIndex((s, i) => i >= 9 && i < 45 && !s));
  const e = await center(`.slot[data-slot="${empty}"]`);
  await page.mouse.click(e.x, e.y);
  await sleep(300);
  check('the half goes back down', (await ev(i => window.poxel.inv[i]?.count, empty)) === 5);
  await page.keyboard.press('KeyE');
  await sleep(400);
  await playing();

  // ---- 3. Q drops one, Ctrl+Q drops the stack
  await ev(i => window.poxel.select(i), await slotOf('dirt'));
  await sleep(200);
  const before = await count('dirt');
  await page.keyboard.press('KeyQ');
  await sleep(500);
  check('Q drops one item', (await count('dirt')) === before - 1, `${before} -> ${await count('dirt')}`);
  await page.keyboard.down('Control'); await page.keyboard.press('KeyQ'); await page.keyboard.up('Control');
  await sleep(500);
  check('Ctrl+Q drops the whole stack', !(await ev(() => window.poxel.inv[window.poxel.inv.findIndex((s, i) => i < 9 && s && s.type === 'dirt')])) && (await count('dirt')) === before - 5,
    `${await count('dirt')} dirt left (the other half is in another slot)`);

  // ---- 4. Eating (a golden apple can be eaten even when full)
  await give('golden_apple', 2);
  await sleep(500);
  await ev(i => window.poxel.select(i), await slotOf('golden_apple'));
  await ev(() => window.poxel.setYawPitch(0, 1.2)); // up at the sky, so right-click can't place or use a block
  await page.mouse.down({ button: 'right' }); await sleep(2500); await page.mouse.up({ button: 'right' });
  await sleep(500);
  check('holding right-click eats (and keeps eating)', (await count('golden_apple')) < 2, `${await count('golden_apple')} of 2 apples left`);

  // ---- 5. H sets a home: refused without etherite armour, then set (with a toast) when wearing some
  await page.keyboard.press('KeyH');
  await sleep(500);
  check('H without etherite armour explains why not', /etherite armour/.test(await chatLog()));
  await give('etherite_helmet', 1);
  await sleep(500);
  await page.keyboard.press('KeyE'); await sleep(400);
  const h = await center(`.slot[data-slot="${await slotOf('etherite_helmet')}"]`);
  await page.keyboard.down('Shift'); await page.mouse.click(h.x, h.y); await page.keyboard.up('Shift');
  await sleep(300);
  await page.keyboard.press('KeyE'); await sleep(400);
  await playing();
  await page.keyboard.press('KeyH');
  let toast = '';
  for (let i = 0; i < 10 && !toast; i++) { await sleep(150); toast = await ev(() => { const t = document.getElementById('toast'); return t && getComputedStyle(t).opacity !== '0' && getComputedStyle(t).display !== 'none' ? t.textContent : ''; }); }
  check('H with etherite armour sets a home (toast)', /Home 1 set/.test(toast), JSON.stringify(toast));

  // ---- 6. A critical hit: jump, and hit a zombie on the way down
  await give('iron_sword', 1);
  await ev(() => window.poxel.send({ t: 'dev', time: 0.5 })); // night: no daylight burning
  await sleep(400);
  await ev(i => window.poxel.select(i), await ev(() => window.poxel.inv.findIndex((s, i) => i < 9 && s && s.type === 'iron_sword')));
  await ev(() => window.poxel.send({ t: 'dev', spawn: 'zombie' }));
  await sleep(1500);
  let crit = false;
  for (let i = 0; i < 6 && !crit; i++) {
    const z = await ev(() => window.poxel.entities().find(e => e.kind === 'zombie'));
    if (!z) break;
    await aimAt(z.x, z.y + 1, z.z);
    await page.keyboard.down('Space'); await sleep(90); await page.keyboard.up('Space');
    await sleep(330); // past the top of the jump, falling
    await page.mouse.click(640, 360);
    for (let k = 0; k < 6 && !crit; k++) { await sleep(60); crit = await ev(() => document.getElementById('crit-flash').classList.contains('show')); }
    await sleep(700);
  }
  check('a hit while falling is a critical hit (flash)', crit);

  // ---- 7. Resizing the window resizes the view
  const viewWidth = () => ev(() => Math.max(...[...document.querySelectorAll('canvas')].map(c => c.width)));
  const w0 = await viewWidth();
  await page.setViewport({ width: 900, height: 560 });
  await sleep(500);
  const w1 = await viewWidth();
  check('the view follows a window resize', w1 !== w0 && w1 > 0, `${w0} -> ${w1}`);
  await page.setViewport({ width: 1280, height: 720 });

  // ---- 8. Single player: creative mode and flying (double-tap jump, hold to rise)
  await page.close();
  const sp = await openGame(browser);
  watch(sp, 'single');
  const sev = (f, ...a) => sp.evaluate(f, ...a);
  await sev(() => { window.poxel.deleteSave(4); window.poxel.startSingle(777); });
  await sleep(4500);
  await sev(() => window.poxel.ui.forcePlaying());
  await sp.keyboard.press('KeyT'); await sleep(200);
  await sp.keyboard.type('/gamemode creative'); await sp.keyboard.press('Enter');
  await sleep(800);
  await sev(() => window.poxel.ui.forcePlaying());
  const y0 = await sev(() => window.poxel.body.pos.y);
  await sp.keyboard.press('Space'); await sleep(120); await sp.keyboard.press('Space');
  await sleep(150);
  await sp.keyboard.down('Space'); await sleep(1000); await sp.keyboard.up('Space');
  await sleep(300);
  const y1 = await sev(() => window.poxel.body.pos.y);
  check('creative: double-tap jump flies', y1 - y0 > 3, `rose ${(y1 - y0).toFixed(1)} blocks`);
  await sp.close();
} catch (e) {
  check('suite ran without crashing', false, e.stack || String(e));
}
await browser.close();
finish();
