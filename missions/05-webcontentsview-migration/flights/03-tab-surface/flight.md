# Flight: Tab Surface

**Status**: ready
**Mission**: [WebContentsView Migration](../../mission.md)

## Contributing to Criteria
- [ ] **SC1 — Native guest surface.** Every tab — web AND internal `goldfinch://` — renders via a
  per-tab `WebContentsView`; **no `<webview>` tag remains anywhere** in the tab/guest path
  (`webviewTag:true` and the `will-attach-webview` hook are removed). *(This flight fully meets SC1's
  source-absence half; the "browses" half rides SC3.)*
- [ ] **SC3 — Browser-behavior parity (tab surface).** Multi-tab browsing, tab switch/close,
  back/forward/reload, address-bar sync, favicons, titles, persistent sessions, and popups-as-tabs all
  work on the per-tab-view surface. *(Verified: active browsing/tab behavior tests on the new surface.)*
- [ ] **SC5 — Privacy & trust model preserved (partition identity + farble + internal trust).** Each
  tab's jar/container/burner/default partition is reproduced **byte-exact** at view construction (the
  security-critical move off `<webview partition>` onto `webPreferences.partition`); fingerprint farbling
  (main-world, non-context-isolated preload) still runs per tab on directly-constructed views; and the
  internal-page trust model (the four gates, the internal session, the origin-checked bridge) holds on
  the internal `WebContentsView`. *(Verified: `internal-session-exclusion` + `mcp-jar-scoping` first,
  then `farbling-correctness` / `core-browsing-shields`.)*
- [ ] **SC6 — Automation parity (forced subset only).** `captureWindow` is re-homed so it still
  composites the guest once guests are sibling views (a regression this flight *introduces* and must
  fix); the by-`webContents`-id addressing the rest of the MCP surface uses is unchanged. *(Broad MCP
  end-to-end parity remains the **Flight 5** sweep; this flight only repairs what the tab-surface change
  breaks.)*

---

## Pre-Flight

### Objective

Migrate guest tabs from renderer-embedded `<webview>` elements to per-tab main-process
`WebContentsView`s — **one view per tab, `setVisible` for show/hide, per-tab `webPreferences` set at
construction** (the spike-proven model). This flight migrates **both** web tabs **and** internal
`goldfinch://` tabs (operator decision — see DD0), which lets it fully remove the `<webview>` machinery
(`webviewTag:true`, `will-attach-webview`) and meets SC1's source-absence criterion outright. The
chrome `WebContentsView` from Flight 2 stays the host; guest views become **siblings** of the chrome
view, positioned by main-process geometry. Tab-strip-essential events (navigation, title, favicon, load
state) re-home from `<webview>` DOM events to main-process `webContents` events forwarded over IPC; the
conveniences (find, media-rescan, privacy-stream) stay on their current path and re-home in **Flight 4**.
Because guests stop being nested in the chrome document, `captureWindow` must be re-homed too. The
acceptance signal for the new surface is **rendered pixels + the byte-exact partition guards**, not a
DOM read — this flight is where the mission's "DOM-correct ≠ render-correct" thesis is first exercised
on guest tabs.

### Open Questions
- [x] One view per tab vs. one reused view? → **One-view-per-tab + `setVisible`** (Flight-1 spike,
  debrief Recommendation 1). Resolved → DD1.
- [x] Does the farble main-world preload run on a *directly-constructed* `WebContentsView` webContents
  (no `<webview>` attachment hook)? → **Yes** — Flight-1 spike probes 6a/6b passed (main-world preload
  runs at `document-start` on a directly-constructed view). Resolved → DD3/DD10.
- [x] Which tabs migrate this flight — web only, or web + internal? → **Both** (operator decision).
  Resolved → DD0.
- [x] Who computes per-tab-view geometry: renderer-measures-the-slot-and-sends, or main-computes-from
  -insets? → **renderer-measures-sends, Architect-accepted** (Phase 5b) against the real flex layout, with
  five apparatus requirements made load-bearing (DPR→DIP scaling, initial-bounds seed, set-bounds-before
  -reveal ordering, debounce strategy, overlay-occlusion caveat). Resolved → DD5. Divert trigger did not fire.
