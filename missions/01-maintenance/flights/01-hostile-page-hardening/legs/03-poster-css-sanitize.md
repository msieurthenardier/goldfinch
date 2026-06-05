# Leg: poster-css-sanitize

**Status**: completed
**Flight**: [Harden the Hostile-Page Security Boundary](../flight.md)

## Objective
Close the CSS-injection sink at `renderer.js:355` by scheme-allowlisting an untrusted video `poster` URL before it is interpolated into a `backgroundImage: url("…")` value — the one media sink not run through safe encoding.

## Context
- Flight DD/technical approach F6. `renderer.js:355`: `if (item.poster) thumb.style.backgroundImage = \`url("${item.poster}")\`;`. `item.poster` is page-derived (`webview-preload.js:113`, via `absUrl()`/`new URL()`). Although `new URL()` normalization mitigates classic breakout, the value is attacker-influenced and this is the only sink not protected by `escapeHtml`.
- Decision (from flight): **scheme-allowlist is the sole gate** — `CSS.escape` escapes CSS *identifiers*, not the `url("…")` string context, and `escapeHtml` has the wrong semantics for CSS; neither is used.
- Reuse the shared module from leg 1: add a sibling predicate `isSafePosterUrl(url)` to `src/shared/url-safety.js` (dual export, unit-testable), keeping one home for URL-safety logic.
- Prerequisite: leg 1 created `src/shared/url-safety.js` and the `node --test` runner.

## Inputs
- `src/renderer/renderer.js` — the poster sink at `:355` (within the media-card render path).
- `src/preload/webview-preload.js:113` — poster origin (for understanding; not modified).
- `src/shared/url-safety.js` — existing dual-export module (from leg 1).
- `test/unit/url-safety.test.js` — existing suite (from leg 1) to extend.

## Outputs
- `src/shared/url-safety.js` — add `isSafePosterUrl(url)` (allow `http:`/`https:`/`blob:` only — `data:` dropped, see AC; also reject values containing `"`/`)`; same robust parse + dual export as `isSafeTabUrl`).
- `src/renderer/renderer.js` — set `backgroundImage` only when `isSafePosterUrl(item.poster)` is true.
- `test/unit/url-safety.test.js` — add cases for `isSafePosterUrl`.

## Acceptance Criteria
- [ ] `isSafePosterUrl(url)` returns **true** only when **both** hold: (a) the scheme is `http:`, `https:`, or `blob:` (case-insensitive); **and** (b) the normalized `href` contains **no** `"` or `)` characters. Returns **false** for `javascript:`, `file:`, `vbscript:`, `data:` (dropped — see below), empty/non-string/malformed, and any breakout payload (e.g. `") ; background: red; ("`, or a crafted `data:`/`blob:` value carrying `"`/`)`).
  - **Why `data:` is dropped, not allowlisted**: a `data:` URL's path is opaque — `new URL()` does **not** percent-encode literal `"`/`)` inside it, so a `data:image/png,x");…("` value would pass a scheme-only gate and break out of `url("…")`. `http`/`https` URLs have their `"` percent-encoded to `%22` by URL normalization, and `blob:` is structurally `blob:<origin>/<uuid>` (no quotes) — both are safe. The explicit `"`/`)` reject in (b) is belt-and-suspenders.
- [ ] `renderer.js:356` sets `thumb.style.backgroundImage` **only** when `isSafePosterUrl(item.poster)` is true; otherwise no background is set (the existing `if (item.poster)` truthiness guard is replaced by the scheme check — `isSafePosterUrl` already rejects empty/non-string). A crafted `poster` can never reach the `url("…")` sink.
- [ ] No `CSS.escape` and no `escapeHtml` is used for this sink (scheme allowlist is the sole gate).
- [ ] `isSafePosterUrl` is exported (dual export) and unit-tested; `npm test` passes (existing url-safety + download-path suites still green).
- [ ] Legitimate posters still render: an ordinary `https://…/poster.jpg` (and `blob:` image posters) still set the background. (`data:` posters are intentionally rejected — see above.)

## Verification Steps
- `npm test` → exits 0; new `isSafePosterUrl` cases pass.
- `grep -n "isSafePosterUrl\|backgroundImage" src/renderer/renderer.js src/shared/url-safety.js` → predicate defined in shared, used at the poster sink; the `backgroundImage` assignment is gated.
- Read `renderer.js:356` to confirm the scheme check precedes the assignment and no `CSS.escape`/`escapeHtml` was added there.

> Scope note: image-type items set `img.src = item.url` (`renderer.js:351`) — that is an `<img src>` (not a CSS sink) and out of scope for F6; flagged for a possible future leg, not addressed here.

## Implementation Guidance

1. **Add `isSafePosterUrl` to `src/shared/url-safety.js`**
   - Mirror `isSafeTabUrl`'s robust parse (coerce, trim, try `new URL`, reject on throw). Allowed schemes: `http:`, `https:`, `blob:` (**not** `data:`, **not** `about:`). After the scheme passes, also return `false` if `parsed.href` contains `"` or `)`.
   - Export alongside `isSafeTabUrl`: add `isSafePosterUrl` to the CommonJS `module.exports` object **and** add a separate `globalThis.isSafePosterUrl = isSafePosterUrl;` statement (the renderer reads it as a global — don't forget the second statement).

2. **Gate the renderer sink** (`renderer.js:356`)
   - Change `if (item.poster) thumb.style.backgroundImage = \`url("${item.poster}")\`;` to set the background only when `isSafePosterUrl(item.poster)` is true.
   - Do not change the `thumb.style.backgroundImage = 'none'` reset at `renderer.js:415` — `'none'` is a constant CSS keyword (not interpolated input), so it is safe as-is.

3. **Extend tests** — update the `require` destructure in `test/unit/url-safety.test.js` to also import `isSafePosterUrl`, and add cases covering the AC: allow `http`/`https`/`blob` (incl. uppercase scheme); reject `data:` (even a plain `data:image/png,abc`), `javascript:`/`file:`/`vbscript:`, empty/non-string/malformed, and breakout payloads containing `"`/`)` (incl. an `http:`-scheme value with injected quotes and a `data:`-with-quotes value).

## Edge Cases
- **Missing/empty poster**: `isSafePosterUrl('')`/`undefined` → false → no background (matches prior behavior).
- **Uppercase scheme** (`HTTPS://`, `DATA:`): allowed (case-insensitive).
- **Breakout payload** (`") ; ... ; url("`): rejected by the `"`/`)` check (and usually by the scheme check too); never reaches the sink.
- **`data:` posters**: **rejected** — opaque-path `data:` values can carry literal `"`/`)` past `new URL()` and break out. (Vanishingly rare for real `<video poster>`; no UX cost.)
- **`blob:` posters**: allowed (legitimate for in-page media thumbnails; structurally `blob:<origin>/<uuid>`, no quotes).
- **`http(s)` with injected quotes**: `new URL()` percent-encodes `"`→`%22`, so a normal `http(s)` poster passes; the explicit `"`/`)` check is the backstop.

## Files Affected
- `src/shared/url-safety.js` — add `isSafePosterUrl`
- `src/renderer/renderer.js` — gate the `backgroundImage` sink at `:355`
- `test/unit/url-safety.test.js` — add `isSafePosterUrl` cases

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing (`npm test`)
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `completed` (in this file's header)
- [ ] Check off this leg in flight.md
- [ ] If final leg of flight: (N/A — leg 3 of 5)
- [ ] Commit handled at flight end (deferred per agentic-workflow single-commit model)
