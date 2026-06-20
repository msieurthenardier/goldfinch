# Leg: downloads-model-store

**Status**: completed
**Flight**: [Downloads Surface](../flight.md)

## Objective

Build the main-process **app-level downloads model**: an in-memory `DownloadsManager` (canonical
cross-jar list) backed by a new electron-free `downloads-store.js` that exposes a **narrow repository
interface** (`list`/`append`/`remove`/`clear`/`getNextId`) with **terminal-only JSON persistence**, a
**persisted monotonic `nextId`**, and a **500-item cap** — then refactor the `will-download` handler to
register every download, **save silently to the OS Downloads folder** (DD5), persist on terminal
transition, and broadcast **id-keyed** progress/done events through `broadcastToChromeAndInternal`,
migrating the renderer toast consumers without changing their behavior.

## Context

- **DD3** — app-level model; in-memory live + **terminal-only** JSON persistence behind a repo
  interface; **persisted `nextId`** (never `max(persisted)+1` — a high-id record can be pruned/removed,
  re-issuing a live id → collision); 500-cap prune-oldest-by-`id`; in-progress is **memory-only** (no
  restart reconciliation); the in-progress history gap on **any teardown** is accepted for v1.
- **DD4** — media-panel downloads are captured automatically (they funnel through the same one
  `will-download` handler); no special-casing.
- **DD5** — Chrome-like **silent default-save** to `app.getPath('downloads')`, dropping the
  single-download native `setSaveDialogOptions` prompt; correctness now leans on `uniquePath`'s ` (n)`
  dedup.