- [x] Does `captureWindow` survive guests becoming sibling views? → **No** — `chromeContents.capturePage()`
  is structurally blind to sibling views (Flight-1 spike Leg 1 demonstrated per-view capture can't see
  the overlap). Must be re-homed this flight → DD11 (carried as a divert trigger, judged on the PNG).

### Design Decisions

**DD0 — Migrate BOTH web and internal tabs to views this flight (operator decision).**
- Choice: Flight 3 migrates every tab — untrusted web tabs *and* trusted internal `goldfinch://` pages —
  to directly-constructed `WebContentsView`s. The mission's original plan slated internal pages for
  Flight 5; the operator chose to pull them forward so the `<webview>` machinery can be removed in one
  flight rather than leaving a transient hybrid across two.
- Rationale: `webviewTag:true` + `will-attach-webview` can only be removed once **no** tab is a
  `<webview>`; migrating internal alongside web tabs unblocks that cleanup now (debrief Recommendation 2)
  and meets SC1's source-absence half outright.
- Trade-off: A larger, security-critical diff this flight (it touches the internal trust boundary); the
  mission's **Flight 5 shrinks to the automation (MCP) parity sweep** (internal-page migration moves
  here). The mission Flights list is updated to reflect this; traceability preserved in the flight log.

**DD1 — One `WebContentsView` per tab; `setVisible` for show/hide; per-tab `webPreferences` at construction.**
- Choice: Each tab is its own `WebContentsView`, held in a module-level **tab-view registry** keyed by
  the guest `webContents.id` (`wcId`). The active tab's view is `setVisible(true)`; all others
  `setVisible(false)`. All per-tab `webPreferences` are set in the `new WebContentsView({...})` call —
  the config that used to be applied by the `will-attach-webview` hook (DD3) moves to construction time,
  because that hook never fires for a directly-constructed view.
- Rationale: The Flight-1 spike validated exactly this model (debrief Recommendation 1). `setVisible`
  is the native analog of today's renderer `.hidden` CSS toggle (`renderer.js:811`).
- Trade-off: Main-process owns tab lifecycle/visibility that the renderer owned before — a real shift in
  responsibility, but the necessary one for native views.

**DD2 — Extend the accessor seam: add a tab-view registry + `getTabContents(wcId)`; KEEP `getChromeContents()`.**
- Choice: Introduce the tab registry and a `getTabContents(wcId)` / `getActiveTabContents()` accessor
  **alongside** the existing `getChromeContents()` — do not replace it. Chrome-renderer sends keep going
  to `getChromeContents()`; per-tab sends/targets resolve through the new accessor. Carry the Flight-2
  **`isDestroyed()` wrong-object guard lesson**: guard the *real send target*
  (`view.webContents.isDestroyed()`), never a wrapper that compiles clean while gating the wrong object.
- Rationale: Debrief Recommendation 1 — "extend the seam, don't replace it." The chrome contents and the
  guest contents are genuinely different sinks.
- Trade-off: Two accessors to keep straight; the grep-driven "no old reference survives" gate (the
  Flight-2 AC7 pattern, debrief "what went well") is reused to keep them from crossing.

**DD3 — Per-tab `webPreferences` reproduced BYTE-EXACT at construction (SC5 security-critical).**
- Choice: Move the `will-attach-webview` branch logic (`main.js:330–346`) to construction:
  - **Web tabs**: `contextIsolation:false`, `sandbox:false`, `nodeIntegration:false`, the
    `webview-preload.js` (farble main-world), `partition = jar.partition` (the exact persisted/burner
    string). **No `spellcheck` key** — construct web views at Electron's default (do NOT set
    `spellcheck:false`) so the session-layer `applySpellcheck` applier (`main.js:~794`, runs on
    `session-created`) keeps owning the live web toggle, exactly as today. (Architect catch: the
    attach-hook left web spellcheck at default *because it's immutable after attach*; at construction
    there is no "after attach", so an explicit `false` would wrongly disable it until the first toggle.)
  - **Internal tabs**: `contextIsolation:true`, `sandbox:true`, `nodeIntegration:false`,
    `spellcheck:false`, the internal preload, `partition = INTERNAL_PARTITION`.
