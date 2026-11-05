// @ts-check

// Sortie 06 (non-blocking save prompt), DD6: the ONE per-reason close-effects table for the
// corner save prompt. Pure and DOM-free; required by main (Node >= 22 `require(esm)`, the
// `src/shared/` convention) AND imported by the chrome client, so the manager's emitted reasons
// and the chrome's handled reasons can never drift apart (drift-guarded in
// `test/unit/save-prompt-close-effects.test.js`).
//
// The prompt has its OWN main->chrome close channel (`save-prompt-closed`); these reasons never
// flow through the menu sheet's `MENU_CLOSE_REASONS` / `SHEET_DISMISS_REASONS` / channel 7.
//
// Effect fields:
//   dismissShown  - main drops the SHOWN capture via `vaultHuman.captureDismiss` (the prompt's
//                   own close did not already write/drop it).
//   advance       - the chrome queue presents the next offer.
//   dropTabQueue  - the chrome removes the closed prompt's tab's queued entries (no dismiss
//                   calls: main's `dropCapturesForTab` already dropped them).
//   clearQueue    - the chrome empties BOTH queues (`presentationQueue`, `pendingCaptureUnlock`).
//   refocusGuest  - refocus the guest via the shared `focusActiveGuest` predicate (DD2 refocus
//                   rule). True for `saved`/`dismissed` ONLY (Leg 3); the manager additionally
//                   gates it on "the prompt held focus when the close began".
//
// Unknown reasons map to the `dismissed` row (an `Object.hasOwn` lookup, so `'constructor'` /
// `'__proto__'` cannot reach a prototype member) - the same fail-safe-to-resolution default
// `auth-challenges.js` uses: drop + advance, never "keep pending".

/**
 * @typedef {{
 *   dismissShown: boolean,
 *   advance: boolean,
 *   dropTabQueue: boolean,
 *   clearQueue: boolean,
 *   refocusGuest: boolean
 * }} SavePromptCloseEffects
 */

/** @param {Partial<SavePromptCloseEffects>} e @returns {Readonly<SavePromptCloseEffects>} */
function row(e) {
  return Object.freeze({
    dismissShown: false,
    advance: false,
    dropTabQueue: false,
    clearQueue: false,
    refocusGuest: false,
    ...e
  });
}

/** @type {Readonly<Record<string, Readonly<SavePromptCloseEffects>>>} */
const TABLE = Object.freeze({
  // written by the save path itself (captureSave already dropped the record)
  saved: row({ advance: true, refocusGuest: true }),
  dismissed: row({ dismissShown: true, advance: true, refocusGuest: true }),
  timeout: row({ dismissShown: true, advance: true }),
  // main already dropped the record (CAPTURE_DROP_MS / tab-changed)
  expired: row({ advance: true }),
  // Leg 2 reasons, present now so Leg 2 consumes the table rather than editing its shape.
  // The consented capture is HELD; the queue waits for the unlock sheet.
  'unlock-requested': row({}),
  // unlock abandoned: the held capture(s) are dropped and the whole locked queue cleared.
  'unlock-abandoned': row({ dismissShown: true, clearQueue: true }),
  'tab-switch': row({ dropTabQueue: true, advance: true }),
  'tab-hide': row({ dropTabQueue: true, advance: true }),
  'tab-close': row({ dropTabQueue: true, advance: true }),
  'tab-moved': row({ dropTabQueue: true, advance: true }),
  // window close / chrome renderer gone: drop the shown capture (idempotent when the window-close
  // sweep already did) and clear the chrome queue.
  teardown: row({ dismissShown: true, clearQueue: true }),
  // dismissShown is false: `dropAllCaptures` follows main-side; the manager still sets
  // `settling` so the drop cannot flash the "expired" state.
  'vault-lock': row({ clearQueue: true })
});

/** The closed set of DD6 close reasons (frozen). */
const SAVE_PROMPT_CLOSE_REASONS = Object.freeze(new Set(Object.keys(TABLE)));

/**
 * @param {any} reason
 * @returns {Readonly<SavePromptCloseEffects>}
 */
function savePromptCloseEffects(reason) {
  if (typeof reason === 'string' && Object.hasOwn(TABLE, reason)) return TABLE[reason];
  return TABLE.dismissed;
}

export { savePromptCloseEffects, SAVE_PROMPT_CLOSE_REASONS };
