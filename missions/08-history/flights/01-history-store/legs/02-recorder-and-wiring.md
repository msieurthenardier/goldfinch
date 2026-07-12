# Leg: recorder-and-wiring

**Status**: completed
**Flight**: [Per-Jar History Store](../flight.md)

## Objective

Create `src/main/history-recorder.js` (the DD4/DD5 recording gate) and wire
the live pipeline: partition threaded into `wireTabViewEvents`, recorder
called from the existing navigation/title forwards, store opened at boot and
closed on `will-quit`, hourly retention pruning, and the `retentionDays`
field on the jar record.

## Context

- Leg 1 landed `src/main/history-store.js` with the exact API this leg
  consumes: `open(dir)`, `close()`, `recordVisit({jarId,url,title,visitedAt})
  → id`, `setTitle(visitId, title)`, `pruneExpired(retentionByJarId, now) →
  Record<jarId, count>`. 1315 tests green, ~1s.
- Flight DD4 (visit semantics), DD5 (positive registered-jar allowlist),
  DD6 (retention field + prune cadence), DD7 (`history-changed { jarId }`
  invalidation broadcasts), DD8 (Electron-free recorder shape).
- Architect pins: store opens as a **sibling call after
  `initProfileAndStores(...)` returns** — do NOT widen that function's
  unit-pinned 4-store signature (`test/unit/init-profile-order.test.js`);
  `will-quit` (not `before-quit`) closes the store, deliberately;
  title-backfill map crash-leak is accepted bounded behavior;
  `renderer-globals.d.ts` `jarsList()` return type gains `retentionDays`.

## Inputs

- Leg 1 landed (history-store on branch, uncommitted).
- `src/main/main.js:1256 — "function wireTabViewEvents(view, wcId)"`;
  call site `main.js:2085 — "wireTabViewEvents(view, wcId)"`; partition in
  scope at `main.js:2077 — "tabViews.set(wcId, { view, partition: trusted ?
  INTERNAL_PARTITION : partition, … })"`.
- `src/main/jars.js:validateContainers` (field-by-field rebuild, never
  spreads) and `jars.js:add` (record construction:
  `{ id, name, color, partition }`).
- `src/main/main.js:1689 — "function broadcastToChromeAndInternal"`;
  `main.js:2463 — "registerJarIpc({"` (wiring neighborhood);
  `main.js:2706 — "app.on('before-quit', …)"` (existing teardown — the new
  `will-quit` hook is separate and later).
- `ipcMain.on('tab-close')` at `main.js:2093` with `tabViews.delete(wcId)`
  at `main.js:2102` — the teardown point for `forgetTab`.

## Outputs

- `src/main/history-recorder.js` (new) + `test/unit/history-recorder.test.js`
  (new).
- `src/main/jars.js` — `retentionDays` on the jar record (add + validator +
  default) + `test/unit/jars.test.js` additions.
- `src/main/main.js` — partition threading, recorder calls, store
  open/close, prune scheduler.
- `src/renderer/renderer-globals.d.ts` — `retentionDays: number` on the
  `jarsList()` return element type (the chrome-bridge declare at the line
  containing `Promise<Array<{ id: string; name: string; color: string;
  partition: string }>>`).

## Recorder Contract (implement exactly)

`createHistoryRecorder({ store, listJars, broadcast, now = () => Date.now(),
suppressionMs = 30_000 })` → `{ handleNavigation, handleTitleUpdated,
forgetTab }`. CJS, `// @ts-check`, no `require('electron')`. Factory shape
(like `createMenuOverlayManager`), NOT a module singleton — tests build many.

