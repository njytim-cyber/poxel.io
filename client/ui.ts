import type { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { ACHIEVEMENTS } from '../shared/achievements.ts';
import { isMobile, releaseAllKeys } from './input';
import { openScreen, closeScreen, setCloseHandler, type ScreenMode } from './inventory';
import type { FurnaceState, Stack } from '../shared/furnace.ts';
import { send } from './net';
import type { ClientMsg, SquadOrder } from '../shared/protocol.ts';

// One place that decides what the player is doing, so overlays never fight each other.
// panel: a dialog over the game (moonstone orb destinations, robot squad)
export type GameState = 'menu' | 'playing' | 'paused' | 'screen' | 'chat' | 'dead' | 'panel';
export let state: GameState = 'menu';
// Mirrors the state onto <body> so CSS can hide touch controls while a menu/screen is open
function setState(s: GameState) {
  state = s;
  document.body.dataset.state = s;
}
document.body.dataset.state = state;

let controls: PointerLockControls;
const $ = (id: string) => document.getElementById(id);
const show = (id: string, on: boolean, display = 'flex') => { const el = $(id); if (el) el.style.display = on ? display : 'none'; };

export function isPlaying() { return state === 'playing'; }

// Single player pauses the world while the pause menu is open
let pauseHandler: (paused: boolean) => void = () => {};
export function setPauseHandler(fn: (paused: boolean) => void) { pauseHandler = fn; }

export function initUI(c: PointerLockControls) {
  controls = c;

  controls.addEventListener('lock', () => {
    // The lock is requested asynchronously (resume); if a screen, chat or death came first, keep that
    if (state === 'screen' || state === 'chat' || state === 'dead' || state === 'menu' || state === 'panel') { controls.unlock(); return; }
    setState('playing');
    show('pause-menu', false);
    pauseHandler(false);
  });

  controls.addEventListener('unlock', () => {
    // Esc while playing -> pause menu. Other states unlocked on purpose.
    if (state === 'playing') pause();
  });

  // Browsers refuse re-locking right after Esc; fall back to the pause menu so the player can click Resume
  document.addEventListener('pointerlockerror', () => {
    if (state === 'playing' || state === 'screen' || state === 'chat') pause();
  });

  $('btn-resume')?.addEventListener('click', () => resume());
  setCloseHandler(() => closeGameScreen());
  $('btn-respawn')?.addEventListener('click', () => respawnHandler());
  $('btn-orb-close')?.addEventListener('click', () => closePanel());
  $('btn-squad-close')?.addEventListener('click', () => closePanel());
  $('btn-squad')?.addEventListener('click', () => openSquad());
  $('btn-tp-yes')?.addEventListener('click', () => answerTp(true));
  $('btn-tp-no')?.addEventListener('click', () => answerTp(false));

  const input = $('chat-input') as HTMLInputElement | null;
  input?.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      const text = input.value.trim();
      if (text) send({ t: 'chat', text });
      closeChat();
    } else if (e.key === 'Escape') closeChat();
  });
  input?.addEventListener('blur', () => { if (isMobile && state === 'chat') closeChat(); });
}

let respawnHandler: () => void = () => {};
export function setRespawnHandler(fn: () => void) { respawnHandler = fn; }

export function startPlaying() {
  show('main-menu', false);
  show('game-hud', true, 'block');
  show('chat-box', true, 'flex');
  resume();
}

export function resume() {
  (document.activeElement as HTMLElement | null)?.blur?.(); // a focused slider or field would keep the keys
  show('pause-menu', false);
  show('death-screen', false);
  pauseHandler(false);
  setState('playing');
  if (isMobile) return;
  try { controls.lock(); } catch { pause(); }
}

export function pause() {
  if (state === 'menu' || state === 'dead') return;
  if (state === 'screen') closeScreen();
  if (state === 'chat') hideChatInput();
  if (state === 'panel') hidePanels();
  setState('paused');
  show('pause-menu', true);
  releaseAllKeys();
  pauseHandler(true);
  if (!isMobile && controls.isLocked) controls.unlock();
}

