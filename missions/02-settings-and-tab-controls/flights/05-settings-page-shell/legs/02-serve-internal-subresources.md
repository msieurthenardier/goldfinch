# Leg: serve-internal-subresources

**Status**: landed
**Flight**: [Settings Page Shell + Address-Bar Chips](../flight.md)

## Objective
Extend the internal `goldfinch://` protocol handler from serving a single root-path HTML file per host to a
**per-host path allowlist** that also serves the settings page's CSS (and optionally JS) subresources, with
content-type by file extension, traversal-proof, under the **unchanged** strict CSP.

## Context
- **DD2.** Today `handleInternal` (`src/main/main.js:handleInternal`) serves **root-path only** — a single
  HTML file per host via `INTERNAL_PAGES[url.host]` (`src/main/main.js:INTERNAL_PAGES`), hardcoded
  `Content-Type: text/html`. Any non-root path 404s; non-GET 405s. The settings shell (leg 3) needs
  `settings.css` (and optionally `settings.js`) served as **same-origin subresources**.
- **CSP unchanged.** `INTERNAL_CSP` (`src/main/main.js:INTERNAL_CSP` =
  `"default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'"`) stays exactly as-is.
  `default-src 'self'` permits the page to load its own same-origin `goldfinch://settings/settings.css` —
  **no relaxation, no `'unsafe-inline'`**. Subresources inherit `style-src`/`script-src` from `default-src`.
- **CSP-subresource SPIKE (DD2) — live-confirm deferred to leg 7.** That `default-src 'self'` admits a
  `goldfinch://` subresource on a `{standard, secure}` scheme is *very likely but unproven in this
  codebase* (Architect). The canonical de-risk is a live load with no `securitypolicyviolation`. **This
  harness cannot autonomously launch the GUI**, so per the Flight Director deviation logged for this leg,
  the live confirmation is **batched into leg 7's live verification** (it runs the app on `:9222` anyway),
  with the **fallback ready**: if a CSP block appears, add an explicit per-page `style-src 'self';
  script-src 'self'` to the served CSP (still no `'unsafe-inline'`). The implementation here is structured
  so that fallback is a one-line change to the served headers. Leg 3 proceeds on the strong architectural
  prior (same-origin `'self'` subresource is exactly what `'self'` covers).
- **Traversal-proofing (constraint).** The served file path is **NEVER derived from `url.pathname`** — it
  is selected from a **fixed map** keyed by the normalized pathname. A non-allowlisted path 404s.
- **Builder glob.** `package.json` `build.files` is `["src/**/*", "package.json"]` with `asar: false`, so
  new `.css`/`.js` files under `src/renderer/pages/` are picked up unpacked in dev and packaged builds
  alike — confirm, no config change expected.

## Inputs
What exists before this leg runs:
- `src/main/main.js` with `INTERNAL_PAGES` (host→file), `INTERNAL_CSP`, and `handleInternal(request)`
  serving root-path HTML only.
- `src/renderer/pages/settings.html` (the Flight-4 stub).
- The unit-test harness `node --test test/unit/*.test.js`; existing pure-module pattern
  (`src/shared/url-safety.js` + `test/unit/url-safety.test.js`, `src/main/download-path.js`).

## Outputs
What exists after this leg completes:
- A **per-host path allowlist** so `goldfinch://settings/` serves the HTML and
  `goldfinch://settings/settings.css` serves the stylesheet (and `settings.js` if the shell uses it),
  each with the correct content-type; every non-allowlisted path still 404s, non-GET still 405s, CSP
  unchanged.
- A pure, unit-tested asset-resolution helper (path+host → file+content-type | null) extracted in the
  codebase's established pattern.
- A minimal `src/renderer/pages/settings.css` proving the serving path end to end (leg 3 enriches its
  content).

## Acceptance Criteria
- [ ] `INTERNAL_PAGES` is a **per-host path map** (e.g. `{ settings: { '/': <settings.html>,
  '/settings.css': <settings.css>, ['/settings.js': <settings.js>] } }`) — host → (normalized path → file).
- [ ] A **pure asset-resolution helper** (no Electron import) maps `(host, pathname)` to
  `{ file, contentType } | null` using the fixed map, and a **named-exported** content-type-by-extension
  function returns `text/html; charset=utf-8`, `text/css; charset=utf-8`, `text/javascript; charset=utf-8`
  for `.html`/`.css`/`.js`. It is **traversal-proof**: it returns `null` for any path not literally present
  as a key (no path is ever built from `pathname`). It **normalizes `''` → `'/'`** before lookup (the
  WHATWG parser yields `pathname: ''` for `goldfinch://settings` in Node vs `'/'` in Electron — same dual
  behavior `isInternalPageUrl` documents). The content-type is derived from the **resolved map entry's**
  extension, never from raw `url.pathname`. Lives at **`src/main/internal-assets.js`** (main-process-only;
  plain CommonJS `module.exports`, mirroring `src/main/download-path.js` — **NOT** `src/shared/`, which is
  the dual-export renderer+main layer this helper has no business in).
- [ ] `handleInternal` uses the helper: GET + resolved → serve `net.fetch(pathToFileURL(file))` re-wrapped
  with the helper's content-type + the **unchanged** `INTERNAL_CSP`; resolved-miss → 404; non-GET → 405;
  any throw → 500 (never throws out). The existing root-HTML behavior is preserved (`goldfinch://settings/`
  still serves `settings.html` as `text/html`).
- [ ] `src/renderer/pages/settings.css` exists (minimal is fine — leg 3 fills it) and is referenced from
  `settings.html` via `<link rel="stylesheet" href="settings.css">` (relative, resolves to
  `goldfinch://settings/settings.css`).
