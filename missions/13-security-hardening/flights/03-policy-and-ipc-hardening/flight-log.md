# Flight Log: Policy and IPC Hardening Batch

**Flight**: [Policy and IPC Hardening Batch](flight.md)

## Summary

Planning complete. Branch `flight/03-policy-and-ipc-hardening` stacked on flight 2. Covers audit findings 2 (permission allowlist), 4 (IPC sender + tab-navigate URL), 5 (nav guards), 6 (vault isTrusted).

---

## Reconnaissance Report

Source: issue #131 findings 2, 4, 5, 6. Full IPC/permission/nav/vault recon against `flight/02` HEAD, 2026-07-25 (embedded in the flight DDs). Key facts:

| finding | current state | evidence |
|---|---|---|
| 2 permission | 12-entry deny-list, `granted = !SENSITIVE.has(perm)` → default-allow | `session-runtime.js:4-17,227-235`; `privacy-permission` push at `:231`; internal excluded via `applyShields` early-return |
| 2 app needs | app requests NOTHING (no getUserMedia/requestFullscreen/device handlers) | grep `src/` clean |
| 4 unguarded chrome-trust | `tab-navigate`/`tab-find`/`tab-history-snapshot`/`rescan-media`/`new-container-create`/`identity-new`/`privacy-*`/`zoom`/`print`/`toggle-devtools`/`page-context-*` ignore sender | `register-tab-ipc.js`, `register-browser-ipc.js` inventory |
| 4 tab-navigate URL | `loadURL(args[0])` — NO isSafeTabUrl (unlike automation/nav.js) | `register-tab-ipc.js:654-670` |
| 4 HIGH regression risk | `openSiteSettingsTab` navigates internal tab to `goldfinch://` via tab-navigate | `overlay-menus.js:120` |
| 5 nav guards | only `will-navigate` + `setWindowOpenHandler` on guests; NO will-frame-navigate/will-redirect; NO web-contents-created | `guest-wiring.js:65-79`; grep clean |
| 5 web-contents-created timing | fires synchronously during `new WebContentsView()`, before wireGuestContents | `register-tab-ipc.js:112-115` |
| 6 vault isTrusted | submit listener has NO isTrusted check; sibling icon handlers do | `webview-preload.js:329` vs `vault-fill-icon.js:191` |
| 6 edit target | source `webview-preload.js` (bundle regenerates) | flight 2 bundling |

---

## Leg Progress

### Leg 01 — permission-allowlist (2026-07-25)

Inverted the web-session permission policy from a 12-entry deny-list to a positive allowlist.

