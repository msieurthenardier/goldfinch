# Flight Log: Conveniences & Event-Seam Re-architecture

**Flight**: [Conveniences & Event-Seam Re-architecture](flight.md)

## Summary

Planning in progress. The upstream reconnaissance (below) found the flight materially smaller than the
mission budgeted: Flight 3 already re-homed almost every renderer↔`<webview>`-element seam, leaving
`find.js` as the only `confirmed-live` element-coupled convenience. Operator confirmed the leaner scope
(find re-home + full active-view consolidation + docs/spec cleanup + full convenience-corpus
verification + HAT).

---

## Reconnaissance Report

Source artifact: the Flight-3 (Tab Surface) debrief's forward-looking action items + technical
recommendations. Each cited item walked against current code on `mission/05-webcontentsview-migration`.

| Item | Classification | Evidence | Recommendation |
|------|----------------|----------|----------------|
| Dead `find.js` automation find | `confirmed-live` | `src/main/automation/find.js:120,170` — `querySelectorAll('webview')` (now always empty) in injected find/stop code | **Leg 1** — re-home to main-process `wc.findInPage()` + `found-in-page` event |
| Renderer `found-in-page` listener | `already-satisfied` | No dead `tab.webview` listener in `renderer.js`; find results return via MCP/IPC, not a DOM listener | No re-home needed |
| Media-rescan seam | `already-satisfied` (minimal re-point done in F3) | `src/main/main.js:1554` — `ipcMain.on('rescan-media', {wcId})` → `getTabContents(wcId).send('rescan-media')` | None — fully on `webContents`/IPC |
| Privacy-stream listener | `already-satisfied` | `src/main/main.js:1546` — `guest-privacy-fp` uses `event.sender.id`, no element access | None |
| zoom / print / DevTools / context-menu / spellcheck / downloads | `already-satisfied` | `automation/zoom.js:49,76`; `automation/print.js:44`; `devtools.js:35`; `main.js:622` (`context-menu`→`page-context-menu` IPC); `main.js:1107,1628` (session-layer spellcheck); `downloads-manager.js` (main-process model) — all on `webContents`/IPC | Re-verify only (Leg 4 corpus) |
| `visibleWebTabWcId` / `!t.trusted` bookkeeping | `confirmed-live` (scattered) | `renderer.js:110,780-792,811,860-876,1096,1160,1166,1172,1260,2144,2282,2598` (~12 callsites) | **Leg 2** — consolidate to single active-view concept + `isWebTab()` |
| `capture-active-guest` comment invariant | `confirmed-live` | `src/main/main.js:1520-1534` — comment states chrome-only exposure but not "captures internal too; no exfiltration" | **Leg 3** — clarify comment |
| `farbling-correctness.md` citation | `drifted` | spec `:51` cites `tab.webview.reload()` / `renderer.js:1756`; real code is `tabNavigate(...)` at `renderer.js:2327` | **Leg 3** — fix citation |
| `CLAUDE.md` tab architecture | `confirmed-live` (stale) | goldfinch `CLAUDE.md:21,23,33,56,66,104` still describe tabs as `<webview>` elements | **Leg 3** — update to WebContentsView + freeze-frame + `INTERNAL_PARTITION` rule |
| `responsive-tab-strip.md` | `already-satisfied` | spec is MCP-only (`getChromeTarget`/`captureWindow`/`readDom`), no `<webview>` coupling | **Retire from scope** (M05F2 Rec 5 closed) |
| `tab-surface-geometry` / `internal-tab-menus` specs | not-yet-authored | absent from `tests/behavior/` | **Authored at planning** (2026-06-26) |
| `find-in-page.md` cold-start note | `needs-human-recheck` | spec `:9` documents a `<webview>` cold-start `{0,0}` quirk | **Leg 1** — re-verify under `WebContentsView`; update the note |

**Operator decision (2026-06-26):** confirmed the leaner scope; full active-view consolidation; full
convenience corpus as Witnessed runs; HAT included. `responsive-tab-strip` retired (already satisfied).

---

## Leg Progress

### Leg 1: find-rehome — 2026-06-27 — landed

**What changed:**

