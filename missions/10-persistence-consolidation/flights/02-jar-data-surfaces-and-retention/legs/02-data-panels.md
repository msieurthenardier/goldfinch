# Leg: data-panels

**Status**: completed
**Flight**: [Jar Data Surfaces + Generalized Retention](../flight.md)

## Objective

Build the Cookies and Other-site-data panels end-to-end — new fail-closed
IPC twins, internal-preload wrappers, the DD10 `jar-data-changed`
broadcast, and two renderer panel modules cloned from the history panel's
shape — per the leg-1 spike verdicts, with unit tests and a smoke-level
live check on the rig.

## Context

- Governing DDs: DD2 (cookies IPC + URL reconstruction + query-on-open,
  tab-selection trigger), DD3 **VERDICT: composite** (IndexedDB-dir-scrape
  origins ∪ history-derived origins, two-tier badges "has stored data" /
  "visited — storage unconfirmed", NO usage figure), DD7 (no values
  persisted — and this leg also omits cookie VALUES from listing payloads:
  the criteria need name/domain/expiry; least-privilege), DD8 (panel-shape
  parity + a11y), DD10 (`jar-data-changed { jarId, classes }`).
- Spike measurements this leg relies on (flight log Decisions): the
  unconditional dot-strip is safe for host-only AND domain cookies, and
  `cookies.remove(reconstructedUrl, name)` verified for both (read-back
  confirmed); IndexedDB origins are recoverable from origin-named leveldb
  directory names (`IndexedDB/http_127.0.0.1_<port>.indexeddb.leveldb`);
  localStorage is a consolidated non-origin-keyed store (invisible to the
  scrape — the honest-labeling gap); history-derived origins ride the
  shipped `GROUP BY` idiom (`history-store.js:205-219 suggest`) +
  `hostnameOf`/origin normalization (`trackers.js`).
- Retention sweeps, the bookkeeping table, and schema v2 are **leg 3** —
  this leg's `jar-data-changed` firing sites are `handleClearData`
  (cookies/storage classes) and `handleWipe`; the sweep-completion firing
  site arrives with leg 3.
- Key seams: `src/main/jar-ipc.js` (twin pattern — bare `ipcMain.handle`
  + `registerInternalHandler`; `handleClearData` :213-264; `handleWipe`
  :278-293; `broadcastJarsChanged` :73-76), `src/preload/internal-preload.js`
  (history wrappers :384-450 as the template), `src/renderer/pages/jars.js`
  (`buildPanelContent` — only the `history` branch mounts content; the
  Clear controls rows route via `panelForDataClass`),
  `src/renderer/pages/jars-history-panel.js` (the module shape to clone),
  `src/shared/jar-panel-model.js` / `jar-data-classes.js`.

## Inputs

- Leg 1 landed (verdicts in flight log); working tree has only artifact
  changes; suite 2017 green.

## Outputs

- `src/main/jar-ipc.js`: four new handler bodies registered as twins —
  `jars-cookies-list`, `jars-cookies-remove`, `jars-sitedata-list`,
  `jars-sitedata-remove-origin` (+ `internal-` twins) — plus the DD10
  broadcast wiring in `handleClearData`/`handleWipe`.
- New pure helpers (unit-testable, Electron-free): cookie→URL
  reconstruction; IndexedDB-dirname→origin parser (defensive:
  unparseable → null, never throw); origin-union/badge model (pure list
  merge for the two tiers). Location: `src/main/` or `src/shared/` per
  house fit (shared if the renderer needs the badge model too).
- `src/main/history-store.js`: a jar-scoped
  origins-with-last-activity read (GROUP BY idiom) injected into jar-ipc.
- `src/preload/internal-preload.js`: `jarsCookiesList`,
  `jarsCookiesRemove`, `jarsSiteDataList`, `jarsSiteDataRemoveOrigin`,
  `onJarDataChanged`/`offJarDataChanged` wrappers.
