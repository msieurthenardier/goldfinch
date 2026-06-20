# Flight: Downloads Surface

**Status**: completed
**Mission**: [Standard Browser Conveniences](../../mission.md)

## Contributing to Criteria
- [x] **SC7** — Downloads surface: review in-progress and completed downloads in a dedicated surface,
  see per-item state/progress, and open the downloaded file or its folder (*behavior-test-backed for
  the model/list; the page UI + controls are HAT-verified*).
- [x] **SC8** (part) — Agent parity: the downloads **list** is invocable through the automation surface
  as a gated, discoverable tool (`downloadsList`), inheriting M03's gating (*behavior-test-backed*).

---

## Pre-Flight

### Objective

Add a **downloads surface** — the convenience Electron leaves unwired despite Chromium fully driving
downloads (`session.will-download` / `DownloadItem`). The operator opens **`goldfinch://downloads`**
(a new internal page, reached from the **kebab overflow menu** and the conventional **`Ctrl+J`**) and
reviews an **app-level, persisted** list of in-progress and completed downloads — per-item
state/progress, with full modern-browser controls (open file, show in folder, pause/resume, cancel,
remove from list, clear all, retry). Expose the **read-only `downloadsList`** automation tool
(admin-only) for agent parity (SC8 part). The list is **app-level (cross-jar) and persisted across
restart** — modern-browser behaviour, and coherent because downloaded files are not jar-separated on
disk, so the list carries no jar-private state to protect.

The current download plumbing already works end-to-end (`session.will-download` handler broadcasting
`download-progress`/`download-done`, `show-item-in-folder`, sanitized/unique save paths) but is
**session-only, in-memory, URL-keyed, and surfaced only as ephemeral toasts** — there is no model, no
stable per-download id, no persistence, no list UI, and no pause/cancel. This flight adds the **model
and persistence layer** beneath, the **page** above, and the **tool** beside; it is a renderer +
main-process build, not a thin view.

This flight also folds in one carry-forward maintenance item the Flight-4 debrief explicitly nominated
for "flight-5 or end-of-mission maintenance": **`menuController` graduation** (DD8) — the flight adds a
5th menu consumer surface area (the kebab gains an item) and the controller is now load-bearing across
its consumers with undocumented constraints, so the extraction is timely here.

### Open Questions
- [x] **Surface shape** → **`goldfinch://downloads` internal page** (mirrors the `goldfinch://settings`
  pattern), not a side panel. Avoids the #27 side-panel open-animation glitch (owned by Flight 6) and
  is the `chrome://downloads` analogue. (DD1, operator)
- [x] **Entry point** → **kebab overflow-menu item + `Ctrl+J`**, **no toolbar button**. Toolbar pins
  are **tab-level** (`toolbarPins`); downloads is **app-level**, so a pinnable button would be a
  category error. (DD2, operator)
- [x] **Persistence / scope** → **app-level, persisted, schema-versioned** downloads store. **Supersedes**
  the mission's earlier "session/lightweight, defer persistence to the jars-lifecycle mission" lean —
  the operator's call: files aren't separable on disk, so there is no per-jar privacy stance to protect
  and no reason to keep the list ephemeral. (DD3, operator)
- [x] **Control scope** → **full browser parity** (open file, show in folder, pause/resume, cancel,
  remove, clear all, retry). (DD4, operator)
- [x] **Default save location** → **Chrome-like silent save to the OS Downloads folder**, no
  per-download native dialog (the existing single-download `setSaveDialogOptions` prompt is dropped for
  the default path). Follows directly from "mimic modern browsers" **and** unblocks the SC8
  behavior-test act path (a native save dialog is not drivable through the automation surface). An
  optional "ask where to save each time" setting is **out of scope** (future). (DD5, operator-directive
  — **flagged for confirmation**, architect [medium])
- [x] **`downloadsList` automation scope** → **admin (chrome) key only**, refused for jar/web keys at
  the `scope.js` façade. An app-level cross-jar view is an admin capability — a jar key must not learn
  what other jars downloaded ("new tools must not widen the surface's reach"). (DD6, operator)
- [x] **Behavior-test apparatus** → the M03 automation surface, audited both axes (DD7). The
  `goldfinch://downloads` page lives in the **internal session, which automation cannot read even for
  admin** — so the **read/assert path is the `downloadsList` tool result + the filesystem**, never the
  page DOM. The page UI is HAT/a11y, not an automation step.
- [x] **Retention + storage** → **JSON store now, behind a narrow repository interface**; keep until
  cleared with a **"Clear now"** button + a **500-item cap** (prune oldest on append); **SQLite is the
  planned future substrate** (DD9). (operator, 2026-06-20)
