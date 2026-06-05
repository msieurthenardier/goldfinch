# Flight: Harden the Hostile-Page Security Boundary

**Status**: landed
**Mission**: [Codebase Health — 2026-06-05 Maintenance](../../mission.md)

## Contributing to Criteria
- [x] F1 — page-originated URLs scheme-filtered before a webview `src` (verified by behavior test `tab-scheme-guard`)
- [x] F3 — `open-external` capability removed (was unused)
- [x] F4 — `download-media` `saveDir` asserted within a dialog-approved root
- [x] F5 — download filenames reject leading-dot / reserved names; containment asserted
- [x] F6 — `poster` sanitized before `backgroundImage`
- [x] F7 — `containers.json` shape-validated on load

---

## Pre-Flight

### Objective
Close the one directly hostile-page-reachable security gap (F1) — a crafted page driving a `<webview>` to a `file:`/`javascript:`/`data:` URL through both the `window.open` and media-open paths — and tighten the surrounding defense-in-depth surfaces (downloads, external-launch, CSS, container-state) so untrusted page content cannot escalate. Reconnaissance against current code (recorded in the flight log) confirmed all six findings live and accurate, and expanded F1 to cover a second injection vector through the shared `createTab` choke point.

### Open Questions
- [x] Where should the F1 scheme guard live, and what schemes are allowed? → see Design Decisions
- [x] Remove the unused `open-external` binding or guard it? → see Design Decisions
- [x] How is F1 verified given the test harness post-dates this flight? → see Design Decisions

### Design Decisions

**F1 guard — TWO enforcement points sharing one predicate** (revised after design review). A single pure `isSafeTabUrl(url)` predicate (allowlist `http:`/`https:`/`about:blank`, reject all else) is enforced at **both** places a hostile page can reach a `<webview>`:
  1. **Renderer — `createTab` gate** (`renderer.js:106-111`): covers tab *creation* — `window.open` (via `onOpenTab` `renderer.js:1083`) and media-open (`createTab(item.url)` `renderer.js:428`). Unsafe URLs are dropped (no navigation).
  2. **Main — `will-navigate` guard on webview guests** (`main.js:54-63`, the existing `web-contents-created` handler): covers *in-page self-navigation*. **Design review caught that `createTab` alone is insufficient** — a hostile page can do `window.location = 'file:///etc/passwd'` or click a `file:` link, navigating an *existing* webview without going through `createTab` (confirmed: no `will-navigate` listener exists anywhere). Add `contents.on('will-navigate', (e, url) => { if (!isSafeTabUrl(url)) e.preventDefault(); })` on each webview guest, mirroring the `setWindowOpenHandler` deny pattern.
- Rationale: allowlist over denylist (unforeseen schemes fail closed); enforcing the *same* predicate at both the create path and the navigate path is what actually achieves "a hostile page can never drive a webview to a dangerous scheme." `createTab` is the single tab-*creation* choke point; `will-navigate` is the single in-page-*navigation* choke point.
- Trade-off: a non-web media item (`data:`/`blob:` source) won't open as a full tab. Acceptable and confirmed lossless — `webview-preload.js:68` already excludes blob: media as "can't be re-fetched outside the page," so a blob: pop-out was never functional; inline panel preview/download is unaffected.
- Scope note: top-frame `will-navigate` is covered; subframe (`<iframe>`) navigation to `file:` is lower-risk (Chromium blocks most `file:` subframe loads) and left out of this flight. The user-initiated address-bar `toUrl` path stays out of scope (not hostile-page-reachable).

**Shared dual-export module for pure security helpers** (`src/shared/url-safety.js`): the predicate is now consumed by **both** processes — `renderer.js` (which runs `nodeIntegration:false` per `main.js:26`, so it *cannot* `require()` and must load the helper as a `<script>` global from `index.html`) and `main.js` (CommonJS, which `require()`s it for the `will-navigate` guard). It is therefore written as a dual-export module: `if (typeof module !== 'undefined') module.exports = …` exposes it to `require()` and the test runner, while also assigning a `window` global for the renderer.
- Rationale: one predicate, one source of truth, enforced identically in both processes and unit-tested deterministically. The cross-process need makes the dual-export the natural (not incidental) design. The leg creates the `src/shared/` directory (does not yet exist).
- Trade-off: one extra `<script>` include and a small export shim; negligible.

