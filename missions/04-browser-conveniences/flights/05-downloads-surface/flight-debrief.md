# Flight Debrief: Downloads Surface

**Date**: 2026-06-20
**Flight**: [Downloads Surface](flight.md)
**Status**: landed
**Duration**: 2026-06-19 (planned) – 2026-06-20 (landed + HAT)
**Legs Completed**: 7 of 7 (6 autonomous + 1 optional HAT, all `completed`)

## Outcome Assessment

### Objectives Achieved

The flight delivered a complete, app-level, persisted downloads surface over the existing
`will-download` plumbing, plus agent parity and a folded-in maintenance refactor:

- **`goldfinch://downloads`** internal page — list of in-progress + completed downloads with live
  per-item progress and full browser-parity controls (open, show-in-folder, pause/resume, cancel,
  remove-from-list, clear all, retry), reached via the kebab menu and `Ctrl+J`.
- **App-level persistence** — `downloads-store.js` (terminal-only JSON, 500-item cap, persisted
  monotonic `nextId`, durability discipline borrowed from `settings-store.js`) behind a narrow repo
  interface; `downloads-manager.js` holds the canonical in-memory list aggregating every jar/session.
- **`downloadsList` MCP tool** — read-only, admin-only (jar keys refused with a distinct error),
  `wcId`-less; tool count 26 → 27. (SC8 part.)
- **Silent default-save** to the OS Downloads folder (DD5) — no per-download native dialog.
- **`menuController` graduation** (DD8, Flight-4 carry-forward) — extracted verbatim to
  `src/renderer/menu-controller.js`, documented in `docs/renderer-menu.md`, all consumers regressed.

**938 unit tests pass** (0 fail / 0 skip), typecheck + lint clean, `npm run a11y` 0 new violations
against the live app. SC7/SC8 live-verified: a download triggered via the MCP `navigate` tool
appeared in `downloadsList` as `completed` with a real 4096-byte on-disk `savePath`; a jar key was
refused with the distinct admin-only error. PR #66 open.

### Mission Criteria Advanced

- **SC7** — Downloads surface (model/list behavior-test-backed; page UI + controls HAT-verified). ✅
- **SC8 (part)** — Agent parity: `downloadsList` invocable through the automation surface as a gated,
  discoverable tool, inheriting M03 gating. ✅

## What Went Well

- **The architect [high] catches paid off directly.** Both cycle-1 [high] issues — the three
  single-origin internal-seam widenings (DD1) and the `downloadsList` admin-only refusal that an
  unmodified `WCID_FIRST_OPS` omission would have turned into an opaque "not a function" (DD6) — were
  exactly the load-bearing edits. Naming them in the spec + leg prerequisites meant the implementer hit
  no surprise, and both catches converted into clean, symmetric, tested as-built code.
- **The cycle-2 [high] `nextId`-persistence fix is embodied correctly.** `getNextId()`
  increments-and-persists; prune/remove/clear never lower it; the `max(persistedNextId, maxRecordId+1, 1)`
  load term is a repair-only path. This defends the exact id-reuse-after-prune collision the review
  predicted, and a dedicated monotonicity-across-prune+remove test guards it.
- **The repo-interface seam is real, not aspirational.** `downloads-manager.js` never touches
  `fs`/`path`/disk shape; `main.js`/`engine.js` only call manager methods. DD9's "SQLite swap is a
  one-module change" promise actually holds.
- **`menuController` extraction was a clean, verbatim, fully-regressed move** (character-identical diff,
  +15 unit tests, green chrome a11y sweep) that retired the Flight-4 #1 carry-forward with no behavior
  change.
- **Security-by-construction in the action surface** — the renderer sends only an `id`; main resolves
  the trusted `savePath` by id before `shell.openPath`/`showItemInFolder`, closing an arbitrary-file-open
  vector. One allowlisted dispatch channel, every branch no-ops on a missing/invalid id.
- **The optional HAT leg earned its keep** — it found three real defects no automated test caught (see
  Deviations) and fixed them inline before merge.

## What Could Be Improved

