# Flight Log: The Failure Surface and Navigation Errors

**Flight**: [flight.md](flight.md)
**Mission**: [No Silent Failures](../../mission.md)

Append-only during execution. Ground truth for what happened.

---

## Reconnaissance Report (planning, 2026-09-15)

Source artifacts: GitHub issue #163 (canonical), the 2026-08-27 maintenance
report's #163 triage row, and the Mission 20 Architect review's flight-1
inputs. Every cited item walked against `main` @ `0fcb100`.

| Item | Classification | Evidence | Recommendation |
|---|---|---|---|
| #163-1 No `did-fail-load` / `did-fail-provisional-load` handling anywhere | confirmed-live | repo-wide grep: zero hits in `src/`; `guest-wiring.js` `wireTabViewEvents` registers `did-start-navigation`, `did-navigate`, `did-navigate-in-page`, `page-title-updated`, `page-favicon-updated`, `did-start/stop-loading`, `did-finish-load`, `dom-ready`, `found-in-page` only (`:451-541`) | leg 1 (DD2) |
| #163-2 Rejected `loadURL` only logs (`register-tab-ipc.js:163`, `:838`) | drifted → confirmed-live | now `src/main/register-tab-ipc.js:185-187` (`tab-create`) and `:895-897` (`tab-navigate`); both `logger.warn` only | leg 1 stamps `lastRequestedUrl` at both sites (DD2); the catch stays diagnostic |
| #163-3 Failed guest lands on `chrome-error://chromewebdata/` with a 39-byte empty document | confirmed-live | corroborated by `squawks/0046-omnibox-bare-ip-forces-https.md:11,19` (in-guest `location.href`, blank capture); Chromium's net-error page is a browser-layer feature Electron does not ship | DD1 — the surface is chrome-owned |
| #163-4 `enumerateTabs` reports the intended URL while the guest is at `chrome-error://` | needs-human-recheck | census rows are renderer-sourced (`tab-controller.js:1172-1180` `listTabs()`), `tab.url` is set from `did-navigate`'s `wc.getURL()` push (`renderer.js:1513`); what `getURL()` returns after the error commit is unmeasured | leg-1 spike (DD4 premise); design is branch-complete either way |
| #163-5 Tab title stays "New tab" on failure | confirmed-live | `.tab-title` is written only by the `tab-title` push (`renderer.js:1568-1578`, `title \|\| tab.url`); no title event fires for an error document | DD6 — host-derived title on failure |
| #163-6 Certificate failures reach the same generic surface until #143 specialises | confirmed-live | no `certificate-error` handler (`app-lifecycle.js` registers `login` `:96` and `select-client-certificate` `:109` only); Electron's default rejects, so the failure arrives as `did-fail-load` `ERR_CERT_AUTHORITY_INVALID` | DD3 `cert` kind; Flight 2 intercepts earlier |
| Maint-08-27 "no `did-fail-load` handling; highest user-visible" | confirmed-live | same as #163-1 | — |
| Architect (M20 review): per-tab failure state must live on the tab's own entry, projected by the surface | confirmed design input | registry entry shape is `{ view, partition, trusted, active }` (`register-tab-ipc.js:154`), no failure field; overlay managers are per-window singletons tracking only the active guest (`find-overlay-manager.js:212-236`) | DD1/DD2 add `loadFailure` + `lastRequestedUrl` to the entry |
| Architect (M20 review): session snapshot / closed-tab capture read live `wc.getURL()` | confirmed-live | `session-snapshot.js:41`, `closed-tab-capture.js:67` | DD4 `effectiveUrl` |

No item is `already-satisfied`; nothing retires. Item #163-4 is the flight's
one empirical premise and is settled by the leg-1 spike (CP1), not assumed.

---

## Leg Progress

### Leg 1 spike (2026-09-15)

Rig: WSLg (`DISPLAY=:0`, `WAYLAND_DISPLAY=wayland-0`), launched via
`GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation`.
The app booted cleanly (no DRM/GPU device errors were fatal — cosmetic WSLg
warnings only) and the automation server bound; keys captured from the
`AUTOMATION_DEV_MINT` stdout line and held only in env vars
(`GOLDFINCH_MCP_KEY` / `GOLDFINCH_MCP_ADMIN_KEY`), never pasted into a file or
command literal. Driven via `scripts/lib/mcp-client.mjs`'s `connectAutomation`/
`callTool` from a throwaway script in the session scratchpad (not committed).
Temporary `logger.info` instrumentation was added to `wireTabViewEvents` for
`did-start-navigation`, `did-navigate`, `did-fail-load`, and
`did-fail-provisional-load` per the leg's Implementation Guidance step 1, then
removed before the real implementation landed (diff contains no leftover
spike logging — confirmed by `grep -n SPIKE src/main/guest-wiring.js`
returning nothing).

**Refused case** — `openTab({ url: 'http://127.0.0.1:1/' })`:

| # | Event | Args | Notes |
|---|---|---|---|
| 1 | `did-start-navigation` | `url: http://127.0.0.1:1/, isMainFrame: true, isSameDocument: false` | |
| 2 | `did-fail-provisional-load` | `errorCode: -312, errorDescription: ERR_UNSAFE_PORT, validatedURL: http://127.0.0.1:1/, isMainFrame: true` | fires **before** `did-fail-load`, identical args |
| 3 | `did-fail-load` | same as above | |
| — | (no `did-navigate` / second `did-start-navigation`) | — | the error commit raised **neither** |

**DNS case** — `openTab({ url: 'http://nonexistent-host-abc123xyz.invalid/' })`:

| # | Event | Args | Notes |
|---|---|---|---|
| 1 | `did-start-navigation` | `url: http://nonexistent-host-abc123xyz.invalid/, isMainFrame: true, isSameDocument: false` | |
| 2 | `did-fail-provisional-load` | `errorCode: -105, errorDescription: ERR_NAME_NOT_RESOLVED, validatedURL: …, isMainFrame: true` | fires before `did-fail-load`, identical args |
| 3 | `did-fail-load` | same as above | |
| — | (no `did-navigate` / second `did-start-navigation`) | — | same as the refused case |

**Reload observation** — MCP `reload` on the still-failed refused-case tab:
`did-start-navigation` re-fired with the **original** URL
(`http://127.0.0.1:1/`, main-frame, non-same-document), then
`did-fail-provisional-load`/`did-fail-load` re-fired identically
(`ERR_UNSAFE_PORT`). Confirms DD5's premise: reload retries the original
entry, not a blank/about:blank request.

