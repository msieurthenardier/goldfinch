// @ts-check

// DOM builder + renderer for the corner SAVE PROMPT card (originally the menu-overlay sheet's
// `vault-capture` template, M12 Flight 2 Leg 4 capture-save, DD7; Sortie 06 Leg 1 moved it to the
// per-window save-prompt view and made it NON-MODAL: no backdrop, no `aria-modal`, the card is the
// root). Extracted as pure, document-injected helpers (the same "pure module in src/shared/"
// pattern vault-unlock-template.js / vault-picker-template.js use) so the save-vs-update
// rendering AND the vault-choice-on-save-only contract are unit-testable against the
// fake-document helper without a live view. `src/renderer/save-prompt.js` imports these and wires
// behavior (Save -> the `save-prompt:save` invoke, Not now / X -> `save-prompt:dismiss`).
//
// The card is `role="dialog"` with `aria-labelledby` (heading) / `aria-describedby` (the field
// rows) and NO `aria-modal` - the page behind it stays operable. It shows the origin + username
// (read-only), a "Save password?" / "Update password?" heading, and - for a `save` only - a vault
// choice (default the active jar, "Global" selectable). Save + "Not now" + a dismiss X, a 3 px
// countdown bar, a "1 of N" counter and a `role="status"` node for result states.
//
// SECURITY (leg core): the model is METADATA ONLY (origin / username / mode /
// defaultVaultId / choices / captureId). The captured password NEVER reaches the
// sheet — it lives only in the main-side held record; the Save invoke reports just
// the chosen vaultId (+ captureId + token).

// Kind-keyed dispatch table (Mission 21 Flight 3 Leg 1, replacing the binary
// `model.kind === 'card'` branching; `identity` added at Leg 4, AC17/AC18):
// each entry supplies the heading noun, the subject row's label, and its
// value-text builder (including the family's "nothing captured" fallback —
// '(card)' / '(no username)'). Data only, no branching logic, so a future kind
// adds an entry rather than editing a function body. Membership is checked via
// hasOwnProperty (never a bare truthy lookup) so a `kind` of 'constructor' or
// similar can't resolve through Object.prototype.
//
// `identity` is MODE-DISPATCH WITHIN the family, layered on top of the family
// dispatch above it (AC17): its own `heading(model)` overrides the generic
// `${Save|Update} ${noun}?` construction — the model's `mode` is only two
// values ('save'/'update'), but identity has THREE headings, so 'update' is
// further split on whether `changedFields` is non-empty (a conflict) or empty
// (a gap-fill). DD6: the subject row lists field LABELS from
// `addedFields`/`changedFields` — never a value; `classifyCapture`'s `to`/`from`
// values never reach this module at all (consumed main-side, per the flight's
// own field-names-not-values rule).
const KIND_TABLE = {
  card: {
    noun: 'card',
    resultNoun: 'Card',
    subjectLabel: 'Card',
    // last4 is a declared NON-SECRET field; the PAN never reaches the sheet at all.
    subjectValueText(model) {
      const brand = model && model.brand != null && model.brand !== '' ? String(model.brand) : '';
      const last4 = model && model.last4 != null && model.last4 !== '' ? `•••• ${model.last4}` : '';
      return [brand, last4].filter(Boolean).join('  ') || '(card)';
    }
  },
  login: {
    noun: 'password',
    resultNoun: 'Password',
    subjectLabel: 'Username',
    subjectValueText(model) {
      return model && model.username != null && model.username !== '' ? String(model.username) : '(no username)';
    }
  },
  identity: {
    resultNoun: 'Details',
    subjectLabel: 'Fields',
    heading(model) {
      const mode = model && model.mode === 'update' ? 'update' : 'save';
      if (mode === 'save') return 'Save your details?';
      const changed = Array.isArray(model && model.changedFields) ? model.changedFields : [];
      return changed.length > 0 ? 'Update your saved details?' : 'Add to your saved details?';
    },
    // Field LABELS only (DD6) — a conflict names BOTH groups.
    subjectValueText(model) {
      const added = Array.isArray(model && model.addedFields) ? model.addedFields : [];
      const changed = Array.isArray(model && model.changedFields) ? model.changedFields : [];
      const parts = [];
      if (added.length) parts.push(added.join(', '));
      if (changed.length) parts.push(changed.join(', '));
      return parts.join(' · ') || '(no fields)';
    }
  }
};