- `src/main/automation/find.js` — Both ops (`findInPage` / `stopFindInPage`) re-homed from the
  dead renderer-injection path (`querySelectorAll('webview')` + `chromeContents.executeJavaScript`)
  to operate directly on the guest `wc`. `findInPage` now calls `wc.findInPage(text, opts)`,
  captures the returned `requestId`, and resolves from the `found-in-page` event on `wc` via a
  `requestId`-correlated listener. Cold-start retry ported intact (resolve-on-nonzero, ≤5 retries
  at 500 ms, `findTimeoutMs` timeout, same opts on retry). MAX-retry exhaustion now immediately
  calls `finish(last)` (review fix — old renderer code had a silent spin-until-timeout). The
  post-activate stale-handle re-resolve result is now ASSIGNED to `wc` (fixing the bug in the old
  code that discarded the re-resolve and operated on the stale pre-activate handle).
  `stopFindInPage` now calls `wc.stopFindInPage('clearSelection')` directly. Both `chromeContents`-
  required throws dropped. Module/function header comments rewritten to the main-process
  `found-in-page` + `requestId`-correlation model. No `require('electron')` added (Electron-free
  discipline preserved).

- `test/unit/automation-find.test.js` — Full rewrite to the event-listener model. 23 tests, all
  green. Fake wc is an EventEmitter (node:events) with `findInPage`/`stopFindInPage` methods that
  record calls and return incrementing requestIds. No assertions on injected code strings, no
  `new Function(code)` parse guards, no `userGesture`/`chromeContents`-missing assertions. Covers:
  correlated resolve; foreign-requestId ignore; cold-start retry (re-issue + real count resolve);
  timeout fallback; listener cleanup on both resolve and timeout; opts threading; internal-session
  refusal before activate; foreground-first activate + double re-resolve (resolved===2); bad-handle
  / no-such-contents; MAX-retry exhaustion; stopFindInPage contract.

- `tests/behavior/find-in-page.md` — Known-issue note (lines 9-14) rewritten to describe the
  main-process `found-in-page` surface and the requestId-correlated retry mechanism. `<webview>`
  and "Flight-2 Deviation D1" framing removed. Whether the cold-start quirk still reproduces under
  WebContentsView is deferred to the Leg 4 Witnessed run.

**Test results:**
- `node --test test/unit/automation-find.test.js` — 23/23 pass
- `npm test` — 947/947 pass
- `npm run typecheck` — clean (no new errors)
- `npm run lint` — clean

**grep checks:**
- `grep -rn "querySelectorAll('webview')" src/` — no output
- `grep -rn "getWebContentsId" src/` — no output

**Deviations from leg spec:**
- None of substance. One minor review fix applied: MAX-retry exhaustion in the old renderer-injected
  code had an implicit `return` (no `finish(last)`) that would spin the interval until the timeout
  fired. The rewritten main-process op calls `finish(last)` on `attempts >= MAX` so exhaustion
  resolves immediately — consistent with the leg spec's explicit "MAX-retry exhaustion resolves
  `last`" requirement (and the leg implementation guidance confirmed it).

**Anomalies:** None.

---

### Leg 2: active-view-consolidation — 2026-06-27 — landed

**What changed (`src/renderer/renderer.js` only):**

- `visibleWebTabWcId` decl + comment renamed to `activeViewWcId` with unified-concept JSDoc.
- `isWebTab(tab)` helper added beside `isInternalTab` (`return !isInternalTab(tab)`).
- All 14 `.trusted`-based decision branches replaced by `isInternalTab`/`isWebTab`:
  - `updateNavButtons` `:1108` — `tab.trusted` → `isInternalTab(tab)`
  - `navigate` `:1137` — `!tab.trusted` → `isWebTab(tab)`
  - Back / forward / reload click handlers `:1160, :1166, :1172` — `!t.trusted` → `isWebTab(t)`
  - `rescanMedia` click `:1260` — `t.trusted` → `isInternalTab(t)`
  - `runFind` `:2099` — `!tab.trusted` → `isWebTab(tab)`
  - `closeFind` `:2144` — `!t.trusted` → `isWebTab(t)`
  - Shields reload button `:2282` — `!t.trusted` → `isWebTab(t)`
  - `newIdentity` `:2327` — `!tab.trusted` → `isWebTab(tab)`
  - Keyboard reload shortcut `:2598` — `!t.trusted` → `isWebTab(t)`
  - `activateTab` ready-branch `:859` and not-ready branch (collapsed, see below)
  - `createTab` `.then` `:790`, `unfreezeGuest` `:1096` (folded into tracker rework below)
