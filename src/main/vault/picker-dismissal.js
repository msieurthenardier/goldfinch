'use strict';

// Which sheet closes END a vault picker open (Mission 23 Flight 1, leg `vault-fill-trust`).
//
// The sheet reports every close through `onClosed({ menuType, reason })`, which names no tab. A close of
// the `vault-picker` or `vault-unlock` sheet for a DISMISSAL reason means the operator walked away from
// the picker open, so every picker context belonging to a tab of that window is dropped (the chrome's id
// is useless afterwards and main must not keep a live one).
//
// An explicit allowlist on both halves, never a denylist:
//   - menu types: exactly `vault-picker` and `vault-unlock` (no other sheet - kebab, suggestions, auth,
//     every other vault sheet - ends a picker open);
//   - reasons: escape, outside click, blur, teardown and the three tab reasons. NEVER `activated` (a pick,
//     or a successful unlock that continues to the picker), `superseded` (the unlock row replacing the
//     picker, or the picker replacing the unlock sheet) or `vault-lock` (a lock keeps the context - the
//     chrome re-raises the unlock sheet and the same open continues).
// Pure and Electron-free.

/** @type {ReadonlySet<string>} */
const PICKER_MENU_TYPES = Object.freeze(new Set(['vault-picker', 'vault-unlock']));

/** @type {ReadonlySet<string>} */
const DISMISSAL_REASONS = Object.freeze(
  new Set(['escape', 'outside-click', 'blur', 'teardown', 'tab-switch', 'tab-hide', 'tab-close'])
);

/**
 * @param {unknown} menuType
 * @param {unknown} reason
 * @returns {boolean}
 */
function dismissesPickerContexts(menuType, reason) {
  return (
    typeof menuType === 'string' &&
    typeof reason === 'string' &&
    PICKER_MENU_TYPES.has(menuType) &&
    DISMISSAL_REASONS.has(reason)
  );
}

module.exports = { PICKER_MENU_TYPES, DISMISSAL_REASONS, dismissesPickerContexts };
