// @ts-check
'use strict';

// Multi-file transaction primitive for the vault store (Mission 18, Flight 2,
// Leg 2 / flight DD2): journal-first + staged files + single-rename commit +
// idempotent load-time recovery.
//
// SCHEME (ordering is the correctness argument — do not reorder):
//   1. `beginTransaction` writes the JOURNAL FIRST via `writeFileAtomic` (a torn
//      journal is impossible; a kill inside its write leaves only swept `.tmp-*`
//      residue, and journal-first guarantees zero staged files exist at that
//      point). The journal names every member's final and staged name, so
//      recovery never guesses what a crash left behind.
//   2. Each staged file is then written — ALSO via `writeFileAtomic` (design
//      review HIGH: an unsynced staged write would allow durable-commit +
//      torn-staged-content after power loss, the one mixed state no in-process
//      test can catch; the `.tmp-` residue this creates is already
//      sweep-covered).
//   3. `commit` performs the COMMIT DISCRIMINATOR — one atomic rename of the
//      journal from its uncommitted to its committed name (with the same
//      best-effort dir-fsync treatment as atomic-write.js). Journal present
//      UNCOMMITTED ⇒ recovery rolls BACK (deletes the staged files the journal
//      names); present COMMITTED ⇒ recovery rolls FORWARD (finishes the
//      renames). Then the final renames run and the journal is removed.
//   4. `recover` is idempotent (safe to re-run at any point, double-crash
//      included), per-file ENOENT-tolerant, ENOENT-tolerant on a missing
//      directory (fresh profile — `vaults/` is created lazily), and
//      CIPHERTEXT-ONLY: it never reads, parses, or repairs vault content.
//
// NAME FAMILY (single-sourced here; the residue tests import the helpers):
//   uncommitted journal:  txn-<12hex>.journal
//   committed journal:    txn-<12hex>.journal.committed
//   staged member:        <finalName>.stage-<12hex>
// Journal names form ONE recognizable pattern family (`JOURNAL_RE`) so
// `recover`'s scan and `beginTransaction`'s defensive check share a single
// match. Staged names are DISJOINT from `writeFileAtomic`'s `.tmp-<12hex>`
// temp pattern, so the orphan sweep can never delete a committed transaction's
// staged files.
//
// SWEEP CONCURRENCY (argument stated per the leg spec): `writeFileAtomic` is
// fully synchronous and recovery runs synchronously in the store constructor
// before any store op — in-process concurrent `.tmp-` creation during the sweep
// is impossible; cross-process concurrency is out of scope (single app
// instance).
//
// ELECTRON-FREE, deps-light: `node:fs` / `node:path` / `node:crypto` +
// `./atomic-write` only. Synchronous throughout — matches the store idiom and
// keeps the crash-window reasoning simple. `fs` is referenced through the
// module object so the fault-injection suite can monkeypatch single syscalls.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { writeFileAtomic } = require('./atomic-write');

// Journal document format id + version (this module owns the format). Content
// is plain JSON — a txn id and the member name list. NO secrets, NO ciphertext.
const TXN_FORMAT = 'gfvault-txn';
const TXN_VERSION = 1;

// The journal name family: `txn-<12hex>.journal` (uncommitted) and
// `txn-<12hex>.journal.committed` (committed). One regex backs both recover's
// scan and beginTransaction's defensive existing-journal check.
const JOURNAL_RE = /^txn-([0-9a-f]{12})\.journal(\.committed)?$/;

// Staged-member suffix — structurally disjoint from ATOMIC_TMP_RE below.
const STAGE_RE = /\.stage-[0-9a-f]{12}$/;

// writeFileAtomic's temp pattern (`atomic-write.js:38`: `${dest}.tmp-` +
// randomBytes(6).hex → 12 hex chars). The orphan sweep removes ONLY this.
const ATOMIC_TMP_RE = /\.tmp-[0-9a-f]{12}$/;

