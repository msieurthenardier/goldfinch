# Flight: Conveniences & Event-Seam Re-architecture

**Status**: landed
**Mission**: [WebContentsView Migration](../../mission.md)

## Contributing to Criteria
- [ ] **SC4** — Conveniences parity (with event-seam re-architecture): zoom, print/Save-as-PDF,
  find-in-page, DevTools, page context menu, spellcheck, downloads all keep working on the native guest
  surface; the renderer↔`<webview>`-element seams are re-homed to the main-process `webContents`.
- [ ] **SC6 (partial)** — the `findInPage`/`stopFindInPage` MCP ops are restored to functional on the
  view surface (the full MCP parity sweep remains Flight 5).

---

## Pre-Flight

### Objective

Finish the event-seam migration and prove conveniences parity on the native view surface. Flight 3
opportunistically re-homed **almost every** renderer↔`<webview>`-element seam while migrating tabs
(zoom, print, DevTools, context menu, spellcheck, downloads, media-rescan, and the privacy stream all
already route through the main-process `webContents`/IPC — see the Reconnaissance Report in the flight
log). The **one** confirmed-live element-coupled seam that remains is the automation **find** path
(`src/main/automation/find.js` still injects a script that does `querySelectorAll('webview')`, now
always empty — so `findInPage` is dead). This flight (1) re-homes find to the main-process
`webContents`, deleting the Deviation-D1 renderer-injection workaround; (2) consolidates the scattered
web-only active-view bookkeeping (`visibleWebTabWcId` / `!t.trusted`) into a single active-view concept
to root-cause the Flight-3 HAT regression class; (3) fixes a drifted spec citation, the stale
`<webview>`-era architecture docs in `CLAUDE.md`, and the `capture-active-guest` comment invariant; then
(4) runs the **full convenience behavior-test corpus** plus two newly-authored specs
(`tab-surface-geometry`, `internal-tab-menus`) as the SC4 acceptance net, capped by an interactive HAT.

### Open Questions
- [x] Which event seams actually still need re-homing? → **Reconnaissance Report (flight log):** only
  `find.js` (the MCP automation ops) is `confirmed-live`; all other conveniences already route through
  `webContents`/IPC. See DD1.
- [x] **Does the user-facing find bar (Ctrl+F) currently work?** → **YES** (design-review finding,
  code-confirmed). The bar already routes through the Flight-3-migrated main-process path: `tab-find` IPC
  (`main.js:1499`) → `wc.findInPage()` → the permanent `found-in-page` listener (`main.js:670`) →
  `tab-found-in-page` → renderer `onTabFoundInPage` (`renderer.js:2787`). The bar needs **no change**;
  only the MCP `findInPage`/`stopFindInPage` automation ops in `find.js` are dead. See DD1.
- [x] Is `found-in-page` delivered to the main-process `webContents` on the view surface? → **YES,
  proven in production** since Flight 3 (`main.js:670`). There is no "warning shot"; DD1's re-verify
  was over-cautious. See DD1.
- [x] How deep should the `visibleWebTabWcId`/`!t.trusted` consolidation go? → **Operator decision:**
  full active-view concept. **Re-opened by design review** — the three F3 HAT regressions this targeted
  are *already individually fixed* in current code and an `isInternalTab()` predicate already exists
  (`renderer.js:911`), so full consolidation is now preventive-hardening/readability, not a live-bug
  fix. **Re-confirmed at Phase 6: operator chose full structural consolidation** with eyes open. See DD2.
- [x] How thorough is the SC4 acceptance net? → **Operator decision:** full convenience corpus as
  Witnessed runs + the two new specs + HAT. See DD3.
