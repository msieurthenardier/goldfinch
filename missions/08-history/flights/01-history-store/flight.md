# Flight: Per-Jar History Store

**Status**: landed
**Mission**: [Per-Jar Browsing History](../../mission.md)

## Contributing to Criteria

- [ ] Visits to web pages in jar-backed tabs are recorded (address, title, visit
      time) and survive an app restart. *(this flight's primary charter)*
- [ ] Burner tabs and internal (`goldfinch://`) pages never produce history
      records — nothing from a burner session is persisted anywhere.
      *(behavior-test-backed — spec authored this flight:
      `tests/behavior/history-recording.md`)*
- [ ] Each jar has its own retention policy (initial value 30 days) … entries
      older than the jar's retention are removed automatically without operator
      action. *(this flight lands the field, default, and automatic pruning;
      the EDIT control on the manage-jars page is Flight 3)*
- [ ] History adds no network egress: recording, search, retention, and
      suggestions operate entirely locally. *(recording/retention half; search
      and suggestions re-verified in Flights 3–4)*
- [ ] Groundwork for "suggestions stay felt-instant at scale": the schema and
      indexes that make prefix lookups responsive at tens of thousands of rows
      land here; the criterion itself closes in Flight 4.

---

## Pre-Flight

### Objective

Land the mission's storage substrate and the recording pipeline: a per-jar
browsing-history store on Node's built-in `node:sqlite` (the operator-ruled
substrate; this flight writes the M03-style decision record), fed by the
existing navigation events in `wireTabViewEvents`, gated by a positive
registered-jar allowlist so burner and internal sessions structurally never
record, pruned automatically per each jar's retention policy, announced via
`history-changed` invalidation-signal broadcasts, and exposed to the internal
pages through a `registerXIpc`-style twin-registered IPC module. At landing,
Goldfinch records real browsing history that survives restart — with no UI yet
(Flights 2–4) and no automation tool yet (Flight 5), but with the store API
shaped so both bolt on without rework.

### Open Questions

- [x] Substrate go/no-go → resolved at mission design (operator ruling):
      built-in `node:sqlite`. Decision record is DD1.
- [x] Write path (sync-only engine on the main event loop) → see DD2.
- [x] What counts as a visit (redirects, SPA, reloads, failed loads,
      duplicates) → see DD4.
- [x] Burner/internal exclusion mechanics (positive allowlist shape) → see DD5.
- [x] Where the per-jar retention value lives + pruning cadence → see DD6.
- [x] `history-changed` channel payload + subscriber inventory → see DD7.
- [x] Admin identity and history (mission open question) → see DD10.
- [x] Does Flight 1 register the read/mutate IPC channels, or defer to their
      Flight-3 consumer? → registered here per the mission's Flight-1 bullet
      ("registerXIpc-style wiring"); shapes are consumer-anticipated. See DD9.

### Design Decisions

**DD1 — Substrate decision record: built-in `node:sqlite` (M03-style record).**
Goldfinch's history store uses Node's built-in `node:sqlite` (`DatabaseSync`),
not a vendored native module. This is the operator's ruling at mission design,
informed by the Architect's live probe (FTS5 virtual tables confirmed working
inside a real Electron 42 main process) and re-confirmed at flight design on
the dev host (Node 22.22: `DatabaseSync` + FTS5 + prefix MATCH work unflagged;
`ExperimentalWarning` emitted).
- Rationale: preserves the zero-runtime-dependency identity (the M03 MCP-SDK
  precedent set the bar for what earns a dependency; a storage engine the
  runtime already ships does not). No per-platform prebuilds, no
  electron-builder packaging changes, no CI surface.
- **The accepted ongoing cost, named**: `node:sqlite` is an **experimental**
  Node API. It emits `ExperimentalWarning` at require time (in the app console
  and in `npm test` output — cosmetic, accepted), and its API may shift across
  Electron/Node upgrades. Every future Electron major bump (starting with the
  already-backlogged 42 → 43) must re-run the store's unit suite and treat a
  `node:sqlite` API break as a first-class migration cost. This is a standing
  tax, not a one-time risk.