- Tracker consolidated: three setter sites (`activateTab` ready-branch, `createTab` `.then`,
  `unfreezeGuest`) set `activeViewWcId = tab.wcId` unconditionally (web or internal).
- The two identical not-ready branches in `activateTab` collapsed to one: reads tracker before
  clearing, calls `tabHide(activeViewWcId)`, sets `activeViewWcId = null`. Outgoing internal view
  now hidden during the not-ready window (the ONE intentional behavior delta — design-approved).
- `closeTab`: `if (tab.wcId === activeViewWcId) activeViewWcId = null`.
- `freezeGuest` JSDoc updated to drop `visibleWebTabWcId` reference. Code unchanged.
- `unfreezeGuest` JSDoc updated to unified framing.

**Test results:**
- `npm test` — 947/947 pass
- `npm run typecheck` — clean
- `npm run lint` — clean
- `npm run a11y` — deferred to Leg 5 HAT (requires live GUI + automation surface)

**Verification greps:**
- `grep -n "\.trusted" src/renderer/renderer.js` → empty (only JSDoc/comments and the `tabCreate` field pass)
- `grep -n "if (!trusted)" src/renderer/renderer.js` → empty
- `grep -rn "visibleWebTabWcId" src/` → empty

**Substrate-guard audit:**

| Guard | Location | Correct under unified concept? | Notes |
|-------|----------|-------------------------------|-------|
| `isInternalTab(tab)` (find-bar gate) | `activateTab` :843 | Yes | Correct — find bar never shown for internal tab |
| `activeViewWcId = tab.wcId` (ready-set) | `activateTab` :858 | Yes | Uniform — web or internal view tracked after tabSetActive |
| `tabHide(activeViewWcId)` + clear | `activateTab` :862-863 | **Yes — verified explicitly** | Reads tracker BEFORE clearing; hides the outgoing view regardless of tab type; the one behavior delta (internal outgoing now hidden) is design-approved |
| `activeViewWcId = null` (close-clear) | `closeTab` :809 | Yes | Only clears if the closed tab was the tracked one |
| `activeViewWcId = tab.wcId` (then-set) | `createTab .then` :791 | Yes | Only sets if this tab is still active; uniform tracking |
| `activeViewWcId = t.wcId` (unfreeze-set) | `unfreezeGuest` :1086 | Yes | freeze→switch→unfreeze: `activeTab()` returns the NEW active tab; tracker updated to new view — correct |
| `isInternalTab(tab)` (toolbar disable) | `activateTab` :875 | Yes | Tab-scoped toolbar disable; web-vs-internal |
| `isInternalTab(tab)` (DevTools state) | `activateTab` :884 | Yes | Skip DevTools state query on internal tab |
| `isInternalTab(tab)` (nav lock) | `navigate` :1118 | Yes | Internal-tab nav lock; reroutes web URL to new tab |
| `isWebTab(tab)` (navigate loadURL) | `navigate` :1127 | Yes | Only web tabs navigate |
| `isWebTab(t)` (back/forward/reload clicks) | `:1150, :1156, :1162` | Yes | Internal tabs have buttons disabled; belt-and-suspenders |
| `isInternalTab(t)` (rescan guard) | `rescanMedia` :1250 | Yes | Internal tabs excluded by disabled state; redundant but safe |
| `isWebTab(tab)` (runFind) | `runFind` :2089 | Yes | Find only applies to web tabs |
| `isWebTab(t)` (closeFind stop) | `closeFind` :2134 | Yes | Find stop only for web tabs |
| `isWebTab(t)` (shields reload, new identity, kbd reload) | `:2272, :2317, :2588` | Yes | All web-only IPC paths; internal tabs excluded by disabled state |
| `isInternalContents(wc)` | `src/main/automation/resolve.js`, `observe.js`, `find.js`, etc. | Yes (out of scope) | Main-process guard; unaffected by this leg |

