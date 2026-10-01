// Fast checks of the authoritative server (no browser, no network): node --test tests/unit/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, creativeCodeHash, type Storage, type WorldSave, type PlayerSave } from '../../server/core/game.ts';
const TEST_CODE = creativeCodeHash('1234'); // the tests' own creative code
import type { ServerMsg } from '../../shared/protocol.ts';

function memoryStorage(world: WorldSave | null = null) {
  const s = { world, players: {} as Record<string, PlayerSave>, worldSaves: 0 };
  const storage: Storage = {
    loadWorld: () => s.world,
    saveWorld: w => { s.world = w; s.worldSaves++; },
    loadPlayer: n => s.players[n] || null,
    savePlayer: (n, p) => { s.players[n] = p; },
  };
  return { s, storage };
}

function fakeConn() {
  const got: ServerMsg[] = [];
  return { got, conn: { send: (m: ServerMsg) => { got.push(m); }, close: () => {} } };
}

const hello = (name: string) => ({ t: 'hello', v: 1, name, look: {}, token: 'tok-' + name });
const edits = (flat: number[]) => { const o: string[] = []; for (let i = 0; i < flat.length; i += 4) o.push(flat.slice(i, i + 4).join(',')); return o; };
const tick = (g: Game, n: number) => { for (let i = 0; i < n; i++) g.tick(0.05); };

test('a brand-new world is saved immediately, so an early crash keeps the seed', () => {
  const { s, storage } = memoryStorage();
  new Game(storage, { creativeCode: TEST_CODE, seed: 4242 });
  assert.equal(s.worldSaves, 1);
  assert.equal(s.world?.seed, 4242);
});

test('new players get nearby edits in the welcome, far ones only when they get close', () => {
  const near = [3, 20, 3, 0];               // chunk 0,0
  const far = [3200, 20, 3200, 0];          // chunk 200,200
  const { storage } = memoryStorage({ v: 1, seed: 7, time: 0.3, edits: [...near, ...far], facing: [], spawn: [0.5, 60, 0.5] } as WorldSave);
  const g = new Game(storage, { creativeCode: TEST_CODE,});
  const { got, conn } = fakeConn();
  const p = g.join(conn, hello('Walker'))!;
  const welcome = got.find(m => m.t === 'welcome') as Extract<ServerMsg, { t: 'welcome' }>;
  assert.deepEqual(edits(welcome.edits), ['3,20,3,0']);

  p.body.pos.x = 3200.5; p.body.pos.z = 3200.5;
  tick(g, 5);
  const streamed = got.filter(m => m.t === 'edits').flatMap(m => (m as Extract<ServerMsg, { t: 'edits' }>).list);
  assert.deepEqual(edits(streamed), ['3200,20,3200,0']);

  // Coming back doesn't resend what the client already has
  const before = got.filter(m => m.t === 'edits').length;
  p.body.pos.x = 0.5; p.body.pos.z = 0.5;
  tick(g, 5);
  assert.equal(got.filter(m => m.t === 'edits').length, before);
});

test('an edit that restores the generated block is forgotten', () => {
  const { storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 99 });
  const w = (g as any).world;
  const original = w.get(5, 10, 5);
  w.set(5, 10, 5, original === 0 ? 1 : 0);
  assert.equal(w.exportEdits().length, 4);
  w.set(5, 10, 5, original);
  assert.equal(w.exportEdits().length, 0);
  assert.equal(w.editedChunkCount(), 0);
});

test('a refused dig tells the client the real block (no ghost holes)', () => {
  const { storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 5 });
  const { got, conn } = fakeConn();
  const p = g.join(conn, hello('Digger'))!;
  const x = Math.floor(p.body.pos.x) + 9, y = Math.floor(p.body.pos.y) - 1, z = Math.floor(p.body.pos.z);
  g.handle(p, { t: 'dig', x, y, z } as any);
  const reply = got.filter(m => m.t === 'blocks').flatMap(m => (m as Extract<ServerMsg, { t: 'blocks' }>).list);
  assert.deepEqual(reply.slice(0, 4), [x, y, z, (g as any).world.get(x, y, z)]);
});

test('a dig far outside the world range generates no terrain', () => {
  const { storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 5 });
  const { conn } = fakeConn();
  const p = g.join(conn, hello('Faraway'))!;
  const chunksBefore = g.stats().chunks;
  g.handle(p, { t: 'dig', x: 1e7, y: 10, z: 1e7 } as any);
  g.handle(p, { t: 'place', x: -5e6, y: 10, z: 5e6, nx: 0, ny: 1, nz: 0, facing: 0 } as any);
  assert.equal(g.stats().chunks, chunksBefore);
});

test('in daylight, zombies only spawn in caves (never on the surface or under trees)', async () => {
  const { columnInfo } = await import('../../shared/worldgen.ts');
  for (const seed of [12345, 777, 4242]) {
    const { storage } = memoryStorage();
    const g = new Game(storage, { creativeCode: TEST_CODE, seed });
    const { conn } = fakeConn();
    const p = g.join(conn, hello('Sunny' + seed))!;
    const gm = g as any;
    for (let i = 0; i < 400; i++) gm.trySpawnMobs(1);
    const zombies = [...gm.mobs.values()].filter((m: any) => !['pig', 'cow', 'chicken'].includes(m.kind)); // every hostile kind
    for (const z of zombies) {
      const ground = columnInfo(Math.floor(z.body.pos.x), Math.floor(z.body.pos.z), seed).h;
      assert.ok(z.body.pos.y <= ground - 6, `seed ${seed}: zombie at y=${z.body.pos.y} but ground is ${ground}`);
    }
    void p;
  }
});

test('at night, zombies can spawn on the surface', () => {
  const { storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 12345 });
  const { conn } = fakeConn();
  const p = g.join(conn, hello('Nightowl'))!;
  const gm = g as any;
  for (let i = 0; i < 400; i++) gm.trySpawnMobs(0);
  const surface = [...gm.mobs.values()].filter((m: any) => m.kind === 'zombie' && m.body.pos.y > p.body.pos.y - 8);
  assert.ok(surface.length > 0, 'no zombie spawned near the surface at night');
});

test('a character carried from a save replaces the server inventory and health', () => {
  const { storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 3 });
  const { got, conn } = fakeConn();
  const carry = { inv: { slots: [{ type: 'diamond', count: 3 }, null, { type: 'stick', count: 5 }], selected: 2, cursor: null }, health: 11 };
  const p = g.join(conn, { ...hello('Traveller'), carry })!;
  const w = got.find(m => m.t === 'welcome') as Extract<ServerMsg, { t: 'welcome' }>;
  assert.equal(w.carried, true);
  assert.equal(p.health, 11);
  assert.deepEqual(p.inv.slots.slice(0, 3), [{ type: 'diamond', count: 3 }, null, { type: 'stick', count: 5 }]);
});

test('a carried character is never saved as the server character (no duplicating items between them)', () => {
  const { s, storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 3 });
  // The server's own character for this name has 2 sticks
  const own = g.join(fakeConn().conn, hello('Traveller'))!;
  own.inv.slots[0] = { type: 'stick', count: 2 };
  g.leave(own);
  // Join carrying 64 diamonds from a single-player save, then leave
  const p = g.join(fakeConn().conn, { ...hello('Traveller'), carry: { inv: { slots: [{ type: 'diamond', count: 64 }] }, health: 20 } })!;
  assert.equal(p.inv.slots[0]?.type, 'diamond');
  g.leave(p);
  // The server still has its own character, not a copy of the diamonds
  const saved = s.players['Traveller'].inv.slots.filter(Boolean);
  assert.deepEqual(saved, [{ type: 'stick', count: 2 }]);
  const back = g.join(fakeConn().conn, hello('Traveller'))!;
  assert.deepEqual(back.inv.slots.filter(Boolean), [{ type: 'stick', count: 2 }]);
});

test('using /give or creative marks the character as cheated (it stays in single player)', () => {
  const { s, storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 3, ops: ['*'] });
  const p = g.join(fakeConn().conn, hello('Solo'))!;
  g.handle(p, { t: 'chat', text: '/give diamond 5' } as any);
  g.leave(p);
  assert.equal(s.players['Solo'].cheated, true);
  const honest = g.join(fakeConn().conn, hello('Honest'))!;
  g.leave(honest);
  assert.ok(!s.players['Honest'].cheated);
});

