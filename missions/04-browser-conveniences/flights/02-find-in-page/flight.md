# Flight: Find in Page

**Status**: completed
**Mission**: [Standard Browser Conveniences](../../mission.md)

## Contributing to Criteria
- [x] **SC4** — Find in page: search for text within the current page, step forward/backward through
  matches with a visible match count/position, and dismiss the search — all keyboard-operable
  (`Ctrl+F` to open, `Esc` to close). Applies to web content only; absent/inert on `goldfinch://`
  internal tabs. *(HAT-confirmed on WSLg via Enter: bar open page/chrome-focused, visible `n/m`,
  forward/back stepping, `Esc`/`✕` close + focus-restore, per-tab restore, internal no-op, lightbox
  guard. Live search-as-you-type is degraded on WSLg only — the `findNext:false` cold quirk — and is
  a documented known issue pending macOS confirmation.)*
- [x] **SC8** (part) — Agent parity: find-in-page is invocable through the automation surface as
  gated, jar-scoped tools (`findInPage` / `stopFindInPage`). *(Tools discoverable — surface 24→26;
  stepping/warm finds live-verified to return true counts; the cold-first-find `{0,0}` is the same
  WSLg known issue, macOS-pending.)*

---

## Pre-Flight

### Objective

Add **find in page** — the convenience Electron leaves unwired despite Chromium providing the engine
(`webContents.findInPage` / the `found-in-page` event). The operator opens a **floating find bar**
with `Ctrl+F`, types a query, sees a live **match count / position** (`n/m`), steps through matches
forward (`Enter`) and backward (`Shift+Enter`), and dismisses with `Esc`. Per-tab find state is
**preserved across tab switches** (Chrome-like). Expose **`findInPage`** and **`stopFindInPage`** as
gated automation/MCP tools (agent parity). Every affordance targets **web content only** — it no-ops
on `goldfinch://` internal tabs.

This flight inherits three carry-forward lessons from the Flight 1 debrief, applied as up-front design
decisions rather than rediscovered through bugs:
1. **Three-place wcId-op registration** (`engine.js` + `mcp-tools.js` + `scope.js WCID_FIRST_OPS`),
   now CI-guarded by the `automation-scope.test.js` membership test — both new tools are auto-checked.
2. **Live-query, not cache, for session-owned implicit state.** Match counts/positions are read live
   from the `found-in-page` event, never cached; the per-tab persistence (DD3) caches only
   renderer-owned UI *intent* (query text + open flag) and re-queries Chromium for counts on restore.
3. **Internal-refusal and OS-native steps are HAT/unit checkpoints, never automation-surface steps**
   — the apparatus structurally cannot hand an op a `goldfinch://` wcId.