**freeze → switch-while-frozen → unfreeze sequence:** `activateTab` does not check `guestFrozen`; a switch while frozen updates `activeTabId` but does not change `activeViewWcId` (no `tabSetActive` is sent since frozen). `unfreezeGuest` reads `activeTab()` (the NEW active tab after the switch) and re-shows + sets `activeViewWcId = t.wcId` — leaves the tracker pointing at the newly-active view. Correct.

**Deviations from leg spec:** None.

**Anomalies:** None.

---

### Leg 3: docs-and-spec-cleanup — 2026-06-27 — landed

**What changed:**

- `CLAUDE.md` — Full `<webview>`-to-`WebContentsView` architecture sweep across all stale present-tense
  passages: Main bullet, Preloads bullet, Renderer bullet, cross-cutting Webviews/`asar:false`/Frameless
  window/security-gotcha facts, Two-point security boundary, internal-page model (`internal webview`,
  `will-attach-webview`, `webviewTag`, `existing.webview.loadURL`), DevTools detach reason, spellcheck
  session bullet. All rewritten to the construction-time `tab-create` / `WebContentsView` framing. Three
  new doc notes added: **freeze-frame pattern** (`freezeGuest`/`unfreezeGuest` with `captureActiveGuest`,
  `tabHide`, `tabSetActive`; placed after Page context menu section); **`capture-active-guest`
  chrome-only contract** (paired with freeze-frame; explains why `isInternalContents` is not applied);
  **`INTERNAL_PARTITION` import-never-derive rule** (folded into the existing "single-sourced" bullet,
  expanding it with the security consequence of drift).

- `tests/behavior/farbling-correctness.md` — New Identity Variant section rewritten: removed
  `tab.webview.reload()` / `renderer.js:1756` dead reference; replaced with the real
  `window.goldfinch.tabNavigate({ wcId: tab.wcId, verb: 'reload', args: [] })` (symbol-form,
  inside `newIdentity`). `newIdentity()` citation updated to symbol-form (no bare line number); same
  for `identity-new` handler and `rerollSeed`. `webview-preload.js:233` SEED citation confirmed
  accurate (still correct at that line), left as-is.

- `src/main/main.js` (comments only) — Two stale `will-attach-webview` code comments reworded:
  - `~:1367`: "byte-exact webPreferences matching will-attach-webview's internal branch" →
    "byte-exact webPreferences set at construction time on the trusted `tab-create` path"
  - `~:1397`: "NO spellcheck key — see will-attach-webview for the web branch" →
    "NO spellcheck key — the session-layer applier (applySpellcheck) owns the web toggle"

- `src/main/devtools.js` (comment only) — JSDoc for `setDevTools` updated: "`<webview>` guests have
  no native host region for docked DevTools" → "in-window docked DevTools via setDevToolsWebContents
  is a BACKLOG item (not yet implemented); detached is the shipped mode"

**`capture-active-guest` comment — already correct (no clarification added):**
The `ipcMain.handle('capture-active-guest', …)` comment block (`main.js:1514-1523`) already states:
"ONLY caller is the trusted chrome renderer's freeze helper — `captureActiveGuest` is exposed solely
on chrome-preload, never on any guest preload. It captures, as a still, a page the chrome ALREADY
displays in its own #webviews region; nothing crosses a trust boundary that the chrome doesn't already
hold. (`isInternalContents` is intentionally NOT applied here…)" — the chrome-only and
no-exfiltration invariant is fully stated. Left unchanged. Recorded here per spec.

**Test results:**
- `npm test` — 947/947 pass (no code changes)
- `npm run typecheck` — clean
- `npm run lint` — clean

**Verification greps:**
- `grep -rn "<webview>" CLAUDE.md` → 1 result, line 33: "A `WebContentsView` (and its predecessor
  `<webview>`)" — intentional historical reference in the compositing-gotcha section. Correct.
- `grep -rn "tab\.webview" tests/behavior/farbling-correctness.md` → no output
- `grep -rn "will-attach-webview" src/main/main.js` → no output
- `grep -rn "will-attach-webview\|webviewTag" CLAUDE.md` → no output

**Deviations from leg spec:** None.

**Anomalies:** None.

---

