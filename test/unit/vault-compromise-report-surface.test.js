'use strict';

// M18 F2 L4 — the compromise-mode REVOCATION-REPORT surface, end-to-end across
// every unit-reachable hop, with a REAL store (regression net for behavior-test
// run 2026-09-02-02-22-01, checkpoint 7: the "Everything rotated" card rendered
// an EMPTY revoked-keys list).
//
// WHY THIS SUITE EXISTS — what the leg-4 suites modeled optimistically:
// vault-compromise-handlers.test.js drives the real overlay registrar but stubs
// `vaultCompromiseRotate` with a CANNED reply carrying `revoked` in exactly the
// shape the stash expects, and surfaces the report into a harness-local
// variable; register-vault-ipc.test.js likewise injects a hand-built report
// into `getCompromiseReport`. So the {admin, vaultIds} shape was ASSERTED at
// each hop but never DERIVED across hops — had any hop renamed or misshapen the
// field (store return → main-side delegate/stash → internal-vault-state →
// page model → card rows), every leg-4 suite would still have passed. This
// suite composes the chain for real: a real VaultStore rotation feeds the real
// registerOverlayIpc handler through a faithful transcription of main.js's
// delegate + stash glue (main.js itself requires Electron), and the resulting
// session report is read back through the real registerVaultIpc state handler,
// the real selectVaultView normalization, and the real compromiseCardRows
// row model — the exact objects the page renders from.
//
// Forensic note (run 2026-09-02-02-22-01): tracing this chain found NO drop —
// this suite passed against the shipped modules on first composition. The
// checkpoint-7 empty card matches the operator's off-script SECOND completed
// rotation (recovery branch, manager.json mtime 02:47:11Z, 85s after the
// witnessed rotation's 02:45:46Z commit): a repeat rotation has nothing left to
// revoke, its report legitimately OVERWRITES the session-held one (DD6
// last-rotation-wins), and the capture postdated it. Both truths are pinned
// below: a first rotation's populated rows, and a repeat rotation's non-null
// report with ZERO rows (the spec's "empty list is CORRECT after a second
// rotation" distinction).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const vaultStoreModule = require('../../src/main/vault/vault-store');
const { registerOverlayIpc } = require('../../src/main/register-overlay-ipc');
const { registerVaultIpc } = require('../../src/main/register-vault-ipc');
const { createSuppressionHolder } = require('../../src/main/vault/autolock-suppression');
const { createCompromiseRevealStore } = require('../../src/main/vault/pending-compromise-reveals');
const { selectVaultView, compromiseCardRows } = require('../../src/shared/vault-page-model.js');
const { mapVaultSheetError, VAULT_COMPROMISE_ROTATE_CONFIG } = require('../../src/main/vault/vault-sheet-errors');

