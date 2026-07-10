'use strict';

/**
 * jars.js — the goldfinch://jars internal page controller (Flight 3, Legs 1-2).
 *
 * Leg 1 shipped a read-only live list. Leg 2 adds the interactions: create
 * (curated palette), rename/recolor, set-default, delete with an in-page two-step
 * confirm. Row order/shape/editability comes from the pure buildJarPageModel +
 * PALETTE (jar-page-model.js), loaded via <script> before this file.
 *
 * State shape (Leg 2): `state = { containers, defaultId }` is a persisted mirror
 * of the last broadcast/boot read (module-scope) — render() is a pure function of
 * `state` plus the transient `ui` object, so a UI-only action (opening an editor)
 * can re-render without a fresh IPC round trip. `ui = { mode, rowId, draft }`
 * tracks AT MOST one open transient surface at a time (`mode` is 'create' | 'edit'
 * | 'confirm-delete' | null) — exclusivity is enforced by construction, since
 * opening any transient surface always replaces `ui` wholesale. Every render()
 * reconciles `ui` against the fresh row set: if the row an editor/confirm was open
 * for no longer exists (deleted from another surface), the transient state
 * collapses silently, without error.
 *
 * CSP: served as a same-origin subresource under default-src 'self' (no
 * 'unsafe-inline'). NO inline event handlers; NO dynamic <script>/<style>
 * injection. All DOM is built with createElement + textContent (names are
 * model-controlled but rendered as text regardless); dot/swatch colors are set
 * only after an isSafeColor check (defense in depth — the store already clamps on
 * write).
 *
 * Broadcast-before-resolve (F2-observed, renderer.js:2710-2716): a mutation's
 * jars-changed broadcast can arrive BEFORE its own invoke() resolves. Rendering
 * therefore NEVER reads from an invoke's resolved value — only from `state`, which
 * is updated exclusively by the boot read and the onJarsChanged subscription.
 * Invoke results are used only as success/failure signals (and, on success, to
 * close the transient UI that triggered them).
 */