### Process
- **The HAT leg was optional, and the three real defects were HAT-only-observable.** The flight got
  lucky that the operator ran the optional leg. Internal-page DOM is permanently unauditable by the
  automation surface (now the third such data point after Flight-3 DevTools and Flight-4
  spellcheck/context-menu), so internal-page UI is a HAT/a11y-only verification class. **Decision
  (operator, this debrief): for future internal-page surfaces the HAT leg is NON-OPTIONAL.**
- **A recurring leg-authoring gap: type/lint "glue" files omitted from Files Affected.** Legs 2, 3, and
  5 each independently rediscovered and self-corrected the same class of omission — `renderer-globals.d.ts`
  (bridge typedefs + the renderer-side keydown/action return-union, a *separate* declaration from the
  JSDoc union) and `eslint.config.mjs` (injected-global registration as `readonly`). It never blocked,
  but it's avoidable noise.

### Technical
- **`wireDownloadHandler` is the most under-tested high-value function in the flight** — it owns the
  silent-save path, id assignment, the filename-from-`savePath` fix, and the `paused`-from-`isPaused()`
  broadcast, and it has zero direct unit coverage. Two of the three HAT defects lived here. Extracting
  its record/broadcast-payload construction into a pure, electron-free helper (like `downloads-manager`/
  `download-path` already are) would let unit tests pin all three HAT-fix behaviors cheaply.
- **DD5's silent-save under-stated its blast radius.** Cycle-1 flagged that dropping the native dialog
  made `uniquePath`'s ` (n)` dedup load-bearing for the on-disk *path*; it did not anticipate that the
  *display name* also had to be re-sourced from the deduped path (the wrong-filename HAT defect). Future
  "drop the native dialog" decisions should enumerate *every* affordance the dialog provided (location,
  rename, overwrite handling), not just location.
- **`getDownloads` accessor is manually threaded at two `createEngine` sites** (`main.js:150`, dev seam);
  a third site could silently omit it and get `downloads-unavailable`. Low risk (clean throw, no
  null-deref) but un-guarded duplication.
- **`goldfinch_new.png` (345 KB) committed but not yet wired up.** Confirmed by the operator as the new
  app icon; it is referenced nowhere in `src/` today. Tracked as an action item (wire-up), not debt to
  remove.

### Documentation
- **The `DownloadItem` `paused`/`getState()` Electron fact is load-bearing in ~6 places and undocumented.**
  Electron keeps a paused download at `getState() === 'progressing'`, exposing paused only via the
  `isPaused()` boolean. The next maintainer will re-trip this; it deserves a one-liner near
  `wireDownloadHandler` or a short download-architecture note.
- **The main-side-path-resolution security rule** ("the renderer sends an id, never a path") deserves a
  sentence in CLAUDE.md alongside the internal-IPC trust model, since it's the pattern any future
  record-acting internal channel should follow.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| Pause/resume model revised at HAT — `paused` made first-class in the broadcast | Electron keeps a paused `DownloadItem` at `getState()==='progressing'`; paused is only the `isPaused()` boolean. Unavoidable real-environment discovery, not a design miss. | No (one-off Electron quirk) — but **do** spike `DownloadItem` state representation in future download flights |
| Double-download on file-URL navigation removed | `navigate()`'s `.catch` re-navigated via `src` on the download-conversion `ERR_FAILED` reject — vestigial recovery code firing a 2nd `will-download`. Found at HAT only. | No (bug fix) — guard via behavior-test count assertion |
| Displayed filename re-sourced from `basename(getSavePath())` | Record used `item.getFilename()` (original suggested name) not the `uniquePath`-deduped on-disk name. Downstream of DD5's silent-save. Found at HAT only. | No (bug fix) — guard via behavior-test |
| `renderer-globals.d.ts` / `eslint.config.mjs` edited beyond Files Affected (legs 2, 3, 5) | Mechanical typecheck/lint dependencies of preload-bridge / action-union / module-extraction changes. | **Yes** — add to the `/leg` Files-Affected checklist for renderer work |
| Tool-count doc bump touched `CLAUDE.md:194` beyond the leg's "kebab prose" scope (leg 6) | Coherence: a stale "26 tools" enumeration in the same file would contradict the as-built surface. | No (correct judgment call, logged) |
| `goldfinch_new.png` committed after the flight-level commit excluded it | Operator-directed (this session); it's the new app icon, wire-up pending. | No — action item |

