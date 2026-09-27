import type { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { isMobile, releaseAllKeys } from './input';
import { openScreen, closeScreen, setCloseHandler, type ScreenMode } from './inventory';
import type { FurnaceState } from '../shared/furnace.ts';
import { send } from './net';

// One place that decides what the player is doing, so overlays never fight each other.
export type GameState = 'menu' | 'playing' | 'paused' | 'screen' | 'chat' | 'dead';
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
    if (state === 'screen') closeScreen();
    if (state === 'chat') hideChatInput();
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

  const input = $('chat-input') as HTMLInputElement | null;
  input?.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      const text = input.value.trim();
      if (text) send({ t: 'chat', text });
      closeChat();
    } else if (e.key === 'Escape') closeChat();
  });
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
  setState('paused');
  show('pause-menu', true);
  releaseAllKeys();
  pauseHandler(true);
  if (!isMobile && controls.isLocked) controls.unlock();
}

// Opens an inventory-style screen. The plain inventory tells the server; tables/furnaces were
// already opened by the server (it validated the block) before this is called.
export function openGameScreen(mode: ScreenMode, furnace?: FurnaceState) {
  if (state === 'screen') closeScreen();
  if (state !== 'playing' && state !== 'screen') return;
  if (mode === 'inventory') send({ t: 'screen', mode: 'inventory' });
  setState('screen');
  releaseAllKeys();
  openScreen(mode, furnace);
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

export function showDeath(message: string) {
  if (state === 'screen') closeScreen();
  if (state === 'chat') hideChatInput();
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

export function flashHurt() {
  const el = $('hurt-overlay');
  if (!el) return;
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

export function setUnderwater(level: 'none' | 'water' | 'lava') {
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
