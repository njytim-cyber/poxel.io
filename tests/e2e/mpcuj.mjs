// Multiplayer critical user journey, through the real buttons: a desktop host presses Play Online,
// plays a little, invites a friend on a phone, they chat and fight together, the friend goes down
// and gives up, drops off the network and comes back into their held place, then the host quits.
// Also measures what players feel: time to join, frame times, and network use per player.
// Screenshots go to tests/e2e/out/mpcuj-*.png.
// Usage: node tests/e2e/mpcuj.mjs [ws-url]
import { BASE, OUT, WS, GPU_ARGS, NO_THROTTLE_ARGS, launch, sleep, suite, uniqueName } from './lib.mjs';
const url = process.argv[2] || WS;
const browser = await launch({ args: [...GPU_ARGS, ...NO_THROTTLE_ARGS], viewport: null });
const { check, info, watch, finish } = suite('mpcuj');
const PHONE = { ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36', w: 915, h: 412 };

const shot = (page, name) => page.screenshot({ path: `${OUT}/mpcuj-${name}.png` });
const visible = (page, id) => page.evaluate(i => { const el = document.getElementById(i); return !!el && getComputedStyle(el).display !== 'none'; }, id);
const text = (page, id) => page.evaluate(i => document.getElementById(i)?.textContent || '', id);
const inWorld = page => page.waitForFunction(() => !!window.poxel && document.getElementById('main-menu')?.style.display === 'none'
  && getComputedStyle(document.getElementById('loading-screen')).display === 'none', { timeout: 30000 }).then(() => true, () => false);

// Frame times (rAF intervals) and WebSocket bytes, per page
async function instrument(page, tag) {
  await page.evaluateOnNewDocument(() => {
    window.__frames = [];
    let last = performance.now();
    const loop = t => { window.__frames.push(t - last); last = t; if (window.__frames.length > 3000) window.__frames.shift(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    // Keep the game's sockets reachable, so the test can cut one like a network failure would
    const Native = window.WebSocket;
    window.__sockets = [];
    window.WebSocket = class extends Native { constructor(...a) { super(...a); window.__sockets.push(this); } };
  });
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable');
  const net = { rx: 0, tx: 0 };
  cdp.on('Network.webSocketFrameReceived', e => { net.rx += e.response.opcode === 2 ? e.response.payloadData.length * 0.75 : e.response.payloadData.length; });
  cdp.on('Network.webSocketFrameSent', e => { net.tx += e.response.opcode === 2 ? e.response.payloadData.length * 0.75 : e.response.payloadData.length; });
  return { tag, cdp, net };
}
async function frameStats(page) {
  return page.evaluate(() => {
    const f = window.__frames.splice(0).filter(x => x > 0).sort((a, b) => a - b);
    if (!f.length) return null;
    const q = p => f[Math.min(f.length - 1, Math.floor(f.length * p))].toFixed(1);
    return { n: f.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: f[f.length - 1].toFixed(1), over50: f.filter(x => x > 50).length };
  });
}
async function measure(page, m, label, ms) {
  await page.evaluate(() => { window.__frames.length = 0; });
  const rx0 = m.net.rx, tx0 = m.net.tx;
  await sleep(ms);
  const s = await frameStats(page);
  const kbps = v => ((v * 8) / 1000 / (ms / 1000)).toFixed(1);
  info(`${m.tag} ${label}: frames ${JSON.stringify(s)} | net down ${kbps(m.net.rx - rx0)} kbit/s, up ${kbps(m.net.tx - tx0)} kbit/s`);
  return s;
}

try {
  const host = uniqueName('Hana'), friend = uniqueName('Fen');
  const start = `${BASE}?server=${encodeURIComponent(url)}`;

  // ---- 1. Host (desktop) lands on the menu and presses Play Online
  const ctxA = await browser.createBrowserContext();
  const A = await ctxA.newPage();
  await A.setViewport({ width: 1280, height: 720 });
  watch(A, 'host');
  const mA = await instrument(A, 'host');
  await A.evaluateOnNewDocument(n => localStorage.setItem('poxel_name', n), host);
  let t = Date.now();
  await A.goto(start, { waitUntil: 'load' });
  await A.waitForFunction(() => document.body.dataset.ready === '1', { timeout: 30000 });
  info(`host: menu ready in ${Date.now() - t}ms`);
  await shot(A, '01-host-menu');
  t = Date.now();
  await A.click('#btn-play-online');
  check('host joins with one click', await inWorld(A));
  info(`host: Play Online -> in the world in ${Date.now() - t}ms`);
  await A.evaluate(() => window.poxel.ui.forcePlaying());
  await sleep(1500);
  await shot(A, '02-host-in-world');
  await measure(A, mA, 'alone, standing', 4000);

  // ---- 2. Host digs the block in front of them (real mouse) and opens the inventory
  const target = await A.evaluate(() => { const b = window.poxel.body.pos; return { x: Math.floor(b.x) + 1, y: Math.floor(b.y) - 1, z: Math.floor(b.z) }; });
  await A.evaluate(({ x, y, z }) => { const b = window.poxel.body.pos; const dx = x + 0.5 - b.x, dy = y + 0.9 - (b.y + 1.62), dz = z + 0.5 - b.z; window.poxel.setYawPitch(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))); }, target);
  await A.mouse.move(640, 360);
  await A.mouse.down(); await sleep(2500); await A.mouse.up();
  await sleep(800);
  check('host mined a block', (await A.evaluate(() => window.poxel.inv.filter(Boolean).length)) > 0);
  await A.keyboard.press('KeyE');
  await sleep(500);
  await shot(A, '03-host-inventory');
  await A.keyboard.press('KeyE');
  await sleep(400);
  await A.evaluate(() => window.poxel.ui.forcePlaying());

  // ---- 3. Host opens the pause menu and invites a friend
  await A.keyboard.press('Escape');
  await sleep(500);
  await A.evaluate(() => { if (window.poxel.ui.state !== 'paused') window.poxel.ui.pause?.(); });
  await shot(A, '04-host-pause-menu');
  await A.evaluate(() => document.getElementById('btn-invite').click());
  await sleep(300);
  const link = await A.evaluate(() => document.getElementById('invite-link').value);
  check('invite link ready', link.includes('join='), link);
  await shot(A, '05-host-invite');
  await A.evaluate(() => document.getElementById('btn-invite-close').click());
  await A.evaluate(() => window.poxel.ui.forcePlaying());

  // ---- 4. Friend opens the link on a phone and taps Join
  const ctxB = await browser.createBrowserContext();
  const B = await ctxB.newPage();
  await B.setUserAgent(PHONE.ua);
  await B.setViewport({ width: PHONE.w, height: PHONE.h, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  watch(B, 'phone');
  const mB = await instrument(B, 'phone');
  await B.evaluateOnNewDocument(n => localStorage.setItem('poxel_name', n), friend);
  t = Date.now();
  await B.goto(link, { waitUntil: 'load' });
  await B.waitForFunction(() => document.body.dataset.ready === '1', { timeout: 30000 });
  info(`phone: menu ready in ${Date.now() - t}ms`);
  await shot(B, '06-phone-invite-menu');
  check('phone sees "Join <host>"', (await text(B, 'play-online-label')) === `Join ${host}`, await text(B, 'play-online-label'));
  const btn = await B.evaluate(() => { const r = document.getElementById('btn-play-online').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  t = Date.now();
  await B.touchscreen.tap(btn.x, btn.y);
  check('phone joins with one tap', await inWorld(B));
  info(`phone: tap -> in the world in ${Date.now() - t}ms`);
  await sleep(1500);
  const pa = await A.evaluate(() => ({ ...window.poxel.body.pos }));
  const pb = await B.evaluate(() => ({ ...window.poxel.body.pos }));
  check('friend arrives next to the host', Math.hypot(pa.x - pb.x, pa.z - pb.z) < 4, `${Math.hypot(pa.x - pb.x, pa.z - pb.z).toFixed(1)} blocks`);
  await shot(B, '07-phone-in-world');
  await shot(A, '08-host-sees-friend');
  check('host sees the friend', (await A.evaluate(() => window.poxel.counts().players)) === 1);
  await measure(A, mA, 'with friend', 4000);
  await measure(B, mB, 'with host', 4000);

  // ---- 5. Chat: host types, the phone sees it
  await A.keyboard.press('KeyT');
  await sleep(200);
  await A.keyboard.type('hi from the host!');
  await A.keyboard.press('Enter');
  await sleep(800);
  check('chat reaches the phone', (await B.evaluate(() => document.getElementById('chat-log').textContent)).includes('hi from the host!'));
  await shot(B, '09-phone-chat');
  await A.evaluate(() => window.poxel.ui.forcePlaying());

  // ---- 6. A zombie turns up; the host draws a sword and fights it with real clicks
  // (bare hands do 1 damage: a zombie only falls to them by burning in daylight)
  await A.evaluate(() => window.poxel.send({ t: 'dev', give: 'iron_sword', count: 1 }));
  await sleep(500);
  await A.evaluate(() => window.poxel.select(window.poxel.inv.findIndex(s => s && s.type === 'iron_sword')));
  await sleep(300);
  await A.evaluate(() => window.poxel.send({ t: 'dev', spawn: 'zombie' }));
  await sleep(1500);
  const z = await A.evaluate(() => window.poxel.entities().find(e => e.kind === 'zombie'));
  check('zombie spawned', !!z);
  if (z) {
    for (let i = 0; i < 24; i++) { // a sword kills in 4 hits; extra tries for a slow machine
      const zz = await A.evaluate(eid => window.poxel.entities().find(e => e.eid === eid), z.eid);
      if (!zz) break;
      await A.evaluate(p => { const b = window.poxel.body.pos; const dx = p.x - b.x, dy = p.y + 1 - (b.y + 1.62), dz = p.z - b.z; window.poxel.setYawPitch(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))); }, zz);
      if (Math.hypot(zz.x - pa.x, zz.z - pa.z) > 2.5) await A.evaluate(p => window.poxel.glide(p.x + 1.5, p.y + 0.1, p.z), zz);
      await A.mouse.click(640, 360);
      await sleep(450);
    }
    await shot(A, '10-host-fight');
    check('host defeated the zombie', !(await A.evaluate(eid => window.poxel.entities().some(e => e.eid === eid && !e.dying), z.eid)));
  }
  await measure(A, mA, 'after the fight', 3000);

  // ---- 7. The friend falls, goes down, and gives up with a tap; then respawns
  const fb = await B.evaluate(() => ({ ...window.poxel.body.pos }));
  await B.evaluate(p => window.poxel.glide(p.x, p.y + 26, p.z, 6), fb);
  for (let i = 0; i < 40 && !(await visible(B, 'downed-screen')); i++) await sleep(150);
  check('friend goes down from the fall', await visible(B, 'downed-screen'));
  await shot(B, '11-phone-downed');
  await sleep(1700);
  await B.touchscreen.tap(PHONE.w / 2, PHONE.h * 0.3);
  for (let i = 0; i < 20 && !(await B.evaluate(() => window.poxel.ui.state === 'dead')); i++) await sleep(150);
  check('a tap gives up', await B.evaluate(() => window.poxel.ui.state === 'dead'));
  await shot(B, '12-phone-dead');
  const rb = await B.evaluate(() => { const r = document.getElementById('btn-respawn').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await B.touchscreen.tap(rb.x, rb.y);
  await sleep(1200);
  check('friend respawns', await B.evaluate(() => window.poxel.ui.state === 'playing' && window.poxel.health() > 0));

  // ---- 8. The phone's connection drops (not a quit: an abnormal close, as when a network or proxy fails)
  // and it comes back into its held place
  const before = await B.evaluate(() => ({ ...window.poxel.body.pos }));
  const seenByHost = async () => A.evaluate(n => window.poxel.entities().find(e => e.kind === 'player'), friend);
  info(`phone before the drop: own ${JSON.stringify(before)} | host sees ${JSON.stringify(await seenByHost())}`);
  // (only the game's socket: the dev server's live-reload socket would reload the page)
  const gameHost = new URL(url).host;
  const cut = await B.evaluate(h => { let n = 0; for (const ws of window.__sockets) if (ws.readyState === 1 && new URL(ws.url).host === h) { ws.close(3001, 'network dropped'); n++; } return n; }, gameHost);
  check('cut the game connection', cut === 1, `${cut} sockets`);
  await sleep(300);
  await shot(B, '13-phone-dropped');
  info('phone banner after the drop: ' + JSON.stringify(await text(B, 'net-banner')));
  let back = false;
  for (let i = 0; i < 60 && !back; i++) { await sleep(250); back = await B.evaluate(() => getComputedStyle(document.getElementById('net-banner')).display === 'none'); }
  check('phone reconnects after the network returns', back);
  await sleep(800);
  const after = await B.evaluate(() => ({ ...window.poxel.body.pos }));
  info(`phone after reconnecting: own ${JSON.stringify(after)} | host sees ${JSON.stringify(await seenByHost())}`);
  check('phone is back where it was', Math.hypot(after.x - before.x, after.z - before.z) < 2, `moved ${Math.hypot(after.x - before.x, after.z - before.z).toFixed(1)}`);
  const hostChat = await A.evaluate(() => document.getElementById('chat-log').textContent);
  check('host never saw the friend leave', !hostChat.includes(`${friend} left`), hostChat.slice(-200));
  check('both still online', (await A.evaluate(() => window.poxel.online().length)) === 2);

  // ---- 9. The host quits from the pause menu; the phone sees them go
  await A.evaluate(() => window.poxel.ui.pause?.());
  await A.evaluate(() => document.getElementById('btn-save-quit').click());
  await sleep(2500);
  check('host is back on the menu', await A.evaluate(() => document.getElementById('main-menu').style.display !== 'none'));
  check('phone sees the host leave', (await B.evaluate(() => document.getElementById('chat-log').textContent)).includes(`${host} left`));
  await shot(B, '14-phone-host-left');
} catch (e) {
  check('journey ran without crashing', false, e.stack || String(e));
}
// Close pages like closing a tab (a clean close), so this suite's players don't linger on the server
for (const pg of await browser.pages()) await pg.close().catch(() => {});
for (const c of browser.browserContexts()) for (const pg of await c.pages()) await pg.close().catch(() => {});
await sleep(500);
await browser.close();
finish();
