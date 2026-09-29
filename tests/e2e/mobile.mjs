// Touch controls on an emulated phone or tablet: joystick, look, jump, mine, place, hotbar, inventory, menu.
// Usage: node tests/e2e/mobile.mjs [phone|tablet]
import { OUT, BASE, GPU_ARGS, NO_THROTTLE_ARGS, launch, sleep, suite } from './lib.mjs';
const DEVICES = {
  phone: { ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36', w: 915, h: 412 },
  tablet: { ua: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', w: 1180, h: 820 },
};
const which = process.argv[2] || 'phone';
const dev = DEVICES[which];
if (!dev) throw new Error(`Unknown device "${which}" (use phone or tablet)`);
const browser = await launch({ args: [...GPU_ARGS, ...NO_THROTTLE_ARGS], viewport: null });
const { check, info, watch, finish } = suite(`mobile-${which}`);

// The user agent and touch viewport must be set before the game loads (it detects touch at startup)
const page = await browser.newPage();
await page.setUserAgent(dev.ua);
await page.setViewport({ width: dev.w, height: dev.h, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
watch(page, which);
const ev = (f, ...a) => page.evaluate(f, ...a);
const center = sel => ev(s => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height, vis: getComputedStyle(el).display !== 'none' }; }, sel);
const tap = async sel => { const c = await center(sel); await page.touchscreen.touchStart(c.x, c.y); await sleep(80); await page.touchscreen.touchEnd(); };
const hold = async (sel, ms) => { const c = await center(sel); await page.touchscreen.touchStart(c.x, c.y); await sleep(ms); await page.touchscreen.touchEnd(); };
// Gestures on the game view (away from the buttons): tap = use/place, long-press = mine
const viewPoint = () => ({ x: dev.w * 0.55, y: dev.h * 0.35 });
const tapView = async () => { const p = viewPoint(); await page.touchscreen.touchStart(p.x, p.y); await sleep(80); await page.touchscreen.touchEnd(); };
const holdView = async ms => { const p = viewPoint(); await page.touchscreen.touchStart(p.x, p.y); await sleep(ms); await page.touchscreen.touchEnd(); };

try {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.poxel, { timeout: 15000 });
  await sleep(1500);
  check('detected as touch device', await ev(() => document.getElementById('mobile-hud').style.display === 'block'));
  await ev(() => window.poxel.startSingle(12345));
  await sleep(4500);
  await ev(() => { document.getElementById('main-menu').style.display = 'none'; });
  check('game started', await ev(() => window.poxel.ui.state === 'playing'), await ev(() => window.poxel.ui.state));
  await page.screenshot({ path: `${OUT}/${which}-hud.png` });

  // Layout (like Minecraft): joystick bottom-left; Jump bottom-right with Sneak above it and Run to its left
  const [js, jump, sneak, run] = [await center('#joystick-zone'), await center('#btn-mobile-jump'), await center('#btn-mobile-sneak'), await center('#btn-mobile-sprint')];
  check('joystick at the bottom left', js.x < dev.w * 0.25 && js.y > dev.h * 0.6, JSON.stringify(js));
  check('jump at the bottom right', jump.x > dev.w * 0.8 && jump.y > dev.h * 0.7, JSON.stringify(jump));
  check('sneak above jump, run left of jump', Math.abs(sneak.x - jump.x) < 5 && sneak.y < jump.y && run.x < jump.x && run.y > sneak.y);
  const offscreen = await ev(() => [...document.querySelectorAll('#mobile-hud button, #joystick-zone')].filter(el => { const r = el.getBoundingClientRect(); return r.width && (r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight); }).map(el => el.id));
  check('all touch controls fully on screen', offscreen.length === 0, offscreen.join(','));

  // Which element is on top of the joystick? (covered = broken joystick)
  const top = await ev(() => { const r = document.getElementById('joystick-zone').getBoundingClientRect(); const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return el ? (el.id || el.className || el.tagName) : 'none'; });
  info(`element on top of joystick centre: ${top}`);

  // Joystick: drag up (forward)
  const j = await center('#joystick-zone');
  const p0 = await ev(() => ({ ...window.poxel.body.pos }));
  await page.touchscreen.touchStart(j.x, j.y);
  for (let i = 1; i <= 8; i++) { await page.touchscreen.touchMove(j.x, j.y - i * 6); await sleep(30); }
  await sleep(1200);
  const keysDuring = await ev(() => ({ ...window.__keys }));
  await page.touchscreen.touchEnd();
  await sleep(300);
  const p1 = await ev(() => ({ ...window.poxel.body.pos }));
  const moved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
  check('joystick moves the player', moved > 2, `moved ${moved.toFixed(2)} keys=${JSON.stringify(keysDuring)}`);

  // Look: swipe on the right side of the screen
  const yaw0 = await ev(() => window.poxel.yaw());
  await page.touchscreen.touchStart(dev.w * 0.6, dev.h * 0.4);
  for (let i = 1; i <= 10; i++) { await page.touchscreen.touchMove(dev.w * 0.6 + i * 12, dev.h * 0.4); await sleep(16); }
  await page.touchscreen.touchEnd();
  await sleep(200);
  const yaw1 = await ev(() => window.poxel.yaw());
  check('swipe to look around', Math.abs(yaw1 - yaw0) > 0.2, `yaw ${yaw0.toFixed(2)} -> ${yaw1.toFixed(2)}`);

  // Jump button
  await ev(() => { window.__maxY = 0; const b = window.poxel.body; const y0 = b.pos.y; const t = setInterval(() => { window.__maxY = Math.max(window.__maxY, b.pos.y - y0); }, 16); setTimeout(() => clearInterval(t), 1500); });
  await hold('#btn-mobile-jump', 300);
  await sleep(900);
  check('jump button', (await ev(() => window.__maxY)) > 0.5, `rose ${(await ev(() => window.__maxY)).toFixed(2)}`);

  // Run and Sneak are toggles
  await tap('#btn-mobile-sprint');
  const runOn = await ev(() => window.__keys.run && document.getElementById('btn-mobile-sprint').classList.contains('on'));
  await tap('#btn-mobile-sprint');
  check('Run toggles on and off', runOn && !(await ev(() => window.__keys.run)));
  await tap('#btn-mobile-sneak');
  const sneakOn = await ev(() => window.__keys.shift);
  await tap('#btn-mobile-sneak');
  check('Sneak toggles on and off', sneakOn && !(await ev(() => window.__keys.shift)));

  // A quick tap on the view must not mine
  for (let i = 0; i < 20 && !(await ev(() => window.poxel.body.onGround)); i++) await sleep(100);
  await ev(() => window.poxel.setYawPitch(window.poxel.yaw(), -1.5));
  await sleep(300);
  const under = await ev(() => window.poxel.lookTarget());
  const before = under ? under.id : -1;
  await tapView();
  await sleep(600);
  check('tap on the view does not mine', under && (await ev(t => window.poxel.getBlock(t.x, t.y, t.z), under)) === before);
  // Long-press on the view mines the block under the crosshair
  await holdView(2500);
  await sleep(1500);
  const after = under ? await ev(t => window.poxel.getBlock(t.x, t.y, t.z), under) : -1;
  check('long-press on the view mines a block', before > 0 && after === 0, `${before} -> ${after}`);
  if (under) await ev(t => window.poxel.glide(t.x + 0.5, t.y + 0.2, t.z + 0.5), under);
  await sleep(2000);
  const got = await ev(() => window.poxel.inv.filter(Boolean).map(s => s.type + 'x' + s.count));
  check('broken block picked up', got.length > 0, JSON.stringify(got));

  // Use/place the block back: climb out of the hole onto open ground and aim a couple of blocks ahead
  await ev(() => window.poxel.select(0));
  await sleep(300);
  await ev(() => { const b = window.poxel.body.pos; return window.poxel.glide(b.x, b.y + 2.5, b.z + 3); });
  for (let i = 0; i < 30 && !(await ev(() => window.poxel.body.onGround)); i++) await sleep(100);
  const heldBefore = await ev(() => window.poxel.inv[0] ? window.poxel.inv[0].count : 0);
  const heldType = await ev(() => window.poxel.inv[0]?.type);
  await ev(() => window.poxel.setYawPitch(0, -0.6));
  await sleep(200);
  await tapView();
  await sleep(1000);
  const heldAfter = await ev(() => window.poxel.inv[0] ? window.poxel.inv[0].count : 0);
  // Flowers can only go on grass/dirt, so a picked-up flower may correctly refuse to be placed
  const plant = /flower|dandelion|rose|poppy|grass/.test(heldType || '');
  check('tap on the view places a block', heldBefore > 0 && (heldAfter === heldBefore - 1 || plant), `${heldType} ${heldBefore} -> ${heldAfter}`);

  // Hotbar tap
  await ev(() => window.poxel.select(0));
  const slot3 = await ev(() => { const r = document.querySelectorAll('#inventory-bar .slot')[3].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.touchscreen.touchStart(slot3.x, slot3.y); await sleep(60); await page.touchscreen.touchEnd();
  await sleep(300);
  check('tap hotbar slot selects it', await ev(() => document.querySelectorAll('#inventory-bar .slot')[3].classList.contains('active')));

  // Inventory button, tap a slot, tap outside to close
  await tap('#btn-mobile-inv');
  await sleep(600);
  check('inventory button opens inventory', await ev(() => window.poxel.ui.state === 'screen'));
  await page.screenshot({ path: `${OUT}/${which}-inventory.png` });
  const firstItem = await ev(() => { const s = [...document.querySelectorAll('#full-inventory-grid .slot')].find(el => el.querySelector('img')); if (!s) return null; const r = s.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  if (firstItem) {
    await page.touchscreen.touchStart(firstItem.x, firstItem.y); await sleep(60); await page.touchscreen.touchEnd();
    await sleep(300);
    check('tap picks up a stack', await ev(() => document.getElementById('cursor-item').style.display === 'block'));
    await page.touchscreen.touchStart(firstItem.x, firstItem.y); await sleep(60); await page.touchscreen.touchEnd();
    await sleep(300);
  }
  const modalBox = await ev(() => { const r = document.getElementById('modal-container').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const outside = modalBox.x > 20 ? { x: 8, y: dev.h / 2 } : { x: dev.w - 8, y: 8 };
  await page.touchscreen.touchStart(outside.x, outside.y); await sleep(60); await page.touchscreen.touchEnd();
  await sleep(500);
  check('tap outside closes inventory', await ev(() => window.poxel.ui.state === 'playing'), await ev(() => window.poxel.ui.state));

  // Menu button -> pause -> Back to Game resumes
  await tap('#btn-mobile-menu');
  await sleep(400);
  check('menu button pauses', await ev(() => window.poxel.ui.state === 'paused'));
  await tap('#btn-resume');
  await sleep(400);
  check('Back to Game resumes', await ev(() => window.poxel.ui.state === 'playing'));

  await tap('#btn-mobile-view');
  await sleep(300);
  await page.screenshot({ path: `${OUT}/${which}-thirdperson.png` });
} catch (e) {
  check('suite completed without a script error', false, e.message);
} finally {
  await browser.close();
}
finish();
