// goldfinch://vault serves imports through an exact flat allowlist. These
// specifiers intentionally describe serving paths rather than disk paths.
// @ts-ignore — serving-path vs disk-path mismatch
import { selectVaultView } from './vault-page-model.js';
// @ts-ignore — serving-path vs disk-path mismatch
import { MASK, EDITOR_LAYOUT, initialSecretStates, reveal as revealState, hide as hideState, edit as editState, assembleSave, safeHttpUrl } from './vault-editor-model.js';
// @ts-ignore — serving-path vs disk-path mismatch
import { generatePassword, CLASS_NAMES } from './password-generator.js';

/**
 * vault.js — the goldfinch://vault internal page controller (M12 Flight 3).
 *
 * Leg 1 landed the three-state shell (not-set-up / locked / unlocked). Leg 2 adds
 * item CRUD to the UNLOCKED state: a metadata-only item list per vault, a full-item
 * editor (login/card/note) that keeps secrets MASKED until an explicit per-field
 * reveal, preserves unrevealed secrets on save via the out-of-band unchangedSecrets
 * signal, and delete + reveal + copy. Leg 3 completes the TOTP story — enroll via
 * the totp secret field (normalized to the canonical otpauth:// string in main) plus
 * a LIVE code widget (code + local countdown, computed in main, seed stays in main) —
 * and adds a pure password generator (DD7) to the login password field.
 *
 * CSP: served as a same-origin subresource under default-src 'self' (no
 * 'unsafe-inline'). NO inline event handlers; NO dynamic <script>/<style> injection.
 *
 * SECURITY (flight DD6/edge-cases):
 *  - ALL DOM text is set via `textContent`, NEVER `innerHTML` — the list/editor
 *    render attacker-influenced item strings (titles/usernames/origins); textContent
 *    + the strict CSP are the load-bearing XSS mitigations.
 *  - No plaintext secret enters the DOM until an explicit reveal; a revealed secret is
 *    cleared from the DOM + re-masked on hide, on blur (of a pure reveal), and on save.
 *  - An `origin` rendered as a link is scheme-validated http/https first (a
 *    `javascript:` origin executes when set as an href even without innerHTML).
 */

