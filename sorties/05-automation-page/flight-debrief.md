# Flight Debrief: Automation Page

**Date**: 2026-10-23
**Flight**: [Automation Page](flight.md) (Sortie 05, no parent mission; the charter stands in)
**Status**: completed
**Duration**: 2026-10-23 – 2026-10-23 (chartered, designed, executed, HAT'd and debriefed in one working session)
**Legs Completed**: 2 of 2 (1 autonomous + HAT)
**Plugin version**: mission-control 1.2.2
**Commit / PR**: `1a0ce3e` (leg 1) + `ce929b4` (HAT fixes, landing) on `sortie/05-automation-page`, PR #267

## Outcome Assessment

### Objectives Achieved
The Automation controls now live on their own trusted internal page, `goldfinch://automation`. It covers the enable toggle, address/port, MCP config, per-jar keys, admin key and activity log, and opens from a new ⋯ menu **Automation** item directly above **Vault**. The page uses Settings' sidebar shell (Connection / Keys / Activity). Under the jar list are two plain-text hints: where to create a jar and where to mint a jar's vault access key.

The work came with three structural improvements:
- The kebab action table moved out of `renderer.js` into `createChromePageActions`. `renderer.js` went from 1546 to 1505 lines, and the seam is unchanged.
- A new drift guard (`internal-host-drift.test.js`) ties `INTERNAL_HOSTS`, the page map, both `INTERNAL_ORIGINS` sets and `INTERNAL_JAR_NAMES` together.
- The scroll-spy is now a shared module.

`settings.js` shed about 990 lines.

### Charter Criteria (the sortie's only criteria assessment)

| Criterion | Status | Notes |
|---|---|---|
| ⋯ menu shows Automation directly above Vault; activating it opens `goldfinch://automation` as a trusted internal tab | **met** | HAT H1/H2 by eye (click and Enter; arrow order). The dispatch hop is unit-tested with the real `kebabActions` (AC5b). The trusted open was proven live in the AC25 smoke (origin + `goldfinch-internal` bridge present). |
| Every Automation control behaves as before; Settings has no Automation section or nav entry | **met (with a coverage caveat)** | Controllers and CSS moved verbatim (Reviewer diffed removed vs added hunks; every `automation-*` id unchanged). The AC25 live smoke covered status, address, copy, toggle↔store and the activity log. HAT H4 confirmed Settings by eye. **Caveat**: the three behavior specs for this surface were *not* run (stale pre-existing, squawk 0156), so mint/rotate/revoke and port-save were not exercised end to end on the new page. |
| Plain-text hints point to Cookie jars (new jar) and Vault → Access keys (vault access key) | **met** | HAT H3 after two inline fixes: hints moved below the jar list and spaced; the intro was trimmed. Strings pinned whitespace-normalized. |
| Docs and behavior specs that direct readers to Settings → Automation point at the new page | **met** | DD7 plus the AC23 judged grep. The flight review caught one miss (`farbling-correctness.md`), which was fixed before commit. |

### Checkpoints
All three were met:
- **Kebab extraction**: `renderer.js` landed at 1505 against its 1546 budget.
- **Page and Settings**: the page renders and works; Settings is clean.
- **Docs/specs and smoke**: retargeted; live smoke passed.

On the gates:
- **AC25 sub-check**: one sub-check ("About becomes current" on scroll) was unreachable by automation on this rig. That is pre-existing scroll-spy geometry, not a regression. It was carried to the HAT and accepted by eye.
- **a11y audit**: clean on both `goldfinch://automation` and `goldfinch://settings`.

## What Went Well
- **Design review earned its cost again.** Flight review 1 caught two highs before any code was written:
  - `kebabActionSettings` is a seam entry that three specs drive by name, so moving it wholesale would have thrown a `ReferenceError` at boot.
  - `INTERNAL_JAR_NAMES` would have labelled the tab "Settings".

  Review 2 caught a fake regex in `tab-controller.test.js` that would have let the new name test pass vacuously. The leg review caught an unverifiable AC (internal tabs render no dot).
- **Drift guard over checklist.** `internal-host-drift.test.js` is neuter-verified across all five lists. It turns the "missed one origin list → page silently loses its bridge" failure class into a red test, so the next internal page is self-checking.
- **Extraction paid for the feature.** Moving the kebab actions next to their `open*Page` siblings freed 41 lines of `renderer.js` budget. The seam stayed byte-identical through a three-line wrapper.
- **Verbatim move discipline.** The Reviewer diffed removed against added hunks and found only header/import/scroll-spy-call differences, which made "behaves exactly as before" credible without re-testing every control.
- **The HAT caught what static review can't.** The dense hint block (`main section p { margin: 0 }`) and the redundant "shown once" sentence were both seen only on the rendered page. Sortie 01's recommendation to include a visual review paid off.
- **Fix-vs-feature gate worked.** The clickable-links request was recognized mid-HAT as a feature that reversed a charter constraint. It was surfaced with a design sketch, and the operator deferred it to a follow-up sortie instead of widening this one.

## What Could Be Improved

### Process
- **Spec runnability wasn't checked at design.** DD7 re-authored three behavior specs' URLs and strings, but nobody ran or substrate-checked them. They turned out to read a store file (`settings.json`) retired by the app.db migration, and to expect pre-Flight-8 status strings. This was discovered only at HAT step H5, which left the charter's "behaves as before" criterion without an executed spec. **Operator ruling: check specs at flight design** — when a flight retargets or relies on a spec, verify its last-run date and substrate (files, tables, strings) and fold any fix-up into the flight.
- **Sibling-registration sweep missed two consumers at first design.** The FD's initial code read found the obvious onboarding points but not `INTERNAL_JAR_NAMES` (a chrome-side host enumerator) or the seam entry. A grep for an existing sibling's identifier (e.g. `vault`, `'Settings'`) across `src/ test/ scripts/ tests/behavior/`, with every hit dispositioned, would have found both before review.
- **Two ACs targeted unobservable or unreachable states.** These were the dot-title check (internal tabs have no dot) and the scroll-spy "About becomes current" check (the geometry never reaches it). Both are cases of the standing "check the apparatus can observe it" rule, applied late.

### Technical
- **Pre-existing scroll-spy bug, now on two pages.** At typical viewport heights the first section stays in the observation zone at maximum scroll, so the last link never becomes current. The code moved verbatim; the bug is not new, but it now affects Automation too.
- **`automation.js` is 933 lines** of three verbatim IIFE controllers with no mock-DOM unit coverage (`settings.js` never had any either). It is a split candidate on the `vault-*-controller.js` pattern if the page grows.
- **`internal-assets.test.js` keeps a synthetic map** with a settings `/audit-paging.js` route that no longer matches the real map. This is harmless, since that test uses its own fake, but it can mislead.
- **The `eaddrinuseMessage` string change** is unpinned, as was the old text.

### Documentation
- CLAUDE.md is current: the 1505 budget, the five-host list, `INTERNAL_JAR_NAMES`, and the drift guard in "Adding an internal page". A debrief-crew concern that it still read 1546 was checked by the FD and is wrong.
- The README's Settings and kebab descriptions were already stale before this sortie and were left untouched.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|---|---|---|
| DD2 kept a `kebabActionSettings` wrapper in `renderer.js` | Seam entry driven by name from three specs (design review 1) | Yes. Before moving any `renderer.js` function, grep the seam tail and `tests/behavior/` for its name |
| AC25 dot-title live check dropped; unit pin is the only proof of "Automation" as the tab name | Internal tabs render no dot (`tab-controller.js` dot branch) | No. One-off apparatus fact, now recorded |
| AC25 scroll-spy sub-check replaced by a hide-first-section probe, then by eye at HAT | Pre-existing observer geometry | Yes, as a rule: an AC that relies on scroll-position UI needs a geometry check before it's written |
| HAT fixes 1–2 (hint placement and spacing, intro trimmed) | Visual density visible only when rendered | Partially. Budget one HAT pass for copy and layout on any page with new prose |
| H5–H7 behavior specs skipped → squawk 0156 | Specs stale before this sortie (retired store, old strings) | Yes, as a design-time check (operator ruling) |
| Clickable hint links deferred to a follow-up sortie | Feature that reverses a charter constraint; operator ruled to defer | Yes. The fix-vs-feature gate did its job |

## Key Learnings
- **Every internal-page enumerator is now self-detecting.** Add a host to `INTERNAL_HOSTS` and the drift guard names every list that still lacks it. Future "add a page" work starts from a red test, not a checklist.
- **The evaluate seam reaches beyond `renderer.js`.** Seam names are a contract with `tests/behavior/*.md`. Any move or rename of a `renderer.js` function must grep the specs as well as `seam-contract.test.js`.
- **"Re-authored" is not "runnable."** A spec edited for a URL change can still be dead on a retired substrate. Only a run, or at least a substrate check, proves a spec is live.
- **Apparatus facts:**
  - Internal tabs render no container dot, so the container name surfaces only via `tab.container.name`.
  - The tab strip shows "Automation" while `<title>` is "Automation — Goldfinch".
  - Prettier wraps long hint strings, so copy pins must compare whitespace-normalized text.
- **Internal-page cross-links design (for the follow-up)**, per the Architect assessment:
  - It is sound as sketched: an origin-gated `internal-open-page { page }` channel with a closed allowlist, sender-resolved owner routing (never last-focused), and the chrome calling trusted `createTab`.
  - Map page→URL from one table drift-guarded against `INTERNAL_HOSTS`, never a raw host from the payload.
  - Make a missing or closing sender record a no-op, and keep it out of the MCP surface.
  - Rule on reusing an existing tab versus opening a new one.
  - Don't copy `internal-open-tab-in-jar`'s handler shape: it opens untrusted web URLs.

**Test metrics** (Developer run on `ce929b4`):
- **Counts**: 6032 tests in 26 suites — 6028 pass, 0 fail, 0 skipped, 4 todo (the known `save-moment-corpus` cases). No flakes.
- **Wall-clock**: median ~7.4 s across three runs (7.45 / 8.82 / 7.41 s). That is +64 tests versus sortie 04 (5968 at 6.43 s) and about +1 s, which is inside the historical 5.2–7.9 s band.
- **Likely cause**: host noise, not this flight. The untouched heavy-KDF vault suites ran slower than in sortie 04 (`vault-compromise-rotate` 2.64 vs 2.56 s, `vault-txn` 2.31 vs 2.01 s, `vault-context` 1.78 vs 1.60 s). Other prior top-ten files (`vault-import-logins`, `download-path`, `dev-profile`) dropped out, and `navigation-controller` held at 1.43 s.
- **This flight's files**: all eleven new or changed test files run 58–96 ms each, and none entered the top ten.
- **Next step**: re-measure on a quiet host before declaring a new band, per sortie 03.
- **Line budgets**: `renderer.js` is 1505/1505 (retargeted; 41 lines freed); `bookmarks-bar.js` is 1076/1100, unchanged.

## Human Interview
- **Clickable links**: the operator "only realized at HAT". Seeing the rendered page made the want obvious, and the charter-time question (plain text recommended) did not steer the choice. Deferral to a follow-up sortie is the operator's ruling.
- **Spec upkeep**: the operator wants spec runnability checked at flight design, not discovered at HAT (see Process).
- **Friction**: nothing notable for the size of the change.

## Methodology Observations
All observed on mission-control **1.2.2**.

1. **Flight skill, Phase 2 (code interrogation): no prompt to sweep sibling registrations.**
   - **What happened**: for "add an instance of an existing kind" work (a new internal page, menu item or host), the skill's code-interrogation step asks what code relates, not "where is every existing sibling registered?". The FD's first design missed a chrome-side host enumerator and a seam-reachable function. Both were caught by Architect review 1 as highs.
   - **Expected**: a step that greps an existing sibling's identifier and dispositions every hit, the same technique as a grep-AC but run at design time.
   - **Cost**: one extra design-review cycle (the second of two allowed) spent on findings a sweep would have produced.
2. **Flight skill, Phase 4/5 (behavior-test authoring and verification approach): no runnability check for *existing* specs a flight retargets.**
   - **What happened**: the skill prompts authoring new specs and vetting the apparatus, but says nothing about verifying that an existing spec the flight edits or depends on still runs. Its substrate may have been retired by an intervening change; here a store file disappeared in a migration.
   - **Expected**: a design-time check of last-run date plus referenced substrates for every spec named in the verification approach.
   - **Cost**: the HAT's three behavior-spec gates were unrunnable and were skipped. The charter criterion was accepted on weaker evidence, and a squawk was opened.
3. **Agentic-workflow, Phase 2a (leg design): the AC-observability audit is not explicit at leg level.**
   - **What happened**: two leg-01 ACs targeted states the apparatus could not observe or reach (a dot that doesn't render, a scroll position the geometry never reaches). The leg-design review caught one, and the Developer hit the other at smoke time.
   - **Expected**: the leg-design risk checks include "can the named apparatus observe each AC's state?" (the flight skill has the two-axis premise audit; the leg phase doesn't restate it).
   - **Cost**: one AC dropped at review and one substituted mid-leg and carried to the HAT. No defect resulted.
4. **Behavior-test skill, Phase 1 (validate spec): shape-only validation.**
   - **What happened**: Phase 1 validates section presence but not whether the spec's Preconditions and Observables reference substrates that still exist. Here that was a file path the app no longer writes.
   - **Expected**: an optional substrate check before spawning crews (referenced files, tables, literal UI strings).
   - **Cost**: none this time. The FD found it by manual probe before spawning, which avoided roughly 13 checkpoints × 2 agents of wasted runs. But nothing in the skill prompted the probe.
5. **Sortie skill, step 2 (charter) vs HAT: a charter constraint was challenged at HAT.**
   - **What happened**: the charter's "plain text, no new channel" constraint was operator-agreed, then reversed by the operator at HAT on seeing the rendered page. The agentic-workflow's fix-vs-feature gate handled it correctly by deferring to a new sortie, but the sortie skill has no explicit path for "a charter constraint reversal discovered at HAT".
   - **Expected**: guidance that a reversed charter constraint at HAT routes to a follow-up sortie by default, unless the operator amends the charter with a scoped design review.
   - **Cost**: none; recorded for the sweep.

**Sortie vehicle fit**: right-sized. There was one decision cluster (page split, host onboarding, kebab placement, hint copy) and one autonomous leg plus a HAT. The one second-cluster candidate, cross-links with a new IPC channel, was correctly kept out of scope. A squawk would have been wrong: a new trusted origin, a security-sensitive allowlist change and a seam-adjacent extraction all needed design review. A mission would have been ceremony.

## Recommendations
1. **Plan the internal-page cross-links follow-up sortie**, starting from the Architect-tightened sketch (Key Learnings): single-table allowlist drift-guarded against `INTERNAL_HOSTS`, owner-routed, no-op on a missing record, outside MCP, plus a ruling on tab reuse.
2. **Complete squawk 0156** (re-author and run the three automation behavior specs), so the new page has executed end-to-end coverage for mint, rotate, revoke and port-save.
3. **Add two planning rules to CLAUDE.md's project-specific planning list**:
   - (a) "add another X" work greps an existing sibling's identifier across `src/ test/ scripts/ tests/behavior/` and dispositions every hit at design time;
   - (b) any behavior spec a flight retargets or relies on gets a last-run and substrate check at design.
4. **Fix the scroll-spy last-section selection** (choose the last intersecting section or the one nearest the top at end-of-scroll) with a geometry-aware mock test. It now affects two pages.
5. **Re-measure the test wall-clock on a quiet host** before recording a new band.

## Action Items
- [ ] Follow-up sortie: internal-page cross-links (clickable Keys hints → Cookie jars / Vault). Plan via `/mission-control:sortie`.
- [ ] Squawk 0156: re-author and run `settings-automation`, `settings-activity-viewer`, `automation-key-gating`.
- [ ] Squawk 0157: scroll-spy never marks the last section current at end of scroll (Settings `#about`; also the Automation page).
- [ ] Squawk 0158: README's Settings and ⋯-menu descriptions are stale (pre-existing).
- [ ] Squawk 0159: `internal-assets.test.js` synthetic map carries a settings `/audit-paging.js` route the real map no longer has.
- [ ] CLAUDE.md planning rules (a) and (b) from Recommendation 3. These need an operator decision on wording, so they are not squawks.
