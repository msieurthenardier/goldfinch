'use strict';
// @ts-check

// Sortie 06 Leg 3 (flight DD2): the pure key decision for the corner save-prompt view. Read
// main-side from the prompt view's TRUSTED `before-input-event` (the sheet's precedent), so a
// page can never spoof it and no page->main key channel exists. Main-only CJS.
//
//   F6        -> 'to-address'  (the prompt's hop onward in the F6 cycle: the address bar)
//   Shift+F6  -> 'to-guest'    (back to the page)
//   Escape    -> 'dismiss'     ("Not now")
// Everything else (Tab, Shift+Tab, Enter, Space, keyUp, any Ctrl/Alt/Meta-modified F6/Escape)
// -> null: the page keeps it natively.

/**
 * @param {{ type?: string, key?: string, control?: boolean, meta?: boolean, shift?: boolean, alt?: boolean }} input
 * @returns {'to-address' | 'to-guest' | 'dismiss' | null}
 */
function savePromptKeyAction(input) {
  if (!input || input.type !== 'keyDown') return null;
  if (input.control || input.meta || input.alt) return null;
  if (input.key === 'F6') return input.shift ? 'to-guest' : 'to-address';
  if (input.key === 'Escape' && !input.shift) return 'dismiss';
  return null;
}

module.exports = { savePromptKeyAction };