/**
 * Resolve a capture model's family. An absent or unrecognised `kind` (including
 * `undefined`, `null`, or any string not in KIND_TABLE) resolves to `login` —
 * the exact fallback the prior `model.kind === 'card'` check implied.
 * @param {{ kind?: string }} model
 * @returns {'card'|'login'|'identity'}
 */
function kindOf(model) {
  const kind = model && model.kind;
  const known = typeof kind === 'string' && Object.prototype.hasOwnProperty.call(KIND_TABLE, kind);
  const knownKind = /** @type {'card'|'login'|'identity'} */ (kind);
  return known ? knownKind : 'login';
}

/**
 * Build the save-prompt card shell (built once per init by save-prompt.js; the per-offer content
 * is filled by renderVaultCaptureCard). NON-MODAL (Sortie 06): the card IS the root - no
 * backdrop wrapper, no `aria-modal`.
 * @param {Document} document
 * @returns {{
 *   node: HTMLElement,
 *   card: HTMLElement,
 *   timerFill: HTMLElement,
 *   heading: HTMLElement,
 *   dismissX: HTMLButtonElement,
 *   fields: HTMLElement,
 *   originValue: HTMLElement,
 *   subjectLabel: HTMLElement,
 *   usernameValue: HTMLElement,
 *   choices: HTMLElement,
 *   lockNote: HTMLElement,
 *   error: HTMLElement,
 *   counter: HTMLElement,
 *   status: HTMLElement,
 *   save: HTMLButtonElement,
 *   cancel: HTMLButtonElement,
 * }}
 */
export function buildVaultCaptureCard(document) {
  const card = document.createElement('div');
  card.id = 'save-prompt-card';
  card.className = 'new-container-inner vault-capture-inner';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-labelledby', 'save-prompt-heading');
  card.setAttribute('aria-describedby', 'save-prompt-fields');

  const timer = document.createElement('div');
  timer.className = 'save-prompt-timer';
  const timerFill = document.createElement('div');
  timerFill.className = 'save-prompt-timer-fill';
  timer.appendChild(timerFill);
  card.appendChild(timer);

  const head = document.createElement('div');
  head.className = 'save-prompt-head';
  const heading = document.createElement('div');
  heading.id = 'save-prompt-heading';
  heading.className = 'vault-capture-heading';
  head.appendChild(heading);
  const dismissX = /** @type {HTMLButtonElement} */ (document.createElement('button'));
  dismissX.type = 'button';
  dismissX.className = 'save-prompt-close';
  dismissX.setAttribute('aria-label', 'Dismiss');
  dismissX.textContent = '\u2715';
  head.appendChild(dismissX);
  card.appendChild(head);

  const fields = document.createElement('div');
  fields.id = 'save-prompt-fields';
  fields.className = 'vault-capture-fields';
  card.appendChild(fields);
  const originValue = makeField(document, fields, 'Site').value;
  // The second row is Username for a login and Card for a payment card (issue #152),
  // so its LABEL is re-rendered per offer alongside its value.
  const { label: subjectLabel, value: usernameValue } = makeField(document, fields, 'Username');

  const choices = document.createElement('div');
  choices.className = 'vault-capture-choices';
  choices.setAttribute('role', 'radiogroup');
  choices.setAttribute('aria-label', 'Choose a vault');
  card.appendChild(choices);

  // Locked offers (Sortie 06 Leg 2): the note under the choices; hidden for every unlocked offer.
  const lockNote = document.createElement('div');
  lockNote.className = 'save-prompt-lock-note hidden';
  card.appendChild(lockNote);

  const error = document.createElement('div');
  error.className = 'vault-capture-error';
  error.setAttribute('aria-live', 'polite');
  error.textContent = '';
  card.appendChild(error);

  const actions = document.createElement('div');
  actions.className = 'new-container-actions';
  const save = /** @type {HTMLButtonElement} */ (document.createElement('button'));
  save.className = 'text-btn primary vault-sheet-btn';
  save.type = 'button';
  save.textContent = 'Save';
  const cancel = /** @type {HTMLButtonElement} */ (document.createElement('button'));
  cancel.className = 'text-btn vault-sheet-btn';
  cancel.type = 'button';
  cancel.textContent = 'Not now';
  const counter = document.createElement('span');
  counter.className = 'save-prompt-counter';
  actions.appendChild(counter);
  actions.appendChild(cancel);
  actions.appendChild(save);
  card.appendChild(actions);

  // Result states (saved / expired / ...) render here, in the same view.
  const status = document.createElement('div');
  status.className = 'save-prompt-status';
  status.setAttribute('role', 'status');
  status.classList.add('hidden');
  card.appendChild(status);

  return {
    node: card,
    card,
    timerFill,
    heading,
    dismissX,
    fields,
    originValue,
    subjectLabel,
    usernameValue,
    choices,
    lockNote,
    error,
    counter,
    status,
    save,
    cancel
  };
}

