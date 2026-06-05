# Leg: remove-open-external

**Status**: completed
**Flight**: [Harden the Hostile-Page Security Boundary](../flight.md)

## Objective
Remove the unused, unconstrained `open-external` IPC capability (handler + contextBridge binding), eliminating a latent privileged surface (`shell.openExternal` with no scheme allowlist).

## Context
- Flight DD/technical approach F3 — remove, don't guard. `main.js:173-175` (shifted from the original `:156-158` by legs 1–2) `ipcMain.handle('open-external', (_e, url) => { if (url) shell.openExternal(url); })`; bridged at `chrome-preload.js:13` `openExternal: (url) => ipcRenderer.invoke('open-external', url)`. Recon confirmed **no renderer caller** (`grep openExternal src/renderer/renderer.js` → none). Guarding dead code is weaker than removing it; a future need re-introduces it deliberately with an allowlist.
- No test impact (no behavior to assert beyond absence); verified via grep + the app still loading.

## Inputs
- `src/main/main.js` — the `open-external` handler (`:156-158`).
- `src/preload/chrome-preload.js` — the `openExternal` bridge line (`:13`).

## Outputs
- `src/main/main.js` — `open-external` handler deleted.
- `src/preload/chrome-preload.js` — `openExternal` line deleted.

## Acceptance Criteria
- [ ] The `ipcMain.handle('open-external', …)` handler is removed from `src/main/main.js`.
- [ ] The `openExternal:` line is removed from the `contextBridge.exposeInMainWorld('goldfinch', …)` object in `src/preload/chrome-preload.js`.
- [ ] `grep -rn "open-external\|openExternal" src/` returns **no matches** (no handler, no bridge, no caller).
- [ ] The `shell` import in `main.js` is retained (still used by `show-item-in-folder` → `shell.showItemInFolder`); no unused-import is introduced and no other handler is disturbed.
- [ ] No syntax breakage — `node -e "require('./src/preload/chrome-preload.js')"` is not applicable (needs Electron), but the file parses; `npm test` still passes (unchanged suites).

## Verification Steps
- `grep -rn "open-external\|openExternal" src/` → empty.
- `grep -n "shell" src/main/main.js` → `shell` still imported and still used by `show-item-in-folder` (and any other `shell.*` call).
- `npm test` → exits 0 (no regression).
- Read the edited regions to confirm only the two target lines/blocks were removed and surrounding handlers are intact.

## Implementation Guidance

1. **`src/main/main.js`** — delete the three-line `ipcMain.handle('open-external', …)` block (currently `:173-175`; locate by content, not line number, since the tree has uncommitted edits). Leave `show-item-in-folder` (just above) and the privacy section (just below) intact. Do not touch the `shell` require on line 3.
2. **`src/preload/chrome-preload.js`** — delete the `openExternal: (url) => ipcRenderer.invoke('open-external', url),` line (`:13`) from the exposed object. Ensure the surrounding object literal stays valid (no dangling comma issues).
3. Confirm with the grep in Verification Steps.

## Edge Cases
- **`shell` still needed**: `show-item-in-folder` uses `shell.showItemInFolder` — keep the import.
- **Trailing comma / object validity** in the preload after removing the line.
- **No caller to update**: recon confirmed none; the grep AC is the guard against a missed reference.

## Files Affected
- `src/main/main.js` — remove `open-external` handler
- `src/preload/chrome-preload.js` — remove `openExternal` bridge line

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing (`npm test`)
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `completed` (in this file's header)
- [ ] Check off this leg in flight.md
- [ ] If final leg of flight: (N/A — leg 4 of 5)
- [ ] Commit handled at flight end (deferred per agentic-workflow single-commit model)
