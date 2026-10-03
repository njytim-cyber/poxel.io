// Two players join through a public tunnel link (the way friends do): prefilled address, join, chat.
// Usage: node tests/e2e/tunnel.mjs https://<random>.trycloudflare.com
import { OUT, launch, sleep, suite, uniqueName } from './lib.mjs';
const base = process.argv[2];
if (!base) { console.error('Usage: node tests/e2e/tunnel.mjs <tunnel-url>'); process.exit(2); }
const browser = await launch({ viewport: { width: 960, height: 600 } });
const { check, info, watch, finish } = suite('tunnel');

async function join(name) {
  const page = await (await browser.createBrowserContext()).newPage();
  watch(page, name);
  const t0 = Date.now();
  await page.goto(`${base.replace(/\/$/, '')}/riventale/`, { waitUntil: 'load' });
  info(`${name} page load ${Date.now() - t0}ms`);
  await sleep(1500);
  await page.click('#btn-multiplayer');
  await sleep(300);
  const prefilled = await page.$eval('#mp-url', el => el.value);
  check(`${name}: server address prefilled from link`, prefilled.startsWith('wss://'), prefilled);
  await page.$eval('#mp-name', (el, n) => { el.value = n; }, name);
  await page.click('#btn-connect');
  await sleep(5000);
  const inGame = await page.$eval('#main-menu', el => el.style.display === 'none');
  check(`${name}: joined`, inGame, await page.$eval('#mp-status', el => el.textContent));
  return page;
}

try {
  const A = await join(uniqueName('Alice'));
  const B = await join(uniqueName('Bob'));
  await sleep(2000);
  const lines = await A.$$eval('.chat-line', ls => ls.map(l => l.textContent));
  check('Alice sees "Bob joined"', lines.some(l => l.includes('joined the game') && l.startsWith('Bob')), JSON.stringify(lines));
  // Bob chats through the UI
  await B.keyboard.press('KeyT');
  await sleep(300);
  await B.keyboard.type('hello through the tunnel');
  await B.keyboard.press('Enter');
  await sleep(1500);
  const lines2 = await A.$$eval('.chat-line', ls => ls.map(l => l.textContent));
  check('chat through tunnel', lines2.some(l => l.includes('hello through the tunnel')));
  await A.keyboard.press('F3');
  await sleep(6000);
  info('Alice F3: ' + (await A.$eval('#debug', el => el.innerText)).replace(/\n/g, ' | '));
  await A.screenshot({ path: `${OUT}/tunnel-alice.png` });
} catch (e) {
  check('suite completed without a script error', false, e.message);
} finally {
  await browser.close();
}
finish();
