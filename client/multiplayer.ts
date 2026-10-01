// Multiplayer from the menu: one-tap Play Online, joining a server (with a loading screen), invite links,
// sessions that end (refused, kicked, unreachable) going back to the menu with the reason, and the ping.
// main.ts owns the game mode and the menu screens; it hands them over through initMultiplayer.
import qrcode from 'qrcode-generator';
import type { ServerMsg } from '../shared/protocol.ts';
import { store } from './store';
import { profileName, cleanName, previousNameOn, rememberNameOn, carryFrom, canCarry, startCarry, stopCarry, onCarryMessage, flushCarry } from './character';
import { getSaveMeta, savesSettled } from './saves';
import { savedLook } from './avatar';
import { startRemote, disconnect, onNetStatus } from './net';
import { resetSession, pingMs } from './session';
import { body } from './player';
import { isLoaded } from './world';
import * as ui from './ui';

export interface MultiplayerHooks {
  showMenu(which: 'main' | 'mp'): void;
  startMulti(): void;      // the game is now a multiplayer session
  endMulti(): void;        // ...and no longer is
  inMulti(): boolean;
  characterSlot(): number; // the save chosen under "Name & server" (-1: this server's character)
  pingVisible(): boolean;  // false while the debug overlay (which shows the ping too) is open
}
let hooks: MultiplayerHooks;
export function initMultiplayer(h: MultiplayerHooks) { hooks = h; }

let mpServer = '', mpJoinName = '';

// Server messages in a multiplayer session: a carried character's changes, and the name used on this server
export function onMultiplayerMessage(m: ServerMsg) {
  onCarryMessage(m);
  if (m.t === 'welcome' && mpServer) rememberNameOn(mpServer, mpJoinName);
}

// In the world: the loading screen waits for the ground, Invite appears, and the invite link is used up
export function onJoinedWorld() {
  waitForGround();
  const invite = document.getElementById('btn-invite');
  if (invite) invite.style.display = '';
  // A reload shouldn't look like a fresh invite
  if (location.search) history.replaceState(null, '', location.pathname);
}