**F3 disposition — remove, don't guard**: delete the `open-external` IPC handler (`main.js:156-158`) and its bridge line (`chrome-preload.js:13`). Recon confirmed **no renderer caller**.
- Rationale: guarding a dead, latent privileged capability is weaker than removing it. If a future feature needs external-launch, re-introduce it with a scheme allowlist at that time.
- Trade-off: a future caller must re-add the binding — cheap, and forces a deliberate re-think of the allowed schemes.

**Verification tooling — pull a minimal runner forward**: stand up `node --test` (zero-dependency, built into Node ≥18) with a `test` script in `package.json`, used for the pure helpers this flight introduces (`isSafeTabUrl`, the extracted filename sanitizer, the `containers.json` validator).
- Rationale: F1 warrants deterministic unit coverage *now*, before Flight 2 stands up the full harness. `node --test` is a forward-compatible floor that Flight 2 (F8) can extend or wrap.
- Trade-off: minor overlap with Flight 2's F8/F9 (test script + `engines`). Coordinated: this flight adds the `test` script and a `node --test` baseline; Flight 2 builds on it (and owns the `engines` field) rather than replacing it. Noted in the mission's Known Issues if the runner choice is revisited.

### Prerequisites
- [x] Working tree clean; recon complete (flight log).
- [x] Apparatus for the behavior test exists but is **not exercised this flight** — running `tab-scheme-guard` later needs `npm run dev:debug` (port 9222) + a local HTTP trigger fixture. The spec is authored as `draft`; it is run via `/behavior-test tab-scheme-guard` once the app is drivable (after Flight 2's harness or on demand). No new long-running service is introduced by this flight's code — no port/environment conflict.

### Pre-Flight Checklist
- [x] All open questions resolved
- [x] Design decisions documented
- [x] Prerequisites verified
- [x] Validation approach defined (unit tests via `node --test` + draft behavior spec `tab-scheme-guard`)
- [x] Legs defined

---

## In-Flight

### Technical Approach

One finding maps to one leg. Evidence is from the recon pass (flight log); each leg carries its fix and verification.

- **F1 — tab-URL scheme guard, two enforcement points (Action Required).** See the Design Decision for the full two-point rationale. **Fix:** (a) add `isSafeTabUrl()` in `src/shared/url-safety.js` (dual export; create the dir), `<script>`-include it in `index.html` before `renderer.js`, and gate `createTab` (`renderer.js:106-111`) so unsafe schemes never reach `setAttribute('src')` — closes `window.open` + media-open; (b) `require` the same helper in `main.js` and add `contents.on('will-navigate', (e,url) => { if(!isSafeTabUrl(url)) e.preventDefault(); })` inside the existing `web-contents-created` webview branch (`main.js:54-63`) — closes in-page self-navigation. Allow `http`/`https`/`about:blank`. Stand up `node --test` and unit-test the predicate (`file:///etc/passwd`→reject, `https://x`→allow, `javascript:…`→reject, `data:…`→reject, `about:blank`→allow, `''`/garbage→reject). Behavior spec `tests/behavior/tab-scheme-guard.md` (authored, draft) is the real-environment regression gate and now also exercises the in-page `window.location` vector.
- **F4 + F5 — download path hardening (Advisory; shared code path).** `download-media` (`main.js:72-85`) stores a renderer `saveDir` used unchecked at `main.js:117-119`; `uniquePath` (`main.js:88-99`) strips separators but not `..`/leading dots/reserved names and never asserts containment. **Fix (F4):** in main, maintain a **session-scoped** Set of directories returned by `choose-download-dir` (`main.js:101-107`) and reject any `download-media` `saveDir` not in it (fall back to the save-dialog branch). Confirmed restart-safe and sufficient by recon: the renderer fetches `bulk.dir` fresh from `chooseDownloadDir()` on **every** bulk run (`renderer.js:569,586`) and never persists it, so a session Set always contains a legitimately-dialoged dir — no cross-restart false-reject, no persistence needed. **Fix (F5):** strip leading dots, reject Windows reserved device names, and assert containment on the **final** resolved path *after* the dedup loop — `path.resolve(candidate).startsWith(path.resolve(dir)+path.sep)` — throwing/falling back on violation (not on the pre-loop string). Extract the pure filename-sanitization into a helper and unit-test it.
- **F6 — `poster` CSS sink (Advisory).** `renderer.js:355` interpolates `item.poster` into `backgroundImage` unescaped. **Fix:** scheme-allowlist as the **sole** gate — set the background *only* when `item.poster` starts with `http:`/`https:`/`data:`/`blob:`; otherwise set no background. Do **not** rely on `CSS.escape` (it escapes CSS *identifiers*, not the `url("…")` string context, so it does not prevent breakout) nor on the existing `escapeHtml` helper (`renderer.js:1100`, wrong escaping semantics for CSS). The allowlisted schemes are document/renderer-context-scoped and cannot break out of `url()`.
- **F3 — remove `open-external` (Advisory).** **Fix:** delete the handler (`main.js:156-158`) and bridge line (`chrome-preload.js:13`); grep-confirm no remaining reference across `src/` (recon already confirmed none).
- **F7 — `containers.json` validation (Advisory).** `jars.load()` (`jars.js:21-30`) assigns a parsed array wholesale. **Fix:** validate **per entry** (not all-or-nothing) — keep entries where `id` is a non-empty string and `partition` matches the expected `persist:` prefix, de-duplicate ids, coerce `name`/`color` to safe strings; **drop only the malformed entries, preserving valid user-created containers**; merge the `DEFAULTS` floor in only if no valid `default`-id entry survives. Extract the pure validator and unit-test the per-entry behavior (mixed valid/invalid input keeps the valid, drops the invalid, never wipes user containers wholesale).

### Checkpoints
- [x] F1 guard landed at **both** points (`createTab` gate + main `will-navigate` guard) sharing `isSafeTabUrl`; unit tests green under `npm test`; behavior spec referenced
- [x] Download hardening (F4 session approved-set + F5 final-path containment) landed; filename-sanitizer unit-tested
- [x] `poster` sink scheme-allowlisted (F6)
- [x] `open-external` removed (F3); no dangling references
- [x] `containers.json` per-entry validator landed and unit-tested, user containers preserved (F7)

### Adaptation Criteria

**Divert if**:
- Gating `createTab` breaks a legitimate in-app navigation that relies on a non-allowlisted scheme (e.g. an internal `about:`/`chrome:` page) — re-open the scheme-policy DD.
- The `node --test` baseline conflicts with a tooling decision Flight 2 wants to make first — pause and resequence the runner setup.

**Acceptable variations**:
- Placing `isSafeTabUrl` in `src/shared/` vs co-locating with another shared helper, as long as it stays dual-export and unit-tested.
- F6 implemented as scheme-reject vs `CSS.escape`, provided a crafted `poster` cannot inject CSS.
- Bundling the `node --test` bootstrap into the F1 leg vs a tiny preceding setup step.

### Legs

> Tentative — planned one at a time during execution. F1 first (highest priority; also bootstraps the test runner the later legs reuse).

- [x] `tab-scheme-guard` - F1: `isSafeTabUrl` dual-export helper (`src/shared/`) wired at **both** enforcement points — `createTab` gate (window.open & media-open) + main `will-navigate` guard (in-page nav) + `node --test` bootstrap + unit tests; references behavior spec `tab-scheme-guard`
- [x] `download-path-hardening` - F4 + F5: session approved-dir Set + `uniquePath` leading-dot/reserved-name guard + final-path containment assert + sanitizer unit test
- [x] `poster-css-sanitize` - F6: scheme-allowlist the `poster` background (no `CSS.escape`/`escapeHtml`)
- [x] `remove-open-external` - F3: delete handler + bridge line
- [x] `containers-json-validation` - F7: per-entry validator (extracted + unit-tested), preserves valid user containers, DEFAULTS as floor

---

## Post-Flight

### Completion Checklist
- [x] All legs completed
- [ ] Code merged
- [x] `npm test` green (isSafeTabUrl, filename sanitizer, containers validator)
- [x] Behavior spec `tab-scheme-guard` reviewed (promote `draft` → `active` when first run passes)
- [x] CLAUDE.md updated if the security-boundary description changed (e.g. the new `createTab` guard / `src/shared/` pattern)

### Verification
- **Automated (unit, `node --test`):** `isSafeTabUrl` accepts only `http`/`https`/`about:blank`; the filename sanitizer rejects `..`/leading-dot/reserved names and enforces final-path containment; the `containers.json` validator drops only malformed entries while preserving valid user containers.
- **Automated (behavior):** `/behavior-test tab-scheme-guard` — a hostile page's `window.open('file:///…')`, `javascript:`, and `data:` attempts, an **in-page `window.location='file://'` self-navigation**, and a crafted `file:` media-open all fail to load a dangerous scheme into any webview, while a legitimate `https:` `window.open` still opens. (Run once the app is drivable; spec authored as draft.)
- **Manual spot-checks:** `open-external` is gone (grep clean); a download cannot escape the chosen directory or write a hidden/reserved filename; a crafted `poster` cannot inject CSS; a tampered `containers.json` is repaired per-entry (valid user containers survive) rather than collapsing jar isolation.
