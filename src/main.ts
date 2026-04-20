import * as THREE from 'three';
import { initWorld } from './world';
import { setupInput } from './input';
import { initPlayer, updatePlayer, controls, updateAvatarColors, applyHairGeometry } from './player';
import { initInventory } from './inventory';
import { loadGame, saveGame, getSaveMeta } from './saves';

// Global Scene Setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB); // Sky blue
scene.fog = new THREE.Fog(0x87CEEB, 10, 50);

const fov = 75;
const aspect = window.innerWidth / window.innerHeight;
const near = 0.1;
const far = 1000;
const perspectiveCamera = new THREE.PerspectiveCamera(fov, aspect, near, far);

const renderer = new THREE.WebGLRenderer({ antialias: false }); // false for that pixelated retro look
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
document.body.appendChild(renderer.domElement);

// Lighting
const ambientLight = new THREE.AmbientLight(0xcccccc, 0.6);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.6);
directionalLight.position.set(10, 20, 10);
scene.add(directionalLight);

// Setup Game Modules
initWorld(scene);
setupInput();
initPlayer(perspectiveCamera, scene);
initInventory();

// Resize handling
window.addEventListener('resize', onWindowResize, false);
function onWindowResize() {
  perspectiveCamera.aspect = window.innerWidth / window.innerHeight;
  perspectiveCamera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);

  // Resize Shop Canvas if open
  const shopPreview = document.querySelector('.shop-preview');
  if (shopPreview) {
      const rect = shopPreview.getBoundingClientRect();
      if (rect.width > 0) {
          if(shopCamera) shopCamera.aspect = rect.width / rect.height;
          if(shopCamera) shopCamera.updateProjectionMatrix();
          if(shopRenderer) shopRenderer.setSize(rect.width, rect.height);
      }
  }
}

// GUI Integration
let currentSaveSlot = -1;

const mainMenu = document.getElementById('main-menu');
const menuMainScreen = document.getElementById('menu-screen-main');
const menuLoadScreen = document.getElementById('save-slots-container');
const menuShopScreen = document.getElementById('shop-screen');

const btnNewGame = document.getElementById('btn-new-game');
const btnOpenLoad = document.getElementById('btn-open-load');
const btnBackLoad = document.getElementById('btn-back-load');
const btnShop = document.getElementById('btn-shop');
const btnSaveShop = document.getElementById('btn-save-shop');
const saveButtons = document.querySelectorAll('.save-slot');
const btnSaveQuit = document.getElementById('btn-save-quit');

// Shop Scene Setup
const shopCanvas = document.getElementById('shop-canvas') as HTMLCanvasElement;
const shopScene = new THREE.Scene();
export const shopCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
shopCamera.position.set(0, 0, 4);

export const shopRenderer = new THREE.WebGLRenderer({ canvas: shopCanvas, alpha: true, antialias: true });
shopRenderer.setPixelRatio(window.devicePixelRatio);

shopScene.add(new THREE.AmbientLight(0xffffff, 0.8));
const shopDirLight = new THREE.DirectionalLight(0xffffff, 0.6);
shopDirLight.position.set(5, 10, 5);
shopScene.add(shopDirLight);

// Shop Avatar
const shopAvatar = new THREE.Group();
const shopMatSkin = new THREE.MeshLambertMaterial({ color: localStorage.getItem('poxel_skin') || '#ffcc99' });
const shopMatShirt = new THREE.MeshLambertMaterial({ color: localStorage.getItem('poxel_shirt') || '#00aaff' });
const shopMatPants = new THREE.MeshLambertMaterial({ color: localStorage.getItem('poxel_pants') || '#0000aa' });
const shopMatHair = new THREE.MeshLambertMaterial({ color: localStorage.getItem('poxel_hair') || '#6b4423' });
const currentEyeColorVal = localStorage.getItem('poxel_eye') || '#000000';
let currentHairStyle = parseInt(localStorage.getItem('poxel_style') || '0');

