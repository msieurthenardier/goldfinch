// @ts-check
// goldfinch://vault serves imports through an exact flat allowlist. The pure
// display-logic helpers below live in vault-page-model.js (DD10 ruling 5) —
// everything else here is injected, the vault-nav-controller.js precedent.
import {
  browserImportDestinationOptions,
  browserImportSkipLines,
  browserImportOutcomeLines
  // @ts-ignore — serving-path vs disk-path mismatch
} from './vault-page-model.js';

/**
 * Owns the browser-CSV password import UI (M19 F1 Leg 2 / DD5, DD9, DD10, DD11, DD13):
 * pick modal → destination modal (destination + Replace/Merge choice) → native confirm
 * (main-side, DD13) → completion modal. Built OUTSIDE vault.js from day one (DD10) — the
 * page wires only construction, a trigger button, `refresh()`'s held-state join, and a
 * pagehide drop; every DOM helper and state reader is injected, mirroring
 * vault-nav-controller.js's shape.
 *
 * SECURITY: every render is `textContent`-only (the page's own rule); no candidate
 * field content (password/username/notes/title) ever reaches this module — the flow
 * module holds the plaintext main-side and this controller only ever sees aggregate
 * counts (`summary.candidateCount`, `summary.skipped` reason codes, and the commit
 * reply's `counts`).
 *
 * @param {{
 *   bridge: {
 *     vaultState: () => Promise<{ vaults?: Array<{ vaultId?: unknown, count?: unknown }> }>,
 *     browserImportPick: () => Promise<any>,
 *     browserImportSummary: () => Promise<{ handle: string, summary: { candidateCount: number, skipped: any[] } } | null>,
 *     browserImportCancel: (handle?: string) => Promise<any>,
 *     browserImportCommit: (payload: { handle: string, target: string, mode: 'merge' | 'replace' }) => Promise<any>
 *   },
 *   dom: {
 *     el: (tag: string, className?: string, text?: string) => HTMLElement,
 *     button: (label: string, className: string, onClick: () => void) => HTMLButtonElement,
 *     iconButton: (iconKey: string, ariaLabel: string, onClick: () => void, opts?: any) => HTMLButtonElement,
 *     openModal: (opts: any) => { close: () => void, setSubmitEnabled: (on: boolean) => void, setStatus: (text: string) => void },
 *     appendOption: (select: HTMLSelectElement, value: string, text: string) => void
 *   },
 *   getPresence: () => { jarRows: Array<{ id?: unknown, name?: unknown }>, jarVaultPresence: Record<string, { hasVault?: unknown, count?: unknown }> },
 *   refresh: () => void
 * }} deps
 */
