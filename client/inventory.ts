// Inventory UI. The rules live in shared/inventory.ts: every click is applied here immediately
// (prediction) and sent to the server, whose confirmed state replaces ours once it catches up.
import { itemDef, ITEMS } from '../shared/blocks.ts';
import {
  newInv, applyAction, recipeGroups, recipeNeeds, available, fitsGrid, maxSets, refreshCrafting,
  GRID_2, GRID_3, RESULT, FURNACE_INPUT, FURNACE_FUEL, FURNACE_OUTPUT, CHEST_START, CHEST_SIZE,
  type Inv, type Screen, type ScreenMode, type InvAction, type Stack,
} from '../shared/inventory.ts';
import { SMELT_TIME, type FurnaceState } from '../shared/furnace.ts';
import type { Recipe } from '../shared/recipes.ts';
import type { InvState } from '../shared/protocol.ts';
import { getIconURL } from './textures';
import { send, nextSeq } from './net';

export type InventoryItem = Stack;
export type { ScreenMode };

const inv: Inv = newInv();
export const inventory = inv.slots; // live view of the slots (same array, mutated in place)
export let selectedSlotIndex = 0;
let screen: Screen | null = null;
let ghost: Recipe | null = null;
let pendingSeq = 0;   // last inventory action we sent
let serverState: InvState | null = null;

export let isOpen = false;

const listeners: (() => void)[] = [];
export function onInventoryChange(cb: () => void) { listeners.push(cb); }
function changed() {
  renderInventoryBar();
  if (isOpen) renderFullInventory();
  for (const cb of listeners) cb();
}

let closeHandler: () => void = () => {};
export function setCloseHandler(fn: () => void) { closeHandler = fn; }

function assign(state: InvState) {
  for (let i = 0; i < inv.slots.length; i++) inv.slots[i] = state.slots[i] ? { ...state.slots[i]! } : null;
  inv.cursor = state.cursor ? { ...state.cursor } : null;
}

// Authoritative inventory from the server. While our own clicks are still in flight we keep the
// predicted state (the server will send the confirmed result right after).
export function setInvState(state: InvState) {
  serverState = state;
  if ((state.ack ?? 0) < pendingSeq) return;
  assign(state);
  if (screen) refreshCrafting(inv, screen);
  changed();
  renderCursor();
}

export function resetInventory() {
  inv.slots.fill(null);
  inv.cursor = null;
  pendingSeq = 0;
  serverState = null;
  changed();
}

// ------------------------------------------------------------------ Hotbar

export function setSelectedSlot(index: number) {
  const i = ((index % 9) + 9) % 9;
  if (i === selectedSlotIndex) return;
  selectedSlotIndex = i;
  inv.selected = i;
  send({ t: 'select', slot: i });
  renderInventoryBar();
  const item = inventory[i];
  showItemName(item ? itemDef(item.type).name : '');
  for (const cb of listeners) cb();
}

// Server told us which slot is selected (on join) — no echo back
export function setSelectedFromServer(i: number) {
  selectedSlotIndex = inv.selected = Math.max(0, Math.min(8, i | 0));
  renderInventoryBar();
  for (const cb of listeners) cb();
}

export function getSelectedItem(): Stack { return inventory[selectedSlotIndex]; }

// Local prediction of consuming the held item (placing/eating); the server confirms with 'inv'
// Creative mode: placing doesn't use up the stack
let infiniteBlocks = false;
export function setInfiniteBlocks(on: boolean) { infiniteBlocks = on; }

export function predictUseSelected() {
  if (infiniteBlocks) return;
  const it = inventory[selectedSlotIndex];
  if (!it) return;
  it.count--;
  if (it.count <= 0) inventory[selectedSlotIndex] = null;
  changed();
}

// ------------------------------------------------------------------ Actions

function perform(action: InvAction) {
  if (!screen) return;
  const g = applyAction(inv, screen, action, () => {}); // drops are spawned by the server
  ghost = action.a === 'book' ? g : null;
  pendingSeq = nextSeq();
  send({ t: 'inv', action, seq: pendingSeq });
  changed();
  renderCursor();
}

