# Mission Debrief: Top-Bar Download Visibility

**Date**: 2026-07-19
**Mission**: [Top-Bar Download Visibility](mission.md)
**Status**: completed
**Duration**: 2026-07-19 (single session — mission through mission debrief)
**Flights Completed**: 1 of 1

> **Scope note.** Single-flight mission: the architectural and technical assessment is carried from
> [Flight 01's debrief](flights/01-indicator-and-popup/flight-debrief.md) (which included a full Architect
> design-review + Developer metrics pass) rather than duplicated via a separate mission-level Architect
> interview. Human/orchestration insight was captured inline during the HAT session, reflected below.

## Outcome Assessment

### Success Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| Persistent indicator visible while active/recent, hidden when idle | **Met** | Chrome-like persistence after the HAT recent-persistence fix; operator-verified |
| Live state conveyed accessibly (label, not color/animation alone) | **Met** | `aria-label` is the state-of-truth channel; `npm run a11y` passed live |
| Activating the indicator opens a popup listing current + recent | **Met** | New `downloads` sheet template (`role="dialog"`); operator-verified |
| Open completed file / reveal in folder; in-progress not openable | **Met** | External effects HAT-verified; in-progress rows are buttonless text + live bar |
| Popup offers a way to open `goldfinch://downloads` | **Met** | Footer action; operator-verified |
| Open/reveal never trust a renderer path (main-side by id) | **Met** | Id-only chrome-trust handlers + shared resolver + `state==='completed'` gate |
| App-scoped: present on internal tabs, independent of toolbar pins | **Met** | Grep-verified zero `toolbarPins` refs; present on `goldfinch://` tabs (HAT) |
| `npm run a11y` passes for button + popup; existing behavior tests unaffected | **Met** | New `downloads-button` + `sheet:downloads` states pass; 2242/2242 unit green |

**8 of 8 criteria met.**

### Overall Outcome

The mission delivered exactly its stated outcome: a user who starts a download in Goldfinch now has a
persistent, glanceable top-bar place to see in-flight and recently-finished downloads and act on them
(open, reveal, jump to the downloads page) without chasing a dismissed toast. The outcome remained the
right goal throughout — no pivot. Shipped as PR
[#107](https://github.com/msieurthenardier/goldfinch/pull/107) (ready for review), two commits
(`9a2089c` legs 1-3, `6db0902` HAT alignment).

## Flight Summary

| Flight | Status | Key Outcome |
|--------|--------|-------------|
| 01 — Top-Bar Download Indicator + Downloads Popup | completed | All 4 legs landed (3 autonomous + HAT). Trust-boundary IPC, app-scoped button + reducer, sheet popup + a11y. HAT caught and fixed two real UX gaps (recent-persistence, live popup progress). |

## What Went Well

1. **Autonomous design → implement, with human oversight concentrated at HAT, worked as intended.** The
   operator's chosen model — run mission → flight → legs → implementation autonomously, then step in at a
   single HAT leg — delivered a clean, reviewed, landed feature while keeping the human's attention on
   exactly the judgment calls automation can't make. Both HAT findings were *experiential UX* calls (an
   indicator that vanished too eagerly; progress that looked frozen) that no automated gate would have
   flagged — validating HAT as the right place for concentrated human oversight.
2. **The layered review gates caught the right issues at the right stages.** Mission viability review,
   flight design review, per-leg design review on the two HIGH-risk legs (2 cycles on Leg 3, catching two
   HIGH-severity bugs *before code*), an independent flight-end review, and an independent review of the
   HAT changes — each caught something the next stage would have paid more to fix. Risk-tiering (L1/L3 HIGH,
   L2 LOW) was accurate.
3. **Single-flight mission sizing was correct.** One coherent outcome, one risk-clustered flight, 3 legs +
   HAT. No flight churn; the leg dependency graph (L1⊥L2→L3) held exactly.

## What Could Be Improved