const shopHead = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), shopMatSkin);
shopHead.position.y = 0.5;
const shopHair = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.1, 0.52), shopMatHair);
applyHairGeometry(currentHairStyle, shopHair);
shopHead.add(shopHair);

let shopLeInner: THREE.Mesh;
let shopReInner: THREE.Mesh;

const createEye = (x: number, isLeft: boolean) => {
  const eye = new THREE.Group(); eye.position.set(x, 0, -0.252);
  eye.add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.005), new THREE.MeshBasicMaterial({color: 0xffffff})));
  const pupil = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.08, 0.006), new THREE.MeshBasicMaterial({color: currentEyeColorVal}));
  pupil.position.set(-x * 0.15, 0, 0); eye.add(pupil); 
  if (isLeft) shopLeInner = pupil; else shopReInner = pupil;
  return eye;
};
shopHead.add(createEye(-0.1, true)); shopHead.add(createEye(0.1, false));
shopAvatar.add(shopHead);

const shopBody = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.75, 0.25), shopMatShirt);
shopBody.position.y = -0.125;
shopAvatar.add(shopBody);

const shopLArm = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.75, 0.25), shopMatSkin);
shopLArm.position.set(-0.375, -0.125, 0);
shopAvatar.add(shopLArm);
const shopRArm = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.75, 0.25), shopMatSkin);
shopRArm.position.set(0.375, -0.125, 0);
shopAvatar.add(shopRArm);

const shopLLeg = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.75, 0.25), shopMatPants);
shopLLeg.position.set(-0.125, -0.875, 0);
shopAvatar.add(shopLLeg);
const shopRLeg = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.75, 0.25), shopMatPants);
shopRLeg.position.set(0.125, -0.875, 0);
shopAvatar.add(shopRLeg);

shopAvatar.position.y = 0.25;
shopScene.add(shopAvatar);

// Super Shop Avatar modifications
let activeSuperCosmetic = localStorage.getItem('poxel_super') || 'none';

let shopTopHat: THREE.Mesh;
let shopBackpack: THREE.Mesh;
let shopNinjaMask: THREE.Mesh;

function buildCosmetics(parent: THREE.Group, headAnchor: THREE.Mesh, bodyAnchor: THREE.Mesh) {
    const tophat = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.4), new THREE.MeshLambertMaterial({color: 0x111111}));
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.05), new THREE.MeshLambertMaterial({color: 0x111111}));
    brim.position.y = -0.2; tophat.add(brim);
    tophat.position.y = 0.45;
    headAnchor.add(tophat);
    
    const backpack = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.15), new THREE.MeshLambertMaterial({color: 0xaa2222}));
    backpack.position.set(0, 0, 0.2);
    bodyAnchor.add(backpack);
    
    const ninja = new THREE.Mesh(new THREE.BoxGeometry(0.51, 0.51, 0.51), new THREE.MeshLambertMaterial({color: 0x111111}));
    const eyeSlit = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.52), new THREE.MeshLambertMaterial({color: 0xffcc99}));
    eyeSlit.position.set(0, 0.1, 0);
    ninja.add(eyeSlit);
    headAnchor.add(ninja);
    
    return { tophat, backpack, ninja };
}

const shopCosmetics = buildCosmetics(shopAvatar, shopHead, shopBody);

function applySuperCosmetic(cosmeticId: string, cosmetics: typeof shopCosmetics) {
    cosmetics.tophat.visible = cosmeticId === 'tophat';
    cosmetics.backpack.visible = cosmeticId === 'backpack';
    cosmetics.ninja.visible = cosmeticId === 'ninja';
}

applySuperCosmetic(activeSuperCosmetic, shopCosmetics);

