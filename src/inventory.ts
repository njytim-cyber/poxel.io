import { checkCraftingRecipe, recipes } from './recipes';
import { itemDef } from './blocks';
import { getIconURL } from './textures';
import { getFurnace, SMELT_TIME, type FurnaceState } from './furnace';

export type InventoryItem = { type: string; count: number } | null;

// 0-8 hotbar, 9-44 main, 45-53 crafting grid, 54 craft result, 55-59 armor (helmet, chest, legs, boots, gauntlets)
export const inventory: InventoryItem[] = new Array(60).fill(null);
export let selectedSlotIndex = 0;
export type ScreenMode = 'inventory' | 'table' | 'furnace';
let mode: ScreenMode = 'inventory';
let furnace: FurnaceState | null = null;
let cursor: InventoryItem = null;

const GRID_2 = [45, 46, 48, 49];
const GRID_3 = [45, 46, 47, 48, 49, 50, 51, 52, 53];
const gridIndices = () => (mode === 'table' ? GRID_3 : GRID_2);

// ------------------------------------------------------------------ Change notification

const listeners: (() => void)[] = [];
export function onInventoryChange(cb: () => void) { listeners.push(cb); }
function changed() {
  renderInventoryBar();
  if (isOpen) renderFullInventory();
  for (const cb of listeners) cb();
}

let dropHandler: (type: string, count: number) => void = () => {};
export function setDropHandler(fn: (type: string, count: number) => void) { dropHandler = fn; }
let closeHandler: () => void = () => closeScreen();
export function setCloseHandler(fn: () => void) { closeHandler = fn; }

// ------------------------------------------------------------------ Basic ops

const maxStack = (type: string) => itemDef(type).stack;

export function setSelectedSlot(index: number) {
  selectedSlotIndex = ((index % 9) + 9) % 9;
  renderInventoryBar();
  const item = inventory[selectedSlotIndex];
  showItemName(item ? itemDef(item.type).name : '');
}

export function getSelectedItem(): InventoryItem {
  return inventory[selectedSlotIndex];
}

// Adds to hotbar+main inventory; returns how many didn't fit
export function addItem(type: string, count = 1): number {
  const max = maxStack(type);
  const order = [...Array(45).keys()];
  for (const i of order) {
    const it = inventory[i];
    if (it && it.type === type && it.count < max) {
      const n = Math.min(max - it.count, count);
      it.count += n; count -= n;
      if (count <= 0) break;
    }
  }
  if (count > 0) for (const i of order) {
    if (!inventory[i]) {
      const n = Math.min(max, count);
      inventory[i] = { type, count: n }; count -= n;
      if (count <= 0) break;
    }
  }
  changed();
  return count;
}

export function removeItem(index: number, count = 1): boolean {
  const it = inventory[index];
  if (!it || it.count < count) return false;
  it.count -= count;
  if (it.count <= 0) inventory[index] = null;
  changed();
  return true;
}

export function clearInventory() {
  inventory.fill(null);
  cursor = null;
  changed();
}

export function setInventoryData(data: any[]) {
  for (let i = 0; i < inventory.length; i++) {
    const d = data?.[i];
    inventory[i] = d && typeof d.type === 'string' && d.count > 0 ? { type: d.type, count: d.count | 0 } : null;
  }
  inventory[54] = null;
  changed();
}

// ------------------------------------------------------------------ Crafting

function currentRecipe() {
  const cols = mode === 'table' ? 3 : 2;
  const types = gridIndices().map(i => inventory[i]?.type || null);
  return checkCraftingRecipe(types, cols);
}

export function refreshCrafting() {
  const r = currentRecipe();
  inventory[54] = r ? { type: r.type, count: r.count } : null;
}

function consumeGrid() {
  for (const i of gridIndices()) {
    const it = inventory[i];
    if (it) { it.count--; if (it.count <= 0) inventory[i] = null; }
  }
}

function craftClick(shift: boolean) {
  let r = currentRecipe();
  if (!r) return;
  if (shift) {
    for (let n = 0; n < 64 && r; n++) {
      if (!fitsInInventory(r.type, r.count)) break;
      consumeGrid();
      addItemSilently(r.type, r.count);
      r = currentRecipe();
    }
    return;
  }
  if (!cursor) cursor = { type: r.type, count: r.count };
  else if (cursor.type === r.type && cursor.count + r.count <= maxStack(r.type)) cursor.count += r.count;
  else return;
  consumeGrid();
}

