// goldfinch://vault serves imports through an exact flat allowlist. These
// specifiers intentionally describe serving paths rather than disk paths.
// @ts-ignore — serving-path vs disk-path mismatch
import { selectVaultView, vaultNavEntries } from './vault-page-model.js';
// @ts-ignore — serving-path vs disk-path mismatch
import { MASK, EDITOR_LAYOUT, initialSecretStates, reveal as revealState, hide as hideState, edit as editState, assembleSave, safeHttpUrl } from './vault-editor-model.js';
// @ts-ignore — serving-path vs disk-path mismatch
import { generatePassword, CLASS_NAMES } from './password-generator.js';
// @ts-ignore — serving-path vs disk-path mismatch
import { isSafeColor } from './safe-color.js';
// @ts-ignore — serving-path vs disk-path mismatch
import { createVaultNav } from './vault-nav-controller.js';

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
 * M12 F5 HAT (hat-page-sidebar) restructures the page into a master-detail nav+main matching
 * the cookie-jars page and renames it "Secrets": a TWO-LEVEL left nav (a top "Settings" entry +
 * a top "Vaults" group whose indented children are one entry per vault — Global with a globe
 * icon, each jar with its color dot) driven by the pure `vaultNavEntries` model, and a stacked,
 * scroll-spied section list. The manager-wide controls (lock/auto-lock incl. an inline "Lock now",
 * import, master-key management incl. export) live under the Settings section — buttons only; DD5
 * is preserved (no master-equivalent secret in the DOM).
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
  const navEl = /** @type {HTMLElement|null} */ (document.getElementById('vault-nav'));
  if (!root || !navEl) return;

  // Master-detail nav (M12 F5 HAT hat-page-sidebar): the jars-page rail, mirrored.
  // Built from the vault-state rows + jarsList on every refresh; the scroll-spy sets
  // aria-current on the visible section's entry.
  const nav = createVaultNav({
    document,
    Node,
    navEl,
    IntersectionObserver,
    isSafeColor,
    fallbackColor: '#9aa0ac'
  });

  // Cached jar rows (id/name/color) for the nav dots — a non-secret metadata read,
  // refreshed alongside vault state. `[]` until the first fetch resolves.
  /** @type {Array<{ id?: unknown, color?: unknown }>} */
  let jarRows = [];

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

  /**
   * A self-contained kebab (overflow) menu: a ⋮ trigger button + a popup menu of
   * actions, used to fold a subsection's action buttons off the page to cut noise
   * (operator, M12 F5 HAT). Keyboard + a11y: `aria-haspopup="menu"` / `aria-expanded`
   * on the trigger, `role="menu"`/`menuitem` on the popup, Escape closes + restores
   * focus, arrow/Home/End move between items, and it closes on outside-pointerdown or
   * a selection. The document listener is added only while open and removed on close,
   * so nothing leaks past a page re-render (which closes the menu by removing the DOM).
   * The glyph is inline SVG (three dots), not an emoji — same reason as the fill icon.
   * @param {{ ariaLabel: string, items: Array<{ label: string, onSelect: () => void }> }} opts
   * @returns {HTMLElement}
   */
  function buildKebabMenu(opts) {
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const wrap = el('div', 'vault-kebab');
    const btn = /** @type {HTMLButtonElement} */ (el('button', 'vault-kebab-btn'));
    btn.type = 'button';
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', opts.ariaLabel);

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    for (const cy of [6, 12, 18]) {
      const dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('cx', '12');
      dot.setAttribute('cy', String(cy));
      dot.setAttribute('r', '1.7');
      svg.appendChild(dot);
    }
    btn.appendChild(svg);

    const menu = el('div', 'vault-kebab-menu');
    menu.setAttribute('role', 'menu');
    menu.hidden = true;

    /** @type {HTMLButtonElement[]} */
    const itemEls = [];
    for (const item of opts.items) {
      const mi = /** @type {HTMLButtonElement} */ (el('button', 'vault-kebab-item', item.label));
      mi.type = 'button';
      mi.setAttribute('role', 'menuitem');
      mi.addEventListener('click', () => { close(); item.onSelect(); });
      menu.appendChild(mi);
      itemEls.push(mi);
    }

    /** @type {((ev: Event) => void)|null} */
    let onDocPointer = null;
    const isOpen = () => !menu.hidden;
    function open() {
      if (isOpen()) return;
      menu.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      onDocPointer = (ev) => {
        if (!wrap.contains(/** @type {Node} */ (ev.target))) close();
      };
      document.addEventListener('pointerdown', onDocPointer, true);
      if (itemEls[0]) itemEls[0].focus();
    }
    /** @param {boolean} [restoreFocus] */
    function close(restoreFocus) {
      if (!isOpen()) return;
      menu.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      if (onDocPointer) {
        document.removeEventListener('pointerdown', onDocPointer, true);
        onDocPointer = null;
      }
      if (restoreFocus) btn.focus();
    }
    btn.addEventListener('click', () => { if (isOpen()) close(); else open(); });
    wrap.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && isOpen()) { ev.preventDefault(); close(true); return; }
      if (!isOpen()) {
        if (ev.target === btn && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
          ev.preventDefault();
          open();
        }
        return;
      }
      const n = itemEls.length;
      const idx = itemEls.indexOf(/** @type {any} */ (ev.target));
      if (ev.key === 'ArrowDown') { ev.preventDefault(); itemEls[(idx + 1 + n) % n].focus(); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); itemEls[(idx - 1 + n) % n].focus(); }
      else if (ev.key === 'Home') { ev.preventDefault(); itemEls[0].focus(); }
      else if (ev.key === 'End') { ev.preventDefault(); itemEls[n - 1].focus(); }
    });

    wrap.appendChild(btn);
    wrap.appendChild(menu);
    return wrap;
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

  // Single-open enforcement (M12 F5 acceptance): each vault section now owns its own
  // INLINE editor host (so Add/Edit renders within the section that triggered it,
  // not a shared host floated to the top of the page). The old shared-host model gave
  // single-open for free — with per-section hosts we track the currently-open one and
  // clear it when an editor opens elsewhere. Reset per render (the hosts are rebuilt).
  /** @type {HTMLElement|null} */
  let activeEditorHost = null;

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

  // ── Page-level modal (M12 F5 HAT, I14) ──
  // The single reusable Import / Export dialog, built INLINE here (not a served module — vault.js
  // is well under the extraction threshold and this avoids the internal-page-map onboarding). It
  // mirrors the proven page-modal pattern in jars-confirm-modal.js: a fixed backdrop + a dialog
  // card (role="dialog" aria-modal aria-labelledby), a Tab focus-trap over the modal's focusables,
  // Escape + backdrop-click dismiss, and focus RETURN to the invoking button on close. All text via
  // textContent (strict CSP). NO master-equivalent secret ever enters this modal or the page DOM
  // (DD2/DD5) — import's source secret stays on the chrome-owned vault-import-unlock sheet.
  //
  // M5: the modal lives on document.body, so it SURVIVES a #vault-root re-render. render() calls
  // closeActivePageModal() so an idle auto-lock mid-modal (onVaultLockState → refresh) can't orphan
  // a stale unlocked-context modal. Only ONE page modal is open at a time (module-scoped ref).
  /** @type {{ close: () => void } | null} */
  let activePageModal = null;
  function closeActivePageModal() {
    if (activePageModal) activePageModal.close();
  }

  /**
   * A page-level notice surfaced on the NEXT render (M12 F5 HAT, I14). Set before a refresh() that
   * tears the page down (e.g. an export that raced an idle auto-lock → { locked }); render() shows
   * it once at the top of #vault-root then clears it. `textContent`-only.
   * @type {string|null}
   */
  let pendingNotice = null;

  /**
   * Open the single page-level modal. `body` is the caller-built content (selects, file-pick
   * controls); the shell adds the title, a status line (role="status"), and a Cancel/Submit
   * actions row. The Submit button starts disabled unless `submitEnabled` is true. Returns a handle
   * to close it, toggle Submit, and set the status line. Dismissal (Cancel / Escape / backdrop)
   * runs the optional `onCancel` (L1 held-state clear) before closing; the M5 render-triggered
   * close() does NOT (it is not an operator dismissal).
   * @param {{ title: string, body: HTMLElement, submitLabel: string, onSubmit: () => void, submitEnabled?: boolean, onCancel?: () => void }} opts
   * @returns {{ close: () => void, setSubmitEnabled: (on: boolean) => void, setStatus: (text: string) => void }}
   */
  function openModal(opts) {
    // Single page-modal at a time — close any prior one first (also removes its document.body node).
    closeActivePageModal();
    // The invoking button is document.activeElement at open time (the browser focuses a button on
    // click before its handler runs); restore focus to it on close, never stranding focus on <body>.
    const invoker = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const backdrop = el('div', 'vault-modal-backdrop');
    const card = el('div', 'vault-modal-card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    const titleId = 'vault-modal-title';
    card.setAttribute('aria-labelledby', titleId);
    const titleEl = el('h2', 'vault-modal-title', opts.title);
    titleEl.id = titleId;
    card.appendChild(titleEl);

    const bodyWrap = el('div', 'vault-modal-body');
    bodyWrap.appendChild(opts.body);
    card.appendChild(bodyWrap);

    const status = el('p', 'vault-modal-status');
    status.setAttribute('role', 'status');
    card.appendChild(status);

    const actions = el('div', 'vault-modal-actions');
    const cancelBtn = button('Cancel', 'vault-btn', () => dismiss());
    const submitBtn = button(opts.submitLabel, 'vault-btn primary', () => opts.onSubmit());
    submitBtn.disabled = opts.submitEnabled !== true;
    actions.appendChild(cancelBtn);
    actions.appendChild(submitBtn);
    card.appendChild(actions);

    backdrop.appendChild(card);
    document.body.appendChild(backdrop);

    let closed = false;
    function close() {
      if (closed) return;
      closed = true;
      backdrop.remove();
      if (activePageModal === handle) activePageModal = null;
      if (invoker && invoker.isConnected) invoker.focus();
    }
    function dismiss() {
      if (opts.onCancel) { try { opts.onCancel(); } catch { /* a cancel hook must never throw out */ } }
      close();
    }

    backdrop.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); dismiss(); return; }
      if (e.key === 'Tab') {
        const focusables = /** @type {HTMLElement[]} */ (Array.from(card.querySelectorAll(
          'button:not([disabled]), select:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href]'
        )));
        if (!focusables.length) return;
        e.preventDefault();
        const i = focusables.indexOf(/** @type {any} */ (document.activeElement));
        const n = (i + (e.shiftKey ? -1 : 1) + focusables.length) % focusables.length;
        focusables[n].focus();
      }
    });
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) dismiss(); });

    const handle = {
      close,
      setSubmitEnabled: (/** @type {boolean} */ on) => { submitBtn.disabled = !on; },
      setStatus: (/** @type {string} */ text) => { status.textContent = text; },
    };
    activePageModal = handle;

    // Default focus: the first focusable in the body (a select), else Cancel — never <body>.
    const firstBody = bodyWrap.querySelector('button, select, input, textarea');
    if (firstBody instanceof HTMLElement) firstBody.focus();
    else cancelBtn.focus();

    return handle;
  }

  /**
   * Build a source/destination vault `<select>` for a modal — global + each persistent jar, the
   * same options the old export/import selects built. `textContent`-only.
   * @param {Array<{ vaultId: string, label: string }>} vaults
   * @param {string} ariaLabel
   * @returns {HTMLSelectElement}
   */
  function buildVaultSelect(vaults, ariaLabel) {
    const select = /** @type {HTMLSelectElement} */ (el('select', 'vault-settings-select'));
    select.setAttribute('aria-label', ariaLabel);
    for (const v of vaults) {
      const opt = /** @type {HTMLOptionElement} */ (el('option', undefined, v.label));
      opt.value = v.vaultId;
      select.appendChild(opt);
    }
    return select;
  }

  /**
   * The Export modal (M12 F5 HAT, I14). Body: a SOURCE-vault select, a "Choose location…" button +
   * a path display, driven off the modal's status line. Export (submit) is DISABLED until a save
   * location is chosen. "Choose location…" runs `pickSavePath` (main-side save dialog ONLY, no
   * write) — export binds source→path at submit, so changing the source after choosing a location
   * is fine (no held main-side state). Submit runs `exportVault(target, savePath)` fully main-side
   * (ciphertext-only bundle; never transits the page). L2: a { locked } (idle-lock race) closes the
   * modal, refreshes the page, and surfaces a brief notice; a write error shows on the status line —
   * neither is silently swallowed. { ok } closes the modal.
   * @param {Array<{ vaultId: string, label: string }>} vaults
   */
  function openExportModal(vaults) {
    /** @type {string|null} */
    let savePath = null;
    const body = el('div', 'vault-modal-form');

    const field = el('label', 'vault-settings-field');
    field.appendChild(el('span', 'vault-settings-label', 'Vault'));
    const select = buildVaultSelect(vaults, 'Export source vault');
    field.appendChild(select);
    body.appendChild(field);

    const fileRow = el('div', 'vault-modal-file-row');
    const pathDisplay = el('span', 'vault-modal-path');
    fileRow.appendChild(button('Choose location…', 'vault-btn', () => {
      Promise.resolve(bridge.pickSavePath(select.value)).then((res) => {
        if (res && res.path) {
          savePath = res.path;
          pathDisplay.textContent = res.path;
          handle.setSubmitEnabled(true);
        }
      }).catch(() => {});
    }));
    fileRow.appendChild(pathDisplay);
    body.appendChild(fileRow);

    const handle = openModal({
      title: 'Export a vault',
      body,
      submitLabel: 'Export',
      submitEnabled: false,
      onSubmit: () => {
        if (!savePath) return;
        handle.setSubmitEnabled(false);
        handle.setStatus('Exporting…');
        Promise.resolve(bridge.exportVault(select.value, savePath)).then((res) => {
          if (res && res.locked) {
            pendingNotice = 'The manager locked — export canceled. Unlock and try again.';
            handle.close();
            refresh();
            return;
          }
          if (res && res.ok) { handle.close(); return; }
          if (res && res.canceled) { handle.setStatus('Export canceled.'); handle.setSubmitEnabled(true); return; }
          handle.setStatus('Could not export the vault.'); handle.setSubmitEnabled(true);
        }).catch(() => { handle.setStatus('Could not export the vault.'); handle.setSubmitEnabled(true); });
      },
    });
  }

  /**
   * The Import modal (M12 F5 HAT, I14). Body: a DESTINATION-vault select, a "Choose file…" button +
   * a path display. Continue (submit) is DISABLED until a bundle is picked FOR the currently-shown
   * destination. "Choose file…" runs `pickImportFile(destination)` — main opens + reads + HOLDS the
   * bundle for that destination and returns { ok, path } | { canceled } | { error }. NO secret is
   * entered here: Continue runs `beginImportUnlock()`, forwarding to the chrome-owned
   * vault-import-unlock sheet where the held bundle is consumed with the source master password /
   * recovery key (DD2/DD5).
   *
   * H1: the held _pendingVaultImport.destinationTarget is bound at pick time. If the operator
   * changes the destination select AFTER a successful pick, invalidate it — clear the path, drop the
   * held bundle (clearPendingImport), disable Continue, and require a re-pick — so the held
   * destination can never drift from the one the modal shows.
   *
   * L1: on dismiss (Cancel / Escape / backdrop) after a pick, drop the held bundle via
   * clearPendingImport so an abandoned import never lingers.
   * @param {Array<{ vaultId: string, label: string }>} vaults
   */
  function openImportModal(vaults) {
    let picked = false;
    const body = el('div', 'vault-modal-form');

    const field = el('label', 'vault-settings-field');
    field.appendChild(el('span', 'vault-settings-label', 'Vault'));
    const select = buildVaultSelect(vaults, 'Import destination vault');
    field.appendChild(select);
    body.appendChild(field);

    const fileRow = el('div', 'vault-modal-file-row');
    const pathDisplay = el('span', 'vault-modal-path');
    fileRow.appendChild(button('Choose file…', 'vault-btn', () => {
      Promise.resolve(bridge.pickImportFile(select.value)).then((res) => {
        if (res && res.ok) {
          picked = true;
          pathDisplay.textContent = res.path || '';
          handle.setStatus('');
          handle.setSubmitEnabled(true);
        } else if (res && res.error) {
          picked = false;
          pathDisplay.textContent = '';
          handle.setStatus('Could not read that bundle file.');
          handle.setSubmitEnabled(false);
        }
        // { canceled } → do nothing (keep any prior pick).
      }).catch(() => {});
    }));
    fileRow.appendChild(pathDisplay);
    body.appendChild(fileRow);

    // H1: a destination change after a successful pick invalidates the held bundle.
    select.addEventListener('change', () => {
      if (!picked) return;
      picked = false;
      pathDisplay.textContent = '';
      handle.setStatus('');
      handle.setSubmitEnabled(false);
      Promise.resolve(bridge.clearPendingImport()).catch(() => {});
    });

    const handle = openModal({
      title: 'Import a vault',
      body,
      submitLabel: 'Continue',
      submitEnabled: false,
      onSubmit: () => {
        if (!picked) return;
        Promise.resolve(bridge.beginImportUnlock()).catch(() => {});
        handle.close();
      },
      onCancel: () => {
        // L1: drop any held bundle when the operator dismisses the modal.
        if (picked) Promise.resolve(bridge.clearPendingImport()).catch(() => {});
      },
    });
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

  // ── Settings section (M12 F5 HAT hat-page-sidebar) ──
  // The top "Settings" nav entry's section groups the manager-wide controls under one
  // heading with subsections: lock/unlock, auto-lock, import, and master-key management.
  // These RELOCATE the existing sheet-triggering wiring (DD5: buttons only — every
  // master-equivalent secret still lives on the chrome sheets over the Buffer channel).

  /**
   * The locked-state unlock/recover banner — extracted so the Settings section can host
   * it while locked (Unlock + the recover-after-forgotten-master affordance). NO secret
   * is entered here; both route page → main → chrome to a chrome-owned sheet.
   * @returns {HTMLElement}
   */
  function buildLockedBanner() {
    const banner = el('div', 'vault-locked-banner');
    banner.appendChild(el('p', undefined, 'Unlock the manager to view and edit items.'));
    // M12 F3 Leg 4: request the F2 chrome-owned unlock sheet (page → main → chrome). A
    // DISTINCT trigger from the guest-gesture unlock — no fill-picker continuation. The
    // page refreshes to unlocked off the vault-lock-state broadcast on success.
    banner.appendChild(button('Unlock', 'vault-btn primary', () => {
      root.dataset.unlockRequested = 'true';
      Promise.resolve(bridge.requestUnlock()).catch(() => {});
    }));
    // M12 F4 Leg 2 (key-rotation): the RECOVER-after-forgotten-master affordance — reachable
    // FROM the LOCKED state (the recovery key is its own step-up + installs the MRK). Routes
    // to the chrome-owned vault-recover sheet; NO secret is entered here.
    banner.appendChild(button('Forgot master password? Recover', 'vault-btn vault-link-btn', () => {
      Promise.resolve(bridge.requestRecover()).catch(() => {});
    }));
    return banner;
  }

  /**
   * The "Settings" section: manager-wide controls, state-gated. While UNLOCKED: Lock now +
   * auto-lock + import + master-key management. While LOCKED: unlock/recover banner +
   * auto-lock (settingsGet works without the MRK). Carries the reserved section id
   * `vault-settings` (the nav's top entry jumps here).
   * @param {{ mode: string, vaults: Array<{ vaultId: string, label: string }> }} view
   * @returns {HTMLElement}
   */
  function buildSettingsSection(view) {
    const unlocked = view.mode === 'unlocked';
    const section = el('section', 'vault-section vault-settings-section');
    section.id = 'vault-settings';
    section.setAttribute('aria-labelledby', 'vault-settings-heading');
    const h2 = el('h2', undefined, 'Settings');
    h2.id = 'vault-settings-heading';
    section.appendChild(h2);

    if (!unlocked) {
      section.appendChild(buildLockedBanner());
    }

    // Manager-wide auto-lock — both states (a plain settings read/write; needs no MRK).
    // "Lock now" now lives INLINE beside the auto-lock dropdown (unlocked only — locking
    // is global and needs an unlocked manager), so the old top-of-Settings actions row is gone.
    section.appendChild(buildAutoLockSection(unlocked));

    if (unlocked) {
      // Import / Export — two buttons, each opening a page-level modal that selects the vault +
      // file location (import then hands off to the chrome-owned secret sheet; DD2/DD5).
      section.appendChild(buildImportExportSection(view.vaults));
      // Master-key management — change master / rotate recovery / admin rotate-provision. Each
      // routes to a chrome-owned sheet; NO master-equivalent secret here (DD5).
      section.appendChild(buildMasterKeySection());
    }
    return section;
  }

  /**
   * A per-vault section while the manager is LOCKED — heading + an unlock prompt, no items
   * (those need the MRK). Carries the section id `vault-<vaultId>` so the nav entry jumps here.
   * @param {{ id: string, label: string }} entry
   * @returns {HTMLElement}
   */
  function buildLockedVaultSection(entry) {
    const section = el('section', 'vault-section vault-child-section');
    section.id = `vault-${entry.id}`;
    section.dataset.vaultId = entry.id;
    const headingId = `vault-h-${entry.id}`;
    section.setAttribute('aria-labelledby', headingId);
    const h3 = el('h3', 'vault-section-title', entry.label);
    h3.id = headingId;
    section.appendChild(h3);
    section.appendChild(el('p', 'vault-empty', 'Unlock the manager to view this vault’s items.'));
    return section;
  }

  // The fixed auto-lock choices (minutes). Every value is a valid integer in the settings
  // validator's [1, 1440] range, so a write never rejects for range.
  const AUTOLOCK_OPTIONS = [1, 2, 5, 10, 15];
  const AUTOLOCK_DEFAULT = 10;

  /**
   * Snap an arbitrary stored minutes value to the nearest offered option (ties → the smaller
   * option, since the options list is ascending and the first strictly-smaller diff wins). A
   * non-number / non-finite value falls back to the default. Purely presentational — the stored
   * setting is NOT rewritten on seed; the operator's own pick persists it.
   * @param {number} value
   * @returns {number}
   */
  function nearestAutoLockOption(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return AUTOLOCK_DEFAULT;
    let best = AUTOLOCK_OPTIONS[0];
    let bestDiff = Math.abs(best - value);
    for (const opt of AUTOLOCK_OPTIONS) {
      const diff = Math.abs(opt - value);
      if (diff < bestDiff) { best = opt; bestDiff = diff; }
    }
    return best;
  }

  /**
   * The manager-wide idle auto-lock duration (M12 F3 Leg 5; dropdown per M12 F5 HAT batch).
   * A `<select>` (1/2/5/10/15 minutes) bound to the EXISTING settingsGet/settingsSet
   * ('vaultAutoLockMinutes') bridge — NO new IPC. A stored value outside the five options snaps
   * to the nearest (default 10 if absent/invalid); the write never rejects for range since every
   * option is a valid integer. A change arms the NEXT idle timer (the store re-reads
   * getAutoLockMinutes() per op; a currently-pending timer keeps the old value until the next
   * vault op — accepted). "Lock now" sits INLINE to the right (unlocked only).
   * @param {boolean} unlocked  whether the manager is unlocked (gates the inline Lock now).
   * @returns {HTMLElement}
   */
  function buildAutoLockSection(unlocked) {
    // A Settings SUBSECTION (M12 F5 HAT hat-page-sidebar): a div + h3 nested under the
    // single "Settings" heading, not its own top-level section.
    const section = el('div', 'vault-subsection vault-autolock-section');
    const h3 = el('h3', 'vault-subsection-title', 'Auto-lock');
    section.appendChild(h3);
    section.appendChild(el('p', 'vault-lede',
      'Automatically lock the manager after a period of inactivity.'));

    const row = el('div', 'vault-settings-row');
    const field = el('label', 'vault-settings-field');
    field.appendChild(el('span', 'vault-settings-label', 'Auto-lock after'));
    const select = /** @type {HTMLSelectElement} */ (el('select', 'vault-settings-select'));
    select.setAttribute('aria-label', 'Auto-lock after this many minutes of inactivity');
    for (const minutes of AUTOLOCK_OPTIONS) {
      const opt = /** @type {HTMLOptionElement} */
        (el('option', undefined, minutes === 1 ? '1 minute' : `${minutes} minutes`));
      opt.value = String(minutes);
      select.appendChild(opt);
    }
    field.appendChild(select);
    row.appendChild(field);

    // "Lock now" — relocated INLINE beside the auto-lock dropdown (M12 F5 HAT batch). Unlocked
    // only: locking is GLOBAL (zeroizes every vault key at once), non-destructive, and reversible
    // via unlock, so no confirm. Same wiring — the internal-vault-lock bridge call — as before;
    // the page re-renders to the locked view off the vault-lock-state broadcast the store's onLock
    // hook emits. Carries no secret.
    if (unlocked) {
      row.appendChild(button('Lock now', 'vault-btn', () => {
        Promise.resolve(bridge.lockVault()).catch(() => {});
      }));
    }
    section.appendChild(row);

    const status = el('p', 'vault-settings-status');
    status.setAttribute('role', 'status');
    section.appendChild(status);

    // Seed the selection from the existing settings bridge, snapping to the nearest option.
    Promise.resolve(bridge.settingsGet('vaultAutoLockMinutes')).then((v) => {
      select.value = String(nearestAutoLockOption(/** @type {number} */ (v)));
    }).catch(() => { select.value = String(AUTOLOCK_DEFAULT); });

    // Persist on change. Every option is in range, so a rejection is unexpected — surface it inline.
    select.addEventListener('change', () => {
      const minutes = Number(select.value);
      Promise.resolve(bridge.settingsSet('vaultAutoLockMinutes', minutes)).then(() => {
        status.textContent = 'Saved.';
      }).catch(() => {
        status.textContent = 'Could not save the auto-lock setting.';
      });
    });
    return section;
  }

  /**
   * The "Import / Export" Settings subsection (M12 F5 HAT, I14). A heading + a one-line lede + EXACTLY
   * two buttons: "Import…" and "Export…". Each opens a page-level modal that selects the vault
   * (destination for import / source for export) AND the file location, ending in a Cancel/Submit
   * combo. NO master-equivalent secret is entered on this page — import's source secret stays on the
   * chrome-owned vault-import-unlock sheet; export is ciphertext-only + fully main-side (DD2/DD5).
   * `textContent`-only.
   * @param {Array<{ vaultId: string, label: string }>} vaults
   * @returns {HTMLElement}
   */
  function buildImportExportSection(vaults) {
    const section = el('div', 'vault-subsection vault-importexport-section');
    section.appendChild(el('h3', 'vault-subsection-title', 'Import / Export'));
    section.appendChild(el('p', 'vault-lede',
      'Import a portable vault bundle, or export one to a file. You’ll pick the vault and file location in a dialog; for import you’ll enter the source master password or recovery key on a secure prompt.'));

    const row = el('div', 'vault-settings-row');
    row.appendChild(button('Import…', 'vault-btn', () => openImportModal(vaults)));
    row.appendChild(button('Export…', 'vault-btn', () => openExportModal(vaults)));
    section.appendChild(row);
    return section;
  }

  /**
   * Master-key management (M12 F5 HAT hat-page-sidebar) — a Settings SUBSECTION grouping every
   * operator-secret action: change master password, rotate recovery key, provision/rotate admin
   * key (M12 F4 Leg 2/3, DD3/DD4). Each routes page → main → chrome to a chrome-owned sheet; NO
   * master-equivalent secret is entered or shown here — every secret entry + the one-time
   * recovery/admin displays live on the sheet (DD2/DD5). Export moved to the "Import / Export"
   * subsection (M12 F5 HAT, I14). `textContent`-only.
   * @returns {HTMLElement}
   */
  function buildMasterKeySection() {
    const section = el('div', 'vault-subsection vault-masterkey-section');
    // The three operator-secret actions are folded into a kebab beside the heading to cut
    // page noise (operator, M12 F5 HAT) — each still routes page → main → chrome sheet; the
    // sheet owns every secret entry + one-time display (DD5). Change master → the
    // vault-change-master sheet; Rotate recovery → the vault-stepup sheet (new key shown once on
    // the recovery-show sheet); Provision/rotate admin (M12 F4 Leg 3, DD4) → the vault-stepup
    // sheet (mode 'rotate-admin'), which provisions from scratch or rotates + invalidates the prior key.
    const head = el('div', 'vault-subsection-head');
    head.appendChild(el('h3', 'vault-subsection-title', 'Master-key management'));
    head.appendChild(buildKebabMenu({
      ariaLabel: 'Master-key actions',
      items: [
        { label: 'Change master password', onSelect: () => { Promise.resolve(bridge.requestChangeMaster()).catch(() => {}); } },
        { label: 'Rotate recovery key', onSelect: () => { Promise.resolve(bridge.requestRotateRecovery()).catch(() => {}); } },
        { label: 'Provision / rotate admin key', onSelect: () => { Promise.resolve(bridge.requestRotateAdmin()).catch(() => {}); } }
      ]
    }));
    section.appendChild(head);
    section.appendChild(el('p', 'vault-lede',
      'Change your master password, or rotate your recovery or admin key. You’ll confirm on a secure prompt — nothing secret is typed on this page.'));
    return section;
  }

  /**
   * A per-vault section while the manager is UNLOCKED — the vault's item list + an INLINE
   * editor host, plus (jars only) its access keys. Carries the section id `vault-<vaultId>`
   * so the nav entry jumps here. Export moved to Settings > master-key management (per the
   * operator design).
   * @param {{ id: string, kind: string, label: string, count?: number }} entry
   */
  function buildVaultSection(entry) {
    const vaultId = entry.id;
    const section = el('section', 'vault-section vault-child-section');
    section.id = `vault-${vaultId}`;
    section.dataset.vaultId = vaultId;
    const headingId = `vault-h-${vaultId}`;
    section.setAttribute('aria-labelledby', headingId);

    const header = el('div', 'vault-section-head');
    const h3 = el('h3', 'vault-section-title',
      typeof entry.count === 'number' ? `${entry.label} (${entry.count})` : entry.label);
    h3.id = headingId;
    header.appendChild(h3);

    // Per-section INLINE editor host (M12 F5 acceptance): Add/Edit renders HERE, within the
    // section that triggered it — not into a shared host floated to the page top. Sits right
    // after the add-row and before the item list. Single-open across sections is enforced in
    // openEditor (which clears any other section's open host).
    const editorHost = el('div', 'vault-editor-host');
    editorHost.hidden = true;

    // Add-item control: a type picker + Add button → a blank editor in THIS section's host.
    const picker = /** @type {HTMLSelectElement} */ (el('select', 'vault-type-select'));
    picker.setAttribute('aria-label', `New item type for ${entry.label}`);
    for (const [type] of Object.entries(EDITOR_LAYOUT)) {
      const opt = /** @type {HTMLOptionElement} */ (el('option', undefined, type[0].toUpperCase() + type.slice(1)));
      opt.value = type;
      picker.appendChild(opt);
    }
    header.appendChild(picker);
    header.appendChild(button('Add', 'vault-btn', () => {
      openEditor(editorHost, { vaultId, meta: null, type: picker.value });
    }));
    section.appendChild(header);
    section.appendChild(editorHost);

    const list = el('ul', 'vault-item-list');
    list.setAttribute('role', 'list');
    list.setAttribute('aria-label', `${entry.label} items`);
    section.appendChild(list);

    // Populate the list from the metadata-only read (no secret ever).
    bridge.vaultList(vaultId).then((res) => {
      if (!res || res.locked) { refresh(); return; }
      renderItems(list, res.items || [], vaultId, editorHost);
    }).catch(() => {});

    // Access-key management (M12 F3 Leg 5): list by keyId + Mint + per-row Revoke. Access keys are
    // a JAR concept — the manager-wide Global vault has none, so it gets no access-key subsection.
    if (entry.kind === 'jar') {
      section.appendChild(buildAccessKeysSection({ vaultId, label: entry.label }));
    }

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
   * Render the full-item editor into the given section's INLINE host.
   * @param {HTMLElement} host
   * @param {{ vaultId: string, meta: any, type: string }} args
   */
  function openEditor(host, { vaultId, meta, type }) {
    runEditorCleanups(); // tear down any prior editor's live TOTP widget before reopening.
    // Single-open: if an editor is open in another section, clear its host first (the shared-host
    // model gave this for free; per-section hosts need it explicit). runEditorCleanups above has
    // already drained that editor's timers/listeners.
    if (activeEditorHost && activeEditorHost !== host) {
      activeEditorHost.textContent = '';
      activeEditorHost.hidden = true;
    }
    activeEditorHost = host;
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

    // Per-credential match-mode toggle (M12 F4 Leg 4 / DD5) — LOGIN only. Default exact;
    // opting in fills across the whole registrable domain (any subdomain) behind the
    // hardened, fail-closed matcher enforced in main. The registrable domain itself is
    // resolved main-side (the PSL is not shipped to the page), so the label is generic.
    let matchModeCheckbox = null;
    if (itemType === 'login') {
      const row = el('label', 'vault-field vault-field-toggle');
      matchModeCheckbox = /** @type {HTMLInputElement} */ (el('input'));
      matchModeCheckbox.type = 'checkbox';
      matchModeCheckbox.className = 'vault-field-toggle-input';
      matchModeCheckbox.checked = !isNew && !!(meta && meta.matchMode === 'registrable-domain');
      row.appendChild(matchModeCheckbox);
      const text = el('span', 'vault-field-toggle-text');
      text.appendChild(el('span', 'vault-field-label', 'Match any subdomain of this site'));
      text.appendChild(el('span', 'vault-field-hint',
        'Fill on any subdomain of this website’s registrable domain, not just this exact address. Off by default.'));
      row.appendChild(text);
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
      const matchMode = matchModeCheckbox && matchModeCheckbox.checked ? 'registrable-domain' : 'exact';
      const { item, unchangedSecrets } = assembleSave({
        type: itemType, id: meta && meta.id, nonSecretValues, secretStates, matchMode,
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

    // The character-class toggles are populated in row 2 below; declared up here so the
    // Generate handler in row 1 can read them (they are set before any click can fire).
    /** @type {Record<string, HTMLInputElement>} */
    const classToggles = {};

    // Row 1: Length on the left, Generate on the right — the two "actions" of the widget.
    const topRow = el('div', 'vault-gen-row');
    const lenLabel = el('label', 'vault-gen-len');
    lenLabel.appendChild(el('span', 'vault-gen-len-label', 'Length'));
    const lenInput = /** @type {HTMLInputElement} */ (el('input', 'vault-gen-len-input'));
    lenInput.type = 'number';
    lenInput.min = '1';
    lenInput.max = '128';
    lenInput.value = '20';
    lenLabel.appendChild(lenInput);
    topRow.appendChild(lenLabel);

    const status = el('span', 'vault-gen-status');
    status.setAttribute('role', 'status');

    topRow.appendChild(button('Generate', 'vault-btn small', () => {
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
    gen.appendChild(topRow);

    // Row 2: the character-class toggles, grouped on one line so the four checkboxes read
    // as a single "include" control rather than four loose boxes wrapping among buttons.
    const classRow = el('div', 'vault-gen-classes');
    classRow.appendChild(el('span', 'vault-gen-classes-label', 'Include'));
    const CLASS_LABELS = { lower: 'a-z', upper: 'A-Z', digits: '0-9', symbols: '!@#' };
    for (const cls of CLASS_NAMES) {
      const wrap = el('label', 'vault-gen-class');
      const cb = /** @type {HTMLInputElement} */ (el('input'));
      cb.type = 'checkbox';
      cb.checked = true;
      classToggles[cls] = cb;
      wrap.appendChild(cb);
      wrap.appendChild(el('span', undefined, CLASS_LABELS[cls] || cls));
      classRow.appendChild(wrap);
    }
    gen.appendChild(classRow);
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
    if (activeEditorHost === host) activeEditorHost = null;
  }

  /**
   * The "Vaults" group header section (M12 F5 HAT batch). A short top-level section that titles
   * the group of per-vault subsections that follow it as siblings — the nav's "Vaults" parent
   * entry jumps here. Carries the reserved section id `vault-vaults`.
   * @returns {HTMLElement}
   */
  function buildVaultsGroupSection() {
    const section = el('section', 'vault-section vault-vaults-section');
    section.id = 'vault-vaults';
    section.setAttribute('aria-labelledby', 'vault-vaults-heading');
    const h2 = el('h2', undefined, 'Vaults');
    h2.id = 'vault-vaults-heading';
    section.appendChild(h2);
    section.appendChild(el('p', 'vault-lede', 'Manage the items stored in each vault.'));
    return section;
  }

  /**
   * Render the nav+main master-detail (M12 F5 HAT hat-page-sidebar): a TWO-LEVEL left nav
   * (a top "Settings" entry + a top "Vaults" group with one indented child per vault) driven by
   * the pure entry model, and a stacked section list in #vault-root that the nav scroll-spies
   * (Settings, the Vaults header, then each per-vault subsection — all siblings so the scroll-spy
   * resolves the topmost-visible one unambiguously). not-set-up short-circuits to the setup CTA
   * with an empty nav (there are no vaults yet).
   * @param {{ setUp?: unknown, unlocked?: unknown, vaults?: unknown }} state
   */
  function render(state) {
    runEditorCleanups(); // clearing #vault-root orphans any live TOTP widget's timers.
    activeEditorHost = null; // the per-section hosts are rebuilt below; drop the stale reference.
    accessKeyRefreshers = []; // clearing #vault-root drops the prior sections' refreshers.
    // M5: an Import/Export modal lives on document.body (not #vault-root) so it survives this
    // re-render. Close it here — otherwise an idle auto-lock mid-modal fires onVaultLockState →
    // refresh → render and would strand a stale unlocked-context modal over the now-locked page.
    closeActivePageModal();
    const view = selectVaultView(state);
    root.textContent = '';
    root.dataset.mode = view.mode;

    // A pending page notice (e.g. an export that raced an idle auto-lock → { locked }): show it once
    // at the top of #vault-root, then clear it so it does not persist across later renders.
    if (pendingNotice) {
      const notice = el('p', 'vault-page-notice', pendingNotice);
      notice.setAttribute('role', 'status');
      root.appendChild(notice);
      pendingNotice = null;
    }

    if (view.mode === 'not-set-up') {
      nav.render([]);
      nav.observe([]);
      root.appendChild(buildNotSetUp());
      return;
    }

    const entries = vaultNavEntries(view.vaults, jarRows);
    nav.render(entries);

    // Settings section first.
    root.appendChild(buildSettingsSection(view));

    // The Vaults group header, then one subsection per vault (the group entry's children).
    // Each unlocked vault section builds its OWN inline editor host (M12 F5 acceptance).
    root.appendChild(buildVaultsGroupSection());
    const group = entries.find((e) => e.kind === 'group');
    for (const child of (group && group.children) || []) {
      if (view.mode === 'unlocked') root.appendChild(buildVaultSection(child));
      else root.appendChild(buildLockedVaultSection(child));
    }

    // Scroll-spy over every rendered section (Settings + Vaults header + per-vault) → aria-current.
    const sectionEls = Array.from(root.children).filter(
      (child) => child instanceof HTMLElement && child.id.startsWith('vault-')
    );
    nav.observe(/** @type {HTMLElement[]} */ (sectionEls));
    if (entries.length) nav.setActive(nav.sectionIdFor(entries[0].id));
  }

  /**
   * Fetch the current vault state + jar rows (for the nav dots) and render. Both are
   * non-secret metadata reads; jarsList works regardless of vault lock state.
   */
  function refresh() {
    if (!window.goldfinchInternal) return;
    Promise.all([
      window.goldfinchInternal.vaultState(),
      Promise.resolve(window.goldfinchInternal.jarsList()).catch(() => [])
    ]).then(([state, jars]) => {
      jarRows = Array.isArray(jars) ? jars : [];
      render(state);
    }).catch(() => {});
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

  // Tear down the nav's scroll-spy observer on unload (mirrors jars.js's jarsNav.destroy()).
  window.addEventListener('pagehide', () => nav.destroy(), { once: true });

  refresh();
}

init();
