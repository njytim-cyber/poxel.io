// Banners and dyes, claim stones, moonstone orbs, robot squads and the (secret) Frost World
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, creativeCodeHash, type Storage, type WorldSave, type PlayerSave } from '../../server/core/game.ts';
import { BLOCK_ID, FROST_PORTAL, COLORS } from '../../shared/blocks.ts';
import { checkCraftingRecipe, recipes } from '../../shared/recipes.ts';
import { isFrost, generateFrostChunk, nearestShrine, findFrostPortal } from '../../shared/frost.ts';
import { generateChunkData, idx } from '../../shared/worldgen.ts';
import type { ServerMsg } from '../../shared/protocol.ts';

const TEST_CODE = creativeCodeHash('1234');

function memoryStorage(world: WorldSave | null = null) {
  const s = { world, players: {} as Record<string, PlayerSave> };
  const storage: Storage = {
    loadWorld: () => s.world, saveWorld: w => { s.world = w; },
    loadPlayer: n => s.players[n] || null, savePlayer: (n, p) => { s.players[n] = p; }, deletePlayer: n => { delete s.players[n]; },
  };
  return { s, storage };
}
function fakeConn() {
  const got: ServerMsg[] = [];
  return { got, conn: { send: (m: ServerMsg) => { got.push(m); }, close: () => {} } };
}
const hello = (name: string) => ({ t: 'hello', v: 2, name, look: {}, token: 'tok-' + name });
const tick = (g: Game, n: number) => { for (let i = 0; i < n; i++) g.tick(0.05); };
const chats = (got: ServerMsg[]) => got.filter(m => m.t === 'chat').map(m => (m as any).text as string);
const toasts = (got: ServerMsg[]) => got.filter(m => m.t === 'toast').map(m => (m as any).text as string);

// A flat stone floor at height y with clear air above, around (x, z)
function flat(g: Game, x: number, y: number, z: number, r = 6) {
  const w = (g as any).world;
  for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
    w.set(x + dx, y - 1, z + dz, BLOCK_ID.stone);
    for (let dy = 0; dy < 8; dy++) w.set(x + dx, y + dy, z + dz, 0);
  }
}
function stand(p: any, x: number, y: number, z: number) { p.body.pos.x = x + 0.5; p.body.pos.y = y; p.body.pos.z = z + 0.5; }
function hold(p: any, type: string, count = 1) { p.inv.slots[p.inv.selected] = { type, count }; }
const place = (g: Game, p: any, x: number, y: number, z: number, facing = 0) => g.handle(p, { t: 'place', x, y, z, nx: 0, ny: 1, nz: 0, facing } as any);
const dig = (g: Game, p: any, x: number, y: number, z: number) => { p.lastDig = -99; g.handle(p, { t: 'dig', x, y, z } as any); };

test('dyes mix, wool can be dyed any colour, and every colour has a banner', () => {
  const grid = (a: string, b: string) => checkCraftingRecipe([a, b, null, null], 2);
  assert.deepEqual(grid('red_dye', 'yellow_dye'), { type: 'orange_dye', count: 2 });
  assert.deepEqual(grid('yellow_dye', 'red_dye'), { type: 'orange_dye', count: 2 });
  assert.deepEqual(grid('red_wool', 'cyan_dye'), { type: 'cyan_wool', count: 1 });
  assert.deepEqual(grid('purple_wool', 'white_dye'), { type: 'wool', count: 1 });
  for (const c of COLORS) assert.ok(recipes.some(r => r.result.type === `${c}_banner`), `${c} banner`);
  const w = 'pink_wool';
  assert.deepEqual(checkCraftingRecipe([w, w, w, w, w, w, null, 'stick', null], 3), { type: 'pink_banner', count: 1 });
});

