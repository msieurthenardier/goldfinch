# Flight: The Failure Surface and Navigation Errors

**Status**: in-flight
**Mission**: [No Silent Failures](../../mission.md)

## Contributing to Criteria

- [ ] A failed navigation never renders an empty document (address + reason +
      retry; behavior-test-backed)
- [ ] Failure is visible from the tab strip; the address bar keeps the intended
      address
- [ ] New surfaces are safe and accessible — text-only rendering of engine
      strings, keyboard-operable, a11y-audited, and the automation census
      reports each tab's load state (this flight introduces the field with
      `ok` / `failed`; Flights 2 and 3 add their values)
- [ ] *(partial, until Flight 2)* Certificate failures reach the same generic
      surface — no navigation fails blank on a certificate error

---

## Pre-Flight

### Objective

Give every failed top-frame navigation an explanatory, retryable surface, and
decide — once, for the whole mission — how a tab with no page to show presents
that surface. Main learns about the failure from the engine event it currently
ignores, records it on the tab's own registry entry, hides the guest view while
the tab is failed, and pushes the failure to the owning chrome; the chrome
renders an app-authored explanation (address, reason, retry) in the guest slot,
marks the tab in the strip, keeps the intended address in the address bar, and
reports the state in the automation census. Certificate failures ride the same
surface with certificate copy until Flight 2 intercepts them earlier.

### Open Questions

- [x] Surface mechanism — chrome DOM / overlay view / in-guest document → DD1
      (operator ruling 2026-09-15: chrome-owned panel, guest hidden)
- [x] Which engine event(s) carry the failure, and what to ignore → DD2
- [x] Where the "intended address" lives after a failure → DD4 (design is
      branch-complete; the *spike* in leg 1 records which branch is exercised)
- [x] Does the toolbar Reload retry the intended address on an error page →
      DD5 (spike; both outcomes designed)
- [x] Census field shape and who sources it → DD7
- [x] Behavior-test apparatus, act and observe axes → DD11
- [x] Fixtures for each failure class → DD12
- [x] HAT leg → yes, small (operator ruling 2026-09-15)
- [x] Timeout class → optional long-wait variant row (operator ruling)
- [x] Architect second pass (2026-09-15): **approve with changes** — all
      first-pass findings confirmed resolved against source; remaining items
      (name the F6 routing site; refresh drifted `tab-set-active` line
      citations; acknowledge the unreachable `page-context-correct` focus
      site) folded into DD1, DD6, DD9, DD11. Review cycles exhausted (2/2).
- [x] Architect design review (2026-09-15): **approve with changes** — three
      high findings (move-path show site; focus axis via F6/re-arm; title
      clobber) and three medium (error-commit clear race; restore-branch
      `lastRequestedUrl`; activation-time projection) folded into DD1, DD2,
      DD4, DD6, DD9, DD12 and the spike list. Electron premises: `did-fail-
      load` covers provisional failures (high confidence); `getURL()` after
      the error commit genuinely ambiguous (spike); Reload replays the
      original entry (medium-high). Enter-then-fails focus orphan → DD6.

### Design Decisions

