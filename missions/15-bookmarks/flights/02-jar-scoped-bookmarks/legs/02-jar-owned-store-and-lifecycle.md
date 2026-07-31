# Leg: jar-owned-store-and-lifecycle

**Status**: completed
**Flight**: [Jar-Scoped Bookmarks](../flight.md)

## Objective

Move bookmark truth from the app-scoped `documents` blob to a jar-keyed `bookmarks` table (app.db schema v3), rewrite the store and all six IPC channels jar-first, wire jar-delete teardown and the new Bookmarks data class, and re-target every pinned test whose premise shifts — main-process side only.

## Context

- Implements flight DD1 (table, schema v3), DD2 (position ordering), DD3 (jarId-first API), DD4 (corruption/validation split), DD5 (`bookmarks-changed { jarId }`), DD8's main-side guard only (registry rejection), DD9 (delete drops / wipe keeps / Bookmarks data class), DD10 (clean slate + migration-failure distinguishability).
- **Renderer is deliberately untouched.** Preload, `renderer-globals.d.ts`, and every chrome consumer change in leg 3. Between this leg and leg 3 the app is test-green but runtime-degraded (chrome still calls the old un-jarred shapes; mutation handlers reject, reads return empty). Acceptable: nothing commits until flight-end review covers the composed result. The **one** renderer-adjacent exception: none — even `register-overlay-ipc.js`'s bookmark-edit forward is payload-compatible (the jarId is captured chrome-side at open, DD13, leg 3).
- Ground truth from leg 1: `renderer.js` extraction landed; no main-side file this leg touches was modified by leg 1.

### Leg design decisions (settling what the flight deferred here)

**L2-DD-A — Reorder (and every multi-row mutation) runs in an explicit transaction.** `reorder(jarId, ids)` rewrites every position in the jar; a throw mid-loop would leave duplicate positions. Wrap the rewrite in `BEGIN IMMEDIATE` … `COMMIT` with `ROLLBACK` on throw (node:sqlite `DatabaseSync.exec`). Same treatment for the v3 migration step (below). This resolves the flight's open question "does position normalization need to be transactional?" — yes, cheaply.