// Drag Rotation for Shop Avatar
let isShopDrag = false; let shopPX = 0; let shopPY = 0;
const previewBox = document.querySelector('.shop-preview') as HTMLElement;
if (previewBox) {
  previewBox.addEventListener('mousedown', (e) => { isShopDrag = true; shopPX = e.clientX; shopPY = e.clientY; });
  window.addEventListener('mouseup', () => isShopDrag = false);
  window.addEventListener('mousemove', (e) => {
    if (isShopDrag) {
      shopAvatar.rotation.y += (e.clientX - shopPX) * 0.01;
      shopAvatar.rotation.x = Math.max(-0.5, Math.min(0.5, shopAvatar.rotation.x + (e.clientY - shopPY) * 0.01));
      shopPX = e.clientX; shopPY = e.clientY;
    }
  });
}

// State for current selected colors
let currentSkin = shopMatSkin.color.getHexString();
let currentShirt = shopMatShirt.color.getHexString();
let currentPants = shopMatPants.color.getHexString();
let currentHairHex = shopMatHair.color.getHexString();
let currentEyeColorState = currentEyeColorVal.replace('#', '');

// Swatch Data
const swatchesSkin = ['#ffcc99', '#f2d3ab', '#e0ac69', '#c68642', '#8d5524', '#3d2c23'];
const swatchesShirt = ['#00aaff', '#33cc33', '#ff3333', '#ffff33', '#ff9900', '#aa00aa', '#ffffff', '#111111', '#555555'];
const swatchesPants = ['#0000aa', '#00aa00', '#aa0000', '#aaaa00', '#222222', '#666666', '#ffffff', '#0055ff'];
const swatchesHair = ['#6b4423', '#111111', '#ddbb55', '#cc3333', '#aa5500', '#3333cc', '#e6e6fa', '#ffffff'];
const swatchesEye = ['#000000', '#0055ff', '#00aa00', '#8d5524', '#aa0000', '#aa00aa', '#ffffff'];

function populateGrid(id: string, colors: string[], type: 'skin' | 'shirt' | 'pants' | 'hair' | 'eye') {
    const grid = document.getElementById(id);
    if (!grid) return;
    grid.innerHTML = '';
    colors.forEach(col => {
        const sw = document.createElement('div');
        sw.className = 'color-swatch';
        sw.style.backgroundColor = col;
        const curHex = '#' + (type === 'skin' ? currentSkin : type === 'shirt' ? currentShirt : type === 'pants' ? currentPants : type === 'hair' ? currentHairHex : currentEyeColorState);
        if (col.toLowerCase() === curHex.toLowerCase()) sw.classList.add('selected');
        
        sw.addEventListener('click', () => {
            Array.from(grid.children).forEach(c => c.classList.remove('selected'));
            sw.classList.add('selected');
            if (type === 'skin') { currentSkin = col.slice(1); shopMatSkin.color.set(col); }
            if (type === 'shirt') { currentShirt = col.slice(1); shopMatShirt.color.set(col); }
            if (type === 'pants') { currentPants = col.slice(1); shopMatPants.color.set(col); }
            if (type === 'hair') { currentHairHex = col.slice(1); shopMatHair.color.set(col); }
            if (type === 'eye') { 
               currentEyeColorState = col.slice(1); 
               shopLeInner.material = new THREE.MeshBasicMaterial({color: col});
               shopReInner.material = new THREE.MeshBasicMaterial({color: col});
            }
        });
        grid.appendChild(sw);
    });
}

populateGrid('grid-skin', swatchesSkin, 'skin');
populateGrid('grid-shirt', swatchesShirt, 'shirt');
populateGrid('grid-pants', swatchesPants, 'pants');
populateGrid('grid-hair', swatchesHair, 'hair');
populateGrid('grid-eyes', swatchesEye, 'eye');

const superItems = [
   { id: 'none', name: 'Remove Set', rarity: 'common', unlockMin: 0 },
   { id: 'tophat', name: 'Mayor Set', rarity: 'rare', unlockMin: 5, shirt: '#111111', pants: '#222222' },
   { id: 'backpack', name: 'Explorer Set', rarity: 'epic', unlockMin: 10, shirt: '#8d5524', pants: '#556b2f' },
   { id: 'ninja', name: 'Ninja Set', rarity: 'legendary', unlockMin: 15, shirt: '#111111', pants: '#111111', skin: '#f2d3ab' }
];