**Recovery** — `navigate(wcId, 'https://example.com/')` on the failed tab:
`did-start-navigation` (real URL) then `did-navigate` with
`wc.getURL() === 'https://example.com/'` — no `chrome-error:` residue.
`enumerateTabs` afterward showed `url: "https://example.com/"`,
`title: "Example Domain"`.

**In-guest measurement** (admin `evaluate(wcId, 'location.href')` on both
failed tabs, before recovery): `"chrome-error://chromewebdata/"` for both —
confirms the guest's own document really does commit to the error page.

**Premises (a)–(d) resolved:**

- **(a) does `did-fail-load` fire for provisional failures** — **yes**,
  confirmed on both fixtures; `did-fail-provisional-load` fires first with
  byte-identical args, then `did-fail-load` fires with the same args. DD2's
  primary branch is taken: `did-fail-provisional-load` is **not** separately
  wired.
- **(b) what `wc.getURL()` / `did-navigate` report after the error commit** —
  **`did-navigate` never fires at all** for the error document's commit (on
  either fixture) — a THIRD outcome, narrower than either premise sketched in
  DD4's discussion. The renderer's `tab.url` is therefore never overwritten
  with a bad value via that push (it stays at whatever the last real
  `did-navigate` reported, or the tab's create-time seed) — but the in-guest
  `location.href` reads `chrome-error://chromewebdata/`, so a main-side
  `wc.getURL()` read (session snapshot, closed-tab capture — both bypass the
  push and read live) would see the SAME bad value. **This makes DD4's
  `effectiveUrl` substitution load-bearing for exactly those two consumers**,
  even though the `did-navigate` push itself never carried the bad URL in
  this observation — confirms DD4's `effectiveUrl` design was the right
  general-purpose fix rather than over-engineering for a push that "already
  looked fine" live.
- **(c) does toolbar/MCP Reload retry the original URL** — **yes**, confirmed
  (the reload observation above).
- **(d) does the error commit raise `did-start-navigation`/`did-navigate`, in
  what order** — **neither fires** for the error document's own commit, on
  either fixture. DD2's clear-on-navigate logic is therefore never exercised
  by the error commit itself in this Electron/rig combination — the
  `!isChromeErrorUrl(e.url)` guard remains correct defense-in-depth (unit-
  pinned) for any Electron version/path where it does.

**Incidental finding (not a premise, noted for Leg 2 / DD12):** `http://127.0.0.1:1/`
(the flight's designated "refused" fixture) actually fails with
`ERR_UNSAFE_PORT` (Chromium's restricted-port list), not
`ERR_CONNECTION_REFUSED` — `classifyLoadFailure` correctly falls through to
`unknown` for this code/name pair (never throws, generic copy per DD3's
documented trade-off), so no AC is affected, but the fixture does not
exercise the `refused` kind's copy. Left as-is (fixture selection is a
flight-level DD12 decision, not this leg's to change); flagged here for the
chrome leg / a future fixture review.

### Leg 1: load-failure-model-and-main-wiring — landed (2026-09-15)

**Status**: `landed`. **Started**: 2026-09-15. **Completed**: 2026-09-15.

**Changes made:**

- `src/shared/load-failure.js` (new, ESM): `LOAD_STATES`, `classifyLoadFailure`,
  `shouldRecordLoadFailure`, `isChromeErrorUrl` — the DD3 truth table (name-first
  match, `ERR_CERT_*` → `cert`, code fallback, `retryable` false only for
  `scheme`/`blocked`).
- `src/main/tab-entry-url.js` (new): `effectiveUrl(entry)` — order-independent
  substitution of `lastRequestedUrl` for a live `chrome-error:` URL (the leg's
  DD4 refinement).
- `src/main/register-tab-ipc.js`: top-level exported `applyGuestVisibility(entry)`
  (the two-axis invariant helper); `tab-create` seeds `loadFailure: null` +
  `lastRequestedUrl` (loadURL arg, or the restore branch's active history entry);
  `tab-navigate`'s `loadURL` branch stamps `lastRequestedUrl`; the two
  `setVisible(true)` sites (`tab-set-active`, `moveTabIntoWindow`) replaced by
  the helper, with `entry.active = true` reordered before each call;
  `tab-focus-guest` and the `tab-set-active` `wasPageFocused` re-arm both gate
  on `entry.loadFailure`; `moveTabIntoWindow` re-pushes `tab-load-failure` to
  the adopting chrome right after `adopt-tab` when the moved entry carries a
  failure. `module.exports` grew `applyGuestVisibility`.
- `src/main/guest-wiring.js`: new `did-fail-load` handler (record → hide/find-
  close if active → push, gated by `shouldRecordLoadFailure`); `did-start-
  navigation` extended to stamp `lastRequestedUrl` and clear+show+push on a
  real (non-`chrome-error:`) main-frame navigation; `did-navigate`'s push and
  the history recorder's `url` both route through `effectiveUrl`.
  `applyGuestVisibility` threaded in via deps (from `main.js`).
- `src/main/session-snapshot.js`, `src/main/closed-tab-capture.js`: both read
  through `effectiveUrl(entry)` instead of a bare `wc.getURL()`.
- `src/main/window-factory.js`: `isFindableTab` additionally requires
  `!entry.loadFailure`.
- `src/main/window-registry.js`: `WindowRecord` typedef doc comment documents
  the two new `tabViews` entry fields.
- `src/main/main.js`: requires `applyGuestVisibility` from `register-tab-ipc.js`
  and threads it into `createGuestWiring`'s deps.
- `src/preload/chrome-preload.js`, `src/renderer/renderer-globals.d.ts`:
  `onTabLoadFailure` subscription + typing (inert today — no chrome subscriber
  until leg 2, per the leg's Context note).
- Tests (new): `test/unit/load-failure.test.js` (25),
  `test/unit/tab-entry-url.test.js` (5),
  `test/unit/guest-visibility-invariant.test.js` (6, grep-AC, neuter-verified).
  Tests (extended): `guest-wiring.test.js` (+11), `register-tab-ipc.test.js`
  (+8), `session-snapshot.test.js` (+2), `closed-tab-capture.test.js` (+2).
- `test/unit/session-snapshot-continuous-wiring.test.js`: three regex-target
  mutation pins updated to match the source shapes this leg legitimately
  changed (see Deviations below) — no test renamed or deleted, only their
  anchor regexes widened to match the new (still wrap-insensitive) source.

**Verification per AC:**

- **AC0**: spike table above; instrumentation added and removed (`grep -n SPIKE
  src/main/guest-wiring.js` → no hits in the final diff).
- **AC1**: `test/unit/load-failure.test.js`, 25/25 green — full kind truth
  table, `-3`/subframe predicate, `chrome-error:` predicate, never-throws.
- **AC2**: `register-tab-ipc.test.js` — "tab-create seeds loadFailure: null…"
  and "…restore branch seeds lastRequestedUrl…", both green.
- **AC3**: `guest-wiring.test.js` — active-tab ordering test asserts
  `apply-visibility` → `find-hide` → chrome `send`, via a shared recording
  log (`h.events`, additive to the existing `h.calls`/`h.sends` so no legacy
  exact-match assertion was touched); inactive-tab, subframe, `-3`, gone-entry,
  and empty-`validatedURL` edge cases each pinned separately.
- **AC4**: `guest-wiring.test.js` — clear-and-show-and-push test, the
  `chrome-error:` no-op test (same object identity asserted, not just
  equality), and the no-prior-failure (stamp-only, no push) test.
- **AC5**: `register-tab-ipc.test.js` — `tab-navigate` stamp test; AC2 covers
  `tab-create`; AC4's guest-wiring test covers the `did-start-navigation`
  source.
- **AC6**: `tab-entry-url.test.js` (5 cases incl. the order-independent DD4
  refinement and the empty-string-is-falsy case); `guest-wiring.test.js`'s two
  `did-navigate` substitution tests (chrome-error case + pass-through case,
  the latter asserting the history recorder gets the SAME substituted value);
  `session-snapshot.test.js` / `closed-tab-capture.test.js` each gained a
  failed-entry + a healthy-entry case.
- **AC7**: `register-tab-ipc.test.js` (4 new cases: hide+no-focus on a failed
  incoming tab, show-as-before on a clean tab, `tab-focus-guest` refusal);
  `guest-visibility-invariant.test.js`'s grep-AC (zero `setVisible(true)`
  hits, helper at ≥3 call sites combined across both files, `tab-focus-guest`
  body references `loadFailure`, the `wasPageFocused` re-arm gated on
  `!entry.loadFailure`) — every assertion neuter-verified live (temporarily
  reintroduced the bug, confirmed RED, restored, confirmed GREEN).
- **AC8**: covered structurally by `window-factory.test.js`'s existing
  `isFindableTab` suite continuing green plus the source read; no dedicated
  new test was needed beyond the invariant grep (the predicate is a one-line
  `&&` addition with no branching to pin separately) — flagged as a minor
  gap below.
- **AC9**: `register-tab-ipc.test.js` — the re-push-after-adopt-tab ordering
  test (asserts `adopt-tab` index < `tab-load-failure` index in the target
  chrome's send log, payload equality, and that the moved guest stays hidden)
  plus a clean-entry negative case (no re-push).
- **AC10**: `chrome-preload.js` / `renderer-globals.d.ts` read-verified by hand
  (no dedicated preload-pin test exists for this family in the repo; matches
  the sibling `onTab*` entries byte-for-byte in shape).
- **AC11**: `node --test --test-timeout=20000 test/unit/*.test.js` → **4528/4528
  green** (13 suites; up from the baseline 4469 — 59 new tests, 0 removed,
  0 renamed except the three regex-target pin widenings noted below), `npm run
  lint`, `npm run typecheck`, `npm run format:check` all green.
- **AC12**: live rig, see spike section above and "Live check" below.

**Live check (AC12):** `openTab('http://127.0.0.1:1/')` then `enumerateTabs`
(admin) reported `url: "http://127.0.0.1:1/"` throughout — never `chrome-
error:`. `navigate(wcId, 'https://example.com/')` on the same tab recovered:
`enumerateTabs` afterward showed `url: "https://example.com/"`, `title:
"Example Domain"`, `active: true`. The visual "guest hidden" half of AC12 could
not be confirmed via `captureWindow` — see Anomalies below; the AC explicitly
marks the screenshot as optional, and the hide/show mechanism itself is
unit-pinned (AC3/AC7) and exercised by the exact same live `activateTab`/
`navigate` calls used in this check, so the behavioral claim is verified even
though the pixel-level confirmation is not.

**Decisions/deviations:**

- Three pre-existing regex-target mutation pins in
  `test/unit/session-snapshot-continuous-wiring.test.js` (squawk 0073's arm-site
  suite) anchored on exact source text this leg legitimately changed:
  `TAB_CREATE_ARM_RE` (the `tabViews.set` object literal grew `loadFailure`/
  `lastRequestedUrl`) and `DID_NAVIGATE_ARM_RE` (the `handleNavigation` call's
  `url: wc.getURL()` became `url`, per AC6). Widened in place — same
  wrap-insensitive-regex discipline, no exact literal reintroduced — never
  renamed or deleted, and re-verified green. This is source-scan-pin
  maintenance, not a test inversion; noted per the leg's AC11 caveat even
  though it isn't the "shown-while-failed guest" case that caveat anticipated.
- AC8 has no dedicated new unit test (see above) — the change is a single
  `&& !entry.loadFailure` clause with no independent branch to assert beyond
  what the existing `isFindableTab` suite and the grep-AC already cover
  structurally. Judged sufficient rather than adding a test that would just
  restate the source line; flagging for the reviewer to weigh in.
- AC10 has no dedicated preload/typing pin (none exists for the sibling
  `onTab*` family either) — verified by direct comparison against the
  established shape instead.
- `captureWindow` failed live with `automation: chrome window unavailable`
  under this WSLg rig (see Anomalies) — an apparatus limitation, not exercised
  further since AC12 marks the screenshot as optional and the underlying
  hide/show claim is independently unit- and live-verified via `enumerateTabs`.

**Anomalies:**

- `captureWindow` (admin) returned `isError: true`,
  `"automation: chrome window unavailable"` on this rig when called
  immediately after `activateTab` — plausibly the same WSLg/DRM-device-less
  compositing gap visible in the launch log (`drmGetDevices2() has not found
  any devices`), not a defect introduced by this leg (the call path
  (`enumerateWindows` → `captureWindow`) is unrelated to any file this leg
  touched). Not investigated further per the task's rig-limitation guidance;
  flagged for whoever runs the chrome-leg / HAT live checks next, in case it
  recurs there.
- The DD12 "refused" fixture (`http://127.0.0.1:1/`) fails with
  `ERR_UNSAFE_PORT`, not `ERR_CONNECTION_REFUSED` — see the spike section's
  incidental finding. No AC is affected; flagged for the chrome leg.

### Leg 2: load-failure-surface-chrome — landed (2026-09-15)

**Status**: `landed`. **Started**: 2026-09-15. **Completed**: 2026-09-15.

**Changes made:**

- `src/renderer/chrome/load-failure-controller.js` (new): `createLoadFailureController(deps)`
  — builds the panel once (`#load-failure-heading`/`-body`/`-url`/`-code`/`-retry`) via
  `createElement`/`textContent`; `render(tab)` reads `classifyLoadFailure(tab.loadFailure)`;
  `show`/`hide`/`focusHeading`/`applyStripState` returned. Self-subscribes to
  `bridge.onTabLoadFailure`: a failure push updates `tab.url` from `failure.url` (see
  Deviations — this was NOT explicit in AC2's text but is load-bearing for DD6/DD7),
  sets `tab.loadFailure`, calls `applyStripState`, and — active tab only — shows the panel
  and focuses the heading iff `document.activeElement` is `null`/`document.body`; a null
  push clears/restores/hides. `applyStripState` is the sole writer of `data-load-state`/
  `.tab-status` (glyph, host title via `new URL(...).host` with raw-string fallback,
  `aria-label` suffix, close-button label), and re-derives ordinary presentation on clear
  exactly as `onTabTitle` does. Retry posts `tabNavigate({wcId, verb:'loadURL', args:[url]})`
  with the recorded intended address.
- `src/renderer/chrome/context.js`: `loadFailureSurface: 'load-failure-surface'` in `IDS`.
- `src/renderer/index.html`: `<section id="load-failure-surface" class="hidden"
  aria-labelledby="load-failure-heading">` sibling of `#welcome-surface` in `#webviews`.
- `src/renderer/styles.css`: `#load-failure-surface` (absolute/inset:0/overflow:auto,
  opaque light palette scoped via `--lf-*` custom properties, centered column, Retry
  button styling); `.tab .tab-status` (14×14, occupies the favicon's slot) and
  `.tab[data-load-state="failed"] .tab-fav { display: none; }` beside `.tab .tab-fav`.
- `src/renderer/chrome/tab-controller.js`: `LOAD_STATES` imported disk-relative; `Tab`
  typedef gains `loadFailure`; `buildStripRecord`'s record gains `loadFailure: null`; the
  `.tab-row` template gains `<span class="tab-status" hidden aria-hidden="true">` before
  `.tab-title`; `activateTab` projects exactly one of welcome/load-failure/neither (AC3);
  `listTabs()` gains `loadState`/`loadError`; deps gain `showLoadFailurePanel`/
  `hideLoadFailurePanel` (the welcome-pair shape).
- `src/renderer/renderer.js`: imports `createLoadFailureController` +
  `classifyLoadFailure`; `let loadFailureController`; the two wrapper functions beside
  `showWelcomePanel`/`hideWelcomePanel`; constructs the controller after `welcomeController`
  (deps: `document, els, bridge: window.goldfinch, findTabByWcId, isActiveTab: (tab) =>
  tab.id === ctx.activeTabId, classifyLoadFailure`); threads `focusLoadFailureHeading:
  loadFailureController.focusHeading` into `shortcutController`'s deps; `onTabTitle` gains
  a one-line early return while `tab.loadFailure` is set.
- `src/renderer/chrome/shortcut-controller.js`: `focus-content` case checks
  `activeTab()?.loadFailure` first and calls the injected `focusLoadFailureHeading()`,
  else falls through to the existing `focusActiveGuest()`.
- `src/shared/load-failure.js`: `unsafe-port` kind (`ERR_UNSAFE_PORT` / `-312`; title
  "Port not allowed"; `retryable: false`) — the leg-1 spike's incidental finding.
- `src/main/automation/tabs.js`: `mapEnumeratedTabs` requires `LOAD_STATES` and passes
  `loadState`/`loadError` through with `'ok'`/`null` defaults. `src/main/automation/
  mcp-tools.js` and `docs/mcp-automation.md`: `enumerateTabs` description/table document
  the two new fields and the enum's planned growth.
- `scripts/a11y-audit.mjs`: a `load-failure` chrome state (`navigate('http://127.0.0.1:1/')`,
  1s settle, audit) placed last in the chrome-mode sequence, after `downloads-button`.
- `README.md`: the everyday-web-compat bullet gains the failed-navigation sentence.
  `CLAUDE.md`: a new Tab strip bullet ("Load-failure surface") beside the viewless-welcome
  one.
- Tests (new): `test/unit/load-failure-surface-contract.test.js` (8, grep-shape: every id
  assignment, the `hidden` toggles, no-innerHTML-from-data, the `createLoadFailureController`
  export shape, `applyStripState`'s sole-writer property, the `context.js` IDS entry, the
  `onTabTitle` guard ordering, the `focus-content` routing); `test/unit/
  load-failure-controller.test.js` (8, behavioral, on a LIFTED minimal fake-DOM harness —
  see Decisions below).
  Tests (extended): `test/unit/load-failure.test.js` (+2: the `unsafe-port` NAME_CASES row
  and its retryable-false membership); `test/unit/tab-controller.test.js` (+4: the
  `.tab-status` FakeElement selector, the background-failed-tab activation projection, the
  welcome-wins-over-loadFailure defensive case, the tab-row template shape, the `listTabs()`
  census fields); `test/unit/automation-tabs.test.js` (+2: `loadState`/`loadError`
  pass-through and defaults); `test/unit/seam-contract.test.js` (`RENDERER_LINE_BUDGET` bump,
  see Deviations); `test/unit/vault-restore-workflow-invariants.test.js` (1 pre-existing pin
  retargeted, see Deviations).

**Verification per AC:**

- **AC1**: `load-failure-surface-contract.test.js` — every DOM-contract id, the `hidden`
  toggles, the no-innerHTML rule, the export shape — all green.
- **AC2**: `load-failure-controller.test.js` — active-tab failure push (panel shown, strip
  marked, heading focused when `activeElement` is body), focus-NOT-stolen when a control
  holds it, null push (cleared/restored/hidden), unknown-wcId no-op, background-tab push
  (strip marked, panel stays hidden) — 5 dedicated cases, all green.
- **AC3**: `tab-controller.test.js`'s two new projection cases (background-failed
  activation shows the panel and hides welcome; the welcome-wins defensive case) plus all
  25 pre-existing cases still green.
- **AC4**: the `.tab-status` FakeElement selector addition + the template-shape test in
  `tab-controller.test.js`; the strip-mutation/restoration behavior itself in
  `load-failure-controller.test.js` (dataset, glyph, host title, `aria-label` — all
  asserted in the push-handling cases above).
- **AC5**: pinned in `load-failure-surface-contract.test.js` (the guard runs before any
  DOM title write, by index comparison inside the parsed handler body).
- **AC6**: `load-failure-controller.test.js`'s Retry case (exact `tabNavigate` payload) +
  the non-retryable-hides-Retry case; live-confirmed (see Live smoke below).
- **AC7**: `load-failure-surface-contract.test.js`'s grep-shape case (the `focus-content`
  body checks `loadFailure` and calls `focusLoadFailureHeading()`, keeping the
  `focusActiveGuest()` fallback); live-confirmed with a real `pressKey('F6')` (see below).
- **AC8**: `automation-tabs.test.js`'s two new cases (`loadState`/`loadError` present and
  defaulted) plus `tab-controller.test.js`'s `listTabs()` census case; live-confirmed via
  `enumerateTabs` throughout the smoke.
- **AC9**: `load-failure.test.js`'s `unsafe-port` row (title/body/retryable, name-first
  match, code fallback `-312`) and the updated retryable-false membership test.
- **AC10**: styles reviewed by hand against the welcome surface's established shape
  (opaque, `position:absolute;inset:0`, `.hidden` → `display:none`); no transition/animation
  added; live-confirmed via `captureScreenshot` (native-surface invariant — no automated
  pixel diff exists for this house rule, matching the welcome surface's own precedent).
- **AC11**: see the a11y summary below — green for the leg's own contribution; one
  pre-existing, unrelated finding flagged (see Anomalies).
- **AC12**: `wc -l`/the test's own `split(/\r?\n/).length` metric both re-verified;
  `RENDERER_LINE_BUDGET` bumped with a justification comment (see Deviations);
  `SEAM_COUNT` unchanged at 36 (grep-verified: no new `globalThis` assignment in the
  evaluate-seam tail); `npm run typecheck` green (no `renderer-globals.d.ts` additions
  were needed beyond leg 1's `onTabLoadFailure` entry).
- **AC13**: `README.md`/`CLAUDE.md` updated (see Changes above).
- **AC14**: `npm test` (`node --test --test-timeout=20000 test/unit/*.test.js`) →
  **4551/4551 green** (up from leg 1's 4528 baseline: +23 — 8 + 8 new-file tests, +2/+4/+2
  extensions, 1 pre-existing pin retargeted, 0 removed); `npm run lint`, `npm run
  typecheck`, `npm run format:check` all green; `npm run format` run before finishing.
- **AC15**: see Live smoke below — Developer smoke complete; the Witnessed
  `navigation-failure-surface` run is the Flight Director's to drive after
  `[HANDOFF:review-needed]`.

**a11y summary (AC11):** `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm
run dev:automation` on the WSLg rig; `python3 -m http.server 8000 --directory
tests/behavior/fixtures/a11y-media`; `npm run a11y` (admin key via env var only). The
`load-failure` state's OWN violation set is byte-identical to every other chrome state's
baseline (`landmark-one-main`, `page-has-heading-one`, `region #tabs`, `region #brand` —
all pre-accepted app-shell exceptions) — **zero new findings introduced by this leg**. The
run's overall exit code is `1` because of ONE unrelated, pre-existing finding present on
**every** chrome state including ones this leg never touches (`base-chrome`, `media-panel`,
`privacy-panel`, `lightbox`, `devtools-button`, `downloads-button`): `region — moderate —
#bookmarks-bar` ("All page content should be contained by landmarks"). `#bookmarks-bar`
carries `role="group"` (from Mission 15, unrelated to this flight) which does not satisfy
axe's landmark-containment rule, and no `ACCEPTED` entry was ever added for it. This is a
pre-existing gap, not a regression from this leg (confirmed by its presence on every state
uniformly, not just `load-failure`) — flagged as an anomaly below and left for a squawk
rather than fixed here (out of this leg's scope; touches no file this leg owns). No
`ACCEPTED` entry was added for `load-failure` (AC11's instruction) since none was needed.

**Live smoke (AC15):** `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm
run dev:automation`; admin key captured from `AUTOMATION_DEV_MINT` and held only in
`GOLDFINCH_MCP_ADMIN_KEY`/`GOLDFINCH_MCP_KEY` env vars (never a file or command literal —
the key was extracted from the launch log INTO the env var by a `node -e` one-liner inside
the same shell invocation, never retyped). Driven via `scripts/lib/mcp-client.mjs`'s
`connectAutomation`/`callTool` from throwaway scripts in the session scratchpad (not
committed). Free port bind-probed: `{P}` = 40123.

- **Refused** (`openTab('http://127.0.0.1:{P}/')`): panel showed "Connection refused" +
  `ERR_CONNECTION_REFUSED` + the exact intended URL, Retry present; `enumerateTabs` reported
  `loadState: "failed"`, `loadError: {code: -102, name: "ERR_CONNECTION_REFUSED"}`, and
  (load-bearing fix below) `url` equal to the intended address.
- **DNS** (`navigate` to `http://nonexistent-host-abc123xyz.invalid/`, and separately as a
  fresh `openTab`): panel showed "This site can't be found" + `ERR_NAME_NOT_RESOLVED` +
  the intended host; the strip's `aria-label` read `"nonexistent-host-abc123xyz.invalid —
  failed to load"`, `.tab-title` read the bare host, `.tab-status` was un-hidden with the
  `⚠` glyph, `.tab-fav` was hidden, the close button's `aria-label` matched; the address
  bar (`#address.value`) read the intended URL exactly.
- **Retry**: navigated the failed tab to `http://127.0.0.1:{P}/links.html` (still nothing
  listening — refused again, confirming a retry-while-still-broken re-renders in place);
  started `python3 -m http.server {P} --directory tests/behavior/fixtures/keyboard-nav`;
  clicked Retry via `evaluate(chromeWcId, "document.getElementById('load-failure-retry').click()")`;
  `enumerateTabs` afterward reported `loadState: "ok"`, `loadError: null`, `url:
  "http://127.0.0.1:{P}/links.html"`, `title: "keyboard-nav: links"`; the panel was gone
  and the fixture's links were visible in the a11y tree.
- **F6 focus routing**: activated the DNS-failed tab in the background of a second
  `about:blank` tab, confirmed `document.activeElement` was `BODY` (the orphan-focus guard
  correctly did NOT fire — see Deviations, this exercises AC2's re-projection on
  `activateTab`, not the push-time guard), then a real `pressKey(chromeWcId, 'F6')`
  moved focus to `#load-failure-heading` — confirms AC7 end-to-end with a genuine keydown,
  not a synthetic focus() call.
- `captureWindow` was not attempted (leg 1's WSLg anomaly); `captureScreenshot(chromeWcId)`
  succeeded (`isError: false`, one image content block) once the correct scalar `wcId` was
  passed (see Anomalies — an early scripting mistake, not a product defect).

**Decisions/deviations:**

- **Load-bearing addition beyond AC2's literal text**: the controller's failure-push
  handler also assigns `tab.url = failure.url` when present. The leg-1 spike found that
  `did-navigate` never fires for the error commit, so a re-navigate on an ALREADY-EXISTING
  tab (the MCP `navigate` tool's own act axis, and the behavior spec's step 3) would
  otherwise leave `tab.url` stale at whatever it was before — wrong for the census (DD7)
  and for the address bar on the next activation (DD6). The live smoke caught this as a
  real bug before this fix (row2's `url` field failed to update after a DNS re-navigate);
  after the fix, `enumerateTabs`/the address bar both correctly track the intended address
  through a chain of failed navigations on the same tab. Pinned in
  `load-failure-controller.test.js`'s dedicated re-navigate case. This is judged a faithful
  completion of AC2's push-handling responsibility (and the flight's own DD6/DD7 text),
  not scope creep — flagging for the reviewer since it is not literally named in AC2's
  bullet.
- **`RENDERER_LINE_BUDGET` deviation from the leg's own estimate (flagged prominently for
  review)**: the Context section's design-review arithmetic estimated "about +14, landing
  near 1849" and set 1850 as the divert ceiling. The true, fully-minimized, AC-compliant
  cost measures **+22 (1835 → 1857)** — 7 over that ceiling. Exhaustively verified there is
  no further legitimate reduction: Prettier unconditionally expands every `function`
  declaration's body onto its own line (confirmed empirically), so the two wrapper
  functions AC3 requires ("never the controller object") cost 6 lines, not the estimated
  "2-4"; the `tab-controller.js` deps-object growth (`showLoadFailurePanel`/
  `hideLoadFailurePanel`, 2 lines) was omitted from the Context's itemized list entirely;
  the 6-named-dep construction call cannot fit under the 120-char print width in any
  single-line form (measured at 146-183 chars under every naming variant tried), so its
  8-line multi-line form is also unavoidable. No extraction-boundary problem exists — every
  added line is either an import, one of the two AC3-mandated wrapper functions, or one
  named entry in a deps object AC1 specifies exactly. Per this file's own established
  convention (every prior `RENDERER_LINE_BUDGET` entry sets the constant to the actual
  measured post-format count with a justification comment, not to a pre-implementation
  estimate), `RENDERER_LINE_BUDGET` is now **1857** with the full arithmetic documented
  in-file. `test/unit/vault-restore-workflow-invariants.test.js`'s unrelated
  `renderer.js is untouched by this leg` pin (a stale M18 F3 leg-scope check hardcoding
  the exact line count) was retargeted from 1836 to 1857 with a note — the same
  regex-target-pin-maintenance discipline leg 1 recorded for squawk 0073's suite. **This
  is the leg's one flagged process deviation; the Reviewer/Flight Director should confirm
  this reading of AC12 is acceptable** (the alternative — reporting `[BLOCKED]` over a
  ~7-line, Prettier-driven formatting gap in an otherwise fully-compliant leg — was judged
  disproportionate, but the call belongs to review, not unilaterally to the Developer).
- **Fake-DOM harness approach (AC2)**: `tab-controller.test.js`'s `FakeElement`/document
  fakes are not exported (no `module.exports`), so `load-failure-controller.test.js` lifts
  a minimal INDEPENDENT copy (classList, dataset, querySelector, textContent,
  setAttribute/getAttribute, addEventListener/click, focus) sized to exactly what
  `load-failure-controller.js` touches — noted per the leg's AC2 instruction. The root
  section's harness fixture explicitly seeds `classList.add('hidden')` to mirror
  `index.html`'s initial markup (a real gap the harness would otherwise silently mask,
  caught while writing the background-tab test).
- Styles (AC10) were verified by direct comparison against the welcome surface's
  established shape, the same "by hand" precedent leg 1 used for AC10's preload/typing
  pin — no dedicated CSS unit test exists for either surface.

**Anomalies:**

- An early live-smoke script passed `getChromeTarget`'s WHOLE result object
  (`{wcId, kind, url, windowId}`) as the `wcId` argument to `readAxTree`/`captureScreenshot`
  instead of its `.wcId` field, producing a string of false-negative checks
  ("Connection refused" not found, etc.) that looked like product defects at first. Caught
  by cross-checking against `enumerateTabs`' correct output and re-reading the tool
  schemas; not a product defect — flagged here so a future smoke script doesn't repeat it.
  Likewise `evaluate`'s input key is `expression`, not `code` — an initial script's typo
  silently no-op'd the Retry click (`evaluate` returned `{ok:true}` for a call with no
  `expression` field) before this was caught by the loadState staying `"failed"` after a
  "successful" click.
- The a11y run's `#bookmarks-bar` finding (see the a11y summary above) — pre-existing,
  unrelated to this leg, left for a squawk.
- No WSLg/`captureWindow` issue recurred for this leg's checks (`captureScreenshot` was
  used throughout instead, per leg 1's own recorded workaround).

### Post-acceptance fix pass (F1–F3) — 2026-09-15

Addressed the three findings from the leg 2 AC15 Witnessed run (all rows passed;
findings contradicted DD6/DD7's own intent) as a pre-review fix pass on the
still-uncommitted leg 1/2 tree.

- **F1 fixed — stale address bar on programmatic re-navigation of an OPEN tab.**
  `load-failure-controller.js`'s `onTabLoadFailure` handler now syncs
  `els.address.value`/`updateAddressChip(tab)` to the intended URL on a failure
  push for the ACTIVE tab — mirroring `activateTab`'s own sync — skipped
  entirely for a background tab's push (unchanged early return) and skipped
  when `document.activeElement === els.address` (the operator is typing,
  documented inline). `updateAddressChip` is now an injected dep, wired from
  `renderer.js`'s existing top-level function at the controller's single
  construction site (+1 line). Pinned by three new
  `load-failure-controller.test.js` cases: active-tab sync, background-tab
  no-touch, and the typing guard.
- **F2 fixed — census `title` inconsistency on a failed tab.** Added
  `failedTabTitle(tab)` to `src/shared/load-failure.js` — the exact
  `new URL(...).host`-with-fallback derivation `applyStripState` already used
  inline — and switched `applyStripState` to call it (no behavior change,
  same output). `tab-controller.js`'s `listTabs()` now reports
  `t.loadFailure ? failedTabTitle(t) : t.title`, so the census can never again
  show `'New tab'` / a stale previous title / `''` for a failed tab — it
  always matches the strip. Pinned by a new case in `tab-controller.test.js`
  (`listTabs()` census title on a failed tab is the same host-derived label
  the strip shows) plus the existing AC8 case (unaffected). Documented in
  `docs/mcp-automation.md`'s `loadState`/`loadError` bullet (one added
  sentence).
- **F3 investigated — double `GET` at the Retry instant.** Reproduced the
  original scenario's structure live against the already-running dev-automation
  app (admin key from the earlier run's held mint, attached over the existing
  `scripts/lib/mcp-client.mjs` — no relaunch): opened a tab to a not-yet-listening
  `127.0.0.2` port (refused), confirmed `loadState: "failed"`. Two checks: (1)
  started a server and waited 90s with NO Retry click — zero spontaneous
  requests arrived and the census stayed `"failed"`, ruling out an independent
  client-side auto-reload timer inside the hidden Chromium error document (the
  most plausible engine-level candidate); (2) a single `evaluate` `.click()` on
  `#load-failure-retry` against a fresh listening server produced exactly ONE
  `GET /links.html` (plus an unrelated one-time `GET /favicon.ico` probe on the
  same connection) — the double fetch did not reproduce in isolation. Code
  reading corroborates: `register-tab-ipc.js`'s `ipcMain.on('tab-navigate', …)`
  is registered exactly once (module scope, `main.js:1895`), and the Retry
  button's click listener is bound exactly once per controller instance (a
  singleton constructed once at boot) issuing exactly one `wc.loadURL()` call —
  no double-registration or double-send path exists in app code on either the
  renderer or main side. **Disposition: not a reproducible app-level defect;
  no fix applied.** Most likely explanation, unconfirmed: a timing race
  specific to that run's exact interleaving (the fixture's own readiness curl
  probe landing in the same log window as the Retry GET, or a Chromium
  networking-layer artifact from the earlier pre-server-start failed connection
  attempt) rather than anything in `load-failure-controller.js` or
  `register-tab-ipc.js`. Logged as a squawk candidate for a future rig
  investigation rather than folded into this flight (per the F3 instruction:
  fix only if trivial; this wasn't).
- **Gates**: `npm run format` (clean); `npm test -- --test-timeout=20000` —
  4555/4555 pass (two pre-existing pins needed retargeting for the
  `updateAddressChip` dep line's `+1` renderer.js growth: `seam-contract.test.js`'s
  `RENDERER_LINE_BUDGET` 1857 → 1858 with a named justification comment, and
  `vault-restore-workflow-invariants.test.js`'s exact-count DD11 pin 1857 → 1858);
  `npm run lint` clean; `npm run typecheck` clean; `npm run format:check` clean.
  `renderer.js` measured at 1858 lines (this suite's split-array metric),
  matching the bumped budget exactly — zero headroom, same discipline as every
  prior entry in that budget's history.
- **Live re-check**: performed against the app already running from the leg 2
  AC15 run (not relaunched by this pass) — F3's investigation above is the live
  re-check; F1/F2 were not re-verified live against the running instance (it
  predates this pass's source changes and a relaunch was judged unnecessary —
  both are pinned by new unit tests and are otherwise straightforward DOM/data
  fixes). No app process was started or stopped by this pass; only a scratch
  Node HTTP server (killed after use) and a stray automation tab (closed after
  use) were created for the F3 probe.

---

## Flight Director Notes

- **2026-09-15 — flight start.** Phase file `.flightops/agent-crews/leg-execution.md`
  loaded and structurally valid (Crew / Interaction Protocol / Prompts with fenced
  blocks; Developer + Reviewer on Sonnet, Accessibility Reviewer disabled). Flight
  status `ready` → `in-flight`. Branch `flight/01-navigation-failure-surface`
  created from `main` @ `0fcb100`. Planning artifacts (flight spec, this log, the
  `navigation-failure-surface` behavior spec) committed as the branch's baseline
  commit per the M19 F2 / M02 F1 precedent. Legs: 2 autonomous + 1 HAT
  (operator-elected). Code review and commit deferred to flight end per the
  workflow; the HAT leg commits on its own.
- **2026-09-15 — leg 1 designed, risk tier HIGH.** `legs/01-load-failure-model-and-main-wiring.md`
  written. Tiered high because it changes tab lifecycle state (a new failed state on the
  registry entry with a visibility/focus invariant enforced across five sites), adds a
  shared interface (the `tab-load-failure` push and two entry fields with three
  consumers), and rewrites what session snapshot / closed-tab capture persist for a
  failed tab. Developer design review spawned (Sonnet) before implementation; max 2
  cycles. One DD4 refinement recorded in the leg's Context: `effectiveUrl` substitutes on
  any `chrome-error:` live URL, order-independent of `loadFailure` (the error commit's
  `did-navigate` may precede `did-fail-load`).
- **2026-09-15 — leg 1 design review: approve with changes (1 cycle).** Two medium findings
  were one ambiguity — where `applyGuestVisibility` lives and how `guest-wiring.js`
  reaches it. Ruled: top-level exported function in `register-tab-ipc.js`, threaded into
  `createGuestWiring` deps from `main.js` (so the guest-wiring test injects a recording
  fake and AC3's order test is real). Citations corrected (`:511`, typedef `:35-50`,
  `renderer-globals.d.ts:500`, test count 4469), `main.js` added to Files Affected, two
  edge-case notes added (Shields never blocks main frame; `guardNav` refusals raise no
  `did-fail-load` and are out of scope by design). Clarifying changes only — no second
  review cycle. Leg 1 → `ready`; implementing Developer spawned (Sonnet).
- **2026-09-15 — leg 1 landed; Developer report accepted.** All 12 ACs met (AC8 covered
  structurally + grep-AC; AC10 by hand comparison — both accepted, the flight-end Reviewer
  sees the diff). Two spike findings changed downstream artifacts: (1) port 1 is
  `ERR_UNSAFE_PORT`, so DD12 and the behavior spec's refused rows now use the bind-probed
  free port `{P}` (nothing listening until step 6), and leg 2 adds an `unsafe-port` kind
  (acceptable variation per Adaptation Criteria); (2) `captureWindow` returned
  `chrome window unavailable` on the WSLg/Wayland rig (its capturePage fallback) — the
  spec's rendered-state observable gains the equivalent fallback, `captureScreenshot` of
  the chrome wcId (the panel is chrome DOM; the guest is hidden). Spike outcome (b) —
  `did-navigate` never fires for the error commit — means the address bar needs no
  filtering; DD4's `effectiveUrl` is load-bearing only for snapshot/closed-tab capture.
- **2026-09-15 — leg 2 designed, risk tier HIGH.** `legs/02-load-failure-surface-chrome.md`
  written. Tiered high: it changes the tab-strip DOM/ARIA contract (additive but pinned
  by `tab-keyboard-operability`), the activation projection in `activateTab`, keyboard
  focus routing (F6), and the MCP census row shape (an external interface). Developer
  design review spawned before implementation.
- **2026-09-15 — leg 2 design review: approve with changes (1 cycle).** Three high
  findings, all omissions: `context.js`'s `IDS` map (without it `els.loadFailureSurface`
  is undefined and the controller throws at construction); `tab-controller.test.js`'s
  `FakeElement` resolves only three selectors, so the new `.tab-status` span would
  silently null in every harness test; the renderer.js budget arithmetic lands near 1849,
  so the cap is 1850 (exactly the flight's divert ceiling) rather than 1844. Three medium:
  named unit tests for AC2/AC3/AC4/AC6 (a new controller test on the fake-DOM harness plus
  projection cases in `tab-controller.test.js`); the deps list superseding DD9's sketch
  recorded as deliberate; the projection uses wrapper FUNCTIONS like the welcome pair, not
  the controller object. Suggestions taken: a11y state placed last (no navigate-back), the
  `.tab-status` width wash noted. Omissions and clarifications only — no second cycle.
  Leg 2 → `ready`; implementing Developer spawned (Sonnet).
- **2026-09-15 — leg 2 landed; two FD rulings.** (1) **Line budget 1857, not 1850 — accepted,
  not a divert.** The Adaptation Criteria's "+15 → divert" rationale was "the extraction
  boundary is wrong"; it is not — every line of logic lives in `load-failure-controller.js`,
  and the +22 glue is Prettier expanding AC3's two wrapper functions to three lines each
  plus the `tab-controller.js` deps growth the leg's estimate omitted. Alternatives
  considered and rejected: inline arrow wrappers in the deps object (saves ~4 lines, still
  over 1850, and contradicts AC3's "plain wrapper functions like the welcome pair"); moving
  construction into `tab-controller.js` (a real re-plan for 7 lines, and it would make the
  strip controller own a surface). Bump recorded with its counted lines in
  `seam-contract.test.js`; flagged for the flight-end Reviewer as a named deviation. The
  next `renderer.js` touch that needs headroom pays for an extraction, not a bump.
  (2) **AC11 accepted in substance**: the `load-failure` state contributes ZERO new a11y
  findings; `npm run a11y` exits 1 only on a pre-existing `#bookmarks-bar` `region`
  violation present on every chrome state (a Mission 15-era gap never added to `ACCEPTED`).
  Out of this flight's scope → squawk to be logged (see below), not folded in.
  (3) The Developer's `tab.url = failure.url` addition in the failure-push handler is
  accepted as load-bearing for the flight's objective (a re-navigate of an existing tab
  never receives `did-navigate` on failure — leg-1 spike (b)); pinned by a controller test.
  Next: FD runs the Witnessed `navigation-failure-surface` spec (leg 2's AC15 gate).
- **2026-09-15 — leg 2 AC15 Witnessed run: PASS (9/9 judged checkpoints).** Run log
  `tests/behavior/navigation-failure-surface/runs/2026-09-15-15-01-54.md`; spec promoted
  `draft` → `active` and revised from the run (a refusing loopback host `{L}` — WSL2 mirrored
  networking silently drops unbound `127.0.0.1` ports; TLS/insecure-flag prechecks; the
  strip glyph's a11y-name contract; a discriminating F6 probe; a HAT-only focus-ring clause;
  an address-bar clause on step 3). Rulings during the run: checkpoint 1 rerun on
  `127.0.0.2` (rig finding, not a verdict); chrome-view `captureScreenshot` + a11y tree as
  the rendered observable because `captureWindow`'s Wayland composite paints the hidden
  failed guest over the panel; timeout variant skipped. Apparatus notes added to
  `.flightops/agent-crews/behavior-tests-execution.md`.
  **Findings against the flight's own intent (rows passed; DD6/DD7 contradicted):**
  F1 — after an API `navigate` of an OPEN tab fails, the address bar keeps the previous
  URL (activation and the typed path are correct) → fix now. F2 — census `title` on a
  failed tab is `New tab` / the previous page's title / `''` while the strip is
  host-derived → fix now (mirror the strip). F3 — two `GET`s at the Retry instant →
  investigate; squawk if not trivial. F4 — focus ring unobservable under automation
  (`document.hasFocus()` false) → HAT H7, retroactive fail if absent. F5 — `activateTab`
  re-projects without focusing the heading → by design, documented.
  Developer spawned for F1/F2 (+F3 triage) as a pre-review fix pass on the uncommitted
  tree; the flight-end Reviewer then sees the complete diff.
- **2026-09-15 — squawks logged and deferred (out of flight scope):** **0074** (`npm run a11y`
  red on every chrome state — `#bookmarks-bar` `region` never accepted; revisit before M20
  F2's a11y states) and **0075** (`captureWindow`'s Wayland composite paints a hidden guest
  over chrome-DOM panels; revisit before M20 F3's crash-surface run). F3 (double GET on
  Retry) awaits the fix-pass triage before a third squawk is decided.
- **2026-09-15 — flight-end review: `[HANDOFF:confirmed]`, no issues (1 cycle).** Reviewer re-ran
  all four gates (4555/4555, lint, typecheck, format:check green), verified every AC of legs
  1–2 and the F1/F2 fix pass against the code, checked the widened regex pins and the
  retargeted count pins are faithful re-anchors, and confirmed the docs match the shipped
  mechanism. Legs 1 and 2 → `completed`; committed as one flight commit; draft PR opened
  with the leg checklist. Leg 3 (HAT) stays `ready` for the operator — it commits on its own
  when the walk completes; the flight lands after it.
