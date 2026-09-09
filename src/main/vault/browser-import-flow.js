// @ts-check
'use strict';

// The operator-driven browser-CSV-import FLOW (M19 F1 Leg 2 / DD5, DD6, DD13):
// pick → hold → destination/mode choice → native confirm → commit. Electron-free
// and injected-deps (the `main.js` M18 restore-delegate SHAPE — `dialog`/`fs`/
// `windowForChrome`/`listJars` passed in, never `require('electron')`) so the
// DD13 confirm ordering and the lock-during-confirm drop are PROVEN under
// `node --test`, not merely asserted by grep. `main.js` wires this module's
// four methods into `registerBrowserIpc`'s deps object and stays composition
// only (leg ruling 1/2).
//
// Security shape this module exists to hold (DD5/DD13, restated from the flight):
// (a) the native file dialog has no automation surface, so no tier — admin
// included — can INITIATE an import; (b) the plaintext payload is held
// main-side and never sent to the page, so a tier that can drive the page
// cannot READ the credentials; (c) the commit is gated by a native
// `dialog.showMessageBox`, AWAITED BEFORE `pending.take()` — an idle-lock or
// window-close firing while that dialog is open must still drop the held
// payload (the record stays reachable by the drop fan-out until `take()`
// removes it), so the await-then-take ordering is load-bearing, not
// incidental.

const {
  BrowserImportFormatError,
  MAX_PAYLOAD_BYTES,
  detectChromeExport,
  adaptChromeRows,
  summarizeOutcomes
} = require('./browser-import');
const { parseCsv } = require('./csv-parse');
const { mapVaultSheetError, VAULT_BROWSER_IMPORT_COMMIT_CONFIG } = require('./vault-sheet-errors');

/**
 * @typedef {Object} BrowserImportFlowDeps
 * @property {() => any} getStore  the vault store accessor (main's `getVaultStore` memo idiom).
 * @property {{
 *   hold: (chromeId: number, parts: { payload: Buffer, summary: any }) => string,
 *   peekSummary: (chromeId: number) => { handle: string, summary: any } | null,
 *   take: (chromeId: number, handle: string) => { handle: string, payload: Buffer, summary: any } | null,
 *   clear: (chromeId: number, handle?: string) => void
 * }} pending  the `pending-browser-imports.js` store instance.
 * @property {{ showOpenDialog: (opts: any) => Promise<{ canceled?: boolean, filePaths?: string[] }>, showMessageBox: (win: any, opts: any) => Promise<{ response: number }> }} dialog
 * @property {{ statSync: (p: string) => { size: number }, readFileSync: (p: string) => Buffer }} fs
 * @property {(chromeId: number) => any} windowForChrome  the BaseWindow (or null) to parent the native confirm on.
 * @property {() => Array<{ id: string, name?: string }>} listJars
 */

/**
 * @param {BrowserImportFlowDeps} deps
 * @returns {{
 *   begin: (chromeId: number) => Promise<any>,
 *   summary: (chromeId: number) => { handle: string, summary: any } | null,
 *   cancel: (chromeId: number, handle: string) => void,
 *   commit: (chromeId: number, payload: { handle: string, target: string, mode: string }) => Promise<any>
 * }}
 */
