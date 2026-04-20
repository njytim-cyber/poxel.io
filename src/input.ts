import { setSelectedSlot } from './inventory';

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