function fitsInInventory(type: string, count: number) {
  const max = maxStack(type);
  let room = 0;
  for (let i = 0; i < 45; i++) {
    const it = inventory[i];
    if (!it) room += max; else if (it.type === type) room += max - it.count;
    if (room >= count) return true;
  }
  return false;
}

function addItemSilently(type: string, count: number) {
  const saved = listeners.length;
  void saved;
  const max = maxStack(type);
  for (let i = 0; i < 45 && count > 0; i++) {
    const it = inventory[i];
    if (it && it.type === type && it.count < max) { const n = Math.min(max - it.count, count); it.count += n; count -= n; }
  }
  for (let i = 0; i < 45 && count > 0; i++) {
    if (!inventory[i]) { const n = Math.min(max, count); inventory[i] = { type, count: n }; count -= n; }
  }
  return count;
}

// ------------------------------------------------------------------ Slot model

interface SlotRef {
  get(): InventoryItem;
  set(v: InventoryItem): void;
  accepts(type: string): boolean;
  kind: 'normal' | 'result' | 'output';
  index?: number;
}

const invSlot = (i: number): SlotRef => ({
  get: () => inventory[i],
  set: v => { inventory[i] = v; },
  accepts: type => i < 55 || itemDef(type).armor?.slot === i - 55,
  kind: i === 54 ? 'result' : 'normal',
  index: i,
});

const furnaceSlot = (field: 'input' | 'fuel' | 'output'): SlotRef => ({
  get: () => furnace ? furnace[field] : null,
  set: v => { if (furnace) furnace[field] = v; },
  accepts: type => field === 'input' || (field === 'fuel' && !!itemDef(type).fuel),
  kind: field === 'output' ? 'output' : 'normal',
});

// Shift-click destination ranges
function quickMove(ref: SlotRef) {
  const it = ref.get();
  if (!it) return;
  let targets: number[];
  const i = ref.index;
  const armorSlot = itemDef(it.type).armor?.slot;
  if (i !== undefined && i < 45 && armorSlot !== undefined && !inventory[55 + armorSlot]) {
    inventory[55 + armorSlot] = it; ref.set(null); return;
  }
  if (i !== undefined && i < 9) targets = range(9, 45);
  else if (i !== undefined && i < 45) targets = mode === 'furnace' && furnace ? [] : range(0, 9);
  else targets = [...range(9, 45), ...range(0, 9)];

  if (mode === 'furnace' && furnace && i !== undefined && i < 45) {
    // Send smeltables to the input, fuel to the fuel slot
    const def = itemDef(it.type);
    const target: 'input' | 'fuel' | null = def.smelt ? 'input' : def.fuel ? 'fuel' : null;
    if (target) {
      const cur = furnace[target];
      if (!cur) { furnace[target] = it; ref.set(null); return; }
      if (cur.type === it.type) {
        const n = Math.min(maxStack(it.type) - cur.count, it.count);
        cur.count += n; it.count -= n;
        if (it.count <= 0) ref.set(null);
        return;
      }
    }
    targets = i < 9 ? range(9, 45) : range(0, 9);
  }

  const max = maxStack(it.type);
  for (const t of targets) {
    const d = inventory[t];
    if (d && d.type === it.type && d.count < max) { const n = Math.min(max - d.count, it.count); d.count += n; it.count -= n; }
    if (it.count <= 0) break;
  }
  for (const t of targets) {
    if (it.count <= 0) break;
    if (!inventory[t]) { inventory[t] = { type: it.type, count: it.count }; it.count = 0; }
  }
  if (it.count <= 0) ref.set(null);
}

const range = (a: number, b: number) => Array.from({ length: b - a }, (_, k) => a + k);

