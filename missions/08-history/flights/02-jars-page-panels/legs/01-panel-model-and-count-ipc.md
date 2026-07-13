# Leg: panel-model-and-count-ipc

**Status**: completed
**Flight**: [Manage-Jars Page Panels](../flight.md)

## Objective

Create the pure panel-taxonomy module `src/shared/jar-panel-model.js`
(flight DD1), add the `history-count` IPC twin + preload invoker + type
declare (flight DD6), and register the new shared module on the jars page's
serving path — all unit-tested, no page-DOM changes yet.

## Context

- Flight 2 DD1 (taxonomy), DD2 (three-point onboarding), DD6 (count twin).
- Flight 1 landed `history-ipc.js` with four twin-registered ops and the
  static `history: <op> — <code>` error contract — this leg adds a fifth op
  following those conventions byte-for-byte.
- `historyStore.countByJar(jarId)` exists (`src/main/history-store.js`,
  exported) — no store changes needed.

## Inputs

- Branch `flight/02-jars-page-panels` (stacked on flight/01 HEAD 2994863).
- `src/main/history-ipc.js` — handler + twin-registration conventions,
  `registerHistoryIpc({ ipcMain, historyStore, jars, broadcast })`.
- `src/preload/internal-preload.js` — `historyList` invoker style +
  handle-map `on`/`off`.
- `src/renderer/renderer-globals.d.ts` — `GoldfinchInternalBridge` history
  entries (loose `(payload: any): Promise<any>` style).
- `src/main/main.js` `INTERNAL_PAGES.jars` sub-map (flat `pathname → file`
  entries); `src/renderer/pages/jars.html` module script tags.
- `src/shared/jar-data-classes.js` — `JAR_DATA_CLASSES` ids
  (`cookies`, `storage`, `cache`).

## Outputs

- `src/shared/jar-panel-model.js` (new, ESM) +
  `test/unit/jar-panel-model.test.js` (new).
- `src/main/history-ipc.js` — `history-count` / `internal-history-count`.
- `test/unit/history-ipc.test.js` — count branches added.
- `src/preload/internal-preload.js` — `historyCount` invoker.
- `src/renderer/renderer-globals.d.ts` — `historyCount` declare.
- `src/renderer/pages/jars.html` — the literal tag form
  `<script src="jar-panel-model.js" type="module"></script>` beside the
  other shared-module tags. **Exactly this form** *(design review)*: NO
  `defer` (the DD3 defer rule binds classic scripts only; module tags are
  exempt) and NO `./` prefix — the script-tag contract test's
  `isSharedSrc()` classifies shared files by `!src.includes('/')`, so a
  `./` prefix would silently drop this file from the module-pin net.
- `src/main/main.js` — `'/jar-panel-model.js'` entry in
  `INTERNAL_PAGES.jars`.

## Contract (implement exactly)

**`src/shared/jar-panel-model.js`** (ESM, `// @ts-check`, no imports —
pure data + one function; do NOT import jar-data-classes — the mapping is
by id string so the module has ZERO imports; note `jar-page-model.js` is
NOT actually import-free (it imports `burner.js`) — this module is
stricter):

```js
export const JAR_PANELS = Object.freeze([
  Object.freeze({ id: 'history',   label: 'History' }),
  Object.freeze({ id: 'cookies',   label: 'Cookies' }),
  Object.freeze({ id: 'site-data', label: 'Other site data' })
]);

// Data-class id -> panel id. 'history' anticipates the Flight-3 class.
export function panelForDataClass(classId) { … }
// cookies -> 'cookies'; storage -> 'site-data'; cache -> 'site-data';
// history -> 'history'; anything else -> null (fail-closed).
```

**`history-count` handler** (in `registerHistoryIpc`, defined once,
registered on both families like the existing four):
- payload not a non-null object → `{ ok: false, error: 'history: count — malformed-payload' }`
- unknown jar (same `jars.list().some(...)` check) → `{ ok: false, error: 'history: count — unknown-jar' }`
- ok → `{ ok: true, count: historyStore.countByJar(jarId) }`
- store throws → `{ ok: false, error: 'history: count — store-failure' }`
  (static; `console.error('[history]', err)`).
- No broadcast (read-only op).

**Preload**: `historyCount: (payload) => ipcRenderer.invoke('internal-history-count', payload)`
(param named `payload`, matching the sibling invokers).
**d.ts**: `historyCount(payload: any): Promise<any>;` beside the other
history entries.
**Housekeeping** *(design review)*: update the stale "four history IPC
channels" JSDoc in `history-ipc.js` to five; extend the test file's shared
fake store with `countByJar(jarId)` + a `throws.countByJar` toggle
(the existing convention).

## Acceptance Criteria

- [x] `jar-panel-model.js` exists (ESM, frozen, dependency-free);
      `test/unit/jar-panel-model.test.js` pins: panel order
      (history, cookies, site-data), labels, deep-frozen-ness,
      `panelForDataClass` totality over every CURRENT `JAR_DATA_CLASSES`
      id (import the real list in the TEST to assert every id maps
      non-null — the totality guard lives in the test, keeping the module
      dependency-free), the anticipatory `history` mapping, and
      fail-closed `null` for unknown ids.
- [x] `history-count` twins registered (registration-surface test updated:
      exactly 5 chrome + 5 internal channels); untrusted-sender rejection
      for `internal-history-count`; every new error string pinned
      VERBATIM; success shape `{ ok: true, count }` with a real store;
      store-failure branch via the shared throwing-fake convention;
      same-identifier grep-AC extended to the fifth op.
- [x] Grep-AC: `grep -n '\${' src/main/history-ipc.js` → still zero hits.
- [x] `jars.html` tag + `INTERNAL_PAGES.jars` entry added;
      `jars-page-shared-scripts.test.js` still green (self-derives).
- [x] `npm test` / `npm run typecheck` / `npm run lint` green; suite ~1s.

## Verification Steps

- `npm test`, `npm run typecheck`, `npm run lint`.
- `node --input-type=module -e "import('./src/shared/jar-panel-model.js').then(m => console.log(m.JAR_PANELS.length))"`
  from the repo root → `3`.

## Edge Cases

- `panelForDataClass(null/undefined/'')` → `null` (fail-closed; pinned).
- The module must not import `jar-data-classes.js` (keeps the serving
  graph flat; the totality check lives in the unit test instead).

## Files Affected

- `src/shared/jar-panel-model.js` — new
- `test/unit/jar-panel-model.test.js` — new
- `src/main/history-ipc.js`, `test/unit/history-ipc.test.js`
- `src/preload/internal-preload.js`, `src/renderer/renderer-globals.d.ts`
- `src/renderer/pages/jars.html`, `src/main/main.js` (INTERNAL_PAGES)

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed`
- [x] Do NOT commit (flight-level review + commit after the last leg)

## Citation Audit

All referenced seams verified during flight design recon and the Flight-2
Architect review (same session, current tree): `history-ipc.js`
twin/error conventions, `internal-preload.js` history invokers,
`renderer-globals.d.ts` history block, `INTERNAL_PAGES.jars` flat map,
`jars.html` module tags, `jar-data-classes.js` ids, `countByJar` export.
Symbol-form; none line-brittle.