- Rationale: Jar membership is decided by **session-object identity** (mission Constraint); the partition
  string must be byte-exact or the internal trust boundary or MCP jar-scoping silently breaks. This is
  the single most security-load-bearing change in the flight.
- Trade-off: None acceptable — drift here is a security regression. Guarded by `internal-session-exclusion`
  + `mcp-jar-scoping` run FIRST at the HAT.

**DD4 — Swap the guest-event predicate in Leg 1; delete the `<webview>` machinery in Leg 3 (split, per Architect HIGH).**
- Choice, split across two legs because the two halves have different prerequisites:
  - **The predicate swap lands in LEG 1, with the first tab view.** The `web-contents-created`
    `getType() === 'webview'` filter (`main.js:411`) gates **all** guest-event wiring (the
    `setWindowOpenHandler` popups-as-tabs, the `will-navigate` safety guards, `before-input-event`
    zoom/find/print/devtools, `devtools-opened/closed`, `context-menu` — `main.js:410–520`). A
    directly-constructed `WebContentsView`'s `webContents.getType()` returns **`'window'`** (Architect-
    confirmed, Electron 42), so under the old filter a tab view would get **none** of that wiring — a
    silent dropped-guest security/behavior regression (lost nav guard, lost popup interception). So the
    filter must become a **registry-membership predicate** (is this `webContents` in our tab-view
    registry?) **at the moment Leg 1 starts constructing tab views**, not deferred to the cleanup leg.
  - **The machinery deletion lands in LEG 3** (gated on Leg 2, when no tab is a `<webview>`): remove
    `webviewTag:true` (`main.js:297`) and the now-never-fired `will-attach-webview` hook
    (`main.js:330–346`).
- Rationale: Debrief Recommendation 2 (remove vestigial machinery) + Architect HIGH (the predicate is a
  *correctness* prerequisite for Leg 1's tab views to receive guest wiring at all, separable from the
  cosmetic machinery deletion).
- Trade-off: Registry-membership is the robust predicate, but note the **`getType()` collision**: the
  chrome view's webContents *also* returns `'window'` now, so nothing may key behavior on the type string
  — `classifyContents` (`resolve.js:48`) correctly keys 'chrome' vs 'guest' on `wc === chromeContents`
  identity, which survives; audit any other `getType()` reader during Leg 1.

