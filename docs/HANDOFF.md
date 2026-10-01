# Poxel.io — Session Handoff (2026-09-30)

Poxel.io is a browser voxel sandbox game (its own game — never describe it as a clone of anything) with single player and a self-hosted multiplayer server. Latest commit: `36a65c5` on `master`, pushed to https://github.com/njytim-cyber/poxel.io.

## Status (2026-09-30)

- **Done since the last handoff:** tests in `tests/` (`npm test`, `test:unit`, `test:e2e`, `test:perf`, `test:soak`, budgets in `tests/e2e/budgets.json`); health log (`data/health.log`); edits streamed per chunk; single-player saves in IndexedDB; view-distance slider in the pause menu.
- **Bug sweep (this session):** item dupes when carrying a single-player character (the server now keeps its own character separately), leaving while downed, no default operator (see below), cheated saves can't be carried, IndexedDB/localStorage save rollback, facing of chests and jack o'lanterns, and anti-cheat: walking through blocks, 1-second digging, chests used from far away, faked ground/water to skip fall damage, downed players running or /spawn-ing away. Also death loot deleted when the inventory was full, spoofable per-IP headers, furnace stack sizes, `/give constructor`, the downed inventory freeze, mobile give-up, Esc in the recipe search, an inventory close button, and GPU/material leaks.
- **Operators:** nobody by default. List names in `OPS=a,b` or one per line in `DATA_DIR/ops.txt` (this PC has `data/ops.txt` with player9989). An operator's old name stays locked when they rename. Single player allows cheats, but `/give`, creative or dev tools mark the save `cheated`, and cheated saves can't be taken into a server.
- **New: The Robotic World** (stage 1 of 2; design in `docs/robotic-world.md`, code in `shared/robotic.ts`). It's a far-off strip of the same world (x 70,000 to 130,000, bedrock walls), so saves, streaming and multiplayer are unchanged. Stage 2 is still to do: boss and altar, obitite, laser cannon and offhand, compass deflecting lasers, jetpack.

## Next session: priorities

1. **Robotic World stage 2** (see `docs/robotic-world.md`).
2. **Performance:** chunk meshing is about 17 ms against the 12 ms budget. The new terrain is more varied, so greedy meshing merges less. Meshing runs on workers, so the budget may need a deliberate re-baseline, or the mesher needs optimising. One 70-150 ms GPU-process stall about 3 s into the perf run has no cause found yet: it isn't a shader compile, and chunk uploads are already capped at 2 per frame. Run perf with other Chrome windows closed: with the owner's Chrome open, even the previous commit dropped to 30 FPS.
3. **Server autosave** still rewrites the whole `world.json` (logged as a warning when a save takes over 100 ms). Move to per-chunk region files before worlds get big.
4. **Still to test by hand:** a 60-minute soak, real phones and tablets over the tunnel, and a low-end GPU at view distance 2-3.

## How to run

```bash
npm install
npm run dev        # Vite dev client at http://localhost:5173/poxel.io/ (has window.poxel test hooks)
npm run host       # build + start the game server on :8080 (also serves the built game at /poxel.io/)
npm run tunnel     # Cloudflare quick tunnel -> prints https://<random>.trycloudflare.com to share
npm run deploy     # build + publish static client to GitHub Pages (single player + manual server address)
```

