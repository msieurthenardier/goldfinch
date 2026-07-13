# Mission Debrief: Per-Jar Browsing History

**Date**: 2026-07-13
**Mission**: [Per-Jar Browsing History](mission.md)
**Status**: completed
**Duration**: 2026-07-12 → 2026-07-13
**Flights Completed**: 6 of 6

## Outcome Assessment

### Success Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| Visits recorded (address, title, time) + survive restart | **Met** | `history-recording` behavior test 8/8 (F1) |
| Burner + internal pages never produce records | **Met** | Positive partition allowlist; 8/8 confirmed zero rows (F1) |
| Jar isolation holds for history on every surface | **Met** | Automation `history-automation-isolation` 7/7 (F5); address-bar behavior-tested (F4); web-page surface structural + unit-pinned (F1) |
| Manage-jars page presents per-data-class regions with left-nav anchors | **Met** | Shipped as collapsible panels (F2), refined to a per-jar tab strip at HAT (F6/H4) |
| Browse / search / delete-one / clear-all | **Met** | F3; UI reworked at HAT (numbered pager, links, trashcan) |
| History participates in jar data controls (clear-class + wipe) | **Met** | F3; wipe-closes-tabs correctness fix at HAT (F6/H6) |
| Per-jar retention policy (30-day initial), editable, auto-prune | **Met** | F3; cutoff unit-pinned, prune-on-change IPC-tested |
| Address-bar suggestions from active jar; keyboard/pointer select + navigate | **Met** | `omnibox-suggestions` behavior test 7/7 (F4) |
| Felt-instant at scale (tens of thousands of entries) | **Met** | Store probe ≤5ms median at 50k; live 114ms keystroke-to-rows (F4) |
| Jar-keyed automation reads own history; other jars refused | **Met** | `history-automation-isolation` 7/7 (F5) |
| No network egress (recording/search/retention/suggestions all local) | **Met** | Search half F3, suggestion half F4; no suggestion-blending |

**11 of 11 success criteria met.** Every criterion that could be pinned by real-environment
observation is behavior-test-backed.

### Overall Outcome

The mission delivered its stated outcome in full: the operator can answer "where have I
been?" per jar, on their terms — visible and manageable on the manage-jars page,
searchable from the address bar, aging out under a per-jar retention policy, and readable
by automation only within the jar a client is keyed to. Burner tabs remain truly
ephemeral. Jar isolation was extended to history on every surface with no exceptions — the
mission's non-negotiable constraint held throughout. Beyond the feature, the mission
delivered its strategic purpose: it proved out the `node:sqlite` storage substrate that
justifies and de-risks the follow-on store-migration mission.

## Flight Summary

| Flight | Status | Key Outcome |
|--------|--------|-------------|
| F1 history-store | completed | `node:sqlite` store + recorder + IPC twins; the durable spine of the mission — its API survived all later flights untouched |
| F2 jars-page-panels | completed | Manage-jars per-data-class regions + `history-count` IPC + the pure `jar-panel-model.js` taxonomy seam |
| F3 history-panel | completed | Browse/search/delete/clear, retention control, `history` data class; excellent permanent backend, HAT-reworked UI |
| F4 omnibox-suggestions | completed | Frecency `suggest` + non-focusing cross-view sheet dropdown; recon-first design, zero diverts |
| F5 automation-history | completed | Jar-confined `getHistory` façade; closed the mission (all 11 criteria) |
| F6 hat-alignment | completed | Guided HAT surfaced 9 findings + 6 rulings machine gates could not; fixes landed as risk-tiered legs |

### Flight Patterns

- **The flights that went smoothest were recon-first and design-review-heavy** (F1, F4).
  Verifying load-bearing environment facts *before* writing legs eliminated diverts.
- **The one flight that "struggled" (F6) struggled by design** — it is the human-judgment
  flight, and its findings were the point, not a failure. It also net-*simplified* the
  codebase (retired more machinery than it added).
- **Common thread across all six:** zero core-seam reworks. The store API, the identity
  façade, and the twin-IPC pattern were established in F1/F5 and extended additively
  everywhere else.

## What Went Well

1. **The architecture improved by design, not luck.** A whole new storage tier plus four
   user-facing surfaces landed without a single cross-flight rework of a core seam. All
   ten Flight-1 store signatures survived to HEAD; `pruneOneJar`, `suggest`, and
   `listByPage` were added purely additively. The "jar-keyed, `now`-injected, Electron-free,
   live-handle-singleton" store shape was the single best structural decision of the
   mission.