**DD5 — Tab-view geometry: renderer measures the content slot and sends bounds to main. [RESOLVED — Architect-accepted, Phase 5b]**
- Choice (Architect-adjudicated, accepted): The chrome renderer measures the `#webviews` content slot
  (`index.html:118`, `flex:1` inside the `#main` flexbox, `styles.css:526–536`) via
  `getBoundingClientRect()` and sends bounds to main over IPC; main calls `tabView.setBounds(...)` for the
  active tab. The renderer stays the single source of layout truth (it owns toolbar/tabstrip heights AND
  the **#27 panel sibling-resize** — the panels are `flex:none` siblings whose `width` transition reflows
  `#webviews`, `styles.css:606–616`), so the panel-resizes-guest behavior (#27/SC7) is preserved
  essentially for free. Main-computes-from-fixed-insets was rejected: brittle, and **blind to panel state**.
  The operator's divert trigger ("Architect rejects renderer-measures-sends") did **not** fire.
- **Five apparatus requirements the Architect made load-bearing (must be honored in Leg 1):**
  1. **devicePixelRatio scaling (the critical one).** `getBoundingClientRect()` returns **CSS px**;
     `WebContentsView.setBounds()` takes **DIP** (the same space `getContentBounds()` uses at
     `main.js:357`). CSS px == DIP only at `devicePixelRatio === 1`. The renderer must pre-convert to DIP
     (or main divides by content scale) — **and Leg 1 must test at DPR≠1**, or it's a silent geometry bug
     on exactly the HiDPI displays most common in the field.
  2. **Synchronous initial-bounds seed.** Between `addChildView`/`setVisible(true)` and the first
     measurement IPC, the view has stale/zero bounds → first-frame flicker at wrong bounds. Seed a one-time
     full-content-area rect at construction (mirroring the chrome view's seed-from-constructed-size at
     `main.js:316–318`), or have the activate-IPC carry the bounds.
  3. **Set-bounds-before-reveal ordering on tab switch.** Sequence must be: **set the incoming view's
     bounds → `setVisible(true)` incoming → `setVisible(false)` outgoing** — geometry correct while still
     hidden, then reveal, then hide the old one. Otherwise the incoming tab paints one frame at stale
     bounds.
  4. **Debounce *strategy* is a decision, not a tuning knob.** The panel `transition` is `0.18s ease`
     (`styles.css:614`). Pick one: send on `requestAnimationFrame` during an active resize/transition so
     the guest tracks the animation, OR explicitly accept a snap-to-final-size-after-animate and put that
     in the HAT's expected results so it isn't logged as a defect. (Exact debounce ms stays tunable.)
  5. **In-`#webviews` overlay occlusion caveat.** A tab view is opaque over its bounds, so chrome overlays
     that sit *over* `#webviews` — the find-bar (`#find-bar`, `styles.css:551`, z-index:10), the page
     context menu, the site-info popup — will be **occluded** by the active tab view. The panels are safe
     (flex siblings, outside the measured rect). The occluded overlays are find/convenience surfaces DD6
     defers to Flight 4 anyway; note the occlusion as **expected until those surfaces re-home (F4)** or are
     repositioned outside the view bounds.
- Trade-off: An IPC round-trip on resize/panel-toggle, and the five requirements above are Leg-1 scope.

**DD6 — Re-home tab-strip-ESSENTIAL events to main→IPC→renderer; convenience callsites go INERT until Flight 4.**
- Choice: The events the tab strip needs to function — `did-navigate` / `did-navigate-in-page`,
  `page-title-updated`, `page-favicon-updated`, `did-start-loading` / `did-stop-loading`, and the
  load/security state — re-home from the renderer's `<webview>` DOM listeners (`renderer.js:977–1041`) to
  main-process guest `webContents` events forwarded to the chrome renderer over IPC (mirroring the
  existing `zoom-changed` / `devtools-state-changed` broadcasts).
- **Disposition of the ~49 renderer `tab.webview.*` callsites (Architect MEDIUM — these cannot just
  "stay"; their substrate is the deleted `<webview>` element):**
  - **Navigation/control verbs** the tab strip drives — `loadURL`/`reload`/`stop`/`goBack`/`goForward`/
    `canGoBack`/`canGoForward`/`getURL`/`focus` — re-point to IPC calls against the main-process tab view
    (these are tab-surface-essential; in Leg 1 scope).
    `classList.toggle('hidden')` (`renderer.js:811`) → main-side `setVisible` (DD1).
  - **Convenience callsites whose only substrate is the `<webview>` element** — `findInPage`/`stopFindInPage`
    (`renderer.js:~2080`), `webview.send('rescan-media')` (`renderer.js:~1239`), and the
    `ipc-message`/`found-in-page`/`did-fail-load` DOM listeners (`renderer.js:1044–1064`) — are
    **guarded-inert** in Leg 1 (the element they call no longer exists) and **re-homed in Flight 4** to
    `tabView.webContents` sends/events. **Features temporarily dark between F3 and F4: in-page find, the
    media-panel rescan (the signature media catalog stops live-updating on navigation), and the
    privacy-stream live counters.** This is the direct cost of the operator's "F3 = tab-strip essentials
    only" scope choice; it is bounded to one flight and restored in F4. *(See Flight Director Notes / the
    operator flag — if the media-panel-dark transient is unacceptable, the minimal send-target re-point
    for `rescan-media` + `found-in-page` can be pulled into F3 without the full F4 rewrite.)*
- Rationale: Operator-scoped F3/F4 boundary — F3 does the minimum for "the tab surface works"; F4 owns
  the event-seam rewrite the mission already budgets there.
- Trade-off: Three convenience features inert for one flight (named above), re-verified in F4.

