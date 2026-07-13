// @ts-check

// Clearable per-jar data classes (M06 Flight 4, Leg 1 / DD2). A frozen, ordered
// list of descriptors mapping onto Electron's `ses.clearStorageData({ storages })`
// taxonomy (`ClearStorageDataOptions` — electron.d.ts:20369). The goldfinch://jars
// page renders its data-control buttons FROM this list (leg 2+), so the promise
// made here was kept: the "history" class (M08 Flight 3 / DD1) slotted in as one
// more descriptor with no layout rethink.
//
// `cache`'s `storages` is the `null` SENTINEL — clearCache() is a distinct method,
// not a storages set. jar-ipc.js's handler maps the sentinel to
// `ses.clearCache()` + `ses.clearStorageData({ storages: ['shadercache'] })`.
// `history`'s `storages` is ALSO `null` (it isn't a clearStorageData class
// either), but it is distinguished from cache via the `custom` discriminator —
// jar-ipc.js's handleClearData dispatches on `custom` FIRST, before falling
// back to the storages-null cache path (DD1: a naive storages-falsy fallthrough
// would route a history clear into `ses.clearCache()` instead of the history
// purge).
//
// No imports — this module depends on nothing (mirrors jar-page-model.js's shape).
// Real ES module (M07 Flight 2 sweep): pure `export` bindings for all consumers
// (require(esm) in jar-ipc.js and the test runner; pages/jars.js imports what it
// uses). jars.html is now an all-module page, so the old classic-script
// shared-lexical-scope collision class no longer applies —
// jars-page-shared-scripts.test.js now guards the page's script-tag contracts
// instead.

/**
 * @typedef {{ id: string, label: string, storages: readonly string[] | null, custom?: string }} JarDataClass
 */

/** @type {ReadonlyArray<JarDataClass>} */
export const JAR_DATA_CLASSES = Object.freeze([
  Object.freeze({ id: 'cookies', label: 'Cookies', storages: Object.freeze(['cookies']) }),
  Object.freeze({
    id: 'storage',
    label: 'Site storage',
    storages: Object.freeze(['filesystem', 'indexdb', 'localstorage', 'websql', 'serviceworkers', 'cachestorage'])
  }),
  // Sentinel: null storages means "not a clearStorageData class" — see handler
  // mapping note above.
  Object.freeze({ id: 'cache', label: 'Cache', storages: null }),
  // History (M08 Flight 3 / DD1): also the null-storages sentinel, discriminated
  // from cache via `custom` — see the handler-dispatch note above.
  Object.freeze({ id: 'history', label: 'History', storages: null, custom: 'history' })
]);

/**
 * Look up a data class descriptor by id.
 * @param {string} id
 * @returns {JarDataClass | null}
 */
export function jarDataClassById(id) {
  for (const c of JAR_DATA_CLASSES) {
    if (c.id === id) return c;
  }
  return null;
}
