# The Frost World (a secret dimension)

The game never tells players how to get here. There is no recipe-book hint, no chat hint and no compass hint outside it. Its achievements show as "???" until they're earned.

## Getting there
- Build an upright frame of **Blocks of Moonstone** (4 moonstone each), like a doorway. The hole is 2 wide and 3 tall, and the frame needs 10 blocks. The corners are optional.
- Fill the 2×3 hole with **robot eyes** (from the Robotic World). When the last eye goes in, the eyes turn into a glowing blue **Frost Portal**. It works whether the last block placed is an eye or a frame block.
- **Walk into the portal** to travel. You arrive in front of a portal on the other side. If there isn't one, a return portal is built on untouched ground. Its frame (`frost_frame`) drops nothing, so travelling can't make free moonstone.
- Breaking any frame block puts the whole portal out, and the eyes are used up. Portal blocks can't be mined.
- Your robots come with you, except ones guarding a spot.

## The world
- A strip far to the west, at x from -130000 to -70000. A portal at x leads to x - 100000 and back (`shared/frost.ts`). Bedrock walls separate it from the Overworld, as with the Robotic World.
- Glacier plains and ridges of snow over **permafrost**. There are packed ice patches, tall **ice spikes**, and frozen lakes with ice over water.
- **Ice caves**: tunnels whose walls are packed ice and blue ice.
- Ores: **glacite** (rare, deep, needs a diamond pickaxe), lots of frost crystal, coal, iron and a little diamond.
- **Ice ruins**: half-fallen snow brick houses with a lantern and a loot chest (frost crystals, glacite, moonstone, moonstone orbs...).
- A long polar twilight: a pale sky, close fog and no sun. Frostbitten and skeletons roam at any hour.

## The Frost Wraith (boss)
- About one shrine per 256 × 256 area: a round blue ice floor with a ring of ice pillars and a `frost_shrine` core that can't be mined.
- The Wraith rises when a player comes within 40 blocks. It is 3 blocks tall, has 250 health, and floats about 2.5 blocks above the ground.
  - **Ice beam**: 3 hearts and slows you for 3 s.
  - Up close, a **chilling touch**: 2 hearts and a slow.
  - Every 18 s (12 on Hard) it **calls up two frostbitten** around you.
- It drops 6-10 **glacite**, and half the time a **Frost Heart**. It rises again 30 minutes after being defeated.
- A held compass points to the nearest shrine while you're in the Frost World.

## Items
- **Glacite tools** (pickaxe, axe, shovel, hoe, sword): as strong as etherite. Every hit **chills** what it hits: mobs move at 40% speed for 3 s, players are slowed for 2 s.
- **Frost Heart**: held, or in the offhand. Cold can't touch you: no slowing, no freezing in powder snow, and frostbitten hits don't chill you.
- Being slowed: you move at half speed, and a cold blue edge shows round the screen.

## Achievements (secret)
- Cold Feet: find the Frost World. Deep Freeze: get glacite. Thaw: defeat the Frost Wraith.