**DD6a — Per-tab Shields first-party attribution survives unchanged (Architect LOW).**
- Choice/Note: `applyShields`/`tabFirstParty` key privacy aggregation and block decisions on
  `details.webContentsId` + session from the `webRequest` hook (`main.js:745,779,811,840`) — **not** on
  the `<webview>` element. Because DD3 preserves the per-jar session byte-exact, this attribution is
  unaffected by the substrate swap. No code change; called out so `core-browsing-shields` at the HAT
  explicitly re-confirms per-tab block attribution on the new surface.

**DD7 — `download-media` fallback targets the active tab's contents, not the chrome (lands in Leg 1).**
- Choice: The `download-media` fallback `wc || getChromeContents()` (`main.js:549`) becomes
  `wc || getActiveTabContents()` — when no explicit `webContentsId` is passed, downloads should ride the
  active guest's session, not the chrome's. **This lands in Leg 1** (Architect MEDIUM): it's a one-line
  change gated only on `getActiveTabContents` existing (DD2, Leg 1), and the moment web tabs become views
  the old `getChromeContents()` fallback is already the wrong (chrome-session) downloader — deferring it
  to Leg 3 would leave a latent wrong-jar download window across Legs 1–2.
- Rationale: Debrief Recommendation 2. With tabs as views the chrome contents is the wrong default
  downloader (wrong session/jar).
- Trade-off: None — corrects a latent jar-scoping subtlety the `<webview>` arrangement masked.

**DD8 — Popups-as-tabs, persistent sessions, navigation guards survive unchanged.**
- Choice: `setWindowOpenHandler` keeps denying native windows and sending `open-tab` (`main.js:414`); the
  `open-tab` path now constructs a view instead of a `<webview>`. Persistent-session partition strings
  (`persist:goldfinch`, `persist:container:*`, `burner:*`, `jars.js`) are unchanged. The `will-navigate`
  safety guards (`main.js:422–430`, internal vs. web allowlist) already live on the guest `webContents` —
  they survive as-is.
- Rationale: These already key off the guest `webContents`, not the `<webview>` element — the migration
  doesn't touch their logic, only what constructs the guest.
- Trade-off: None; re-verified by `core-browsing-shields` + `tab-scheme-guard`.

**DD9 — macOS unverified (standing mission DD5) — named, not silently re-deferred.**
- Choice: Directly-constructed per-tab views + per-tab partition land on the unverified mac path; code is
  correct by construction but mac frameless/view/partition behavior is **unverifiable this mission** (no
  in-loop venue). Recorded as unknown, build-readiness only.
- Rationale: Mission Constraint + Flight-1/2 debrief Key Learning 5 — the mac gap is accumulating across
  flights and must stay visible, resolved at Flight 6's landing gate, not papered over.
- Trade-off: Mac tab-surface parity carries the explicit caveat forward.

**DD10 — Farble main-world preload reproduced on directly-constructed views (spike-proven).**
- Choice: The `webview-preload.js` farble path (`main.js:322–324` rationale; preload at
  `webview-preload.js`) is set as the web tab view's `preload` with `contextIsolation:false` at
  construction, so the fingerprint hooks still wrap APIs in the page main world. Per-jar farble seed
  (`WeakMap<session>`, `main.js:1150–1163`) and the `shields-farble` sync IPC are unchanged (they key off
  the session, which the byte-exact partition preserves).
- Rationale: Mission open question, resolved by spike probes 6a/6b.
- Trade-off: None; guarded by `farbling-correctness`.

**DD11 — `captureWindow` re-homed to a window-level composite (guests become siblings).**
- Choice: `captureWindow` (`observe.js:212–214`, currently `chromeContents.capturePage()`) goes
  **guest-blind** the moment guests are sibling `WebContentsView`s rather than `<webview>`s nested in the
  chrome document (Flight-1 spike Leg 1 demonstrated per-view capture cannot see the overlap). Re-home it
  to a **window-level grab** (the spike's validated `desktopCapturer` window apparatus) OR a composite of
  chrome + active-guest captures, so it again attests the true composite. `captureScreenshot(wcId)`
  (per-guest, `observe.js:131`, foreground-then-`capturePage`) is unaffected — it captures a specific
  guest's own contents. The guest-vs-chrome classification both paths use (`classifyContents`,
  `resolve.js:48`, keyed on `wc === chromeContents` identity) is **unaffected** — tab views are
  `!== chromeContents` so they classify 'guest' correctly, which is exactly why `captureScreenshot(wcId)`
  survives and only the whole-window composite needs the re-home.
