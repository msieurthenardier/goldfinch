# Flight Debrief: Parity Sweep, Mission Landing & v0.6.0 Release

**Date**: 2026-07-09
**Flight**: [Parity Sweep, Mission Landing & v0.6.0 Release](flight.md)
**Status**: landed
**Duration**: 2026-07-08 (plan) → 2026-07-09 (landed + shipped)
**Legs Completed**: 6 of 7 (Leg 7 release-smoke optional + non-gating, skipped)

## Outcome Assessment

### Objectives Achieved
The flight landed exactly as designed: browser-behavior parity proven on the native surface, the Flight-5
carry-forwards + the parked `<webview>` sweep folded, macOS build-readiness verified, `mission/05` merged to
`main`, and **v0.6.0 released with all installers**. The plan was unusually accurate — only DD7 was materially
refined; the deviations that surfaced were caught by the review gate, not shipped.

### Mission Criteria Advanced (the mission LANDS here)
- **SC1** — native guest surface: source-absence of the functional `<webview>` forms verified (Leg 2, DD10).
- **SC3** — browser-behavior parity: the browsing/tab-strip/chrome-UI corpus PASS 8/8 on the native surface (Leg 1).
- **SC8** — frameless/controls parity: Linux/WSLg in-loop; **macOS by build-readiness** (installer builds green
  in CI; runtime deferred, DD2).
- **Mission landing**: `mission/05` → `main` (`761aec0`); shipped as **v0.6.0** (release run `29027676740`,
  6/6 jobs; all installers). With SC2/4/5/6/7 already met, the WebContentsView migration is complete.

All checkpoints met. The build was validated by a **green build-only dry-run before the tag** — no broken build
was ever published.

## What Went Well
- **Plan accuracy.** 7 legs mapped cleanly to natural boundaries; the sequential dependency (Leg 2's `<webview>`
  sweep rewords specs Leg 1 drives) was identified and honored; Leg 7 correctly scoped optional/non-gating and
  skipped (packaging validated three ways: local build + CI dry-run + real release build).
- **DD6 — test-shape-as-acceptance-criterion (the standout).** The Architect's pre-flight [HIGH] caught that the
  existing `automation-nav` internal-refusal tests pass `deps` WITHOUT `allowInternal`, so they'd stay green even
  with the guard broken. Making "new tests MUST assert `allowInternal:true` refusal per op" a hard Leg-2 criterion
  converted a would-be "landed-done-with-bug-intact" into 5 real admin-path tests. A guard whose only meaningful
  exercise is the privileged/relaxed path needs a test constructed on that path — or coverage is illusory.
- **The build-only dry-run before the tag earned its keep** even going green first-time: it validated the
  workflow's **publish gating** (create-draft/publish/update-readme correctly SKIP without a tag), converting
  "never tag a broken build" from a hope into a checked precondition, and licensing the operator to authorize the
  irreversible tag with confidence.
- **The operator-gated outward-facing sequence** — parity → merge → push → dry-run → **STOP** → tag — kept the
  hard-to-reverse publish behind an explicit checkpoint. Clean, reusable release-flight template.
- **529 resilience.** Two transient `529 Overloaded` API errors mid-Leg-1 were absorbed with a ~5-min backoff and
  **no work lost** — because run logs are per-spec and timestamped. Resilience from artifact granularity, not heroics.
- **`nav.js` hardening closes the last asymmetry.** `navigate`/`goBack`/`goForward`/`reload` now carry the same
  op-local `isInternalContents` guard as `zoom`/`find`/`print`/`observe` — the internal-session trust model is
  coherent across the whole automation surface for the first time, even under admin `allowInternal:true`.
- **`<webview>` sweep clean** (prose/comments only; SC1 holds), with an incidental doc-accuracy fix riding along
  (`webview-preload.js` header: stale `sendToHost` → the actual `send('guest-media-list')`).

## What Could Be Improved

### Process / Planning
- **"Build-readiness" for a multi-arch platform was under-specified (DD2).** `macos-latest` defaults to Apple
  Silicon, so the shipped mac artifact is **arm64-only** — no Intel/x64 build exists. This surfaced as a *note at
  Leg 6*, not a named DD scope line. A build-readiness decision for a multi-arch platform should enumerate which
  arches the CI runner actually produces.
- **The CI dry-run's venue was discovered mid-flight (DD7).** `workflow_dispatch` needs the code on a *remote*
  branch; pushing the feature branch trends into the operator-gated zone. The refinement (dry-run runs
  post-merge-pre-tag on `main`) was sound and logged — but future release flights should **plan the dry-run into
  the on-`main`-pre-tag slot from the start**, and carry a prereq "CI dry-run requires code on a pushable remote branch."
