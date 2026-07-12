// @ts-check

// Panel taxonomy for the goldfinch://jars management page (M08 Flight 2, Leg 1 /
// flight DD1). Maps each per-jar data class onto one of three collapsible
// panels — History, Cookies, Other site data — so the page can render panels
// data-driven and route a future JAR_DATA_CLASSES entry (e.g. Flight 3's
// "history" class) into the right panel with no layout rethink.
//
// Pure, dependency-free ES module: ZERO imports, unlike jar-page-model.js
// (which imports burner.js) — this module is stricter. The mapping is by id
// STRING, not by importing jar-data-classes.js, so the module has nothing to
// depend on; the totality-over-JAR_DATA_CLASSES check lives in the unit test
// instead (which imports the real list), keeping this module's serving graph
// flat.

/**
 * @typedef {{ id: string, label: string }} JarPanel
 */

/** @type {ReadonlyArray<JarPanel>} */
export const JAR_PANELS = Object.freeze([
  Object.freeze({ id: 'history', label: 'History' }),
  Object.freeze({ id: 'cookies', label: 'Cookies' }),
  Object.freeze({ id: 'site-data', label: 'Other site data' })
]);

// Data-class id -> panel id. 'history' anticipates the Flight-3 JAR_DATA_CLASSES
// entry (not yet added — DD5). Fail-closed: any unrecognized id maps to null
// rather than guessing a panel.
/**
 * @param {string} classId
 * @returns {string | null}
 */
export function panelForDataClass(classId) {
  switch (classId) {
    case 'cookies':
      return 'cookies';
    case 'storage':
    case 'cache':
      return 'site-data';
    case 'history':
      return 'history';
    default:
      return null;
  }
}
