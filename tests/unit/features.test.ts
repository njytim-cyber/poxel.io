// Banners and dyes, claim stones, moonstone orbs, robot squads and the (secret) Frost World
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, creativeCodeHash, type Storage, type WorldSave, type PlayerSave } from '../../server/core/game.ts';
import { BLOCK_ID, ELEM_PORTAL, COLORS } from '../../shared/blocks.ts';
import { checkCraftingRecipe, recipes } from '../../shared/recipes.ts';
import { isElemental, generateElementalChunk, nearestShrine, findElementalPortal, elementalBiome, SHRINE_BOSS, SHRINE_CORE } from '../../shared/elemental.ts';
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
const hello = (name: string) => ({ t: 'hello', v: 3, name, look: {}, token: 'tok-' + name });
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

// An Elemental World portal frame along x: gold along the bottom (row y), etherite along the top (row y + 4),
// obitite down the left and moonstone down the right; the hole is x..x+1 by y+1..y+3
function buildFrame(w: any, x: number, y: number, z: number, left: number = BLOCK_ID.obitite_block, right: number = BLOCK_ID.moonstone_block) {
  for (let i = -1; i <= 2; i++) { w.set(x + i, y, z, BLOCK_ID.gold_block); w.set(x + i, y + 4, z, BLOCK_ID.etherite_block); }
  for (let j = 1; j <= 3; j++) { w.set(x - 1, y + j, z, left); w.set(x + 2, y + j, z, right); }
}
// A shrine of this biome's boss
function shrineOf(biome: string, seed: number) {
  for (let i = 0; i < 900; i++) {
    const s = nearestShrine(-100000 + (i % 30) * 256, Math.floor(i / 30) * 256, seed);
    if (s && s.biome === biome) return s;
  }
  throw new Error(`no ${biome} shrine found`);
}

test('the secret Elemental World: etherite, gold, obitite and moonstone around robot eyes make a portal there and back', () => {
  const { storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 7, maxPlayers: 8 });
  const { got, conn } = fakeConn();
  const p = g.join(conn, hello('Explorer'))!;
  const w = (g as any).world;
  const x = 900, y = 30, z = 900;
  flat(g, x, y, z, 6);
  // The old all-moonstone frame no longer works
  buildFrame(w, x, y, z, BLOCK_ID.moonstone_block, BLOCK_ID.moonstone_block);
  for (const [i, j] of [[0, 1], [1, 1], [0, 2], [1, 2], [0, 3], [1, 3]]) w.set(x + i, y + j, z, BLOCK_ID.robot_eye);
  assert.equal(findElementalPortal(w.get, x, y + 1, z, BLOCK_ID.robot_eye), null, 'moonstone on both sides: no portal');
  // The right frame, with five eyes: not yet
  buildFrame(w, x, y, z);
  w.set(x + 1, y + 3, z, 0);
  assert.equal(findElementalPortal(w.get, x, y + 1, z, BLOCK_ID.robot_eye), null, 'five eyes are not enough');
  stand(p, x, y, z + 3);
  hold(p, 'robot_eye');
  place(g, p, x + 1, y + 3, z);
  for (const [i, j] of [[0, 1], [1, 1], [0, 2], [1, 2], [0, 3], [1, 3]]) assert.equal(w.get(x + i, y + j, z), ELEM_PORTAL);
  // Step in: off to the Elemental World, beside a return portal
  stand(p, x, y + 1, z);
  tick(g, 2);
  assert.ok(isElemental(p.body.pos.x), `in the Elemental World (x ${p.body.pos.x})`);
  assert.ok(got.some(m => m.t === 'achievements' && (m as any).unlocked === 'frost'));
  assert.ok(chats(got).some(t => t.includes('Elemental World (')), 'told which biome');
  let near = 0;
  for (let dx = -12; dx <= 12; dx++) for (let dz = -12; dz <= 12; dz++) for (let dy = -6; dy <= 6; dy++) if (w.get(Math.floor(p.body.pos.x) + dx, Math.floor(p.body.pos.y) + dy, Math.floor(p.body.pos.z) + dz) === ELEM_PORTAL) near++;
  assert.equal(near, 6, 'a return portal was built');
  // Back again through it
  (p as any).portalCd = 0;
  const back = [...Array(25).keys()].flatMap(dx => [...Array(25).keys()].flatMap(dz => [...Array(13).keys()].map(dy => [Math.floor(p.body.pos.x) + dx - 12, Math.floor(p.body.pos.y) + dy - 6, Math.floor(p.body.pos.z) + dz - 12]))).find(([a, b, c]) => w.get(a, b, c) === ELEM_PORTAL)!;
  p.body.pos.x = back[0] + 0.5; p.body.pos.y = back[1]; p.body.pos.z = back[2] + 0.5;
  tick(g, 2);
  assert.ok(!isElemental(p.body.pos.x) && Math.abs(p.body.pos.x - x) < 12, 'home again, beside the first portal');
  // Breaking the frame (any of its blocks) puts the portal out
  stand(p, x + 3, y, z + 2);
  hold(p, 'diamond_pickaxe');
  tick(g, 300);
  dig(g, p, x + 2, y + 2, z);
  assert.equal(w.get(x + 2, y + 2, z), 0);
  assert.equal(w.get(x, y + 1, z), 0, 'portal out');
  // Mirrored (moonstone on the left) works too, and placing a corner block last lights it
  const x2 = x + 8;
  flat(g, x2, y, z, 4);
  buildFrame(w, x2, y, z, BLOCK_ID.moonstone_block, BLOCK_ID.obitite_block);
  for (const [i, j] of [[0, 1], [1, 1], [0, 2], [1, 2], [0, 3], [1, 3]]) w.set(x2 + i, y + j, z, BLOCK_ID.robot_eye);
  w.set(x2 + 2, y + 4, z, 0);
  stand(p, x2 + 3, y, z + 2);
  hold(p, 'etherite_block');
  place(g, p, x2 + 2, y + 4, z);
  assert.equal(w.get(x2, y + 1, z), ELEM_PORTAL, 'lit by the last corner');
});