/**
 * A transaction-layer state/argument problem: malformed members, a journal
 * already present at begin, an impossible two-journal state at recover, a
 * malformed journal document. Always loud — recovery never guesses.
 */
class VaultTxnError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'VaultTxnError';
  }
}

/**
 * @param {string} id
 * @returns {string} the UNCOMMITTED journal file name for txn `id`.
 */
function uncommittedJournalName(id) {
  return `txn-${id}.journal`;
}

/**
 * @param {string} id
 * @returns {string} the COMMITTED journal file name for txn `id`.
 */
function committedJournalName(id) {
  return `txn-${id}.journal.committed`;
}

/**
 * @param {string} finalName
 * @param {string} id
 * @returns {string} the staged sibling name for `finalName` in txn `id`.
 */
function stagedName(finalName, id) {
  return `${finalName}.stage-${id}`;
}

/**
 * Best-effort directory fsync so a just-performed rename is durable — the same
 * treatment as atomic-write.js: some filesystems reject fsync on a directory fd
 * (EINVAL); a failure here must never fail a completed rename.
 * @param {string} dir
 * @returns {void}
 */
function fsyncDirBestEffort(dir) {
  /** @type {number | undefined} */
  let dfd;
  try {
    dfd = fs.openSync(dir, 'r');
    fs.fsyncSync(dfd);
  } catch {
    // best-effort — ignored (EINVAL on FS that disallow dir fsync, etc.).
  } finally {
    if (dfd !== undefined) {
      try {
        fs.closeSync(dfd);
      } catch {
        // best-effort close.
      }
    }
  }
}

/**
 * Validate a member's final name: a plain basename inside `dir`, never a path,
 * and never a name the machinery itself owns (journal / staged / atomic-temp
 * patterns) — a member colliding with the name family would confuse recovery.
 * @param {unknown} finalName
 * @returns {string} the validated name.
 */
function validateFinalName(finalName) {
  if (typeof finalName !== 'string' || finalName.length === 0) {
    throw new VaultTxnError('vault-txn: member finalName must be a non-empty string');
  }
  if (finalName !== path.basename(finalName) || finalName === '.' || finalName === '..') {
    throw new VaultTxnError(`vault-txn: member finalName must be a plain basename (got "${finalName}")`);
  }
  if (JOURNAL_RE.test(finalName) || STAGE_RE.test(finalName) || ATOMIC_TMP_RE.test(finalName)) {
    throw new VaultTxnError(`vault-txn: member finalName collides with the transaction name family ("${finalName}")`);
  }
  return finalName;
}

/**
 * Scan a directory listing for journal files (either state).
 * @param {string[]} names
 * @returns {Array<{ name: string, id: string, committed: boolean }>}
 */
function journalsIn(names) {
  const out = [];
  for (const name of names) {
    const m = JOURNAL_RE.exec(name);
    if (m) out.push({ name, id: m[1], committed: m[2] !== undefined });
  }
  return out;
}

/**
 * Read + strictly validate a journal document. The journal was written via
 * `writeFileAtomic`, so a torn/absent-field journal is an impossible state —
 * throw loudly rather than guess (never roll anything from a document we do not
 * fully trust: recovery renames and unlinks by the names it carries).
 * @param {string} dir
 * @param {{ name: string, id: string }} journal
 * @returns {{ id: string, members: Array<{ finalName: string, stagedName: string }> }}
 */
function readJournal(dir, journal) {
  const text = fs.readFileSync(path.join(dir, journal.name), 'utf8');
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    throw new VaultTxnError(
      `vault-txn: journal ${journal.name} is not valid JSON (${/** @type {Error} */ (err).message})`
    );
  }
  if (!doc || typeof doc !== 'object' || doc.format !== TXN_FORMAT || doc.version !== TXN_VERSION) {
    throw new VaultTxnError(`vault-txn: journal ${journal.name} has an unknown format/version`);
  }
  if (doc.id !== journal.id) {
    throw new VaultTxnError(`vault-txn: journal ${journal.name} carries a mismatched txn id "${doc.id}"`);
  }
  if (!Array.isArray(doc.members) || doc.members.length === 0) {
    throw new VaultTxnError(`vault-txn: journal ${journal.name} has no member list`);
  }
  /** @type {Array<{ finalName: string, stagedName: string }>} */
  const members = [];
  for (const m of doc.members) {
    const finalName = validateFinalName(m?.finalName);
    if (m?.stagedName !== stagedName(finalName, journal.id)) {
      throw new VaultTxnError(`vault-txn: journal ${journal.name} names an out-of-family staged file`);
    }
    members.push({ finalName, stagedName: m.stagedName });
  }
  return { id: journal.id, members };
}

