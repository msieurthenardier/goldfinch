/** Stable create-panel DOM, draft lifecycle, validation, and anchoring. */
export function createJarsCreatePanel(deps) {
  /** @typedef {{ id: string, name: string, color: string, isDefault: boolean, isBurner: boolean }} JarRow */
  const {
    window, document, bridge, sectionsEl, newBtn, isSafeColor, PALETTE,
    pickNewJarColor, createPanelModeKey, getContainers, getUi, setUi,
    getSectionRefs, requestRender
  } = deps;
  const FALLBACK_COLOR = '#9aa0ac';
  const createPanelEl = document.createElement('div');
  createPanelEl.id = 'jars-create-panel';

  function closeTransient() {
    setUi({ mode: null, rowId: null, action: null, draft: null });
    requestRender();
  }

/**
 * A reusable swatch grid: a role="radiogroup" of role="radio" buttons, one per
 * color, aria-checked against `getSelected()`. `onSelect` mutates the caller's
 * state directly — the grid updates its own aria-checked/selected state in
 * place via its internal paint() (called synchronously right after onSelect,
 * in the same click handler), so a section's swatch click can give instant
 * visual feedback without waiting for a broadcast re-render. Reused as-is from
 * Flight 3 (leg spec: unchanged) by both the create panel and each section.
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
 * Anchor the create panel immediately before the Burner section (F4 fix).
 * The panel isn't part of `rows`, so renderSections above never positions
 * it — this corrective step runs after every render (state-only or
 * getUi().mode transition alike) and repositions it via ONE conditional
 * insertBefore call: a no-op in the steady-state case where it's already
 * in the right spot, and otherwise a single atomic DOM move — which, like
 * every other insertBefore reposition on this page, never disturbs a
 * currently-focused descendant, so this is safe to run even while the
 * panel holds focus (typed name / picked color mid-edit).
 *
 * Because this runs on every render, a NEW jar section inserted while the
 * panel is open lands before it automatically: renderSections' own
 * insertBefore call for that new row targets `prevEl.nextSibling`, which —
 * in the steady state this function maintains — IS the panel, so the new
 * section is slotted in right before it, and this function then finds the
 * panel already correctly placed before Burner and no-ops.
 * @param {JarRow[]} rows
 */
function anchorCreatePanel(rows) {
  const burnerRow = rows.find((r) => r.isBurner);
  const burnerRefs = burnerRow ? getSectionRefs(burnerRow.id) : null;
  if (burnerRefs) {
    if (createPanelEl.parentNode !== sectionsEl || createPanelEl.nextSibling !== burnerRefs.root) {
      sectionsEl.insertBefore(createPanelEl, burnerRefs.root);
    }
  } else if (createPanelEl.parentNode !== sectionsEl || sectionsEl.lastChild !== createPanelEl) {
    // Defensive fallback — buildJarPageModel always appends a Burner row,
    // so this branch is not reachable in practice.
    sectionsEl.appendChild(createPanelEl);
  }
}

// Tracks which mode the create panel's DOM currently reflects, so render()
// can rebuild it ONLY on an actual open/close transition (leg spec AC) —
// never on a state-only pass, so an in-progress create-panel edit survives
// an unrelated jars-changed broadcast.
/** @type {'create'|null} */
let createPanelMode = null;

/** Rebuild the create-panel DOM from ui (shown only while getUi().mode === 'create'). */
function renderCreatePanel() {
  createPanelEl.textContent = '';
  newBtn.textContent = getUi().mode === 'create' ? 'Cancel' : '+ New jar';
  newBtn.setAttribute('aria-expanded', String(getUi().mode === 'create'));
  if (getUi().mode !== 'create') return;

  const draft = /** @type {{name: string, color: string}} */ (getUi().draft);

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
  errorLine.setAttribute('aria-live', 'polite');
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
    // (leg spec AC) — cleanName does not trim.
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

  // On open, the name input receives focus and the panel is scrolled into
  // view (leg spec AC).
  nameInput.focus();
  createPanelEl.scrollIntoView({ block: 'nearest' });
}

/** Rebuild the create panel only when getUi().mode actually transitioned to/from 'create'. */
function maybeRenderCreatePanel() {
  const targetMode = createPanelModeKey(getUi());
  if (targetMode === createPanelMode) return;
  createPanelMode = targetMode;
  renderCreatePanel();
}

function handleNewClick() {
  if (getUi().mode === 'create') {
    closeTransient();
  } else {
    setUi({ mode: 'create', rowId: null, action: null, draft: { name: '', color: pickNewJarColor(PALETTE, getContainers().map((container) => container.color)) } });
    requestRender();
  }
}
newBtn.addEventListener('click', handleNewClick);

// Escape dismisses ANY open transient state — create panel or a data/delete
// confirm (FD ruling at design review: keyboard consistency across every
// getUi().mode). The name input's own keydown handler stopPropagation()s its
// Escape, so this never double-fires against an in-progress name edit.
function handleKeydown(e) {
  if (e.key === 'Escape' && getUi().mode !== null) closeTransient();
}
window.addEventListener('keydown', handleKeydown);


  return {
    render(rows) {
      anchorCreatePanel(rows);
      maybeRenderCreatePanel();
    },
    close: closeTransient,
    element: createPanelEl,
    destroy() {
      newBtn.removeEventListener('click', handleNewClick);
      window.removeEventListener('keydown', handleKeydown);
    }
  };
}