test('Elemental World terrain: four biomes, each with its own ground, and a shrine with its own boss', () => {
  const seed = 11;
  const want: Record<string, number[]> = {
    frost: [BLOCK_ID.snow_block, BLOCK_ID.permafrost], volcano: [BLOCK_ID.basalt, BLOCK_ID.volcanic_ash],
    jungle: [BLOCK_ID.jungle_wood, BLOCK_ID.moss_block], clouds: [BLOCK_ID.cloud, BLOCK_ID.skystone],
  };
  for (const biome of Object.keys(want)) {
    // A chunk well inside this biome
    let at: [number, number] | null = null;
    for (let i = 0; i < 4000 && !at; i++) {
      const x = -100000 + (i % 60) * 64, z = Math.floor(i / 60) * 64;
      if ([[0, 0], [24, 0], [0, 24], [-24, 0], [0, -24]].every(([dx, dz]) => elementalBiome(x + dx, z + dz, seed) === biome)) at = [x, z];
    }
    assert.ok(at, `found ${biome}`);
    const seen = new Set<number>();
    for (let i = -1; i <= 1; i++) for (let k = -1; k <= 1; k++) for (const id of generateElementalChunk(Math.floor(at![0] / 16) + i, Math.floor(at![1] / 16) + k, seed)) seen.add(id);
    for (const id of want[biome]) assert.ok(seen.has(id), `${biome} has block ${id}`);
    const s = shrineOf(biome, seed);
    const d = generateChunkData(Math.floor(s.x / 16), Math.floor(s.z / 16), seed);
    assert.equal(d[idx(((s.x % 16) + 16) % 16, s.y - 1, ((s.z % 16) + 16) % 16)], BLOCK_ID[SHRINE_CORE[s.biome]], `${biome} shrine core`);
  }
  assert.deepEqual(generateChunkData(-6250, 0, seed), generateElementalChunk(-6250, 0, seed), 'the world generator sends that strip here');
});