- Fallback (only on a hard mid-mission blocker): vendored `better-sqlite3`,
  which would require per-platform prebuilds AND electron-builder packaging
  verification (`build.files` has no `node_modules` entry today) — a real
  flight's worth of work, which is why the fallback is not the default.
- Trade-off: experimental-API exposure, accepted above. The engine is
  synchronous-only (no async/worker variant) — see DD2.

**DD2 — Write path: direct synchronous writes in WAL mode on the main event
loop.** The store opens with `journal_mode=WAL` and `synchronous=NORMAL`, and
every write (record visit, title backfill, delete, clear, prune) is a direct
synchronous call through cached prepared statements. No debounce queue, no
batch buffer, no utility-process offload.
- Rationale: a single-row INSERT through a prepared statement into a WAL
  database is microseconds-to-tens-of-microseconds — orders of magnitude
  cheaper than the whole-file JSON rewrites the settings/downloads stores
  already perform synchronously on the same loop. Navigation frequency
  (human browsing, a handful of jars) does not approach the rate where this
  matters. WAL means writers never block the readers Flight 4 will add for
  suggestion queries, which carries the "felt-instant under concurrent
  queries" concern.
- Trade-off: we give up write batching that would help at pathological
  navigation rates (rapid redirect chains); accepted — the duplicate
  suppression in DD4 bounds the worst case, and the divert criterion below
  names the escape hatch (utility-process offload) if live use proves this
  wrong.
- Durability: `will-quit` closes the database (WAL checkpoint on close);
  `synchronous=NORMAL` in WAL risks at most the last transactions on OS
  crash — acceptable for browsing history (not user-authored data).
  `will-quit` is a **new lifecycle seam, chosen deliberately** (the existing
  teardown — `downloadsManager.flushInterrupted()` + `mcpServer.stop()` —
  rides `before-quit`): closing after windows are torn down guarantees no
  in-flight navigation can still be writing. *(Architect review: rationale
  requested.)*

**DD3 — Schema: single `visits` table + FTS5 external-content index.**
`userData/history.db`, schema v1 (a `meta`/`user_version` pragma marks it):

```sql
CREATE TABLE visits (
  id         INTEGER PRIMARY KEY,
  jar_id     TEXT    NOT NULL,
  url        TEXT    NOT NULL,
  title      TEXT,
  visited_at INTEGER NOT NULL          -- ms epoch
);
CREATE INDEX visits_jar_time ON visits (jar_id, visited_at DESC);
CREATE INDEX visits_jar_url  ON visits (jar_id, url);
CREATE VIRTUAL TABLE visits_fts USING fts5(
  url, title, content='visits', content_rowid='id',
  prefix='2 3 4'
);
-- default unicode61 tokenizer, DELIBERATELY no tokenchars override: with
-- '-._/:' as tokenchars a URL becomes ONE giant token and 'exam' prefix
-- queries match nothing (leg-1 design review, live-probed); default
-- tokenization splits https://example.com/page1 into
-- ['https','example','com','page1'], which is exactly what omnibox
-- prefix matching needs.
-- INSERT/UPDATE/DELETE triggers keep visits_fts in sync with visits
```

- One visit = one row (the honest model for "browse recent visits"
  chronologically); dedupe/ranking for suggestions happens at query time
  (`GROUP BY url` over the FTS-narrowed subset), which Flight 4 tunes.
- FTS5 external-content + prefix indexes is what makes prefix search
  responsive at tens of thousands of rows; the flight-design probe confirmed
  the exact construction works on both the host Node and (per the mission
  probe) Electron 42's main process.
- Search input is **sanitized into FTS5 syntax by the store** (tokens quoted,
  prefix `*` appended) — raw user text is never passed as a MATCH expression
  (FTS5 operator injection throws).
- Trade-off vs a two-table (pages+visits) design: suggestion queries do a
  GROUP BY at query time instead of reading a precomputed per-URL row.
  Accepted at this cardinality (the FTS subset is small); revisit in Flight 4
  only if the felt-instant criterion fails empirically.