- [ ] **Does the WSLg cold-start find quirk** (first `findInPage` on a fresh guest returns `{0,0}`,
  documented in `find-in-page.md`) **still reproduce under `WebContentsView`**, or was it a `<webview>`
  artifact? Re-verified in Leg 1. **If it reproduces**, the resolve-on-nonzero retry currently living in
  the injected script (`find.js:117-132`, being deleted) must be **re-ported to the main-process
  listener** — not merely a doc update. The spec's known-issue note (`find-in-page.md:9`) is rewritten to
  the new surface regardless.

### Design Decisions

**DD1 — Find re-home: delete the D1 injection in `find.js`; serve the MCP ops from the main-process
`found-in-page` event.** *(Scope narrowed by design review — the seam is smaller than recon implied.)*
The Deviation-D1 renderer-injection workaround in `src/main/automation/find.js` (the `findInPage`/
`stopFindInPage` **MCP automation ops**) existed only because an Electron `<webview>` does not deliver
`found-in-page` to the main-process `webContents`. That reason is structurally gone: guests are now
`WebContentsView`s whose `webContents` **already** emit `found-in-page` to main — proven in production
since Flight 3, where the **user find bar already runs through it** (`tab-find` → `wc.findInPage()` →
the permanent `found-in-page` listener at `main.js:670` → `tab-found-in-page` → `renderer.js:2787`). So:
- **The find bar needs no change.** Leg 1 is *only* `find.js` (delete the ~130-line injection that does
  `querySelectorAll('webview')` at `:120,:170`) + its injection-coupled unit test
  (`test/unit/automation-find.test.js`, ~573 lines asserting the injected code string — **must be
  rewritten** to model the event-listener architecture; this is in Leg-1 scope, not just `find.js`).
- **Listener model (decided):** do **not** attach a per-call `wc.on('found-in-page')` (it would
  double-fire alongside the existing permanent listener and misattribute concurrent finds). Instead
  correlate on Electron's `requestId` — `wc.findInPage()` returns the `requestId`, and `found-in-page`
  carries it — via a `requestId → resolver` map fed by a single listener path, serving the MCP op while
  the existing bar forward is undisturbed.
- Rationale: simpler, correct, and the structural reason for the hack is gone.
- Trade-off: only the WSLg cold-start quirk remains to re-verify (see Open Questions — if it reproduces,
  the retry is re-ported to the main listener, not just documented).
- Invariant (no security relaxation): the re-home routes through the existing jar-scoped `wcId`
  resolution (`resolve.js`) and the op-local `isInternalContents` guard (`find.js:87,160`) — `out-of-jar`
  refusal and the internal-tab no-op are preserved, not widened (the unit tests pinning internal-refusal
  even under `allowInternal:true` stay).

**DD2 — Active-view consolidation + substrate-guard audit (preventive hardening).**
*(Reframed by design review.)* Replace the scattered, web-only `visibleWebTabWcId` + raw `!t.trusted`
dual-tracking (~12 callsites across `createTab`/`activateTab`/`closeTab`/`freezeGuest`/`unfreezeGuest` +
nav/rescan guards, `renderer.js:110,780-792,811,860-876,1096,1160,1166,1172,1260,2144,2282,2598`) with a
single **active-view** concept and a consistent `isWebTab()`/`!isInternalTab()` predicate. Bundle the
debrief's **substrate-guard audit** (Rec 1): grep every `!t.trusted` / `tab.webview` / `isInternalContents`
/ `visibleWebTabWcId` reference and confirm each is correct under the unified concept.
- Rationale (corrected): the three Flight-3 HAT regressions this targeted are **already individually
  fixed** in current code (`freezeGuest:1058` keys on `wcId` not trust; `sendActiveBounds:1043` bounds
  internal views; `capture-active-guest:1513` captures internal deliberately), and an `isInternalTab()`
  predicate **already exists** (`renderer.js:911`, used at ~13 sites). So this is **preventive hardening
  + readability** (consistent predicate, collapse `visibleWebTabWcId`), not a live-bug fix.
