// @ts-check

// Session-restore jar resolution (M09 Flight 9, Leg 3 — DD4 / AC5b). Pure, no DOM,
// no Electron: given a saved tab's jarId and the live jars snapshot, resolve the
// matching container, or `null` when that jar no longer exists (deleted between quit
// and relaunch).
//
// A null return means DROP the tab — NEVER home-substitute (the DD4 deleted-jar edge).
// This is deliberately NOT inheritContainerFromPartition, which takes a partition and
// carries a default-jar/fresh-burner fallback that would silently re-home a deleted
// jar's tab, violating DD4. Factored as a pure both-directions unit pin (the same rigor
// leg 2 applied by factoring resolvePersistJar), so the privacy-adjacent drop rule is a
// real assertion rather than a source-scan.

/**
 * @template {{ id: string }} C
 * @param {string} jarId
 * @param {C[]} containers
 * @returns {C | null}
 */
export function resolveRestoreContainer(jarId, containers) {
  return containers.find((c) => c.id === jarId) || null;
}