### Leg 4: verify-convenience-corpus — 2026-06-27 — DEFERRED (apparatus)

The formal Witnessed convenience corpus + `npm run a11y` gate could not run: the in-loop session's
goldfinch MCP client is jar-authed and wired to a pre-existing instance, so the admin-only observables
the specs need (`getChromeTarget`, `captureWindow`) are refused (see Anomalies + Deviations). Operator
chose to accept SC4 via the Leg-5 HAT for this landing and carry the formal corpus + a11y gate forward
to a session wired admin@flight-4. Leg status left `ready` (deferred), not `completed`.

---

### Leg 5: hat-and-alignment — 2026-06-29/30 — completed

Guided on-screen HAT on the flight-4 instance (WSLg). **All steps pass.**

- **Step 1 (find bar):** initially FAILED — Ctrl+F didn't focus the input, search wasn't incremental,
  stepping sluggish. Diagnosed a Flight-3-migration focus regression and **fixed inline** (see Flight
  Director Notes 2026-06-29): `getChromeContents()?.focus()` before `open-find` (`main.js` ~:583) +
  ↑/↓ keyboard stepping and button focus-steal suppression (`renderer.js` ~:2155). Operator re-verified:
  "working well." Residual rapid-click step coalescing = inherent Chromium `findInPage` async, documented.
- **Step 2 (web-tab menu freeze/restore):** kebab + container render above the frozen still; restore +
  scroll correct. PASS.
- **Step 3 (internal-tab menu freeze/restore):** kebab + container render **above** on
  `goldfinch://settings` and `goldfinch://downloads` — the Flight-3 occlusion regression class stays
  fixed. PASS.
- **Step 4 (internal → new-tab, Leg-2 behavior delta):** no flash/black-band on the switch. PASS —
  confirms the uniform `activeViewWcId` tracking is correct on screen.
- **Step 5 (panel-resizes-guest):** media + privacy panels reflow the guest on web AND internal tabs,
  no overlap/gap/clip, restore on close. PASS.
- **Step 6 (geometry on resize/maximize):** active view tracks the slot; the two carried WSLg known
  issues (internal-tab menu blip; maximize ~2/3) re-checked — operator reported all acceptable. PASS.

**HAT-fix verification basis:** the inline find-focus fix (~20 lines, `main.js` + `renderer.js`) was
verified by the unit suite (947/947), typecheck + lint green, and the operator's on-screen re-verify —
landed without a separate Reviewer pass (proportionate to a small, thrice-verified inline HAT fix).

**Also during the HAT:** operator-directed exploration of a floating overlay find bar → in-goldfinch
spike GREEN → spun out to **Flight 7** (see Flight Director Notes + the Flight-7 seed). Not built in
Flight 4.

---

## Decisions

### Flight Director Notes

- **2026-06-26 — Flight planned via `/flight`.** Recon reshaped the mission's "budgeted as a rewrite"
  framing: F3's opportunistic re-homing left only `find.js` live. Recorded here rather than rewriting the
  mission's Flight-4 line (the original framing stays as commentary; this log + flight.md are the live
  spec). Two behavior specs (`tab-surface-geometry`, `internal-tab-menus`) authored inline at planning so
  their `captureWindow` rendered-state apparatus shaped the leg breakdown (DD4).
- **2026-06-26 — Design review (Architect, codebase-grounded) → approve with changes; incorporated.**
  Three load-bearing corrections from real code reads: (1) **DD1 narrowed** — the user find bar already
  works through the F3-migrated `tab-find`/`tab-found-in-page` main-process path (`main.js:670,1499`);
  `found-in-page` delivery is proven, not a risk. Leg 1 is now only the `find.js` MCP ops + a rewrite of
  the injection-coupled `automation-find.test.js` (~573 lines), with `requestId` correlation to avoid
  double-fire/concurrent-find misattribution. (2) **DD2 reframed** — the three F3 HAT regressions are
  already individually fixed and `isInternalTab()` already exists (`renderer.js:911`); consolidation is
  preventive-hardening, not a bug fix. **Operator re-confirmed full structural consolidation anyway.**
  (3) **Spec apparatus fixed** — the WSLg-fallback `captureWindow` draws the live-hidden guest over the
  chrome, so the menu-above pixel check is unreliable there; both new specs now make `readDom` of
  `#webviews backgroundImage` the **authoritative** freeze tell and demote pixels to corroborating.
  Also: CLAUDE.md staleness wider than recon (added `:27,28,65,72,75,78`); 2 new specs run as a gating
  sub-step before the 9-spec corpus. A second Architect pass was skipped — the edits directly implement
  the review's own recommendations. Flight set to `ready`.