function clickSlot(ref: SlotRef, button: number, shift: boolean) {
  if (ref.kind === 'result') { craftClick(shift); afterClick(); return; }
  const slot = ref.get();

  if (ref.kind === 'output') {
    if (!slot) return;
    if (shift) { const left = addItemSilently(slot.type, slot.count); ref.set(left > 0 ? { type: slot.type, count: left } : null); }
    else if (!cursor) { cursor = slot; ref.set(null); }
    else if (cursor.type === slot.type) {
      const n = Math.min(maxStack(slot.type) - cursor.count, slot.count);
      cursor.count += n; slot.count -= n;
      if (slot.count <= 0) ref.set(null);
    }
    afterClick(); return;
  }

  if (shift && slot) { quickMove(ref); afterClick(); return; }

  if (button === 2) {
    if (!cursor && slot) {
      const half = Math.ceil(slot.count / 2);
      cursor = { type: slot.type, count: half };
      slot.count -= half;
      if (slot.count <= 0) ref.set(null);
    } else if (cursor && ref.accepts(cursor.type)) {
      if (!slot) { ref.set({ type: cursor.type, count: 1 }); cursor.count--; }
      else if (slot.type === cursor.type && slot.count < maxStack(slot.type)) { slot.count++; cursor.count--; }
      if (cursor.count <= 0) cursor = null;
    }
  } else {
    if (!cursor) { if (slot) { cursor = slot; ref.set(null); } }
    else if (!slot) { if (ref.accepts(cursor.type)) { ref.set(cursor); cursor = null; } }
    else if (slot.type === cursor.type) {
      const n = Math.min(maxStack(slot.type) - slot.count, cursor.count);
      slot.count += n; cursor.count -= n;
      if (cursor.count <= 0) cursor = null;
    } else if (ref.accepts(cursor.type)) { ref.set(cursor); cursor = slot; }
  }
  afterClick();
}

function afterClick() {
  ghost = null;
  refreshCrafting();
  changed();
  renderCursor();
}

// ------------------------------------------------------------------ Screen open/close

export let isOpen = false;

export function openScreen(m: ScreenMode, furnaceKey?: string) {
  mode = m;
  furnace = m === 'furnace' && furnaceKey ? getFurnace(furnaceKey) : null;
  isOpen = true;
  ghost = null;
  const modal = document.getElementById('full-inventory-modal');
  if (modal) modal.style.display = 'flex';
  refreshCrafting();
  renderFullInventory();
}

// Puts the crafting grid and cursor back into the inventory (dropping overflow), hides the screen
export function closeScreen() {
  if (!isOpen) return;
  isOpen = false;
  for (const i of GRID_3) {
    const it = inventory[i];
    if (it) { inventory[i] = null; const left = addItemSilently(it.type, it.count); if (left) dropHandler(it.type, left); }
  }
  inventory[54] = null;
  if (cursor) { const left = addItemSilently(cursor.type, cursor.count); if (left) dropHandler(cursor.type, left); cursor = null; }
  furnace = null;
  const modal = document.getElementById('full-inventory-modal');
  if (modal) modal.style.display = 'none';
  renderCursor();
  changed();
}

// ------------------------------------------------------------------ Rendering

function fillSlotEl(el: HTMLElement, item: InventoryItem) {
  el.innerHTML = '';
  if (!item) { el.title = ''; return; }
  const img = document.createElement('img');
  img.src = getIconURL(item.type);
  img.draggable = false;
  img.className = 'item-img';
  el.appendChild(img);
  el.title = itemDef(item.type).name;
  if (item.count > 1) {
    const c = document.createElement('span');
    c.className = 'count';
    c.textContent = String(item.count);
    el.appendChild(c);
  }
}

// Long press on a stack picks up half of it (20/40), a quick click picks up everything
const LONG_PRESS_MS = 350;
let pendingPress: { ref: SlotRef; timer: number } | null = null;
let splitLabel = '';
let splitTimer = 0;

function slotEl(ref: SlotRef, extraClass = ''): HTMLElement {
  const el = document.createElement('div');
  el.className = 'slot ' + extraClass;
  fillSlotEl(el, ref.get());
  el.addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation();
    const slot = ref.get();
    if (e.button === 0 && !e.shiftKey && !cursor && slot && slot.count > 1 && ref.kind === 'normal') {
      const timer = window.setTimeout(() => {
        pendingPress = null;
        const total = slot.count;
        clickSlot(ref, 2, false); // right-click logic = take half
        if (cursor) showSplit(`${cursor.count}/${total}`);
      }, LONG_PRESS_MS);
      pendingPress = { ref, timer };
      return;
    }
    clickSlot(ref, e.button, e.shiftKey);
  });
  el.addEventListener('mousedown', e => e.stopPropagation()); // keep inventory clicks away from mining
  el.addEventListener('contextmenu', e => e.preventDefault());
  return el;
}