- `cloudflared` is the official standalone binary in `%USERPROFILE%\.cloudflared-bin\cloudflared.exe`. It is not on PATH, and `npm run tunnel` uses the full path.
- **Quick tunnels expire without warning** ("Tunnel not found" in the cloudflared log). Restart `npm run tunnel` to get a new link. A stable URL needs a free Cloudflare account and a named tunnel.
- Server env vars: `PORT` (8080), `DATA_DIR` (`./data`, gitignored), `MAX_PLAYERS` (16), `MAX_PER_IP` (4), `SEED`.
- The world and players are saved in `data/world.json` and `data/players/<name>.json`, each with a `.bak`. Corrupt files are moved to `*.corrupt-<ts>`.
- **Hosting decision:** the website is on Cloudflare (`npm run deploy:cf` → https://poxel.njytim.workers.dev; `cloudflare/worker.js` also forwards multiplayer to `ORIGIN_URL` with the shared `ORIGIN_SECRET`). For now the game server runs on the owner's PC: `npm run host:cf` starts it with a fresh `ORIGIN_SECRET`, opens a Cloudflare quick tunnel, and points the Worker at it (`wrangler secret bulk`), so players always use the workers.dev link. No domain or paid server until multiplayer is proven; after that, a domain plus an always-on server (e.g. DigitalOcean Singapore) behind a named Cloudflare Tunnel. Fly.io was dropped: its Windows tool is unsigned, and Smart App Control (which stays on) blocks it.
- `npm run deploy:cf` deploys to Cloudflare. In the owner's own PowerShell, use `npx.cmd` (script execution policy blocks `npx.ps1`).
- GitHub Actions: manual-only workflows, if any. The owner watches Actions minutes, so add nothing that runs on push.
- Node ≥ 23.6 is required: the server runs TypeScript directly via type stripping. Server and shared code must use `.ts` import extensions and erasable syntax only (no enums or parameter properties). This is checked by `tsconfig.server.json`.
- Git has no global identity on this PC. Commit with `git -c user.name="Koh Huiling" -c user.email="njytim@gmail.com" ...`. Never commit `index.docx` (the owner's untracked file) or `data/`.

## Architecture

```
shared/   pure TS, runs in browser, workers and Node
  blocks.ts     block/item registry, tool tiers, mining times, atlas UVs
  worldgen.ts   seeded terrain/biomes/caves/ores/trees + greedy mesher (packed 10-byte vertices)
  physics.ts    AABB movement, raycasts (takes a block-lookup function)
  inventory.ts  all inventory/crafting/recipe-book/furnace-slot rules (applyAction is deterministic)
  furnace.ts, recipes.ts, mobs.ts (hitboxes), time.ts (day/night), protocol.ts (messages + binary codec)
server/
  core/game.ts   authoritative simulation: players, mobs, items, furnaces, damage, anti-cheat, saving
  core/world.ts  chunks generated on demand from the seed; only edits stored
  node.ts        HTTP + WebSocket transport, static hosting, rate limits, heartbeat, crash-safe saves
client/
  main.ts        menus, game loop, autosave, dev hooks (window.poxel only in dev)
  net.ts         Connection: local (Web Worker running server/core = single player) or remote WebSocket
  serverWorker.ts  the integrated single-player server
  session.ts     applies ServerMsg to client state (welcome/reconnect resync, blocks, inv, screens, health...)
  world.ts       client chunk store, worker pool (gen+mesh), per-chunk geometry, streaming
  player.ts      input, predicted movement (shared physics), dig/place prediction, camera/hand
  inventory.ts   inventory UI; predicts via shared rules, reconciles with server using seq/ack
  remote.ts      other players/mobs/items with 110 ms snapshot interpolation
  avatar.ts, ui.ts (state machine: menu/playing/paused/screen/chat/dead), input.ts, sky.ts, textures.ts
```

- **Who decides what:** the server is authoritative for blocks, mobs, items, furnaces, inventories and health. The client predicts movement, digging, placing and inventory clicks, and the server corrects it.
- **Single player** runs the same server code in a worker, so there is one set of rules. It pauses when the pause menu is open.
- **Identity:** player names are owned by a random token stored in the browser (`poxel_token`). Clearing browser data or switching devices means picking a new name on that server.

## Testing

- The scripts use `puppeteer-core` with the local Chrome. For real GPU numbers use `--use-angle=d3d11`. For two-tab multiplayer tests add `--disable-renderer-backgrounding --disable-background-timer-throttling --disable-backgrounding-occluded-windows`.
- **Suites:**
  - `cuj.mjs`: the critical journey (tree → planks → table → pickaxe → cobblestone → save/load).
  - `sp.mjs`, `mp.mjs`, `respawn.mjs`.
  - `crash.mjs`: hard-kills the server and checks reconnect and consistency.
  - `mobile.mjs phone|tablet`, `tunnel.mjs <url>`.
  - `soak.mjs <ws-url> <bots> <seconds>`: flood and fuzz; set `MAX_PER_IP=100` on the target server.
  - `content.mjs` (loot chests, farming, ice, new mobs) and `robotic.mjs` (portal, taming, the trip home).
  - `perf.mjs`.
- `npm run test:e2e` starts the Vite dev client and a test server (with `DEV_TOOLS=1`, so `window.poxel.glide` can teleport when the straight path is blocked; the server refuses moves into blocks). Never set `DEV_TOOLS` on a real server.
- **Last results:**

  | Suite | Result |
  |---|---|
  | CUJ | 12/12 |
  | Respawn | 8/8 |
  | Crash | 6/6 |
  | Tablet | 14/14 |
  | Phone | 13/14 (a dandelion correctly can't be planted off-grass) |
  | 10-minute soak | 0 errors |
  | Tunnel with two players | pass, 15 ms ping |

- **Test pitfalls learned the hard way:**
  - Blocks set only on the client (`window.poxel.setBlock`) aren't on the server, which now refuses moves into its solid blocks. Also send `{ t: 'dev', blocks: [x, y, z, id, ...] }`.
  - Don't edit code while a suite runs: Vite hot-reloads it mid-test.
  - Teleporting the player is rejected by the server's movement budget. Use `window.poxel.glide()`.
  - Moving the mouse while pointer-locked turns the camera. Park the mouse before aiming.
  - Plants get replaced when you place onto them.
  - Names get claimed across runs. Use unique names.
  - Vite HMR changes module URLs. Use the `window.poxel` hooks, not `import()`.
  - Background tabs throttle `requestAnimationFrame`.

## Recent fixes (for context)

- Respawn got stuck on the death screen.
- The nipplejs 1.x joystick API change meant the mobile joystick did nothing.
- The touch HUD covered menus.
- The phone inventory overflowed the screen.
- A server freeze in older code.
- Movement-budget anti-cheat, so chunk-generation DoS is no longer possible.
- Ghost players when a save failed.
- Corrupt-save recovery.
- Saves every 10 s.
- Reconnect resync.
- Name tokens.
- Several save-loss cases.
- GPU leaks.
- Worker failure fallback.
- Zombie server when the port was already taken.

## Owner preferences

- The owner only sees the final message of each assistant turn. Put questions, instructions and status there, and stop at milestones instead of working silently for a long time.
- Keep Poxel.io's own identity: never call it a Minecraft clone in titles, UI, docs or commits.
