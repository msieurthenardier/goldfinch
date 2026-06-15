// @ts-check
'use strict';
// Dev gates for the automation surface. Two predicates with deliberately different scopes:
//   - isAutomationDevEnabled — the LEGACY interim dev seam (DD7): true for `--remote-debugging-port`
//     OR `--automation-dev`. Originally the main process keyed on the CDP port and the chrome
//     renderer on the injected `--automation-dev` marker (set via the chrome window's
//     additionalArguments).
//   - isMcpAutomationEnabled — the NARROWER MCP-transport gate (DD4): true ONLY for `--automation-dev`.
//     Note `--automation-dev` is now also read in the MAIN process (to gate the MCP server), not only
//     as the renderer-injected marker it was previously documented as.
// Both are pure; neither throws.

/**
 * Returns true iff the process was launched in automation-dev mode (legacy seam, DD7):
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

/**
 * Returns true iff argv carries the EXACT `--automation-dev` token — the narrower MCP-transport gate
 * (DD4). Deliberately does NOT match `--remote-debugging-port`: gating the MCP server on this predicate
 * keeps it STRUCTURALLY decoupled from the CDP port, so `npm run dev:debug` (which launches with
 * `--remote-debugging-port` but no `--automation-dev`) does NOT start the MCP server. This is what makes
 * the Flight-3 DD10 DevTools test confound-free. `--automation-dev` is read here in the MAIN process.
 *
 * False for any non-array input, an empty array, or when the exact token is absent (a prefix like
 * `--automation-dev-extra` does not match).
 *
 * @param {unknown} argv  typically process.argv
 * @returns {boolean}
 */
function isMcpAutomationEnabled(argv) {
  return Array.isArray(argv) && argv.includes('--automation-dev');
}

module.exports = { isAutomationDevEnabled, isMcpAutomationEnabled };
