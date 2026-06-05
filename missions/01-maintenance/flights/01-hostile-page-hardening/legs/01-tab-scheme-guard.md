# Leg: tab-scheme-guard

**Status**: completed
**Flight**: [Harden the Hostile-Page Security Boundary](../flight.md)

## Objective
Introduce a single `isSafeTabUrl()` scheme-allowlist predicate and enforce it at both points a hostile page can drive a `<webview>` — the renderer `createTab` gate and a new main-process `will-navigate` guard — backed by a `node --test` unit suite for the predicate.

## Context
- Flight DD "F1 guard — TWO enforcement points sharing one predicate": allowlist `http:`/`https:`/`about:blank`; reject everything else. `createTab` (`renderer.js:106`) covers `window.open` (via `onOpenTab`) and media-open (`renderer.js:428`); the main `will-navigate` guard covers in-page self-navigation (`window.location='file://…'`), which `createTab` cannot see.
- Flight DD "Shared dual-export module": renderer runs `nodeIntegration:false` (`main.js:26`) so it cannot `require()` — the helper is loaded as a `<script>` global there; `main.js` (CommonJS) and the test runner `require()` it. One source of truth.
- This is the first leg: it also bootstraps the `node --test` runner that legs 2 and 5 reuse.

## Inputs
- `src/main/main.js` — `web-contents-created` webview branch (`:54-63`, where `setWindowOpenHandler` is already attached on the guest `contents`); `nodeIntegration:false` on the chrome window (`:23-30`).
- `src/renderer/renderer.js` — `createTab(url, container)` (`:106-138`), called from 6 sites incl. `onOpenTab` (`:1083`) and media-open `popout` (`:428`).
- `src/renderer/index.html` — loads `renderer.js` via a `<script>` tag (verify it is a classic script, not `type="module"`).
- `package.json` — no `test` script, no test tooling (confirmed).

## Outputs
- `src/shared/url-safety.js` (new) — `isSafeTabUrl(url)` with dual export (CommonJS `module.exports` + `globalThis`/`window` global).
- `src/renderer/index.html` — `<script src="../shared/url-safety.js"></script>` included **before** `renderer.js`.
- `src/renderer/renderer.js` — `createTab` rejects unsafe URLs before `webview.setAttribute('src', …)`.
- `src/main/main.js` — `require`s the helper; adds `contents.on('will-navigate', …)` in the webview branch.
- `package.json` — `"test": "node --test"` (and `"test:watch"` optional).
- `test/unit/url-safety.test.js` (new) — unit tests for `isSafeTabUrl`.

## Acceptance Criteria
- [ ] `isSafeTabUrl(url)` returns **true** only for `http:`, `https:`, and `about:blank`; returns **false** for `file:`, `data:`, `javascript:`, `blob:`, `chrome:`, empty string, non-string input, and malformed URLs. Scheme matching is case-insensitive (`FILE://` rejected, `ABOUT:BLANK`/`About:Blank` **allowed**) and tolerant of leading/trailing whitespace. Note: the WHATWG `URL` parser does **not** lowercase the `about:` pathname, so the allow-check must be `parsed.href.toLowerCase() === 'about:blank'` (or `protocol === 'about:' && pathname.toLowerCase() === 'blank'`), not a raw `=== 'about:blank'`.
- [ ] `createTab` (`renderer.js`) does not call `setAttribute('src', url)` (nor otherwise load) when `isSafeTabUrl(url)` is false; unsafe URLs result in no navigation (silent drop — no toast required this leg) — a blocked `window.open`/media-open never loads the dangerous URL.
- [ ] `main.js` registers a handler on the **`will-navigate`** event (NOT `did-start-navigation`, which cannot be cancelled) of each webview guest `contents`, calling `e.preventDefault()` when `isSafeTabUrl(url)` is false, leaving the webview on its current page. The guard covers `file:`/`data:`/`javascript:` arriving via in-page `window.location` (all rejected by the shared predicate).
- [ ] Both `main.js` and `renderer.js` use the **same** `src/shared/url-safety.js` predicate (no duplicated/inlined scheme logic).
- [ ] `npm test` runs `node --test` and passes; the suite covers every allow/reject case above.
- [ ] Legitimate navigation is unaffected: `http(s)` `window.open`, media-open of an `http(s)` URL, and normal in-page link navigation to `http(s)` still work (reasoned/verified; full behavior coverage is the draft `tab-scheme-guard` spec, run later).