function createBrowserImportFlow({ getStore, pending, dialog, fs, windowForChrome, listJars }) {
  /**
   * Pick a Chrome password-export CSV, read + parse + adapt it ONCE, and HOLD the raw
   * payload (never the parsed candidates — DD6 best-effort: the parsed strings are
   * dropped on return) main-side under the picking window's chrome id.
   * @param {number} chromeId
   * @returns {Promise<{ ok?: boolean, path?: string, handle?: string, summary?: { candidateCount: number, skipped: any[] }, canceled?: boolean, error?: string }>}
   */
  async function begin(chromeId) {
    if (typeof chromeId !== 'number') return { error: 'no-window' };
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Import passwords from a browser export',
      properties: ['openFile'],
      filters: [
        { name: 'CSV password export', extensions: ['csv'] },
        { name: 'All files', extensions: ['*'] }
      ]
    });
    if (canceled || !filePaths || !filePaths[0]) return { canceled: true };
    const path = filePaths[0];

    let stat;
    try {
      stat = fs.statSync(path);
    } catch {
      return { error: 'unreadable' };
    }
    if (stat.size > MAX_PAYLOAD_BYTES) return { error: 'too-large' };

    /** @type {Buffer} */
    let payload;
    try {
      // Buffer, never 'utf8' (DD6) — the raw bytes are what gets held + zeroized;
      // parsing below reads its own local utf8 string, never retained past this call.
      payload = fs.readFileSync(path);
    } catch {
      return { error: 'unreadable' };
    }

    /** @type {{ candidateCount: number, skipped: any[] } | undefined} */
    let summaryOut;
    try {
      const { records } = parseCsv(payload.toString('utf8'));
      detectChromeExport(records);
      const { candidates, skipped } = adaptChromeRows(records);
      summaryOut = { candidateCount: candidates.length, skipped };
    } catch (e) {
      if (e instanceof BrowserImportFormatError) return { error: e.reason };
      return { error: 'unreadable' };
    }

    const handle = pending.hold(chromeId, { payload, summary: summaryOut });
    return { ok: true, path, handle, summary: summaryOut };
  }

  /**
   * The page's window-scoped summary read — `pending.peekSummary` verbatim.
   * @param {number} chromeId
   * @returns {{ handle: string, summary: any } | null}
   */
  function summary(chromeId) {
    return pending.peekSummary(chromeId);
  }

  /**
   * Drop the held record at any step (pick-modal Cancel, or destination-modal Cancel).
   * @param {number} chromeId
   * @param {string} handle
   */
  function cancel(chromeId, handle) {
    pending.clear(chromeId, handle);
  }

  /**
   * The destination label for the native confirm's message — the jar's name, id
   * fallback, or 'Global'.
   * @param {string} target
   * @returns {string}
   */
  function destLabel(target) {
    if (target === 'global') return 'Global';
    const jars = Array.isArray(listJars()) ? listJars() : [];
    const jar = jars.find((j) => j && j.id === target);
    return jar ? jar.name || jar.id : target;
  }

  /**
   * DD13's native-confirm-gated commit. Ordering is pinned (leg ruling 1 step-by-step,
   * design-reviewed): validate shape → peek the held record → store pre-checks (locked /
   * unresolvable target) → a FRESH `listItems(target).length` read → AWAIT the native
   * confirm (the record is still HELD across this await) → re-peek (a concurrent
   * lock/close may have dropped it while the dialog was open) → `take()` → import,
   * zeroizing the payload in a nested `finally`.
   * @param {number} chromeId
   * @param {{ handle: string, target: string, mode: string }} payload
   * @returns {Promise<{ ok: boolean, target?: string, counts?: any, reason?: string }>}
   */
  async function commit(chromeId, payload) {
    const { handle, target, mode } = payload || {};
    if (typeof handle !== 'string' || typeof target !== 'string' || (mode !== 'merge' && mode !== 'replace')) {
      return { ok: false, reason: 'state' };
    }

    const rec = pending.peekSummary(chromeId);
    if (!rec || rec.handle !== handle) return { ok: false, reason: 'state' };

    const store = getStore();
    if (!store.isUnlocked()) return { ok: false, reason: 'locked' };

    try {
      // step 3's VaultStateError (an unresolvable/burner target) rides the SAME
      // mapper + finally-free try as step 7's importLogins throws (leg ruling 1 —
      // ONE try/catch spans steps 3-7; the zeroize-only finally nests inside it
      // from take() onward, since take() hasn't run yet at this point).
      store.resolveTarget(target);

      // Step 4 (DD13 freshness contract): read HERE, immediately before the confirm
      // renders — the source of truth is the on-disk vault, rebuilt on every confirm.
      const existingCount = store.listItems(target).length;

      const label = destLabel(target);
      const detail =
        mode === 'replace'
          ? `This will first delete the ${existingCount} item(s) already in ${label}. ` +
            'Delete the exported CSV file after this import — it contains your passwords in plain text.'
          : `${existingCount} item(s) already there are kept; logins already present are skipped. ` +
            'Delete the exported CSV file after this import — it contains your passwords in plain text.';

      const { response } = await dialog.showMessageBox(windowForChrome(chromeId) ?? undefined, {
        type: 'question',
        buttons: ['Import', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
        title: 'Import passwords',
        message: `Import ${rec.summary.candidateCount} login(s) into ${label}?`,
        detail
      });
      if (response !== 0) return { ok: false, reason: 'declined' };

      // Step 6: re-peek — a lock/window-close may have dropped the record while the
      // dialog was open (the async gap this whole ordering exists to close).
      const stillHeld = pending.peekSummary(chromeId);
      if (!stillHeld || stillHeld.handle !== handle) return { ok: false, reason: 'state' };

      const taken = /** @type {{ payload: Buffer, summary: any }} */ (pending.take(chromeId, handle));
      if (!taken) return { ok: false, reason: 'state' };
      try {
        const { records } = parseCsv(taken.payload.toString('utf8'));
        detectChromeExport(records);
        const { candidates } = adaptChromeRows(records);
        const { results } = store.importLogins(target, candidates, { mode });
        const counts = summarizeOutcomes(taken.summary.skipped, results);
        return { ok: true, target, counts };
      } finally {
        taken.payload.fill(0);
      }
    } catch (e) {
      const mapped = mapVaultSheetError(e, VAULT_BROWSER_IMPORT_COMMIT_CONFIG);
      // VAULT_BROWSER_IMPORT_COMMIT_CONFIG only ever maps to a `{ ok:false, reason }` shape
      // (never the bare-boolean/plain-{ok:false} rules mapVaultSheetError's general return
      // type also admits) — cast-to-local per CLAUDE.md's "Cast-to-local before a chain".
      const commitRefusal = /** @type {{ ok: false, reason: string } | null} */ (mapped);
      if (commitRefusal !== null) return commitRefusal;
      throw e;
    }
  }

  return { begin, summary, cancel, commit };
}

module.exports = { createBrowserImportFlow };