- Rationale: This is an SC6 regression the migration *introduces*; it must be fixed in the same flight
  that causes it (the Flight-2 pattern: fix the defect you create). Broad MCP parity stays Flight 5; this
  is the forced subset.
- Trade-off: A capture-path change verified by **reading the captured PNG** at the HAT (agent-reads-PNG
  loop), not a live-eyeball-only check — same divert-trigger discipline as Flight 2's carried unknown.

### Prerequisites
- [ ] Flight-3 branch created off `mission/05-webcontentsview-migration` (the long-running mission branch).
- [ ] Flight 2 merged into the mission branch (done — `BaseWindow` + chrome `WebContentsView` shell in
  place; `getChromeContents()` accessor live).
- [ ] App runs under Linux/WSLg with a live display (the in-loop venue).
- [ ] Automation apparatus available: `npm run dev:automation` + the loopback admin MCP client (for the
  security-identity + `mcp-drive-end-to-end` HAT specs) and `desktopCapturer` window-grab (for the
  `captureWindow` PNG read).
- [ ] Spike-proven inputs confirmed available (one-per-tab + `setVisible`; farble on directly-constructed
  views; geometry sibling-resize) — Flight-1 debrief Recommendation 1.

### Pre-Flight Checklist
- [x] All open questions resolved (geometry DD5 adjudicated and accepted by the Phase-5b Architect with
  five load-bearing apparatus requirements folded into DD5/Leg 1).
- [x] Design decisions documented (DD0–DD11, incl. DD6a; Architect "approve with changes" incorporated —
  the predicate-swap re-scope to Leg 1, the convenience-callsite disposition, DD7→Leg 1, the spellcheck
  byte-exactness, and the five geometry requirements).
- [ ] Prerequisites verified (flight branch creation is the first execution step)
- [x] Validation approach defined (security-identity specs first → farble/shields → browsing/MCP corpus +
  guided visual HAT + `captureWindow` PNG read + a11y)
- [x] Legs defined

---

## In-Flight

### Technical Approach

Executed via `/agentic-workflow` (mechanical re-pointing with a wide, security-critical surface), with a
final guided HAT leg. **Leg 1** is the atomic core — web tabs become sibling views (registry + accessor +
byte-exact web `webPreferences` at construction + geometry + `setVisible` + the open/create/activate/close
re-wiring + tab-strip-essential event re-homing + the `captureWindow` composite fix) — and the app must
run with web tabs browsing as views at its end (no non-runnable intermediate). **Leg 2** migrates internal
`goldfinch://` tabs to views with the trust model intact (the security-critical half of DD0/DD3).
**Leg 3** removes the now-vestigial `<webview>` machinery (`webviewTag`, `will-attach-webview`, the
`getType()` filter → registry predicate) and re-points the `download-media` fallback — order-dependent:
it can only run once no tab is a `<webview>`. **Leg 4** is the interactive HAT. The real risk is **not**
render (the spike de-risked the view model) but the **byte-exact partition identity** (silent trust-boundary
or jar-scoping breakage) and the **wide guest-event re-bind** (a dropped guest in the `web-contents-created`
predicate change) — gated by the security-identity specs running first and the grep-driven "no `<webview>`
reference survives" check, not by "tabs render."

### Checkpoints
- [ ] Web tabs open / browse / switch / close as per-tab `WebContentsView`s; the tab strip reflects
  navigation/title/favicon/load (essential events re-homed); geometry correct at **DPR≠1** and across a
  panel toggle; `typecheck`/`lint` green; **the guest-event wiring is proven to FIRE on a tab view** —
  popup-opens-as-tab, blocked-unsafe-nav, DevTools-toggle, context-menu smoke (not just "one MCP op")
