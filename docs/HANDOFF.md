# Riventale — Session Handoff (2026-10-03)

## Read first (2026-10-03)

- **Direction change:** the game is moving to the new domain **riventale.world** and will become an **app-based game**. **Principal development now happens on another machine**; this PC (the owner's Windows PC) is no longer the main dev box.
- **Cloudflare account for the new domain: tim@latticelogic.app.** riventale.world was bought through Cloudflare Registrar in that account (2026-10-03) and is live. If it won't load on the owner's home Wi-Fi, that's an old "doesn't exist" answer cached by their router/provider from lookups made before the domain went live (it expires by itself). When checking a new domain, ask Cloudflare's DNS directly (`nslookup <name> 1.1.1.1`), never through the home network.
  - **Poxel.io is retired** (owner, 2026-10-03). The project, repo (https://github.com/njytim-cyber/riventale), package and paths are all Riventale now. The old Worker `poxel` (https://poxel.njytim.workers.dev, account njytim@gmail.com) still exists but nothing deploys to it any more; its config was removed. Deleting it is the owner's call.
  - **Account rule (owner's instruction):** tim@latticelogic.app holds **only** riventale.world. Every other side or non-commercial project goes in njytim@gmail.com. Never mix them. Before any `wrangler deploy`, `npm run deploy:cf`, `npm run host:cf` or DNS change, run `npx wrangler whoami` and check the account matches the project. **riventale.world is the only domain the owner owns**: the old site has none (it's on workers.dev).
- **Name confirmed:** the game is called **Riventale** (confirmed by the owner 2026-10-03).
- **Code state:** `master` is pushed and deployed to https://riventale.world (single player only). Wrangler on the owner's PC is signed in to tim@latticelogic.app.
- **GitHub Actions:** the repo has **no workflows**, and shipping (git push + `npm run deploy:cf` from the PC) uses no Actions minutes. The only runs in the Actions tab are GitHub Pages' own "pages build and deployment" for the old `gh-pages` branch (https://njytim-cyber.github.io/riventale/, an outdated poxel build). The repo is public, so those cost nothing. Turning Pages off is the owner's call.
- The owner's untracked `index.docx` must never be committed.

### riventale.world (static site live since 2026-10-03; multiplayer later)

The game is now called **Riventale** in the UI: page title, a pixel-art crest and wordmark on the main menu, a favicon, home-screen icons and a web manifest (all in `public/`, drawn by `npm run art` = `scripts/art.mjs`). Saved-data keys (`poxel_*`), the `x-poxel-*` Worker headers and the `window.poxel` test hooks were left alone on purpose (saves carry over; nobody sees them). The path the game is served under (Vite base for `npm run dev`/`build`, and the game server) is now `/riventale/`.

Menus polished on 2026-10-03 (all live):
- **Wardrobe** (the shop, `#shop-screen`; code in client/main.ts under "Shop Scene Setup"): night-sky stage; the character has greyscale pixel textures tinted by each colour (`shopTexture`), a neck, split legs, arms angled from the shoulders and an idle animation (`animateShopAvatar`); a voxel plinth with a gold band; a rim light; a 360° turn handle (`#shop-turn`) plus drag/swipe. Category tabs, palettes plus a **Custom** hue/saturation/brightness picker under each, hair styles, **Sets** with rarity cards and unlock progress, Random, Cancel (back to the saved look) and Save look. One "selected" style everywhere: a gold ring (outline). Owner asked for this level of polish after a design review; keep the same style for new screens.
- **Load game**: each slot is a card coloured by its world's difficulty (icon, day/night, hearts, achievements, "Saved N min ago" from `getSaveTime` in client/saves.ts). Empty slots start a new world there, after the difficulty choice.
- Pixel titles (WARDROBE, LOAD GAME, CHOOSE YOUR PATH) and icons (die, sets, lock, difficulty) are drawn in `scripts/art.mjs` (5x7 font in `GLYPHS`; 16x16 `sprite()` maps). Run `npm run art` after changing it; the outputs in `public/` are committed.

Also on the site: a themed **Choose your path** difficulty screen (three element-coloured cards with pixel icons) and a **Forging your world** loading screen for single-player worlds (`client/worldLoading.ts`: crest with orbiting element orbs, steps, a bar that follows the chunks loaded round the player, a tip).

The Worker config is `cloudflare/wrangler.jsonc` (Worker `riventale`, account tim@latticelogic.app). `npm run build:cf` builds with `--mode riventale` (`.env.riventale`: `VITE_MULTIPLAYER=off`), which hides Play Online and "Name & server" until multiplayer is set up. Dev and test builds keep them.

1. `npx wrangler whoami` must show **tim@latticelogic.app**. If not: `npx wrangler logout`, then `npx wrangler login` as that account.
2. `npm run deploy:cf` builds and deploys.
3. Live: https://riventale.world and https://www.riventale.world (custom domains in `cloudflare/wrangler.jsonc`), plus https://riventale.tim-00e.workers.dev. Consider `"workers_dev": false` later.
4. Multiplayer is deliberately not set up for riventale yet (the owner will decide later). The menu hides it (see above). `npm run host:cf` now targets https://riventale.world; to turn multiplayer on, remove `.env.riventale`'s switch, then run host:cf.

### Work in this commit (since 3a537c8)

- **The Tempest's transformation is a 10-second cinematic** (`TRANSFORM_SECONDS` in server/core/game.ts and client/remote.ts must match). It can't be hurt meanwhile.
  1. It flies to the middle of its temple (`m.home`, set when a temple boss rises).
  2. It fires a held laser at each standing crystal in turn, absorbing it (+60 hp each).
  3. Its rings spin up and shatter, and its wings fade away.
  4. Light pours in (fx `gather` at 6.8 s).
  5. At 8.2 s, the burst (fx `transform`): four wings fade back in and snap open, and the halo drops on.
  Client side: `tempestForm()` in client/remote.ts.
- **Tempest health is 480** (it was 960; the owner said it was too strong).
- **Dev-only** `{t:'dev', enrageNear:true}`: puts a boss that's already up into phase two. It's used to film or test the transformation at a real temple. The script used was in a session scratchpad: start single player with seed 777 and find a clouds shrine with `nearestShrine`.
- **Earlier today (in 3a537c8):** themed boss bars, the Tempest's second form, review fixes, and more. See the sections below.
- **Tests:** 121 unit tests pass. Browser suites pass, except:
  - `perf` fails when the machine is busy. Chunk generation was benchmarked in Node at the same speed as before.
  - `join`/`mpcuj` are flaky under load and pass when run alone.

### Requested but NOT started: dragons, Black Knight, totems (owner's spec, with their answers)

1. **Dragon Altar** (craftable in the crafting table, normal world, not secret). Placing it uses it up and teleports you to a **boss arena**. Plan: a new far-off strip like the other worlds (for example `shared/lair.ts`, x 170000-171024, a floating obsidian arena in the void, with an exit block back to where you came from). Every `isRobotic`/`isElemental` hook would need a lair case:
   - worldgen.ts: columnInfo, generateChunkData, placeFeatures, structureInRegion;
   - client/sky.ts;
   - client/weather.ts;
   - mob spawning in game.ts;
   - daylight.
2. **Black Dragon, 800 health.** It flies, swoops and nearly one-shots you, uses only elemental abilities, and has **8 moves**. Proposed:
   - fire breath (fireball fan);
   - magma meteors (marked);
   - frost breath (icicles, freeze);
   - quake slam;
   - poison cloud;
   - hurricanes;
   - lightning storm;
   - a telegraphed death swoop (~17 damage).
3. **The Elemental Core becomes a black dragon, 1500 health** (currently 2000 in shared/mobs.ts). A **spinner on its head** picks its element (**fire, earth, wind, water**), and its **spikes, teeth and eyes** recolour to match. It keeps the existing element cycling (`updateCore` with `CORE_ELEMENTS`). **Second form: it transforms into a Black Knight** and fights on foot with melee, a dash, elemental sword waves and a leap slam.
4. **Totems: Speed and Jump.** They are crafted, stack (to 16; the effect does not grow with stack size), and work **in the offhand** (`slots[60]`, `OFFHAND` in shared/inventory.ts) or **placed as a block**, which buffs everyone within 5 blocks. There is no generic buff system yet: add a server→client `buff` message and multiply client walk speed and `JUMP_VELOCITY` (client/player.ts). Server move budgets (game.ts onMove, refill 11/13 per s) should allow about ×1.35.
5. The owner asked to confirm with them before building, since the app direction may change priorities.

### Name research (2026-10-03)

The owner picked **Riventale** (riventale.world). For the record, names checked earlier and found free on .io: Cubelore, Voxelborn, Voxeltempest, Elementalbound, Cubiara, Poxelforge, Voxzy. Taken: voxel.io, VoxelCraft, VoxelForge, Voxelmine, Voxel Quest, Cubia.

## Earlier handoff (2026-10-01)

Riventale is a browser voxel sandbox game (its own game — never describe it as a clone of anything) with single player and multiplayer. Everything is on `master`, pushed to https://github.com/njytim-cyber/riventale. **Live:** https://riventale.world (Cloudflare, single player).

## Status (2026-10-01)

- **Gameplay added:** 16 achievements (server-side, saved per character; banner + pause-menu list), critical hits (1.5x while falling after a jump), touch screens act where you tap (no crosshair), aiming passes through your own tamed robots.
- **Hosting:** website and multiplayer entrance on Cloudflare (a Worker on workers.dev, account njytim@gmail.com). The game server runs on the owner's PC behind a quick tunnel: `npm.cmd run host:cf` (see How to run). No domain or paid server yet, on purpose (see Decisions).
- **Multiplayer UX:** one-tap **Play Online**; **Invite friends** (pause menu: share/copy link + QR; newcomers start 2 blocks from the inviter on solid ground, facing them); loading screen; refusals/kicks/offline go back to the menu with the reason; **held seats** (an unexpected drop keeps you in the world 60 s; others see "reconnecting..."); ping always on screen; player list shown even alone; click (desktop) / tap (touch) to give up while down; name tags fade up close.
- **Code:** multiplayer menu flow moved to `client/multiplayer.ts` (main.ts 871 → 690 lines).
- **Tests:** 82 unit tests (incl. `items.test.ts`: smelting, every click type, 15,000 random clicks with no duplication/loss; `server.test.ts`: the real network server vs bad input). 15 browser suites incl. new `join`, `mpcuj` (multiplayer journey) and `actions`. `npm run coverage`: server+shared **94% of lines**; **83% of named client functions** run in browser tests.
- **Probed:** a 4x-slowed phone CPU and 150-300 ms round trips: frames stay ~7 ms, no server corrections, smooth remote movement. Real low-end phones, iPhones (Safari) and many players at once are still untested.

## Added later on 2026-10-01 (second session)

- **Banners and dyes**: new dyes (white from bones; orange, purple, pink and cyan mixed from two dyes), so there are 10 colours. Any wool can be dyed any colour. Each colour has a banner: 6 wool over a stick. A banner is drawn as one flat cloth facing whoever placed it. Placing a block next to a torch or banner no longer replaces it (`isReplaceable`).
- **Claim stones**: stone bricks around an iron ingot. In multiplayer, only the owner and players they `/trust` can build, dig, till, or open chests and furnaces within 16 blocks (any height). Only the owner (or an operator) can take the stone back. A claim can't be within 40 blocks of the world spawn or overlap someone else's. 3 per player. `/claims`, `/trust`, `/untrust`. "Entering X's land" toasts. Saved in `world.json` (`claims`, `trust`).
- **Moonstone orbs**: moonstone around glass, 2 per craft. Use one to pick a destination: a friend (they must accept with Y/N or `/tpaccept`, `/tpdeny`), a set home, or where you last died. The orb is used up when you arrive.
- **Robot squads**: G (or the pause menu, or 🤖 on phones, or `/robots <order>`) gives tamed robots orders. **Follow**; **Guard** (keeps watch where you stood; stays when you travel, goes back to its post when you rejoin); **Collect** (fetches dropped items within 12 blocks and hands them over). Orders, posts and carried items are saved with the player.
- **The Elemental World (secret)**: see `docs/elemental-world.md`. The portal frame is etherite blocks on top, gold below, obitite down one side and moonstone down the other, with robot eyes inside. It has four biomes (Frosted Lands, Volcano, Overgrown Jungle, Cloud Kingdom), each with a boss that drops its elemental ore. The ores make one armour piece each: a water helmet (breathing), a lava chestplate (lava immunity, . for fireballs), earth leggings (20 hearts, knockback) and wind boots (no fall damage). The poison sword uses every element. Drowning was added so the helmet matters.
- **Armour**: a full tungsten set blocks robot lasers; a full obitite set (the jetpack counts) blocks lava.
- **Creative code** changed (only its fingerprint is in `server/core/game.ts`). The owner has the code.
- 7 new achievements (3 secret, shown as ??? until earned). New tests: `tests/unit/features.test.ts`, browser suite `features`.
- **Boss fights upgraded** (see `docs/elemental-world.md`):
  - Every Elemental boss has several moves on their own timers, plus a second phase below half health.
  - The Frost Wraith has icicle volleys, icicle rain marked on the ground (freezes you solid) and a frost nova.
  - The Magma Colossus gathers 5 magma balls and throws them one by one (10 hearts each without armour), slams the ground, and in phase two makes fireballs rain from the sky.
  - The Thorn Guardian stomps (everything within 8 blocks is hurt and thrown about 8 blocks) and, in phase two, bursts into poison spores.
  - The Tempest (renamed from the Storm Roc: a gold core in gold rings, with white wings) fires lasers from its core and summons hurricanes that fling you up.
  - Each boss now has a temple with two loot chests. The Cloud Kingdom's floats at y 48 with a spiral stair. (2026-10-02: temples now sit at the middle of each biome, radius 16, four 16-tall towers with boss crystals that heal the boss; the Tempest (480 hp) has a second form; the Elemental Core has 2000 hp.)
  - All bosses (the Robot Titan too) come back **5 minutes** after being defeated.
  - Visuals: a particle system (`client/particles.ts`) with effects sent as `fx` messages, screen shake, projectiles with glows and trails, and new boss models.
  - Armour is now drawn as plates over the body, with elemental trims. Ores have their own icons.
  - Browser suite `bosses` screenshots all of it.
- **More (2026-10-02):**
  - **The Elemental Core**, a final boss, is summoned at a craftable Elemental Altar once all four elemental bosses are beaten. It cycles through their moves and drops Elemental Wings (gliding). Details in `docs/elemental-world.md`.
  - **Elemental tools:** Blazing, Tidal, Quaking and Gale versions of the obitite sword, pickaxe, axe and shovel.
  - **Teams:** `/team <colour>` starts a team (a colour nobody has yet); joining one with members needs `/team invite <name>` from a member. Also `/team leave` and `/team list`. Name tags and the player list show the colour, teammates share claims, and there is no friendly fire (fireballs included). Saved in `world.json`.
  - **Weather** (`client/weather.ts`):
    - The server switches between clear, rain and thunder. Snow falls in cold biomes, never in the desert, and drops never fall under roofs.
    - Lightning strikes near players in storms (5 damage plus fire), and rain puts out burning players.
    - The Elemental World has its own weather per biome: snow, ash, drizzle.
  - **Boats** (a U of planks): use one on water, row with W, sneak to get out.
  - **Minecarts and rails** (iron): use a minecart on a rail. It follows the rails up and down steps and round corners, and stops where they end.
  - **Other changes:**
    - Creative flying was really running at walking speed; it's now 14 blocks/s (32 sprinting).
    - The Tempest has 480 health and perches every so often.
    - Every creature has a spawn egg (creative menu).
  - Browser suite `world` plays through riding, weather, gliding and the Core.
- **Protocol version 4.** Tabs still on the old client are told to refresh. The server must be restarted together with the website deploy.
- **Flaky browser checks seen under load** (each passes when rerun):
  - the critical hit in `actions` (jump timing);
  - "leave handled" in `mp` (a fixed 1.5 s wait);
  - once, `carry` joined with the previous suite's inventory.

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
npm run dev        # Vite dev client at http://localhost:5173/riventale/ (has window.poxel test hooks)
npm run host       # build + start the game server on :8080 (also serves the built game at /riventale/)
npm run tunnel     # Cloudflare quick tunnel -> prints https://<random>.trycloudflare.com to share
npm run deploy     # build + publish static client to GitHub Pages (single player + manual server address)
npm run deploy:cf  # build + deploy the website/Worker to Cloudflare (https://riventale.world)
npm run host:cf    # multiplayer for the live site: game server on this PC + quick tunnel, Worker re-pointed
npm test           # unit + all browser suites;  npm run test:unit  /  npm run test:e2e [suite...] [-suite]
npm run coverage   # coverage: server+shared lines (HTML in coverage/server) + client functions never run
```

- **Hosting a session:** in the owner's PowerShell run `npm.cmd run host:cf` (not `npm`: script execution policy blocks `npm.ps1`/`npx.ps1`). Wait for "Multiplayer is live", then share https://riventale.world. Ctrl+C saves and stops. Server-side code changes only take effect after restarting it.

- `cloudflared` is the official standalone binary in `%USERPROFILE%\.cloudflared-bin\cloudflared.exe`. It is not on PATH, and `npm run tunnel` uses the full path.
- **Quick tunnels expire without warning** ("Tunnel not found" in the cloudflared log). Restart `npm run tunnel` to get a new link. A stable URL needs a free Cloudflare account and a named tunnel.
- Server env vars: `PORT` (8080), `DATA_DIR` (`./data`, gitignored), `MAX_PLAYERS` (16), `MAX_PER_IP` (4), `SEED`.
- The world and players are saved in `data/world.json` and `data/players/<name>.json`, each with a `.bak`. Corrupt files are moved to `*.corrupt-<ts>`.
- **Hosting decision:** the website is on Cloudflare (`npm run deploy:cf` → https://riventale.world; `cloudflare/worker.js` also forwards multiplayer to `ORIGIN_URL` with the shared `ORIGIN_SECRET`). For now the game server runs on the owner's PC: `npm run host:cf` starts it with a fresh `ORIGIN_SECRET`, opens a Cloudflare quick tunnel, and points the Worker at it (`wrangler secret bulk`), so players always use the workers.dev link. No domain or paid server until multiplayer is proven; after that, a domain plus an always-on server (e.g. DigitalOcean Singapore) behind a named Cloudflare Tunnel. Fly.io was dropped: its Windows tool is unsigned, and Smart App Control (which stays on) blocks it.
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
- Keep Riventale's own identity: never describe it as a clone or copy of another game in titles, UI, docs or commits.
- Do setup through command-line tools by default; ask the owner only for what needs them (a browser approval, a payment method). No workarounds around security protections.
- Test for bugs (typecheck, unit, browser suites) before every push or deploy.
- Minimise spending until there's a working product.