### Open Questions
- [x] **Find bar placement / shape** → **Floating top-right overlay** anchored to the page area
  (`[ input ] n/m [↑] [↓] [✕]`), renderer-driven on the active tab's `<webview>` tag. Not the
  in-address-bar zoom-control pattern (too tight for input + count + nav + close) and not a side
  panel (#27 animation glitch; unconventional for find). (DD1, operator)
- [x] **Where is `Ctrl+F` captured?** → The **main-process `before-input-event` handler on each guest**
  (the Flight-1 capture site at `main.js:357`, page-focused case) intercepts `Ctrl+F` and messages the
  renderer to open the bar; the renderer `document` keydown (`renderer.js:2053`) covers the
  chrome-focused case. `Esc`/`Enter`/`Shift+Enter` are handled while the find input has focus. (DD2)
- [x] **Find state on tab switch** → **Preserve per-tab state** (Chrome-like), but cache only
  renderer-owned UI *intent* (`{ findOpen, findText }` on the tab); re-issue `findInPage` to refresh
  the live count/highlight on restore. No cached match counts. (DD3, operator)
- [x] **MCP find tool shape** → **`findInPage(wcId, text, {forward, findNext, matchCase})` →
  `{activeMatchOrdinal, matches}`** plus **`stopFindInPage(wcId)` → `{ok:true}`** (full parity with the
  UI: search / step / dismiss). Flat schemas. (DD4, operator)
- [x] **Is the UI find driven main-side or renderer-side?** → **Renderer-side on the `<webview>` tag**
  (the `found-in-page` event returns to the renderer where the bar lives). The MCP op runs **main-side**
  on `webContents`. Two independent entry points share one per-guest Chromium find session
  (last-writer-wins) — acceptable. (DD1)
- [x] **Behavior-test apparatus** → the M03 automation surface, audited on both axes (DD6). Act via the
  `findInPage`/`stopFindInPage` tools; observe the returned `{activeMatchOrdinal, matches}` against a
  page with a known term count, corroborated by `evaluate`. Internal-refusal + the visual bar are
  HAT/unit, not automation steps.

### Design Decisions

**DD1 — Find bar = floating top-right overlay, renderer-driven on the `<webview>` tag.** The bar is
renderer chrome: an absolutely-positioned overlay anchored to the top-right of the webview region,
`[ input ] n/m [↑] [↓] [✕]`, shown only while find is active on a web tab. The search runs renderer-side
via the active tab's `<webview>` tag (`wv.findInPage(text, opts)` — Electron exposes it on the
`<webview>` element, `electron.d.ts:19463`), and results arrive on the renderer `found-in-page` event
carrying `{requestId, activeMatchOrdinal, matches, finalUpdate}`. The displayed `n/m` is read **live
from each event**, never cached.
- Rationale: conventional and discoverable; room for input + count + two nav buttons + close; keeps the
  result event in the renderer where the bar lives — no IPC round-trip for the UI path.
- Trade-off: the MCP op (DD4, main-side `webContents.findInPage`) is a second entry point into the same
  per-guest Chromium find session; concurrent use is last-writer-wins (as in a real browser).

**DD2 — `Ctrl+F` captured main-side via the existing `before-input-event` handler (page-focused) +
renderer `document` keydown fallback (chrome-focused); `Esc`/`Enter`/`Shift+Enter` handled in the find
input.** Reuse the Flight-1 capture site (`main.js:357`, which already handles `Ctrl +`/`-`/`0`/`Ctrl+P`
and skips `__goldfinchInternal` sessions): add `input.key === 'f' && (input.control || input.meta)` →
`event.preventDefault()` + an `open-find` message to the renderer. The renderer fallback
(`renderer.js:2053`) handles `Ctrl+F` while the chrome shell is focused, guarded by `isInternalTab(tab)`
and the open-lightbox check (as the zoom fallback is). While the find input is focused: `Enter` = next
match (forward), `Shift+Enter` = previous, `Esc` = close → `stopFindInPage('clearSelection')` → restore
focus to the page.
- Rationale: mirrors the Flight-1 zoom/print capture exactly (page-focused is the normal case); the
  main-side handler already exists and already excludes internal sessions.