/**
 * Begin a multi-file transaction in `dir`: write the journal FIRST (naming every
 * member's final and staged name), then write each member's staged file — both
 * via `writeFileAtomic`. Nothing observable changes at any final name.
 *
 * DEFENSIVE INVARIANT: refuses if ANY journal (either state) already exists in
 * `dir` — there is never more than one transaction, and a leftover journal means
 * recovery has not run (the caller's constructor bug, surfaced loudly).
 * @param {string} dir  the directory holding the member files (e.g. `vaults/`).
 * @param {Array<{ finalName: string, content: Buffer | string }>} members
 * @returns {{ dir: string, id: string, members: Array<{ finalName: string, stagedName: string }>, committed: boolean }}
 */
function beginTransaction(dir, members) {
  if (typeof dir !== 'string' || dir.length === 0) {
    throw new VaultTxnError('vault-txn: dir is required');
  }
  if (!Array.isArray(members) || members.length === 0) {
    throw new VaultTxnError('vault-txn: members must be a non-empty array');
  }
  const seen = new Set();
  for (const m of members) {
    const finalName = validateFinalName(m?.finalName);
    if (seen.has(finalName)) {
      throw new VaultTxnError(`vault-txn: duplicate member finalName "${finalName}"`);
    }
    seen.add(finalName);
    const content = /** @type {any} */ (m).content;
    if (!Buffer.isBuffer(content) && typeof content !== 'string') {
      throw new VaultTxnError(`vault-txn: member "${finalName}" content must be a Buffer or string`);
    }
  }
  if (journalsIn(fs.readdirSync(dir)).length > 0) {
    throw new VaultTxnError('vault-txn: a transaction journal already exists — recovery has not run');
  }

  const id = crypto.randomBytes(6).toString('hex');
  const named = members.map((m) => ({ finalName: m.finalName, stagedName: stagedName(m.finalName, id) }));

  // 1. Journal FIRST — recovery must never have to guess what a crash left.
  const journalDoc = { format: TXN_FORMAT, version: TXN_VERSION, id, members: named };
  writeFileAtomic(path.join(dir, uncommittedJournalName(id)), Buffer.from(JSON.stringify(journalDoc), 'utf8'));

  // 2. Staged files — each via writeFileAtomic (fsynced: a power loss after the
  // commit rename must never surface torn staged content on roll-forward).
  for (let i = 0; i < members.length; i++) {
    writeFileAtomic(path.join(dir, named[i].stagedName), members[i].content);
  }

  return { dir, id, members: named, committed: false };
}

/**
 * Commit a transaction: the single atomic journal-state rename (uncommitted →
 * committed) is THE durable commit point — before it, recovery rolls back;
 * after it, recovery rolls forward. Then the final renames run and the journal
 * is removed. A crash anywhere in here is repaired by `recover`.
 * @param {{ dir: string, id: string, members: Array<{ finalName: string, stagedName: string }>, committed: boolean }} handle
 * @returns {void}
 */