**DD4 — Visit semantics: committed main-frame navigations, http(s) only,
consecutive-duplicate suppression, async title backfill.**
- **Record on** `did-navigate` (committed main-frame navigation — fires with
  the post-redirect final URL; never fires for failed loads) and
  `did-navigate-in-page` (SPA/pushState). Reloads re-fire `did-navigate` and
  DO count as visits, subject to suppression below.
- **Scheme allowlist**: record only `http:`/`https:` URLs. This structurally
  excludes `goldfinch://` internal pages, `about:blank`, and anything else —
  a positive check, matching the mission's allowlist posture.
- **Consecutive-duplicate suppression**: skip recording when the URL equals
  the same jar's most-recently-recorded URL and less than 30 s have elapsed
  (in-memory per-jar `{ url, ts }` map — no DB read on the hot path). Bounds
  reload spam and redirect landing loops.
- **Title backfill**: titles arrive after navigation via
  `page-title-updated`. The recorder keeps a per-`wcId` map of the last
  recorded visit id; a title event updates that row (and its FTS shadow).
  Tab teardown clears the map entry. **Cache contract**: source of truth is
  the store row; the map is write-through bookkeeping invalidated by the next
  navigation on that `wcId` or by `forgetTab`. A *crashed* tab (no
  `tab-close`) leaks its entry — a bounded, low-severity leak (wcIds are
  never reused; mirrors the pre-existing `tabViews` crash gap), accepted, not
  a correctness bug. *(Architect review.)* The recorder's per-jar
  duplicate-suppression map is likewise in-memory only and empty after
  restart — a post-restart revisit within 30 s records an extra row, which is
  correct (visits are facts, suppression is spam-bounding).

**DD5 — Positive allowlist = "partition resolves to a registered jar".** The
recorder records only when the tab's partition string exactly matches the
`partition` of a jar in the live registry (`jars.list().find(j =>
j.partition === partition)`), and it stores that jar's `id`.
- This is deliberately **stronger than the mission's literal
  `persist:container:` prefix check** and covers the legacy default jar,
  whose partition is `persist:goldfinch` (no `container:` segment) — a real
  jar whose history the mission's "every jar keeps its own history" outcome
  requires. A bare prefix check would silently exclude it.
- It preserves — and strengthens — the mission's structural intent: the gate
  is a **positive resolution against the registry**, never "is not a burner".
  Burner partitions (`burner:<n>`) and the internal partition
  (`goldfinch-internal`) match no registered jar and record nothing, by
  construction. The DD4 scheme allowlist independently excludes internal
  pages even if a registry entry ever pointed at them.
- The partition is threaded into `wireTabViewEvents` from its call site
  (`main.js` `tab-create`), where it is already computed — the recorder never
  re-derives identity from the webContents.

**DD6 — Retention lives on the jar record; pruning runs at open + hourly.**
- `jars.js` gains a `retentionDays` field on each jar record (integer,
  1–3650, default **30**). Existing v2 `containers.json` files upgrade in
  place via the store's field-by-field rebuild (missing/invalid →
  default 30); no envelope-version bump (the shape tolerates additive
  fields). The edit UI is Flight 3; this flight lands storage, validation,
  and default.
- Rationale: the jar record is the established home for per-jar metadata, it
  already rides `jars-changed` broadcasts (Flight 3's UI gets live updates
  for free), and retention is operator-facing jar configuration, not history
  data.