**L2-DD-B — Migration failure is distinguished from corruption by SQLite *numeric result code*, and a migration bug never quarantines a healthy profile.** Today `open()`'s catch (`app-db.js:235-240`) quarantines on *any* `attemptOpen` throw — a v3-step bug (table collision, failed index, DELETE error) would silently destroy settings, jars, shields, downloads, session, and cookie bookkeeping (flight DD10's finding). New contract, **corrected by design review** (empirically probed against this repo's Node v22.22.0):
- `err.code` is useless for classification — it is the literal string `'ERR_SQLITE_ERROR'` for *every* SQLite-thrown error. The only discriminating signal is **`err.errcode`, a raw integer primary result code**, and `require('node:sqlite').constants` exports no symbolic names for result codes — the values are hardcoded with a comment: **11 (`SQLITE_CORRUPT`)** and **26 (`SQLITE_NOTADB`)**.
- Each ladder step body is wrapped; a throw whose `errcode` is 11 or 26 rethrows untagged → outer catch quarantines, exactly as today. Any **other** throw from a ladder step is tagged (`err.appDbMigrationFailure = true`) and `open()` **rethrows it instead of quarantining** — the file is healthy at its last committed version; destroying it would be strictly worse than failing loudly (the house "programmer errors propagate, never dissolve" rule, `bookmarks-store.js:166-170`).
- A **pin test** asserts the literal numeric values node:sqlite currently returns for a real corrupt file (11 via mangled page bytes, 26 via not-a-database bytes) — so a future SQLite/Node bump that changed them fails loudly instead of silently misclassifying (design-review suggestion, adopted).

**L2-DD-B2 — Each ladder step commits its own `user_version` bump atomically, replacing the single end-of-ladder write.** Design review found the compound case: with the current shape (one `PRAGMA user_version` write after all steps, `app-db.js:157-159`), a v0 profile whose v1/v2 steps succeed but whose v3 step throws would be left with v1/v2 tables durably on disk and `user_version` still 0 — and the *next* open would re-run the v1 step into "table already exists" (errcode 1 → tagged → not quarantined): a permanent boot brick with no self-healing. Fix: each step's transaction contains its DDL/DML **and** its own `PRAGMA user_version = <n>` (user_version writes are transactional — header field), so a throw at step N leaves the file durably and consistently at version N-1, and the next open resumes from there, retrying only the failed step. Success paths are behavior-identical.

**L2-DD-C — Registry rejection covers the four mutation channels; reads pass through.** Per DD8's text ("rejects *writes* for any jarId not in `jars.list()`"): `bookmark-add`/`bookmark-update`/`bookmark-remove`/`bookmark-reorder` return `{ ok: false, reason: 'unknown-jar' }` for a jarId absent from the registry (covers burner ids, `internal`, and deleted jars in one rule). `bookmarks-get`/`bookmarks-suggest` skip the check — an unknown jar naturally yields zero rows, and a read must never fail during the jar-delete race window.

**L2-DD-D — Row repair happens at read, filter-only.** The per-row validator (DD4) drops url-invalid/id-invalid rows and repairs title/icon *in the returned copies*; it never writes back or deletes during a read. Matches Flight 1's read-path behavior (validate on load, persist only on next mutation) minus the persistence — a read stays a read.

**L2-DD-E — The Bookmarks data class maps to the `history` panel on the jars page** *(design-review finding — FD ruling)*. `panelForDataClass` (`src/shared/jar-panel-model.js:34-46`) decides which panel hosts each class's "Clear X" button (`jars-section-controller.js:344-356` — fail-closed: an unrouted class renders **no control**), and `jar-panel-model.test.js:43` asserts totality over the real `JAR_DATA_CLASSES` — so adding the fifth entry without a mapping both fails the suite *and* makes DD9's clear control unreachable from the UI. Ruling: `case 'bookmarks': return 'history'` — the History panel is the browsing-record panel, and "Clear bookmarks" beside "Clear history" is coherent; a dedicated bookmarks panel is unjustified (the jars page lists nothing bookmark-shaped). Placement gets a HAT sanity-check in leg 4. The `bookmarks` clear broadcasts `bookmarks-changed`, never `jar-data-changed`, so `handleJarDataChanged`'s panel-count refresh (`jars-section-controller.js:832-843`) is deliberately untouched.

## Inputs

- Leg 1 landed (uncommitted) on `flight/02-jar-scoped-bookmarks`; suite at 3278 green
- `app-db.js` at `CURRENT_VERSION = 2` (`:75`), ladder in `attemptOpen` (`:142-169`), quarantine catch (`:235-240`), `createCookieSeenStore` factory precedent (`:326-388`)
- `bookmarks-store.js` as the Flight 1 array/document store (module array `:66`, `validateEntries` `:120-143`, envelope v1)
- `register-bookmarks-ipc.js` six channels, no jarId, `broadcast('bookmarks-changed', {})`
- `history-store.js` jarId-first precedent (`suggest(jarId, query, …)` `:449`, `deleteVisit(jarId, visitId)` `:484`, `clearJar(jarId)` `:495`)

## Outputs

- app.db at schema v3 with the `bookmarks` table; legacy `documents` bookmarks row deleted on migration
- `bookmarks-store.js` stateless, jarId-first, position-ordered, row-validating
- All six IPC channels jar-addressed; `bookmarks-changed { jarId }`
- Jar delete drops bookmarks; identity wipe keeps them; fifth `JAR_DATA_CLASSES` entry dispatching in `handleClearData`
- Pinned tests re-targeted (renamed, never deleted); new unit coverage per flight Verification
- `tests/behavior/bookmarks-bar.md` checkpoint 12 amended (premise invalidated by this leg)

## Acceptance Criteria

- [x] **Schema v3** exists in `app-db.js`: the `bookmarks` table per flight DD1's shape (`id` PK, `jar_id` NOT NULL, `url` NOT NULL, `title`, `icon`, `position` NOT NULL, `added_at` NOT NULL), index `bookmarks_jar_pos (jar_id, position)`, unique index `bookmarks_jar_url (jar_id, url)`; `CURRENT_VERSION = 3`; the v3 ladder step also executes `DELETE FROM documents WHERE store = 'bookmarks'`. **Every ladder step runs in its own transaction containing its own `PRAGMA user_version` bump** (L2-DD-A/B2). A profile at version 0, 1, or 2 lands on 3 in one open; a v3 file no-ops; a step-N failure leaves the file durably at N-1 and a subsequent open resumes from there (tested).
- [x] **Migration-failure distinguishability** (L2-DD-B): classification is by `err.errcode` ∈ {11, 26} — never `err.code`; a non-corruption throw from a ladder step propagates out of `open()` tagged, without quarantining, leaving the file at its last committed version; a corruption-class throw still quarantines and recreates. Both paths unit-tested (pre-seeded conflicting `bookmarks` table for the former; garbage-bytes file for the latter), plus the errcode **pin test** (11 and 26 as currently thrown by node:sqlite for real corrupt/not-a-db files).
- [x] **`createBookmarksStore()` factory** in `app-db.js` alongside `createCookieSeenStore()`, owning the prepared statements and SQL-level operations (list-by-jar ordered by position, insert, update, delete, position rewrite in-transaction, `clearJar`, plus what validation needs); statements live in `prepareStatements()` with all-distinct numbered placeholders (house gotcha).
- [x] **`bookmarks-store.js` rewritten**: no module-scoped bookmark array; API is `list(jarId)`, `add(jarId, {url,title,icon})`, `update(jarId, id, patch)`, `remove(jarId, id)`, `reorder(jarId, ids)`, `clearJar(jarId)`; `load(userDataPath)` retained for `init-profile.js:72` shape parity (resolves the factory, reads nothing into memory). Per-row read validation preserves Flight 1's exact drop/repair split: `url` DROP-worthy (`isSafeTabUrl` and not `about:blank`), `id` DROP-worthy, `title` REPAIRED (falls back to the row's url), `icon` REPAIRED (must match `/^data:image\//i` else `null`) (L2-DD-D). Return-shape contracts preserved: `add` idempotent per jar via `bookmarkUrlsMatch` (`created:false` returns the existing entry); `update` rejects `duplicate-url` only within the jar, `not-found` for wrong jar or missing id; `reorder` ignores unknown/duplicate ids and preserves omitted entries in prior relative order; all results are copies.
- [x] **Position invariant**: after any mutation, each jar's positions are exactly `0..n-1` gap-free; `add` appends at n; `remove` renormalizes; `reorder` rewrites inside one transaction (L2-DD-A).
- [x] **IPC jar-addressed**: all six handlers take `jarId` in the payload; the four mutation channels reject jarIds absent from `jars.list()` with `{ ok: false, reason: 'unknown-jar' }` (L2-DD-C — requires injecting `jars` into `registerBookmarksIpc` at `main.js:1779-1783`); `bookmarks-suggest` becomes per-jar (`matchBookmarks(store.list(jarId), …)`); every broadcast is `bookmarks-changed { jarId: <the mutated jar> }` with the existing gates preserved (add only when `created`, update/remove only when `ok`, reorder unconditional).
- [x] **DD9 lifecycle wiring**: `jar-registry-ipc.js`'s `handleRemove` calls `bookmarksStore.clearJar(removed.id)` in its **own** try/catch (fail-soft, logged `[bookmarks]`, never flips `ok`), *not* inside the `wipeJarData` try at `:104-108`, and broadcasts `bookmarks-changed { jarId }` when rows were deleted (n>0); `wipeJarData` (`jar-data-lifecycle.js:20-36`) is **not** modified; `jar-data-classes.js` gains `{ id: 'bookmarks', label: 'Bookmarks', storages: null, custom: 'bookmarks' }`; `jar-data-ipc.js`'s `handleClearData` dispatches `custom === 'bookmarks'` → `bookmarksStore.clearJar` **before** the storages/cache fallthrough (the `custom === 'history'` idiom at `:61-70`, own error fragment `bookmarks-failure`, logged), broadcasting `bookmarks-changed { jarId }` under the n>0 gate (`:103` precedent). **Injection routing** (design-review finding): `main.js` calls neither registrar directly — it calls the `registerJarIpc` facade (`main.js:1727`, `src/main/jar-ipc.js`), so `jar-ipc.js`'s signature/JSDoc gains a `bookmarksStore` slot forwarded to both registrars (`jar-ipc.js:47`, `:61`). The injection is a **plain optional reference** (not a `getVaultStore`-style accessor — the store is an eagerly-required module singleton like `historyStore`); registrars skip the step when it is absent (offline-test gating).
- [x] **Jars-page panel routing** (L2-DD-E): `src/shared/jar-panel-model.js` gains `case 'bookmarks': return 'history'`; `jar-panel-model.test.js` gains the explicit `bookmarks -> history` case alongside its totality check (which otherwise fails the moment the fifth class lands).
- [x] **Jars-page confirm/status copy** *(round-2 design-review finding, HIGH)*: `jars-section-controller.js`'s `CLEAR_COPY` and `CLEAR_OK_NOTE` dictionaries (`:556-567`) are hardcoded per class id and feed `entry.copy`/`entry.okNote` via `DATA_ACTIONS` (`:580-587`) into `jars-confirm-modal.js` — with no `bookmarks` key, the confirm dialog body and the success toast would render the literal string `"undefined"`. Both dictionaries gain `bookmarks` entries (e.g. "Clears this jar's saved bookmarks." / "Bookmarks cleared."), and a totality test over the **real** `JAR_DATA_CLASSES` (the `jar-panel-model.test.js:43` pattern — the existing `jars-section-controller.test.js` uses a fake two-class fixture and cannot catch this) pins that every class id has both copy strings, so a future sixth class cannot regress the same way. *Verified the test actually catches the regression: reverting the `bookmarks` entries locally and re-running the new totality test fails with the exact `"undefined"` string before the fix is restored.*
- [x] **Pinned tests re-targeted, never deleted** (rename-not-delete): `broadcast-invariant.test.js` — the **four** payload-shape pins (`:211`, `:238`, `:259`, `:277`) renamed and re-asserted to `payload: { jarId }`, **and** (design-review finding) all **nine** bookmark tests in the file plus their harness (`makeBookmarksIpcHarness`, `:185-199`) updated: the harness gains a `jars` stub with at least one registered id and every `invoke()` payload gains that `jarId`, else every test fails `unknown-jar`; `app-db.test.js` `user_version` expectations move 2→3 with new ladder cases (0→3, 1→3, 2→3, 3 no-op, legacy-row-gone, step-failure-resume); `bookmarks-store.test.js` rewritten against the jar-first API preserving every behavioral assertion that still applies per jar. *Deviation, harmless*: the flight spec's count was 29; the rewrite lands at **37** (added explicit per-jar-isolation/cross-jar assertions the array-store version had no way to express) and the broadcast-invariant bookmark-test count grew from nine to **13** (added explicit unknown-jar rejection cases per channel) — every prior behavioral assertion that still applies is preserved, nothing was dropped.
- [x] **New unit coverage** per the flight's Verification section: per-jar isolation on every store method; `(jar_id, url)` uniqueness permitting the same URL across jars; position normalization incl. omitted-entries-preserved; the drop/repair split per row; unknown-jar write rejection; and — in one test file — `handleRemove` drops bookmarks while `handleWipe` preserves them. The wipe-vs-remove pair **extends the shared `test/unit/helpers/jar-ipc-harness.js`** (a `makeFakeBookmarksStore` alongside the existing `makeFakeHistoryStore` pattern, `:190` region) rather than building a standalone harness — it is the established pattern and the harness must learn the `bookmarksStore` slot anyway. Lands in the new `test/unit/bookmarks-jar-lifecycle.test.js` (spans both registrars via the shared facade harness, so it belongs to neither registrar's own suite alone).
- [x] **`tests/behavior/bookmarks-bar.md` checkpoint 12 amended**: retargeted from documents-row byte corruption (premise deleted by this leg) to row-level validation — app down, inject one invalid row beside valid siblings via `sqlite3`, relaunch, bad row dropped, siblings render. Checkpoint 11's restart-persistence phrasing gains the jar dimension.
- [x] `npm test`, `npm run typecheck`, `npm run lint` green; no **chrome**-renderer, preload, or `renderer-globals.d.ts` changes (those are leg 3). The only renderer-side files touched are the two jars-*page* files the data-class addition forces (`jar-panel-model` consumer copy in `jars-section-controller.js`; the shared model itself).

