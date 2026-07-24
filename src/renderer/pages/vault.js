// goldfinch://vault serves imports through an exact flat allowlist. These
// specifiers intentionally describe serving paths rather than disk paths.
// @ts-ignore — serving-path vs disk-path mismatch
import { selectVaultView, vaultNavEntries } from './vault-page-model.js';
// @ts-ignore — serving-path vs disk-path mismatch
import { MASK, EDITOR_LAYOUT, initialSecretStates, reveal as revealState, hide as hideState, edit as editState, assembleSave, partitionItemsByType, safeHttpUrl } from './vault-editor-model.js';
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

  // Inline-SVG icon path sets (stroke-based, 24x24 viewBox) for the row/section icon buttons —
  // no emoji (the guest tofu lesson; matches the nav-controller icon convention).
  /** @type {Record<string, string[]>} */
  const ICON_PATHS = {
    add: ['M12 5v14', 'M5 12h14'],
    edit: ['M12 20h9', 'M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z'],
    trash: ['M3 6h18', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2', 'M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14', 'M10 11v6', 'M14 11v6'],
    eye: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
    'eye-off': ['M17.9 17.9A10.4 10.4 0 0 1 12 20c-7 0-10-8-10-8a18.8 18.8 0 0 1 5.1-6M9.9 4.2A9.5 9.5 0 0 1 12 4c7 0 10 8 10 8a18.9 18.9 0 0 1-2.2 3.2m-6.7-1.1a3 3 0 0 1-4.2-4.2', 'M2 2l20 20'],
    copy: ['M9 9h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V11a2 2 0 0 1 2-2z', 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'],
    // Open-folder — the file-uploader row's "browse" affordance (M12 F5 HAT tail): opens the
    // native dialog (pickImportFile / pickSavePath) and populates the path field.
    folder: ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
  };

  const SVG_NS = 'http://www.w3.org/2000/svg';

  // The manager-wide global vault id (vault-store.js's GLOBAL_ID). Used ONLY as the fixed target
  // threaded into pickImportFile from the fresh-profile import modal (M12 F5 HAT,
  // hat-fresh-profile-import): the store's fresh-adopt branch ignores the target and writes GLOBAL_ID
  // unconditionally, but vaultImportBeginFromFile's guard requires a non-empty string. The literal
  // is used (not an import) to avoid threading the main-only sentinel module into this page-served
  // module — the same rationale vault-page-model.js records for keeping GLOBAL_ID off the page side.
  const GLOBAL_VAULT_ID = 'global';

  /**
   * Build an inline-SVG glyph (stroke=currentColor, aria-hidden) from an ICON_PATHS key.
   * @param {string} iconKey
   * @returns {SVGSVGElement}
   */
  function buildIconSvg(iconKey) {
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
    for (const d of ICON_PATHS[iconKey]) {
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', d);
      svg.appendChild(p);
    }
    return svg;
  }

  /**
   * Build a square ICON button: an inline-SVG glyph whose accessible name comes from `ariaLabel`
   * (the icon replaces the visible text). `danger` tints it destructive.
   * @param {string} iconKey
   * @param {string} ariaLabel
   * @param {() => void} onClick
   * @param {{ danger?: boolean }} [opts]
   * @returns {HTMLButtonElement}
   */
  function iconButton(iconKey, ariaLabel, onClick, opts) {
    const b = /** @type {HTMLButtonElement} */
      (el('button', 'vault-icon-btn' + (opts && opts.danger ? ' danger' : '')));
    b.type = 'button';
    b.setAttribute('aria-label', ariaLabel);
    b.title = ariaLabel;
    b.appendChild(buildIconSvg(iconKey));
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

  // Editor-scoped teardown (M12 F3 Leg 3; extended for the modal editor, M12 F5 HAT
  // hat-vault-item-organization): the live TOTP widget arms timers + document/window listeners,
  // AND (DD6) the editor registers a secret-input WIPE here — both MUST be torn down on every
  // editor-modal exit or page re-render, otherwise a per-period `vaultTotpCode` poll (a full-vault
  // decrypt each call) outlives the closed editor and/or a revealed secret survives in a detached
  // input. Every widget/editor registers its cleanup here; the choke points below drain it:
  // openEditor (before openModal preempts a prior editor), the modal's onSubmit/onCancel (before
  // handle.close(), which drains NOTHING), and render() (before closeActivePageModal on idle-lock).
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
   * A `danger` submit renders the primary action in the destructive (red) style — used by
   * the delete/revoke confirm modals; it defaults to the accent "primary" style otherwise.
   * @param {{ title: string, body: HTMLElement, submitLabel: string, onSubmit: () => void, submitEnabled?: boolean, onCancel?: () => void, danger?: boolean }} opts
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
    const submitBtn = button(opts.submitLabel, opts.danger ? 'vault-btn danger' : 'vault-btn primary', () => opts.onSubmit());
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
   * The Export modal (M12 F5 HAT, I14; file-uploader row + validated pasteable path M12 F5 HAT
   * tail). Body: a SOURCE-vault select, then a file-uploader ROW — a text input showing the save
   * path + an open-folder icon button that runs `pickSavePath` (main-side save dialog ONLY, no
   * write) and populates the field. The field is EDITABLE/PASTEABLE (operator ask — the path looks
   * like a real uploader); the actual write is gated MAIN-SIDE by validateExportPath (canonical
   * extension + existing writable parent, not a directory), so a typed path can never be a
   * write-anywhere primitive (review HIGH-2). Export (submit) is DISABLED until the field is
   * non-empty. Submit runs `exportVault(target, savePath)` fully main-side (ciphertext-only bundle;
   * never transits the page). L2: a { locked } (idle-lock race) closes the modal, refreshes, and
   * surfaces a brief notice; an invalid-path / write error shows on the status line — none is
   * silently swallowed. { ok } closes the modal.
   * @param {Array<{ vaultId: string, label: string }>} vaults
   */
  function openExportModal(vaults) {
    const body = el('div', 'vault-modal-form');

    const field = el('label', 'vault-settings-field');
    field.appendChild(el('span', 'vault-settings-label', 'Vault'));
    const select = buildVaultSelect(vaults, 'Export source vault');
    field.appendChild(select);
    body.appendChild(field);

    // File-uploader row: a pasteable path input + an open-folder icon button (native save dialog).
    const fileRow = el('div', 'vault-modal-file-row');
    const pathInput = /** @type {HTMLInputElement} */ (el('input', 'vault-modal-path-input'));
    pathInput.type = 'text';
    pathInput.placeholder = 'Choose or type a .gfvaultbundle path';
    pathInput.setAttribute('aria-label', 'Export file location');
    pathInput.addEventListener('input', () => {
      handle.setStatus('');
      handle.setSubmitEnabled(pathInput.value.trim().length > 0);
    });
    fileRow.appendChild(pathInput);
    fileRow.appendChild(iconButton('folder', 'Choose a save location', () => {
      Promise.resolve(bridge.pickSavePath(select.value)).then((res) => {
        if (res && res.path) {
          pathInput.value = res.path;
          handle.setStatus('');
          handle.setSubmitEnabled(true);
        }
      }).catch(() => {});
    }));
    body.appendChild(fileRow);

    const handle = openModal({
      title: 'Export a vault',
      body,
      submitLabel: 'Export',
      submitEnabled: false,
      onSubmit: () => {
        const savePath = pathInput.value.trim();
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
          if (res && res.error === 'invalid-path') {
            handle.setStatus('That location can’t be used. Pick a .gfvaultbundle or .json path in an existing folder.');
            handle.setSubmitEnabled(true);
            return;
          }
          if (res && res.canceled) { handle.setStatus('Export canceled.'); handle.setSubmitEnabled(true); return; }
          handle.setStatus('Could not export the vault.'); handle.setSubmitEnabled(true);
        }).catch(() => { handle.setStatus('Could not export the vault.'); handle.setSubmitEnabled(true); });
      },
    });
  }

  /**
   * The Import modal (M12 F5 HAT, I14; file-uploader row + Replace-existing confirm M12 F5 HAT
   * tail). Body: a DESTINATION-vault select, a file-uploader ROW (a READ-ONLY path field showing
   * the dialog-picked path + an open-folder icon button), and a Replace-existing affordance shown
   * ONLY when the destination already holds a vault.
   *
   * The bundle READ stays DIALOG-BOUND: the folder button runs `pickImportFile(destination)` — main
   * opens + reads + HOLDS the bundle for that destination (main reads filePaths[0]) and returns
   * { ok, path } | { canceled } | { error }. The path field is READ-ONLY (it only DISPLAYS the
   * dialog path) so a typed/pasted path can never drive main's read — no arbitrary-read oracle
   * (review HIGH-2/3). NO secret is entered here: Continue runs `beginImportUnlock(overwrite)`,
   * forwarding to the chrome-owned vault-import-unlock sheet where the held bundle is consumed with
   * the source master password / recovery key (DD2/DD5).
   *
   * REPLACE-EXISTING (review HIGH-1 / MEDIUM-3): on open + on every destination change we probe
   * `hasVault(dest)`. When the destination already holds a vault, importing REPLACES (destroys) it,
   * so a REQUIRED "Replace the existing vault" checkbox appears and Continue stays disabled until it
   * is checked. No checkbox is shown for an empty destination. `overwrite` is bound at the Continue
   * step from the checkbox's FINAL state — never silently, never at file-pick.
   *
   * H1: the held _pendingVaultImport.destinationTarget is bound at pick time. A destination change
   * AFTER a successful pick invalidates it — clear the path, drop the held bundle
   * (clearPendingImport), reset the Replace checkbox, disable Continue, re-probe, force a re-pick.
   *
   * L1: on dismiss (Cancel / Escape / backdrop) after a pick, drop the held bundle via
   * clearPendingImport so an abandoned import never lingers.
   *
   * FRESH-PROFILE MODE (M12 F5 HAT, hat-fresh-profile-import): when `opts.fresh` is true the
   * modal is opened from the NOT-SET-UP page to reach the store's fresh-adopt branch
   * (vault-store.js:823-841) — the marquee cross-machine restore. On a fresh profile there is NO
   * destination vault (view.vaults is empty) and the fresh branch IGNORES the destination (writes
   * GLOBAL_ID unconditionally — no collision, no overwrite). So fresh mode OMITS the destination
   * select, the hasVault probe, AND the Replace checkbox; it shows a restore-oriented lede and
   * threads the fixed GLOBAL_ID target into pickImportFile (vaultImportBeginFromFile's guard needs a
   * non-empty string; the fresh branch discards it) with overwrite=false. The read stays
   * dialog-bound and NO secret enters the page — Continue hands off to the SAME chrome-owned
   * vault-import-unlock sheet, which already offers the master-password OR recovery-key choice
   * (DD2/DD5). On a successful adopt the store leaves the profile set-up + UNLOCKED and broadcasts
   * the lock-state, so the existing onVaultLockState → refresh path re-renders not-set-up → unlocked
   * (no extra page wiring here). Default (opts omitted / fresh falsy) = today's set-up behavior.
   * @param {Array<{ vaultId: string, label: string }>} vaults  Destination options (empty when fresh).
   * @param {{ fresh?: boolean }} [opts]
   */
  function openImportModal(vaults, opts) {
    const fresh = !!(opts && opts.fresh);
    let picked = false;
    let importHandle = null;      // opaque per-transaction token from pickImportFile (PR#112 finding 5)
    let collision = false;        // the current destination already holds a vault (never in fresh mode)
    let replaceConfirmed = false; // the "Replace the existing vault" checkbox state (unused in fresh mode)
    const body = el('div', 'vault-modal-form');

    // Fresh mode: a restore lede in place of a destination select — there is no destination on a
    // not-set-up profile and the fresh-adopt branch ignores the target entirely.
    if (fresh) {
      body.appendChild(el('p', 'vault-lede',
        'Restore a vault exported from another device. You’ll enter its master password or recovery key on a secure prompt.'));
    }

    // Destination-vault select — set-up profiles only (a fresh profile has no destination vault).
    const field = el('label', 'vault-settings-field');
    field.appendChild(el('span', 'vault-settings-label', 'Vault'));
    const select = buildVaultSelect(vaults, 'Import destination vault');
    field.appendChild(select);
    if (!fresh) body.appendChild(field);

    // File-uploader row: a READ-ONLY path field (dialog-picked path, display only) + folder button.
    const fileRow = el('div', 'vault-modal-file-row');
    const pathInput = /** @type {HTMLInputElement} */ (el('input', 'vault-modal-path-input'));
    pathInput.type = 'text';
    pathInput.readOnly = true;
    pathInput.placeholder = 'No file chosen';
    pathInput.setAttribute('aria-label', 'Selected bundle file');
    fileRow.appendChild(pathInput);
    fileRow.appendChild(iconButton('folder', 'Choose a bundle file', pickFile));
    body.appendChild(fileRow);

    // Replace-existing confirmation — set-up profiles only; shown ONLY when the destination already
    // holds a vault. A fresh profile never collides, so the affordance is omitted entirely.
    const replaceRow = el('div', 'vault-modal-replace-row');
    replaceRow.hidden = true;
    replaceRow.appendChild(el('p', 'vault-modal-warn',
      'A vault already exists here — importing will REPLACE it, permanently destroying the current vault.'));
    const replaceLabel = el('label', 'vault-modal-replace-label');
    const replaceCheckbox = /** @type {HTMLInputElement} */ (el('input'));
    replaceCheckbox.type = 'checkbox';
    replaceLabel.appendChild(replaceCheckbox);
    replaceLabel.appendChild(el('span', undefined, 'Replace the existing vault'));
    replaceRow.appendChild(replaceLabel);
    if (!fresh) body.appendChild(replaceRow);

    function updateContinueEnabled() {
      handle.setSubmitEnabled(picked && (!collision || replaceConfirmed));
    }

    replaceCheckbox.addEventListener('change', () => {
      replaceConfirmed = replaceCheckbox.checked;
      updateContinueEnabled();
    });

    // Probe whether a destination already holds a vault → show/hide the Replace affordance.
    function probeCollision(dest) {
      return Promise.resolve(bridge.hasVault(dest)).then((r) => {
        collision = !!(r && r.present);
        replaceRow.hidden = !collision;
        if (!collision) { replaceConfirmed = false; replaceCheckbox.checked = false; }
        updateContinueEnabled();
      }).catch(() => {});
    }

    // The target threaded into pickImportFile. Fresh mode has no select and the fresh branch
    // discards the target, but vaultImportBeginFromFile's guard needs a non-empty string → GLOBAL_ID.
    function pickTarget() {
      return fresh ? GLOBAL_VAULT_ID : select.value;
    }

    function pickFile() {
      Promise.resolve(bridge.pickImportFile(pickTarget())).then((res) => {
        if (res && res.ok) {
          picked = true;
          importHandle = res.importHandle || null; // finding 5: bind this transaction's token.
          pathInput.value = res.path || '';
          handle.setStatus('');
          updateContinueEnabled();
        } else if (res && res.error) {
          picked = false;
          importHandle = null;
          pathInput.value = '';
          handle.setStatus('Could not read that bundle file.');
          updateContinueEnabled();
        }
        // { canceled } → do nothing (keep any prior pick).
      }).catch(() => {});
    }

    // H1: a destination change after a successful pick invalidates the held bundle; always re-probe
    // the new destination's collision state and reset the Replace checkbox. (Set-up mode only — the
    // fresh modal has no destination select.)
    if (!fresh) {
      select.addEventListener('change', () => {
        replaceConfirmed = false;
        replaceCheckbox.checked = false;
        if (picked) {
          picked = false;
          pathInput.value = '';
          handle.setStatus('');
          Promise.resolve(bridge.clearPendingImport(importHandle)).catch(() => {});
          importHandle = null;
        }
        probeCollision(select.value);
      });
    }

    const handle = openModal({
      title: 'Import a vault',
      body,
      submitLabel: 'Continue',
      submitEnabled: false,
      onSubmit: () => {
        if (!picked || (collision && !replaceConfirmed)) return;
        // Bind overwrite from the checkbox FINAL state at Continue (review MEDIUM-3). Fresh mode
        // never collides → overwrite is always false (replaceConfirmed stays false).
        Promise.resolve(bridge.beginImportUnlock(replaceConfirmed, importHandle)).catch(() => {});
        handle.close();
      },
      onCancel: () => {
        // L1: drop any held bundle when the operator dismisses the modal.
        if (picked) Promise.resolve(bridge.clearPendingImport(importHandle)).catch(() => {});
      },
    });

    // Initial probe for the default-selected destination (set-up mode only — no destination or
    // collision on a fresh profile).
    if (!fresh) probeCollision(select.value);
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

    // The two not-set-up entry points, side by side: "Set up" stays the PRIMARY CTA; "Import a
    // vault bundle" is a SECONDARY affordance that reaches the store's fresh-adopt branch (the
    // marquee cross-machine restore — M12 F5 HAT, hat-fresh-profile-import). The import path enters
    // NO secret here: it opens the destination-less fresh-mode modal, which hands off to the
    // chrome-owned vault-import-unlock sheet (DD2/DD5). On a successful adopt the store leaves the
    // profile set-up + UNLOCKED and broadcasts the lock-state → the page re-renders to unlocked.
    const actions = el('div', 'vault-setup-actions');
    actions.appendChild(button('Set up the password manager', 'vault-btn primary', () => {
      // M12 F3 Leg 4: request the chrome-owned setup sheet (page → main → chrome → the
      // vault-set card). NO password is entered here — it lives only on the sheet + in
      // main; the page moves to unlocked off the vault-lock-state broadcast on success.
      root.dataset.setupRequested = 'true';
      Promise.resolve(bridge.requestSetup()).catch(() => {});
    }));
    actions.appendChild(button('Import a vault bundle', 'vault-btn', () => {
      // Fresh-profile restore: a destination-less import modal (no vault select, no Replace
      // checkbox) that adopts a bundle exported from another device. No destination exists yet.
      openImportModal([], { fresh: true });
    }));
    section.appendChild(actions);
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
      row.appendChild(button('Lock now', 'vault-btn primary', () => {
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

  // The typed item subsections a vault splits into (M12 F5 HAT hat-vault-item-organization).
  // Logins / Cards / Notes are the item-editor types; each renders its OWN list + an Add button
  // that opens a blank editor modal OF THAT TYPE (the old type <select> is gone — each Add knows
  // its type). Access keys is a jar-only fourth subsection, built separately (its Add mints).
  const ITEM_SUBSECTIONS = [
    { type: 'login', title: 'Logins', empty: 'No logins yet.' },
    { type: 'card', title: 'Cards', empty: 'No cards yet.' },
    { type: 'note', title: 'Notes', empty: 'No notes yet.' },
  ];

  // Fallback dot color when a jar carries no safe color — the nav-dot idiom
  // (vault-nav-controller.js: `color && isSafeColor(color) ? color : fallbackColor`).
  const TITLE_DOT_FALLBACK = '#9aa0ac';

  // The Global vault's title marker — the globe (ICON_GLOBE idiom, vault-nav-controller.js),
  // inlined here for the title row. `aria-hidden`; the heading's name span carries the label.
  function buildGlobeMarker() {
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
    svg.classList.add('vault-title-globe');
    const shapes = [
      { tag: 'circle', attrs: { cx: '12', cy: '12', r: '9' } },
      { tag: 'path', attrs: { d: 'M3 12h18' } },
      { tag: 'path', attrs: { d: 'M12 3c2.5 2.5 3.8 5.7 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.7-3.8-9S9.5 5.5 12 3Z' } }
    ];
    for (const shape of shapes) {
      const node = document.createElementNS(SVG_NS, shape.tag);
      for (const key of Object.keys(shape.attrs)) node.setAttribute(key, shape.attrs[key]);
      svg.appendChild(node);
    }
    return /** @type {any} */ (svg);
  }

  /**
   * Build one typed item subsection: a head (h4 + an Add button that opens a blank editor
   * modal OF THIS TYPE) + an empty list the caller fills after the partitioned vaultList read.
   * @param {string} vaultId
   * @param {{ type: string, title: string, empty: string }} sub
   * @returns {{ subsection: HTMLElement, list: HTMLElement }}
   */
  function buildTypeSubsection(vaultId, sub) {
    const subsection = el('section', 'vault-subsection vault-type-subsection');
    const headingId = `vault-sub-${vaultId}-${sub.type}`;
    subsection.setAttribute('aria-labelledby', headingId);
    const head = el('div', 'vault-subsection-head');
    const h4 = el('h4', 'vault-subsection-title', sub.title);
    h4.id = headingId;
    head.appendChild(h4);
    head.appendChild(iconButton('add', `Add ${sub.type}`, () => {
      openEditor({ vaultId, meta: null, type: sub.type });
    }));
    subsection.appendChild(head);

    const list = el('ul', 'vault-item-list');
    list.setAttribute('role', 'list');
    list.setAttribute('aria-label', sub.title);
    subsection.appendChild(list);
    return { subsection, list };
  }

  /**
   * The defensive "Other items" subsection — surfaces any item whose `type` the page does not
   * recognize (partitionItemsByType's `unknown` bucket) rather than silently dropping it. Hidden
   * until such an item appears.
   * @returns {{ subsection: HTMLElement, list: HTMLElement }}
   */
  function buildUnknownSubsection() {
    const subsection = el('section', 'vault-subsection vault-type-subsection vault-unknown-subsection');
    subsection.hidden = true;
    const head = el('div', 'vault-subsection-head');
    head.appendChild(el('h4', 'vault-subsection-title', 'Other items'));
    subsection.appendChild(head);
    const list = el('ul', 'vault-item-list');
    list.setAttribute('role', 'list');
    list.setAttribute('aria-label', 'Other items');
    subsection.appendChild(list);
    return { subsection, list };
  }

  /**
   * A per-vault section while the manager is UNLOCKED — a title row (jar color dot / Global
   * globe + name) + per-type item subsections (Logins / Cards / Notes) each with its own list +
   * Add, plus (jars only) an Access keys subsection. Carries the section id `vault-<vaultId>` so
   * the nav entry jumps here. ONE metadata-only vaultList read is partitioned by type client-side.
   * @param {{ id: string, kind: string, label: string, count?: number, color?: string|null }} entry
   */
  function buildVaultSection(entry) {
    const vaultId = entry.id;
    const section = el('section', 'vault-section vault-child-section');
    section.id = `vault-${vaultId}`;
    section.dataset.vaultId = vaultId;
    const headingId = `vault-h-${vaultId}`;
    section.setAttribute('aria-labelledby', headingId);

    // Title row: a jar color dot (Global: the globe icon) + the vault name. The entry carries
    // its OWN color/kind (vault-page-model.js), so there is no re-derivation from jarRows.
    const header = el('div', 'vault-section-head');
    const h3 = el('h3', 'vault-section-title vault-title-row');
    h3.id = headingId;
    if (entry.kind === 'jar') {
      const dot = el('span', 'vault-title-dot');
      dot.style.background =
        typeof entry.color === 'string' && isSafeColor(entry.color) ? entry.color : TITLE_DOT_FALLBACK;
      h3.appendChild(dot);
    } else {
      h3.appendChild(buildGlobeMarker());
    }
    h3.appendChild(el('span', 'vault-title-name', entry.label));
    header.appendChild(h3);
    section.appendChild(header);

    // Per-type subsections, built empty then populated below (DD-A: an empty subsection still
    // renders heading + empty state + Add, so Add is always reachable).
    /** @type {Record<string, HTMLElement>} */
    const lists = {};
    for (const sub of ITEM_SUBSECTIONS) {
      const built = buildTypeSubsection(vaultId, sub);
      lists[sub.type] = built.list;
      section.appendChild(built.subsection);
    }
    const unknown = buildUnknownSubsection();
    section.appendChild(unknown.subsection);

    // One metadata-only read (no secret ever), partitioned by type client-side (defensively —
    // an unknown type surfaces in "Other items", never dropped).
    bridge.vaultList(vaultId).then((res) => {
      if (!res || res.locked) { refresh(); return; }
      const buckets = partitionItemsByType(res.items || []);
      for (const sub of ITEM_SUBSECTIONS) {
        renderItems(lists[sub.type], buckets[sub.type], vaultId, sub.empty);
      }
      renderUnknownItems(unknown, buckets.unknown);
    }).catch(() => {});

    // Access-key management (M12 F3 Leg 5): a jar-only fourth subsection — Add(=Mint) + list +
    // per-row Revoke. The manager-wide Global vault has none.
    if (entry.kind === 'jar') {
      section.appendChild(buildAccessKeysSection({ vaultId, label: entry.label }));
    }

    return section;
  }

  /**
   * Render the defensive "Other items" subsection: a visible row per unknown-type item + a
   * console warning, so nothing the partition could not bucket is silently lost.
   * @param {{ subsection: HTMLElement, list: HTMLElement }} sub
   * @param {Array<any>} items
   */
  function renderUnknownItems(sub, items) {
    sub.list.textContent = '';
    if (!items || !items.length) { sub.subsection.hidden = true; return; }
    sub.subsection.hidden = false;
    for (const meta of items) {
      console.warn('vault: unknown item type surfaced, not dropped:', meta && meta.type);
      const li = el('li', 'vault-item-row');
      const info = el('div', 'vault-item-info');
      info.appendChild(el('span', 'vault-item-title', (meta && meta.title) || '(untitled)'));
      info.appendChild(el('span', 'vault-item-sub',
        `Unknown item${meta && meta.type ? ` (${meta.type})` : ''}`));
      li.appendChild(info);
      sub.list.appendChild(li);
    }
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
    // Add = Mint (DD-B label uniformity: every subsection's create control reads "Add"; the
    // aria-label stays "Mint access key" for the true action). Routes to the chrome-owned
    // vault-stepup sheet (page → main → chrome). NO secret is entered or shown here; the minted
    // secret appears only on the chrome-owned accesskey-show sheet.
    head.appendChild(iconButton('add', 'Mint access key', () => {
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
   * plaintext envelope fingerprint — no secret). Revoke now requires a confirm modal (DD-B —
   * revoking breaks live automation); on confirm the list re-fetches.
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
      li.appendChild(iconButton('trash', `Revoke access key ${k.keyId}`, () => {
        openRevokeConfirm({ vaultId, keyId: k.keyId, refreshKeys });
      }, { danger: true }));
      list.appendChild(li);
    }
  }

  /**
   * The delete-item confirm modal (DD-C: reuse openModal, a message body + a danger submit). The
   * per-row Delete opens this DIRECTLY (no editor open at the time — no modal nesting). Only on
   * confirm does it call vaultItemDelete; a { locked } race closes the modal + refreshes.
   * @param {{ vaultId: string, itemId: string, title: string }} args
   */
  function openDeleteConfirm({ vaultId, itemId, title }) {
    const body = el('div', 'vault-modal-form');
    const msg = el('p', 'vault-confirm-message');
    msg.appendChild(document.createTextNode('Permanently delete '));
    msg.appendChild(el('strong', 'vault-confirm-name', title)); // attacker-influenced → textContent
    msg.appendChild(document.createTextNode('? This can’t be undone.'));
    body.appendChild(msg);

    const handle = openModal({
      title: 'Delete item',
      body,
      submitLabel: 'Delete',
      submitEnabled: true,
      danger: true,
      onSubmit: () => {
        handle.setSubmitEnabled(false);
        Promise.resolve(bridge.vaultItemDelete({ vaultId, itemId })).then((res) => {
          if (!res || res.locked) { handle.close(); refresh(); return; }
          handle.close();
          refresh();
        }).catch(() => {
          handle.setStatus('Could not delete the item.');
          handle.setSubmitEnabled(true);
        });
      },
    });
  }

  /**
   * The revoke-access-key confirm modal (DD-B). Same shape as the delete confirm: a naming
   * message + a danger "Revoke" submit; on confirm calls vaultAccessKeyRevoke and re-fetches the
   * list (a { locked } race refreshes the page).
   * @param {{ vaultId: string, keyId: string, refreshKeys: () => void }} args
   */
  function openRevokeConfirm({ vaultId, keyId, refreshKeys }) {
    const body = el('div', 'vault-modal-form');
    const msg = el('p', 'vault-confirm-message');
    msg.appendChild(document.createTextNode('Revoke access key '));
    msg.appendChild(el('strong', 'vault-confirm-name', keyId));
    msg.appendChild(document.createTextNode('? Any automation using it will stop working.'));
    body.appendChild(msg);

    const handle = openModal({
      title: 'Revoke access key',
      body,
      submitLabel: 'Revoke',
      submitEnabled: true,
      danger: true,
      onSubmit: () => {
        handle.setSubmitEnabled(false);
        Promise.resolve(bridge.vaultAccessKeyRevoke({ vaultId, keyId })).then((res) => {
          if (!res || res.locked) { handle.close(); refresh(); return; }
          handle.close();
          refreshKeys();
        }).catch(() => {
          handle.setStatus('Could not revoke the access key.');
          handle.setSubmitEnabled(true);
        });
      },
    });
  }

  /**
   * Render ONE typed subsection's item rows (M12 F5 HAT). `items` is already partitioned to a
   * single type. Each row shows its info (title, sub, scheme-guarded origin link — all
   * textContent) plus a row-actions group: an Edit button (opens the edit modal) + a Delete
   * button (opens a confirm modal). Delete lives on the row now, OFF the editor. DD-A: an empty
   * subsection still renders its empty state (Add stays reachable in the head above).
   * @param {HTMLElement} list
   * @param {Array<any>} items
   * @param {string} vaultId
   * @param {string} emptyText
   */
  function renderItems(list, items, vaultId, emptyText) {
    list.textContent = '';
    if (!items || !items.length) {
      list.appendChild(el('li', 'vault-empty', emptyText || 'No items yet.'));
      return;
    }
    for (const meta of items) {
      const li = el('li', 'vault-item-row');
      li.dataset.itemId = meta.id;

      // Item info (textContent-only). No open-button now — Edit opens the editor modal.
      const info = el('div', 'vault-item-info');
      info.appendChild(el('span', 'vault-item-title', meta.title || '(untitled)'));
      const sub = meta.type === 'login'
        ? (meta.username || '')
        : (meta.type === 'card' ? (meta.last4 ? `•••• ${meta.last4}` : '') : '');
      if (sub) info.appendChild(el('span', 'vault-item-sub', sub));

      // The origin is an attacker-influenced string: render it as a link ONLY when its scheme
      // is http/https (a `javascript:` href executes even without innerHTML); otherwise render
      // it as inert text. Kept OUTSIDE any button (an anchor must not nest inside a button).
      if (meta.type === 'login' && meta.origin) {
        const href = safeHttpUrl(meta.origin);
        if (href) {
          const a = /** @type {HTMLAnchorElement} */ (el('a', 'vault-item-origin', meta.origin));
          a.href = href;
          a.rel = 'noreferrer noopener';
          a.target = '_blank';
          info.appendChild(a);
        } else {
          info.appendChild(el('span', 'vault-item-origin', meta.origin));
        }
      }
      li.appendChild(info);

      // Row actions: Edit + Delete sit together with NO divider (CSS). Edit opens the edit
      // modal; Delete opens a confirm modal (delete moved OFF the editor).
      const actions = el('div', 'vault-item-actions');
      actions.appendChild(iconButton('edit', `Edit ${meta.title || 'item'}`, () => {
        openEditor({ vaultId, meta, type: meta.type });
      }));
      actions.appendChild(iconButton('trash', `Delete ${meta.title || 'item'}`, () => {
        openDeleteConfirm({ vaultId, itemId: meta.id, title: meta.title || '(untitled)' });
      }, { danger: true }));
      li.appendChild(actions);

      list.appendChild(li);
    }
  }

  /**
   * Open the full-item editor AS A MODAL (M12 F5 HAT hat-vault-item-organization). The rich form
   * (non-secret fields, masked secret fields via buildSecretField, the TOTP widget, login
   * matchMode + password generator) renders in openModal's body; Save is the modal submit,
   * Cancel/Esc/backdrop the dismiss. Delete now lives on the row, NOT in the editor.
   *
   * DD6 SECURITY (design-review HIGH — trace ALL FIVE exit paths: Save-success, Cancel, Esc,
   * backdrop, idle-lock re-render). openModal's own close() drains NOTHING (no onCancel, no wipe),
   * and the idle-lock path reaches it via render()→closeActivePageModal(). So teardown is routed
   * through the `editorCleanups` REGISTRY — the same choke point render() drains BEFORE it closes
   * the modal (while it is still attached):
   *   - a `() => wipeSecretInputs(secretInputs)` cleanup is registered at build time (alongside
   *     the TOTP widget's own registered cleanup) — so every drain zeroes every secret input;
   *   - onSubmit (after a successful save) and onCancel (Esc/backdrop/Cancel) call
   *     runEditorCleanups() — draining the wipe + the TOTP poll/listeners — and then close;
   *   - the leading runEditorCleanups() below runs BEFORE openModal's preempting
   *     closeActivePageModal(), so a prior editor modal can never be detached with un-drained
   *     cleanups; render()'s existing runEditorCleanups() (before closeActivePageModal) covers
   *     the idle-lock path. handle.close() is ONLY the backdrop-removal + focus-return.
   * @param {{ vaultId: string, meta: any, type: string }} args
   */
  function openEditor({ vaultId, meta, type }) {
    // Drain any prior editor's live TOTP widget + registered secret-wipe BEFORE openModal's
    // preempting closeActivePageModal() detaches it (close() drains nothing). openModal enforces
    // single-open thereafter.
    runEditorCleanups();
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

    const form = /** @type {HTMLFormElement} */ (el('form', 'vault-editor'));
    form.setAttribute('aria-label', isNew ? `New ${itemType}` : `Edit ${itemType}`);
    // A page-nav-free submit: openModal's Save is the real action; this only stops an Enter
    // keypress in a text field from reloading the served page.
    form.addEventListener('submit', (e) => e.preventDefault());

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

    // Secret fields (masked; per-field reveal + copy on an existing item). buildTotpWidget (for an
    // existing login with a seed) pushes its own poll/listener teardown into editorCleanups.
    const hasTotp = !isNew && itemType === 'login' && !!(meta && meta.hasTotp);
    for (const spec of layout.secret) {
      form.appendChild(buildSecretField(spec, { vaultId, isNew, itemId: meta && meta.id, secretStates, secretInputs, hasTotp }));
    }

    // DD6 crux: register the secret-input WIPE into the editorCleanups registry (today it was
    // only called imperatively in Save/Cancel). Now EVERY drain — onSubmit, onCancel, AND the
    // render()/idle-lock path (which runs runEditorCleanups() while the modal is still attached,
    // before closeActivePageModal()) — zeroes the inputs.
    editorCleanups.push(() => wipeSecretInputs(secretInputs));

    const handle = openModal({
      title: isNew ? `New ${itemType}` : `Edit ${itemType}`,
      body: form,
      submitLabel: 'Save',
      submitEnabled: true,
      onSubmit: () => {
        const nonSecretValues = {};
        for (const [name, input] of Object.entries(nonSecretInputs)) nonSecretValues[name] = input.value;
        const matchMode = matchModeCheckbox && matchModeCheckbox.checked ? 'registrable-domain' : 'exact';
        const { item, unchangedSecrets } = assembleSave({
          type: itemType, id: meta && meta.id, nonSecretValues, secretStates, matchMode,
        });
        // Synchronous pre-roundtrip wipe (shrinks the reveal window) — IN ADDITION to the
        // registered cleanup drained just below on success.
        wipeSecretInputs(secretInputs);
        Promise.resolve(bridge.vaultItemSave({ vaultId, item, unchangedSecrets })).then((res) => {
          if (!res || res.locked) { runEditorCleanups(); handle.close(); refresh(); return; }
          runEditorCleanups(); // drain the registered wipe + TOTP teardown BEFORE close.
          handle.close();
          refresh();
        }).catch(() => { handle.setStatus('Could not save.'); });
      },
      onCancel: () => {
        // Esc / backdrop / Cancel: drain the registry (the registered wipe zeroes every secret
        // input; the TOTP cleanup stops the poll + removes its listeners) BEFORE openModal closes.
        runEditorCleanups();
      },
    });
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

    // The input + its in-field controls share a relative wrapper so Reveal/Copy overlay the
    // input's right edge and surface on hover / keyboard focus (CSS :hover / :focus-within).
    const wrap = el('div', 'vault-secret-wrap' + (multiline ? ' multiline' : ''));
    wrap.appendChild(input);

    /** @type {HTMLButtonElement|null} */
    let revealBtn = null;
    // Toggle the reveal button's GLYPH (eye ↔ eye-off) + its accessible name/tooltip. Named
    // setRevealLabel because buildGeneratorControls passes it as the post-generate relabel hook.
    function setRevealLabel() {
      if (!revealBtn) return;
      const revealed = ctx.secretStates[name].revealed;
      revealBtn.replaceChildren(buildIconSvg(revealed ? 'eye-off' : 'eye'));
      const lbl = revealed ? 'Hide' : 'Reveal';
      revealBtn.setAttribute('aria-label', lbl);
      revealBtn.title = lbl;
    }

    if (!ctx.isNew) {
      wrap.classList.add('has-controls');
      const controls = el('div', 'vault-secret-controls');
      revealBtn = iconButton('eye', 'Reveal', () => {
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
      controls.appendChild(iconButton('copy', 'Copy', () => {
        bridge.vaultReveal({ vaultId: ctx.vaultId, itemId: ctx.itemId }).then((res) => {
          if (!res || res.locked) { refresh(); return; }
          const secret = res.item ? (res.item[name] == null ? '' : String(res.item[name])) : '';
          bridge.clipboardWrite(secret);
        }).catch(() => {});
      }));
      wrap.appendChild(controls);
    }

    row.appendChild(wrap);

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
    // DD6 (design-review HIGH): drain the editor-cleanup registry BEFORE closeActivePageModal()
    // below, while any open editor modal is STILL attached — this zeroes its secret inputs (the
    // registered wipe) and stops its TOTP poll on the idle-lock re-render path (openModal's own
    // close() runs neither onCancel nor a wipe, so this is the only teardown on that path).
    runEditorCleanups(); // also: clearing #vault-root would orphan any live TOTP widget's timers.
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
