# Flight Debrief: Top-Bar Download Indicator + Downloads Popup

**Date**: 2026-07-19
**Flight**: [Top-Bar Download Indicator + Downloads Popup](flight.md)
**Status**: landed
**Duration**: 2026-07-19 (single session — design through HAT)
**Legs Completed**: 4 of 4

## Outcome Assessment

### Objectives Achieved

The flight delivered a persistent, app-scoped download indicator in the top bar (left of the window
controls) plus a sheet-hosted downloads popup with per-row open / reveal-in-folder actions and a link to
the full downloads page. All three autonomous legs landed clean; the HAT leg surfaced and closed two
real alignment gaps. Final state: `npm test` 2242/2242, `npm run typecheck` clean, `npm run lint` clean,
`npm run a11y` passed live (new `downloads-button` + `sheet:downloads` states, no new violations).

### Mission Criteria Advanced

All eight mission success criteria are satisfied and operator-verified:
- Persistent indicator visible while active/recent, hidden when idle ✓ (Chrome-like persistence after HAT)
- State conveyed accessibly via `aria-label` (not color/animation alone) ✓
- Popup lists current + recent ✓
- Open completed file / reveal in folder / in-progress not openable ✓ (external effects HAT-verified)
- Footer opens `goldfinch://downloads` ✓
- Open/reveal never trust a renderer path (id-resolved main-side, completion-gated) ✓
- App-scoped: present on internal tabs, independent of `toolbarPins` ✓
- `npm run a11y` passes ✓; existing behavior tests unaffected ✓

## What Went Well

- **On-pattern implementation, no shortcuts.** The pure-model→render split
  (`downloads-indicator-model.js` reducer vs. `downloads-controller.js` DOM apply) mirrors
  `buildAutomationIndicatorModel`/`renderAutomationIndicator` precisely; the `downloads` menu-overlay
  template followed the established registration pattern (no `items` getter, input-dialog Tab-cycle,
  `role="dialog"`); the trust boundary landed with an id-only shared resolver + completion gate and the
  internal handler refactored onto it rather than forked. `textContent`-only filenames and the FD-ruled
  evaluate-seam count bump (19→21 with `seam-contract.test.js` + CLAUDE.md co-updated) all followed
  project discipline.
- **Risk-tiering earned its keep.** Leg 3 (HIGH) took two design-review cycles that caught two
  HIGH-severity issues *before any code ran*: a `fixedTriggerMenu` misuse that would have thrown on every
  open/close, and a disabled-first-button focus trap. The landed code was clean because the gate caught
  them pre-implementation — validation that the HIGH-risk design-review gate pays for itself.
- **The HAT leg + fix-vs-feature gate worked as designed.** HAT absorbed one FIX (recent-persistence,
  inline) and one FEATURE (live popup progress, promoted to a scoped design review before implementation).
  The FEATURE promotion was the correct process call, not a failure.
- **Live-progress reused an existing transport instead of adding surface.** The live popup progress rides
  the same model-replace-via-reopen path the `suggestions` template already uses — no new IPC channel, no
  `src/main`/preload change — so DD2's "no push channel" invariant held literally true.