function init() {
  // The bridge exists only on the genuine goldfinch://vault origin.
  const bridge = window.goldfinchInternal;
  if (!bridge) return;

  const root = /** @type {HTMLElement|null} */ (document.getElementById('vault-root'));
  if (!root) return;

  /**
   * Create an element with a className and text set via textContent (never
   * innerHTML — see the SECURITY note above).
   * @param {string} tag
   * @param {string} [className]
   * @param {string} [text]
   * @returns {HTMLElement}
   */
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  /**
   * @param {string} label
   * @param {string} className
   * @param {() => void} onClick
   * @returns {HTMLButtonElement}
   */
  function button(label, className, onClick) {
    const b = /** @type {HTMLButtonElement} */ (el('button', className, label));
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  // Editor-scoped teardown (M12 F3 Leg 3): the live TOTP widget arms timers +
  // document/window listeners that MUST be torn down when the editor closes or the
  // page re-renders — otherwise a per-period `vaultTotpCode` poll (a full-vault
  // decrypt each call) outlives the closed editor. Every widget registers its
  // cleanup here; the single choke points below (openEditor / closeEditor / render)
  // drain it.
  /** @type {Array<() => void>} */
  let editorCleanups = [];
  function runEditorCleanups() {
    const fns = editorCleanups;
    editorCleanups = [];
    for (const fn of fns) {
      try { fn(); } catch { /* a cleanup must never throw out of teardown */ }
    }
  }

  // Access-key list refreshers (M12 F3 Leg 5). Each unlocked vault section registers a
  // cheap re-fetch of its access-key list here (a metadata-only read — envelope keyIds, no
  // item decrypt). A single window-focus listener (below) drains them so the list refreshes
  // when the operator returns from the chrome-owned mint sheet (the minted secret is shown on
  // the sheet, never here — there is no page-side mint-complete callback). Reset per render.
  /** @type {Array<() => void>} */
  let accessKeyRefreshers = [];
  function refreshAccessKeyLists() {
    for (const fn of accessKeyRefreshers) {
      try { fn(); } catch { /* a refresh must never throw */ }
    }
  }

  // ── not-set-up + locked states (leg 1 shell; setup/unlock flows land in leg 4) ──

  function buildNotSetUp() {
    const section = el('section', 'vault-section');
    section.setAttribute('aria-labelledby', 'vault-setup-heading');
    const h2 = el('h2', undefined, 'Set up the password manager');
    h2.id = 'vault-setup-heading';
    section.appendChild(h2);
    section.appendChild(el('p', 'vault-lede',
      'Choose a master password to start storing logins, cards, and notes in an encrypted vault.'));

    const note = el('p', 'vault-stub-note');
    note.setAttribute('role', 'status');
    section.appendChild(button('Set up the password manager', 'vault-btn primary', () => {
      // M12 F3 Leg 4: request the chrome-owned setup sheet (page → main → chrome → the
      // vault-set card). NO password is entered here — it lives only on the sheet + in
      // main; the page moves to unlocked off the vault-lock-state broadcast on success.
      root.dataset.setupRequested = 'true';
      Promise.resolve(bridge.requestSetup()).catch(() => {});
    }));
    section.appendChild(note);
    return section;
  }

  /**
   * @param {Array<{ vaultId: string, label: string, count?: number }>} vaults
   */
  function buildLocked(vaults) {
    const section = el('section', 'vault-section');
    section.setAttribute('aria-labelledby', 'vault-locked-heading');
    const h2 = el('h2', undefined, 'Vault locked');
    h2.id = 'vault-locked-heading';
    section.appendChild(h2);

    const banner = el('div', 'vault-locked-banner');
    banner.appendChild(el('p', undefined, 'Unlock the manager to view and edit items.'));
    const note = el('p', 'vault-stub-note');
    note.setAttribute('role', 'status');
    banner.appendChild(button('Unlock', 'vault-btn primary', () => {
      // M12 F3 Leg 4: request the F2 chrome-owned unlock sheet (page → main → chrome). A
      // DISTINCT trigger from the guest-gesture unlock — no fill-picker continuation. The
      // page refreshes to unlocked off the vault-lock-state broadcast on success.
      root.dataset.unlockRequested = 'true';
      Promise.resolve(bridge.requestUnlock()).catch(() => {});
    }));
    section.appendChild(banner);
    section.appendChild(note);

    // Labels only while locked — no counts, no items (those need the MRK).
    const ul = el('ul', 'vault-list');
    ul.setAttribute('role', 'list');
    ul.setAttribute('aria-label', 'Vaults');
    for (const v of vaults) {
      const li = el('li', 'vault-row');
      li.dataset.vaultId = v.vaultId;
      li.appendChild(el('span', 'vault-name', v.label));
      ul.appendChild(li);
    }
    section.appendChild(vaults.length ? ul : el('p', 'vault-empty', 'No vaults yet.'));
    return section;
  }

  // ── unlocked state: item list + editor ──

  /**
   * @param {Array<{ vaultId: string, label: string, count?: number }>} vaults
   */
  function buildUnlocked(vaults) {
    const wrap = el('div', 'vault-unlocked');

    // Manager-wide auto-lock setting (M12 F3 Leg 5) — once, above the per-vault sections.
    wrap.appendChild(buildAutoLockSection());

    // A single editor host reused by every vault section; hidden until opened.
    const editorHost = el('div', 'vault-editor-host');
    editorHost.hidden = true;
    wrap.appendChild(editorHost);

    for (const v of vaults) {
      wrap.appendChild(buildVaultSection(v, editorHost));
    }
    return wrap;
  }

  /**
   * The manager-wide idle auto-lock duration (M12 F3 Leg 5). A number input (1–1440) bound
   * to the EXISTING settingsGet/settingsSet('vaultAutoLockMinutes') bridge — NO new IPC. An
   * out-of-range / non-integer write throws the settings validator's TypeError → the invoke
   * rejects → surfaced inline. A change arms the NEXT idle timer (the store re-reads
   * getAutoLockMinutes() per op; a currently-pending timer keeps the old value until the next
   * vault op — accepted).
   * @returns {HTMLElement}
   */
  function buildAutoLockSection() {
    const section = el('section', 'vault-section vault-autolock-section');
    section.setAttribute('aria-labelledby', 'vault-autolock-heading');
    const h2 = el('h2', undefined, 'Auto-lock');
    h2.id = 'vault-autolock-heading';
    section.appendChild(h2);
    section.appendChild(el('p', 'vault-lede',
      'Automatically lock the manager after this many minutes of inactivity (1–1440).'));

    const row = el('label', 'vault-autolock-row');
    row.appendChild(el('span', 'vault-autolock-label', 'Minutes'));
    const input = /** @type {HTMLInputElement} */ (el('input', 'vault-autolock-input'));
    input.type = 'number';
    input.min = '1';
    input.max = '1440';
    input.step = '1';
    row.appendChild(input);
    section.appendChild(row);

    const status = el('p', 'vault-autolock-status');
    status.setAttribute('role', 'status');
    section.appendChild(status);

    // Seed the current value from the existing settings bridge.
    Promise.resolve(bridge.settingsGet('vaultAutoLockMinutes')).then((v) => {
      if (typeof v === 'number') input.value = String(v);
    }).catch(() => {});

    // Persist on change; surface the validator's out-of-range/non-integer rejection.
    input.addEventListener('change', () => {
      const minutes = Number(input.value);
      Promise.resolve(bridge.settingsSet('vaultAutoLockMinutes', minutes)).then(() => {
        status.textContent = 'Saved.';
      }).catch(() => {
        status.textContent = 'Enter a whole number of minutes between 1 and 1440.';
      });
    });
    return section;
  }

  /**
   * @param {{ vaultId: string, label: string, count?: number }} v
   * @param {HTMLElement} editorHost
   */
  function buildVaultSection(v, editorHost) {
    const section = el('section', 'vault-section');
    section.dataset.vaultId = v.vaultId;
    const headingId = `vault-h-${v.vaultId}`;
    section.setAttribute('aria-labelledby', headingId);

    const header = el('div', 'vault-section-head');
    const h2 = el('h2', undefined,
      typeof v.count === 'number' ? `${v.label} (${v.count})` : v.label);
    h2.id = headingId;
    header.appendChild(h2);

    // Add-item control: a type picker + Add button → a blank editor.
    const picker = /** @type {HTMLSelectElement} */ (el('select', 'vault-type-select'));
    picker.setAttribute('aria-label', `New item type for ${v.label}`);
    for (const [type] of Object.entries(EDITOR_LAYOUT)) {
      const opt = /** @type {HTMLOptionElement} */ (el('option', undefined, type[0].toUpperCase() + type.slice(1)));
      opt.value = type;
      picker.appendChild(opt);
    }
    header.appendChild(picker);
    header.appendChild(button('Add', 'vault-btn', () => {
      openEditor(editorHost, { vaultId: v.vaultId, meta: null, type: picker.value });
    }));
    section.appendChild(header);

    const list = el('ul', 'vault-item-list');
    list.setAttribute('role', 'list');
    list.setAttribute('aria-label', `${v.label} items`);
    section.appendChild(list);

    // Populate the list from the metadata-only read (no secret ever).
    bridge.vaultList(v.vaultId).then((res) => {
      if (!res || res.locked) { refresh(); return; }
      renderItems(list, res.items || [], v.vaultId, editorHost);
    }).catch(() => {});

    // Access-key management (M12 F3 Leg 5): list by keyId + Mint + per-row Revoke.
    section.appendChild(buildAccessKeysSection(v));

    return section;
  }

  /**
   * Per-vault access-key management (M12 F3 Leg 5, flight DD5). Lists the vault's access-key
   * grants by keyId ONLY (no secret — grep AC), with a Mint control (routes to the chrome-
   * owned step-up sheet — the master password + the minted secret never touch this page) and
   * a per-row Revoke (immediate). Registers a cheap list refresher for the window-focus drain
   * so a mint completed on the sheet reflects on return.
   * @param {{ vaultId: string, label: string }} v
   * @returns {HTMLElement}
   */
  function buildAccessKeysSection(v) {
    const akSection = el('section', 'vault-accesskeys');
    const headingId = `vault-ak-h-${v.vaultId}`;
    akSection.setAttribute('aria-labelledby', headingId);

    const head = el('div', 'vault-accesskeys-head');
    const h3 = el('h3', 'vault-accesskeys-title', 'Access keys');
    h3.id = headingId;
    head.appendChild(h3);
    // Mint → the chrome-owned vault-stepup sheet (page → main → chrome). NO secret is entered
    // or shown here; the minted secret appears only on the chrome-owned accesskey-show sheet.
    head.appendChild(button('Mint access key', 'vault-btn', () => {
      Promise.resolve(bridge.requestMint(v.vaultId)).catch(() => {});
    }));
    akSection.appendChild(head);

    const list = el('ul', 'vault-accesskey-list');
    list.setAttribute('role', 'list');
    list.setAttribute('aria-label', `${v.label} access keys`);
    akSection.appendChild(list);

    function refreshKeys() {
      Promise.resolve(bridge.vaultAccessKeys(v.vaultId)).then((res) => {
        if (!res || res.locked) { refresh(); return; }
        renderAccessKeys(list, res.keys || [], v.vaultId, refreshKeys);
      }).catch(() => {});
    }
    accessKeyRefreshers.push(refreshKeys);
    refreshKeys();
    return akSection;
  }

  /**
   * Render a vault's access-key rows (keyId + Revoke). keyId via textContent only (a
   * plaintext envelope fingerprint — no secret). Revoke is immediate; the list re-fetches.
   * @param {HTMLElement} list
   * @param {Array<{ keyId: string }>} keys
   * @param {string} vaultId
   * @param {() => void} refreshKeys
   */
  function renderAccessKeys(list, keys, vaultId, refreshKeys) {
    list.textContent = '';
    if (!keys.length) {
      list.appendChild(el('li', 'vault-empty', 'No access keys.'));
      return;
    }
    for (const k of keys) {
      const li = el('li', 'vault-accesskey-row');
      li.dataset.keyId = k.keyId;
      li.appendChild(el('span', 'vault-accesskey-id', k.keyId));
      li.appendChild(button('Revoke', 'vault-btn danger small', () => {
        Promise.resolve(bridge.vaultAccessKeyRevoke({ vaultId, keyId: k.keyId })).then((res) => {
          if (!res || res.locked) { refresh(); return; }
          refreshKeys();
        }).catch(() => {});
      }));
      list.appendChild(li);
    }
  }

  /**
   * @param {HTMLElement} list
   * @param {Array<any>} items
   * @param {string} vaultId
   * @param {HTMLElement} editorHost
   */
  function renderItems(list, items, vaultId, editorHost) {
    list.textContent = '';
    if (!items.length) {
      list.appendChild(el('li', 'vault-empty', 'No items yet.'));
      return;
    }
    for (const meta of items) {
      const li = el('li', 'vault-item-row');
      li.dataset.itemId = meta.id;

      const openBtn = /** @type {HTMLButtonElement} */ (el('button', 'vault-item-open'));
      openBtn.type = 'button';
      openBtn.appendChild(el('span', 'vault-item-title', meta.title || '(untitled)'));
      openBtn.appendChild(el('span', 'vault-item-type', meta.type));
      const sub = meta.type === 'login'
        ? (meta.username || '')
        : (meta.type === 'card' ? (meta.last4 ? `•••• ${meta.last4}` : '') : '');
      if (sub) openBtn.appendChild(el('span', 'vault-item-sub', sub));
      openBtn.addEventListener('click', () => {
        openEditor(editorHost, { vaultId, meta, type: meta.type });
      });
      li.appendChild(openBtn);

      // The origin is an attacker-influenced string: render it as a link ONLY when
      // its scheme is http/https (a `javascript:` href executes even without
      // innerHTML); otherwise render it as inert text. Kept OUTSIDE the open button
      // (an anchor must not nest inside a button).
      if (meta.type === 'login' && meta.origin) {
        const href = safeHttpUrl(meta.origin);
        if (href) {
          const a = /** @type {HTMLAnchorElement} */ (el('a', 'vault-item-origin', meta.origin));
          a.href = href;
          a.rel = 'noreferrer noopener';
          a.target = '_blank';
          li.appendChild(a);
        } else {
          li.appendChild(el('span', 'vault-item-origin', meta.origin));
        }
      }
      list.appendChild(li);
    }
  }

  /**
   * Render the full-item editor into the shared host.
   * @param {HTMLElement} host
   * @param {{ vaultId: string, meta: any, type: string }} args
   */
  function openEditor(host, { vaultId, meta, type }) {
    runEditorCleanups(); // tear down any prior editor's live TOTP widget before reopening.
    const isNew = !meta;
    const itemType = isNew ? type : meta.type;
    const layout = EDITOR_LAYOUT[itemType];
    if (!layout) return;

    // Live secret-field state (mask/reveal/edit) keyed by field name.
    const secretStates = initialSecretStates(itemType, isNew);
    /** @type {Record<string, HTMLInputElement|HTMLTextAreaElement>} */
    const secretInputs = {};
    /** @type {Record<string, HTMLInputElement>} */
    const nonSecretInputs = {};

    host.textContent = '';
    host.hidden = false;

    const form = /** @type {HTMLFormElement} */ (el('form', 'vault-editor'));
    form.setAttribute('aria-label', isNew ? `New ${itemType}` : `Edit ${itemType}`);
    form.addEventListener('submit', (e) => e.preventDefault());

    form.appendChild(el('h3', 'vault-editor-title', isNew ? `New ${itemType}` : `Edit ${itemType}`));

    // Non-secret fields (from metadata; blank for a new item).
    for (const spec of layout.nonSecret) {
      const row = el('label', 'vault-field');
      row.appendChild(el('span', 'vault-field-label', spec.label));
      const input = /** @type {HTMLInputElement} */ (el('input', 'vault-input'));
      input.type = 'text';
      input.value = isNew ? '' : (meta[spec.name] == null ? '' : String(meta[spec.name]));
      nonSecretInputs[spec.name] = input;
      row.appendChild(input);
      form.appendChild(row);
    }

    // Secret fields (masked; per-field reveal + copy on an existing item).
    const hasTotp = !isNew && itemType === 'login' && !!(meta && meta.hasTotp);
    for (const spec of layout.secret) {
      form.appendChild(buildSecretField(spec, { vaultId, isNew, itemId: meta && meta.id, secretStates, secretInputs, hasTotp }));
    }

    // Actions.
    const actions = el('div', 'vault-editor-actions');
    const status = el('p', 'vault-editor-status');
    status.setAttribute('role', 'status');

    actions.appendChild(button('Save', 'vault-btn primary', () => {
      const nonSecretValues = {};
      for (const [name, input] of Object.entries(nonSecretInputs)) nonSecretValues[name] = input.value;
      const { item, unchangedSecrets } = assembleSave({
        type: itemType, id: meta && meta.id, nonSecretValues, secretStates,
      });
      wipeSecretInputs(secretInputs); // clear-on-save DOM hygiene
      bridge.vaultItemSave({ vaultId, item, unchangedSecrets }).then((res) => {
        if (!res || res.locked) { refresh(); return; }
        closeEditor(host);
        refresh();
      }).catch(() => { status.textContent = 'Could not save.'; });
    }));

    if (!isNew) {
      actions.appendChild(button('Delete', 'vault-btn danger', () => {
        bridge.vaultItemDelete({ vaultId, itemId: meta.id }).then((res) => {
          if (!res || res.locked) { refresh(); return; }
          closeEditor(host);
          refresh();
        }).catch(() => { status.textContent = 'Could not delete.'; });
      }));
    }

    actions.appendChild(button('Cancel', 'vault-btn', () => {
      wipeSecretInputs(secretInputs);
      closeEditor(host);
    }));

    form.appendChild(actions);
    form.appendChild(status);
    host.appendChild(form);
    host.scrollIntoView({ block: 'nearest' });
    const firstInput = form.querySelector('input, textarea');
    if (firstInput) /** @type {HTMLElement} */ (firstInput).focus();
  }

  /**
   * Build one secret field row: a masked input plus (for an existing item) Reveal
   * and Copy buttons. Editing/typing marks the field touched; a pure reveal is
   * cleared on hide/blur/save.
   * @param {{ name: string, label: string, multiline?: boolean }} spec
   * @param {{ vaultId: string, isNew: boolean, itemId?: string, secretStates: any, secretInputs: any, hasTotp?: boolean }} ctx
   */
  function buildSecretField(spec, ctx) {
    const { name, label, multiline } = spec;
    const row = el('div', 'vault-field vault-field-secret');
    const lab = el('label', 'vault-field-label', label);
    row.appendChild(lab);

    const input = /** @type {HTMLInputElement|HTMLTextAreaElement} */
      (el(multiline ? 'textarea' : 'input', 'vault-input'));
    if (!multiline) /** @type {HTMLInputElement} */ (input).type = 'text';
    // Masked-until-reveal for an existing item: empty value, MASK placeholder.
    input.value = '';
    if (!ctx.isNew) input.setAttribute('placeholder', MASK);
    ctx.secretInputs[name] = input;

    // Programmatic value sets (reveal) must NOT be read as a user edit.
    let revealing = false;
    input.addEventListener('input', () => {
      if (revealing) return;
      ctx.secretStates[name] = editState(ctx.secretStates[name], input.value);
    });
    input.addEventListener('blur', () => {
      const st = ctx.secretStates[name];
      // Clear a PURE reveal (shown but not edited) on blur; keep in-progress edits.
      if (st.revealed && !st.touched) {
        ctx.secretStates[name] = hideState(st);
        revealing = true; input.value = ''; revealing = false;
        setRevealLabel();
      }
    });

    row.appendChild(input);

    /** @type {HTMLButtonElement|null} */
    let revealBtn = null;
    function setRevealLabel() {
      if (revealBtn) revealBtn.textContent = ctx.secretStates[name].revealed ? 'Hide' : 'Reveal';
    }

    if (!ctx.isNew) {
      const controls = el('div', 'vault-field-controls');
      revealBtn = button('Reveal', 'vault-btn small', () => {
        const st = ctx.secretStates[name];
        if (st.revealed) {
          // Hide → clear plaintext from the DOM + re-mask.
          ctx.secretStates[name] = hideState(st);
          revealing = true; input.value = ''; revealing = false;
        } else {
          bridge.vaultReveal({ vaultId: ctx.vaultId, itemId: ctx.itemId }).then((res) => {
            if (!res || res.locked) { refresh(); return; }
            const secret = res.item ? (res.item[name] == null ? '' : String(res.item[name])) : '';
            ctx.secretStates[name] = revealState(ctx.secretStates[name], secret);
            revealing = true; input.value = secret; revealing = false;
            setRevealLabel();
          }).catch(() => {});
          return;
        }
        setRevealLabel();
      });
      controls.appendChild(revealBtn);

      // Copy fetches the current stored secret and writes it to the OS clipboard
      // WITHOUT putting it in the DOM (reuses the existing clipboard:write sink).
      controls.appendChild(button('Copy', 'vault-btn small', () => {
        bridge.vaultReveal({ vaultId: ctx.vaultId, itemId: ctx.itemId }).then((res) => {
          if (!res || res.locked) { refresh(); return; }
          const secret = res.item ? (res.item[name] == null ? '' : String(res.item[name])) : '';
          bridge.clipboardWrite(secret);
        }).catch(() => {});
      }));
      row.appendChild(controls);
    }

    // A secret field may carry extra affordances BELOW its input row: the password
    // field gets a Generate control; an existing login's totp field gets a live code
    // widget. Both live outside the grid row (a fragment groups them).
    const frag = document.createDocumentFragment();
    frag.appendChild(row);

    if (name === 'password') {
      // A programmatic `input.value` set fires no input event, so the generated
      // value is not re-read as a user edit; afterSet only refreshes the reveal
      // label (the field is now revealed + touched via the editState in the control).
      frag.appendChild(buildGeneratorControls(input, ctx.secretStates, name, setRevealLabel));
    }

    if (name === 'totp' && !ctx.isNew && ctx.hasTotp && ctx.itemId) {
      frag.appendChild(buildTotpWidget(ctx.vaultId, ctx.itemId));
    }

    return frag;
  }

  /**
   * A password Generate control: length + per-class toggles + a Generate button.
   * On generate it writes a fresh password into `input` and marks the field TOUCHED
   * (so it is sent verbatim on save). `textContent`-only; pure `generatePassword`.
   * @param {HTMLInputElement|HTMLTextAreaElement} input  the password input.
   * @param {Record<string, any>} secretStates
   * @param {string} name  the field name ('password').
   * @param {() => void} afterSet  invoked after the value is written (relabel hook).
   * @returns {HTMLElement}
   */
  function buildGeneratorControls(input, secretStates, name, afterSet) {
    const gen = el('div', 'vault-generator');

    const lenLabel = el('label', 'vault-gen-len');
    lenLabel.appendChild(el('span', 'vault-gen-len-label', 'Length'));
    const lenInput = /** @type {HTMLInputElement} */ (el('input', 'vault-gen-len-input'));
    lenInput.type = 'number';
    lenInput.min = '1';
    lenInput.max = '128';
    lenInput.value = '20';
    lenLabel.appendChild(lenInput);
    gen.appendChild(lenLabel);

    /** @type {Record<string, HTMLInputElement>} */
    const classToggles = {};
    const CLASS_LABELS = { lower: 'a-z', upper: 'A-Z', digits: '0-9', symbols: '!@#' };
    for (const cls of CLASS_NAMES) {
      const wrap = el('label', 'vault-gen-class');
      const cb = /** @type {HTMLInputElement} */ (el('input'));
      cb.type = 'checkbox';
      cb.checked = true;
      classToggles[cls] = cb;
      wrap.appendChild(cb);
      wrap.appendChild(el('span', undefined, CLASS_LABELS[cls] || cls));
      gen.appendChild(wrap);
    }

    const status = el('span', 'vault-gen-status');
    status.setAttribute('role', 'status');

    gen.appendChild(button('Generate', 'vault-btn small', () => {
      const opts = { length: Number(lenInput.value) };
      for (const cls of CLASS_NAMES) opts[cls] = classToggles[cls].checked;
      let generated;
      try {
        generated = generatePassword(opts);
      } catch (err) {
        status.textContent = /** @type {Error} */ (err).message.replace(/^password-generator:\s*/, '');
        return;
      }
      status.textContent = '';
      input.value = generated;
      // Programmatic set: reflect it as a real user edit so save sends it verbatim.
      secretStates[name] = editState(secretStates[name], generated);
      afterSet();
    }));
    gen.appendChild(status);
    return gen;
  }

  /**
   * A live TOTP code widget (M12 F3 Leg 3 / DD4): fetches `vaultTotpCode` (code +
   * seconds-remaining computed in main — the seed never reaches the page), COUNTS
   * DOWN LOCALLY each second, and RE-FETCHES only on the period boundary (a full
   * decrypt per call, so per-period keeps decrypts to ~1/period). Polling stops on
   * page hide / window blur and resumes on show / focus. `textContent`-only. The
   * widget registers its teardown with the editor-cleanup registry.
   * @param {string} vaultId
   * @param {string} itemId
   * @returns {HTMLElement}
   */
  function buildTotpWidget(vaultId, itemId) {
    const wrap = el('div', 'vault-totp-widget');
    wrap.appendChild(el('span', 'vault-totp-label', 'One-time code'));
    const codeEl = el('span', 'vault-totp-code', '••••••');
    const countEl = el('span', 'vault-totp-count', '');
    wrap.appendChild(codeEl);
    wrap.appendChild(countEl);

    let stopped = false;
    let secondsRemaining = 0;
    /** @type {any} */
    let timer = null;

    function clearTimer() {
      if (timer !== null) { clearTimeout(timer); timer = null; }
    }

    function tick() {
      if (stopped) return;
      countEl.textContent = `${secondsRemaining}s`;
      clearTimer();
      if (secondsRemaining <= 0) { fetchCode(); return; } // period boundary → re-fetch.
      timer = setTimeout(() => { secondsRemaining -= 1; tick(); }, 1000);
    }

    function fetchCode() {
      if (stopped || !window.goldfinchInternal) return;
      window.goldfinchInternal.vaultTotpCode({ vaultId, itemId }).then((res) => {
        if (stopped) return;
        if (!res || res.locked) { refresh(); return; } // idle-lock mid-poll → unlock path.
        if (res.code == null) { codeEl.textContent = '—'; countEl.textContent = ''; return; }
        codeEl.textContent = res.code;
        secondsRemaining = typeof res.secondsRemaining === 'number' ? res.secondsRemaining : 0;
        tick();
      }).catch(() => {});
    }

    function start() {
      if (!stopped) return; // already running (stopped===false)
      stopped = false;
      fetchCode();
    }
    function stop() {
      stopped = true;
      clearTimer();
    }

    // Stop polling while the page is hidden or the window is blurred; resume on return.
    const onVisibility = () => { if (document.hidden) stop(); else start(); };
    const onBlur = () => stop();
    const onFocus = () => start();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);

    // Begin polling (start() early-returns unless stopped, so kick off directly).
    fetchCode();

    editorCleanups.push(() => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
    });

    return wrap;
  }

  /** Zero out every secret input's DOM value (clear-on-save/cancel hygiene). */
  function wipeSecretInputs(secretInputs) {
    for (const input of Object.values(secretInputs)) {
      /** @type {HTMLInputElement} */ (input).value = '';
    }
  }

  /** @param {HTMLElement} host */
  function closeEditor(host) {
    runEditorCleanups();
    host.textContent = '';
    host.hidden = true;
  }

  /**
   * Render exactly one state region from the page view.
   * @param {{ setUp?: unknown, unlocked?: unknown, vaults?: unknown }} state
   */
  function render(state) {
    runEditorCleanups(); // clearing #vault-root orphans any live TOTP widget's timers.
    accessKeyRefreshers = []; // clearing #vault-root drops the prior sections' refreshers.
    const view = selectVaultView(state);
    root.textContent = '';
    root.dataset.mode = view.mode;
    if (view.mode === 'not-set-up') {
      root.appendChild(buildNotSetUp());
    } else if (view.mode === 'locked') {
      root.appendChild(buildLocked(/** @type {any} */ (view.vaults)));
    } else {
      root.appendChild(buildUnlocked(/** @type {any} */ (view.vaults)));
    }
  }

  /** Fetch the current vault state and render. */
  function refresh() {
    if (!window.goldfinchInternal) return;
    window.goldfinchInternal.vaultState().then(render).catch(() => {});
  }

  // M12 F3 Leg 4: refresh on every vault lock-state transition (setup / unlock / auto-lock)
  // so the page moves not-set-up → locked → unlocked without a manual reload. The payload
  // is a NON-SECRET projection; the page always re-queries its full state (labels only).
  // Cleaned up on pagehide (the internal-page listener-handle pattern — otherwise each
  // guest reload leaks an ipcRenderer listener).
  const lockStateHandle = bridge.onVaultLockState(() => refresh());
  window.addEventListener('pagehide', () => bridge.offVaultLockState(lockStateHandle), { once: true });

  // M12 F3 Leg 5: re-fetch every unlocked vault's access-key list when the window regains
  // focus — the operator has just returned from the chrome-owned mint sheet (there is no
  // page-side mint-complete callback; the minted secret is shown only on the sheet). Cheap
  // (metadata-only reads); a no-op while not-set-up / locked (no refreshers registered).
  window.addEventListener('focus', refreshAccessKeyLists);
  window.addEventListener('pagehide', () => window.removeEventListener('focus', refreshAccessKeyLists), { once: true });

  refresh();
}

init();