function finishPress() {
  if (!pendingPress) return;
  clearTimeout(pendingPress.timer);
  const ref = pendingPress.ref;
  pendingPress = null;
  clickSlot(ref, 0, false);
}

function showSplit(text: string) {
  splitLabel = text;
  renderCursor();
  clearTimeout(splitTimer);
  splitTimer = window.setTimeout(() => { splitLabel = ''; renderCursor(); }, 1500);
}

export function renderInventoryBar() {
  const bar = document.getElementById('inventory-bar');
  if (!bar) return;
  // Reuse existing slot elements to avoid layout thrash on every pickup
  if (bar.children.length !== 9) {
    bar.innerHTML = '';
    for (let i = 0; i < 9; i++) {
      const el = document.createElement('div');
      el.className = 'slot';
      el.addEventListener('click', () => setSelectedSlot(i));
      bar.appendChild(el);
    }
  }
  for (let i = 0; i < 9; i++) {
    const el = bar.children[i] as HTMLElement;
    el.classList.toggle('active', i === selectedSlotIndex);
    fillSlotEl(el, inventory[i]);
  }
}

export function renderFullInventory() {
  const grid = document.getElementById('full-inventory-grid');
  if (!grid) return;
  grid.innerHTML = '';
  for (let i = 9; i < 45; i++) grid.appendChild(slotEl(invSlot(i)));
  for (let i = 0; i < 9; i++) grid.appendChild(slotEl(invSlot(i), i === 0 ? 'hotbar-start' : ''));

  const craftingArea = document.getElementById('crafting-area');
  const furnaceArea = document.getElementById('furnace-area');
  const armorArea = document.getElementById('armor-area');
  if (craftingArea) craftingArea.style.display = mode === 'furnace' ? 'none' : 'block';
  if (furnaceArea) furnaceArea.style.display = mode === 'furnace' ? 'block' : 'none';
  if (armorArea) armorArea.style.display = mode === 'inventory' ? 'flex' : 'none';
  const title = document.getElementById('crafting-title');
  if (title) title.textContent = mode === 'table' ? 'Crafting Table' : 'Crafting';

  const cGrid = document.getElementById('crafting-grid');
  if (cGrid) {
    cGrid.innerHTML = '';
    cGrid.className = mode === 'table' ? 'grid-3x3' : 'grid-2x2';
    const cols = mode === 'table' ? 3 : 2;
    gridIndices().forEach((i, k) => {
      const el = slotEl(invSlot(i));
      // Faded ingredient icons for a recipe picked in the book but not yet craftable
      const g = ghost?.shape[Math.floor(k / cols)]?.[k % cols];
      if (g && !inventory[i]) {
        const img = document.createElement('img');
        img.src = getIconURL(g);
        img.className = 'item-img ghost';
        el.appendChild(img);
      }
      cGrid.appendChild(el);
    });
  }
  renderRecipeBook();
  const cResult = document.getElementById('crafting-result');
  if (cResult) { cResult.innerHTML = ''; cResult.appendChild(slotEl(invSlot(54), 'result-slot')); }

  const aGrid = document.getElementById('armor-grid');
  if (aGrid) {
    aGrid.innerHTML = '';
    const labels = ['helmet', 'chest', 'legs', 'boots', 'hands'];
    for (let i = 55; i <= 59; i++) {
      const el = slotEl(invSlot(i), 'armor-slot-ui');
      if (!inventory[i]) el.dataset.label = labels[i - 55];
      aGrid.appendChild(el);
    }
  }
  if (mode === 'furnace') renderFurnace();
}

function renderFurnace() {
  const put = (id: string, field: 'input' | 'fuel' | 'output') => {
    const host = document.getElementById(id);
    if (host) { host.innerHTML = ''; host.appendChild(slotEl(furnaceSlot(field), field === 'output' ? 'result-slot' : '')); }
  };
  put('furnace-input', 'input');
  put('furnace-fuel', 'fuel');
  put('furnace-output', 'output');
  updateFurnaceGauges();
}

