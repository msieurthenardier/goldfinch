# Flight Log: Harden the Hostile-Page Security Boundary

**Flight**: [Harden the Hostile-Page Security Boundary](flight.md)

## Summary
In flight (execution started 2026-06-05). Design complete and Architect-approved; reconnaissance confirmed all six findings live (F1 scope-expanded to two enforcement points).

---

## Flight Director Notes

- **Phase 1 setup** — Loaded crew (`leg-execution.md`, valid), mission, flight, behavior spec. Node v22 (supports `node --test`). Crew: Developer + Reviewer (both Sonnet); Accessibility Reviewer disabled (this flight touches security code, not UI — the renderer `createTab`/poster edits are non-visual). Will spawn the Accessibility Reviewer only if a leg turns out to touch user-facing UI.
- **Git decision** — Branched `flight/01-hostile-page-hardening` off `main` (global "branch first" rule). Baseline-committing the planning artifacts (maintenance report, full mission scaffold, behavior spec) + the mission→active / flight→in-flight transitions, so leg implementation accumulates on a clean tree. Per this skill, code review + commit are deferred to a single pass after the last autonomous leg.
- **Mission activated** — `01-maintenance` `planning → active`; flight `ready → in-flight`.
- **Leg order** — F1 first (`tab-scheme-guard`): highest priority and it bootstraps the `node --test` runner the later legs reuse. Then download-path-hardening, poster-css-sanitize, remove-open-external, containers-json-validation. All five are autonomous (no HAT leg).

---

## Reconnaissance Report

Source artifact: [maintenance/2026-06-05.md](../../../../maintenance/2026-06-05.md). Each cited finding walked against current `src/` (HEAD on `main` at design time).

| Item | Classification | Evidence (current code) | Recommendation |
|------|----------------|-------------------------|----------------|
| F1 — `open-tab` scheme bypass | **confirmed-live** | `main.js:58-61` `setWindowOpenHandler(({url})=>send('open-tab',url))` → `chrome-preload.js:36` `onOpenTab` → `renderer.js:1083` → `createTab` `renderer.js:106-111` `webview.setAttribute('src', url)`. No scheme guard at any hop. | Fix — **expanded scope, see note below**. |
| F3 — `open-external` unconstrained | **confirmed-live** | `main.js:156-158` `shell.openExternal(url)` (only `if(url)`); bridged `chrome-preload.js:13`. `grep openExternal src/renderer/renderer.js` → **no caller** (confirmed unused). | Fix — recommend **removing** the unused binding (handler + bridge line) rather than allowlisting a dead capability. |
| F4 — `saveDir` not containment-checked | **confirmed-live** | `main.js:72,77` stores renderer `saveDir`; `main.js:117-119` `item.setSavePath(uniquePath(meta.saveDir, suggested))`. Sole legit source is the native dialog `choose-download-dir` `main.js:101-107`. | Fix — defense-in-depth; bundle with F5 (same handler/`uniquePath`). |
| F5 — filename traversal residue | **confirmed-live** | `main.js:88-99` `uniquePath`: `replace(/[\/\\:*?"<>\|]/g,'_').slice(0,180)` — no `..`/leading-dot/reserved-name guard, no `path.resolve` containment. | Fix — bundle with F4. |
| F6 — `poster` CSS sink | **confirmed-live** | `renderer.js:355` `thumb.style.backgroundImage = \`url("${item.poster}")\`` — unescaped, unlike sibling sinks. | Fix as cited. |
| F7 — `containers.json` no shape validation | **confirmed-live** | `jars.js:21-30` `if (Array.isArray(saved) && saved.length) containers = saved;` — wholesale assign, no per-field validation. | Fix as cited. |

**No items retired** — all six are real work; line citations are accurate.

### Recon discovery — F1 scope expansion
`createTab(url)` (`renderer.js:106`) is the single choke point for **all** tab creation, called from 6 sites. Two pass *untrusted* URLs into the webview `src`:
1. `onOpenTab` (`renderer.js:1083`) — the page-supplied `window.open()` URL (the cited F1 path), and
2. **media-open** (`renderer.js:428`) `createTab(item.url)` — a **page-derived media URL** opened as a full tab. This is a *second* hostile-URL injection vector through the same sink that the source finding did not enumerate.

Implication: the scheme guard belongs in `createTab` (covers both vectors + any future caller), not only in `setWindowOpenHandler`. The address-bar path `toUrl` (`renderer.js:249-255`) is user-initiated and passes `scheme://` through verbatim — lower priority, but a shared helper can cover it too.

---

## Design Review (Phase 5b)

