// Quick generation/meshing benchmark (not part of the test run): node tests/unit/bench.ts
import { generateChunkData, computeHeights, meshSection, MIN_Y, MAX_Y, PAD_B, PAD_H, type SectionInput } from '../../shared/worldgen.ts';

const N = 40;
generateChunkData(0, 0, 12345); // warm up
const t = performance.now();
for (let i = 0; i < N; i++) generateChunkData(100 + i, 7, 12345);
console.log('generation ms/chunk', ((performance.now() - t) / N).toFixed(2));

// Meshing: every section of a few chunks, with their neighbours (as the client does)
const data = new Map<string, { data: Uint8Array; heights: Int16Array }>();
const chunk = (cx: number, cz: number) => {
  const k = `${cx},${cz}`;
  let c = data.get(k);
  if (!c) { const d = generateChunkData(cx, cz, 12345); c = { data: d, heights: computeHeights(d) }; data.set(k, c); }
  return c;
};
function input(cx: number, cz: number, sec: number): SectionInput {
  const y0 = MIN_Y + sec * 16;
  const pick = (x: number, z: number) => chunk(cx + (x < 0 ? -1 : x > 15 ? 1 : 0), cz + (z < 0 ? -1 : z > 15 ? 1 : 0));
  const blocks = new Uint8Array(PAD_B * PAD_B * PAD_B);
  for (let y = -1; y <= 16; y++) for (let z = -1; z <= 16; z++) for (let x = -1; x <= 16; x++) {
    const wy = y0 + y;
    blocks[((y + 1) * PAD_B + (z + 1)) * PAD_B + (x + 1)] = wy < MIN_Y ? 9 : wy > MAX_Y ? 0 : pick(x, z).data[((wy - MIN_Y) << 8) | ((z & 15) << 4) | (x & 15)];
  }
  const heights = new Int16Array(PAD_H * PAD_H);
  for (let z = -3; z <= 18; z++) for (let x = -3; x <= 18; x++) heights[(z + 3) * PAD_H + (x + 3)] = pick(x, z).heights[((z & 15) << 4) | (x & 15)];
  return { y0, blocks, heights, facing: [] };
}
const SECTIONS = Math.ceil((MAX_Y - MIN_Y + 1) / 16);
const inputs: SectionInput[] = [];
for (let i = 0; i < 9; i++) for (let s = 0; s < SECTIONS; s++) inputs.push(input(200 + (i % 3), 50 + Math.floor(i / 3), s));
for (const inp of inputs.slice(0, SECTIONS)) meshSection(inp); // warm up
const t2 = performance.now();
for (const inp of inputs) meshSection(inp);
console.log('meshing ms/chunk', ((performance.now() - t2) / 9).toFixed(2));