**DD3 — Preserve per-tab find state by caching UI *intent* only; re-query Chromium for counts on
restore; invalidate on navigation.** The operator chose Chrome-like per-tab persistence. To avoid the
stale-state class that bit the Flight-1 zoom label (debrief Key Learning #2), the per-tab cache holds
only renderer-owned UI state — `{ findOpen: boolean, findText: string }` on the tab object — and
**never** the match counts. Its **cache-freshness contract** is explicit:
- *Source of truth*: the `<webview>`'s live `found-in-page` event (counts) + the renderer-owned tab
  fields (open flag, query text). The cache never holds a count.
- *Rebuild trigger*: on **tab activation** of a tab with `findOpen`, re-show the bar with `findText` and
  **re-issue `findInPage(findText, { findNext: false })`** to refresh the live count/highlight (the
  `found-in-page` event repaints `n/m`). On tab switch the tab being left is **not** stopped
  (`stopFindInPage('keepSelection')`), so its highlight survives in the guest.
- *Invalidation event (Architect [high]) — navigation*: on a **full `did-navigate`** (`renderer.js:721`,
  where `media`/`selected`/`privacy` already reset) of a tab with `findOpen`, the cached `findText`
  count is stale against a new document and the highlight is gone → **close the bar, clear `findOpen`,
  and `stopFindInPage('clearSelection')`**. (Re-opening with `Ctrl+F` starts fresh on the new page.)
  This forecloses the only reachable stale-`n/m` state. `did-navigate-in-page` (hash/history) does
  **not** invalidate. A destroyed/recreated webview clears the cache with the tab.
- *Race-guard*: the renderer `found-in-page` handler carries the **`activeTabId` race-guard** — an event
  whose target tab is no longer active updates that tab's cache but does **not** repaint the visible bar
  (same pattern as `refreshZoomControl`).
- *Listener topology (Architect Q2)*: the `found-in-page` listener is attached **per-webview in
  `wireWebview`** (`renderer.js:663`), so a backgrounded tab's late `finalUpdate` is not lost — each
  tab owns its event stream; the race-guard only gates the *visible* repaint.
- Rationale: satisfies "preserve per-tab state" while keeping match counts **live-queried, not cached**
  — the safe reading of the operator's choice. The cache is UI intent the renderer solely writes.
- Trade-off: re-issuing `findInPage` on restore re-highlights; a brief recompute, not a stale number.

**DD4 — Two MCP tools: `findInPage` + `stopFindInPage`; async event-wrap on `finalUpdate`; op-local
internal guard; three-place registration.** Add `src/main/automation/find.js`:
- `findInPage(wcId, text, deps, { forward, findNext, matchCase } = {})` → `{ activeMatchOrdinal,
  matches }`. `findInPage` is **asynchronous/event-driven**: `wc.findInPage(text, opts)` returns a
  `requestId` immediately and `found-in-page` fires **multiple times** until `finalUpdate: true`.
  **This event-wrap is net-new to the codebase** (Architect [medium]): `observe.js` `waitForPaint` is a
  `setTimeout`/`.once('did-stop-loading')` and `cdp.js` `withDebuggerSession` is synchronous attach/
  detach — neither awaits a multi-fire event. The op must therefore specify its own listener contract:
  attach `wc.on('found-in-page', handler)`, resolve **only** on `result.requestId === requestId &&
  result.finalUpdate === true`, bound with a **timeout fallback** (return the last-seen update), and
  **remove the listener in `finally`** (no leak). Only the **foreground-first** discipline mirrors an
  existing op (`print.js:39-43`: `activate` → re-resolve → `waitForPaint` for a backgrounded guest).
  Returns the structured object via the default `okResult` JSON-text path (not `imageResult`).
- `stopFindInPage(wcId, deps)` → `{ ok: true }` via `wc.stopFindInPage('clearSelection')`.
- Both carry the **op-local `isInternalContents(wc)` guard AFTER `resolveContents`** (Flight-1 DD3 —
  admin runs `allowInternal: true`, so `resolveContents` alone does not refuse internal pages).
- **Three-place registration:** `engine.js` (dispatch), `mcp-tools.js` (ToolDef, flat schemas:
  `findInPage` requires `{wcId, text}` + optional `{forward, findNext, matchCase}`; `stopFindInPage`
  requires `{wcId}`), and **`scope.js WCID_FIRST_OPS`** (jar façade). The CI guard test in
  `automation-scope.test.js` auto-verifies both are jar-reachable. **Tool count 24 → 26.**
- Rationale: full agent parity with the UI (search / step / dismiss); resolving on `finalUpdate` is the
  correct read of the multi-fire `found-in-page` event.
- Trade-off: the event-wrap adds the only async-event op in the find module; covered by a fake
  `found-in-page` emitter in unit tests.

**DD5 — All find affordances no-op on internal `goldfinch://` tabs, on BOTH the user and admin paths.**
The main-side capture already skips `__goldfinchInternal` sessions (`main.js:356`); the renderer
open-find path and fallback guard `isInternalTab(tab)` (`renderer.js:587`); the MCP ops carry the
op-local `isInternalContents` guard (DD4). `Ctrl+F` on an internal tab opens no bar; `findInPage` via the
admin key refuses internal. Per the Flight-1 debrief, the internal-refusal case is a **HAT/unit**
checkpoint, **not** an automation-surface step — the surface cannot open or enumerate internal tabs to
obtain a `goldfinch://` wcId.

**DD6 — Behavior-test apparatus = the M03 automation surface (dogfooding), audited both axes.**
- **Act**: `findInPage` / `stopFindInPage` MCP tools; `openTab` / `enumerateTabs` for setup.
- **Observe**: the `findInPage` return `{ activeMatchOrdinal, matches }` against a stable page with a
  **known** count of a chosen term; corroborated by `evaluate` (e.g. counting occurrences in the DOM).
  `stopFindInPage` asserted by a subsequent state read / no error.
- **Key identity**: the run uses a **jar key** for the parity assertion and the **admin** key only where
  the op-local internal guard would be exercised — but per DD5 the internal case is unreachable via the
  surface, so it is deferred to HAT/unit (not a live automation step).
- The visual find bar, match highlighting, and keyboard flow (`Ctrl+F`/`Esc`/`Enter`/`Shift+Enter`) are
  **HAT + a11y**, outside the automation apparatus (renderer-rendered, like the zoom chip).

### Prerequisites
- [ ] M03 automation surface runnable (`npm run dev:automation`) — landed (M03).
- [ ] `evaluate` tool available (F9) for the behavior-test corroboration — landed.
- [ ] Accessibility gate runnable (`npm run a11y`).
- [ ] A **jar key** (parity assertion) and the env-gated **admin** key available (per M03 gating).
  *(Note: `findInPage`/`stopFindInPage` do NOT exist today — they are deliverables of leg 2; the
  `find-in-page` behavior test runs at `verify-integration`, after that leg lands.)*

### Pre-Flight Checklist
- [x] All open questions resolved
- [x] Design decisions documented
- [x] Prerequisites verified (M03 surface, `evaluate`, a11y gate, jar + admin keys — all landed; the
  `findInPage`/`stopFindInPage` tools are leg-2 deliverables, gated behind `verify-integration`)
- [x] Validation approach defined (`find-in-page` behavior test drafted at `tests/behavior/find-in-page.md`;
  HAT for the visual bar + a11y gate)
- [x] Legs defined (3 + optional HAT)
- [x] Architect design review incorporated (1 cycle — *approve with changes*; all issues applied: DD3
  navigation-invalidation [high], DD4 net-new event-wrap framing [medium], CLAUDE.md count bump [medium],
  nested `.result` payload, preload path, lightbox guard + focus-restore as leg-1 deliverables,
  per-webview listener topology, WSLg spike)

---

## In-Flight

### Technical Approach

**Find bar (renderer chrome, primary).** A new floating overlay in `index.html` anchored top-right of the
webview region (`[ input ] n/m [↑] [↓] [✕]`), styled in `styles.css`. Opened by an `open-find` message
from main (the `Ctrl+F` `before-input-event` capture) or by the renderer keydown fallback; focuses the
input on open. The renderer drives the active tab's `<webview>` tag: `wv.findInPage(text, { findNext,
forward, matchCase })` on input/Enter/Shift+Enter, listening on the webview's `found-in-page` event —
reading **`e.result.{activeMatchOrdinal, matches, finalUpdate, requestId}`** (the renderer payload is
nested under `.result`; main's `webContents` delivers `result` as the 2nd arg) — to update the live
`n/m` (with the `activeTabId` race-guard). `Esc` (or the `✕` button) closes the bar, calls
`wv.stopFindInPage('clearSelection')`, and **restores focus to the page** (an explicit a11y acceptance
item — renderer focus-logic is exactly where Flight-1's HAT bugs lived). Per-tab state (`{ findOpen,
findText }`) persists across tab switches (DD3); on activating a tab with `findOpen`, re-show + re-issue
`findInPage` to refresh counts; on full `did-navigate` of a find-open tab, close + clear (DD3
invalidation). Guarded by `isInternalTab` and the open-lightbox check (`renderer.js:2061` pattern; the
lightbox keydown listener is at `~1216`) — the find bar is absent on internal tabs and its `Esc` must
not fight the lightbox's `Esc`-to-close.

**`stopFindInPage` action map** (the three Electron actions, `electron.d.ts`): close/dismiss (UI `Esc`/`✕`)
and the MCP `stopFindInPage` tool use **`'clearSelection'`**; tab-leave (DD3, keep the leaving tab's
highlight) uses **`'keepSelection'`**; `'activateSelection'` is unused.

**Ctrl+F capture (main-side).** Extend the `before-input-event` handler (`main.js:357`) with `key === 'f'
&& (control || meta)` → `event.preventDefault()` + send `open-find` to the renderer. The renderer
`document` keydown (`renderer.js:2053`) adds the chrome-focused `Ctrl+F` fallback alongside the existing
`Ctrl+M`/`Ctrl+Shift+P` shortcuts, with the `isInternalTab`+lightbox guards.

**Automation (MCP parity).** Add `src/main/automation/find.js` (`findInPage` — event-wrapped on
`found-in-page` `finalUpdate` with a timeout + foreground-first + op-local internal guard;
`stopFindInPage` — `clearSelection` + op-local internal guard). Wire each as an engine op (`engine.js`),
an MCP tool (`mcp-tools.js`, flat schemas), and a `WCID_FIRST_OPS` entry (`scope.js`), with unit tests
against a fake engine/`webContents` and a fake `found-in-page` emitter. Bump the tool-count assertions
(`automation-mcp-tools.test.js`, `automation-mcp-server.test.js`) and the count comment 24 → 26.

**preload bridge.** Add the find IPC to `src/preload/chrome-preload.js` mirroring the zoom surface:
`onOpenFind(cb)` (main → renderer, the `Ctrl+F` capture — mirrors `onOpenTab`; main sends via
`mainWindow.webContents.send('open-find', …)` like `main.js:336`'s `open-tab`). The UI find itself runs
on the `<webview>` tag in the renderer and needs no new IPC; only the `Ctrl+F` open signal crosses from
main.

### Checkpoints
- [x] `Ctrl+F` opens the find bar with the **page focused** (via `before-input-event`) and with the
  chrome focused (fallback); the bar focuses its input; no bar on internal tabs; lightbox guarded.
  *(HAT-confirmed.)*
- [x] Typing searches live; `n/m` count/position updates from `found-in-page`; `Enter`/`Shift+Enter`
  step forward/back; `Esc`/`✕` closes and clears the highlight. *(Stepping/`Enter` + close confirmed;
  live-type count update degraded on WSLg only — known issue, macOS-pending.)*
- [x] Per-tab find state preserved across tab switches (DD3): UI intent cached, counts re-queried — no
  stale `n/m`. *(HAT-confirmed.)*
- [x] `findInPage`/`stopFindInPage` MCP tools live, jar-scoped, op-local-internal-guarded, flat-schema,
  unit-tested; tool count 26. *(Note: DD4's main-side event-wrap was superseded by Deviation D1 —
  renderer-routed find — because `found-in-page` never fires on a main-process `<webview>` guest's
  `webContents`.)*
- [x] `find-in-page` behavior test run on the automation surface (jar key) — stepping/warm parity
  verified; cold-first-find WSLg-blocked (known issue); `npm run a11y` clean; docs updated.

### Adaptation Criteria

**Divert if**:
- The `<webview>` `found-in-page` event does not fire reliably on the dev platform (WSLg) — fall back to
  driving the UI find main-side via `webContents` + an IPC count broadcast (the zoom-style path), and
  assert the bar manually in HAT.
- `findInPage`'s `finalUpdate` event cannot be observed deterministically in the op (would undercut DD4's
  observability premise) — bound it with the timeout fallback and return the last-seen update.

**Acceptable variations**:
- Find bar exact placement/styling (top-right offset, animation) refined during HAT.
- MCP option naming (`findNext` vs `next`) settled at implementation, as long as schemas stay flat.

### Legs

> **Note:** Tentative; planned and created one at a time as the flight progresses.

- [x] `find-bar-ui` — the floating top-right find-bar component (markup, styles, open/focus/close),
  `Ctrl+F` main-side `before-input-event` capture (`main.js:357`, inserted **before** the `if (!action)
  return` at `:375`, beside `Ctrl+P`) + `open-find` IPC + renderer chrome-focused fallback
  (`renderer.js:2053`), renderer-driven `wv.findInPage`/`found-in-page` with the per-webview listener
  attached in `wireWebview` (`renderer.js:663`) and the `activeTabId` race-guard, reading `e.result.*`,
  `Enter`/`Shift+Enter`/`Esc`, live `n/m` count/position display, `stopFindInPage('clearSelection')` on
  close **+ focus-restore to the page**, per-tab UI-intent cache + re-query-on-restore + **`did-navigate`
  invalidation** (close+clear, beside the existing `media`/`selected`/`privacy` reset at
  `renderer.js:721`) (DD3), `isInternalTab` / internal-session no-op, **lightbox guard baked in** (the
  `renderer.js:2061` open-lightbox check; don't fight the lightbox `Esc` at `~1216`). Keyboard-operable,
  within the a11y gate (focus management, `aria-live` count). **First step: a ~5-min WSLg spike** that
  `<webview>` `found-in-page` fires reliably — if not, divert to the main-side + IPC-broadcast path (a
  materially different leg, per Adaptation Criteria).
- [x] `find-mcp-tools` — `src/main/automation/find.js` (`findInPage` event-wrapped on `found-in-page`
  `finalUpdate` + timeout + foreground-first + op-local internal guard; `stopFindInPage` →
  `clearSelection` + op-local internal guard) + **three-place registration** (`engine.js`,
  `mcp-tools.js` flat schemas, `scope.js WCID_FIRST_OPS`) + unit tests (fake engine/`webContents` + fake
  `found-in-page` emitter) + tool-count bumps (24 → 26).
- [x] `verify-integration` — author/run the `find-in-page` behavior test on the automation surface
  (jar key): assert `{activeMatchOrdinal, matches}` against a known term count, step forward/back via
  `findNext`/`forward`, `stopFindInPage` clears; corroborate with `evaluate`; `npm run a11y`. **Owns the
  docs + count bumps**: README keyboard-shortcuts table (add `Ctrl+F`, `Esc`, `Enter`/`Shift+Enter` for
  find); `docs/mcp-automation.md` (add `findInPage`/`stopFindInPage`); and the tool-count refs in **all
  three** places — `automation-mcp-tools.test.js`, `automation-mcp-server.test.js` (`EXPECTED_TOOL_COUNT`),
  **and the prose tool list in `CLAUDE.md:177`** (24→26, add both tool names — flagged by the Flight-1
  "stale CLAUDE.md count" debrief note). Regression sweep of specs touching the `before-input-event` /
  keydown handlers.
- [x] `hat-and-alignment` *(optional)* — guided HAT for the find bar: `Ctrl+F` open (page- and
  chrome-focused), live `n/m`, match highlighting, `Enter`/`Shift+Enter` stepping, `Esc`/`✕` close, the
  per-tab restore behavior (DD3), internal-tab no-op, and the lightbox interaction — fixing issues live
  until the operator is satisfied.

---

## Post-Flight

### Completion Checklist
- [x] All legs completed
- [ ] Code merged *(draft PR open; awaiting merge)*
- [x] Tests passing (unit 834 green; `find-in-page` behavior test live-verified for stepping/warm
  parity, cold-first-find WSLg-blocked as a documented known issue; a11y 0 new violations)
- [x] Docs updated (README shortcuts table; `docs/mcp-automation.md`; tool-count refs; CLAUDE.md prose)

### Verification
- **SC4** — `find-in-page` behavior test (MCP-driven match-count/position assertions + step
  forward/back + `stopFindInPage` clears) green on the automation surface; the visual find bar
  (`Ctrl+F`/`Esc`/`Enter`/`Shift+Enter`, live `n/m`, per-tab restore, internal no-op) HAT-confirmed;
  `npm run a11y` clean.
- **SC8 (part)** — `findInPage`/`stopFindInPage` discoverable and invocable over MCP, jar-scoped + admin;
  unit tests green; tool count 26.