- **Healthy test metrics.** +119 tests over the prior flight (2123 → 2242, reconciling exactly with the
  flight log's running count), wall time flat-to-improved (~2.04s vs. the prior 2.45–2.74s) despite the
  additions. No new failures, skips, or flakes.

## What Could Be Improved

### Process

- **DD2 and DD5 were both revised at HAT, and both revisions were foreseeable at design time.** This cost
  a full implement → HAT → re-design → re-implement round-trip on each.
  - **DD5** (idle/acknowledge policy) shipped as "hide on acknowledge," which the operator immediately
    rejected — but the *mission's own outcome language* ("a persistent, glanceable place… to see that a
    download is in flight or **recently finished**") already implied persistence past viewing. The final
    policy (persist until idle; acknowledge only clears an "attention" emphasis) was derivable from the
    mission text alone. DD5 correctly flagged itself "HAT-tunable," but shipped the escape hatch instead of
    doing the cross-check the hatch was signalling.
  - **DD2** (snapshot-at-open) treated "live" and "new push channel" as synonymous, then rejected live —
    but a shipped counterexample (the `suggestions` template's live model-replace) already existed in the
    same file family. A design-time survey of existing menu-overlay templates would have found the
    eventual Option 1 up front.

### Technical

- **The sheet-side live-update path has zero automated coverage — the flight's single largest verification
  gap.** `sameDownloadsStructure` / `updateDownloads` / `paintDownloads` (`menu-overlay.js`) and the
  `renderer.js` opener/dispatch glue have no `node:test` coverage. This is *consistent with project
  convention* (DOM-composition files are exercised via `npm run a11y` + behavior tests, not `node --test`),
  but the correctness-critical `sameDownloadsStructure` fingerprint (id + completed-flag → update-vs-rebuild)
  currently has only code review + manual HAT eyeballing behind it. A bug there would silently stop live
  updates or cause a focus-stealing rebuild mid-Tab-cycle.
- **The `download-indicator` behavior test was deferred** (admin MCP apparatus unavailable in-session — see
  Deviations). Manual HAT verification is an adequate *one-time* gate but leaves this surface with no
  regression net against future refactors of the shared sheet machinery.

### Documentation

- Three reusable idioms emerged that deserve a named home in CLAUDE.md's menu-overlay / chrome section
  rather than living only as inline comments: (1) **app-scoped indicator** = mirror `#automation-indicator`
  (hidden badge button in `#tabstrip`, `no-drag`, reducer→deriveModel→DOM, `aria-label` as state-of-truth,
  never touches `toolbarPins`); (2) **live sheet content** = reuse the suggestions model-replace transport
  (re-invoke `open()` on the already-open entry), never add a push channel; (3) **in-place-update vs.
  rebuild** = structural-fingerprint check → patch-in-place else full rebuild, rAF-coalesced and gated on
  `overlayMenus.<x>.open`.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| DD5 acknowledge: on-open → on-close (design review) → persist-until-idle (HAT) | Original hid the trigger under its own popup, then hid recent downloads against the mission's persistence intent | The **policy** (persist until idle) → yes, as the default for recent-activity indicators. The **process lesson** (cross-check "HAT-tunable" defaults against mission outcome text at flight sign-off) → yes |
| DD2 snapshot-at-open → live model-replace refresh | Operator flagged the static snapshot as "frozen"; a live-update transport already existed | The **transport reuse** (suggestions model-replace for live sheet content) → yes, name it a standard pattern |
| Leg-2 content boundary: `context.js` IDS entry moved from Leg 3 → Leg 2 | The button's id registration travels with its markup | Minor; good FD practice (caught + logged pre-implementation), no standardization needed |
| `download-indicator` behavior test deferred | Run session's MCP was jar-scoped; admin key mints only under `GOLDFINCH_AUTOMATION_ADMIN` (stdout, block-buffered when piped) | The **premise-audit lesson** (audit apparatus *provisioning*, not just *mechanism*) → yes, see Recommendations |
| Leg-3 in-progress rows: disabled button → no button (text only) | A disabled first button created a focus trap on popup open | Yes — buttonless in-progress rows is the correct pattern here; don't reintroduce a disabled button |

## Key Learnings

1. **A "HAT-tunable" flag on a design decision is a smell to resolve at design time, not defer.** Both DD5
   revisions traced back to the mission's own outcome language. When a flight author suspects a default
   might be wrong enough to flag it tunable, cross-check it against the mission text before locking it in.
2. **Before defaulting a new UI to a limited mode "to preserve an invariant," survey the codebase for an
   existing pattern that achieves the richer behavior within the invariant.** DD2's live-vs-snapshot
   dilemma was already solved by the suggestions template; the invariant ("no push channel") was never
   actually in tension with "live."
3. **Apparatus premise-audits have two orthogonal halves: mechanism and provisioning.** DD6 correctly
   audited the *mechanism* (admin-scoped `getChromeTarget` works, exercised by `a11y-audit.mjs`) but not
   the *provisioning* (will the specific run session be launched with an admin key, and can the key reach
   the MCP config given it's block-buffered stdout?). The provisioning half is just as falsifiable at
   planning time and belongs in Prerequisites.
4. **The HIGH-risk design-review gate is load-bearing.** Leg 3's "Implementation Guidance" code samples
   contained two HIGH-severity bugs; the gate caught both pre-code. Treat HIGH-risk legs' code samples as
   drafts to be adversarially reviewed, which the risk-tiering already assumes.

## Recommendations

1. **Run `/behavior-test download-indicator` with an admin key as a near-term must** — not a someday item.
   Launch `GOLDFINCH_AUTOMATION_ADMIN=1 npm run dev:automation`, capture the admin key from a TTY (not a
   pipe), point the MCP config at the admin key + printed port, run the test, and flip the spec
   `draft → active` on pass. This closes the flight's single largest coverage gap, specifically the
   Tab-focus-retention-during-live-repaint path that has no automated coverage today.
2. **Document the three emergent patterns** (app-scoped indicator, live-sheet-content transport reuse,
   in-place-update-vs-rebuild) in CLAUDE.md's menu-overlay/chrome section so the next flight reuses rather
   than re-derives them.
3. **Adopt two methodology practices** (skill-effectiveness feedback — carried to the mission debrief):
   (a) the **flight skill** should cross-check any "HAT-tunable" default against the parent mission's
   outcome language before sign-off; (b) the **behavior-test AUTHORING guide** should split premise-audit
   into *mechanism* (code-traced) and *provisioning* (session launch flags / key-export path), and any
   spec naming a privileged apparatus should carry a "Provisioning" precondition line.
4. **If a DOM-shape / accessibility-audit-style regression net gets built for any menu-overlay template,
   extend it to cover the downloads live-update path** — a lightweight non-snapshot stand-in until the
   behavior test runs (consistent with the standing preference for DOM-shape/a11y assertions over golden
   files).

## Action Items

- [ ] Run `/behavior-test download-indicator` under an admin MCP key; flip spec `draft → active` on pass.
- [ ] Add the three emergent patterns to CLAUDE.md (menu-overlay / chrome-indicator section).
- [ ] (Methodology, mission-control) Add a "provisioning vs. mechanism" split to the behavior-test
      premise-audit guidance, and a mission-outcome cross-check for HAT-tunable defaults to the flight skill.
- [ ] (Optional) Add a `deriveModel` `allPaused`-with-mixed-set label assertion to the reducer unit tests.
- [ ] Merge PR [#107](https://github.com/msieurthenardier/goldfinch/pull/107) after review.
