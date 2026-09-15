# Leg: load-failure-surface-chrome

**Status**: completed
**Flight**: [The Failure Surface and Navigation Errors](../flight.md)

## Objective

The chrome renders the failure main now reports: an explanatory, retryable
panel in the guest slot for the active failed tab, a failed state in the tab
strip for any failed tab, the intended address preserved in the address bar,
keyboard focus that never lands in a hidden guest, and `loadState` /
`loadError` in the automation census — verified live by the
`navigation-failure-surface` behavior spec and the a11y audit.

## Context

- **Design decisions in force**: DD1 (chrome-owned panel; F6 lands on the
  panel heading), DD3 (model copy; `LOAD_STATES` is the census enum), DD5
  (retry rides `loadURL` of the intended address), DD6 (strip state, title
  clobber guard, focus-on-failure), DD7 (census fields, renderer-sourced),
  DD9 (line budgets; `shortcut-controller.js` F6 branch; activation-time
  projection in `activateTab`), DD10 (frozen DOM contract), DD11
  (apparatus), DD12/DD13 (fixtures, a11y state). Read them in
  `../flight.md`.
- **Leg 1 delivered** (uncommitted on the flight branch — see the flight
  log's leg-1 entry): `src/shared/load-failure.js` (`LOAD_STATES`,
  `classifyLoadFailure({ code, name })` → `{ kind, title, body, retryable }`,
  `shouldRecordLoadFailure`, `isChromeErrorUrl`); the owner-routed push
  `tab-load-failure { wcId, failure: { code, name, url } | null }` exposed
  as `window.goldfinch.onTabLoadFailure(cb)` (`chrome-preload.js:357`,
  typed at `renderer-globals.d.ts:501`); main hides a failed tab's guest,
  refuses `tab-focus-guest` for it, keeps `enumerateTabs`' `url` at the
  intended address, and re-pushes the failure to an adopting window after
  a move.