// A random secret kept in this browser: proves you own your player name on a server
export function playerToken(): string {
  let t = store.get('poxel_token');
  if (!t) {
    t = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
    store.set('poxel_token', t);
  }
  return t;
}
const mpName = document.getElementById('mp-name') as HTMLInputElement | null;
const mpUrl = document.getElementById('mp-url') as HTMLInputElement | null;
const mpStatus = document.getElementById('mp-status');
// Accepts pasted https:// links and bare hosts
function toSocketUrl(raw: string): string {
  const url = raw.trim().replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://');
  if (url && !/^wss?:\/\//.test(url)) return (location.protocol === 'https:' ? 'wss://' : 'ws://') + url;
  return url;
}
// When the page is served by the game server itself (Cloudflare, or a tunnel to the server), join that server
const servedByGameServer = location.port !== '5173' && !location.hostname.endsWith('github.io');
const defaultServer = servedByGameServer ? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`
  : (import.meta as any).env?.VITE_SERVER_URL || (location.hostname === 'localhost' ? 'ws://localhost:8080' : '');
// Invite links: ?join=<friend> (and ?server=<address> when the page isn't served by the game server)
const params = new URLSearchParams(location.search);
const inviteFrom = cleanName(params.get('join') || '');
const playServer: string = servedByGameServer ? defaultServer : toSocketUrl(params.get('server') || '') || store.get('poxel_server') || defaultServer;
if (mpName) mpName.value = profileName();
if (mpUrl) mpUrl.value = playServer;

const mpButton = document.getElementById('btn-multiplayer') as HTMLButtonElement | null;
mpButton?.addEventListener('click', () => hooks.showMenu('mp'));
document.getElementById('btn-back-mp')?.addEventListener('click', () => hooks.showMenu('main'));
document.getElementById('btn-connect')?.addEventListener('click', () => {
  const url = toSocketUrl(mpUrl?.value || '');
  if (!url) { if (mpStatus) mpStatus.textContent = 'Enter the server address your host gave you.'; return; }
  const slot = hooks.characterSlot();
  joinServer(url, cleanName(mpName?.value || '') || profileName(), slot);
});

// One tap: straight into the world with your name and last character (both changeable under Multiplayer)
const playOnline = document.getElementById('btn-play-online') as HTMLButtonElement | null;
if (playOnline && playServer) {
  playOnline.style.display = '';
  const label = document.getElementById('play-online-label');
  if (label && inviteFrom) label.textContent = `Join ${inviteFrom}`;
  document.getElementById('btn-new-game')?.classList.remove('primary');
  const mpLabel = mpButton?.querySelector('span');
  if (mpLabel) mpLabel.textContent = 'Name & server';
  playOnline.addEventListener('click', () => {
    const wanted = Number(store.get('poxel_mp_character') ?? -1);
    const slot = wanted >= 0 && getSaveMeta(wanted) && canCarry(wanted) ? wanted : -1;
    joinServer(playServer, profileName(), slot);
  });
}

function joinServer(url: string, name: string, slot: number) {
  store.set('poxel_name', name);
  store.set('poxel_server', url);
  store.set('poxel_mp_character', String(slot));
  if (mpName) mpName.value = name;
  if (mpStatus) mpStatus.textContent = 'Connecting...';
  showMenuError('');
  showLoading('Connecting...');
  hooks.startMulti();
  resetSession();
  if (slot >= 0) startCarry(slot); else stopCarry();
  // Renamed since the last visit to this server? Ask it to move our character and name lock over
  const prev = previousNameOn(url);
  mpServer = url; mpJoinName = name;
  startRemote(url, name, savedLook(), playerToken(), () => ({
    prevName: prev && prev.toLowerCase() !== name.toLowerCase() ? prev : undefined,
    carry: slot >= 0 ? carryFrom(slot) : undefined,
    near: inviteFrom && inviteFrom.toLowerCase() !== name.toLowerCase() ? inviteFrom : undefined,
  }));
}

// Loading screen: from pressing Play until the ground around you is there
const loadingScreen = document.getElementById('loading-screen');
let loadingTimer = 0;
function showLoading(text: string) {
  const t = document.getElementById('loading-text');
  if (t) t.textContent = text;
  if (loadingScreen) loadingScreen.style.display = text ? 'flex' : 'none';
  if (!text) clearInterval(loadingTimer);
}
function waitForGround() {
  showLoading('Loading the world...');
  const t0 = performance.now();
  clearInterval(loadingTimer);
  loadingTimer = window.setInterval(() => {
    const { x, z } = body.pos;
    const ready = [-16, 0, 16].every(dx => [-16, 0, 16].every(dz => isLoaded(Math.floor(x + dx), Math.floor(z + dz))));
    if (ready || performance.now() - t0 > 8000) showLoading('');
  }, 100);
}
document.getElementById('btn-loading-cancel')?.addEventListener('click', () => leaveToMenu(''));

// Errors that end a multiplayer session go to the main menu, with the reason shown there
function showMenuError(text: string) {
  const box = document.getElementById('menu-error');
  const t = document.getElementById('menu-error-text');
  if (t) t.textContent = text;
  if (box) box.style.display = text ? 'flex' : 'none';
}
async function leaveToMenu(reason: string) {
  disconnect();
  ui.setConnectionBanner(''); // the reason moves to the menu
  if (hooks.inMulti()) { stopCarry(); await savesSettled(); }
  if (ui.state === 'menu') { showLoading(''); showMenuError(reason); hooks.showMenu('main'); hooks.endMulti(); return; }
  try { sessionStorage.setItem('poxel_menu_error', reason); } catch { /* storage blocked */ }
  location.reload();
}
try {
  const err = sessionStorage.getItem('poxel_menu_error');
  if (err) { sessionStorage.removeItem('poxel_menu_error'); showMenuError(err); }
} catch { /* storage blocked */ }

// Invite friends (pause menu): a link that brings them into this world, next to you
const inviteModal = document.getElementById('invite-modal');
function inviteLink(): string {
  const u = new URL(location.origin + location.pathname);
  if (!servedByGameServer) u.searchParams.set('server', mpServer);
  u.searchParams.set('join', mpJoinName);
  return u.toString();
}
document.getElementById('btn-invite')?.addEventListener('click', () => {
  if (!inviteModal) return;
  const link = inviteLink();
  const input = document.getElementById('invite-link') as HTMLInputElement | null;
  if (input) input.value = link;
  const qr = qrcode(0, 'M');
  qr.addData(link);
  qr.make();
  const box = document.getElementById('invite-qr');
  if (box) box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  const share = document.getElementById('btn-invite-share');
  if (share) share.style.display = typeof navigator.share === 'function' ? '' : 'none';
  inviteModal.style.display = 'flex';
});
document.getElementById('btn-invite-share')?.addEventListener('click', () => {
  navigator.share?.({ title: 'Play with me', text: `Join ${mpJoinName} in Poxel`, url: inviteLink() }).catch(() => { /* cancelled */ });
});
document.getElementById('btn-invite-copy')?.addEventListener('click', async e => {
  const btn = e.currentTarget as HTMLButtonElement;
  const input = document.getElementById('invite-link') as HTMLInputElement | null;
  try { await navigator.clipboard.writeText(inviteLink()); } catch { input?.select(); document.execCommand('copy'); }
  btn.textContent = 'Copied!';
  setTimeout(() => { btn.textContent = 'Copy link'; }, 1500);
});
document.getElementById('btn-invite-close')?.addEventListener('click', () => { if (inviteModal) inviteModal.style.display = 'none'; });
// A character carried from a save must reach the save before the page goes away
window.addEventListener('pagehide', flushCarry);

let flushedForDrop = false;
onNetStatus((status, detail) => {
  if (status === 'online') { ui.setConnectionBanner(''); flushedForDrop = false; }
  else if (status === 'reconnecting') {
    // Rejoining sends the carried character from its save, so bring the save up to date first (once per drop)
    if (!flushedForDrop) { flushedForDrop = true; flushCarry(); }
    ui.setConnectionBanner(detail || 'Reconnecting...');
  }
  else if (status === 'offline') {
    if (mpStatus && ui.state === 'menu') mpStatus.textContent = detail || 'Disconnected';
    // The session is over (refused, kicked, server unreachable): back to the menu with the reason
    if (hooks.inMulti()) leaveToMenu(detail || 'Disconnected');
    else ui.setConnectionBanner(detail || 'Disconnected');
  }
});

// Ping, always on screen in multiplayer (green / yellow / red)
const pingHud = document.getElementById('ping-hud');
setInterval(() => {
  if (!pingHud) return;
  const show = hooks.inMulti() && ui.state !== 'menu' && hooks.pingVisible() && pingMs >= 0;
  pingHud.style.display = show ? 'block' : 'none';
  if (!show) return;
  pingHud.textContent = `${pingMs} ms`;
  pingHud.className = pingMs < 100 ? 'ok' : pingMs < 250 ? 'meh' : 'bad';
}, 1000);