**DD1 — Surface mechanism: chrome-owned panel, guest hidden.** The failure
surface is chrome DOM — `#load-failure-surface`, a sibling of
`#welcome-surface` inside `#webviews` — rendered by a new
`load-failure-controller.js` in the `welcome-controller.js` shape. Main
enforces ONE two-axis invariant for guest views — *a guest view is visible
iff its tab is active AND its entry carries no load failure; a guest never
receives OS focus while its entry carries a load failure* — through a single
helper, `applyGuestVisibility(entry)`, called from EVERY site that shows a
guest (Architect review, 2026-09-15 — enumerated by grepping every
`setVisible(true)`/`.focus()` on a guest view in `src/main`):
`tab-set-active` (`register-tab-ipc.js:976` `setVisible(true)`, `:981` the
`addChildView` raise, `:988` the `wasPageFocused` focus re-arm — the re-arm
is skipped for a failed incoming tab; re-grep before pinning, these lines
drift), `moveTabIntoWindow` (`:488`, the cross-window move/adopt show — today
unconditional), `tab-focus-guest` (`:926`, the M17 F1 **F6** gesture — refused
for a failed tab; the chrome instead moves focus into the panel), and the two
failure-state transitions in `guest-wiring.js` (failure recorded → hide if
active; failure cleared → show if active). `activeTabWcId`,
find-overlay/sheet bounds tracking, `activeTab()` resolution, and the
raise-on-activate stay exactly as they are — the failed guest is *hidden*,
never *un-activated*. A unit test pins that every enumerated site consults
the helper (grep-AC on the call sites) and that a failed entry never reaches
`webContents.focus()`. One `wc.focus()` is deliberately outside the list:
`register-browser-ipc.js:499` (`page-context-correct`, spelling correction)
is reachable only from a guest `context-menu` event, which a hidden guest
cannot raise — acknowledged beside the grep-AC, not gated.
- Rationale: the welcome surface proves the chrome-panel-in-the-guest-slot
  pattern (M16); the panel is keyboard-native, lands in the standard chrome a11y
  sweep, needs no new view/preload/geometry module, and moves no trust
  boundary. The in-guest option would put the retry affordance in the same
  realm as hostile page script (Architect, mission review); the overlay-view
  option adds a fourth per-window view for no benefit over a hidden guest.
- Trade-off: per-tab failure state must live on the registry entry and the
  renderer record and be *projected* on activation (the Architect's "per-tab
  state gap") — this flight builds that state deliberately. `captureScreenshot`
  of a failed tab captures a hidden, blank guest (accepted; agents read
  `loadState` and `captureWindow` instead — DD11). The guest slot changes are
  discrete `setVisible` steps, never animated (native-surface invariant).
  When a failure lands on the ACTIVE tab the pinned order is: record the
  entry state → hide the guest → close the find overlay (`findOverlay.hide()`)
  → push to the chrome; the sheet is left alone (an open menu is the
  operator's, not the page's). Unit-pinned the way `tab-hide` pins its own
  ordering.

**DD2 — Failure signal: `did-fail-load`, main frame only, never `ERR_ABORTED`.**
`wireTabViewEvents` gains one handler on `did-fail-load` that records a failure
only when `isMainFrame === true` and `errorCode !== -3` (`ERR_ABORTED` fires
for user-cancelled navigations and downloads and is not a failure). The
registry entry gains `loadFailure: { code, name, url } | null` and
`lastRequestedUrl: string | null`. `lastRequestedUrl` is stamped at every
main-frame, non-same-document `did-start-navigation` whose URL is not
`chrome-error:` (`e.url`), at the two `loadURL` call sites, at the
`restoreHistory` branch of `tab-create` (the restored entry's URL at its
active index — `navigationHistory.restore()` may not raise the generic hook
the same way), and — as a second, event-carried source — from
`did-fail-load`'s own `validatedURL` argument when the failure is recorded.
The failure clears at the next main-frame, non-same-document
`did-start-navigation` whose URL is not `chrome-error:` — the error
document's own commit must never erase the failure it reports (Architect
review; whether that commit raises a `did-start-navigation` at all is spike
check (d)). Chrome learns both transitions over
one owner-routed push, `tab-load-failure { wcId, failure | null }` (routing
class 3, `chromeForTab(wcId)` at event time). `did-fail-provisional-load` is
NOT separately wired: Electron 44 emits `did-fail-load` for provisional
failures too — the leg-1 spike confirms this on the live rig; if it does not
hold, both events funnel into the same handler with the same guards.
- Rationale: one signal, one state field, one push; the guards are the two
  documented false-positive sources.
- Trade-off: subframe failures are invisible (a broken third-party iframe is the
  page's problem, not the navigation's).

