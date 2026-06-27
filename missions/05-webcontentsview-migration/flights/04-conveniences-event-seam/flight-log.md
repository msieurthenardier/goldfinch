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

---

## Deviations

_(none yet)_

---

## Anomalies

_(none yet)_

---

## Session Notes

_(none yet)_