- `src/renderer/pages/jars-cookies-panel.js`,
  `src/renderer/pages/jars-sitedata-panel.js` (+ `jars.html` script tags,
  CSS as needed, **and the `INTERNAL_PAGES.jars` allowlist entries in
  `src/main/main.js`** — the internal-assets resolver is exact-match; an
  unregistered module 404s (design review; the three-point onboarding
  precedent `jars-tabs.js` followed: main.js entry + script tag;
  `jars-page-shared-scripts.test.js` self-derives from jars.html)):
  history-panel-shaped modules with list rendering,
  per-item delete, manual refresh, empty/error states, two-tier badges on
  the site-data panel and its honest known-gap note; mounted from
  `buildPanelContent` with a **tab-selection activation hook** (DD2 — not
  the section-visibility `onExpanded` trigger).
- Tests: jar-ipc twin coverage (fail-closed validation, static errors,
  unknown jar, malformed payloads, DD10 broadcast firing), pure-helper
  suites, and whatever source-scan pattern the house uses for preload
  wiring. Suite green.

## Acceptance Criteria

- [x] Cookies twins list the jar session's cookies (name, domain, path,
      expirationDate, secure/hostOnly/session flags — **NO value field in
      the payload**) and remove a single cookie via the verified
      reconstruction; fail-closed on unknown jar / malformed payload with
      static `jars: <op> — <code>`-style error strings.
- [x] Site-data twins return the composite origin list with per-origin
      tier (`stored` — IndexedDB-confirmed / `visited` — history-derived)
      and remove an origin's storage via
      `clearStorageData({ origin, storages: <the storage class set,
      cookies excluded> })`; the IndexedDB parser degrades unparseable
      dirnames to skip, never throws; a jar with no storage path or no
      history yields an empty (not error) list.
- [x] `jar-data-changed { jarId, classes }` broadcasts from
      `handleClearData` (when cookies and/or storage cleared) and
      `handleWipe`; exposed on the internal bridge; both new panels
      re-query on it (and BOTH panels re-query directly after their own
      mutations — per-cookie delete and per-origin delete alike, not
      waiting on the broadcast).
- [x] Panels render per DD8: history-panel structural parity (headings,
      list semantics, buttons real `<button>`s, labels), tab-selection
      activation (opening the History tab must NOT fire cookie/site-data
      queries and vice versa), manual refresh affordance, site-data
      known-gap note, no usage figures.
- [x] Unit layer: new twins + pure helpers + broadcast covered;
      `npm test` / `npm run typecheck` / `npm run lint` green; suite
      timing guidance respected (share fixtures; no gratuitous per-test
      rig work).
- [x] **Smoke-level live check (implementing agent, not the Witnessed
      gate)**: on the rig, in a persist jar drive a fixture page that sets
      a cookie via `document.cookie` AND seeds IndexedDB
      (`indexedDB.open` + put). Then on `goldfinch://jars`: Cookies tab →
      the cookie lists; delete it → row gone + session read-back empty;
      Site-data tab → the fixture origin shows at the **`stored`** tier
      (this also live-probes the IndexedDB dirname parse against a real
      origin — spike B only measured a non-default-port localhost origin;
      if a default-port `https://` origin is reachable in the smoke, read
      the on-disk dirname for it and record whether the port segment is
      present, adjusting the parser if the format differs) and a
      visited-only origin shows at the `visited` tier. Screenshot + notes
      into the flight log (evidence paths under /tmp). **Done — see
      flight-log.md Leg Progress for the full evidence + the live-measured
      default-port sentinel (`_0`) finding and parser fix.**

## Verification Steps

- `node --test` the touched suites; full `npm test`; typecheck; lint.
- Grep: no cookie `value` field crosses the IPC payload; no `onExpanded`
  wiring for the two new panels; `internal-preload.js` exposes the FOUR
  new wrappers + the event pair; `main.js` `INTERNAL_PAGES.jars` carries
  both new module paths.
- Smoke-check evidence recorded in the flight log.

## Implementation Guidance

1. **Pure helpers first** (with tests): `cookieUrl(cookie)` (scheme from
   `secure`, dot-strip domain, path default `/`); 
   `originFromIndexedDbDirname(name)` (parse `<scheme>_<host>_<port>.indexeddb.leveldb`
   → origin string; null on anything unexpected);
   `mergeOriginTiers(storedOrigins, visitedOrigins)` → sorted
   `[{ origin, tier }]` with `stored` winning duplicates.