- [x] **Media-panel downloads in the list** → **yes** — they already funnel through the one
  `session.will-download` handler, so the `DownloadsManager` captures them with no special-casing; the
  media panel's own toasts/bulk progress coexist as the in-the-moment "bubble." (DD4, operator)
- [x] **Persistence model / "two files?"** → **no** — a single store, **persist terminal records only**;
  in-progress (`progressing`/`paused`) live in memory and stream to the page, never touch disk (DD3). A
  second in-progress file would only earn its keep for resume-after-restart, which Electron can't do
  anyway. Accepted gap: a download killed mid-flight by an app crash is lost from history (the partial
  file remains on disk). (operator)
- [x] **Internal-page IPC surface for the downloads page** → **RESOLVED at design review.** The page needs
  a **read + subscribe** channel for the list/live-progress and **action** channels (pause/resume/cancel/
  remove/clear/open/show). Live push is supported: `broadcastToChromeAndInternal` (`main.js:798`) fans out
  by **session marker** (`__goldfinchInternal === true`), not origin — the settings page already consumes
  such pushes (`internal-preload.js` `on('settings-changed', …)`). So the download events route through
  `broadcastToChromeAndInternal` (today they go only to `mainWindow.webContents.send`, `main.js:526`/`539`)
  and the page subscribes via a new `onDownloadsChanged` bridge in `internal-preload.js`. **No polling.**
  But the bridge is **origin-hardcoded to `settings`** — see the three widenings in DD1.
