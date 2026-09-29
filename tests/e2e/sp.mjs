// Single player smoke test: start, walk, dig + pickup, chat, inventory, save, Save & Quit + Load.
import { OUT, launch, openGame, sleep, suite } from './lib.mjs';
const browser = await launch();
const page = await openGame(browser);
const { check, info, watch, finish } = suite('sp');
watch(page);
const ev = (fn, ...a) => page.evaluate(fn, ...a);

try {
  await page.screenshot({ path: `${OUT}/sp-menu.png` });
  await ev(() => { window.poxel.deleteSave(4); window.poxel.startSingle(12345); });
  await sleep(4000);
  await ev(() => window.poxel.ui.forcePlaying());
  await page.keyboard.press('F3');
  await sleep(1500);
  check('single player started', await ev(() => window.poxel.ui.state === 'playing'));
  await page.screenshot({ path: `${OUT}/sp-playing.png` });

  // walk
  const p0 = await ev(() => ({ ...window.poxel.body.pos }));
  await page.keyboard.down('KeyW'); await sleep(1500); await page.keyboard.up('KeyW');
  const p1 = await ev(() => ({ ...window.poxel.body.pos }));
  check('walking works', Math.hypot(p1.x - p0.x, p1.z - p0.z) > 3, `moved ${Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(1)}`);

  // mine block under feet with hand -> server drop -> pickup
  // (the first hit can be a plant such as tall grass, which drops nothing, so dig until something drops)
  for (let k = 0; k < 3 && !(await ev(() => window.poxel.inv.some(Boolean))); k++) {
    // Stand in the middle of the block, so the one being dug is the one underfoot and we drop onto the drop
    await ev(() => { const b = window.poxel.body.pos; window.poxel.tp(Math.floor(b.x) + 0.5, b.y, Math.floor(b.z) + 0.5); });
    await sleep(300);
    await ev(() => window.poxel.setYawPitch(0, -1.57));
    await sleep(200);
    const hit = await ev(() => window.poxel.lookTarget());
    await page.mouse.down(); await sleep(1600); await page.mouse.up();
    await sleep(2500);
    info(`dig ${k}: aimed ${hit ? `${hit.id}@${hit.x},${hit.y},${hit.z}` : 'nothing'} -> ${hit ? await ev(h => window.poxel.getBlock(h.x, h.y, h.z), hit) : '-'}; at ${JSON.stringify(await ev(() => { const b = window.poxel.body; return [b.pos.x.toFixed(2), b.pos.y.toFixed(2), b.pos.z.toFixed(2), b.inWater]; }))}`);
  }
  const inv = await ev(() => window.poxel.inv.filter(Boolean));
  check('dig -> server drop -> pickup', inv.length > 0, JSON.stringify(inv));

  await ev(() => window.poxel.send({ t: 'chat', text: 'hi from sp' }));
  await sleep(300);
  check('chat round-trip', await ev(() => [...document.querySelectorAll('.chat-line')].some(l => l.textContent.includes('hi from sp'))));
  await page.keyboard.press('Tab');
  await sleep(500);
  check('inventory opens', await ev(() => window.poxel.ui.state === 'screen'));
  await page.screenshot({ path: `${OUT}/sp-inventory.png` });
  await page.keyboard.press('Tab');
  await sleep(300);

  // save & reload
  const saved = await ev(async () => await window.poxel.saveNow());
  check('local save produced', saved);
  check('save written to slot', await ev(() => !!window.poxel.readSave(4)?.world));
  // Save & Quit then Load: the inventory must come back
  const before = await ev(() => JSON.stringify(window.poxel.inv.filter(Boolean)));
  // A save left in localStorage by an older version (slot 3) must move to IndexedDB on the next start
  await ev(() => { window.poxel.deleteSave(3); localStorage.setItem('poxel_save_3', JSON.stringify({ v: 3, ...window.poxel.readSave(4) })); localStorage.setItem('poxel_meta_3', 'old'); });
  await ev(() => window.poxel.ui.pause());
  await sleep(300);
  // View distance slider in the pause menu (remembered across reloads; checked after Load below)
  await ev(() => { const s = document.getElementById('view-distance'); s.value = '6'; s.dispatchEvent(new Event('input')); });
  check('view distance slider applies', await ev(() => document.getElementById('view-distance-value').textContent === '6 chunks'));
  await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.click('#btn-save-quit')]);
  await sleep(2000);
  check('old localStorage save moved to IndexedDB', await ev(() => !!window.poxel.readSave(3)?.world && !localStorage.getItem('poxel_save_3')));
  await ev(() => window.poxel.deleteSave(3));
  await page.click('#btn-open-load');
  await sleep(300);
  await page.click('.save-slot[data-slot="4"]');
  await sleep(4000);
  const afterLoad = await ev(() => JSON.stringify(window.poxel.inv.filter(Boolean)));
  check('Save & Quit, then Load restores inventory', before === afterLoad && before !== '[]', `${before} vs ${afterLoad}`);
  check('view distance remembered after reload', await ev(() => document.getElementById('view-distance').value === '6'));
  await ev(() => { const s = document.getElementById('view-distance'); s.value = '4'; s.dispatchEvent(new Event('input')); });
  info((await ev(() => document.getElementById('debug').innerText)).replace(/\n/g, ' | '));
} catch (e) {
  check('suite completed without a script error', false, e.message);
} finally {
  await browser.close();
}
finish();