2. **history-store read**: `originsForJar(jarId)` — GROUP BY on the
   normalized origin of `url` with `MAX(visited_at)`; reuse the suggest
   query's shape. **Origin normalization (design review correction): use
   `new URL(url).origin` directly via a new pure `origin(url)` helper**
   (null on parse failure; grep first for an existing one — none known
   outside trackers). Do NOT use `trackers.js`'s
   `hostnameOf`/`registrableDomain` — they drop scheme/port and collapse
   to eTLD+1, which merges distinct origins and yields strings
   `clearStorageData({origin})` can't act on. The same helper keys both
   union sides.
3. **jar-ipc twins**: clone the history-ipc registration discipline
   (define once, register twice; validate order: malformed → unknown jar →
   act; static error strings). Site-data list: `ses.storagePath`
   (verify property vs method against electron.d.ts at implementation) +
   defensive `readdir` of `IndexedDB/`; absent dirs → empty tier.
   DD10 broadcast: add to `handleClearData` (fire once with the actual
   cleared classes ∩ {cookies, storage}) and `handleWipe` (all classes).
4. **Preload + panels**: follow the history wrapper/panel templates;
   activation hook — find the tab-selection seam in `jars-tabs.js` /
   `jars.js` and pass an explicit `onActivated` to the new modules;
   per-item delete follows the history panel's per-row convention
   exactly: immediate delete on click, no confirm (verified convention —
   design review). Clone the history panel's monotonic `viewGen`-style
   staleness guard for async responses (the established defense against
   a concurrent clear racing an in-flight list query) — a requirement,
   not an implicit inheritance.
5. **Smoke check** (rig): the F1/spike apparatus mechanism; back up the
   dev profile if mutated; restore after; never print keys.

## Edge Cases

- **Expired-but-listed cookies**: `ses.cookies.get` may return
  session-expired entries; list what the session reports (source of
  truth), no filtering.
- **Jar with zero cookies / zero origins**: explicit empty-state copy,
  not a blank region.
- **Burner**: burner has no jar record — the panels exist only for
  registered jars (structurally unreachable; no special code).
- **Origin normalization mismatches** (e.g. `http_127.0.0.1_8080` vs
  history's `http://127.0.0.1:8080`): one normalizer used on both sides
  of the union (criterion above).
- **`clearStorageData` origin param semantics**: takes an origin string —
  verify trailing-slash/port normalization live in the smoke check.
- **Empty-name cookies** (`=value` form; `Cookie.name` may be an empty
  string): render as the empty-name row, and verify
  `cookies.remove(url, '')` behavior in the unit/smoke layer.
- **Deleting a `visited`-tier origin with no actual storage**: expected
  silent no-op success (the row clears from the visited tier only if
  history says so — the delete acts on storage, not history); state this
  in the panel's known-gap note.

## Files Affected

- `src/main/jar-ipc.js`, `src/main/history-store.js`
- `src/main/main.js` — `INTERNAL_PAGES.jars` entries (design review)
- new pure-helper module(s) (incl. `origin(url)`)
- `src/preload/internal-preload.js`
- `src/renderer/pages/jars-cookies-panel.js` (new),
  `jars-sitedata-panel.js` (new), `jars.js`, `jars.html`,
  `jars-tabs.js` (activation generalization — design review), page CSS
- `test/unit/jar-ipc.test.js`, new helper suites, `history-store.test.js`,
  wiring source-scan per house pattern (`jars-page-shared-scripts.test.js`
  self-derives — no edit expected)

---

## Post-Completion Checklist

- [x] All acceptance criteria verified (incl. smoke-check evidence in the
      flight log)
- [x] Tests passing (`npm test`, `npm run typecheck`, `npm run lint`)
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed`
- [x] Do NOT commit (flight-end review/commit model)

## Citation Audit

Verified at leg design (2026-07-17, post-spike tree): `jar-ipc.js:213-264
handleClearData` / `:278-293 handleWipe` / `:73-76 broadcastJarsChanged`,
`internal-preload.js:384-450` history wrappers, `jars.js buildPanelContent`
history-only mount, `history-store.js:205-219` suggest GROUP BY,
`trackers.js:71,81` hostnameOf/registrableDomain — all `OK` per the
flight-design review and spike code-citations on the unchanged files.