- **Spike findings that shape this leg**: `did-navigate` never fires for
  the error commit, so `tab.url` in the renderer is never clobbered — the
  address bar needs no filtering here, only the *title* guard (DD6). The
  MCP/toolbar Reload retries the original URL, so the toolbar needs no
  change; the panel's Retry uses `tabNavigate loadURL` for determinism.
  `http://127.0.0.1:1/` fails as `ERR_UNSAFE_PORT` (-312) — the model gains
  an `unsafe-port` kind in this leg (an "acceptable variation" per the
  flight's Adaptation Criteria) and the behavior spec's refused fixture is
  now the bind-probed free port `{P}`.
- **Mutual exclusion in the guest slot**: a tab is either a viewless welcome
  record (`tab.welcome`, no guest) or a real tab that may be failed
  (`tab.loadFailure`, hidden guest). `activateTab` projects exactly one of
  `#welcome-surface` / `#load-failure-surface` / neither.
- **Budgets**: `renderer.js` is at 1835 lines against `RENDERER_LINE_BUDGET`
  1836 (`test/unit/seam-contract.test.js:169`). The controller owns all
  logic; `renderer.js` gains (design-review arithmetic): 2 import lines, 1
  `let` declaration, an ~8-line construction call, 2 wrapper functions (2–4
  lines), the 2-line `onTabTitle` guard, and 1 dep line into the shortcut
  controller — about +14, landing near 1849. The budget therefore moves to
  **1850** (the flight's own "+15 → divert" ceiling is 1850; anything above
  it is a divert, not a bump). `SEAM_COUNT` stays 36 — the a11y audit
  reaches the failed state through the existing `navigate(url)` global.
- **Deps supersede DD9's sketch (deliberate)**: DD9 listed `els, bridge,
  tabs, navigate`; the controller takes `document, els, bridge,
  findTabByWcId, isActiveTab, classifyLoadFailure` instead — `tabs` is
  unnecessary given `findTabByWcId`, and Retry goes through
  `bridge.tabNavigate` with the recorded address rather than the address
  bar's `navigate()` (which would re-run `toUrl`). Recorded here so it is
  not read as drift.
- **House rules that bite here**: engine strings and addresses render via
  `textContent` only, never markup; no page-controlled URL is fetched by the
  chrome (the panel fetches nothing); `.hidden` toggles via `classList`;
  strip ARIA contract stays additive (`tab-keyboard-operability` pins it);
  Prettier formatting; `src/shared/` imports from the `file://` chrome are
  disk-relative with `.js` extensions.

## Inputs

- Leg 1 landed on `flight/01-navigation-failure-surface` (uncommitted);
  `npm test` 4528/4528; lint/typecheck/format:check green.
- `src/renderer/chrome/context.js` — the `IDS` map (`:4-75`) that builds
  `els`; `welcomeSurface: 'welcome-surface'` at `:72` is the entry to mirror.
- `test/unit/tab-controller.test.js` — the chrome DOM harness:
  `FakeElement`'s `innerHTML` setter resolves exactly `['.tab-title',
  '.tab-close', '.tab-fav']` (`:56-57`, `querySelector` map `:87-88`), and
  the recording-fake precedent for `activateTab`'s welcome branch order
  (`:219-394`).
- `src/renderer/chrome/welcome-controller.js` — the controller shape to copy
  (`createWelcomeController(deps)`, `els.welcomeSurface` root built once with
  `createElement`/`textContent`, `show(tab)`/`hide()`).
- `src/renderer/chrome/tab-controller.js` — `buildStripRecord`
  (`:99-155`; record fields `:102-114`, the `.tab-row` template `:151`),
  `activateTab` (`:865`; welcome toggle `:889-890 — "if (tab.welcome)
  showWelcomePanel(tab); else hideWelcomePanel();"`, `els.address.value =
  tab.url` `:892`), `window.__goldfinchAutomation.listTabs()`
  (`:1172-1180`).
- `src/renderer/renderer.js` — welcome controller construction
  (`:620-631`), the `showWelcomePanel`/`hideWelcomePanel` wrapper functions
  (`:209-213`) that `tab-controller.js` receives as deps (`:67-68`) — the
  exact mechanism AC3 mirrors, `onTabTitle` (`:1568-1578 — ".tab-title').textContent =
  title || tab.url"`), `onTabFavicon` (`:1580-1603`), `onTabLoading`
  (`:1605-1617`).
- `src/renderer/chrome/shortcut-controller.js` — `case 'focus-content'`
  (`:206-212 — "window.goldfinch.focusActiveGuest(); return true;"`).
- `src/renderer/chrome/navigation-controller.js` — `pendingFocusGuest`
  (`:190-217`), the Enter handler (`:387-415`).
- `src/renderer/index.html:353-360` (`#webviews` + `#welcome-surface`),
  `src/renderer/styles.css` (`#webviews` `:812-819`, `#welcome-surface`
  `:841-876`, `.tab` rules `:203-330`, `.tab .tab-fav` `:301-306`).
- `src/main/automation/tabs.js` `mapEnumeratedTabs` (`:40-55`, row at
  `:52`), `src/main/automation/mcp-tools.js` `enumerateTabs` description
  (`:129-136`), `docs/mcp-automation.md:460-470`.
- `scripts/a11y-audit.mjs` — chrome-mode state driving via
  `evaluate(client, wcId, \`navigate(${JSON.stringify(fixtureUrl)})\`)`
  (`:349-353`) and the state list that follows.
