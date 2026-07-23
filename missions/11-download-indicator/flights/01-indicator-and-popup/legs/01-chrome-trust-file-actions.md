# Leg: chrome-trust-file-actions

**Status**: completed
**Flight**: [Top-Bar Download Indicator + Downloads Popup](../flight.md)

## Objective

Add two chrome-trust IPC handlers — `open-downloaded-file` and `reveal-downloaded-file` — that take a
numeric download **id**, resolve the file's `savePath` main-side from the downloads manager (never from
the renderer), and call `shell.openPath` / `shell.showItemInFolder`; plus the `window.goldfinch` preload
bridges the popup will call.

## Context

- Flight DD4: file actions must resolve `savePath` main-side by id; a renderer-held path is never
  trusted. Today's chrome-trust `show-item-in-folder` (`register-download-ipc.js:80 — "ipcMain.handle('show-item-in-folder', (_event, savePath) => {"`)
  trusts a renderer-supplied path, so reveal-by-id is genuinely new work, not just open-by-id.
- The internal-origin-locked handler `internal-downloads-action` already resolves records by id and
  performs open/show (`register-download-ipc.js:131 — "const record = manager.listAll().find((entry) => entry.id === id);"`,
  open body at `:158-162`, show body at `:163-166`). This leg extracts that id→record resolution into a
  shared helper and reuses it, rather than forking trust-domain logic.
- These new handlers are plain `ipcMain.handle` (chrome-trust — reachable from the `file://` chrome, the
  same trust domain as `show-item-in-folder`), NOT `registerInternalHandler` (which is locked to the
  `goldfinch://` internal session). The popup lives in the chrome.
- Downstream: Leg 3's popup dispatch calls `window.goldfinch.openDownloadedFile(id)` /
  `revealDownloadedFile(id)`. This leg has no UI dependency and can land first.

## Inputs

- `src/main/register-download-ipc.js` exports `registerDownloadIpc({ ipcMain, shell, getDownloadsManager, ... })`;
  the manager exposes `listAll()` returning records `{ id, url, filename, savePath, state, ... }`
  (`downloads-manager.js:listAll`). `shell` and `getDownloadsManager` are already injected
  (`main.js:805 — "shell,"`, `main.js:807 — "getDownloadsManager: () => downloadsManager,"`).
- `src/preload/chrome-preload.js` exposes the `window.goldfinch` bridge object; `showItemInFolder` is the
  existing precedent (`chrome-preload.js:34 — "showItemInFolder: (savePath) => ipcRenderer.invoke('show-item-in-folder', savePath),"`).
- `test/unit/register-download-ipc.test.js` — existing unit harness (`makeHarness()`) that stubs
  `ipcMain.handle`, `shell.openPath`/`showItemInFolder` (recording `['open', savePath]` / `['show', savePath]`),
  and a `manager.listAll()` returning `record = { id: 1, url, savePath: '/trusted/file' }`.

## Outputs

- `register-download-ipc.js`: a shared `resolveDownloadRecord(id)` helper; two new `ipcMain.handle`
  channels `open-downloaded-file` and `reveal-downloaded-file`; the internal open/show bodies refactored
  onto the shared helper (behavior unchanged).
- `chrome-preload.js`: `openDownloadedFile(id)` and `revealDownloadedFile(id)` on `window.goldfinch`.
- `register-download-ipc.test.js`: updated handler-set assertion + new tests for the two channels.

## Acceptance Criteria

- [x] `open-downloaded-file` and `reveal-downloaded-file` are registered via `ipcMain.handle`
      (chrome-trust), NOT `registerInternalHandler`.
- [x] Both handlers take **only a numeric id** — no path parameter — and resolve `savePath` from
      `getDownloadsManager().listAll()` by id, via a single shared `resolveDownloadRecord(id)` helper also
      used by the internal `internal-downloads-action` open/show bodies.
- [x] `open-downloaded-file` returns `{ ok: false }` and does **not** call `shell.openPath` when the id
      resolves to no record OR the record's `state !== 'completed'`; when the record is completed it calls
      `shell.openPath(record.savePath)` and returns `{ ok: !error, error: error || undefined }` — i.e.
      `{ ok: true, error: undefined }` on success (mirrors the internal open body; the existing internal
      test at `register-download-ipc.test.js:79` asserts exactly `{ ok: true, error: undefined }`).
- [x] `reveal-downloaded-file` calls `shell.showItemInFolder(record.savePath)` and returns `{ ok: true }`
      for a resolved record; returns `{ ok: false }` (no shell call) for an unresolved id.
- [x] `window.goldfinch.openDownloadedFile(id)` and `window.goldfinch.revealDownloadedFile(id)` invoke the
      two channels respectively.
- [x] The legacy path-trusting `show-item-in-folder` handler is left intact (still used by the toast in
      `media-controller.js`); the internal `internal-downloads-action` open/show still pass their tests.
- [x] `npm test` passes, including the updated `register-download-ipc.test.js` handler-set assertion.

## Verification Steps

- `npm test` (or `node --test test/unit/register-download-ipc.test.js`) — all green.
- `grep -n "open-downloaded-file\|reveal-downloaded-file" src/main/register-download-ipc.js` — both are
  `ipcMain.handle`, and their handler bodies reference `resolveDownloadRecord`, not a path argument.
