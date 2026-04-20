import { setSelectedSlot } from './inventory';
import nipplejs from 'nipplejs';

export const isMobile = ('ontouchstart' in window || navigator.maxTouchPoints > 0) && window.innerWidth <= 1024;
export let touchLookDelta = { x: 0, y: 0 };

export const keys: { [key: string]: boolean } = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  run: false,
  jump: false,
  shift: false
};

export function setupInput() {
  if (isMobile) {
      setupMobileInput();
      return;
  }
  
  document.addEventListener('keydown', (e) => {
    switch (e.code) {
      case 'ArrowUp':
      case 'KeyW':
        keys.forward = true;
        break;
      case 'ArrowLeft':
      case 'KeyA':
        keys.left = true;
        break;
      case 'ArrowDown':
      case 'KeyS':
        keys.backward = true;
        break;
      case 'ArrowRight':
      case 'KeyD':
        keys.right = true;
        break;
      case 'KeyR':
        keys.run = true;
        break;
      case 'Space':
        keys.jump = true;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        keys.shift = true;
        break;
      case 'Digit1': setSelectedSlot(0); break;
      case 'Digit2': setSelectedSlot(1); break;
      case 'Digit3': setSelectedSlot(2); break;
      case 'Digit4': setSelectedSlot(3); break;
      case 'Digit5': setSelectedSlot(4); break;
      case 'Digit6': setSelectedSlot(5); break;
      case 'Digit7': setSelectedSlot(6); break;
      case 'Digit8': setSelectedSlot(7); break;
      case 'Digit9': setSelectedSlot(8); break;
    }
  });

  document.addEventListener('keyup', (e) => {
    switch (e.code) {
      case 'ArrowUp':
      case 'KeyW':
        keys.forward = false;
        break;
      case 'ArrowLeft':
      case 'KeyA':
        keys.left = false;
        break;
      case 'ArrowDown':
      case 'KeyS':
        keys.backward = false;
        break;
      case 'ArrowRight':
      case 'KeyD':
        keys.right = false;
        break;
      case 'KeyR':
        keys.run = false;
        break;
      case 'Space':
        keys.jump = false;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        keys.shift = false;
        break;
    }
  });
}

function setupMobileInput() {
    const hud = document.getElementById('mobile-hud');
    if (hud) hud.style.display = 'block';

    const joystickZone = document.getElementById('joystick-zone');
    if (joystickZone) {
        const manager = nipplejs.create({
            zone: joystickZone,
            mode: 'static',
            position: { left: '50%', top: '50%' },
            color: 'white'
        });
        
        manager.on('move', (evt, data) => {
            const angle = data.angle.degree;
            keys.forward = angle > 45 && angle < 135;
            keys.backward = angle > 225 && angle < 315;
            keys.right = angle <= 45 || angle >= 315;
            keys.left = angle >= 135 && angle <= 225;
        });

        manager.on('end', () => {
            keys.forward = false;
            keys.backward = false;
            keys.left = false;
            keys.right = false;
        });
    }

    const lookZone = document.getElementById('touch-look-zone');
    let lastTouchX = 0;
    let lastTouchY = 0;
    
    if (lookZone) {
        lookZone.addEventListener('touchstart', (e) => {
            lastTouchX = e.touches[0].clientX;
            lastTouchY = e.touches[0].clientY;
        });
        lookZone.addEventListener('touchmove', (e) => {
            const touch = e.touches[0];
            touchLookDelta.x = touch.clientX - lastTouchX;
            touchLookDelta.y = touch.clientY - lastTouchY;
            lastTouchX = touch.clientX;
            lastTouchY = touch.clientY;
        });
        lookZone.addEventListener('touchend', () => {
            touchLookDelta.x = 0;
            touchLookDelta.y = 0;
        });
    }
    
    const bindBtn = (id: string, action: (held: boolean) => void) => {
        const btn = document.getElementById(id);
        if (!btn) return;
        btn.addEventListener('touchstart', (e) => { e.preventDefault(); action(true); });
        btn.addEventListener('touchend', (e) => { e.preventDefault(); action(false); });
        btn.addEventListener('touchcancel', (e) => { e.preventDefault(); action(false); });
    };

    bindBtn('btn-mobile-jump', (h) => keys.jump = h);
    bindBtn('btn-mobile-sprint', (h) => keys.run = h);
    
    bindBtn('btn-mobile-hit', (h) => {
        // We dispatch standard MouseEvents so the raycaster triggers normally in player.ts!
        if (h) document.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
        else document.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
    });
    
    bindBtn('btn-mobile-inv', (h) => {
        if (h) document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyI' }));
    });
    
    bindBtn('btn-mobile-shop', (h) => {
        if (h) {
             const btnShop = document.getElementById('btn-shop');
             if (btnShop) btnShop.click();
        }
    });
}
