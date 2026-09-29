// Your character across saves and servers: take a single-player save's character into multiplayer,
// die there, and the save has lost those items too. The profile name and name token survive reloads.
// Usage: node tests/e2e/carry.mjs [ws-url]
import { WS, launch, openGame, sleep, suite, uniqueName } from './lib.mjs';
const url = process.argv[2] || WS;
const browser = await launch({ viewport: { width: 1100, height: 700 } });
const { check, info, watch, finish } = suite('carry');
const SLOT = 4; // window.poxel.startSingle uses slot 5 (index 4)

try {
  const page = await openGame(browser, { ctx: true });
  watch(page);
  const ev = (f, ...a) => page.evaluate(f, ...a);
  const invOf = () => ev(() => window.poxel.inv.filter(Boolean).map(s => s.type + 'x' + s.count).sort().join(' '));
  const savedInv = () => ev(slot => {
    const p = window.poxel.readSave(slot)?.players?.Player;
    return p ? p.inv.slots.filter(Boolean).map(s => s.type + 'x' + s.count).sort().join(' ') : null;
  }, SLOT);

  // 1. Single player: get some items and save
  await ev(slot => { window.poxel.deleteSave(slot); window.poxel.startSingle(12345); }, SLOT);
  await sleep(4000);
  await ev(() => window.poxel.ui.forcePlaying());
  for (let k = 0; k < 4 && (await ev(() => window.poxel.inv.filter(Boolean).length)) < 1; k++) {
    await ev(() => window.poxel.setYawPitch(0, -1.55));
    await page.mouse.down(); await sleep(1600); await page.mouse.up(); await sleep(2000);
  }
  await ev(() => window.poxel.saveNow());
  const spItems = await invOf();
  check('got items in single player', spItems.length > 0, spItems);
  check('items are in the save', (await savedInv()) === spItems, `${await savedInv()}`);

  // 2. Reload (like quitting to the menu) and join multiplayer with that save's character, through the menu
  const name = uniqueName('Carrier');
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !!window.poxel);
  await sleep(1000);
  await page.click('#btn-multiplayer');
  await sleep(300);
  const options = await page.$$eval('#mp-character option', os => os.map(o => o.value));
  check('the save is offered as a character', options.includes(String(SLOT)), options.join(','));
  await page.$eval('#mp-name', (el, n) => { el.value = n; }, name);
  await page.$eval('#mp-url', (el, u) => { el.value = u; }, url);
  await page.select('#mp-character', String(SLOT));
  await page.click('#btn-connect');
  await sleep(3500);
  await ev(() => window.poxel.ui.forcePlaying());
  check('joined the server with the save\'s items', (await invOf()) === spItems, await invOf());

  const token1 = await ev(() => localStorage.getItem('poxel_token'));

  // 3. Die on the server: the items drop there, and the save loses them too
  await ev(() => window.poxel.send({ t: 'chat', text: '/kill' }));
  await sleep(1500);
  check('died in multiplayer', await ev(() => window.poxel.ui.state === 'dead'));
  check('the save lost the items after dying in multiplayer', (await savedInv()) === '', `save now: "${await savedInv()}"`);
  // Quit without respawning (respawning right on the dropped items would pick them back up)
  await ev(() => window.poxel.flushCarry?.());

  // 4. Name and token are remembered (the same profile everywhere)
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !!window.poxel);
  await sleep(800);
  check('profile name remembered after reload', (await page.$eval('#mp-name', el => el.value)) === name);
  check('name token remembered after reload', !!token1 && (await ev(() => localStorage.getItem('poxel_token'))) === token1);

  // 5. Loading the single-player save: the items are gone there as well
  await page.click('#btn-open-load');
  await sleep(300);
  await page.click(`.save-slot[data-slot="${SLOT}"]`);
  await sleep(4000);
  check('single-player save loads without the lost items', (await invOf()) === '', await invOf());
  info(`carried: ${spItems}`);
} catch (e) {
  check('suite completed without a script error', false, e.message);
} finally {
  await browser.close();
}
finish();