- **The "public publish" framing was inaccurate** — the repo is PRIVATE, so the release is collaborator-only.
  The gating was still correct (a tag is hard to reverse), but the risk was overstated in planning; repo
  visibility should be a pre-flight known.

### Technical
- **Page-context Escape reconciliation was wrong** (Anomaly). F6 Leg 2 "reconciled" CLAUDE.md to `#kebab` based on
  the F5 behavior observation, but code truth is `returnFocus` else `els.address.focus()` (right-click → address
  bar). The final Reviewer caught it and reverted to code-accurate before merge. **Lesson: an observed-behavior
  reconciliation does not override source truth** — the `#kebab` observation was a keyboard/`returnFocus` scenario
  mis-generalized.
- **SC3 per-spec Validator was deferred** during the 529 spike (Leg 1 accepted on Executor evidence + FD triage;
  the final flight Reviewer covered the whole diff). Acceptable given the lower-stakes parity specs + the Reviewer
  backstop, but noted.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| DD7 CI dry-run → post-merge-pre-tag (not feature branch) | `workflow_dispatch` needs a remote branch | Yes — plan the dry-run into the on-`main`-pre-tag slot from the start |
| Two 529 backoff-and-retry cycles (Leg 1) | Transient server-side API overload | The resilience: yes — long agent legs should checkpoint at per-unit (per-spec) granularity so an overload death is resumable |
| CLAUDE.md page-context Escape reverted to code-accurate | Leg-2 reconciliation trusted an observation over source | Yes — source is authoritative; observations get re-verified, not enshrined |
| Leg 7 release-smoke skipped | Packaging validated 3× (local + dry-run + real build); non-gating | Yes — a green publish is not held hostage to an optional smoke |

## Key Learnings
- **Test-shape-as-acceptance-criterion** for privileged-path guards (DD6) — the single most valuable pre-flight call.
- **The build-only dry-run before a tag validates publish *gating*, not just the build**, and licenses the
  irreversible tag — standardize it even when it goes green first-time.
- **The operator-gated outward-facing sequence** (parity→merge→dry-run→STOP→tag) is a reusable release template.
- **"Build-readiness" ≠ a single green CI job for a multi-arch platform** — enumerate arches.
- **Per-unit artifact granularity is what makes long agent legs resilient** to transient API failures.

## Recommendations
1. **arm64-only mac** — decide explicitly whether v0.x needs Intel/x64 mac reach; if so, add an x64 (or universal)
   mac matrix entry to `.github/workflows/build.yml`. Today it's a silent installer-coverage gap. (→ mission debrief.)
2. **Unsigned mac** — proper Developer-ID signing + notarization is a post-release follow-up gated on obtaining a
   cert; keep it visible so it isn't forgotten once a cert exists. (→ mission debrief.)
3. **`update-readme` auto-commit to `main`** — documented (DD11) and expected, but consider changing the job to
   open a PR rather than push directly to `main`; at minimum keep a runbook note so a future operator doesn't
   misread the bot commit as drift.
4. **Page-context Escape** — re-observe per invocation (right-click vs keyboard) and reconcile
   `tests/behavior/page-context-menu.md`'s expected result to the code truth (`returnFocus` else address bar).
5. **Settings-page a11y coverage gap** — the axe harness can't inject into the internal `goldfinch://settings`
   target (the DD5 exclusion that makes internal pages safe also makes them un-auditable in-loop). A mission-level
   question: how to a11y-audit internal pages without weakening the exclusion. (→ mission debrief.)

## Action Items
- [ ] **→ Mission debrief:** macOS runtime verification (keyboard-bridge HAT + CDP/find-count/focus-ring items);
  arm64-only mac (decide x64/universal); unsigned mac (signing+notarization once a cert exists); the belt-and-
  suspenders live two-agent re-run of the 2 BLOCKING security specs; the settings-page a11y coverage gap.
- [ ] Re-observe + reconcile the page-context Escape target (`page-context-menu.md`).
- [ ] Consider `update-readme` → PR-instead-of-push; or a runbook note.
- [ ] Cosmetic: set `desktopName` in the electron-builder linux block (window-association nicety).

## Test Metrics (this debrief, fresh run on `main`)
- `npm test`: **1065/1065 pass**, 0 fail, 0 skipped, no flakes; **~5.25 s** wall, 12 suites. `npm run typecheck`
  clean (~1.75 s); `npm run lint` clean (~1.45 s).
- **Delta:** F3 951 → F4 947 → F5 1060 → **F6 1065 (+5)** — fully attributed to the 5 new admin-path
  `automation-nav` tests (nav suite 26 → 31). Live count matches the flight-log claim exactly.