2. **Three house patterns fired *predictively* — the bar for promotion.** (a) The DD2
   named ~1,800-line growth trigger + pre-agreed extraction fallback fired exactly where
   forward design predicted (twice in F6), each extraction mechanical because the target
   was named at design time; jars.js settled at 1,598, ~200 under the trigger. (b) The
   taxonomy-behind-a-pure-model seam (`jar-panel-model.js`) survived the F6 panel→tab
   rewrite byte-intact. (c) The per-jar-confinement façade (`scope.js`) is now a reusable
   security template (three independent confinement layers; jar keys can't even enumerate
   other jars via error discrimination).
3. **The design-review live-probe gate repeatedly caught silent data-loss bugs** that
   spec-faithful unit tests would have pinned green — F1's tokenizer (would have shipped
   non-functional search) and retention seeding (`NaN` cutoff matching zero rows), F3's
   single-key prune (would have orphan-deleted *every other jar's* history on any
   retention edit). These were plausible-but-wrong silent failures; the live probe, not
   code-reading, is what caught them.
4. **Isolation — the non-negotiable constraint — was held and proven, not asserted.**
   Defense-in-depth across façade → engine → SQL scoping, unit-pinned to short-circuit
   before the engine, and behavior-tested live against a retained ~50k foreign-row
   population with same-session positive controls on every negative checkpoint.

## What Could Be Improved

1. **Defer aesthetics to HAT; never defer behavioral correctness that contradicts a
   criterion.** H6 (wiping a jar with open tabs left a residual history row — a direct
   violation of the "wiping removes history" criterion) was *foreseen at F3 probe 6* and
   mis-triaged as a "legitimate reload-triggered visit." The root cause was an
   architectural interaction latent from the moment F4/DD4 chose reload-on-wipe: a
   reload-sweep meets a recorder that counts navigations as visits. A design review asking
   "what does the recorder do with a *programmatic* reload?" would have caught it. H5 (a
   plain display-logic bug) reinforces the line from the other side — it should have been a
   unit assert in F3, not a HAT finding.
2. **No committed regression net for internal-page renderer behavior — a mission-wide
   ceiling.** All four new surfaces are internal-page DOM ("not eval-observable"), so the
   pager, modal focus-trap, `auxclick` jar-routing, scroll-anchor, select-all, and the
   fragile cross-view Ch7-before-Ch6 temporal contract are guarded only by doc-comments +
   uncommitted local behavior tests. This is the single largest standing exposure the
   mission leaves behind. It is a house-practice ceiling, not a mission defect — but it is
   worth an explicit decision (even a narrow eval-observable assertion, e.g. active-tab
   `aria-selected`, would catch structural regressions the operator currently re-walks).
3. **The main.js recording wire (F1's biggest exposure) has no CI net** — the
   `did-navigate` → recorder glue is verified only by the non-CI, non-committed
   `history-recording` behavior test. A thin smoke assertion would close it cheaply.
4. **A handful of catalogued small debts** (below) — mostly quick wins, none load-bearing.

## Lessons Learned

- **Anticipate the store API, not the IPC read shape.** F1's jar-keyed store methods
  survived three flights; its speculative cursor-paged `history-list` IPC channel was
  removed in F6 once the real consumer chose numbered paging. Defer speculative read-channel
  *shapes* to the consumer's flight; anticipate the durable store API.
- **Abstract the stable axis, let presentation churn.** The taxonomy model is *why* the
  panel→tab rewrite cost almost nothing. Standing guidance for any "reorganize a page" flight.
- **Determinism by construction.** The store and the pure decision modules both refuse to
  read the wall clock; the caller injects `now`. Make this the default for any
  time-dependent query logic.
- **Cross-view screen-reader parity is a pattern-level ceiling, not a per-feature gap.**
  True combobox `aria-activedescendant` across WebContentsView documents is impossible —
  the option DOM is unreachable from the input's document. Accept it as the a11y ceiling of
  *every* cross-view sheet menu; don't relitigate per-feature.
- **A "legitimate but surprising" residual that contradicts a mission criterion is a
  defect** — file it in its originating flight, don't carry it to HAT. Any flight that
  introduces a programmatic navigation (reload/redirect/sweep) into a system with a
  navigation-recorder owes a design-review question about their interaction.

## Methodology Feedback

- **Budget a dedicated end-of-mission HAT flight by default for any mission shipping new
  interactive surfaces.** It surfaced 9 findings + 6 rulings that machine gates provably
  could not (all four surfaces are structurally outside the eval-observable harness), and
  it was chartered up front — not bolted on. For pure backend/store missions it is not
  warranted.
- **Promote to standing methodology conventions:** (a) named quantitative growth triggers
  with a pre-named extraction target beat "split when it feels big"; (b) the multi-surface
  design-review trigger inside HAT (it caught two real HIGH scope gaps in one F6 leg);
  (c) risk-tiered per-leg review with an explicit, recorded LOW-tier skip.
- **The fully-autonomous orchestration of F1–F5 worked.** Five flights designed, reviewed,
  implemented, and behavior-tested end-to-end with the human engaged only at phase gates
  and the HAT. The deferred single-review-and-commit mode kept overhead low; the
  design-review gate carried real correctness load (it caught every silent-failure bug
  before code). The level of autonomy was appropriate — the human's judgment was reserved
  for exactly the class of decision (look-and-feel, product rulings) that machines can't
  make, and the H6 saga showed the value of a machine tiebreaker (automation reproduction)
  when a manual HAT observation produced a false negative.
- **Behavior-test authoring lessons to land in AUTHORING.md** (banked across F4/F5): seeds
  must account for the system's own data-lifecycle policies (retention prune at launch ate
  a 120-day seed); stage navigation targets through the real recording pipeline to
  resolvable local fixtures, not fictional hosts; pre-declare per-launch teardown when the
  key tier has no in-protocol quit; "Executor tears down only after Validator [CLOSING]";
  every negative checkpoint carries a same-session positive control; judge sheet visibility
  from pixels, not DOM presence (the "two closed states" hazard).

