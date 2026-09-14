// @ts-check
// goldfinch://vault serves imports through an exact flat allowlist. These
// specifiers intentionally describe serving paths rather than disk paths.
import {
  restoreDestinationOptions,
  restoreOutcomeLines
  // @ts-ignore — serving-path vs disk-path mismatch
} from './vault-page-model.js';
// @ts-ignore — serving-path vs disk-path mismatch
import { isSafeColor } from './safe-color.js';
// @ts-ignore — serving-path vs disk-path mismatch
import { PALETTE } from './jar-page-model.js';

/**
 * Owns the portable-bundle restore + export modal cluster (M18 F3, HAT-tuned), extracted out
 * of vault.js (Flight 2 Leg 1 / DD4, the M18 F3 debt) to buy vault.js headroom under its line
 * budget — the `vault-browser-import-controller.js` precedent (`createVaultBrowserImport`).
 * Every DOM hook, HAT-tuned copy string, and restore semantic below is UNCHANGED from the
 * pre-extraction vault.js — this is a move, not a rewrite; the page wires only construction,
 * two "Resume restore" banner triggers, `refresh()`'s held-record join, the labels-ready
 * listener, and a pagehide drop.
 *
 * `pendingImportRecord` becomes controller-owned closure state (design review HIGH finding —
 * it was read/written at six sites, only three of which sat inside the moved functions):
 * exposed via `heldRecord()` (getter), `loadHeld()` (the `refresh()`-joined re-fetch, mirrors
 * `vault-browser-import-controller.js`'s `loadHeld`), `handleLabelsReady(vaults)` (the DISTINCT
 * first-arrival fetch+validate+open path — vs. `openMapping`, the resume-banner entry against an
 * already-held record), and `dropHeldOnPagehide()`. `pendingNotice` is a SECOND state coupling
 * (written here, read only in vault.js's `render()`): the injected `setNotice(text)` callback
 * carries it out — the `refresh` precedent, not folded into `refresh` itself.
 *
 * SECURITY: every render is `textContent`-only (the page's own rule); NO master-equivalent
 * secret ever enters this module or the page DOM — the restore's source secret stays on the
 * chrome-owned vault-import-unlock sheet; export is ciphertext-only + fully main-side.
 *
 * @param {{
 *   bridge: {
 *     pickSavePath: (target: string) => Promise<{ path?: string, canceled?: boolean }>,
 *     exportProfile: (savePath?: string) => Promise<{ ok?: boolean, path?: string, carried?: string[], canceled?: boolean, locked?: boolean, error?: string, reason?: string }>,
 *     exportVault: (target: string, savePath?: string) => Promise<{ ok?: boolean, path?: string, canceled?: boolean, locked?: boolean, error?: string, reason?: string }>,
 *     pickImportFile: () => Promise<{ ok?: boolean, path?: string, importHandle?: string, canceled?: boolean, error?: string }>,
 *     beginImportUnlock: () => Promise<{ ok: boolean }>,
 *     clearPendingImport: (handle?: string) => Promise<{ ok: boolean }>,
 *     hasVault: (vaultId: string) => Promise<{ present: boolean }>,
 *     commitImport: (payload: { handle: string, mapping: any }) => Promise<{
 *       ok: boolean,
 *       fresh?: boolean,
 *       results?: Array<{ entryHandle: string, outcome: string, destination?: string, mergeReport?: { imported: number, skippedIdentical: number, conflictCopies: number } }>,
 *       generation?: { completedAt: number, nonce: string },
 *       reason?: string
 *     }>,
 *     fetchImportLabels: () => Promise<{ handle: string, labels: Array<{ entryHandle: string, identity: { kind: 'global' } | { kind: 'jar', name: string, color?: string }, itemCount: number }> } | null>
 *   },
 *   dom: {
 *     el: (tag: string, className?: string, text?: string) => HTMLElement,
 *     button: (label: string, className: string, onClick: () => void) => HTMLButtonElement,
 *     iconButton: (iconKey: string, ariaLabel: string, onClick: () => void, opts?: any) => HTMLButtonElement,
 *     openModal: (opts: any) => { close: () => void, setSubmitEnabled: (on: boolean) => void, setStatus: (text: string) => void },
 *     appendOption: (select: HTMLSelectElement, value: string, text: string) => void
 *   },
 *   getJarRows: () => Array<{ id?: unknown, color?: unknown }>,
 *   getJarVaultPresence: () => Record<string, { hasVault: boolean, count?: number }>,
 *   refresh: () => void,
 *   setNotice: (text: string) => void
 * }} deps
 */