test('a banner faces whoever placed it; placing next to it (or a torch) never replaces it', () => {
  const { storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 3 });
  const { got, conn } = fakeConn();
  const p = g.join(conn, hello('Flag'))!;
  const w = (g as any).world;
  const x = 40, y = 30, z = 40;
  flat(g, x, y, z); stand(p, x, y, z - 3);
  hold(p, 'red_banner');
  place(g, p, x, y, z, 2);
  assert.equal(w.get(x, y, z), BLOCK_ID.red_banner);
  assert.equal(w.facing.get(`${x},${y},${z}`), 2);
  assert.ok(got.some(m => m.t === 'achievements' && (m as any).unlocked === 'banner'));
  hold(p, 'dirt', 5);
  place(g, p, x, y, z);
  assert.equal(w.get(x, y, z), BLOCK_ID.red_banner, 'still a banner');
  assert.equal(p.inv.slots[p.inv.selected].count, 5, 'no dirt used');
  // Breaking the block under it drops it
  dig(g, p, x, y - 1, z);
  assert.equal(w.get(x, y, z), 0);
  assert.ok([...(g as any).items.values()].some((it: any) => it.type === 'red_banner'));
});

test('claim stones: only the owner and trusted friends build, open chests, or take the stone', () => {
  const { s, storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 3, maxPlayers: 8 });
  const a = g.join(fakeConn().conn, hello('Owner'))!;
  const { got: bGot, conn: bConn } = fakeConn();
  const b = g.join(bConn, hello('Guest'))!;
  const w = (g as any).world;
  const x = 300, y = 30, z = 300;
  flat(g, x, y, z, 8);
  stand(a, x, y, z - 2); stand(b, x + 2, y, z - 2);
  hold(a, 'claim_stone', 3);
  place(g, a, x, y, z);
  assert.equal(w.get(x, y, z), BLOCK_ID.claim_stone);
  // The guest can't dig, place or open a chest here
  w.set(x + 3, y, z, BLOCK_ID.chest);
  dig(g, b, x + 1, y - 1, z);
  assert.equal(w.get(x + 1, y - 1, z), BLOCK_ID.stone, 'dig refused');
  assert.ok(toasts(bGot).some(t => t.includes('belongs to Owner')));
  hold(b, 'dirt', 4);
  place(g, b, x + 1, y, z + 1);
  assert.equal(w.get(x + 1, y, z + 1), 0, 'place refused');
  bGot.length = 0;
  g.handle(b, { t: 'open', x: x + 3, y, z } as any);
  assert.ok(bGot.some(m => m.t === 'screen' && (m as any).mode === null), 'chest refused');
  // Trusted: now they can (but still can't take the claim stone)
  g.handle(a, { t: 'chat', text: '/trust guest' } as any);
  dig(g, b, x + 1, y - 1, z);
  assert.equal(w.get(x + 1, y - 1, z), 0, 'trusted guest digs');
  dig(g, b, x, y, z);
  assert.equal(w.get(x, y, z), BLOCK_ID.claim_stone, 'only the owner takes the stone');
  // Saved and loaded
  g.saveAll(true);
  assert.equal(s.world!.claims![`${x},${y},${z}`], 'Owner');
  assert.deepEqual(s.world!.trust!.owner, ['guest']);
  const g2 = new Game(storage, { creativeCode: TEST_CODE, maxPlayers: 8 });
  assert.equal((g2 as any).claims.get(`${x},${y},${z}`), 'Owner');
  // Untrusted again, then the owner removes the claim
  g.handle(a, { t: 'chat', text: '/untrust Guest' } as any);
  dig(g, b, x + 2, y - 1, z);
  assert.equal(w.get(x + 2, y - 1, z), BLOCK_ID.stone);
  dig(g, a, x, y, z);
  assert.equal(w.get(x, y, z), 0);
  dig(g, b, x + 2, y - 1, z);
  assert.equal(w.get(x + 2, y - 1, z), 0, 'open land again');
});

test('claims: not at the world spawn, not overlapping a neighbour, and a few per player', () => {
  const { storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 3, maxPlayers: 8 });
  const { got, conn } = fakeConn();
  const a = g.join(conn, hello('Lander'))!;
  const b = g.join(fakeConn().conn, hello('Other'))!;
  const w = (g as any).world;
  const sp = (g as any).spawnPoint;
  const tryClaim = (p: any, x: number, z: number) => { const y = 40; flat(g, x, y, z, 3); stand(p, x, y, z - 2); hold(p, 'claim_stone'); place(g, p, x, y, z); return w.get(x, y, z) === BLOCK_ID.claim_stone; };
  assert.equal(tryClaim(a, Math.floor(sp[0]) + 5, Math.floor(sp[2]) + 5), false, 'spawn is free for all');
  assert.ok(chats(got).some(t => t.includes('world spawn')));
  assert.ok(tryClaim(b, 1000, 1000));
  assert.equal(tryClaim(a, 1020, 1000), false, 'overlaps Other');
  assert.ok(tryClaim(a, 2000, 0)); assert.ok(tryClaim(a, 2100, 0)); assert.ok(tryClaim(a, 2200, 0));
  assert.equal(tryClaim(a, 2300, 0), false, 'three claims each');
});

