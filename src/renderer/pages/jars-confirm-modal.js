// @ts-check

/**
 * jars-confirm-modal.js — the ONE page-level confirm modal for
 * goldfinch://jars (H7, M08 Flight 6 Leg 5). Growth-checkpoint extraction
 * (leg spec, pre-agreed, not a re-litigation): landing the modal inline in
 * jars.js crossed the ~1,800-line DD2 trigger, so it moves here — the
 * `jars-tabs.js` / `jars-history-panel.js` three-point-onboarding precedent
 * (a new `jars.html` module `<script>` tag, a new `INTERNAL_PAGES.jars`
 * pathname entry in `main.js`, and the `jars-page-shared-scripts.test.js`
 * contract test self-deriving from `jars.html` — no test-file edit needed).
 *
 * Replaces the per-region inline confirms every earlier flight used: ONE
 * dialog, built once and appended to `<body>`, driven by jars.js's `ui`
 * singleton via `update()` — reconciled once per `render()` call. jars.js
 * calls `update()` AFTER `renderSections` (its own `render()`'s ordering
 * comment): `reconcileUi` has already collapsed `ui` for a since-removed row
 * by the time `update()` runs, so a live `SectionRefs` is guaranteed for any
 * surviving open row.
 *
 * Host coupling (Electron-free injected-deps pattern, CLAUDE.md "Recurring
 * module shapes"): this module has no access to jars.js's page-level `ui`
 * singleton, `sectionMap`, or `DATA_ACTIONS` table, so they're passed in
 * once at `createConfirmModal()` construction. `getUi()` reads the CURRENT
 * `ui` value live (never a stale snapshot — `ui` is reassigned wholesale on
 * every transient-state change in jars.js); `closeTransient` is the EXACT
 * SAME function jars.js uses for every other transient dismissal;
 * `getSectionRefs(rowId)` resolves the caller's live `SectionRefs`-shaped
 * object, duck-typed (`dataButtons` — the same field `setSectionStatus`'s
 * caller already needs).
 *
 * `createConfirmModal()` returns `{ captureTrigger, update }`:
 * - `captureTrigger()` — call at the START of `openDataConfirm`, BEFORE `ui`
 *   is reassigned: the button that was just clicked is
 *   `document.activeElement` at that point (the browser focuses a button on
 *   click before its handler runs), and `update()` alone can't see it
 *   (`update()` is `ui`-driven, one render step later, by which point the
 *   trigger may already have moved focus elsewhere via its own disable).
 * - `update()` — call once per `render()`, after `renderSections`. Diffs the
 *   open `(action, rowId)` key exactly like the retired per-region areas did
 *   (M06 F4 DD6 focus-preserving discipline, carried page-wide: a same-row
 *   action SWAP is itself a key change and forces a rebuild): opens +
 *   populates the modal for `(ui.action, ui.rowId)` when
 *   `ui.mode === 'confirm'`, else closes it — restoring focus to the
 *   captured trigger, or the injected fallback element when the trigger is
 *   gone (`delete` is `silentSuccess` — its row and trigger are removed by
 *   jars.js's `renderSections` before `update()` runs, design review; never
 *   strand focus on `<body>`, the house invariant).
 *
 * Transplants the menu-overlay sheet's new-container dialog
 * (`menu-overlay.js:296-431`, the same-repo template): `role="dialog"
 * aria-modal="true"`, a fixed small-array Tab cycle, Escape + backdrop
 * dismiss, explicit focus-return — simpler here, a 2-element
 * `[confirm, cancel]` cycle instead of 3. In-flight suppress (Confirm
 * clicked, `run` pending) is a dialog-local `keydown`+`stopPropagation`
 * shadow (design review, FD pick — mirrors the name-input Escape precedent
 * at `jars.js:831-838`; smaller than threading an `inFlight` flag through
 * jars.js's `ui` singleton, and keeps jars.js's own global Escape handler
 * unchanged), covering both Escape and backdrop-click dismissal.
 */

/**
 * @typedef {{ copy: string, run: (id: string) => Promise<any>, okNote: string, failNote: string, silentSuccess?: boolean }} DataAction
 */

/**
 * @param {{
 *   dataActions: { [action: string]: DataAction },
 *   titles: { [action: string]: string },
 *   getUi: () => { mode: (string|null), rowId: (string|null), action: (string|null) },
 *   closeTransient: () => void,
 *   getSectionRefs: (rowId: string) => any,
 *   setSectionStatus: (refs: any, text: string, ok: boolean) => void,
 *   fallbackFocusEl: HTMLElement
 * }} deps
 * @returns {{ captureTrigger: () => void, update: () => void }}
 */