// Opening: plain inventory opens instantly; tables/furnaces open when the server confirms
export function openScreen(mode: ScreenMode, furnace?: FurnaceState, chest?: Stack[]) {
  screen = { mode, furnace: furnace ? { ...furnace } : null, chest: chest ? chest.map(s => (s ? { ...s } : null)) : null };
  isOpen = true;
  ghost = null;
  const modal = document.getElementById('full-inventory-modal');
  if (modal) modal.style.display = 'flex';
  refreshCrafting(inv, screen);
  renderFullInventory();
}

export function screenMode(): ScreenMode | null { return screen?.mode ?? null; }

export function setChestState(slots: Stack[]) {
  if (!screen || screen.mode !== 'chest') return;
  screen.chest = slots.map(s => (s ? { ...s } : null));
  renderChest();
}

function renderChest() {
  const host = document.getElementById('chest-grid');
  if (!host || !screen || screen.mode !== 'chest') return;
  host.innerHTML = '';
  for (let i = 0; i < CHEST_SIZE; i++) host.appendChild(slotEl(CHEST_START + i));
}

export function setFurnaceState(f: FurnaceState) {
  if (!screen || screen.mode !== 'furnace') return;
  screen.furnace = { ...f };
  renderFurnace();
}

// Closing returns grid items/cursor to the inventory (predicted here, done for real on the server)
export function closeScreen() {
  if (!isOpen) return;
  if (screen) perform({ a: 'close' });
  isOpen = false;
  screen = null;
  const modal = document.getElementById('full-inventory-modal');
  if (modal) modal.style.display = 'none';
  renderCursor();
  changed();
}

// ------------------------------------------------------------------ Rendering

function fillSlotEl(el: HTMLElement, item: Stack) {
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

function slotContent(slot: number): Stack {
  if (slot >= CHEST_START) return screen?.chest?.[slot - CHEST_START] ?? null;
  if (slot >= 100) {
    const f = screen?.furnace;
    if (!f) return null;
    return slot === FURNACE_INPUT ? f.input : slot === FURNACE_FUEL ? f.fuel : f.output;
  }
  return inv.slots[slot];
}

// Long press on a stack picks up half of it (20/40), a quick click picks up everything
const LONG_PRESS_MS = 350;
let pendingPress: { slot: number; timer: number } | null = null;
let splitLabel = '';
let splitTimer = 0;

function slotEl(slot: number, extraClass = ''): HTMLElement {
  const el = document.createElement('div');
  el.className = 'slot ' + extraClass;
  fillSlotEl(el, slotContent(slot));
  el.addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation();
    const item = slotContent(slot);
    const normal = slot !== RESULT && slot !== FURNACE_OUTPUT;
    if (e.button === 0 && !e.shiftKey && !inv.cursor && item && item.count > 1 && normal) {
      const timer = window.setTimeout(() => {
        pendingPress = null;
        const total = item.count;
        perform({ a: 'click', slot, button: 2, shift: false }); // right-click rule = take half
        if (inv.cursor) showSplit(`${inv.cursor.count}/${total}`);
      }, LONG_PRESS_MS);
      pendingPress = { slot, timer };
      return;
    }
    perform({ a: 'click', slot, button: e.button === 2 ? 2 : 0, shift: e.shiftKey });
  });
  el.addEventListener('mousedown', e => e.stopPropagation()); // keep inventory clicks away from mining
  el.addEventListener('contextmenu', e => e.preventDefault());
  return el;
}