test('moonstone orb: back to where you died, or to a friend who says yes', () => {
  const { storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 3, maxPlayers: 8 });
  const { got: aGot, conn: aConn } = fakeConn();
  const a = g.join(aConn, hello('Traveller'))!;
  const { got: bGot, conn: bConn } = fakeConn();
  const b = g.join(bConn, hello('Friend'))!;
  flat(g, 500, 30, 500); stand(b, 500, 30, 500);
  // Where you died
  a.lastDeath = [123.5, 60, 456.5];
  hold(a, 'moonstone_orb', 3);
  g.handle(a, { t: 'orb' } as any);
  const menu = aGot.find(m => m.t === 'orbmenu') as any;
  assert.deepEqual(menu.players, ['Friend']);
  assert.equal(menu.death, true);
  g.handle(a, { t: 'orbgo', to: 'death' } as any);
  assert.ok(Math.abs(a.body.pos.x - 123.5) < 0.01 && Math.abs(a.body.pos.z - 456.5) < 0.01);
  assert.equal(a.inv.slots[a.inv.selected].count, 2, 'one orb used');
  assert.ok(aGot.some(m => m.t === 'achievements' && (m as any).unlocked === 'orb'));
  // A friend: asked first; no means no
  (a as any).portalCd = 0;
  g.handle(a, { t: 'orbgo', to: 'player', name: 'friend' } as any);
  assert.ok(bGot.some(m => m.t === 'tpask' && (m as any).from === 'Traveller'));
  g.handle(b, { t: 'chat', text: '/tpdeny' } as any);
  assert.ok(Math.abs(a.body.pos.x - 123.5) < 0.01, 'stayed put');
  assert.equal(a.inv.slots[a.inv.selected].count, 2);
  g.handle(a, { t: 'orbgo', to: 'player', name: 'Friend' } as any);
  g.handle(b, { t: 'tpreply', from: 'Traveller', accept: true } as any);
  assert.ok(Math.hypot(a.body.pos.x - b.body.pos.x, a.body.pos.z - b.body.pos.z) < 4, 'next to the friend');
  assert.equal(a.inv.slots[a.inv.selected].count, 1);
  // An answer to nobody's request does nothing
  g.handle(b, { t: 'tpreply', from: 'Traveller', accept: true } as any);
  assert.equal(a.inv.slots[a.inv.selected].count, 1);
});

test('robot squads: guard stays at its post, follow comes along, collect fetches items; orders are saved', () => {
  const { s, storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 3, maxPlayers: 8 });
  const { got, conn } = fakeConn();
  const p = g.join(conn, hello('Boss'))!;
  const x = 700, y = 30, z = 700;
  flat(g, x, y, z, 30);
  stand(p, x, y, z);
  const pets = [0, 1].map(i => { const m = (g as any).spawnMob('robot', x + 2 + i, y, z); m.owner = p.name; return m; });
  g.handle(p, { t: 'squad', order: 'guard', eid: pets[0].eid } as any);
  assert.equal(pets[0].order, 'guard');
  assert.ok(got.some(m => m.t === 'squad' && (m as any).list.length === 2));
  assert.ok(got.some(m => m.t === 'achievements' && (m as any).unlocked === 'squad'));
  // Walk 28 blocks away: the follower is brought along, the guard stays
  stand(p, x + 28, y, z);
  tick(g, 40);
  assert.ok(Math.abs(pets[1].body.pos.x - p.body.pos.x) < 6, 'follower came');
  assert.ok(Math.abs(pets[0].body.pos.x - x) < 4, 'guard stayed');
  // Collect: a dropped item is fetched and handed over
  g.handle(p, { t: 'chat', text: '/robots collect' } as any);
  assert.equal(pets[0].order, 'collect');
  const before = p.inv.slots.filter(Boolean).length;
  g.spawnItem('diamond', 2, x + 28, y + 0.2, z + 9, { x: 0, y: 0, z: 0 });
  tick(g, 400);
  assert.ok(p.inv.slots.some(st => st?.type === 'diamond' && st.count === 2), 'diamonds delivered');
  assert.ok(p.inv.slots.filter(Boolean).length > before);
  // Saved with the player: guard post and order
  g.handle(p, { t: 'squad', order: 'guard' } as any);
  g.saveAll(true);
  const saved = s.players.Boss.pets as any[];
  assert.equal(saved.length, 2);
  assert.ok(saved.every(pt => pt.order === 'guard' && Array.isArray(pt.guard)));
});

