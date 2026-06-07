# Leg: boundary-hardening

**Status**: completed
**Flight**: [Internal Page Scheme (`goldfinch://`)](../flight.md)

## Objective
Make the main-process `will-navigate` guard **session-aware** — web-origin webviews keep rejecting
`goldfinch://` while the internal session is allowed to navigate within the internal allowlist — and
extend the `tab-scheme-guard` fixture with the four `goldfinch://` page-spoof vectors the behavior test
(steps 8–13, authored at planning) drives.

## Context
- **Flight DD4** — `will-navigate` (`main.js:150`, inside `app.on('web-contents-created')` for type
  `webview`) currently `e.preventDefault()` when `!isSafeTabUrl(url)` — which already rejects
  `goldfinch://` for ALL webviews. Keep that for web webviews; **allow `goldfinch://` only for the
  internal session**, distinguished by the **`__goldfinchInternal` session marker** leg 2 already sets
  (`main.js:605/629`). The internal branch allows **only `isInternalPageUrl(url)`** (so the internal
  session can be on / reload `goldfinch://settings` but cannot be navigated anywhere else either).
- **Spike (DD4), live**: whether `will-navigate` even fires on the internal webview's own **initial load
  AND reload** is confirmed live at leg 6 (the harness can't launch the GUI). The guard is written
  defensively regardless — if the event never fires for programmatic loads (Architect prediction), this
  branch is belt-and-suspenders; if it does fire, `isInternalPageUrl('goldfinch://settings') === true`
  keeps load/reload working. **The spike must explicitly check the INITIAL load, not just reload** — if
  an intermediate `about:blank` step fires `will-navigate` during initial load, the `isInternalPageUrl`-only
  branch would `preventDefault` it (`isInternalPageUrl('about:blank') === false`); step 12 (trusted-open
  renders the stub) would catch a fully-broken load, but the spike should confirm initial-load survival
  directly. Either way the code is correct; the spike tells us if it's load-bearing and flags any
  about:blank interaction.
- **Serving stays internal-session-only** (DD2, leg 2) — no change needed; this leg **asserts** (static
  read) that `protocol.handle` is registered on `internalSession` only, so a web webview has no handler.
- **The behavior spec is already extended** (`tests/behavior/tab-scheme-guard.md` steps 8–13, authored
  during flight planning). This leg builds the **fixture** the spec's `goldfinch://` steps reference;
  the spec itself needs no change unless a refinement surfaces. The fixture dir
  (`tests/behavior/fixtures/`) is excluded from lint/prettier (see the fixture's own header comment).

## Inputs
- `src/main/main.js` post-leg-3: `will-navigate` at `:150`; the require of `{ isSafeTabUrl }` from
  `../shared/url-safety` (`isInternalPageUrl` now also exported there from leg 3); the
  `__goldfinchInternal` marker on the internal session.
- `tests/behavior/fixtures/tab-scheme-guard/index.html` — current vectors 1–6 (file/js/data/self-nav/
  media/control); the `<script>` block at the end.
- `tests/behavior/tab-scheme-guard.md` — steps 8–13 already present (window.open / location / iframe /
  fetch / trusted-open / reload).

## Outputs
- Session-aware `will-navigate` in `main.js` (web branch unchanged; internal branch = `isInternalPageUrl`-only).
- `main.js` requires `isInternalPageUrl` alongside `isSafeTabUrl`.
- The fixture gains the 4 `goldfinch://` spoof vectors with observable hooks (status element + console).
- Offline gates green; the live spoof-rejection + spike + CSP read-back run in leg 6.

## Acceptance Criteria
- [ ] `will-navigate` (`main.js:150`) is **session-aware**: if the navigating webContents' session
  carries `__goldfinchInternal`, allow the navigation **only when `isInternalPageUrl(url)`** (else
  `preventDefault`); otherwise (web session) keep the existing `!isSafeTabUrl(url) → preventDefault`
  **unchanged** (still rejects `goldfinch://`, `file:`, `data:`, `javascript:` from web origins).
- [ ] `main.js` imports `isInternalPageUrl` (add to the existing
  `const { isSafeTabUrl } = require('../shared/url-safety')` → `{ isSafeTabUrl, isInternalPageUrl }`).
- [ ] The discriminator is the **session marker** (`/** @type {any} */(contents.session).__goldfinchInternal`),
  NOT the URL string — a web webview cannot become the internal session.
- [ ] **Static assertion documented in the leg/flight-log**: `protocol.handle('goldfinch', …)` is
  registered ONLY on `internalSession` (leg 2), never on the default/web session — so web webviews have
  no `goldfinch://` handler (the fourth gate). No code change; confirm by read.
- [ ] The fixture `tests/behavior/fixtures/tab-scheme-guard/index.html` gains a new section with **four**
  `goldfinch://` vectors, each with a stable `id` the Executor can click:
  - `#open-goldfinch` → `window.open('goldfinch://settings')`
  - `#nav-goldfinch` → `window.location = 'goldfinch://settings'`
  - `#embed-goldfinch` → injects an **explicitly sized, bordered** `<iframe src="goldfinch://settings">`
    into the page AND writes a positive "iframe injected" status to a stable element + `console.log`
    (mirroring the fetch hook) — so a blank iframe (the pass state) is distinguishable from "the button
    never fired." The observable: the iframe is present and visible but does NOT render the settings
    stub ("Settings — coming soon") inside it.
  - `#fetch-goldfinch` → `fetch('goldfinch://settings')` and writes the outcome (`resolved` vs
    `rejected: <err>`) to a stable `#goldfinch-fetch-result` element AND `console.log`s it, so the
    Validator can read that the fetch was rejected, not resolved.
- [ ] The fixture keeps the existing `trigger-page-loaded` marker and vectors 1–6 intact; the new
  `<script>` wiring follows the existing pattern (attach by `id`, avoid HTML-attribute quoting issues).
- [ ] Offline gates green: `npm run typecheck` → 0 (main.js change), `npm run lint` → 0 (fixture is
  lint-excluded; main.js must stay clean), `npm test` → 161 unchanged (no unit/test-suite change).

## Verification Steps
- `npm run typecheck` → 0; `npm run lint` → 0; `npm test` → 161 unchanged.
- **Static read-through**: the web branch of `will-navigate` is byte-equivalent to today (still
  `!isSafeTabUrl → preventDefault`); the internal branch is `isInternalPageUrl`-only; the discriminator
  is the session marker; `protocol.handle` is internal-session-only.
- **Deferred to leg 6 (live)**: run the extended `tab-scheme-guard` — drive the 4 new fixture vectors and
  confirm each is rejected (no internal tab/stub via `window.open`/`location`; the iframe does not render
  the stub; `fetch` rejects); run the trusted-open + reload positives; run the **`will-navigate` spike**
  (does it fire on the internal load/reload?) and the **CSP read-back**; confirm `goldfinch://nope` 404s.

## Implementation Guidance

1. **Session-aware `will-navigate`** (`main.js:150`)
   ```js
   contents.on('will-navigate', (e, url) => {
     // Optional access → a missing/falsy session falls through to the stricter web branch.
     if (/** @type {any} */ (contents.session)?.__goldfinchInternal) {
       // Internal session: only ever on the internal allowlist (goldfinch://settings).
       if (!isInternalPageUrl(url)) e.preventDefault();
     } else {
       // Web session: unchanged — rejects goldfinch://, file:, data:, javascript:, etc.
       if (!isSafeTabUrl(url)) e.preventDefault();
     }
   });
   ```
   - Add `isInternalPageUrl` to the `url-safety` require at the top of `main.js`.
   - Reference DD4 (not a line number) in any comment.

2. **Fixture vectors** (`tests/behavior/fixtures/tab-scheme-guard/index.html`)
   - Add a `<section>` "Internal scheme (`goldfinch://`) spoof vectors" with the four buttons above and a
     `<div id="goldfinch-fetch-result">` (empty initially). Wire `#open-goldfinch`/`#nav-goldfinch`
     inline or in the `<script>`; wire `#embed-goldfinch` to append an `<iframe>`; wire `#fetch-goldfinch`
     in the `<script>` to `fetch('goldfinch://settings').then(...).catch(e => write 'rejected: '+e)` and
     mirror to `console.log`.
   - Keep vectors 1–6 and the `trigger-page-loaded` marker; match the existing button styling/structure.

3. **Scope guard**: do NOT touch `createTab`, the preloads, `protocol.handle`, or `will-attach-webview`
   (legs 2/3). Do NOT run the live GUI. The behavior spec already has steps 8–13 — only edit it if you
   spot a concrete mismatch with the fixture ids you create (keep the spec's plain-English steps stable).

## Edge Cases
- **`contents.session` undefined in `will-navigate`**: guard with optional access; default to the web
  branch (stricter — rejects `goldfinch://`) if the marker can't be read.
- **Internal page same-document section switch (Flight 5)**: client-side section switching does NOT fire
  `will-navigate` (it fires `did-navigate-in-page`), so the `isInternalPageUrl`-only internal branch
  won't block future settings sections. **BUT ⚠️ flag for Flight 5**: if a future internal page is a
  *distinct host/path* reachable by a **full navigation** (e.g. `goldfinch://history`), this branch will
  silently `preventDefault` it — the internal `will-navigate` allowlist (`isInternalPageUrl`) must grow
  **alongside** `INTERNAL_PAGES` (leg 2) and the `isInternalPageUrl` allowlist whenever a new internal
  page is added by real navigation.
- **`will-redirect` not guarded**: a web page 3xx→`goldfinch://` is still blocked by the no-handler gate
  (web session has no handler); moot, but noted.
- **Fixture iframe to `goldfinch://`**: from the web origin it is blocked by the web session having no
  handler AND (defense-in-depth) the internal CSP `frame-ancestors 'none'` — the test asserts the stub
  does not render inside the iframe, not the mechanism.

## Files Affected
- `src/main/main.js` — session-aware `will-navigate`; `isInternalPageUrl` import.
- `tests/behavior/fixtures/tab-scheme-guard/index.html` — 4 new `goldfinch://` vectors + fetch-result hook.
- (`tests/behavior/tab-scheme-guard.md` — only if a fixture-id mismatch needs reconciling; steps 8–13
  already authored.)

---

## Post-Completion Checklist

**Batched-commit flight: implement + update artifacts, do NOT commit; signal `[HANDOFF:review-needed]`.**

- [ ] All acceptance criteria verified (static + offline gates; live spoof/spike/CSP-readback → leg 6)
- [ ] Offline gates passing (`npm test` / `typecheck` / `lint`)
- [ ] Update flight-log.md with leg progress entry (incl. the protocol-handle-internal-only static assertion)
- [ ] Set this leg's status to `landed`
- [ ] Check off this leg in flight.md
- [ ] Do NOT commit; signal `[HANDOFF:review-needed]`