**DD3 — Classification is a pure `src/shared/` model; copy is app-authored.**
`src/shared/load-failure.js` (ESM, `require(esm)`-testable) exports
`classifyLoadFailure({ code, name })` → `{ kind, title, body, retryable }` and
the `LOAD_STATES` enum (`ok`, `failed` in this flight; Flights 2 and 3 append
`cert-blocked`, `crashed`, `hung` here, one place). Kinds: `dns`
(`ERR_NAME_NOT_RESOLVED`), `refused` (`ERR_CONNECTION_REFUSED`), `timeout`
(`ERR_CONNECTION_TIMED_OUT`, `ERR_TIMED_OUT`), `offline`
(`ERR_INTERNET_DISCONNECTED`), `unreachable` (`ERR_ADDRESS_UNREACHABLE`),
`dropped` (`ERR_CONNECTION_CLOSED` / `_RESET` / `_FAILED`,
`ERR_EMPTY_RESPONSE`), `cert` (every `ERR_CERT_*`), `tls`
(`ERR_SSL_PROTOCOL_ERROR`, `ERR_SSL_VERSION_OR_CIPHER_MISMATCH`), `blocked`
(`ERR_BLOCKED_BY_CLIENT`, `ERR_BLOCKED_BY_RESPONSE`), `redirect-loop`
(`ERR_TOO_MANY_REDIRECTS`), `scheme` (`ERR_UNKNOWN_URL_SCHEME`), `unknown`
(everything else). Match on the `name` string first (stable across Chromium),
code second. Title/body strings live in the model; the raw name and the
intended address render as separate `textContent` lines.
- Rationale: the `page-context-model.js` / `tab-context-model.js` precedent —
  DOM-free, unit-tested truth table; engine strings never become prose.
- Trade-off: an unmapped code shows generic copy plus its raw name — honest,
  not pretty.

**DD4 — The intended address is main's `lastRequestedUrl`, never the
`chrome-error://` document.** Chromium commits a failed navigation to a
`chrome-error://chromewebdata/` document. Whether `wc.getURL()` reports that
URL or the original one after the commit is the flight's one empirical
premise (issue #163 measured `location.href` in the guest as `chrome-error://`
and the census as the intended URL — consistent with either the renderer
record or `getURL()` holding the original). The design is branch-complete: a
main-side helper `effectiveUrl(entry)` returns `entry.lastRequestedUrl` when
`entry.loadFailure` is set and the field is non-null, else `wc.getURL()`
(defensive fallback — never `null`); `did-navigate`'s push,
`session-snapshot.js`, and `closed-tab-capture.js` all read through it.
The renderer keeps `tab.url` = the pushed URL, so the address bar, chip, and
census never see `chrome-error:`. The leg-1 spike records which branch the live
engine exercises; the helper stays either way (cheap, unit-pinned defense).
- Rationale: one substitution point beats three consumers each special-casing
  a scheme.
- Trade-off: a failed tab's session/closed-tab entry carries the intended URL
  and retries at restore — the desired behavior.

**DD5 — Retry rides the existing navigate path.** The surface's Retry button
calls the chrome's `navigate(tab.url)` equivalent → `tabNavigate loadURL` with
the intended address; `did-start-navigation` clears the failure, main re-shows
the guest, the chrome hides the panel. The toolbar Reload on a failed tab is
expected to retry the original URL (Chromium reloads an error page's original
entry) — the spike confirms; if not, the chrome routes Reload on a failed tab to
the same `loadURL` path. A retry that fails again re-renders the panel in
place (latest failure wins; no flicker requirement).
- Rationale: zero new IPC; the same gate (`isSafeTabUrl`) the address bar uses.

**DD6 — Strip and address-bar presentation.** `.tab` gains
`data-load-state="failed"`; the tab-row template gains one
`<span class="tab-status" hidden>` that carries a warning glyph when failed
(the favicon is hidden while failed and restored on clear); `.tab-title` shows
the intended host, and the `tab-title` consumer (`renderer.js` `onTabTitle`)
short-circuits while `tab.loadState === 'failed'` so a late
`page-title-updated` from the error document (typically empty →
`title || tab.url`) cannot clobber it (Architect review); `tab-favicon`
pushes are stored but the `<img>` stays hidden via the `data-load-state` CSS
while failed; the tab's `aria-label` gains a "— failed to load" suffix. On
clear, the next `tab-title`/`tab-favicon` push restores the ordinary
presentation. The address bar shows the intended URL; the chip
stays in its scheme-derived web state. Media/Shields/DevTools affordances are
untouched (they act on the guest, which still exists); the find overlay is
excluded on failed tabs via `isFindableTab` (`window-factory.js:220-223`,
`&& !entry.loadFailure`) and closed when a failure lands on the active tab
(nothing to search). **Focus on failure**: when a failure lands on the
ACTIVE tab and no chrome control holds focus (the address-bar Enter path
blurs the input expecting the page — `pendingFocusGuest`,
`navigation-controller.js:190-217`, which never resolves for a failed load),
the controller moves focus to the panel's heading (`tabindex="-1"`) so
keyboard focus is never orphaned on `<body>` and assistive tech announces the
failure; the F6 gesture on a failed tab lands on the same heading (DD1) —
implemented in `src/renderer/chrome/shortcut-controller.js`'s
`focus-content` case (`~:206-212`): the chrome already holds
`tab.loadState` from the push, so it checks the active tab synchronously and
calls the controller's `focusHeading()` instead of `focusActiveGuest()`; no
main round-trip, and main's `tab-focus-guest` refusal (DD1) remains the
backstop. Retry is never auto-focused (an accidental Enter must not retry).
- Rationale: the strip contract stays additive (`tab-keyboard-operability`
  pins the ARIA tab-strip contract; nothing renamed).