test('nobody is an operator unless the server names them', () => {
  const { storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 3 });
  const c = fakeConn();
  const p = g.join(c.conn, { ...hello('player9989'), token: 'x' })!;
  g.handle(p, { t: 'chat', text: '/give diamond 64' } as any);
  g.handle(p, { t: 'chat', text: '/gamemode creative 1234' } as any);
  assert.equal(p.inv.slots.filter(Boolean).length, 0);
  assert.equal(p.gamemode, 'survival');
});

test('an operator who renames keeps their old name locked', () => {
  const { s, storage } = memoryStorage();
  (storage as any).deletePlayer = (n: string) => { delete s.players[n]; };
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 3, ops: ['Boss'] });
  g.leave(g.join(fakeConn().conn, { ...hello('Boss'), token: 'boss' })!);
  g.leave(g.join(fakeConn().conn, { ...hello('Chief'), token: 'boss', prevName: 'Boss' } as any)!);
  assert.ok(s.players['Boss'], 'old name still claimed');
  const c = fakeConn();
  assert.equal(g.join(c.conn, { ...hello('Boss'), token: 'intruder' }), null);
});

test('servers can refuse carried characters', () => {
  const { storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 3, allowCarry: false });
  const { got, conn } = fakeConn();
  const p = g.join(conn, { ...hello('Traveller'), carry: { inv: { slots: [{ type: 'diamond', count: 64 }] }, health: 20 } })!;
  assert.equal((got.find(m => m.t === 'welcome') as any).carried, false);
  assert.equal(p.inv.slots.filter(Boolean).length, 0);
});

test('renaming moves the character and frees the old name; others cannot take a claimed name', () => {
  const { s, storage } = memoryStorage();
  (storage as any).deletePlayer = (n: string) => { delete s.players[n]; };
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 3 });
  const a = fakeConn();
  const alice = g.join(a.conn, { ...hello('Alice'), token: 'alice-token' })!;
  alice.inv.slots[0] = { type: 'apple', count: 2 };
  g.leave(alice);
  assert.ok(s.players['Alice']);

  // Someone else can't use the name, or steal the character by pretending to rename from it
  const e = fakeConn();
  assert.equal(g.join(e.conn, { ...hello('Alice'), token: 'eve-token' }), null);
  const eve = g.join(e.conn, { ...hello('Eve'), token: 'eve-token', prevName: 'Alice' })!;
  assert.equal(eve.inv.slots[0], null);
  g.leave(eve);

  // The owner renames: same character, new name locked to them, old name free
  const b = fakeConn();
  const renamed = g.join(b.conn, { ...hello('Alicia'), token: 'alice-token', prevName: 'Alice' })!;
  assert.deepEqual(renamed.inv.slots[0], { type: 'apple', count: 2 });
  assert.ok(s.players['Alicia']?.token === 'alice-token');
  assert.equal(s.players['Alice'], undefined);
  g.leave(renamed);
  const c = fakeConn();
  assert.equal(g.join(c.conn, { ...hello('Alicia'), token: 'someone-else' }), null);
});

// ------------------------------------------------------------------ Difficulty, hunger, farming

test('Easy has no hunger; Medium and Hard drain food with activity', () => {
  for (const difficulty of ['easy', 'medium', 'hard'] as const) {
    const { storage } = memoryStorage();
    const g = new Game(storage, { creativeCode: TEST_CODE, seed: 11, difficulty });
    const { got, conn } = fakeConn();
    const p = g.join(conn, hello('Runner' + difficulty))!;
    assert.equal((got.find(m => m.t === 'welcome') as any).difficulty, difficulty);
    p.exhaustion = 100; // a long, hard day
    g.tick(0.05);
    if (difficulty === 'easy') assert.equal(p.food, 20);
    else assert.ok(p.food < 20, `${difficulty}: food ${p.food}`);
  }
});

test('starving stops at half a heart on Medium, kills on Hard', () => {
  for (const [difficulty, survives] of [['medium', true], ['hard', false]] as const) {
    const { storage } = memoryStorage();
    const g = new Game(storage, { creativeCode: TEST_CODE, seed: 11, difficulty, maxPlayers: 1 }); // single player: no downed state
    const p = g.join(fakeConn().conn, hello('Hungry' + difficulty))!;
    p.food = 0; p.sat = 0;
    for (let i = 0; i < 20 * 120; i++) g.tick(0.05); // two minutes of starving
    assert.equal(!p.dead, survives, `${difficulty}: health ${p.health}`);
    if (survives) assert.equal(p.health, 1);
  }
});

test('eating fills hunger (and returns the bowl from stew)', () => {
  const { storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 11, difficulty: 'medium' });
  const p = g.join(fakeConn().conn, hello('Eater'))!;
  p.food = 10;
  p.inv.slots[0] = { type: 'mushroom_stew', count: 1 };
  p.inv.selected = 0;
  g.handle(p, { t: 'eat' } as any);
  assert.equal(p.food, 16);
  assert.deepEqual(p.inv.slots.find(Boolean), { type: 'bowl', count: 1 });
});

test('the difficulty is kept in the world save', () => {
  const { s, storage } = memoryStorage();
  new Game(storage, { creativeCode: TEST_CODE, seed: 11, difficulty: 'hard' });
  assert.equal(s.world?.difficulty, 'hard');
  const again = new Game(storage, { creativeCode: TEST_CODE, seed: 11, difficulty: 'easy' }); // a saved world keeps its own
  assert.equal(again.difficulty, 'hard');
});

test('crops planted on farmland grow until ripe', () => {
  const { storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 11 });
  const p = g.join(fakeConn().conn, hello('Farmer'))!;
  const w = (g as any).world;
  const x = Math.floor(p.body.pos.x) + 2, z = Math.floor(p.body.pos.z);
  const y = w.surfaceHeight(x, z);
  w.set(x, y, z, 84); // farmland
  w.set(x, y + 1, z, 0);
  p.inv.slots[0] = { type: 'seeds', count: 3 }; p.inv.selected = 0;
  g.handle(p, { t: 'place', x, y: y + 1, z, nx: 0, ny: 1, nz: 0, facing: 0 } as any);
  assert.equal(w.get(x, y + 1, z), 85, 'seeds planted');
  for (let i = 0; i < 20 * 400; i++) g.tick(0.05); // ~7 minutes
  assert.equal(w.get(x, y + 1, z), 87, 'wheat ripe');
});

test('new blocks: powder snow is not solid, plants follow their placement rules', async () => {
  const { isSolid, plantCanStand, BLOCK_ID } = await import('../../shared/blocks.ts');
  assert.equal(isSolid(BLOCK_ID.powder_snow), false);
  assert.equal(isSolid(BLOCK_ID.ice), true);
  assert.equal(plantCanStand(BLOCK_ID.wheat_0, BLOCK_ID.farmland), true);
  assert.equal(plantCanStand(BLOCK_ID.wheat_0, BLOCK_ID.dirt), false);
  assert.equal(plantCanStand(BLOCK_ID.torch, BLOCK_ID.stone), true);
  assert.equal(plantCanStand(BLOCK_ID.dandelion, BLOCK_ID.stone), false);
});

test('a hit is not healed back straight away by the hunger regeneration', () => {
  const { storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 11, difficulty: 'medium' });
  const a = g.join(fakeConn().conn, { ...hello('Hitter'), token: 'h' })!;
  const b = g.join(fakeConn().conn, { ...hello('Target'), token: 't' })!;
  for (let i = 0; i < 60; i++) g.tick(0.05); // spawn protection wears off, heal timer sits at full
  b.body.pos.x = a.body.pos.x; b.body.pos.y = a.body.pos.y; b.body.pos.z = a.body.pos.z - 2;
  g.handle(a, { t: 'attack', eid: b.eid } as any);
  g.tick(0.05); g.tick(0.05);
  assert.equal(b.health, 19);
});

// ------------------------------------------------------------------ Chests and structures