## Verification Steps
- `npm test` → exits 0; test output shows the allow/reject cases passing.
- `grep -n "isSafeTabUrl" src/main/main.js src/renderer/renderer.js src/shared/url-safety.js` → predicate defined once in `shared/`, imported in both.
- `grep -n "will-navigate" src/main/main.js` → handler present in the webview branch.
- Read `createTab` to confirm the guard precedes `setAttribute('src', …)`.
- Confirm `index.html` includes `url-safety.js` before `renderer.js`.

## Implementation Guidance

1. **Create `src/shared/url-safety.js`**
   - Export a pure `isSafeTabUrl(url)`: coerce to string, trim, reject non-strings/empties; parse scheme robustly. Allow exactly `http:`, `https:`, and the literal `about:blank`. Reject all else.
   - Prefer the WHATWG `URL` parser where available for scheme extraction, but guard against throws (malformed input → reject). For `about:blank`, compare `parsed.href.toLowerCase() === 'about:blank'` — the parser does NOT lowercase the `about:` pathname (`new URL('ABOUT:BLANK').href` → `'about:BLANK'`), so a raw `=== 'about:blank'` would wrongly reject `ABOUT:BLANK`.
   - Dual export: `if (typeof module !== 'undefined' && module.exports) { module.exports = { isSafeTabUrl }; }` and also `(typeof globalThis !== 'undefined' ? globalThis : window).isSafeTabUrl = isSafeTabUrl;` so the renderer gets a global.

2. **Wire the renderer** (`index.html` + `renderer.js`)
   - Add `<script src="../shared/url-safety.js"></script>` immediately before the `renderer.js` `<script>` (path relative to `src/renderer/index.html` → `../shared/url-safety.js`).
   - Place the guard at the **top of `createTab`**, as the first statement (before `++tabSeq` and any DOM creation): `if (!isSafeTabUrl(url)) return null;`. This avoids a `tabSeq` gap and orphaned nodes. Verified safe: none of the 9 `createTab` call sites use the return value, and `closeTab`'s zero-tabs guard calls `createTab()` (defaults to `HOMEPAGE`, which is `http(s)` and passes). Silent drop — no toast this leg.

3. **Wire main** (`main.js`)
   - `const { isSafeTabUrl } = require('../shared/url-safety');` (path relative to `src/main/main.js`).
   - In the `web-contents-created` webview branch (`:54-63`), alongside `setWindowOpenHandler`, add: `contents.on('will-navigate', (e, url) => { if (!isSafeTabUrl(url)) e.preventDefault(); });`

4. **Bootstrap the test runner**
   - Add `"test": "node --test"` to `package.json` scripts. (Do not add an `engines` field — that is Flight 2's scope; `node --test` is available on the project's Node 20/22.)
   - Create `test/unit/url-safety.test.js` using `node:test` + `node:assert`, requiring `../../src/shared/url-safety` (two levels up from `test/unit/`). Cover all allow/reject cases incl. `ABOUT:BLANK`/`About:Blank` (allowed), case-insensitive scheme rejection (`FILE://`), whitespace, non-string, null/undefined, and malformed input. `node --test` (no args) auto-discovers `test/unit/url-safety.test.js`.

## Edge Cases
- **`about:blank`** must be allowed (used as a benign blank tab); other `about:` URLs (e.g. `about:config`-style) rejected.
- **Case / whitespace**: `FILE://`, `  javascript:…`, `Http://` — normalize before matching. `ABOUT:BLANK`/`About:Blank` must be **allowed** (compare lowercased `href`).
- **Protocol-relative `//host/path`**: not an absolute URL; `toUrl` normally upgrades these for the address bar, but `createTab` may receive one — treat as unsafe (reject) since it has no explicit safe scheme.
- **Non-string / undefined / null**: reject without throwing.
- **`HOMEPAGE` default**: confirm it is `http(s)` so the no-arg `createTab()` path (new-tab button, keyboard) still works.
- **Drop UX**: a blocked media-open should leave the existing inline panel preview usable (no functional regression for the user).

## Files Affected
- `src/shared/url-safety.js` — new: `isSafeTabUrl` (dual export)
- `src/renderer/index.html` — add `<script>` include before `renderer.js`
- `src/renderer/renderer.js` — guard in `createTab`
- `src/main/main.js` — `require` helper + `will-navigate` guard
- `package.json` — add `test` script
- `test/unit/url-safety.test.js` — new: predicate unit tests

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing (`npm test`)
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `completed` (in this file's header)
- [ ] Check off this leg in flight.md
- [ ] If final leg of flight: (N/A — leg 1 of 5)
- [ ] Commit handled at flight end (deferred per agentic-workflow single-commit model)