// Opens an inventory-style screen. The plain inventory tells the server; tables/furnaces were
// already opened by the server (it validated the block) before this is called.
export function openGameScreen(mode: ScreenMode, furnace?: FurnaceState, chest?: Stack[]) {
  if (state === 'screen') closeScreen();
  if (state !== 'playing' && state !== 'screen') return;
  if (mode === 'inventory') send({ t: 'screen', mode: 'inventory' });
  setState('screen');
  releaseAllKeys();
  openScreen(mode, furnace, chest);
  if (!isMobile) controls.unlock();
}

// Set when we ask the server to open a table/furnace; a reply that arrives when we no longer
// want it (we opened the inventory, paused, died...) is declined instead of hijacking the UI.
let expectingScreen = 0;
export function expectScreen() { expectingScreen = performance.now(); }
export function takeExpectedScreen(): boolean {
  const ok = expectingScreen > 0 && performance.now() - expectingScreen < 5000 && state === 'playing';
  expectingScreen = 0;
  return ok;
}

export function closeGameScreen() {
  if (state !== 'screen') return;
  closeScreen();
  resume();
}

// ------------------------------------------------------------------ Dialogs over the game (moonstone orb, robot squad)

let panelId = '';
function openPanel(id: string): boolean {
  if (state !== 'playing' && state !== 'panel' && state !== 'paused') return false;
  if (state === 'paused') show('pause-menu', false);
  if (panelId && panelId !== id) show(panelId, false);
  panelId = id;
  setState('panel');
  releaseAllKeys();
  show(id, true);
  if (!isMobile && controls.isLocked) controls.unlock();
  return true;
}
function hidePanels() { if (panelId) show(panelId, false); panelId = ''; }
export function closePanel() {
  if (state !== 'panel') return;
  hidePanels();
  resume();
}

// Where a moonstone orb can take you (the server's list)
export function showOrbMenu(players: string[], homes: { i: number; name: string }[], death: boolean) {
  const list = $('orb-list');
  if (!list || state !== 'playing') return;
  list.innerHTML = '';
  const add = (label: string, msg: ClientMsg) => {
    const b = document.createElement('button');
    b.className = 'menu-btn';
    b.textContent = label;
    b.onclick = () => { send(msg); closePanel(); };
    list.appendChild(b);
  };
  for (const n of players) add(`To ${n}`, { t: 'orbgo', to: 'player', name: n });
  for (const h of homes) add(`To ${h.name}`, { t: 'orbgo', to: 'home', i: h.i });
  if (death) add('To where you last died', { t: 'orbgo', to: 'death' });
  if (!list.children.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = "Nowhere to go yet: no friends online, no homes set, and you haven't died.";
    list.appendChild(p);
  }
  openPanel('orb-modal');
}

// A friend asks to teleport to you: Accept / No (or Y / N)
let tpFrom = '', tpTimer = 0;
export function showTpAsk(from: string) {
  tpFrom = from;
  const t = $('tp-ask-text');
  if (t) t.textContent = `${from} wants to teleport to you`;
  show('tp-ask', true);
  clearTimeout(tpTimer);
  tpTimer = window.setTimeout(hideTpAsk, 60000);
}
function hideTpAsk() { tpFrom = ''; show('tp-ask', false); }
export function answerTp(accept: boolean): boolean {
  if (!tpFrom) return false;
  send({ t: 'tpreply', from: tpFrom, accept });
  hideTpAsk();
  return true;
}

// Robot squad: your tamed robots and their orders
let squad: { eid: number; hp: number; max: number; order: SquadOrder }[] = [];
export function setSquad(list: typeof squad) {
  squad = list;
  for (const id of ['btn-squad', 'btn-mobile-squad']) { const b = $(id); if (b) b.style.display = list.length ? '' : 'none'; }
  renderSquad();
}
export function openSquad() {
  send({ t: 'squad' });
  renderSquad();
  openPanel('squad-modal');
}
export const squadOpen = () => panelId === 'squad-modal';
function renderSquad() {
  const el = $('squad-list');
  if (!el) return;
  el.innerHTML = '';
  if (!squad.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'No robots yet. In the Robotic World, use a tungsten ingot on a robot to tame it.';
    el.appendChild(p);
    return;
  }
  const row = (label: string, order: SquadOrder | null, eid?: number, hp?: number, max?: number) => {
    const r = document.createElement('div');
    r.className = 'squad-row';
    const name = document.createElement('div');
    name.className = 'squad-name';
    name.textContent = label;
    if (hp !== undefined && max) {
      const bar = document.createElement('div'); bar.className = 'squad-hp';
      const fill = document.createElement('div'); fill.style.width = `${Math.round((hp / max) * 100)}%`;
      bar.appendChild(fill); name.appendChild(bar);
    }
    const orders = document.createElement('div');
    orders.className = 'squad-orders';
    for (const o of ['follow', 'guard', 'collect'] as SquadOrder[]) {
      const b = document.createElement('button');
      b.className = 'menu-btn' + (o === order ? ' active' : '');
      b.textContent = o[0].toUpperCase() + o.slice(1);
      b.onclick = () => send(eid === undefined ? { t: 'squad', order: o } : { t: 'squad', order: o, eid });
      orders.appendChild(b);
    }
    r.append(name, orders);
    el.appendChild(r);
  };
  if (squad.length > 1) row('All robots', squad.every(s => s.order === squad[0].order) ? squad[0].order : null);
  squad.forEach((s, i) => row(`Robot ${i + 1}`, s.order, s.eid, s.hp, s.max));
}

