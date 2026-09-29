# Poxel.io — Session Handoff (2026-09-27)

Poxel.io is a browser voxel sandbox game (its own game — never describe it as a clone of anything) with single player and a self-hosted multiplayer server. Latest commit: `36a65c5` on `master`, pushed to https://github.com/njytim-cyber/poxel.io.

## Next session: priorities (requested by the owner)

The owner asked for **more stability and performance management**. Start there, before new features:

1. **Put the test suites in the repo and make them repeatable.** Everything in "Testing" below currently lives in a temporary folder that disappears with this session. Move the scripts into `tests/e2e/`, and fix the hardcoded paths (the relative `ws` import path, the absolute Chrome path). Add `npm run test:e2e` plus a short README. Use fixed seeds (`startSingle(12345)`) and unique player names per run; see the test pitfalls below.
2. **Continuous health monitoring.**
   - Log `/health` stats (tickMs, tickMaxMs, rssMB, players, mobs, items, chunks) to a rolling file every minute.
   - Warn in the log when tickMaxMs > 25 ms or rss keeps growing.
   - Consider a tiny admin page that shows them.
3. **Performance budgets with regression checks.**
   - Baseline on the owner's PC (real GPU, headless `--use-angle=d3d11`): 60 FPS vsync while running across new terrain, p99 frame < 18 ms, no frames > 50 ms, about 90 world draw calls.
   - Server: about 3 ms average tick with 15 bots, worst case about 11 ms, memory plateaus around 215–230 MB under the 10-minute soak.
   - Make the perf/soak scripts fail when these regress.
4. **Known scaling limits to fix before real player growth.**
   - **The welcome message sends the entire edit list** (`world.exportEdits()`). It gets big on long-lived worlds. Stream edits per chunk as the client loads chunks, and drop edits that match the generated terrain.
   - **The server re-serializes the whole world JSON on every autosave** (10 s when changed). Move to per-chunk region files, or at least incremental writes.
   - **Single-player saves the whole world to localStorage every 10 s.** This will hit the quota on big worlds. Consider IndexedDB, and show storage usage.
   - `client/world.ts` `buildSectionInput` string-parses every `facing` entry for every section mesh. Index facing by chunk.
   - Item entity cap is 600 (oldest evicted). Death loot can be evicted by spam in busy servers.
5. **Longer soak and device matrix.**
   - Run a 60-minute soak; the old code froze after about 30 minutes, and the new code has only been proven for 10 minutes.
   - Test real Android/iOS devices over the tunnel.
   - Test a low-end GPU with render distance 2–3.
   - Consider adding a render-distance setting in the pause menu: `setRenderDistance` exists in `client/world.ts` but has no UI.

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
- **Hosting decision:** iterate on the owner's PC with the quick tunnel. Fly.io is set up (logged in as njytim@gmail.com, region `sin`, flyctl in `%USERPROFILE%\.fly\bin`), but **do not deploy there unless the owner asks.**
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

## Testing (scripts are in the temp scratchpad; move them, see priority 1)

- The scripts use `puppeteer-core` with the local Chrome. For real GPU numbers use `--use-angle=d3d11`. For two-tab multiplayer tests add `--disable-renderer-backgrounding --disable-background-timer-throttling --disable-backgrounding-occluded-windows`.
- **Suites:**
  - `cuj.mjs`: the critical journey (tree → planks → table → pickaxe → cobblestone → save/load).
  - `sp.mjs`, `mp.mjs`, `respawn.mjs`.
  - `crash.mjs`: hard-kills the server and checks reconnect and consistency.
  - `mobile.mjs phone|tablet`, `tunnel.mjs <url>`.
  - `soak.mjs <ws-url> <bots> <seconds>`: flood and fuzz; set `MAX_PER_IP=100` on the target server.
  - `perf.mjs` / `perfgpu.mjs`.
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