const FAST_SCRYPT = { algo: 'scrypt', N: 2 ** 12, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const OLD_MASTER = 'old compromised master';
const NEW_MASTER = 'entirely different new master';
const NEWER_MASTER = 'a third, different master';
const JARS = [{ id: 'work' }, { id: 'personal' }];

function loginItem(overrides = {}) {
  return { type: 'login', title: 'Example', username: 'u', password: 'hunter2', ...overrides };
}

/**
 * The main.js composition (main.js is not importable — it requires Electron at
 * load): the compromise delegate over the real store (main.js `vaultCompromiseRotate`)
 * — since M18 F3 L1 (DD9) composed from the REAL error mapper module
 * (vault-sheet-errors.js) with main.js's own VAULT_COMPROMISE_ROTATE_CONFIG, so a
 * future mapping change fails loudly here instead of silently diverging — and the
 * stash that normalizes `revoked` into the session-held report (main.js
 * `stashCompromiseReveal`), which remains a faithful hand-transcription (it holds no
 * error-mapping logic to import). Keep the stash in lockstep with main.js — it is the
 * only still-replicated hop in this chain.
 */
function makeMainComposition(store) {
  const holder = createSuppressionHolder({ setSuspended: () => {} });
  const reveals = createCompromiseRevealStore(holder);
  /** @type {{ admin: boolean, vaultIds: string[] } | null} */
  let _compromiseReport = null;

  function stashCompromiseReveal(chromeId, { recoveryKey, revoked }) {
    _compromiseReport = revoked
      ? {
          admin: revoked.admin === true,
          vaultIds: Array.isArray(revoked.vaultIds) ? revoked.vaultIds.filter((id) => typeof id === 'string') : []
        }
      : { admin: false, vaultIds: [] };
    reveals.stash(chromeId, recoveryKey);
  }

  const vaultCompromiseRotate = async ({ oldMasterPassword, recoveryKey, newMasterPassword }) => {
    try {
      const args = recoveryKey
        ? { recoveryKey: recoveryKey.toString('utf8'), newMasterPassword }
        : { oldMasterPassword, newMasterPassword };
      const res = await store.compromiseRotate(args);
      return { ok: true, recoveryKey: res.recoveryKey, revoked: res.revoked };
    } catch (e) {
      // M18 F3 L1 (DD9): composed from the REAL mapper module (vault-sheet-errors.js)
      // with main.js's own VAULT_COMPROMISE_ROTATE_CONFIG, never a transcribed ladder.
      const mapped = mapVaultSheetError(e, VAULT_COMPROMISE_ROTATE_CONFIG);
      if (mapped !== null) return mapped;
      throw e;
    }
  };

  return {
    vaultCompromiseRotate,
    stashCompromiseReveal,
    getCompromiseReport: () => _compromiseReport,
    clearCompromiseReport: () => {
      _compromiseReport = null;
    }
  };
}

/**
 * Real overlay registrar over a stubbed sheet (the vault-compromise-handlers.test.js
 * harness idiom). `onStash` lets a test snoop the one-time recovery key the handler
 * stashes (it never rides the invoke reply) without altering the main.js transcription.
 */
function makeOverlayHarness(main, { menuType, onStash }) {
  const handlers = new Map();
  const ipcMain = { on: () => {}, handle: (ch, fn) => handlers.set(ch, fn) };
  const sheetSender = { isDestroyed: () => false };
  const win = { id: 1, isDestroyed: () => false };
  const sheet = {
    getView: () => ({ webContents: sheetSender }),
    getCurrentMenu: () => ({ token: 7, menuType }),
    closeMenuOverlay: () => {}
  };
  const rec = { sheet, win };
  registerOverlayIpc({
    ipcMain,
    registry: { records: () => [rec], getWindowForChrome: () => null },
    chromeForAttachment: (w) => (w === win ? { id: 100, send: () => {} } : null),
    chromeForTab: () => null,
    sanitizeActivatedValue: () => undefined,
    vaultCompromiseRotate: main.vaultCompromiseRotate,
    stashCompromiseReveal: (chromeId, reveal) => {
      if (onStash) onStash(reveal);
      main.stashCompromiseReveal(chromeId, reveal);
    },
    ackVaultReveal: () => true
  });
  return { handlers, sheetSender };
}

/** Real internal-vault-state surface over the same session report. */
function readPageView(store, main) {
  const handlers = new Map();
  registerVaultIpc({
    ipcMain: { handle: (ch, fn) => handlers.set(ch, fn) },
    registerInternalHandler: (ipc, ch, fn) => ipc.handle(ch, fn),
    getVaultStore: () => store,
    jars: {
      list: () => [
        { id: 'work', name: 'Work' },
        { id: 'personal', name: 'Personal' }
      ]
    },
    getCompromiseReport: main.getCompromiseReport,
    clearCompromiseReport: main.clearCompromiseReport
  });
  const state = handlers.get('internal-vault-state')();
  const view = selectVaultView(state);
  return { state, view, rows: compromiseCardRows(view.compromiseReport, view.vaults) };
}

test('report surface end-to-end: a rotation WITH revocations renders the admin row + per-vault display labels (incl. GLOBAL), then a repeat rotation renders the correct EMPTY list', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-report-surface-'));
  try {
    const store = vaultStoreModule.load(dir, {
      scryptParams: FAST_SCRYPT,
      getAutoLockMinutes: () => 10,
      listJars: () => JARS
    });
    // A v1 admin-provisioned profile with items in global + personal and a minted
    // access key on EACH (the checkpoint-7 fixture, plus the GLOBAL_ID target the
    // store suite pins — its display label must resolve like any jar's).
    await store.setup({ masterPassword: OLD_MASTER });
    store.saveItem('global', loginItem({ id: 'g1' }));
    store.saveItem('personal', loginItem({ id: 'p1' }));
    await store.mintAccessKey('global', { masterPassword: OLD_MASTER });
    await store.mintAccessKey('personal', { masterPassword: OLD_MASTER });

    const main = makeMainComposition(store);

    // ---- rotation 1: the master branch (the witnessed run's completed rotation).
    /** @type {{ recoveryKey?: string }} */
    const stashed = {};
    const h1 = makeOverlayHarness(main, {
      menuType: 'vault-compromise',
      onStash: (reveal) => {
        stashed.recoveryKey = reveal.recoveryKey;
      }
    });
    const reply1 = await h1.handlers.get('menu-overlay:vault-compromise')(
      { sender: h1.sheetSender },
      {
        token: 7,
        oldSecret: new Uint8Array(Buffer.from(OLD_MASTER, 'utf8')),
        newSecret: new Uint8Array(Buffer.from(NEW_MASTER, 'utf8'))
      }
    );
    assert.deepEqual(reply1, { ok: true }, 'the invoke reply carries NO secret and NO report');
    const first = readPageView(store, main);
    assert.deepEqual(
      first.state.compromiseReport,
      { admin: true, vaultIds: ['global', 'personal'] },
      'the real rotation report reaches internal-vault-state intact'
    );
    assert.deepEqual(
      first.rows,
      [
        { label: 'Admin key', hint: '— Revoked' },
        { label: 'Global', hint: '— Revoked' },
        { label: 'Personal', hint: '— Revoked' }
      ],
      'the card rows: admin first, then display labels — global resolved to its label'
    );

    // ---- rotation 2: the RECOVERY branch (the run's off-script repeat rotation),
    // using rotation 1's one-time recovery key. Nothing is left to revoke.
    assert.equal(typeof stashed.recoveryKey, 'string', 'rotation 1 stashed its one-time recovery display');
    const h2 = makeOverlayHarness(main, { menuType: 'vault-compromise-recover' });
    const reply2 = await h2.handlers.get('menu-overlay:vault-compromise-recover')(
      { sender: h2.sheetSender },
      {
        token: 7,
        recoverySecret: new Uint8Array(Buffer.from(stashed.recoveryKey, 'utf8')),
        newSecret: new Uint8Array(Buffer.from(NEWER_MASTER, 'utf8'))
      }
    );
    assert.deepEqual(reply2, { ok: true });
    const second = readPageView(store, main);
    assert.deepEqual(
      second.state.compromiseReport,
      { admin: false, vaultIds: [] },
      'a repeat rotation OVERWRITES the session report with its own (last-rotation-wins, DD6)'
    );
    assert.notEqual(second.view.compromiseReport, null, 'the card still renders — the report is non-null');
    assert.deepEqual(second.rows, [], 'and its revoked-keys list is CORRECTLY empty');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
