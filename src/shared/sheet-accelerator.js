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
 *     Ctrl+R reload, Ctrl+Shift+P toggle-privacy, Ctrl+Tab/Ctrl+Shift+Tab tab-next/
 *     tab-prev, Ctrl+PageDown/Ctrl+PageUp tab-next/tab-prev, Ctrl+1..8/Ctrl+9
 *     tab-jump-1..8/tab-jump-last (M09 F3 Leg 1), Ctrl+Shift+T reopen-closed-tab
 *     (M09 F4 Leg 2, DD2 — retires the reservation)
 *
 * DOCUMENTED RISK (design review Q3, mission-debrief carry): this mapper
 * hand-mirrors keydownToAction rather than sharing it — every classifier change
 * (including this flight's `alt` addition) must land in BOTH files in lockstep
 * or the sheet path silently diverges on AltGr locales. Unification is a future
 * maintenance candidate, not this flight.
 *
 * Unmodified Arrow/Home/End/Enter/Space/Escape/Tab stay with the sheet page (the
 * APG menu contract wins inside the menu): every mapping below requires
 * control||meta EXCEPT F12 — APG keys are excluded by construction.
 *
 * Overlap resolution (union semantics): Shift disambiguates the P/I/T chords —
 * Ctrl+Shift+P → toggle-privacy (chrome), Ctrl+Shift+I → devtools (guest),
 * Ctrl+Shift+T → reopen-closed-tab (chrome, M09 F4); unshifted Ctrl+P → print,
 * unshifted Ctrl+T → new-tab. `=` matches shift-tolerantly (US-layout
 * Ctrl+Shift+= → zoom-in), mirroring the guest branch's `'=' || '+'` match.
 *
 * Case discipline mirrors the source handlers exactly: t/w/l/m/r match lowercase
 * only (the chrome handler never matched their shifted forms) when UNSHIFTED;
 * f/F, j/J, p/P, i/I, and (M09 F4) T/t match both cases where their source
 * branches do.
 *
 * `alt` (M09 F3, threaded in lockstep with keydown-action.js's own i18n ruling)
 * defaults to `false` and gates ONLY the digit tab-jump branch, for the same
 * AltGr reason documented there: `Ctrl+Alt+7..9` must keep producing its
 * character, never a tab-jump. The digit match is on `key` alone, regardless
 * of `shift` (AZERTY parity, same as the `=` zoom match above).
 *
 * @param {{ key: string, control: boolean, meta: boolean, shift: boolean, alt?: boolean }} input
 * @returns {{ scope: 'guest' | 'chrome',
 *   action: 'devtools' | 'zoom-in' | 'zoom-out' | 'zoom-reset' | 'print' | 'find'
 *     | 'downloads' | 'new-tab' | 'close-tab' | 'focus-address' | 'toggle-panel'
 *     | 'reload' | 'toggle-privacy'
 *     | 'tab-next' | 'tab-prev'
 *     | 'tab-jump-1' | 'tab-jump-2' | 'tab-jump-3' | 'tab-jump-4' | 'tab-jump-5'
 *     | 'tab-jump-6' | 'tab-jump-7' | 'tab-jump-8' | 'tab-jump-last'
 *     | 'reopen-closed-tab',
 *   autoRepeatGuard?: boolean } | null}
 */
export function sheetAcceleratorAction({ key, control, meta, shift, alt = false }) {
  // F12 — the sole modifier-less accelerator (guest devtools branch).
  if (key === 'F12') return { scope: 'guest', action: 'devtools', autoRepeatGuard: true };

  if (!(control || meta)) return null; // APG keys excluded by construction

  // Shift-disambiguated chords FIRST (Ctrl+Shift+I devtools / Ctrl+Shift+P privacy /
  // Ctrl+Shift+T reopen-closed-tab, M09 F4 DD2), before the unshifted p/P print or
  // t/new-tab matches below can shadow them.
  if (shift && (key === 'I' || key === 'i')) return { scope: 'guest', action: 'devtools', autoRepeatGuard: true };
  if (shift && (key === 'P' || key === 'p')) return { scope: 'chrome', action: 'toggle-privacy' };
  if (shift && (key === 'T' || key === 't')) return { scope: 'chrome', action: 'reopen-closed-tab' };

  // Guest-class (mirrors the guest before-input-event branch bodies).
  if (key === '=' || key === '+') return { scope: 'guest', action: 'zoom-in' };
  if (key === '-') return { scope: 'guest', action: 'zoom-out' };
  if (key === '0') return { scope: 'guest', action: 'zoom-reset' };
  if (key === 'p' || key === 'P') return { scope: 'guest', action: 'print' };
  if (key === 'f' || key === 'F') return { scope: 'guest', action: 'find' };
  if (key === 'j' || key === 'J') return { scope: 'guest', action: 'downloads', autoRepeatGuard: true };

  // Chrome-class tab-cycle (M09 F3 Leg 1) — mirrors keydownToAction's Tab/PageDown/
  // PageUp mapping, not lightbox-gated (there is no lightbox concept on the sheet).
  if (key === 'Tab') return { scope: 'chrome', action: shift ? 'tab-prev' : 'tab-next' };
  if (key === 'PageDown') return { scope: 'chrome', action: 'tab-next' };
  if (key === 'PageUp') return { scope: 'chrome', action: 'tab-prev' };

  // Chrome-class tab-jump (M09 F3 Leg 1) — same `!alt` AltGr guard and shift-
  // tolerant digit match as keydownToAction; must stay in lockstep with it.
  if (!alt && key >= '1' && key <= '9') {
    return { scope: 'chrome', action: /** @type {any} */ (key === '9' ? 'tab-jump-last' : `tab-jump-${key}`) };
  }

  // Chrome-class (mirrors keydownToAction's lowercase-only matches).
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
