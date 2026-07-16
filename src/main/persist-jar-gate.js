// @ts-check
'use strict';

// Persist-jar gate (M09 Flight 9, Leg 2, AC0) — the SINGLE definition of the
// mission's security-critical burner boundary: a tab is a persist-jar tab iff it
// is not trusted AND its partition resolves to a registered jar. This is the
// POSITIVE allowlist (the history-recorder precedent) — burner (`burner:<n>`) and
// internal partitions match nothing here, so they resolve to null with NO negative
// "is-it-a-burner" check anywhere. Shared by BOTH session-snapshot.js and
// closed-tab-capture.js so the two suites cannot drift on the boundary the mission
// calls absolute. Electron-free: reads only the injected tab entry + jars snapshot.

/**
 * Resolve a tab entry to its persist jar, or null when it must be dropped.
 * @param {{ partition: string, trusted: boolean }} tabEntry
 * @param {Array<{ id: string, partition: string }>} jarsList
 * @returns {{ id: string, partition: string } | null}
 */
function resolvePersistJar(tabEntry, jarsList) {
  return !tabEntry.trusted && jarsList.find((j) => j.partition === tabEntry.partition) || null;
}

module.exports = { resolvePersistJar };
