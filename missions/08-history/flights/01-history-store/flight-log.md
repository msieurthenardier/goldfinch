# Flight Log: Per-Jar History Store

**Flight**: [Per-Jar History Store](flight.md)

## Summary

Flight complete: 4 legs landed (`store-core`, `recorder-and-wiring`,
`history-ipc`, `verify-integration`), 1376 unit tests green, behavior test
`history-recording` 8/8 (live two-agent run), flight-level code review clean
(zero findings). Lands the mission's storage substrate and recording
pipeline on `node:sqlite`.

---

## Leg Progress

### Leg 1 — `store-core`

- **Status**: landed
- **Started**: 2026-07-12
- **Completed**: 2026-07-12

**Changes Made**

- Added `src/main/history-store.js` (new): Electron-free, `// @ts-check` CJS
  module owning `userData/history.db` on `node:sqlite` (`DatabaseSync`).
  Implements the leg's full API contract exactly — `open(userDataPath)`,
  `close()`, `recordVisit`, `setTitle`, `listRecent`, `search`,
  `deleteVisit`, `clearJar`, `countByJar`, `pruneExpired` — schema v1 (single
  `visits` table + FTS5 external-content `visits_fts` index with
  INSERT/UPDATE/DELETE sync triggers, `visits_jar_time`/`visits_jar_url`
  indexes), WAL + `synchronous=NORMAL`, cached prepared statements rebuilt
  per `open()`. Followed every leg-spec correction verbatim: distinct
  `?1/?2/?3` placeholders in the paging cursor query, unaliased
  `visits_fts` in the search JOIN, no FTS tokenchars override, store-owned
  `isOpen` flag guarding `close()` idempotence, `mkdirSync(userDataPath,
  {recursive:true})` before opening, corrupt-file quarantine-and-recreate
  (`history.db.corrupt-<ms-epoch>` + best-effort `-wal`/`-shm` siblings).
- Added `test/unit/history-store.test.js` (new): 22 tests covering the full
  API round-trip, cross-jar isolation, search sanitization (FTS5 operator
  injection safety + prefix matching), title backfill + FTS shadow sync,
  retention + orphan GC, close/reopen persistence, corrupt-file recovery,
  cursor paging (incl. same-timestamp id tiebreak), validation errors, and
  require-time side-effect freedom.
- No other files touched (main.js wiring is leg 2; IPC is leg 3), per the
  leg's Outputs contract.

**Verification**

