// @ts-check
'use strict';

// Find-overlay page module (M05 Flight 7 — DD4 UI wiring). Since the Leg-3 cutover
// this is the SOLE find UI (the chrome #find-bar was retired); its behavior carries
// that bar's contract: incremental search on input (findNext:false), Enter/Shift+Enter
// and ↑/↓ stepping, prev/next buttons with mousedown focus-steal suppression, ✕/Esc
// close, count rendered `n/m` or `0/0`. Per-tab find state stays in the chrome renderer
// (DD9) — this page holds only the live input text. Reset happens on the NEXT
// find-overlay:init (reset-on-next-open is the contract; there is NO separate reset
// channel — session close is main-side only).
//
// NOTE: this document has window.findOverlay (see find-overlay-globals.d.ts), NOT
// window.goldfinch — the project-wide renderer-globals.d.ts makes the chrome bridge
// *appear* typed here, but it is absent at runtime. Never reference it in this file.
(() => {
  const input = /** @type {HTMLInputElement} */ (document.getElementById('find-input'));
  const count = /** @type {HTMLElement} */ (document.getElementById('find-count'));
  const prevBtn = /** @type {HTMLButtonElement} */ (document.getElementById('find-prev'));
  const nextBtn = /** @type {HTMLButtonElement} */ (document.getElementById('find-next'));
  const closeBtn = /** @type {HTMLButtonElement} */ (document.getElementById('find-close'));
  const bridge = window.findOverlay;

  // Live search text (the only page-side state).
  let text = '';

  // Chrome-bar default find options (runFind parity), overridden per call.
  // NOTE: `findNext` here is the chrome-bar payload shape — "this is a STEP request" —
  // NOT Electron's FindInPageOptions.findNext (which means "begin a new session", the
  // inverse). Main's find-overlay:query handler owns the mapping (HAT-1 fix): a step
  // continues the engine session only when the text is unchanged; any text change
  // begins a new session so edits re-search immediately.
  const runQuery = (opts) => {
    bridge.query({ text, findNext: false, forward: true, matchCase: false, ...opts });
  };

  // Step to the next/previous match. No-op on empty text (chrome-bar parity).
  const step = (forward) => {
    if (!text) return;
    runQuery({ findNext: true, forward });
  };

  // Incremental search. Empty text → blank the count locally, but STILL send the
  // query (Leg-3 deletion sync): main skips findInPage on empty but forwards
  // find-overlay-text to the chrome so the tab's per-tab findText tracks a
  // delete-to-empty — switch-back then restores a blank bar, not resurrected text.
  // Main never stopFinds on empty — the highlight persists until close, exactly
  // like the retired inset bar's runFind.
  input.addEventListener('input', () => {
    text = input.value;
    if (!text) count.textContent = '';
    runQuery({ findNext: false });
  });

  // Keyboard map — parity with the chrome bar's findInput keydown handler.
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      step(!e.shiftKey);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      step(true);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      step(false);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      bridge.close();
    }
  });

  // Ctrl/Cmd+F inside the overlay re-selects the input (standard find-bar parity —
  // main's guest-side stimulus only fires while the PAGE has focus, so the overlay
  // handles its own).
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
      e.preventDefault();
      input.focus();
      input.select();
    }
  });

  // Prevent the nav buttons from stealing DOM focus away from the input so the user
  // can keep typing without re-clicking after each step (chrome-bar pattern).
  prevBtn.addEventListener('mousedown', (e) => e.preventDefault());
  nextBtn.addEventListener('mousedown', (e) => e.preventDefault());
  prevBtn.addEventListener('click', () => step(false));
  nextBtn.addEventListener('click', () => step(true));
  closeBtn.addEventListener('click', () => bridge.close());

  // Seed on open — full open-parity with the chrome bar's openFind: an empty seed
  // clears the input AND blanks the count (a stale count from a prior session must
  // not survive a fresh open); a non-empty seed (Leg 3 passes real per-tab findText)
  // also issues the initial query so the highlight/count appear. Focus + select in
  // both cases (main focuses the overlay webContents; this focuses the DOM input).
  bridge.onInit(({ findText }) => {
    text = typeof findText === 'string' ? findText : '';
    input.value = text;
    if (!text) {
      count.textContent = '';
    } else {
      runQuery({ findNext: false });
    }
    input.focus();
    input.select();
  });

  // Count path B (DD3): `n/m` or `0/0` — same format the retired chrome bar used.
  // Empty-text guard (HAT-1): now that every edit re-searches (new engine session per
  // text change), a delete-to-empty can race a late found-in-page event from the last
  // pre-empty query — dropping counts while the input is empty keeps the blanked count
  // blank (deletion-sync contract) instead of resurrecting a stale `n/m`.
  bridge.onCount(({ activeMatchOrdinal, matches }) => {
    if (!text) return;
    count.textContent = matches ? `${activeMatchOrdinal}/${matches}` : '0/0';
  });
})();