test('the secret Frost World: a moonstone frame filled with robot eyes becomes a portal there and back', () => {
  const { storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 7, maxPlayers: 8 });
  const { got, conn } = fakeConn();
  const p = g.join(conn, hello('Explorer'))!;
  const w = (g as any).world;
  const x = 900, y = 30, z = 900;
  flat(g, x, y, z, 6);
  // Frame along x: bottom row y, hole x..x+1 by y+1..y+3, top row y+4 (corners left out)
  for (const i of [0, 1]) { w.set(x + i, y, z, BLOCK_ID.moonstone_block); w.set(x + i, y + 4, z, BLOCK_ID.moonstone_block); }
  for (let j = 1; j <= 3; j++) { w.set(x - 1, y + j, z, BLOCK_ID.moonstone_block); w.set(x + 2, y + j, z, BLOCK_ID.moonstone_block); }
  for (const [i, j] of [[0, 1], [1, 1], [0, 2], [1, 2], [0, 3]]) w.set(x + i, y + j, z, BLOCK_ID.robot_eye);
  assert.equal(findFrostPortal(w.get, x, y + 1, z, BLOCK_ID.robot_eye), null, 'five eyes are not enough');
  stand(p, x, y, z + 3);
  hold(p, 'robot_eye');
  place(g, p, x + 1, y + 3, z);
  for (const [i, j] of [[0, 1], [1, 1], [0, 2], [1, 2], [0, 3], [1, 3]]) assert.equal(w.get(x + i, y + j, z), FROST_PORTAL);
  // Step in: off to the Frost World, beside a return portal
  stand(p, x, y + 1, z); (p as any).body.pos.z = z + 0.5;
  tick(g, 2);
  assert.ok(isFrost(p.body.pos.x), `in the Frost World (x ${p.body.pos.x})`);
  assert.ok(got.some(m => m.t === 'achievements' && (m as any).unlocked === 'frost'));
  let near = 0;
  for (let dx = -12; dx <= 12; dx++) for (let dz = -12; dz <= 12; dz++) for (let dy = -6; dy <= 6; dy++) if (w.get(Math.floor(p.body.pos.x) + dx, Math.floor(p.body.pos.y) + dy, Math.floor(p.body.pos.z) + dz) === FROST_PORTAL) near++;
  assert.equal(near, 6, 'a return portal was built');
  // Back again through it
  (p as any).portalCd = 0;
  const back = [...Array(25).keys()].flatMap(dx => [...Array(25).keys()].flatMap(dz => [...Array(13).keys()].map(dy => [Math.floor(p.body.pos.x) + dx - 12, Math.floor(p.body.pos.y) + dy - 6, Math.floor(p.body.pos.z) + dz - 12]))).find(([a, b, c]) => w.get(a, b, c) === FROST_PORTAL)!;
  p.body.pos.x = back[0] + 0.5; p.body.pos.y = back[1]; p.body.pos.z = back[2] + 0.5;
  tick(g, 2);
  assert.ok(!isFrost(p.body.pos.x) && Math.abs(p.body.pos.x - x) < 12, 'home again, beside the first portal');
  // Breaking the frame puts the portal out
  p.lastDig = -99; stand(p, x + 3, y, z + 2);
  hold(p, 'diamond_pickaxe');
  (p as any).lastDig = -99;
  tick(g, 200); // mining time
  g.handle(p, { t: 'dig', x: x + 2, y: y + 2, z } as any);
  assert.equal(w.get(x + 2, y + 2, z), 0);
  assert.equal(w.get(x, y + 1, z), 0, 'portal out');
});

