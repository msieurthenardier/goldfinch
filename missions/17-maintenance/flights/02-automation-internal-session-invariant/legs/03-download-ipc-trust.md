# Leg: download-ipc-trust

**Status**: completed
**Flight**: [Automation-Surface Internal-Session Invariant](../flight.md)
**Slug**: `download-ipc-trust`
**Risk tier**: high — two IPC trust-boundary fixes on a security-sensitive surface (a renderer-supplied handle and a renderer-supplied filesystem path).

## Objective

Close finding F10c (flight DD4), two independent trust gaps in `src/main/register-download-ipc.js`, both unchanged by the flight pivot:

1. **`download-media`** trusts a renderer-supplied `webContentsId` with no validation — naming the chrome's own id resolves the chrome contents as the downloader, reopening the default-session cookie leak that DD6 (M13 F1 L2) closed by removing the chrome-view fallback. Validate the id against **tab** contents; a non-tab id is ignored (fall back to the sender's active tab).
2. **`show-item-in-folder`** takes a raw renderer-supplied path and hands it straight to `shell.showItemInFolder` — directly contradicting the neighboring comment (`:88-90`: "never trust a renderer-supplied path"). Confine it to a path main already knows: an approved download directory or a known download record's `savePath`; reject anything else.

## Context

**Ground truth (read 2026-08-28, post-Leg-2).**

- `register-download-ipc.js:49-51` — `ipcMain.handle('download-media', …)`: `const wc = typeof webContentsId === 'number' ? webContents.fromId(webContentsId) : null;` then `const downloader = wc || senderActiveTab;` (`:53,59`). `webContents.fromId` accepts ANY id — including the chrome's — so a renderer naming the chrome id downloads via the chrome contents (default session). `senderActiveTab` (`:52-53`) is the sanctioned fallback (`getTabContents(rec.activeTabWcId)`), and `getTabContents` is already imported (`:10`). DD6 comment (`:54-58`) documents that the chrome-view fallback was removed precisely to avoid default-session cookies — but the renderer-supplied id reintroduces the same path.
- `register-download-ipc.js:86-88` — `ipcMain.handle('show-item-in-folder', (_event, savePath) => { if (savePath) shell.showItemInFolder(savePath); })`. Raw path, no validation.
  - Comment `:90-92`: "resolve savePath MAIN-SIDE by numeric id — never trust a renderer-supplied path." The sibling handlers `open-downloaded-file` (`:126`), `reveal-downloaded-file` (`:139`), and the internal open/show bodies (`:190`) all follow it via `resolveDownloadRecord(id)` (`:93-98`).
  - Its two renderer callers (`src/renderer/chrome/media-controller.js`): `:494` `showItemInFolder(dir)` — a bulk-download **directory** (the saveDir, tracked in `approvedDownloadDirs`); `:715` `showItemInFolder(d.savePath)` — a completed download's **savePath**. Neither caller has a download-record **id** in scope, so migrating to `reveal-downloaded-file(id)` would need new renderer plumbing.
- Main knows both legitimate shapes already: `approvedDownloadDirs` (a `Set` of resolved dirs, populated in `download-media` `:60-62` and the save-dir chooser `:83`) and `getDownloadsManager().listAll()` records, each carrying `.savePath` (`resolveDownloadRecord`, `:93-98`).
- Tests: `test/unit/register-download-ipc.test.js` (if present — confirm; else the download IPC is tested via `media-proxy-handler.test.js` / a downloads test). The design review to confirm the test home and the fake shapes.

