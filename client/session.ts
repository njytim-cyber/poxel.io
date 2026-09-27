// Applies messages from the server to the client-side game state.
import type { ServerMsg } from '../shared/protocol.ts';
import { resetWorld, importEditsFlat, importFacingFlat, loadAreaNow, setBlock, facing, getSeed } from './world';
import * as player from './player';
import { setInvState, resetInventory, setFurnaceState, setSelectedFromServer } from './inventory';
import { clearRemote, onSpawn, onDespawn, onSnap, onEquip, onAnim } from './remote';
import { setTimeOfDay } from './sky';
import * as ui from './ui';
import { send } from './net';

let started = false;
let myEid = -1;
let readyHandler: () => void = () => {};
let lastPing = 0;
export let pingMs = 0;
export let onlinePlayers: { eid: number; name: string; ping: number }[] = [];

export function onReady(fn: () => void) { readyHandler = fn; }
export function resetSession() { started = false; myEid = -1; onlinePlayers = []; }
export function markPingSent(ts: number) { lastPing = ts; }

export function handleServerMessage(m: ServerMsg) {
  switch (m.t) {
    case 'welcome': {
      // On a reconnect the server may have restarted and lost recent edits, so always rebuild the world
      // from what it says. Keep our own position if it's close to the server's (no visible snap).
      const reconnect = started && getSeed() === m.seed;
      const keep = reconnect ? { x: player.body.pos.x, y: player.body.pos.y, z: player.body.pos.z } : null;
      clearRemote();
      resetWorld(m.seed);
      importFacingFlat(m.facing);
      importEditsFlat(m.edits);
      const near = keep && Math.hypot(keep.x - m.you.x, keep.y - m.you.y, keep.z - m.you.z) < 4;
      const at = near ? keep! : m.you;
      loadAreaNow(at.x, at.z, 1);
      player.setPlayerFeet(at);
      if (!reconnect) player.setYawPitch(m.you.yaw, m.you.pitch);
      // A new session has no open screens and a living player: leave anything the old session left open
      if (ui.state === 'screen' || ui.state === 'dead') {
        if (ui.state === 'screen') ui.closeGameScreen(); else ui.resume();
      }
      resetInventory();
      myEid = m.eid;
      player.resetPlayerState(m.you.health);
      setSelectedFromServer(m.you.inv.selected);
      setInvState({ ...m.you.inv, ack: Number.MAX_SAFE_INTEGER });
      setTimeOfDay(m.time);
      if (!started) { started = true; readyHandler(); }
      return;
    }
    case 'snap': onSnap(m.ents); return;
    case 'spawn': onSpawn(m.ents.filter(e => e.eid !== myEid)); return;
    case 'despawn': onDespawn(m.eids); return;
    case 'equip': onEquip(m.eid, m.held, m.armor); return;
    case 'anim': onAnim(m.eid, m.a); return;
    case 'blocks': {
      const l = m.list;
      for (let i = 0; i + 4 < l.length; i += 5) {
        const [x, y, z, id, f] = [l[i], l[i + 1], l[i + 2], l[i + 3], l[i + 4]];
        if (f >= 0) facing.set(`${x},${y},${z}`, f);
        setBlock(x, y, z, id, true);
      }
      return;
    }
    case 'inv': setInvState(m.inv); return;
    case 'screen':
      if (m.mode === null) { if (ui.state === 'screen') ui.closeGameScreen(); }
      else if (m.mode !== 'inventory') {
        if (ui.takeExpectedScreen()) ui.openGameScreen(m.mode, m.furnace);
        else send({ t: 'screen', mode: null }); // we no longer want it: tell the server to close it
      }
      return;
    case 'furnace': setFurnaceState(m.state); return;
    case 'health': player.onHealth(m.hp); return;
    case 'hurt': player.onHurt(m.from, m.knock); return;
    case 'death': player.onDeath(m.msg); return;
    case 'pos': player.setPlayerFeet(m); return;
    case 'chat': ui.addChatLine(m.from, m.text); return;
    case 'time': setTimeOfDay(m.time); return;
    case 'players': onlinePlayers = m.list; renderOnlineList(); return;
    case 'toast': ui.toast(m.text); return;
    case 'homes': player.onHomes(m.list, m.slots); return;
    case 'kick': ui.setConnectionBanner(m.reason); return;
    case 'pong': if (m.ts === lastPing) pingMs = Math.round(performance.now() - m.ts); return;
  }
}

function renderOnlineList() {
  const el = document.getElementById('online-list');
  if (!el) return;
  el.innerHTML = '';
  if (onlinePlayers.length <= 1) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  const h = document.createElement('div');
  h.className = 'online-title';
  h.textContent = `Online (${onlinePlayers.length})`;
  el.appendChild(h);
  for (const p of onlinePlayers) {
    const row = document.createElement('div');
    row.textContent = `${p.name}${p.eid === myEid ? ' (you)' : ''}  ${p.ping ? p.ping + 'ms' : ''}`;
    el.appendChild(row);
  }
}