- `open()` schema AC: verified with a second live `DatabaseSync` connection
  against the just-created `history.db`, asserting `PRAGMA user_version = 1`
  and the individual presence of `visits`, `visits_fts`, `visits_ai`,
  `visits_ad`, `visits_au` in `sqlite_master` (type IN table/trigger) plus
  `visits_jar_time`/`visits_jar_url` indexes — never a total row count (FTS5
  external-content's four shadow tables would trip a count assertion).
- Full API round-trip AC: pinned by
  `full API round-trips: record -> listRecent -> setTitle -> search ->
  deleteVisit -> clearJar -> countByJar -> pruneExpired`, one test chaining
  all eight operations with assertions at each step.
- Cross-jar isolation AC: pinned by `cross-jar isolation: ...` — rows seeded
  in jars A and B; `listRecent(A)`/`search(A,…)`/`countByJar(A)` confirmed
  A-only, `deleteVisit(A, idOfBRow)` confirmed `false` + non-destructive,
  `clearJar(A)` confirmed B-preserving, and a `before` cursor id from jar B
  confirmed `[]` for jar A.
- Search sanitization AC: pinned by two tests — operator characters (`"`,
  `*`, `(`, `)`, `-word`, `NEAR`, an unterminated quote, an injected `OR`)
  each asserted non-throwing; prefix match (`exam` → `example.com`) asserted
  by id; empty/whitespace/quote-only queries asserted to return `[]`.
- Title backfill AC: pinned by `title backfill: setTitle updates the row AND
  the FTS shadow` — searches by a distinctive old title before update, then
  by the new title after, confirming the old title no longer matches.
- Retention AC: pinned by three tests — `{ a: 30 }` retention deletes only
  the row older than 30 days for jar `a` while keeping the fresher row;
  orphan GC deletes every row of a jar id absent from the map; an empty
  retention map is confirmed pure orphan GC (deletes everything); the
  return-value-maps-only-nonzero-counts sub-clause pinned by a case where
  one registered jar has zero eligible/zero rows.
- Persistence AC: pinned by `persistence: close -> reopen on the same dir ->
  rows still there` (fresh-required store instance on reopen, cache-bust
  pattern).
- Corrupt-file recovery AC: pinned by writing garbage bytes to `history.db`
  before `open()`, asserting `open()` does not throw, a
  `history.db.corrupt-*` sibling exists, and the store is immediately
  functional (record + read round-trip) post-recovery.
- Paging AC: pinned by `paging: listRecent pages via before with no
  duplicates/gaps, incl. same-timestamp id tiebreak` — 5 rows (3 sharing one
  `visited_at`) paged with `limit: 2`, the concatenated pages compared
  byte-for-byte against the full `visited_at DESC, id DESC` order.
- Suite/typecheck/lint AC: `npm test` — 1315 tests (13 suites), 0 failures,
  wall-clock ~1.0–1.1s (target ~1s, no visible regression from the pre-leg
  baseline); `npm run typecheck` — clean, no `@ts-ignore` needed (`@types/node`
  ^26 ships usable `node:sqlite` types); `npm run lint` — clean. Also ran the
  spec's standalone `node -e "const h=require('./src/main/history-store');"`
  check manually: requiring the module creates no files (confirmed against
  an empty scratch dir).

### Leg 2 — `recorder-and-wiring`

- **Status**: landed
- **Started**: 2026-07-12
- **Completed**: 2026-07-12

**Changes Made**

- Added `src/main/history-recorder.js` (new): Electron-free, `// @ts-check`
  CJS factory `createHistoryRecorder({ store, listJars, broadcast, now?,
  suppressionMs? })` (not a module singleton, like `createMenuOverlayManager`)
  implementing the leg's decision gates exactly: DD5 positive allowlist
  (`listJars().find(j => j.partition === partition)`, linear scan, commented
  as deliberate), DD4 scheme allowlist (`new URL()` try/catch, `http:`/
  `https:` only), DD4 consecutive-duplicate suppression (per-jar `{ url, ts }`
  map, `suppressionMs` default 30s, suppressed hits do NOT refresh `ts`).
  `handleNavigation` records via `store.recordVisit`, updates `lastByJar` and
  `lastVisitByWc.set(wcId, { visitId, jarId })` (the pair, per the leg's
  design-review pin), broadcasts `history-changed { jarId }`, returns the
  visit id. `handleTitleUpdated(wcId, title)` looks up `lastVisitByWc`,
  no-ops on miss/empty/non-string title, else calls `store.setTitle` and
  broadcasts with the stored jarId. `forgetTab(wcId)` deletes the map entry.
  Every store call is try/catch-wrapped (`console.error('[history]', err)`,
  returns null/no-op) — a store hiccup never breaks navigation.
- Added `test/unit/history-recorder.test.js` (new): 22 tests — positive
  recording (http and https), the full DD5 allowlist decision table (burner,
  internal, unknown partition, undefined partition), the full DD4 scheme
  allowlist (`goldfinch://`, `about:blank`, invalid URL), suppression (within
  window, after window, different URL, per-jar not per-tab, cross-jar
  independence, and a dedicated non-self-extension test using a manual fake
  clock), title backfill (hit/miss/empty/non-string/forgetTab), and
  store-throw swallowing for both handlers.
- `src/main/jars.js`: added module const `DEFAULT_RETENTION_DAYS = 30` and
  validator `cleanRetention(v)` (integer 1–3650 kept as-is, else 30 —
  deliberately strict on type so a numeric string like `'15'` cannot silently
  coerce). Landed `retentionDays` on all FOUR assembly sites per the leg's
  enumeration: `FRESH_SEED` and `LEGACY_DEFAULTS` literals, `add()`'s
  constructed record, and `validateContainers()`'s field-by-field `kept.push`
  (`retentionDays: cleanRetention(entry.retentionDays)`). `rename()` left
  untouched (mutation path is Flight 3's `setRetention`). Module doc header
  updated to include `retentionDays` in the documented on-disk shape.
- `test/unit/jars.test.js`: updated the five enumerated shape-pinning
  assertions (the `__proto__`-pollution key list, the `save()` atomic-write
  `deepEqual`, the mutations-round-trip `deepEqual`, `remove()`'s returned-
  object `deepEqual`, and `list()`'s key-sort assertion) to include
  `retentionDays`. Added six new tests: a coercion table (`undefined`, `0`,
  `-1`, `3651`, `1.5`, `'15'`, `null` → 30; `1`/`30`/`3650` kept), an
  `add()` default-pin test, an upgrade-path test against a v2 fixture shaped
  exactly like the real dev-profile file (three containers, no
  `retentionDays`, each kept record gains 30), a fresh-install seed-path
  test, a legacy-v1-bare-array seed-path test, and a persisted-round-trip
  test (a custom `retentionDays: 90` written directly into the fixture file
  survives `load()` unchanged — no public setter landed this leg, per spec).
- `src/main/main.js`: `wireTabViewEvents(view, wcId, partition)` gained the
  partition param (doc comment records the DD5 rationale for reusing the
  same raw value passed to `tabViews.set`); its call site at `tab-create`
  passes `trusted ? INTERNAL_PARTITION : partition` (byte-identical to the
  registry value). Added `historyRecorder?.handleNavigation(...)` inside the
  existing `did-navigate` and `did-navigate-in-page` guards (alongside, never
  replacing, the existing `sendToChrome` calls) and
  `historyRecorder?.handleTitleUpdated(wcId, title)` inside the existing
  `page-title-updated` guard. Added `historyRecorder?.forgetTab(wcId)` next
  to `tabViews.delete(wcId)` in the `tab-close` handler. Added the
  `history-store`/`history-recorder` requires, a module-scoped
  `let historyRecorder = null`, and — inside `app.whenReady()` as a sibling
  call immediately after `initProfileAndStores(...)` returns (Architect-
  pinned; the unit-pinned 4-store signature is untouched) —
  `historyStore.open(app.getPath('userData'))` followed by
  `historyRecorder = createHistoryRecorder({ store: historyStore, listJars:
  () => jars.list(), broadcast: broadcastToChromeAndInternal })`. Added
  `pruneAllJars()` (builds `retentionByJarId` from `jars.list()`, calls
  `historyStore.pruneExpired`, broadcasts `history-changed` per nonzero-count
  jar, try/catch-wrapped) run once at boot then on an hourly `setInterval(...)
  .unref()`. Added `app.on('will-quit', () => { try { historyStore.close(); }
  catch {} })` as a new, deliberately later-than-`before-quit` lifecycle hook
  (DD2 rationale: no in-flight navigation can still be writing once windows
  are torn down). No other main.js behavior changed.
- `src/renderer/renderer-globals.d.ts`: added `retentionDays: number` to the
  `GoldfinchInternalBridge.jarsList()` element type (the chrome-bridge
  `GoldfinchBridge.jarsList()` stays `Promise<any>`, untouched, per the leg's
  citation).

**Verification**

- Recorder factory/decision-table AC: `test/unit/history-recorder.test.js`,
  22/22 green — see the enumerated coverage in Changes Made above.
- `jars.js` retentionDays AC: `test/unit/jars.test.js`, 88/88 green (82
  pre-existing + 6 new; the five enumerated assertions updated in place, no
  test count change from those). Verified each of the four assembly sites
  independently via the new upgrade-path/fresh-seed/legacy-seed/add()-default
  tests, plus the coercion table and the persisted-custom-value round-trip.
- `main.js` wiring AC: verified by direct diff read — `wireTabViewEvents`
  signature + call site both carry `partition`; recorder calls sit inside
  the existing `did-navigate`/`did-navigate-in-page`/`page-title-updated`
  guards and `tab-close`; boot/prune/close wiring matches the leg's six
  points exactly; `git diff -- src/main/main.js` shows no unrelated hunks.
- `renderer-globals.d.ts` AC: `retentionDays: number` present on the
  `GoldfinchInternalBridge.jarsList()` return element type.
- Suite/typecheck/lint AC: `npm test` — 1343 tests (13 suites: 1315 baseline
  + 22 recorder + 6 jars), 0 failures, wall-clock ~1.06s (target ~1s, no
  regression); `npm run typecheck` — clean; `npm run lint` — clean.
- Grep-AC: `grep -n "Date.now()" src/main/history-recorder.js` → exactly one
  hit, the injected default parameter (`now = () => Date.now()`) — confirmed
  no `Date.now()` call anywhere in decision logic.
- `node -e "require('./src/main/history-recorder')"` from a scratch cwd —
  no throw, no side effects.

### Leg 3 — `history-ipc`

- **Status**: landed
- **Started**: 2026-07-12
- **Completed**: 2026-07-12

**Changes Made**

- Added `src/main/history-ipc.js` (new): Electron-free, `// @ts-check` CJS
  module implementing flight DD9 exactly — `registerHistoryIpc({ ipcMain,
  historyStore, jars, broadcast })` defines four handler bodies once
  (`handleList`/`handleSearch`/`handleDelete`/`handleClear`) and registers
  each twice: bare `ipcMain.handle('history-*', ...)` on the chrome-trusted
  channel, `registerInternalHandler(ipcMain, 'internal-history-*', ...)` on
  the internal-origin-gated twin (jar-ipc.js's extract-don't-fork pattern,
  same identifier passed to both registrations for each op). Validation is
  fail-closed and in-order per the leg's contract: malformed-payload →
  unknown-jar (via `jars.list().some(j => j.id === jarId)`) → bad-args, each
  returning a STATIC `history: <op> — <code>` error string (zero template
  interpolation — the leg's explicit correction of jar-ipc's `clear-data`/
  `wipe` dynamic-interpolation precedent). `history-list` treats `before:
  null` as the documented no-cursor value (excluded from the bad-args check,
  passed through to `listRecent`'s already-defaulting param) while an absent
  `limit`/`before` key is simply omitted from the options object passed to
  the store. `history-delete` broadcasts `history-changed { jarId }` only
  when `deleteVisit` returns `true`; `history-clear` broadcasts only when
  `clearJar`'s returned count is `> 0` (idempotent empty-jar clear: `{ ok:
  true, cleared: 0 }`, no broadcast). Every handler wraps its store call in
  try/catch, logs via `console.error('[history]', err)`, and returns the
  op's static `store-failure` string — never lets an exception reach the
  IPC boundary as a rejected invoke.
- Added `test/unit/history-ipc.test.js` (new): 33 tests. Registration
  surface (exactly 4 chrome + 4 internal channels, no others); untrusted-
  sender rejection per internal channel via a `trustedHistoryEvent()`-style
  fake event (origin `goldfinch://jars` — history has no page of its own,
  DD9) mirroring `jar-ipc.test.js`'s `trustedJarsEvent()` apparatus, plus a
  same-origin/non-internal-session rejection test pinning the strict `===
  true` check; behavioral-parity tests (a mutation via
  `internal-history-clear` observable via chrome `history-list`, a mutation
  via chrome `history-delete` observable via `internal-history-list`, and a
  read-consistency test across both twins); every validation branch for all
  four ops with error strings asserted verbatim; `before: null` accepted;
  `limit: 0` passes IPC validation (store owns clamping); cross-jar
  `visitId` scoping on delete; per-jar isolation on clear; and the
  store-failure catch branch for all four ops using ONE shared fake store
  (a tiny real jar-keyed in-memory visit list, not four per-op stubs) with
  per-method `throws` toggles — the jar-ipc `storageThrows` convention.
- `src/preload/internal-preload.js`: added a new "per-jar history surface"
  section to the `goldfinchInternal` bridge object (after `offJarsChanged`)
  — `historyList`/`historySearch`/`historyDelete`/`historyClear` (thin
  `ipcRenderer.invoke('internal-history-*', payload)` wrappers) plus
  `onHistoryChanged`/`offHistoryChanged` using the existing handle-map
  `on`/`off` pair. No chrome-preload additions (leg spec — omnibox read
  path is Flight 4's design).
- `src/renderer/renderer-globals.d.ts`: added the four invokers to
  `GoldfinchInternalBridge` typed `(payload: any): Promise<any>` (the loose
  `downloadsList()`/`settingsGet()` style, per the leg's design-review
  correction of the draft's precedent — NOT the jars block's precise
  structural types) plus `onHistoryChanged(cb: (p: any) => void): number` /
  `offHistoryChanged(h: number): void` matching the exact style of the
  neighboring `onJarsChanged`/`offJarsChanged` declares.
- `src/main/main.js`: added `const { registerHistoryIpc } =
  require('./history-ipc')` alongside the other leg-1/2 history requires,
  and called `registerHistoryIpc({ ipcMain, historyStore, jars, broadcast:
  broadcastToChromeAndInternal })` at **module scope, immediately after the
  `registerJarIpc({...})` block closes** (before `ipcMain.handle('identity-
  new', ...)`) — the design-review-pinned location, not the leg-2 boot
  block. `git diff -- src/main/main.js` confirmed the leg's hunk is exactly
  the require line + this 6-line registration call; no unrelated changes.

**Verification**

- Registration-surface AC: `registers exactly the four chrome + four
  internal history channels, no others` — `[...handlers.keys()].sort()`
  deepEqual against the pinned 8-channel list.
- Extract-don't-fork AC (three-way pin, per leg spec): (a) the registration-
  surface test above; (b) the two behavioral-parity tests (internal-clear →
  chrome-list observes it; chrome-delete → internal-list observes it); (c)
  grep-AC below.
- Untrusted-sender AC: `an untrusted event (wrong origin) is rejected on
  every internal-history-* channel` iterates all 4 internal channels,
  asserting each throws `forbidden: ...` with zero broadcasts; a second test
  pins the strict `isInternalSession === true` check (allowlisted origin +
  `__goldfinchInternal: false` still rejects).
- Validation-branch AC: every op's malformed-payload/unknown-jar/bad-args
  (plus delete's not-found) branch asserted with the exact static string,
  for all 4 non-object payload shapes (`undefined`/`null`/string/number)
  where applicable. `before: null` pinned as accepted (not bad-args);
  `limit: 0` pinned as passing IPC validation.
- Broadcast-conditionality AC: delete broadcasts only on a true return
  (not-found case asserted zero events); clear broadcasts only when
  `cleared > 0` (empty-jar case asserted zero events, non-empty case
  asserted exactly one `history-changed { jarId }` event).
- Store-failure AC: one test per op (`listRecent`/`search`/`deleteVisit`/
  `clearJar` each independently toggled via the shared fake store's
  `throws` map) asserts the static `store-failure` string and that no
  exception propagates past the handler (the invoke helper would have
  thrown synchronously otherwise, failing the test).
- Grep-AC: `grep -n '\${' src/main/history-ipc.js` → zero hits (exit 1, no
  match). `grep -n "ipcMain.handle('history-\|registerInternalHandler(ipcMain,
  'internal-history-"` confirmed the same handler identifier
  (`handleList`/`handleSearch`/`handleDelete`/`handleClear`) is passed to
  both the bare and internal registration for each op.
- `node -e "require('./src/main/history-ipc')"` — no throw, confirming
  require-time side-effect freedom.
- Suite/typecheck/lint AC: `npm test` — 1376 tests (13 suites: 1343
  pre-leg-3 baseline + 33 history-ipc), 0 failures, wall-clock ~1.14s
  (target ~1s, no regression); `npm run typecheck` — clean, ~1.7s; `npm run
  lint` — clean, ~1.4s.

### Leg 4 — `verify-integration` (Developer half)

- **Status**: in-flight (Developer half landed; behavior-test run + landing
  pending with the Flight Director)
- **Started**: 2026-07-12

**Changes Made (Developer half — items 1–3 only)**

- Scale probe: uncommitted scratch script (`/tmp/.../history-scale-probe.js`,
  never part of the repo) opened `history-store.js` on a `mkdtempSync` temp
  dir, seeded 51,000 rows (17,000 per jar) across 3 jar ids (`personal`,
  `work`, `banking`) with varied domains/paths/titles and explicit
  `visitedAt` values spread across time, then timed `search(jar, 'exa'/
  'wiki'/'git')` and `listRecent(jar)` 10 runs each. Seeding took 6.18s
  (single-connection `recordVisit` calls through the store's public API, no
  explicit transaction wrapper — within the leg's "fine for seeding to take a
  few seconds" allowance). Temp dir removed after the run (`fs.rmSync`,
  confirmed no leftover directory).
- CLAUDE.md: added a new "History store (`src/main/history-store.js`)"
  section, placed as the sibling `###` section immediately after "Settings
  store" (before "Internal-bridge security model"). Covers: the DD1 substrate
  ruling + decision-record pointer, the `ExperimentalWarning`/Electron-bump
  re-verify rule, the recording pipeline (`wireTabViewEvents` partition
  threading, the recorder's three ordered decision gates, the positive
  registered-jar allowlist and why burner/internal need no dedicated
  exclusion code, title backfill), `retentionDays` + `pruneAllJars` cadence
  (boot + hourly, orphan GC), the `history-changed { jarId }`
  invalidation-only contract, the `history-ipc.js` twin-registration +
  static-error-string pattern, the `history.db`/`-wal`/`-shm` WAL file family
  + the `will-quit` close seam, and a one-line note on the two live-probed
  sqlite gotchas (bare-`?`-vs-numbered-placeholder collapse; default
  `unicode61` tokenizer). Every claim cross-checked against the current
  `history-store.js`, `history-recorder.js`, `history-ipc.js`, `jars.js`, and
  `main.js` before writing. No other doc claims went stale (README untouched
  — no user-visible claims changed this flight).

**Verification**

- Scale-probe AC: prefix-search median 2.055–2.203ms, max 2.149–2.816ms
  across `exa`/`wiki`/`git` (well inside the leg's informal single-digit-ms
  bound). `listRecent` median 0.094–0.099ms, max 0.135–0.335ms across all
  three jars. Full numbers:
  - `search("personal", "exa")`: median 2.203ms, max 2.816ms
  - `search("personal", "wiki")`: median 2.055ms, max 2.149ms
  - `search("personal", "git")`: median 2.102ms, max 2.632ms
  - `listRecent("personal")`: median 0.094ms, max 0.249ms
  - `listRecent("work")`: median 0.099ms, max 0.335ms
  - `listRecent("banking")`: median 0.096ms, max 0.135ms
- Suite/typecheck/lint AC (post doc edit): `npm test`, `npm run typecheck`,
  `npm run lint` all green — see Flight Director Notes below for exact
  numbers.
- Behavior-test AC (`/behavior-test history-recording`, spec status flip,
  leg status → landed): **not run by this Developer leg** — reserved for the
  Flight Director per the leg's split of work. This entry only covers items
  1–3 (Developer half); the leg's overall status stays `in-flight` until the
  Flight Director completes item 4 and lands it.

---

### Leg 4 — `verify-integration` (Flight Director half)

- **Status**: landed
- **Completed**: 2026-07-12

**Behavior test `history-recording`**: **PASS 8/8** (first run, live
two-agent Witnessed mode; run log
`tests/behavior/history-recording/runs/2026-07-12-19-37-28.md`; spec →
`active`). Recording, same-row title backfill, pushState capture, burner
exclusion (zero rows with the page demonstrably loaded), internal-page
exclusion, and restart survival (WAL checkpointed on kebab-Exit quit; no
duplicate rows on relaunch) all verified against the real app. Every PASS
grounded in the Validator's independent readOnly DB queries.

**Run findings carried forward** (for Flight 5 docs / debrief):
- `enumerateTabs` DOES list internal `goldfinch://` tabs (jarId
  'internal') for an admin identity, contradicting its tool description
  ("non-internal") at `src/main/automation/mcp-tools.js` — doc/behavior
  divergence to reconcile in Flight 5's docs pass (or fix the listing).
- Spec-quality notes from the Validator closing (visits table name,
  capture-then-assert resolved default jar, positive-load-before-absence
  rule, per-URL duplicate semantics at relaunch, 'other side closed' as
  the expected quit-race signature) — fold into the spec on its next
  touch.
- Session-MCP key-tier note: pre-wired goldfinch MCP session tools carry a
  jar-tier key; behavior-test admin ops need a scripted SDK client with
  the per-launch minted adminKey (apparatus note for the Flight 5
  isolation specs).

---

## Decisions

*(none yet)*

---

## Deviations

- None. Implemented exactly to the leg's contract — no API renames, no
  signature changes beyond the specified `wireTabViewEvents` partition param,
  no scope creep into leg 3 territory (`history-ipc.js`, `internal-preload.js`).
- Leg 3: None. Implemented exactly to the leg's IPC contract (channels,
  payload shapes, STATIC error strings, broadcast conditions, registration
  location) with zero API renames or scope creep beyond the leg's Files
  Affected list.

---

## Anomalies

- Leg 1: `ExperimentalWarning: SQLite is an experimental feature...` printed
  once per `node --test` process on `node:sqlite` require, as expected and
  accepted per flight DD1 — not a test failure, not investigated further.
- Leg 2: none observed.
- Leg 3: none observed.

---

## Flight Director Notes

- **2026-07-12 — flight start**: Flight status → in-flight; branch
  `flight/01-history-store` created off `main`. Crew file
  `leg-execution.md` validated (Crew / Interaction Protocol / Prompts all
  present). Deferred-review mode: single code review + commit after the
  last autonomous leg.
- **2026-07-12 — leg 1 design review**: Developer (Sonnet) verdict
  **approve with changes**; two HIGH findings, both live-probed by the
  reviewer with prescribed, verified fixes: (1) paging SQL mixed bare `?`
  with `?1` — SQLite collapses them onto one bound slot; rewritten with
  distinct `?1/?2/?3`; (2) flight DD3's `tokenize="unicode61 tokenchars
  '-._/:'"` made a whole URL one FTS token, defeating the leg's own prefix
  AC — override dropped, default unicode61 pinned (flight DD3 amended with
  rationale). Non-blocking items applied: named-object schema assertions
  (FTS shadow tables), unaliased-MATCH note, store-owned close() idempotence
  flag, flight DD8 `pruneExpired(…, now)` signature sync. **Re-review
  skipped** (FD call): every change was the reviewer's own live-verified
  prescription — a second pass would re-confirm its own text. Leg 1 → ready.
- **2026-07-12 — leg 1 implementation**: Developer (Sonnet) landed
  `history-store.js` + 22-test suite; 1315/1315 green ~1s; typecheck/lint
  clean; zero deviations. Uncommitted per deferred-review mode.
- **2026-07-12 — leg 2 design review**: Developer (Sonnet) verdict **approve
  with changes**. HIGH: (1) leg text self-contradicted on `lastVisitByWc`
  shape — pinned to `{ visitId, jarId }` pair (return type unchanged);
  (2) `retentionDays` would silently never land on fresh-install/legacy
  seeded jars — `load()` branch (c) maps `FRESH_SEED`/`LEGACY_DEFAULTS`
  literals directly, bypassing `validateContainers()`, and the reviewer
  live-probed that an `undefined` retention reaches `pruneExpired` as a
  `NaN` cutoff that binds silently and matches zero rows. Leg now names all
  FOUR assembly sites + seed-path tests. MEDIUM: five exact-shape
  `jars.test.js` assertions enumerated for update. Suggestions applied
  (coercion probe uses '15' not '30'; main.js require lines named;
  jar-page-model allowlist forward-pointer for Flight 3). Re-review skipped
  (same rationale as leg 1 — reviewer-prescribed, live-verified fixes).
  Leg 2 → ready.
- **2026-07-12 — leg 2 implementation**: Developer (Sonnet) landed
  recorder + jars retentionDays (all four assembly sites) + main.js wiring;
  1343/1343 green ~0.97s; typecheck/lint clean; grep-ACs pass. Uncommitted.
- **2026-07-12 — leg 3 design review**: Developer (Sonnet) verdict **approve
  with changes**. HIGH: the draft's twin-registration AC demanded
  reference-equality via fake ipcMain — unachievable
  (`registerInternalHandler` wraps handlers in an origin-check closure);
  rewritten to jar-ipc's own bar: registration-surface test + behavioral
  parity + same-identifier grep. MEDIUM: draft gave two contradictory
  registration locations 140 lines apart; pinned to module scope after
  `registerJarIpc` (~2489), lazy-closure-safe before store open. LOW: d.ts
  precedent corrected (loose downloadsList style, not jars' precise types).
  Suggestions applied (countByJar noted unused; `before: null` promoted to
  an AC; shared throwing-fake-store convention pinned). Re-review skipped
  (reviewer-prescribed fixes). Leg 3 → ready.
- **2026-07-12 — leg 2 implementation**: Developer (Sonnet) landed
  `history-recorder.js` (22-test suite) + `jars.js` `retentionDays` (four
  assembly sites + validator, six new/updated `jars.test.js` cases) +
  `main.js` wiring (partition threading, recorder calls, boot open/close,
  hourly prune) + `renderer-globals.d.ts`. 1343/1343 green ~1.06s;
  typecheck/lint clean; grep-AC confirmed single `Date.now()` hit (the
  injected default). Zero deviations. Uncommitted per deferred-review mode.
- **2026-07-12 — leg 3 implementation**: Developer (Sonnet) landed
  `history-ipc.js` (33-test suite, all three extract-don't-fork pins +
  per-channel untrusted-sender rejection) + `internal-preload.js` (4
  invokers + on/off pair) + `renderer-globals.d.ts` (loose-style bridge
  declares) + `main.js` (require + registration at the design-review-pinned
  location, confirmed by `git diff` showing no unrelated hunks). 1376/1376
  green ~1.14s; typecheck ~1.7s clean; lint ~1.4s clean; both grep-ACs
  (zero `${`, same-identifier twin registration) pass; require-time
  side-effect freedom confirmed. Zero deviations. Uncommitted per
  deferred-review mode. Leg 3 → landed. The flight's tentative leg list
  (flight.md) names one more leg (`verify-integration` — live boot
  verification, no source changes), so this is not necessarily the
  flight's last leg; that is an FD call, not this leg's to make.

---

## Session Notes

- **2026-07-12 (flight design)**: `node:sqlite` re-probed on the dev host
  (Node 22.22, plain `node -e`): `DatabaseSync`, FTS5 virtual table creation,
  insert, and MATCH query all work unflagged; `ExperimentalWarning` emitted
  (accepted cost, DD1). SQLite 3.50.4.
- **2026-07-12 (design review)**: Architect verdict **approve with changes**
  (single cycle). Empirical probes by the reviewer: FTS5 external-content
  triggers resync on INSERT/UPDATE/DELETE; `readOnly` reader succeeds against
  a WAL db held by a live writer; malformed MATCH throws (validates DD3
  sanitization); `jars.js` field-by-field rebuild defaults a missing
  `retentionDays` rather than dropping the record (verified against the real
  dev-profile `containers.json`). Changes applied to the spec: history store
  opens as a sibling call after `initProfileAndStores` (NOT by widening the
  unit-pinned 4-store seam); behavior-spec Step 8 quits via kebab Exit (never
  a single-PID SIGTERM); title-backfill map crash-leak named as accepted
  bounded cache behavior; `renderer-globals.d.ts` jar-record type added to
  leg 2; orphan-GC query shape pinned; `will-quit` rationale recorded; no new
  internal origin confirmed. Flight status → ready.
