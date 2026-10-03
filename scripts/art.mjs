// Draws Riventale's crest, wordmark and icons as pixel art. Run: node scripts/art.mjs
// Writes SVGs and PNGs into public/ (Vite copies them to the site root). The PNGs are committed, so
// this only needs re-running after a change. sharp comes with wrangler (through miniflare).
import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const OUT = new URL('../public/', import.meta.url);
mkdirSync(OUT, { recursive: true });
const save = (name, data) => writeFileSync(new URL(name, OUT), data);

const INK = '#170f2b';
const px = (x, y, fill, w = 1, h = 1) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;

// The crest: a crystal split into the four elements (storm, fire, frost, forest) round a white core.
// 32 x 32 grid.
function crest() {
  const c = 15.5, R = 14;
  const quad = (x, y) => (y < c ? (x < c ? 'storm' : 'fire') : (x < c ? 'forest' : 'frost'));
  const shades = {
    storm: ['#fff3a8', '#ffd23f', '#d99a12'],
    fire: ['#ffb27a', '#ff6a2a', '#c23a10'],
    frost: ['#b8ecff', '#3fb4ff', '#1a6fd1'],
    forest: ['#a8f0a0', '#3fc25a', '#1f7d3a'],
  };
  const out = [];
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const d = Math.abs(x - c) + Math.abs(y - c);
    if (d > R) continue;
    if (d > R - 1.5) { out.push(px(x, y, INK)); continue; }
    const s = shades[quad(x, y)];
    // Light from the top left: lit facets near that edge, dark near the bottom right.
    const lean = (x - c) + (y - c);
    let fill = lean < -9 ? s[0] : lean > 7 ? s[2] : s[1];
    if (d > R - 2.5 && lean < -3) fill = s[0];
    // The seams between elements
    if (Math.abs(x - c) < 0.6 || Math.abs(y - c) < 0.6) fill = '#ffffff';
    out.push(px(x, y, fill));
  }
  // The core
  out.push(px(13, 13, '#ffffff', 6, 6), px(14, 12, '#ffffff', 4, 1), px(14, 19, '#ffffff', 4, 1),
    px(12, 14, '#ffffff', 1, 4), px(19, 14, '#ffffff', 1, 4), px(14, 14, '#fffbe0', 4, 4), px(15, 15, '#ffe680', 2, 2));
  // Sparkles
  out.push(px(8, 9, '#ffffff'), px(9, 8, '#ffffff'), px(22, 23, '#ffffff', 1, 1));
  return out.join('');
}

const svg = (w, h, body, extra = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges"${extra}>${body}</svg>\n`;

const crestSvg = svg(32, 32, crest());
save('crest.svg', crestSvg);
save('favicon.svg', crestSvg);

// An opaque tile for home screens and app icons: night sky, crest in the middle.
const tile = (pad) => svg(32 + pad * 2, 32 + pad * 2,
  `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a1d5c"/><stop offset="1" stop-color="#0d0a1f"/></linearGradient></defs>` +
  `<rect width="${32 + pad * 2}" height="${32 + pad * 2}" fill="url(#sky)"/><g transform="translate(${pad} ${pad})">${crest()}</g>`);

// The wordmark: RIVENTALE in a 5 x 7 pixel font, gold with an ink outline and drop shadow.
const GLYPHS = {
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10111', '10001', '10001', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  ' ': ['000', '000', '000', '000', '000', '000', '000'],
};
function wordmark(text) {
  const on = new Set();
  let left = 1;
  for (const ch of text) {
    GLYPHS[ch].forEach((row, y) => [...row].forEach((b, x) => { if (b === '1') on.add(`${left + x},${y + 1}`); }));
    left += GLYPHS[ch][0].length + 1;
  }
  const w = left + 1, h = 10;
  const edge = new Set(), shadow = new Set();
  for (const k of on) {
    const [x, y] = k.split(',').map(Number);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) edge.add(`${x + dx},${y + dy}`);
    for (let dy = 0; dy <= 2; dy++) for (let dx = 0; dx <= 1; dx++) shadow.add(`${x + dx},${y + dy}`);
  }
  const rects = (set, fill) => [...set].map(k => { const [x, y] = k.split(',').map(Number); return px(x, y, fill); }).join('');
  return svg(w, h,
    `<defs><linearGradient id="gold" gradientUnits="userSpaceOnUse" x1="0" y1="1" x2="0" y2="8">` +
    `<stop offset="0" stop-color="#fff6c8"/><stop offset="0.45" stop-color="#ffd23f"/><stop offset="1" stop-color="#ff8a1f"/></linearGradient></defs>` +
    `<g fill="${INK}">${rects(shadow, INK)}${rects(edge, INK)}</g>` +
    `<g>${[...on].map(k => { const [x, y] = k.split(',').map(Number); return px(x, y, 'url(#gold)'); }).join('')}</g>`);
}
save('wordmark.svg', wordmark('RIVENTALE'));
save('title-path.svg', wordmark('CHOOSE YOUR PATH'));
save('title-load.svg', wordmark('LOAD GAME'));

