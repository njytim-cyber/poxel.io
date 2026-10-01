# Poxel.io — Session Handoff (2026-10-01)

Poxel.io is a browser voxel sandbox game (its own game — never describe it as a clone of anything) with single player and multiplayer. Everything is on `master`, pushed to https://github.com/njytim-cyber/poxel.io. **Live:** https://poxel.njytim.workers.dev (Cloudflare).

## Status (2026-10-01)

- **Gameplay added:** 16 achievements (server-side, saved per character; banner + pause-menu list), critical hits (1.5x while falling after a jump), touch screens act where you tap (no crosshair), aiming passes through your own tamed robots.
- **Hosting:** website and multiplayer entrance on Cloudflare (a Worker on workers.dev, account njytim@gmail.com). The game server runs on the owner's PC behind a quick tunnel: `npm.cmd run host:cf` (see How to run). No domain or paid server yet, on purpose (see Decisions).
- **Multiplayer UX:** one-tap **Play Online**; **Invite friends** (pause menu: share/copy link + QR; newcomers start 2 blocks from the inviter on solid ground, facing them); loading screen; refusals/kicks/offline go back to the menu with the reason; **held seats** (an unexpected drop keeps you in the world 60 s; others see "reconnecting..."); ping always on screen; player list shown even alone; click (desktop) / tap (touch) to give up while down; name tags fade up close.
- **Code:** multiplayer menu flow moved to `client/multiplayer.ts` (main.ts 871 → 690 lines).
- **Tests:** 82 unit tests (incl. `items.test.ts`: smelting, every click type, 15,000 random clicks with no duplication/loss; `server.test.ts`: the real network server vs bad input). 15 browser suites incl. new `join`, `mpcuj` (multiplayer journey) and `actions`. `npm run coverage`: server+shared **94% of lines**; **83% of named client functions** run in browser tests.
- **Probed:** a 4x-slowed phone CPU and 150-300 ms round trips: frames stay ~7 ms, no server corrections, smooth remote movement. Real low-end phones, iPhones (Safari) and many players at once are still untested.

## Decisions (and why)

- **No spending until multiplayer is proven.** Then: pick the game's new name (Poxel clashes with the poxel.io shooter), buy the domain on Cloudflare (~US$10/yr), and put the server behind a **named Cloudflare Tunnel** (free, stable). An always-on server later: a small VPS (e.g. DigitalOcean Singapore) behind the same tunnel. Without a domain, the researched options were Northflank (free sandbox, if it allows Singapore + a volume: unverified), Render ($7.25/mo) and Railway (~$5/mo, rough 2026 reliability).
- **Fly.io dropped:** its Windows CLI is unsigned, and **Smart App Control is On** on this PC and must stay on. Railway, Render, Koyeb and DigitalOcean CLIs are unsigned too. Signed tools that work: `cloudflared`, `wrangler` (npm), `gh`, `ssh`, Node. Never suggest turning Smart App Control off.
- **No automatic GitHub Actions** (the owner watches Actions minutes). Tests run on this PC before every push.

## Next session: priorities

1. **Playtest with friends** through the live link (`npm.cmd run host:cf`), ideally including a real phone and an iPhone. That's the "multiplayer proven" gate for the name + domain step.
2. **Name + domain**, then the named tunnel (no more quick-tunnel restarts).
3. **Coverage gaps:** `npm run coverage` lists client functions that never ran. Known holes: migrating old saves, creative-mode details, some network-server branches. `mpcuj` hangs under coverage (its Save & Quit reload: "detached Frame"; it passes normally), so coverage leaves it out; fix if coverage of that journey is wanted.
4. **Robotic World stage 2** follow-ups and **server autosave** (whole `world.json` each save; move to per-chunk files before worlds get big).
5. Ideas from the multiplayer research (not started): Cloudflare Turnstile on join, a chat filter + mute/report/kick, recovering a name on a new device, `/tp <friend>`, a world list once there's more than one world.

## How to run

```bash
npm install
npm run dev        # Vite dev client at http://localhost:5173/poxel.io/ (has window.poxel test hooks)
npm run host       # build + start the game server on :8080 (also serves the built game at /poxel.io/)
npm run tunnel     # Cloudflare quick tunnel -> prints https://<random>.trycloudflare.com to share
npm run deploy     # build + publish static client to GitHub Pages (single player + manual server address)
npm run deploy:cf  # build + deploy the website/Worker to Cloudflare (https://poxel.njytim.workers.dev)
npm run host:cf    # multiplayer for the live site: game server on this PC + quick tunnel, Worker re-pointed
npm test           # unit + all browser suites;  npm run test:unit  /  npm run test:e2e [suite...] [-suite]
npm run coverage   # coverage: server+shared lines (HTML in coverage/server) + client functions never run
```