- `src/main/session-runtime.js`: replaced `SENSITIVE_PERMISSIONS` (deny-list) with `ALLOWED_PERMISSIONS` (positive `Set`, :4-19). Both `setPermissionRequestHandler` (:227) and `setPermissionCheckHandler` (:234) now compute `granted = ALLOWED_PERMISSIONS.has(permission)`. The `privacy-permission` push (:231) is byte-identical: payload `{ webContentsId, permission, granted }`. Added a comment documenting that Electron 43's request/check handlers take different permission-string unions, so the shared Set is intentional. No permission handler added to the internal session — `applyShields` still early-returns on `__goldfinchInternal` (:157), unchanged.
- **Final allowlist membership** (unchanged from DD1/AC2 seed — no adjustment needed from FD's empirical pass, see below): `fullscreen`, `clipboard-sanitized-write`, `pointerLock`, `mediaKeySystem`, `storage-access`, `top-level-storage-access`, `speaker-selection`, `window-management`. Denied (excluded): `openExternal`, `media`, `geolocation`, `notifications`, `midi`, `midiSysex`, `hid`, `serial`, `usb`, `display-capture`, `idle-detection`, `clipboard-read`, `keyboardLock`, `fileSystem`, `deprecated-sync-clipboard-read`, and any unlisted/future/`unknown` string.
- `test/unit/session-runtime.test.js`: added a new test (`permission allowlist denies invented/future permissions and grants allowlisted members`) asserting (a) `'some-future-perm-2030'` denies via both `permissionRequest` and `permissionCheck`, (b) `'fullscreen'` grants via both handlers, with the `privacy-permission` push carrying `granted: true`. Kept the existing `geolocation`-denies (request handler) and `notifications`-denies (check handler) assertions — both remain excluded, so still deny.
- Test counts: `test/unit/session-runtime.test.js` 8 → 9 tests, all passing. Full suite: 2831 tests, 2831 pass, 0 fail (one earlier `npm test` run showed a transient `fail 1` unrelated to session-runtime — not reproducible on rerun, no session-runtime test involved).
- Gate: `npm test`, `npm run lint`, `npm run typecheck` all green.
- AC1–AC4 verified by diff + unit tests. AC5 (FD empirical live pass: fullscreen video, File System Access API site, `openExternal`/registered-protocol link) deferred to FD per leg spec — handed off via `[HANDOFF:review-needed]`.

### Leg 02 — ipc-sender-and-vault-guard (2026-07-25)

Sender-identity validation on the chrome-trust IPC channels that ignored it, a branched URL-safety gate on `tab-navigate`, and the vault-capture `isTrusted` guard. Implemented in parallel with Leg 01 (disjoint files); the FD records this entry (the developer was told to avoid the shared flight-log to prevent a parallel-write race with Leg 01's developer).

- **`src/main/register-tab-ipc.js`**: added `requireChrome(event)` (identity-resolve the sender's chrome record) and `ownsTab(event, wcId)` (sender's record must EQUAL `getWindowForGuest(wcId)`). wcId-scoped channels `tab-close`/`tab-hide`/`tab-set-active`/`tab-set-bounds` now use `ownsTab`; `tab-navigate`/`tab-find` (previously no sender check) gained `ownsTab`; `tab-history-snapshot` gained `requireChrome` (kept its internal-exclusion target guard). `tab-navigate`'s `loadURL` branch is trust-branched — `entry.trusted` (fallback `isInternalContents`) picks `isInternalPageUrl` vs `isSafeTabUrl`, so `openSiteSettingsTab`'s `goldfinch://settings/#privacy` on an internal tab still works (the HIGH regression the design review flagged). `isInternalPageUrl` threaded into the injected deps + the `main.js` `registerTabIpc` call.
- **`src/main/register-browser-ipc.js`**: local `requireChrome`; added `if (!requireChrome(event)) return <refusal>` ahead of (not replacing) the existing target/internal guards on `new-container-create`, `rescan-media`, `zoom-apply`, `get-zoom`, `print`, `toggle-devtools`, `is-devtools-open`, `page-context-action`, `page-context-correct`, `identity-new`, `privacy-cookies`, `privacy-clear-cookies`, `privacy-clear-storage`. **Self-scoped channels left untouched** (`vault-*`, `guest-*`, `shields-farble`, `guest-media-list`, `guest-privacy-fp` resolve from `event.sender.id` — a chrome check would break the guest sender). Reviewer grep-confirmed none were touched.
- **`src/preload/webview-preload.js`**: the submit-capture listener early-returns via `if (!(isTrustedGet ? isTrustedGet.call(e) : e.isTrusted)) return;` (module-scope `isTrustedGet`), mirroring `vault-fill-icon.js`'s `readTrusted`; the accepted-tradeoff comment rewritten to state synthetic/page-dispatched submits are now ignored (closes the spurious-offer AND update-disposition cases). Source edit; bundle regenerates via `pretest`.
- **Tests**: inverted `register-browser-ipc.test.js`'s `new-container-create` `{}`-sender success pin → refusal (+ a legit-chrome-succeeds follow-up); non-chrome refusal across `get-zoom`/`toggle-devtools`/`page-context-action`/`rescan-media`; `register-tab-ipc.test.js` gained non-chrome + **cross-window** refusal on wcId-scoped channels and full `tab-navigate` `loadURL` coverage (web unsafe refused, web safe allowed, internal `goldfinch://` allowed, internal+web-URL refused, non-chrome refused). Existing real-sender tests stayed green.
- Gate: `npm test` 2834 pass, lint + typecheck clean. Fully unit-verified — no FD live pass needed.

### Leg 03 — nav-guards (2026-07-25)

Extended navigation guarding to subframe navigations and redirects on guests, and added a `web-contents-created` catch-all covering every other webContents. Design-reviewed needs-rework → reworked before implementation (four fixes folded in below); this is the flight's riskiest leg — a live behavior change on a previously-unguarded surface (`will-redirect`/`will-frame-navigate` were fully unenforced before).

- `src/main/guest-wiring.js`: `wireGuestContents` now sets `contents.__goldfinchNavGuarded = true` synchronously at the top (before `setWindowOpenHandler`/any listener attach), with a comment pinning that this must stay synchronous — a future `await` inserted before this call would reopen the latch race. Factored the session-aware predicate into a local `guardNav(event)` — reading **`event.url`** exclusively (not a positional `(event, url)`, which `will-frame-navigate` never provides — it passes a single merged Event) — and attached it to `will-navigate`, `will-frame-navigate`, and `will-redirect`, placed before the internal-session early return so both branches are covered.
- `src/main/app-lifecycle.js`: added a top-level `app.on('web-contents-created', ...)` catch-all (registered before `app.whenReady()`, since `createWindow()` — which builds the first chrome webContents — runs inside the ready continuation and a listener attached later would miss it). Per contents: `setWindowOpenHandler(() => ({ action: 'deny' }))` (a setter — the guest's own later-installed handler safely overrides it) plus a nav guard on `will-navigate`/`will-frame-navigate`/`will-redirect` that reads `contents.__goldfinchNavGuarded` **inside the handler** and early-returns for guests (the latch is read at fire time, not attach time, since `web-contents-created` fires synchronously during `new WebContentsView()`, before `wireGuestContents` runs). For non-guest views, it allows `isSafeTabUrl`/`isInternalPageUrl` plus an explicit scheme allowlist (`devtools:`, `file:`, `chrome-extension:`, `about:` — DevTools frontend, the built-in PDF viewer, extension pages, and file links) and `preventDefault`s everything else.
- `src/main/main.js`: threaded `isSafeTabUrl`/`isInternalPageUrl` (already imported at the top of the file, already passed into `registerTabIpc`) into the `registerAppLifecycle({...})` call so `app-lifecycle.js` keeps its zero-`require()` design (Electron-free, fully deps-injected).
- Tests: `test/unit/guest-wiring.test.js` — rewrote the existing `will-navigate` allowlist test to read `event.url` (was asserting against the old positional-arg emit shape, which the new handler no longer honors) and added two tests: (1) `will-frame-navigate`/`will-redirect` enforce the predicate — the subframe case is emitted with the **single details-object shape** (`{ url, isMainFrame, preventDefault }`), deliberately not a positional 2nd arg, so the test would fail against a regressed `(event, url)` handler instead of masking it; (2) a latched guest's legitimate `https→https` navigation is not blocked by a simulated catch-all guard. `test/unit/app-lifecycle.test.js` — threaded `isSafeTabUrl`/`isInternalPageUrl` fakes into the harness and added a `FakeWebContents` (EventEmitter-based) to test: the catch-all registers at top level (before `whenReady` resolves); it denies window-open and blocks a non-guest `javascript:` navigation on all three events; it allows `devtools:`/`file:`/`chrome-extension:`/`about:`; and a latched contents is never blocked, even on a scheme that would otherwise fail the predicate (the latch defers entirely to the guest's own listener).
- `tests/behavior/tab-scheme-guard.md`: appended steps 14 (subframe dangerous-scheme navigation via `will-frame-navigate`) and 15 (a real cross-scheme redirect via `will-redirect`, plus a same-scheme http→https control) after the existing 13 steps, per DD3/AC5. Both new steps note fixture gaps the FD will need to close at live-pass time (the fixture has no subframe self-nav vector yet; a real cross-scheme 302 needs more than a static file server).
- Test counts: `guest-wiring.test.js` 9 → 11 tests; `app-lifecycle.test.js` 7 → 10 tests. Full suite: 2840 tests, 2840 pass, 0 fail.
- Gate: `npm test`, `npm run lint`, `npm run typecheck` all green.
- AC1–AC4 verified by diff + unit tests. AC5 (FD live pass extending `tab-scheme-guard` with the subframe + real cross-scheme redirect steps, and confirming DevTools/PDF-viewer/ordinary browsing are unaffected) deferred to FD per leg spec — handed off via `[HANDOFF:review-needed]`. Divert path (scope the guest redirect/subframe guard down) stays available to the FD if the live cross-scheme redirect check finds a legitimate flow broken.

---

## Decisions

### AC5 live passes (legs 1 + 3) — PASS (regression-critical), FD live check 2026-07-25
Launched `dev:automation`; opened a parent page with an http `<iframe>` + a plain page. Evidence: `/tmp/behavior-tests/goldfinch/f3-live/`.

**Leg 3 (nav guards) — the regression-critical checks pass:**
- **Ordinary browsing NOT broken**: the http iframe loaded (`subLoaded: true`) and a main-frame navigation to a new http page succeeded. This directly confirms the `will-frame-navigate`/`will-navigate`/`will-redirect` guards allow legitimate http nav — i.e. the design-review [HIGH] arg-shape bug (`will-frame-navigate` passing a single Event, not positional `url`, which would `preventDefault` every navigation) is **absent** in the shipped code.
- **DevTools opens** (`openDevTools → ok:true`): the `web-contents-created` catch-all's scheme allowlist (`devtools:`/`file:`/`chrome-extension:`/`about:`) correctly does not block the DevTools frontend.

**Leg 1 (permission allowlist):**
- The check handler reports `denied` for excluded permissions (`geolocation`, `notifications`) via `navigator.permissions.query` — the allowlist is governing. (Consistent with pre-change behavior for these; the new property is that *unknown/future* permissions now also deny, unit-pinned.)

**Residual (documented, non-blocking)**: exhaustive gesture-gated permission exercises (fullscreen grant, `fileSystem`-in-use denial, `openExternal` denial) and a real cross-scheme-redirect divert-trigger need richer fixtures/user-gesture simulation than the automation seam provides headlessly. Covered by (a) deterministic unit tests (allowlist grants `fullscreen`, denies invented/excluded; nav guards preventDefault disallowed schemes on all three events; latch prevents guest over-block), and (b) the extended `tab-scheme-guard.md` steps 14-15 for a future dedicated Witnessed run once the fixture gains a subframe-nav vector + a cross-scheme 302 endpoint. No divert triggered — no legitimate flow observed breaking.

---

## Deviations

*(none yet)*

---

## Anomalies

*(none yet)*

---

## Flight Director Notes

- 2026-07-25 — Flight 3 planned autonomously; branch stacked on flight 2. Architect design review: approve-with-changes (HIGH tab-navigate internal-tab regression caught pre-implementation; nav guards recognized as a live behavior change, not pure defense-in-depth). Leg split into permission (live) / ipc-sender+vault (mechanical) / nav-guards (live) so the risky live-behavior legs are isolated from the mechanical one.