- **2026-06-27 — Execution via `/agentic-workflow`.** Flight branch `flight/04-conveniences-event-seam`
  cut off the mission branch; planning baseline committed (`6274ea8`). Legs 1-3 designed (each
  design-reviewed by a Developer (Sonnet) → approve-with-changes, all incorporated; second design pass
  skipped each time as edits implemented the review directly), implemented by Developer agents under the
  deferred-commit model, then reviewed together by an independent Reviewer (Sonnet, never Opus) →
  `[HANDOFF:confirmed]`, no blocking issues. Committed as `76fb7e4` (legs 1-3 code + artifacts; `npm
  test` 947/947, typecheck + lint green). Legs 4-5 designed + committed (`f0f55c2`). No push / no PR —
  per the mission's long-running-local-branch constraint (Flight-3 precedent: land by local merge into
  the mission branch, `main` untouched).
- **2026-06-27 — Leg 4 (automated convenience corpus) DEFERRED — apparatus blocker.** Launched a
  flight-4 instance on `127.0.0.1:49710` (admin + jar keys minted). But the in-loop session's
  `mcp__goldfinch__*` client is **jar-authed and wired to a different, pre-existing instance** (enumerate
  showed an unrelated `work`-jar tab), so the admin-only observables the two new specs require
  (`getChromeTarget`, `captureWindow`) are refused — the Witnessed corpus cannot run through the
  pre-wired apparatus this session. **Operator decision: pivot to the Leg 5 HAT** (on-screen, no admin
  MCP needed) as the SC4 acceptance gate for this landing; the formal Witnessed corpus + `npm run a11y`
  gate are carried forward as a follow-up to run in a properly-wired (admin@flight-4) session. The
  flight debrief carries this forward. See Anomalies.
- **2026-06-29 — HAT (Leg 5) surfaced + fixed a find-bar focus regression (SC4).** On-screen HAT Step 1:
  Ctrl+F did not move OS keyboard focus to the find input (keystrokes went to the page), incremental
  search appeared dead ("had to hit Enter"), and stepping was sluggish. Root cause (code-confirmed): the
  guest `before-input-event` Ctrl+F branch (`main.js` ~:577) sent `open-find` to the chrome but never
  moved OS focus to the chrome view — the guest `WebContentsView` kept native focus, so the renderer's
  `findInput.focus()` was DOM-only. A genuine Flight-3-migration regression (find bar untouched by Legs
  1-3). **Fixed inline:** `getChromeContents()?.focus()` before `send('open-find')` (mirrors the
  `main.js:1637` spellcheck focus precedent) + wired ↑/↓ keyboard stepping in the find input
  (`renderer.js`), and `mousedown preventDefault` on the step buttons to keep the input focused. Operator
  re-verified Step 1 on screen: "working well." Residual: very-rapid step-button clicks coalesce —
  inherent Chromium `findInPage` async behavior, documented not over-engineered. (Tests 947/947,
  typecheck/lint green.) These fixes land with Flight 4.
- **2026-06-29 — Overlay find bar spun out to a new flight (Flight 7); Flight 4 lands without it.**
  During the HAT the operator asked to make the find bar *float* over the live guest. A live HTML bar
  can't composite over an opaque guest `WebContentsView` (native layer wins) — which is why the bar
  currently insets the guest. Per the project's own "spike webview-region mechanisms first" rule, ran a
  spike: a standalone Electron spike was inconclusive (WSLg GPU init differed from goldfinch), but an
  **in-goldfinch env-gated spike was GREEN** — a small overlay `WebContentsView` added after the guest
  z-orders above it, paints its web content over the live guest, takes keyboard input, page stays live
  (operator-confirmed on screen). Spike reverted (find-focus fix preserved). A first leg design
  (`legs/06-find-overlay-view.md`, since removed) was design-reviewed → **needs-rework + flight-sized**.
  **Operator decision: make it Flight 7, land Flight 4 now.** See the **Flight-7 seed** below.

