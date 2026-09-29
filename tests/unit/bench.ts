// Quick generation/meshing benchmark (not part of the test run): node tests/unit/bench.ts
import { generateChunkData } from '../../shared/worldgen.ts';

const N = 40;
generateChunkData(0, 0, 12345); // warm up
const t = performance.now();
for (let i = 0; i < N; i++) generateChunkData(100 + i, 7, 12345);
console.log('generation ms/chunk', ((performance.now() - t) / N).toFixed(2));
