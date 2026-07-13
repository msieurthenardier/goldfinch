# Flight Log: HAT & Alignment — Per-Jar History

**Flight**: [HAT & Alignment](flight.md)

## Summary

*(session not started — awaiting the operator)*

---

## Leg Progress

### HAT re-verification (closing leg — completed 2026-07-13)

**Disposition**: R1 + H1–H7 all confirmed resolved live (Re-Steps 1–7);
the `jar-data-controls` behavior test re-ran 7/7 PASS (Re-Step 8). Two
re-verification findings dispositioned as follow-ups (NOT this flight):
H8 (internal-page keyboard focus — pre-existing, operator-ruled follow-up)
and H9 (paging scroll anchor — banked fix). Leg `completed`; flight
`landed`; mission ready for `/mission-debrief`.

- **Re-Step 1 (R1 address select-all): PASS** — first click selects the
  whole URL, second click places cursor, Ctrl+L selects, internal-tab
  read-only bar unaffected.
- **Re-Step 2 (H4 tabs restyle): PASS** — per-jar tab strip
  (History · Cookies · Other site data), History default + count badge,
  one panel at a time, tighter/professional look, arrow-key tab nav,
  Burner has no tabs.
- **Re-Step 3 (H1/H5 paging): FUNCTIONAL PASS, two findings** —
  - **H8 (BUG — keyboard, needs diagnosis)**: operator reports keyboard
    controls "not working within the jars page at all" on step 3. NOT the
    modal (its keydown is scoped to the hidden-when-closed backdrop —
    verified). Tension with re-Step 2's arrow-key tab-nav pass (likely a
    visual pass, keyboard untested there). Disambiguation pending: does
    Tab move the focus ring at all (→ no-focus, serious) vs. only specific
    widgets lack key handlers (→ narrower). **DIAGNOSED**: first Tab jumps
    to the chrome address bar then cycles the ~8 chrome toolbar stops —
    OS keyboard focus is on the CHROME view, never the jars-page guest
    view. Root cause: `tab-set-active` (main.js:2215) raises the active
    guest view (`addChildView`) so mouse input works but NEVER calls
    `webContents.focus()` on the guest, so the chrome keeps OS focus and
    Tab traverses it. **PRE-EXISTING** (no F6 leg touched tab-set-active
    or guest focus; internal-page keyboard traversal was never
    test-covered). Cross-cutting fix (risks the find-overlay / menu-sheet
    / tab-strip focus interplay — main.js:2241 already guards against
    focus-stealing). **Operator ruling: FILE AS FOLLOW-UP** (mission
    Known Issue + BACKLOG seed for a dedicated internal-page-keyboard-
    focus flight with its own design + behavior test) — NOT fixed in this
    history HAT.
- **Re-Step 4 (H2 row links): PASS** — history rows are links; left AND
  middle click open the page in a NEW tab in the SAME jar; jars page stays
  open.
- **Re-Step 5 (H3 trashcan): PASS** — per-row delete is a trashcan icon
  with danger hover; deletes the entry, count drops.
- **Re-Step 6 (H7 confirm modal): PASS** — destructive actions open an
  unmissable centered modal + dimmed backdrop; Cancel/Escape/backdrop
  dismiss; Confirm runs; focus lands on Cancel, Tab cycles Confirm↔Cancel.