**DD7 — Census: `loadState` + `loadError`, renderer-sourced.** `listTabs()`
adds `loadState: LOAD_STATES.*` and `loadError: { code, name } | null`;
`mapEnumeratedTabs` passes them through; the `enumerateTabs` tool description
and `docs/mcp-automation.md` document the shape and the enum's planned growth.
- Rationale: `url`/`title`/`active` already come from the renderer record; the
  renderer holds the failure the moment main pushes it. No new drive op.
- Trade-off: a mid-boot window contributes zero rows (unchanged contract).

**DD8 — Cross-window move re-projects the failure.** Registry-entry fields
travel with the entry on move/adopt; the adopting window's chrome receives a
fresh `tab-load-failure` push after adopt so its record and panel match main
(`tab-move-to-new-window` / adopt path, `register-tab-ipc.js:622-842`).

**DD9 — Line budgets.** All chrome logic lands in
`src/renderer/chrome/load-failure-controller.js` (injected `els`, `bridge`,
`tabs`, `navigate`); the controller self-subscribes to `onTabLoadFailure` AND exposes
`show(tab)`/`hide()` that `activateTab` calls beside `showWelcomePanel`/
`hideWelcomePanel` (`tab-controller.js:889-890`) — activation-time
projection of a background failure is an explicit deliverable (behavior spec
step 5), not an implied consequence of the push.
`renderer.js` grows by construction glue only (≤ 8 lines);
`shortcut-controller.js` gains the one F6 branch (DD6) and
`tab-controller.js` the two projection calls and the `listTabs` fields —
no other chrome file changes;
`RENDERER_LINE_BUDGET` moves from 1836 to at most 1844 with the standard
justification comment in `seam-contract.test.js`. No evaluate-seam change
(`SEAM_COUNT` stays 36): the a11y audit reaches the failed state through the
existing `navigate(url)` global (DD13).

**DD10 — Frozen DOM contract for the surface.** As with the welcome surface
(M16 F3 DD2): `#load-failure-surface`, `#load-failure-heading`,
`#load-failure-url`, `#load-failure-code`, `#load-failure-body`,
`#load-failure-retry`, the `.hidden` toggle, and `.tab[data-load-state]` /
`.tab-status` are read by the behavior spec, the a11y audit, and the
controller's own unit test; a restyle may wrap them but never rename, remove,
or change their toggling. A HAT change to this contract is a spec re-author,
handled deliberately.

**DD11 — Verification apparatus (act + observe audited).**
- *Act*: MCP `openTab` / `navigate` to fixture URLs (jar-scoped or admin);
  Retry via admin `evaluate` on the chrome wcId
  (`document.getElementById('load-failure-retry').click()` — the a11y audit's
  own drive idiom); the typed-navigation row uses `evaluate` only to set and
  focus `#address`, then a REAL `pressKey(chromeWcId, 'Enter')` — the
  `pendingFocusGuest` path under test is armed by the Enter keydown listener
  (`navigation-controller.js:387-415`), which the bare `navigate()` global
  bypasses; `pressKey` on the chrome target is established precedent
  (`devtools-cdp-conflict.md`); `closeTab` +
  `pressKey('Control+Shift+T')` for the reopen row.
