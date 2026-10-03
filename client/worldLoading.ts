// The loading screen for single-player worlds: from pressing New Game (or a save) until the ground
// around you is there. The bar follows the chunks loaded near the player.
import { body } from './player';
import { isLoaded } from './world';

const screen = document.getElementById('world-loading');
const title = document.getElementById('wl-title');
const step = document.getElementById('wl-step');
const fill = document.getElementById('wl-fill');
const tip = document.getElementById('wl-tip');

const NEW_STEPS = ['Raising the mountains...', 'Carving the rivers...', 'Planting the forests...', 'Hiding ores in the deep...',
  'Waking the elemental temples...', 'Scattering the stars...', 'Lighting the sun...'];
const LOAD_STEPS = ['Finding your footprints...', 'Unpacking your chests...', 'Waking the mobs...', 'Lighting the sun...'];
const TIPS = [
  'Four elemental bosses guard their temples. Each drops a piece of elemental armour.',
  'Hunger heals you on Medium. Keep some food in your hotbar.',
  'Crystal towers mark the temples. Look for them on the horizon.',
  'Press H to set your home, so you can find your way back.',
  'Storms bring lightning. Stay out of the open when the sky turns dark.',
  'Banners and dyes let you mark your base in your own colours.',
];

const MIN_MS = 1400; // long enough to read, short enough not to get in the way
const MAX_MS = 12000;
let timer = 0, t0 = 0, steps = NEW_STEPS, inWorld = false, shown = 0;

// 5 x 5 chunks round the player; the inner 3 x 3 must be there before the screen goes
function progress(): { done: number; ready: boolean } {
  const { x, z } = body.pos;
  let got = 0, inner = true;
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
    const loaded = isLoaded(Math.floor(x + dx * 16), Math.floor(z + dz * 16));
    if (loaded) got++;
    else if (Math.abs(dx) <= 1 && Math.abs(dz) <= 1) inner = false;
  }
  return { done: got / 25, ready: inner };
}

function tick() {
  const ms = performance.now() - t0;
  // Before the world is there, creep up to 15%; then follow the chunks
  let pct = Math.min(15, ms / 80);
  let ready = false;
  if (inWorld) {
    const p = progress();
    pct = 15 + p.done * 85;
    ready = p.ready;
  }
  shown = Math.max(shown, pct); // never goes backwards
  if (fill) fill.style.width = `${shown.toFixed(1)}%`;
  const i = Math.min(steps.length - 1, Math.floor((shown / 100) * steps.length));
  if (step && step.textContent !== steps[i]) step.textContent = steps[i];
  if ((ready && ms > MIN_MS) || ms > MAX_MS) hideWorldLoading();
}

export function showWorldLoading(isNew: boolean) {
  if (!screen) return;
  steps = isNew ? NEW_STEPS : LOAD_STEPS;
  if (title) title.textContent = isNew ? 'Forging your world' : 'Returning to your world';
  if (tip) tip.textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
  inWorld = false; shown = 0; t0 = performance.now();
  screen.classList.remove('wl-out');
  screen.style.display = 'flex';
  clearInterval(timer);
  timer = window.setInterval(tick, 100);
  tick();
}

// The world has started: from now the bar follows the chunks
export function worldLoadingReady() { inWorld = true; }

export function hideWorldLoading() {
  clearInterval(timer);
  if (!screen || screen.style.display === 'none') return;
  if (fill) fill.style.width = '100%';
  screen.classList.add('wl-out');
  setTimeout(() => { if (screen.classList.contains('wl-out')) screen.style.display = 'none'; }, 450);
}
