// @ts-check

/**
 * keydownToAction({ key, ctrl, meta, shift, lightboxOpen, alt })
 *
 * Pure mapper from a renderer keydown descriptor to a chrome-shortcut action,
 * extracted from the GLOBAL chrome shortcut keydown handler (renderer.js). It
 * reproduces that handler's gating exactly, but performs NO side effects: no
 * DOM, no IPC, no Electron. It takes a plain descriptor and returns the action
 * string the handler should dispatch, or null when no shortcut matches (or when
 * a lightbox-gated key is pressed while a lightbox is open).
 *
 * The impure dispatch (resolving the active tab, the internal-tab / null-wcId
 * guards, preventDefault, and the actual IPC / DOM ops) stays in the handler.
 *
 * Gating, mirroring the live handler:
 *   - F12 is decided BEFORE the modifier gate (it carries no modifier). It
 *     defers while a lightbox is open.
 *   - mod = ctrl || meta; with no modifier (and key !== 'F12'), nothing matches.
 *   - Zoom (=/+/-/0) and find (f/F) defer while a lightbox is open.
 *   - Tab-cycle (Ctrl+Tab/Ctrl+Shift+Tab, Ctrl+PageDown/Ctrl+PageUp) and
 *     tab-jump (Ctrl+1..9) are NOT lightbox-deferred — tab switching must
 *     always work, matching the new-tab/close-tab precedent (M09 F3, DD1).
 *   - The rest of the chain (t/w/l/m/j, Shift+P, Shift+T, Ctrl+Shift+I, r) is NOT
 *     lightbox-gated — EXCEPT Ctrl+Shift+I (devtools), which IS lightbox-guarded
 *     in the live handler, matching the F12 devtools entry point. Ctrl+J
 *     (downloads) is app-level like new-tab, so it is NOT lightbox-gated.
 *   - Ctrl+Shift+I (devtools) vs Ctrl+Shift+P (toggle-privacy) vs Ctrl+Shift+T
 *     (reopen-closed-tab, M09 F4) is disambiguated by the key letter, so chain
 *     order cannot double-handle.
 *
 * `alt` (M09 F3, i18n design-review ruling) defaults to `false` so every
 * existing pin (which never passes it) is unaffected. It gates ONLY the digit
 * tab-jump branch: on European layouts, AltGr-produced digits report as
 * ctrl+alt, so `Ctrl+Alt+7..9` must keep producing their character (`{`/`[`/`]`
 * etc.), never a tab-jump. The guard is scoped to digits only — Tab/PageDown/
 * PageUp are not character-producing, so guarding them would be cargo cult.
 * The digit match itself is on `key === '1'..'9'` REGARDLESS of `shift` —
 * AZERTY layouts need Shift to produce digit characters, so a reflexive
 * `!shift` guard would break them (mirrors the existing shift-tolerant `'='`
 * zoom match above).
 *
 * @param {{
 *   key: string,
 *   ctrl: boolean,
 *   meta: boolean,
 *   shift: boolean,
 *   lightboxOpen: boolean,
 *   alt?: boolean,
 * }} descriptor
 * @returns {'devtools' | 'zoom-in' | 'zoom-out' | 'zoom-reset' | 'find'
 *   | 'new-tab' | 'close-tab' | 'focus-address' | 'toggle-panel'
 *   | 'toggle-privacy' | 'reload' | 'downloads'
 *   | 'tab-next' | 'tab-prev'
 *   | 'tab-jump-1' | 'tab-jump-2' | 'tab-jump-3' | 'tab-jump-4' | 'tab-jump-5'
 *   | 'tab-jump-6' | 'tab-jump-7' | 'tab-jump-8' | 'tab-jump-last'
 *   | 'reopen-closed-tab'
 *   | null}
 */
export function keydownToAction({ key, ctrl, meta, shift, lightboxOpen, alt = false }) {
  // F12 (no modifier) — must be decided BEFORE the modifier gate, else it never
  // fires. Defers while a lightbox is open.
  if (key === 'F12') return lightboxOpen ? null : 'devtools';

  const mod = ctrl || meta;
  if (!mod) return null;

  // Page-zoom (=/+/-/0) — lightbox-deferred.
  if (key === '=' || key === '+' || key === '-' || key === '0') {
    if (lightboxOpen) return null;
    return key === '-' ? 'zoom-out' : key === '0' ? 'zoom-reset' : 'zoom-in';
  }

  // Find (f/F) — lightbox-deferred.
  if (key === 'f' || key === 'F') {
    if (lightboxOpen) return null;
    return 'find';
  }

  // Tab-cycle — NOT lightbox-gated (M09 F3, DD1). Shift disambiguates direction;
  // PageDown/PageUp are the mainstream-browser equivalent chords.
  if (key === 'Tab') return shift ? 'tab-prev' : 'tab-next';
  if (key === 'PageDown') return 'tab-next';
  if (key === 'PageUp') return 'tab-prev';

  // Tab-jump (Ctrl+1..8 → position N, Ctrl+9 → last) — NOT lightbox-gated,
  // NOT shift-gated (see doc comment above), gated on `!alt` only (AltGr guard).
  if (!alt && key >= '1' && key <= '9') {
    return key === '9' ? 'tab-jump-last' : /** @type {any} */ (`tab-jump-${key}`);
  }

  // Ctrl+Shift+T -> reopen-closed-tab (M09 F4, DD2 step 1) — RETIRES the
  // reservation this chord previously held unassigned (see the flight's design
  // decisions). Matches both cases (capslock-with-shift parity, same as the
  // Ctrl+Shift+I/P chords below); NOT lightbox-gated (tab management is global,
  // same class as tab-cycle/jump above).
  if (shift && (key === 'T' || key === 't')) return 'reopen-closed-tab';

  // The rest of the chain (NOT lightbox-gated, except Ctrl+Shift+I below).
  if (key === 't') return 'new-tab';
  if (key === 'w') return 'close-tab';
  if (key === 'l') return 'focus-address';
  if (key === 'm') return 'toggle-panel';
  if (key === 'j' || key === 'J') return 'downloads';
  if (shift && (key === 'P' || key === 'p')) return 'toggle-privacy';
  if (shift && (key === 'I' || key === 'i')) {
    // Ctrl+Shift+I devtools — the alternate to F12; lightbox-guarded like F12.
    return lightboxOpen ? null : 'devtools';
  }
  if (key === 'r') return 'reload';

  return null;
}