- Highest-risk site (audit must verify explicitly): `visibleWebTabWcId` is specifically *the outgoing
  web tab to hide* when switching to an internal tab (`renderer.js:864-876`). A naive "single active-view
  wcId" merge must still distinguish "hide the outgoing web view" from "incoming view is internal" — do
  not flatten this away.
- Trade-off: touches a working renderer surface → regression risk for a now-readability-grade benefit.
  Mitigated by the new `tab-surface-geometry` spec (Leg 4) + the HAT (Leg 5). **Divert** to the minimal
  predicate sweep + `visibleWebTabWcId` collapse (no structural rewrite) if consolidation destabilizes
  freeze/geometry beyond inline-fixable.
- **Depth — DECIDED (operator, Phase 6, after the corrected rationale): full structural consolidation.**
  The operator chose the cleanest end state (single active-view abstraction) over the lighter predicate
  sweep, accepting the readability-grade benefit and the churn on a working surface, with the geometry
  spec + HAT as the regression net.

**DD3 — Verification = full convenience corpus as Witnessed runs + two new specs.**
SC4's acceptance net is the convenience behavior-test corpus run on the new surface. Per operator
choice, run the **full** set as formal Witnessed runs: `page-zoom`, `print-to-pdf`, `find-in-page`,
`devtools-cdp-conflict`, `page-context-menu`, `kebab-menu`, `menu-dismissal`, `spellcheck`,
`downloads-surface`, plus the two new specs below. Apparatus: the admin MCP surface
(`getChromeTarget` → chrome `wcId`; `captureWindow` for rendered pixels) for chrome-frame behaviors,
and the goldfinch MCP guest-addressed ops (`findInPage`, `setZoom`/`getZoom`, …) for the automation
parity assertions — the same apparatus the existing specs already use (no new seam required).
- Trade-off: the heaviest leg; live + time-consuming. A spec that fails on a re-confirmed WSLg-class
  artifact lands as an operator-accepted known issue with disposition recorded, not a flight blocker.
- **Ordering (design-review fix):** the two brand-new draft specs run **first**, as a gating sub-step —
  new specs often need an apparatus fix on first run; validating them before the 9-spec corpus avoids a
  late spec-apparatus bug forcing a corpus restart.
- `responsive-tab-strip` is **retired** from this corpus (recon `already-satisfied` — MCP-only, no
  `<webview>` coupling; closes M05F2 Rec 5).

**DD4 — Two new behavior specs authored at planning (apparatus observability audited).**
Authored inline during this planning (per the flight workflow), before legs lock, so the apparatus
choice shapes the breakdown:
- `tab-surface-geometry` — freeze open/dismiss (still painted in `#webviews`, live guest hidden, then
  restored), panel-resizes-guest, find-bar inset. **Observable via `captureWindow`** (a window grab
  composites chrome + the guest view, so freeze vs. live is a pixel-observable delta), corroborated by
  reading the chrome `#webviews` `backgroundImage` via `readDom`.
- `internal-tab-menus` — kebab (⋮) and container (▾) menus render **above** the frozen still and
  freeze/restore correctly **while on** an internal `goldfinch://` tab (Settings / Downloads) — the
  exact case the Flight-3 per-leg review missed. **Observable via `captureWindow`** (the menu painted
  over the still is rendered-state), corroborated by `readAxTree`/`readDom` for menu structure.
- Both assert **rendered** state (`captureWindow`), never DOM geometry alone — the mission's SC2
  "DOM-correct ≠ render-correct" discipline.

**DD5 — Interactive HAT included** (operator choice). A guided on-screen pass closes the flight: find
bar, menu freeze/restore on web *and* internal tabs, panel-resizes-guest, geometry on resize/maximize;
issues fixed inline. Re-checks the two carried WSLg known issues.

**DD6 — macOS remains unverified (carry-forward DD9).** WSLg stays the in-loop venue; the two carried
WSLg-class known issues (internal-tab menu-open blip; maximize ~2/3 screen) are re-checked at the HAT
but not resolved here — the macOS landing gate is Flight 6.