/** The locked-offer note (Sortie 06 Leg 2). */
export const LOCK_NOTE = 'Your vault is locked. You will enter your master password to save.';

/**
 * The noun a success result uses ("Password saved to ...", "Card saved to ...", "Details saved
 * to ..."), resolved through KIND_TABLE. @param {{ kind?: string }} model
 * @returns {string}
 */
export function resultNounOf(model) {
  return KIND_TABLE[kindOf(model)].resultNoun;
}

/**
 * Sortie 06 Leg 3 (DD3/R9): the screen-reader announcement for a freshly presented OFFER, built
 * from KIND_TABLE nouns and the origin HOST only (never a username, vault label or field value).
 * `withHint` appends "Press F6 to respond." - the chrome's polite region carries it; the prompt's
 * own status node omits it (the prompt is already in reach). Result-only models announce nothing.
 * @param {any} model
 * @param {{ withHint?: boolean }} [opts]
 * @returns {string | null}
 */
export function savePromptAnnouncement(model, { withHint = false } = {}) {
  if (!model || typeof model !== 'object' || typeof model.result === 'string') return null;
  /** @type {string} */
  let host;
  try {
    host = new URL(String(model.origin)).host;
  } catch {
    host = '';
  }
  const where = host ? ` for ${host}` : '';
  const kind = kindOf(model);
  const update = model.mode === 'update';
  let lead;
  if (kind === 'identity') {
    const changed = Array.isArray(model.changedFields) ? model.changedFields : [];
    if (!update) lead = 'Save your details';
    else lead = changed.length > 0 ? 'Update your saved details' : 'Add to your identity';
  } else {
    lead = `${update ? 'Update' : 'Save'} ${KIND_TABLE[kind].noun}`;
  }
  return `${lead}${where}?${withHint ? ' Press F6 to respond.' : ''}`;
}

/**
 * A labeled read-only field row ("<label>: <value>"). Returns both spans so a caller
 * can re-render the label per offer (the login/card subject row).
 * @param {Document} document
 * @param {HTMLElement} card
 * @param {string} labelText
 * @returns {{ label: HTMLElement, value: HTMLElement }}
 */
function makeField(document, card, labelText) {
  const row = document.createElement('div');
  row.className = 'vault-capture-field';
  const label = document.createElement('span');
  label.className = 'vault-capture-field-label';
  label.textContent = labelText;
  const value = document.createElement('span');
  value.className = 'vault-capture-field-value';
  row.appendChild(label);
  row.appendChild(value);
  card.appendChild(row);
  return { label, value };
}

/**
 * Render the per-offer content into a built card: the Save/Update heading, the origin
 * + username, and — for a `save` only — a vault radio choice (default the model's
 * defaultVaultId; "Global" selectable). An `update` renders NO choice (the item's
 * vault is fixed). Clears the error line. Returns the choice radio inputs in order
 * (empty for `update`) so the caller can read the selection.
 * @param {Document} document
 * @param {ReturnType<typeof buildVaultCaptureCard>} refs
 * @param {{ origin?: string, username?: string|null, mode?: string, defaultVaultId?: string, choices?: Array<string | { vaultId: string, label?: string, disabled?: boolean }>, kind?: string, brand?: string|null, last4?: string|null, addedFields?: string[], changedFields?: string[] }} model
 * @returns {{ mode: 'save'|'update', choiceInputs: HTMLInputElement[] }}
 */
