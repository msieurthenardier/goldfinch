// @ts-check
'use strict';

// Pre-ready Shields config reader (sortie 02 DD2). Native cookie isolation is
// a Chromium feature switch that must be set BEFORE `app.ready`, but Shields
// loads inside `whenReady` (app.db is opened there). This module resolves the
// persisted config read-only, mirroring `shields.load`'s order:
//   app.db row -> legacy shields.json (read-only, NEVER renamed) -> DEFAULTS.
// Fail-closed: any read failure falls through, ending at DEFAULTS (isolation
// on). Electron-free, injected deps; NEVER throws.

const path = require('path');
const { DEFAULTS, parseShieldsConfig } = require('./shields');

const LEGACY_FILE_NAME = 'shields.json';

/**
 * @param {{
 *   userDataPath: string,
 *   peek: (userDataPath: string, store: string) => string | null,
 *   fs: { existsSync(p: string): boolean, readFileSync(p: string, enc: 'utf8'): string }
 * }} deps
 * @returns {typeof DEFAULTS}
 */
function readStartupShieldsConfig({ userDataPath, peek, fs }) {
  try {
    const row = peek(userDataPath, 'shields');
    if (row !== null && row !== undefined) return parseShieldsConfig(row);
  } catch {
    // unreadable / corrupt / locked / no documents table -> legacy peek
  }
  try {
    const file = path.join(userDataPath, LEGACY_FILE_NAME);
    if (fs.existsSync(file)) return parseShieldsConfig(fs.readFileSync(file, 'utf8'));
  } catch {
    // fall through to defaults
  }
  return { ...DEFAULTS };
}

module.exports = { readStartupShieldsConfig };