test('Frost World terrain: snow over permafrost, glacite deep down, a shrine for the Wraith', () => {
  const seed = 11;
  const cx = -100000 / 16;
  let snow = 0, permafrost = 0, glacite = 0;
  for (let i = 0; i < 6; i++) {
    const d = generateFrostChunk(cx + i, i, seed);
    for (let k = 0; k < d.length; k++) { if (d[k] === BLOCK_ID.snow_block) snow++; else if (d[k] === BLOCK_ID.permafrost) permafrost++; else if (d[k] === BLOCK_ID.glacite_ore) glacite++; }
  }
  assert.ok(snow > 500 && permafrost > 10000 && glacite > 0, `snow ${snow}, permafrost ${permafrost}, glacite ${glacite}`);
  assert.deepEqual(generateChunkData(cx, 0, seed), generateFrostChunk(cx, 0, seed), 'the world generator sends that strip here');
  const s = nearestShrine(-100000, 0, seed)!;
  const d = generateChunkData(Math.floor(s.x / 16), Math.floor(s.z / 16), seed);
  assert.equal(d[idx(((s.x % 16) + 16) % 16, s.y - 1, ((s.z % 16) + 16) % 16)], BLOCK_ID.frost_shrine);
});

test('the Frost Wraith: rises at its shrine, ice beams slow you (not with a Frost Heart), drops glacite', () => {
  const { storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 11, maxPlayers: 8, difficulty: 'easy' });
  const { got, conn } = fakeConn();
  const p = g.join(conn, hello('Hunter'))!;
  const s = nearestShrine(-100000, 0, 11)!;
  stand(p, s.x + 6, s.y, s.z);
  tick(g, 30);
  const wraith = [...(g as any).mobs.values()].find((m: any) => m.kind === 'frost_wraith');
  assert.ok(wraith, 'it woke');
  assert.ok(chats(got).some(t => t.includes('Frost Wraith rises')));
  assert.ok(got.some(m => m.t === 'boss' && (m as any).name === 'Frost Wraith'));
  // Its beam slows
  (g as any).slowPlayer(p, 3);
  assert.ok(got.some(m => m.t === 'slow'));
  got.length = 0;
  p.slowT = 0;
  p.inv.slots[60] = { type: 'frost_heart', count: 1 };
  (g as any).slowPlayer(p, 3);
  assert.ok(!got.some(m => m.t === 'slow'), 'a Frost Heart keeps the cold out');
  // A glacite sword chills what it hits
  p.inv.slots[p.inv.selected] = { type: 'glacite_sword', count: 1 };
  const z = (g as any).spawnMob('zombie', p.body.pos.x + 1.5, p.body.pos.y, p.body.pos.z);
  g.handle(p, { t: 'attack', eid: z.eid } as any);
  assert.ok(z.slowT > 0, 'chilled');
  // Defeated: glacite, the achievement, and it stays down for 30 minutes
  wraith.health = 0; wraith.dying = 0;
  tick(g, 30);
  assert.ok([...(g as any).items.values()].some((it: any) => it.type === 'glacite'));
  assert.ok(got.some(m => m.t === 'achievements' && (m as any).unlocked === 'wraith'));
  tick(g, 60);
  assert.ok(![...(g as any).mobs.values()].some((m: any) => m.kind === 'frost_wraith'));
});

test('generated Frost World chunks match between calls (deterministic)', () => {
  const a = generateFrostChunk(-6250, 3, 99), b = generateFrostChunk(-6250, 3, 99);
  assert.deepEqual(a, b);
  assert.ok(isFrost(-100000) && !isFrost(0) && !isFrost(100000));
});