// ------------------------------------------------------------------ Chat

export function openChat(prefill = '') {
  if (state !== 'playing') return;
  setState('chat');
  releaseAllKeys();
  const input = $('chat-input') as HTMLInputElement | null;
  if (!input) return;
  show('chat-input', true, 'block');
  $('chat-box')?.classList.add('open');
  input.value = prefill;
  if (!isMobile) controls.unlock();
  setTimeout(() => input.focus(), 0);
}

function hideChatInput() {
  const input = $('chat-input') as HTMLInputElement | null;
  if (input) { input.blur(); input.style.display = 'none'; }
  $('chat-box')?.classList.remove('open');
}

export function closeChat() {
  if (state !== 'chat') return;
  hideChatInput();
  resume();
}

export function addChatLine(from: string | null, text: string) {
  const log = $('chat-log');
  if (!log) return;
  const line = document.createElement('div');
  line.className = 'chat-line' + (from ? '' : ' system');
  if (from) {
    const n = document.createElement('b');
    n.textContent = `<${from}> `;
    line.appendChild(n);
  }
  line.appendChild(document.createTextNode(text));
  log.appendChild(line);
  while (log.children.length > 60) log.removeChild(log.firstChild!);
  log.scrollTop = log.scrollHeight;
  setTimeout(() => line.classList.add('faded'), 10000);
}

// Multiplayer downed state: overlay with a bleed-out countdown; a tap (or the button) gives up
let downedUntil = 0, downedTimer = 0, downedAt = 0;
let giveUp: () => void = () => {};
// While down, the mouse stays locked (you can still crawl and look), so clicks come here instead of the button
export function downedClick() { if (performance.now() - downedAt > 1500) giveUp(); }
export function showDowned(seconds: number, onGiveUp: () => void) {
  if (state === 'screen') closeGameScreen();
  document.body.dataset.downed = '1';
  const el = $('downed-screen');
  if (!el) return;
  el.style.display = 'flex';
  downedUntil = performance.now() + seconds * 1000;
  const tick = () => {
    const left = Math.max(0, Math.ceil((downedUntil - performance.now()) / 1000));
    const t = $('downed-timer');
    if (t) t.textContent = `Bleeding out in ${left}s`;
  };
  tick();
  clearInterval(downedTimer);
  downedTimer = window.setInterval(tick, 250);
  // A click/tap anywhere gives up, but not in the first moments (you may still be clicking from the fight)
  downedAt = performance.now();
  giveUp = onGiveUp;
  el.onclick = () => downedClick();
  const hint = el.querySelector('.downed-hint');
  if (hint) hint.textContent = isMobile ? 'Tap anywhere to give up' : 'Click to give up';
  const b = $('btn-giveup');
  if (b) b.onclick = e => { e.stopPropagation(); onGiveUp(); };
  setReviveProgress(0, '');
}
export function hideDowned() {
  clearInterval(downedTimer);
  delete document.body.dataset.downed;
  const el = $('downed-screen');
  if (el) el.style.display = 'none';
  setReviveProgress(0, '');
}
// Shown to both the downed player (in their overlay) and the reviver (under the crosshair)
export function setReviveProgress(progress: number, name: string, reviving = false) {
  const fill = $('revive-bar-fill');
  if (fill) fill.style.width = `${Math.round(progress * 100)}%`;
  const box = $('revive-progress');
  if (box) {
    box.style.display = reviving && progress > 0 ? 'block' : 'none';
    const label = $('revive-label');
    if (label) label.textContent = `Reviving ${name}...`;
    const f2 = $('revive-bar-fill-2');
    if (f2) f2.style.width = `${Math.round(progress * 100)}%`;
  }
}