## Verification Steps

- `node --test test/unit/app-db.test.js test/unit/bookmarks-store.test.js test/unit/broadcast-invariant.test.js` — ladder, store, broadcast pins green at new premises.
- Migration proof: unit tests build v0/v1/v2 files (the `app-db.test.js:172-202` seeding idiom), open, assert `user_version = 3`, `bookmarks` table present, documents bookmarks row absent.
- Migration-failure proof: seeded conflicting `bookmarks` table (non-corrupt) → `open()` throws tagged, file NOT quarantined, still at its prior version; garbage-bytes file → quarantined and recreated (existing test).
- DD9 proof: the one-file wipe-vs-remove test passes; `grep -n bookmarks src/main/jar-data-lifecycle.js` → no hits.
- Full `npm test && npm run typecheck && npm run lint`.

## Implementation Guidance

1. **app-db.js first** (schema + factory + migration semantics), unit-tested before anything consumes it.
2. **bookmarks-store.js** against the factory; keep validation/business rules here, SQL there — the jars.js/settings-store layering.
3. **register-bookmarks-ipc.js** + the `main.js` injection (`jars`).
4. **Lifecycle wiring** (jar-registry-ipc, jar-data-classes, jar-data-ipc) with their injections.
5. **Test re-targets last**, once shapes are final.
6. Suggest response envelope stays `{ ok, suggestions }`; `matchBookmarks` itself is untouched (it takes a list).
7. `DATA_IMAGE_RE` export from `bookmarks-store.js`: round-2 review found it has **no** importers (`favicon-fetch.js` carries its own copy) — preserve the export anyway (cheap, and tests may reference it), but don't treat it as load-bearing.
8. **Transaction wrapper robustness** (round-2 note): wrap the `ROLLBACK` in the step-failure catch in its own try/catch (the `quarantineCorruptFile` best-effort idiom) — a `ROLLBACK` with no transaction active throws and would mask the original error.
9. **The errcode-11 pin test may be non-trivial to fixture** (round-2 note): the reviewer's attempts to provoke `SQLITE_CORRUPT` (11) by flipping data-page bytes all read back silently; only full not-a-database bytes reliably produce 26. Try corrupting bytes an open actually validates (schema cookie / header fields past offset 16, or a mangled `sqlite_master` cell). If no deterministic 11 recipe lands within reasonable effort: pin 26 with real bytes, unit-test the classification predicate for 11 directly (injected error object), and record the gap in the flight log rather than shipping a flaky fixture.

