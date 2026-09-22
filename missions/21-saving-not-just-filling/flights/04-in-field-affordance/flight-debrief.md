# Flight Debrief: The In-Field Affordance

**Date**: 2026-09-22
**Flight**: [The In-Field Affordance](flight.md)
**Status**: landed
**Duration**: 2026-09-21 (planning, flight start) – 2026-09-22 (HAT passed, landed)
**Legs Completed**: 5 of 5 (`lock-indicator-click`, `password-field-roles`, `generate-in-picker`, `goldfinch-badge`, `hat-and-alignment`)

## Outcome Assessment

### Objectives Achieved

- **Capture correctness (Leg 2).** Password fields in a login scope are classified
  `current`/`new`/`confirm` by a layered, pure rule (`password-field-roles.js`).
  - Capture now saves the NEW password on sign-up and change-password forms, and only
    when a present confirm field agrees.
  - A rotation is filed as an UPDATE to the one login whose stored password equals the
    provenanced current password, with the stored username preserved.
  - The live wrong-value defect found at planning (a rotation would have saved the OLD
    password) is closed.
  - Verified live at HAT step 6: a no-username change-password form updated
    `alice-test` in place.
- **Generate in picker (Leg 3).** "Generate strong password" is the first picker row on
  new-password fields, including while locked.
  - Candidates are CSPRNG over the existing generator, honouring `minlength`/`maxlength`
    and `passwordrules`.
  - `pattern` is checked only in the guest's isolated world.
  - New and confirm are filled with provenance, and the save follows the ordinary
    capture path.
  - Verified live at HAT steps 4, 5 and 7.
- **Badge (Leg 4 + HAT).** The in-field icon is recognisably Goldfinch, but in the
  operator-chosen toggle-pill form (variant A) rather than the planned round
  mark-plus-overlay. It has an "Open Vault" tooltip, and the attribute-key pin is
  unchanged. Verified at HAT steps 1–2.
- **Carried squawks.**
  - **0099** (toolbar lock click) is fixed. The HAT extended it: a locked right-click
    now shows "Unlock now" instead of an empty menu.
  - **0100** (sheet menus dead after closing an internal tab) is root-caused and fixed:
    a same-tick resize of a visible sheet followed by its removal left Chromium's page
    visibility stuck `hidden`. Both squawks are completed and live-verified.

### Mission Criteria Advanced

- ✅ "A password can be generated from within the field being typed, at account creation
  and at password rotation, and the generated value survives into the vault through the
  same save path as a typed one." Met live (HAT 4–6).
- ✅ "The in-field vault affordance is recognisably Goldfinch … legible at in-field size
  in both lock states, on light and dark form fields, while still carrying nothing a
  hostile page could read." Met, with the toggle-pill redesign (HAT 1–2).
- Held: genuine-gesture-only offers and page-proof disposition. DD4's password-match
  disposition reads only provenanced values; the `matchedByPassword` DD3c exemption was
  neuter-verified.
- Held: zero offers on the negative set. `signup-confirm-mismatch` joined the gated
  negatives; `signin-lying-new-password` never reaches the password-match update.
- Held: the capture exclusions. Burner/internal tabs never raise the badge, main
  re-checks set-up/persistent-jar/origin, and generation is absent from the MCP surface
  (grep-verified by two Reviewers).

## What Went Well

- **Design review earned its cost again.** Every HIGH was caught before code:
  - DD3a's missing sibling-field path (flight planning);
  - the `rec.username` null overwrite on a password-matched rotation (Leg 2 round 1),
    which would have been silent vault corruption that looks correct in the UI;
  - the picker dispatch that would have routed both new action rows to "Manage
    passwords" (Leg 3 round 1).

  All three were FD-verified against code before being accepted.
- **Corpus first (DD2) caught a real defect, not just coverage.**
  - Seven of the twelve new fixtures failed on unmodified code for the right reason: the
    change-password shapes saved the CURRENT password.
  - The corpus then caught the planner's first draft reading a whole per-entry snapshot
    as a field record.