export function createConfirmModal({ dataActions, titles, getUi, closeTransient, getSectionRefs, setSectionStatus, fallbackFocusEl }) {
  const backdrop = document.createElement('div');
  backdrop.id = 'jars-confirm-backdrop';
  backdrop.className = 'jar-modal-backdrop';
  backdrop.hidden = true;
  document.body.appendChild(backdrop);

  const card = document.createElement('div');
  card.className = 'jar-modal-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', 'jars-confirm-title');
  card.setAttribute('aria-describedby', 'jars-confirm-desc');
  backdrop.appendChild(card);

  const titleEl = document.createElement('h2');
  titleEl.id = 'jars-confirm-title';
  titleEl.className = 'jar-modal-title';
  card.appendChild(titleEl);

  const bodyEl = document.createElement('div');
  card.appendChild(bodyEl);

  /** Diff key ('action:rowId') of the currently-open modal, or null. */
  /** @type {string|null} */
  let openKey = null;
  // The element to restore focus to on close (captured by captureTrigger()
  // at the moment the trigger was clicked).
  /** @type {HTMLElement|null} */
  let triggerEl = null;
  /** @type {HTMLButtonElement|null} */
  let confirmBtnEl = null;
  /** @type {HTMLButtonElement|null} */
  let cancelBtnEl = null;
  // In-flight suppress flag — see module doc comment.
  let inFlight = false;

  /**
   * Restore focus to the captured trigger, falling back to the injected
   * `fallbackFocusEl` when the trigger is gone (design review — see module
   * doc comment). Never strand focus on `<body>`.
   */
  function restoreFocus() {
    const target = triggerEl && triggerEl.isConnected ? triggerEl : fallbackFocusEl;
    triggerEl = null;
    target.focus();
  }

  /**
   * Build the confirm block for one data action (cycle-2 AC, carried
   * verbatim from the pre-Leg-5 per-region implementation): action-specific
   * copy, a Confirm button, Cancel, and its own confirm-LOCAL error line
   * (delete-confirm precedent — NOT the section's shared line).
   *
   * In-flight guard (cycle-2 AC (b)): Confirm AND Cancel disable themselves,
   * plus this action's trigger button (in its region's always-visible row),
   * the instant Confirm is clicked — since the trigger stays clickable while
   * the modal is open, leaving it enabled would let a second click
   * double-fire the same request. This guard is load-bearing for `delete`
   * too (design review, carried from jars.js): the footer's delete button
   * stays visible beside the open modal, exactly like every other
   * `dataActions` trigger, so it needs the same disable. Disabling it also
   * makes a "swap away and back to this action mid-flight" impossible by
   * construction (the trigger can't be clicked to reopen it), which is the
   * double-fire hole the sibling-visible design opens. The trigger always
   * re-enables on settle, success or failure, independent of whether this
   * confirm is still the one showing. Resolve/reject additionally verify
   * `ui` still points at THIS `(action, rowId)` (via `getUi()`) before
   * mutating (closing the confirm) or writing the local error — an
   * abandoned promise from a swapped-away confirm must not close or relabel
   * a NEWER confirm the user opened instead.
   *
   * `entry.silentSuccess` (delete only, today): on success, skip BOTH
   * `setSectionStatus` and `closeTransient()` — the historic no-op success
   * path (jars.js's `DATA_ACTIONS` comment).
   * @param {string} id
   * @param {string} action
   * @param {any} refs
   * @returns {{ root: HTMLElement, confirmBtn: HTMLButtonElement, cancelBtn: HTMLButtonElement }}
   */
  function buildContent(id, action, refs) {
    const entry = dataActions[action];
    const wrap = document.createElement('div');
    wrap.className = 'jar-confirm';

    const text = document.createElement('p');
    text.className = 'jar-confirm-text';
    text.id = 'jars-confirm-desc';
    text.textContent = entry.copy;
    wrap.appendChild(text);

    const errorLine = document.createElement('p');
    errorLine.className = 'jar-error-line';
    errorLine.setAttribute('aria-live', 'polite');
    wrap.appendChild(errorLine);

    const actionsEl = document.createElement('div');
    actionsEl.className = 'jar-form-actions';

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'jar-btn jar-btn-danger';
    confirmBtn.textContent = 'Confirm';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'jar-btn';
    cancelBtn.textContent = 'Cancel';

    const triggerBtn = refs.dataButtons ? refs.dataButtons.get(action) : null;

    confirmBtn.addEventListener('click', () => {
      confirmBtn.disabled = true;
      cancelBtn.disabled = true;
      if (triggerBtn) triggerBtn.disabled = true;
      inFlight = true;
      entry.run(id)
        .then((result) => {
          if (triggerBtn) triggerBtn.disabled = false;
          const ui = getUi();
          const stillOpen = ui.mode === 'confirm' && ui.rowId === id && ui.action === action;
          if (stillOpen) inFlight = false;
          if (result && result.ok) {
            if (!entry.silentSuccess) {
              setSectionStatus(refs, entry.okNote, true);
              if (stillOpen) closeTransient();
            }
            return;
          }
          if (stillOpen) {
            errorLine.textContent = entry.failNote;
            confirmBtn.disabled = false;
            cancelBtn.disabled = false;
          }
        })
        .catch(() => {
          if (triggerBtn) triggerBtn.disabled = false;
          const ui = getUi();
          const stillOpen = ui.mode === 'confirm' && ui.rowId === id && ui.action === action;
          if (stillOpen) inFlight = false;
          if (stillOpen) {
            errorLine.textContent = entry.failNote;
            confirmBtn.disabled = false;
            cancelBtn.disabled = false;
          }
        });
    });

    cancelBtn.addEventListener('click', () => closeTransient());

    actionsEl.appendChild(confirmBtn);
    actionsEl.appendChild(cancelBtn);
    wrap.appendChild(actionsEl);
    return { root: wrap, confirmBtn, cancelBtn };
  }

  /**
   * Reconcile the modal against `ui` — see module doc comment for the full
   * contract.
   */
  function update() {
    const ui = getUi();
    const openHere = ui.mode === 'confirm' && ui.rowId != null && ui.action != null && dataActions[ui.action] != null;
    const key = openHere ? ui.action + ':' + ui.rowId : null;
    if (key === openKey) return;
    const wasOpen = openKey != null;
    openKey = key;

    if (key === null) {
      backdrop.hidden = true;
      bodyEl.textContent = '';
      confirmBtnEl = null;
      cancelBtnEl = null;
      inFlight = false;
      if (wasOpen) restoreFocus();
      return;
    }

    const refs = getSectionRefs(/** @type {string} */ (ui.rowId));
    if (!refs) {
      // Unreachable in practice (jars.js's reconcileUi already collapses
      // `ui` before this runs) — fail closed rather than throw.
      openKey = null;
      backdrop.hidden = true;
      return;
    }

    inFlight = false;
    titleEl.textContent = titles[/** @type {string} */ (ui.action)] || 'Confirm';
    const built = buildContent(/** @type {string} */ (ui.rowId), /** @type {string} */ (ui.action), refs);
    bodyEl.textContent = '';
    bodyEl.appendChild(built.root);
    confirmBtnEl = built.confirmBtn;
    cancelBtnEl = built.cancelBtn;
    backdrop.hidden = false;
    // Default focus Cancel — destructive-safe (design review).
    built.cancelBtn.focus();
  }

  // Focus trap: Tab/Shift+Tab cycle Confirm↔Cancel (menu-overlay.js:296-431
  // precedent, a 2-element cycle here). Escape cancels UNLESS a confirm run
  // is in flight — suppressed via the dialog-local stopPropagation shadow
  // (module doc comment), which also keeps jars.js's own global Escape
  // handler untouched (this listener runs on the bubble path before the
  // event ever reaches `window`).
  backdrop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (inFlight) return;
      closeTransient();
      return;
    }
    if (e.key === 'Tab' && confirmBtnEl && cancelBtnEl) {
      e.preventDefault();
      const cycle = [confirmBtnEl, cancelBtnEl];
      const i = cycle.indexOf(/** @type {any} */ (document.activeElement));
      const n = (i + (e.shiftKey ? -1 : 1) + cycle.length) % cycle.length;
      cycle[n].focus();
    }
  });

  // Backdrop click cancels (menu-overlay.js dialogNode precedent) —
  // suppressed while in flight, same as Escape.
  backdrop.addEventListener('click', (e) => {
    if (e.target !== backdrop) return;
    if (inFlight) return;
    closeTransient();
  });

  /**
   * Capture the trigger for focus-restore on close — call at the START of
   * `openDataConfirm`, BEFORE `ui` is reassigned (see module doc comment).
   */
  function captureTrigger() {
    triggerEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }

  return { captureTrigger, update };
}
