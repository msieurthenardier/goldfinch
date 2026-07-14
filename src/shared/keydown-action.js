// @ts-check

/**
 * keydownToAction({ key, ctrl, meta, shift, lightboxOpen })
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
 *   - The rest of the chain (t/w/l/m/j, Shift+P, Ctrl+Shift+I, r) is NOT
 *     lightbox-gated — EXCEPT Ctrl+Shift+I (devtools), which IS lightbox-guarded
 *     in the live handler, matching the F12 devtools entry point. Ctrl+J
 *     (downloads) is app-level like new-tab, so it is NOT lightbox-gated.
 *   - Ctrl+Shift+I (devtools) vs Ctrl+Shift+P (toggle-privacy) is disambiguated
 *     by the key letter, so chain order cannot double-handle.
 *
 * @param {{
 *   key: string,
 *   ctrl: boolean,
 *   meta: boolean,
 *   shift: boolean,
 *   lightboxOpen: boolean,
 * }} descriptor
 * @returns {'devtools' | 'zoom-in' | 'zoom-out' | 'zoom-reset' | 'find'
 *   | 'new-tab' | 'close-tab' | 'focus-address' | 'toggle-panel'
 *   | 'toggle-privacy' | 'reload' | 'downloads' | 'reopen-closed'
 *   | 'next-tab' | 'previous-tab' | 'move-tab-left' | 'move-tab-right'
 *   | 'tab-1' | 'tab-2' | 'tab-3' | 'tab-4' | 'tab-5' | 'tab-6'
 *   | 'tab-7' | 'tab-8' | 'tab-last' | null}
 */
export function keydownToAction({ key, ctrl, meta, shift, lightboxOpen }) {
  // F12 (no modifier) — must be decided BEFORE the modifier gate, else it never
  // fires. Defers while a lightbox is open.
  if (key === 'F12') return lightboxOpen ? null : 'devtools';

  const mod = ctrl || meta;
  if (!mod) return null;

  // Tab management. Match shifted chords before the legacy lowercase-only
  // branches so Ctrl+Shift+T is reopen, never a new tab.
  if (shift && (key === 'T' || key === 't')) return 'reopen-closed';
  if (key === 'Tab') return shift ? 'previous-tab' : 'next-tab';
  if (key === 'PageDown') return 'next-tab';
  if (key === 'PageUp') return 'previous-tab';
  if (shift && key === 'ArrowLeft') return 'move-tab-left';
  if (shift && key === 'ArrowRight') return 'move-tab-right';
  if (!shift && /^[1-8]$/.test(key)) {
    return /** @type {'tab-1'|'tab-2'|'tab-3'|'tab-4'|'tab-5'|'tab-6'|'tab-7'|'tab-8'} */ (`tab-${key}`);
  }
  if (!shift && key === '9') return 'tab-last';

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