**Decision (design-time):** for `show-item-in-folder`, **validate main-side** (accept a path iff it is an approved download dir OR equals a known record's resolved `savePath`; else no-op) rather than migrate the callers to an id-based handler. Rationale: it closes the trust gap with no IPC-signature change and no renderer/preload/`.d.ts` churn, and both callers pass main-originated paths that main can re-verify. The id-migration alternative is rejected here (the callers lack record ids without extra plumbing); if the reviewer prefers it, that is a larger, cross-file change.

## Inputs

- `flight/02` after Legs 1–2 landed (uncommitted). This leg touches only `register-download-ipc.js` + its tests — no overlap with Legs 1–2.

## Outputs

- `src/main/register-download-ipc.js` — (1) in `download-media`, gate the renderer `webContentsId` through a tab check (`getTabContents(webContentsId)` yields a real tab, or `registry.isTabViewWcId(webContentsId)`); a non-tab id ⇒ `wc = null` ⇒ the existing `senderActiveTab` fallback. (2) in `show-item-in-folder`, validate the path against `approvedDownloadDirs` ∪ known-record `savePath`s before `shell.showItemInFolder`; reject otherwise.
- Tests: the download-media validation (a chrome/non-tab id is NOT used as the downloader — falls back; a real tab id IS used); the show-item-in-folder validation (an approved dir and a known savePath are shown; an arbitrary/unknown path is refused — `shell.showItemInFolder` NOT called).
- Flight-log leg entry; this leg `landed`.

## Acceptance Criteria

- [x] AC1: `download-media` with a `webContentsId` that is NOT a tab (e.g. the chrome's id, or an unknown id) does not resolve that contents as the downloader — it falls back to the sender's active tab (or fails loudly if none); a `webContentsId` that IS a real tab is used — unit-pinned; the chrome-id → default-session path is closed.
- [x] AC2: `show-item-in-folder` calls `shell.showItemInFolder` only for a path that is an approved download directory OR a known download record's resolved `savePath`; for any other path it is a no-op (`shell.showItemInFolder` NOT called) — unit-pinned, incl. a path-traversal-y / arbitrary path rejected.
- [x] AC3: the two legitimate renderer callers still work — the bulk-download directory (`media-controller.js:494`) and a completed download's savePath (`:715`) both pass validation (they are main-known) — covered by AC2's positive cases mirroring those inputs.
- [x] AC4: no IPC signature change, no renderer/preload/`.d.ts` change (validation is main-internal); `resolve.js`, `observe.js`, the vault path untouched.
- [x] AC5: gates — `npm test` (0 fail/skip/todo), `npm run lint`, `npm run typecheck`, `npx prettier --check .`; Legs 1–2 suites stay green.

## Verification Steps

- AC1: a test passing the chrome wcId (or an id `getTabContents` rejects) asserts the downloader is the sender's active tab, not the supplied contents; neuter — remove the tab check → the chrome-id test shows the chrome contents used → red.
- AC2/AC3: tests for approved-dir, known-savePath (shown), and arbitrary-path (not shown); neuter — remove the validation → the arbitrary-path test shows it called → red.
- AC4: `git diff --stat` shows only `register-download-ipc.js` + its test file.
- AC5: gates.

## Implementation Guidance

1. **download-media**: replace `const wc = typeof webContentsId === 'number' ? webContents.fromId(webContentsId) : null;` with a tab-validated resolve — prefer `const wc = typeof webContentsId === 'number' ? getTabContents(webContentsId) : null;` if `getTabContents` returns a tab's contents for a tab wcId and null/undefined otherwise (CONFIRM its contract; if it throws or returns non-null for non-tabs, guard with `registry.isTabViewWcId(webContentsId)` first). The point: only a real tab's contents may be the explicit downloader; everything else falls to `senderActiveTab`. Keep the DD6 comment and extend it to name this validation.
2. **show-item-in-folder**: build the main-known set at call time — `const resolved = path.resolve(savePath);` accept iff `approvedDownloadDirs.has(resolved)` OR `getDownloadsManager()?.listAll().some((r) => r.savePath && path.resolve(r.savePath) === resolved)`; only then `shell.showItemInFolder(savePath)`. Otherwise return/no-op (optionally log). Update the `:90-92` comment to describe validation (the equivalent of resolve-by-id for callers that hold a path, not an id).
3. Tests: confirm the test home (grep for an existing `register-download-ipc` / `download` IPC test; if none, add `test/unit/register-download-ipc.test.js` with a fake `ipcMain`/`webContents`/`shell`/`getDownloadsManager`/`getTabContents`/`registry` per the file's other-handler test pattern). Cover AC1 and AC2 incl. the neuter checks.
4. Gates.

## Edge Cases

- **No active tab and a bad id**: `download-media` already returns `{ ok:false, 'No web contents available' }` when `downloader` is falsy — a rejected id that also has no `senderActiveTab` fails loudly (correct, DD6).
- **A record whose savePath is null / in-flight**: excluded from the known-savePath set (only completed records carry a stable savePath); an in-flight file should not be "show in folder"-able anyway.
- **Symlink / normalization**: compare `path.resolve`d values on both sides so a `.`/`..`-laden renderer path can't dodge the set; do not `realpath` (that hits the FS) unless the reviewer wants it.
- **`getTabContents` contract** (design review CONFIRMED): `main.js:464-470` → `registry.getWindowForGuest` matches only `rec.tabViews.has(wcId)`, returning **null** (never throwing) for the chrome id, a sheet id, a popup id, or an unknown/dead id, and a live contents only for a genuine tab — so `const wc = getTabContents(webContentsId)` is correct with NO `isTabViewWcId` guard. Internal (vault/settings) tabs are ordinary tabs and correctly resolve (tab-vs-non-tab, not internal-vs-external).
- **Stale "Show in folder" toast** (design review LOW): if the user clears download history while an old completion toast (`media-controller.js:715`) is still visible, its `d.savePath` is no longer in `listAll()` nor an approved dir, so the click silently no-ops even though the file exists — **fails closed (safe)**; a minor UX regression vs today, accepted and documented (a security fix must not trust an unvalidated path to preserve that convenience).
- **Dead `webContents` param** (design review LOW, optional): after step 1 removes the sole `webContents.fromId` use (`:51`), the `webContents` factory param (`:8`, passthrough `main.js:1389`) is unused. Remove it for cleanliness IF it is a clean 2-line removal; leave it if removal would ripple — lint will not fail either way (`args:'after-used'`). Not required by AC4.

## Files Affected

`src/main/register-download-ipc.js`, its unit test. (Not renderer/preload/`.d.ts`; not `resolve.js`/`observe.js`/`vault-context.js`.)

## Citation Audit

2026-08-28, against `flight/02` post-Leg-2: `register-download-ipc.js:49-62` (download-media), `:86-88` (show-item-in-folder), `:90-98` (comment + `resolveDownloadRecord`), `:126/139/190` (id-based siblings), `getTabContents` import `:10`, `approvedDownloadDirs` use; renderer callers `media-controller.js:494/715`. All read at design time; the design review to confirm the `getTabContents` non-tab contract and the test home.