test('each biome\'s boss rises at its shrine, fights, and drops its elemental ore', () => {
  const ores: Record<string, string> = { frost: 'water_ore', volcano: 'lava_ore', jungle: 'earth_ore', clouds: 'wind_ore' };
  const ach: Record<string, string> = { frost: 'wraith', volcano: 'colossus', jungle: 'thorn', clouds: 'roc' };
  for (const biome of Object.keys(ores)) {
    const { storage } = memoryStorage();
    const g = new Game(storage, { creativeCode: TEST_CODE, seed: 11, maxPlayers: 8, difficulty: 'easy' });
    const { got, conn } = fakeConn();
    const p = g.join(conn, hello('Hunter'))!;
    const s = shrineOf(biome, 11);
    stand(p, s.x + 3, s.y, s.z + 1); // inside the ring of pillars
    tick(g, 30);
    const boss = [...(g as any).mobs.values()].find((m: any) => m.kind === SHRINE_BOSS[biome as keyof typeof SHRINE_BOSS]);
    assert.ok(boss, `${biome}: it woke`);
    assert.ok(got.some(m => m.t === 'boss' && (m as any).hp > 0), `${biome}: health bar`);
    // It attacks (keep the player alive while it does)
    const hp0 = p.health;
    let hurt = false;
    for (let i = 0; i < 400 && !hurt; i++) { g.tick(0.05); if (p.health < hp0 || p.dead || p.downed) hurt = true; if (p.downed) { p.downed = false; p.health = 20; } }
    assert.ok(hurt, `${biome}: the boss attacks`);
    boss.health = 0; boss.dying = 0;
    tick(g, 30);
    assert.ok([...(g as any).items.values()].some((it: any) => it.type === ores[biome]), `${biome}: drops ${ores[biome]}`);
    assert.ok(got.some(m => m.t === 'achievements' && (m as any).unlocked === ach[biome]), `${biome}: achievement`);
  }
});

test('the Frost Wraith\'s cold: a Frost Heart keeps it out; glacite chills what it hits', () => {
  const { storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 11, maxPlayers: 8 });
  const { got, conn } = fakeConn();
  const p = g.join(conn, hello('Cold'))!;
  (g as any).slowPlayer(p, 3);
  assert.ok(got.some(m => m.t === 'slow'));
  got.length = 0; p.slowT = 0;
  p.inv.slots[60] = { type: 'frost_heart', count: 1 };
  (g as any).slowPlayer(p, 3);
  assert.ok(!got.some(m => m.t === 'slow'), 'a Frost Heart keeps the cold out');
  p.inv.slots[p.inv.selected] = { type: 'glacite_sword', count: 1 };
  const z = (g as any).spawnMob('zombie', p.body.pos.x + 1.5, p.body.pos.y, p.body.pos.z);
  g.handle(p, { t: 'attack', eid: z.eid } as any);
  assert.ok(z.slowT > 0, 'chilled');
});

test('elemental armour: one piece per element, made with etherite; the poison sword needs every element', () => {
  const E = 'etherite';
  const grid3 = (rows: (string | null)[][]) => checkCraftingRecipe(rows.flat(), 3);
  assert.deepEqual(grid3([[E, E, E], [E, 'water_ore', E], [null, null, null]]), { type: 'water_helmet', count: 1 });
  assert.deepEqual(grid3([[E, 'lava_ore', E], [E, E, E], [E, E, E]]), { type: 'lava_chestplate', count: 1 });
  assert.deepEqual(grid3([[E, E, E], [E, 'earth_ore', E], [E, null, E]]), { type: 'earth_leggings', count: 1 });
  assert.deepEqual(grid3([[E, null, E], [E, 'wind_ore', E], [null, null, null]]), { type: 'wind_boots', count: 1 });
  assert.deepEqual(grid3([['water_ore', 'obitite', 'lava_ore'], ['earth_ore', 'obitite', 'wind_ore'], [null, 'stick', null]]), { type: 'poison_sword', count: 1 });
  assert.deepEqual(checkCraftingRecipe(['obitite', 'obitite', 'obitite', 'obitite'], 2), { type: 'obitite_block', count: 1 });
});