- `handleNavigation({ wcId, partition, url })`:
  1. **Positive allowlist (DD5)**: `const jar = listJars().find(j =>
     j.partition === partition)`; no match → return `null` (burner
     `burner:<n>`, internal `goldfinch-internal`, undefined — all fall out
     here). Comment in code: O(#jars) linear scan per navigation, jar counts
     are small, deliberate.
  2. **Scheme allowlist (DD4)**: parse with `new URL(url)` in try/catch;
     protocol must be `http:` or `https:`; otherwise return `null`.
  3. **Duplicate suppression (DD4)**: per-jar in-memory map
     `lastByJar: Map<jarId, { url, ts }>` — if same `url` and
     `now() - ts < suppressionMs`, return `null` (do NOT update the map
     entry's ts — a reload loop shouldn't extend suppression forever;
     document this choice in a comment).
  4. Record: `store.recordVisit({ jarId, url, title: null, visitedAt:
     now() })`; update `lastByJar`; set `lastVisitByWc.set(wcId,
     { visitId, jarId })` (the PAIR — `handleTitleUpdated`'s broadcast needs
     the jarId and cannot recover it from `lastByJar`); `broadcast(
     'history-changed', { jarId })`; **return the visit id** (a number —
     the return type does not change with the map's stored shape).
- `handleTitleUpdated(wcId, title)`: look up `lastVisitByWc`; miss → no-op.
  Non-empty string title → `store.setTitle(visitId, title)` and
  `broadcast('history-changed', { jarId })` (both read from the stored
  `{ visitId, jarId }` pair). Empty/non-string title → no-op.
- `forgetTab(wcId)`: delete the `lastVisitByWc` entry. (Crash-leak accepted
  per flight DD4 cache contract — wcIds never reused.)
- Recorder never throws out of its handlers: wrap store calls in try/catch,
  `console.error('[history]', err)` and continue (a store hiccup must never
  break navigation).

## jars.js `retentionDays` (DD6)

**FOUR assembly sites must gain the field — missing any one silently drops
it** (design-review live probe: an `undefined` retention reaches
`pruneExpired` as a `NaN` cutoff, which binds without throwing and matches
ZERO rows — pruning silently never happens for that jar):

1. `add()`: include `retentionDays: DEFAULT_RETENTION_DAYS` (module const,
   30) in the constructed record.
2. `validateContainers()`: in the field-by-field `kept.push({...})`, add
   `retentionDays: cleanRetention(entry.retentionDays)` where
   `cleanRetention(v)` returns `v` when it's an integer in 1–3650, else 30.
   Existing v2 files (no field) upgrade in place — no version bump.
3. `FRESH_SEED` (jars.js:48-51) — fresh installs bypass
   `validateContainers()` entirely (`load()` branch (c) maps the literal
   directly).
4. `LEGACY_DEFAULTS` (jars.js:56-61) — same bypass for legacy-profile
   first loads.

- Add a short comment at the seed literals noting all four sites must agree
  (a future single-assembly refactor routing branch (c) through
  `validateContainers()` would collapse this — note it, don't do it here).
- `rename()` does NOT accept retention (mutation path is Flight 3's
  `setRetention`; not built here).
- **Five existing `test/unit/jars.test.js` assertions pin the exact 4-field
  record shape and MUST be updated with the new field** *(design review,
  enumerated)*: lines 250-251 and 1066 (`Object.keys(...).sort()` ===
  `['color','id','name','partition']`), 832-834 and 853-855 (full-object
  `deepEqual`s), 955-965 (`remove()` returned-object `deepEqual`). The
  `BURNER` identity assertion (~line 434) is NOT touched — Burner is not a
  store entry and gets no retention field.
- New tests: upgrade-path test with a fixture shaped exactly like the real
  dev-profile file (v2 envelope, three containers, no `retentionDays`) —
  each kept record gains `retentionDays: 30`; **seed-path tests** — a fresh
  install (no file) and a legacy bare-array file both produce jars carrying
  `retentionDays: 30`; validator coercion table (0, -1, 3651, 1.5, `'15'`
  — a NON-default numeric string, so string-coercion bugs can't hide —
  null → 30; 1, 30, 3650 → kept); `add()` default pinned; persisted
  round-trip keeps a custom value (edit the file fixture directly; do not
  add a public setter this leg).

## main.js wiring (keep it thin — every branch is recorder-owned)

1. **Threading**: change the signature to
   `wireTabViewEvents(view, wcId, partition)` and pass the same `partition`
   value used at `tabViews.set` (`trusted ? INTERNAL_PARTITION : partition`
   is for the registry — pass the RAW web-branch partition for web tabs;
   simplest correct form: pass `trusted ? INTERNAL_PARTITION : partition`,
   identical to the registry value — the recorder's allowlist rejects the
   internal partition anyway; one value, no divergence).
2. Inside the existing `did-navigate` and `did-navigate-in-page` guards, add
   `historyRecorder?.handleNavigation({ wcId, partition, url: wc.getURL() })`
   alongside the existing `sendToChrome` (never replacing it). Inside the
   existing `page-title-updated` guard: `historyRecorder?.handleTitleUpdated(
   wcId, title)`.
3. In `ipcMain.on('tab-close')`, next to `tabViews.delete(wcId)`:
   `historyRecorder?.forgetTab(wcId)`.
4. **Boot** — add `const historyStore = require('./history-store')` and
   `const { createHistoryRecorder } = require('./history-recorder')` at
   main.js's require block. Then (in `whenReady`, immediately after
   `initProfileAndStores(...)` returns — sibling call, Architect-pinned):
   `historyStore.open(app.getPath('userData'))`, then
   `historyRecorder = createHistoryRecorder({ store: historyStore,
   listJars: () => jars.list(), broadcast: broadcastToChromeAndInternal })`
   (module-scope `let historyRecorder = null` so `wireTabViewEvents` sees
   it).
5. **Prune**: after boot wiring, run
   `pruneAllJars()` once and `setInterval(pruneAllJars, 60*60*1000).unref()`.
   `pruneAllJars()` builds `retentionByJarId` from `jars.list()`
   (`Object.fromEntries(jars.list().map(j => [j.id, j.retentionDays]))`),
   calls `historyStore.pruneExpired(map, Date.now())`, and broadcasts
   `history-changed { jarId }` per key of the returned nonzero-count record.
   Wrap in try/catch (log, never crash the interval).
6. **Close**: `app.on('will-quit', () => { try { historyStore.close(); }
   catch {} })` — new hook, deliberately after `before-quit` teardown
   (flight DD2 rationale).

## Acceptance Criteria

- [x] `src/main/history-recorder.js` exists (factory, CJS, `@ts-check`,
      Electron-free); `test/unit/history-recorder.test.js` pins the decision
      table with a fake store/broadcast: registered-jar+http(s) records &
      broadcasts; burner (`burner:1`), internal (`goldfinch-internal`),
      unknown partition, `goldfinch://` URL, `about:blank`, and invalid URL
      all return null with zero store calls; suppression window (same URL
      within 30s suppressed, after 30s records, different URL records,
      suppression does not self-extend); title backfill (hit updates store +
      broadcasts with the right jarId; miss/empty/non-string no-op;
      forgetTab clears); store-throw swallowed (handler returns null,
      navigation unaffected).
- [x] `jars.js` records carry `retentionDays` (default 30, validator 1–3650
      integer) from ALL FOUR assembly sites (`add`, `validateContainers`,
      `FRESH_SEED`, `LEGACY_DEFAULTS`); upgrade-path + seed-path + coercion
      tests added to `test/unit/jars.test.js`; the five enumerated
      shape-pinning assertions updated; real-shape v2 fixture test included.
- [x] `main.js` wiring per the six points above; `wireTabViewEvents` has the
      partition param at both definition and call site; recorder calls sit
      inside the existing guards; no other main.js behavior changes.
- [x] `renderer-globals.d.ts` `jarsList()` element type includes
      `retentionDays: number`.
- [x] `npm test` (incl. existing 1315 + new), `npm run typecheck`,
      `npm run lint` all green; suite ~1s.
- [x] Grep-AC: `grep -n "Date.now()" src/main/history-recorder.js` → only
      the injected default parameter (`now = () => Date.now()`), nowhere in
      decision logic.

## Verification Steps

- `npm test` / `npm run typecheck` / `npm run lint`.
- `node -e "require('./src/main/history-recorder')"` — no side effects.
- Manual boot is NOT this leg's gate (leg 4 verify-integration owns the live
  checks); this leg's ACs are unit + static only.

## Edge Cases

- `did-navigate` fires for the INITIAL load of every tab (including
  restored/new-tab loads) — correct to record; no special-casing.
- `wc.getURL()` at `did-navigate-in-page` returns the post-pushState URL —
  use the same `wc.getURL()` read as the existing `sendToChrome` line.
- Two tabs in the same jar visiting the same URL within 30s: second is
  suppressed (per-jar map, not per-tab) — deliberate (DD4: suppression is
  jar-scoped spam-bounding).
- A jar deleted mid-session: `listJars()` no longer resolves its partition —
  recording stops instantly for its open tabs (correct; rows GC'd by prune's
  orphan sweep until Flight 3 wires delete-purge).
- Forward-pointer for Flight 3 (not this leg): `src/shared/jar-page-model.js`
  `buildJarPageModel` field-allowlists `{ id, name, color, isDefault,
  isBurner }` — it will silently omit `retentionDays` until Flight 3 adds it
  for the retention edit control. *(design review)*
- Recorder created only after `whenReady`; navigations can't precede it
  (tabs are created via IPC after the chrome loads), but the `?.` guard
  makes the ordering assumption harmless.

## Files Affected

- `src/main/history-recorder.js` — new
- `test/unit/history-recorder.test.js` — new
- `src/main/jars.js` — retentionDays field
- `test/unit/jars.test.js` — new cases
- `src/main/main.js` — threading + boot/close/prune wiring
- `src/renderer/renderer-globals.d.ts` — jar record type

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Tests passing (`npm test`, `npm run typecheck`, `npm run lint`)
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed`
- [x] Do NOT commit (flight-level review + commit after the last leg)

## Citation Audit

Verified at leg design time against the working tree: `main.js:1256`
(`function wireTabViewEvents(view, wcId)`), `main.js:2085` (call site),
`main.js:2077` (`tabViews.set(… partition …)`), `main.js:2093/2102`
(`tab-close` / `tabViews.delete`), `main.js:1689`
(`broadcastToChromeAndInternal`), `main.js:2463` (`registerJarIpc({`),
`main.js:2706` (`app.on('before-quit'`), `jars.js:83`
(`validateContainers`), `jars.js:245` (`add`), `renderer-globals.d.ts:237`
(`jarsList(): Promise<Array<{ id: string; name: string; color: string;
partition: string }>>`), `init-profile.js:26` (4-store signature). All
verified OK 2026-07-12.
