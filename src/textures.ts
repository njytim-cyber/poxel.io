import * as THREE from 'three';

function generateTexture(baseColor: THREE.Color, noiseColor: THREE.Color, size: number = 16): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const isNoise = Math.random() > 0.5;
      ctx.fillStyle = isNoise ? `#${noiseColor.getHexString()}` : `#${baseColor.getHexString()}`;
      ctx.fillRect(x, y, 1, 1);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter; // Pixelated look
  texture.minFilter = THREE.NearestFilter;
  return texture;
}

function generateGrassSide(size: number = 16): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  
  const dirtBase = new THREE.Color(0x8B5A2B);
  const dirtNoise = new THREE.Color(0x6b4226);
  const grassBase = new THREE.Color(0x556b2f);
  const grassNoise = new THREE.Color(0x6b8e23);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Top couple of pixels are grass
      const isGrassLevel = y < 3 + Math.random() * 2;
      const isNoise = Math.random() > 0.5;
      
      if (isGrassLevel) {
        ctx.fillStyle = isNoise ? `#${grassNoise.getHexString()}` : `#${grassBase.getHexString()}`;
      } else {
        ctx.fillStyle = isNoise ? `#${dirtNoise.getHexString()}` : `#${dirtBase.getHexString()}`;
      }
      ctx.fillRect(x, y, 1, 1);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  return texture;
}

export const materials = {
  dirt: new THREE.MeshLambertMaterial({ map: generateTexture(new THREE.Color(0x8B5A2B), new THREE.Color(0x6b4226)) }),
  grassTop: new THREE.MeshLambertMaterial({ map: generateTexture(new THREE.Color(0x556b2f), new THREE.Color(0x6b8e23)) }),
  grassSide: new THREE.MeshLambertMaterial({ map: generateGrassSide() }),
  stone: new THREE.MeshLambertMaterial({ map: generateTexture(new THREE.Color(0x777777), new THREE.Color(0x555555)) }),
  bedrock: new THREE.MeshLambertMaterial({ map: generateTexture(new THREE.Color(0x222222), new THREE.Color(0x111111)) }),
  wood: new THREE.MeshLambertMaterial({ map: generateTexture(new THREE.Color(0xa67c00), new THREE.Color(0x8b6508)) }),
  craftingTableTop: new THREE.MeshLambertMaterial({ map: generateTexture(new THREE.Color(0xCD853F), new THREE.Color(0x8B5A2B)) }),
  leaves: new THREE.MeshLambertMaterial({ map: generateTexture(new THREE.Color(0x2e8b57), new THREE.Color(0x006400)), transparent: true, opacity: 0.9 }),
  iron_ore: new THREE.MeshLambertMaterial({ map: generateTexture(new THREE.Color(0x777777), new THREE.Color(0xd8a983)) }),
  diamond_ore: new THREE.MeshLambertMaterial({ map: generateTexture(new THREE.Color(0x777777), new THREE.Color(0x00ffff)) }),
  gold_ore: new THREE.MeshLambertMaterial({ map: generateTexture(new THREE.Color(0x777777), new THREE.Color(0xffd700)) }),
  moonstone_ore: new THREE.MeshLambertMaterial({ map: generateTexture(new THREE.Color(0x777777), new THREE.Color(0xe6e6fa)) }),
  etherite_ore: new THREE.MeshLambertMaterial({ map: generateTexture(new THREE.Color(0x222222), new THREE.Color(0x4a4a5a)) })
};

function generateCrackTexture(stage: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d')!;
  
  ctx.clearRect(0,0,16,16);
  if (stage === 0) return new THREE.CanvasTexture(canvas);
  
  ctx.strokeStyle = 'rgba(10, 10, 10, 0.8)';
  ctx.lineWidth = 1;
  ctx.lineCap = 'square';
  ctx.lineJoin = 'miter';
  
  ctx.beginPath();
  const paths = [
    [[8,8], [5,5], [2,7], [0,4]],
    [[8,8], [11,6], [14,9], [16,5]],
    [[8,8], [9,12], [7,15], [8,16]],
    [[8,8], [4,10], [1,13], [0,16]],
    [[8,8], [12,11], [15,14], [16,16]]
  ];

  paths.forEach(path => {
     ctx.moveTo(path[0][0], path[0][1]);
     const targetSegments = (stage / 10) * 3;
     for(let i=1; i<path.length; i++) {
         if (i <= targetSegments) {
             ctx.lineTo(path[i][0], path[i][1]);
         } else if (i - 1 < targetSegments) {
             const pct = targetSegments - (i - 1);
             const prev = path[i-1];
             const cur = path[i];
             ctx.lineTo(prev[0] + (cur[0] - prev[0]) * pct, prev[1] + (cur[1] - prev[1]) * pct);
         }
     }
  });
  
  if (stage > 3) {
      ctx.moveTo(5,5);
      const pct = Math.min(1, (stage-3)/7);
      ctx.lineTo(5 + 3*pct, 5 - 3*pct);
      ctx.moveTo(11,6);
      ctx.lineTo(11 + 2*pct, 6 - 4*pct);
  }

  if (stage > 6) {
      ctx.moveTo(9,12);
      const pct = Math.min(1, (stage-6)/4);
      ctx.lineTo(9 + 3*pct, 12 + 2*pct);
  }
  
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  return tex;
}

export const crackMaterials = Array.from({length: 11}, (_, i) => 
  new THREE.MeshBasicMaterial({ 
    map: generateCrackTexture(i), 
    transparent: true, 
    alphaTest: 0.1, 
    depthWrite: false 
  })
);

export function getGrassMaterials() {
  return [
    materials.grassSide, 
    materials.grassSide, 
    materials.grassTop,  
    materials.dirt,      
    materials.grassSide, 
    materials.grassSide  
  ];
}

export function getCraftingTableMaterials() {
  return [
    materials.wood, // right
    materials.wood, // left
    materials.craftingTableTop,  // top
    materials.wood, // bottom
    materials.wood, // front
    materials.wood  // back
  ];
}
