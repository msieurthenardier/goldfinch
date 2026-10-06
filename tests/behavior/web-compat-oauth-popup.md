# Behavior Test: OAuth Popup Round-Trip (Real Popup Window)

**Slug**: `web-compat-oauth-popup`
**Status**: active
**Created**: 2026-07-28
**Last Run**: 2026-10-06-13-24-48 (pass, 8/8: step 3 floating-window clause confirmed by operator by eye; first run, batched; see runs/2026-10-06-13-24-48.md)
**Cache:** cold

## Intent

Verifies the popup-based OAuth sign-in pattern end to end against the local fixture under the M14 F2 Option B ruling: a DD3-qualifying `window.open` (features + named target) opens a **real popup BrowserWindow** with a live opener handle; the popup delivers a token to the opener via `postMessage`, the opener acks, and the popup self-closes through the guest shim — with the popup visible to and drivable by the automation surface while it lives (DD1a census + addressability). Unit tests pin every seam (predicate, registry, census assembly, resolve widening); only a live run proves the cross-process whole: real window creation, opener linkage across real contents, message round-trip, and the self-close path. Core observables are page-DOM reads runnable with a **jar-scoped key** (DD4); the census assertions are **admin-tier** and are skipped (or deferred to the Flight 3 admin-keyed bundle) when the run-time key is jar-scoped.

## Preconditions

- App launched against a fresh scratch profile with automation enabled and keys minted: `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1 npm run dev:automation` (instance identity: use the freshly minted key(s) from this launch's own `AUTOMATION_DEV_MINT` line, on the exactly-bound port).
- Fixture server running: `node tests/behavior/fixtures/web-compat/serve.mjs --port {P} [--log {logfile}]` (serves `/oauth/opener.html` + `/oauth/popup.html`; port must not collide with the MCP port).
- Steps marked **[admin]** require the admin key; all other steps are runnable with a jar key for the jar the opener tab lives in.

## Observables Required

- browser (page DOM state via `evaluate`/`readDom` on tab AND popup wcIds; census via `enumerateTabs`/`enumerateWindows` — measured via goldfinch MCP)
- shell (fixture server lifecycle; optional JSONL log reads — measured via Bash)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Open a tab to `http://127.0.0.1:{P}/oauth/opener.html` via `openTab`; record its `wcId` and (from enumeration) its `jarId`. Wait for load. | Page loads; `#popup-state` reads `none`; `#result` is empty. |
| 2 | **[admin]** Baseline census: `enumerateWindows` and `enumerateTabs`. Record the opener tab's `windowId`. | `enumerateWindows` contains **no** entry carrying `popupWcId`; `enumerateTabs` contains **no** row with `popup: true`. |
| 3 | In the opener tab, `evaluate`: `document.getElementById('open-popup').click()`. | **[by-eye]** A real popup window appears on screen as a visually distinct floating window, not a new tab (operator clause: unobservable by the apparatus on Wayland, since `captureWindow` composites only the browser window). Automated clauses: in the opener: `#popup-state` reads `open`; `window.__oauthPopup` is truthy and `window.__oauthPopup.closed === false` (live opener handle). `enumerateTabs` with the jar key shows exactly one new row: `popup: true`, `active: false`, `jarId` = the opener's jar, `windowId` = the opener's window, url ending `/oauth/popup.html`. The popup is not in the tab strip (`captureWindow` plus a chrome tab-strip read show no tab for it). Record the popup `wcId`. `captureScreenshot {popup wcId}` returns a painted (non-blank) popup surface at roughly the `window.open` feature size (width 420; the viewport height may read slightly under the requested `height` because the height is applied as the outer size). |
| 4 | **[admin]** Census with the popup live: `enumerateWindows`, `enumerateTabs`. | `enumerateWindows` includes exactly one popup entry `{ popupWcId, openerWindowId, url, title }` with `openerWindowId` = the opener tab's `windowId` (from step 2) and url ending `/oauth/popup.html`; the entry carries no `windowId` field. Admin `enumerateTabs` shows the same popup row as step 3. |
| 5 | Drive the popup by its `wcId` (jar key: the wcId from the step-3 popup row): `readDom` or `evaluate` the popup's `#status`. | Returns `awaiting-approval` — the popup wcId resolves and is drivable by the jar key whose jar it lives in (DD1a addressability; no `non-tab-contents` refusal, no `out-of-jar`). |
| 6 | Still targeting the popup `wcId`, `evaluate`: `document.getElementById('approve').click()`. | Accepted (no refusal). |
| 7 | (Wait point) | Within 5s, in the opener tab: `#result` matches `^fixture-oauth-token-\w+$` (token delivered over the opener handle), `#popup-state` reads `closed`, and `window.__oauthPopup.closed === true` (the popup self-closed via `window.close()` after the ack). Focus/opener state sane: the opener tab is still the window's active tab and its page is undisturbed (same URL, no navigation). |
| 8 | **[admin]** Census after close: `enumerateWindows`, `enumerateTabs`. | No entry carrying `popupWcId` and no row with `popup: true` remain; driving the recorded popup `wcId` now refuses with `no-such-contents`. |

## Row Conventions

- A **[by-eye]** clause is an operator-only check the apparatus cannot observe. The Validator reports it INCONCLUSIVE (apparatus) and the operator confirms it by eye; the run log records the operator's verdict and date, and the step is upgraded to PASS only on that confirmation. The automated clauses in the same row are judged as normal and must not be masked by the by-eye clause.
- Known limitation: the ack-driven popup close (step 7) is not distinguishable from a plain `window.close()` or external close today; the fixture is unchanged.

## Out of Scope

- Live GitHub OAuth witnessed run — Flight 3 (HAT), per the mission criterion.
- Auth challenges (basic-auth / client-cert) arriving from popup contents — unit-pinned matrix in `auth-challenges.test.js`; live coverage rides `web-compat-basic-auth`'s infrastructure if ever needed.
- Deny-convert of featureless/`_blank` opens (popup-as-tab) — `popup-jar-inheritance`.
- Foreign-jar popup invisibility to a jar key — unit-pinned (scope façade session filter); a live variant would need two jar keys.
- Popup close-with-owner-window (DD1f) and cross-window opener moves — unit-pinned.