- *Observe*: **`captureWindow`** (admin) for rendered state — the guest is
  hidden, so the composited window IS the surface; **`readAxTree`** on the
  chrome wcId (non-tab wcIds resolve admin-only) for the surface's heading,
  address, and Retry button; **`enumerateTabs`** for `loadState`/`loadError`
  and `url`. `captureScreenshot(wcId)` of a failed tab is NOT an observable
  (hidden guest) — the spec never reads it.
- Read paths cited: `tabs.js:52` row shape (+ new fields), `captureWindow`
  admin tool, `getChromeTarget` → chrome wcId.

**DD12 — Fixtures: nothing new on disk.** Refused → `http://127.0.0.1:1/`.
DNS → `http://nonexistent-host-abc123xyz.invalid/`. Certificate →
`tests/behavior/fixtures/web-compat/serve-tls.mjs` (throwaway CA) with the
app launched WITHOUT `--insecure-tls-fixtures` → `ERR_CERT_AUTHORITY_INVALID`.
Retry → `python3 -m http.server {P} --directory
tests/behavior/fixtures/keyboard-nav` started only AFTER the first attempt at
`http://127.0.0.1:{P}/links.html` fails (`links.html` is an existing 200
fixture page; `web-compat/serve.mjs` has no `/` route and would answer 404 —
Architect review). Timeout/unreachable →
optional variant against TEST-NET-1 `http://192.0.2.1:81/` with a long wait.

**DD13 — a11y audit state.** `scripts/a11y-audit.mjs` gains a `load-failure`
chrome state driven by `navigate('http://127.0.0.1:1/')` on the chrome wcId
(the existing fixture-navigate idiom), audited after the panel renders. Any
new finding is a real finding; no `ACCEPTED` entry is pre-added.

### Prerequisites

- [ ] Mission 20 active (yes, commit `0fcb100`); working tree clean on `main`.
- [ ] Flight branch `flight/01-navigation-failure-surface` created at flight
      start.
- [ ] Live rig launchable: `GOLDFINCH_AUTOMATION_ADMIN=1
      GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation` (WSLg); the admin
      key captured from the `AUTOMATION_DEV_MINT` line by env-var reference
      only. *(The `goldfinch-dev` MCP entry was not connected during planning
      — the app was not running; this is the expected cold state, not a
      defect.)*
- [ ] Fixture certs generated: `node
      tests/behavior/fixtures/web-compat/gen-certs.mjs` (`openssl` 3.0.13
      present — verified).
- [ ] Free fixture port chosen by bind-probe at run time (`ss -ltn` cannot
      see Windows-side WSL2 listeners); the MCP port `49707` is left alone.
- [ ] Leg-1 spike recorded in the flight log before the chrome leg starts:
      (a) does `did-fail-load` fire for provisional failures; (b) what
      `wc.getURL()` / `did-navigate` report after the error commit; (c) does
      toolbar Reload retry the original URL on an error page; (d) does the
      error document's own `chrome-error://` commit raise a
      `did-start-navigation` / `did-navigate` pair after `did-fail-load`, and
      in what order relative to it.

### Pre-Flight Checklist

- [x] All open questions resolved
- [x] Design decisions documented
- [ ] Prerequisites verified
- [x] Validation approach defined
- [x] Legs defined

---

## In-Flight

### Technical Approach

1. **Shared model first** — `src/shared/load-failure.js` with its truth-table
   unit test; the enum is the single source for census values.
2. **Main-side state and invariant** — registry entry fields; `did-fail-load`
   handler and `did-start-navigation` clear in `guest-wiring.js`; the
   visibility invariant in `tab-set-active`; `effectiveUrl` consumed by
   `did-navigate`'s push, `session-snapshot.js`, `closed-tab-capture.js`;
   `isFindableTab` exclusion; adopt-time re-push; the `tab-load-failure`
   preload/typing entry. Unit coverage in `guest-wiring.test.js` (the
   `FakeContents` harness emits `did-fail-load` directly),
   `session-snapshot`/`closed-tab-capture` tests, and a new visibility-
   invariant test on the tab-IPC path.
3. **Chrome surface** — `load-failure-controller.js`, the `#load-failure-
   surface` markup and CSS (opaque, `position:absolute; inset:0`, the welcome
   palette), strip state, address-bar preservation, retry, census fields, the
   `enumerateTabs` description + `docs/mcp-automation.md`, the a11y state,
   README's error-page claim, CLAUDE.md's Tab strip / Chrome indicators notes.
