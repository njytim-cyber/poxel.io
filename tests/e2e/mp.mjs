// Two players on one server: visibility, movement sync, edit propagation, rejection of illegal
// placing, chat, PvP and leaving.
// Usage: node tests/e2e/mp.mjs [ws-url]
import { OUT, WS, GPU_ARGS, NO_THROTTLE_ARGS, launch, openGame, sleep, suite, uniqueName } from './lib.mjs';
const url = process.argv[2] || WS;
const browser = await launch({ args: [...GPU_ARGS, ...NO_THROTTLE_ARGS], viewport: { width: 960, height: 600 } });
const { check, info, watch, finish } = suite('mp');

async function client(name) {
  const page = await openGame(browser, { ctx: true }); // separate localStorage per player
  watch(page, name);
  await page.evaluate((u, n) => window.poxel.connect(u, n), url, name);
  await sleep(3000);
  await page.evaluate(() => window.poxel.ui.forcePlaying());
  return page;
}

try {
  const A = await client(uniqueName('Alice'));
  const B = await client(uniqueName('Bob'));
  await sleep(1500);
  const evA = (f, ...a) => A.evaluate(f, ...a), evB = (f, ...a) => B.evaluate(f, ...a);

  check('both online', (await evA(() => window.poxel.online().length)) === 2, JSON.stringify(await evA(() => window.poxel.online())));
  // Put Bob 3 blocks in front of Alice, facing each other
  const pa = await evA(() => ({ ...window.poxel.body.pos }));
  await evB(p => window.poxel.glide(p.x, p.y + 0.5, p.z - 3), pa); await evB(() => window.poxel.setYawPitch(Math.PI, 0));
  await evA(() => window.poxel.setYawPitch(0, -0.25));
  await sleep(1500);
  check('Alice sees Bob', (await evA(() => window.poxel.counts().players)) === 1);
  info(`Bob after walking over: hp ${await evB(() => window.poxel.health())} at ${JSON.stringify(await evB(() => window.poxel.body.pos))}`);
  await A.screenshot({ path: `${OUT}/mp-alice-sees-bob.png` });

  // Bob walks
  await B.keyboard.down('KeyD'); await sleep(1200); await B.keyboard.up('KeyD');
  await sleep(500);
  const bPos = await evB(() => ({ ...window.poxel.body.pos }));
  check('Bob moved', Math.abs(bPos.x - pa.x) > 2, `bob x ${bPos.x.toFixed(1)} vs ${pa.x.toFixed(1)}`);

  // Alice has no blocks in her inventory, so the server must reject her place: Bob should NOT see a block
  await evA(() => { window.poxel.send({ t: 'chat', text: 'placing' }); });
  const target = await evA(() => { const b = window.poxel.body.pos; return { x: Math.floor(b.x) + 1, y: Math.floor(b.y), z: Math.floor(b.z) }; });
  const bobBefore = await evB(t => window.poxel.getBlock(t.x, t.y, t.z), target);
  await evA(t => { window.poxel.send({ t: 'place', x: t.x, y: t.y, z: t.z, nx: 0, ny: 1, nz: 0, facing: 0 }); }, target);
  await sleep(600);
  const bobSees = await evB(t => window.poxel.getBlock(t.x, t.y, t.z), target);
  check('server rejects placing without the item', bobSees === bobBefore, `block ${bobBefore} -> ${bobSees}`);

  // Alice digs the block under her; Bob sees the hole
  const under = await evA(() => { const b = window.poxel.body.pos; return { x: Math.floor(b.x), y: Math.floor(b.y) - 1, z: Math.floor(b.z) }; });
  const before = await evB(t => window.poxel.getBlock(t.x, t.y, t.z), under);
  await evA(t => window.poxel.send({ t: 'dig', ...t }), under);
  await sleep(800);
  const after = await evB(t => window.poxel.getBlock(t.x, t.y, t.z), under);
  check("Bob sees Alice's dig", before !== 0 && after === 0, `${before} -> ${after}`);

  check('chat reaches other player', await evB(() => [...document.querySelectorAll('.chat-line')].some(l => l.textContent.includes('placing'))));

  // PvP: Alice attacks Bob
  const bobEid = await evB(() => window.poxel.online().find(p => p.name.startsWith('Bob'))?.eid);
  await Promise.all([evB(p => window.poxel.glide(p.x, p.y + 0.3, p.z - 2), pa), evA(p => window.poxel.glide(p.x, p.y + 0.3, p.z), pa)]);
  await sleep(600);
  const hp0 = await evB(() => window.poxel.health());
  info(`before PvP: Bob hp ${hp0} at ${JSON.stringify(await evB(() => window.poxel.body.pos))}, Alice at ${JSON.stringify(await evA(() => window.poxel.body.pos))}`);
  // Lowest health right after each hit (a well-fed player heals quickly between hits)
  let hp1 = hp0;
  for (let i = 0; i < 3; i++) { await evA(id => window.poxel.send({ t: 'attack', eid: id }), bobEid); await sleep(150); hp1 = Math.min(hp1, await evB(() => window.poxel.health())); await sleep(550); }
  check('PvP damage', hp1 < hp0, `${hp0} -> ${hp1}`);
  await B.screenshot({ path: `${OUT}/mp-bob-view.png` });

  // Downed and revived: Bob falls from high up, goes down (not dead), Alice holds Use on him
  const pb = await evB(() => ({ ...window.poxel.body.pos }));
  await evB(p => window.poxel.glide(p.x, p.y + 26, p.z, 6), pb);
  for (let i = 0; i < 40 && !(await evB(() => document.getElementById('downed-screen').style.display === 'flex')); i++) await sleep(150);
  check('a fatal fall in multiplayer downs you instead of killing you', await evB(() => document.getElementById('downed-screen').style.display === 'flex' && window.poxel.ui.state !== 'dead'));
  await sleep(600);
  const bobAt = await evB(() => ({ ...window.poxel.body.pos }));
  await evA(b => { const p = window.poxel.body.pos; window.poxel.glide(b.x, b.y + 0.2, b.z + 1.8); }, bobAt);
  await sleep(1200);
  await evA(b => { const p = window.poxel.body.pos; const dx = b.x - p.x, dy = b.y + 0.3 - (p.y + 1.62), dz = b.z - p.z; window.poxel.setYawPitch(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))); }, bobAt);
  await evA(() => window.poxel.ui.forcePlaying());
  await A.mouse.move(480, 300);
  await A.mouse.down({ button: 'right' }); await sleep(3800); await A.mouse.up({ button: 'right' });
  await sleep(500);
  check('a friend holding Use revives you', await evB(() => document.getElementById('downed-screen').style.display === 'none' && window.poxel.health() >= 6 && window.poxel.ui.state !== 'dead'), `hp=${await evB(() => window.poxel.health())}`);

  // Down again: a click straight away (still fighting) doesn't give up; a click after a moment does
  const pb2 = await evB(() => ({ ...window.poxel.body.pos }));
  await evB(p => window.poxel.glide(p.x, p.y + 26, p.z, 6), pb2);
  for (let i = 0; i < 40 && !(await evB(() => document.getElementById('downed-screen').style.display === 'flex')); i++) await sleep(150);
  await B.mouse.click(480, 300);
  await sleep(500);
  check('an early click while down does not give up', await evB(() => document.getElementById('downed-screen').style.display === 'flex'));
  await sleep(1500);
  await B.mouse.click(480, 300);
  for (let i = 0; i < 20 && !(await evB(() => window.poxel.ui.state === 'dead')); i++) await sleep(150);
  check('clicking while down gives up', await evB(() => window.poxel.ui.state === 'dead' && document.getElementById('downed-screen').style.display === 'none'));
  check('desktop hint says click', (await evB(() => document.querySelector('.downed-hint').textContent)) === 'Click to give up');

  // Bob disconnects -> Alice sees him leave
  await B.close();
  await sleep(1500);
  check('leave handled', (await evA(() => window.poxel.online().length)) === 1 && (await evA(() => window.poxel.counts().players)) === 0);
} catch (e) {
  check('suite completed without a script error', false, e.message);
} finally {
  await browser.close();
}
finish();