// 16 x 16 icons for the difficulty cards: a sapling (easy), a sword (medium), a flame (hard)
function sprite(rows, colours) {
  return svg(16, 16, rows.flatMap((row, y) => [...row].map((ch, x) => colours[ch] ? px(x, y, colours[ch]) : '')).join(''));
}
save('icon-easy.svg', sprite([
  '................',
  '......ll........',
  '.....lggl...ll..',
  '.....lgggl.lggl.',
  '......lgggGgggl.',
  '.......lggGggl..',
  '........lGGll...',
  '.........b......',
  '.........b......',
  '........bb......',
  '........b.......',
  '.....ddddddd....',
  '....dDDDDDDDd...',
  '.....ddddddd....',
  '................',
  '................',
], { l: '#a8f0a0', g: '#3fc25a', G: '#1f7d3a', b: '#8a5a2b', d: '#6b4423', D: '#4a2e17' }));
save('icon-medium.svg', sprite([
  '................',
  '.............ww.',
  '............wss.',
  '...........wsS..',
  '..........wsS...',
  '.........wsS....',
  '........wsS.....',
  '...h...wsS......',
  '...hh.wsS.......',
  '....hhsS........',
  '.....hh.........',
  '....bhhh........',
  '...bb..hh.......',
  '..bb............',
  '.bb.............',
  '................',
], { w: '#ffffff', s: '#cfd8e6', S: '#7d8aa3', h: '#ffd23f', b: '#8a5a2b' }));
save('icon-hard.svg', sprite([
  '................',
  '.......r........',
  '......rr....r...',
  '.....rror..rr...',
  '....rrooor.rr...',
  '....rooyoorrr...',
  '...rrooyyoorr...',
  '...roooyyyoor...',
  '..rrooyyyyoorr..',
  '..rooyyywyyoor..',
  '..rooyywwwyoor..',
  '..rroyywwwyorr..',
  '...rooyyyyyor...',
  '....rrooooorr...',
  '......rrrrr.....',
  '................',
], { r: '#c23a10', o: '#ff6a2a', y: '#ffd23f', w: '#fff6c8' }));

// PNG icons. Pixel art is scaled with nearest-neighbour so the edges stay sharp.
const png = async (src, size, name) => {
  const raster = await sharp(Buffer.from(src), { density: 72 }).png().toBuffer();
  await sharp(raster).resize(size, size, { kernel: 'nearest' }).png().toFile(new URL(name, OUT).pathname.replace(/^\/(\w:)/, '$1'));
};
await png(crestSvg, 32, 'favicon-32.png');
await png(tile(4), 180, 'apple-touch-icon.png');
await png(tile(4), 192, 'icon-192.png');
await png(tile(8), 512, 'icon-512.png');

save('manifest.webmanifest', JSON.stringify({
  name: 'Riventale',
  short_name: 'Riventale',
  start_url: './',
  display: 'fullscreen',
  background_color: '#0d0a1f',
  theme_color: '#0d0a1f',
  icons: [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
  ],
}, null, 2) + '\n');
console.log('Art written to public/');