async function findStructure(kind: string, seed: number) {
  const { structureInRegion } = await import('../../shared/worldgen.ts');
  for (let r = 1; r < 60; r++) for (let rx = -r; rx <= r; rx++) for (const rz of [-r, r]) {
    for (const under of [false, true]) {
      const s = structureInRegion(rx, rz, seed, under);
      if (s?.kind === kind) return s;
    }
  }
  return null;
}

test('every structure kind appears somewhere and has a chest', async () => {
  const { generateChunkData, idx } = await import('../../shared/worldgen.ts');
  const { CHEST } = await import('../../shared/blocks.ts');
  for (const kind of ['cabin', 'temple', 'igloo', 'dungeon']) {
    const s = await findStructure(kind, 12345);
    assert.ok(s, `no ${kind} found`);
    let chests = 0;
    for (let cx = (s!.x - 6) >> 4; cx <= (s!.x + 6) >> 4; cx++) for (let cz = (s!.z - 6) >> 4; cz <= (s!.z + 6) >> 4; cz++) {
      const d = generateChunkData(cx, cz, 12345);
      for (let lx = 0; lx < 16; lx++) for (let lz = 0; lz < 16; lz++) for (let y = s!.y - 2; y <= s!.y + 6; y++) if (d[idx(lx, y, lz)] === CHEST) chests++;
    }
    assert.ok(chests >= 1, `${kind} at ${s!.x},${s!.y},${s!.z} has no chest`);
  }
});

test('a generated chest has loot; a placed chest starts empty; contents are saved and spill when broken', async () => {
  const { CHEST } = await import('../../shared/blocks.ts');
  const s = await findStructure('cabin', 12345);
  const { s: saved, storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 12345 });
  const { got, conn } = fakeConn();
  const p = g.join(conn, hello('Looter'))!;
  const w = (g as any).world;
  // find the cabin's chest
  let chest: number[] | null = null;
  for (let i = -3; i <= 3 && !chest; i++) for (let k = -3; k <= 3 && !chest; k++) for (let j = 0; j <= 3; j++) if (w.get(s!.x + i, s!.y + j, s!.z + k) === CHEST) { chest = [s!.x + i, s!.y + j, s!.z + k]; break; }
  assert.ok(chest, 'cabin chest');
  p.body.pos.x = chest![0] + 0.5; p.body.pos.y = chest![1] + 1; p.body.pos.z = chest![2] + 2.5;
  g.handle(p, { t: 'open', x: chest![0], y: chest![1], z: chest![2] } as any);
  const screen = got.filter(m => m.t === 'screen').pop() as any;
  assert.equal(screen.mode, 'chest');
  assert.ok(screen.chest.some(Boolean), 'loot inside');
  // take the first stack with a shift-click
  const first = screen.chest.findIndex(Boolean);
  g.handle(p, { t: 'inv', seq: 1, action: { a: 'click', slot: 200 + first, button: 0, shift: true } } as any);
  assert.ok(p.inv.slots.some(Boolean), 'moved into the inventory');
  g.handle(p, { t: 'inv', seq: 2, action: { a: 'close' } } as any);
  g.saveAll(true);
  assert.ok(saved.world?.chests && Object.keys(saved.world.chests).length === 1, 'chest saved');

  // a chest the player places is empty
  const x = chest![0] + 1, y = chest![1], z = chest![2] + 1;
  w.set(x, y, z, 0); w.set(x, y - 1, z, 3);
  p.inv.slots[0] = { type: 'chest', count: 1 }; p.inv.selected = 0;
  g.handle(p, { t: 'place', x, y, z, nx: 0, ny: 1, nz: 0, facing: 0 } as any);
  g.handle(p, { t: 'open', x, y, z } as any);
  const placed = got.filter(m => m.t === 'screen').pop() as any;
  assert.equal(placed.mode, 'chest');
  assert.ok(!placed.chest.some(Boolean), 'placed chest is empty');

  // breaking the loot chest spills what's left
  const itemsBefore = g.stats().items;
  for (let i = 0; i < 40; i++) g.tick(0.05); // dig credit
  g.handle(p, { t: 'dig', x: chest![0], y: chest![1], z: chest![2] } as any);
  assert.ok(g.stats().items > itemsBefore, 'contents dropped');
});

// ------------------------------------------------------------------ Hostile mobs

function arena(difficulty: 'easy' | 'medium' | 'hard' = 'medium') {
  const { storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 12345, difficulty });
  const p = g.join(fakeConn().conn, hello('Hunter' + Math.random().toString(36).slice(2, 6)))!;
  const gm = g as any;
  for (let i = 0; i < 60; i++) g.tick(0.05); // spawn protection wears off
  gm.mobs.clear();
  gm.time = 0.75; // night, so nothing burns
  return { g, p, gm };
}

test('a skeleton keeps its distance and its arrows hurt', () => {
  const { g, p, gm } = arena();
  const { x, y, z } = p.body.pos;
  gm.spawnMob('skeleton', x, y, z - 8);
  const hp0 = p.health;
  let arrows = 0;
  for (let i = 0; i < 20 * 8 && p.health === hp0; i++) {
    g.tick(0.05);
    p.food = 20; p.sat = 0;
    for (const it of gm.items.values()) if (it.arrow) arrows++;
  }
  assert.ok(arrows > 0, 'shot arrows');
  assert.ok(p.health < hp0, `arrow hit (health ${p.health})`);
});

test('a slime splits into slimelets when killed', () => {
  const { g, p, gm } = arena();
  gm.spawnMob('slime', p.body.pos.x + 3, p.body.pos.y, p.body.pos.z);
  const slime = [...gm.mobs.values()][0];
  gm.damageMob(slime, 100, p.body.pos);
  for (let i = 0; i < 30; i++) g.tick(0.05);
  const kids = [...gm.mobs.values()].filter((m: any) => m.kind === 'slimelet');
  assert.ok(kids.length >= 2, `${kids.length} slimelets`);
});

test('husk hits make you hungry (Medium)', () => {
  const { g, p, gm } = arena('medium');
  const { x, y, z } = p.body.pos;
  gm.spawnMob('husk', x, y, z - 1);
  const ex0 = p.exhaustion;
  for (let i = 0; i < 40 && p.health === 20; i++) g.tick(0.05);
  assert.ok(p.health < 20, 'husk hit');
  assert.ok(p.exhaustion >= ex0 + 4 || p.food < 20 || p.sat < 5, 'hunger drained');
});

test('desert nights bring husks, snowy nights frostbitten; caves have a mix (slimes deep down)', async () => {
  const { columnInfo } = await import('../../shared/worldgen.ts');
  const { gm } = arena();
  const find = (biome: string) => {
    for (let x = -2000; x < 2000; x += 37) for (let z = -2000; z < 2000; z += 41) if (columnInfo(x, z, 12345).biome === biome) return { x, z };
    return null;
  };
  const kindsAt = (x: number, y: number, z: number, cave: boolean) => { const k = new Set<string>(); for (let i = 0; i < 300; i++) k.add(gm.hostileKind(x, y, z, cave)); return k; };
  const desert = find('desert'), snowy = find('snowy');
  assert.ok(desert && snowy, 'found desert and snowy land');
  assert.ok(kindsAt(desert!.x, 20, desert!.z, false).has('husk'), 'husks in the desert');
  assert.ok(kindsAt(snowy!.x, 20, snowy!.z, false).has('frostbitten'), 'frostbitten in the snow');
  const cave = kindsAt(0, 0, 0, true);
  assert.ok(cave.has('zombie') && cave.has('skeleton') && cave.has('spider') && !cave.has('slime'), 'shallow caves: ' + [...cave]);
  assert.ok(kindsAt(0, -50, 0, true).has('slime'), 'deep caves have slimes');
});

// ------------------------------------------------------------------ Downed and revive (multiplayer)

function party() {
  const { storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 12345, maxPlayers: 8, difficulty: 'easy' });
  const a = fakeConn(), b = fakeConn();
  const alice = g.join(a.conn, { ...hello('Alice'), token: 'a' })!;
  const bob = g.join(b.conn, { ...hello('Bob'), token: 'b' })!;
  for (let i = 0; i < 60; i++) g.tick(0.05);
  bob.body.pos.x = alice.body.pos.x; bob.body.pos.y = alice.body.pos.y; bob.body.pos.z = alice.body.pos.z - 1.5;
  bob.inv.slots[0] = { type: 'diamond', count: 5 };
  return { g, alice, bob, a, b };
}