- **Re-Step 7 (H6 wipe closes tabs): PARTIAL — operator correction.**
  History IS wiped and STAYS cleared (the reload→re-record root cause is
  fixed — good) BUT the jar's open tab(s) did NOT close as intended.
  onJarWiped's close sweep (renderer.js:172) looks correct on read
  (filters `container.id===p.id && isWebTab && wcId!=null`, closes) — so
  this is either a real bug or a test-setup nuance (the open tab may not
  have been in the wiped jar). Being verified authoritatively by the
  `jar-data-controls` behavior test (its Step 5 = wipe-closes-tab, rewritten
  in Leg 05); fix inline if the test's Validator fails Step 5.
  **RESOLVED — NOT A BUG.** Direct automation reproduction (clean instance,
  port 49721): created jar `h6-probe`, opened a web tab in it (enumerate:
  wc3/h6-probe active) + a `work` tab, wiped `h6-probe` → enumerate showed
  ONLY the `work` tab; the h6-probe tab (wc3) was CLOSED, focus fell to
  `work`. onJarWiped close-sweep works correctly. The operator's manual
  observation was a test-setup nuance — the wiped jar's tab was likely the
  ONLY web tab, so closeTab closed it AND spawned a fresh blank tab
  (can't have zero tabs), reading as "a tab is still there." Re-Step 7 →
  PASS.
  - **H9 (fix — paging scroll anchor)**: paging from a full 50-row page to
    a shorter page leaves the scroll position far down (short page doesn't
    refill the viewport). On page change, anchor the jar's tabs/section
    top back into view (scrollIntoView the section or History panel top).
    **Banked as a follow-up** (not implemented this flight) — a small,
    low-risk renderer fix for a future maintenance/UX pass.
- **Re-Step 8 (`jar-data-controls` behavior test): 7/7 PASS** — live
  two-agent Witnessed run (Sonnet Executor + Validator), fresh scratch
  profile on port 49731, run log
  `tests/behavior/jar-data-controls/runs/2026-07-13-15-09-25.md`. The
  rewritten Step 5 (H6 close-not-reload) is now CONFIRMED against the real
  environment: `jarsWipe({id:'personal'})` closed BOTH personal-jar tabs
  (staged wcId 4 + boot wcId 2), post-wipe enumeration retained only the
  work tab, and the stale eval against wcId 4 errored `no-such-contents`
  (WebContents destroyed, not reloaded). The Validator independently
  re-observed the closure. F4 clear/wipe/reject/isolation semantics
  (Steps 1–4, 6–7) re-confirmed unregressed. Spec carry-forward applied
  this run: Step 5's parenthetical, which wrongly implied the personal
  boot tab survives, corrected to state the wipe closes ALL the jar's tabs
  (work tab is the sole survivor). Two further spec carry-forwards banked
  (burner-vs-unknown error granularity; explicit fixture URL).

### HAT walkthrough (live)

- **Step 1 (recording sanity across jars): PASS** — counts per jar
  reflect own browsing. Observations banked for the findings leg:
  - **H1 (feature)**: real paging for the history list — numbered paging
    bar at the bottom (`< 1, 2, 3, … >`) instead of Show more.
  - **H2 (feature)**: history rows should be actual links navigating to
    the site (open-target decision needed: same-jar tab).
  - **H3 (fix)**: per-row delete `×` → trashcan icon, to read as
    "delete this history entry".
  Operator direction: batch findings into one leg after the walkthrough
  (not inline).
- **Step 2 (burner leaves no trace): PASS** — no count movement, no
  suggestion leakage from burner browsing.
- **Step 3 (panel look & feel): FUNCTIONAL PASS, restyle requested** —
  - **H4 (restyle, design-review required)**: the disclosure dropdowns
    read cartoonish/unprofessional. Replace with per-jar TABS
    (History | Cookies | Other site data) — professional, tight
    appearance. FD working interpretation: horizontal tab strip per jar
    section, History default-selected, count as a badge on the History
    tab; one visible region per jar (supersedes the F2
    independently-collapsible ruling — operator authority, recorded).
    Structural touchpoints to review at leg design: CONFIRM_REGIONS
    machinery, lazy fetch on expand→on tab-select, hash deep-links,
    count wiring.
- **Step 4 (history panel content): PASS with one fix** —
  - **H5 (fix)**: status line says "Showing X of many" even when X < the
    50-row page limit (i.e. the COMPLETE set) — "of many" must only
    render when a full page returned; otherwise show the plain count.
    Likely subsumed by H1's paging bar; tracked so it can't slip.
  Rows/search/delete/clear-confirm otherwise good.
- **Step 5 (retention control): PASS** — copy clear, presets adequate,
  instant-apply trusted. (Operator note: no live way to observe pruning —
  correct; the cutoff behavior is unit-pinned and prune-on-change is
  IPC-tested; observing it live needs time travel.)
- **Step 6 (data-controls integration): two findings** —
  - **H6 (BUG, design-review required)**: "Clear identity did not clear
    the history (in the UI)." Diagnosed by code reading (not live repro):
    the store purge + `history-changed` broadcast are CORRECT (F3 probe 6
    DB-verified the purge; the jars-page `onHistoryChanged` handler
    refreshes count + panel). ROOT CAUSE: `handleWipe` broadcasts
    `jar-wiped`, and the renderer's `onJarWiped` handler (renderer.js:158)
    reloads every open web tab in the wiped jar (F4/DD4 — so the
    logged-out state is visible); reloads re-fire `did-navigate`, which
    the recorder counts as visits → the wiped jar's history is purged then
    IMMEDIATELY re-populated with the current page(s) of its open tabs.
    Operator perceives "not cleared." This is a real interaction bug
    between DD4 (reload-on-wipe) and the recorder (reloads = visits) —
    violates the mission's "wiping removes the jar's history" for any jar
    with open tabs. Fix options for the leg (design-review): suppress
    recording for wipe-triggered reloads (recorder needs a wipe-reload
    signal); or reconsider the reload sweep; or accept + copy. F3 probe 6
    actually FORESAW this ("the 1 residual row is a legitimate
    reload-triggered new visit") but classified it non-defect — HAT
    reclassifies it a real UX bug.
  - **H7 (UX change, design-review)**: clear-history / clear-identity
    confirmation is an easily-overlooked INLINE two-step; should be a
    modal the user cannot miss. Spans the jars-page confirm machinery
    (all data-class + wipe + delete confirms share it) — multi-surface,
    review-gated.

### Leg 02: `address-select-all` (R1) — landed

- Implemented the leg's single-surface change exactly: one `mousedown`
  listener added to `els.address` in `src/renderer/renderer.js`, placed
  ahead of the existing `input`/`blur`/`keydown` omnibox-suggestions
  listener block. Returns early on `readOnly` (internal `goldfinch://`
  tabs) and on `document.activeElement === els.address` (already
  focused — normal cursor placement on the second click); otherwise
  `preventDefault()`s the default cursor placement and calls
  `focus()` + `select()`. The existing `focus-address` (Ctrl+L) handler
  and the `input`/`blur`/`keydown` suggestions listeners were not
  touched.
- Gates: `npm test` (1494/1494 pass), `npm run typecheck` (clean),
  `npm run lint` (clean).
- No unit suite covers this DOM behavior by design (per the leg) —
  live verification of the click-to-select behavior is deferred to the
  `hat-reverification` closing leg.
- Leg status → `landed`. Not committed (flight-level review + commit
  deferred to after the last autonomous leg per the sequencing note
  above).

### Leg 03: `jars-page-tabs` (H4) — landed

- Converted each persistent jar's three F2 collapsible disclosure panels
  (History/Cookies/Other site data) to a WAI-ARIA tab strip in
  `src/renderer/pages/jars.js`: `role="tablist"`/`"tab"`/`"tabpanel"`,
  History default-selected (`aria-selected`, roving `tabindex`), panel
  ids unchanged (`jar-<id>--<panel>`, double-hyphen scheme preserved).
  The History visit count moved from the old disclosure-button label to
  a `<span class="jar-tab-count">` badge on the History tab, still fed
  by the SAME two `fetchHistoryCount` writers (build +
  `onHistoryChanged`) — `render()`/`updateJarSection` still never write
  it.
- `SectionRefs.panelOpen` (Map) → `activeTab` (single panel id, default
  `'history'`) + `SectionRefs.tabRefs` (Map of `{ tab, panel,
  countSpan? }`). ONE shared `selectTab(refs, panelId)` is the sole
  switch path — used by tab click, the local roving-tabindex keydown
  handler (ArrowLeft/Right + Home/End; `menu-controller.js` deliberately
  NOT reused per design review), and the hash deep-link
  (`tryExpandFromHash`, repointed from `expandPanel`). It carries the
  `closeTransient()`-on-switch-away-from-open-confirm guard and the
  never-strand-focus-on-`<body>` rule (focus moves to the newly-selected
  tab when the outgoing tabpanel held focus, or when focus was already
  on `<body>` — e.g. an initial-boot hash switch).
- Lazy history fetch: `historyPanel.onExpanded()` now fires on
  scroll-into-view (extended the existing scroll-spy
  `IntersectionObserver` in `observeSectionsIfChanged` rather than
  adding a second observer) instead of at build time, AND on a direct
  switch onto the History tab — both triggers share `onExpanded`'s
  existing idempotent guard, so no `jars-history-panel.js` change was
  needed.
- **Growth checkpoint fired**: landing the tab widget inline brought
  jars.js to 1,827 lines — at/over the ~1,800 DD2 trigger — so the
  pre-agreed fallback ran: the tablist build, roving keydown handler,
  and `selectTab` were extracted to a new sibling module,
  `src/renderer/pages/jars-tabs.js` (216 lines), following the
  `jars-history-panel.js` three-point-onboarding precedent exactly —
  a new `<script src="jars-tabs.js" type="module">` tag in
  `jars.html`, a new `/jars-tabs.js` entry in `INTERNAL_PAGES.jars`
  (`src/main/main.js`), and the `jars-page-shared-scripts.test.js`
  contract test needed NO edit (it self-derives from `jars.html`).
  jars.js also needed a new `sourceType: 'module'` entry in
  `eslint.config.mjs`'s ESM-pages block (alongside `jars.js` /
  `jars-history-panel.js`). **Final jars.js: 1,708 lines** (net
  reduction vs. the pre-leg 1,727-line disclosure-panel baseline, once
  the extraction is counted).
- CSS: replaced the F2 disclosure block (`jars.css:396-463` —
  `.jar-panel`/`.jar-panel-heading`/`.jar-panel-toggle`/chevron/
  `.jar-panel-count`/`.jar-panel-region`) with a flat underline tab
  strip (`.jar-tabs`/`.jar-tablist`/`.jar-tab`/`.jar-tab-count`/
  `.jar-tabpanel`) — no transition properties anywhere, so tab
  switching is instant by construction (satisfies the reduced-motion
  requirement with nothing to disable).
- Both grep-ACs confirmed clean: JS
  `grep -n "aria-expanded\|jar-panel-heading\|panelOpen"
  src/renderer/pages/jars.js` → only the create-panel's own
  (exempt) `aria-expanded` hit; CSS
  `grep -n "jar-panel-toggle\|jar-panel-heading"
  src/renderer/pages/jars.css` → 0 hits.
- Gates: `npm test` (1494/1494 pass), `npm run typecheck` (clean),
  `npm run lint` (clean, after the eslint config addition above), the
  `jars-page-shared-scripts.test.js` contract test green.
- No unit suite covers this DOM behavior by design (per the leg,
  internal-page DOM is not eval-observable) — live tab-feel
  verification deferred to the `hat-reverification` closing leg.
- Leg status → `landed`. Not committed (flight-level review + commit
  deferred to after the last autonomous leg per the sequencing note
  above). `WIPE_COPY` untouched (Leg 4 owns it), Burner no-tabs branch
  untouched, footer stayed outside the tab widget.

### Leg 04: `history-panel-content` (H1/H2/H3, H5 closed) — landed

- **H1 (numbered paging)**: added `history-store.js`'s `listByPage(jarId,
  { page, pageSize })` — a new `listByOffset` prepared statement (distinct
  ?1/?2/?3 placeholders, the listRecentWithCursor gotcha), `page` clamped to
  a floored minimum of 1, `pageSize` clamped the same way `listRecent`'s
  `limit` is; an out-of-range page returns `[]` (OFFSET past the row count),
  no special-casing. Unit-pinned: page boundaries incl. a partial last page,
  out-of-range → empty, page-1 order identical to `listRecent`'s first page,
  clamp behavior for non-positive/fractional/non-finite `page` and for
  `pageSize`. `history-ipc.js` gained the `history-page`/`internal-
  history-page` twin (`{ jarId, page, pageSize? }` → `{ ok, visits, total }`,
  `total` = `countByJar`) and the `history-list`/`internal-history-list`
  twin was REMOVED outright — net twin count stayed at 6. `page`/`pageSize`
  are validated as POSITIVE INTEGERS (`isPositiveInteger`, not the looser
  `isFiniteNumber` used elsewhere) so `page: 0`/negative/fractional is
  `bad-args`. The closed-set registration test and every `history-list`-
  keyed test in `history-ipc.test.js` were rewritten onto `history-page`.
  `jars-history-panel.js`'s cursor/append "Show more" model was REWORKED
  (not patched) into a numbered pager bar (prev/next chevrons + windowed
  page numbers with ellipsis, `computePageNumbers`) — a page click fetches
  `history-page` under the existing `viewGen` stale-response token guard,
  and self-corrects if the current page overshoots a freshly-shrunk total
  (e.g. a delete emptying the last page). The old "Showing X of many" status
  line is gone (H5 closed) — the pager IS the count affordance for the
  recent view; the search view (still single-shot, unpaged) shows a plain
  "Showing first 50" note only when a full page returns, never "of many".
- **H2 (rows as links, new tab in the SAME jar)**: added a DIRECTLY-
  registered `internal-open-tab-in-jar` handler in `main.js` (beside the
  file's other bare `registerInternalHandler` calls, right after
  `registerHistoryIpc` — NOT threaded through `jar-ipc.js`/`history-ipc.js`
  as a new dep, since it needs `main.js`'s module-scoped `getChromeContents`
  closure and the already-required `isSafeTabUrl`). Validates the jar exists
  (`jars.list().find`) and re-validates `isSafeTabUrl(url)` main-side
  (defense-in-depth — the downstream `createTab` untrusted branch checks it
  again), then reuses the EXACT SAME `open-tab` → chrome's `onOpenTab` →
  `inheritFromPartition` path popups/context-menu opens use, so a jar's own
  `partition` resolves to that jar's own container for free — "new tab, same
  jar" with no bespoke routing. Each row's primary line is now a real
  `<a href>` (neutral styling — no UA link-blue/visited-purple, underline
  only on hover/focus); BOTH `click` AND `auxclick` are intercepted
  (middle-click fires `auxclick`, never `click` — left uncaught it would
  fall through to the jars-page's own `setWindowOpenHandler` and leak into
  the INTERNAL partition, a jar-isolation surprise) and both
  `preventDefault()` + call the new `bridge.openTabInJar({ jarId, url })`
  wrapper (`internal-preload.js` + `renderer-globals.d.ts`).
- **H3 (trashcan delete icon)**: `buildIcon()`/`ICON_DELETE` (Lucide
  trash-2) were DUPLICATED from `jars.js` into `jars-history-panel.js`
  (~50 lines incl. doc comments) with a cross-reference comment — jars.js
  doesn't export them and this module must not reach into jars.js
  internals. The delete button keeps its `.jar-history-row-delete` danger
  hooks and `aria-label` ("Delete visit: <title>"); behavior unchanged
  (`historyDelete`, repaint only on the `history-changed` broadcast, no
  optimistic removal).
- Preserved invariants: the `viewGen` stale-response token guard (now also
  guards the H1 self-correction re-fetch), the retention `<select>`/search
  `<input>` built-once-never-recreated focus/caret preservation, and the
  render-never-writes-count rule (this module never touches jars.js's
  `.jar-tab-count` badge). Leg 03's tab shell (jars-tabs.js, `selectTab`,
  the lazy `onExpanded` scroll-into-view trigger) was not touched.
  `jars.css` gained pager/anchor/trashcan-centering rules and the old
  `.jar-history-show-more` rule was replaced (not just deprecated).
- Gates: `npm test` (1502/1502 pass, incl. 6 new `listByPage` unit-pin tests
  and the rewritten `history-page` IPC suite), `npm run typecheck` (clean),
  `npm run lint` (clean). Grep-AC: no `${` in `history-ipc.js` (confirmed
  clean — the two new/changed error strings stay static literals). Script-
  tag contract test (`jars-page-shared-scripts.test.js`) green — no new
  script tag was needed (`jars-history-panel.js` was already registered in
  `jars.html`/`INTERNAL_PAGES.jars` since Leg 3).
- Line counts: `jars-history-panel.js` grew from 320 to **511 lines** (the
  leg's REWORK, not an additive patch — H1's pager replaces the cursor/
  append model, plus the H3 icon duplication). **jars.js stayed untouched
  at 1,708 lines** — the History-panel work landed entirely in
  `jars-history-panel.js`, `history-store.js`, `history-ipc.js`, and
  `main.js`; jars.js is not pushed toward the ~1,800 DD2 growth-checkpoint
  trigger.
- No unit suite covers this module's DOM behavior by design (house practice
  for page controllers, per the module's own doc comment) — live click-feel
  verification (numbered pager clicks, left/ctrl/middle-click open-in-jar,
  trashcan hover) deferred to the `hat-reverification` closing leg.
- Leg status → `landed`. Not committed (flight-level review + commit
  deferred to after the last autonomous leg per the sequencing note above).

### Leg 05: `confirm-modal-and-wipe` (H6/H7) — landed

- **H7 (page-level confirm modal)**: retired the per-region inline confirms
  (`CONFIRM_REGIONS`, `regionForAction`, `confirmAreas`, `confirmOpenKeys`,
  and `updateConfirmAreas`) in favor of ONE `role="dialog" aria-modal="true"`
  modal, transplanting the menu-overlay sheet's new-container dialog
  (`menu-overlay.js:296-431`) — a 2-element `[confirm, cancel]` Tab-cycle
  instead of its 3-element one. `buildDataConfirm` (renamed `buildContent`
  in the extracted module) is otherwise unchanged — same `run` bodies,
  in-flight disable, stale-`ui` guard, `silentSuccess` (delete), per-action
  copy — plus a returned `cancelBtn`, Cancel now also disables in-flight,
  and default focus goes to Cancel (destructive-safe) instead of Confirm. A
  per-action TITLE table (`CONFIRM_TITLE`, jars.js) feeds `aria-labelledby`;
  the copy paragraph's fixed id feeds `aria-describedby`. In-flight
  Escape/backdrop suppression is a dialog-local `keydown`+`stopPropagation`
  shadow (FD pick from design review, mirroring the name-input Escape
  precedent) rather than threading an `inFlight` flag through `ui`. Focus
  restores to the captured trigger on close, falling back to `#jars-new`
  when the trigger is gone (`delete`'s `silentSuccess` removes the row/
  trigger before the modal's close-detection runs — design review).
  `jars-tabs.js` — the design-review-caught HIGH scope gap — had its
  `selectTab` confirm-close-on-switch branch removed (dead by construction:
  the modal's focus trap blocks tab-strip interaction while open) along
  with the `getUi`/`closeTransient`/`regionForAction` params `createJarTabs`
  used to take.
- **H6 (wipe closes tabs, not reload)**: `onJarWiped` (renderer.js)
  SUPERSEDES the F4 DD4 reload sweep — reloading was re-recording a fresh
  visit in the just-cleared history, the root cause. Reuses the DD6
  ordered-sweep shape (`refreshOpenTabJars`, renderer.js:174-195) for the
  identical multi-close-with-active pattern: snapshot first (`closeTab`
  mutates `tabs`), activate a surviving non-matching tab FIRST when the
  active tab is among the matches (so `closeTab`'s own active-tab fallback
  never fires mid-sweep, avoiding the tabSetActive flicker), then close
  every match, the originally-active one last. `WIPE_COPY` (jars.js) now
  warns tabs will CLOSE (was "reload"). `handleWipe` (jar-ipc.js) untouched
  per spec — closing is purely the renderer's reaction to the unchanged
  `jar-wiped` broadcast.
- **Growth-fallback extraction triggered**: landing the modal inline pushed
  jars.js to 1,817 lines (≥ the ~1,800 DD2 trigger), so per the
  pre-agreed fallback it moved to a new sibling module,
  `src/renderer/pages/jars-confirm-modal.js` (316 lines) — the
  `jars-tabs.js`/`jars-history-panel.js` three-point-onboarding precedent
  (`jars.html` module `<script>` tag, `INTERNAL_PAGES.jars` entry in
  `main.js`, and the `src/renderer/**` ES-module block in
  `eslint.config.mjs`; the script-tag contract test self-derives from
  `jars.html`, no edit needed). **jars.js settled at 1,587 lines** (down
  from 1,708 pre-leg — retiring the per-region machinery net-reduced it
  even after accounting for the modal's own wiring, which now lives in the
  extracted module instead).
- **`tests/behavior/jar-data-controls.md` rewritten** (the design-review
  HIGH scope gap): Step 5's expected result and the Intent sentence now
  assert CLOSE-not-reload — the personal tab's pre-wipe `wcId` disappears
  from `enumerateTabs` rather than surviving in place with a cleared
  in-memory expando. The RE-RUN is folded into the `hat-reverification`
  closing leg per the leg spec, alongside the live modal-feel and
  wipe-closes-tabs HAT re-checks.
- `jars.css`: dropped ONLY the `.jar-data-confirm-area` rule (kept
  `.jar-confirm`/`.jar-confirm-text`/`.jar-form-actions`, reused verbatim by
  the modal's mounted content); added `.jar-modal-backdrop`/`.jar-modal-
  card`/`.jar-modal-title` (no transition/animation property anywhere —
  reduced-motion is a non-issue by construction, matching the tablist's own
  discipline).
- Gates: `npm test` (1502/1502 pass), `npm run typecheck` (clean), `npm run
  lint` (clean), script-tag contract test green. Both grep-ACs 0 hits:
  `CONFIRM_REGIONS\|confirmAreas\|regionForAction\|confirmOpenKeys` in
  jars.js, and `.jar-data-confirm-area` in jars.css (only
  `.jar-confirm`/`-text`/`.jar-form-actions` remain, confirmed present).
- Live modal feel (focus trap, default-focus Cancel, Escape/backdrop
  dismiss, focus-restore) and the live wipe-closes-tabs behavior are
  deferred to the `hat-reverification` closing leg per the leg spec's
  Verification Steps — internal-page DOM isn't eval-observable (M06 F4
  DD9), so this is the acceptance signal for both.
- Leg status → `landed`. Not committed (flight-level review + commit
  follows, this being the last autonomous leg per the sequencing note
  above).

### Leg 07: `history-paging-scroll-anchor` (H9) — landed

- **Anchor approach chosen: callback (option 2), not self-contained
  `mountEl.closest(...)`.** A DOM-structure check confirmed a stable
  wrapper selector DOES exist (`.jar-history-mount`'s ancestor
  `section.jar-section` contains both the mount and that jar's tab strip,
  and `section.jar-section { scroll-margin-top: 24px }` already exists to
  clear the page's sticky nav on anchor jumps) — so option 1 was
  technically viable. It was rejected anyway because `jars-history-panel.js`'s
  own module doc explicitly states the module "never touches anything
  outside its own `mountEl`" (DD7's DOM-contract divert criterion,
  M08 F3 Leg 2) — a `closest()` walk out of the mount would violate that
  documented boundary for a leg that doesn't need to. Instead,
  `createHistoryPanel` gained an optional `onPageChange: () => void`
  constructor callback (same injected-deps shape as the existing `onError`/
  `getRetentionDays`), and `jars.js` (which already owns the section element
  as `refs.root`, from `tryExpandFromHash`'s identical
  `refs.root.scrollIntoView(...)` precedent at jars.js:1475) implements it:
  `onPageChange: () => refs.root.scrollIntoView({ block: 'start' })` —
  `'start'` (not `tryExpandFromHash`'s `'nearest'`) per the operator's
  "tabs at the top" wording. The callback closes over `refs` the same way
  `buildPanelContent`'s History branch already does (forward-declared `let
  refs`, only assigned once the section is fully built, never invoked
  before then) — no new pattern introduced.
- **One-shot intent mechanism**: a module-scoped `let pendingScrollAnchor =
  false` in `createHistoryPanel`. `goToPage(page)` sets it `true`
  immediately before calling `refresh()` — the ONLY site that arms it (the
  search-debounce handler resets `currentPage` and calls `refresh()`
  directly, never through `goToPage`, so it can never arm the flag).
  `refresh()`'s `.then((result) => {...})` success handler captures it into
  a local (`shouldScrollAnchor`) and clears the module flag to `false` as
  the FIRST statement in the handler — before the `token !== viewGen`
  stale-token check, before the `!result.ok` error check, and before the
  page-overshoot self-correction branch. This guarantees: a stale response
  never scrolls (flag already cleared, early return follows); an error
  never scrolls; and the self-correction re-fetch never scrolls even when
  it was triggered by the very click that armed the flag — the captured
  local is simply dropped in that branch (recursive `refresh()` call starts
  its own fresh, unarmed cycle). `onPageChange` is invoked only at the very
  end of the non-search paint branch, after `paintPager` repaints, gated on
  `shouldScrollAnchor && onPageChange`. `destroy()` needed no change: it
  already bumps `viewGen`, which routes any in-flight paint through the
  same stale-token early return.
- **Reduced-motion**: no new JS-side `matchMedia` check — `jars.css`
  already gates `html { scroll-behavior: smooth }` behind
  `@media (prefers-reduced-motion: no-preference)` (jars.css:53-58), the
  same mechanism `tryExpandFromHash`'s existing `scrollIntoView` call
  already relies on. The new `onPageChange` call inherits it for free.
- Files touched: `src/renderer/pages/jars-history-panel.js` (added the
  `onPageChange` param + JSDoc, the `pendingScrollAnchor` flag, the arm site
  in `goToPage`, the capture/clear + fire site in `refresh()`, and an H9
  module-doc paragraph) — **553 lines** (was 512). `src/renderer/pages/
  jars.js` (added the `onPageChange` callback + a comment at the
  `createHistoryPanel` call site) — **1,598 lines** (well under the ~1,800
  DD2 growth-checkpoint trigger; +11 lines net for this leg).
- Gates: `npm run lint` clean, `npm run typecheck` clean, `npm test`
  1502/1502 pass (no hang).
- Live scroll feel (does the tab strip visibly land at the top on a
  full-page → short-page pager click) is operator-verified per the leg's
  Verification Steps — internal-page DOM scroll position isn't
  eval-observable (M06 F4 DD9); no behavior test for this leg.
- Leg status → `landed`. Not committed (flight-level review + commit
  deferred to the Flight Director).

---

## Decisions

Operator rulings (2026-07-13 HAT):
- **H2 open-target → NEW TAB, same jar.** History-row links open a fresh
  web tab in that jar (jars page stays open).
- **H6 wipe fix → CLOSE the jar's tabs on wipe (not reload), and state it
  in the confirm copy.** Supersedes F4/DD4's reload-open-tabs-on-wipe.
  Closing the identity's tabs means no reload → no re-recorded visit →
  history stays cleared. The wipe confirm must warn that open tabs in the
  jar will close.
- **R1 → YES, select-all on address-bar focus** (adopt the standard
  browser convention; click/focus selects the whole URL).
- **R2 → KEEP recording search-fallthrough navigations** (they're real
  visits; appear in history and are suggestable).
- **R3 (out-of-jar msg discloses own jar id) → KEEP** (own-binding only,
  harmless) — FD default, no objection raised.
- **R4 (ranking weights / row count / debounce) → LEAVE AS SHIPPED**
  (operator passed ranking at step 8).
- **R5 (panel default/persist) → SUPERSEDED by H4** (tabs; History is the
  default-selected tab).
- **R6 (SR parity for the cross-view dropdown) → ACCEPT as documented gap
  this mission; BACKLOG a follow-up** — FD default, no objection.

---

## Flight Director Notes

- **2026-07-13 — implementation phase start**: agentic-workflow re-invoked
  on the in-flight HAT flight; crew `leg-execution.md` validated. Legs
  sequenced 02 address-select-all → 03 jars-page-tabs (design-review) →
  04 history-panel-content (design-review) → 05 confirm-modal-and-wipe
  (design-review) → 06 hat-reverification (interactive). Deferred single
  code review + commit after leg 05.
- **Leg 02 `address-select-all` risk tier: LOW** — additive single-surface
  renderer fix (one mousedown listener), established pattern, no
  schema/interface/state/security surface. Design review skipped;
  flight-end Reviewer covers it.
- **Leg 03 `jars-page-tabs` risk tier: HIGH** — restructures the F2 panel
  architecture (shared-interface + state-machine surface). Design review
  ran: Developer verified every cited internal against post-F3 code (no
  mismatches), verdict approve-with-changes. Applied: single `selectTab`
  path (hash routes through it, carries the closeTransient guard);
  never-strand-focus-on-body rule; local roving handler (menu-controller
  NOT reusable / not loaded); lazy fetch → scroll-into-view (not build);
  growth checkpoint + pre-agreed jars-tabs.js extraction fallback (~73
  line headroom); CSS grep-AC added; scope fences (WIPE_COPY → Leg 4,
  activeTab reset moot). Re-review skipped (reviewer-prescribed fixes).
- **Leg 04 `history-panel-content` risk tier: HIGH** — store schema/
  statement addition, new IPC surface, new cross-process open-tab wiring.
  Design review ran (approve-with-changes; every cited seam verified,
  H2 open-tab reuse + jar-resolution math confirmed, security boundary
  intact). Rulings applied: REMOVE history-list (dead post-migration;
  twin count stays 6), add history-page with page+pageSize validation;
  register internal-open-tab-in-jar DIRECTLY in main.js (needs
  getChromeContents); intercept click AND auxclick so left/ctrl/middle
  all route to the correct jar (middle-click otherwise leaks to default
  jar); duplicate buildIcon/ICON_DELETE into the panel (avoid a 3-file
  extraction); pager is a rework not a patch. Re-review skipped.
- **Leg 05 `confirm-modal-and-wipe` risk tier: HIGH** — reworks the
  confirm architecture (retires per-region machinery) + cross-surface
  wipe change + a behavior-spec contract. Design review ran
  (approve-with-changes; current machinery verified exactly). Two HIGH
  scope gaps caught + fixed: (1) jars-tabs.js hard-depends on
  regionForAction (must drop the branch + params); (2) jar-data-controls.md
  Step 5 pins reload-not-close (rewrite + re-run in hat-reverification).
  Mechanics pinned: per-action title table for aria-labelledby;
  buildDataConfirm exposes cancelBtn + default-focus Cancel; in-flight
  Escape via dialog-local stopPropagation shadow (FD pick); focus-restore
  fallback to #jars-new when the trigger is gone; DD6 ordered-sweep for
  the wipe close (flicker); CSS drop ONLY .jar-data-confirm-area;
  jars-confirm-modal.js pre-named as the growth fallback. Re-review
  skipped (reviewer-prescribed).

---

## Deviations

*(none yet)*

---

## Anomalies

*(none yet)*

---

## Session Notes

- **2026-07-13 (flight design)**: HAT script assembled from the carry-
  forwards of the three live behavior-test runs (F1/F4/F5) and the five
  flight logs. Branches consolidated first: `flight/08-history-mission`
  = the five flight commits, PR #79 (supersedes #74–#78, closed). HAT
  fixes will land as follow-up commits on that branch.
- **2026-07-13 (post-landing reopen)**: Operator continued HAT testing after
  the flight landed. Two items:
  - **Clear-history tab behavior — investigated, NO code change.** Operator
    observed "clear history did not close the tabs, and the modal doesn't
    warn about tabs closing." Source check (`jars.js`): clear-history runs
    `jarsClearData({classes:['history']})` — a granular data-class clear
    (copy "Clears this jar's browsing history."), same family as
    cookies/storage/cache. Granular clears intentionally do NOT close or
    reload tabs (behavior test confirmed via the surviving `__bt_alive`
    expando); only Wipe/Delete close tabs and their copy already warns
    ("Open tabs in this jar will close."). This is conventional (Chrome/
    Firefox don't close tabs on clear-history either). **Operator ruling:
    keep clear-history as-is** (non-destructive record clear; Wipe stays the
    tab-closing tool).
  - **H9 (paging scroll anchor) — promoted from banked follow-up to Leg 07.**
    Operator: "make the scroll position change too, just add a leg." Flight
    reopened `landed` → `in-flight`; `07-history-paging-scroll-anchor.md`
    authored (status `ready`). Scope: scroll the jar's tab strip / History
    panel top into view ONLY on a user pager page-change, never on the
    shared `refresh()` funnel's other callers (initial/search/broadcast/
    self-correction). Reduced-motion instant.

## Flight Director Notes (leg 07 cycle)

- **Leg 07 (history-paging-scroll-anchor) risk-tier: LOW.** Additive,
  single-surface renderer change in `jars-history-panel.js`, within the
  established pager→`goToPage`→`refresh()` pattern. No schema/interface/
  lifecycle/security surface; does not contradict a prior leg. → per-leg
  design review SKIPPED; flight-end Reviewer covers the code. Design authored
  directly by the FD (equivalent to a /leg pass) with full acceptance
  criteria, since the change and seam were already fully characterized during
  H9 diagnosis. Deferred single review + commit after this (only) leg.
- **Leg 07 review fix (non-blocking correctness):** the one-shot
  `pendingScrollAnchor` capture/clear in `refresh()`'s success handler was
  originally placed BEFORE the `token !== viewGen` stale-token check, so a
  stale/superseded response could clear the flag out from under a still-
  in-flight, genuinely current page click (e.g. click page 3 then page 5
  before the page-3 fetch resolves; if the page-3 response resolves first,
  it wiped the flag and page 5's paint never scrolled). Fixed by moving the
  stale-token check to run first (pure no-op on the flag when stale), with
  the capture/clear now happening after it but still before the error
  early-return and the page-overshoot self-correction re-fetch, so those two
  paths continue to consume/clear the flag and never scroll. Verified: the
  four background `refresh()` callers (initial fetch, search debounce,
  `onHistoryChanged` broadcast, and the self-correction re-fetch itself)
  still never scroll; reduced-motion handling and the optional `onPageChange`
  guard in `jars.js` are untouched. Gates green: `npm test` (1502 passed),
  `npm run typecheck`, `npm run lint`.