function commit(handle) {
  if (!handle || typeof handle !== 'object' || typeof handle.id !== 'string' || !Array.isArray(handle.members)) {
    throw new VaultTxnError('vault-txn: commit needs the handle returned by beginTransaction');
  }
  if (handle.committed) {
    throw new VaultTxnError('vault-txn: transaction already committed');
  }
  const { dir, id } = handle;

  // THE COMMIT DISCRIMINATOR — one atomic same-directory rename, made durable
  // with the same best-effort dir-fsync treatment as atomic-write.js.
  fs.renameSync(path.join(dir, uncommittedJournalName(id)), path.join(dir, committedJournalName(id)));
  fsyncDirBestEffort(dir);
  handle.committed = true;

  // Final renames (each atomic per-file; a crash mid-way is rolled forward).
  for (const m of handle.members) {
    fs.renameSync(path.join(dir, m.stagedName), path.join(dir, m.finalName));
  }

  // Post-roll cleanup: the transaction is complete — remove the journal.
  fs.unlinkSync(path.join(dir, committedJournalName(id)));
  fsyncDirBestEffort(dir);
}

/**
 * Idempotent load-time recovery. Committed journal ⇒ roll FORWARD (finish the
 * renames, ENOENT-tolerant per file, remove the journal); uncommitted journal ⇒
 * roll BACK (delete the journal-named staged files, ENOENT-tolerant, remove the
 * journal); then one bounded `readdir` sweep deletes only
 * `writeFileAtomic`-pattern `*.tmp-<12hex>` orphans. Safe to re-run at any
 * point (double-crash included). A missing `dir` (fresh profile — `vaults/` is
 * created lazily) is a silent no-op. NEVER reads, parses, or repairs vault
 * content. Finding two journals is an impossible state and throws loudly.
 * @param {string} dir
 * @returns {void}
 */
function recover(dir) {
  /** @type {string[]} */
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    if (/** @type {any} */ (err).code === 'ENOENT') return; // fresh profile — nothing to recover.
    throw err;
  }

  const journals = journalsIn(names);
  if (journals.length > 1) {
    // beginTransaction refuses while any journal exists, so two journals can
    // never be produced by this machinery — never guess which one to honor.
    throw new VaultTxnError(
      `vault-txn: found ${journals.length} transaction journals — impossible state, refusing to guess`
    );
  }

  if (journals.length === 1) {
    const journal = journals[0];
    const doc = readJournal(dir, journal);
    if (journal.committed) {
      // Roll FORWARD: finish the renames. ENOENT-tolerant per file — a member
      // whose staged file is gone was already renamed before the crash.
      for (const m of doc.members) {
        try {
          fs.renameSync(path.join(dir, m.stagedName), path.join(dir, m.finalName));
        } catch (err) {
          if (/** @type {any} */ (err).code !== 'ENOENT') throw err;
        }
      }
    } else {
      // Roll BACK: delete the journal-named staged files. ENOENT-tolerant — the
      // kill-between-journal-and-staging case rolls back as a natural no-op.
      for (const m of doc.members) {
        try {
          fs.unlinkSync(path.join(dir, m.stagedName));
        } catch (err) {
          if (/** @type {any} */ (err).code !== 'ENOENT') throw err;
        }
      }
    }
    try {
      fs.unlinkSync(path.join(dir, journal.name));
    } catch (err) {
      if (/** @type {any} */ (err).code !== 'ENOENT') throw err;
    }
    fsyncDirBestEffort(dir);
  }

  // Bounded orphan sweep: ONLY writeFileAtomic-pattern temp names (a hard kill
  // INSIDE writeFileAtomic leaves a random-suffixed `.tmp-*` no journal can
  // name). Staged names are structurally disjoint, so a committed transaction's
  // staged files can never match. Fresh listing — the roll above changed it.
  for (const name of fs.readdirSync(dir)) {
    if (ATOMIC_TMP_RE.test(name)) {
      try {
        fs.unlinkSync(path.join(dir, name));
      } catch (err) {
        if (/** @type {any} */ (err).code !== 'ENOENT') throw err;
      }
    }
  }
}

module.exports = {
  beginTransaction,
  commit,
  recover,
  VaultTxnError,
  // Name-family helpers — single-sourced so the residue-construction tests and
  // any future consumer never re-type the patterns.
  uncommittedJournalName,
  committedJournalName,
  stagedName
};