test('in multiplayer, 0 health means downed (not dead), and a friend can revive you', () => {
  const { g, alice, bob, b } = party();
  (g as any).damagePlayer(bob, 100, null, 'fall');
  assert.equal(bob.dead, false);
  assert.equal(bob.downed, true);
  assert.ok(b.got.some(m => m.t === 'downed'));
  for (let i = 0; i < 20 * 3.3; i++) { g.handle(alice, { t: 'revive', eid: bob.eid } as any); g.tick(0.05); }
  assert.equal(bob.downed, false);
  assert.equal(bob.health, 6);
  assert.deepEqual(bob.inv.slots[0], { type: 'diamond', count: 5 }, 'kept the items');
  assert.ok(b.got.some(m => m.t === 'revived'));
});

test('a downed player can give up, and bleeds out if nobody helps', () => {
  const one = party();
  (one.g as any).damagePlayer(one.bob, 100, null, 'fall');
  one.g.handle(one.bob, { t: 'giveup' } as any);
  assert.equal(one.bob.dead, true);
  assert.equal(one.bob.inv.slots[0], null, 'items dropped');

  const two = party();
  (two.g as any).damagePlayer(two.bob, 100, null, 'fall');
  for (let i = 0; i < 20 * 61; i++) two.g.tick(0.05);
  assert.equal(two.bob.dead, true);
});

test('while downed: can only crawl; mobs leave you alone; another hit finishes you; single player dies straight away', () => {
  const { g, bob } = party();
  const gm = g as any;
  gm.damagePlayer(bob, 100, null, 'fall');
  const before = bob.inv.slots[0];
  g.handle(bob, { t: 'dig', x: Math.floor(bob.body.pos.x), y: Math.floor(bob.body.pos.y) - 1, z: Math.floor(bob.body.pos.z) } as any);
  assert.deepEqual(bob.inv.slots[0], before);
  gm.time = 0.75; gm.mobs.clear();
  gm.spawnMob('zombie', bob.body.pos.x, bob.body.pos.y, bob.body.pos.z - 1);
  for (let i = 0; i < 40; i++) g.tick(0.05);
  assert.equal(bob.dead, false, 'zombie ignored the downed player');
  bob.invuln = 0;
  gm.damagePlayer(bob, 1, null, 'lava');
  assert.equal(bob.dead, true);

  const { storage } = memoryStorage();
  const sp = new Game(storage, { creativeCode: TEST_CODE, seed: 1, maxPlayers: 1 });
  const solo = sp.join(fakeConn().conn, hello('Solo'))!;
  for (let i = 0; i < 60; i++) sp.tick(0.05);
  (sp as any).damagePlayer(solo, 100, null, 'fall');
  assert.equal(solo.dead, true);
});

// ------------------------------------------------------------------ Commands and creative mode

function chatReplies(got: ServerMsg[]) { return got.filter(m => m.t === 'chat').map(m => (m as any).text as string); }

test('/give and /gamemode work for operators only (none by default)', () => {
  const { storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 3, ops: ['player9989'] });
  const op = fakeConn(), other = fakeConn();
  const owner = g.join(op.conn, { ...hello('player9989'), token: 'o' })!;
  const guest = g.join(other.conn, { ...hello('Guest'), token: 'g' })!;
  g.handle(guest, { t: 'chat', text: '/give diamond 64' } as any);
  assert.equal(guest.inv.slots.filter(Boolean).length, 0);
  assert.ok(chatReplies(other.got).some(t => t.includes('Only server operators')));
  g.handle(owner, { t: 'chat', text: '/give diamond 70' } as any);
  assert.equal(owner.inv.slots.filter(s => s?.type === 'diamond').reduce((a, s) => a + s!.count, 0), 70);
  g.handle(owner, { t: 'chat', text: '/give oak_log 3 Guest' } as any); // by display name, to another player
  assert.deepEqual(guest.inv.slots.find(Boolean), { type: 'wood', count: 3 });
  g.handle(owner, { t: 'chat', text: '/give notathing' } as any);
  assert.ok(chatReplies(op.got).some(t => t.includes('Unknown item')));
  g.handle(guest, { t: 'chat', text: '/gamemode creative 1234' } as any);
  assert.equal(guest.gamemode, 'survival');
  g.handle(owner, { t: 'chat', text: '/gamemode c 1234' } as any);
  assert.equal(owner.gamemode, 'creative');
  assert.ok(op.got.some(m => m.t === 'gamemode' && (m as any).mode === 'creative'));
});

test('creative: no damage, instant breaking without drops, blocks never run out, mobs ignore you', () => {
  const { storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 12345, maxPlayers: 8, ops: ['player9989'] });
  const gm = g as any;
  const p = g.join(fakeConn().conn, { ...hello('player9989'), token: 'o' })!;
  for (let i = 0; i < 60; i++) g.tick(0.05);
  g.handle(p, { t: 'chat', text: '/gamemode creative 1234' } as any);
  gm.damagePlayer(p, 50, null, 'zombie');
  assert.equal(p.health, 20);
  // Break stone instantly (no tool, no dig credit) and get nothing
  const x = Math.floor(p.body.pos.x), y = Math.floor(p.body.pos.y) - 2, z = Math.floor(p.body.pos.z);
  const items0 = g.stats().items;
  for (let k = 0; k < 5; k++) g.handle(p, { t: 'dig', x, y: y - k, z } as any);
  assert.equal(gm.world.get(x, y - 4, z), 0);
  assert.equal(g.stats().items, items0);
  // Placing keeps the stack
  p.inv.slots[0] = { type: 'stone', count: 1 }; p.inv.selected = 0;
  g.handle(p, { t: 'place', x, y: y - 4, z, nx: 0, ny: 1, nz: 0, facing: 0 } as any);
  assert.equal(gm.world.get(x, y - 4, z), 3);
  assert.deepEqual(p.inv.slots[0], { type: 'stone', count: 1 });
  // Zombies don't chase creative players
  gm.time = 0.75; gm.mobs.clear();
  gm.spawnMob('zombie', p.body.pos.x, p.body.pos.y, p.body.pos.z - 1);
  for (let i = 0; i < 40; i++) g.tick(0.05);
  assert.equal(p.health, 20);
  // Survival again: damage works
  g.handle(p, { t: 'chat', text: '/gamemode survival' } as any);
  p.invuln = 0;
  gm.damagePlayer(p, 3, null, 'fall');
  assert.equal(p.health, 17);
});

test('creative mode is saved for the owner (and never for anyone else)', () => {
  const { s, storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 3, ops: ['player9989'] });
  const p = g.join(fakeConn().conn, { ...hello('player9989'), token: 'o' })!;
  g.handle(p, { t: 'chat', text: '/gamemode creative 1234' } as any);
  g.leave(p);
  assert.equal(s.players['player9989'].gamemode, 'creative');
  const again = g.join(fakeConn().conn, { ...hello('player9989'), token: 'o' })!;
  assert.equal(again.gamemode, 'creative');
  s.players['Sneaky'] = { ...s.players['player9989'], token: 'x' }; // a hand-edited save can't grant creative
  const sneaky = g.join(fakeConn().conn, { ...hello('Sneaky'), token: 'x' })!;
  assert.equal(sneaky.gamemode, 'survival');
});

test('a hoe tills grass with tall grass on it (clearing the plant)', () => {
  const { storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 12345 });
  const gm = g as any;
  const p = g.join(fakeConn().conn, hello('Tiller'))!;
  const x = Math.floor(p.body.pos.x) + 2, z = Math.floor(p.body.pos.z);
  const y = gm.world.surfaceHeight(x, z);
  gm.world.set(x, y, z, 1); gm.world.set(x, y + 1, z, 33);
  p.inv.slots[0] = { type: 'wooden_hoe', count: 1 }; p.inv.selected = 0;
  g.handle(p, { t: 'till', x, y, z } as any);
  assert.equal(gm.world.get(x, y, z), 84);
  assert.equal(gm.world.get(x, y + 1, z), 0);
});