## Edge Cases

- **Jar deleted between registry check and store write**: the store's jar-scoped WHERE clauses make the write a no-op/`not-found` — never a cross-jar effect. No lock needed (all synchronous on the main process).
- **Same URL, two jars**: legal and expected — assert it in both store and IPC tests (the feature's core claim).
- **`handleRemove`'s existing fail-soft shape**: it returns `ok: true` even when `wiped: false`; the bookmarks clear must not change that contract — it adds its own fail-soft flag or silently logs, but never flips `ok`.
- **Clear on a jar with zero bookmarks**: no broadcast (n>0 gate), still `cleared` includes the class (matches history's shape).
- **`bookmark-add` payload with a valid jar but invalid url**: `invalid-url` (store), not `unknown-jar` — registry check first, then store validation; test the ordering.
- **Legacy envelope row absent** (fresh profile): v3 DELETE is a no-op — must not throw.
- **In-memory mode** (`open({ memory: true })`): ladder runs from 0 — v3 must apply there too (tests rely on it).

## Files Affected

- `src/main/app-db.js` — v3 schema, ladder step, migration-error classification, `createBookmarksStore()`, statements
- `src/main/bookmarks-store.js` — full rewrite (stateless, jarId-first)
- `src/main/register-bookmarks-ipc.js` — jar-addressed channels, registry rejection, `{ jarId }` broadcasts
- `src/main/main.js` — `jars` into `registerBookmarksIpc`; `bookmarksStore` into the `registerJarIpc` facade call (`:1727`)
- `src/main/jar-ipc.js` — facade signature/JSDoc gains `bookmarksStore`, forwarded to both registrars (`:47`, `:61`)
- `src/main/jar-registry-ipc.js` — `handleRemove` bookmark teardown (own try/catch)
- `src/shared/jar-data-classes.js` — fifth entry
- `src/main/jar-data-ipc.js` — `custom === 'bookmarks'` dispatch
- `src/shared/jar-panel-model.js` — `bookmarks -> history` mapping (L2-DD-E)
- `src/renderer/pages/jars-section-controller.js` — `CLEAR_COPY`/`CLEAR_OK_NOTE` `bookmarks` entries (round-2 finding)
- `test/unit/app-db.test.js`, `test/unit/bookmarks-store.test.js`, `test/unit/broadcast-invariant.test.js`, `test/unit/jar-panel-model.test.js` — re-targets + new coverage
- `test/unit/helpers/jar-ipc-harness.js` — `bookmarksStore` slot + `makeFakeBookmarksStore`; the wipe-vs-remove pair lands in the harness's consumer test file
- `tests/behavior/bookmarks-bar.md` — checkpoint 12 retarget, checkpoint 11 jar phrasing
- `CLAUDE.md` — only where it states the app-scoped store shape/broadcast payload (`:197-206` region); leg 3 completes the doc pass

## Citation Audit (2026-07-31)

Verified this session against the working tree: `app-db.js:75` (`CURRENT_VERSION = 2`), `:142-169` (ladder), `:235-240` (quarantine catch), `:326-388` (cookie-seen factory), `:370` (`deleteByJar`); `bookmarks-store.js:66` (module array), `:120-143` (`validateEntries`), `:166-171` (programmer-error-propagates comment), `:213-228` (`add`), `:277-298` (`reorder`); `register-bookmarks-ipc.js:26` (deps), `:55/:64/:73/:83` (empty-payload broadcasts); `main.js:1779-1783` (registration); `jar-registry-ipc.js:80-118` (`handleRemove`, wipe try at `:104-108`), `:68-79` (recyclable-id fail-closed comment); `jar-data-lifecycle.js:20-36` (`wipeJarData`); `jar-data-ipc.js:61-70` (custom-first dispatch), `:103` (n>0 gate), `:129-148` (`handleWipe`); `jar-data-classes.js:33-46` (four entries, null-storages + custom pattern); `history-store.js:449/:484/:495` (jarId-first precedent); `init-profile.js:72` (`bookmarks.load`); `broadcast-invariant.test.js:211/:238/:259/:277` (the four payload pins; nine bookmark tests total in the file, harness at `:185-199`); `app-db.test.js` `user_version === 2` assertions at `:145/:202/:251/:276` (design-review correction — four assertions, matching the flight spec's count); `bookmarks-store.test.js` — **29** tests by count this session (the flight spec says 30; treat the grep count as binding). Design-review verifications folded in: node:sqlite error surface probed live (`err.code` uniform, `err.errcode` numeric, no result-code constants exported); `main.js:1727` `registerJarIpc` facade confirmed as the sole route to both jar registrars; `jar-panel-model.js:34-46` + `jar-panel-model.test.js:43` totality pin confirmed; `jars-section-controller.js:344-356` fail-closed button routing confirmed.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed` (in this file's header) — flight-end review advances it to `completed`
- [x] Check off this leg in flight.md
- [x] Do NOT commit — flight-end review and commit happen after the last autonomous leg