## Key Learnings

- **Internal pages are a permanent HAT-only verification class.** The automation surface cannot read the
  internal session's DOM (even for admin), so every internal-page UI flow is HAT/a11y-only. Three flights
  now confirm this. The model/list/tool layers *are* automatable (and were); the page UI is not.
- **The explicit façade-refusal idiom for admin-only app-level ops is proven** — three instances now
  (`captureWindow`, `getChromeTarget`, `downloadsList`), each with a distinct admin-only error and a
  dedicated jar-refused test. The "leave it out of `WCID_FIRST_OPS` → opaque 'not a function'" trap is a
  recurring footgun worth standardizing against.
- **Terminal-only persistence was the right simplifying call.** Electron can't resume a `DownloadItem`
  across a restart, so persisting in-progress records would only manufacture dead `interrupted` rows.
  Terminal-only eliminated restart reconciliation entirely. The accepted "in-progress not durable across
  any teardown" gap is sound for v1 and is the right thing for the SQLite mission to close.
- **Test-count growth was healthy and fully attributable**: 803 (F1) → 834 (F2) → 879 (F3) → 879 (F4) →
  **938 (F5, +59)**, all from real new coverage (store 16, manager 10, menu-controller 15, url-safety +4,
  internal-ipc +3, keydown +5, automation-scope +3, plus tool-count refs). Wall-clock held flat at ~0.9 s
  (electron-free pure-logic suite). No timing or flake concern.

## Recommendations

1. **Make the HAT leg non-optional for future internal-page surfaces** (operator-confirmed this debrief).
   The next obvious one is the seeded browsing-history surface — plan its HAT leg as load-bearing from
   day one, not optional.
2. **Harden the `downloads-surface` behavior test to regression-guard the HAT defects.** Promote the
   already-drafted same-filename dedup variant to a required step, and add a "single download → exactly
   one new record" count assertion. This converts double-download and wrong-filename into automated
   guards through the existing, proven apparatus — the cheapest high-value action from this flight.
3. **Extract `wireDownloadHandler`'s record/broadcast-payload construction into a pure helper** so the
   filename-from-savePath and paused-from-isPaused logic gets unit coverage — the single biggest
   test-coverage win available.
4. **Add a standing `/leg` Files-Affected checklist item for renderer work**: `renderer-globals.d.ts`
   (bridge typedefs + action unions) and `eslint.config.mjs` (injected-global registration) are
   near-certain dependencies of any preload/global/module change.
5. **Spike `DownloadItem` state semantics before the next download-touching flight** — record the
   *representation* of state (filename source, how paused is expressed, what fires `'updated'`), not just
   that events fire. Two of three HAT defects were "Electron API behaves unexpectedly," the same class
   the Flight-4 debrief named HAT-authoritative.

## Action Items
- [ ] Wire up `goldfinch_new.png` as the app icon (operator-confirmed intent) — investigate icon
  reference sites (`electron-builder` config, window/dock icon) and replace `goldfinch_color`/`goldfinch_mono`
  where appropriate; or decide it's an asset-only addition. Currently committed but unreferenced.
- [ ] Harden `tests/behavior/downloads-surface.md`: promote the dedup variant to a required step + add the
  "exactly one new record" single-download assertion (regression guard for double-download + wrong-filename).
- [ ] Document the `DownloadItem` `paused`/`getState()==='progressing'` fact near `wireDownloadHandler`
  (or a short download-architecture note).
- [ ] Add the renderer-glue (`renderer-globals.d.ts` + `eslint.config.mjs`) checklist item to `/leg`.
- [ ] Near-term: extract `wireDownloadHandler` payload construction into a pure, unit-tested helper.
- [ ] Backlog line: prefer `~/Downloads` when it exists but XDG is unset (the `$HOME`-fallback HAT note).
- [ ] Methodology: record "HAT non-optional for internal-page surfaces" where the project keeps its
  flight-planning conventions.