test('a carried character brings its hunger too', () => {
  const { storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 3, difficulty: 'medium' });
  const p = g.join(fakeConn().conn, { ...hello('Traveller'), carry: { inv: { slots: [] }, health: 20, food: 9 } })!;
  assert.equal(p.food, 9);
});

test('item spam evicts ordinary drops before death loot', () => {
  const { storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 5 });
  const items = (g as any).items as Map<number, { type: string; keep?: boolean }>;
  g.spawnItem('diamond', 3, 100, 200, 100, { x: 0, y: 0, z: 0 }, 1, true);
  for (let i = 0; i < 700; i++) g.spawnItem('dirt', 1, i * 2, 200, 0, { x: 0, y: 0, z: 0 });
  assert.ok(items.size <= 601);
  assert.ok([...items.values()].some(it => it.type === 'diamond'));
});

// ------------------------------------------------------------------ Anti-cheat

test('digging a slow block takes its real time (no 1-second cap)', () => {
  const { storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 5 });
  const w = (g as any).world;
  const p = g.join(fakeConn().conn, hello('Miner'))!;
  const x = Math.floor(p.body.pos.x) + 1, y = Math.floor(p.body.pos.y), z = Math.floor(p.body.pos.z);
  for (let i = 0; i < 3; i++) w.set(x, y + i, z, 3); // stone: 7.5s by hand
  tick(g, 40);
  g.handle(p, { t: 'dig', x, y, z } as any);
  assert.equal(w.get(x, y, z), 0, 'first break allowed');
  tick(g, 40); // 2s later: far too soon for stone by hand
  g.handle(p, { t: 'dig', x, y: y + 1, z } as any);
  assert.equal(w.get(x, y + 1, z), 3, 'second break refused');
  tick(g, 120); // 8s in total
  g.handle(p, { t: 'dig', x, y: y + 1, z } as any);
  assert.equal(w.get(x, y + 1, z), 0, 'allowed after the real mining time');
});

test('moving into solid blocks is refused', () => {
  const { storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 5 });
  const w = (g as any).world;
  const { got, conn } = fakeConn();
  const p = g.join(conn, hello('Ghost'))!;
  const b = p.body.pos, x = Math.floor(b.x) + 1, z = Math.floor(b.z);
  for (let y = Math.floor(b.y); y < Math.floor(b.y) + 3; y++) w.set(x, y, z, 3);
  g.handle(p, { t: 'move', x: x + 0.5, y: b.y, z: z + 0.5, yaw: 0, pitch: 0, flags: 1 } as any);
  assert.notEqual(Math.floor(p.body.pos.x), x);
  assert.ok(got.some(m => m.t === 'pos'), 'client told to go back');
});

test('a chest stops working when you walk away from it', () => {
  const { storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 5 });
  const w = (g as any).world;
  const p = g.join(fakeConn().conn, hello('Reacher'))!;
  const x = Math.floor(p.body.pos.x) + 1, y = Math.floor(p.body.pos.y), z = Math.floor(p.body.pos.z);
  w.set(x, y, z, 90);
  g.handle(p, { t: 'open', x, y, z } as any);
  assert.equal(p.screen?.mode, 'chest');
  p.body.pos.x += 50;
  g.handle(p, { t: 'inv', seq: 1, action: { a: 'click', slot: 0 } } as any);
  assert.equal(p.screen, null);
});

test('dying with a full inventory and a stack on the cursor drops the cursor stack too', () => {
  const { storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 5 });
  const p = g.join(fakeConn().conn, hello('Hoarder'))!;
  g.handle(p, { t: 'screen', mode: 'inventory' } as any);
  for (let i = 0; i < 36; i++) p.inv.slots[i] = { type: 'dirt', count: 64 };
  p.inv.cursor = { type: 'diamond', count: 5 };
  const before = g.stats().items;
  g.handle(p, { t: 'chat', text: '/kill' } as any);
  assert.equal(g.stats().items - before, 37);
});

test('/give ignores names that are not items', () => {
  const { storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 5, ops: ['*'] });
  const p = g.join(fakeConn().conn, hello('Op'))!;
  g.handle(p, { t: 'chat', text: '/give constructor 5' } as any);
  assert.equal(p.inv.slots.filter(Boolean).length, 0);
});

// ------------------------------------------------------------------ The Robotic World

import { generateChunkData, idx as blockIdx } from '../../shared/worldgen.ts';
import { ROBO_MIN_X, isRobotic, roboticStructureInRegion } from '../../shared/robotic.ts';
import { BLOCK_ID } from '../../shared/blocks.ts';

test('robotic world terrain: walls at its edge, rust rock, tungsten, oil pools and structures', () => {
  const edge = generateChunkData(ROBO_MIN_X / 16, 0, 12345);
  assert.equal(edge[blockIdx(0, 20, 0)], BLOCK_ID.bedrock, 'wall at the edge');
  const counts: Record<number, number> = {};
  for (let i = 0; i < 12; i++) for (const v of generateChunkData(ROBO_MIN_X / 16 + 1000 + i * 3, i * 5, 12345)) counts[v] = (counts[v] || 0) + 1;
  for (const name of ['rust_rock', 'scrap_ground', 'tungsten_ore', 'oil']) assert.ok(counts[BLOCK_ID[name]] > 0, `${name} appears`);
  const kinds = new Set<string>();
  for (let rx = 1800; rx < 1840; rx++) for (let rz = 0; rz < 10; rz++) { const s = roboticStructureInRegion(rx, rz, 12345); if (s) kinds.add(s.kind); }
  assert.deepEqual([...kinds].sort(), ['giant_robot', 'ruin']);
});

// A portal (plus of etherite blocks around gold) built just in front of the player
function buildPortal(g: Game, p: { body: { pos: { x: number; y: number; z: number } } }) {
  const w = (g as any).world;
  const x = Math.floor(p.body.pos.x) + 2, y = Math.floor(p.body.pos.y), z = Math.floor(p.body.pos.z);
  w.set(x, y, z, BLOCK_ID.gold_block);
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) w.set(x + dx, y, z + dz, BLOCK_ID.etherite_block);
  return { x, y, z };
}

test('a portal takes you to the Robotic World and back', () => {
  const { storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 5 });
  const { got, conn } = fakeConn();
  const p = g.join(conn, hello('Traveller'))!;
  const home = { x: p.body.pos.x, z: p.body.pos.z };
  const w = (g as any).world;
  const portal = buildPortal(g, p);
  // Not a portal without all four etherite blocks
  w.set(portal.x + 1, portal.y, portal.z, BLOCK_ID.stone);
  g.handle(p, { t: 'open', ...portal } as any);
  assert.ok(!isRobotic(p.body.pos.x), 'incomplete portal does nothing');
  w.set(portal.x + 1, portal.y, portal.z, BLOCK_ID.etherite_block);
  g.handle(p, { t: 'open', ...portal } as any);
  assert.ok(isRobotic(p.body.pos.x), `arrived at x=${p.body.pos.x}`);
  assert.ok(got.some(m => m.t === 'pos'), 'client moved');
  // Arrived next to a return portal that can't be mined
  const core = { x: Math.floor(p.body.pos.x), y: Math.floor(p.body.pos.y) - 1, z: Math.floor(p.body.pos.z) - 1 };
  assert.equal(w.get(core.x, core.y, core.z), BLOCK_ID.portal_core);
  tick(g, 80); // portal cooldown
  g.handle(p, { t: 'open', ...core } as any);
  assert.ok(!isRobotic(p.body.pos.x), 'back in the overworld');
  assert.ok(Math.hypot(p.body.pos.x - home.x, p.body.pos.z - home.z) < 6, 'next to the portal you left from');
});