### Prerequisites
- [ ] App launches via `npm run dev:automation` with `GOLDFINCH_AUTOMATION_DEV_MINT=1`
  `GOLDFINCH_AUTOMATION_ADMIN=1` and a pinned `GOLDFINCH_MCP_PORT` (admin + jar keys captured from the
  `AUTOMATION_DEV_MINT` stdout line). **Port-conflict check:** pick a free loopback port at run time
  (prior sessions used 49707/49710) — confirm nothing else is bound before launch.
- [ ] The two new specs (`tab-surface-geometry`, `internal-tab-menus`) authored before Leg 4 runs
  (authored during this planning — see `tests/behavior/`).
- [ ] Mission branch up to date; flight branches `flight/04-conveniences-event-seam` off the mission
  branch (not `main`), per the mission's long-running-branch constraint.

### Pre-Flight Checklist
- [x] All open questions resolved or assigned to a leg
- [x] Design decisions documented
- [x] Prerequisites verified
- [x] Validation approach defined
- [x] Legs defined

---

## In-Flight

### Technical Approach

Re-home the one live seam, then consolidate, document, and verify. `find.js` drops its DOM-injection
body for `wc.findInPage()` + a main-process `found-in-page` listener keyed on the resolved guest `wcId`,
fanning the single result to the MCP caller and the chrome find bar; the jar-scope + internal guards are
unchanged. The renderer's web-only active-view bookkeeping collapses to one active-view concept with an
`isWebTab()` predicate, with a substrate-guard audit confirming every old-substrate-keyed guard is
correct. Docs and a drifted spec citation are corrected, and the `capture-active-guest` comment states
its chrome-only/no-exfiltration invariant. Verification runs the full convenience corpus + two new
rendered-state specs as Witnessed runs, then an interactive HAT.

### Checkpoints
- [x] `find.js` MCP ops re-homed to the main-process `found-in-page` event (correlated by `requestId`);
  **no `querySelectorAll('webview')` remains anywhere in `src/`**; jar-scope + internal-tab guards
  preserved; the injection-coupled `automation-find.test.js` rewritten to the event model and green.
  *(User find bar unchanged — already migrated. Live `findInPage` match-count re-verify deferred with the
  Leg-4 corpus.)*
- [x] Active-view concept consolidated (consistent `isWebTab()`/`!isInternalTab()` predicate; single
  `wcId` tracker; outgoing-web-tab hide-on-switch-to-internal preserved); substrate-guard audit clean;
  `npm test` / `typecheck` / `lint` green. *(`a11y` is a live gate — deferred with the Leg-4 corpus.)*
- [x] `CLAUDE.md` tab-architecture section updated (WebContentsView, freeze-frame pattern,
  `capture-active-guest` chrome-only contract, `INTERNAL_PARTITION` import-never-derive rule);
  `farbling-correctness.md` citation corrected; `capture-active-guest` comment confirmed correct.
- [ ] Full convenience corpus + `tab-surface-geometry` + `internal-tab-menus` as Witnessed runs —
  **DEFERRED (apparatus)**; SC4 accepted via the HAT. Carried forward to an admin@flight-4 session.
- [x] HAT passed (all steps); the two carried WSLg known issues re-checked (operator: acceptable). A
  Flight-3 find-focus regression was surfaced + fixed inline during the HAT.

### Adaptation Criteria

**Divert if**:
- The active-view consolidation destabilizes freeze/geometry beyond inline-fixable → scope down to the
  minimal predicate sweep + `visibleWebTabWcId` collapse (no structural rewrite), record in the flight
  log. *(Low likelihood — the F3 regressions are already fixed; this is hardening.)*
- A new behavior spec proves un-observable as authored (e.g. the WSLg-fallback `captureWindow` issue
  below forces reliance on a tell that turns out insufficient) → fix the spec's apparatus before running
  the corpus, record the apparatus change.

