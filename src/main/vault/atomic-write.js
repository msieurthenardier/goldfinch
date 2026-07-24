// @ts-check
'use strict';

// Atomic file writer for the vault store (Mission 12, Flight 1, Leg 2).
//
// The `.gfvault` / `manager.json` files are NOT `app.db` rows (DD1) — they are
// self-contained JSON documents written directly to `userData/vaults/`. Post-M10
// the other stores moved onto SQLite rows, so there is no live temp-write+rename
// helper left to reuse; this module is that helper, kept tiny and independently
// testable.
//
// Durability contract: the destination is never observed in a partial state. We
// write a uniquely-named temp file in the SAME directory (so `rename` is a
// same-filesystem atomic swap), fsync the file, then `rename` it over the
// destination. On any error the temp file is unlinked (best-effort, inside its
// OWN try so a cleanup failure can't mask the original throw) and the error is
// rethrown with the destination untouched.
//
// ELECTRON-FREE: `node:fs` / `node:path` / `node:crypto` only. Synchronous —
// matches the store idiom and keeps the crash-window reasoning simple. `fs` is
// referenced through the module object (`fs.renameSync`, not a destructured
// const) so the unit suite can monkeypatch a single call to simulate a crash.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

/**
 * Atomically write `buf` to `destPath`. On success the destination holds exactly
 * `buf`; on any failure the destination is left exactly as it was (or absent, if
 * it did not exist) and no temp file remains.
 * @param {string} destPath
 * @param {Buffer | string} buf
 * @returns {void}
 */
function writeFileAtomic(destPath, buf) {
  const dir = path.dirname(destPath);
  const tmp = `${destPath}.tmp-${crypto.randomBytes(6).toString('hex')}`;
  /** @type {number | undefined} */
  let fd;
  try {
    fd = fs.openSync(tmp, 'wx');
    fs.writeSync(fd, /** @type {any} */ (Buffer.isBuffer(buf) ? buf : Buffer.from(buf, 'utf8')));
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmp, destPath);
    // Best-effort directory fsync so the rename itself is durable. Some
    // filesystems reject fsync on a directory fd (EINVAL) — swallow that (and
    // any other dir-fsync failure): the file-level fsync + rename already give
    // the atomicity guarantee, and this must never fail a completed write.
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
  } catch (err) {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // best-effort close before cleanup.
      }
    }
    // Unlink the temp file inside its OWN best-effort try so a cleanup failure
    // does not mask the original error. The destination is never touched.
    try {
      fs.unlinkSync(tmp);
    } catch {
      // best-effort — nothing more we can do.
    }
    throw err;
  }
}

module.exports = { writeFileAtomic };