- [ ] **Unit tests** for the resolution helper: each allowlisted path resolves with the right content-type;
  representative traversal/garbage paths (`/../main.js`, `/settings.css/../x`, `/nope`, `/SETTINGS.CSS`
  case-mismatch policy, empty) resolve to `null`; unknown host → `null`. Added under `test/unit/`.
- [ ] `npm run lint`, `npm run typecheck`, `npm test` all green.
- [ ] Builder glob confirmed: `package.json` `build.files` (`src/**/*`) covers the new `.css`/`.js` — no
  config change needed (note in the flight log).

## Verification Steps
- `npm test` — the new internal-assets unit tests pass alongside the existing 161.
- `npm run lint && npm run typecheck` — green.
- Code read: confirm no code path builds a filesystem path from `url.pathname`; the map is fixed.
- **Deferred to leg 7 (live):** with the app on `:9222`, open `goldfinch://settings`, confirm
  `settings.css` loads (stylesheet applies; **no `securitypolicyviolation`** in the guest) — the DD2 spike.
  If blocked, apply the documented CSP fallback.

## Implementation Guidance

1. **Extract the resolution logic as `src/main/internal-assets.js`** — main-process-only, **plain CommonJS
   `module.exports`**, modeled on `src/main/download-path.js` (NOT the dual-export `src/shared/url-safety.js`
   shape). It must be **Electron-free and `__dirname`-free** so unit tests inject a synthetic map. Export:
   - `contentTypeFor(file)` (named export) → the `Content-Type` string by the **resolved file's** extension
     (`.html`/`.css`/`.js`), defaulting conservatively (e.g. `application/octet-stream`) for anything else —
     though only allowlisted extensions can ever reach it.
   - `createResolver(map)` → returns `resolve(host, pathname)` → `{ file, contentType } | null`. **`main.js`
     owns the fully-resolved absolute-path map** (the `path.join(__dirname, ...)` values stay in `main.js`'s
     `INTERNAL_PAGES`) and passes it to `createResolver` once at startup; the helper itself never touches
     `__dirname`/`path.join`. `resolve` normalizes `pathname` (`'' → '/'`), looks it up in the fixed
     per-host map, and on a hit derives `contentType` via `contentTypeFor(file)`; **never** constructs a
     path from `pathname`; returns `null` on any miss (unknown host or unknown path).

2. **Rework `handleInternal`** to call the bound resolver `resolve(url.host, url.pathname)`; on `null` →
   404; on hit → `net.fetch` the file and re-wrap with `{ 'Content-Type': <resolved.contentType>,
   'Content-Security-Policy': INTERNAL_CSP }`. The old `rootPath` check disappears (the resolver subsumes
   it); preserve the 405 (non-GET), the 500 catch, and the "discard net.fetch's file: headers" behavior.

3. **Create `src/renderer/pages/settings.css`** with a minimal rule (e.g. a `:root` brand-token block +
   `body` background) — enough to visibly prove it applied. Leg 3 replaces/extends it. Add the `<link>` to
   `settings.html`.

4. **Add unit tests** `test/unit/internal-assets.test.js` (node:test + node:assert/strict, matching the
   existing files; inject a synthetic map with predictable fake paths à la `download-path.test.js`):
   allowlisted paths (`/`, `''`, `/settings.css`) → correct file + content-type; traversal/garbage →
   `null` for at least `/../main.js`, `/settings.css/../x`, `/settings.css/` (trailing slash),
   `//settings.css` (double-leading-slash, as the URL parser yields), `/nope`, `/SETTINGS.CSS`
   (case-mismatch policy), and empty/unknown host; `contentTypeFor` per extension incl. the conservative
   default.

5. **Confirm the builder glob** covers the new files — read `package.json` `build.files`; it is `src/**/*`,
   so no change. Note it in the flight log (don't edit package.json unless it's actually missing).

## Edge Cases
- **Case sensitivity**: decide and test the policy for `/SETTINGS.CSS` vs `/settings.css`. Fixed-map
  exact-match (case-sensitive) is simplest and safest — a mismatch 404s. Document the choice.
- **Query/fragment**: `new URL` already separates `pathname` from search/hash; resolve on `pathname` only.
- **`settings.js` optional**: if leg 3 decides not to ship JS, the `/settings.js` map entry can be omitted;
  do not serve a file that doesn't exist. Keep the map honest to what's on disk.
- **Trailing-slash host paths**: `goldfinch://settings` (no trailing slash) → `url.pathname === '/'` already
  (standard scheme); keep the existing `'' → '/'` normalization.
- **Never widen `isSafeTabUrl`** — this leg does not touch URL safety; serving is independent of the tab
  open-path guard.

## Files Affected
- `src/main/main.js` — `INTERNAL_PAGES` → per-host path map; `handleInternal` → uses the resolver.
- `src/main/internal-assets.js` (new) — pure resolver + content-type helper.
- `src/renderer/pages/settings.html` — add `<link rel="stylesheet" href="settings.css">`.
- `src/renderer/pages/settings.css` (new) — minimal brand-token stylesheet (leg 3 enriches).
- `test/unit/internal-assets.test.js` (new) — resolver unit tests.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:** *(commit deferred to the flight-level review)*

- [ ] All acceptance criteria verified (offline)
- [ ] Tests passing (unit + offline gates)
- [ ] Update flight-log.md with leg progress entry (note: builder-glob confirmed; live CSP spike carried to
  leg 7 with the fallback documented)
- [ ] Set this leg's status to `landed` (commit deferred)
- [ ] Check off this leg in flight.md
- [ ] Do NOT commit; do NOT signal `[HANDOFF:review-needed]`
