// @ts-check
'use strict';

// Clearable per-jar data classes (M06 Flight 4, Leg 1 / DD2). A frozen, ordered
// list of descriptors mapping onto Electron's `ses.clearStorageData({ storages })`
// taxonomy (`ClearStorageDataOptions` — electron.d.ts:20369). The goldfinch://jars
// page renders its data-control buttons FROM this list (leg 2+), so a future
// "history" class slots in as one more descriptor with no layout rethink.
//
// `cache`'s `storages` is the `null` SENTINEL — clearCache() is a distinct method,
// not a storages set. jar-ipc.js's handler maps the sentinel to
// `ses.clearCache()` + `ses.clearStorageData({ storages: ['shadercache'] })`.
//
// No imports — this module depends on nothing (mirrors jar-page-model.js's shape).
// Dual-export tail below (CJS + globalThis) follows jar-page-model.js:80-85
// exactly. Loaded via classic <script> on jars.html, sharing the page's ONE
// top-level lexical scope with burner.js / safe-color.js / jar-page-model.js /
// jars.js (jars-page-shared-scripts.test.js enforces no top-level collision) —
// the names JAR_DATA_CLASSES / jarDataClassById were checked against those files'
// own top-level declarations (BURNER, RESOLVED_BURNER, PALETTE,
// buildJarPageModel, HEX, KEYWORD, isSafeColor; jars.js is IIFE-wrapped, so it
// declares nothing at top level) before being finalized.

/**
 * @typedef {{ id: string, label: string, storages: readonly string[] | null }} JarDataClass
 */

/** @type {ReadonlyArray<JarDataClass>} */
const JAR_DATA_CLASSES = Object.freeze([
  Object.freeze({ id: 'cookies', label: 'Cookies', storages: Object.freeze(['cookies']) }),
  Object.freeze({
    id: 'storage',
    label: 'Site storage',
    storages: Object.freeze(['filesystem', 'indexdb', 'localstorage', 'websql', 'serviceworkers', 'cachestorage'])
  }),
  // Sentinel: null storages means "not a clearStorageData class" — see handler
  // mapping note above.
  Object.freeze({ id: 'cache', label: 'Cache', storages: null })
]);

/**
 * Look up a data class descriptor by id.
 * @param {string} id
 * @returns {JarDataClass | null}
 */
function jarDataClassById(id) {
  for (const c of JAR_DATA_CLASSES) {
    if (c.id === id) return c;
  }
  return null;
}

// Dual export: CommonJS (main process + test runner) and global (renderer-class
// documents, which run with nodeIntegration:false and cannot require()).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { JAR_DATA_CLASSES, jarDataClassById };
} else {
  /** @type {any} */ (globalThis).JAR_DATA_CLASSES = JAR_DATA_CLASSES;
  /** @type {any} */ (globalThis).jarDataClassById = jarDataClassById;
}
