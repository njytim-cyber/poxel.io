// Single-player "integrated server": the same authoritative game as the multiplayer server,
// running in a Web Worker so mobs/items/furnaces never slow down rendering.
import { Game, type Storage, type WorldSave, type PlayerSave, type Player } from '../server/core/game.ts';
import { TICK_RATE, type ClientMsg } from '../shared/protocol.ts';

const ctx = self as unknown as { postMessage(m: unknown): void; onmessage: ((e: MessageEvent) => void) | null };

let game: Game | null = null;
let player: Player | null = null;
let world: WorldSave | null = null;
let players: Record<string, PlayerSave> = {};

const storage: Storage = {
  loadWorld: () => world,
  saveWorld: w => { world = w; ctx.postMessage({ type: 'save', world, players }); },
  loadPlayer: name => players[name] || null,
  savePlayer: (name, s) => { players[name] = s; },
};

ctx.onmessage = e => {
  const d = e.data;
  try {
    if (d.type === 'init') {
      world = d.world || null;
      players = d.players || {};
      game = new Game(storage, { seed: d.seed, maxPlayers: 1 });
      let last = performance.now();
      // Save (world + player) every 10s so closing the tab loses at most a few seconds
      setInterval(() => { try { game!.saveAll(true); } catch (err) { ctx.postMessage({ type: 'error', error: String(err) }); } }, 10000);
      setInterval(() => {
        const now = performance.now();
        try { game!.tick((now - last) / 1000); } catch (err) { ctx.postMessage({ type: 'error', error: String((err as Error).stack || err) }); }
        last = now;
      }, 1000 / TICK_RATE);
    } else if (d.type === 'msg' && game) {
      const msg = d.msg as ClientMsg;
      if (!player) {
        player = game.join({ send: m => ctx.postMessage({ type: 'msg', msg: m }), close: reason => ctx.postMessage({ type: 'msg', msg: { t: 'kick', reason } }) }, msg);
      } else game.handle(player, msg);
    } else if (d.type === 'pause' && game) {
      game.paused = !!d.paused;
    } else if (d.type === 'save' && game) {
      game.saveAll(true);
    }
  } catch (err) {
    ctx.postMessage({ type: 'error', error: String((err as Error).stack || err) });
  }
};
