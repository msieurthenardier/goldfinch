# Flight Log: Downloads Surface

**Flight**: [Downloads Surface](flight.md)

## Summary

Flight planned 2026-06-19, marked **ready** 2026-06-20 after two architect review cycles (both *approve
with changes*, all issues applied). Adds an app-level, persisted downloads surface
(`goldfinch://downloads`, reached from the kebab menu + `Ctrl+J`) over the existing `will-download`
plumbing, plus the admin-only `downloadsList` automation tool (SC7, SC8 part).

**Executed 2026-06-20 via `/agentic-workflow`** — 6 autonomous legs, each design-reviewed (1–2 cycles)
then implemented by a Developer agent; commit deferred to flight level (deferred-commit model). All legs
`completed`. **938 unit tests pass**, typecheck + lint clean, `npm run a11y` 0 new violations.
**SC7/SC8 live-verified**: a download triggered via the MCP `navigate` tool appeared in `downloadsList`
(admin) as `completed` with a real 4096-byte on-disk `savePath`; a **jar key was refused** with the
distinct admin-only error. `downloads-surface` behavior test → `active`. Flight-level Reviewer
**[HANDOFF:confirmed]** (3 non-blocking stale-comment fixes applied). Status: **`landed`** — the optional
`hat-and-alignment` leg remains operator-driven; `/flight-debrief` transitions to `completed`.

---

## Reconnaissance Report

This flight sources its scope from the mission roadmap (Flight 5) and the Flight-4 debrief carry-forward
list, not from a findings-enumerating artifact with cited file:line items. The mission's cited download
plumbing was verified live against current code during planning:

| Item | Classification | Evidence | Note |
|------|---------------|----------|------|
| `will-download` handler exists, session-scoped, URL-keyed, toast-only | `confirmed-live` | `main.js:507` (`wireDownloadHandler`), `:456` `pendingDownloads`, `:526`/`:539` progress/done events | The gap is the model/persistence/UI/tool layer — this flight's scope. |
| Sanitize + traversal-guard + unique-path save helpers | `already-satisfied` (reuse) | `download-path.js` (`sanitizeFilename`, `isWithinDir`, `uniquePath`) | Reused by DD3/DD5; no rework. |
| `show-item-in-folder` reveal | `already-satisfied` (reuse) | `main.js:550` | Reused by DD4; add `open file` (`shell.openPath`) alongside. |
| Single-download path prompts a native save dialog | `confirmed-live` (to change) | `setSaveDialogOptions` in `wireDownloadHandler` | DD5 drops the prompt for the silent default-save (operator confirm). |
| `menuController` graduation (Flight-4 carry-forward) | `confirmed-live` | `renderer.js` IIFE, 4+ consumers; Flight-4 debrief recommendation #1 | Folded in as DD8 (`menu-controller-graduation` leg). |
| `getChromeTarget` admin-only app-level tool (template for `downloadsList`) | `already-satisfied` (template) | `mcp-tools.js:493` `CHROME_TOOLS`, `scope.js` façade admin-only gate | `downloadsList` mirrors this gating (DD6); not a `wcId`-first op. |

No stale/`already-satisfied` work items required retirement from scope.

---

## Decisions Log

- **2026-06-19** — Operator: downloads are **app-level, not jar-level**, and persistence **mimics modern
  browsers** (persisted history, app-level). This **supersedes** the mission Open Question's "session/
  lightweight, defer to jars-lifecycle mission" lean. Rationale: files aren't separable on disk once
  downloaded, so the list carries no per-jar privacy stance. (→ DD3)
- **2026-06-19** — Operator: surface = `goldfinch://downloads` internal page; entry via the **kebab menu +
  `Ctrl+J`**, **no toolbar button** (pins are tab-level, downloads is app-level). (→ DD1, DD2)
- **2026-06-19** — Operator: **full browser-parity** controls. (→ DD4)
- **2026-06-19** — Operator: `downloadsList` automation tool is **admin-key only**. (→ DD6)
- **2026-06-19** — Operator: include the optional **HAT + alignment** leg. (→ legs)
- **2026-06-19** — Operator: **fold `menuController` graduation** into this flight. (→ DD8)
- **2026-06-19** — Planning (flagged for operator confirmation): **Chrome-like silent save to the OS
  Downloads folder, no per-download dialog** (DD5) — follows "mimic modern browsers" and is a feasibility
  prerequisite for the SC8 behavior-test act path (a native dialog is not automation-drivable).
- **2026-06-20** — Operator: **DD5 confirmed** (silent save, keep it).
- **2026-06-20** — Operator: **retention** = JSON store now with a **"Clear now"** button + **500-item
  cap** (prune oldest); **SQLite is the planned future substrate** for storage in general (downloads +
  browsing history) — JSON built behind a narrow repo interface for a localized swap. (→ DD3, DD9; BACKLOG
  seed added)
- **2026-06-20** — Operator: **media-panel downloads are included** in the downloads list (free — same
  `will-download` funnel). (→ DD4)
- **2026-06-20** — Design discussion → **persistence model**: single store, **persist terminal records
  only**, in-progress memory-only (no second file, no restart reconciliation); never-complete handling =
  terminal states persisted/retryable, stalled = user-cancel (no v1 watchdog), crash-mid-download is the
  one accepted history gap. (→ DD3)