let playTimeSeconds = parseInt(localStorage.getItem('poxel_playtime') || '0');
setInterval(() => {
    if (controls.isLocked) {
        playTimeSeconds++;
        if (playTimeSeconds % 10 === 0) {
            localStorage.setItem('poxel_playtime', playTimeSeconds.toString());
        }
    }
}, 1000);

function populateSuperGrid() {
    const grid = document.getElementById('grid-super');
    if (!grid) return;
    grid.innerHTML = '';
    
    superItems.forEach(item => {
        const card = document.createElement('div');
        card.className = `super-item-card rarity-${item.rarity}`;
        if (activeSuperCosmetic === item.id) card.classList.add('selected');
        
        const unlocked = playTimeSeconds >= item.unlockMin * 60;
        
        const emoji = item.id === 'tophat' ? '🎩' : item.id === 'backpack' ? '🎒' : item.id === 'ninja' ? '🥷' : '❌';
        
        if (unlocked) {
            card.innerHTML = `<div style="font-size:50px; margin-bottom:10px;">${emoji}</div><div class="item-name">${item.name}</div>`;
            card.addEventListener('click', () => {
                Array.from(grid.children).forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
                activeSuperCosmetic = item.id;
                applySuperCosmetic(activeSuperCosmetic, shopCosmetics);
                
                // Apply Set Presets
                if ((item as any).shirt) {
                    currentShirt = (item as any).shirt.slice(1);
                    shopMatShirt.color.set((item as any).shirt);
                    Array.from(document.getElementById('grid-shirt')?.children || []).forEach(c => c.classList.remove('selected'));
                }
                if ((item as any).pants) {
                    currentPants = (item as any).pants.slice(1);
                    shopMatPants.color.set((item as any).pants);
                    Array.from(document.getElementById('grid-pants')?.children || []).forEach(c => c.classList.remove('selected'));
                }
                if ((item as any).skin) {
                    currentSkin = (item as any).skin.slice(1);
                    shopMatSkin.color.set((item as any).skin);
                    Array.from(document.getElementById('grid-skin')?.children || []).forEach(c => c.classList.remove('selected'));
                }
            });
        } else {
            card.style.opacity = '0.5';
            const progressMin = Math.floor(playTimeSeconds / 60);
            card.innerHTML = `<div style="font-size:40px; margin-bottom:5px;">🔒</div><div style="font-size:14px; font-weight:bold;">Play ${item.unlockMin}m</div><div class="item-name">${progressMin}/${item.unlockMin}m</div>`;
        }
        
        grid.appendChild(card);
    });
}


// Hair Style Logic
const styleBtns = document.querySelectorAll('#grid-hair-style .shop-tab');
styleBtns.forEach(btn => {
    const styleId = parseInt((btn as HTMLElement).dataset.style || '-1');
    if (styleId === currentHairStyle) {
        styleBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }
    btn.addEventListener('click', () => {
        styleBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentHairStyle = styleId;
        applyHairGeometry(currentHairStyle, shopHair);
    });
});

// Shop Tabs Logic
const tabs = document.querySelectorAll('.shop-tab');
const tabContents = document.querySelectorAll('.shop-tab-content');
tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tabContents.forEach(tc => tc.classList.remove('active'));
        tab.classList.add('active');
        const target = (tab as HTMLElement).dataset.tab;
        document.getElementById(`tab-${target}`)?.classList.add('active');
        
        const shopScreen = document.getElementById('shop-screen');
        if (shopScreen) {
             if (target === 'super') shopScreen.classList.add('super-mode');
             else shopScreen.classList.remove('super-mode');
             
             // Poll for resize during transition
             let ticks = 0;
             const resizeInt = setInterval(() => {
                 onWindowResize();
                 ticks++;
                 if (ticks > 15) clearInterval(resizeInt);
             }, 35);
        }
    });
});