- **Pruning cadence**: `pruneExpired` runs once at store open (app launch)
  and on a 60-minute `setInterval` (unref'd). Per jar, it deletes visits
  older than `now − retentionDays`; it also garbage-collects **orphan rows**
  whose `jar_id` no longer resolves to a registered jar (defense-in-depth for
  jar deletions that predate Flight 3's delete-purge wiring). The orphan set
  is computed as `SELECT DISTINCT jar_id FROM visits` minus the registry's
  ids (the `visits_jar_time` index makes both the distinct scan and the
  per-jar deletes cheap — no full-table pattern scan). *(Architect review:
  pinned.)* Prune deletes broadcast `history-changed` per affected jar.
- Trade-off: up to ~1 h of over-retention between ticks — invisible at a
  30-day granularity. On-write pruning rejected (hot-path work for no
  operator-visible gain).

**DD7 — `history-changed` is an invalidation signal: `{ jarId }`.** Broadcast
via the existing `broadcastToChromeAndInternal` on every mutation: a recorded
visit, a title backfill, a per-entry delete, a jar clear, and per-jar prune
deletions. Payload is `{ jarId }` only — **never** row data or counts;
subscribers re-query through their own read path (M06 lesson: invalidation
semantics, not full-payload snapshots).
- Subscriber inventory at this flight: **none live** (the Flight-3 history
  panel is the first consumer; Flight 4's omnibox reads via its own query
  channel and may not subscribe at all). The channel + preload subscription
  land now so Flight 3 builds against a wired seam.
- Per-navigation broadcast volume is one `send` per recorded visit — noise
  accepted; any consumer that repaints expensively debounces on its side
  (noted for Flight 3's design).

**DD8 — Module shapes: two new Electron-free CJS main modules.**
- `src/main/history-store.js` — the substrate. CJS (`src/main/**` is
  CommonJS per eslint config), `// @ts-check`, Electron-free: the directory
  is injected at `open(userDataPath)` (house store pattern —
  settings/downloads precedent), `node:sqlite` required at module top. API:
  `open(dir)`, `close()`, `recordVisit({ jarId, url, title?, visitedAt })`,
  `setTitle(visitId, title)`, `listRecent(jarId, { limit, before? })`,
  `search(jarId, query, { limit })`, `deleteVisit(jarId, visitId)` (jar-scoped
  — the id alone never authorizes cross-jar deletion), `clearJar(jarId)`,
  `pruneExpired(retentionByJarId, now)` (returns per-jar deletion counts;
  `now` injected — no `Date.now()` inside the store),
  `countByJar(jarId)`. Reads are jar-keyed throughout — the Flight-5
  automation façade and Flight-4 suggestions call the same jar-scoped API.
- `src/main/history-recorder.js` — the gate + bookkeeping (DD4/DD5 logic).
  Electron-free, injected deps: `{ store, listJars, broadcast, now? }`.
  Exposes `handleNavigation({ wcId, partition, url })`,
  `handleTitleUpdated(wcId, title)`, `forgetTab(wcId)`. All decision logic
  (allowlist, scheme check, suppression, backfill map) is unit-testable
  offline with fakes.
- Both are testable under plain `node --test` with `mkdtempSync` temp dirs
  and the house cache-bust-reload pattern; the flight-design probe confirmed
  `node:sqlite` works unflagged on the dev host's Node 22.22.

**DD9 — `src/main/history-ipc.js`, twin-registered, consumer-anticipated.**
`registerHistoryIpc({ ipcMain, historyStore, jars, broadcast })` defines
handler bodies once and registers each twice — bare `ipcMain.handle` on
chrome-trusted channels AND `registerInternalHandler` on `internal-history-*`
twins (the `jar-ipc.js` extract-don't-fork pattern):
- `history-list` / `internal-history-list` — `{ jarId, limit, before? }` →
  `{ ok, visits }`
- `history-search` / `internal-history-search` — `{ jarId, query, limit }` →
  `{ ok, visits }`
- `history-delete` / `internal-history-delete` — `{ jarId, visitId }` →
  `{ ok }`
- `history-clear` / `internal-history-clear` — `{ jarId }` → `{ ok }`
- Failure branches are fail-closed and return `{ ok: false, error }` with
  branch-discriminable `history: <op> — <code>` strings (the M07 F1 contract
  pattern; the mission notes the first `result.error` consumer must
  prefix-match — these strings are static, no dynamic interpolation).
- Unknown jar id → `{ ok: false }`; jar ids are validated against the live
  registry before any store call. Mutations broadcast `history-changed`.
- `internal-preload.js` gains `historyList` / `historySearch` /
  `historyDelete` / `historyClear` + `onHistoryChanged` / `offHistoryChanged`
  (handle-map pattern), each declared on `GoldfinchInternalBridge` in
  `renderer-globals.d.ts` (preload-bridge declare rule). No chrome-preload
  additions this flight (the omnibox read path is Flight 4's design).
- **No new internal origin**: history has no page of its own — its UI renders
  inside `goldfinch://jars` (Flights 2–3), so the existing `INTERNAL_ORIGINS`
  set is untouched, deliberately. *(Architect review: confirmed.)*
- **Not in scope here**: the `JAR_DATA_CLASSES` `history` descriptor and the
  clear-data/wipe/delete integration (Flight 3, where the fourth
  wipe-composition copy triggers the DD3-extraction clause).

**DD10 — Admin automation identity: consistent with the existing model.** The
mission's open question is resolved to the default: the admin key reads any
jar's history (consistent with admin's existing bypass posture in `scope.js`);
jar keys read only their own jar. No history is carved out of admin scope.
This flight ships **no** automation tool (Flight 5 does); the decision is
recorded now because the store API shape (jar-keyed reads callable with any
jar id) is what makes both tiers implementable without rework.

### Prerequisites

- [x] `node:sqlite` + FTS5 confirmed inside Electron 42's main process (live
      probe at mission design).
- [x] `node:sqlite` + FTS5 + prefix MATCH confirmed unflagged on the dev
      host's Node 22.22 under plain `node -e` (flight-design probe) — unit
      tests can use the real engine; no `--experimental-sqlite` flag needed
      in `npm test`.
- [x] Electron baseline 42.6.1; suite + typecheck green on `main` (clean tree
      at flight design).
- [x] `wireTabViewEvents` call site has the partition in scope
      (`main.js` `tab-create`, `tabViews.set` already stores it).
- [x] No port/service conflicts: the flight introduces no network surface.

### Pre-Flight Checklist

- [x] All open questions resolved
- [x] Design decisions documented
- [x] Prerequisites verified
- [x] Validation approach defined
- [x] Legs defined

---

## In-Flight

### Technical Approach

Four modules carry the flight, three of them new:

1. **`src/main/history-store.js`** (new) — owns the SQLite database
   (`userData/history.db`), schema creation (DD3), prepared statements, WAL
   configuration (DD2), FTS sync triggers, and the full jar-keyed API (DD8).
   No Electron import; directory injected at `open()`.
2. **`src/main/history-recorder.js`** (new) — owns the recording decision
   (DD4/DD5): registry-resolution allowlist, scheme allowlist, duplicate
   suppression, the per-`wcId` title-backfill map, and `history-changed`
   emission on successful writes. No Electron import; deps injected.
3. **`src/main/history-ipc.js`** (new) — twin-registered IPC (DD9), modeled
   line-for-line on `jar-ipc.js`'s structure (single deps object, handler
   bodies defined once, chrome + internal registration, returned broadcaster
   if main needs one).
4. **`src/main/main.js` / `jars.js` / preload** (edits) —
   thread the partition into `wireTabViewEvents` and call the recorder from
   the existing `did-navigate` / `did-navigate-in-page` / `page-title-updated`
   guards (an addition alongside an existing forward — no new
   instrumentation); open the history store as a **sibling call in `main.js`
   immediately after `initProfileAndStores(...)` returns** — NOT by widening
   that function's unit-pinned 4-store `load(path)` signature
   (`test/unit/init-profile-order.test.js` hardcodes it; the dev-profile
   `setPath` redirect has already run by then, so the ordering invariant is
   satisfied for free — *Architect review: pinned*); close it on `will-quit`;
   start the prune interval; add `retentionDays` to the jar record (DD6) and
   to the `jarsList()` return type in `renderer-globals.d.ts` (checkJs would
   otherwise reject future `.retentionDays` reads — *Architect review*);
   register the IPC module next to `registerJarIpc`; extend
   `internal-preload.js` + `renderer-globals.d.ts` (DD9).

Unit coverage follows the house store-test pattern (temp dirs, cache-bust
reload, corrupt-input tolerance, validator drops) plus recorder decision
tables (allowlist × scheme × suppression) and IPC handler tests with fakes.
The scale question ("felt-instant at tens of thousands") is probed in the
verify-integration leg with a throwaway seeding script, NOT a committed unit
test — the M07 suite-speed work (~1 s wall-clock) is not spent on a 50k-row
fixture every run.

### Checkpoints

- [x] Store opens, creates schema v1, records/reads/searches/deletes/prunes
      under unit tests; suite still ~1 s.
- [x] Recorder decision table pinned: registered jar + http(s) records;
      burner/internal/unknown partitions and non-http schemes never do;
      duplicate suppression and title backfill behave.
- [x] Live app records real visits per jar, survives restart, and the
      `history.db` file contains rows ONLY for registered jars after mixed
      jar/burner/internal browsing.
- [x] `history-changed` observed on the internal bridge; IPC twins respond on
      both trust domains; fail-closed branches return pinned error strings.
- [x] Behavior test `history-recording` passes (recording, burner/internal
      exclusion, restart survival).

### Adaptation Criteria

**Divert if**:
- `node:sqlite` hits a hard blocker inside Electron 42 that the mission
  probes didn't surface (corruption, crash, missing FTS5 in a packaged
  build) → stop, sweep the failure class, escalate for the
  `better-sqlite3` fallback ruling (packaging verification becomes a
  prerequisite).
- Synchronous writes measurably jank the main loop in live use (navigation
  stutter attributable to the store) → stop and re-plan the write path
  (batched queue or utility process) before piling on consumers.
- The jars.js `retentionDays` addition can't upgrade existing profiles in
  place (validator drops whole records) → stop; a registry migration is
  mission-level, not a leg detail.

**Acceptable variations**:
- Exact FTS5 tokenizer/prefix tuning, statement layout, and pragma details.
- The suppression window constant (30 s) and prune interval (60 min).
- Error-string codes, as long as they're static and branch-discriminable.
- Splitting or merging legs 2–3 if the seam proves awkward mid-flight.

### Legs

> **Note:** These are tentative suggestions, not commitments. Legs are
> planned and created one at a time as the flight progresses.

- [x] `store-core` — `history-store.js`: schema v1 + FTS5, WAL open/close,
      full jar-keyed API, sanitized search, prune with orphan GC; unit suite.
- [x] `recorder-and-wiring` — `history-recorder.js` + the main.js threading
      (partition into `wireTabViewEvents`, recorder calls, `forgetTab` on
      teardown), store open as a sibling call after `initProfileAndStores`,
      `will-quit` close, prune scheduling, `jars.js` `retentionDays` (+ the
      `renderer-globals.d.ts` jar-record type); unit suites — incl. an
      upgrade-path test against a fixture shaped exactly like the real
      dev-profile `containers.json` (v2, three containers, no
      `retentionDays`).
- [x] `history-ipc` — `history-ipc.js` twins + `internal-preload.js`
      subscriptions/invokers + `renderer-globals.d.ts` declares; unit suite.
- [x] `verify-integration` — live boot (`npm run dev:automation`): mixed
      jar/burner/internal browsing inspected in `history.db`, restart
      survival, scale probe (seed ~50k rows, time prefix search), run
      `/behavior-test history-recording`, docs (CLAUDE.md history section +
      decision-record pointer, README if user-visible claims change).

---

## Post-Flight

### Completion Checklist

- [x] All legs completed
- [ ] Code merged
- [x] Tests passing
- [x] Documentation updated

### Verification

- `npm test` / `npm run typecheck` / `npm run lint` green throughout; suite
  wall-clock stays ~1 s (no 50k-row fixtures in the unit suite).
- Behavior test `history-recording` (authored this flight, run at
  verify-integration): jar visits recorded with title+time, burner and
  internal navigation leave zero rows, records survive an app restart.
  Apparatus: goldfinch MCP (drive) + shell reads of the dev-profile
  `history.db` via `node -e` with `node:sqlite` (WAL permits a concurrent
  reader). **Observability premise audited at design**: the act path is the
  existing MCP drive surface; the read path is the on-disk database itself —
  no test-only seam required.
- Scale probe at verify-integration: with ~50k seeded rows, a prefix search
  returns in single-digit milliseconds (informal bound; the binding
  felt-instant criterion closes in Flight 4 with the real omnibox).