- `test/unit/seam-contract.test.js:160-169` (budget + justification comment
  convention); `test/unit/search-engines.test.js:249-290` (the welcome
  DOM-contract grep-shape test to mirror); `test/unit/automation-tabs.test.js`
  (`mapEnumeratedTabs` row-shape tests `:80-179`);
  `test/unit/load-failure.test.js` (leg 1's truth table).
- `README.md:36-44` (the everyday-web-compat bullet), `CLAUDE.md` Tab strip
  section (the viewless-welcome bullet is the model for a new bullet).

## Outputs

- `src/renderer/chrome/load-failure-controller.js` (new).
- `src/renderer/chrome/context.js` — `loadFailureSurface:
  'load-failure-surface'` in `IDS`.
- `src/renderer/index.html`, `src/renderer/styles.css` — the surface + strip
  state styles.
- `src/renderer/chrome/tab-controller.js` — record fields, template span,
  activation projection, census fields.
- `src/renderer/renderer.js` — construction glue, `onTabTitle` guard.
- `src/renderer/chrome/shortcut-controller.js` — F6 routing.
- `src/shared/load-failure.js` — `unsafe-port` kind.
- `src/main/automation/tabs.js`, `src/main/automation/mcp-tools.js`,
  `docs/mcp-automation.md` — census fields.
- `scripts/a11y-audit.mjs` — `load-failure` state.
- `test/unit/seam-contract.test.js` — budget bump;
  `test/unit/load-failure-surface-contract.test.js` (new, grep-shape);
  `test/unit/load-failure-controller.test.js` (new, behavioral — on the
  `tab-controller.test.js` fake-DOM harness); extensions to
  `tab-controller.test.js` (`.tab-status` in the `FakeElement` selector
  list + the activation-projection cases), `automation-tabs.test.js`,
  `load-failure.test.js`.
- `README.md`, `CLAUDE.md` — the surface documented.
- Flight log: leg entry, a11y run result, live smoke observations.

## Acceptance Criteria

- [ ] **AC1 — Controller + frozen DOM contract.**
      `src/renderer/chrome/load-failure-controller.js` exports
      `createLoadFailureController(deps)` (deps: `document`, `els`, `bridge`
      = `window.goldfinch`, `findTabByWcId`, `isActiveTab(tab)` or `ctx`,
      `classifyLoadFailure`) and builds ONCE, inside `els.loadFailureSurface`
      (`#load-failure-surface`, a new `<section class="hidden"
      aria-labelledby="load-failure-heading">` sibling of `#welcome-surface`
      in `#webviews`, registered in `context.js`'s `IDS` map as
      `loadFailureSurface: 'load-failure-surface'` beside `welcomeSurface`): `#load-failure-heading` (`<h2 tabindex="-1">`, the
      model title), `#load-failure-body` (the model body),
      `#load-failure-url` (the intended address, `textContent`),
      `#load-failure-code` (the raw engine name, e.g.
      `ERR_NAME_NOT_RESOLVED`, `textContent`), and `#load-failure-retry`
      (`<button type="button">Retry</button>`, toggled `.hidden` when the
      classification is not `retryable`). Returns `{ show(tab), hide(),
      focusHeading(), applyStripState(tab) }`. The new
      `test/unit/load-failure-surface-contract.test.js` pins every id
      assignment, the `hidden` toggles, and that no `innerHTML` assignment
      from data exists in the file (grep-shape, the welcome precedent).
- [ ] **AC2 — Push handling.** The controller subscribes to
      `bridge.onTabLoadFailure` itself. For a push with a `failure`: sets
      `tab.loadFailure = failure` on the record found by `wcId`, calls
      `applyStripState(tab)`, and — if the tab is the active tab — renders
      and shows the panel and, when `document.activeElement` is `null` or
      `document.body` (no chrome control holds focus — the typed-Enter
      `pendingFocusGuest` case), focuses `#load-failure-heading`; Retry is
      never auto-focused. For a push with `failure: null`: clears
      `tab.loadFailure`, restores the strip (`applyStripState`), and hides the panel if that tab is active. A push for an unknown `wcId` is a
      no-op. Behaviorally pinned in the new
      `test/unit/load-failure-controller.test.js` on the
      `tab-controller.test.js` fake-DOM harness (import its `FakeElement`/
      `FakeDocument` if exported, else lift a minimal copy — note which in the
      flight log) with a recording `bridge` whose `onTabLoadFailure(cb)`
      captures the subscriber: failure push → panel visible, strip marked,
      heading focused when `activeElement` is body; null push → hidden,
      strip restored; unknown wcId → nothing touched.
- [ ] **AC3 — Activation-time projection.** `tab-controller.js` receives
      two plain wrapper functions, `showLoadFailurePanel(tab)` /
      `hideLoadFailurePanel()`, exactly as it receives
      `showWelcomePanel`/`hideWelcomePanel` today (`renderer.js:209-213`
      wrappers → `tab-controller.js:67-68` deps) — never the controller
      object. `activateTab` then projects exclusively: `if (tab.welcome) {
      hideLoadFailurePanel(); showWelcomePanel(tab); } else if
      (tab.loadFailure) { hideWelcomePanel(); showLoadFailurePanel(tab); }
      else { hideWelcomePanel(); hideLoadFailurePanel(); }`, so exactly one
      surface is ever visible. Switching from a failed tab to a healthy one
      hides the panel; switching to a background-failed tab shows it
      (behavior spec steps 4–5). Pinned in `tab-controller.test.js` with
      recording fakes for both wrapper pairs, mirroring the existing welcome
      branch-order cases (`:219-394`).
- [ ] **AC4 — Strip state.** `buildStripRecord`'s record gains
      `loadFailure: null`; its template gains `<span class="tab-status"
      hidden aria-hidden="true"></span>` immediately before `.tab-title`.
      `applyStripState(tab)` sets `data-load-state="failed"` on `.tab`, shows
      `.tab-status` with a warning glyph (`⚠`), writes the intended host
      (`new URL(failure.url || tab.url).host`, falling back to the raw URL
      string on parse failure) into `.tab-title`, and sets the tab's
      `aria-label` to `"<host> — failed to load"` (and the close button's
      `aria-label` accordingly); on clear it removes the attribute, hides
      `.tab-status`, and re-derives the title/labels from `tab.title ||
      tab.url` exactly as `onTabTitle` does. CSS: `.tab[data-load-state=
      "failed"] .tab-fav { display: none; }` and `.tab-status` styling — the
      glyph occupies the favicon's slot (same width), so no new `@container`
      disclosure stage is needed; a one-line CSS comment says so.
      `tab-controller.test.js`'s `FakeElement` `innerHTML` selector list
      (`:56-57`) and `querySelector` map (`:87-88`) gain `.tab-status`, or
      every existing harness test resolves the span to `null` silently;
      `load-failure-controller.test.js` asserts the strip mutation and
      restoration on that harness.
- [ ] **AC5 — Title clobber guard.** `renderer.js`'s `onTabTitle` handler
      stores `tab.title` but returns before touching the DOM while
      `tab.loadFailure` is set (a late/empty `page-title-updated` from the
      error document cannot clobber the host title); the next push after
      clear restores ordinary presentation. Pinned by a grep-shape assertion
      in the contract test (`onTabTitle` body references `loadFailure`).
- [ ] **AC6 — Retry.** `#load-failure-retry` click calls
      `bridge.tabNavigate({ wcId: tab.wcId, verb: 'loadURL', args:
      [failure.url || tab.url] })` for the tab the panel currently shows;
      main clears the failure on `did-start-navigation` and the resulting
      `null` push hides the panel (AC2). A retry that fails again re-renders
      in place (the next failure push). Pinned in
      `load-failure-controller.test.js`: clicking the fake Retry records
      exactly one `tabNavigate` call with `{ wcId, verb: 'loadURL', args:
      [url] }`.
- [ ] **AC7 — F6 routing.** `shortcut-controller.js`'s `focus-content` case
      calls the injected `focusLoadFailureHeading()` when
      `activeTab()?.loadFailure` is set, else `window.goldfinch.
      focusActiveGuest()` as today; `renderer.js` threads the controller's
      `focusHeading` into the shortcut controller's deps. Pinned by a
      grep-shape assertion (`focus-content` case references `loadFailure`).
- [ ] **AC8 — Census.** `listTabs()` rows gain `loadState:
      tab.loadFailure ? LOAD_STATES.FAILED : LOAD_STATES.OK` and `loadError:
      tab.loadFailure ? { code, name } : null` (`LOAD_STATES` imported
      disk-relative from `../../shared/load-failure.js`); `mapEnumeratedTabs`
      passes both through (defaulting `loadState` to `'ok'` and `loadError`
      to `null` when absent); the `enumerateTabs` tool description and
      `docs/mcp-automation.md`'s census bullet document the two fields and
      that `loadState`'s enum grows in later flights. `automation-tabs.test.js`
      asserts both fields in the row shape.
- [ ] **AC9 — `unsafe-port` kind.** `load-failure.js` maps
      `ERR_UNSAFE_PORT` / `-312` to kind `unsafe-port` (title "Port not
      allowed", body "This address uses a network port Goldfinch doesn't
      allow for safety.", `retryable: false`); `load-failure.test.js` covers
      it; the DD3 kind list in the flight is annotated.
- [ ] **AC10 — Styles.** `#load-failure-surface` is `position: absolute;
      inset: 0; overflow: auto;` with an explicit opaque background (the
      welcome surface's light palette tokens reused or aliased), a centered
      column, and `#load-failure-surface.hidden { display: none; }`. No
      transition/animation on anything that resizes the guest slot (the
      slot is unchanged — the panel is a sibling overlay in `#webviews`).
- [ ] **AC11 — a11y audit state.** `scripts/a11y-audit.mjs` gains a chrome
      state labelled `load-failure`: `navigate('http://127.0.0.1:1/')` on the
      chrome wcId (the `ERR_UNSAFE_PORT` panel — instant, deterministic, no
      port probing), a short settle, audit the chrome wcId. Placed LAST in
      the chrome-mode sequence (after `downloads-button`, before the sheet
      states) — nothing after it needs a loaded guest, so no navigate-back
      and no media re-scan timing risk (design review).
      No `ACCEPTED` entry is pre-added; `npm run a11y` is green on the rig
      (recorded in the flight log with the run's summary line).
- [ ] **AC12 — Budgets.** `RENDERER_LINE_BUDGET` = 1850 (the flight's
      divert ceiling; arithmetic in Context) with a justification comment
      naming this leg and the counted lines; `renderer.js` measured ≤ 1850; `SEAM_COUNT` unchanged at 36;
      `npm run typecheck` green with the new controller and the
      `renderer-globals.d.ts` additions it needs (none expected beyond leg
      1's).
- [ ] **AC13 — Docs.** `README.md`'s browsing bullet says a navigation that
      fails shows an explanatory page with the address, the reason, and a
      Retry button instead of a blank tab; `CLAUDE.md`'s Tab strip section
      gains a bullet for the load-failure surface (mechanism, the two-axis
      invariant's location, the frozen DOM contract ids, the census fields,
      the `onTabTitle` guard, the F6 rule) modelled on the viewless-welcome
      bullet but a quarter of its length.
- [ ] **AC14 — Gates.** `npm test`, `npm run lint`, `npm run typecheck`,
      `npm run format:check` green; `npm run format` run before finishing.
- [ ] **AC15 — Live smoke (Developer) + Witnessed run (Flight Director).**
      The Developer records in the flight log a live smoke over MCP: refused
      (`http://127.0.0.1:{P}/` with nothing listening) shows the panel with
      "Connection refused" and `ERR_CONNECTION_REFUSED`; DNS shows "This
      site can't be found"; `enumerateTabs` reports `loadState: "failed"`
      with the matching `loadError.name`; Retry after starting
      `python3 -m http.server {P} --directory
      tests/behavior/fixtures/keyboard-nav` on `/links.html` recovers to
      `loadState: "ok"`. The leg then LANDS only when the Flight Director's
      run of `/mission-control:behavior-test navigation-failure-surface`
      passes on its core rows (the timeout variant may be skipped and
      noted).

## Verification Steps

- AC1/AC5/AC7: `node --test test/unit/load-failure-surface-contract.test.js`
  (grep-shape pins: id assignments, `hidden` toggles, no data `innerHTML`,
  `onTabTitle` guard, `focus-content` routing, `context.js` `IDS` entry).
- AC2/AC4/AC6: `node --test test/unit/load-failure-controller.test.js`
  (push handling, strip mutation/restoration, retry payload, heading focus).
- AC3: `node --test test/unit/tab-controller.test.js` (activation projection
  with recording fakes; existing cases still green after the `.tab-status`
  harness addition).
- AC8: `node --test test/unit/automation-tabs.test.js`; `grep -n loadState
  src/main/automation/mcp-tools.js docs/mcp-automation.md`.
- AC9: `node --test test/unit/load-failure.test.js`.
- AC11: `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm
  run dev:automation`, then `npm run a11y` per `docs/dev-testing.md`'s a11y
  recipe; the summary line goes in the flight log.
- AC12: `node --test test/unit/seam-contract.test.js`; `wc -l
  src/renderer/renderer.js`.
- AC14: `npm test && npm run lint && npm run typecheck && npm run
  format:check`.
- AC15: Developer smoke via `scripts/lib/mcp-client.mjs` (env-var key
  only); FD-driven `/mission-control:behavior-test navigation-failure-surface`
  after `[HANDOFF:review-needed]`.

## Implementation Guidance

1. **Model first**: add `unsafe-port` to `NAME_KIND`/`CODE_KIND`/`KIND_COPY`
   and its test rows.
2. **Markup + CSS**: the `<section>` in `index.html`; `loadFailureSurface`
   in `context.js`'s `IDS`; `#load-failure-surface`
   rules beside `#welcome-surface` (reuse its `--wl-*` tokens by scoping
   them on a shared selector or duplicating the four needed); the
   `.tab-status` span and the `data-load-state` favicon rule beside the
   `.tab .tab-fav` rule.
3. **Controller**: copy `welcome-controller.js`'s skeleton. Build the column
   once; `render(tab)` reads `classifyLoadFailure(tab.loadFailure)` and
   writes title/body/url/code via `textContent`, toggles Retry by
   `retryable`; `show(tab)` = render + `root.classList.remove('hidden')` +
   remember `currentTab`; `hide()` clears both. `focusHeading()` focuses
   `#load-failure-heading`. `applyStripState(tab)` is the ONLY writer of
   `data-load-state`/`.tab-status`. The `onTabLoadFailure` subscription
   lives in the controller (deps carry `bridge`).
4. **tab-controller.js**: record field + template span (keep the `.tab-row`
   structure and every existing class); `activateTab` projection (AC3);
   `listTabs` fields. `tab-controller.js` receives `showLoadFailurePanel`/
   `hideLoadFailurePanel` wrapper functions through its deps exactly like
   `showWelcomePanel`/`hideWelcomePanel` (`renderer.js:209-213` →
   `tab-controller.js:67-68`). Extend `tab-controller.test.js`'s harness
   (`.tab-status`) and add the projection cases.
5. **renderer.js**: construct the controller beside the welcome controller
   (deps: `document`, `els`, `bridge: window.goldfinch`, `findTabByWcId`,
   `isActiveTab: (tab) => tab.id === ctx.activeTabId`,
   `classifyLoadFailure`); the `onTabTitle` early return; thread
   `focusLoadFailureHeading` into the shortcut controller; the two wrapper
   functions beside the welcome ones. Count lines; stay ≤ 1850.
6. **shortcut-controller.js**: the `focus-content` branch.
7. **Census** (`tabs.js`, `mcp-tools.js`, docs) and the a11y state.
8. **Tests, gates, live smoke, a11y run, docs, flight-log entry.** Signal
   `[HANDOFF:review-needed]`; the FD runs the Witnessed spec.

## Edge Cases

- **Failure push for a tab whose `wcId` the renderer has not recorded yet**
  (`onViewCreated` pending): `findTabByWcId` returns null → no-op; main's
  entry keeps the state, and the adopt/activation paths re-project it. If
  the live smoke shows a lost first push on a brand-new tab, add a re-check
  in `onViewCreated` that asks nothing of main — note it, do not widen IPC.
- **Welcome record can never be failed** (no guest) — the projection order
  in AC3 makes the welcome branch win regardless.
- **Panel shown, operator opens a sheet menu**: the sheet composites over
  the guest region above the chrome DOM — unaffected; the panel is chrome
  DOM under it.
- **Find overlay**: main already excludes failed tabs (leg 1); Ctrl+F on a
  failed tab must not open the overlay — verify the chrome's `openFind`
  path tolerates the refusal (it should: main gates `find-overlay:open` on
  `isFindableTab`); if the chrome opens a dead bar, gate `openFind` on
  `!tab.loadFailure`.
- **Internal (`goldfinch://`) tab fails**: the panel renders the same; the
  address bar stays read-only per the internal chip rule.
- **Cross-window move of a failed tab**: the adopting chrome receives the
  re-push after `adopt-tab`; its record is created by the adopt path — the
  push must arrive after the record exists (main queues it after
  `adopt-tab` on the same boot-gated path; confirm the adopt handler
  creates the strip record synchronously on receipt).
- **Retry while offline flapping**: repeated failure pushes re-render; no
  debounce required.
- **Reduced motion / theming**: static panel, no animation to guard.

## Files Affected

- `src/renderer/chrome/load-failure-controller.js` — new
- `src/renderer/chrome/context.js` — `IDS` entry
- `src/renderer/index.html`, `src/renderer/styles.css`
- `src/renderer/chrome/tab-controller.js`, `src/renderer/renderer.js`,
  `src/renderer/chrome/shortcut-controller.js`
- `src/shared/load-failure.js`
- `src/main/automation/tabs.js`, `src/main/automation/mcp-tools.js`,
  `docs/mcp-automation.md`
- `scripts/a11y-audit.mjs`
- `test/unit/load-failure-surface-contract.test.js` (new),
  `test/unit/load-failure-controller.test.js` (new),
  `test/unit/tab-controller.test.js`, `test/unit/seam-contract.test.js`,
  `test/unit/automation-tabs.test.js`, `test/unit/load-failure.test.js`
- `README.md`, `CLAUDE.md`
- `missions/20-no-silent-failures/flights/01-navigation-failure-surface/flight-log.md`

## Citation Audit

2026-09-15 (design): re-checked against the flight branch with leg 1's
uncommitted changes applied: `tab-controller.js` `:99-155`, `:151`, `:865`,
`:889-890`, `:892`, `:1172-1180`; `renderer.js` `:620-631`, `:1568-1578`,
`:1580-1603`, `:1605-1617`; `shortcut-controller.js:206-212`;
`navigation-controller.js` `:190-217`, `:387-415`; `index.html:353-360`;
`styles.css` `:812-819`, `:841-876`, `:301-306`; `tabs.js` `:40-55`;
`mcp-tools.js:129-136`; `docs/mcp-automation.md:460-470`;
`a11y-audit.mjs:349-353`; `seam-contract.test.js:169`;
`search-engines.test.js:249-290`; `chrome-preload.js:357`;
`renderer-globals.d.ts:501` — all present with the quoted snippets.
Developer design review (same day): no line drift; two omissions added
(`context.js:4-75`/`:72`, `tab-controller.test.js:56-57`/`:87-88`/
`:219-394`) and `renderer.js:209-213` / `tab-controller.js:67-68` cited
for the wrapper mechanism. Leg 1's
edits shifted no line in these chrome files (it touched none of them
except the two preload/typing sites, both cited post-edit).

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `completed` (in this file's header)
- [ ] Check off this leg in flight.md
- [ ] If final leg of flight:
  - [ ] Update flight.md status to `landed`
  - [ ] Check off flight in mission.md
- [ ] Commit all changes together (code + artifacts)
