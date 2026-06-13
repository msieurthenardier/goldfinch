// @ts-check
'use strict';
// Dev gate for the interim automation seam (DD7). True when the process was launched with the
// dev debugging port (browser process) OR carries the injected --automation-dev marker (renderer
// process, set via the chrome window's additionalArguments). Pure; never throws.

/**
 * Returns true iff the process was launched in automation-dev mode:
 * - The main process: carries `--remote-debugging-port` (any value) in argv.
 * - The chrome renderer process: carries the injected `--automation-dev` marker
 *   (set via additionalArguments in the chrome BrowserWindow webPreferences).
 * False for any non-array input or when neither flag is present.
 *
 * @param {unknown} argv  typically process.argv
 * @returns {boolean}
 */
function isAutomationDevEnabled(argv) {
  return Array.isArray(argv) && argv.some(
    (a) => typeof a === 'string' && (a.startsWith('--remote-debugging-port') || a === '--automation-dev')
  );
}

module.exports = { isAutomationDevEnabled };