export function showDeath(message: string) {
  hideDowned();
  if (state === 'screen') closeScreen();
  if (state === 'chat') hideChatInput();
  if (state === 'panel') hidePanels();
  setState('dead');
  const msg = $('death-message');
  if (msg) msg.textContent = message;
  show('pause-menu', false);
  show('death-screen', true);
  if (!isMobile && controls.isLocked) controls.unlock();
}

export function toMenu() {
  setState('menu');
}

// Test hook: play without pointer lock (headless browsers can't lock the mouse)
export function forcePlaying() {
  show('main-menu', false);
  show('pause-menu', false);
  show('game-hud', true, 'block');
  show('chat-box', true, 'flex');
  setState('playing');
}

export function setConnectionBanner(text: string) {
  const el = $('net-banner');
  if (!el) return;
  el.textContent = text;
  el.style.display = text ? 'block' : 'none';
}

// ------------------------------------------------------------------ HUD

const HEART_FULL = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 9 9" shape-rendering="crispEdges"><path d="M1 1h3v1h1V1h3v1h1v3H8v1H7v1H6v1H5v1H4V8H3V7H2V6H1V5H0V2h1z" fill="#1a0000"/><path d="M1 2h3v1h1V2h3v3H7v1H6v1H5v1H4V7H3V6H2V5H1z" fill="#e02020"/><path d="M2 2h1v1H2z" fill="#ffb0b0"/></svg>');
const HEART_EMPTY = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 9 9" shape-rendering="crispEdges"><path d="M1 1h3v1h1V1h3v1h1v3H8v1H7v1H6v1H5v1H4V8H3V7H2V6H1V5H0V2h1z" fill="#1a0000"/><path d="M1 2h3v1h1V2h3v3H7v1H6v1H5v1H4V7H3V6H2V5H1z" fill="#3a2a2a"/></svg>');
const HEART_HALF = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 9 9" shape-rendering="crispEdges"><path d="M1 1h3v1h1V1h3v1h1v3H8v1H7v1H6v1H5v1H4V8H3V7H2V6H1V5H0V2h1z" fill="#1a0000"/><path d="M1 2h3v1h1V2h3v3H7v1H6v1H5v1H4V7H3V6H2V5H1z" fill="#3a2a2a"/><path d="M1 2h3v1h0.5v5H4V7H3V6H2V5H1z" fill="#e02020"/><path d="M2 2h1v1H2z" fill="#ffb0b0"/></svg>');