export function createVaultBrowserImport(deps) {
  const { bridge, dom, getPresence, refresh } = deps;
  const { el, button, iconButton, openModal, appendOption } = dom;

  /** @type {{ handle: string, summary: { candidateCount: number, skipped: any[] } } | null} */
  let heldRecord = null;

  /** A coded `begin`/adapter refusal → its fixed, non-technical message (never raw). */
  function errorMessage(code) {
    if (code === 'unrecognized-format') return "That file isn't a Chrome password export.";
    if (code === 'too-large') return 'That file is too large.';
    if (code === 'too-many-rows') return 'Too many rows.';
    return 'Could not read that file.';
  }

  /**
   * Re-fetch this window's held record (a NON-SECRET summary projection) — called from
   * vault.js's `refresh()`, joined into its existing `Promise.all` (DD10) so the first
   * post-broadcast render already reflects the held state (no one-render-late flicker).
   * NEVER cancels the record — a strict resync read.
   * @returns {Promise<void>}
   */
  function loadHeld() {
    return Promise.resolve(bridge.browserImportSummary())
      .then((rec) => {
        heldRecord = rec && rec.summary ? rec : null;
      })
      .catch(() => {
        heldRecord = null;
      });
  }

  /**
   * The pick modal (mirrors `openImportPickModal`): a Chrome-export guidance lede, a
   * read-only path field + folder button running `browserImportPick()`. On a successful
   * pick, Continue opens the destination modal directly (no intermediate hop — unlike
   * restore, there is no secret sheet in the middle).
   */
  function openPickModal() {
    /** @type {{ handle: string, summary: { candidateCount: number, skipped: any[] } } | null} */
    let picked = null;
    const body = el('div', 'vault-modal-form');
    body.appendChild(
      el(
        'p',
        'vault-lede',
        'In Chrome, open the password manager (chrome://password-manager), open Settings, and choose ' +
          'Export passwords. Chrome asks for your device password and saves a CSV file. Choose that file here.'
      )
    );

    const fileRow = el('div', 'vault-modal-file-row');
    const pathInput = /** @type {HTMLInputElement} */ (el('input', 'vault-modal-path-input'));
    pathInput.type = 'text';
    pathInput.readOnly = true;
    pathInput.placeholder = 'No file chosen';
    pathInput.setAttribute('aria-label', 'Selected export file');
    fileRow.appendChild(pathInput);
    fileRow.appendChild(iconButton('folder', 'Choose an export file', pickFile));
    body.appendChild(fileRow);

    const foundLine = el('p', 'vault-lede', '');
    body.appendChild(foundLine);

    function pickFile() {
      Promise.resolve(bridge.browserImportPick())
        .then((res) => {
          if (res && res.ok) {
            picked = { handle: res.handle, summary: res.summary };
            heldRecord = picked;
            pathInput.value = res.path || '';
            const n = res.summary.candidateCount;
            const skippedN = res.summary.skipped.length;
            foundLine.textContent =
              n === 0
                ? 'No logins found in that file.'
                : `${n} login${n === 1 ? '' : 's'} found.` +
                  (skippedN > 0 ? ` ${skippedN} row${skippedN === 1 ? '' : 's'} can't be imported.` : '');
            handle.setStatus('');
            handle.setSubmitEnabled(n > 0);
          } else if (res && res.error) {
            picked = null;
            pathInput.value = '';
            foundLine.textContent = '';
            handle.setStatus(errorMessage(res.error));
            handle.setSubmitEnabled(false);
          }
          // { canceled } → do nothing (keep any prior pick).
        })
        .catch(() => {});
    }

    const handle = openModal({
      title: 'Import from a browser',
      body,
      submitLabel: 'Continue',
      submitEnabled: false,
      onSubmit: () => {
        if (!picked) return;
        handle.close();
        openDestinationModal(picked);
      },
      onCancel: () => {
        if (picked) Promise.resolve(bridge.browserImportCancel(picked.handle)).catch(() => {});
        heldRecord = null;
      }
    });
  }

  /**
   * The destination modal (DD9, DD13): a summary block (candidate count + skip
   * breakdown), a destination `<select>` (Global preselected), and a Replace/Merge
   * `<select>` shown only when the selected destination's presence snapshot reports
   * >= 1 item (display-only — `mode` always rides the commit, defaulting to 'merge').
   * Commit awaits a main-side NATIVE confirm (DD13) before any write.
   * @param {{ handle: string, summary: { candidateCount: number, skipped: any[] } }} record
   */
  function openDestinationModal(record) {
    Promise.resolve(bridge.vaultState())
      .then((state) => {
        const vaults = Array.isArray(state && state.vaults) ? state.vaults : [];
        const globalRow = /** @type {any} */ (vaults.find((v) => v && v.vaultId === 'global'));
        return globalRow && typeof globalRow.count === 'number'
          ? { hasVault: true, count: globalRow.count }
          : { hasVault: false };
      })
      .catch(() => ({ hasVault: false }))
      .then((globalPresence) => renderDestinationModal(record, globalPresence));
  }

  /**
   * @param {{ handle: string, summary: { candidateCount: number, skipped: any[] } }} record
   * @param {{ hasVault?: unknown, count?: unknown }} globalPresence
   */
  function renderDestinationModal(record, globalPresence) {
    const { jarRows, jarVaultPresence } = getPresence();
    /** @type {Record<string, { hasVault?: unknown, count?: unknown }>} */
    const presenceByVaultId = { global: globalPresence, ...jarVaultPresence };
    const options = browserImportDestinationOptions(jarRows, jarVaultPresence, globalPresence);

    const body = el('div', 'vault-modal-form');
    const n = record.summary.candidateCount;
    body.appendChild(el('p', 'vault-lede', `${n} login${n === 1 ? '' : 's'} found.`));

    const skipLines = browserImportSkipLines(record.summary.skipped);
    if (skipLines.length) {
      const skipList = el('ul', 'vault-outcome-list');
      skipList.hidden = skipLines.length > 5;
      for (const line of skipLines) skipList.appendChild(el('li', undefined, `Line ${line.line}: ${line.text}`));
      if (skipLines.length > 5) {
        const toggle = button(`Show ${skipLines.length} rows that can't be imported`, 'vault-btn small', () => {
          skipList.hidden = !skipList.hidden;
        });
        body.appendChild(toggle);
      } else {
        body.appendChild(
          el('p', 'vault-lede', `${skipLines.length} row${skipLines.length === 1 ? '' : 's'} can't be imported:`)
        );
      }
      body.appendChild(skipList);
    }

    const destField = el('label', 'vault-field');
    destField.appendChild(el('span', 'vault-field-label', 'Import into'));
    const destSelect = /** @type {HTMLSelectElement} */ (el('select', 'vault-settings-select'));
    destSelect.setAttribute('aria-label', 'Import destination');
    for (const o of options) appendOption(destSelect, o.vaultId, o.label);
    destSelect.value = 'global';
    destField.appendChild(destSelect);
    body.appendChild(destField);

    const modeField = el('label', 'vault-field');
    modeField.appendChild(el('span', 'vault-field-label', 'What to do'));
    const modeSelect = /** @type {HTMLSelectElement} */ (el('select', 'vault-settings-select'));
    modeSelect.setAttribute('aria-label', 'Replace or merge');
    appendOption(modeSelect, 'merge', 'Merge — keep existing, add new');
    appendOption(modeSelect, 'replace', 'Replace — delete existing, then import');
    modeSelect.value = 'merge';
    modeField.appendChild(modeSelect);
    body.appendChild(modeField);

    function updateModeVisibility() {
      const p = presenceByVaultId[destSelect.value];
      const hasItems = !!(p && p.hasVault === true && typeof p.count === 'number' && p.count >= 1);
      modeField.hidden = !hasItems;
    }
    updateModeVisibility();
    destSelect.addEventListener('change', updateModeVisibility);

    const handle = openModal({
      title: 'Import passwords',
      body,
      submitLabel: 'Import',
      submitEnabled: n > 0,
      onSubmit: () => {
        handle.setSubmitEnabled(false);
        handle.setStatus('Importing…');
        // mode ALWAYS rides the commit — 'merge' is the literal default for an
        // empty/unconfirmed destination (the row is hidden, not absent).
        const modeValue = modeField.hidden ? 'merge' : modeSelect.value;
        const mode = /** @type {'merge' | 'replace'} */ (modeValue === 'replace' ? 'replace' : 'merge');
        Promise.resolve(bridge.browserImportCommit({ handle: record.handle, target: destSelect.value, mode }))
          .then((res) => {
            if (res && res.ok) {
              heldRecord = null;
              handle.close();
              openCompletionModal(res.counts);
              return;
            }
            if (res && res.reason === 'declined') {
              handle.setStatus('Import cancelled.');
              handle.setSubmitEnabled(true);
              return;
            }
            if (res && res.reason === 'busy') {
              handle.setStatus('A rotation is in progress — try again shortly.');
              handle.setSubmitEnabled(true);
              return;
            }
            // 'locked' / 'state' / anything else: the held record is gone or the
            // manager locked — start over from Import.
            heldRecord = null;
            handle.setStatus('That import could not be completed. Start over from Import.');
          })
          .catch(() => {
            heldRecord = null;
            handle.setStatus('That import could not be completed. Start over from Import.');
          });
      },
      onCancel: () => {
        Promise.resolve(bridge.browserImportCancel(record.handle)).catch(() => {});
        heldRecord = null;
      }
    });
  }

  /**
   * The completion modal (DD11): the ordered outcome lines, then the export-file
   * deletion guidance — raised into a bordered/tinted `.vault-info-panel` callout
   * (HAT enhancement 1) so the reminder stands out instead of blending in as a plain
   * line; same idiom as `.vault-sever-card`/`.vault-page-notice` in vault.css, `role="note"`
   * (advisory, not an alert). Done closes and refreshes (the restore precedent).
   * @param {any} counts
   */
  function openCompletionModal(counts) {
    const body = el('div', 'vault-modal-form');
    const list = el('ul', 'vault-outcome-list');
    for (const line of browserImportOutcomeLines(counts)) list.appendChild(el('li', undefined, line));
    body.appendChild(list);
    const infoPanel = el('div', 'vault-info-panel');
    infoPanel.setAttribute('role', 'note');
    infoPanel.appendChild(
      el('p', 'vault-lede', 'Delete the exported CSV file now — it contains your passwords in plain text.')
    );
    body.appendChild(infoPanel);

    const handle = openModal({
      title: 'Import complete',
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
   * Drop the held record on pagehide (DD6 ruling 4's best-effort drop path — no
   * send-on-pagehide delivery guarantee exists in this codebase; the store's own
   * safety-drop timer is the authoritative bound).
   */
  function dropHeldOnPagehide() {
    if (heldRecord) Promise.resolve(bridge.browserImportCancel(heldRecord.handle)).catch(() => {});
  }

  return {
    openPickModal,
    openDestinationModal,
    heldRecord: () => heldRecord,
    loadHeld,
    dropHeldOnPagehide
  };
}