- **2026-06-20** — Operator: **remove = history-only** ("Remove from list" + footer note; no "Delete
  file" action this flight). (→ DD4)
- **2026-06-20** — Operator: **seed the SQLite storage-migration mission in `BACKLOG.md`** — done
  (`BACKLOG.md` "Persistent storage substrate: JSON stores → SQLite").

---

## Design Review

- **2026-06-19** — Architect review (1 cycle): **approve with changes**. Two [high] issues, several
  [medium]/[low], all applied to the spec:
  - **[high]** The internal-IPC/preload seam is **single-origin (`settings`) at three points**
    (`internal-preload.js:20`, `internal-ipc.js:18` `INTERNAL_ORIGIN`, `url-safety.js:109`
    `isInternalPageUrl`) — "reuses the hardened seam" hid the real widenings. → DD1 + `downloads-page` leg
    now name all three (CLAUDE.md:80 already prescribes the `isInternalPageUrl` one).
  - **[high]** `downloadsList` admin-only refusal is **not free** — an app-level op left out of
    `WCID_FIRST_OPS` throws the opaque "engine.getDownloadsList is not a function"; needs an explicit jar
    refusal block in `scope.js` (mirror `getChromeTarget:165`) + a dedicated jar-refused unit test (the
    three-place guard only covers wcId-first ops). → DD6 + `downloads-mcp-tool` leg updated.
  - **[medium]** Live-progress push is feasible via `broadcastToChromeAndInternal` (`main.js:798`,
    by session marker not origin) — retire the "request/response only" worry. → DD1/DD3 route events there.
  - **[medium]** Toast-consumer citations corrected (`renderer.js:2580`/`2595`, not 1755/1779) + the
    URL→id bulk-correlation through `pendingDownloads` called out. → DD3.
  - **[medium]** `downloads-model` leg overloaded → split into `downloads-model-store` (main) + action
    handlers folded into `downloads-page` (where exercised).
  - **[medium]** DD5 silent-save also removes native rename/redirect + overwrite handling → `uniquePath`
    dedup is now load-bearing (behavior-test dedup variant kept).
  - **[low]** Cache-freshness/restart contract: `progressing → interrupted` reconciliation in NORMALIZERS,
    throttled progress persistence, source-of-truth declared. → DD3.
  - **[low]** DD2 capture-path wording: the page-focused `before-input-event` is `!__goldfinchInternal`,
    so internal-page `Ctrl+J` relies on the renderer fallback. → DD2.
  - Confirmed sound (no change): the behavior-test act path (`navigate` to a `Content-Disposition:
    attachment` fixture fires `will-download`, completes dialog-free under DD5; internal page truly
    unreadable by automation, so `downloadsList` + filesystem `stat` is the right observable); the
    tool-count ref sites; the DD8 `menuController` extraction plan.
  - Open question resolutions adopted: per-download id = **persisted monotonic counter** (hash collides on
    same-url re-downloads DD5 allows); retry = fresh `downloadURL` re-issue.

- **2026-06-20** — Architect review **cycle 2** (on the storage/retention revisions): **approve with
  changes**. Storage model judged fundamentally sound (terminal-only persistence eliminates
  reconciliation; display merge coherent; repo interface is the right seam; media-panel funneling verified;
  remove-from-list never touches disk verified). Issues applied:
  - **[high]** The monotonic `id` had no persistence home in the repo interface — `max(persisted id)+1` is
    unsafe because the high-id record can be pruned/removed. → DD3 + interface add **`getNextId()`** + a
    persisted **`nextId`** never lowered by prune/remove; folded into the repo interface to keep DD9's
    one-module-swap honest.
  - **[medium]** A stale `progressing → interrupted` reconciliation line in the Technical Approach
    contradicted the revised DD3. → removed.
  - **[medium]** "Crash-only" loss framing was too generous — a normal quit also loses in-progress
    (`before-quit` is sync, the store write is I/O; quit handlers only stop the MCP server). → reframed as
    **any-teardown**, with a best-effort `interrupted` flush noted, contract = "in-progress is not durable."
  - **[low]** "Mirror `settings-store.js`'s DEFAULTS/VALIDATORS/NORMALIZERS" is a poor mechanical fit for
    an array-of-records store. → reworded to reuse its **durability discipline** (electron-free + injected
    path, atomic write, corrupt→empty-list, codec seam), NOT its fixed-key object schema; per-record
    validator + 500-cap clamp on load is the array analogue.
  - **[low]** scope.js path drift → `src/main/automation/scope.js`; `getChromeTarget` refusal at `:168`.
  - Confirmed (no change): `node:sqlite` is available in Electron 42 / Node ≥ 22.12 (zero-dep SQLite path
    open today — BACKLOG seed sharpened); 500-cap "oldest" = by `id`; action handlers tolerate a missing
    id; behavior test still sound (step 6 asserts a *completed* record survives restart).

## Execution Notes

_(append-only during execution)_

### Leg Progress

#### 2026-06-20 — Leg 1 `downloads-model-store` implemented → `landed`

**Changes made:**
- **`src/main/downloads-store.js`** (new) — electron-free JSON repo over `downloads.json` under
  `userData`. On-disk shape `{ version:1, nextId, records }`. Repo interface exactly
  `load`/`list`/`append`/`remove`/`clear`/`getNextId`. Persisted monotonic `nextId` (authority is the
  persisted field; `max(maxRecordId+1, persistedNextId, 1)` only repairs a pre-field file) — **never
  lowered** by prune or remove. `append` clamps to the newest 500 by id (drop-oldest); `load` applies the
  same clamp plus a per-record validator (drops entries lacking a positive-int `id`, string `filename`, or
  a terminal `state ∈ {completed,cancelled,interrupted}`; coerces/clamps the rest). Corrupt/unreadable/bad
  top-level shape → empty list + `nextId=1`, never throws. Atomic temp+rename write; injectable
  `{serialize,deserialize}` codec (defaults JSON). Mirrors `settings-store.js` durability discipline, not
  its fixed-key schema.
- **`src/main/downloads-manager.js`** (new) — electron-free `createManager(store)` factory.
  `Map<id,record>` of in-progress; `register` (ids via `store.getNextId()`), `update` (memory-only, no-op
  on unknown id), `finalize` (append terminal record + drop from memory; no-op if unknown; falls back to
  the in-progress `savePath` when none given), `listAll` (merge store + memory deduped by id, **memory
  wins**), `remove` (memory + `store.remove`), `clear` (`store.clear`, memory stays), `flushInterrupted`
  (best-effort append of each in-progress record as `interrupted`, tolerates a store throw).
- **`src/main/main.js`** — `wireDownloadHandler` refactored: removed the `setSaveDialogOptions` branch
  (DD5 silent default-save to `app.getPath('downloads')` via `uniquePath`); kept the `meta.saveDir` bulk
  branch. `setSavePath` before `manager.register`. Hoisted `received`/`total` getters once in the `updated`
  handler feeding both `manager.update` and the broadcast. Progress/done now broadcast via
  `broadcastToChromeAndInternal` (not `mainWindow.webContents.send`), id-keyed and carrying both `id` and
  `url` plus `filename`/`state`/`received`/`total`(/`savePath`). Added a **module-scoped** `downloadsManager`
  (assigned at the `initProfileAndStores` call site, after stores load — the sync `session-created` hook
  also calls `wireDownloadHandler`) and a `Map<id, DownloadItem>` `liveDownloadItems` registry as the leg-2
  action seam (no action IPC wired this leg). `before-quit` now calls `downloadsManager?.flushInterrupted()`
  before `mcpServer?.stop()`. Fixed the stale `pendingDownloads` JSDoc (`{ suggestedName, saveDir }`).
- **`src/main/init-profile.js`** — loads the downloads store via
  `downloads.load(app.getPath('userData'))` after `settings.load`; JSDoc `stores` typedef updated for the
  4th store.
- **`src/renderer/renderer.js`** — **no logic change** (per spec). Confirmed the toast consumers
  (`onDownloadProgress`/`onDownloadDone`) still correlate by `d.url`, and the new id-bearing payload still
  carries `url`; the URL-keyed bulk tracker is untouched.
- **`test/unit/init-profile-order.test.js`** — updated for the 4th store (`downloads.load`): asserts it
  runs after `setPath` and receives the dev-redirected path; the unpackaged getPath-isolation assertion
  switched from `lastIndexOf('getPath')` to the first post-`setPath` getPath (there are now two consumer
  reads, settings + downloads).
- **`test/unit/downloads-store.test.js`** (new, 16 tests) and **`test/unit/downloads-manager.test.js`**
  (new, 10 tests) — cover getNextId monotonicity across prune+remove, nextId reload survival + pre-field
  repair, 500-cap prune on append and on load, per-record validator drop, corrupt→empty, bare-array shape
  rejection, codec seam, list-copy; and manager register/update/finalize/listAll-merge-dedup/remove/clear/
  flushInterrupted incl. the throw-tolerance path.
- **`BACKLOG.md`** — verified the "Persistent storage substrate: JSON stores → SQLite" seed is present
  (BACKLOG.md:137). Not duplicated.

**WSLg `app.getPath('downloads')` writability spike (flight prerequisite, flight.md:296):** **WRITABLE.**
A standalone Electron `whenReady` probe (`npx electron … --no-sandbox`; Electron launches directly under
WSLg, no xvfb needed) reported `app.getPath('downloads')` resolving to the home dir (this dev env has no
XDG `downloads` dir configured, so Electron falls back to `$HOME`) and an `fs.accessSync(…, W_OK)` plus a
real write-then-unlink probe both succeeded. The silent default-save path is functional in this dev env —
leg 6's documented WSLg store-seeding fallback is **not** needed here, though the live-trigger assertion
still defers to macOS per the flight Adaptation Criteria. (Note: the fallback dir being `$HOME` rather than
a `Downloads/` subfolder is an environment artifact, not a code issue; on a normal desktop it resolves to
`~/Downloads`.)

**Deviations from the leg spec:** None material. Two minor test-authoring notes: (1) the leg's `listAll`
memory-wins test required the fake store to start id issuance at 2 so `register()` wouldn't collide with a
seeded id-1 terminal record (a test-fixture detail, not a manager behavior change); (2) the order test's
getPath isolation was switched from `lastIndexOf` to first-post-`setPath` `indexOf` because adding a 4th
store that also reads getPath made `lastIndexOf` point at the downloads read rather than settings — both
reads are asserted after `setPath`, so the invariant is stronger, not weaker.

**Test outcome:** `node --test test/unit/*.test.js` → **905 pass / 0 fail** (12 suites). New store +
manager suites pass (26 tests); no regression in `settings-store.test.js` / `download-path.test.js` /
`init-profile-order.test.js`. `npm run typecheck` and `npm run lint` both clean. `setSaveDialogOptions`
grep returns empty; `broadcastToChromeAndInternal('download-{progress,done}')` both present.

#### 2026-06-20 — Leg 2 `downloads-page` implemented → `landed`

**Files created:**
- **`src/renderer/pages/downloads.html`** (new) — the `goldfinch://downloads` internal page. Same-origin
  `<link rel="stylesheet" href="downloads.css">` + `<script src="downloads.js" defer>` only (no inline —
  CSP `default-src 'self'`). A header (`<h1>` + "Clear now" button), a semantic `<ul aria-live="polite">`
  download list, an empty-state line, and the footer note that removing/clearing affects history only and
  files are not deleted from disk.
- **`src/renderer/pages/downloads.css`** (new) — dark/gold chrome modeled on settings.css (same brand
  tokens), visible accent focus rings on every control, a live progress-bar style, per-state status
  coloring (completed = green, failed = red), and a flex row/controls layout.
- **`src/renderer/pages/downloads.js`** (new) — bridge-guarded IIFE. Loads via `downloadsList()` and
  renders newest-first by id; subscribes via `onDownloadsChanged` (over `download-progress` +
  `download-done`) and **patches the affected row by id** (status text + progress-bar width) without a
  full reload, re-fetching on an **unknown id OR a terminal/done transition** to backfill savePath/metadata
  (the broadcast carries no savePath). Full per-item control set gated by `record.state`: Open/Show only
  for `completed` (gated on state, not savePath — in-progress carries a partial path); Pause/Cancel for
  `progressing`, Resume/Cancel for `paused`; Retry for `cancelled`/`interrupted`; Remove for terminal only.
  Each control calls `downloadsAction(id, action)`; an `open` error string surfaces as an inline row notice
  (no throw). List-level "Clear now" → `downloadsClear()`. Keyboard-operable `<button>`s with `aria-label`s;
  `pagehide` cleanup of the listener handles.

**Files modified (the three single-origin seam widenings + page registration + IPC):**
- **`src/shared/url-safety.js`** — `isInternalPageUrl` now tests membership in an `INTERNAL_HOSTS` set
  (`{settings, downloads}`) instead of `host === 'settings'`; root-path clause and dual export tail
  preserved.
- **`src/main/internal-ipc.js`** — `INTERNAL_ORIGIN` (single string) → `INTERNAL_ORIGINS` allowlist Set
  (`{goldfinch://settings, goldfinch://downloads}`); `isTrustedInternalSender = INTERNAL_ORIGINS.has(origin)
  && isInternalSession === true`. Exported the Set. Added a comment that the trust boundary is "internal vs
  web," not "settings vs downloads" — any internal page may call any channel. Kept the Node-vs-Blink origin
  gotcha note.
- **`src/preload/internal-preload.js`** — origin gate widened to `INTERNAL_ORIGINS.has(location.origin)`;
  **appended** `downloadsList`/`downloadsAction`/`downloadsClear` + `onDownloadsChanged`/`offDownloadsChanged`
  (a tuple of handles over both broadcast channels) to the existing `goldfinchInternal` bridge. Inert on
  settings, main-side origin-checked regardless.
- **`src/main/main.js`** — `INTERNAL_PAGES` gained a `downloads` host (`/`, `/downloads.css`, `/downloads.js`).
  Three new `registerInternalHandler` channels next to settings/shields: `internal-downloads-list` →
  `downloadsManager.listAll()`; `internal-downloads-action` → a single `{id, action}` dispatch with a
  main-side action allowlist `['pause','resume','cancel','remove','retry','open','show']`; `internal-downloads-clear`
  → `downloadsManager.clear()`. savePath for open/show is resolved **main-side by id** from the manager
  (never a renderer-supplied path) → `shell.openPath` / `shell.showItemInFolder`. pause/resume/cancel act on
  `liveDownloadItems.get(id)`; remove → `downloadsManager.remove(id)`; retry →
  `mainWindow.webContents.downloadURL(url)` (mainWindow uses defaultSession, download-wired at whenReady —
  fresh id/new record, old failed record stays). All branches no-op on a missing/invalid id.
- **`src/renderer/renderer-globals.d.ts`** — added the five downloads bridge methods to the
  `GoldfinchInternalBridge` typedef (typecheck dependency, see Deviations).
- **`CLAUDE.md`** — preload bridge description, the "adding an internal page" note, the internal-bridge
  security model (`registerInternalHandler` two-condition check, Node-vs-Blink gotcha, `location.origin`
  defense-in-depth), and the trust-domains channel list all updated to state TWO trusted internal origins
  (settings, downloads) and that the predicates are allowlist-based.
- **`test/unit/url-safety.test.js`** — added downloads host true (+ trailing slash + sub-path false) and an
  unknown internal host (`goldfinch://history`) false; settings still true.
- **`test/unit/internal-ipc.test.js`** — added downloads origin + internal session → true; web origin +
  internal session → false; allowlisted (downloads) origin + non-internal session → false.

**Test outcome:** `node --test test/unit/*.test.js` → **912 pass / 0 fail** (12 suites; +7 over leg 1's
905 — 4 new url-safety + 3 new internal-ipc cases). `npm run typecheck` clean; `npm run lint` clean.
**`npm run a11y` → "No NEW violations — every violation node is in the ACCEPTED baseline. ✅"** (25 accepted
baseline nodes in the chrome 7-state sweep, 0 new). Per the Accessibility AC, the internal downloads page
itself is HAT-verified, not auditable by `a11y-audit.mjs` (internal-session-excluded like settings); the
a11y gate covers the chrome sweep only.

**Deviations from the leg spec:**
- **`renderer-globals.d.ts` added to Files Affected** (not in the leg's list). The `GoldfinchInternalBridge`
  TS interface (the `// @ts-check` typedef for `window.goldfinchInternal`) must declare the new bridge
  methods or `npm run typecheck` fails on `downloads.js`'s bridge calls — a mechanical typecheck dependency
  of the preload widening, in line with how prior legs extended the same typedef. No behavior change.
- The a11y run bound the MCP surface to **port 49709** (49707 free-fallback in this dev env), so the audit
  was pointed via `GOLDFINCH_MCP_PORT=49709`; result unchanged.
- No other deviations. The Open/Show state-gate, terminal-only Remove (cancel-first), retry-via-defaultSession,
  main-side savePath resolution, and single allowlisted dispatch channel all match the cycle-2 spec.

#### 2026-06-20 — Leg 3 `downloads-entry` implemented → `landed`

**Files changed:**
- **`src/shared/keydown-action.js`** — added `if (key === 'j' || key === 'J') return 'downloads';` to the
  NOT-lightbox-gated chain (right after `m`→toggle-panel), so it inherits the `mod = ctrl||meta` gate (bare
  `j` → null) and is app-level like `new-tab`. Extended the `@returns` JSDoc union with `'downloads'`
  (required: the file is `@ts-check`) and updated the header comment's chain description to note `j` and
  that Ctrl+J is not lightbox-gated.
- **`src/renderer/index.html`** — added `<button id="kebab-downloads" class="cm-item" role="menuitem"
  tabindex="-1">Downloads</button>` after `#kebab-settings` (order: Settings, **Downloads**, Print…, Exit).
  Picked up automatically by `kebabItems()` (dynamic `[role="menuitem"]` query) for roving-tabindex/arrow
  nav — no menuController registration change.
- **`src/renderer/renderer.js`** — added an `openDownloads()` helper
  (`createTab('goldfinch://downloads', null, { trusted: true })`) shared by all three entry paths (DRY); a
  `#kebab-downloads` click handler beside the other kebab handlers (`closeKebabMenu()` then
  `openDownloads()`); a `case 'downloads'` in the keydown dispatch switch that `e.preventDefault()`s and
  no-ops when `activeTab()` is internal (`isInternalTab`) else opens (DD2 anti-stacking guard); and a
  `window.goldfinch.onOpenDownloads(() => openDownloads())` consumer beside `onOpenFind` (no internal guard —
  this only fires for web-page focus).
- **`src/main/main.js`** — in the guest `before-input-event` handler, after the Ctrl+F→`open-find` branch,
  added a Ctrl+J branch `if ((input.key === 'j' || input.key === 'J') && !input.isAutoRepeat) {
  event.preventDefault(); if (mainWindow) mainWindow.webContents.send('open-downloads'); return; }`. Sits
  inside the `input.control || input.meta` gate and the outer `!__goldfinchInternal` skip. The
  `isAutoRepeat` guard is REQUIRED (this path has no `isInternalTab` guard, so a held Ctrl+J would stack
  tabs — mirrors the F12/Ctrl+Shift+I branches).
- **`src/preload/chrome-preload.js`** — added `onOpenDownloads: (cb) => ipcRenderer.on('open-downloads',
  () => cb()),` beside `onOpenFind`.
- **`src/renderer/renderer-globals.d.ts`** — added `onOpenDownloads(cb: () => void): void;` to the
  `window.goldfinch` bridge typedef, AND extended the renderer-side `keydownToAction` return-union typedef
  with `'downloads'` (see Deviations — required for typecheck).
- **`test/unit/keydown-action.test.js`** — added Ctrl+J→`'downloads'`, Ctrl+j→`'downloads'`,
  meta+J→`'downloads'`, bare `j`→`null`, and lightbox-open Ctrl+J→`'downloads'` (NOT gated).

**Test outcome:** `node --test test/unit/*.test.js` → **917 pass / 0 fail** (+5 over leg 2's 912 — the new
keydown-action cases). `npm run typecheck` clean; `npm run lint` clean.

**`npm run a11y` — NOT RUN in this leg's environment.** The a11y gate requires a live Electron GUI bound
to an automation key (`a11y-audit.mjs` errors out without `GOLDFINCH_MCP_ADMIN_KEY` / a running automation
surface), and the headless agent environment has no display — the documented
`GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation` launch hangs with no
GUI. The only chrome-sweep change is one additive `#kebab-downloads` `<button>` that mirrors the existing
`#kebab-settings`/`#kebab-print`/`#kebab-exit` menuitems exactly (same `class`/`role`/`tabindex`/text
button) — those are in the accepted baseline, so it introduces no new violation pattern. **Flag for
flight-level review/leg 6: re-run `npm run a11y` against the live app to confirm 0 new violations.**

**Deviations from the leg spec:**
- **`renderer-globals.d.ts` keydownToAction return-union extended** (the leg listed only the
  `onOpenDownloads` typedef addition there). The renderer typechecks `keydownToAction` against a *separate*
  global declaration in `renderer-globals.d.ts` (distinct from the JSDoc union in `keydown-action.js`), so
  the dispatch `case 'downloads'` failed `npm run typecheck` (TS2678) until that union also gained
  `'downloads'`. Mechanical typecheck dependency, same rationale as the JSDoc union and as how prior legs
  extended this file. No behavior change.
- **`npm run a11y` not exercised** — environment limitation (no GUI), see above. Deferred to flight-level /
  leg 6 live verification.
- No other deviations. All six Implementation Guidance steps followed; the `isAutoRepeat` guard, the
  `isInternalTab` no-stack guard, the no-toolbar/pins constraint, and the single `openDownloads()` converge
  point all honored.

#### 2026-06-20 — Leg 4 `downloads-mcp-tool` implemented → `landed`

Exposed the app-level downloads list to the automation surface as the read-only, admin-only `downloadsList`
MCP tool. All five Implementation Guidance steps followed; every AC honored.

**Files changed:**
- `src/main/automation/engine.js` — folded a `getDownloads` accessor into the opts bag
  (`createEngine(getMainWindow, { allowInternal = false, getDownloads = null } = {})`) and added the
  `getDownloadsList` op beside `getChromeTarget` (no `wcId`; throws a clean
  `automation: downloads-unavailable` when the accessor is absent — no null-deref).
- `src/main/main.js` — threaded `getDownloads: () => downloadsManager.listAll()` at BOTH `createEngine`
  sites: the `getEngine` factory (`:150`, spread over `engineOpts` to preserve `allowInternal`) and the
  dev seam (`:1371`). The closure is lazy; `downloadsManager` is module-scoped and assigned at store-load
  (leg 1) before the MCP server / dev seam register.
- `src/main/automation/scope.js` — added the `facade.getDownloadsList` admin-only refusal block in the jar
  façade (mirrors `getChromeTarget`/`captureWindow`: `requireJar()` first, then throws
  `automation: admin-only — downloadsList …`). NOT added to `WCID_FIRST_OPS` (it is app-level, not
  wcId-first). Admin path returns the engine unchanged → passthrough.
- `src/main/automation/mcp-tools.js` — added the `downloadsList` ToolDef to `CHROME_TOOLS` (no-input
  schema, `call: (engine) => engine.getDownloadsList()`, default `okResult` JSON serialization). Updated
  the tool-count comment.
- `test/unit/automation-mcp-tools.test.js` — count 26 → 27, added `'downloadsList'` to the expected name
  set, updated the title + category breakdown; 3 new tests (listed/no-leak, admin-returns-records,
  jar-refused isError).
- `test/unit/automation-mcp-server.test.js` — `EXPECTED_TOOL_COUNT` 26 → 27, title string "returns 27
  tools", added `'downloadsList'` to the `nullOps` audit-detail array.
- `test/unit/automation-scope.test.js` — 3 new dedicated tests outside the `WCID_FIRST_OPS` iteration: jar
  refused (`/admin-only — downloadsList/`, engine never reached), admin pass-through, unknown-jar
  no-such-jar-first.

**Tool-count bump:** 26 → 27 (CHROME_TOOLS now has 2 admin-only tools: `getChromeTarget` + `downloadsList`).

**Results:** `node --test test/unit/*.test.js` → **923 tests pass, 0 fail** (up from 905+ baseline; +9
new tests this leg minus shared-helper reuse). `npm run typecheck` clean. `npm run lint` clean. a11y
N/A (no UI in this leg), skipped per leg.

**Deviations:** None. All edits confined to the leg's Files Affected list. CLAUDE.md prose + 
`docs/mcp-automation.md` count bumps intentionally NOT touched (owned by leg 6).

#### 2026-06-20 — Leg 5 `menu-controller-graduation` implemented → `landed`

Behavior-preserving extraction refactor: graduated the in-`renderer.js` `menuController` IIFE + `focusItem`
+ the global `pointerdown`/`blur` outside-dismiss listeners into a standalone `src/renderer/menu-controller.js`
module (dual CJS/global export). All six Implementation Guidance steps followed; every AC honored; all Edge
Cases handled. **The moved code is character-identical** — verified by `diff` against `HEAD:renderer.js`
(both the IIFE+listeners block `:128`-`:239` and `focusItem` `:339`-`:344` diff clean). No logic change.

**Files changed:**
- `src/renderer/menu-controller.js` — **new**. The `menuController` IIFE, the `pointerdown`/`blur` listeners,
  and `focusItem` (kept a hoisted `function` declaration), MOVED verbatim. `// @ts-check` + `'use strict'`
  retained. Dual-export tail (`module.exports = { menuController, focusItem }` for tests; `globalThis.*` for
  the renderer), mirroring `keydown-action.js`/`url-safety.js`. The `MenuEntry` `@typedef` was **not** carried
  in — it is referenced ambiently from the d.ts (the `AutomationActivity` precedent).
- `src/renderer/renderer.js` — the IIFE, both global listeners, `focusItem`, and the `MenuEntry` `@typedef`
  **removed** (net −115 lines). Every consumer untouched (container/kebab/site-info/page-context `register`,
  the toggles, the three `focusItem` calls in the `onOpen`s) — they now resolve to the script-loaded globals.
- `src/renderer/index.html` — added `<script src="menu-controller.js"></script>` between `keydown-action.js`
  and `renderer.js` (loads **before** `renderer.js`, so the globals exist when it registers entries at eval).
- `src/renderer/renderer-globals.d.ts` — declared the `MenuEntry` interface (HERE ONLY), the `menuController`
  global (`register`/`open`/`close`/`closeAll`/`current` shape), and `focusItem(items, i)`. Mirrors how
  `keydownToAction`/`AutomationActivity` are declared. `renderer.js` typechecks via `checkJs:true` (no
  `// @ts-check` directive added).
- `docs/renderer-menu.md` — **new**. Documents the APG roving-tabindex contract, the `MenuEntry` fields
  (which are optional), the three accumulated constraints (`trigger === menu` opener-skip; `!entry.items`
  roving no-op; `focusReturn?` vs default `trigger.focus()`), mutual-exclusion + `pointerdown`/`blur`
  outside-dismiss, and the "raw `onClose` vs public `closeX` wrapper — never collapse them (recursion)" rule.
- `CLAUDE.md` — one-line pointer in the renderer architecture bullet to `docs/renderer-menu.md`.
- `test/unit/menu-controller.test.js` — **new**. 15 tests via fake entries (no jsdom, no new dependency):
  mutual exclusion + `current`, `closeAll`, `startIndex` passthrough, trigger-keydown opener
  (Enter/Space/ArrowDown→0, ArrowUp→-1) + the `trigger === menu` opener-skip, the menu-keydown contract
  (Escape/Tab → close + `focusReturn`-or-`trigger.focus`; the `!items` no-op), the with-items roving path
  (ArrowDown/ArrowUp-wrap/Home/End) through the real `focusItem` asserted via item focus spies + tabIndex,
  and `focusItem` wrap math directly.

**Results:** `node --test test/unit/*.test.js` → **938 tests pass, 0 fail** (923 baseline + 15 new). The
new `menu-controller.test.js` runs in isolation: **15 pass, 0 fail**. `npm run typecheck` clean (no
`MenuEntry` duplicate-identifier — the type is in the d.ts only). `npm run lint` clean. `npm run a11y`
(`--tags=wcag2a,wcag2aa,wcag21a,wcag21aa`) ran against the live app over the loopback MCP automation
surface: **"No NEW violations — every violation node is in the ACCEPTED baseline"** — the menus
(kebab/container/site-info/page-context) are exercised in the chrome sweep and stay clean after the move.

**Deviations:**
- `eslint.config.mjs` edited (NOT in the leg's Files Affected list). Required, not optional: the renderer
  ESLint block declares each injected global as `readonly` (`keydownToAction`, `isSafeTabUrl`, …), so
  `menuController`/`focusItem` had to be added there or every consumer call site would `no-undef`. Same
  precedent as when `keydown-action.js` was extracted. Additionally, `menu-controller.js` itself (which
  *defines* those symbols + uses the CJS `module` global) was given its own ESLint block (script +
  browser + node globals) and excluded from the generic renderer block via `ignores`, so the `readonly`
  global injection doesn't trip `no-redeclare` on its own definitions. No behavior change; lint-only config.
- No other deviations. All consumer behavior is preserved (verified by the character-identical diff + the
  green a11y chrome sweep + the unit-test state-machine/keyboard coverage).

#### 2026-06-20 — Leg 6 `verify-integration` implemented → `landed`

The final autonomous leg: download fixture created, user-facing docs + doc tool-count owned (the build
legs' deferred edits), the `downloads-surface` behavior-test spec finalized + run, and the **SC7/SC8
real-environment observables verified live**. All Implementation Guidance steps 1–6 followed; every AC
honored; edge cases handled (port fallback, octet-stream-primary).

**Fixture:** `tests/behavior/fixtures/downloads/download-fixture.bin` — **new**, a deterministic 4096-byte
binary. Served by `python3 -m http.server` rooted at `tests/behavior/fixtures/`, it is delivered as
`application/octet-stream` (verified via `curl -D -`), which Chromium **downloads** rather than renders.
The Content-Disposition fallback was **not** needed.

**SC7/SC8 live verification — VERDICT: PASS.** Mechanism: **scripted live integration smoke** (leg-permitted
alternative to the multi-agent Witnessed run) over the MCP automation surface (attach + env-key model). App
launched `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation`; **MCP server
bound port 49709** (free-fallback off 49707 — captured live from the listening socket, not hardcoded).
Results:
- Tool discovery: **27 tools**, `downloadsList` present.
- Baseline `downloadsList` (admin): empty array, `N = 0`.
- `openTab` + `navigate` to the fixture → the download fired and **completed silently** (no dialog, DD5).
  (`navigate` itself returned `ERR_FAILED (-2)` — expected: the navigation became a `will-download`, so the
  body is consumed as a download, not rendered.)
- `downloadsList` (admin) new record: `filename: download-fixture.bin`, `state: completed`,
  non-empty `savePath` (`~/download-fixture.bin` on this WSLg box — `$HOME` fallback, the leg-1 finding),
  `received === total === 4096`.
- `stat` the `savePath` → file exists, **4096 bytes**, `isFile: true` — corroborated against the filesystem.
- `downloadsList` with the **jar key** → **refused** with the distinct
  `automation: admin-only — downloadsList (app-level downloads view) is restricted to the admin identity`
  (not a generic 401 / "not a function" — the "jewel of the gate" edge case satisfied).

Evidence at the ephemeral `/tmp/behavior-tests/goldfinch/downloads-surface/2026-06-20-10-02-09/` (NOT
committed — holds the real absolute savePath; anonymized to `~/…` in committed artifacts). Committed run log:
`tests/behavior/downloads-surface/runs/2026-06-20-10-02-09.md`. Both background processes (app + http server)
torn down.

**Behavior-test spec disposition:** a **live** run exercised the real SC7/SC8 observables incl. the DD5
silent save → spec status set to **`active`** (the WSLg seeded-store fallback was NOT used; live trigger
fired and completed). Spec finalized: tool count 27; fixture preconditions reconciled to the
`.bin`/octet-stream **primary** + Content-Disposition **fallback**.

**Docs owned:**
- `README.md` — added `| `Ctrl+J` | Open downloads |` row to the Keyboard shortcuts table.
- `docs/mcp-automation.md` — **26 → 27** (overview breakdown + "All 27 tools below"); admin section retitled
  "Admin chrome / app-level (2)"; **`downloadsList` documented** (admin-only, app-level, no `wcId`, no input,
  returns the `{ id, url, filename, savePath, state, received, total, … }` records); admin-identity paragraph
  updated to list `downloadsList` + its `automation: admin-only` jar-key refusal.
- `CLAUDE.md` — **kebab prose** updated from "(Settings + Exit; …" to **Settings, Downloads, Print…, Exit**;
  Downloads item documented as opening `goldfinch://downloads` via the trusted `createTab` path, reachable
  via `Ctrl+J`. (The internal-page allowlist / `INTERNAL_ORIGINS` / downloads-bridge / menu-controller notes
  were already present from legs 2/3/5 — verified coherent, not duplicated.)

**Whole suite green:** `node --test test/unit/*.test.js` → **938 pass / 0 fail**; `npm run typecheck` clean;
`npm run lint` clean; `npm run a11y` (chrome sweep, run against the live app on port 49709) →
**"No NEW violations — every violation node is in the ACCEPTED baseline"** (25 accepted baseline nodes;
the kebab — now incl. the Downloads item — is exercised in the sweep). This also discharges the leg-3 a11y
re-run that the leg-3 agent could not perform.

**Deviations:**
- `CLAUDE.md` Automation-engine bullet (`:194`, NOT in the leg's narrow "kebab prose" Files-Affected entry)
  bumped **26 → 27** with `downloadsList` added to the tool enumeration. Required for coherence: leaving a
  stale "26 tools" enumeration that omits `downloadsList` in the same file would contradict the doc count
  bump and the as-built surface. Within the leg's docs-ownership intent (the build legs deferred the doc
  tool-count here); logged as an out-of-Files-Affected edit per the leg constraint.
- Stale source comment noted, NOT touched: `src/renderer/renderer.js:199` still reads "(Settings, Print…,
  Exit)" omitting Downloads. This is feature **source** (legs 2/3/5 own it), out of this leg's docs+spec+fixture
  scope — flagged for the Flight Director / a follow-up, not silently edited.
- No feature-source changes. No bugs found in legs 1–5 — the live verification passed end-to-end.

### Flight Director Notes

- **2026-06-20** — `/agentic-workflow` started. Phase 1 context loaded: mission `active`, flight
  `ready` → transitioned to **`in-flight`**. Branch `flight/05-downloads-surface` cut from `main`;
  prior `/flight` planning artifacts (flight spec/log, `downloads-surface` behavior-test draft,
  `BACKLOG.md` SQLite seed, mission roadmap annotation) committed as the flight baseline. No legs
  designed yet — starting the leg cycle at leg 1 `downloads-model-store`. Crew per
  `.flightops/agent-crews/leg-execution.md` (Developer = Sonnet, Reviewer = Sonnet). Per the skill:
  per-leg **design** review, but code review + commit **deferred** until after the last autonomous
  leg.
- **2026-06-20** — Leg 1 `downloads-model-store` designed via `/leg`; Developer design review (1 cycle)
  returned **approve with changes** (1 medium, 3 low, suggestions, 4 questions). Applied: hoisted
  `received`/`total` bindings in the progress broadcast (medium — guidance wouldn't run as written);
  manager must be **module-scoped** (assigned at store-load, not a `whenReady` local) because the sync
  `session-created` hook also calls `wireDownloadHandler` (low); `init-profile-order.test.js` must be
  updated for the 4th store + added to Files Affected/verification (low); stale `pendingDownloads`
  JSDoc fix folded in (low); grep-pattern escaping, store-test cache-bust pattern, manager in-memory
  fake-store testing, before-quit flush order (flush→stop) (suggestions). Resolved the 2 gating
  questions **without operator escalation**: DD5 silent-save is already operator-confirmed (Decisions
  Log 2026-06-20), and the WSLg `getPath('downloads')` writability spike is folded into leg-1
  done-criteria (this leg owns that flight prerequisite). Only minor/clarifying edits applied →
  **skipped the 2nd design-review cycle** (skill permits). Leg 1 → `ready`. `[HANDOFF:review-needed]`.
- **2026-06-20** — Leg 1 implemented by Developer agent and set `landed` (commit deferred to flight
  level). Result: `downloads-store.js` + `downloads-manager.js` created, `wireDownloadHandler` refactored
  (silent default-save, id-keyed broadcasts, module-scoped manager, `liveDownloadItems` registry seam),
  `init-profile.js` + order test updated, toast consumers confirmed behavior-preserved (no rewrite). **905
  unit tests pass**, typecheck + lint clean. **WSLg spike: `app.getPath('downloads')` is writable** (env
  has no XDG downloads dir → Electron falls back to `$HOME`; environment artifact, not a code issue), so
  leg 6's store-seeding fallback is not needed; live-trigger still defers to macOS. No material deviations.
- **2026-06-20** — Leg 2 `downloads-page` designed; **2 design-review cycles** (the complex leg).
  Cycle 1 *approve with changes* (3 medium, 2 low): corrected leg-1-induced main.js line drift
  (`:550`→`:593`, `:798`→`:841`); Open/Show gated on `state==='completed'` not savePath (in-progress
  records carry a real partial savePath); Remove made **terminal-only** (cancel-first) to avoid the
  finalize-noop history-loss; **a11y restated as HAT-verified** (the internal session is unauditable by
  `a11y-audit.mjs`, `npm run a11y` covers the chrome sweep only); retry source pinned; live-payload
  re-fetch note added; single allowlisted action-dispatch channel. Cycle 2 *approve* (no high/medium) —
  confirmed all resolutions and **definitively answered the retry session-wiring** (mainWindow uses
  `defaultSession`, wired at `main.js:1248`, so `mainWindow.webContents.downloadURL` works with no
  fallback). Leg 2 → `ready`. `[HANDOFF:review-needed]`.