test('a robot fires its laser at you (3 hearts), and a tungsten ingot tames it', () => {
  const { s, storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 5 });
  const w = (g as any).world;
  const { got, conn } = fakeConn();
  const p = g.join(conn, hello('Tamer'))!;
  // A flat, clear arena in the air so line of sight is certain
  const bx = Math.floor(p.body.pos.x), by = Math.floor(p.body.pos.y) + 30, bz = Math.floor(p.body.pos.z);
  for (let dx = -12; dx <= 12; dx++) for (let dz = -3; dz <= 3; dz++) { w.set(bx + dx, by - 1, bz + dz, BLOCK_ID.stone); for (let dy = 0; dy < 4; dy++) w.set(bx + dx, by + dy, bz + dz, 0); }
  p.body.pos.x = bx + 0.5; p.body.pos.y = by; p.body.pos.z = bz + 0.5;
  const robot = (g as any).spawnMob('robot', bx + 8.5, by, bz + 0.5);
  for (let i = 0; i < 600 && p.health >= 20; i++) g.tick(0.05); // up to ~10 shots (robots can miss)
  assert.ok(p.health <= 14, `laser hurt: health ${p.health}`);
  assert.ok(got.some(m => m.t === 'beam'), 'beam shown');
  // Tame it
  p.health = 20;
  robot.body.pos.x = bx + 2.5;
  p.inv.slots[0] = { type: 'tungsten_ingot', count: 2 }; p.inv.selected = 0;
  g.handle(p, { t: 'tame', eid: robot.eid } as any);
  assert.equal(robot.owner, 'Tamer');
  assert.equal(p.inv.slots[0]?.count, 1, 'used one ingot');
  for (let i = 0; i < 100; i++) g.tick(0.05);
  assert.equal(p.health, 20, 'a tamed robot does not shoot you');
  // It fights for you: a zombie nearby gets lasered
  const zombie = (g as any).spawnMob('zombie', bx - 6.5, by, bz + 0.5);
  for (let i = 0; i < 300 && zombie.health >= 20 && zombie.dying < 0; i++) g.tick(0.05);
  assert.ok(zombie.health < 20 || zombie.dying >= 0, 'pet attacked the zombie');
  // Saved with you, and back when you return
  g.leave(p);
  assert.deepEqual(s.players['Tamer'].pets?.length, 1);
  assert.ok(![...(g as any).mobs.values()].some((m: any) => m.owner === 'Tamer'), 'left with its owner');
  g.join(fakeConn().conn, hello('Tamer'))!;
  assert.equal([...(g as any).mobs.values()].filter((m: any) => m.owner === 'Tamer').length, 1);
});

test('a quick block right after a slow one is not refused (log by hand, then leaves)', () => {
  const { storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 5 });
  const w = (g as any).world;
  const p = g.join(fakeConn().conn, hello('Lumberjack'))!;
  const x = Math.floor(p.body.pos.x) + 1, y = Math.floor(p.body.pos.y), z = Math.floor(p.body.pos.z);
  w.set(x, y, z, BLOCK_ID.wood); w.set(x, y + 1, z, BLOCK_ID.leaves);
  tick(g, 60); // the time it takes to punch the log
  g.handle(p, { t: 'dig', x, y, z } as any);
  assert.equal(w.get(x, y, z), 0, 'log broken');
  tick(g, 6); // 0.3s later
  g.handle(p, { t: 'dig', x, y: y + 1, z } as any);
  assert.equal(w.get(x, y + 1, z), 0, 'leaves broken');
});

test('landing in powder snow breaks the fall', () => {
  const { storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 5 });
  const w = (g as any).world;
  const p = g.join(fakeConn().conn, hello('Skier'))!;
  const x = Math.floor(p.body.pos.x), z = Math.floor(p.body.pos.z), y = Math.floor(p.body.pos.y) + 40;
  w.set(x, y - 1, z, BLOCK_ID.stone); w.set(x, y, z, BLOCK_ID.powder_snow); w.set(x, y + 1, z, BLOCK_ID.powder_snow);
  for (let yy = y + 2; yy < y + 26; yy++) w.set(x, yy, z, 0);
  (g as any).teleport(p, x + 0.5, y + 24, z + 0.5);
  // Fall down through the air (the client reports water-like flags inside the snow), then land on the stone
  for (let yy = y + 23; yy >= y + 2; yy -= 2) { tick(g, 4); g.handle(p, { t: 'move', x: x + 0.5, y: yy, z: z + 0.5, yaw: 0, pitch: 0, flags: 0 } as any); }
  tick(g, 4); g.handle(p, { t: 'move', x: x + 0.5, y: y + 1, z: z + 0.5, yaw: 0, pitch: 0, flags: 4 } as any);
  tick(g, 4); g.handle(p, { t: 'move', x: x + 0.5, y, z: z + 0.5, yaw: 0, pitch: 0, flags: 1 | 4 } as any);
  assert.equal(p.health, 20);
});

test('a teleport never lands inside blocks, and a return portal never destroys a chest', () => {
  const { s, storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 5 });
  const w = (g as any).world;
  const p = g.join(fakeConn().conn, hello('Builder'))!;
  const sx = Math.floor(p.spawn[0]), sy = Math.floor(p.spawn[1]), sz = Math.floor(p.spawn[2]);
  for (let dy = 0; dy < 3; dy++) w.set(sx, sy + dy, sz, BLOCK_ID.stone); // spawn point built over
  (g as any).teleport(p, sx + 0.5, sy, sz + 0.5);
  assert.ok(p.body.pos.y >= sy + 3, `lifted out: y=${p.body.pos.y}`);
  // A chest right where a return portal would go (x + 100000 of the portal)
  const portal = buildPortal(g, p);
  const tx = portal.x + 100000, tz = portal.z;
  const top = w.surfaceHeight(tx, tz);
  (g as any).setBlock(tx, top + 1, tz, BLOCK_ID.chest);
  (g as any).chests.set(`${tx},${top + 1},${tz}`, [{ type: 'diamond', count: 5 }]);
  tick(g, 80);
  g.handle(p, { t: 'open', ...portal } as any);
  assert.ok(isRobotic(p.body.pos.x), 'travelled');
  assert.equal(w.get(tx, top + 1, tz), BLOCK_ID.chest, 'chest still there');
  void s;
});

test('creative item list: any item, only in creative', () => {
  const { storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 5, ops: ['*'] });
  const p = g.join(fakeConn().conn, hello('Maker'))!;
  g.handle(p, { t: 'screen', mode: 'inventory' } as any);
  g.handle(p, { t: 'inv', seq: 1, action: { a: 'creative', type: 'diamond', all: true } } as any);
  assert.equal(p.inv.cursor, null, 'refused in survival');
  g.handle(p, { t: 'chat', text: '/gamemode creative 1234' } as any);
  g.handle(p, { t: 'screen', mode: 'inventory' } as any);
  g.handle(p, { t: 'inv', seq: 2, action: { a: 'creative', type: 'diamond', all: true } } as any);
  assert.deepEqual(p.inv.cursor, { type: 'diamond', count: 64 });
  g.handle(p, { t: 'inv', seq: 3, action: { a: 'creative', type: 'constructor', all: true } } as any);
  assert.deepEqual(p.inv.cursor, { type: 'diamond', count: 64 }, 'not an item: ignored');
  g.handle(p, { t: 'inv', seq: 4, action: { a: 'creative', type: null, all: false } } as any);
  assert.equal(p.inv.cursor, null, 'deleted');
});

test('etherite is craftable from a gold ingot and a moonstone', async () => {
  const { recipes } = await import('../../shared/recipes.ts');
  const r = recipes.filter(r => r.result.type === 'etherite' && JSON.stringify(r.shape).includes('moonstone'));
  assert.equal(r.length, 2, 'both ways round');
  const { storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 5 });
  const p = g.join(fakeConn().conn, hello('Smith'))!;
  p.inv.slots[0] = { type: 'gold_ingot', count: 1 }; p.inv.slots[1] = { type: 'moonstone', count: 1 };
  g.handle(p, { t: 'screen', mode: 'inventory' } as any);
  g.handle(p, { t: 'inv', seq: 1, action: { a: 'book', result: 'etherite', shift: false } } as any);
  g.handle(p, { t: 'inv', seq: 2, action: { a: 'click', slot: 54, button: 0, shift: true } } as any);
  assert.ok(p.inv.slots.some(s => s?.type === 'etherite'), JSON.stringify(p.inv.slots.filter(Boolean)));
});

