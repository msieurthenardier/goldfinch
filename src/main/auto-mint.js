// @ts-check
'use strict';
// Dev auto-mint target resolution (M06 F2 DD7), split out of src/shared/automation-dev.js
// in the flight-02 ESM-conversion divert. WHY THIS LIVES MAIN-SIDE: it requires burner.js,
// which is now a real ES module — and preload require graphs must stay ESM-free
// (chrome-preload.js requires automation-dev.js with the RENDERER process's Node require,
// which has NO require(esm) support; a transitive burner require kills the preload).
// The main process's require(esm) IS supported (live-proven, flight 02 leg 1 boot), and
// resolveAutoMintTarget's only callers are main.js and unit tests — both require(esm)-capable.

const { BURNER } = require('../shared/burner');

/**
 * Resolves the dev auto-mint target (M06 F2 DD7): the id of the jar that currently
 * holds the default flag, or `null` when the resolved default is the Burner sentinel
 * (an empty jar registry — the mint guard refuses burner ids, so there is nothing to
 * mint). Id-compared against BURNER.id, never reference-compared — jars.getDefault()
 * may cross process/IPC boundaries where reference identity does not survive
 * (same discipline as DD3's reconciliation contract).
 *
 * Pure; never throws for a conforming `jars` argument.
 *
 * @param {{ getDefault: () => { id: string } }} jars
 * @returns {string | null}
 */
function resolveAutoMintTarget(jars) {
  const d = jars.getDefault();
  return d && d.id !== BURNER.id ? d.id : null;
}

module.exports = { resolveAutoMintTarget };
