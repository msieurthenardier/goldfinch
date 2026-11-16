// @ts-check
'use strict';

// Owner-only file modes for profile and vault data (leg `clipboard-and-file-modes`, flight DD7,
// mission finding 21). Electron-free: `fs` and the logger are injected.
//
// Two jobs, both BEST-EFFORT and never fatal (a read-only profile, FAT, a network filesystem and
// Windows all ignore or refuse mode bits): create what we own owner-only (`OWNER_FILE` 0o600,
// `OWNER_DIR` 0o700), and tighten what already exists - once, at open, never on a timer. No code
// path may depend on the resulting mode. A failure is logged ONCE per instance, not per file.

const nodePath = require('node:path');

const OWNER_FILE = 0o600;
const OWNER_DIR = 0o700;

/** The database family in the profile directory: `app.db`, `history.db`, their sidecars, quarantines. */
const DB_FAMILY_RE = /^(app|history)\.db(-wal|-shm)?(\.corrupt-\d+)?$/;
/** Quarantined `-wal`/`-shm` siblings are renamed WITH the suffix appended after the extension. */
const DB_QUARANTINE_SIDECAR_RE = /^(app|history)\.db(-wal|-shm)\.corrupt-\d+$/;
/** A legacy JSON store imported once and renamed. */
const MIGRATED_RE = /\.migrated$/;

/**
 * @param {{ fs: typeof import('node:fs'), logger?: { warn?: (...a: any[]) => void } }} deps
 */
function createFileModes({ fs, logger = console }) {
  let reported = false;

  /** @param {unknown} err @param {string} what */
  function report(err, what) {
    if (reported) return;
    reported = true;
    const code = err && typeof err === 'object' && 'code' in err ? String(/** @type {any} */ (err).code) : 'error';
    logger.warn?.(`[file-modes] could not set owner-only mode on ${what} (${code}); continuing (logged once)`);
  }

  let linkReported = false;
  /**
   * What `p` is WITHOUT following a link: 'file' | 'dir' | 'link' | 'other', or null when it does not
   * exist (or cannot be examined). A symbolic link is never chmodded - `chmodSync` follows it, so a link
   * inside the profile could change the mode of a target outside it. Skipped and logged once.
   * @param {string} p
   */
  function kindOf(p) {
    try {
      const st = fs.lstatSync(p);
      if (st.isSymbolicLink()) {
        if (!linkReported) {
          linkReported = true;
          logger.warn?.('[file-modes] skipped a symbolic link (not followed, mode unchanged; logged once)');
        }
        return 'link';
      }
      if (st.isFile()) return 'file';
      if (st.isDirectory()) return 'dir';
      return 'other';
    } catch {
      return null;
    }
  }

  /** @param {string} p */
  function chmodFile(p) {
    const kind = kindOf(p);
    if (kind === null) return;
    if (kind !== 'file') return;
    try {
      fs.chmodSync(p, OWNER_FILE);
    } catch (err) {
      if (/** @type {any} */ (err)?.code !== 'ENOENT') report(err, 'a file');
    }
  }

  /** Create `dir` (recursive) owner-only, and tighten it if it already existed. @param {string} dir */
  function ensureOwnerDir(dir) {
    try {
      fs.mkdirSync(dir, { recursive: true, mode: OWNER_DIR });
    } catch (err) {
      // A failed mkdir is the caller's own problem (it still does its own mkdir); not ours to throw.
      report(err, 'a directory');
      return;
    }
    if (kindOf(dir) !== 'dir') return;
    try {
      fs.chmodSync(dir, OWNER_DIR);
    } catch (err) {
      report(err, 'a directory');
    }
  }

  /** @param {string} dir An existing directory whose mode is tightened (no create). */
  function chmodDir(dir) {
    if (kindOf(dir) !== 'dir') return;
    try {
      fs.chmodSync(dir, OWNER_DIR);
    } catch (err) {
      if (/** @type {any} */ (err)?.code !== 'ENOENT') report(err, 'a directory');
    }
  }

  /**
   * Tighten every regular file directly in `dir` whose name matches `test`.
   * @param {string} dir
   * @param {(name: string) => boolean} test
   */
  function tightenFilesIn(dir, test) {
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch (err) {
      if (/** @type {any} */ (err)?.code !== 'ENOENT') report(err, 'a directory listing');
      return;
    }
    for (const name of names) {
      if (!test(name)) continue;
      const full = nodePath.join(dir, name);
      if (kindOf(full) !== 'file') continue;
      chmodFile(full);
    }
  }

  /**
   * Pre-create `file` owner-only (open-append-close) when it is absent, so a SQLite database - and
   * its `-wal` / `-shm` sidecars, which inherit the main file's mode - is born 0600. An existing
   * file is tightened instead. A zero-length file is a valid empty SQLite database.
   * @param {string} file
   */
  function precreateOwnerFile(file) {
    try {
      if (kindOf(file) !== null) {
        chmodFile(file); // a link or other non-regular entry is skipped inside
        return;
      }
      // 'ax' (O_EXCL): never opens through a link that appeared since the check.
      const fd = fs.openSync(file, 'ax', OWNER_FILE);
      fs.closeSync(fd);
    } catch (err) {
      report(err, 'a database file');
    }
  }

  /**
   * Run before a database is opened: pre-create it owner-only, then tighten its existing family
   * (sidecars, `.corrupt-*` quarantines) and any `*.migrated` import renames in the same directory.
   * @param {string} dbPath
   */
  function prepareDatabaseFiles(dbPath) {
    const dir = nodePath.dirname(dbPath);
    precreateOwnerFile(dbPath);
    if (dir) {
      tightenFilesIn(dir, (n) => DB_FAMILY_RE.test(n) || DB_QUARANTINE_SIDECAR_RE.test(n) || MIGRATED_RE.test(n));
    }
  }

  return { chmodFile, chmodDir, ensureOwnerDir, tightenFilesIn, precreateOwnerFile, prepareDatabaseFiles };
}

module.exports = { createFileModes, OWNER_FILE, OWNER_DIR, DB_FAMILY_RE, MIGRATED_RE };