saveButtons.forEach(btn => {
    const slot = parseInt((btn as HTMLElement).dataset.slot!);
    const meta = getSaveMeta(slot);
    if (meta) {
        btn.innerHTML = `Save ${slot + 1}<br><span style="font-size:12px;color:#ccc">${meta}</span>`;
    }
});

btnNewGame?.addEventListener('click', () => {
    currentSaveSlot = 0;
    startGame();
});

btnOpenLoad?.addEventListener('click', () => {
    if (menuMainScreen) menuMainScreen.style.display = 'none';
    if (menuLoadScreen) menuLoadScreen.style.display = 'flex';
});

btnBackLoad?.addEventListener('click', () => {
    if (menuLoadScreen) menuLoadScreen.style.display = 'none';
    if (menuMainScreen) menuMainScreen.style.display = 'flex';
});

btnShop?.addEventListener('click', () => {
    if (menuMainScreen) menuMainScreen.style.display = 'none';
    if (menuShopScreen) {
        populateSuperGrid(); // Refresh unlock status
        menuShopScreen.style.display = 'flex';
        // Trigger resize calculation for the canvas
        setTimeout(() => onWindowResize(), 10);
    }
});

btnSaveShop?.addEventListener('click', () => {
    localStorage.setItem('poxel_skin', '#' + currentSkin);
    localStorage.setItem('poxel_shirt', '#' + currentShirt);
    localStorage.setItem('poxel_pants', '#' + currentPants);
    localStorage.setItem('poxel_hair', '#' + currentHairHex);
    localStorage.setItem('poxel_eye', '#' + currentEyeColorState);
    localStorage.setItem('poxel_style', currentHairStyle.toString());
    localStorage.setItem('poxel_super', activeSuperCosmetic);
    
    updateAvatarColors('#' + currentSkin, '#' + currentShirt, '#' + currentPants, '#' + currentHairHex, '#' + currentEyeColorState, currentHairStyle, activeSuperCosmetic);

    if (menuShopScreen) menuShopScreen.style.display = 'none';
    if (menuMainScreen) menuMainScreen.style.display = 'flex';
});

saveButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
        const slot = parseInt((e.currentTarget as HTMLElement).dataset.slot!);
        const success = loadGame(slot);
        if (success) {
            currentSaveSlot = slot;
            startGame();
        } else {
            console.warn('Save slot empty.');
            currentSaveSlot = slot;
            startGame(); // Just start a new game effectively, assigning them to the target slot
        }
    });
});

btnSaveQuit?.addEventListener('click', () => {
    if (currentSaveSlot !== -1) {
        saveGame(currentSaveSlot);
        location.reload(); 
    }
});

function startGame() {
    if (mainMenu) mainMenu.style.display = 'none';
    const instr = document.getElementById('instructions');
    if (instr) instr.style.display = 'flex';
    controls.lock();
}

function animate() {
  requestAnimationFrame(animate);
  updatePlayer();
  
  if (mainMenu && mainMenu.style.display !== 'none') {
      controls.object.rotation.y -= 0.002;
  }
  
  renderer.render(scene, perspectiveCamera);

  if (menuShopScreen && menuShopScreen.style.display !== 'none') {
      if (!isShopDrag) shopAvatar.rotation.y += 0.005;
      shopRenderer.render(shopScene, shopCamera);
  }

  const debug = document.getElementById('debug');
  if (debug) {
    debug.innerHTML = `
      Real Pos: ${controls.object.position.x.toFixed(2)}, ${controls.object.position.y.toFixed(2)}, ${controls.object.position.z.toFixed(2)}<br>
      Chunks count: ${(window as any).chunkGroup?.children?.length ?? 0}<br>
      Active Memory Size: ${(window as any).localStorage?.length ?? 0} keys
    `;
  }
}

// Debugging
console.log("main.ts execution reached end");
(window as any).scene = scene;
(window as any).camera = perspectiveCamera;
(window as any).chunkGroup = scene.children.find(c => c.type === 'Group');
console.log("Chunk group children: ", (window as any).chunkGroup?.children.length);
animate();