- **Neuter checks kept finding things.**
  - Ten recorded neuter checks across Legs 2–3 and the HAT fixes.
  - One exposed a vacuous AC14(d): a "downgrade survives" test on a named-username row
    passes with the exemption removed. It was rewritten against a null-username row.
- **Structural hygiene paid off across flights.** `dropCapture`'s zeroize-every-Buffer
  sweep (M21 F3 LD7) covered the new `currentPassword` secret with zero edits.
- **Sharing beat hand-mirroring.** DD7's two-world hand-mirror was resolved by both
  worlds importing Leg 2's `loginScopeOrdinals`, with no drift guard needed.
- **The two-candidate design held.** DD6/DD7's "send N precomputed options and let the
  low-trust side choose" closed the ReDoS axis by construction, with no retry channel.
  It is the template for "the value must satisfy page constraints but must not be
  computed in the lower-trust world".
- **`renderer.js` zero headroom was respected throughout.** No growth, and the HAT's
  "Unlock now" fix swapped one dependency line 1:1 (still exactly 1550 lines).
- **The HAT was load-bearing, not ceremonial.** 4 of 9 steps failed on first pass (the
  badge, Generate missing, the empty right-click menu, and 0100 still broken after the
  first fix). All were fixed inline, re-verified live, and then reviewed by a Reviewer
  before commit.
- **The design lab was a good improvisation.** When the badge failed, a six-variant
  lab page (actual size in light and dark fields, plus 4×) let the operator pick in one
  round instead of iterating blind.

## What Could Be Improved

### Process

- **DD11's "diagnose 0100 in Leg 1" was planned on an unobservable surface.** The kebab
  and page-context menuTypes are redacted from every capture by design, so an
  automation-first diagnosis could not even distinguish broken from redacted.
  - Pass 1 produced a false-positive "deterministic repro" from blank captures.
  - Pass 2 correctly refuted it but found nothing.
  - The first fix (`setVisible(false)` in `hide()`) was built on an untested hypothesis
    and failed live.
  - What worked was a human repro plus FD instrumentation (`document.visibilityState`),
    then a single-variable experiment matrix driven through the admin MCP with a fresh
    app per run.

  **Critical.** Any defect on a surface named in CLAUDE.md's standing
  unobservable-surfaces list should start with a human repro plus instrumentation, not
  automation.
- **No remedy should ship before one experiment has confirmed the hypothesis.** The first
  0100 fix was implemented, unit-pinned and handed to the operator without a live check.
  The later experiment matrix (web→web fine, internal→web broken, close-first fine,
  reorder fixed) took about ten minutes and would have rejected it immediately.
  **Important.**
- **The visual design was pinned in the flight instead of chosen by the operator.** DD9
  fixed a specific visual form (a round mark with a corner overlay), and Leg 4 built the
  whole builder and its tests around it. The operator rejected it at HAT step 1 as hard
  to read, which forced a full rewrite of `buildVaultLockIcon` and its structural tests.
  The mechanism constraints in DD9 (rebuild whole, attribute pin, legibility) were right;
  the chosen form was a guess. **Important:** visual DDs should pin constraints and put
  an operator-picked design lab BEFORE the implementing leg.
- **Several restarts left a second app instance running.** Twice, because `pkill -f`
  patterns missed the Electron main process or killed the FD's own shell. At least one
  HAT step briefly ran against stale code. **Minor:** restart by PID and verify an
  instance count of exactly 1 (adopted mid-HAT).
- **A flake was reported but never tracked down.** The Leg 2 Developer saw one unnamed
  single-test failure in five runs, and it was never named or reproduced. The flight-end
  Reviewer was asked to watch for it; no run since has failed (three fresh debrief runs:
  0 fail). **Minor:** when a flake is seen, capture the failing test name before
  re-running.