test('water helmet: no drowning (others drown); wind boots: no fall damage', () => {
  const { storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 3, maxPlayers: 8, difficulty: 'easy' });
  const { got, conn } = fakeConn();
  const p = g.join(conn, hello('Diver'))!;
  const w = (g as any).world;
  const x = 2600, y = 30, z = 2600;
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) { w.set(x + dx, y - 1, z + dz, BLOCK_ID.stone); for (let dy = 0; dy < 4; dy++) w.set(x + dx, y + dy, z + dz, BLOCK_ID.water); }
  stand(p, x, y, z);
  tick(g, 20 * 14);
  assert.equal(p.health, 20, 'fine for 14 seconds');
  assert.ok(got.some(m => m.t === 'air' && (m as any).air < 0.5), 'the air bar runs down');
  tick(g, 20 * 4);
  assert.ok(p.health < 20, 'then drowning');
  assert.ok(got.some(m => m.t === 'death' || m.t === 'health'));
  // With the water helmet: breathes forever
  p.health = 20; (p as any).air = 15;
  p.inv.slots[55] = { type: 'water_helmet', count: 1 };
  tick(g, 20 * 20);
  assert.equal(p.health, 20, 'water helmet: no drowning');
  // Wind boots: a long fall, no damage
  p.inv.slots[58] = { type: 'wind_boots', count: 1 };
  p.fallStart = p.body.pos.y + 30; p.flags = 0;
  g.handle(p, { t: 'move', x: p.body.pos.x, y: p.body.pos.y, z: p.body.pos.z, yaw: 0, pitch: 0, flags: 1 } as any);
  assert.equal(p.health, 20, 'wind boots: no fall damage');
});

test('lava chestplate: lava and magma can\'t hurt you, and . shoots fireballs that burn', () => {
  const { storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 3, maxPlayers: 8 });
  const p = g.join(fakeConn().conn, hello('Pyro'))!;
  const w = (g as any).world;
  const x = 3000, y = 30, z = 3000;
  flat(g, x, y, z, 12);
  stand(p, x, y, z);
  g.handle(p, { t: 'fireball', dx: 1, dy: 0, dz: 0 } as any);
  assert.equal([...(g as any).items.values()].filter((it: any) => it.type === 'fireball').length, 0, 'no chestplate, no fireball');
  p.inv.slots[56] = { type: 'lava_chestplate', count: 1 };
  p.invuln = 0;
  g.damagePlayer(p, 4, null, 'lava');
  g.damagePlayer(p, 4, null, 'fire');
  assert.equal(p.health, 20, 'lava and fire do nothing');
  const zombie = (g as any).spawnMob('zombie', x + 8.5, y, z + 0.5);
  const eyeY = y + 1.62, dy = (y + 1 - eyeY) / 8;
  g.handle(p, { t: 'fireball', dx: 1, dy, dz: 0 } as any);
  assert.equal([...(g as any).items.values()].filter((it: any) => it.type === 'fireball').length, 1, 'a fireball flies');
  for (let i = 0; i < 20 && !(zombie.fireT > 0); i++) g.tick(0.05);
  assert.ok(zombie.health <= 14 && zombie.fireT > 0, `the zombie is hit and burning (health ${zombie.health})`);
  // Standing on magma burns (without the chestplate)
  p.inv.slots[56] = null;
  w.set(x, y - 1, z, BLOCK_ID.magma_block);
  p.flags = 1; p.health = 20; p.invuln = 0;
  tick(g, 25);
  assert.ok(p.health < 20, 'magma burns');
});

test('earth leggings: 20 hearts and harder hits; the poison sword poisons (never killing a player by itself)', () => {
  const { storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 3, maxPlayers: 8, difficulty: 'easy' });
  const { got, conn } = fakeConn();
  const p = g.join(conn, hello('Earthy'))!;
  const q = g.join(fakeConn().conn, hello('Victim'))!;
  const x = 3400, y = 30, z = 3400;
  flat(g, x, y, z, 8);
  stand(p, x, y, z);
  p.inv.slots[57] = { type: 'earth_leggings', count: 1 };
  tick(g, 2);
  assert.ok(got.some(m => m.t === 'maxhp' && (m as any).max === 40), '40 health = 20 hearts');
  p.health = 30;
  for (let i = 0; i < 20 * 30; i++) g.tick(0.05);
  assert.ok(p.health > 30, `regenerates beyond 10 hearts (${p.health})`);
  // Harder knockback
  const z1 = (g as any).spawnMob('pig', x + 1.5, y, z + 0.5);
  g.handle(p, { t: 'attack', eid: z1.eid } as any);
  assert.ok(Math.abs(z1.body.vel.x) > 10, `knocked hard (${z1.body.vel.x})`);
  // Taking them off: back to 10 hearts
  p.inv.slots[57] = null;
  tick(g, 2);
  assert.ok(p.health <= 20 && got.some(m => m.t === 'maxhp' && (m as any).max === 20));
  // The poison sword
  p.inv.slots[p.inv.selected] = { type: 'poison_sword', count: 1 };
  (p as any).attackCd = 0;
  const mob = (g as any).spawnMob('cow', x - 1.5, y, z + 0.5);
  g.handle(p, { t: 'attack', eid: mob.eid } as any);
  assert.ok(mob.poisonT > 0, 'the cow is poisoned');
  stand(q, x, y, z + 1.5); q.health = 3; q.invuln = 0; (p as any).attackCd = 0;
  (g as any).poisonPlayer(q, 10);
  tick(g, 20 * 10);
  assert.equal(q.health, 1, 'poison leaves a player at half a heart');
});

