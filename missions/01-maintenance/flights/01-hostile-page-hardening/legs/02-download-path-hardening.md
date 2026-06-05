# Leg: download-path-hardening

**Status**: completed
**Flight**: [Harden the Hostile-Page Security Boundary](../flight.md)

## Objective
Prevent a download from escaping the user-chosen directory or writing a hidden/reserved filename: validate that `download-media`'s `saveDir` is a directory the app's own folder-dialog approved this session (F4), and harden `uniquePath`'s filename sanitization with a final-path containment assertion (F5).

## Context
- Flight DD/technical approach F4+F5 (shared code path). `download-media` (`main.js:72-85`) stores a renderer-supplied `saveDir` in `pendingDownloads`; `will-download` (`main.js:112-124`) consumes it via `uniquePath(meta.saveDir, suggested)` (`:119`). `uniquePath` (`main.js:88-99`) currently does `String(filename).replace(/[\/\\:*?"<>|]/g, '_').slice(0,180)` — separators are stripped (so `../` collapses to `_.._`), but leading dots, Windows reserved device names, and directory containment are unchecked.
- Recon (flight log) established `saveDir` is **always** freshly sourced from the native dialog `choose-download-dir` (`main.js:101-107`) per bulk run (`renderer.js:569,586`) and never persisted — so a **session-scoped** approved-set is sufficient and restart-safe. The threat is second-order (a compromised renderer supplying an arbitrary `saveDir`); this leg closes it defense-in-depth.
- Prerequisite: leg 1 (`tab-scheme-guard`) landed the `node --test` runner this leg reuses (`npm test`).

## Inputs
- `src/main/main.js` — `download-media` handler (`:72-85`), `uniquePath` (`:88-99`), `choose-download-dir` (`:101-107`), `wireDownloadHandler`/`will-download` (`:109-150`).
- Leg 1 outputs: `package.json` `test` script + `test/unit/` directory exist.

## Outputs
- `src/main/download-path.js` (new) — pure helpers: `sanitizeFilename(name)` and `isWithinDir(dir, candidate)`, CommonJS-exported (requirable by `main.js` and the test).
- `src/main/main.js` — a session-scoped `approvedDownloadDirs` Set populated in `choose-download-dir`; `download-media` rejects a `saveDir` not in it; `uniquePath` uses `sanitizeFilename` and asserts containment on the final path.
- `test/unit/download-path.test.js` (new) — unit tests for `sanitizeFilename` and `isWithinDir`.

## Acceptance Criteria
- [ ] `choose-download-dir` (`main.js:101-107`) records the returned absolute path (via `path.resolve`) in a module-scoped session `Set` before returning it.
- [ ] `download-media` (`main.js:72-85`) rejects when `saveDir` is provided but its `path.resolve`d form is **not** in the approved Set — returns `{ ok: false, error: <message> }` **before** `pendingDownloads.set` and before `downloader.downloadURL(url)` (so `will-download` never fires for it and no map entry is orphaned). When `saveDir` is absent/null, behavior is unchanged (falls through to the save-dialog branch in `will-download`). The renderer's `bulkPump` (`renderer.js:583-588`) already treats `!res.ok` as a per-item failure, so fail-fast rejection is correct UX (no dialog fallback).
- [ ] `sanitizeFilename` is applied **inside `uniquePath`** to its fully-resolved `filename` argument — i.e. it sanitizes whichever value `suggested` holds at `main.js:119` (`(meta && meta.suggestedName) || item.getFilename() || 'download'`), covering **both** the page-supplied `suggestedName` **and** the browser-reported `item.getFilename()` fallback. Per-source sanitization before `pendingDownloads.set` is neither required nor sufficient; the `uniquePath` boundary is the single choke point.
- [ ] `sanitizeFilename(name)`: strips path separators (existing behavior), **strips leading dots** (no hidden files), **strips trailing dots** (`NUL.` is still reserved on Windows), neutralizes `..`, **prefixes** Windows reserved device names with `_` (`CON`→`_CON`, `con.txt`→`_con.txt`, `LPT1`→`_LPT1`; case-insensitive; basename reserved regardless of extension), caps length, and falls back to `'download'` when the result is empty.
- [ ] `uniquePath` asserts containment on the **final** resolved candidate (after the dedup `while` loop): `isWithinDir(dir, candidate)` must hold, i.e. `path.resolve(candidate).startsWith(path.resolve(dir) + path.sep)`. On violation it does NOT return a path that escapes `dir` (throw, or fall back to `path.join(dir, 'download')`).
- [ ] The normal download flow is unaffected: a file with an ordinary name saved into a dialog-chosen dir still works; bulk download into the chosen folder still works.
- [ ] `npm test` passes, covering: `..`/`../../etc/passwd`, leading-dot (`.bashrc`), trailing-dot (`NUL.`), reserved names (`CON`, `con.txt`, `LPT1`), empty/all-dots/whitespace names, very long names, a **falsy `suggestedName`** producing a safe name from the fallback, a **dedup-suffix** scenario staying within `dir`, and containment (sanitized names stay within `dir`; a hypothetical escaping candidate is rejected).

