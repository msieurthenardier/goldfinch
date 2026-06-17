'use strict';
// Derive the dev-isolated userData path from Electron's default userData path.
// Pure + electron-free so it unit-tests without an Electron runtime (DD1).

/**
 * Returns the default userData path with `-dev` appended to its final path segment
 * (`/home/x/.config/goldfinch` -> `/home/x/.config/goldfinch-dev`). The `/[\\/]+$/`
 * quantifier collapses any run of trailing separators, so `…/goldfinch`,
 * `…/goldfinch/`, and `…/goldfinch//` all yield `…/goldfinch-dev` (no stray separator).
 * Handles both POSIX `/` and Windows `\` separators.
 *
 * @param {string} defaultUserDataPath  Electron's default app.getPath('userData')
 * @returns {string}
 */
function devUserDataPath(defaultUserDataPath) {
  return defaultUserDataPath.replace(/[\\/]+$/, '') + '-dev';
}

module.exports = { devUserDataPath };