(function () {
  // The bridge only exists on the genuine goldfinch://jars origin.
  const bridge = window.goldfinchInternal;
  if (!bridge) return;

  const listEl = /** @type {HTMLElement|null} */ (document.getElementById('jars-list'));
  const newBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('jars-new'));
  const createPanelEl = /** @type {HTMLElement|null} */ (document.getElementById('jars-create-panel'));
  const pageErrorEl = /** @type {HTMLElement|null} */ (document.getElementById('jars-page-error'));
  if (!listEl || !newBtn || !createPanelEl || !pageErrorEl) return;

  const FALLBACK_COLOR = '#9aa0ac';
  const SVG_NS = 'http://www.w3.org/2000/svg';

  /**
   * Build a decorative inline icon (Lucide-style: 24x24 viewBox, 16x16 render
   * size, stroke=currentColor so it inherits the button's text color — same
   * convention already used for the static toolbar/pin-toggle icons in
   * index.html and settings.html). Built entirely via createElementNS —
   * NEVER innerHTML/a template string — matching this page's textContent-only
   * CSP convention (module doc comment); jars.js renders one row per jar
   * dynamically, so the icon can't be static markup the way the pin-toggle
   * icons are.
   * @param {ReadonlyArray<{tag: string, attrs: Record<string, string>}>} shapes
   * @returns {SVGSVGElement}
   */
  function buildIcon(shapes) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.classList.add('jar-icon');
    for (const shape of shapes) {
      const el = document.createElementNS(SVG_NS, shape.tag);
      for (const key of Object.keys(shape.attrs)) el.setAttribute(key, shape.attrs[key]);
      svg.appendChild(el);
    }
    return svg;
  }

  // Lucide "pencil" and "trash-2" path data (ISC license) — same icon set/style
  // already vendored as static SVG for the toolbar and pin-toggle buttons.
  /** @type {ReadonlyArray<{tag: string, attrs: Record<string, string>}>} */
  const ICON_EDIT = [
    { tag: 'path', attrs: { d: 'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z' } },
    { tag: 'path', attrs: { d: 'm15 5 4 4' } }
  ];
  /** @type {ReadonlyArray<{tag: string, attrs: Record<string, string>}>} */
  const ICON_DELETE = [
    { tag: 'path', attrs: { d: 'M3 6h18' } },
    { tag: 'path', attrs: { d: 'M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6' } },
    { tag: 'path', attrs: { d: 'M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2' } },
    { tag: 'line', attrs: { x1: '10', x2: '10', y1: '11', y2: '17' } },
    { tag: 'line', attrs: { x1: '14', x2: '14', y1: '11', y2: '17' } }
  ];

  /** @typedef {{ containers: Array<any>, defaultId: (string|null) }} JarsState */
  /** @typedef {{ mode: ('create'|'edit'|'confirm-delete'|null), rowId: (string|null), draft: ({name: string, color: string, originalColor?: string}|null) }} UiState */

  /** @type {JarsState} */
  let state = { containers: [], defaultId: null };
  /** @type {UiState} */
  let ui = { mode: null, rowId: null, draft: null };

  // ---------------------------------------------------------------------------
  // Shared helpers
  // ---------------------------------------------------------------------------

  /** @param {string} text */
  function setPageError(text) {
    pageErrorEl.textContent = text;
  }

  function clearPageError() {
    pageErrorEl.textContent = '';
  }

  /** Collapse any open transient state (create/edit/confirm-delete) and re-render. */
  function closeTransient() {
    ui = { mode: null, rowId: null, draft: null };
    render();
  }

  /**
   * A reusable swatch grid: a role="radiogroup" of role="radio" buttons, one per
   * color, aria-checked against `getSelected()`. `onSelect` mutates the caller's
   * draft directly — the grid updates its own aria-checked/selected state in
   * place (no full page re-render on a swatch click, so an in-progress name-input
   * caret/focus survives a color pick). Shared by the create panel and the edit
   * row (leg spec implementation guidance #4 — one function, reused).
   * @param {readonly string[]} colors
   * @param {() => string} getSelected
   * @param {(color: string) => void} onSelect
   * @returns {HTMLElement}
   */
  function buildSwatchGrid(colors, getSelected, onSelect) {
    const grid = document.createElement('div');
    grid.className = 'swatch-grid';
    grid.setAttribute('role', 'radiogroup');
    grid.setAttribute('aria-label', 'Jar color');

    /** @type {HTMLButtonElement[]} */
    const buttons = [];

    function paint() {
      const selected = getSelected();
      for (const btn of buttons) {
        const checked = btn.dataset.color === selected;
        btn.setAttribute('aria-checked', String(checked));
        btn.classList.toggle('selected', checked);
      }
    }

    for (const color of colors) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'swatch-btn';
      btn.dataset.color = color;
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-label', color);
      btn.style.background = isSafeColor(color) ? color : FALLBACK_COLOR;
      btn.addEventListener('click', () => {
        onSelect(color);
        paint();
      });
      buttons.push(btn);
      grid.appendChild(btn);
    }

    paint();
    return grid;
  }

  /**
   * Color list for a row's edit swatch grid: the curated PALETTE, plus the row's
   * original color as a trailing 13th "current" swatch when it isn't already a
   * palette member (legacy/migrated jars — leg spec edge case).
   * @param {string} originalColor
   * @returns {readonly string[]}
   */
  function editColors(originalColor) {
    return PALETTE.includes(originalColor) ? PALETTE : [...PALETTE, originalColor];
  }

  // ---------------------------------------------------------------------------
  // Row rendering
  // ---------------------------------------------------------------------------

  /**
   * Build a read-only row element for one jar-page-model row. editability =
   * !row.isBurner (leg spec: reuse the existing model field, no duplicate) — the
   * page never special-cases id === 'burner' in DOM code, so the Burner row
   * structurally gets no action buttons.
   * @param {{ id: string, name: string, color: string, isDefault: boolean, isBurner: boolean }} row
   * @returns {HTMLElement}
   */
  function buildRow(row) {
    const li = document.createElement('li');
    li.className = 'jar-row';
    li.dataset.id = row.id;
    if (row.isBurner) li.dataset.burner = 'true';

    const dot = document.createElement('span');
    dot.className = 'jar-dot';
    // Defense in depth (menu-overlay.js:202 precedent): the store already clamps
    // colors on write, but the page still guards style.background itself.
    dot.style.background = isSafeColor(row.color) ? row.color : FALLBACK_COLOR;
    li.appendChild(dot);

    const main = document.createElement('div');
    main.className = 'jar-main';

    const name = document.createElement('span');
    name.className = 'jar-name';
    name.textContent = row.name;
    main.appendChild(name);

    if (row.isDefault) {
      const badge = document.createElement('span');
      badge.className = 'jar-badge';
      badge.textContent = 'Default';
      main.appendChild(badge);
    }

    if (row.isBurner) {
      const note = document.createElement('span');
      note.className = 'jar-footnote-badge';
      note.textContent = '(evaporates)';
      main.appendChild(note);
    }

    li.appendChild(main);

    // Burner explanatory hint (HAT step-1 finding F4, operator ruling): rendered
    // INSIDE the Burner row's own <li>, below the dot+name line but still above
    // the row's own bottom border (the "divider line" the operator flagged as
    // visually detaching it when it lived in a separate footnote paragraph below
    // the whole list) — so it reads as belonging to the Burner row.
    if (row.isBurner) {
      const hint = document.createElement('p');
      hint.className = 'jar-burner-hint';
      hint.textContent = 'Burner is always available and keeps no history — its tabs evaporate on close.';
      li.appendChild(hint);
    }

    const editable = !row.isBurner;
    if (editable) {
      const actions = document.createElement('div');
      actions.className = 'jar-row-actions';

      if (!row.isDefault) {
        // Text button (operator ruling, HAT step-5 F6: no obvious icon for
        // "make default") — kept compact via .jar-btn-compact so it sits well
        // beside the new icon-only Edit/Delete buttons.
        const defaultBtn = document.createElement('button');
        defaultBtn.type = 'button';
        defaultBtn.className = 'jar-btn jar-btn-compact';
        defaultBtn.textContent = 'Make default';
        defaultBtn.setAttribute('aria-label', `Make ${row.name} the default jar`);
        defaultBtn.addEventListener('click', () => handleSetDefault(row.id));
        actions.appendChild(defaultBtn);
      }

      // Icon buttons (HAT step-5 F6): pencil/trash replace the old Edit/Delete
      // text buttons. aria-label carries the per-row name (list of several
      // icon-only buttons would otherwise all read identically to a screen
      // reader — the downloads.js per-item aria-label convention); title
      // mirrors it for the visible hover tooltip.
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'jar-btn jar-icon-btn';
      editBtn.appendChild(buildIcon(ICON_EDIT));
      editBtn.setAttribute('aria-label', `Edit ${row.name}`);
      editBtn.title = `Edit ${row.name}`;
      editBtn.addEventListener('click', () => openEdit(row));
      actions.appendChild(editBtn);

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'jar-btn jar-icon-btn jar-btn-danger';
      deleteBtn.appendChild(buildIcon(ICON_DELETE));
      deleteBtn.setAttribute('aria-label', `Delete ${row.name}`);
      deleteBtn.title = `Delete ${row.name}`;
      deleteBtn.addEventListener('click', () => openConfirmDelete(row));
      actions.appendChild(deleteBtn);

      li.appendChild(actions);
    }

    return li;
  }

  /**
   * Build the inline edit-row: name input (pre-filled from ui.draft) + swatch
   * grid (current color marked; a palette-external color appends a 13th "current"
   * swatch) + Save/Cancel + a reserved error line. Save carries ONLY the changed
   * fields to jarsRename.
   * @param {{ id: string, name: string, color: string }} row
   * @returns {HTMLElement}
   */
  function buildEditRow(row) {
    const li = document.createElement('li');
    li.className = 'jar-row jar-row-edit';
    li.dataset.id = row.id;

    const draft = /** @type {{name: string, color: string, originalColor: string}} */ (ui.draft);

    const form = document.createElement('form');
    form.className = 'jar-form';

    const nameLabel = document.createElement('label');
    nameLabel.className = 'jar-form-label';
    nameLabel.textContent = 'Name';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'jar-name-input';
    nameInput.maxLength = 24;
    nameInput.value = draft.name;
    nameInput.setAttribute('aria-label', `Edit name for ${row.name}`);
    nameLabel.appendChild(nameInput);
    form.appendChild(nameLabel);

    form.appendChild(buildSwatchGrid(editColors(draft.originalColor), () => draft.color, (color) => { draft.color = color; }));

    const errorLine = document.createElement('p');
    errorLine.className = 'jar-error-line';
    form.appendChild(errorLine);

    const actions = document.createElement('div');
    actions.className = 'jar-form-actions';

    const saveBtn = document.createElement('button');
    saveBtn.type = 'submit';
    saveBtn.className = 'jar-btn jar-btn-primary';
    saveBtn.textContent = 'Save';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'jar-btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => closeTransient());

    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);
    form.appendChild(actions);

    function syncSaveDisabled() {
      saveBtn.disabled = nameInput.value.trim() === '';
    }
    nameInput.addEventListener('input', () => {
      draft.name = nameInput.value;
      syncSaveDisabled();
    });
    syncSaveDisabled();

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const trimmed = draft.name.trim();
      if (!trimmed) return; // page-side guard mirrors create; store clamp backstops
      saveBtn.disabled = true;
      /** @type {{id: string, name?: string, color?: string}} */
      const patch = { id: row.id };
      if (trimmed !== row.name) patch.name = trimmed;
      if (draft.color !== row.color) patch.color = draft.color;
      bridge.jarsRename(patch)
        .then((result) => {
          if (!result) {
            errorLine.textContent = "Couldn't update jar";
            saveBtn.disabled = false;
            return;
          }
          // Success: state already reflects the change (broadcast-before-resolve
          // — see the module doc comment), so this only needs to close the editor.
          closeTransient();
        })
        .catch(() => {
          errorLine.textContent = "Couldn't update jar";
          saveBtn.disabled = false;
        });
    });

    li.appendChild(form);
    return li;
  }

  /**
   * Build the in-page two-step delete confirmation for one row (DD5 copy). Only
   * Confirm calls jarsRemove; Confirm disables once clicked (handleRemove is
   * async — jar-ipc.js:115-142 — a double-fire would surface a needless
   * {ok:false} inline error).
   * @param {{ id: string, name: string, color: string }} row
   * @returns {HTMLElement}
   */
  function buildConfirmRow(row) {
    const li = document.createElement('li');
    li.className = 'jar-row jar-row-confirm';
    li.dataset.id = row.id;

    const header = document.createElement('div');
    header.className = 'jar-main';
    const dot = document.createElement('span');
    dot.className = 'jar-dot';
    dot.style.background = isSafeColor(row.color) ? row.color : FALLBACK_COLOR;
    header.appendChild(dot);
    const name = document.createElement('span');
    name.className = 'jar-name';
    name.textContent = row.name;
    header.appendChild(name);
    li.appendChild(header);

    const text = document.createElement('p');
    text.className = 'jar-confirm-text';
    text.textContent = 'Deletes this jar and wipes its cookies, site storage, and cache. Open tabs in this jar will close.';
    li.appendChild(text);

    const errorLine = document.createElement('p');
    errorLine.className = 'jar-error-line';
    li.appendChild(errorLine);

    const actions = document.createElement('div');
    actions.className = 'jar-form-actions';

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'jar-btn jar-btn-danger';
    confirmBtn.textContent = 'Confirm';
    confirmBtn.addEventListener('click', () => {
      confirmBtn.disabled = true;
      bridge.jarsRemove({ id: row.id })
        .then((result) => {
          if (!result || !result.ok) {
            errorLine.textContent = "Couldn't delete jar";
            confirmBtn.disabled = false;
          }
          // On success the row disappears on the next render (reconciliation
          // collapses ui once row.id no longer exists) — nothing to close here.
        })
        .catch(() => {
          errorLine.textContent = "Couldn't delete jar";
          confirmBtn.disabled = false;
        });
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'jar-btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => closeTransient());

    actions.appendChild(confirmBtn);
    actions.appendChild(cancelBtn);
    li.appendChild(actions);

    return li;
  }

  // ---------------------------------------------------------------------------
  // Create panel
  // ---------------------------------------------------------------------------

  /** Rebuild the create-panel DOM from ui (shown only while ui.mode === 'create'). */
  function renderCreatePanel() {
    createPanelEl.textContent = '';
    newBtn.textContent = ui.mode === 'create' ? 'Cancel' : '+ New jar';
    newBtn.setAttribute('aria-expanded', String(ui.mode === 'create'));
    if (ui.mode !== 'create') return;

    const draft = /** @type {{name: string, color: string}} */ (ui.draft);

    const form = document.createElement('form');
    form.className = 'jar-form';

    const nameLabel = document.createElement('label');
    nameLabel.className = 'jar-form-label';
    nameLabel.textContent = 'Name';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'jar-name-input';
    nameInput.maxLength = 24;
    nameInput.value = draft.name;
    nameInput.setAttribute('aria-label', 'New jar name');
    nameLabel.appendChild(nameInput);
    form.appendChild(nameLabel);

    form.appendChild(buildSwatchGrid(PALETTE, () => draft.color, (color) => { draft.color = color; }));

    const errorLine = document.createElement('p');
    errorLine.className = 'jar-error-line';
    form.appendChild(errorLine);

    const actions = document.createElement('div');
    actions.className = 'jar-form-actions';

    const submitBtn = document.createElement('button');
    submitBtn.type = 'submit';
    submitBtn.className = 'jar-btn jar-btn-primary';
    submitBtn.textContent = 'Create';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'jar-btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => closeTransient());

    actions.appendChild(submitBtn);
    actions.appendChild(cancelBtn);
    form.appendChild(actions);

    function syncSubmitDisabled() {
      submitBtn.disabled = nameInput.value.trim() === '';
    }
    nameInput.addEventListener('input', () => {
      draft.name = nameInput.value;
      syncSubmitDisabled();
    });
    syncSubmitDisabled();

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const trimmed = draft.name.trim();
      // Page-side trim/disable is the SOLE enforcement for whitespace-only names
      // (leg spec AC) — cleanName (jars.js:75-77) does not trim.
      if (!trimmed) return;
      submitBtn.disabled = true;
      bridge.jarsAdd({ name: trimmed, color: draft.color })
        .then((result) => {
          if (!result) {
            errorLine.textContent = "Couldn't create jar";
            submitBtn.disabled = false;
            return;
          }
          // Success: the form resets/closes; the new jar appears via the
          // broadcast re-render (no optimistic insertion).
          closeTransient();
        })
        .catch(() => {
          errorLine.textContent = "Couldn't create jar";
          submitBtn.disabled = false;
        });
    });

    createPanelEl.appendChild(form);
  }

  // ---------------------------------------------------------------------------
  // Transient-state open/close + set-default
  // ---------------------------------------------------------------------------

  /** @param {{ id: string, name: string, color: string }} row */
  function openEdit(row) {
    ui = { mode: 'edit', rowId: row.id, draft: { name: row.name, color: row.color, originalColor: row.color } };
    render();
  }

  /** @param {{ id: string, name: string, color: string }} row */
  function openConfirmDelete(row) {
    ui = { mode: 'confirm-delete', rowId: row.id, draft: null };
    render();
  }

  /** @param {string} id */
  function handleSetDefault(id) {
    clearPageError();
    bridge.jarsSetDefault({ id })
      .then((ok) => {
        if (!ok) setPageError("Couldn't set default jar");
      })
      .catch(() => setPageError("Couldn't set default jar"));
  }

  newBtn.addEventListener('click', () => {
    if (ui.mode === 'create') {
      closeTransient();
    } else {
      ui = { mode: 'create', rowId: null, draft: { name: '', color: PALETTE[0] } };
      render();
    }
  });

  // Escape dismisses ANY open transient state — create form, edit row, or delete
  // confirm (FD ruling at design review: keyboard consistency across every
  // ui.mode, not confirm-only).
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && ui.mode !== null) closeTransient();
  });

  // ---------------------------------------------------------------------------
  // Render + state
  // ---------------------------------------------------------------------------

  /**
   * Reconcile `ui` against the fresh row set: an open editor/confirm collapses
   * silently if its row id no longer exists (e.g. deleted from another surface).
   * @param {Array<{ id: string }>} rows
   */
  function reconcileUi(rows) {
    if ((ui.mode === 'edit' || ui.mode === 'confirm-delete') && !rows.some((r) => r.id === ui.rowId)) {
      ui = { mode: null, rowId: null, draft: null };
    }
  }

  /** Render is a pure function of `state` + `ui` — never of an invoke's resolved value. */
  function render() {
    const rows = buildJarPageModel(state.containers, state.defaultId);
    reconcileUi(rows);

    listEl.textContent = '';
    for (const row of rows) {
      if (ui.mode === 'edit' && ui.rowId === row.id) {
        listEl.appendChild(buildEditRow(row));
      } else if (ui.mode === 'confirm-delete' && ui.rowId === row.id) {
        listEl.appendChild(buildConfirmRow(row));
      } else {
        listEl.appendChild(buildRow(row));
      }
    }

    renderCreatePanel();
  }

  /**
   * Normalize jarsGetDefault()'s resolved object (a persistent jar, or a
   * structured-clone of the frozen BURNER) into the broadcast's defaultId
   * convention (string id, or null when Burner holds the flag). Compare by id,
   * never by reference — jarsGetDefault() crosses IPC as a clone (leg spec F2 DD3
   * lesson).
   * @param {{ id?: string }|null|undefined} def
   * @returns {string|null}
   */
  function normalizeDefaultId(def) {
    if (!def || typeof def.id !== 'string') return null;
    return def.id === BURNER.id ? null : def.id;
  }

  /** @param {JarsState} payload */
  function applyState(payload) {
    state = { containers: Array.isArray(payload.containers) ? payload.containers : [], defaultId: payload.defaultId };
    render();
  }

  // Boot/broadcast race (leg edge case): subscribe FIRST, then boot-read, so a
  // mutation racing the one-shot boot reads is never lost — applyState wholesale-
  // replaces `state`, so whichever arrives last wins.
  const handle = bridge.onJarsChanged((payload) => {
    if (payload && Array.isArray(payload.containers)) applyState(payload);
  });

  Promise.all([bridge.jarsList(), bridge.jarsGetDefault()])
    .then(([containers, def]) => {
      applyState({ containers: Array.isArray(containers) ? containers : [], defaultId: normalizeDefaultId(def) });
    })
    .catch(() => {});

  // Clean up on pagehide to prevent listener accumulation across electronmon
  // reloads (settings.js:138-142 pattern).
  window.addEventListener('pagehide', () => bridge.offJarsChanged(handle), { once: true });
})();