test('creative mode needs the code', () => {
  const { storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 5, ops: ['*'] });
  const c = fakeConn();
  const p = g.join(c.conn, hello('Kid'))!;
  g.handle(p, { t: 'chat', text: '/gamemode creative' } as any);
  assert.equal(p.gamemode, 'survival');
  g.handle(p, { t: 'chat', text: '/gamemode creative 9999' } as any);
  assert.equal(p.gamemode, 'survival');
  assert.ok(chatReplies(c.got).some(t => t.includes('needs the code')));
  g.handle(p, { t: 'chat', text: '/gamemode creative 1234' } as any);
  assert.equal(p.gamemode, 'creative');
  g.handle(p, { t: 'chat', text: '/gamemode survival' } as any);
  assert.equal(p.gamemode, 'survival', 'survival needs no code');
});

test('/sethome and /tphome (one home per piece of etherite armour)', () => {
  const { s, storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 5 });
  const c = fakeConn();
  const p = g.join(c.conn, hello('Homer'))!;
  g.handle(p, { t: 'chat', text: '/sethome 1' } as any);
  assert.ok(chatReplies(c.got).some(t => t.includes('Wear etherite armour')), 'needs armour');
  p.inv.slots[55] = { type: 'etherite_helmet', count: 1 };
  p.inv.slots[56] = { type: 'etherite_chestplate', count: 1 };
  const home = { ...p.body.pos };
  g.handle(p, { t: 'chat', text: '/sethome 2' } as any);
  assert.equal(p.homes[1]?.name, 'Home 2');
  assert.equal(p.homes[0], null, 'slot 1 still empty');
  g.handle(p, { t: 'chat', text: '/sethome 3' } as any);
  assert.ok(chatReplies(c.got).some(t => t.includes('from 1 to 2')), 'only 2 slots');
  (g as any).teleport(p, home.x + 30, home.y + 20, home.z);
  g.handle(p, { t: 'chat', text: '/tphome 1' } as any);
  assert.ok(chatReplies(c.got).some(t => t.includes("isn't set yet")));
  g.handle(p, { t: 'chat', text: '/tphome 2' } as any);
  assert.ok(Math.hypot(p.body.pos.x - home.x, p.body.pos.z - home.z) < 0.01, 'back home');
  g.leave(p);
  assert.equal(s.players['Homer'].homes?.[0], null);
  const again = g.join(fakeConn().conn, hello('Homer'))!;
  assert.equal(again.homes[1]?.name, 'Home 2', 'saved');
});

test('the Robot Titan wakes at its altar, drops obitite, and returns 30 minutes after being defeated', async () => {
  const { nearestAltar } = await import('../../shared/robotic.ts');
  const { s, storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 5 });
  const c = fakeConn();
  const p = g.join(c.conn, hello('Hero'))!;
  const a = nearestAltar(100000, 0, 5)!;
  const w = (g as any).world;
  assert.equal(w.get(a.x, a.y - 1, a.z), BLOCK_ID.altar_core, 'altar generated');
  (g as any).teleport(p, a.x + 20.5, a.y + 1, a.z + 0.5);
  tick(g, 25);
  const titans = () => [...(g as any).mobs.values()].filter((m: any) => m.kind === 'robot_titan');
  assert.equal(titans().length, 1, 'woke up');
  assert.ok(chatReplies(c.got).some(t => t.includes('has awoken')));
  assert.ok(c.got.some(m => m.t === 'boss' && (m as any).hp === 300), 'health bar');
  tick(g, 25);
  assert.equal(titans().length, 1, 'only one per altar');
  // Defeat it
  const t = titans()[0];
  t.health = 1; t.hurt = 0;
  (g as any).damageMob(t, 5, p.body.pos);
  tick(g, 30);
  assert.equal(titans().length, 0);
  const obitite = [...(g as any).items.values()].filter((i: any) => i.type === 'obitite').reduce((n: number, i: any) => n + i.count, 0);
  assert.ok(obitite >= 6, `dropped ${obitite} obitite`);
  assert.ok(chatReplies(c.got).some(t => t.includes('defeated')));
  tick(g, 60);
  assert.equal(titans().length, 0, 'stays away for 30 minutes');
  g.saveAll(true);
  assert.ok(s.world?.titans && Object.values(s.world.titans)[0] > 1700, 'respawn time saved');
});

test('laser cannon (in hand or offhand) hits mobs; a compass bounces robot lasers back', () => {
  const { storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 5, difficulty: 'hard' });
  const w = (g as any).world;
  const { got, conn } = fakeConn();
  const p = g.join(conn, hello('Gunner'))!;
  const bx = Math.floor(p.body.pos.x), by = Math.floor(p.body.pos.y) + 30, bz = Math.floor(p.body.pos.z);
  for (let dx = -14; dx <= 14; dx++) for (let dz = -3; dz <= 3; dz++) { w.set(bx + dx, by - 1, bz + dz, BLOCK_ID.stone); for (let dy = 0; dy < 5; dy++) w.set(bx + dx, by + dy, bz + dz, 0); }
  p.body.pos.x = bx + 0.5; p.body.pos.y = by; p.body.pos.z = bz + 0.5;
  const zombie = (g as any).spawnMob('zombie', bx + 8.5, by, bz + 0.5);
  // Offhand cannon, empty hand: fire along +x at the zombie's chest height
  p.inv.slots[60] = { type: 'laser_cannon', count: 1 };
  const eyeY = by + 1.62, dy = (by + 1 - eyeY) / 8;
  g.handle(p, { t: 'fire', dx: 1, dy, dz: 0 } as any);
  assert.equal(zombie.health, 14, 'hit for 3 hearts');
  assert.ok(got.some(m => m.t === 'beam'));
  g.handle(p, { t: 'fire', dx: 1, dy, dz: 0 } as any);
  assert.equal(zombie.health, 14, 'cooldown');
  // Compass: a robot's laser bounces back at it
  zombie.dying = 0;
  p.inv.slots[60] = { type: 'compass', count: 1 };
  const robot = (g as any).spawnMob('robot', bx - 8.5, by, bz + 0.5);
  for (let i = 0; i < 1200 && robot.health >= 30; i++) { g.tick(0.05); p.health = 20; }
  assert.ok(robot.health < 30, 'robot hurt by its own laser (deflected half the time)');
  assert.ok(got.some(m => m.t === 'toast' && (m as any).text === 'Deflected!'));
});

test('recipes: laser cannon and compass', async () => {
  const { recipes } = await import('../../shared/recipes.ts');
  for (const t of ['laser_cannon', 'compass', 'tungsten_pickaxe', 'obitite_chestplate']) assert.ok(recipes.some(r => r.result.type === t), t);
  const { armorPoints, newInv } = await import('../../shared/inventory.ts');
  const inv = newInv();
  inv.slots[60] = { type: 'diamond_chestplate', count: 1 };
  assert.equal(armorPoints(inv), 0, 'offhand armour does not protect');
});

test('jetpack: three clicks on oil fill it, thrust burns fuel, and thrusting flights cause no fall damage', () => {
  const { storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 5 });
  const w = (g as any).world;
  const { got, conn } = fakeConn();
  const p = g.join(conn, hello('Rocket'))!;
  const x = Math.floor(p.body.pos.x), y = Math.floor(p.body.pos.y), z = Math.floor(p.body.pos.z);
  w.set(x + 2, y, z, BLOCK_ID.oil);
  p.inv.slots[0] = { type: 'jetpack', count: 1 }; p.inv.selected = 0;
  for (let i = 0; i < 3; i++) { g.handle(p, { t: 'refuel', x: x + 2, y, z } as any); tick(g, 8); }
  assert.equal(p.jetFuel, 1, 'full after three clicks');
  assert.ok(got.some(m => m.t === 'fuel' && (m as any).f === 1));
  // Wear it and thrust straight up for a while, then land
  p.inv.slots[56] = p.inv.slots[0]; p.inv.slots[0] = null;
  let yy = p.body.pos.y;
  for (let i = 0; i < 40; i++) { tick(g, 1); yy += 0.3; g.handle(p, { t: 'move', x: p.body.pos.x, y: yy, z: p.body.pos.z, yaw: 0, pitch: 0, flags: 16 } as any); }
  assert.ok(p.jetFuel < 1 && p.jetFuel > 0.9, `burned some fuel: ${p.jetFuel}`);
  // Gently down with thrust, then touch down: no fall damage
  for (let i = 0; i < 40; i++) { tick(g, 1); yy -= 0.3; g.handle(p, { t: 'move', x: p.body.pos.x, y: yy, z: p.body.pos.z, yaw: 0, pitch: 0, flags: 16 } as any); }
  tick(g, 1); g.handle(p, { t: 'move', x: p.body.pos.x, y: y, z: p.body.pos.z, yaw: 0, pitch: 0, flags: 1 } as any);
  assert.equal(p.health, 20);
  // Without fuel the thrust flag counts for nothing
  p.jetFuel = 0;
  (g as any).teleport(p, p.body.pos.x, y, p.body.pos.z);
  yy = y;
  for (let i = 0; i < 40; i++) { tick(g, 1); yy += 0.3; g.handle(p, { t: 'move', x: p.body.pos.x, y: yy, z: p.body.pos.z, yaw: 0, pitch: 0, flags: 16 } as any); }
  tick(g, 1); g.handle(p, { t: 'move', x: p.body.pos.x, y: y, z: p.body.pos.z, yaw: 0, pitch: 0, flags: 1 } as any);
  assert.ok(p.health < 20, 'fell without fuel');
});