**Cycle 1 — Architect (Sonnet): approve with changes.** All six findings verified live; citations accurate. Issues incorporated into the spec:
- **[high] F1 in-page navigation gap** — gating `createTab` alone misses `window.location='file://'` self-navigation (no `will-navigate` listener exists). **Fix added:** main-process `will-navigate` guard on webview guests sharing the same `isSafeTabUrl`. Strengthened the dual-export DD (helper now used by main + renderer). Behavior spec gained an in-page-nav step.
- **[high] F4 approved-set restart concern** — investigated: renderer fetches `bulk.dir` fresh per bulk run (`renderer.js:569,586`), never persisted, so a **session-scoped** Set is sufficient and restart-safe. Documented in the F4 DD; no persistence added.
- **[med] F5 containment placement** — clarified: assert on the **final** resolved path after the dedup loop, not the pre-loop string.
- **[med] F6 CSS.escape insufficient** — corrected: scheme-allowlist is the **sole** gate; `CSS.escape`/`escapeHtml` explicitly rejected (wrong semantics for `url()` context).
- **[low] F7 data loss** — corrected: **per-entry** validation preserving valid user containers; DEFAULTS merged only as a floor.
- Suggestions folded in: create `src/shared/` dir; `blob:` trade-off confirmed lossless via `webview-preload.js:68`; engines ≥18 assumption noted (owned by Flight 2).

**Cycle 2 — Architect (Sonnet): APPROVE.** All five prior issues confirmed resolved against real code (`will-navigate` is preventable on the guest contents in hand at `main.js:58`; no fourth vector — Chromium blocks 3xx→`file:` redirects). One new low nit (behavior Step 5 lacked a positive anchor) — fixed inline. Flight is execution-ready.

---

## Leg Progress

### tab-scheme-guard — landed (2026-06-05)

**Status**: landed

**Changes made:**
- `src/shared/url-safety.js` (new) — `isSafeTabUrl(url)` pure predicate with WHATWG URL parser; allows `http:`, `https:`, `about:blank` (case-insensitive via `href.toLowerCase()`); dual-export (CommonJS `module.exports` + `globalThis` global).
- `src/renderer/index.html` — added `<script src="../shared/url-safety.js"></script>` immediately before `renderer.js` script tag.
- `src/renderer/renderer.js` — added `if (!isSafeTabUrl(url)) return null;` as first statement of `createTab` (before `++tabSeq` and DOM creation), covering all 9 call sites including `onOpenTab` and media-open.
- `src/main/main.js` — added `require('../shared/url-safety')` import; added `contents.on('will-navigate', (e, url) => { if (!isSafeTabUrl(url)) e.preventDefault(); })` in the `web-contents-created` webview branch alongside existing `setWindowOpenHandler`.
- `package.json` — added `"test": "node --test"` to scripts (no `engines` field added — deferred to Flight 2 scope).
- `test/unit/url-safety.test.js` (new) — 26 test cases covering all allow/reject cases: `http:`, `https:`, `about:blank`/`ABOUT:BLANK`/`About:Blank`, whitespace-padded safe URLs, `file:`/`FILE:`, `data:`, `javascript:`, `blob:`, `chrome:`, `about:config`, empty/whitespace, null, undefined, number, object, array, malformed, protocol-relative.

**Test result**: `npm test` → 26 pass, 0 fail, exit 0.

**Notes/deviations**: None. Implementation follows the leg spec exactly. The `about:blank` case-insensitivity is handled by `parsed.href.toLowerCase() === 'about:blank'` as specified (WHATWG parser does not normalize the `about:` pathname case). The `closeTab` zero-tabs fallback `createTab()` defaults to `HOMEPAGE` (http/https), so the guard is safe there too.

### download-path-hardening — landed (2026-06-05)

**Status**: landed

**Changes made:**
- `src/main/download-path.js` (new) — pure CommonJS helpers: `sanitizeFilename(name)` (strips path separators, leading/trailing dots, `..`, prefixes Windows reserved device names with `_`, caps at 180 chars, falls back to `'download'`); `isWithinDir(dir, candidate)` (strict containment check using `path.resolve` + `path.sep`, rejects equal-to-dir and sibling-prefix paths).
- `src/main/main.js` — added `require('./download-path')` import; added module-scoped `const approvedDownloadDirs = new Set()`; `choose-download-dir` now calls `approvedDownloadDirs.add(path.resolve(chosen))` before returning the chosen path; `download-media` rejects with `{ ok: false, error: 'Download directory not approved.' }` before `pendingDownloads.set` when `saveDir != null && !approvedDownloadDirs.has(path.resolve(saveDir))`; `uniquePath` uses `sanitizeFilename(filename)` as the single choke point and asserts `isWithinDir(dir, candidate)` after the dedup loop, falling back to `path.join(dir, 'download')` with a `console.warn` on violation.
- `test/unit/download-path.test.js` (new) — 29 test cases covering: path separator stripping, traversal (`../../etc/passwd`), leading-dot (`.bashrc`), trailing-dot (`NUL.`), reserved names (`CON`, `con`, `con.txt`, `LPT1`, `NUL`, `PRN`), trailing-dot reserved (`NUL.`→`_NUL`), empty/all-dots/whitespace, null/undefined, very long name, normal filename, falsy suggestedName, `isWithinDir` containment (accept file in dir, reject dir itself, reject parent, reject sibling prefix `/foo/bar` vs `/foo/bar-evil`, reject traversal, accept nested), and dedup suffix staying within dir.