export function createVaultRestoreController(deps) {
  const { bridge, dom, getJarRows, getJarVaultPresence, refresh, setNotice } = deps;
  const { el, iconButton, openModal, appendOption } = dom;

  /**
   * The window's held multi-vault import record (M18 F3 L3 / DD2 ruling 3(c), DD5 edge case
   * "Labels-ready fan-out"). SERVER-AUTHORITATIVE — this is a display cache only, never the
   * source of truth: a `null` here after a lock/timer/cancel drop correctly hides the resume
   * affordance, and a stale non-null value can't itself cause a wrong commit (commitImport's
   * own handle match is the real guard). Powers the "Resume restore" banner — the mapping modal
   * itself is opened directly by `handleLabelsReady` on first arrival; this cache exists for the
   * RE-entry path after a forced modal close.
   * @type {{ handle: string, labels: Array<{ entryHandle: string, identity: { kind: 'global' } | { kind: 'jar', name: string, color?: string }, itemCount: number }> } | null}
   */
  let heldRecord = null;

  // The manager-wide global vault id (vault-store.js's GLOBAL_ID). Used ONLY as the fixed target
  // threaded into pickImportFile from the fresh-profile import modal (M12 F5 HAT,
  // hat-fresh-profile-import): the store's fresh-adopt branch ignores the target and writes GLOBAL_ID
  // unconditionally, but vaultImportBeginFromFile's guard requires a non-empty string. The literal
  // is used (not an import) to avoid threading the main-only sentinel module into this page-served
  // module — the same rationale vault-page-model.js records for keeping GLOBAL_ID off the page side.
  const GLOBAL_VAULT_ID = 'global';

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
   * The Export modal (M18 F3 L3 / DD1 ruling 7 made this WHOLE-PROFILE only; M18 F3 L4, HAT
   * fix 1 — the operator VETOED that at the HAT and asked for both choices back). Body: a
   * SOURCE select — "Whole profile" (DEFAULT, per the mission ruling — unchanged) or a single
   * vault, global or any jar (the operator's veto — the pre-leg-3 select shape, restored via
   * the same `buildVaultSelect` builder used elsewhere) — then the same file-uploader ROW as
   * before: a text input showing the save path + an open-folder icon button that runs
   * `pickSavePath(<target>)` (main-side save dialog ONLY, no write; target-keyed default
   * filename) and populates the field. The field is EDITABLE/PASTEABLE (operator ask); the
   * actual write is gated MAIN-SIDE (canonical extension + existing writable parent), so a
   * typed path can never be a write-anywhere primitive. Export is DISABLED until the field is
   * non-empty. Submit runs `exportProfile(savePath)` (whole profile) or `exportVault(target,
   * savePath)` (single vault) fully main-side (ciphertext-only bundle; never transits the
   * page) — the jars page's delete-time single-vault export offer remains a separate,
   * untouched `exportVault` caller (`jars-section-controller.js:638`). A { locked } (idle-lock
   * race) closes the modal, refreshes, and surfaces a brief notice on either path; an
   * invalid-path / write error shows on the status line — none is silently swallowed.
   * @param {Array<{ vaultId: string, label: string }>} vaults
   */
  function openExportModal(vaults) {
    const body = el('div', 'vault-modal-form');

    const WHOLE_PROFILE_LEDE =
      'Export every vault in this profile — the global vault and every jar that has one — into a single encrypted file.';
    const SINGLE_VAULT_LEDE = 'Export this one vault into a single encrypted file.';
    const lede = el('p', 'vault-lede', WHOLE_PROFILE_LEDE);
    body.appendChild(lede);

    // Source choice: "Whole profile" is a synthetic leading option (value '') prepended onto
    // the SAME select buildVaultSelect builds for the vault entries — never a second control —
    // so the pre-leg-3 single-vault select shape is restored verbatim, just with one extra
    // option ahead of it. "Whole profile" is the DEFAULT (mission ruling 7, unchanged by the
    // veto); a single vault is what the veto restores.
    const field = el('label', 'vault-settings-field');
    field.appendChild(el('span', 'vault-settings-label', 'Source'));
    const select = buildVaultSelect(vaults, 'Export source');
    const wholeProfileOpt = /** @type {HTMLOptionElement} */ (el('option', undefined, 'Whole profile'));
    wholeProfileOpt.value = '';
    select.insertBefore(wholeProfileOpt, select.firstChild);
    select.value = '';
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
    fileRow.appendChild(
      iconButton('folder', 'Choose a save location', () => {
        Promise.resolve(bridge.pickSavePath(select.value || 'profile'))
          .then((res) => {
            if (res && res.path) {
              pathInput.value = res.path;
              handle.setStatus('');
              handle.setSubmitEnabled(true);
            }
          })
          .catch(() => {});
      })
    );
    body.appendChild(fileRow);

    // Switching source clears any already-picked path (a whole-profile path and a single-vault
    // path are different targets — never silently carry one over to the other) and swaps the
    // lede so the modal always states what Export is about to do.
    select.addEventListener('change', () => {
      lede.textContent = select.value === '' ? WHOLE_PROFILE_LEDE : SINGLE_VAULT_LEDE;
      pathInput.value = '';
      handle.setStatus('');
      handle.setSubmitEnabled(false);
    });

    const handle = openModal({
      title: 'Export',
      body,
      submitLabel: 'Export',
      submitEnabled: false,
      onSubmit: () => {
        const savePath = pathInput.value.trim();
        if (!savePath) return;
        const wholeProfile = select.value === '';
        handle.setSubmitEnabled(false);
        handle.setStatus('Exporting…');
        Promise.resolve(wholeProfile ? bridge.exportProfile(savePath) : bridge.exportVault(select.value, savePath))
          .then((res) => {
            if (res && res.locked) {
              setNotice('The manager locked — export canceled. Unlock and try again.');
              handle.close();
              refresh();
              return;
            }
            if (res && res.ok) {
              if (wholeProfile) {
                // Whole-profile result keeps its carried-vaults statement (ruling 7, unchanged) —
                // M18 F3 L4, HAT fix 2: name the carried vaults, not just a count. M18 F3 L5
                // (ruling 4c): `res.carried` is real NAMES directly now — main-only, never
                // serialized; entryHandles are opaque, so the old id→label lookup is gone.
                // The cast below is needed because `res`'s inferred type is the UNION of exportProfile's
                // and exportVault's reply shapes (only the former declares `carried`) — this branch
                // runs only when `wholeProfile` is true, i.e. only for an exportProfile reply.
                const profileRes = /** @type {{ ok?: boolean; carried?: string[] }} */ (res);
                const names = Array.isArray(profileRes.carried) ? profileRes.carried : [];
                const count = names.length;
                setNotice(
                  count === 0
                    ? 'Exported 0 vaults.'
                    : `Exported ${count} vault${count === 1 ? '' : 's'}: ${names.join(', ')}.`
                );
              } else {
                setNotice(`Exported ${select.selectedOptions[0].textContent}.`); // M18 F3 L6 (smoke polish 3)
              }
              // Shared close+refresh: refresh() paints the notice (locked branch above closes+refreshes itself and returns early, so no double-close).
              handle.close();
              refresh();
              return;
            }
            if (res && res.error === 'invalid-path') {
              handle.setStatus(
                'That location can’t be used. Pick a .gfvaultbundle or .json path in an existing folder.'
              );
              handle.setSubmitEnabled(true);
              return;
            }
            if (res && res.canceled) {
              handle.setStatus('Export canceled.');
              handle.setSubmitEnabled(true);
              return;
            }
            handle.setStatus(wholeProfile ? 'Could not export the profile.' : 'Could not export the vault.');
            handle.setSubmitEnabled(true);
          })
          .catch(() => {
            handle.setStatus(wholeProfile ? 'Could not export the profile.' : 'Could not export the vault.');
            handle.setSubmitEnabled(true);
          });
      }
    });
  }

  /**
   * The restore PICK modal (M18 F3 L3 / DD2 — the UNIFIED workflow: both entry points —
   * Settings' "Import…" and the not-set-up page's "Import a vault bundle" — open THIS SAME
   * flow now; the old `fresh`-split single modal converges here). Body: a file-uploader ROW
   * (a READ-ONLY path field + an open-folder icon button) — NO destination is picked here
   * (ruling 1: destination binding moves entirely to the COMMIT-time mapping step). NO secret
   * is entered here either: Continue runs `beginImportUnlock()` (a fully bare trigger — no
   * payload at all), handing off to the chrome-owned vault-import-unlock sheet, which
   * PREVIEWS the bundle secret (master password OR recovery key) and, on success, notifies
   * the page (labels-ready) to open the mapping modal.
   *
   * The bundle READ stays DIALOG-BOUND: the folder button runs `pickImportFile()` — main opens
   * + reads + HOLDS the bundle (main reads filePaths[0]); the page never gets an arbitrary-read
   * oracle. On dismiss (Cancel / Escape / backdrop) after a pick, drop the held bundle via
   * clearPendingImport so an abandoned pick never lingers (DD5's explicit-cancel row).
   *
   * `opts.fresh` only changes the lede copy — a not-set-up profile has no destination select to
   * omit post-DD2 (there never is one here anymore), so fresh and set-up modes share the exact
   * same body shape.
   * @param {{ fresh?: boolean }} [opts]
   */
  function openImportPickModal(opts) {
    const fresh = !!(opts && opts.fresh);
    let picked = false;
    let importHandle = null; // opaque per-transaction token from pickImportFile (PR#112 finding 5)
    const body = el('div', 'vault-modal-form');

    body.appendChild(
      el(
        'p',
        'vault-lede',
        fresh
          ? 'Restore vaults exported from another device. You’ll enter the source master password or recovery key on a secure prompt, then choose where each vault lands.'
          : 'Import vaults from a portable bundle exported from another device or profile. You’ll enter the source master password or recovery key on a secure prompt, then choose where each vault lands.'
      )
    );

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

    function pickFile() {
      Promise.resolve(bridge.pickImportFile())
        .then((res) => {
          if (res && res.ok) {
            picked = true;
            importHandle = res.importHandle || null; // finding 5: bind this transaction's token.
            pathInput.value = res.path || '';
            handle.setStatus('');
            handle.setSubmitEnabled(true);
          } else if (res && res.error) {
            picked = false;
            importHandle = null;
            pathInput.value = '';
            handle.setStatus('Could not read that bundle file.');
            handle.setSubmitEnabled(false);
          }
          // { canceled } → do nothing (keep any prior pick).
        })
        .catch(() => {});
    }

    const handle = openModal({
      title: fresh ? 'Restore a profile' : 'Import a vault bundle',
      body,
      submitLabel: 'Continue',
      submitEnabled: false,
      onSubmit: () => {
        if (!picked) return;
        Promise.resolve(bridge.beginImportUnlock()).catch(() => {});
        handle.close();
      },
      onCancel: () => {
        // DD5 matrix: drop any held bundle when the operator dismisses the pick modal.
        if (picked) Promise.resolve(bridge.clearPendingImport(importHandle)).catch(() => {});
      }
    });
  }

  const NEW_JAR_FALLBACK_COLOR = '#4a90d9';

  /**
   * A dot-swatch color picker (HAT fix 4; collapsed-by-default toggle added at HAT fix 5, a
   * live-walk operator ask) — mirrors the jars page's radiogroup-of-role=radio idiom
   * (`jars-create-controller.js` / `jars-section-controller.js`'s `buildSwatchGrid`),
   * reimplemented locally here (goldfinch://vault has no route to jars-create-controller.js
   * itself, only to the shared PALETTE data it draws from — squawk 0063). `colors` is
   * expected to already carry the prefilled color as a trailing extra
   * swatch when it isn't one of the presets — mirroring `jars-section-controller.js`'s
   * `editColors` (append-as-custom-swatch, never a "nearest color" guess). Collapsed state
   * shows only the selected color as a single dot button; clicking it expands the grid inline
   * below the dot (no overlay) — the same button+aria-expanded+outside-click/Escape-close
   * shape as vault.js's own `buildKebabMenu`, sized down to one grid with no item-list nav.
   * A swatch selection collapses the grid back to the dot.
   * @param {readonly string[]} colors
   * @param {string} initialColor
   * @param {string} ariaLabel
   * @param {(color: string) => void} onSelect
   * @returns {HTMLElement}
   */
  function buildColorSwatchGrid(colors, initialColor, ariaLabel, onSelect) {
    const wrap = el('div', 'vault-swatch-wrap');
    let selected = initialColor;

    const toggle = /** @type {HTMLButtonElement} */ (el('button', 'vault-swatch-toggle'));
    toggle.type = 'button';
    toggle.setAttribute('aria-haspopup', 'true');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', ariaLabel);
    const dot = el('span', 'vault-swatch-dot');
    toggle.appendChild(dot);

    const grid = el('div', 'vault-swatch-grid');
    grid.setAttribute('role', 'radiogroup');
    grid.setAttribute('aria-label', ariaLabel);
    grid.hidden = true;

    /** @type {HTMLButtonElement[]} */
    const buttons = [];
    function paint() {
      dot.style.background = isSafeColor(selected) ? selected : NEW_JAR_FALLBACK_COLOR;
      for (const btn of buttons) {
        const checked = btn.dataset.color === selected;
        btn.setAttribute('aria-checked', String(checked));
        btn.classList.toggle('selected', checked);
      }
    }

    /** @type {((ev: Event) => void)|null} */
    let onDocPointer = null;
    const isOpen = () => !grid.hidden;
    function open() {
      if (isOpen()) return;
      grid.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
      onDocPointer = (ev) => {
        if (!wrap.contains(/** @type {Node} */ (ev.target))) close();
      };
      document.addEventListener('pointerdown', onDocPointer, true);
      (buttons.find((b) => b.dataset.color === selected) || buttons[0])?.focus();
    }
    /** @param {boolean} [restoreFocus] */
    function close(restoreFocus) {
      if (!isOpen()) return;
      grid.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
      if (onDocPointer) {
        document.removeEventListener('pointerdown', onDocPointer, true);
        onDocPointer = null;
      }
      if (restoreFocus) toggle.focus();
    }
    toggle.addEventListener('click', () => (isOpen() ? close() : open()));
    wrap.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && isOpen()) {
        ev.preventDefault();
        ev.stopPropagation(); // collapse the palette only — don't also dismiss the modal
        close(true);
      }
    });

    for (const color of colors) {
      const btn = /** @type {HTMLButtonElement} */ (el('button', 'vault-swatch-btn'));
      btn.type = 'button';
      btn.dataset.color = color;
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-label', color);
      btn.style.background = isSafeColor(color) ? color : NEW_JAR_FALLBACK_COLOR;
      btn.addEventListener('click', () => {
        selected = color;
        paint();
        onSelect(color);
        close(true);
      });
      buttons.push(btn);
      grid.appendChild(btn);
    }
    paint();

    wrap.appendChild(toggle);
    wrap.appendChild(grid);
    return wrap;
  }

  /**
   * The mapping modal (M18 F3 L3 / DD2 ruling 3(d), the Flight 1 O4 baseline): one row per
   * bundle vault, EACH carrying an individually-changeable directive (HAT ruling, Leg 4: DD2's
   * "explicit directive" is satisfied by every row's directive being visible and editable, not
   * by starting unset — a disabled "Choose…" placeholder option exists for a row that would
   * legitimately have no default, but every row DOES have one, prefilled at HAT fix 5: a global
   * row defaults to Use an existing vault → Global, a jar row defaults to Create a new jar with
   * its own name+color already filled in — UNLESS its name matches an existing jar (DD3 rerun-
   * recovery, HAT fix 7), which instead defaults to Use an existing vault → that jar — so
   * Commit starts enabled and "Choose…" is never the DISPLAYED value). Per row: Skip / Create a
   * new jar (jar-sourced rows only) / Use an existing
   * vault — the destination sub-picker REUSES `buildVaultSelect` (the retiring single-select
   * flows' builder, per the leg's "never leave it orphaned" note). Choosing an existing
   * destination probes `hasVault` and, on a real collision, requires an explicit Replace-or-Merge
   * choice (merge listed first — the calmed, non-destructive default once a mode IS required);
   * switching the directive away before the probe resolves supersedes it (HAT fix 5) so a late
   * reply can never re-show the collision block or overwrite the row's now-current state.
   *
   * The global-sourced row (`identity.kind === 'global'`) never offers "new" (you cannot
   * create a new jar for the manager-wide global vault); on a FRESH profile `existingVaults`
   * is empty (ruling 3: only new-jar/skip/global→global are legal), so a synthetic "Global
   * (this profile)" destination is injected for that one row so the DD2/DD3 global→global
   * path stays reachable without a real existing-vaults list.
   *
   * RESUME (ruling 9): callable both from the labels-ready notification (a fresh record) and
   * from the page's "Resume restore" affordance (re-entering after a forced broadcast-close)
   * — identical behavior either way; no secret re-entry is ever needed here. Cancel drops the
   * held record (via clearPendingImport) and kills the resume affordance; a forced close
   * (any OTHER broadcast, ruling 9) does NOT — this function's own `onCancel` is the only
   * path that clears the record; a render-triggered `closeActivePageModal()` never runs it.
   * M18 F3 L5: rows key off `label.entryHandle` (opaque, not the old `sourceId`); `label.jarMeta` is now `label.identity` — submit's mapping keys on entryHandle too.
   * @param {{ handle: string, labels: Array<{ entryHandle: string, identity: { kind: 'global' } | { kind: 'jar', name: string, color?: string }, itemCount: number }> }} record
   * @param {Array<{ vaultId: string, label: string }>} existingVaults  the CURRENT profile's vaults; empty on a fresh profile.
   */
  function openMappingModal(record, existingVaults) {
    const jarRows = getJarRows();
    const jarVaultPresence = getJarVaultPresence();
    const body = el('div', 'vault-modal-form vault-mapping-form');
    body.appendChild(el('p', 'vault-lede', 'Choose what happens to each vault in this bundle.'));

    /** @type {Map<string, { directive?: string, destination?: string, mode?: string, newJar?: { name: string, color: string }, complete: boolean }>} */
    const rowState = new Map();
    /** @type {Array<() => void>} */
    const seedFns = [];

    function updateCommitEnabled() {
      handle.setSubmitEnabled(record.labels.every((l) => rowState.get(l.entryHandle)?.complete === true));
    }

    for (const label of record.labels) {
      const identity = label.identity;
      const isGlobalSource = identity.kind === 'global';
      const title = identity.kind === 'jar' ? identity.name : 'Global';
      const row = el('div', 'vault-mapping-row');
      row.appendChild(
        el('h4', 'vault-mapping-row-title', `${title} (${label.itemCount} item${label.itemCount === 1 ? '' : 's'})`)
      );

      // Each control below is wrapped in the editor's own .vault-field/.vault-field-label
      // convention (HAT fix 4) — a visible label plus the shared vertical rhythm — instead of
      // an unlabeled control sitting flush against its neighbor.
      const directiveField = el('label', 'vault-field');
      directiveField.appendChild(el('span', 'vault-field-label', 'Action'));
      const directiveSelect = /** @type {HTMLSelectElement} */ (el('select', 'vault-settings-select'));
      directiveSelect.setAttribute('aria-label', `${title} — directive`);
      const placeholder = /** @type {HTMLOptionElement} */ (el('option', undefined, 'Choose…'));
      placeholder.value = '';
      placeholder.disabled = true;
      placeholder.selected = true;
      directiveSelect.appendChild(placeholder);
      appendOption(directiveSelect, 'skip', 'Skip');
      if (!isGlobalSource) appendOption(directiveSelect, 'new', 'Create a new jar');
      // Jar rows source "existing" destinations from jarRows + jarVaultPresence, not
      // existingVaults (HAT fix 8 — fixes the fresh-adopt gap where DD2 ruling 3 forces
      // existingVaults empty). Also resolves HAT-fix-7's rerun match; degrades safely mid-race.
      const jarDest =
        identity.kind === 'jar' ? restoreDestinationOptions(jarRows, jarVaultPresence, identity.name) : null;
      const destinationOptions = isGlobalSource
        ? existingVaults.some((v) => v.vaultId === GLOBAL_VAULT_ID)
          ? existingVaults
          : [...existingVaults, { vaultId: GLOBAL_VAULT_ID, label: 'Global (this profile)' }]
        : jarDest.options;
      if (destinationOptions.length) appendOption(directiveSelect, 'existing', 'Use an existing vault');
      const matchedExisting = isGlobalSource ? undefined : jarDest.matched;
      // Prefill a sensible default directive (HAT fix 5, live-walk operator ruling): a global
      // row always has an 'existing' destination (Global itself, synthesized above when
      // missing), so it prefills 'existing'→Global; a jar row prefills 'new' (its own
      // name/color are prefilled below) UNLESS a name-matched residue jar exists, above. No
      // row is left on the disabled placeholder, so the Action select's DISPLAYED value never
      // reads "Choose…".
      directiveSelect.value = isGlobalSource ? 'existing' : matchedExisting ? 'existing' : 'new';
      directiveField.appendChild(directiveSelect);
      row.appendChild(directiveField);

      // New-jar fields (name + color), shown only for directive === 'new'. Color is a
      // dot-swatch picker (HAT fix 4) — mirrors the jars page's own jar-creation idiom instead
      // of a native <input type=color> rectangle+RGB picker.
      const newJarRow = el('div', 'vault-mapping-newjar-row');
      newJarRow.hidden = true;
      const nameField = el('label', 'vault-field');
      nameField.appendChild(el('span', 'vault-field-label', 'Jar name'));
      const nameInput = /** @type {HTMLInputElement} */ (el('input', 'vault-modal-path-input'));
      nameInput.type = 'text';
      nameInput.setAttribute('aria-label', `${title} — new jar name`);
      nameInput.value = title;
      nameField.appendChild(nameInput);
      newJarRow.appendChild(nameField);
      const initialColor =
        identity.kind === 'jar' && isSafeColor(identity.color) ? identity.color : NEW_JAR_FALLBACK_COLOR;
      // selectedColor is captured by the swatch grid's onSelect below and read back in
      // recompute()'s 'new' branch — the grid has no <input> to read a .value from.
      let selectedColor = initialColor;
      const colorField = el('div', 'vault-field');
      colorField.appendChild(el('span', 'vault-field-label', 'Jar color'));
      colorField.appendChild(
        buildColorSwatchGrid(
          // Mirrors jars-section-controller.js's editColors: the prefilled bundle color rides
          // as a trailing custom swatch when it isn't already one of the presets.
          PALETTE.includes(initialColor) ? PALETTE : [...PALETTE, initialColor],
          initialColor,
          `${title} — new jar color`,
          (color) => {
            selectedColor = color;
            recompute();
          }
        )
      );
      newJarRow.appendChild(colorField);
      row.appendChild(newJarRow);

      // Destination sub-picker — REUSES buildVaultSelect (the retiring single-select flows'
      // builder). Shown only for directive === 'existing'.
      const destRow = el('div', 'vault-mapping-dest-row');
      destRow.hidden = true;
      const destSelect = destinationOptions.length
        ? buildVaultSelect(destinationOptions, `${title} — destination`)
        : null;
      // buildVaultSelect defaults to its first option; a global row's prefilled 'existing'
      // directive specifically targets Global, and a name-matched jar row's targets ITS
      // residue jar — neither is necessarily first once other vaults exist in destinationOptions.
      if (destSelect && isGlobalSource) destSelect.value = GLOBAL_VAULT_ID;
      else if (destSelect && matchedExisting) destSelect.value = matchedExisting.vaultId;
      if (destSelect) {
        const destField = el('label', 'vault-field');
        destField.appendChild(el('span', 'vault-field-label', 'Destination'));
        destField.appendChild(destSelect);
        destRow.appendChild(destField);
      }
      row.appendChild(destRow);

      // Replace-or-Merge — shown only once a real collision is confirmed at the destination.
      const modeRow = el('div', 'vault-mapping-mode-row');
      modeRow.hidden = true;
      modeRow.appendChild(
        el(
          'p',
          'vault-modal-warn',
          'A vault already exists there. Merge keeps both; Replace destroys the existing one.'
        )
      );
      const modeField = el('label', 'vault-field');
      modeField.appendChild(el('span', 'vault-field-label', 'What to do'));
      const modeSelect = /** @type {HTMLSelectElement} */ (el('select', 'vault-settings-select'));
      modeSelect.setAttribute('aria-label', `${title} — replace or merge`);
      appendOption(modeSelect, 'merge', 'Merge (keep both, mark conflicts)');
      appendOption(modeSelect, 'replace', 'Replace (destroy the existing vault)');
      modeField.appendChild(modeSelect);
      modeRow.appendChild(modeField);
      row.appendChild(modeRow);

      // Bumped on every recompute() call so a hasVault probe that resolves AFTER this row has
      // since moved on (directive switched away, or switched to a different destination) drops
      // its result instead of clobbering the row's current state (HAT fix 5, live-walk finding):
      // a Skip/New row could flip back to a stale 'existing'+collision-block display when an
      // in-flight probe from a PRIOR 'existing' selection landed late.
      let probeGeneration = 0;

      function probeDestinationCollision() {
        const destination = /** @type {HTMLSelectElement} */ (destSelect).value;
        const myGeneration = probeGeneration;
        const stale = () => myGeneration !== probeGeneration;
        Promise.resolve(bridge.hasVault(destination))
          .then((r) => {
            if (stale()) return;
            const collision = !!(r && r.present);
            modeRow.hidden = !collision;
            rowState.set(label.entryHandle, {
              directive: 'existing',
              destination,
              mode: collision ? modeSelect.value : undefined,
              complete: true
            });
            updateCommitEnabled();
          })
          .catch(() => {
            if (stale()) return;
            // Fail-safe: never silently allow a destructive replace when the probe itself failed.
            modeRow.hidden = false;
            rowState.set(label.entryHandle, {
              directive: 'existing',
              destination,
              mode: modeSelect.value,
              complete: true
            });
            updateCommitEnabled();
          });
      }

      function recompute() {
        // Superseding a prior probe happens FIRST, and the visible controls below swap
        // synchronously — the row never waits on the (fire-and-forget, never awaited) probe to
        // repaint. HAT fix 5's lag re-check confirmed this path has no synchronous IPC wait.
        probeGeneration++;
        const v = directiveSelect.value;
        newJarRow.hidden = v !== 'new';
        destRow.hidden = v !== 'existing';
        if (v === 'skip') {
          modeRow.hidden = true;
          rowState.set(label.entryHandle, { directive: 'skip', complete: true });
          updateCommitEnabled();
        } else if (v === 'new') {
          modeRow.hidden = true;
          const name = nameInput.value.trim();
          rowState.set(label.entryHandle, {
            directive: 'new',
            newJar: { name, color: isSafeColor(selectedColor) ? selectedColor : NEW_JAR_FALLBACK_COLOR },
            complete: name.length > 0
          });
          updateCommitEnabled();
        } else if (v === 'existing' && destSelect) {
          rowState.set(label.entryHandle, { directive: 'existing', destination: destSelect.value, complete: false });
          updateCommitEnabled();
          probeDestinationCollision();
        } else {
          modeRow.hidden = true;
          rowState.set(label.entryHandle, { complete: false });
          updateCommitEnabled();
        }
      }
      directiveSelect.addEventListener('change', recompute);
      nameInput.addEventListener('input', recompute);
      // The color swatch grid's onSelect already calls recompute() directly on click — no
      // separate change/input listener needed here (one fewer per-row hook than the old
      // native-input approach).
      destSelect?.addEventListener('change', recompute);
      modeSelect.addEventListener('change', () => {
        const s = rowState.get(label.entryHandle);
        if (s) {
          s.mode = modeSelect.value;
          updateCommitEnabled();
        }
      });
      seedFns.push(recompute);

      body.appendChild(row);
    }

    const handle = openModal({
      title: 'Choose destinations',
      body,
      submitLabel: 'Commit',
      submitEnabled: false,
      onSubmit: () => {
        handle.setSubmitEnabled(false);
        handle.setStatus('Restoring…');
        // M18 F3 L5 (cycle-2, the most consequential rekey site): mapping MUST key on
        // entryHandle, not the old plaintext sourceId (`record.handle` above is the
        // unrelated per-IMPORT-SESSION token).
        /** @type {any} */
        const mapping = {};
        for (const [entryHandle, s] of rowState) {
          if (s.directive === 'skip') mapping[entryHandle] = { directive: 'skip' };
          else if (s.directive === 'new') mapping[entryHandle] = { directive: 'new', newJar: s.newJar };
          else mapping[entryHandle] = { directive: 'existing', destination: s.destination, mode: s.mode };
        }
        Promise.resolve(bridge.commitImport({ handle: record.handle, mapping }))
          .then((res) => {
            heldRecord = null; // the commit consumed the record either way.
            if (res && res.ok) {
              handle.close();
              // record.labels (in closure) carries the decrypted names the completion display
              // joins against (ruling 4) — an entryHandle is never shown to the operator.
              openCompletionModal(res, record.labels);
              return;
            }
            handle.setStatus(
              res && res.reason === 'busy'
                ? 'A rotation is in progress — try again shortly.'
                : 'That restore could not be completed. Start over from Import.'
            );
            handle.setSubmitEnabled(false);
          })
          .catch(() => {
            handle.setStatus('That restore could not be completed. Start over from Import.');
          });
      },
      onCancel: () => {
        // DD5/ruling 9: an explicit cancel drops the held record and kills the resume affordance
        // — a render-triggered forced close (any other broadcast) never reaches this branch.
        heldRecord = null;
        Promise.resolve(bridge.clearPendingImport(record.handle)).catch(() => {});
      }
    });
    for (const seed of seedFns) seed();
  }

  /**
   * The restore completion surface (DD2 ruling 3(e); DD11: reflects post-restore state
   * without a manual reload — this modal renders directly from the commit reply, and a fresh
   * adopt's unlock broadcast independently re-queries state for the rest of the page). Lists
   * each bundle vault's outcome INCLUDING merge detail, so a dedup-only merge (DD4) reads as
   * legibly-empty rather than silently "Restored" (HAT fix 11). A fresh adopt's one-time
   * recovery key + the DD7 sever offer are surfaced main-side (the dismiss-locked recovery-show
   * sheet, the Settings sever card) — this modal shows no secret, ever.
   * M18 F3 L5: results key on the bundle's opaque `entryHandle` — the caller passes `labels` (its `record.labels`, still in closure) so `restoreOutcomeLines` can join each to a decrypted NAME; an entryHandle is NEVER shown.
   * @param {{ fresh?: boolean, results?: Array<{ entryHandle: string, outcome: string, destination?: string, mergeReport?: { imported: number, skippedIdentical: number, conflictCopies: number } }> }} result
   * @param {Array<{ entryHandle: string, identity: { kind: 'global' } | { kind: 'jar', name: string, color?: string } }>} [labels]
   */
  function openCompletionModal(result, labels) {
    const body = el('div', 'vault-modal-form');
    const list = el('ul', 'vault-mapping-outcomes');
    for (const line of restoreOutcomeLines(result.results, labels)) {
      const li = el('li');
      li.textContent = line.text;
      list.appendChild(li);
    }
    body.appendChild(list);
    if (result.fresh) {
      body.appendChild(
        el(
          'p',
          'vault-lede',
          'This profile is now set up and unlocked. Save the new recovery key shown on the secure prompt.'
        )
      );
    }

    const handle = openModal({
      title: 'Restore complete',
      body,
      submitLabel: 'Done',
      submitEnabled: true,
      onSubmit: () => {
        handle.close();
        refresh();
      }
    });
  }

  /**
   * Re-fetch this window's held record (DD2 ruling 9) — called from vault.js's `refresh()`,
   * joined into its existing `Promise.all` so the first post-broadcast render already reflects
   * the resume state (no one-render-late flicker — the `vault-browser-import-controller.js`
   * `loadHeld` precedent). NEVER cancels the record — a strict resync read.
   * @returns {Promise<void>}
   */
  function loadHeld() {
    return Promise.resolve(bridge.fetchImportLabels())
      .then((rec) => {
        heldRecord = rec && rec.labels ? rec : null;
      })
      .catch(() => {
        heldRecord = null;
      });
  }

  /**
   * The labels-ready first-arrival path (DD2 ruling 3(c), distinct from `openMapping` — the
   * resume-banner entry against an already-held record): fetch THIS window's own record and, if
   * present, store it and open the mapping modal directly against the caller's CURRENT vault
   * list (vault.js's `lastViewVaults`, which has no other route into this module). A null fetch
   * (the record was dropped between the sheet's success and this fetch — lock, timer, another
   * pick) is a strict no-op, never assuming the event implies its own record.
   * @param {Array<{ vaultId: string, label: string }>} vaults
   * @returns {Promise<void>}
   */
  function handleLabelsReady(vaults) {
    return Promise.resolve(bridge.fetchImportLabels())
      .then((rec) => {
        if (rec && rec.labels) {
          heldRecord = rec;
          openMappingModal(rec, vaults);
        }
      })
      .catch(() => {});
  }

  /**
   * DD5 ruling 4's pagehide drop path (best-effort — no send-on-pagehide delivery guarantee
   * exists in this codebase; the store's own safety-drop timer is the authoritative bound).
   * Once a labels-bearing record is held, leaving the vault page (tab close, navigate away)
   * drops it.
   */
  function dropHeldOnPagehide() {
    if (heldRecord) Promise.resolve(bridge.clearPendingImport(heldRecord.handle)).catch(() => {});
  }

  return {
    openExportModal,
    openImportPickModal,
    // The resume-banner entry against an already-held record (vault.js guards the call on
    // heldRecord() truthiness) — a thin, named alias onto openMappingModal itself.
    openMapping: openMappingModal,
    heldRecord: () => heldRecord,
    loadHeld,
    handleLabelsReady,
    dropHeldOnPagehide
  };
}