- [ ] `captureWindow` composites the active guest once guests are sibling views — **confirmed by reading
  the captured PNG**, not the live screen (DD11 divert trigger)
- [ ] Internal `goldfinch://settings` + `goldfinch://downloads` load as views with the trust model intact
  (internal session, four gates, origin-checked bridge) — no internal `<webview>` path remains
- [ ] `webviewTag:true` + `will-attach-webview` removed; grep shows **zero** `<webview>`/`webviewTag`
  references in the tab path; the `web-contents-created` predicate identifies tab views by registry
  membership; `download-media` falls back to the active tab's contents
- [ ] HAT: `internal-session-exclusion` + `mcp-jar-scoping` PASS **first**, then `farbling-correctness`,
  `core-browsing-shields`, `mcp-drive-end-to-end`, and the Flight-2-deferred corpus
  (`responsive-tab-strip` full, `tab-keyboard-operability`, `settings-shell`); visual HAT confirms tab
  switch shows the right view at the right bounds and the panel resize moves the guest; `npm run a11y` green

### Adaptation Criteria

**Divert if**:
- **A per-tab partition's session-object identity drifts** — `internal-session-exclusion` or
  `mcp-jar-scoping` fails on the new surface → SC5 security regression; **stop** (this is the mission's
  byte-exact constraint, not a tune-up).
- **The farble main-world preload does not run** on a directly-constructed web tab view (contradicting
  spike 6a/6b) → SC5 regression; stop and reassess the construction-time preload path.
- **`captureWindow` returns chrome-without-guest** after the re-home (DD11) and neither the window-grab
  nor the composite restores it → SC6 regression; stop and decide. Judged on the captured PNG.
- **DD5 geometry ships visible gap/flicker** that the five apparatus requirements were meant to prevent —
  wrong-size view at DPR≠1, first-frame-at-stale-bounds on tab switch, or the guest failing to track the
  #27 panel toggle → fix within renderer-measures-sends (the approach is Architect-accepted; this is an
  apparatus bug, not an approach divert).
- Internal-page migration destabilizes the trust model in a way that can't be made byte-exact this flight
  → options-review (fall back to DD0 web-only + defer internal to Flight 5).

**Acceptable variations**:
- Accessor/registry naming and key choice (`wcId` vs. tabId); exact debounce on the geometry IPC.
- `captureWindow` implemented as window-grab vs. chrome+guest composite — either satisfies DD11.
- mac branch shipped unverified (DD9) — expected, not a divert.
- Minor renderer tweaks where the chrome layout needs them to drive view geometry (kept minimal).

### Legs

> **Note:** Tentative; planned one at a time via `/agentic-workflow`. Leg 1 is the large atomic core (the
> app must run with web tabs browsing as views at its end). Legs are order-dependent: Leg 3 (machinery
> removal) can only run after Leg 2 (internal tabs migrated), because the machinery can't be removed while
> any tab is still a `<webview>`. Leg 4 is the interactive HAT.

- [ ] `web-tabs-as-views` — **Atomic core; app must run (web tabs browse as views) at the end.** Introduce
  the tab-view registry + `getTabContents`/`getActiveTabContents` accessor (DD2); construct web tab views
  with byte-exact web `webPreferences` at construction (DD3-web, DD10 farble); **swap the
  `web-contents-created` `getType()==='webview'` filter to the registry-membership predicate** so the new
  tab views actually receive the guest-event wiring (DD4 Leg-1 half — popups, `will-navigate` guards,
  zoom/find/devtools/context-menu); drive geometry with all five DD5 requirements (DPR→DIP, initial seed,
  set-bounds-before-reveal, debounce strategy, overlay-occlusion) + `setVisible` show/hide (DD1); re-point
  the renderer navigation/control verbs (`loadURL`/`reload`/`stop`/`goBack`/`goForward`/`getURL`/`focus`,
  the open-tab / createTab / activateTab / close paths) off `<webview>` onto views (DD8) and
  **guard-inert the find/media-rescan/privacy-stream callsites** (DD6); re-home the tab-strip-essential
  events (DD6); re-point `download-media` to `getActiveTabContents()` (DD7); fix `captureWindow` (DD11).
  Internal tabs still `<webview>` at this point (`webviewTag` stays on; `will-attach-webview` still fires
  for them). **Gate: web tabs open/browse/switch/close as views; strip reflects nav/title/favicon;
  geometry correct at DPR≠1 and across a panel toggle; `captureWindow` composites the guest (PNG read);
  and the guest wiring is proven to FIRE on a tab view — a popup-opens-as-tab + a blocked-unsafe-nav + a
  DevTools-toggle + a context-menu smoke, not just "one MCP op" (Architect); `typecheck`/`lint` green.**
  (SC1-part, SC3, SC5-part, SC6.)