1. **Two design decisions (DD2 snapshot-at-open, DD5 acknowledge/idle policy) were revised at HAT, and both
   were foreseeable at design time** — DD5 from the mission's own outcome language ("recently finished…
   persistent"), DD2 from an existing codebase precedent (the suggestions template's live model-replace).
   Each cost an implement → HAT → re-design → re-implement round-trip. The fix is process, not people: a
   design-time cross-check against the mission text (for tunable defaults) and a codebase-precedent survey
   (before defaulting a UI to a limited mode) would have front-loaded both.
2. **The behavior test (`download-indicator`) never ran** — the run session's MCP was jar-scoped, and the
   admin key needed to read the chrome/sheet mints only under `GOLDFINCH_AUTOMATION_ADMIN` (block-buffered
   stdout, TTY-only). Root cause: the apparatus premise was audited for *mechanism* but not *provisioning*.
   The UI surface now ships with manual-HAT verification but no automated regression net — the mission's
   single largest residual gap.
3. **The sheet-side live-update path has no automated coverage** (`sameDownloadsStructure` /
   `updateDownloads` / `paintDownloads`), consistent with project convention for DOM-composition files but
   leaving the correctness-critical update-vs-rebuild fingerprint on code-review + manual eyeballing until
   the deferred behavior test runs.

## Lessons Learned

- **Technical**: three reusable idioms emerged — app-scoped chrome indicator (mirror `#automation-indicator`),
  live sheet content via the suggestions model-replace transport (no push channel), and in-place-update-vs-
  rebuild via a structural fingerprint. All three deserve a named home in CLAUDE.md.
- **Process**: a "HAT-tunable" flag on a design decision is a signal to *resolve* the default at design
  time (cross-checked against the mission outcome), not to defer the reasoning to HAT.
- **Process**: apparatus premise-audits have two halves — *mechanism* (does the code support it?) and
  *provisioning* (will this run session actually be launched with the required scope/keys?). Skipping the
  second surfaces as a mid-run scramble.
- **Domain**: for a "recent activity" indicator, persistence past viewing (until an idle timeout) is the
  mainstream-browser expectation and was implicit in the mission text — the correct default from the start.

## Methodology Feedback

Improvements to Flight Control itself (mission-control skills), surfaced by this mission:

1. **Flight skill** — when a design decision carries a "HAT-tunable" escape hatch, cross-check its
   tentative default against the parent mission's outcome language before flight sign-off. Both DD5
   revisions traced back to the mission doc; the escape hatch let flight design skip reasoning the mission
   text had already answered.
2. **Behavior-test AUTHORING guide** — split the apparatus premise-audit into **mechanism** (code-traced:
   authorization tiers, return shapes) and **provisioning** (session launch flags, key-export path, and
   whether the standard `/behavior-test` or HAT invocation actually satisfies them). Any spec naming a
   privileged apparatus (admin key, elevated MCP scope) should carry a **Provisioning** precondition line
   with the exact launch incantation — a falsifiable planning-time check, not a run-time discovery.
3. **Flight prerequisites** — "the run session's MCP key will be admin-scoped when the behavior test
   executes" is an operational precondition as checkable at planning as any code-shape claim; behavior-test
   flights that need elevated apparatus should list it explicitly.

These are cross-project methodology changes; applying them to the mission-control skills is a follow-up
(recorded as an action item), kept out of this project's tree per the skill/project boundary.

## Action Items

- [ ] **Run `/behavior-test download-indicator` under an admin MCP key** and flip the spec `draft → active`
      — closes the mission's largest coverage gap (Tab-focus retention during a live in-place repaint).
- [ ] **Merge PR [#107](https://github.com/msieurthenardier/goldfinch/pull/107)** after review.
- [ ] **Document the three emergent patterns** in CLAUDE.md (menu-overlay / chrome-indicator section).
- [ ] **(mission-control)** Apply the two methodology improvements above (flight-skill mission-outcome
      cross-check for tunable defaults; AUTHORING provisioning-vs-mechanism premise-audit split).
- [ ] **(Optional)** `/routine-maintenance` — this mission touched shared chrome + sheet surfaces; a
      between-mission health check is available before the next mission, though the diff was additive and
      self-contained.