function finishPress() {
  if (!pendingPress) return;
  clearTimeout(pendingPress.timer);
  const slot = pendingPress.slot;
  pendingPress = null;
  perform({ a: 'click', slot, button: 0, shift: false });
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
  if (!screen) return;
  const mode = screen.mode;
  const grid = document.getElementById('full-inventory-grid');
  if (!grid) return;
  grid.innerHTML = '';
  for (let i = 9; i < 45; i++) grid.appendChild(slotEl(i));
  for (let i = 0; i < 9; i++) grid.appendChild(slotEl(i, i === 0 ? 'hotbar-start' : ''));

  const craftingArea = document.getElementById('crafting-area');
  const furnaceArea = document.getElementById('furnace-area');
  const chestArea = document.getElementById('chest-area');
  const armorArea = document.getElementById('armor-area');
  if (craftingArea) craftingArea.style.display = mode === 'furnace' || mode === 'chest' ? 'none' : 'block';
  if (furnaceArea) furnaceArea.style.display = mode === 'furnace' ? 'block' : 'none';
  if (chestArea) chestArea.style.display = mode === 'chest' ? 'block' : 'none';
  if (armorArea) armorArea.style.display = mode === 'inventory' ? 'flex' : 'none';
  const title = document.getElementById('crafting-title');
  if (title) title.textContent = mode === 'table' ? 'Crafting Table' : 'Crafting';

  const cGrid = document.getElementById('crafting-grid');
  if (cGrid && mode !== 'furnace' && mode !== 'chest') {
    cGrid.innerHTML = '';
    cGrid.className = mode === 'table' ? 'grid-3x3' : 'grid-2x2';
    const cols = mode === 'table' ? 3 : 2;
    (mode === 'table' ? GRID_3 : GRID_2).forEach((i, k) => {
      const el = slotEl(i);
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
  const cResult = document.getElementById('crafting-result');
  if (cResult) { cResult.innerHTML = ''; cResult.appendChild(slotEl(RESULT, 'result-slot')); }

  const aGrid = document.getElementById('armor-grid');
  if (aGrid) {
    aGrid.innerHTML = '';
    const labels = ['helmet', 'chest', 'legs', 'boots', 'hands'];
    for (let i = 55; i <= 59; i++) {
      const el = slotEl(i, 'armor-slot-ui');
      if (!inventory[i]) el.dataset.label = labels[i - 55];
      aGrid.appendChild(el);
    }
    // Offhand: a laser cannon or a compass works from here while you hold something else
    const off = slotEl(60, 'armor-slot-ui');
    if (!inventory[60]) off.dataset.label = 'offhand';
    aGrid.appendChild(off);
  }
  renderRecipeBook();
  if (mode === 'furnace') renderFurnace();
  if (mode === 'chest') renderChest();
}

function renderFurnace() {
  if (!screen || screen.mode !== 'furnace') return;
  const put = (id: string, slot: number) => {
    const host = document.getElementById(id);
    if (host) { host.innerHTML = ''; host.appendChild(slotEl(slot, slot === FURNACE_OUTPUT ? 'result-slot' : '')); }
  };
  put('furnace-input', FURNACE_INPUT);
  put('furnace-fuel', FURNACE_FUEL);
  put('furnace-output', FURNACE_OUTPUT);
  const f = screen.furnace;
  const flame = document.getElementById('furnace-flame');
  const arrow = document.getElementById('furnace-arrow-fill');
  if (flame) flame.style.height = `${f && f.burnTotal ? Math.max(0, f.burnLeft / f.burnTotal) * 100 : 0}%`;
  if (arrow) arrow.style.width = `${f ? (f.progress / SMELT_TIME) * 100 : 0}%`;
}

// ------------------------------------------------------------------ Recipe book

let bookOpen = (() => { try { return localStorage.getItem('poxel_book') !== '0'; } catch { return true; } })();

// Creative: the recipe book becomes a list of every item, free and unlimited
let creativeList = false;
export function setCreativeInventory(on: boolean) {
  creativeList = on;
  document.getElementById('recipe-book')?.classList.toggle('creative', on);
  const search = document.getElementById('recipe-search') as HTMLInputElement | null;
  if (search) search.placeholder = on ? 'Search items...' : 'Search...';
  const hint = document.getElementById('recipe-hint');
  if (hint) hint.textContent = on ? 'Click: take one · Shift/right-click: a stack · Click here holding something: delete it' : 'Click: fill grid · Shift+click: craft max';
  if (isOpen) renderRecipeBook();
}
const ALL_ITEMS = Object.keys(ITEMS);

function renderCreativeList(gridEl: HTMLElement) {
  const search = (document.getElementById('recipe-search') as HTMLInputElement)?.value.trim().toLowerCase() || '';
  gridEl.innerHTML = '';
  for (const type of ALL_ITEMS) {
    const name = itemDef(type).name;
    if (search && !name.toLowerCase().includes(search)) continue;
    const btn = document.createElement('div');
    btn.className = 'recipe-btn craftable';
    const img = document.createElement('img');
    img.src = getIconURL(type);
    img.draggable = false;
    btn.appendChild(img);
    btn.title = name;
    let longPress = 0, pressedLong = false;
    btn.addEventListener('pointerdown', ev => {
      ev.stopPropagation();
      pressedLong = false;
      if (ev.pointerType === 'touch') longPress = window.setTimeout(() => { pressedLong = true; perform({ a: 'creative', type, all: true }); }, 450);
    });
    const cancel = () => clearTimeout(longPress);
    btn.addEventListener('pointerup', cancel);
    btn.addEventListener('pointerleave', cancel);
    btn.addEventListener('mousedown', ev => ev.stopPropagation());
    btn.addEventListener('contextmenu', ev => { ev.preventDefault(); ev.stopPropagation(); perform({ a: 'creative', type, all: true }); });
    btn.addEventListener('click', ev => {
      ev.stopPropagation();
      if (pressedLong) return;
      // Holding something that isn't this item: clicking the list throws it away
      if (inv.cursor && inv.cursor.type !== type) { perform({ a: 'creative', type: null, all: false }); return; }
      perform({ a: 'creative', type, all: ev.shiftKey });
    });
    gridEl.appendChild(btn);
  }
}

function renderRecipeBook() {
  const book = document.getElementById('recipe-book');
  const gridEl = document.getElementById('recipe-grid');
  if (!book || !gridEl || !screen) return;
  if (creativeList && screen.mode !== 'furnace' && screen.mode !== 'chest') {
    book.style.display = 'flex'; // always there in creative (like the creative menu elsewhere)
    renderCreativeList(gridEl);
    return;
  }
  book.style.display = bookOpen && screen.mode !== 'furnace' && screen.mode !== 'chest' ? 'flex' : 'none';
  if (!bookOpen || screen.mode === 'furnace' || screen.mode === 'chest') return;
  const search = (document.getElementById('recipe-search') as HTMLInputElement)?.value.trim().toLowerCase() || '';
  const onlyCraftable = (document.getElementById('recipe-filter') as HTMLInputElement)?.checked;
  const have = available(inv);
  const scr = screen;
  const entries = recipeGroups.map(([type, group]) => {
    const fits = group.some(g => fitsGrid(g, scr));
    const craftable = group.some(g => fitsGrid(g, scr) && maxSets(g, have) > 0);
    return { type, group, fits, craftable };
  }).filter(e => (!search || itemDef(e.type).name.toLowerCase().includes(search)) && (!onlyCraftable || e.craftable));
  // Craftable recipes first
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
    const ingredients = [...recipeNeeds(e.group[0])].map(([t, n]) => `${n}x ${itemDef(t).name}`).join(', ');
    btn.title = `${itemDef(e.type).name}\n${ingredients}${e.fits ? '' : '\nNeeds a Crafting Table'}`;
    // Act on release (click), so starting to scroll the recipe list doesn't craft anything
    btn.addEventListener('pointerdown', ev => ev.stopPropagation());
    btn.addEventListener('click', ev => { ev.stopPropagation(); if (e.fits) perform({ a: 'book', result: e.type, shift: ev.shiftKey }); });
    btn.addEventListener('mousedown', ev => ev.stopPropagation());
    gridEl.appendChild(btn);
  }
}

// ------------------------------------------------------------------ Cursor item

let mouseX = 0, mouseY = 0;
function renderCursor() {
  const el = document.getElementById('cursor-item');
  if (!el) return;
  if (!inv.cursor || !isOpen) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  fillSlotEl(el, inv.cursor);
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
    if (inv.cursor) renderCursor();
  });
  window.addEventListener('pointerdown', e => { mouseX = e.clientX; mouseY = e.clientY; }, true);
  window.addEventListener('pointerup', finishPress);
  // A cancelled touch (the finger started scrolling) is not a click
  window.addEventListener('pointercancel', () => { if (pendingPress) { clearTimeout(pendingPress.timer); pendingPress = null; } });

  const modal = document.getElementById('full-inventory-modal');
  // Clicking the dimmed backdrop: drops the held stack, or closes the screen if nothing is held
  modal?.addEventListener('mousedown', e => {
    if (e.target !== modal) return;
    e.stopPropagation(); // don't let the same click mine/attack once the game resumes
    if (!inv.cursor) { closeHandler(); return; }
    perform({ a: 'outside', button: e.button === 2 ? 2 : 0 });
  });
  modal?.addEventListener('contextmenu', e => e.preventDefault());
  const closeBtn = document.getElementById('inventory-close');
  closeBtn?.addEventListener('mousedown', e => e.stopPropagation());
  closeBtn?.addEventListener('click', e => { e.stopPropagation(); closeHandler(); });

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
  void serverState;
}