### Technical

- **Owner-check asymmetry (open debt, security-relevant).** `vault-fill-generated`
  requires `getWindowForChrome(event.sender) === getWindowForGuest(wcId)`, while
  `vault-fill-human` and `vault-reachable-items` (`src/main/main.js` ~2401–2410) still
  trust any chrome-supplied `wcId`. The retrofit failed the squawk gate (criterion 3,
  security-sensitive surface), so it needs a planned leg with design review.
  **Important.** Plan it early in Mission 21's next flight, or in a hardening flight.
- **Squawk 0100's fix is at one call site, not a structural guard.** `tab-set-active` now
  closes before `syncBounds`, and an audit found no other resize-then-remove sites. But
  nothing structural stops a future call site from reintroducing the shape. The existing
  CLAUDE.md "WebContentsView native-surface gotcha" talks only about the guest view.
- **The toolbar-menu empty-state class is untested in general.** The locked right-click
  menu was empty because a model returned `[]` in one state (an "omit, don't disable"
  rule with no replacement item). No invariant asserts that every toolbar-mode menu
  model renders at least one item in every state.
- **Boundary vocabulary between hops.** `generateGestureInfo` emits `null` for "no limit";
  the main-side `sanitizeInt` accepted only `undefined`/`-1`. Every hop was unit-tested
  with hand-built inputs, and no test fed one real module's output into the next. Fixed
  with `generate-gesture-contract.test.js` (real preload output → real main validator,
  over 9 fixtures + 1 negative; neuter: 9/11 red).

### Documentation

- CLAUDE.md is current for password roles, generate-in-picker, the toggle badge,
  "Unlock now", and the squawk 0100 sheet rule. `docs/vault.md` is current for roles and
  generation.
- The flight log's Leg 1 entry reports "5458 pass / 3 todo", which is identical to the
  M21 F3 baseline despite Leg 1 adding 3 tests. It is likely a copy slip; later entries
  are internally consistent. Noted here, not rewritten (the log is append-only).

### Test metrics (Developer, fresh runs this debrief)

| Flight | Tests | Wall-clock |
|---|---|---|
| M21 F2 | 5291 (+118) | 7.3–7.9 s (flagged; machine variance) |
| M21 F3 | 5458 (+167) | 5.96 s |
| **M21 F4** | **5654 (+196)** | **6.50 / 6.54 / 6.63 s** (3 runs) |

- 5654 tests: 5650 pass, 0 fail, 0 skipped, 4 todo (the 3 pre-existing known-unsolved
  shapes plus this flight's `current-new-fully-unmarked`, DD1's documented limit). No
  flakes across 3 runs.
- +196 tests is the largest single-flight addition recorded. Wall-clock stays inside the
  established ~5.2–7.9 s band.
- `vault-compromise-rotate.test.js` in isolation takes 2437 ms, matching F3's re-measured
  2430–2560 ms baseline. The scrypt path has not regressed.
- Per-suite timing is not obtainable from `node --test`'s interleaved output. Only
  isolated-file timing is measurable.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|---|---|---|
| Leg 1 re-scoped from `sheet-and-lock-indicator` to `lock-indicator-click`; 0100 moved to the HAT | Two automation diagnoses could not reproduce it (redacted surface); operator ruling | Yes: route unobservable-surface defects to a human repro from the start |
| Badge redesigned at the HAT (toggle pill, variant A) from a six-variant design lab | The operator found the FD draft hard to read | Yes: design lab before the implementing leg for visual DDs |
| "Open Vault" tooltip added as a `<title>` child (not a root attribute) | Operator request; keeps the root attribute-key pin intact | Yes: extra accessible text on pinned SVGs goes in children |
| Generated fill has NO first-field fallback on a stale/null ordinal | FD call: a generated password in the wrong form is worse than no fill | Yes: make it an explicit DD in comparable flights |
| `vault-fill-generated` owner check stricter than older vault handles | A write into a guest from chrome-supplied input | Converge: retrofit the older two (planned leg) |
| Null accepted as "absent" in `sanitizeGenerateConstraints` (HAT fix) | Preload/main boundary vocabulary mismatch hid Generate on every unconstrained field | Yes: a contract test per multi-hop chain |
| Locked right-click shows "Unlock now" (HAT fix) | An empty menu in the locked state | Yes: no toolbar menu may render empty |
| 0100 fixed by reordering close-before-resize in `tab-set-active`; the first remedy (`setVisible(false)` in `hide`) reverted | Live experiment matrix disproved the first remedy | Yes: confirm the hypothesis by experiment before building the fix |
| Owner-check retrofit NOT logged as a squawk | Fails squawk gate criterion 3 | n/a: carried as a flight-level item |