4. **Verify live** — run `navigation-failure-surface`; `npm run a11y`; the
   four gates.

### Checkpoints

- [ ] CP1 — Spike findings logged (DD2/DD4/DD5 premises settled on the rig)
- [ ] CP2 — Model + main wiring landed; `npm test` green; a failed tab's
      guest is hidden and its snapshot/closed-tab URL is the intended one
- [ ] CP3 — Chrome surface renders for refused/DNS/cert on the live rig;
      census reports `failed` + code; retry recovers
- [ ] CP4 — `navigation-failure-surface` behavior run: pass; `npm run a11y`
      green with the new state
- [ ] CP5 — HAT walk complete; flight `landed`

### Adaptation Criteria

**Divert if**:
- Hiding the guest under DD1 breaks a pinned focus/find/sheet rule that the
  single invariant cannot absorb (e.g. focus lands on a hidden guest and the
  keyboard-reachability contract from M17 F1 regresses) — re-plan the
  mechanism before leg 2.
- `did-fail-load` does not fire for the refused/DNS classes on Electron 44 and
  `did-fail-provisional-load` does not either — the signal premise is wrong.
- The chrome glue needs more than +15 lines in `renderer.js` — the extraction
  boundary is wrong, re-plan.

**Acceptable variations**:
- Wiring `did-fail-provisional-load` into the same handler (DD2 fallback).
- Routing toolbar Reload on a failed tab through `loadURL` (DD5 fallback).
- The `effectiveUrl` substitution turning out never exercised (DD4 — kept).
- Copy edits and kind additions in the classification model.
- Skipping the optional timeout variant row on a given run.

### Legs

> **Note:** These are tentative suggestions, not commitments. Legs are planned
> and created one at a time as the flight progresses. This list will evolve
> based on discoveries during implementation.

- [ ] `load-failure-model-and-main-wiring` — spike (CP1), shared
      classification model + enum, registry fields, `did-fail-load` handler
      and clear, visibility invariant, `effectiveUrl` in the three consumers,
      find exclusion, adopt re-push, `tab-load-failure` preload/typing, unit
      tests. Ends with a failed tab whose guest is hidden and whose census
      URL, snapshot, and closed-tab entry all carry the intended address.
- [ ] `load-failure-surface-chrome` — the controller, markup, CSS, strip
      state, address-bar preservation, retry, census fields + tool docs, a11y
      state, README/CLAUDE.md updates; runs `navigation-failure-surface` and
      `npm run a11y` as its acceptance gate.
- [ ] `hat-and-alignment` *(optional, operator-elected)* — guided walk:
      refused, DNS, cert, background-tab failure, retry, closed-tab reopen,
      keyboard-only reach of Retry; inline fixes; contract changes to DD10 are
      spec re-authors.

---

## Post-Flight

### Completion Checklist

- [ ] All legs completed
- [ ] Code merged
- [ ] Tests passing (`npm test`, `npm run lint`, `npm run typecheck`,
      `npm run format:check`, `npm run a11y`)
- [ ] Documentation updated (`docs/mcp-automation.md`, README error-page
      claim, CLAUDE.md tab-strip/surface notes)

### Verification

- Behavior spec `tests/behavior/navigation-failure-surface.md` — run via
  `/mission-control:behavior-test navigation-failure-surface`; verdict `pass`
  on the core rows (the timeout variant may be skipped and noted).
- `npm run a11y` green including the new `load-failure` state.
- Unit: `load-failure` truth table; `guest-wiring` did-fail-load guards
  (subframe ignored, `-3` ignored, clear on next navigation); two-axis
  visibility/focus invariant across every enumerated site (grep-AC on the
  helper's call sites + a failed entry never focused); active-tab failure
  ordering; `onTabTitle` short-circuit while failed; `effectiveUrl` in snapshot and closed-tab
  capture; `mapEnumeratedTabs` row shape with the two new fields;
  `seam-contract` budgets.
- Mission criteria 1, 2, and the census half of 10 checked off in
  `mission.md` at landing; the certificate bullet stays open for Flight 2.