test('generated Elemental World chunks match between calls (deterministic)', () => {
  const a = generateElementalChunk(-6250, 3, 99), b = generateElementalChunk(-6250, 3, 99);
  assert.deepEqual(a, b);
  assert.ok(isElemental(-100000) && !isElemental(0) && !isElemental(100000));
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
  (g as any).elementalTravel(traveller);
  let inClaim = 0;
  for (let dx = -16; dx <= 16; dx++) for (let dz = -16; dz <= 16; dz++) for (let dy = -10; dy <= 10; dy++) if (w.get(cx + dx, cy + dy, cz + dz) === BLOCK_ID.elemental_frame) inClaim++;
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
  const core = BLOCK_ID[SHRINE_CORE[s.biome]];
  w.get(s.x, s.y, s.z);
  stand(p, s.x, s.y, s.z + 2);
  dig(g, p, s.x, s.y - 1, s.z);
  assert.equal(w.get(s.x, s.y - 1, s.z), core, 'creative cannot break the shrine');
  // A portal far out in the Overworld stays dark
  const x = 50000, y = 30, z = 0;
  flat(g, x, y, z, 6);
  buildFrame(w, x, y, z);
  for (const [i, j] of [[0, 1], [1, 1], [0, 2], [1, 2], [0, 3]]) w.set(x + i, y + j, z, BLOCK_ID.robot_eye);
  stand(p, x, y, z + 3); hold(p, 'robot_eye');
  place(g, p, x + 1, y + 3, z);
  assert.equal(w.get(x, y + 1, z), BLOCK_ID.robot_eye, 'no portal');
  assert.ok(chats(got).some(t => t.includes('stay dark')));
});

test('review fixes: boss area attacks and fireballs leave downed players for their friends to revive', () => {
  const { storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 11, maxPlayers: 8 });
  const p = g.join(fakeConn().conn, hello('Downed'))!;
  const x = 4000, y = 30, z = 4000;
  flat(g, x, y, z, 8);
  stand(p, x, y, z);
  p.health = 0; (g as any).downPlayer(p, 'tempest');
  const roc = (g as any).spawnMob('tempest', x + 3, y + 4, z);
  roc.summonT = 0; roc.attackCd = 99;
  (g as any).updateElementalBoss(roc, p, 3, 0.05);
  assert.ok(p.downed && !p.dead, 'the gust does not finish them off');
  (g as any).spawnShot('fireball', { x: x - 2, y: y + 1, z: z + 0.5 }, { x: 18, y: 0, z: 0 }, roc.eid, false, 5, {});
  tick(g, 10);
  assert.ok(p.downed && !p.dead, 'nor does a fireball');
});

// A boss fight on flat ground: the boss, a player 5 blocks away, and quick access to the boss's move timers
function arena(kind: string, seed = 21) {
  const { storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed, maxPlayers: 8 });
  const { got, conn } = fakeConn();
  const p = g.join(conn, hello('Fighter'))!;
  const x = 5000, y = 30, z = 5000;
  flat(g, x, y, z, 14);
  for (let dx = -14; dx <= 14; dx++) for (let dz = -14; dz <= 14; dz++) for (let dy = 8; dy < 24; dy++) (g as any).world.set(x + dx, y + dy, z + dz, 0);
  stand(p, x + 5, y, z);
  p.invuln = 0;
  const boss = (g as any).spawnMob(kind, x + 0.5, y + (kind === 'tempest' ? 7 : kind === 'frost_wraith' ? 2.5 : 0), z + 0.5);
  // Every move waits, except the one under test
  boss.moves = { nova: 99, rain: 99, summon: 99, barrage: 99, slam: 99, eruption: 99, stomp: 99, roots: 99, spores: 99, hurricanes: 99, gust: 99 };
  boss.attackCd = 99;
  return { g, got, p, boss, x, y, z };
}
const fxs = (got: ServerMsg[], kind: string) => got.filter(m => m.t === 'fx' && (m as any).kind === kind);