export function renderVaultCaptureCard(document, refs, model) {
  const mode = model && model.mode === 'update' ? 'update' : 'save';
  // A LOCKED offer (Sortie 06 Leg 2) renders like a save (heading, vault choices) with the lock
  // note and an "Unlock & save" primary; identity always re-asks after unlock, so it reads
  // "Unlock & review".
  const locked = !!model && model.mode === 'locked';
  // Copy is per-KIND (issue #152): "Save card?" over a payment capture, and the
  // subject row becomes Card ("Visa •••• 4242") instead of Username — resolved
  // through KIND_TABLE rather than a binary branch. A kind may supply its OWN
  // `heading(model)` (identity, AC17 — mode-dispatch WITHIN the family) instead
  // of the generic `${Save|Update} ${noun}?` construction card/login still use.
  const entry = KIND_TABLE[kindOf(model)];
  const heading =
    typeof entry.heading === 'function'
      ? entry.heading(model)
      : `${mode === 'update' ? 'Update' : 'Save'} ${entry.noun}?`;
  refs.heading.textContent = heading;
  refs.originValue.textContent = String(model && model.origin != null ? model.origin : '');
  if (refs.subjectLabel) refs.subjectLabel.textContent = entry.subjectLabel;
  refs.usernameValue.textContent = entry.subjectValueText(model);
  refs.error.textContent = '';
  refs.lockNote.classList.toggle('hidden', !locked);
  refs.lockNote.textContent = locked ? LOCK_NOTE : '';
  refs.save.textContent = locked ? (kindOf(model) === 'identity' ? 'Unlock & review' : 'Unlock & save') : 'Save';

  refs.choices.textContent = '';
  /** @type {HTMLInputElement[]} */
  const choiceInputs = [];
  if (mode === 'save') {
    refs.choices.classList.remove('hidden');
    const list = Array.isArray(model && model.choices) ? model.choices : [];
    const def = model && model.defaultVaultId;
    list.forEach((c, i) => {
      const vaultId = typeof c === 'string' ? c : c && c.vaultId;
      const labelText =
        typeof c === 'string'
          ? c === 'global'
            ? 'Global'
            : c
          : c && c.label != null && c.label !== ''
            ? c.label
            : c && c.vaultId === 'global'
              ? 'Global'
              : c && c.vaultId;

      const optLabel = document.createElement('label');
      optLabel.className = 'vault-capture-choice';
      const input = /** @type {HTMLInputElement} */ (document.createElement('input'));
      input.type = 'radio';
      input.name = 'vault-capture-choice';
      input.value = String(vaultId != null ? vaultId : '');
      input.checked = def != null ? vaultId === def : i === 0;
      // An unresolvable vault ("Unknown vault") is shown but not selectable (main still validates).
      if (c && typeof c === 'object' && c.disabled === true) {
        input.disabled = true;
        input.checked = false;
      }
      const span = document.createElement('span');
      span.textContent = String(labelText != null ? labelText : '');
      optLabel.appendChild(input);
      optLabel.appendChild(span);
      refs.choices.appendChild(optLabel);
      choiceInputs.push(input);
    });
  } else {
    refs.choices.classList.add('hidden');
  }

  return { mode, choiceInputs };
}

/**
 * The chosen vaultId from the rendered choice radios (the checked one, else the first,
 * else null). For an `update` (no choices), returns null — the caller passes the
 * model's defaultVaultId, which main ignores (it uses the record's fixed vault).
 * @param {HTMLInputElement[]} choiceInputs
 * @returns {string | null}
 */
export function selectedVaultId(choiceInputs) {
  if (!Array.isArray(choiceInputs) || !choiceInputs.length) return null;
  const checked = choiceInputs.find((i) => i.checked) || choiceInputs[0];
  return checked ? String(checked.value) : null;
}