## Key Learnings

1. **On an unobservable surface, a blank capture is not evidence.** Redaction and breakage
   look identical. What cracked 0100 was a state-level probe that *is* observable
   (`document.visibilityState` logged from the sheet's own console) combined with an
   observable stand-in menuType (`site-info`).
2. **"State is correct, pixels are missing" is a recurring Electron class.** This was the
   second instance, after the guest-bounds animation gotcha. The rule generalises: a
   native view's visibility can desync from every API-level read when it is resized and
   removed in one tick.
3. **Per-hop unit tests do not prove a chain.** One contract test that pipes real output
   into real input catches boundary-vocabulary mismatches that per-hop tests structurally
   cannot.
4. **Neuter checks catch vacuous tests that review reads past.** AC14(d) was written as
   specified, reviewed, and green, and it still exercised nothing.
5. **Visual acceptance is a human judgement.** Plan the pick; don't guess the answer and
   rebuild it at the HAT.

## Recommendations

1. **Unobservable-surface diagnosis rule** (Critical). Add to CLAUDE.md's Flight
   Operations project rules: a defect on any surface in the standing unobservable-surfaces
   list starts with a human repro plus FD instrumentation. Automation is used only to run
   a hypothesis-confirming experiment matrix (with an observable stand-in, e.g.
   `site-info`), and no remedy is implemented before an experiment confirms the
   mechanism.
2. **Plan the owner-check retrofit** for `vault-fill-human` / `vault-reachable-items` as a
   design-reviewed leg in Mission 21's next flight (or a hardening flight). It is the one
   open security-relevant thread.
3. **Contract test per multi-hop main↔guest chain.** Make it a leg-design-review
   question, beside the neuter-check rule: "does at least one test pipe each real hop's
   output into the next real hop?" Also add the vacuous-downgrade lesson: a "survives"
   test must use the row shape the guard would otherwise act on.
4. **Visual DDs pin constraints only, and a design-lab step precedes the implementing leg**
   (FD-built variants at actual size on light and dark fields, operator picks), rather
   than an FD draft judged at the HAT.
5. **Extend the CLAUDE.md WebContentsView gotcha to sheets and overlays.** Never resize a
   still-visible overlay view and remove it in the same tick; close first, then resize
   (squawk 0100). Name the call-site idiom the way "Focus-then-send" is named.

## Action Items

- [ ] Owner-check retrofit on `vault-fill-human` / `vault-reachable-items`: a planned leg
      in the next Mission 21 flight (failed the squawk gate: security-sensitive surface).
- [ ] Add the unobservable-surface diagnosis rule and the contract-test-per-chain rule to
      CLAUDE.md's project-specific planning rules (Flight Operations section).
- [ ] Squawk candidates (offered to the operator): (a) extend CLAUDE.md's WebContentsView
      gotcha to overlay views with the close-before-resize idiom; (b) add an invariant
      test that every toolbar-mode `pageContextModel` returns ≥ 1 item in every state.
- [ ] Human-interview items still open (asked, not yet answered): design-lab timing for
      visual work; how the 0100 repro sequence was found.