- **Hosting a session:** in the owner's PowerShell run `npm.cmd run host:cf` (not `npm`: script execution policy blocks `npm.ps1`/`npx.ps1`). Wait for "Multiplayer is live", then share https://poxel.njytim.workers.dev. Ctrl+C saves and stops. Server-side code changes only take effect after restarting it.

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
  multiplayer.ts Play Online, joining (loading screen), invite links + QR, errors back to the menu, ping
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
- **Held seats:** if a connection drops unexpectedly (any close code but 1000/1001), the server keeps the player in the world for 60 s (`SEAT_HOLD`) and others see them as "reconnecting". Reconnecting with the same token resumes them. Quitting or closing the tab leaves at once.
- **E2E tests and the real mouse:** on Windows, Chrome's pointer lock clips the real cursor even for headless pages, so `lib.mjs` gives every test page a stand-in pointer lock. Close test pages with `page.close()` (a clean close) before `browser.close()`, or their players stay held on the server and leak into the next suite.

## Testing

- The scripts use `puppeteer-core` with the local Chrome. For real GPU numbers use `--use-angle=d3d11`. For two-tab multiplayer tests add `--disable-renderer-backgrounding --disable-background-timer-throttling --disable-backgrounding-occluded-windows`.
- **Suites:**
  - `cuj.mjs`: the critical journey (tree → planks → table → pickaxe → cobblestone → save/load).
  - `mpcuj.mjs`: the multiplayer journey (desktop host + phone friend: Play Online, invite, chat, fight, downed, a real connection drop and reconnect into the held place, quit), with join time, frame times and network use.
  - `join.mjs`: one-tap Play, loading screen, invite links, refusals and offline servers landing on the menu.
  - `sp.mjs`, `mp.mjs`, `respawn.mjs`.
  - `crash.mjs`: hard-kills the server and checks reconnect and consistency.
  - `mobile.mjs phone|tablet`, `tunnel.mjs <url>`.
  - `soak.mjs <ws-url> <bots> <seconds>`: flood and fuzz; set `MAX_PER_IP=100` on the target server.
  - `content.mjs` (loot chests, farming, ice, new mobs) and `robotic.mjs` (portal, taming, the trip home).
  - `perf.mjs`.
- `npm run test:e2e` starts the Vite dev client and a test server (with `DEV_TOOLS=1`, so `window.poxel.glide` can teleport when the straight path is blocked; the server refuses moves into blocks). Never set `DEV_TOOLS` on a real server.
  - `actions.mjs`: furnace screen, long-press split, Q / Ctrl+Q, eating, H for a home (+ toast), a critical hit, window resize, creative flying.
  - Unit: `tests/unit/game.test.ts` (rules), `items.test.ts` (smelting, clicks, no-dupe fuzz), `server.test.ts` (real server vs bad input).
- **Last results (2026-10-01):** unit 82/82; all 15 browser suites pass (bot, sp, cuj, respawn, mp, join, mpcuj 20/20, actions 13/13, carry, content, robotic, crash, phone, tablet, perf 6/6 at ~7 ms frames). Live check through Cloudflare: two players, join in under a second, 16 ms ping.

- **Test pitfalls learned the hard way:**
  - Blocks set only on the client (`window.poxel.setBlock`) aren't on the server, which now refuses moves into its solid blocks. Also send `{ t: 'dev', blocks: [x, y, z, id, ...] }`.
  - Don't edit code while a suite runs: Vite hot-reloads it mid-test.
  - Teleporting the player is rejected by the server's movement budget. Use `window.poxel.glide()`.
  - Moving the mouse while pointer-locked turns the camera. Park the mouse before aiming.
  - Plants get replaced when you place onto them.
  - Names get claimed across runs. Use unique names.
  - Vite HMR changes module URLs. Use the `window.poxel` hooks, not `import()`.
  - Background tabs throttle `requestAnimationFrame`.
  - In the dev client the page also has Vite's live-reload WebSocket: closing it reloads the page. Filter by host when cutting the game's socket.
  - Timing checks (jump-then-hit) need retries at slightly different moments; coverage instrumentation slows the game.
  - Run the whole suite with `node tests/e2e/run.mjs` (or `npm run test:e2e`); `-name` leaves a suite out.

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
- Do setup through command-line tools by default; ask the owner only for what needs them (a browser approval, a payment method). No workarounds around security protections.
- Test for bugs (typecheck, unit, browser suites) before every push or deploy.
- Minimise spending until there's a working product.