test('critical hits (falling after a jump) and achievements', () => {
  const { s, storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 5 });
  const c = fakeConn();
  const p = g.join(c.conn, hello('Champ'))!;
  const achieved = () => new Set(c.got.filter(m => m.t === 'achievements').flatMap(m => (m as any).ids as string[]));
  // Items in the inventory earn achievements
  p.inv.slots[0] = { type: 'iron_ingot', count: 1 };
  (g as any).sendInv(p);
  assert.ok(achieved().has('iron'));
  assert.ok(c.got.some(m => m.t === 'achievements' && (m as any).unlocked === 'iron'), 'banner for the new one');
  // A normal hit, then a hit while falling after a jump
  const x = p.body.pos.x, y = p.body.pos.y, z = p.body.pos.z;
  const zombie = (g as any).spawnMob('zombie', x + 1.5, y, z);
  g.handle(p, { t: 'attack', eid: zombie.eid } as any);
  const normal = 20 - zombie.health;
  tick(g, 20);
  zombie.health = 20; zombie.hurt = 0;
  g.handle(p, { t: 'move', x, y: y + 1.2, z, yaw: 0, pitch: 0, flags: 0 } as any); tick(g, 3);
  g.handle(p, { t: 'move', x, y: y + 0.8, z, yaw: 0, pitch: 0, flags: 0 } as any);
  const before = zombie.health; // (the ticks above can hurt it too, e.g. burning in daylight)
  g.handle(p, { t: 'attack', eid: zombie.eid } as any);
  assert.equal(before - zombie.health, Math.round(normal * 1.5), 'crit does 1.5x');
  assert.ok(c.got.some(m => m.t === 'crit'));
  assert.ok(achieved().has('crit'));
  // Saved with the character
  g.leave(p);
  assert.ok(s.players['Champ'].achievements?.includes('crit'));
});

test('a dropped player keeps their place for a minute and picks up where they were', () => {
  const { s, storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 7, maxPlayers: 4 });
  const a = fakeConn();
  const p = g.join(a.conn, hello('Dropper'))!;
  p.inv.slots[0] = { type: 'dirt', count: 5 };
  g.disconnect(p, a.conn);
  tick(g, 20 * 30); // 30s: still in the world
  assert.equal(g.playerCount, 1);
  // Reconnecting resumes the same player (no new character, no "joined" spam)
  const b = fakeConn();
  const again = g.join(b.conn, hello('Dropper'))!;
  assert.equal(again, p);
  assert.ok(b.got.some(m => m.t === 'welcome'));
  assert.equal(again.inv.slots[0]?.type, 'dirt');
  // A late close of the old connection doesn't drop the new one
  g.disconnect(p, a.conn);
  tick(g, 20 * 70);
  assert.equal(g.playerCount, 1);
  // Dropping for longer than the hold: they leave and are saved
  g.disconnect(p, b.conn);
  tick(g, 20 * 61);
  assert.equal(g.playerCount, 0);
  assert.equal(s.players['Dropper']?.inv.slots[0]?.type, 'dirt');
});

test('quitting on purpose leaves straight away (no held place)', () => {
  const { storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 7, maxPlayers: 4 });
  const a = fakeConn();
  const p = g.join(a.conn, hello('Quitter'))!;
  g.disconnect(p, a.conn, false);
  assert.equal(g.playerCount, 0);
});

test('another tab with the same character takes over; someone else cannot take a held name', () => {
  const { storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 7, maxPlayers: 4 });
  let closed = '';
  const first = { send: () => {}, close: (r: string) => { closed = r; } };
  const p = g.join(first, hello('Tabby'))!;
  const second = fakeConn();
  assert.equal(g.join(second.conn, hello('Tabby')), p);
  assert.match(closed, /somewhere else/);
  g.disconnect(p, second.conn);
  let refused = '';
  assert.equal(g.join({ send: () => {}, close: r => { refused = r; } }, { ...hello('Tabby'), token: 'someone-else' }), null);
  assert.match(refused, /already playing/);
});

test('an invite link starts a newcomer next to the friend who sent it', () => {
  const { storage } = memoryStorage();
  const g = new Game(storage, { creativeCode: TEST_CODE, seed: 7, maxPlayers: 4 });
  const hc = fakeConn();
  const host = g.join(hc.conn, hello('Host'))!;
  // The host just dug the block east of them: the newcomer must not land in that hole
  const hx = Math.floor(host.body.pos.x), hy = Math.floor(host.body.pos.y), hz = Math.floor(host.body.pos.z);
  (g as any).setBlock(hx + 1, hy - 1, hz, 0);
  const c = fakeConn();
  const guest = g.join(c.conn, { ...hello('Guest'), near: 'host' })!;
  assert.ok(Math.hypot(guest.body.pos.x - host.body.pos.x, guest.body.pos.z - host.body.pos.z) <= 2.01, 'beside the host');
  assert.ok(!(Math.floor(guest.body.pos.x) === hx + 1 && Math.floor(guest.body.pos.z) === hz), 'not over the hole');
  // Facing the host (client convention: yaw = atan2(-dx, -dz) towards the target)
  const want = Math.atan2(-(host.body.pos.x - guest.body.pos.x), -(host.body.pos.z - guest.body.pos.z));
  assert.ok(Math.abs(Math.atan2(Math.sin(guest.yaw - want), Math.cos(guest.yaw - want))) < 0.01, 'facing the host');
  // A host down a 1x1 pit: the newcomer still gets a real spot nearby (at the top), not inside the host
  const pit = g.join(fakeConn().conn, hello('Miner'))!;
  const px = Math.floor(pit.body.pos.x) + 30, pz = Math.floor(pit.body.pos.z) + 30;
  const top = (g as any).world.surfaceHeight(px, pz) + 1;
  for (let y = top - 3; y < top; y++) (g as any).setBlock(px, y, pz, 0);
  pit.body.pos.x = px + 0.5; pit.body.pos.y = top - 3; pit.body.pos.z = pz + 0.5;
  const visitor = g.join(fakeConn().conn, { ...hello('Visitor'), near: 'Miner' })!;
  const dv = Math.hypot(visitor.body.pos.x - pit.body.pos.x, visitor.body.pos.z - pit.body.pos.z);
  assert.ok(dv > 0.5 && dv < 4.5, `near the pit, not inside the miner (${dv.toFixed(1)})`);
  // The host gets one message about it, not two
  const joinedMsgs = hc.got.filter(m => m.t === 'chat' && (m as any).text.includes('Guest'));
  assert.equal(joinedMsgs.length, 1);
  assert.match((joinedMsgs[0] as any).text, /invite link/);
  // A returning player keeps their own saved place
  g.leave(guest);
  host.body.pos.x += 100;
  const back = g.join(fakeConn().conn, { ...hello('Guest'), near: 'Host' })!;
  assert.ok(Math.abs(back.body.pos.x - host.body.pos.x) > 50);
});