**Test result**: `npm test` → 55 pass (29 new download-path + 26 url-safety), 0 fail, exit 0.

**Notes/deviations**: None. Implementation follows the leg spec exactly. The `approvedDownloadDirs` check fires before both `pendingDownloads.set` and `downloader.downloadURL(url)`, ensuring no orphaned map entries and that `will-download` never fires for a rejected URL. The `uniquePath` containment check is post-loop as specified — dedup suffixes are covered.

---

### poster-css-sanitize — landed (2026-06-05)

**Status**: landed

**Changes made:**
- `src/shared/url-safety.js` — added `isSafePosterUrl(url)`: allows `http:`/`https:`/`blob:` only (data: dropped after design review — opaque `data:` paths can carry literal `"`/`)` past `new URL()` and break out of `url("…")`), and additionally rejects any value whose normalized `href` contains `"` or `)` (belt-and-suspenders). Dual-exported (`module.exports` + `globalThis.isSafePosterUrl`).
- `src/renderer/renderer.js` — gated the poster CSS sink (`:356`): `backgroundImage` is set only when `isSafePosterUrl(item.poster)` is true; the `'none'` reset (constant) left untouched.
- `test/unit/url-safety.test.js` — extended with 23 `isSafePosterUrl` cases (allow http/https/blob incl. uppercase; reject data:, data:/http: with injected quotes, javascript/file/vbscript, empty/non-string/null/malformed).

**Test result**: part of the integrated suite — **96 pass, 0 fail** (verified by Flight Director after all parallel legs).

**Notes/deviations**: Design review (Sonnet) caught a HIGH issue — scheme-allowlist alone is insufficient for `data:`; incorporated by dropping `data:` and adding the `"`/`)` reject. Implemented in parallel with legs 4 & 5 (disjoint files). Out-of-scope note: image-type `img.src = item.url` (`renderer.js:351`) is an `<img src>`, not a CSS sink — flagged for a possible future leg.

---

### remove-open-external — landed (2026-06-05)

**Status**: landed

**Changes made:**
- `src/main/main.js` — deleted the `ipcMain.handle('open-external', …)` block (the unconstrained `shell.openExternal`). `shell` import retained (still used by `show-item-in-folder`).
- `src/preload/chrome-preload.js` — deleted the `openExternal` contextBridge line. Object literal remains valid.

**Test result**: no test impact; `grep -rn "open-external\|openExternal" src/` → **zero matches** (verified by Flight Director).

**Notes/deviations**: None. Design review confirmed no caller anywhere in the repo. Implemented in parallel with legs 3 & 5.

---

### containers-json-validation — landed (2026-06-05)

**Status**: landed

**Changes made:**
- `src/main/jars.js` — added pure exported `validateContainers(saved)`: drops non-object/bad-id/bad-partition entries; reserves `persist:goldfinch` for `default`; de-dupes by BOTH `id` and `partition` (two Sets, first wins) — the partition-dedup is the key isolation guarantee; rebuilds objects field-by-field (no spread → no `__proto__`/key leakage); caps `name` at 24 chars; prepends a cloned `default` floor if none survives. `load()` routes the parsed array through it (`[]` sentinel → keep DEFAULTS); try/catch→DEFAULTS preserved.
- `test/unit/jars.test.js` (new) — 31 cases incl. the critical "two distinct ids sharing one partition → only first kept" and "non-default entry aliasing `persist:goldfinch` dropped".

**Test result**: part of the integrated suite — **96 pass, 0 fail**.

**Notes/deviations**: Design review (Sonnet) caught a HIGH issue — id-dedup alone does NOT prevent partition collisions (the actual isolation break F7 targets); incorporated a partition-uniqueness pass + `persist:goldfinch` reservation. Minor test-expectation correction: `String(undefined)` → `'undefined'` (non-empty), so the `'Jar'` fallback fires only on empty-string names (matches existing `add()` semantics) — implementation unchanged. Implemented in parallel with legs 3 & 4.

---

### Flight Director — all legs landed

All 5 autonomous legs implemented and uncommitted. Integrated `npm test` → **96 pass, 0 fail**. Legs 3–5 ran concurrently (disjoint file sets; flight-log/flight.md writes reserved to the Flight Director to avoid races). Proceeding to Phase 2d: single flight-level code review over all uncommitted changes, then commit + PR.

---

## Decisions

---

## Deviations

---

## Anomalies

---

## Session Notes