export function updateFurnaceGauges() {
  if (!furnace) return;
  const flame = document.getElementById('furnace-flame');
  const arrow = document.getElementById('furnace-arrow-fill');
  if (flame) flame.style.height = `${furnace.burnTotal ? Math.max(0, furnace.burnLeft / furnace.burnTotal) * 100 : 0}%`;
  if (arrow) arrow.style.width = `${(furnace.progress / SMELT_TIME) * 100}%`;
}

// Furnace contents change while the screen is open; refresh only the slots
export function refreshFurnaceSlots() {
  if (isOpen && mode === 'furnace') renderFurnace();
}

// ------------------------------------------------------------------ Recipe book (Minecraft style)

type Recipe = (typeof recipes)[number];
let ghost: Recipe | null = null;
let bookOpen = (() => { try { return localStorage.getItem('poxel_book') !== '0'; } catch { return true; } })();

// All recipes grouped by what they make (e.g. planks from oak/birch/pine logs)
const recipeGroups = (() => {
  const map = new Map<string, Recipe[]>();
  for (const r of recipes) {
    const list = map.get(r.result.type) || [];
    list.push(r);
    map.set(r.result.type, list);
  }
  return [...map.entries()];
})();

function needs(r: Recipe): Map<string, number> {
  const m = new Map<string, number>();
  for (const row of r.shape) for (const c of row) if (c) m.set(c, (m.get(c) || 0) + 1);
  return m;
}

function available(): Map<string, number> {
  const m = new Map<string, number>();
  for (const i of [...range(0, 45), ...GRID_3]) { const it = inventory[i]; if (it) m.set(it.type, (m.get(it.type) || 0) + it.count); }
  return m;
}

const fitsGrid = (r: Recipe) => r.shape.length <= (mode === 'table' ? 3 : 2) && r.shape[0].length <= (mode === 'table' ? 3 : 2);
function maxSets(r: Recipe, have: Map<string, number>) {
  let n = Infinity;
  for (const [t, c] of needs(r)) n = Math.min(n, Math.floor((have.get(t) || 0) / c));
  return n;
}

// Moves grid contents back to the inventory, then lays out `sets` copies of the recipe
function fillGrid(r: Recipe, sets: number) {
  for (const i of GRID_3) {
    const it = inventory[i];
    if (it) { inventory[i] = null; const left = addItemSilently(it.type, it.count); if (left) dropHandler(it.type, left); }
  }
  const cols = mode === 'table' ? 3 : 2;
  const grid = gridIndices();
  r.shape.forEach((row, y) => row.forEach((type, x) => {
    if (!type) return;
    let want = sets;
    for (let i = 0; i < 45 && want > 0; i++) {
      const it = inventory[i];
      if (!it || it.type !== type) continue;
      const n = Math.min(want, it.count);
      it.count -= n; want -= n;
      if (it.count <= 0) inventory[i] = null;
    }
    const got = sets - want;
    if (got > 0) inventory[grid[y * cols + x]] = { type, count: got };
  }));
}

function recipeClick(group: Recipe[], shift: boolean) {
  if (cursor) return;
  const have = available();
  const r = group.find(g => fitsGrid(g) && maxSets(g, have) > 0) || group.find(fitsGrid) || group[0];
  if (!fitsGrid(r)) { ghost = null; renderFullInventory(); return; }
  const n = maxSets(r, have);
  if (n > 0) {
    ghost = null;
    const stackLimit = Math.min(...[...needs(r).keys()].map(maxStack));
    fillGrid(r, shift ? Math.min(n, stackLimit) : 1);
    refreshCrafting();
    changed();
  } else {
    ghost = r; // show what's missing as faded icons in the grid
    renderFullInventory();
  }
}