## Verification Steps
- `npm test` → exits 0; `download-path` suite passes alongside leg 1's `url-safety` suite.
- `grep -n "approvedDownloadDirs\|sanitizeFilename\|isWithinDir" src/main/main.js src/main/download-path.js` → Set wired in `choose-download-dir` + `download-media`; helpers imported from `download-path.js`.
- Read `uniquePath` to confirm the containment assertion runs on the final `candidate` after the loop.
- Read `download-media` to confirm the approved-Set check and `{ok:false}` rejection path.

## Implementation Guidance

1. **Create `src/main/download-path.js`** (pure, CommonJS)
   - `sanitizeFilename(name)`: `String(name)`, replace `/[\/\\:*?"<>|]/g` with `_` (preserve current behavior), strip leading dots (`replace(/^\.+/, '')`), collapse any residual `..`, trim, `.slice(0, 180)`; if the base (sans extension, uppercased) matches the reserved-name set, prefix it (e.g. `_CON`); return `'download'` if empty.
   - `isWithinDir(dir, candidate)`: `const r = path.resolve(candidate); return r === path.resolve(dir) ? false : r.startsWith(path.resolve(dir) + path.sep);` (a candidate equal to the dir itself is not a file within it).
   - `module.exports = { sanitizeFilename, isWithinDir };`

2. **Wire the approved-dir Set in `main.js`**
   - Module scope: `const approvedDownloadDirs = new Set();`
   - In `choose-download-dir`, when a path is chosen (not canceled): `approvedDownloadDirs.add(path.resolve(res.filePaths[0]));` before returning.
   - In `download-media`, **before** `pendingDownloads.set` and before `downloader.downloadURL(url)`: if `saveDir != null && !approvedDownloadDirs.has(path.resolve(saveDir))` → `return { ok: false, error: 'Download directory not approved.' };` (placing it first guarantees no orphaned `pendingDownloads` entry and that `will-download` never fires for the rejected URL).
   - Scope note: `approvedDownloadDirs` is module-scoped in main — it is **cumulative within a session** (multiple chosen dirs all remain approved; concurrent bulk runs to different dirs both pass) and survives a renderer reload, but resets on app restart. That matches the renderer flow (a fresh `choose-download-dir` precedes every bulk run), so it's the intended scope.

3. **Harden `uniquePath` in `main.js`**
   - Replace the inline `String(filename).replace(...)` with `sanitizeFilename(filename)` — this is the single choke point covering both filename sources (see AC).
   - After the dedup `while` loop, before returning `candidate`: if `!isWithinDir(dir, candidate)` → fall back to `path.join(dir, 'download')` with a `console.warn`. **Do not throw** — `uniquePath` is called synchronously inside `will-download` (`main.js:119`) where a throw would abort the download with no user feedback.

4. **Tests** — `test/unit/download-path.test.js` (node:test + node:assert, `require('../../src/main/download-path')`). Cover every AC bullet.

## Edge Cases
- **`saveDir` absent (single-file download)**: unchanged — `will-download` uses the save-dialog branch. The approved-Set check only applies when `saveDir` is present.
- **Restart**: approved-Set is empty on launch; but the renderer always re-runs `choose-download-dir` before a bulk run (recon), so a legitimate `saveDir` is always approved first. No false reject in normal use.
- **All-dots / empty / whitespace filename** → `'download'`.
- **Reserved name with extension** (`CON.txt`, `nul.jpg`): Windows reserves the basename regardless of extension — prefix it.
- **Trailing dots** (`NUL.`, `foo.`): Windows strips trailing dots, so `NUL.` resolves to the reserved `NUL` — strip trailing dots before/around the reserved-name check.
- **Dedup suffixes** (` (1)`, ` (2)`) must not break containment — assert after the loop, on the final value.
- **`saveDir` equal to a parent of an approved dir** must NOT pass — only an exact resolved match is approved.

## Files Affected
- `src/main/download-path.js` — new: pure `sanitizeFilename`, `isWithinDir`
- `src/main/main.js` — approved-dir Set; `download-media` rejection; `uniquePath` hardening
- `test/unit/download-path.test.js` — new: unit tests

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing (`npm test`)
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `completed` (in this file's header)
- [ ] Check off this leg in flight.md
- [ ] If final leg of flight: (N/A — leg 2 of 5)
- [ ] Commit handled at flight end (deferred per agentic-workflow single-commit model)
