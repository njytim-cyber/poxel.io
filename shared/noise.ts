// Seeded Perlin noise (2D + 3D) and integer hashing for deterministic world generation.

export class Noise {
  private perm = new Uint8Array(512);

  constructor(seed: number) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    let s = (seed >>> 0) || 1;
    const rand = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  noise3(x: number, y: number, z: number): number {
    const P = this.perm;
    const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
    x -= X; y -= Y; z -= Z;
    const xi = X & 255, yi = Y & 255, zi = Z & 255;
    const u = fade(x), v = fade(y), w = fade(z);
    const A = P[xi] + yi, AA = P[A] + zi, AB = P[A + 1] + zi;
    const B = P[xi + 1] + yi, BA = P[B] + zi, BB = P[B + 1] + zi;
    return lerp(w,
      lerp(v, lerp(u, grad3(P[AA], x, y, z), grad3(P[BA], x - 1, y, z)),
              lerp(u, grad3(P[AB], x, y - 1, z), grad3(P[BB], x - 1, y - 1, z))),
      lerp(v, lerp(u, grad3(P[AA + 1], x, y, z - 1), grad3(P[BA + 1], x - 1, y, z - 1)),
              lerp(u, grad3(P[AB + 1], x, y - 1, z - 1), grad3(P[BB + 1], x - 1, y - 1, z - 1))));
  }

  noise2(x: number, y: number): number {
    return this.noise3(x, y, 0.5);
  }

  // Fractal noise, roughly in [-1, 1]
  fbm2(x: number, y: number, octaves: number): number {
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += this.noise2(x * freq, y * freq) * amp;
      norm += amp; amp *= 0.5; freq *= 2;
    }
    return sum / norm;
  }
}

function fade(t: number) { return t * t * t * (t * (t * 6 - 15) + 10); }
function lerp(t: number, a: number, b: number) { return a + t * (b - a); }
function grad3(h: number, x: number, y: number, z: number) {
  h &= 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
  return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
}

// Deterministic hash of integer coords -> [0, 1)
export function hash3(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647) ^ Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
