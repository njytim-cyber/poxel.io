// Joining multiplayer the way players do: one-tap Play, the loading screen, ping on screen, an invite
// link that brings a friend in beside you, and refusals that land back on the menu with the reason.
// Usage: node tests/e2e/join.mjs [ws-url]
import { BASE, OUT, WS, GPU_ARGS, NO_THROTTLE_ARGS, launch, sleep, suite, uniqueName } from './lib.mjs';
const url = process.argv[2] || WS;
const browser = await launch({ args: [...GPU_ARGS, ...NO_THROTTLE_ARGS], viewport: { width: 960, height: 600 } });
const { check, info, watch, finish } = suite('join');

const visible = (page, id) => page.evaluate(i => { const el = document.getElementById(i); return !!el && getComputedStyle(el).display !== 'none'; }, id);
const text = (page, id) => page.evaluate(i => document.getElementById(i)?.textContent || '', id);
async function open(context, link, name) {
  const page = await context.newPage();
  if (name) await page.evaluateOnNewDocument(n => { if (!localStorage.getItem('poxel_name')) localStorage.setItem('poxel_name', n); }, name);
  watch(page, name || 'page');
  await page.goto(link, { waitUntil: 'load' });
  await page.waitForFunction(() => document.body.dataset.ready === '1', { timeout: 15000 });
  await sleep(300);
  return page;
}
const waitPlaying = page => page.waitForFunction(() => !!window.poxel && document.getElementById('main-menu')?.style.display === 'none'
  && getComputedStyle(document.getElementById('loading-screen')).display === 'none', { timeout: 20000 }).then(() => true, () => false);

try {
  const alice = uniqueName('Ann'), bob = uniqueName('Ben');
  const start = `${BASE}?server=${encodeURIComponent(url)}`;

  // 1. One tap: Play Online is on the main menu and takes you straight in, through a loading screen
  const ctxA = await browser.createBrowserContext();
  const A = await open(ctxA, start, alice);
  check('Play Online button on the menu', await visible(A, 'btn-play-online'));
  await A.click('#btn-play-online');
  await sleep(150);
  check('loading screen while joining', await visible(A, 'loading-screen'));
  check('in the world after loading', await waitPlaying(A));
  await sleep(6500); // first ping goes out after 5s
  check('ping shown on screen', await visible(A, 'ping-hud'), await text(A, 'ping-hud'));
  await A.evaluate(() => window.poxel.ui.forcePlaying());

  // 2. Invite link: Bob opens it and starts next to Alice
  await A.evaluate(() => document.getElementById('btn-invite').click());
  await sleep(200);
  const link = await A.evaluate(() => document.getElementById('invite-link').value);
  check('invite link names the inviter', link.includes(`join=${alice}`), link);
  check('invite dialog has a QR code', await A.evaluate(() => !!document.querySelector('#invite-qr svg')));
  await A.screenshot({ path: `${OUT}/join-invite.png` });
  await A.evaluate(() => document.getElementById('btn-invite-close').click());
  check('player list shows even when alone', await A.evaluate(() => document.getElementById('online-list').style.display !== 'none'));

  const ctxB = await browser.createBrowserContext();
  const B = await open(ctxB, link, bob);
  check('invite button says who you join', (await text(B, 'play-online-label')) === `Join ${alice}`, await text(B, 'play-online-label'));
  await B.click('#btn-play-online');
  check('friend joined from the invite', await waitPlaying(B));
  await sleep(500);
  const pa = await A.evaluate(() => ({ ...window.poxel.body.pos }));
  const pb = await B.evaluate(() => ({ ...window.poxel.body.pos }));
  const d = Math.hypot(pa.x - pb.x, pa.z - pb.z);
  check('friend starts beside the inviter', d < 4, `${d.toFixed(1)} blocks apart`);
  check('invite removed from the address bar', !(await B.evaluate(() => location.search)));

  // 3. A refusal lands on the menu with the reason (someone else's name)
  const ctxC = await browser.createBrowserContext();
  const C = await open(ctxC, start, alice); // same name, different browser = different owner
  await C.click('#btn-play-online');
  await C.waitForFunction(() => getComputedStyle(document.getElementById('menu-error')).display !== 'none', { timeout: 15000 }).catch(() => {});
  const reason = await text(C, 'menu-error-text');
  check('refusal shown on the menu', /already playing/.test(reason), reason);
  check('loading screen gone after a refusal', !(await visible(C, 'loading-screen')));
  check('main menu back after a refusal', await C.evaluate(() => document.getElementById('main-menu').style.display !== 'none'));
  await C.screenshot({ path: `${OUT}/join-refused-menu.png` });
  await ctxC.close();

  // 4. Playing in a second tab takes over; the first tab goes back to the menu and says why
  const B2 = await ctxB.newPage();
  watch(B2, 'bob-tab-2');
  await B2.goto(start, { waitUntil: 'load' });
  await B2.waitForFunction(() => document.body.dataset.ready === '1', { timeout: 15000 });
  await B2.click('#btn-play-online');
  check('second tab plays', await waitPlaying(B2));
  await B.waitForFunction(() => document.body.dataset.ready === '1' && getComputedStyle(document.getElementById('menu-error')).display !== 'none', { timeout: 15000 }).catch(() => {});
  const why = await text(B, 'menu-error-text').catch(() => '');
  check('first tab back on the menu with the reason', /somewhere else/.test(why), why);
  info('B2 at ' + JSON.stringify(await B2.evaluate(() => window.poxel.body.pos)));
} catch (e) {
  check('suite ran without crashing', false, e.stack || String(e));
}
await browser.close();
finish();
