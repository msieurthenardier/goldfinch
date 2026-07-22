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
//   • the target is not itself an existing directory (refuse clobbering a dir)
//   • the parent directory EXISTS, is a directory, and is writable (no writing into a missing
//     tree / a non-writable location)
// On success returns { ok:true, path } where `path` is the RESOLVED absolute path (what main
// should actually write).

const fs = require('node:fs');
const path = require('node:path');

/** Allowed export-file extensions (lower-cased, dot-prefixed). */
const ALLOWED_EXT = new Set(['.gfvaultbundle', '.json']);

/**
 * @param {unknown} savePath  the renderer-supplied save path (dialog-picked OR typed/pasted).
 * @returns {{ ok: boolean, path?: string, reason?: string }}  ok:true carries the RESOLVED
 *   absolute `path`; ok:false carries a `reason` (empty | extension | is-directory | no-parent |
 *   not-writable).
 */
function validateExportPath(savePath) {
  if (typeof savePath !== 'string' || savePath.trim().length === 0) {
    return { ok: false, reason: 'empty' };
  }
  // path.resolve canonicalizes and collapses any `..` traversal into an absolute path.
  const resolved = path.resolve(savePath);
  const ext = path.extname(resolved).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    return { ok: false, reason: 'extension' };
  }
  // Refuse writing ONTO an existing directory.
  let targetStat;
  try { targetStat = fs.statSync(resolved); } catch { targetStat = undefined; }
  if (targetStat && targetStat.isDirectory()) {
    return { ok: false, reason: 'is-directory' };
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