- **DD9** — the JSON store is interim **behind the repo interface** so the planned SQLite swap is a
  one-module change. The BACKLOG storage-migration seed already exists (added during planning — verify,
  don't re-add).
- This is the **first** leg of the flight; the page (leg 2), entry (leg 3), and MCP tool (leg 4) all
  depend on the model and the id-keyed events this leg lands. Action handlers (pause/resume/cancel/
  remove/clear/open/show) are **deferred to `downloads-page`** (architect leg-split) — this leg builds
  the manager methods they will call (`remove`/`clear`) and the live-item registry, but does **not**
  wire the internal-IPC action channels.

## Inputs

What exists before this leg runs:
- `src/main/main.js:507` `wireDownloadHandler(sess)` — session-scoped `will-download` handler; today it
  URL-keys, prompts a native save dialog for single downloads (`:519` `setSaveDialogOptions`), and sends
  `download-progress`/`download-done` **only** to `mainWindow.webContents` (`:526`/`:539`).
- `src/main/main.js:479` `uniquePath(dir, filename)` — **lives in main.js, NOT `download-path.js`**
  (flight-spec drift; see Citation Audit). Sanitizes + dedups with ` (n)` and a traversal guard.
- `src/main/main.js:456` `pendingDownloads` (url → `{ suggestedName, saveDir }`) — the `download-media`
  → `will-download` correlation map; bulk/media downloads set `saveDir` for the silent-into-folder path.
- `src/main/main.js:798` `broadcastToChromeAndInternal(channel, payload)` — fans out to the file://
  chrome **and** every `__goldfinchInternal` session webContents. Already the precedent for
  `settings-changed`/`shields-changed`.
- `src/main/init-profile.js:26` `initProfileAndStores(app, { shields, settings, jars })` — electron-free
  store-load orchestrator; `settings.load(app.getPath('userData'))` at `:35` is the injection template.
- `src/main/settings-store.js` — the **durability-discipline template**: electron-free + injected path
  (`:5`/`:182` `load(userDataPath)`), atomic temp-write-then-rename (`:242` `save`), corrupt-file → safe
  default (`load` never throws, `:223`), pluggable `{ serialize, deserialize }` codec seam (`:13`/`:168`).
- `src/main/download-path.js` — `sanitizeFilename`, `isWithinDir` (no `uniquePath` here).
- `src/renderer/renderer.js:2580` `onDownloadProgress` / `:2595` `onDownloadDone` — URL-keyed toast
  consumers; `:1691` `bulk` tracker, `:1748` `bulkPump` (adds `item.url` to `bulk.urls`), `:1767`
  `bulkComplete(url, success)` — the bulk aggregation correlates **strictly by URL**.
- `src/preload/chrome-preload.js:109`/`:110` — `onDownloadProgress`/`onDownloadDone` bridges (plain
  payload passthrough); `:26` `showItemInFolder`.
- `BACKLOG.md` — already contains the "Persistent storage substrate: JSON stores → SQLite" seed (DD9).

## Outputs

What exists after this leg completes:
- **`src/main/downloads-store.js`** (new) — electron-free repository over a JSON file under `userData`.
- **`src/main/downloads-manager.js`** (new) — electron-free in-memory canonical list + persistence
  policy, store injected.
- **`src/main/main.js`** — `wireDownloadHandler` refactored: id assignment, manager registration,
  **silent default-save**, terminal-persist, id-keyed broadcast via `broadcastToChromeAndInternal`;
  best-effort `interrupted` flush on `before-quit`.
- **`src/main/init-profile.js`** — loads the downloads store alongside the others.
- **`src/renderer/renderer.js`** — toast consumers consume the id-bearing payload, behavior preserved.
- **`test/unit/downloads-store.test.js`** (new) and **`test/unit/downloads-manager.test.js`** (new).
- `BACKLOG.md` SQLite seed **verified present** (no edit expected).

## Acceptance Criteria

- [ ] `src/main/downloads-store.js` exists, is **electron-free** (no `require('electron')`, no
  `app.getPath` at module scope), and exposes exactly the repo interface: `load(userDataPath, opts?)`,
  `list()`, `append(record)`, `remove(id)`, `clear()`, `getNextId()`.
- [ ] **Persisted `nextId`**: `getNextId()` returns a strictly increasing integer that is **never
  lowered by `remove` or by the 500-cap prune**. After appending records up to ids `1..600` (pruning to
  the newest 500) and then removing the highest remaining id, the next `getNextId()` is still greater
  than every id ever issued. (No `max(persisted records)+1` derivation anywhere.)
- [ ] **Terminal-only persistence + 500-cap**: `append` clamps the persisted set to the **newest 500 by
  `id`** (insertion order); `load` applies the same clamp and a **per-record validator that drops
  malformed entries**. A corrupt/unreadable file → **empty list** (load never throws).
- [ ] **Atomic write + codec seam**: persistence writes via temp-file-then-rename, and a `{ serialize,
  deserialize }` pair is injectable (defaulting to JSON), mirroring `settings-store.js`.
- [ ] `src/main/downloads-manager.js` exists, electron-free, store injected; holds in-memory
  **in-progress** records, assigns ids via `store.getNextId()`, and on a terminal state **appends to the
  store and drops the item from memory**. `listAll()` returns the **merge** of in-memory in-progress
  records and `store.list()` terminal records, deduped by `id`.
- [ ] `wireDownloadHandler` (`main.js:507`) registers each `DownloadItem` in the manager with a stable
  `id`, **saves silently** to `app.getPath('downloads')` via `uniquePath` for the default (no `saveDir`)
  path — the `setSaveDialogOptions` branch (`:519`) is removed — and the existing bulk/media `saveDir`
  silent-into-folder path is unchanged.
- [ ] Progress/done events are broadcast through **`broadcastToChromeAndInternal`** (not
  `mainWindow.webContents.send`) and carry **both `id` and `url`** plus `filename`/`state`/`received`/
  `total`/`savePath`.
- [ ] Renderer toast consumers (`renderer.js:2580`/`2595`) still show the single-download confirmation
  ("Show in folder") and the bulk aggregate toast correctly — the **bulk tracker keeps correlating by
  `url`** (it has no id at dispatch time); no visible toast regression.
- [ ] The downloads store is loaded at startup via `init-profile.js` with the injected `userData` path;
  a best-effort `interrupted` flush of in-progress records runs on `before-quit` (`main.js:1310`), with
  the documented caveat that it is not guaranteed (sync handler vs. I/O write).
- [ ] `BACKLOG.md` contains the SQLite storage-migration seed (verify; do not duplicate).
- [ ] `test/unit/init-profile-order.test.js` updated for the 4th store and passing.
- [ ] WSLg `app.getPath('downloads')` writability checked and the result recorded in the flight log
  (the flight's first-leg spike, flight.md:296).
- [ ] `node --test test/unit/*.test.js` passes, including the new store + manager tests; no regression in
  `settings-store.test.js` / `download-path.test.js`.

## Verification Steps

- `node --test test/unit/downloads-store.test.js` — store interface, `getNextId` monotonicity across
  prune+remove, per-record validator drop, 500-cap prune, corrupt→empty, atomic write.
- `node --test test/unit/downloads-manager.test.js` — id assignment via injected store, terminal append
  + memory drop, `listAll` merge/dedup, `remove`/`clear`.
- `node --test test/unit/*.test.js` — full suite green (no regressions).
- `grep -n "setSaveDialogOptions" src/main/main.js` — the single-download prompt branch is gone (the
  only remaining native dialog is `choose-download-dir`'s folder picker, `main.js:497`).
- `grep -nE "broadcastToChromeAndInternal\('download-(progress|done)'" src/main/main.js` — events route
  through the fan-out helper (both progress + done).
- `node --test test/unit/init-profile-order.test.js` — passes with the new 4th store in the load order.
- Manual smoke (optional, `npm run dev`): download a file from a web page → it saves to the OS Downloads
  folder with no save dialog; the "Downloaded — Show in folder" toast still appears; bulk "Download
  selected" from the media panel still shows the aggregate toast.

## Implementation Guidance

1. **`src/main/downloads-store.js` — repo over JSON, mirroring `settings-store.js` durability discipline.**
   - Electron-free; `load(userDataPath, opts?)` stores the dir + codec (default JSON), reads
     `downloads.json` if present. The on-disk shape is an **object** `{ version: 1, nextId: <int>,
     records: [...] }` (not a bare array) so `nextId` persists independently of the records.
   - **Record schema** (terminal only): `{ id, url, filename, savePath, state, received, total, mime?,
     startTime, endTime, error? }` where `state ∈ {'completed','cancelled','interrupted'}`.
   - **Per-record validator** on load: drop entries missing a positive integer `id`, a string
     `filename`, or a terminal `state`; coerce/clamp the rest. Never throw — corrupt JSON or a bad
     top-level shape → `{ version:1, nextId:1, records:[] }`.
   - `getNextId()` returns `nextId` then increments and persists the bump. On `load`, set
     `nextId = max(persistedNextId, maxRecordId+1, 1)` (defensive — but the persisted `nextId` is the
     authority; the `maxRecordId+1` term only repairs a file that predates the field).
   - `append(record)`: push, then **prune to the newest 500 by `id`** (`records.sort`/`slice` by id, or
     drop-oldest); write atomically (temp + rename). `remove(id)`: filter out, write. `clear()`: empty
     `records` (keep `nextId`), write. **None of these ever lower `nextId`.**
   - Reuse the atomic-write + corrupt→default + codec-seam patterns verbatim from `settings-store.js`
     (`save` at `:242`, the `try/catch` in `load` at `:189`-`:227`, the codec at `:164`-`:168`). Do
     **not** copy its fixed-key `DEFAULTS`/`VALIDATORS`/`NORMALIZERS` merge — that's an object-schema fit,
     wrong for an array-of-records store.

2. **`src/main/downloads-manager.js` — in-memory canonical list, store injected.**
   - `createManager(store)` returns an object holding a `Map<id, record>` of **in-progress** records.
   - `register({ url, filename, savePath, mime, startTime })` → `const id = store.getNextId()`; store a
     `progressing` record in memory; return `id`.
   - `update(id, { received, total, state, paused })` → mutate the in-memory record (no disk write).
   - `finalize(id, { state, savePath, endTime, error })` → build the terminal record, `store.append(it)`,
     **delete from memory**. (If `id` is unknown — e.g. already finalized — no-op.)
   - `listAll()` → `[...memory.values(), ...store.list()]` deduped by `id` (memory wins).
   - `remove(id)` → delete from memory if present **and** `store.remove(id)` (history-only; leg 2 calls
     this from the page action). `clear()` → `store.clear()` (in-progress memory items stay).
   - `flushInterrupted()` → for each in-memory record, `store.append({ ...rec, state:'interrupted',
     endTime: <now> })` — best-effort teardown persist; tolerate throw.
   - Keep it electron-free so it unit-tests with a fake/in-memory store.

3. **Refactor `wireDownloadHandler` (`main.js:507`).**
   - Resolve `suggested` as today. **Silent default-save**: when there is no `meta.saveDir`, set
     `item.setSavePath(uniquePath(app.getPath('downloads'), suggested))` and **remove** the
     `setSaveDialogOptions` branch (`:519`-`:521`). Keep the existing `meta.saveDir` branch (`:515`-`:517`).
   - `const id = manager.register({ url, filename: item.getFilename(), savePath: item.getSavePath(),
     mime: item.getMimeType?.(), startTime: Date.now() })` — register **after** `setSavePath` so
     `getSavePath()` is the real target.
   - `updated` handler — **hoist the byte getters once** so the same bindings feed both `manager.update`
     and the broadcast payload (the bare `received`/`total` must be declared, not shorthand to nothing):
     ```js
     item.on('updated', (_e, state) => {
       const received = item.getReceivedBytes();
       const total = item.getTotalBytes();
       manager.update(id, { state, received, total, paused: item.isPaused?.() });
       broadcastToChromeAndInternal('download-progress',
         { id, url, filename: item.getFilename(), state, received, total });
     });
     ```
   - `item.once('done', (_e, state) => { pendingDownloads.delete(url); const savePath = state ===
     'completed' ? item.getSavePath() : null; manager.finalize(id, { state, savePath, endTime:
     Date.now() }); broadcastToChromeAndInternal('download-done', { id, url, filename:
     item.getFilename(), state, savePath }); })`.
   - Hold the live `DownloadItem` reference keyed by `id` somewhere reachable for leg 2's pause/resume/
     cancel handlers (e.g. a `Map<id, DownloadItem>` in main.js the manager doesn't need to know about,
     or pass a getter into the manager). **This leg only needs to keep the reference; it wires no
     actions.** Document the seam so leg 2 picks it up.
   - **The manager must be MODULE-SCOPED, assigned at store-load time — not a `whenReady` local.**
     `wireDownloadHandler` is also invoked from the synchronous `session-created` hook (`main.js:1188`)
     for web jars created before `whenReady`, so its closure must reference a module-scoped `manager`
     that is already assigned. Instantiate it once, right after the stores load (the concrete site is
     the `initProfileAndStores(...)` call, `main.js:1199`), injecting the loaded `downloads-store`.
     A `will-download` cannot realistically fire before a window exists, but module-scoping removes the
     theoretical undefined-manager hazard and mirrors the existing defensive pattern at `:1190`-`:1194`.
   - **Fix the stale `pendingDownloads` JSDoc comment while you're in the handler** (`main.js:456`): it
     reads `// url -> { suggestedName }` but the map stores `{ suggestedName, saveDir }` (`:468`).
     One-line correction — the handler is being rewritten right above it.

4. **`init-profile.js` — load the new store.** Add `downloads` to the injected stores and call
   `downloads.load(app.getPath('userData'))` after `settings.load(...)` (`:35`). Update the JSDoc
   `stores` typedef. **The only hard ordering constraint is "after the `setPath('userData')` redirect"**
   (`:32`); placing it after `settings.load` (which also takes the path as an arg) is fine. The main.js
   call site (`:1199`) passes the new store in the injected object. **Adding a 4th store changes the
   call sequence that `test/unit/init-profile-order.test.js` pins** — update that test to expect the new
   `downloads.load` in order (it asserts source/call order with an instrumented fake `app`).

5. **Renderer toast migration (`renderer.js:2580`/`2595`).** The payload now carries `id` **and** `url`.
   The simplest behavior-preserving change is **no logic change**: the consumers keep using `d.url` for
   the toast map and the `bulk.urls`/`bulkComplete(d.url, …)` correlation (the bulk tracker is started by
   URL at `bulkPump`, `:1748`, and never learns the id). Confirm the `d.url` field is still present in
   both events (it is, per step 3). The `id` field rides along unused by the toasts and is consumed by
   the downloads page in leg 2. Do **not** rewrite the bulk tracker to be id-keyed — it would need an id
   it cannot have at dispatch time, and DD3 prioritizes behavioral preservation.

6. **Best-effort teardown flush.** In `before-quit` (`main.js:1310`), call `manager.flushInterrupted()`
   **first**, then `mcpServer?.stop()` (flush before stop, since `stop()` may be slower). The flush loop
   is bounded by the **in-progress count** (typically 0–few), not the 500-cap, so the synchronous
   `writeFileSync` per item is acceptable quit latency. Document inline that this is best-effort (sync
   handler, I/O write) and the contract remains "in-progress is not durable" (DD3).

8. **WSLg writability spike (this leg owns the flight prerequisite, flight.md:296).** As part of done,
   confirm `app.getPath('downloads')` is writable in the dev env: a quick `npm run dev` smoke download
   (or a one-off `fs.accessSync(app.getPath('downloads'), fs.constants.W_OK)` check) and **record the
   result in the flight log**. If it is NOT writable under WSLg, note it — leg 6's behavior test has a
   documented store-seeding fallback, and the live-trigger assertion defers to macOS (flight Adaptation
   Criteria).

7. **BACKLOG verification.** Confirm the "Persistent storage substrate: JSON stores → SQLite" section is
   present in `BACKLOG.md` (it is — added during planning). Do not duplicate it.

9. **Test construction notes.**
   - `downloads-store.test.js`: the store is a **module-scoped singleton** (like settings-store), so
     copy `settings-store.test.js`'s fresh-require/cache-bust pattern (delete the require cache per test
     group) to stop `dir`/state leaking across tests. Use a real temp dir (`fs.mkdtempSync`).
   - `downloads-manager.test.js`: the manager is a **factory** (`createManager(store)`), not a singleton
     — inject a **pure in-memory fake store** (no fs) and assert `register`/`update`/`finalize`/
     `listAll`/`remove`/`clear`/`flushInterrupted` deterministically. No cache dance needed.
   - The `getNextId` monotonicity-across-prune+remove and 500-cap/corrupt→empty ACs are **store** tests
     (real fs); the manager test stays fast.

## Edge Cases

- **Same-URL re-download** (DD5 allows it): `uniquePath` yields ` (n)` suffixes; each download gets a
  distinct `id` and a distinct `savePath`. The bulk tracker's URL correlation can momentarily collide on
  identical URLs in one batch — this matches today's behavior (pre-existing), not a regression this leg
  introduces; preserve as-is.
- **`download-media` correlation**: `pendingDownloads` is still keyed by URL and deleted on `done` —
  unchanged. The manager id is independent of that map.
- **Item finalized while still in `bulk.urls`**: `bulkComplete(d.url, …)` still fires from the
  `download-done` consumer; preserved.
- **500-cap boundary**: appending the 501st terminal record drops id-oldest; `getNextId` unaffected.
- **Corrupt `downloads.json`**: load → empty records, `nextId` reset to 1 (acceptable: history loss on a
  corrupt file, same posture as settings).
- **`app.getPath('downloads')` not writable** (WSLg risk, flight prerequisite spike): `setSavePath` to an
  unwritable dir surfaces as an `interrupted`/failed item — acceptable for this leg; the behavior test
  (leg 6) has a documented WSLg fallback. Note the result in the flight log if observed.

## Files Affected

- `src/main/downloads-store.js` — **new**: electron-free JSON repo (`list`/`append`/`remove`/`clear`/
  `getNextId`), persisted `nextId`, 500-cap, terminal-only, atomic write, corrupt→empty.
- `src/main/downloads-manager.js` — **new**: in-memory canonical list + persistence policy, store
  injected.
- `src/main/main.js` — refactor `wireDownloadHandler` (`:507`): silent default-save (drop `:519`
  dialog), id assignment + manager registration, id-keyed broadcast via `broadcastToChromeAndInternal`,
  live-item reference seam for leg 2; instantiate manager in `whenReady`; `flushInterrupted` in
  `before-quit` (`:1310`).
- `src/main/init-profile.js` — load the downloads store (inject `userData` path) + typedef.
- `test/unit/init-profile-order.test.js` — update to expect the new `downloads.load` in the load order.
- `src/renderer/renderer.js` — confirm toast consumers (`:2580`/`:2595`) consume the id-bearing payload;
  no logic change.
- `test/unit/downloads-store.test.js` — **new**.
- `test/unit/downloads-manager.test.js` — **new**.
- `BACKLOG.md` — verify SQLite seed present (no edit).

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing (`node --test test/unit/*.test.js`)
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `completed` (in this file's header)
- [ ] Check off this leg in flight.md
- [ ] If final leg of flight: (N/A — leg 1 of 6)
- [ ] Commit deferred per `/agentic-workflow` (flight-level review + commit after the last autonomous leg)

---

## Citation Audit

7 of 8 distinct code citations verified clean against current code at leg design time; 1 drift repaired:

- **`uniquePath` — drifted (repaired).** The flight spec (DD3/DD5, Technical Approach) cites `uniquePath`
  as living in `download-path.js`. It is actually defined in **`src/main/main.js:479`**
  (`download-path.js` exports only `sanitizeFilename` + `isWithinDir`). This leg handles `uniquePath`
  where it lives (main.js); the silent-save refactor uses it in-place. Flagged so leg 2/6 and the
  flight-spec readers aren't sent to the wrong file.
- `main.js:507` `wireDownloadHandler`, `:510` `will-download`, `:519` `setSaveDialogOptions`, `:526`/
  `:539` event sends, `:456` `pendingDownloads`, `:798` `broadcastToChromeAndInternal`, `:1188`/`:1201`/
  `:1205` per-session wiring, `:1310` `before-quit`, `:1199` `initProfileAndStores` call — **OK**.
- `init-profile.js:26`-`:37` (load orchestration) — **OK**.
- `settings-store.js:5`/`:13`/`:182`/`:242` (durability-discipline template) — **OK**.
- `renderer.js:2580`/`:2595` (toast consumers), `:1691`/`:1748`/`:1767` (bulk tracker, URL-keyed) — **OK**.
- `chrome-preload.js:109`/`:110` (download bridges) — **OK**.
- **BACKLOG SQLite seed — already-satisfied.** The DD9 sub-item "seeds the BACKLOG.md SQLite mission" is
  already present in `BACKLOG.md` (added during planning); this leg verifies, not re-adds.