let lastHealth = -1;
export function renderHealth(hp: number, max: number) {
  if (hp === lastHealth) return;
  const el = $('health-bar');
  if (!el) return;
  const hearts = max / 2;
  if (el.children.length !== hearts) {
    el.innerHTML = '';
    for (let i = 0; i < hearts; i++) el.appendChild(document.createElement('img'));
  }
  for (let i = 0; i < hearts; i++) {
    const img = el.children[i] as HTMLImageElement;
    const v = hp - i * 2;
    const src = v >= 2 ? HEART_FULL : v === 1 ? HEART_HALF : HEART_EMPTY;
    if (img.getAttribute('src') !== src) img.src = src;
  }
  // Shake hearts when low or just damaged
  el.classList.toggle('low', hp <= 4);
  if (hp < lastHealth) { el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit'); }
  lastHealth = hp;
}

const DRUM = (meat: string, bone: string) => 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 9 9" shape-rendering="crispEdges"><path d="M4 0h3v1h1v1h1v3H8v1H7v1H5v1H4v1H1V8H0V5h1V4h1V3h1V1h1z" fill="#1a0e00"/><path d="M4 1h3v1h1v3H7v1H5v1H4V6H3V5H2V4h1V3h1z" fill="${meat}"/><path d="M1 5h1v1h1v1h1v1H1z" fill="${bone}"/><path d="M5 2h1v1H5z" fill="#f0c890"/></svg>`);
const FOOD_FULL = DRUM('#b86a2a', '#f0ece0');
const FOOD_HALF = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 9 9" shape-rendering="crispEdges"><path d="M4 0h3v1h1v1h1v3H8v1H7v1H5v1H4v1H1V8H0V5h1V4h1V3h1V1h1z" fill="#1a0e00"/><path d="M4 1h3v1h1v3H7v1H5v1H4V6H3V5H2V4h1V3h1z" fill="#3a2a1a"/><path d="M6 1h1v1h1v3H7v1H6z" fill="#b86a2a"/><path d="M1 5h1v1h1v1h1v1H1z" fill="#f0ece0"/></svg>');
const FOOD_EMPTY = DRUM('#3a2a1a', '#5a5048');

// Achievements: the pause-menu list, and a banner for a new one
let bannerTimer = 0;
export function setAchievements(ids: string[], unlocked?: string) {
  const have = new Set(ids);
  const list = $('achievements-list');
  if (list) {
    list.innerHTML = '';
    for (const a of ACHIEVEMENTS) {
      const li = document.createElement('li');
      const hidden = a.secret && !have.has(a.id);
      li.className = have.has(a.id) ? 'done' : 'locked';
      li.textContent = `${have.has(a.id) ? '★' : '☆'} ${hidden ? '???' : a.name} `;
      const small = document.createElement('small');
      small.textContent = `- ${hidden ? 'A secret' : a.desc}`;
      li.appendChild(small);
      list.appendChild(li);
    }
  }
  const sum = $('achievements-summary');
  if (sum) sum.textContent = `Achievements (${[...have].filter(id => ACHIEVEMENTS.some(a => a.id === id)).length}/${ACHIEVEMENTS.length})`;
  const a = unlocked ? ACHIEVEMENTS.find(x => x.id === unlocked) : undefined;
  if (a) {
    const n = $('achievement-name'); if (n) n.textContent = a.name;
    show('achievement-banner', true, 'block');
    clearTimeout(bannerTimer);
    bannerTimer = window.setTimeout(() => show('achievement-banner', false), 4000);
  }
}
export function critFlash() {
  const el = $('crit-flash');
  if (!el) return;
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
}

export function setBossBar(name: string, hp: number, max: number) {
  const bar = $('boss-bar');
  if (!bar) return;
  if (hp < 0) { bar.style.display = 'none'; return; }
  bar.style.display = 'block';
  const n = $('boss-name'); if (n) n.textContent = name;
  const f = $('boss-fill'); if (f) f.style.width = `${Math.max(0, Math.min(100, (hp / max) * 100))}%`;
}

// Creative mode hides the health and hunger bars (you can't be hurt or get hungry)
export function setCreativeHud(on: boolean) {
  const bars = $('status-bars');
  if (bars) bars.style.visibility = on ? 'hidden' : 'visible';
}

// Hunger bar: drumsticks filling from the right (like hearts from the left). food < 0 hides it (Easy)
let lastFood = -2;
export function renderFood(food: number) {
  if (food === lastFood) return;
  const el = $('food-bar');
  if (!el) return;
  el.style.visibility = food < 0 ? 'hidden' : 'visible';
  if (el.children.length !== 10) { el.innerHTML = ''; for (let i = 0; i < 10; i++) el.appendChild(document.createElement('img')); }
  for (let i = 0; i < 10; i++) {
    const img = el.children[9 - i] as HTMLImageElement;
    const v = food - i * 2;
    const src = v >= 2 ? FOOD_FULL : v === 1 ? FOOD_HALF : FOOD_EMPTY;
    if (img.getAttribute('src') !== src) img.src = src;
  }
  el.classList.toggle('low', food >= 0 && food <= 6);
  lastFood = food;
}

export function flashHurt() {
  const el = $('hurt-overlay');
  if (!el) return;
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

export function setUnderwater(level: 'none' | 'water' | 'lava' | 'oil' | 'snow') {
  const el = $('liquid-overlay');
  if (!el) return;
  el.className = level;
}

let toastTimer = 0;
export function toast(text: string) {
  const el = $('toast');
  if (!el) return;
  el.textContent = text;
  el.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { el.style.opacity = '0'; }, 2200);
}

export function showError(text: string) {
  const el = $('error-banner');
  if (!el) return;
  el.textContent = text;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 6000);
}
