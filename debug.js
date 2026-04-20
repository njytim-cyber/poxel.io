// debug.js
const worldData = new Map();
function addStaticBlock(x, y, z) {
    worldData.set(`${x},${y},${z}`, true);
}
const size = 512;
for (let x = -size / 2; x < size / 2; x++) {
  for (let z = -size / 2; z < size / 2; z++) {
    const yLevel = Math.floor(Math.sin(x/3)*2 + Math.cos(z/3)*2);
    addStaticBlock(x, yLevel, z);
    addStaticBlock(x, yLevel - 1, z);
  }
}

function checkCollision(pos) {
  const width = 0.6;
  const depth = 0.6;
  const feetY = pos.y - 1.0;
  const headY = pos.y + 0.6;

  const minX = Math.floor(pos.x - width/2 + 0.5);
  const maxX = Math.floor(pos.x + width/2 + 0.5);
  const minY = Math.floor(feetY + 0.5);
  const maxY = Math.floor(headY + 0.5);
  const minZ = Math.floor(pos.z - depth/2 + 0.5);
  const maxZ = Math.floor(pos.z + depth/2 + 0.5);

  let output = `pos: ${pos.y}, feetY: ${feetY}, minY: ${minY}, maxY: ${maxY}. Blocks checked:`;

  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        output += ` (${x},${y},${z})=${worldData.has(`${x},${y},${z}`)}`;
        if (worldData.has(`${x},${y},${z}`)) {
             console.log(output);
             return true;
        }
      }
    }
  }
  return false;
}

let pos = {x: 0, y: 3.5, z: 0};
let velY = 0;
for(let i=0; i<10; i++) {
   velY -= 9.8 * 3.0 * 0.016;
   pos.y += velY * 0.016;
   console.log(`Step ${i}, pos.y = ${pos.y}`);
   if(checkCollision(pos)) {
       console.log('Collision hit! Reverting to', pos.y - velY*0.016);
       pos.y -= velY*0.016;
       velY = 0;
   }
}