## Action Items

### Follow-on missions (charter-named, seeded)
- [ ] **Storage-substrate migration** — re-home the settings + downloads JSON stores onto
      the proven `node:sqlite` substrate. The store template is documented and de-risked;
      this migration owes the experimental-API-tax re-run and should decide whether to
      unify the two coexisting paging primitives (cursor vs. offset).
- [ ] **Electron 42→43 major bump** (deferred to the post-mission maintenance sweep) — gates
      a full history store-suite re-run, since the whole mission rests on the experimental
      `node:sqlite` API.

### Follow-up flight (filed)
- [ ] **Internal-page keyboard focus (H8)** — `tab-set-active` raises the guest view but
      never calls `webContents.focus()`, so Tab traverses the chrome toolbar instead of the
      page. Pre-existing, cross-cutting (find-overlay / menu-sheet / tab-strip focus
      interplay); affects *all* internal pages, not just history. Needs its own design +
      behavior test — already in mission Known Issues + BACKLOG.

### Quick-win debt (low effort, real value)
- [ ] Consolidate the automation tool-count invariant to one shared constant (it's asserted
      across `mcp-server.js`, `mcp-tools.js`, and the test's `EXPECTED_TOOL_COUNT`; a stale
      count wedges the whole suite past the 120s gate).
- [ ] Add a thin smoke assertion for the main.js `did-navigate` → recorder wire.
- [ ] Honest omnibox close reasons on error paths (`'superseded'` not `'input-empty'`);
      prune F4 dead surface (`internal-history-suggest`, `lastQuery`/`blurClosedAt`/`refocus`).

### Hardening / carry-forward
- [ ] `rerollSeed`-skip-on-delete-throw (F3 Known Issue) — mission-end hardening candidate.
- [ ] Refactor `pruneExpired`'s cutoff+GC coupling into two methods when next touched.
- [ ] Extract a shared `src/shared/` icon module on the next `buildIcon`/`ICON_DELETE`
      duplication; extract `confineToOwnJar(jarId, jar)` on the third per-jar façade op.
- [ ] Add `getHistory` audit detail (`jarId` presence only, never query text) as read tools
      multiply.

### Documentation / conventions
- [ ] Write one consolidated reference for the jars-page 4-module subsystem contract
      (mount-boundary discipline, `selectTab` sole-switch-path, render-never-writes-count,
      three-point onboarding) — currently only in scattered doc-comments.
- [ ] Verify CLAUDE.md's jars-panel-organization paragraph describes the tab strip, not the
      superseded collapsible panels.
- [ ] Land the behavior-test authoring lessons in `.claude/skills/behavior-test/AUTHORING.md`.
- [ ] Record read-only-forever as a stated automation invariant (so a future
      "add deleteVisit to automation" is forced through an explicit gate).