- [ ] `internal-tabs-as-views` — Construct internal `goldfinch://` tab views with byte-exact internal
  `webPreferences` (DD3-internal: `contextIsolation:true`/`sandbox:true`/`spellcheck:false`,
  internal preload, `INTERNAL_PARTITION`); verify the internal session (`__goldfinchInternal` marker),
  session-scoped `protocol.handle`, the four gates, and the origin-checked bridge hold on the view.
  **Gate: `goldfinch://settings` + `downloads` load as views with the trust model intact; no internal
  `<webview>` path remains.** (SC1-part, SC5-internal.)
- [ ] `remove-webview-machinery` — With no tab a `<webview>`: remove `webviewTag:true` (`main.js:297`) +
  the now-never-fired `will-attach-webview` hook (`main.js:330–346`, DD4 Leg-3 half). **Gate: grep shows
  zero `<webview>`/`webviewTag` in the tab path; app runs; tabs browse; engine + the (re-bound) guest
  wiring still live.** (SC1 source-absence; cleanup.) *(The guest-event predicate swap and the
  `download-media` re-point already landed in Leg 1 — this leg is purely the machinery deletion.)*
- [ ] `verify-tab-surface-hat` *(guided HAT / alignment)* — Run `internal-session-exclusion` +
  `mcp-jar-scoping` **first** (byte-exact partition guard, SC5), then `farbling-correctness`,
  `core-browsing-shields`, `mcp-drive-end-to-end`, and the Flight-2-deferred corpus (`responsive-tab-strip`
  full, `tab-keyboard-operability`, `settings-shell`); visual HAT for tab switch / view bounds / the #27
  panel-resizes-guest; `captureWindow` PNG read; `npm run a11y`. Fix issues live. (SC3/SC5 verification.)

---

## Post-Flight

### Completion Checklist
- [ ] All legs completed (1 `web-tabs-as-views`, 2 `internal-tabs-as-views`, 3 `remove-webview-machinery`,
  4 `verify-tab-surface-hat`)
- [ ] Every tab (web + internal) renders as a per-tab `WebContentsView`; no `<webview>`/`webviewTag`
  remains (grep clean)
- [ ] Per-tab partition identity byte-exact; `internal-session-exclusion` + `mcp-jar-scoping` PASS;
  farbling preserved
- [ ] `captureWindow` composites the guest on the sibling-view surface (PNG-verified); one+ MCP op live
- [ ] Tab-strip-essential events re-homed; browsing/tab corpus + a11y green; mac shipped unverified (DD9)
- [ ] No production code merged to `main` (work on `flight/03-tab-surface`, branched off the mission branch)
- [ ] Flight branch merged to the mission branch; mission `flights` checklist updated
- [ ] Tests passing (`npm test`, `npm run typecheck`, `npm run lint`)

### Verification

Verified on Linux/WSLg by the security-identity behavior tests **first** (`internal-session-exclusion`,
`mcp-jar-scoping` — the byte-exact partition guard), then `farbling-correctness` /
`core-browsing-shields` / `mcp-drive-end-to-end` and the browsing/tab corpus, plus a guided **visual HAT**
(tab switch shows the right view at the right bounds; the #27 panel resize moves the guest — pixels, per
the mission's render-correctness rule) and the `captureWindow` PNG read (DD11). macOS tab-surface parity is
**unverified** this mission (DD9) — build-readiness only. No new behavior-test spec is authored: the
existing corpus is the mission's acceptance net (operator decision).
