# The Elemental World (a secret dimension)

The game never tells players how to get here. There is no hint in the recipe book, chat or compass outside it, and its achievements show as "???" until they're earned. Code: `shared/elemental.ts` (terrain and portal) and `server/core/game.ts` (bosses and effects).

## Getting there
- Build an upright frame around a hole 2 wide and 3 tall:
  - **Top:** 4 Blocks of Etherite (corners included).
  - **Bottom:** 4 Blocks of Gold.
  - **One side:** 3 **Blocks of Obitite** (new: 4 obitite each).
  - **Other side:** 3 Blocks of Moonstone (4 moonstone each).
  - The sides can go either way round.
- Fill the hole with 6 **robot eyes**. When the last eye or frame block goes in, the eyes turn into a glowing **portal**. Walk into it.
- You arrive in front of a portal on the other side. If there isn't one, a return portal is built on untouched ground. Its frame (`elemental_frame`) drops nothing. It is never built on someone else's claim, a boss shrine or a loot chest.
- Breaking any frame block puts the portal out, and the eyes are used up. Portal blocks can't be mined.
- Portals only light near the middle of the Overworld (|x| < about 29,900) or inside the Elemental World. Further out, the eyes "flicker but stay dark".
- Your robots come with you, except ones guarding a spot.

## The world
- A strip far to the west, at x from -130000 to -70000. A portal at x leads to x - 100000 and back.
- Four biomes in regions of about 360 blocks, each region's biome picked at random. Heights blend over 40 blocks at the borders.
  - **Frosted Lands (water):** glaciers and ridges of snow over permafrost, ice spikes, frozen lakes, ice caves, and glacite ore (diamond pickaxe). Ice ruins hold loot chests. Frostbitten and skeletons roam here.
  - **Volcano (lava):** basalt, volcanic ash and **magma blocks**, which burn whoever stands on them. There are lava lakes and smoking cones with lava craters, obsidian, gold and diamonds, and lava in the deepest caves. Husks and skeletons roam here.
  - **Overgrown Jungle (earth):** moss and grass, giant **jungle trees** (jungle logs make planks), swampy pools, berries and melons. Spiders, zombies and slimes roam here.
  - **Cloud Kingdom (wind):** a sea of **clouds** to walk on, with nothing below it but a very long fall. **Skystone** islands float overhead. Skeletons roam here.
- Each biome has its own sky: pale polar twilight, smoky red, steamy green, or bright blue above the clouds.

## Bosses and their temples
- **Temples:** each boss guards a temple, about one per 256 × 256 area, built in its biome's style.
  - A round arena 19 blocks across, with a low wall and four gateways.
  - Six pillars topped with braziers.
  - The shrine's core in the middle, which can't be mined.
  - **Two loot chests** at the back, with diamonds, etherite, golden apples, moonstone orbs, the biome's own blocks, and a small chance of the element's ore.
- **The Cloud Kingdom's temple** floats on a skystone platform at y 57, high above the cloud sea. A spiral stair climbs to its east gateway.
- **When bosses rise:** a boss rises when a player comes within 40 blocks, and returns 5 minutes after being defeated. A held compass points to the nearest temple.
- **Phase two:** below half health every boss is **enraged** ("The ... is enraged!", a burst of light and a red pulse). Its waits between moves are 40% shorter, and it gains new moves.
- **Leaping:** walking bosses that lose sight of you for 4 s leap towards you, so a pillar won't keep them stuck.

| Boss | Moves | Phase two adds | Drops |
|---|---|---|---|
| **Frost Wraith** (floats; icicle shards circle it) | Icicle volleys (3 icicles, 2 hearts and a chill each). **Icicle rain**: 5 icicles drop from above; each landing spot is marked on the ground first; they freeze you solid for 1.5 s. **Frost nova** up close: freezes everyone for 2 s. Calls up frostbitten. A chilling touch. | 5-icicle volleys, 8-icicle rain | Water ore 2-4, glacite, sometimes a Frost Heart |
| **Magma Colossus** (a molten core in its chest, a spiked back) | Fireballs. **Magma barrage**: gathers 5 balls of magma circling its head, then throws them one by one in high arcs. Each does **10 hearts** to a player without armour, and splashes and burns everyone close. **Ground slam**: throws everyone close up and burns them. Punches. | **Eruption**: fireballs rain from the sky around you; faster throws | Lava ore 2-4, obsidian, magma blocks |
| **Thorn Guardian** (bark, moss, thorns, a crown of flowers) | Poison thorns. Roots you to the spot. **Stomp**: it rears up with a warning ring, then everything within 8 blocks, players and mobs alike, is hurt (3 hearts) and **thrown about 8 blocks**. Heavy hits. | **Poison spores** all around (10 blocks) | Earth ore 2-4, moss, jungle logs |
| **Tempest** (flies; a gold core inside three spinning gold rings, on white wings) | **Lasers from its core** (2.5 hearts). Gusts blow everyone away. **Hurricanes**: summons 2 that chase you for 12 s and fling you high into the air. They can't be hurt. | Bursts of three lasers, 3 hurricanes | Wind ore 2-4, feathers, clouds |

### What you see
- **Particles:** every boss gives off its own: embers, leaves, snowflakes, sparks, whirling dust. There are more of them when it's enraged.
- **Projectiles:** fireballs are blazing balls with spark trails, magma balls are molten rocks trailing smoke, and icicles are long ice spikes that fly point first.
- **Impacts:**
  - Explosions are fiery bursts with a shockwave ring.
  - Stomps and slams send a dust or fire ring across the ground.
  - Frost novas are a blue ring.
  - Icicle landing spots get a red warning circle.
- **Screen shake** from big hits nearby. The screen edge turns icy blue when frozen, green when poisoned and orange when burning.

## Elemental armour (one piece per element)
Each piece is etherite in the usual armour shape, with the element's ore in the middle.

All armour is now drawn as plates worn over the body, like real armour, instead of recolouring the skin. Each material has its own texture, with edges, a shine and rivets, and helmets show the face. Elemental pieces carry their element's **trim**: waves (water), glowing cracks (lava), vines and flowers (earth), gold swirls (wind). Their icons show the trim too.

| Piece | Recipe | Power |
|---|---|---|
| **Water Helmet** | etherite with water ore | Breathe underwater forever, swim as fast as you walk, clear sight underwater |
| **Lava Chestplate** | etherite with lava ore | Lava, fire and magma can't hurt you. Press **.** (🔥 on phones) to shoot a blazing fireball (3 hearts, explodes and sets things on fire, 1.2 s cooldown) |
| **Earth Leggings** | etherite with earth ore | **20 hearts** while worn, and your hits knock enemies 2.2× further |
| **Wind Boots** | etherite with wind ore | No fall damage |
| **Poison Sword** | water, lava, earth and wind ore, 2 obitite and a stick | Obitite-sword damage, and every hit poisons for 5 s. Poison does 1 damage a second and never kills a player on its own |

## New for everyone
- **Drowning**: you have 15 s of air underwater (or in oil), shown as bubbles above the hunger bar. After that, 1 heart a second.
- On fire or poisoned: the edge of the screen glows orange or green.

## Other items
- **Glacite tools**: as strong as etherite, and every hit chills (slows) the target.
- **Frost Heart**: held, or in the offhand, it keeps cold out: no slowing, no freezing in powder snow.

## Achievements (all secret)
Elemental (find the world), Deep Freeze (glacite), Thaw (Frost Wraith), Cooled Down (Magma Colossus), Weed Killer (Thorn Guardian), Grounded (Tempest), Venomous (make the poison sword).
