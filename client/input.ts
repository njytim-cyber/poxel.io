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
  jumpTap: () => {},         // each press of jump (creative: a double tap toggles flying)
  touchTap: () => {},        // quick tap on the view: attack a mob, else use/place
  touchHold: (_held: boolean) => {}, // long-press on the view: mine (or eat when holding food)
};

// Touch gestures on the view (like Minecraft's touch controls): drag to look,
// tap to use/place, press and hold (without moving) to mine
const HOLD_MS = 300;
const TAP_SLOP_PX = 12;

const MOVE_KEYS: Record<string, keyof typeof keys> = {
  KeyW: 'forward', ArrowUp: 'forward', KeyS: 'backward', ArrowDown: 'backward',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  KeyR: 'run', ControlLeft: 'run', Space: 'jump', ShiftLeft: 'shift', ShiftRight: 'shift',
};

export function releaseAllKeys() {
  for (const k of Object.keys(keys) as (keyof typeof keys)[]) keys[k] = false;
  if (isMobile) syncToggles();
}

export function setupInput() {
  document.addEventListener('contextmenu', e => e.preventDefault());

  document.addEventListener('keydown', e => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    const k = MOVE_KEYS[e.code];
    if (k) { keys[k] = true; if (e.code === 'Space') e.preventDefault(); }
    if (e.repeat) return;
    if (k === 'jump') actions.jumpTap();
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

function setLatched(id: string, on: boolean) {
  document.getElementById(id)?.classList.toggle('on', on);
}
function syncToggles() {
  setLatched('btn-mobile-sprint', keys.run);
  setLatched('btn-mobile-sneak', keys.shift);
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
      // Pushing the stick all the way forward also starts running (until the stick is released)
      if ((data.force ?? 0) > 1.2 && v.y > 0.5 && !keys.run && !keys.shift) { keys.run = true; syncToggles(); }
    });
    // Letting go of the stick stops running, like Minecraft's sprint
    manager.on('end', () => { keys.forward = keys.backward = keys.left = keys.right = keys.run = false; syncToggles(); });
  }

  const lookZone = document.getElementById('touch-look-zone');
  let lastX = 0, lastY = 0, startX = 0, startY = 0, startT = 0, lookId: number | null = null;
  let moved = false, holding = false;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  const endLook = (tap: boolean) => {
    clearTimeout(holdTimer);
    if (holding) actions.touchHold(false);
    else if (tap && !moved && performance.now() - startT < HOLD_MS) actions.touchTap();
    holding = false; lookId = null;
  };
  if (lookZone) {
    lookZone.addEventListener('touchstart', e => {
      if (lookId !== null) return; // a second finger on the view doesn't restart the gesture
      const t = e.changedTouches[0];
      lookId = t.identifier; lastX = startX = t.clientX; lastY = startY = t.clientY;
      startT = performance.now(); moved = false; holding = false;
      clearTimeout(holdTimer);
      holdTimer = setTimeout(() => { if (lookId !== null && !moved) { holding = true; actions.touchHold(true); } }, HOLD_MS);
    });
    lookZone.addEventListener('touchmove', e => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier !== lookId) continue;
        touchLookDelta.x += t.clientX - lastX;
        touchLookDelta.y += t.clientY - lastY;
        lastX = t.clientX; lastY = t.clientY;
        // Once the finger travels it's a look drag (a hold that already started keeps mining while aiming)
        if (Math.hypot(t.clientX - startX, t.clientY - startY) > TAP_SLOP_PX) moved = true;
      }
    });
    const finish = (tap: boolean) => (e: TouchEvent) => {
      if (Array.from(e.changedTouches).some(t => t.identifier === lookId)) endLook(tap);
    };
    lookZone.addEventListener('touchend', finish(true));
    lookZone.addEventListener('touchcancel', finish(false));
  }

  const bindBtn = (id: string, action: (held: boolean) => void) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.addEventListener('touchstart', e => { if (e.cancelable) e.preventDefault(); e.stopPropagation(); action(true); }, { passive: false });
    btn.addEventListener('touchend', e => { if (e.cancelable) e.preventDefault(); e.stopPropagation(); action(false); }, { passive: false });
    btn.addEventListener('touchcancel', e => { if (e.cancelable) e.preventDefault(); e.stopPropagation(); action(false); }, { passive: false });
  };

  bindBtn('btn-mobile-jump', h => { keys.jump = h; if (h) actions.jumpTap(); });
  // Run and Sneak are toggles so the right thumb stays free to look around
  bindBtn('btn-mobile-sprint', h => { if (h) { keys.run = !keys.run; if (keys.run) keys.shift = false; syncToggles(); } });
  bindBtn('btn-mobile-sneak', h => { if (h) { keys.shift = !keys.shift; if (keys.shift) keys.run = false; syncToggles(); } });
  bindBtn('btn-mobile-inv', h => { if (h) actions.inventory(); });
  bindBtn('btn-mobile-drop', h => { if (h) actions.drop(false); });
  bindBtn('btn-mobile-view', h => { if (h) actions.toggleView(); });
  bindBtn('btn-mobile-menu', h => { if (h) actions.escape(); });

  document.body.addEventListener('touchmove', e => {
    if ((e.target as HTMLElement)?.closest('#full-inventory-modal, #shop-screen, #main-menu, #pause-menu')) return;
    if (e.cancelable) e.preventDefault();
  }, { passive: false });
}
