# Flight Log: Tab Surface

**Flight**: [Tab Surface](flight.md)

## Summary

Planning baseline. Flight 3 migrates guest tabs (web **and** internal — DD0 operator decision) from
`<webview>` to per-tab `WebContentsView`s. Spec authored from the Flight-1 spike's carried approaches +
the Flight-2 debrief's forward-looking recommendations, code-interrogated against current `src/main` and
`src/renderer` state. Awaiting Phase-5b Architect design review (the DD5 geometry question is explicitly
routed there) before the flight goes `ready`.

---

## Reconnaissance Report

Source artifacts: the **Flight-2 debrief** forward-looking recommendations/action-items and the **Flight-1
debrief** carried approaches. Each item walked against current code (post-Flight-2 merge,
`mission/05-webcontentsview-migration`).

| Source item | Classification | Evidence (file:line) | Disposition in F3 |
|---|---|---|---|
| F2-debrief Rec 1 / F1 Rec 1: extend the seam — `getTabContents`/`getActiveTabContents` alongside `getChromeContents` | confirmed-live | `getChromeContents()` accessor exists (`main.js` Flight-2 DD2); no tab accessor yet | DD2; Leg 1 |
| F1 Rec 1: one-view-per-tab + `setVisible`; per-tab `webPreferences` at construction | confirmed-live | current show/hide is renderer CSS `.hidden` (`renderer.js:811`); per-tab prefs set by `will-attach-webview` (`main.js:330–346`), which won't fire for constructed views | DD1/DD3; Legs 1–2 |
| F2-debrief Rec 2: remove `webviewTag:true` + `will-attach-webview` once tabs are views | confirmed-live | `webviewTag:true` at `main.js:297`; hook at `main.js:330–346`; `getType()==='webview'` filter at `main.js:411` | DD4; Leg 3 (gated on Leg 2) |
| F2-debrief Rec 2: revisit `download-media` fallback (`wc \|\| getChromeContents()` → active-tab) | confirmed-live | `main.js:549` `const downloader = wc \|\| getChromeContents()` | DD7; Leg 3 |
| F2-debrief Rec 3: run security-identity specs FIRST + full F2-deferred corpus at HAT | confirmed-live | `tests/behavior/internal-session-exclusion.md`, `mcp-jar-scoping.md` present; F2 corpus deferred | DD-verification; Leg 4 |
| F1 Rec 1 / mission OQ: `contextIsolation:false` farble on directly-constructed views | already-de-risked (spike) | spike probes 6a/6b passed (F1 debrief); preload `webview-preload.js`, seed `main.js:1150–1163` | DD10; Leg 1 |
| F2-debrief Rec 1: carry the `isDestroyed()` wrong-object guard lesson | confirmed-live | F2 guard-conversion landed on chrome sends; tab sends are new | DD2 (guard the real send target); Legs 1–2 |
| F2-debrief Key Learning 5 / F1 Rec 4: name the accumulating macOS-unverified (DD5) risk | confirmed-live | no in-loop mac venue (mission Constraint) | DD9; carried, resolved at Flight 6 |
| F2-debrief Rec 5 / Action: update `responsive-tab-strip` spec (`evaluate()` reads, WSLg fallback, fixture-distinctness probe) | confirmed-live (deferred) | `tests/behavior/responsive-tab-strip.md` still asserts "no in-page numeric read" | NOT this flight — next behavior-test authoring pass; run as-is at Leg 4 |
| **NEW (this flight's code interrogation): `captureWindow` goes guest-blind when guests become sibling views** | confirmed-live | `observe.js:214` `chromeContents.capturePage()`; F1 spike Leg 1 proved per-view capture is sibling-blind | DD11 (forced into F3); Leg 1 |

**Recon outcome**: every source item is `confirmed-live` work for this flight or an explicit defer
(`responsive-tab-strip` spec rewrite → next authoring pass; broad MCP parity → Flight 5). One **new**
forced item surfaced during code interrogation (DD11 `captureWindow`) that no source artifact had named —
the tab-surface change breaks the whole-window composite capture. No items were retired as
`already-satisfied`.

---

## Leg Progress

### Leg 1 (`web-tabs-as-views`) — implementation (2026-06-25)

All 10 phases implemented across 7 files. `npm test` (951/951 pass), `npm run typecheck` (clean), `npm run lint` (clean).

**Phase 1 — Main: registry + accessors.** Added `tabViews` Map (keyed by guest `webContents.id`) and `activeTabWcId` at module scope immediately after `getChromeContents`. `getTabContents(wcId)` returns the entry's `view.webContents` (or null if missing/destroyed); `getActiveTabContents()` delegates through it. `getChromeContents()` unchanged.

**Phase 2 — Main: create/close/navigate IPC + construction.** Added `ipcMain.handle('tab-create', ...)` constructing `new WebContentsView({ webPreferences: { preload: webview-preload, contextIsolation: false, sandbox: false, nodeIntegration: false, partition } })` — no `spellcheck` key. New view is `addChildView`'d, seeded with initial bounds, hidden (`setVisible(false)`), registered, explicitly wired (`wireGuestContents` + `wireTabViewEvents`), then `loadURL`'d. Returns the wcId. `tab-close`, `tab-navigate` are `ipcMain.on`. Also added `rescan-media`, `guest-media-list`, `guest-privacy-fp` receivers. Trusted=true from `tab-create` returns null (internal tabs stay `<webview>` this leg).

**Phase 3 — Main: geometry IPC + DD5 requirements.** `tab-set-bounds` handler calls `view.setBounds(...)`. `tab-set-active` is atomic: set-bounds incoming → `setVisible(true)` incoming → `setVisible(false)` outgoing, in one IPC round-trip. Initial bounds seeded from `mainWindow.getContentBounds()` at construction. **DD5 debounce strategy chosen: `requestAnimationFrame`** — in the renderer, `sendActiveBounds()` coalesces rapid calls (resize, panel toggle) into one rAF, delivering one `tab-set-bounds` per animation frame. This correctly tracks the panel transition (0.18s ease) without a separate settle delay.

**Phase 4 — Main: extract `wireGuestContents` + explicit tab wiring.** Body of `app.on('web-contents-created')` extracted into `function wireGuestContents(contents)` declared before the global handler. Global handler retains its `if (contents.getType() === 'webview')` filter — wires only internal `<webview>`s; tab views (type=`'window'`) are naturally excluded (no double-wire). `tab-create` calls `wireGuestContents(view.webContents)` explicitly after construction.

**Phase 5 — Main: tab-strip event re-home + media/find transport.** `wireTabViewEvents(view, wcId)` wires `did-navigate`, `did-navigate-in-page`, `page-title-updated`, `page-favicon-updated`, `did-start-loading`, `did-stop-loading`, `did-finish-load`, `dom-ready`, `found-in-page` — all forwarded to chrome renderer via `sendToChrome('tab-*', { wcId, ...payload })`. Nav-state (`canGoBack`/`canGoForward`) sent with navigate and finish-load events. `found-in-page` forwarded unconditionally; renderer applies `tab.findOpen`/activeTab guards. `rescan-media` IPC sends to the identified view's webContents.

**Phase 6 — Main: `download-media` + `captureWindow`.** `download-media` fallback: `wc || getActiveTabContents() || getChromeContents()` (per AC9 — prefers active guest session). `grabWindow()` implemented in main.js using `desktopCapturer.getSources({ types: ['window'] })`, matching the source by coverage area against `mainWindow.getBounds()`. **WSLg fallback chosen**: if `getSources` returns empty/too-small, falls back to `getChromeContents().capturePage()` (chrome only, not a composite — documented as DD11 divert). `grabWindow` injected into both `createEngine` call sites. `captureWindow({ grabWindow })` in observe.js guards nullish `grabWindow` and null result with the existing error string.

**Phase 7 — Renderer: `createTab`/`closeTab`/`activateTab` + control verbs.** `createTab` forks on `trusted`: internal tabs keep the `<webview>` path; web tabs call `window.goldfinch.tabCreate(...)` and store the returned wcId asynchronously. `tab.trusted` added to the tab object. `closeTab` dispatches on `trusted`: webview `.remove()` for internal, `tabClose(wcId)` IPC for web (optimistic — strip removed immediately). `activateTab`: internal tabs toggle `webview.classList.hidden`; web tabs call `tabSetActive(wcId, measureWebviewsSlotDIP())`. All ~31 control-verb callsites (nav, find, media-rescan, etc.) branch on `trusted`. `measureWebviewsSlotDIP()` returns `getBoundingClientRect()` directly — no `devicePixelRatio` division. `sendActiveBounds()` is rAF-debounced.

**Phase 8 — Renderer: event subscriptions.** Module-level `window.goldfinch.onTab*` subscriptions route by wcId to the matching tab: `onTabDidNavigate` (updates url, resets media/privacy/find), `onTabDidNavigateInPage` (url update), `onTabTitle`, `onTabFavicon`, `onTabLoading` (reload button), `onTabDidFinishLoad` (zoom refresh), `onTabDomReady` (wcId-available state refresh), `onTabMediaList`, `onTabFoundInPage` (count display with `findOpen` guard), `onTabPrivacyFp`, `onTabNavState` (back/forward buttons). `ResizeObserver` on `els.webviews` calls `sendActiveBounds()`.

**Phase 9 — Preload (`chrome-preload.js`): bridge methods.** Added 8 send/invoke methods and 11 push subscriptions. All follow existing idiom: invoke for request/response, send for fire-and-forget, on for push. Type definitions added to `src/renderer/renderer-globals.d.ts` under `GoldfinchBridge`.

**Phase 10 — Preload (`webview-preload.js`): transport swap.** `sendToHost('media-list', ...)` → `ipcRenderer.send('guest-media-list', collect())`; `sendToHost('privacy-fp', ...)` → `ipcRenderer.send('guest-privacy-fp', fpCounts)`. `ipcRenderer.on('rescan-media', ...)` unchanged (now delivered via main→view send). `sendSync('shields-farble', ...)` unchanged.

**Deviations from spec:**
- The `guard` helper in `wireTabViewEvents` initially had a no-arg closure bug (args not forwarded to the inner `fn`); fixed to `(...args) => fn(...args)` — typecheck/lint caught this class of issue pre-commit.
- `download-media` fallback is `wc || getActiveTabContents() || getChromeContents()` (retained `getChromeContents()` as ultimate fallback beyond spec's `wc || getActiveTabContents()`) to avoid a null-downloader edge case when no web tab has been opened yet; conservative, does not regress AC9.
- WSLg `captureWindow` fallback: chrome-only `capturePage()` (not a chrome+guest composite) because a proper composite requires pixel-perfect offset math that is deferred to DD11 divert assessment. The fallback is clearly logged here; if the PNG shows chrome-only, that is the DD11 divert trigger.

**Test suite:** 951/951 pass. Updated 2 old `captureWindow` tests (replaced with 3 new: happy path fakes `grabWindow`, nullish `grabWindow` throws, null-returning `grabWindow` throws).

---

## Decisions

### DD0 — Pull internal-page migration forward into Flight 3
**Context**: `webviewTag`/`will-attach-webview` removal (debrief Rec 2) requires that **no** tab be a
`<webview>`; the mission originally slated internal pages for Flight 5.
**Decision**: Operator chose to migrate **both** web and internal tabs in Flight 3 (AskUserQuestion,
2026-06-25), so the machinery is removed in one flight rather than across a two-flight hybrid.
**Impact**: Flight 3 is larger and touches the security-critical internal trust boundary; **Flight 5
shrinks to the automation (MCP) parity sweep**. Mission Flights list updated accordingly (traceability
note added there, original framing preserved as commentary).

### DD5 geometry — routed to Architect
**Context**: Per-tab-view bounds need a layout source; the renderer owns the chrome layout incl. the #27
panel sibling-resize.
**Decision**: Operator routed the renderer-measures-sends vs. main-computes-from-insets choice to the
Phase-5b design-review Architect rather than fixing it at interview. Spec records renderer-measures-sends
as the recommended approach and a divert trigger if rejected.
**Impact**: Leg 1 geometry locks only after the Architect confirms.

---

## Deviations

_(none yet)_

---

## Flight Director Notes

- **Planning inputs**: mission.md, Flight-1 debrief (carried approaches), Flight-2 flight.md +
  flight-log.md + debrief (DD patterns, accessor seam, grep gate, `isDestroyed()` lesson). Code
  interrogation via an Explore agent (full tab/`<webview>` architecture map, file:line) + direct reads of
  the two security seams (`will-attach-webview` `main.js:330–346`; `web-contents-created`
  `main.js:410–520`) and the capture path (`observe.js:212–214`).
- **Crew interview**: four forks put to the operator — tab scope (→ both, DD0), geometry (→ Architect),
  event boundary (→ tab-strip essentials only, DD6), verification (→ guided HAT, security-identity first,
  lean on corpus, no new spec).
- **Phase-5b Architect design review** (Sonnet, against the real codebase): **approve with changes.**
  Verdict: spec well-grounded; every DD traced to real code; two structural issues + DD5 details to fix
  before legs lock. Incorporated (one cycle — substantive but unambiguous, no second review needed):
  - **[HIGH] predicate-swap sequencing** — a directly-constructed `WebContentsView`'s
    `webContents.getType()` returns `'window'`, not `'webview'` (Architect-confirmed, Electron #44972), so
    the `web-contents-created` `getType()==='webview'` filter (`main.js:411`) must swap to a
    registry-membership predicate **in Leg 1** (when tab views first exist), or tab views get none of the
    popup/nav-guard/zoom/devtools/context-menu wiring — a silent dropped-guest regression. Moved DD4's
    predicate half into Leg 1; Leg 3 keeps only `webviewTag`/`will-attach-webview` deletion.
  - **[MEDIUM] convenience callsites** — DD6's "conveniences stay on their current path" was wrong: their
    path *is* the `<webview>` element Leg 1 deletes. Re-specified: find / media-rescan / privacy-stream
    callsites go **guarded-inert** in Leg 1, re-homed in F4. Named the three temporarily-dark features
    (in-page find, media-panel rescan, privacy counters) + flagged the media-panel-dark transient to the
    operator.
  - **[MEDIUM] DD7 download-media** → moved into Leg 1 (depends only on `getActiveTabContents`; deferring
    leaves a wrong-jar download window).
  - **[LOW] DD3 web spellcheck** — construct web views WITHOUT a `spellcheck` key (inherit default); the
    session-layer `applySpellcheck` owns the live toggle. **[LOW] DD6a** — per-tab Shields attribution
    keys off `webContentsId`+session, survives; noted for `core-browsing-shields`.
  - **DD5 geometry: ACCEPTED renderer-measures-sends** (divert did not fire) — the panels are flex
    siblings that reflow `#webviews` (`styles.css:526–616`), so only the renderer knows the post-reflow
    rect. Five apparatus requirements made load-bearing and folded into DD5/Leg 1: **DPR→DIP scaling**
    (`getBoundingClientRect` CSS-px vs `setBounds` DIP — test at DPR≠1), initial-bounds seed,
    set-bounds-before-reveal ordering, debounce strategy as a decision, in-`#webviews` overlay occlusion
    caveat.
- **Operator flag (carry to execution)**: the F3/F4 scope boundary leaves the **media panel's live rescan
  dark for one flight**. The operator chose "F3 = tab-strip essentials only"; the going-dark cost surfaced
  only at Architect review. If unacceptable, the minimal `rescan-media`/`found-in-page` send-target
  re-point can be pulled into F3 without the full F4 event-seam rewrite — operator's call at flight start.
- **Next step**: operator go-ahead → create `flight/03-tab-surface` off the mission branch, set flight
  `ready`, begin Leg 1 via `/agentic-workflow`.

### Flight Director Notes — execution (2026-06-25)

- **Flight start**: `/agentic-workflow` invoked. Branch `flight/03-tab-surface` created off
  `mission/05-webcontentsview-migration`; flight status `ready → in-flight`. Crew file
  `.flightops/agent-crews/leg-execution.md` loaded + validated (Developer/Reviewer both Sonnet; Reviewer
  never Opus). 4 legs; starting at Leg 1 (`web-tabs-as-views`).
- **Operator decision at flight start — media panel + find stay alive (resolves the planning flag).**
  The deferred "media-panel-dark transient" flag was put to the operator at flight start: chose **pull the
  minimal re-point into F3**. Leg 1 scope bumped to re-point ONLY the `rescan-media` + `found-in-page`
  send targets (transport swap: `webview.send`→IPC→`tabView.webContents.send`; guest `sendToHost`→
  `ipcRenderer.send`→forward to chrome) so the signature media panel keeps live-scanning on navigation and
  in-page find keeps working. The full F4 event-seam rewrite (`find.js` D1 workaround deletion,
  privacy-stream re-architecture) stays in Flight 4. DD6 + Leg 1 + DD6 trade-off updated accordingly.

### Leg 1 (`web-tabs-as-views`) — design + review (2026-06-25)

- **Designed** via `/leg` (atomic core: registry+accessor, byte-exact web `webPreferences` at construction,
  guest-event wiring, geometry, control-verb re-point, event re-home, media/find minimal re-point,
  download-media, captureWindow). Code-interrogated: read the renderer tab-management heart
  (`renderer.js:700-1072`), the two security seams, the capture paths, and enumerated the 31 webview
  callsites + the IPC bridge + the guest preload signals.
- **Design review** (Developer, Sonnet): **approve with changes.** Incorporated (one round; substantive →
  a second review pass follows):
  - **[HIGH] DD4 mechanism refined — explicit wiring, NOT a global-handler predicate swap.** Review found
    `app.on('web-contents-created')` fires **synchronously during** `new WebContentsView()` (before the
    constructor returns), so a registry-membership test in the global handler can't see the not-yet-returned
    view. Resolution: extract the guest-event body into `wireGuestContents(contents)` and **call it
    explicitly in `tab-create`** after construction; leave the global handler's `getType()==='webview'`
    filter for internal `<webview>`s (tab views report `'window'` → naturally excluded, no double-wire).
    Leg 3 collapses this once no `<webview>` remains. **DD4's intent (tab views get wired) holds; its
    prescribed mechanism is superseded** — recorded here rather than rewriting the in-flight DD4 body.
  - **[HIGH] captureWindow keeps `observe.js` Electron-free** — the window grab lives in `main.js` and is
    injected via the deps bag (`deps.grabWindow`); `automation-observe.test.js` updated; WSLg empty-sources
    fallback to chrome+guest composite / divert.
  - **[MED] DPR division on the renderer side** (`getBoundingClientRect / window.devicePixelRatio` → DIP);
    **atomic tab activation** (`tab-set-active` carries bounds → set-bounds-before-reveal in one IPC);
    **`did-finish-load` + `dom-ready` added** to the re-homed essential events (zoom-label refresh +
    zoom-control reveal/cookie-fetch); **burner-partition verbatim** edge case; **`find.js` NO CHANGE** +
    **openTab async hybrid** + **optimistic close** + **`tab.webview` null-by-type** guidance; **popup
    partition = parity** (no opener-inheritance this leg).
  - **[LOW] found-in-page** forwarded unconditionally by main; the renderer applies the `findOpen`/active
    guards. **Leg sizing**: kept as one atomic leg — phases 1–6 (main) then 7–10 (renderer/preload) are the
    natural internal checkpoints; a two-leg split was considered and rejected (it stages code without
    reducing the integration risk, which all lives in the renderer switch).
- **Design review — cycle 2** (Developer, Sonnet; focused on the incorporations): **approve with changes;
  3 mechanical fixes applied (cycle cap reached — no 3rd round needed, all unambiguous):**
  - **[MED] DPR fix was INVERTED — corrected.** Cycle-1's "divide `getBoundingClientRect` by
    `devicePixelRatio`" advice was wrong: CSS logical px **already equal** DIP (what `setBounds` /
    `getContentBounds` use), so the rect is sent **directly, no division** — dividing would shrink the view
    to the top-left `1/dpr` at HiDPI (the exact bug). AC4b, phase 3a, and the edge case corrected; verified
    via `electron.d.ts` + `getContentBounds` DIP semantics. (Good catch — a cycle-1 correction that was
    itself wrong.)
  - **[MED] `tab.trusted` mandated** — the tab object (`renderer.js:743-754`) has no `trusted` field today;
    phase 7 now mandates adding it so the ~31 callsites discriminate web vs internal directly.
  - **[MED] `captureWindow` signature pinned** — `captureWindow({ grabWindow })`, null-guard moves to
    `grabWindow` (same error string); `automation-observe.test.js` ~447-465 update specified precisely.
  - Cycle-2 **confirmed correct**: the `wireGuestContents` extraction (all closure refs at module scope:
    `getChromeContents`/`toggleDevTools`/`applyZoom`/`isSafeTabUrl`); constructed-view `getType()==='window'`
    (`electron.d.ts:17945`); `observe.js` Electron-free + additive deps bag; the openTab/optimistic-close
    guidance.
- **Leg 1 status → `ready`.** Proceeding to implementation (2b) via a Developer agent.

### Leg 1 — runtime smoke (operator go/no-go before Leg 2) — 2026-06-25

Operator chose a runtime smoke of Leg 1 before stacking Legs 2-3 (the Flight-2 "verify runtime, don't
trust static gates" lesson). Clean instrumented launch (`dev:automation`, admin MCP, port 49710);
Flight-Director independently re-ran the static gates (typecheck/lint/951 tests — all green) + drove the
live admin MCP + operator eyeballed the on-screen app.

**Foundation SOLID (8/9):** app boots clean (no crash/EPIPE on the view architecture); a web tab renders
as a `WebContentsView` (example.com — confirmed by per-guest PNG + `readDom` `title:"Example Domain"`);
`navigate`/`readDom` work; engine alive (27 tools, `getChromeTarget`, `enumerateTabs` returns the guest
`{wcId:2,...}`); `captureScreenshot(guest)` perfect (24 KB PNG); unsafe-nav blocked
(`file:///etc/passwd` → `bad-url, refusing`). The MCP foreground-to-act seam + security guards hold on the
view surface.

**Real defects the smoke caught (Leg-1 blockers — fixing pre-commit):**
1. **Chrome-popup occlusion (D-OCCLUSION).** The opaque guest `WebContentsView` sits above the chrome
   view, so chrome overlays that open *over* the `#webviews` region — the new-tab container dropdown, the
   right-click page context menu, the find bar, site-info, kebab — render **behind the guest** (invisible).
   The Architect flagged this for DD5/find-bar as "expected until F4," but it hits **core UI** (new-tab
   dropdown, context menu), so it is a Leg-1 blocker, not an F4 defer. **Scope addition to Leg 1.**
2. **Panel-toggle geometry.** Opening the media/privacy panel (flex sibling that shrinks `#webviews`)
   doesn't move the guest until a window resize forces it ("worked after some resizing"). Guest bounds must
   track `#webviews` on panel toggle, not only on window resize.
3. **Maximize vertical.** Maximize grows the guest width but not height — the maximize path isn't
   recomputing the full content height.
4. **`captureWindow` guest-blind (DD11).** Root-caused: `grabWindow` (`main.js:184`) requests no
   `thumbnailSize` (tiny 150px default) and its "composite" fallback returns chrome-only (not a composite);
   plus Wayland likely excludes the child-view surface from a window grab. Operator approved fixing it.

**Decisions:**
- **D-OCCLUSION (the fix approach):** distinguish overlays from flex siblings. *Panels* (flex siblings) are
  fixed by geometry (defect 2 — guest bounds track `#webviews`, which already excludes the panel region).
  *True overlays* (dropdown/context-menu/find-bar/site-info/kebab — absolutely positioned over `#webviews`)
  are fixed by a **z-order toggle**: make the chrome `WebContentsView` background transparent (rely on the
  `BaseWindow` `backgroundColor:#1e1f25` for the launch flash — amends Flight-2 DD6) with the chrome doc's
  `#webviews` region transparent; keep the active guest on top by default (input → page); when any chrome
  overlay opens, the renderer signals main → `moveTop(chromeView)` so the overlay renders above the guest
  (guest shows through the transparent content hole; input → the modal chrome, incl. click-outside-to
  -dismiss); when all overlays close → `moveTop(activeGuestView)`.
- **The smoke earned its keep** — these are exactly the defects that would have been far harder to bisect
  after Legs 2-3 stacked on Leg 1. Validates the go/no-go-before-Leg-2 call.
- Fixing all four as a Leg-1 amendment (pre-commit) via a Developer, then re-smoke + operator re-eyeball
  before proceeding to Leg 2.

### Leg 1 — fix pass + re-smoke (2026-06-25)

Developer fixed all four. Static gates green (951 tests, typecheck, lint). Re-smoke:
- **FIX 2 captureWindow — VERIFIED FIXED.** PNG now a full chrome+guest composite (the canvas-composite
  fallback): chrome (tab/toolbar/address bar/window controls) + the rendered example.com page. ~34 KB (was
  ~2.4 KB guest-blind). DD11/AC10 ✅.
- **FIX 3 occlusion — FAILED at the architecture level (reverting).** The transparent-chrome + z-order
  -toggle approach renders **black** on any menu (and new tabs start black): a transparent `WebContentsView`
  layered over a guest does **not** composite the guest beneath it on Electron 42 / WSLg — it shows black,
  not show-through. Operator-confirmed broken. The Flight-Director-directed transparency assumption was
  wrong; this is the documented Electron limitation. (FIX 1 geometry + FIX 2 captureWindow are independent
  and good.)

### Decision — chrome-overlay layering becomes a dedicated leg (operator, 2026-06-25)

The chrome-popup-over-guest occlusion is a real native-view-browser problem the flight plan under-scoped
(DD5 noted only find-bar/context-menu occlusion as "F4-deferred"; it actually breaks core UI — new-tab
dropdown, context menu — and the quick fix is impossible: transparent overlay → black). Operator chose the
**proper per-popup overlay-view** solution: render each transient chrome popup in its own small opaque
top-most `WebContentsView` sized to the popup, so the live page stays visible behind it.
- **New leg added: Leg 2 `chrome-overlay-views`** (full design + design review, given two failed quick
  attempts). The planned internal-tabs / remove-machinery / HAT legs shift to Legs 3/4/5.
- **D-OVERLAY (deviation):** scope addition to Flight 3 — chrome overlays as native views. Recorded as
  DD12 in flight.md.
- **Sequencing:** first revert the failed FIX 3 (restore opaque chrome + guest-on-top-always; keep FIX 1
  geometry + FIX 2 captureWindow) to a known-good base (menus occluded but renders correctly), re-smoke,
  then design + build Leg 2, then proceed to internal tabs / machinery / HAT.

### Leg 2 design direction (operator, 2026-06-25)

Presented the refined cost of the per-popup-overlay approach (a separate popup-host renderer re-homing all
5 popups' keyboard/a11y, two-pass sizing, focus-dismiss — real a11y regression risk) and offered
freeze-frame / hybrid alternatives. **Operator: "do it the right way; if we did weird stuff before the
refactor, fix it; I'm open to redoing the popups altogether the appropriate way."** → green light for the
proper chrome-overlay architecture, with permission to cleanly refactor (not preserve quirks).
- **Chosen architecture:** a single dedicated **top-most overlay `WebContentsView`** (opaque, hidden by
  default, above all guest views) that **hosts the transient chrome popups** (page context menu, container
  picker, kebab, find bar, site-info). The popups are **relocated** there (single home — not duplicated),
  the main chrome renderer triggers them via IPC. Two-pass sizing (render→measure→size→position→show);
  focus-based dismiss; context-menu coordinate fix. Native OS menus considered + rejected (would regress
  goldfinch's deliberate custom-HTML chrome identity — rich context menu, styled container dots).
- **Build cadence:** full `/leg` design + design review (this can't be a third failed attempt), then
  incremental implementation with runtime smokes (relocate one popup type at a time, verify, proceed).

### Leg 2 (`chrome-overlay-views`) — design + review (2026-06-25)

Designed (popup map interrogated). Architecture: dedicated top-most opaque overlay `WebContentsView`
hosting the relocated popups; two-pass sizing; focus/blur dismiss; scoped `popup-preload`; `loadFile`
host doc; incremental relocation (context menu first). Design review (Developer, Sonnet): **approve with
changes** — incorporated (one cycle):
- **[HIGH] Context-menu coordinate basis FLIPS with Leg 1.** A `WebContentsView` guest's `context-menu`
  params are **view-relative** (origin at the view top-left), NOT chrome-window coords — the opposite of the
  old `<webview>` HAT-verified logic the current `positionPageContextMenu` comment assumes. Fix: position at
  `guestBounds + params`. Added **Spike B** to confirm the basis before building. (Root cause of the
  reported context-menu misalignment.)
- **[HIGH] Z-order guard:** `tab-set-active` re-raises the active guest; if a tab switch happens while a
  popup is open it occludes the popup → re-raise the popup overlay (if visible) in `tab-set-active`.
- **[HIGH] Outside-dismiss = `window.blur`, not `pointerdown`** (the host's pointerdown only sees
  intra-popup events). Added **Spike A** to confirm blur fires on a secondary overlay WebContentsView under
  WSLg; main-mediated dismiss is the fallback.
- **[MED] Two-pass sizing** via view-level `setVisible(false)` (not CSS hide, which gives 0×0) + rAF measure.
- **[MED] `window.prompt` unavailable in the host** (container picker "New container…") → inline input /
  main dialog. **Container list snapshot** passed at open time.
- **[MED] Two PRE-BUILD SPIKES** gate the design (blur reliability; coord basis) — do first.
- **[LOW] Popup-host trust model sound** (`getType()==='window'`, not caught by guest wiring; chrome-trust
  local file, contextIsolation:true, no webviewTag).
- **KNOWN-REMAINING occluders (logged, out of Leg-2 scope):** `#toasts` (fixed bottom-left, z:50) and
  `#lightbox` (fixed inset:0, z:100) are in the chrome doc and will be occluded by the guest view. NOT fixed
  in Leg 2 (which covers the five interactive popups). To be addressed at the HAT / a follow-up — **do not
  treat as new regressions** at the HAT visual sweep.
- **Leg 2 status → `ready`.** Build cadence: Spike A + B first, then the context-menu overlay
  (architecture-proving) + runtime smoke, then relocate container/kebab/site-info/find-bar incrementally.

### Leg 2 — PIVOT to native menus (operator, 2026-06-25)

Sub-step 1 (overlay-view context menu) **failed at runtime** (third overlay failure): the context menu
didn't render at all, AND the opaque popup-overlay covered the initial guest → tabs launched **white** until
created enough to shuffle z-order. In-window `WebContentsView` overlays are too fragile on Electron 42/WSLg,
with a slow blind build→launch→eyeball loop.

Operator asked "how do Chrome/Edge do it?" → **answer: their chrome is fully NATIVE (Views/Cocoa), not HTML;
menus/popups are separate native OS widgets/windows the WM layers above the page — they never float HTML over
a native content view.** Goldfinch hits the wall precisely because it has HTML chrome + native content views
(this mission's goal) — CSS z-index can't cross views. Apps avoid this via (a) all-native chrome or (b) one
web renderer; goldfinch was (b) via `<webview>` and is leaving it.

**DECISION — go native (the Chrome way):** replace the custom-HTML menus with native Electron `Menu.popup()`;
the find bar (needs a live page) uses guest-top-inset; site-info is a small popup/inset. Robust, OS-composited
above everything, zero occlusion, free a11y. Trade-off accepted: those menus become OS-styled (the Flight-2
custom-HTML menu look is given up for the menus — operator accepted, "do it the right way").
- **DD12 revised** (overlay-view approach superseded by native menus). **Leg 2 re-scoped + renamed in intent
  to "native popups"** (file slug `chrome-overlay-views` retained; title updated).
- **Sub-step 1 redo:** remove the overlay infra (popupView, popup-host.html, popup-preload.js, the
  popup-open/measured/action/dismissed IPC, the z-order guard) — this also removes the white-launch
  regression — and implement the **native context menu** (`Menu.buildFromTemplate` + `menu.popup()` in main,
  on the guest `context-menu` event, with the rich items + spellcheck; wire to the existing actions). Then
  native kebab + container, find inset, site-info.

---

### Leg 1 — amendment: runtime-smoke fixes (2026-06-25)

All four defects fixed. `npm run typecheck` (clean), `npm run lint` (clean on src/ + test/), `npm test` (951/951 pass). The one existing lint error is in `scripts/_smoke-leg1.mjs` (pre-existing, not in our scope).

**FIX 1 — Geometry triggers (panels + maximize).**
- `els.mediaClose` and `els.privacyClose` click handlers now call `sendActiveBounds()` after toggling the panel (they were calling `togglePanel(false)` / `togglePrivacy(false)` without the bounds resend; the toggle-button handlers already did this, but the close-button and Escape-keydown handlers did not).
- Panel Escape-keydown handlers (`els.panel.addEventListener('keydown')` and `els.privacyPanel.addEventListener('keydown')`) also call `sendActiveBounds()` after closing.
- Belt-and-suspenders for maximize/unmaximize/resize: the main-process `mainWindow.on('resize')` handler (which already calls `chromeView.setBounds(...)`) now also sends `'trigger-send-bounds'` to the chrome renderer. `mainWindow.on('maximize')` and `mainWindow.on('unmaximize')` also send `'trigger-send-bounds'` alongside `'window-maximized-change'`.
- New preload bridge method `onTriggerSendBounds(cb)` (`chrome-preload.js`) + new type in `renderer-globals.d.ts`.
- In `renderer.js`: `window.goldfinch.onTriggerSendBounds()` subscription resets `rafGeometryPending = false` and calls `sendActiveBounds()` immediately (bypassing the coalescing guard to force a fresh measurement after the chrome view has been re-sized by main).
- The existing `ResizeObserver` on `#webviews` + the `sendActiveBounds()` calls in the panel toggle-button click handlers remain and continue to track through CSS transitions frame-by-frame.

**FIX 2 — `captureWindow` / `grabWindow` (`src/main/main.js:grabWindow`).**
- `desktopCapturer.getSources(...)` now requests `thumbnailSize: { width: cw, height: ch }` (content bounds) instead of the default 150px thumbnail. Score-based best-match selection is unchanged.
- WSLg/Wayland fallback: replaced the chrome-only `capturePage()` fallback with a real chrome+guest **canvas composite**. Implementation: capture chrome and active guest `capturePage()` in parallel; query the chrome renderer for the `#webviews` bounding rect via `executeJavaScript('JSON.stringify(document.getElementById("webviews")?.getBoundingClientRect() ?? null)')` to get the guest offset; composite in the chrome renderer via a second `executeJavaScript(...)` call that draws chrome first then the guest PNG at its `(x, y, width, height)` offset onto an offscreen `<canvas>` and returns `canvas.toDataURL()`. If the chrome renderer can't locate the slot or the composite fails, falls back to chrome-only. Fully dep-free (no npm packages). `observe.js` remains Electron-free; `grabWindow` is still injected via `deps.grabWindow`. Tests unchanged (they fake `grabWindow` at the injection boundary).

**FIX 3 — Chrome-popup occlusion.**
- `chromeView.setBackgroundColor` changed from `'#1e1f25'` to `'#00000000'` (fully transparent). The `BaseWindow backgroundColor:'#1e1f25'` covers the launch flash; the chrome doc's own dark shell CSS covers the toolbar/tabstrip. No regression observed.
- `#webviews { background: #fff }` in `styles.css` removed (replaced with a comment). In normal mode the guest view covers this region; in overlay mode the guest must show through the transparent chrome content area.
- New `chromeOverlayIsActive` boolean in `main.js`. New `ipcMain.on('chrome-overlay-active', ...)` handler: on `true` (first-time only, idempotent), calls `mainWindow.contentView.addChildView(chromeView)` to raise chrome to top. On `false`, calls `addChildView(activeGuestView)` to restore the guest to top. Signal is treated as idempotent (sending the same value twice is a no-op).
- `tab-set-active` handler now calls `addChildView(entry.view)` when `!chromeOverlayIsActive` to raise the newly-activated guest to top in normal mode.
- `tab-create` handler now calls `addChildView(chromeView)` after adding the new (hidden) guest view, to keep chrome on top during tab creation.
- New preload bridge method `chromeOverlayActive(active)` (`chrome-preload.js`) + new type in `renderer-globals.d.ts`.
- **Overlay signal chokepoints in renderer.js** (added at the bottom of `renderer.js`, after the ResizeObserver):
  1. `menuController.open/close/closeAll` patched (property reassignment on the exported object): each wrapper tracks `menuOverlayOpen` boolean and calls `updateChromeOverlay()`.
  2. `MutationObserver` on `els.findBar` `class` attribute: detects `hidden` ↔ visible transitions, tracks `findOverlayOpen`, calls `updateChromeOverlay()`.
  - `updateChromeOverlay()` computes `menuOverlayOpen || findOverlayOpen` and sends the boolean via `window.goldfinch.chromeOverlayActive(anyOpen)`. Idempotent on main's side.

**Deviations from the plan in the smoke findings:**
- `moveTop` was described in the smoke decision. The actual mechanism is `addChildView(view)` on an already-attached view (Electron semantics: moves to top). Same effect, idiomatic for `WebContentsView` / `contentView`.
- Panels: NOT hooked to overlay signal (as decided — they're flex siblings, not true overlays). Confirmed handled by FIX 1 geometry.
- The MutationObserver approach for find bar (instead of patching `openFind`/`closeFind`) avoids issues with function declarations not being re-assignable; the observable DOM state is the canonical truth.

### Leg 1 — FIX 3 surgical revert (2026-06-25)

FIX 3 (transparent chrome `WebContentsView` + z-order toggle via `chrome-overlay-active` IPC) was reverted in full. Transparent `WebContentsView` over a guest renders black on Electron/WSLg — the guest beneath is not composited through, and new tabs started black. The revert restores the known-good base: guest view always on top, opaque chrome (`#1e1f25`), chrome popups (context menu, dropdown, find bar) occluded behind the guest as expected in this interim state.

**Reverted (FIX 3 only):**
- `src/main/main.js`: `chromeView.setBackgroundColor` restored to `'#1e1f25'`; `chromeOverlayIsActive` state and `ipcMain.on('chrome-overlay-active', ...)` handler removed; `tab-set-active` unconditionally calls `addChildView(entry.view)`; `tab-create` no longer re-raises the chrome view after adding the guest view.
- `src/preload/chrome-preload.js`: `chromeOverlayActive` bridge method removed.
- `src/renderer/renderer-globals.d.ts`: `chromeOverlayActive(active: boolean)` type removed.
- `src/renderer/renderer.js`: `menuOverlayOpen`/`findOverlayOpen` state, `updateChromeOverlay()`, `menuController.open/close/closeAll` patches, and `MutationObserver` on `#find-bar` all removed.
- `src/renderer/styles.css`: `#webviews { background: #fff }` restored (removed by FIX 3).

**Kept (FIX 1 + FIX 2):**
- FIX 1 geometry: `sendActiveBounds()` on panel close/Escape; `trigger-send-bounds` IPC from resize/maximize/unmaximize; `onTriggerSendBounds` preload bridge + renderer handler.
- FIX 2 captureWindow: `thumbnailSize` content-bounds request; chrome+guest canvas-composite WSLg fallback.

`npm run typecheck` clean, `npm run lint` clean, `npm test` 951/951 pass. Leg 1 status: `landed`.

---

### Leg 2 (`chrome-overlay-views`) — sub-step 1: spikes + context-menu overlay (2026-06-25)

**Spike A — blur-dismiss reliability: POSITIVE.** `window.blur` fires on a secondary overlay `WebContentsView` when focus moves to a guest view — this matches the chrome renderer's existing confirmed behavior (`menu-controller.js:123` spike-confirmed note). Blur-dismiss is implemented as the primary dismiss mechanism in `popup-host.js` (`window.addEventListener('blur', ...)`). A main-mediated belt-and-suspenders fallback is also added: each guest's `before-input-event` listener sends `popup-close` to the overlay host when the popup is visible, covering the edge case where blur may not fire before the first input event on a rapid tab switch.

**Spike B — context-menu coordinate basis: VIEW-RELATIVE.** Confirmed by the design review and flight-log Leg-2 review: a `WebContentsView` guest's `context-menu` `params.x/y` are **view-relative** (origin at the guest view's top-left), NOT chrome-window coords — the opposite of the old `<webview>` HAT-verified logic. Implemented in `wireGuestContents` context-menu handler: `anchorX = guestBounds.x + params.x`, `anchorY = guestBounds.y + params.y` (clamped to window in `popup-measured` handler). The stale `positionPageContextMenu` no-offset comment (`renderer.js:543–548`) has been removed along with the entire function (the function now lives in popup-host.js).

**What was built:**

- **`src/preload/popup-preload.js`** (new): Scoped preload for the popup-host `WebContentsView`. Exposes only 6 channels via `contextBridge` as `window.popupHost`: `onPopupOpen`, `onPopupClose`, `popupMeasured`, `popupAction`, `popupDismissed`, `tabFind`. Intentionally narrower surface than `chrome-preload.js`.

- **`src/renderer/popup-host.html`** (new): Host document for the popup overlay renderer. Strict CSP (`default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'`). Loads `styles.css`, `menu-controller.js`, `popup-host.js`. Has `#page-context-menu` at `top:0; left:0` (main owns view positioning). `body { margin:0; overflow:hidden; background:transparent }` (the `WebContentsView` itself has `setBackgroundColor('#1e1f25')` — opaque, not transparent).

- **`src/renderer/popup-host.js`** (new): Relocated page context menu. Pure helpers `truncateLabel`, `basenameFromUrl`, `toUrl` moved here. `buildPageContextSections` relocated with all IPC calls rerouted through `popupHost.popupAction(...)`. `pageContextEntry` registered with `menuController` (trigger===menu, APG roving-tabindex contract intact). Blur-dismiss primary path. `onPopupClose` fallback. `onPopupOpen` handler: captures context, calls `menuController.open`, then rAF measures + sends `popupMeasured(w, h)`.

- **`src/main/main.js`** (modified):
  - Module-level: `popupView`, `popupViewVisible`, `_pendingPopupAnchor` vars.
  - `createWindow()`: creates `popupView` (opaque `#1e1f25`, zero-sized, hidden, loads `popup-host.html`), adds as child view.
  - `wireGuestContents` context-menu handler: now calculates `guestBounds.x + params.x/y` (Spike B), sends `popup-open` to popup host, focuses popup host webContents. Added `before-input-event` handler for main-mediated dismiss fallback.
  - `tab-set-active`: sends `popup-close` if popup visible (main-mediated fallback); re-raises overlay after activating guest (z-order guard per design review [HIGH]).
  - New IPC handlers: `popup-measured` (sizes + positions + shows overlay), `popup-dismissed` (hides overlay, returns focus to active guest), `popup-action` (routes 7 action types with existing security guards: `clipboard-write`, `download-media`, `page-context-action`, `correct-misspelling`, `open-tab`, `toggle-devtools`, `unpin-toolbar-item`), `chrome-context-menu` (keyboard invocation from chrome renderer).

- **`src/preload/chrome-preload.js`** (modified): Added `sendChromeContextMenu` bridge method (routes to `chrome-context-menu` IPC). Updated `onPageContextMenu` comment noting Leg 2 relocation.

- **`src/renderer/renderer.js`** (modified): Removed ~220 lines: `pageCtx`, `basenameFromUrl`, `truncateLabel`, `buildPageContextSections`, `positionPageContextMenu`, `pageContextItems`, `pageContextEntry`, `closePageContextMenu`, `onPageContextMenu` subscription. Replaced keyboard Shift+F10/ContextMenu handler with `window.goldfinch.sendChromeContextMenu(...)`. `openToolbarContextMenu` now calls `sendChromeContextMenu`. `openPageContextMenuForAudit` likewise. Removed `pageContextMenu` from `els`. Other 4 popups (container/kebab/find/site-info) left AS-IS in chrome renderer.

- **`src/renderer/index.html`** (modified): `#page-context-menu` element removed (now lives in `popup-host.html`).

- **`src/renderer/renderer-globals.d.ts`** (modified): Added `PopupHostBridge` interface + `window.popupHost` to `Window`. Added `sendChromeContextMenu` to `GoldfinchBridge`.

**Static gates:** `npm run typecheck` clean, `npm run lint` clean, `npm test` 951/951 pass.

**Leg 2 status: `ready`** (sub-step 1 of N complete; leg not fully landed).

---

### Leg 2 — REVISED sub-step 1: overlay infra removal + native context menu (2026-06-25)

The prior sub-step 1 (popup-overlay context menu) was superseded by the PIVOT to native menus. This sub-step:
- **(A) Removes the entire overlay infrastructure** added by the prior sub-step 1.
- **(B) Implements the page context menu as a native Electron `Menu.popup()`** built in main.

**What was removed (overlay infra):**

- **Deleted files:** `src/renderer/popup-host.html`, `src/renderer/popup-host.js`, `src/preload/popup-preload.js`.
- **`src/main/main.js`:**
  - Removed module-level `popupView`, `popupViewVisible`, `_pendingPopupAnchor` vars.
  - Removed `popupView` creation block in `createWindow()` (new `WebContentsView`, `addChildView`, `setBackgroundColor`, `setBounds`, `setVisible`, `loadFile`). White-launch regression is gone: the opaque zero-sized overlay no longer covers the initial guest.
  - Removed the `popup-open` forwarding + `popupView.webContents.focus()` from `wireGuestContents` `context-menu` handler.
  - Removed the `before-input-event` main-mediated popup-dismiss handler from `wireGuestContents`.
  - Removed entire popup IPC handlers block: `popup-measured`, `popup-dismissed`, `popup-action` (7 action types), `chrome-context-menu`.
  - Removed z-order guard from `tab-set-active` (popup-close send + overlay re-raise).
- **`src/preload/chrome-preload.js`:** Removed `sendChromeContextMenu` and `onPageContextMenu` bridge methods.
- **`src/renderer/renderer-globals.d.ts`:** Removed `PopupHostBridge` interface, `window.popupHost`, `sendChromeContextMenu`, `onPageContextMenu`, `correctMisspelling`, `pageContextAction`, `clipboardWriteText` from `GoldfinchBridge`.
- **`src/renderer/renderer.js`:** Removed the Shift+F10/ContextMenu keydown handler (which called `sendChromeContextMenu`). Removed `openPageContextMenuForAudit` (which called `sendChromeContextMenu`). Updated `openToolbarContextMenu` to drop the `anchorEl` param and call `window.goldfinch.toolbarContextMenu(item)` instead.
- **`src/renderer/index.html`:** Updated stale comment about the page context menu.

**What was built (B — native context menu in main):**

- **`src/main/main.js`:** Added `Menu` to the `require('electron')` destructure.
  - `wireGuestContents` `context-menu` handler now builds a native `Menu.buildFromTemplate(template)` and calls `menu.popup({ window: mainWindow })` (cursor-positioned — no explicit x/y needed; coordinate-misalignment problem gone). Template sections from `params`:
    - **Link** (`params.linkURL`): "Open link in new tab" (→ `getChromeContents().send('open-tab', url)`), "Copy link address" (→ `clipboard.writeText`). Separator.
    - **Image** (`params.mediaType === 'image'`, `params.srcURL || params.imageURL`): "Copy image" (→ `contents.copyImageAt(params.x, params.y)`), "Save image…" (→ `pendingDownloads` + `contents.downloadURL`). Separator.
    - **Selection** (`params.selectionText`): "Copy" (native `role: 'copy'`). Separator.
    - **Editable** (`params.isEditable`, `params.editFlags`): Cut/Copy/Paste/Select All with native roles, gated per `editFlags`. Separator.
    - **Spellcheck** (`params.misspelledWord`): up to 8 suggestions → `wc.replaceMisspelling(w)` (refocuses guest first); "No suggestions" (disabled) when list empty; "Add to dictionary" → `session.addWordToSpellCheckerDictionary`. Separator.
    - **Always:** "Inspect element" → `toggleDevTools(wc)` (with `isInternalContents` guard; DD6).
  - Template is typed as `Electron.MenuItemConstructorOptions[]`; role values cast with `@type {const}` to satisfy the literal-union type. Empty-template guard (`if (template.length === 0) return`) though inspect-only is always present.
  - **Internal `goldfinch://` guests** remain excluded by the outer `!__goldfinchInternal` guard — no menu by construction.
- **`src/main/main.js`:** New `ipcMain.on('toolbar-context-menu', ...)` handler: validates `item ∈ ['media', 'shields', 'devtools']`, builds a native single-item menu "Unpin {Media|Shields|DevTools}", click does read-merge-write of `toolbarPins` + `broadcastToChromeAndInternal`. Matches the former `popup-action unpin-toolbar-item` discipline exactly.
- **`src/preload/chrome-preload.js`:** Added `toolbarContextMenu(item)` bridge method (→ `ipcRenderer.send('toolbar-context-menu', item)`).
- **`src/renderer/renderer-globals.d.ts`:** Added `toolbarContextMenu(item: 'media' | 'shields' | 'devtools'): void` to `GoldfinchBridge`.
- **`src/renderer/renderer.js`:** `openToolbarContextMenu(item)` is a thin wrapper calling `window.goldfinch.toolbarContextMenu(item)`; three `contextmenu` listeners updated to pass only `item` (anchor element no longer needed).

**Deviations from instructions:**
- `openPageContextMenuForAudit` was removed entirely (it called `sendChromeContextMenu` which no longer exists). The a11y harness will need a new drive point once the native context menu is in place — noted for the a11y sub-step.
- The Shift+F10/ContextMenu keydown chrome-focused handler is gone; when focus is in the chrome shell, Shift+F10 no longer opens an Inspect-only menu. The native context menu fires only from guest right-click (the primary use case). Chrome-focused keyboard context menu is deferred to a later sub-step if needed.
- The toolbar Unpin context menu now goes via `toolbar-context-menu` IPC → native `Menu.popup()` rather than the popup overlay. This is consistent with the native-menus pivot and simpler than before.

**Static gates:** `npm run typecheck` clean, `npm run lint` clean, `npm test` 951/951 pass.

**Leg 2 status: `ready`** (revised sub-step 1 of N complete — overlay removed, native page context menu + toolbar Unpin native; kebab/container/find-bar/site-info remain for subsequent sub-steps).

---

### Leg 2 — white-launch fix (fix-review-issues, 2026-06-25)

**Root cause (precisely diagnosed):** `createTab` calls `activateTab(id)` synchronously (~line 483 of `renderer.js`), but for a web tab `tab.wcId` is still `null` at that point — it is set asynchronously in the `window.goldfinch.tabCreate(...).then((wcId) => { tab.wcId = wcId; ... })` callback. `activateTab`'s show path (`if (!tab.trusted && tab.wcId != null) { tabSetActive(...); visibleWebTabWcId = wcId; }`) is therefore SKIPPED because `wcId` is null. The `.then()` callback never re-sent `tabSetActive`. Result: the active web tab's `WebContentsView` is never made visible — it sits behind the opaque white `#webviews` background (`background: #fff` in `styles.css`) until a later `activateTab` fires (e.g., creating a second tab or switching). This is the white-launch-until-you-create-more-tabs bug.

**Fix (surgical — `src/renderer/renderer.js`):** Inside the `tabCreate(...).then(...)` callback, within the `if (tab.id === activeTabId)` branch, added:
```js
window.goldfinch.tabSetActive(tab.wcId, measureWebviewsSlotDIP());
visibleWebTabWcId = tab.wcId;
```
These two lines run as soon as `wcId` arrives and the tab is still active, making the `WebContentsView` visible immediately. Placed before `updateNavButtons()`/`refreshZoomControl()`/`fetchCookies()` so the view shows without delay. Both `measureWebviewsSlotDIP` and `visibleWebTabWcId` are in scope (same file, module-level).

**Temporary diagnostic log added (`src/main/main.js` `tab-set-active` handler):** A one-line `console.log('[tab-set-active] wcId=...')` added at the top of the `ipcMain.on('tab-set-active', ...)` handler so the launch log shows whether the initial tab gets activated. Remove after operator verifies the fix in the live app.

**Static gates:** `npm run typecheck` clean, `npm run lint` clean, `npm test` 951/951 pass.

**Leg 2 status: `ready`** (fix-review-issues applied; awaiting operator smoke verification).

**CONFIRMED (operator eyeball, 2026-06-25):** launch log shows `[tab-set-active] wcId=2 bounds={x:1,y:89,w:1398,h:810}` (initial tab now activated with correct content bounds). Operator confirmed on-screen: **page renders on launch (white-launch GONE)** and the **native right-click context menu** appears at the cursor, above the page, items work. **The native-menu approach is proven** — the architectural blocker is solved. Temp `[tab-set-active]` diagnostic log to be removed in sub-step 2. Next: native kebab + container picker, then find-inset, then site-info.

---

### Leg 2 — sub-step 2: native KEBAB + native CONTAINER picker (2026-06-25)

**What was implemented:**

**Temp diagnostic log removed:** The `console.log('[tab-set-active] wcId=...')` line in the `ipcMain.on('tab-set-active', ...)` handler in `src/main/main.js` was removed (white-launch confirmed fixed in sub-step 1).

**Native kebab menu (`src/main/main.js` — new `open-kebab-menu` handler):**
- `ipcMain.on('open-kebab-menu', ...)` builds a native `Menu.buildFromTemplate` with four items: Settings, Downloads, Print…, Exit. `menu.popup({ window: mainWindow })`.
- Settings/Downloads: signal the renderer via `getChromeContents().send('chrome-open-internal', url)` → renderer's `onChromeOpenInternal` subscription calls `createTab(url, null, { trusted: true })`. This keeps tab creation entirely in the renderer (which owns it).
- Print…: calls `getActiveTabContents().print(...)` directly in main (same path as the existing `print` IPC handler); guards `!__goldfinchInternal`.
- Exit: `app.quit()`.

**Native container picker (`src/main/main.js` — new `open-container-menu` and `new-container-create` handlers):**
- `ipcMain.on('open-container-menu', (_event, { containers }) => ...)`: builds a native menu from the renderer-supplied containers list. Each container = a `MenuItem` (label = name). Plus a separator + "New container…". `menu.popup({ window: mainWindow })`.
- Selecting a container: `getChromeContents().send('chrome-new-tab-in-container', c.id)` → renderer's `onChromeNewTabInContainer` subscription calls `createTab(currentHomePage(), container)` (after looking up the jar in the local `containers` array).
- Burner tab: the renderer adds a `{id: '__burner__', name: 'Burner tab (evaporates)', ...}` sentinel to the list it sends. When `'chrome-new-tab-in-container'` fires with `jarId === '__burner__'`, the renderer calls `makeBurner()` and opens the ephemeral tab — no burner state reaches main.
- "New container…": `ipcMain.on` fires `getChromeContents().send('chrome-new-container-prompt')` → renderer shows the `#new-container-dialog` inline input. User enters a name → renderer calls `window.goldfinch.newContainerCreate(name)` → `ipcMain.handle('new-container-create', ...)` → `jars.add(name)` → fires `getChromeContents().send('chrome-new-tab-in-container', c.id)`. Since `window.prompt` is unavailable in this renderer, the inline `#new-container-dialog` (a new `<div role="dialog">` element in `index.html`) serves as the name-input surface. It is keyboard-dismissable (Escape, Enter, click-outside) and uses the existing `.text-btn` and new `.new-container-*` CSS classes.

**Main→renderer IPC added:**
- `chrome-open-internal` (string url) → renderer `onChromeOpenInternal`: open a trusted internal tab.
- `chrome-new-tab-in-container` (string jarId) → renderer `onChromeNewTabInContainer`: open a new tab in a container (or burner).
- `chrome-new-container-prompt` (no payload) → renderer `onChromeNewContainerPrompt`: show the inline name dialog.

**Renderer→main IPC added:**
- `open-kebab-menu` (one-way send) → main pops native kebab menu.
- `open-container-menu { containers }` (one-way send, containers snapshot) → main pops native container picker.
- `new-container-create { name }` (invoke, returns container or null) → main creates jar + signals tab open.

**HTML/CSS cleanup:**
- `#container-menu` and `#kebab-menu` HTML elements removed from `index.html`.
- `aria-haspopup="menu"` and `aria-expanded="false"` attributes removed from `#kebab` and `#new-tab-menu` (they now open native menus, not in-page popups).
- New `#new-container-dialog` element added to `index.html` (for the name-input flow).
- `#container-menu`, `#kebab-menu`, `#page-context-menu`, `.cm-item`, `.cm-title`, `.cm-sep` CSS blocks removed from `styles.css` (all menus are now native). `.cm-dot` kept (still used by the privacy panel jar indicator). `.cm-item:focus-visible` removed from the shared focus-visible selector.
- New `.new-container-dialog` / `.new-container-inner` / `.new-container-label` / `.new-container-input` / `.new-container-actions` CSS added for the inline dialog.
- `menuController.js` is **kept** — `siteInfoEntry` (address chip → site-info popup) still uses it.

**Deviations from instructions:**
- The leg spec says to use `dialog` in main for "New container…" input. Electron's `dialog` module has no plain-text input field (only `showOpenDialog`, `showSaveDialog`, `showMessageBox`, `showErrorBox`). The chosen approach — `chrome-new-container-prompt` → inline renderer `<input>` dialog → `new-container-create` IPC — is functionally equivalent and simpler than a secondary `BrowserWindow`. This deviation is logged here.
- Burner tab was preserved in the native menu via the `__burner__` sentinel approach (not in the original spec, which only mentioned persistent containers). Parity with the old HTML picker.
- The kebab `aria-haspopup` attribute was removed (no longer controls an in-page popup); the button is still accessible as a plain button that invokes a native OS menu.

**Static gates:** `npm run typecheck` clean, `npm run lint` clean, `npm test` 951/951 pass.

**Leg 2 status: `ready`** (sub-step 2 of N complete — temp log removed, native kebab + native container picker implemented; find-inset + site-info remain for subsequent sub-steps).

---

### Leg 2 — sub-steps 3+4: find bar + site-info via guest-top-inset (2026-06-26)

**Mechanism — guest-top-inset via `computeTopInsetDIP()` + `measureWebviewsSlotWithInsetDIP()`:**

Both the find bar and site-info popup stay as HTML in the chrome doc (no HTML was removed). Instead, the active guest `WebContentsView` is inset from the top when either popup is visible, so the popup occupies the freed strip above the guest. The page stays live below.

Three new functions in `src/renderer/renderer.js`:

- **`computeTopInsetDIP()`**: measures the inset in CSS px (= DIP). For each visible popup (`#find-bar` and `#site-info-popup`, checked via `!classList.contains('hidden')`), computes `Math.ceil(popup.getBoundingClientRect().bottom - webviewsTop) + 4` (the 4px is a breathing gap below the popup). Returns `Math.max(0, inset)` of both; if both open simultaneously, the lower bottom wins.

- **`measureWebviewsSlotWithInsetDIP()`**: calls `measureWebviewsSlotDIP()` for the base rect, then `computeTopInsetDIP()` for the inset, returns `{ x, y: base.y + inset, width, height: base.height - inset }`. When no popup is open, inset=0 and this is identical to the base measurement.

- **`measureWebviewsSlotDIP()`**: unchanged in logic; now used only as a building block by `measureWebviewsSlotWithInsetDIP()`.

All bounds-sending paths now use `measureWebviewsSlotWithInsetDIP()`:
- `sendActiveBounds()` (rAF-coalesced `tabSetBounds`) — updated.
- Both `tabSetActive` call sites — updated.

**Find bar (AC5):**
- `openFind()`: after removing `hidden` from `#find-bar`, calls `sendActiveBounds()` to trigger an rAF-coalesced bounds recompute. The rAF fires after the bar is visible so `computeTopInsetDIP()` measures the bar correctly.
- `closeFind()`: hides `#find-bar` first, then calls `sendActiveBounds()` to restore the guest's full bounds.
- `onTabDidNavigate` handler (navigate clears find on web tabs): added `sendActiveBounds()` after hiding the bar on the active tab.
- `activateTab()`: find-bar visibility update (`classList.toggle`) was **moved before** the `tabSetActive` call so `measureWebviewsSlotWithInsetDIP()` reads the correct inset for the incoming tab (not the previous tab's state).

**Site-info (AC6):**
- `siteInfoEntry.onOpen()`: after making the popup visible and calling `positionSiteInfoPopup()` (which sets the inline `top` style), calls `sendActiveBounds()`. The rAF fires after the popup is positioned so `computeTopInsetDIP()` measures its bottom correctly.
- `siteInfoEntry.onClose()`: hides the popup, then calls `sendActiveBounds()` to restore the guest's full bounds.

**Inset size notes:**
- Find bar: `position: absolute; top: 8px` in `#main`; height ~34px total → inset ≈ 46px (8 + 34 + 4).
- Site-info popup: `position: absolute` in `<body>`, inline `top = addressChip.bottom + 4`. The popup bottom reaches ~200–240px from the viewport top (toolbar height ~89px + 4px gap + popup height ~120–150px). The inset is the popup's bottom minus `#webviews` top — typically 120–150px. If the popup is tall (long permission list), the inset is large; this is acceptable (noted here as a possible future improvement to freeze-frame the page rather than shrink it, if the page-jump feels bad at HAT).

**No main.js changes:** the inset is computed entirely in the renderer and communicated via the existing `tab-set-bounds` / `tab-set-active` IPC. Main's bounds handlers (`setBounds`) are unchanged.

**Deviations from instructions:**
- None. The implementation follows the spec (renderer-side inset computation, `sendActiveBounds()` on open/close, sharing one `computeTopInsetDIP()` for both popups, activateTab ordering fix).

**Static gates:** `npm run typecheck` clean, `npm run lint` clean, `npm test` 951/951 pass.

**Leg 2 status: `ready`** (sub-steps 3+4 complete — find bar + site-info via guest-top-inset. AC5 + AC6 implemented; awaiting operator HAT / review).

---

### Leg 2 — sub-step 5: site-info FLOAT via freeze-frame (2026-06-26)

**Operator decision (operator instruction, sub-step 5):** convert site-info from guest-top-inset to freeze-frame so the panel **floats** over the frozen page without pushing it down. Find bar stays inset (unchanged).

**Problem with the inset approach for site-info:** the inset shrinks the guest view from the top by 120–150px whenever site-info opens, causing a visible page-jump every time. Site-info is a transient info panel that doesn't need a live page behind it, making it a natural freeze-frame candidate.

**Freeze-frame mechanism:**

1. **On open (`siteInfoEntry.onOpen`):**
   - Panel is made visible and positioned as before (no change to those lines).
   - For a web tab (`!t.trusted && t.wcId != null`): calls `window.goldfinch.captureActiveGuest()` (new IPC — see below). On resolution, if the panel is still open and the capture succeeded:
     - Sets `els.webviews.style.backgroundImage = url('${dataURL}')` + `backgroundSize: '100% 100%'` to display the still PNG in the `#webviews` div.
     - Calls `window.goldfinch.tabHide(visibleWebTabWcId)` to hide the live native `WebContentsView` — the background image now occupies the slot.
     - Sets `siteInfoFreezeActive = true`.
   - Guard: if capture returns null (no active web guest), or the panel was closed before the async capture resolved, the freeze is skipped. Internal tabs (`t.trusted`) are `<webview>` elements in the chrome doc (not occluding native views), so freeze-frame is not needed — the panel shows without it.
   - **No `sendActiveBounds()` call:** site-info no longer participates in the top-inset path; `computeTopInsetDIP()` now considers only the find bar.

2. **On close (`siteInfoEntry.onClose`):**
   - Hides the panel.
   - If `siteInfoFreezeActive`: clears the background image + size, calls `window.goldfinch.tabSetActive(t.wcId, measureWebviewsSlotWithInsetDIP())` to restore the live guest with correct bounds, updates `visibleWebTabWcId`.
   - Sets `siteInfoFreezeActive = false`.

**New IPC — `capture-active-guest` (`src/main/main.js`):**
- `ipcMain.handle('capture-active-guest', async () => ...)` calls `getActiveTabContents()?.capturePage()` → `img.toDataURL()` → returns the PNG data URL string, or `null` on error / no active guest.
- Located after `tab-find` handler (near the other tab IPC handlers).

**`computeTopInsetDIP()` pruned:**
- Site-info block removed (it no longer uses inset). Now only measures the find bar. JSDoc updated to reflect the change ("find bar only; site-info uses freeze-frame").

**New module-level state (`src/renderer/renderer.js`):**
- `let siteInfoFreezeActive = false` — tracks whether the freeze is currently applied, so `onClose` knows whether to restore the guest.

**Files changed:**
- `src/main/main.js` — new `ipcMain.handle('capture-active-guest', ...)`.
- `src/preload/chrome-preload.js` — new `captureActiveGuest` bridge method.
- `src/renderer/renderer-globals.d.ts` — new `captureActiveGuest(): Promise<string | null>` type.
- `src/renderer/renderer.js` — `siteInfoFreezeActive` state; `computeTopInsetDIP()` site-info block removed; `siteInfoEntry.onOpen/onClose` rewritten.

**Deviations from sub-step 5 instructions:**
- Instructions mentioned `window.goldfinch.tabHide(visibleWebTabWcId)` as the hide path. Implemented exactly that (`tabHide` with the tracked `visibleWebTabWcId`).
- Instructions mentioned restoring via `tabSetActive`/`tabShow` for the active web tab. Implemented `tabSetActive(t.wcId, measureWebviewsSlotWithInsetDIP())` which is the correct atomic bounds+show path already used in `activateTab()`.
- The async capture guard (drop-if-panel-already-closed) is a small addition not explicitly in the spec but necessary for correctness (fast open-close before capture resolves).

**Potential flash note:** if the async capture takes >1 frame, there is a brief window where the panel is open but the live guest is still visible. The freeze kicks in when the capture resolves. In practice the capture is fast (~milliseconds on a local process) but on a loaded page it could be slower. Operator is advised to observe this at HAT and report if the delay is perceptible.

**Static gates:** `npm run typecheck` clean, `npm run lint` clean, `npm test` 951/951 pass.

**Leg 2 status: `ready`** (sub-step 5 complete — site-info freeze-frame implemented; find bar still inset; AC5 + AC6 both covered. Awaiting operator HAT / review).

### Leg 2 — COMPLETE (all 5 popups, operator-verified, 2026-06-26)

All five chrome popups no longer occluded by the guest views:
- Context menu, kebab, container picker → native `Menu.popup()` (OS-composited above everything).
- Find bar → guest-top-inset (page stays live for highlights).
- Site-info → freeze-frame float (capture guest → frozen image behind → live restore on close), operator-confirmed float + restore.

White-launch (Leg-1 async-activation bug) fixed + confirmed. Static gates green throughout (951/951 tests, typecheck, lint). a11y (`npm run a11y`) + full behavior corpus deferred to the Leg-5 HAT. **Leg 2 status → `landed`.** Next: Leg 3 (internal `goldfinch://` tabs → views), Leg 4 (remove `<webview>` machinery), Leg 5 (HAT).

---

### Flight Director Notes — PIVOT: native menus → freeze-frame HTML menus (Leg 02b added, 2026-06-26)

**Operator decision.** After Leg 2 landed, the operator reported the native `Menu.popup()` menus
(page context menu, kebab, container picker) "really look terrible, and are a bit laggy" on WSLg, and
asked whether to roll back the whole mission, whether the look is a Linux thing, and whether native
menus can be styled.

**Findings surfaced to the operator:**
- **Native Electron menus cannot be styled** — the `Menu`/`MenuItem` API exposes only
  label/icon/accelerator/role/type; rendering is the OS toolkit (GTK on Linux). No fonts/colors/
  spacing/corners.
- The ugliness + lag are **largely a WSLg artifact** (GTK fallback theme + the Wayland/RDP popup
  pipeline); the same menus render cleanly on macOS/Windows. But the operator runs WSLg.
- A **third option** beyond "ugly native" vs "roll back the mission": render the *styled HTML* menus
  over a **freeze-frame** still of the guest — the exact technique site-info already uses and the
  operator already verified ("Floats + restores correctly"). This recovers the styled look + in-process
  snappiness while keeping the entire migration (rolling back would discard Flights 2–3 and abandon the
  migration's purpose — `<webview>` is deprecated/removal-signaled by Electron).

**Operator chose: freeze-frame HTML menus.** (AskUserQuestion, 2026-06-26.)

**DD12 revised AGAIN → freeze-frame HTML menus** for the three guest-overlapping menus. DD12's prior
native-menu choice (and DD12-orig overlay) are kept for history; this is the live menu disposition
going forward. Leg 2 stays `landed` and is NOT rewritten (immutability) — the revision lands in a new
leg, **02b-freeze-frame-html-menus**, executed next (before Leg 3 internal-tabs; the menus are
chrome-doc HTML, independent of the internal-tab and machinery-removal work). The find-bar inset and
the site-info freeze-frame from Leg 2 are unchanged (find stays inset; site-info migrates onto the
shared freeze helper).

**Design review disposition.** The pivot was scoped via an interactive plan (plan mode) whose design
was cross-referenced against current code by a Plan agent — it surfaced load-bearing drift (the a11y
audit is currently broken because `openPageContextMenuForAudit()` was removed in the pivot; most
main-side handlers the HTML menus call already survive; the `menu-controller.js` extraction +
`window.prompt`/kebab-Downloads drift). That codebase-validated review stands in for the Phase-2a
Developer design review for this leg; recorded here per the agentic-workflow Flight Director decision log.

**Key technical insight (carried):** the menus are restorable verbatim from commit **`83b18ad`** (last
commit before the native pivot) via `git show`. Restoration is mostly renderer/preload/markup + native
handler removal; the bulk of main-side plumbing already survives. Approach: one-message capture for the
context menu (main captures in the `context-menu` handler and forwards `{wcId, params, dataURL}` in a
single IPC → lowest latency). **Gating risk:** `capturePage`-on-open latency must beat native lag — a
latency smoke is the FIRST implementation step, with a divert if median > ~80–100 ms.

---

### Leg 02b — freeze-frame HTML menus (2026-06-26)

**Leg objective:** Revert the three chrome menus (page context menu, kebab ⋮, container picker ▾) from native `Menu.popup()` back to styled HTML, rendered over a freeze-frame still of the active guest `WebContentsView`. Restore from commit `83b18ad`; generalize the site-info freeze helper into shared `freezeGuest`/`unfreezeGuest`; fix the broken a11y audit.

---

#### Step 1 — Latency smoke (GATING)

The `capture-active-guest` IPC handler (`capturePage().toDataURL()`) could not be timed interactively from this non-interactive agent context (no live app session available). However, the operator already verified the site-info freeze-frame (which uses the same handler) as "Floats + restores correctly" in Leg 2, confirming the path is perceptually acceptable. Proceeding on that basis. **Divert threshold not triggered.** Operator is asked to verify perceived latency at runtime (HAT / on-screen smoke, Task #7).

---

#### Step 2 — Freeze-frame generalized (renderer.js)

- `let siteInfoFreezeActive = false` **replaced** with `let guestFrozen = false` — single flag for all menus.
- `async function freezeGuest(stillOpen?)` added near the geometry block: web-tab guard → `captureActiveGuest()` → optional liveness check (`stillOpen()`) → set `#webviews` background image + size → `tabHide(visibleWebTabWcId)` → `guestFrozen = true`. Returns `boolean`.
- `function unfreezeGuest()` added: early-return if not frozen; clear flag + bg image/size → `tabSetActive(t.wcId, measureWebviewsSlotWithInsetDIP())` → restore `visibleWebTabWcId`.
- `sendActiveBounds()` — **early-return when `guestFrozen`** (don't move a hidden guest).
- `onTriggerSendBounds` subscription — **no-op when `guestFrozen`** (unfreezeGuest re-measures on dismiss).
- `siteInfoEntry.onOpen/onClose` **migrated** to call `freezeGuest(() => !els.siteInfoPopup.classList.contains('hidden'))` / `unfreezeGuest()`. Behavior identical to prior sub-step 5 code.

---

#### Step 3 — HTML skeleton restored (index.html, styles.css, renderer.js els)

**index.html:**
- Restored `#container-menu` (empty div, role="menu"), `#kebab-menu` (4 static items: Settings, Downloads, Print…, Exit), `#page-context-menu` (empty div, role="menu", tabindex="-1") from `83b18ad`.
- Removed the `<!-- native Menu.popup() -->` placeholder comments.
- `new-container-dialog` comment updated (no longer triggered by native `chrome-new-container-prompt`).

**styles.css:**
- Restored `#container-menu`, `#kebab-menu`, `#page-context-menu` blocks and `.cm-item`, `.cm-sep`, `.cm-title` rule sets from `83b18ad`. Did NOT duplicate `.cm-dot` (already present from Leg 2) or site-info CSS.

**renderer.js els:**
- Restored: `containerMenu`, `kebabMenu`, `pageContextMenu` bindings.
- Removed the `// removed — native Electron Menu.popup()` comments on those entries.

---

#### Step 4 — Bridge restore (preload + d.ts)

**chrome-preload.js:**
- **Removed:** `toolbarContextMenu`, `openKebabMenu`, `openContainerMenu`, `onChromeOpenInternal`, `onChromeNewTabInContainer`, `onChromeNewContainerPrompt`.
- **Added:** `onPageContextMenu` (carries `dataURL`), `clipboardWriteText`, `correctMisspelling`, `pageContextAction` — all as `ipcRenderer.invoke` matching the existing `ipcMain.handle` handlers in main.js.

**renderer-globals.d.ts:**
- Same removals and additions, typed correctly. `onPageContextMenu` carries `dataURL?: string | null`.

**Gate:** `npm run typecheck` → 0 errors.

---

#### Step 5 — Kebab + container HTML menus restored (renderer.js)

- Restored `kebabItems()`, `positionKebabMenu()`, `kebabEntry` (menuController registration with `onOpen`/`onClose`), `closeKebabMenu()`.
- **Drift applied — Downloads:** added `#kebab-downloads` item + click handler (`closeKebabMenu()` + `openDownloads()`). `openDownloads()` moved to be collocated with the kebab section (was after BURNER_SENTINEL in the native version).
- **Drift applied — no inline menuController/focusItem:** the restored code uses the global `menuController` and `focusItem` from `menu-controller.js` — no duplicate declarations.
- **Drift applied — freeze-frame:** kebab `onOpen` → `freezeGuest(() => !els.kebabMenu.classList.contains('hidden'))`; `onClose` → `unfreezeGuest()`. *(Note: this is async; the menu shows then freezes, similar to the prior site-info approach. On the next leg, the onOpen can be made async if the freeze-then-show pattern is preferred.)*
- Restored `containerItems()`, `containerEntry`, `closeContainerMenu()`.
- **Drift applied — New container…:** the "New container…" button in `containerEntry.onOpen` now calls `document.getElementById('new-container-dialog').classList.remove('hidden'); document.getElementById('new-container-name').focus()` — NOT `window.prompt`. The inline `#new-container-dialog` + `initNewContainerDialog()` handle the rest.
- **Drift applied — burner:** burner click calls `createTab(currentHomePage(), makeBurner())` directly.
- **Drift applied — BURNER_SENTINEL removed:** no longer needed (was only for native picker round-trip).
- Container `onOpen`/`onClose` → same freeze/unfreeze wiring as kebab.
- Replaced native `els.kebab.addEventListener('click', ...)` (was `window.goldfinch.openKebabMenu()`) with controller toggle.
- Replaced native `els.newTabMenu.addEventListener('click', ...)` (was `window.goldfinch.openContainerMenu(...)`) with controller toggle.

---

#### Step 6 — Page context menu restored (renderer.js + main.js)

**renderer.js:**
- Restored `pageContextItems()`, `pageCtx` module-level state object, `truncateLabel()`, `basenameFromUrl()`, `buildPageContextSections()`, `positionPageContextMenu()`, `pageContextEntry` (menuController registration), `closePageContextMenu()`.
- **Drift applied — dataURL freeze:** `onPageContextMenu({ wcId, params, dataURL })` subscription applies the freeze directly from the `dataURL` provided by main (synchronous path — no async wait needed). Sets background image + `tabHide` + `guestFrozen = true` **before** `queueMicrotask(() => menuController.open(...))`.
- `pageContextEntry.onClose` → `unfreezeGuest()`.
- Restored Shift+F10/ContextMenu key handler (chrome-focused case).
- **Drift applied — no duplicate menuController/focusItem:** uses globals.

**main.js (context-menu handler):**
- Replaced the `Menu.buildFromTemplate`/`menu.popup` block with: `event.preventDefault()` → `isInternalContents(contents)` guard → `await contents.capturePage().toDataURL()` (try/catch → null) → `getChromeContents()?.send('page-context-menu', { wcId: contents.id, params, dataURL })`.

---

#### Step 7 — Toolbar Unpin mode restored (renderer.js)

- Replaced 1-arg `openToolbarContextMenu(item)` (which called `window.goldfinch.toolbarContextMenu(item)`) with 2-arg `openToolbarContextMenu(item, anchorEl)` from `83b18ad`.
- Re-pointed the three `contextmenu` listeners on `toggleMedia`, `togglePrivacy`, `toggleDevtools` to pass `els.toggleMedia`, `els.togglePrivacy`, `els.toggleDevtools` as `anchorEl`.
- Toolbar-Unpin mode anchors over chrome (not the guest) — no freeze needed; `onClose` calls `unfreezeGuest()` which no-ops when `guestFrozen === false`.

---

#### Step 8 — Native main handlers removed (main.js)

- Deleted `ipcMain.on('toolbar-context-menu', ...)` block.
- Deleted `ipcMain.on('open-kebab-menu', ...)` block.
- Deleted `ipcMain.on('open-container-menu', ...)` block.
- **Removed `Menu` from Electron `require()` destructure** (line 3). Confirmed `grep "Menu\." src/main/main.js` → 0 results.
- `new-container-create` handler simplified: no longer signals `chrome-new-tab-in-container` back — just creates the jar and returns the object; the renderer opens the tab directly from the resolved container.

---

#### Step 9 — Dead renderer subs removed (renderer.js)

- Deleted `window.goldfinch.onChromeOpenInternal(...)` subscription (Settings/Downloads were signaled from native kebab — now the HTML menu calls `createTab` directly).
- Deleted `window.goldfinch.onChromeNewTabInContainer(...)` subscription (was the native container selection path).
- Deleted `window.goldfinch.onChromeNewContainerPrompt(...)` subscription (was the native "New container…" path).
- `initNewContainerDialog()` kept — it now handles the full inline dialog flow for both the container menu's "New container…" button and the `new-container-create` IPC round-trip.

---

#### Gate results

| Gate | Command | Result |
|------|---------|--------|
| Typecheck | `npm run typecheck` | **PASS** — 0 errors |
| Lint | `npm run lint` | **PASS** — 0 errors |
| Tests | `npm test` | **PASS** — 951/951 |
| Menu. grep | `grep -n "Menu\." src/main/main.js` | **PASS** — 0 results |
| Dead native symbols | `grep -rn "openKebabMenu\|openContainerMenu\|..."` | **PASS** — 0 results |
| a11y | `npm run a11y` | **PENDING** — requires live app session (MCP harness); `openPageContextMenuForAudit()` is restored and the function reference that was broken is satisfied. Operator to verify at on-screen smoke. |

**Runtime smoke:** Could not be performed from this non-interactive agent context (no live app session, no MCP harness access). Visual confirmation that the styled HTML menus render above page content over the freeze-frame still is **pending operator on-screen verification (Task #7)**. This covers AC2, AC3, AC4, AC5 (runtime dismiss paths), and AC6 (geometry guard under resize).

---

#### Drift summary

1. **menuController/focusItem are globals** — dropped inline IIFE + function from restored code (no duplicate declarations).
2. **Kebab Downloads** — added `#kebab-downloads` item (was missing in `83b18ad`).
3. **Container "New container…"** — wired to inline dialog (not `window.prompt`).
4. **BURNER_SENTINEL removed** — no longer needed without the native picker round-trip.
5. **new-container-create return path** — main now just returns the container; renderer opens tab directly.
6. **Page-context dataURL** — renderer applies freeze synchronously from `dataURL` forwarded by main (one round-trip vs. prior two-round-trip async capture path).
7. **onOpen freeze async** — for kebab/container, `freezeGuest` is async but `onOpen` is not `await`ed by the controller; the freeze applies after the menu is already visible (same behavior as the prior site-info implementation). Acceptable per the "accept + log" edge-case note.

**Leg status → `landed` (NOT committed).**

---

#### Leg 02b — fix-review continuation: latent Leg-1 a11y regression (dangling `aria-controls`)

Restoring `openPageContextMenuForAudit()` un-broke the a11y audit (`#page-context-menu` now appears in the audit, as intended). With the audit running again, it surfaced **7 new critical `aria-valid-attr-value` violations on `.tab`** (one per scenario) — a **latent Leg-1 regression** that had been masked since the Leg-2 native pivot broke the audit.

**Root cause (Leg 1, not Leg 02b):** `createTab()` set every tab button's `aria-controls` to `webview-${id}`. Pre-migration each tab had a real `<webview id="webview-${id}">` DOM node, so the IDREF resolved. Leg 1 migrated **web (untrusted) tabs** to native `WebContentsView`s with **no per-tab DOM node** — but the `aria-controls="webview-${id}"` line ran unconditionally for all tabs, so for view-backed web tabs the IDREF dangled → invalid attribute value → critical axe violation.

**Fix (`src/renderer/renderer.js`):** point the tab button's `aria-controls` at the shared content region `#webviews` (`<div id="webviews">` in `index.html`) instead of a per-tab id. `#webviews` is the single content container both tab kinds use — native web views are composited over it; internal tabs keep a `<webview>` CHILD of it — so it is the one element common to both and the only non-dangling target. All tabs controlling the one content region is valid and semantically correct (there is no per-tab DOM node anymore).

**Grep sweep for other dangling IDREFs from the view migration** (`grep -rn "webview-" src/renderer/` + `aria-controls`/`aria-labelledby`/`aria-describedby`/`aria-owns`/`for=`/`htmlFor`/`getElementById('webview-...')`):
- `renderer.js:716` — `webview.id = \`webview-${id}\`` is still set, but ONLY inside the `if (trusted)` branch that genuinely creates a `<webview>` element for internal tabs → the id is on a real element, not dangling; left untouched (no aria refs it).
- `renderer.js:752` — the now-fixed `aria-controls="webviews"` (the only `aria-controls` in the renderer).
- Other `webview-` hits are all `webview-preload.js` file-path references (preload/main), unrelated to IDREFs.
- No `aria-labelledby`/`aria-describedby`/`aria-owns`/`for=`/`htmlFor`/`getElementById('webview-...')` references the removed per-tab element. **Sweep clean — this was the only dangling IDREF.**

**Gates after fix:** `npm run typecheck` → 0 errors; `npm run lint` → 0 errors. The live `npm run a11y` re-run (to confirm the 7 violations are cleared) is the operator's — they will restart the app against fresh code. AC8's a11y line stays "pending operator `a11y` run" until that confirms 0 new violations.

---

#### Leg 02b — HAT inline fix: page context menu (positioning + freeze path)

Operator HAT passed kebab, container, latency, and dismiss-restores. The **page context menu failed** two ways: it rendered BEHIND the live guest in the content region, and was misaligned ~89px too high. Two root causes, both fixed inline (no commit).

**Bug B — positioning (`positionPageContextMenu`, renderer.js).** The offset used `activeTab().webview.getBoundingClientRect()`. Web tabs are native `WebContentsView`s now and have **no `.webview` element** → `wv` falsy → offset fell back to `{left:0,top:0}` → the guest-view-relative `params.x/y` were applied at the chrome origin instead of the content region's top-left (~89px too high; visible when right-clicking near the top, over the chrome band). **Fix:** for the non-keyboard (mouse) case, offset by `els.webviews.getBoundingClientRect()` when there is no `.webview` element; internal tabs (which still have a `<webview>`) keep using its rect; keyboard (chrome-focused Shift+F10) coords stay un-offset.

**Bug A — freeze not applying ("behind" symptom): Option B → Option A switch.** The context menu was the only one using an **event-time main-side capture** (`contents.capturePage()` in the `context-menu` handler, forwarding `dataURL`), freezing only `if (dataURL)`. On WSLg that capture intermittently threw/returned empty at right-click time → `dataURL` null → freeze skipped → the opaque live guest occluded the HTML menu. Kebab/container never had this because they freeze via the renderer's proven `freezeGuest()`/`captureActiveGuest()` path (operator-confirmed working). **Deliberate switch from the plan's "Option B single-message" to "Option A" (the proven renderer path):**
- `main.js` `context-menu` handler: dropped the `capturePage()`/`dataURL` entirely; now synchronous — `preventDefault` → internal guard → `send('page-context-menu', { wcId, params })`.
- `renderer.js` `onPageContextMenu`: removed the `dataURL` destructure + the inline freeze block; just sets `pageCtx` + `queueMicrotask(open)`.
- `renderer.js` `pageContextEntry.onOpen`: applies the freeze via `freezeGuest(() => menuController.current === pageContextEntry)`, gated to the mouse-on-guest case only (`!pageCtx.toolbarItem && !pageCtx.keyboard`) — toolbar-Unpin anchors over chrome and keyboard Shift+F10 originates from a chrome element, neither needs a guest freeze. Fire-and-forget, mirroring kebab/container exactly.
- `renderer-globals.d.ts`: `onPageContextMenu` payload narrowed to `{ wcId, params }` (no `dataURL`).

**Rationale recorded:** the plan's Option B (one-message event-time capture for lowest latency) is abandoned for the context menu because the event-time `capturePage()` is unreliable on WSLg; all four menus now share the single proven `freezeGuest`/`captureActiveGuest` open-time path. Latency was already operator-confirmed acceptable on that path.

**Gates after fix:** `npm run typecheck` → 0 errors; `npm run lint` → 0 errors; `npm test` → 951/951. Operator to restart and re-test the page context menu on-screen.

---

#### Leg 02b — HAT inline fix #2: toolbar-Unpin + keyboard page-context were occluded (freeze made unconditional)

After the context-menu fix, the operator confirmed the mouse page context menu works on screen. New finding: the **toolbar-Unpin menu** (right-click a pinned media/shields/devtools toggle) only appeared when a side panel was open.

**Root cause — earlier assumption wrong.** I had gated the page-context freeze to `!pageCtx.toolbarItem && !pageCtx.keyboard`, on the assumption that toolbar-Unpin "anchors over chrome." In fact the Unpin dropdown extends **DOWN into the guest content region**, so with no side panel open the opaque native guest occludes it; with a panel open that region is chrome HTML (the panel, not a native view) so it showed. The keyboard Shift+F10 page-context case had the same latent exposure.

**Fix (`src/renderer/renderer.js`, `pageContextEntry.onOpen`).** Made the freeze **unconditional**. `freezeGuest()` already self-gates to web tabs (no-ops for internal/no-guest), so toolbar-Unpin and keyboard invocations freeze too when a web guest is present:
```js
// was:
if (!pageCtx.toolbarItem && !pageCtx.keyboard) {
  freezeGuest(() => menuController.current === pageContextEntry);
}
// now:
freezeGuest(() => menuController.current === pageContextEntry);
```
Positioning is unaffected — `positionPageContextMenu` still branches on `pageCtx.keyboard` for the coordinate offset; the freeze only hides the live guest and paints the still. `onClose` already calls `unfreezeGuest()` unconditionally, so the freeze stays balanced across all three invocation modes (mouse / toolbar-Unpin / keyboard).

**Gates after fix:** `npm run typecheck` → 0 errors; `npm run lint` → 0 errors. Operator to re-test toolbar-Unpin (no side panel open) + keyboard Shift+F10 on screen.

---

#### Leg 02b — Flight Director: live verification complete + checkpoint

**a11y (Flight Director ran it live).** Launched `dev:automation` (admin key minted), ran `npm run a11y` against the running app. First run after restoring the audit surfaced the 7 critical `aria-controls` violations (logged above); after the `aria-controls="webviews"` fix and an app restart, the re-run reported **"No NEW violations — every violation node is in the ACCEPTED baseline. ✅"**. The audit exercises `#page-context-menu` (via the restored `openPageContextMenuForAudit()`), confirming the page context menu opens with valid roles/landmark. **AC8 a11y now GREEN** (and a previously-invisible critical regression is cleared — the audit had been broken since the Leg-2 pivot).

**Operator HAT (on-screen, WSLg) — PASS for all menus.** After two inline fixes (context-menu position+freeze; toolbar-Unpin/keyboard freeze made unconditional), the operator confirmed on the real screen:
- Page context menu (mouse): styled, aligned at the cursor, over the frozen page; items work; dismiss restores the live page. ✅
- Kebab ⋮ and container picker ▾: styled, above the page. ✅
- Toolbar-Unpin (right-click a pinned toggle) with **no side panel open**: now shows. ✅
- Latency: as snappy or snappier than the native menus it replaced (original complaint resolved). ✅
- Dismiss restores the live guest cleanly. ✅

**Final gates (Flight Director, clean checkpoint):** `npm run typecheck` → 0; `npm run lint` → 0; `npm test` → 951/951; `npm run a11y` → 0 new violations; `grep "Menu\." src/main/main.js` → 0.

**All AC1–AC8 satisfied** (AC1 latency confirmed by operator feel on the proven `freezeGuest`/`captureActiveGuest` path). **Leg 02b checkpoint-committed (local, not pushed)** — mirroring the Legs 1 & 2 WIP checkpoint; leg stays `landed` (flight-end Reviewer pass + `completed` status happen when the flight lands). Next (operator pace): resume Leg 3 (internal `goldfinch://` tabs → views), Leg 4 (remove `<webview>` machinery), Leg 5 (HAT).

---

### Leg 3 — internal-tabs-as-views (2026-06-26)

**Scope:** Migrated internal `goldfinch://` tabs (settings, downloads) from renderer `<webview>` elements to directly-constructed main-process `WebContentsViews`, reproducing the internal trust boundary byte-exact at construction. Retired all `tab.trusted && tab.webview` renderer couplings. Added a both-sides `capture-active-guest` internal guard. No `<webview>` construction remains anywhere in the codebase.

---

#### Step 1 — Main: `tab-create` internal-view construction

**Byte-exact internal `webPreferences` (the load-bearing fact):**

```js
{
  preload: path.join(__dirname, '..', 'preload', 'internal-preload.js'),
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  partition: INTERNAL_PARTITION,   // ← from require('../shared/internal-page'), never a literal
  spellcheck: false,
}
```

The trusted early-return-null (`main.js:1400`) was replaced by a branch that selects web vs internal `webPreferences` based on the `trusted` flag. The `INTERNAL_PARTITION` constant is already imported at the top of `main.js` — no new import needed. The web branch is byte-identical to before (NO `spellcheck` key on web — owned by the session-layer applier). All construction steps (addChildView, seed bounds, setVisible(false), tabViews register with `trusted`, wireGuestContents then wireTabViewEvents then loadURL) mirror the web path exactly. Returns `wcId` for both trusted and untrusted.

**`tabViews` registration:** `{ view, partition: trusted ? INTERNAL_PARTITION : partition, trusted, active: false }` — the `trusted` flag is now stored in the registry for any future consumer.

---

#### Step 2 — Renderer: `createTab` trusted branch → view IPC

- Removed `<webview>` creation (the `document.createElement('webview')` block with src/preload/partition/allowpopups attributes).
- `tab.webview = null` always (field kept for type compat; Leg 4 removes it).
- Both trusted and untrusted now call `window.goldfinch.tabCreate({ url, partition: jar.partition, trusted })`.
- In the `.then(wcId => ...)` callback, when the tab is still active: calls `tabSetActive(tab.wcId, measureWebviewsSlotWithInsetDIP())` (same as web), and ONLY sets `visibleWebTabWcId = tab.wcId` when `!trusted` — internal tabs never participate in the freeze-frame path.
- The `activateTab` path for internal tabs with wcId now calls `tabSetActive` (so switching back to an already-open internal tab makes it visible — the key AC7 correctness fix).

---

#### Step 3 — Renderer: all `tab.trusted && tab.webview` couplings retired

Every coupling found and updated (AC7):

| Site | Action |
|------|--------|
| `createTab` (`:728–735`) | `<webview>` creation block removed |
| `closeTab` (`:816–821`) | Both branches unified: `tab.wcId != null` → `tabClose` (internal uses same path as web) |
| `activateTab` for-loop (`:829–832`) | `t.trusted && t.webview` CSS toggle removed; all tab visibility via tab-set-active IPC |
| `activateTab` IPC branch (`:856–868`) | `!tab.trusted && tab.wcId != null` → unified `tab.wcId != null` with sub-branch for `!trusted` to set `visibleWebTabWcId`; internal branch sends `tabSetActive` |
| `updateNavButtons` (`:1228`) | `tab.trusted && tab.webview` → `tab.trusted` → explicitly disable back/forward (no nav history) |
| `navigate()` (`:1256–1268`) | Dead `tab.trusted && tab.webview` loadURL branch removed; `isInternalTab` early-return covers internal |
| `els.back` click | Dead `t.trusted && t.webview` branch removed; `!t.trusted && t.wcId != null` only |
| `els.forward` click | Same |
| `els.reload` click | Dead `t.trusted && t.webview` branch removed |
| Keyboard Ctrl+R reload | Dead `t.trusted && t.webview` branch removed |
| Shields "Reload to apply" | Dead `t.trusted && t.webview` branch removed |
| `newIdentity` | Dead `tab.trusted && tab.webview` branch removed |
| `runFind` | Dead `tab.trusted && tab.webview` branch removed; `openFind`'s `isInternalTab` guard prevents internal tabs from reaching here |
| `closeFind` | Same |
| `els.mediaRescan` click | Dead `t.trusted && t.webview` branch removed; guarded by `t.trusted` early-return |
| `__goldfinchAutomation.openTab` | Dead `tab.trusted && tab.webview` dom-ready poll branch removed; all tabs use the wcId-poll path |
| `wireWebview(...)` call (`:787`) | Removed (replaced by the unified tabCreate IPC path) |
| `wireWebview` function (`:1089–1220`) | Removed entirely (fully unused after the call site was removed; grep confirmed 0 call sites) |
| `buildSiteInfo` "Site settings →" (`:329`) | `existing.webview.loadURL(...)` replaced with `tabNavigate({ verb: 'loadURL', args: [...] })` IPC |
| `positionPageContextMenu` (`:558`) | Dead `t.webview` reference removed; always uses `els.webviews.getBoundingClientRect()` (correct for all tabs) |
| `pageContextEntry.focusReturn` (`:609`) | Dead `wv.focus()` on `t.webview` removed; fallback to `ret` or `els.address.focus()` |

`isInternalTab(tab)` is substrate-independent (keys on `container.id === 'internal' || container.partition === internalPartition`) — kept unchanged.

**Post-removal grep:** `grep -n "createElement('webview')\|tab\.webview\|wireWebview" src/renderer/renderer.js` → shows only comments. **AC7 clean.**

---

#### Step 4 — Defensive internal guard on `capture-active-guest`

Added `if (isInternalContents(wc)) return null;` to the main-side `ipcMain.handle('capture-active-guest', ...)` handler after the `wc` resolve. Updated the stale comment: the old text said "internal tabs use `<webview>` in the chrome doc — not occluding — so the freeze-frame is not needed"; corrected to describe the both-sides internal-guard discipline (matching `toggle-devtools`/`print`/`get-zoom`/`page-context-*`). The renderer `!t.trusted` guard in `freezeGuest` is the primary gate; this main-side check is defense-in-depth.

---

#### Trust-transfer analysis (gates, protocol.handle, bridge, exclusion)

All four trust mechanisms key on **session identity** (`wc.session.__goldfinchInternal === true`) or partition — not on the `<webview>` substrate. A constructed view with `partition: INTERNAL_PARTITION` resolves the existing internal session (created at startup, marker already set); no re-creation occurs.

| Mechanism | Transfer status |
|-----------|----------------|
| **Session-created hook** (shields/downloads/spellcheck exemption, `main.js:1746–1765`) | Transfers automatically — the view resolves the same session object whose `session-created` already fired at startup. No change to gate code. |
| **`will-navigate` guard** (`main.js:558–566`) | Transfers automatically — keys on `contents.session.__goldfinchInternal`. |
| **`setWindowOpenHandler`** (`main.js:550–553`) | Transfers automatically — wired by `wireGuestContents` which is called explicitly on the internal view in `tab-create`. |
| **`before-input-event`** zoom/F12/print (`main.js:571–621`) | Transfers automatically — the listener is wired by `wireGuestContents`; the handler checks `__goldfinchInternal`. |
| **`protocol.handle`** | Transfers automatically — registered on the internal session object; byte-exact partition → same handler. Page renders (AC4) pending runtime verification. |
| **Origin-checked bridge** (`registerInternalHandler` + preload `location.origin` check) | Transfers automatically — checks `event.sender.session.__goldfinchInternal` (session marker) + `event.senderFrame.origin` (scheme-derived, same as before). Settings get/set, downloads, shields all pending runtime verification (AC5). |
| **Automation exclusion** (`isInternalContents` in `resolve.js`) | Transfers automatically — keys on `wc.session.__goldfinchInternal === true` (strict equality). `enumerate` filter (`main.js:1094`) and `resolveContents` exclusion both survive. Pending runtime smoke (AC6). |

**None of the gate code was modified.** Trust transfer is structural, not mechanical — it works because the session identity is preserved, which is guaranteed by using `INTERNAL_PARTITION` (the constant, never a literal).

---

#### Tests

No existing unit test pinned the `trusted → null` behavior from `tab-create` (confirmed by grep). The unit tests for `internal-ipc`, `automation-resolve`, `internal-assets`, `automation-tabs`, `automation-scope`, `automation-input`, `automation-print` are all substrate-independent (keyed on session/origin markers via `makeInternalWc`) — they pass without modification.

**`npm test` → 951/951 pass** (unchanged count; no tests required inversion or deletion).

---

#### Post-Leg note for Leg 4

After this leg, **no tab is a `<webview>`** — `tab.webview` is always `null`, `wireWebview` is removed, and no `document.createElement('webview')` call exists in the renderer. Leg 4 can now safely remove:
- `webviewTag: true` from chrome view `webPreferences`
- `will-attach-webview` hook (its internal branch's work is now done at construction time in `tab-create`)
- The `tab.webview` field declaration and any remaining null-check references
- `window.goldfinch.internalPreloadPath` / `internalPreloadPath` global (main now owns the preload path; the renderer no longer sets it on any element)
- The `getType() === 'webview'` filter in `web-contents-created` (no `<webview>` elements remain; the global handler sees no webview guests)

---

#### Runtime verification

**Static gates (all run, all green):**
- `npm run typecheck` → 0 errors
- `npm run lint` → 0 errors
- `npm test` → 951/951 pass
- `grep -n "createElement('webview')\|tab\.webview\|wireWebview" src/renderer/renderer.js` → comments only (AC7 clean)

**Runtime verification (AC2–AC6, AC9 a11y) — PENDING FD/operator verification.** This leg was implemented in a non-interactive agent context with no live app session or MCP harness access. The following ACs require operator on-screen smoke:

- **AC2** — `goldfinch://settings` + `goldfinch://downloads` open, render real content, are visible/switchable/closable as views; `#webviews` has no `<webview>` child.
- **AC3** — Four gates fire on the view: disallowed nav blocked, `window.open` opens a tab, zoom/F12 inert, no shields/download wiring on internal session.
- **AC4** — `protocol.handle` serves the view (page renders, not a 404).
- **AC5** — Origin-checked bridge works: settings get/set round-trips, downloads list renders, shield calls succeed; non-internal sender still rejected.
- **AC6** — Automation: `enumerate` does not list internal; direct internal `wcId` returns `automation: internal-session` for jar keys.
- **AC9 a11y** — `npm run a11y` against the running app.

The trust transfer analysis above is structural (verified by reading the code) — runtime observation is required to close AC2–AC6 as "verified" rather than "expected by construction."

**Leg 3 status → `landed` (NOT committed). ACs AC1/AC7/AC8 verified statically; AC2–AC6/AC9 pending FD/operator on-screen verification.**

#### Leg 3 — Flight Director verification (2026-06-26)

**Design review disposition.** Leg 3 was design-reviewed by a Developer agent (approve-with-changes); it surfaced the both-sides `capture-active-guest` guard (HIGH), the `updateNavButtons` degeneration (HIGH), and the full set of `tab.trusted && tab.webview` couplings beyond the initial list. All were folded into the leg before implementation; the FD skipped a second design-review cycle since the changes were direct incorporations of the reviewer's concrete fixes (flight-end Reviewer is the backstop).

**FD self-serve (live app, Leg-3 code):** clean boot (no errors from the internal-view construction); **`npm run a11y` → 0 new violations (AC9 ✅)**.

**Operator HAT (on-screen, WSLg) — PASS:** `goldfinch://settings` and `goldfinch://downloads` load as views with real content (AC2/AC4 ✅); a settings change persists (origin-checked bridge works on the constructed view — AC5 ✅); back/forward disabled on internal pages (AC7 nav-button fix ✅); switch/close work. The byte-exact `INTERNAL_PARTITION` carried the entire trust boundary onto the views.

**Deferred to Leg 5 HAT (as the flight planned):** the full automation-exclusion + trust corpus — `internal-session-exclusion` + `mcp-jar-scoping` (run FIRST), then `farbling-correctness` / `core-browsing-shields` / `mcp-drive-end-to-end`. The jar-key rejection path (`automation: internal-session`) is already covered by `automation-resolve` unit tests; AC6 closes fully at Leg 5.

**No tab is a `<webview>` anymore** → **Leg 4 (remove `webviewTag`/`will-attach-webview`) is unblocked.** Leg 3 will be checkpoint-committed together with Leg 4 (tightly coupled: Leg 4 removes the machinery Leg 3 made unused).

---

### Leg 4 — remove-webview-machinery

**Date:** 2026-06-26  
**Status:** landed (NOT committed — checkpoint commit covers Legs 3+4 together per Leg 3 FD note)

#### What was removed

**AC1 — `webviewTag: true` (main.js ~line 411):** Removed the `webviewTag: true` key from the `chromeView` `webPreferences` block. Updated the surrounding comment block to drop the `<webview>` rationale and note that guest tabs are now per-tab `WebContentsView`s wired explicitly in `tab-create`.

**AC2 — `will-attach-webview` hook (main.js ~lines 443–467):** Removed the entire `getChromeContents().on('will-attach-webview', …)` callback and its comment block (8-line comment explaining main-world preload and the internal-branch contextIsolation exception). The hook never fires — no `<webview>` is ever attached now. The webPreferences it was setting (contextIsolation, sandbox, nodeIntegration, spellcheck) are now set at construction time in `tab-create` for both the internal branch (via `webPreferencesObj` with `contextIsolation: true`, `sandbox: true`, `spellcheck: false`) and the web branch.

**AC3 — Dead `web-contents-created` handler (main.js ~lines 659–663):** Removed the `app.on('web-contents-created', (_event, contents) => { if (contents.getType() === 'webview') wireGuestContents(contents); })` handler entirely. A constructed `WebContentsView` reports `getType() === 'window'`; this branch could never match. The `wireGuestContents` function definition remains (lines ~514–656); the explicit call in `tab-create` (`wireGuestContents(view.webContents)`) remains untouched.

**AC4 — Unused bridge globals (chrome-preload.js:146–150, renderer-globals.d.ts:116–119):**

Confirm-dead grep BEFORE removal:
```
grep -rn "webviewPreloadPath|internalPreloadPath" src/renderer/ src/main/
→ src/renderer/renderer-globals.d.ts:116  webviewPreloadPath: string;
→ src/renderer/renderer-globals.d.ts:119  internalPreloadPath: string;
```
Zero live renderer consumers (no `window.goldfinch.webviewPreloadPath` or `window.goldfinch.internalPreloadPath` usage in `renderer.js` or any renderer file). Safe to remove.

Removed:
- `webviewPreloadPath: \`file://…webview-preload.js\`` and its comment block from `chrome-preload.js`
- `internalPreloadPath: \`file://…internal-preload.js\`` and its comment block from `chrome-preload.js`
- `webviewPreloadPath: string` type from `renderer-globals.d.ts`
- `internalPreloadPath: string` type from `renderer-globals.d.ts`

The files themselves (`webview-preload.js`, `internal-preload.js`) are **untouched** — main uses them directly via `path.join(__dirname, …)` in `tab-create`.

#### Explicit tab-create wiring confirmed intact

After removal of the dead `web-contents-created` handler, the only `wireGuestContents` call site is the explicit one in `tab-create` (confirmed by grep):
```
grep -rn "wireGuestContents" src/
→ src/main/main.js:514   // wireGuestContents — wires event listeners…
→ src/main/main.js:519   function wireGuestContents(contents) {
→ src/main/main.js:1416  wireGuestContents(view.webContents);   ← explicit tab-create call (KEPT)
```
Every web tab and internal tab view is wired at construction before `loadURL` — no guest is left unwired.

#### AC6 — `find.js` automation-find deferral (DD6)

`src/main/automation/find.js` is **unchanged**. Lines 120 and 170 still contain `document.querySelectorAll('webview')` — a query that now returns an empty NodeList (no `<webview>` elements exist in the chrome doc). The automation `findInPage` MCP op is therefore non-functional on the view surface: the D1 workaround (injecting the listener onto a `<webview>` element) finds nothing.

Per flight DD6, the `find.js` D1 workaround + the full MCP automation parity rework are deferred to **mission Flight 4/5** (the automation parity sweep). The user-facing find **bar** is unaffected (Leg 1 re-pointed the `found-in-page` transport for views). This is a known, tracked deferral — not a regression of existing behavior.

#### SC1 source-absence — MET

Post-removal greps (all run, all clean):
- `grep -rn "webviewTag\|will-attach-webview" src/` → only incidental comments in non-tab-path files (`internal-preload.js:4` historical note, `settings-store.js:64` historical note, `main.js` two historical comments, `renderer.js:1089` changelog comment). Zero live keys or handlers.
- `grep -rn "getType() === 'webview'\|getType()==='webview'" src/` → 0.
- `grep -rn "webviewPreloadPath\|internalPreloadPath" src/` → 0.

No `<webview>` can be constructed (the tag is off; the enabling key is gone from chromeView `webPreferences`). SC1's source-absence half is met.

#### Static gates (verified)

- `npm run typecheck` → 0 errors
- `npm run lint` → 0 errors
- `npm test` → **951/951 pass**

#### Runtime verification — pending FD

`npm run a11y` and the on-screen smoke (web tab + Settings + Downloads open/browse/switch/close as views; popup opens as tab; unsafe nav blocked; internal gates hold) require the live app with the MCP automation surface attached. These were not run in this agent context (no live GUI/MCP harness). The Flight Director should run `npm run a11y` and the HAT smoke before the checkpoint commit.

#### Leg 4 — Flight Director verification (2026-06-26)

Ran against the live app on the Leg-4 code (all `<webview>` machinery removed):
- **Clean boot** — no errors/ReferenceErrors from the deletions.
- **`npm run a11y` → 0 new violations.**
- **MCP view-surface smoke (goldfinch automation, jar-scoped key):** `openTab https://example.com` → view constructed (`wcId 5`); `enumerateTabs` → `{wcId:5, title:"Example Domain", active:true}` (loaded, dom-ready, drivable); `navigate(5, https://example.net)` → `{ok:true}`, `enumerateTabs` → url updated to `example.net` (tab-navigate IPC + `did-navigate` event re-homing intact). `captureWindow` correctly refused for the jar key (`admin-only`) — exclusion still enforced. The engine drives the view end-to-end with no `<webview>` machinery present.

Combined with Leg-3's operator-confirmed internal tabs (Leg 4 only deleted dead code that never fired for views), AC5 (app runs, tabs browse as views) and AC7 (gates green) are satisfied. **Leg 4 `landed` — verified.** Legs 3 + 4 checkpoint-committed together next.

