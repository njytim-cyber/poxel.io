import { setSelectedSlot, selectedSlotIndex } from './inventory';
import nipplejs from 'nipplejs';

// Touch controls for phones/tablets. A touchscreen laptop also has a mouse/trackpad ("fine" pointer),
// so it gets the normal mouse + keyboard controls.
export const isMobile = (() => {
  const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  const hasFinePointer = typeof matchMedia === 'function' && matchMedia('(any-pointer: fine)').matches;
  return hasTouch && (isMobileUA || !hasFinePointer);
})();
export const touchLookDelta = { x: 0, y: 0 };

export const keys = {
  forward: false, backward: false, left: false, right: false,
  run: false, jump: false, shift: false,
};

// Game actions, wired up by player.ts / main.ts
export const actions = {
  primaryDown: () => {},   // mine / attack
  primaryUp: () => {},
  secondaryDown: () => {}, // place / use / eat
  secondaryUp: () => {},
  inventory: () => {},
  escape: () => {},
  drop: (_all: boolean) => {},
  toggleView: () => {},
  toggleDebug: () => {},
  setHome: () => {},
  chat: (_prefill: string) => {},
};

const MOVE_KEYS: Record<string, keyof typeof keys> = {
  KeyW: 'forward', ArrowUp: 'forward', KeyS: 'backward', ArrowDown: 'backward',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  KeyR: 'run', ControlLeft: 'run', Space: 'jump', ShiftLeft: 'shift', ShiftRight: 'shift',
};

export function releaseAllKeys() {
  for (const k of Object.keys(keys) as (keyof typeof keys)[]) keys[k] = false;
}

export function setupInput() {
  document.addEventListener('contextmenu', e => e.preventDefault());

  document.addEventListener('keydown', e => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    const k = MOVE_KEYS[e.code];
    if (k) { keys[k] = true; if (e.code === 'Space') e.preventDefault(); }
    if (e.repeat) return;
    switch (e.code) {
      case 'Tab': case 'KeyE': e.preventDefault(); actions.inventory(); break;
      case 'Escape': actions.escape(); break;
      case 'KeyQ': actions.drop(e.ctrlKey); break;
      case 'F5': case 'F7': case 'KeyV': e.preventDefault(); actions.toggleView(); break;
      case 'F3': e.preventDefault(); actions.toggleDebug(); break;
      case 'KeyH': actions.setHome(); break;
      case 'KeyT': case 'Enter': e.preventDefault(); actions.chat(''); break;
      case 'Slash': e.preventDefault(); actions.chat('/'); break;
    }
    if (e.code.startsWith('Digit')) {
      const n = parseInt(e.code.slice(5));
      if (n >= 1 && n <= 9) setSelectedSlot(n - 1);
    }
  });

  document.addEventListener('keyup', e => {
    const k = MOVE_KEYS[e.code];
    if (k) keys[k] = false;
  });

  // Losing focus (alt-tab) would otherwise leave keys "held"
  window.addEventListener('blur', releaseAllKeys);

  // Touch screens fire emulated mouse events after a tap; ignore those so taps don't mine
  let lastTouch = 0;
  document.addEventListener('touchstart', () => { lastTouch = performance.now(); }, { passive: true, capture: true });
  const fromTouch = () => performance.now() - lastTouch < 800;

  document.addEventListener('mousedown', e => {
    if (fromTouch()) return;
    if (e.button === 0) actions.primaryDown();
    else if (e.button === 2) actions.secondaryDown();
  });
  document.addEventListener('mouseup', e => {
    if (fromTouch()) return;
    if (e.button === 0) actions.primaryUp();
    else if (e.button === 2) actions.secondaryUp();
  });

  document.addEventListener('wheel', e => {
    if (!document.pointerLockElement) return;
    setSelectedSlot(selectedSlotIndex + (e.deltaY > 0 ? 1 : -1));
  }, { passive: true });

  if (isMobile) setupMobileInput();
}

function setupMobileInput() {
  const hud = document.getElementById('mobile-hud');
  if (hud) hud.style.display = 'block';

  const joystickZone = document.getElementById('joystick-zone');
  if (joystickZone) {
    const manager = nipplejs.create({ zone: joystickZone, mode: 'static', position: { left: '50%', top: '50%' }, color: 'white' });
    // nipplejs 1.x passes one event object with the joystick data in evt.data (0.x passed it as a 2nd argument)
    manager.on('move', (evt: any, legacy?: any) => {
      const data = evt?.data ?? legacy;
      const v = data?.vector;
      if (!v) return;
      keys.forward = v.y > 0.3;
      keys.backward = v.y < -0.3;
      keys.right = v.x > 0.3;
      keys.left = v.x < -0.3;
      // Push the stick all the way out to run
      keys.run = (data.force ?? 0) > 1.2 && v.y > 0.5;
    });
    manager.on('end', () => { keys.forward = keys.backward = keys.left = keys.right = keys.run = false; });
  }

  const lookZone = document.getElementById('touch-look-zone');
  let lastX = 0, lastY = 0, lookId: number | null = null;
  if (lookZone) {
    lookZone.addEventListener('touchstart', e => {
      const t = e.changedTouches[0];
      lookId = t.identifier; lastX = t.clientX; lastY = t.clientY;
    });
    lookZone.addEventListener('touchmove', e => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier !== lookId) continue;
        touchLookDelta.x += t.clientX - lastX;
        touchLookDelta.y += t.clientY - lastY;
        lastX = t.clientX; lastY = t.clientY;
      }
    });
    lookZone.addEventListener('touchend', () => { lookId = null; });
  }

  const bindBtn = (id: string, action: (held: boolean) => void) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.addEventListener('touchstart', e => { if (e.cancelable) e.preventDefault(); e.stopPropagation(); action(true); }, { passive: false });
    btn.addEventListener('touchend', e => { if (e.cancelable) e.preventDefault(); e.stopPropagation(); action(false); }, { passive: false });
    btn.addEventListener('touchcancel', e => { if (e.cancelable) e.preventDefault(); e.stopPropagation(); action(false); }, { passive: false });
  };

  bindBtn('btn-mobile-jump', h => { keys.jump = h; });
  bindBtn('btn-mobile-sprint', h => { keys.run = h; });
  bindBtn('btn-mobile-sneak', h => { keys.shift = h; });
  bindBtn('btn-mobile-hit', h => (h ? actions.primaryDown() : actions.primaryUp()));
  bindBtn('btn-mobile-place', h => (h ? actions.secondaryDown() : actions.secondaryUp()));
  bindBtn('btn-mobile-inv', h => { if (h) actions.inventory(); });
  bindBtn('btn-mobile-drop', h => { if (h) actions.drop(false); });
  bindBtn('btn-mobile-view', h => { if (h) actions.toggleView(); });
  bindBtn('btn-mobile-menu', h => { if (h) actions.escape(); });

  document.body.addEventListener('touchmove', e => {
    if ((e.target as HTMLElement)?.closest('#full-inventory-modal, #shop-screen, #main-menu, #pause-menu')) return;
    if (e.cancelable) e.preventDefault();
  }, { passive: false });
}