test('Magma Colossus: gathers five magma balls and throws them one by one; a ball does 10 hearts without armour', () => {
  const { g, got, p, boss } = arena('magma_colossus');
  boss.moves.barrage = 0;
  tick(g, 2);
  const balls = () => [...(g as any).items.values()].filter((it: any) => it.type === 'magma_ball');
  assert.equal(balls().length, 5, 'five balls of magma');
  assert.ok(balls().every((it: any) => it.shot.heldBy === boss.eid), 'circling its head');
  assert.ok(chats(got).some(t => t.includes('gathers balls of magma')));
  tick(g, 20 * 1.6);
  const held = () => balls().filter((it: any) => it.shot.heldBy !== undefined).length;
  assert.ok(held() < 5 && held() > 0, `thrown one by one (${held()} still held)`);
  for (let i = 0; i < 20 * 6 && balls().length; i++) { g.tick(0.05); if (p.downed) { p.downed = false; p.health = 20; } }
  assert.equal(balls().length, 0, 'all thrown');
  assert.ok(fxs(got, 'explode').length >= 1, 'they explode where they land');
  // A direct hit, no armour: 20 damage (10 hearts)
  p.health = 20; p.invuln = 0; p.downed = false;
  (g as any).spawnShot('magma_ball', { x: p.body.pos.x, y: p.body.pos.y + 3, z: p.body.pos.z }, { x: 0, y: -8, z: 0 }, boss.eid, false, 20, { gravity: true, fire: 4, splash: 2 });
  tick(g, 10);
  assert.ok(p.downed || p.health === 0, `10 hearts gone (health ${p.health})`);
});

test('Thorn Guardian: its stomp hurts everything nearby and throws it about 8 blocks', () => {
  const { g, got, p, boss, x, y, z } = arena('thorn_guardian');
  const pig = (g as any).spawnMob('pig', x + 3.5, y, z + 0.5);
  boss.moves.stomp = 0;
  tick(g, 2);
  assert.ok(fxs(got, 'charge').length === 1, 'it rears up first (a warning)');
  tick(g, 20);
  assert.ok(fxs(got, 'stomp').length === 1, 'then stomps');
  const hurt = got.find(m => m.t === 'hurt' && (m as any).knock >= 20) as any;
  assert.ok(hurt && hurt.lift >= 8, 'the player is thrown up and away');
  assert.ok(p.health < 20, 'and hurt');
  assert.ok(pig.health < 10, 'mobs nearby are hurt too');
  tick(g, 30);
  assert.ok(Math.hypot(pig.body.pos.x - x, pig.body.pos.z - z) > 6, `the pig flew (${Math.hypot(pig.body.pos.x - x, pig.body.pos.z - z).toFixed(1)} blocks away)`);
});

test('Frost Wraith: icicles rain where the ground is marked, and freeze you; its icicle volleys fly at you', () => {
  const { g, got, p, boss } = arena('frost_wraith');
  boss.moves.rain = 0;
  tick(g, 2);
  assert.ok(fxs(got, 'mark').length >= 5, 'landing spots are marked');
  for (let i = 0; i < 60 && !got.some(m => m.t === 'slow' && (m as any).freeze); i++) { g.tick(0.05); p.downed = false; }
  assert.ok(got.some(m => m.t === 'slow' && (m as any).freeze), 'an icicle landed on you: frozen');
  assert.ok(fxs(got, 'shatter').length >= 1, 'icicles shatter');
  boss.attackCd = 0;
  tick(g, 2);
  assert.ok([...(g as any).items.values()].filter((it: any) => it.type === 'icicle').length >= 3, 'a volley of icicles');
});