### Flight-7 seed — floating overlay find bar (proven; reviewed; deferred)

Carry-forward design input for planning Flight 7 via `/flight`:
- **Primitive (proven on WSLg, in-goldfinch):** a dedicated overlay `WebContentsView`,
  `mainWindow.contentView.addChildView(overlay)` AFTER the active guest so it z-orders on top; positioned
  over the guest's top strip; the guest is NOT inset. Paints + takes input live.
- **Architecture sketch:** new `find-overlay.html`/`.js`/`-preload.js` (chrome-class file:// trust);
  main owns lifecycle/positioning/focus/teardown.
- **Position-sync (centralize):** reposition the overlay wherever main sets the active guest's bounds
  (`tab-set-active` + `tab-set-bounds`) — that path already receives every renderer-computed geometry
  change (resize/maximize/panel-toggle/tab-switch via `sendActiveBounds`→those handlers). Re-`addChildView`
  the overlay after the guest on `tab-set-active` (guest re-add there would otherwise bury it). Reuse the
  Flight-3 DPR→DIP discipline.
- **Review rework points to resolve at design (design-review verdict):** (1) count delivery — main's
  per-tab `wireTabViewEvents` `found-in-page` should send the count **directly** to the overlay
  webContents (path B, single-hop) when find is overlay-active, not via a renderer round-trip; (2) specify
  the IPC channel set (open/close overlay carrying `{wcId, findText}`; overlay→main `query`; main→overlay
  `count`/`init`); (3) freeze/find-open interaction — **hide the overlay during a menu freeze, restore in
  `unfreezeGuest`** (note `sendActiveBounds` early-returns when `guestFrozen`, so the restore must live in
  `unfreezeGuest`, not the bounds handler) — this also satisfies the operator's "find should hide when a
  context menu appears" instinct; (4) retarget the Ctrl+F focus to `overlayView.webContents.focus()`;
  (5) carry the ↑/↓ stepping + per-tab restore + internal-tab exclusion + a11y (`role=search`,
  `aria-live` count) into the overlay. **Stage:** scaffold+position → find-routing+count → cutover+HAT.
- **Stretch:** the same overlay tech could host the kebab/container/context menus, **retiring the
  freeze-frame hack** — a possible Flight-7 follow-on or its own flight.

---

## Deviations

### Leg 4 automated corpus → HAT (apparatus-driven)
**Planned**: run the two new rendered-state specs + the nine-spec convenience corpus + `npm run a11y` as
Witnessed runs (Leg 4), then the HAT (Leg 5).
**Actual**: the session's goldfinch MCP apparatus is jar-authed against a pre-existing instance, not an
admin connection to the flight-4 instance — admin-only observables refused. Pivoted to the Leg 5 HAT as
the SC4 acceptance gate; deferred the formal corpus + a11y gate to a follow-up session with admin MCP
wired to the flight-4 instance.
**Reason**: apparatus wiring is a session-environment fact outside the flight's code; the HAT verifies
the same SC4 rendered surface (find bar, menu freeze/restore web+internal, panel-resizes-guest,
geometry) directly on screen without needing admin MCP.

---

## Anomalies

### Session goldfinch MCP apparatus jar-authed against a foreign instance
**Observed**: with a flight-4 instance running on `:49710` (admin key minted), the session's
`mcp__goldfinch__*` tools returned `automation: admin-only` for `getChromeTarget` and `captureWindow`,
and `enumerateTabs` listed an unrelated `work`-jar tab (`http://localhost:8485/#admin/providers/...`) —
i.e. the MCP client is jar-scoped and connected to a *different*, pre-existing goldfinch, not the
flight-4 instance.
**Severity**: degraded (blocks the automated Witnessed corpus this session; does not affect the shipped
code, which the HAT verifies on screen).
**Resolution**: deferred the formal corpus + a11y gate to a session where the goldfinch MCP is wired to
the flight-4 instance with the admin key; SC4 accepted via the Leg 5 HAT for this landing.

---

## Session Notes

_(none yet)_
