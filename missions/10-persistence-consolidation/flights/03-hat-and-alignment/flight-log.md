# Flight Log: HAT & Alignment

**Flight**: [HAT & Alignment](flight.md)

## Summary

Flight designed 2026-07-18. **Awaiting the operator** — this flight is
interactive by definition and is the mission's deliberate pause point
under the autonomous pre-authorization ("only pause when human input is
unquestionably required").

---

## Reconnaissance Report

Every station item traces to a recorded source, verified current at
flight design:

| Item | Source | Status |
|------|--------|--------|
| PR #96 promote/merge | F1 flight log (classifier block) | confirmed-live (draft) |
| PR #98 promote/merge (stacked) | F2 flight log | confirmed-live (draft) |
| Key rotation | F1 leg-3 FD security note; F1+F2 debriefs (3 incidents, 1 class) | confirmed-live |
| NUL-delimiter fix | F2 debrief (both interviews independently) | confirmed-live |
| jar-ipc fixture conversion (optional) | F1 debrief Rec 1, F2 debrief Rec 3 | confirmed-live, operator's call |
| Real-profile migration boot | mission criterion 1 (live half) | confirmed-live |
| Cookie-removal-by-age witness | jar-data-surfaces run 1 disposition | confirmed-live |
| Orphan self-heal observation | F2 debrief (reasoned-not-observed) | confirmed-live |
| Site-data real-profile + badge UX read | F2 debrief HAT riders | confirmed-live |

---

## Flight Director Notes

- 2026-07-18: Flight designed autonomously as the accumulation of every
  HAT-scoped carry (no new technical design — a verification checklist
  from reviewed artifacts). Formal Architect design-review pass skipped
  with recorded rationale: every item is recon-verified against its
  source artifact above; the operator reshapes the session live by
  protocol. Flight → ready. **[BLOCKED:operator-required] — by design.**

---

## Leg Progress

### Fix-rider: per-cookie value reveal (Cookies panel)

- **Trigger**: operator request during the HAT walkthrough (station work on
  the goldfinch://jars Cookies panel) — the operator wanted to inspect a
  cookie's live value without leaving the panel.
- **Gate call**: FEATURE (new user-visible affordance — a per-row
  eyeball reveal/hide toggle — not a defect in shipped behavior), called out
  loud per the in-HAT fix-vs-feature protocol.
- **Design review verdict**: multi-surface change (main IPC + preload +
  renderer + styles), so it went through a lightweight Developer
  design-review pass before the implementing spawn. Verdict: approved as
  specified — new `jars-cookies-value` / `internal-jars-cookies-value` twin
  (extract-don't-fork, three-phase validation mirroring
  `handleCookiesRemove`), exact-identity `{name, domain, path}` match
  against `ses.cookies.get({})` (never Electron's subdomain-matching
  `CookiesGetFilter.domain`), `.textContent`-only rendering of the revealed
  value (no innerHTML — pinned as load-bearing against a site-controlled
  string surfacing in a privileged page), and a per-row generation-token
  guard (mirroring the panel's `viewGen` idiom) so a hide can never be
  raced by a late-arriving fetch.
- **What shipped**:
  - `src/main/jar-ipc.js`: `handleCookiesValue` + the chrome/internal twin
    registration, with a one-line note on the identity tuple's Electron-42
    CHIPS/partitioned-cookie caveat (re-check on Electron bumps).
  - `src/preload/internal-preload.js`: `jarsCookiesValue` wrapper.
  - `src/renderer/renderer-globals.d.ts`: `jarsCookiesValue` added to the
    `GoldfinchInternalBridge` type.
  - `src/renderer/pages/jars-cookies-panel.js`: per-row eyeball toggle
    (aria-pressed, dynamic aria-label "Show/Hide value for `<name>`",
    empty-name cookies use the panel's existing "(unnamed cookie)"
    presentation), reveal fetches and paints inline via `.textContent`,
    re-click hides and removes the value node; no caching beyond the
    in-flight fetch — list re-renders already rebuild rows from scratch, so
    reveals reset to hidden for free.
  - `src/renderer/pages/jars.css`: eyeball button + monospace value-span
    styling, consistent with the existing row-control treatment.
  - `test/unit/jar-ipc.test.js`: full validation matrix for the new handler
    (malformed payloads, unknown jar, non-string name/domain/path,
    empty-name-ok, not-found, exact-identity match including two
    same-named cookies on different domains) plus registration-surface and
    untrusted-origin coverage updated for the new twin. The existing "list
    payload has no value field" pin stays green (list handler untouched).
  - No renderer unit suite added (house practice for page controllers,
    `jars-history-panel.js` precedent — static nets only for this layer).
    No source-scan test enumerating internal-preload wrappers exists in
    this repo, so there was nothing to extend there.
- **Required green**: `npm test` (2123/2123 passing), `npm run typecheck`,
  `npm run lint` — all clean.
- **Status**: implemented, NOT committed — awaiting operator live
  verification per protocol.

### Fix-rider: live tab counts + icon refresh button (Cookies / Other-site-data panels)

- **Trigger**: operator request during the HAT walkthrough — two related
  asks on the goldfinch://jars per-jar tab strip: (A) show a live count in
  every tab's header, not just History's; (B) turn the Cookies/Other-site-data
  "Refresh" text button into a right-justified icon.
- **Gate call**:
  - **Rider A**: FEATURE (new user-visible affordance — live counts on two
    previously-uncounted tabs — not a defect in shipped behavior), called out
    loud per the in-HAT fix-vs-feature protocol. Went through one design
    review cycle; the Architect's cycle-1 findings (trigger shape for the new
    counts, copy unification, freshness/de-dup rules, jars-tabs.js's gate
    widening) were resolved by FD revision rulings before implementation —
    see below.
  - **Rider B**: look-and-feel FIX (the existing "Refresh" affordance's
    presentation, not a new capability) — implemented inline, no separate
    design-review cycle.
- **Design review verdict (Rider A, cycle 1 + FD rulings)**:
  1. **Trigger**: counts populate at SECTION BUILD TIME for all three panels,
     unconditionally per persistent jar — mirroring History's own
     pre-existing `fetchHistoryCount` mechanism (which already fired
     unconditionally at build), rather than inventing a new trigger shape.
     Cookies/Other-site-data reuse the SAME `jarsCookiesList`/
     `jarsSiteDataList` IPCs their own tab-selection-gated LIST view already
     calls (`count = response.{cookies,origins}.length`) — no new IPC
     channel. Recorded explicitly in code (jars.js's activationHooks comment,
     and both panel modules' Freshness doc comments): this is a bounded
     one-shot per page load (one `cookies.get` / one `readdir` per jar),
     distinct from a per-scroll live-probe shape that was considered and
     REJECTED — the LIST fetches stay tab-selection-gated exactly as before.
  2. **Format**: unified ALL THREE badges to "<Label> (N)" — History's old
     "— N visits"/"— no visits" suffix is REPLACED (operator-requested copy
     change); zero renders "(0)".
  3. **Freshness**: (a) build-time fetch seeds every badge; (b)
     `history-changed` re-fetches History's badge (unchanged mechanism);
     `jar-data-changed` re-fetches ONLY the badge(s) for the classes actually
     reported in the broadcast (skip classes not in the broadcast); (c) BOTH
     `jars-cookies-panel.js` and `jars-sitedata-panel.js` gained an
     `onCountChanged(n)` constructor-dep hook, fired after every successful
     `refresh()` with the fresh list length — this is what keeps an OPEN
     tab's own per-row deletes reflected in its badge, since those
     deliberately don't broadcast; (d) de-dup rule: a broadcast-triggered
     badge re-fetch is skipped when it targets the section's currently
     ACTIVE tab — that panel's own `refresh()` + `onCountChanged` hook
     already carries it.
  4. **jars-tabs.js**: the history-only count-badge `<span>` gate widened to
     all three panels; the "only writers"/static-label INVARIANT comments
     (there and in jars.js) rewritten for the three-panel count contract.
     Roving-tabindex/keyboard contract and `role="tab"` semantics untouched;
     the accessible name includes the count naturally via the label text — no
     live-region additions.
  5. **Housekeeping** (review LOW): CLAUDE.md's stale M08 note describing the
     old disclosure-panel `.jar-panel-count` corrected to the current
     tab-strip + `.jar-tab-count` reality.
- **Design verdict (Rider B, inline)**: the refresh button becomes an
  icon-only `<button>` (Lucide "refresh-cw", matching the page's existing
  vendored icon-button convention — trash/eyeball icons built the same way)
  with accessible name "Refresh" (`aria-label`, literal and panel-agnostic
  per the operator's ask — consistency over the prior per-panel "Refresh
  cookies"/"Refresh site data" specificity). Applies to BOTH panels. Position:
  right-justified into the SAME top-row `.jar-data-controls-buttons` flex row
  as that panel's Clear-* button(s) (`margin-left: auto`), rather than its
  former standalone full-width line inside the module's own mount — this
  moves the button's DOM out of the panel module and into jars.js, so each
  panel module now exposes a plain `refresh()` trigger hook instead of
  building/owning the button itself; the DD7 two-child region contract is
  unaffected (the button still lives inside the SAME controls-block child,
  never inside the mount). Keyboard/focus behavior unchanged (still a real
  `<button>`, still reachable in the same tab-panel's normal focus order).
- **What shipped**:
  - `src/renderer/pages/jars-tabs.js`: count badge `<span>` built for every
    panel (was History-only); doc comments rewritten for the three-panel
    contract.
  - `src/renderer/pages/jars.js`: `historyCountSuffix` renamed/unified to
    `tabCountSuffix` (pure, "<Label> (N)" for all); new `fetchCookiesCount`/
    `fetchSiteDataCount` (mirroring `fetchHistoryCount`'s shape) plus
    `updateTabCount` (routes a panel's `onCountChanged` into its badge); the
    build-time count-fetch call site generalized from a History-only branch
    to a loop over `JAR_PANELS`; `onJarDataChanged`'s module-level handler
    gained the classes-scoped, active-tab-de-duped badge re-fetch; new
    `ICON_REFRESH` + `buildPanelRefreshButton` (Rider B) building the
    icon-only trigger appended into each panel's `buttonRow` after its
    Clear-* button(s); several doc-comment updates (module-top "Tab counts"
    paragraph, `buildRegionControls`/tab-widget/activationHooks comments)
    recording the FD rulings above.
  - `src/renderer/pages/jars-cookies-panel.js` /
    `jars-sitedata-panel.js`: gained an optional `onCountChanged` constructor
    dep (fired at the end of a successful `refresh()`); removed the
    module-owned `refreshBtn` (DOM + click wiring) and exposed the existing
    internal `refresh()` function as a returned hook instead; doc comments
    updated for both riders (manual-refresh relocation, tab-badge count,
    and the DD2-gating-vs-build-time-count-pass distinction).
  - `src/renderer/pages/jars.css`: `.jar-datalist-refresh` restyled from a
    full-width text-button spacing rule to an icon-only square button with
    `margin-left: auto`; `.jar-data-controls-buttons` gained
    `align-items: center` for the mixed icon/text-button row.
  - `CLAUDE.md`: line ~119's stale M08 disclosure-panel note corrected to
    the tab-strip + generalized-count reality (housekeeping, review LOW).
  - No renderer unit suite added or extended (house practice for page
    controllers, `jars-history-panel.js` precedent — static nets only). No
    existing test pinned the old "— N visits"/"no visits" copy or the
    History-only count-span gate (grepped first) — nothing to update there.
    The main-process `jars-cookies-list`/`jars-sitedata-list` IPC handlers
    this rider's build-time count fetch reuses are unchanged (existing
    `test/unit/jar-ipc.test.js` coverage for those handlers stays green
    untouched).
- **Required green**: `npm test` (2123/2123 passing, unchanged count — no
  new/removed tests this rider), `npm run typecheck`, `npm run lint` — all
  clean.
- **Status**: implemented, NOT committed — awaiting operator live
  verification per protocol.

### Fix-rider: panel explainer + badge tooltips (Other-site-data panel)

- **Trigger**: operator comprehension finding during the HAT walkthrough —
  the operator found the goldfinch://jars Other-site-data panel unexplained
  (what it lists, what the two badge types mean, what Delete does).
- **Gate call**: look-and-feel FIX (clarifying existing shipped copy/labels,
  not a new capability) — implemented inline, no separate design-review
  cycle. Paired BACKLOG seed "Site-data inspector" (show users exactly what
  a site stores) captured separately by the FD as the deeper, out-of-scope
  capability this finding gestures at.
- **What shipped**: `src/renderer/pages/jars-sitedata-panel.js` — a
  one-line plain-language explainer (`EXPLAINER_NOTE`) painted first in the
  mount, above the existing known-gap note, `.textContent`-only; supplementary
  `title`-attribute tooltips on the two badge types (`TIER_TOOLTIP`), badge
  `.textContent` unchanged as the accessible content; the known-gap note
  tightened (`KNOWN_GAP_NOTE`) to drop the now-redundant "(it acts on
  storage, not history)" aside while keeping all three honesty clauses
  (localStorage invisible, never-visited origins absent, visited-tier
  delete can be a silent no-op). `src/renderer/pages/jars.css` —
  `.jar-datalist-explainer-note`, muted styling matching the existing
  gap-note treatment.
- **Required green**: `npm test` (2123/2123 passing, unchanged count — no
  new/removed tests this rider), `npm run typecheck`, `npm run lint` — all
  clean.
- **Status**: implemented, NOT committed — awaiting operator live
  verification per protocol.

### Fix-rider: retention control moved to the jar-section header

- **Trigger**: operator finding during the HAT walkthrough — the per-jar
  retention dropdown rendered INSIDE the History tab panel (a M08 fossil
  from when retention was history-only), which misleads: since M10 Flight 2
  the retention window governs history + cookies + site data together, not
  just History.
- **Gate call**: look-and-feel FIX (relocating an existing control so its
  placement matches its real scope, not a new capability) — implemented
  inline, no separate design-review cycle.
- **What shipped**:
  - `src/renderer/pages/jars-history-panel.js`: retention `<select>` +
    label, the `RETENTION_PRESETS`/`ensureRetentionOption` local logic, the
    `getRetentionDays` constructor dep, and the `onJarsRow` hook all
    REMOVED; module doc comment (top) and the "Patch discipline" paragraph
    rewritten to drop retention and record the relocation, with a
    provenance note pointing at jars.js's replacement logic. Every other
    behavior (search, paging, per-row delete, H1/H2/H3/H9) is
    byte-unchanged.
  - `src/renderer/pages/jars.js`: new module-scope `RETENTION_PRESETS` +
    `ensureRetentionOption(select, days)` (carried over verbatim from the
    History panel's prior implementation); `buildJarSection` now builds the
    retention `<label for>`/`<select id>` pair into the section HEADER
    (`.jar-section-retention`), appended after the dot/name/Default-pill/
    Make-default cluster, right-aligned via CSS; the `change` handler
    (wired after `refs` is assigned, mirroring `nameInput`'s own listener
    wiring) calls the SAME `bridge.jarsSetRetention({ id, days })` path,
    with the same optimistic-update-then-revert-on-failure shape and the
    same `'Could not update retention'` status-line message. `SectionRefs`
    gained `retentionSelect`/`lastKnownRetention`; `updateJarSection` calls
    a new `updateSectionRetention(refs, id)` (replaces the retired
    `historyPanel.onJarsRow()` call) that patches the select in place from
    the raw store record (`currentRowFor`, never the page-model row) with
    the same focused-select guard `onJarsRow` used to apply; the select's
    `aria-label` (disambiguating jar name, mirroring `nameInput`'s own
    `aria-label` pattern) is kept in sync in the same place. Label text
    changed from "Keep history for:" to **"Keep data for:"**.
  - `src/renderer/pages/jars.css`: new `.jar-section-retention{-label,-select}`
    rules (carried over from the retired `.jar-history-retention-*` rules,
    same token palette) plus `flex-wrap: wrap` added to
    `.jar-section-header` so the control drops to its own right-aligned
    line rather than overflowing on a long jar name; old
    `.jar-history-retention-*` rules removed.
  - `CLAUDE.md`: the M08-era "Retention control" bullet and the adjoining
    History-module-content sentence updated to describe the new location
    and to drop the retired `getRetentionDays`/"retention select" mentions.
  - `tests/behavior/jar-data-surfaces.md`: swept for a stale History-panel
    reference — its step 6 already drives retention via the chrome bridge
    `jarsSetRetention` generically ("the internal page's `<select>`", never
    naming the History panel), so it needed no edit.
  - No renderer unit suite added or extended (house practice for page
    controllers, `jars-history-panel.js` precedent — static nets only).
    Grepped for `.jar-history-retention`/`onJarsRow`/`getRetentionDays`
    across `test/`/`tests/` first — zero hits, nothing pinned the old
    shape.
- **Required green**: `npm test` (2123/2123 passing, unchanged count — no
  new/removed tests this rider), `npm run typecheck`, `npm run lint` — all
  clean.
- **Status**: implemented, NOT committed — awaiting operator live
  verification per protocol.

### Fix-rider: literal NUL bytes in `retention-sweep.js` made the file binary to git

- **Trigger**: `src/main/retention-sweep.js`'s `identityKey` helper (M10
  Flight 2, Leg 3) had three LITERAL NUL bytes (0x00) pasted directly into
  its template literal as the field separator, committed as part of
  `2be8424`. A literal NUL makes git classify the whole file as binary —
  `git diff`/`git show` render `Bin NNN -> NNN bytes` with no line diff,
  and blame/PR review tooling can't show the file's history at all.
- **Gate call**: FIX (source-encoding correction only, zero runtime
  behavior change) — implemented inline, no separate design-review cycle.
- **What shipped**: the three literal NUL bytes in `identityKey`'s
  `` `${jarId}\0${name}\0${domain}\0${path}` `` template literal replaced
  with the `\0` escape sequence — the runtime string is byte-identical
  (JS produces the same NUL character either way), only the on-disk source
  encoding changed. A note was added to `identityKey`'s doc comment
  warning against pasting literal NUL bytes into source in the future.
- **Verification**: `grep -P '\x00' src/main/retention-sweep.js` now
  returns nothing (confirmed via byte-level Python scan: 3 → 0). `file
  src/main/retention-sweep.js` now reports "JavaScript source, Unicode
  text, UTF-8 text" (was "data"). `npm test` 2123/2123 passing, `npm run
  typecheck` and `npm run lint` clean.
- **Known caveat**: `git diff --stat` against the current HEAD (`2be8424`,
  which still carries the NUL-laden blob) still reports `Bin ... bytes` —
  git's binary detection is per-blob-pair, and the OLD side of the diff is
  still binary until this fix is itself committed. Verified via a
  side-by-side simulation (diffing a NUL-fixed copy of the HEAD blob
  against the working-tree fix, `--no-index`) that once BOTH sides are
  NUL-free the diff renders as a normal 6-line insertion, not binary. So
  line-diff rendering for this file is restored from the next commit
  forward; it cannot retroactively un-binary the already-committed
  `2be8424` blob.
- **Status**: implemented, NOT committed — per protocol, and also because
  committing is what actually flips `git diff --stat` from `Bin` to line
  counts for this file going forward.

---

### Station D/E walkthrough progress (operator-witnessed)

- TC1 real-profile fidelity after migration: **PASS** (operator). Note:
  the actual migration moment occurred at the FD's flight-end a11y
  launch (2026-07-17 19:39) — disclosed to the operator; fidelity of
  settings/jars/downloads/session/shields verified by the operator on
  their real profile.
- TC2 Cookies panel: **PASS** (operator) — real listing, no values by
  default, unconfirmed per-item delete, refresh. Mid-TC the operator
  requested the value-reveal feature (see fix-rider entry) — verified
  live: PASS.
- Fix-riders (tab counts + icon refresh): **PASS** (operator, live).

### Station completions (2026-07-18)

- **Station A**: PR #96 promoted + merged; PR #98 retargeted to main (one
  trivial BACKLOG conflict resolved on-branch, suite re-verified) and
  merged. Operator additionally directed: dependabot PRs #73 (@types/node
  26.1.1) + #95 (actions/setup-node 7) merged, suite/typecheck/lint green
  on updated deps; patch version bumped to 0.10.1, pushed, NO tag (no
  release, per operator). Issue #94 closed with a landing summary.
- **Station B**: keys ROTATED by the operator (Settings → Automation
  revoke + re-mint; new key placed in .mcp.json by the operator directly —
  never transited this session). `.mcp.json` confirmed git-ignored.
  **Old-key-refuses verified**: the prior registration now returns HTTP
  401 (operator's /mcp reconnect attempt) — revocation confirmed live.
- **Station C**: NUL-delimiter fix landed (committed with the riders);
  jar-ipc.test.js fixture conversion DEFERRED to routine maintenance
  (operator did not elect it during HAT).
- **Station D dispositions**: TC1/TC2 + all riders PASS (see walkthrough
  progress above). TC5 retention sweep: operator unable/declined to test
  at HAT ("not worried about retention in the dev env") — coverage stands
  on the F2 Witnessed gate (storage/history live-PASS) + unit layer.
  TC6 corrupt-DB: skipped (twice machine-witnessed). TC8
  cookie-removal-by-age: closed **procedurally** by operator election
  (flight.md option (b), anticipated in the plan). **Debrief correction
  (Architect): substantively still unwitnessed** — the F2 gate covered
  storage/history removal-by-age, NOT cookies (that clause was the gate's
  honest FAIL); "unit + analogy to the sibling sweep" is the true
  coverage. A cheap live spot-check (set one jar to 1 day, return next
  day, watch a cookie vanish) is recorded as a standing follow-up in the
  mission debrief, not a discharged item.
  Orphan self-heal: passive watch, unit-covered. UX read: discharged
  continuously through the session (four operator findings, all
  addressed as riders).
- **Station E**: behavior-test re-runs skipped (both ran this mission;
  operator-witnessed evidence deemed sufficient).

## Decisions / Deviations / Anomalies

*(recorded during the HAT session)*