- `grep -n "openDownloadedFile\|revealDownloadedFile" src/preload/chrome-preload.js` — both present.
- Confirm the handlers' arity: the handler function's second arg is the id (a number), never a path.

## Implementation Guidance

1. **Extract the shared resolver** in `register-download-ipc.js` (module-local, inside `registerDownloadIpc`
   so it closes over `getDownloadsManager`):
   ```js
   function resolveDownloadRecord(id) {
     if (typeof id !== 'number') return null;
     const manager = getDownloadsManager();
     if (!manager) return null;
     return manager.listAll().find((entry) => entry.id === id) || null;
   }
   ```
   Refactor the internal `internal-downloads-action` handler to obtain `record` via
   `resolveDownloadRecord(id)` instead of the inline `manager.listAll().find(...)` (keep the `manager`
   local for the pause/resume/cancel/remove/retry branches — those need the live-item map and other
   manager methods; only the record lookup is shared). Behavior must be byte-identical.

2. **Add the chrome-trust open handler** (near the existing `show-item-in-folder` at `:80`):
   ```js
   ipcMain.handle('open-downloaded-file', (_event, id) => {
     const record = resolveDownloadRecord(id);
     if (!record || record.state !== 'completed' || !record.savePath) return { ok: false };
     return Promise.resolve(shell.openPath(record.savePath))
       .then((error) => ({ ok: !error, error: error || undefined }));
   });
   ```
   The `state === 'completed'` gate is the trust-boundary enforcement of "never openable until complete":
   an in-flight record already carries a `savePath` (set pre-register at `register-download-ipc.js:91-93`),
   so opening by id must confirm completion or it would launch a partially-written file.

3. **Add the chrome-trust reveal handler**:
   ```js
   ipcMain.handle('reveal-downloaded-file', (_event, id) => {
     const record = resolveDownloadRecord(id);
     if (!record || !record.savePath) return { ok: false };
     shell.showItemInFolder(record.savePath);
     return { ok: true };
   });
   ```
   (Reveal does not gate on completion — revealing an in-progress file's location is harmless — but the
   popup only offers reveal on rows it renders; still, resolve by id, never trust a path.)

4. **Add the preload bridges** in `chrome-preload.js` next to `showItemInFolder` (`:34`):
   ```js
   openDownloadedFile: (id) => ipcRenderer.invoke('open-downloaded-file', id),
   revealDownloadedFile: (id) => ipcRenderer.invoke('reveal-downloaded-file', id),
   ```

5. **Update tests** in `register-download-ipc.test.js`:
   - The first test asserts the exact chrome handler set:
     `assert.deepEqual([...h.handlers.keys()].sort(), ['choose-download-dir', 'download-media', 'show-item-in-folder'])`.
     Update the expected array to include `'open-downloaded-file'` and `'reveal-downloaded-file'` (sorted).
   - Add `state: 'completed'` to the harness `record` so the open-completion gate can pass.
   - Add tests:
     - `open-downloaded-file` with the known id → calls `shell.openPath('/trusted/file')` (events include
       `['open', '/trusted/file']`) and returns `{ ok: true, error: undefined }` (strict `deepEqual` — the
       `error` key is present with value `undefined`; do NOT assert bare `{ ok: true }`).
     - `open-downloaded-file` with an unknown id → `{ ok: false }`, no `open` event.
     - `open-downloaded-file` on an in-progress record → `{ ok: false }`, no `open` event (completion
       gate). Add a **distinct second record** to the harness `manager.listAll()` array —
       `{ id: 2, url, savePath: '/trusted/partial', state: 'progressing' }` — and assert
       `open-downloaded-file(2)` → `{ ok: false }`. Do NOT mutate the shared `record` (the internal
       open/show tests read it).
     - `reveal-downloaded-file` with the known id → `['show', '/trusted/file']`, `{ ok: true }`.
     - `reveal-downloaded-file` with an unknown id → `{ ok: false }`, no `show` event.
     - Assert neither handler accepts a path: pass a bogus path as a second arg and confirm the resolved
       savePath still comes from the manager record (or simply that the handler signature is `(_event, id)`).

## Edge Cases

- **Non-numeric / missing id** → `resolveDownloadRecord` returns `null` → `{ ok: false }`, no shell call.
- **`state !== 'completed'` on open** → `{ ok: false }` (partial-file guard).
- **`shell.openPath` returns a non-empty error string** (Electron convention: empty string = success) →
  surface as `{ ok: false, error }`, mirroring the internal open body.
- **Record present but `savePath` null** (e.g. a non-completed done) → `{ ok: false }`.

## Files Affected

- `src/main/register-download-ipc.js` — shared resolver + two chrome-trust handlers + internal refactor.
- `src/preload/chrome-preload.js` — two `window.goldfinch` bridges.
- `test/unit/register-download-ipc.test.js` — updated handler-set assertion + new tests.

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Tests passing (`npm test`)
- [x] Update flight-log.md with leg progress entry
- [x] Leg status set to `landed` (per `/agentic-workflow` — flight-end review promotes to `completed`)
- [x] Check off this leg in flight.md
- [x] (Not final leg — no flight-level transition here)
- [x] Changes left uncommitted for the single flight-end commit (do NOT commit per-leg under this workflow)
