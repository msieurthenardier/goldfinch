// @ts-check

// Real ES module (M07 Flight 2 sweep). Consumers are the main process
// (main.js, via require(esm)) and the test runner ONLY — no renderer document
// ever loaded this file via <script>, so the old globalThis branch was dead
// code and was deleted with the dual-export tail (no transitional bridge).

/**
 * sheetAcceleratorAction({ key, control, meta, shift })
 *
 * Pure mapper for the menu-overlay sheet's `before-input-event` accelerator
 * forwarding (M05 Flight 8, DD13). While a menu is open, OS keyboard focus sits
 * in the sheet's webContents, where neither the chrome keydown handlers nor the
 * guest before-input-event capture exist — main forwards the UNION of:
 *
 *   guest-class  (the guest-captured set, main.js wireGuestContents):
 *     F12, Ctrl+Shift+I  → devtools        (autoRepeatGuard — held key must not rapid-toggle)
 *     Ctrl+= / + / − / 0 → zoom-in/out/reset (no autoRepeat guard — held zoom repeats, parity)
 *     Ctrl+P             → print           (deliberately NO autoRepeat guard — the guest
 *                                           branch has none today; replicated, see mapper test)
 *     Ctrl+F             → find
 *     Ctrl+J             → downloads       (autoRepeatGuard — held chord must not stack tabs)
 *   chrome-class (the chrome keydownToAction set, src/shared/keydown-action.js):
 *     Ctrl+T new-tab, Ctrl+W close-tab, Ctrl+L focus-address, Ctrl+M toggle-panel,
 *     Ctrl+R reload, Ctrl+Shift+P toggle-privacy
 *
 * Unmodified Arrow/Home/End/Enter/Space/Escape/Tab stay with the sheet page (the
 * APG menu contract wins inside the menu): every mapping below requires
 * control||meta EXCEPT F12 — APG keys are excluded by construction.
 *
 * Overlap resolution (union semantics): Shift disambiguates the two P/I chords —
 * Ctrl+Shift+P → toggle-privacy (chrome), Ctrl+Shift+I → devtools (guest);
 * unshifted Ctrl+P → print. `=` matches shift-tolerantly (US-layout Ctrl+Shift+=
 * → zoom-in), mirroring the guest branch's `'=' || '+'` match.
 *
 * Case discipline mirrors the source handlers exactly: t/w/l/m/r match lowercase
 * only (the chrome handler never matched their shifted forms); f/F, j/J, p/P,
 * i/I match both cases where their source branches do.
 *
 * @param {{ key: string, control: boolean, meta: boolean, shift: boolean }} input
 * @returns {{ scope: 'guest' | 'chrome',
 *   action: string,
 *   autoRepeatGuard?: boolean } | null}
 */
export function sheetAcceleratorAction({ key, control, meta, shift }) {
  // F12 — the sole modifier-less accelerator (guest devtools branch).
  if (key === 'F12') return { scope: 'guest', action: 'devtools', autoRepeatGuard: true };

  if (!(control || meta)) return null; // APG keys excluded by construction

  // Shift-disambiguated chords FIRST (Ctrl+Shift+I devtools / Ctrl+Shift+P privacy),
  // before the unshifted p/P print match can shadow Ctrl+Shift+P.
  if (shift && (key === 'I' || key === 'i')) return { scope: 'guest', action: 'devtools', autoRepeatGuard: true };
  if (shift && (key === 'P' || key === 'p')) return { scope: 'chrome', action: 'toggle-privacy' };

  // Guest-class (mirrors the guest before-input-event branch bodies).
  if (key === '=' || key === '+') return { scope: 'guest', action: 'zoom-in' };
  if (key === '-') return { scope: 'guest', action: 'zoom-out' };
  if (key === '0') return { scope: 'guest', action: 'zoom-reset' };
  if (key === 'p' || key === 'P') return { scope: 'guest', action: 'print' };
  if (key === 'f' || key === 'F') return { scope: 'guest', action: 'find' };
  if (key === 'j' || key === 'J') return { scope: 'guest', action: 'downloads', autoRepeatGuard: true };

  // Chrome-class (mirrors keydownToAction, including tab management).
  if (shift && (key === 'T' || key === 't')) return { scope: 'chrome', action: 'reopen-closed' };
  if (key === 'Tab') return { scope: 'chrome', action: shift ? 'previous-tab' : 'next-tab' };
  if (key === 'PageDown') return { scope: 'chrome', action: 'next-tab' };
  if (key === 'PageUp') return { scope: 'chrome', action: 'previous-tab' };
  if (shift && key === 'ArrowLeft') return { scope: 'chrome', action: 'move-tab-left' };
  if (shift && key === 'ArrowRight') return { scope: 'chrome', action: 'move-tab-right' };
  if (!shift && /^[1-8]$/.test(key)) return { scope: 'chrome', action: `tab-${key}` };
  if (!shift && key === '9') return { scope: 'chrome', action: 'tab-last' };
  if (key === 't') return { scope: 'chrome', action: 'new-tab' };
  if (key === 'w') return { scope: 'chrome', action: 'close-tab' };
  if (key === 'l') return { scope: 'chrome', action: 'focus-address' };
  if (key === 'm') return { scope: 'chrome', action: 'toggle-panel' };
  if (key === 'r') return { scope: 'chrome', action: 'reload' };

  return null;
}

/**
 * isGuestActionAllowed(action, activeTabIsInternal)
 *
 * The DD13 internal-tab guard as a pure decision (unit-tested): guest-class
 * actions no-op when the active tab is internal — the original guest capture sat
 * inside the `!__goldfinchInternal` guard, so F12/zoom/print/Ctrl+Shift+I are
 * inert on internal tabs today and must stay so through the sheet. Ctrl+J
 * (downloads) is tab-independent and EXEMPT. Ctrl+F over an internal active tab
 * is a FULL no-op (menu stays open, keystroke swallowed — symmetric with the
 * guard; find is web-tab-only anyway).
 *
 * @param {string} action  a guest-scope action from sheetAcceleratorAction
 * @param {boolean} activeTabIsInternal  isInternalContents(active guest) — pass
 *   true when there is no active guest at all (nothing to act on)
 * @returns {boolean}
 */
export function isGuestActionAllowed(action, activeTabIsInternal) {
  if (action === 'downloads') return true; // tab-independent, exempt
  return !activeTabIsInternal;
}
