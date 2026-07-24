// @ts-check
'use strict';

// Export-path validation (M12 F5 HAT tail). The vault page's Export modal honors a TYPED/PASTED
// save path (operator ask — the field looks like a real uploader), and vaultSaveBundleToFile
// writes a renderer-supplied path directly with fs.writeFileSync. Without validation that is a
// write-anywhere primitive driven by the page. This module gates a renderer-supplied path BEFORE
// any write.
//
// ELECTRON-FREE (node built-ins only) so it unit-tests headlessly with real temp dirs.
//
// Rules — ALL must hold (else { ok:false, reason }):
//   • a non-empty string
//   • canonicalized via path.resolve (traversal like `../../x` is normalized to a canonical
//     absolute path; the decision below never depends on cwd relativity)
//   • the extension is `.gfvaultbundle` or `.json` (case-insensitive) — never an arbitrary target
//   • the target does not ALREADY EXIST (reason 'exists') unless `allowOverwrite` is passed —
//     the typed/pasted field bypasses the native save dialog's overwrite confirmation, so a
//     silent `writeFileSync` truncation of an arbitrary existing `.json` (e.g. a project's
//     package.json) is a clobber-anywhere primitive. Fail closed: a typed path must name a NEW
//     file, or the operator must re-pick through the native dialog (which confirms overwrites)
//     [PR#112 finding 7].
//   • the target is not itself an existing directory (refuse clobbering a dir)
//   • the target is not an existing SYMLINK (reason 'symlink') — a symlink is a redirect to an
//     arbitrary, possibly non-`.json` file outside the visible target, so writing through it is
//     never in scope. Detected with lstat (never followed) [PR#112 finding 7].
//   • the parent directory EXISTS, is a directory, and is writable (no writing into a missing
//     tree / a non-writable location)
// On success returns { ok:true, path } where `path` is the RESOLVED absolute path (what main
// should actually write). The caller pairs a fresh target with an exclusive-create write
// (`flag:'wx'`) to close the validate→write TOCTOU.

const fs = require('node:fs');
const path = require('node:path');

/** Allowed export-file extensions (lower-cased, dot-prefixed). */
const ALLOWED_EXT = new Set(['.gfvaultbundle', '.json']);

/**
 * @param {unknown} savePath  the renderer-supplied save path (dialog-picked OR typed/pasted).
 * @param {{ allowOverwrite?: boolean }} [opts]  when `allowOverwrite` is true an existing regular
 *   file is permitted (the operator confirmed it) — a symlink / directory is STILL refused.
 * @returns {{ ok: boolean, path?: string, reason?: string }}  ok:true carries the RESOLVED
 *   absolute `path`; ok:false carries a `reason` (empty | extension | symlink | is-directory |
 *   exists | no-parent | not-writable).
 */
function validateExportPath(savePath, { allowOverwrite = false } = {}) {
  if (typeof savePath !== 'string' || savePath.trim().length === 0) {
    return { ok: false, reason: 'empty' };
  }
  // path.resolve canonicalizes and collapses any `..` traversal into an absolute path.
  const resolved = path.resolve(savePath);
  const ext = path.extname(resolved).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    return { ok: false, reason: 'extension' };
  }
  // lstat (NOT stat) so a symlink is seen as a symlink, never followed to its target.
  let targetStat;
  try { targetStat = fs.lstatSync(resolved); } catch { targetStat = undefined; }
  if (targetStat) {
    // A symlink redirects the write to an arbitrary file outside the visible target — never in scope.
    if (targetStat.isSymbolicLink()) {
      return { ok: false, reason: 'symlink' };
    }
    // Refuse writing ONTO an existing directory.
    if (targetStat.isDirectory()) {
      return { ok: false, reason: 'is-directory' };
    }
    // An existing regular file is refused unless the caller explicitly opted into overwrite —
    // the typed field otherwise silently truncates whatever `.json` it names (finding 7).
    if (!allowOverwrite) {
      return { ok: false, reason: 'exists' };
    }
  }
  // The parent directory must exist and be a directory.
  const parent = path.dirname(resolved);
  let parentStat;
  try { parentStat = fs.statSync(parent); } catch { parentStat = undefined; }
  if (!parentStat || !parentStat.isDirectory()) {
    return { ok: false, reason: 'no-parent' };
  }
  // ...and be writable.
  try {
    fs.accessSync(parent, fs.constants.W_OK);
  } catch {
    return { ok: false, reason: 'not-writable' };
  }
  return { ok: true, path: resolved };
}

module.exports = { validateExportPath, ALLOWED_EXT };