*(The DD1 `found-in-page`-delivery risk is retired: delivery is proven in production since Flight 3 —
not a divert condition.)*

**Acceptable variations**:
- A convenience spec failing only on a re-confirmed WSLg-class artifact (e.g. the cold-start find quirk)
  lands as an operator-accepted known issue, not a blocker.
- Minor reordering of the docs leg relative to the code legs (docs don't change runtime behavior).

### Legs

> **Note:** Tentative; planned one at a time as the flight progresses.

- [x] `find-rehome` — delete the D1 renderer-injection in `find.js` (the `querySelectorAll('webview')`
  body at `:120,:170`); serve the MCP `findInPage`/`stopFindInPage` ops from the main-process
  `found-in-page` event correlated by `requestId`, keyed on the resolved guest `wcId`; preserve jar-scope
  + internal guards; **rewrite the injection-coupled `test/unit/automation-find.test.js`** to the
  event-listener model; re-verify the WSLg cold-start quirk (re-port the retry to the main listener if it
  reproduces); update `find-in-page.md` to the new surface. *(The user find bar needs no change — already
  on the migrated path.)* — landed + reviewed (live find re-verify in Leg 4).
- [x] `active-view-consolidation` — replace `visibleWebTabWcId` + raw `!t.trusted` bookkeeping with a
  single active-view concept + consistent `isWebTab()`/`!isInternalTab()` predicate; run the
  substrate-guard audit (grep + confirm every old-substrate-keyed guard), verifying the outgoing-web-tab
  hide-on-switch-to-internal transition explicitly. *(Depth per Phase-6 operator re-confirmation.)* —
  landed + reviewed (live freeze/geometry re-verify in Leg 4/5).
- [x] `docs-and-spec-cleanup` — update `CLAUDE.md` tab-architecture (all stale `<webview>` lines —
  `:21,23,27,28,33,56,65,66,72,75,78,104`; add freeze-frame pattern, `capture-active-guest` chrome-only
  contract, `INTERNAL_PARTITION` import-never-derive rule); fix the `farbling-correctness.md` drifted
  citation (`:51` → `renderer.js:2327`/`tabNavigate`); verify/clarify the `capture-active-guest` comment
  invariant (`main.js:1513-1534` may already be substantially correct — confirm, don't double-write).
- [ ] `verify-convenience-corpus` — **DEFERRED (apparatus).** The formal Witnessed corpus + `npm run
  a11y` gate could not run (session MCP jar-authed against a foreign instance; admin-only observables
  refused). SC4 accepted via the HAT for this landing; corpus + a11y carried forward to a session wired
  admin@flight-4. See flight log.
- [x] `hat-and-alignment` *(optional — operator opted in)* — guided HAT: find bar, menu freeze/restore
  on web + internal tabs, panel-resizes-guest, geometry on resize/maximize; fix inline; re-check the two
  carried WSLg known issues. **All steps pass** — surfaced + fixed a Flight-3 find-focus regression
  inline; raised the overlay-find-bar idea (spun out to Flight 7).

---

## Post-Flight

### Completion Checklist
- [x] Legs 1-3 + 5 completed; Leg 4 (formal corpus + a11y) DEFERRED (apparatus) — carried forward
- [x] Code merged (flight branch → mission branch, local; `main` untouched per mission constraint)
- [x] Tests passing (`npm test` 947/947 / `typecheck` / `lint`; `a11y` is a live gate — deferred)
- [x] Documentation updated (`CLAUDE.md`, corrected citations; the two new specs authored at planning)

### Verification
SC4 is met when the full convenience behavior-test corpus + the two new rendered-state specs pass on the
view surface (or carry recorded operator-accepted known issues) and the HAT confirms the find bar and
menu/geometry behaviors on screen. SC6-partial is met when `findInPage` returns live match counts via
the MCP surface. Source-absence check: `grep -rn "querySelectorAll('webview')" src/` returns nothing.