test('the Tempest: summons hurricanes that chase you and fling you up, then blow over', () => {
  const { g, got, p, boss } = arena('tempest');
  boss.moves.hurricanes = 0;
  tick(g, 2);
  const hurricanes = () => [...(g as any).mobs.values()].filter((m: any) => m.kind === 'hurricane');
  assert.equal(hurricanes().length, 2);
  for (let i = 0; i < 20 * 8 && !got.some(m => m.t === 'hurt' && ((m as any).lift ?? 0) >= 12); i++) { g.tick(0.05); p.downed = false; p.health = 20; }
  assert.ok(got.some(m => m.t === 'hurt' && ((m as any).lift ?? 0) >= 12), 'flung into the air');
  (g as any).damageMob(hurricanes()[0], 50, p.body.pos);
  assert.equal(hurricanes()[0].health, 999, 'a hurricane can\'t be hurt');
  (g as any).mobs.delete(boss.eid); // (or it would summon more)
  tick(g, 20 * 13);
  assert.equal(hurricanes().length, 0, 'they blow over');
});

test('bosses get angrier below half health (phase two), with new moves', () => {
  const { g, got, boss } = arena('magma_colossus');
  boss.health = 150;
  tick(g, 2);
  assert.ok(boss.phase2);
  assert.ok(chats(got).some(t => t.includes('is enraged')));
  assert.ok(fxs(got, 'enrage').length === 1);
  boss.moves.eruption = 0;
  tick(g, 2);
  assert.ok([...(g as any).items.values()].filter((it: any) => it.type === 'fireball' && it.shot.gravity).length >= 4, 'fireballs rain from the sky');
});

test('every boss has a temple with two loot chests; the Cloud Kingdom\'s floats above the clouds with a stair', () => {
  for (const biome of ['frost', 'volcano', 'jungle', 'clouds']) {
    const s = shrineOf(biome, 11);
    const { storage } = memoryStorage();
    const g = new Game(storage, { creativeCode: TEST_CODE, seed: 11, maxPlayers: 8 });
    const w = (g as any).world;
    for (const dx of [-2, 2]) {
      assert.equal(w.get(s.x + dx, s.y, s.z + 7), BLOCK_ID.chest, `${biome}: a chest`);
      assert.match((g as any).lootKind(s.x + dx, s.y, s.z + 7), /^temple_/, `${biome}: temple loot`);
    }
    if (biome === 'clouds') {
      assert.ok(s.y > s.ground + 20, 'high above the clouds');
      // No gap between the platform's edge (radius 9) and the top of the stair
      assert.notEqual(w.get(s.x + 9, s.y - 1, s.z), 0, 'the platform edge');
      assert.equal(w.get(s.x + 10, s.y - 1, s.z), BLOCK_ID.skystone_bricks, 'the stair meets the platform');
    }
    if (biome === 'jungle') {
      let above = 0;
      for (let i = -8; i <= 8; i++) for (let k = -8; k <= 8; k++) for (let j = 7; j <= 20; j++) if (Math.hypot(i, k) < 8 && w.get(s.x + i, s.y + j, s.z + k) !== 0) above++;
      assert.equal(above, 0, 'nothing floats over the jungle arena');
    }
  }
});

test('review fixes: a close-range move waits for you to come close (it is not wasted while you stand back)', () => {
  const { g, got, p, boss, x, y, z } = arena('magma_colossus');
  stand(p, x + 12, y, z); // out of slam range
  boss.moves.slam = 0;
  tick(g, 20);
  assert.equal(fxs(got, 'slam').length, 0);
  boss.body.pos.x = x + 0.5; boss.body.vel.x = 0;
  stand(p, x + 3, y, z); p.invuln = 0;
  tick(g, 2);
  assert.equal(fxs(got, 'slam').length, 1, 'slams as soon as you are close');
});

test('bosses come back 5 minutes after being defeated', () => {
  const { storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 11, maxPlayers: 8, difficulty: 'easy' });
  const { got, conn } = fakeConn();
  const p = g.join(conn, hello('Waiter'))!;
  const s = shrineOf('volcano', 11);
  stand(p, s.x + 3, s.y, s.z + 1);
  p.gamemode = 'creative'; // (it can't hurt us while we wait)
  tick(g, 30);
  const boss = () => [...(g as any).mobs.values()].find((m: any) => m.kind === 'magma_colossus');
  boss().health = 0; boss().dying = 0;
  tick(g, 30);
  assert.ok(chats(got).some(t => t.includes('return in 5 minutes')));
  for (let i = 0; i < 20 * 60 * 4.5; i++) g.tick(0.05);
  assert.ok(!boss(), 'still gone after 4.5 minutes');
  for (let i = 0; i < 20 * 45; i++) g.tick(0.05);
  assert.ok(boss(), 'back after 5');
});