function renderRecipeBook() {
  const book = document.getElementById('recipe-book');
  const gridEl = document.getElementById('recipe-grid');
  if (!book || !gridEl) return;
  book.style.display = bookOpen && mode !== 'furnace' ? 'flex' : 'none';
  if (!bookOpen || mode === 'furnace') return;
  const search = (document.getElementById('recipe-search') as HTMLInputElement)?.value.trim().toLowerCase() || '';
  const onlyCraftable = (document.getElementById('recipe-filter') as HTMLInputElement)?.checked;
  const have = available();
  const entries = recipeGroups.map(([type, group]) => {
    const fits = group.some(fitsGrid);
    const craftable = group.some(g => fitsGrid(g) && maxSets(g, have) > 0);
    return { type, group, fits, craftable };
  }).filter(e => (!search || itemDef(e.type).name.toLowerCase().includes(search)) && (!onlyCraftable || e.craftable));
  // Craftable first, like Minecraft
  entries.sort((a, b) => Number(b.craftable) - Number(a.craftable) || Number(b.fits) - Number(a.fits));

  gridEl.innerHTML = '';
  for (const e of entries) {
    const btn = document.createElement('div');
    btn.className = 'recipe-btn ' + (e.craftable ? 'craftable' : e.fits ? 'missing' : 'needs-table');
    const img = document.createElement('img');
    img.src = getIconURL(e.type);
    img.draggable = false;
    btn.appendChild(img);
    const count = e.group[0].result.count;
    if (count > 1) { const c = document.createElement('span'); c.className = 'count'; c.textContent = String(count); btn.appendChild(c); }
    const ingredients = [...needs(e.group[0])].map(([t, n]) => `${n}x ${itemDef(t).name}`).join(', ');
    btn.title = `${itemDef(e.type).name}\n${ingredients}${e.fits ? '' : '\nNeeds a Crafting Table'}`;
    btn.addEventListener('pointerdown', ev => { ev.preventDefault(); ev.stopPropagation(); recipeClick(e.group, ev.shiftKey); });
    btn.addEventListener('mousedown', ev => ev.stopPropagation());
    gridEl.appendChild(btn);
  }
}

// ------------------------------------------------------------------ Cursor item

let mouseX = 0, mouseY = 0;
function renderCursor() {
  const el = document.getElementById('cursor-item');
  if (!el) return;
  if (!cursor) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  fillSlotEl(el, cursor);
  if (splitLabel) {
    const s = document.createElement('span');
    s.className = 'split-label';
    s.textContent = splitLabel;
    el.appendChild(s);
  }
  el.style.left = mouseX + 'px';
  el.style.top = mouseY + 'px';
}

let nameTimer = 0;
function showItemName(name: string) {
  const el = document.getElementById('item-name-popup');
  if (!el) return;
  el.textContent = name;
  el.style.opacity = name ? '1' : '0';
  clearTimeout(nameTimer);
  nameTimer = window.setTimeout(() => { el.style.opacity = '0'; }, 1500);
}

export function initInventory() {
  // pointermove also tracks fingers, so the held stack follows touches on mobile
  window.addEventListener('pointermove', e => {
    mouseX = e.clientX; mouseY = e.clientY;
    if (cursor) renderCursor();
  });
  window.addEventListener('pointerdown', e => { mouseX = e.clientX; mouseY = e.clientY; }, true);
  window.addEventListener('pointerup', finishPress);
  window.addEventListener('pointercancel', finishPress);
  const modal = document.getElementById('full-inventory-modal');
  // Clicking the dimmed backdrop (outside the panel): drops the held stack, or closes the screen if nothing is held
  modal?.addEventListener('mousedown', e => {
    if (e.target !== modal) return;
    e.stopPropagation(); // don't let the same click mine/attack once the game resumes
    if (!cursor) { closeHandler(); return; }
    const drop = e.button === 2 ? { type: cursor.type, count: 1 } : cursor;
    dropHandler(drop.type, drop.count);
    if (e.button === 2) { cursor.count--; if (cursor.count <= 0) cursor = null; } else cursor = null;
    renderCursor();
  });
  modal?.addEventListener('contextmenu', e => e.preventDefault());

  const search = document.getElementById('recipe-search') as HTMLInputElement | null;
  search?.addEventListener('input', renderRecipeBook);
  search?.addEventListener('mousedown', e => e.stopPropagation());
  document.getElementById('recipe-filter')?.addEventListener('change', renderRecipeBook);
  document.getElementById('recipe-filter-label')?.addEventListener('mousedown', e => e.stopPropagation());
  document.getElementById('recipe-book')?.addEventListener('mousedown', e => e.stopPropagation());
  document.getElementById('recipe-book-toggle')?.addEventListener('mousedown', e => {
    e.stopPropagation();
    bookOpen = !bookOpen;
    try { localStorage.setItem('poxel_book', bookOpen ? '1' : '0'); } catch { /* storage blocked */ }
    renderRecipeBook();
  });
  renderInventoryBar();
}