test('review fixes: renaming keeps your land; no return portals on others\' land; one teleport request at a time', () => {
  const { storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 7, maxPlayers: 8 });
  const w = (g as any).world;
  // Renaming: the claims and trust list go with the new name, and the old name gets nothing
  const a = g.join(fakeConn().conn, hello('Tim'))!;
  const x = 1500, y = 30, z = 1500;
  flat(g, x, y, z); stand(a, x, y, z - 2); hold(a, 'claim_stone');
  place(g, a, x, y, z);
  g.handle(a, { t: 'chat', text: '/trust Pal' } as any);
  g.leave(a);
  const renamed = g.join(fakeConn().conn, { ...hello('Tim'), name: 'Tom', prevName: 'Tim' } as any)!;
  assert.equal(renamed.name, 'Tom');
  assert.equal((g as any).claims.get(`${x},${y},${z}`), 'Tom');
  assert.ok((g as any).trust.get('tom').has('pal'));
  const impostor = g.join(fakeConn().conn, { ...hello('Tim'), token: 'someone-else' } as any)!;
  stand(impostor, x + 2, y, z - 2);
  dig(g, impostor, x + 1, y - 1, z);
  assert.equal(w.get(x + 1, y - 1, z), BLOCK_ID.stone, 'the new "Tim" cannot build there');

  // A return portal is never built inside someone else's claim
  const dest = { x: x - 100000, z };
  const owner = g.join(fakeConn().conn, hello('FrostOwner'))!;
  const cx = dest.x, cz = dest.z, cy = w.surfaceHeight(cx, cz) + 1;
  stand(owner, cx, cy, cz - 2); hold(owner, 'claim_stone');
  w.set(cx, cy, cz, 0); w.set(cx, cy - 1, cz, BLOCK_ID.stone);
  place(g, owner, cx, cy, cz);
  assert.equal(w.get(cx, cy, cz), BLOCK_ID.claim_stone);
  const traveller = g.join(fakeConn().conn, hello('Visitor'))!;
  stand(traveller, x + 0.5, y, z + 0.5);
  (g as any).frostTravel(traveller);
  let inClaim = 0;
  for (let dx = -16; dx <= 16; dx++) for (let dz = -16; dz <= 16; dz++) for (let dy = -10; dy <= 10; dy++) if (w.get(cx + dx, cy + dy, cz + dz) === BLOCK_ID.frost_frame) inClaim++;
  assert.equal(inClaim, 0, 'no frame built on FrostOwner\'s land');

  // Teleport requests: one at a time per player
  const { got: bGot, conn: bConn } = fakeConn();
  const b = g.join(bConn, hello('Target'))!;
  hold(renamed, 'moonstone_orb', 2);
  for (let i = 0; i < 5; i++) g.handle(renamed, { t: 'orbgo', to: 'player', name: 'Target' } as any);
  assert.equal(bGot.filter(m => m.t === 'tpask').length, 1);
  void b;
});

test('review fixes: shrines and portals cannot be broken; portals only light near the world\'s middle', () => {
  const { storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 11, maxPlayers: 8, ops: ['*'] });
  const { got, conn } = fakeConn();
  const p = g.join(conn, hello('Breaker'))!;
  const w = (g as any).world;
  g.handle(p, { t: 'chat', text: '/gamemode creative 1234' } as any);
  const s = nearestShrine(-100000, 0, 11)!;
  w.get(s.x, s.y, s.z);
  stand(p, s.x, s.y, s.z + 2);
  dig(g, p, s.x, s.y - 1, s.z);
  assert.equal(w.get(s.x, s.y - 1, s.z), BLOCK_ID.frost_shrine, 'creative cannot break the shrine');
  // A portal far out in the Overworld stays dark
  const x = 50000, y = 30, z = 0;
  flat(g, x, y, z, 6);
  for (const i of [0, 1]) { w.set(x + i, y, z, BLOCK_ID.moonstone_block); w.set(x + i, y + 4, z, BLOCK_ID.moonstone_block); }
  for (let j = 1; j <= 3; j++) { w.set(x - 1, y + j, z, BLOCK_ID.moonstone_block); w.set(x + 2, y + j, z, BLOCK_ID.moonstone_block); }
  for (const [i, j] of [[0, 1], [1, 1], [0, 2], [1, 2], [0, 3]]) w.set(x + i, y + j, z, BLOCK_ID.robot_eye);
  stand(p, x, y, z + 3); hold(p, 'robot_eye');
  place(g, p, x + 1, y + 3, z);
  assert.equal(w.get(x, y + 1, z), BLOCK_ID.robot_eye, 'no portal');
  assert.ok(chats(got).some(t => t.includes('stay dark')));
});
