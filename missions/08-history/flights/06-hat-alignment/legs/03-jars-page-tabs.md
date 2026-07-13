# Leg: jars-page-tabs

**Status**: completed
**Flight**: [HAT & Alignment](../flight.md)

## Objective

H4: replace each persistent jar's three **collapsible disclosure panels**
(History / Cookies / Other site data) with a horizontal **tab strip** —
one region visible at a time, History default-selected, the visit count as
a badge on the History tab — for a tighter, professional appearance
(HAT step 3: the dropdowns read cartoonish).

## Context & rulings

- HAT step 3 finding H4; operator authorized replacing the F2
  independently-collapsible panels with tabs (flight-log Decisions:
  "H4 → per-jar tabs, History default-selected, count as a badge; one
  visible region per jar — supersedes the F2 collapsible ruling").
- This restructures the F2 panel architecture (`missions/08-history/
  flights/02-jars-page-panels/`). Known touchpoints in
  `src/renderer/pages/jars.js` (post-F3, ~1,726 lines):
  - `CONFIRM_REGIONS = ['history','cookies','site-data','footer']` +
    `regionForAction` + per-region `confirmAreas`/`confirmOpenKeys` +
    `updateConfirmAreas` (F2/F3).
  - `JAR_PANELS` order (`src/shared/jar-panel-model.js`); the panel block
    in `buildJarSection` rendering `<h3><button aria-expanded>` disclosure
    + `role="region"` per panel, keyed by the double-hyphen composite id
    `jar-<id>--<panel>`.
  - `panelRefs` / `panelOpen` maps in `SectionRefs`; the toggle handler
    that flips `.hidden`/`aria-expanded` and calls `closeTransient()` when
    collapsing a panel that owns the open confirm.
  - `fetchHistoryCount` writing the count span (currently in the History
    disclosure button label); the module-level `onHistoryChanged` handler.
  - `createHistoryPanel` mounted in the History region's own child div
    (the F3 two-children DOM contract); its `onExpanded` lazy-fetch hook.
  - Hash deep-link (`#jar-<id>--<panel>` expands + scrolls) and the
    scroll-spy left-nav (per-jar, unaffected by this leg).
  - Burner sections have no panels (`isBurner` branch); footer
    (wipe/delete) lives OUTSIDE the panels.

## Design (WAI-ARIA tabs)

**Per persistent-jar section**, between the name/swatch area and the
footer, render a tab widget replacing the three disclosure panels:
- A `role="tablist"` (aria-label "Jar data") of three
  `<button role="tab">` — History / Cookies / Other site data — in
  `JAR_PANELS` order, each with `aria-selected`, `aria-controls` →
  its panel's id, and roving tabindex (selected tab `tabindex=0`, others
  `-1`; ArrowLeft/Right move+activate with wrap, Home/End — the APG
  horizontal-tabs contract). **Write a small LOCAL roving-tabindex keydown
  handler in jars.js** *(design review: menu-controller.js is NOT loaded
  by jars.html and its ArrowUp/Down + open/close/return-focus semantics
  don't fit a persistent horizontal tablist — do not reuse it)*.
- Three `role="tabpanel"` regions (`aria-labelledby` → their tab), the
  History panel default-shown (`aria-selected=true` on its tab), the other
  two `hidden`. Panel ids keep the double-hyphen `jar-<id>--<panel>`
  scheme (deep-link + aria-controls target).
- **History tab badge**: the visit count renders as a small badge on the
  History tab button (e.g. `<span class="jar-tab-count">`), fed by the
  SAME `fetchHistoryCount` writer (repoint its target element; keep the
  render-never-writes-count invariant — only the build fetch + the
  `onHistoryChanged` handler write it).

**Tab-select mechanics** (per-section state, patch-in-place):
- `SectionRefs.panelOpen` (a Map) is replaced by `activeTab` (a single
  panel id per section, default `'history'`). `panelRefs` keeps
  `{ tab, panel }` per panel id.
- **ONE shared `selectTab(refs, panelId)` function** is the sole
  tab-switch path — used by tab click, the roving keydown activation, AND
  the hash deep-link *(design review, HIGH — a second inline
  implementation would bypass the confirm guard)*. It: sets `activeTab`,
  flips `aria-selected` + `tabindex` on the strip, flips `hidden` on the
  panels — NO content rebuild on switch (the F2 toggle discipline).
- **Switching AWAY from a region that owns the open confirm calls
  `closeTransient()` first** (the F2 collapse-with-open-confirm rule).
- **Never strand focus on `<body>`** *(design review, MEDIUM-HIGH — a
  focused control in the outgoing tabpanel silently loses focus when its
  panel goes `hidden`)*: when `selectTab` is NOT itself a user click on a
  tabpanel-interior control (i.e. a keyboard/hash/programmatic switch),
  move focus to the newly-selected tab button. Concretely: after hiding
  the old panel, if `document.activeElement` is now `<body>` (or was
  inside the hidden panel), `.focus()` the selected tab.
- **Lazy fetch → SCROLL-INTO-VIEW, not build-time** *(design review:
  History-default-active would fire a full 50-row `onExpanded` refresh for
  EVERY persistent jar at build — worse than today where it fires only for
  panels a user expands, and worse still once Leg 3 adds a paging-total
  query on the same trigger)*: trigger `historyPanel.onExpanded()` when the
  section scrolls into view, reusing the existing scroll-spy
  `IntersectionObserver` infrastructure (`observeSectionsIfChanged`,
  ~jars.js:463) or a second lightweight observer keyed the same way. The
  count (`fetchHistoryCount`, a cheap COUNT) stays eager at build,
  unchanged. `onExpanded`'s `if (initialFetchStarted) return;` guard is
  source-agnostic — no `jars-history-panel.js` change needed; it stays
  idempotent whether first fired by scroll-in or a later tab reactivation.

**Reconcile / broadcasts unchanged in spirit**:
- `updateConfirmAreas` still iterates `CONFIRM_REGIONS`; a confirm in a
  non-active tab's region simply isn't visible, but its open-key still
  round-trips (a broadcast mid-confirm must not rebuild an active region
  hosting a focused control — the M06 F4 DD6 rule extended to tabs).
- Footer region (`'footer'`) stays outside the tab widget, always visible.
- `onHistoryChanged` still refreshes the count + `historyPanel.onHistoryChanged()`.

**Hash deep-link**: `#jar-<id>--<panel>` now SELECTS that tab (+ scrolls
the section into view) instead of expanding a panel — repointed to call
the SHARED `selectTab(refs, panelId)` (above), NOT an inline flip
*(design review, HIGH)*. Match by exact id equality (unchanged).

**CSS** (`jars.css`): tab strip (flat, tight — the professional look the
HAT asked for), selected-tab treatment, the count badge, tabpanel padding;
drop the disclosure `.jar-panel-heading`/chevron rules made dead by the
tab conversion. Reduced-motion: instant tab switch (no animation).

**Burner + footer**: unchanged (no tabs on Burner; footer wipe/delete
outside the widget). The footer confirm region is always visible, so
tab-switching never hides it — no interaction.

**Growth checkpoint & fallback** *(design review — only ~73 lines of
headroom to the ~1,800 DD2 trigger; the roving handler + `selectTab` +
hash-repoint are net-NEW code)*: land the tab widget FIRST, report the
jars.js line count. If it lands at/over ~1,800, extract the tab widget
(tablist build + roving keydown + `selectTab`) into a sibling module
`src/renderer/pages/jars-tabs.js`, exactly the `jars-history-panel.js`
precedent (Flight 3's proactive DD2 split) — three-point onboarding
(jars.html module tag, INTERNAL_PAGES.jars entry, contract test
self-derives). Pre-agreed, not a re-litigation.

**Scope fences** *(design review)*: `WIPE_COPY` (the wipe confirm text)
is NOT touched here — the "close tabs" copy change is Leg 4
(confirm-modal-and-wipe). `activeTab` resets to `'history'` only on a
genuine section teardown/rebuild (a row leaving/re-entering `sectionMap`)
— incidental reconciles patch in place and preserve it; this mirrors the
old per-panel `panelOpen` behavior and needs no special handling.

## Acceptance Criteria

- [x] Each persistent jar shows a 3-tab strip (History/Cookies/Other site
      data), History selected by default; one panel visible at a time;
      Burner shows no tabs. (Static verification — code-reviewed; live feel
      deferred to `hat-reverification` per Verification Steps below.)
- [x] APG tabs semantics: `role=tablist/tab/tabpanel`, `aria-selected`,
      `aria-controls`/`aria-labelledby`, roving tabindex, Arrow/Home/End
      move+activate; panel ids keep `jar-<id>--<panel>`.
- [x] The History tab carries the live visit-count badge, fed only by
      `fetchHistoryCount`'s two writers (build + `onHistoryChanged`);
      `updateJarSection`/render never write it (invariant preserved).
- [x] Clear-data confirms still work per data class (cookies confirm in
      the Cookies tab, storage/cache in Other-site-data, wipe/delete in the
      footer); one `(action,rowId)` key mechanism; switching away from a
      tab whose region has an open confirm calls `closeTransient()` first.
- [x] Focus preservation across `jars-changed`/`history-changed`
      broadcasts holds (name input, active tabpanel content, tab focus).
- [x] Hash deep-link selects the named tab and scrolls to the section.
- [x] Focus never stranded on `<body>` by a keyboard/hash/programmatic
      tab switch (moves to the selected tab); single `selectTab` is the
      only switch path (click + roving + hash all route through it).
- [x] Lazy history fetch fires on scroll-into-view, not build (count
      stays eager); the double-fetch guard holds.
- [x] Dead disclosure code/CSS removed — TWO grep-ACs: JS
      `grep -n "aria-expanded\|jar-panel-heading\|panelOpen" src/renderer/pages/jars.js`
      (no disclosure-panel remnants; the create-panel's own
      `aria-expanded` is distinct and stays) AND CSS
      `grep -n "jar-panel-toggle\|jar-panel-heading" src/renderer/pages/jars.css`
      → 0 hits (the `jars.css:396-463` disclosure/chevron block removed).
      Both confirmed 0 stray hits.
- [x] `npm test` / `npm run typecheck` / `npm run lint` green; jars-page
      script-tag contract test green. Report the new jars.js line count
      (watch the ~1,800 DD2 trigger — tabs should be net-neutral-or-less
      vs. the disclosure panels). **Landed at 1,827 lines (over the
      trigger) → growth-checkpoint extraction fired**: the tablist
      build + roving keydown + `selectTab` moved to
      `src/renderer/pages/jars-tabs.js` (the `jars-history-panel.js`
      three-point-onboarding precedent). **Final jars.js: 1,708 lines**
      (jars-tabs.js: 216 lines).

## Verification Steps

Gates + grep-ACs; live tab feel is re-verified in the `hat-reverification`
leg. (Internal-page DOM is not eval-observable — no behavior test; HAT is
the acceptance signal, per M06 F4 DD9.)

## Files Affected

- `src/renderer/pages/jars.js` — the tab conversion
- `src/renderer/pages/jars.css` — tab styling; drop dead disclosure rules
- `src/shared/jar-panel-model.js` — only if the panel descriptors need a
  tab-label field (likely reuse `label` as-is)

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry (incl. jars.js line count)
- [x] Set this leg's status to `landed`
- [x] Do NOT commit