- [x] **Per-download id scheme** → **persisted monotonic counter** (architect recommendation). Survives
  restart cleanly and gives a stable key for action IPC + `removeItem`; `startTime`+url-hash collides on
  same-url re-downloads (which DD5's `uniquePath` explicitly allows). (DD3)
- [x] **Retry / never-complete handling** → Electron cannot resume a `DownloadItem` across a process
  restart, so **"retry" of a failed/cancelled item re-issues `downloadURL(originalUrl)`** (a fresh
  download); pause/resume acts on a *live* item only. Terminal states (`completed`/`cancelled`/
  `interrupted`) are persisted and retryable. A **stalled** download (bytes stop, socket open) stays
  in-progress in memory — the user **cancels** it; **no v1 auto-timeout watchdog** (a "stalled" badge is
  a noted future option). *(Because in-progress is never persisted (DD3), there are no dead `progressing`
  records to reconcile on load — this supersedes the design-review's `progressing → interrupted`
  reconciliation point, which assumed in-progress was persisted.)*

### Design Decisions

**DD1 — Surface = `goldfinch://downloads` internal page (settings pattern), not a side panel.** A new
internal page registered in the `INTERNAL_PAGES` allowlist (`main.js:49`) — `downloads.html` /
`downloads.css` / `downloads.js` under `src/renderer/pages/`, served over the `goldfinch://` protocol
handler, in the internal partition with the internal CSP. Reached as a **trusted tab**
(`createTab('goldfinch://downloads', null, { trusted: true })`), exactly as Settings is opened.
- **The internal seam is single-origin today — generalizing it to a second internal page is real work
  the leg MUST name** (architect [high]). Three points hardcode `goldfinch://settings` and refuse/ignore
  `goldfinch://downloads` until widened to an allowlist/set of internal hosts:
  1. `src/preload/internal-preload.js:20` — `if (location.origin === 'goldfinch://settings')` gates the
     *entire* `goldfinchInternal` bridge; the downloads page would get **no bridge at all**.
  2. `src/main/internal-ipc.js:18` — `INTERNAL_ORIGIN = 'goldfinch://settings'`; `isTrustedInternalSender`
     refuses every downloads-page IPC as a non-internal sender.
  3. `src/shared/url-safety.js:109` — `isInternalPageUrl` hardcodes `host === 'settings'`, so the
     `will-navigate` guard (`main.js:358`) `preventDefault()`s navigation to `goldfinch://downloads` and
     the trusted `createTab` path is gated by the same predicate. (CLAUDE.md:80 already prescribes
     "extend `isInternalPageUrl`'s allowlist" for new internal pages — do the analogous widening of the
     other two, and update the CLAUDE.md security note to reflect a **second trusted internal origin**.)
- Rationale: the `chrome://downloads` analogue; reuses the hardened internal-page seam (allowlist,
  origin-checked IPC, internal CSP); sidesteps the #27 side-panel open-animation glitch entirely (that
  is Flight 6's fix, not a dependency here).
- Trade-off: an internal page needs its own IPC surface (the resolved open questions above) and the
  three single-origin widenings — more wiring than a side panel, but on a trust-vetted seam.

**DD2 — Entry = kebab overflow item (`#kebab-downloads`) + `Ctrl+J`; no toolbar button.** Add a
`Downloads` `role="menuitem"` to `#kebab-menu` (`index.html:43`, beside `#kebab-settings`/`#kebab-print`/
`#kebab-exit`) whose click mirrors `#kebab-settings`: `createTab('goldfinch://downloads', null, {
trusted: true })` (`renderer.js:377`). Add `Ctrl+J` via the unit-tested keydown mapper
(`keydown-action.js`) + the main-side `before-input-event` capture (`main.js`) + the renderer
**chrome-focused** keydown fallback, guarded by `isInternalTab` and the open-lightbox check (the
zoom/find pattern). *(Note: the page-focused `before-input-event` handler is wrapped in
`!__goldfinchInternal` (`main.js:368`), so it never fires while an internal page has focus — `Ctrl+J`
from within an internal tab relies on the renderer fallback, matching existing zoom/find behavior; the
`isInternalTab` guard is about not re-opening downloads from within an internal tab, not the capture
path.)* **No `toolbarPins` change** — pins are tab-scoped; downloads is app-scoped.
- Rationale: app-level capability belongs in the app menu, not the per-tab toolbar; `Ctrl+J` is the
  universal downloads shortcut ("mimic modern browsers").
- Trade-off: no at-a-glance toolbar progress indicator; the menu/`Ctrl+J` are the discovery path.

**DD3 — App-level downloads model; in-memory live + terminal-only JSON persistence, behind a repository
interface.** A new main-process `DownloadsManager` holds the **canonical app-level list** in memory,
aggregating `will-download` across **every** jar/session (the handler is already applied to every jar,
`main.js:1174`). Each record: `{ id, url, filename, savePath, state, received, total, mime?, startTime,
endTime?, paused, error? }` with `id` a **monotonic counter**. Persistence via a new
**`downloads-store.js`** exposing a **narrow repository interface** — `list()` / `append(record)` /
`remove(id)` / `clear()` / **`getNextId()`** — so the planned SQLite swap (DD9) is a one-module change.
- **The id counter must persist THROUGH the store, not be re-derived (architect [high]).** `max(persisted
  id) + 1` is unsafe: the highest-id record can be **pruned by the 500-cap or removed by the user**, so
  `max(persisted)` underestimates the high-water mark and would re-issue a live id → collision. The store
  therefore persists a dedicated **`nextId`** alongside the records (a separate field, monotonic, never
  lowered by prune/remove) and hands it out via `getNextId()`. Keeping the counter *inside* the repo
  interface is also what preserves DD9's "one-module swap" promise (no raw-file side-channel).
- The interim backing is **JSON under `userData`, reusing `settings-store.js`'s *durability discipline*
  — NOT its fixed-key object schema** (architect [low]): electron-free module + injected `userDataPath`
  (`settings-store.js:5`), atomic temp-write-then-rename, **corrupt-file → empty list** (load never
  throws), and the pluggable `{serialize, deserialize}` codec seam (`settings-store.js:13`). The
  array-of-records analogue of settings' merge-with-repair is a **per-record validator that drops
  malformed entries and clamps to the 500-cap on load**.
- **Persist terminal records ONLY; in-progress is memory-only.** The store is written **only when an item
  reaches a terminal state** (`completed`/`cancelled`/`interrupted`) — appended, then **pruned to a
  500-item cap (oldest by `id`, i.e. insertion order)**. In-progress items (`progressing`/`paused`) live
  entirely in the manager's memory and are **streamed to the page, never written to disk**. This means
  **no progress write-amplification and NO restart reconciliation** — there are no persisted `progressing`
  records to clean up (this supersedes the cycle-1 `progressing → interrupted` normalizer point, which
  assumed in-progress was persisted). *Accepted gap — applies to ANY teardown, not just crash (architect
  [medium]):* an item still in-progress when the app stops is lost from history (the partial file remains
  on disk). A normal quit is **not** guaranteed to flush it: the existing `before-quit`/`window-all-closed`
  handlers (`main.js:1310`/`:1312`) only stop the MCP server and `before-quit` is synchronous while the
  store write is I/O. The leg may attempt a **best-effort** persist of `interrupted` on teardown, but the
  contract is "in-progress is not durable." The SQLite version (DD9) closes this properly.
- The `will-download` handler is refactored to assign the id, register the item in the manager, persist on
  terminal transition, and broadcast **id-keyed** `download-progress`/`download-done` **through
  `broadcastToChromeAndInternal` (`main.js:798`)** — today they go only to `mainWindow.webContents.send`
  (`main.js:526`/`539`), which never reaches the internal downloads page.
- **Toast-consumer migration (correct sites + bulk correlation, architect [medium]).** The URL-keyed
  consumers are `renderer.js:2580` (`onDownloadProgress`) and `:2595` (`onDownloadDone`) — *not* the
  `bulkPump`/`bulkFinish` internals. The migration is not a simple re-key: the toast map (`toastEls.get(d.url)`)
  **and** the bulk aggregation (`bulk.urls.has(d.url)` / `bulkComplete(d.url, …)`, populated by URL in
  `bulkPump`) both key on URL, and the `download-media` → `will-download` correlation round-trips by URL
  through `pendingDownloads` (`main.js:456`/`468`/`512`). Moving to id-keyed events means the id must be
  carried back to the bulk tracker. The leg preserves the bulk-download toast and the single-download
  confirmation behaviorally.
- **Cache-freshness contract.** *Source of truth*: the live `DownloadItem`/manager memory while alive; the
  JSON store after a terminal state. *Display*: the page merges the manager's in-memory items (in-progress)
  with the persisted terminal records, deduped by `id`. *Write trigger*: terminal transition only.
  *Max staleness*: the page list is live (pushed); the persisted snapshot simply lacks still-running items
  by design. *Action handlers tolerate a missing `id`* (no-op rather than throw) — covers the harmless
  edge where a terminal record is pruned between the page render and a slow user click.
- Rationale: SC7 needs a per-item model with stable identity and history; terminal-only persistence is the
  simplest correct model for a low-cardinality JSON store and sidesteps reconciliation entirely.
- Trade-off: the model/persistence layer + the toast-consumer migration; the any-teardown in-progress
  history gap. Mitigated by `settings-store`'s durability discipline, the `download-path` helpers, and the
  repo interface.

**DD9 — SQLite is the planned future storage substrate; JSON is interim behind the repo interface.**
Storage is moving to SQLite for Goldfinch **in general** (downloads **and** the future browsing history
sharing one indexed substrate). This flight ships the JSON store (DD3) **behind the `downloads-store`
repository interface** (`list`/`append`/`remove`/`clear`) precisely so the migration is a localized,
one-module swap rather than a `main.js` excavation. A **storage-migration mission is seeded in
`BACKLOG.md`** as part of this flight (docs-only).
- Rationale: decouples the *storage engine* (the genuinely shared future concern) from this flight's
  feature work, and keeps the JSON choice from prejudging the higher-cardinality browsing-history store.
- Trade-off: a thin indirection now; cheap, and it's the seam the SQLite work will land on.

**DD4 — Full browser-parity controls; remove-from-list is history-only; media-panel downloads included.**
Per-item: **open file** (`shell.openPath`), **show in folder** (existing `show-item-in-folder` →
`shell.showItemInFolder`), **pause/resume** (`DownloadItem.pause()`/`.resume()` on a live item),
**cancel** (`.cancel()`), **remove from list**, **retry** (re-issue `downloadURL` for a
failed/cancelled item, DD3), and list-level **"Clear now"** (clears terminal records; in-progress items
stay). Each action is a main-process handler reached over the downloads internal-IPC surface.
- **Remove semantics (operator) — history-only, never touches disk.** "Remove from list" / "Clear now"
  drop the **record** only; the file always stays on disk (Chrome/Safari/Edge semantics). The action is
  worded **"Remove from list"** and a one-line **footer note** states files aren't deleted — the labeling
  carries the meaning and keeps the operator's mental model honest. **No Firefox-style "Delete file"
  action** in v1 (a destructive footgun not worth it for a privacy browser's first cut).
- **Media-panel downloads are included automatically.** The media panel's single download
  (`downloadMedia → downloader.downloadURL`) and bulk "Download selected" already funnel through the one
  `session.will-download` handler, so the `DownloadsManager` captures them with **no special-casing**; the
  media panel's own toasts/bulk progress coexist as the in-the-moment "bubble" (Chrome shelf analogue).
- Rationale: SC7 + "mimic modern browsers".
- Trade-off: pause/resume/cancel are net-new `DownloadItem` wiring; retry is a fresh `downloadURL`
  re-issue, not a live resume (DD3).

**DD5 — Chrome-like silent default save to the OS Downloads folder; no per-download native dialog.**
The default download path saves to `app.getPath('downloads')` with the existing `sanitizeFilename` +
`uniquePath` ` (n)` dedup (`download-path.js`), **without** the single-download `setSaveDialogOptions`
prompt the handler uses today. (The bulk/media path already saves silently to a chosen dir.)
- Rationale: matches every modern browser's default and is the operator's "mimic modern browsers"
  directive; **also a feasibility prerequisite** — a native save dialog cannot be driven by the
  automation surface, so without this the SC8 behavior-test act path is not executable.
- Trade-off: removes the current per-download "choose where to save" prompt for single downloads
  (`setSaveDialogOptions`, `main.js:519`) — a visible UX change (**architect [medium]**, flagged for
  operator confirmation). The native dialog today also let the user **rename/redirect** the file and
  implicitly handled overwrite; silent save removes that and leans **entirely on `uniquePath`'s ` (n)`
  dedup** (`download-path.js`) — so the behavior-test dedup variant becomes load-bearing for correctness,
  not optional. An opt-in "ask where to save each time" setting is deferred (out of scope).

**DD6 — `downloadsList` is admin-only, read-only; NOT a `wcId`-first op.** A new engine op
`getDownloadsList()` returning the app-level records, exposed as the `downloadsList` MCP tool
(`inputSchema: {}`, default `okResult` JSON-text). It is **app-level**, so it takes **no `wcId`** and
**must NOT** be added to `WCID_FIRST_OPS` (`src/main/automation/scope.js:44`).
- **Admin-only refusal needs EXPLICIT façade wiring — it is not free (architect [high]).** For a jar
  identity, `scopeEngine` (`src/main/automation/scope.js:76`) builds a façade containing *only* the
  explicitly-named ops; an op that is merely *left out* of `WCID_FIRST_OPS` resolves to `undefined` on the
  jar façade, and the MCP dispatch (`mcp-tools.js:549`) then throws the **opaque `"engine.getDownloadsList
  is not a function"`** — the exact gap documented at `src/main/automation/scope.js:42`. So the `downloads-mcp-tool` leg must add an **explicit jar
  refusal block** mirroring `getChromeTarget` (`src/main/automation/scope.js:168`): `facade.getDownloadsList = () => {
  requireJar(); throw new Error('automation: admin-only — downloadsList …'); }`. The existing
  three-place-registration guard (`automation-scope.test.js:211`) only covers **wcId-first** ops, so it
  will **not** catch this miss — a **dedicated jar-refused unit test** (like the `getChromeTarget`
  admin-only test, `automation-scope.test.js:329`) is required.
- Acting controls (pause/cancel/retry) are **not** exposed to automation in this flight — SC8 asks for the
  *list* only.
- Rationale: an app-level cross-jar view is an admin capability; matching the existing admin-only
  app-level tool (`getChromeTarget`) keeps the gating model uniform and honours "must not widen the
  surface's reach".
- Trade-off: agents on a jar key can't read downloads (acceptable — it's a global/admin view).
- **Tool count 26 → 27.** Update **all** ref sites: `mcp-tools.js:503` comment,
  `automation-mcp-tools.test.js` (`:72/:76/:77` count + name set), `automation-mcp-server.test.js`
  (`EXPECTED_TOOL_COUNT`, `:26`), and the CLAUDE.md prose tool list.

**DD7 — Behavior-test apparatus = the M03 automation surface, audited both axes.**
- **Act**: open a guest tab and **`navigate`** it to a small fixture file served with
  `Content-Disposition: attachment` (a local `python3 -m http.server` over `tests/behavior/fixtures/`),
  which fires `will-download`; the silent default-save (DD5) lets it complete with no dialog.
- **Observe (read path)**: the **`downloadsList`** tool result (admin key) — assert the new record
  appears with the expected `filename`, a terminal `state: 'completed'`, and a `savePath`; corroborate
  by **stat-ing `savePath` on the filesystem** (the file exists, non-zero size). The **internal
  downloads page DOM is NOT readable via automation** (internal-session exclusion, even for admin), so
  it is **not** an observable here.
- **Key identity**: the run uses the **admin** key (the only key `downloadsList` accepts, DD6); a
  **jar key** call is asserted **refused** (admin-only) — the gating half of SC8.
- The page UI (list rendering, live progress bar, the per-item controls, keyboard operability) is
  **HAT + `npm run a11y`**, outside this apparatus (internal-page-rendered).

**DD8 — Fold in `menuController` graduation (Flight-4 carry-forward).** Extract the `menuController` IIFE
from `renderer.js` to **`src/renderer/menu-controller.js`**, loaded via `<script>` alongside
`keydown-action.js`/`url-safety.js`; document the APG roving contract, the `focusReturn?` option, the
`trigger === menu` constraint, and the global `pointerdown`/`blur` listeners (a short note in
`docs/renderer-menu.md` or CLAUDE.md); **regress all consumers** (the container picker, the kebab — now
gaining the Downloads item — the page-context menu, and the toolbar Unpin) with the net that now exists.
- Rationale: the Flight-4 debrief named it overdue and nominated flight-5; this flight touches the kebab
  (a consumer) and the controller has accumulated undocumented constraints across its consumers.
- Trade-off: a renderer refactor with no functional tie to downloads — a clearly-labelled maintenance
  leg, not feature work. Scoped to one leg; gated on a full-consumer regression pass.
- *Note (scope honesty): this is the one leg with no shared surface to the downloads work. If the flight
  is running hot, it is the cleanest leg to defer to Flight 6 / an end-of-mission maintenance pass.*

### Prerequisites
- [x] M03 automation surface runnable (`npm run dev:automation`) — landed (M03).
- [x] `navigate` / `enumerateTabs` tools available (M03) for the behavior-test act path — landed.
- [x] The env-gated **admin** key available (`GOLDFINCH_AUTOMATION_ADMIN=1` + dev mint) — `downloadsList`
  accepts admin only (DD6). A **jar key** for the refusal assertion. (M03 gating, landed.)
- [x] A fixture served with `Content-Disposition: attachment` for the behavior-test download trigger
  (new fixture under `tests/behavior/fixtures/`; `python3 -m http.server`, the a11y-audit pattern) —
  setup task owned by `verify-integration`.
- [x] Accessibility gate runnable (`npm run a11y`) — landed (first green sweep, Flight 4).
- [x] `app.getPath('downloads')` writable in the dev environment (WSLg) — verify at first leg (spike).
- [x] **Internal-seam generalization understood** — the three single-origin widenings (DD1:
  `internal-preload.js:20`, `internal-ipc.js:18` `INTERNAL_ORIGIN`, `url-safety.js:109` `isInternalPageUrl`)
  are the real load-bearing edits for a second internal page; owned by the `downloads-page` leg.
  *(Note: `downloadsList`, the `goldfinch://downloads` page, and the persisted store do NOT exist today —
  they are deliverables of this flight; the behavior test runs at `verify-integration`, after the model,
  page, and tool land.)*

### Pre-Flight Checklist
- [x] All open questions resolved (retention = JSON now + "Clear now" + 500-cap, SQLite future DD9;
  persistence = terminal-only single store, in-progress memory-only, no reconciliation; media-panel
  downloads included; per-download id = monotonic counter; internal-page IPC =
  `broadcastToChromeAndInternal` push + the three origin widenings; retry = fresh `downloadURL` re-issue;
  remove = history-only)
- [x] Design decisions documented
- [x] Prerequisites verified (M03 surface / keys / a11y gate landed; the attachment fixture is a
  `verify-integration` setup task, and the `downloads`-dir writability is the first-leg spike check)
- [x] Validation approach defined (`downloads-surface` behavior test drafted at
  `tests/behavior/downloads-surface.md`; HAT for the page UI + controls; `npm run a11y`)
- [x] Legs defined (6 + optional HAT)
- [x] Architect design review incorporated (2 cycles, both *approve with changes*, all issues applied;
  cycle 2 on the storage revisions added: persisted `nextId` in the repo interface (high), removed a stale
  reconciliation line + reframed the in-progress gap as any-teardown (medium), `settings-store` durability-
  discipline-not-schema wording (low), `automation/scope.js` path fixes (low))

---

## In-Flight

### Technical Approach

**Model + persistence (main, primary).** A new `DownloadsManager` (main process) owns the canonical
app-level list; `downloads-store.js` (reusing `settings-store.js`'s durability discipline — electron-free
+ injected path, atomic write, corrupt-file → empty list, codec seam — behind the `list`/`append`/`remove`/
`clear`/`getNextId` repo interface, DD3) persists terminal records durably under `userData`. The
`will-download` handler
(`main.js:507`) is refactored to assign a monotonic id per `DownloadItem`, register it, set the **silent
default save path** (`app.getPath('downloads')` + `sanitizeFilename` + `uniquePath`, DD5), persist per the
cache contract (DD3), and broadcast **id-keyed** `download-progress`/`download-done` **via
`broadcastToChromeAndInternal` (`main.js:798`)** so the internal page receives them. The existing toast
consumers (`renderer.js:2580`/`2595`) migrate to the id-keyed events with their behaviour preserved
(including the URL→id bulk-correlation through `pendingDownloads`, DD3).

**`goldfinch://downloads` page (internal, primary).** New `src/renderer/pages/downloads.{html,css,js}`,
registered in `INTERNAL_PAGES` (`main.js:49`) and served by the `goldfinch://` protocol handler under
the internal CSP. **Generalizing the single-origin internal seam (DD1):** widen `internal-preload.js:20`
(bridge origin gate), `internal-ipc.js:18` (`INTERNAL_ORIGIN`), and `url-safety.js:109` (`isInternalPageUrl`)
from the hardcoded `settings` to an internal-host set. The page reads the list, subscribes to live
progress (a new `onDownloadsChanged` bridge in `internal-preload.js` over `broadcastToChromeAndInternal`),
and dispatches the **per-item action handlers** (pause/resume/cancel/remove/clear/open via
`shell.openPath`/show) over the origin-checked internal-IPC pattern (`internal-ipc.js`). Keyboard-operable
and within the a11y gate (list semantics, `aria-live` progress, focusable controls).

**Entry (renderer chrome).** A `Downloads` item in `#kebab-menu` opening `goldfinch://downloads` as a
trusted tab (mirror `#kebab-settings`), plus `Ctrl+J` (keydown mapper + main-side `before-input-event`
capture + renderer **chrome-focused** fallback, `isInternalTab` + lightbox guarded; the page-focused
capture does not fire on internal pages, DD2).

**Automation (MCP parity).** `getDownloadsList()` engine op + `downloadsList` ToolDef (`inputSchema:
{}`), admin-only at the `scope.js` façade (NOT in `WCID_FIRST_OPS`), refused for jar keys with the
distinct admin-only error; unit-tested; tool count 26 → 27 across all ref sites.

**menuController graduation.** Extract the IIFE to `src/renderer/menu-controller.js`, load via
`<script>`, document the contract, regress all consumers (DD8).

### Checkpoints
- [x] `will-download` registers each item in the app-level `DownloadsManager` with a stable id, saves
  silently to the OS Downloads folder (DD5), persists across restart, and emits id-keyed progress/done;
  the existing media-panel bulk + single toasts still work.
- [x] `goldfinch://downloads` renders the persisted list with live per-item progress and the full
  control set (open/show/pause/resume/cancel/remove/clear/retry); keyboard-operable; `npm run a11y` clean.
- [x] Kebab `Downloads` item + `Ctrl+J` open the page (page- and chrome-focused); no-op on internal
  tabs; lightbox not fought.
- [x] `downloadsList` live over MCP, **admin-only** (jar key refused with the distinct error), `wcId`-less,
  unit-tested; tool count 27.
- [x] `downloads-surface` behavior test green on the automation surface (admin key): a triggered download
  appears in `downloadsList` as `completed` with a `savePath` that exists on disk; jar-key call refused.
- [x] `menuController` extracted to its own module, documented, all consumers regressed.

### Adaptation Criteria

**Divert if**:
- The silent default-save (DD5) is rejected at operator confirmation — then the behavior-test act path
  needs an alternative non-dialog trigger (e.g. a test-only seam or the existing approved-dir bulk path),
  and the single-download UX keeps its prompt. (Re-plan the act path before `verify-integration`.)
- `app.getPath('downloads')` is not writable / downloads don't fire under WSLg — fall back to a behavior
  test that seeds the persisted store directly and asserts `downloadsList` reflects it, deferring the
  live-trigger assertion to macOS (the mission already plans macOS verification).
- The internal-page IPC surface proves unable to deliver live progress to `goldfinch://downloads` cleanly
  — re-evaluate the page-vs-panel decision (DD1) before building the page.

**Acceptable variations**:
- Internal-IPC channel names, exact persisted record fields (as long as the record carries
  id/url/filename/savePath/state/progress/timestamps), and the exact 500-cap number.
- Downloads page layout/styling and control affordances, refined during HAT.
- Retry implemented as a fresh `downloadURL` re-issue (vs. attempting live resume) for terminal items.

### Legs

> **Note:** Tentative; planned and created one at a time as the flight progresses.

- [x] `downloads-model-store` *(main-side; architect-split from the old `downloads-model`)* — app-level
  in-memory `DownloadsManager` + `downloads-store.js` exposing the **narrow repo interface**
  (`list`/`append`/`remove`/`clear`/**`getNextId`**) reusing `settings-store.js`'s **durability discipline**
  (electron-free + injected path, atomic write, corrupt→empty-list, codec seam — **not** its fixed-key
  object schema), **persisted `nextId`** (never lowered by prune/remove — NOT `max(persisted)+1`),
  **terminal-only persistence + 500-item cap (prune oldest by `id`)**, in-progress memory-only (no
  reconciliation), refactor the `will-download` handler (`main.js:507`) to register/track/persist-on-terminal
  + best-effort `interrupted` flush on teardown + **silent default-save to OS Downloads** (DD5) + id-keyed
  `download-progress`/`download-done` **routed through `broadcastToChromeAndInternal`** (`main.js:798`),
  and migrate the renderer toast consumers (`renderer.js:2580`/`2595`, incl. the URL→id bulk-correlation
  through `pendingDownloads`) to id-keyed events preserving bulk + single toasts. Captures media-panel
  downloads automatically (DD4). Unit tests for the store (interface incl. `getNextId` monotonicity across
  prune/remove + per-record validator drop + 500-cap prune + corrupt→empty) + path/dedup. **Also seeds the
  `BACKLOG.md` SQLite storage-migration mission (DD9).** (DD3, DD4, DD5, DD9)
- [x] `downloads-page` — `goldfinch://downloads` internal page (`src/renderer/pages/downloads.{html,css,js}`
  + `INTERNAL_PAGES` allowlist entry, `main.js:49`), **the three single-origin internal-seam widenings**
  (`internal-preload.js:20`, `internal-ipc.js:18` `INTERNAL_ORIGIN`, `url-safety.js:109` `isInternalPageUrl`
  → internal-host set; update the CLAUDE.md security note for the 2nd trusted internal origin, DD1), list
  rendering (merging in-memory in-progress + persisted terminal records, DD3) with live progress
  (`onDownloadsChanged` subscribe bridge), the **full per-item control set + the main-process action
  handlers** (pause/resume/cancel/**remove-from-list (history-only)**/open via `shell.openPath`/show,
  folded here where exercised — architect leg-split), list-level **"Clear now"** + the **"files aren't
  deleted" footer note** (DD4), all over the origin-checked internal-IPC pattern (`internal-ipc.js`).
  Keyboard-operable, `aria-live` progress, within the a11y gate. (DD1, DD4)
- [x] `downloads-entry` — kebab `#kebab-downloads` item (`index.html:43`) opening `goldfinch://downloads`
  (mirror `#kebab-settings`, `renderer.js:377`) + `Ctrl+J` (keydown mapper + main-side
  `before-input-event` capture + renderer fallback, `isInternalTab` + lightbox guards). (DD2)
- [x] `downloads-mcp-tool` — `getDownloadsList()` engine op + `downloadsList` ToolDef (`inputSchema: {}`,
  default JSON-text), **admin-only via an EXPLICIT jar-façade refusal block in `scope.js`** mirroring
  `getChromeTarget` (`src/main/automation/scope.js:168` — NOT merely left out of `WCID_FIRST_OPS`, which would throw the opaque
  "not a function"; DD6), **a dedicated jar-refused unit test** (the three-place guard does not cover
  app-level ops; cf. `automation-scope.test.js:329`) + the admin-returns-list test, tool-count 26 → 27
  across `mcp-tools.js:503`, `automation-mcp-tools.test.js`, `automation-mcp-server.test.js`
  (`EXPECTED_TOOL_COUNT`). (DD6)
- [x] `menu-controller-graduation` *(folded-in maintenance, DD8)* — extract the `menuController` IIFE to
  `src/renderer/menu-controller.js`, load via `<script>` alongside `keydown-action.js`/`url-safety.js`,
  document the APG contract + `focusReturn?` + `trigger === menu` constraint + the global
  `pointerdown`/`blur` listeners (`docs/renderer-menu.md` or CLAUDE.md), regress all consumers (container
  picker, kebab incl. the new Downloads item, page-context menu, toolbar Unpin). *(Cleanest leg to defer
  to Flight 6 if the flight runs hot.)*
- [x] `verify-integration` — author/run the `downloads-surface` behavior test on the automation surface
  (admin key): trigger a download via `navigate` to a `Content-Disposition: attachment` fixture, assert
  the record appears in `downloadsList` as `completed` with a `savePath` that exists on disk, assert the
  jar-key call is refused (admin-only). **Owns the docs + count bumps**: README keyboard-shortcuts table
  (`Ctrl+J`); `docs/mcp-automation.md` (`downloadsList`); the **CLAUDE.md kebab prose** (`:23`, add
  Downloads — currently stale, also missing Print) and the new internal page in the internal-page list;
  the tool-count refs in all three sites (DD6). `npm run a11y` clean.
- [x] `hat-and-alignment` *(optional)* — guided HAT for `goldfinch://downloads`: trigger real downloads,
  watch live progress, exercise every control (open file, show in folder, pause/resume, cancel, remove,
  clear all, retry), the kebab + `Ctrl+J` entry, internal-tab no-op, and the a11y sweep — fixing issues
  live until the operator is satisfied.

---

## Post-Flight

### Completion Checklist
- [x] All legs completed (6 autonomous; `hat-and-alignment` remains optional/operator-driven)
- [ ] Code merged (draft PR open; merges after review)
- [x] Tests passing (unit: store + tool; `downloads-surface` behavior test green; a11y 0 new violations)
- [x] Documentation updated (README shortcuts; `docs/mcp-automation.md`; CLAUDE.md kebab prose +
  internal-page list + tool count; tool-count test refs)

### Verification
- **SC7** — the `downloads-surface` behavior test confirms a triggered download is tracked in the
  app-level model and surfaced through `downloadsList` with a real on-disk `savePath`; the
  `goldfinch://downloads` page (list, live progress, open/show/pause/resume/cancel/remove/clear/retry,
  keyboard operability) is **HAT-confirmed** and `npm run a11y` clean.
- **SC8 (part)** — `downloadsList` discoverable and invocable over MCP, **admin-only** (jar key refused);
  unit tests green; tool count 27.
