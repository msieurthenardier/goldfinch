# Leg: sheet-type-dispatch

**Status**: completed
**Flight**: [Identity Fill and Capture](../flight.md)

## Objective

Replace the binary login/card branching in the two vault sheet templates with a
type-keyed dispatch table, and extract the auth/cert challenge subscriptions and
overlay states out of `renderer.js` into a new sibling controller — buying the
line headroom the later legs need — **with zero behaviour change**.

## Context

- **Flight DD3** (extraction is its own first leg) and its round-2 correction.
- **Flight DD5** fixes the family precedence (login > card > identity) that the
  dispatch table must be able to express, but this leg adds **no** identity
  entry — the table gains its third key in Leg 3/Leg 4.
- **Flight DD12** grants a seam ruling in advance; this leg does not use it and
  must not change `SEAM_COUNT`.
- This leg is the only one in the flight with **0 unproven adversarial axes**.
  Its entire value is that it lands green before a third family exists anywhere.

## Inputs

- `src/shared/vault-picker-template.js` — 8 binary family branch sites + 1 copy
  line (verified: `:120`, `:312`, `:313`, `:318`, `:319`, `:324`, `:336`, `:352`;
  copy at `:303`).
- `src/shared/vault-capture-template.js` — 4 binary family branch sites
  (`:124`, `:127`, `:132`, `:133`).
- `src/renderer/renderer.js` — **exactly 1577 lines** by
  `test/unit/seam-contract.test.js`'s own metric (`split(/\r?\n/).length`),
  against `RENDERER_LINE_BUDGET` **1577** (`seam-contract.test.js:300`). Zero
  slack.
- Existing coverage that pins current behaviour: `test/unit/vault-picker-template.test.js`
  (11 tests), `test/unit/vault-capture-template.test.js` (7 tests),
  `test/unit/vault-card-picker.test.js`, `test/unit/audit-hooks.test.js`,
  `test/unit/seam-contract.test.js`. *(An earlier draft also listed
  `overlay-menus.test.js`; design review verified it carries zero
  `auth-basic`/`cert-picker` references — generic factory coverage, so citing it
  here overstated its relevance. It still runs as part of the suite.)*

## Outputs

- Both templates dispatch per item/model type through a single declared table.
- New `src/renderer/chrome/auth-challenge-controller.js` owning the two
  challenge subscriptions and their two overlay states.
- `renderer.js` at **≤1562** lines; `RENDERER_LINE_BUDGET` lowered to the landed
  value.
- No change to rendered output, DOM shape, copy strings, `SEAM_COUNT`, or the
  a11y audit's `open:` strings.

## Acceptance Criteria

- [x] **AC1 — Picker dispatch.** `vault-picker-template.js` resolves a row's
      family through ONE declared table keyed by item `type`, replacing all 8
      binary branch sites. The table supplies, per kind: the section heading
      label, the generic fallback title, the row icon builder, and the secondary
      line. No `=== 'card'` / `!== 'card'` literal remains in the module
      **except** inside that table's own `card` entry.
- [x] **AC2 — Unknown types still render as login, byte-identically.** The
      current code treats every non-`'card'` type as a login (`:312` is
      `type !== 'card'`). `kindOf(item)` must preserve that exactly: an item
      whose `type` is absent, `'login'`, `'note'`, or anything unrecognised
      resolves to the `login` entry. Pinned by a new test asserting an unknown
      type renders the login icon and the `'Login'` generic title.
- [x] **AC3 — Sectioning generalises without changing today's output, INCLUDING
      for a null array entry.** Section headings currently appear iff both
      families are present. The replacement is "≥2 distinct kinds present", and
      the kind-set MUST be derived from **`rows.filter(Boolean)`**.
      **Why this is not a detail** (design review, verified by probe): today's
      precomputation is `rows.some(r => r && …)` (`:312-313`), so a null entry
      contributes to NEITHER boolean — while that same null entry, once reached
      by the render loop, renders as a login (`item || {}`). For the model
      `[null, {type:'card'}]` today's output is **unsectioned**; a natural
      reimplementation deriving kinds via `rows.map(kindOf)` — with
      `kindOf(null) === 'login'`, which is correct for the render loop — computes
      2 kinds and flips it to **sectioned**. That is a real output change, and no
      existing test covers it, so it would sail through AC9. Two derivations over
      the same array, deliberately: `filter(Boolean)` for sectioning, `item || {}`
      for rendering.
- [x] **AC3b — The null-entry case is pinned by a NEW test.** A model of
      `[null, { type: 'card', … }]` renders with no section headings. Added, not
      modified — AC9 is unaffected.
- [x] **AC4 — The empty-picker copy has exactly one home.** `'No saved logins or
      cards to fill here'` moves to a single named module constant. The string is
      **byte-identical** this leg (Leg 4 changes it). A grep finds the literal
      exactly once in the module.
- [x] **AC5 — Capture dispatch.** `vault-capture-template.js` resolves the offer
      family through ONE declared table keyed by `model.kind`, replacing all 4
      binary branch sites, supplying per kind: the heading noun, the subject row
      label, and the subject value text (including its `'(no username)'` /
      `'(card)'` fallback). An absent or unrecognised `kind` resolves to `login`,
      preserving today's `model.kind === 'card'` behaviour.
- [x] **AC6 — The challenge flow is extracted whole, into its own module, in the
      ESTABLISHED controller shape.** A new
      `src/renderer/chrome/auth-challenge-controller.js` exposes
      `createAuthChallengeController(deps)` which wires BOTH
      `onAuthChallengePresent` and `onCertChallengePresent` **inside the factory
      body, at construction time**, and returns `{ overlayStates }` — nothing
      else. `renderer.js` constructs it and spreads the states (the
      `...vaultController.overlayStates` precedent at `:528`).
      **⚠ CORRECTED at design review — the first draft invented a shape.** It
      required a separate "subscription wiring function" that `renderer.js`
      "calls once". Neither sibling controller does that: `vault-controller.js`
      wires its bridge subscriptions inside the factory (from `:185`) and returns
      `{ overlayStates, handleActivation, … }`; `downloads-controller.js` does
      the same for its two (`:162-166`) and returns `{ overlayState, … }`.
      Follow them. Subscribing at construction is safe because the callbacks fire
      only asynchronously.
      **It must NOT be folded into `vault-controller.js`** — flight DD3 records
      why (`legs/01-renderer-extraction.md:58` and `vault-controller.js:16-18`
      both draw that boundary deliberately).
- [x] **AC6b — The now-false comment in `vault-controller.js` is corrected in
      THIS leg.** Its header (`:16-18`) currently reads "NOT owned here … **stays
      in renderer.js**: onAuthChallengePresent / onCertChallengePresent …". After
      this leg that is false. Update the wording to point at
      `auth-challenge-controller.js` — the boundary it describes is unchanged and
      still correct; only the destination is. Leaving a false comment behind is
      not an acceptable "out of scope".
- [x] **AC7 — The audit hooks do NOT move.** `openAuthBasicOverlayForAudit` and
      `openCertPickerOverlayForAudit` already live in
      `src/renderer/chrome/audit-hooks.js` (M20 F2 Leg 1, DD11) and are
      destructured in `renderer.js` at `:1189-1190` purely to feed the seam tail.
      Both the destructure and the seam entries stay exactly as they are.
      `SEAM_COUNT` remains **41**.
- [x] **AC8 — The budget lands lower, and is pinned there.** `renderer.js`
      measures **≤1562** by the test's own metric, and `RENDERER_LINE_BUDGET` is
      set to the landed value (lock in the headroom; do not leave slack), with a
      comment naming this leg and the reason, matching the existing
      `VAULT_PAGE_LINE_BUDGET` / `BOOKMARKS_BAR_LINE_BUDGET` idiom.
- [x] **AC9 — Zero behaviour change, proven not asserted.** The full suite passes
      with **no test modified to accommodate the refactor**. New tests may be
      ADDED (AC2's unknown-type pin, AC3b's null-entry pin, AC4's single-literal
      grep). The ONLY sanctioned edit to an existing test file is the
      `RENDERER_LINE_BUDGET` constant AC8 authorizes — a budget pin, not an
      assertion about behaviour. An existing *assertion* that has to be loosened
      or rewritten is a FAILURE of this leg, not a fix: if one blocks, stop and
      report rather than editing it.
      **BLOCKED — see flight-log.md's "AC9 blocker" anomaly entry.** Two
      pre-existing tests OUTSIDE this leg's cited Inputs/Files-Affected scope
      now fail as a direct, non-behavioral consequence of AC6's extraction:
      `test/unit/cert-picker-template.test.js`'s renderer.js source-scan
      regression pin (looks for the challenge handler body, which correctly
      moved per AC6) and `test/unit/vault-restore-workflow-invariants.test.js`'s
      hardcoded `assert.equal(lines, 1577, …)` renderer.js line-count pin (a
      second, independent copy of the fact `RENDERER_LINE_BUDGET` already
      tracks). Neither reflects a behaviour change. Both were left UNEDITED per
      this AC's own stop-and-report instruction, since fixing either falls
      outside the one sanctioned test edit. Flight Director decision needed.
      **RESOLVED via AC11's amendment**: both are source-LOCATION pins, not
      behavioural assertions, and were retargeted (not loosened) per AC11 below.
      Full suite now green with zero existing assertion weakened — see AC10.
- [x] **AC11 — Two source-LOCATION pins are retargeted to follow the moved code
      (AMENDMENT, 2026-09-20 — see the Amendment block below).** Neither is an
      assertion about behaviour; both pin WHERE a fact lives, and this leg moves
      it.
      1. `test/unit/cert-picker-template.test.js:140-148` reads `renderer.js` and
         regex-matches the `openOverlayMenu('cert-picker', { certs: … })` call.
         That call moved to `auth-challenge-controller.js` per AC6. Retarget the
         **file it reads**; leave the regex itself unchanged. The test's other
         end (the `menu-overlay.js` init-gate half) is untouched.
         **Done**: the `rendererSource` read + its three `assert.match` call
         sites (the object-model send, the `onCertChallengePresent` destructure,
         the `host` spread) were retargeted to read
         `src/renderer/chrome/auth-challenge-controller.js` instead, renamed to
         `challengeControllerSource`. All three regexes matched the moved code
         **verbatim, unchanged** — no wrap-insensitive rewrite was needed. The
         `sheetSource` (`menu-overlay.js`) half is untouched. Assertion failure
         messages were reworded from "renderer.js's…" to "auth-challenge-
         controller.js's…" (message text only, not asserted against).
      2. `test/unit/vault-restore-workflow-invariants.test.js:126` —
         `assert.equal(lines, 1577, …)`, a SECOND independent copy of the
         renderer.js line-count fact. Update the literal to the landed value, in
         lockstep with `RENDERER_LINE_BUDGET`, exactly as its own comment history
         shows has been done on ~8 prior legs.
         **Done**: literal updated `1577 → 1550`, matching `RENDERER_LINE_BUDGET`
         (`seam-contract.test.js:306`), with a new "Retargeted again (Mission 21
         Flight 3 Leg 1, sheet-type-dispatch, AC11.2 …)" comment appended in the
         same style as the ~8 prior entries, naming the auth/cert challenge
         extraction as the reason and cross-referencing squawk 0096 for the
         underlying duplication (deferred, not fixed here).
- [x] **AC11b — The retargeted cert-picker pin is NEUTER-VERIFIED.** CLAUDE.md's
      standing rule: *"Every re-target from an exact-literal pin to a regex-target
      one is neuter-verified."* Temporarily break the protected shape in
      `auth-challenge-controller.js` (e.g. send the bare-array model form), confirm
      the test goes **RED**, then restore. Record the observed failure in the
      flight log. A retarget that cannot be shown to still bite is a silently
      disabled test.
      **Done** — see flight-log.md for the full observed RED output. Summary:
      temporarily replaced the `onCertChallengePresent` handler body with
      `openOverlayMenu('cert-picker', Array.isArray(certs) ? certs : [], null, 0)`
      (the bare-array form); `node --test test/unit/cert-picker-template.test.js`
      went from 8/8 pass to **7 pass / 1 fail**, with subtest 6 ("REGRESSION (M14
      F3 HAT): the LIVE cert-picker model shape…") failing
      `AssertionError` on the exact message "auth-challenge-controller.js's
      cert-challenge-present handler must send the { certs, popup? } object
      model". File was then restored to its exact original content (confirmed
      by rerunning the same test back to 8/8 green).
- [x] **AC10 — Gates clean**: `npm test`, `npm run lint`, `npm run typecheck`,
      `npm run format:check`.
      `npm run lint` / `npm run typecheck` / `npm run format:check` are all
      clean. `npm test`: 5289/5291 relevant tests pass; the 2 failures are
      exactly AC9's blocker above, not independent gate failures.
      **Updated**: after AC11's retargets, `npm test` is fully green — 5291
      pass / 0 fail / 3 todo (pre-existing, unrelated). `npm run lint`,
      `npm run typecheck`, `npm run format` (no-op, tree already formatted),
      and `npm run format:check` all clean. Local gates stood in for hosted
      Concourse CI, which needs an interactive login unavailable here — hosted
      CI did not run.

## Amendment — 2026-09-20 (Flight Director)

**This leg was amended while `in-flight`.** The methodology holds legs immutable
once in-flight, so the change is recorded here as a dated block rather than
edited silently into the criteria above, and the deviation is logged in
`flight-log.md`.

**What changed**: AC11/AC11b added, authorizing two test retargets AC9 had not
anticipated.

**Why this is a citation gap, not a requirements change**: the leg's intent —
zero behaviour change, no loosening of any behavioural assertion — is unchanged
and unweakened. What was wrong was my ENUMERATION of which mechanical pins track
the code this leg moves. My design-time citation audit searched for
`RENDERER_LINE_BUDGET` and for consumers of the two templates; it never searched
for the literal `1577`, nor for source-scan pins that READ `renderer.js` from
other suites. Both misses are the same defect class Flight 2's debrief named
(*"search for unclaimed sites; don't confirm claimed ones"*) — repeated here, one
flight later, by me.

**Why not abort-and-recreate** (the methodology's stated remedy for an in-flight
leg needing change): the implementation is complete and correct against AC1-AC8
and AC10, and the Developer stopped precisely where AC9 told it to rather than
editing around the problem — exactly the behaviour the criterion was written to
produce. Discarding correct work to re-issue a near-identical leg would be
ceremony that destroys value and loses the audit trail this block preserves.

**The underlying duplication is NOT fixed here** — two test files independently
hardcoding renderer.js's line count is its own defect, logged as **squawk 0096**
and deferred. This leg does what all ~8 prior legs did: retargets both by hand.

## Verification Steps

- AC1/AC5: `grep -n "'card'" src/shared/vault-picker-template.js
  src/shared/vault-capture-template.js` — every remaining hit is inside a
  dispatch-table declaration or a doc comment.
- AC2: new unit test in `vault-picker-template.test.js` rendering a model with
  `type: 'note'` and `type: undefined`.
- AC3/AC9: `npm test` with the pre-existing picker/capture template tests
  unmodified. Confirm via `git diff --stat test/` that no existing test file
  lost or changed an assertion.
- AC4: `grep -c "No saved logins or cards to fill here"
  src/shared/vault-picker-template.js` → `1`.
- AC6: `grep -rn "onAuthChallengePresent\|onCertChallengePresent\|'auth-basic'\|'cert-picker'" src/renderer/renderer.js`
  → no subscription bodies and no overlay-state entries remain.
  `grep -n "auth" src/renderer/chrome/vault-controller.js` → the header's
  NOT-owned-here note is still accurate (the new controller does not change it).
- AC7: `node --test test/unit/seam-contract.test.js` passes with `SEAM_COUNT`
  unchanged at 41; `node --test test/unit/audit-hooks.test.js` passes untouched.
- AC8: `node -e "const fs=require('fs');console.log(fs.readFileSync('src/renderer/renderer.js','utf8').split(/\r?\n/).length)"`
  → ≤1562, and equal to the new `RENDERER_LINE_BUDGET`.
- AC10: run all four gates. **Note**: local Concourse CI needs an interactive
  login unavailable to the crew — state plainly in the flight log that the local
  gates stood in for it, never that CI ran.

## Implementation Guidance

1. **Do the templates first, one at a time, running their tests after each.**
   Start with `vault-capture-template.js` (4 sites, simplest shape) to establish
   the table idiom, then `vault-picker-template.js`.
2. **Table shape** — a module-level `const` mapping kind → descriptor, plus a
   `kindOf()` resolver that falls back to `'login'` for anything unrecognised.
   Resolve membership with `Object.prototype.hasOwnProperty.call(TABLE, type)` or
   a `Set`, never a bare `TABLE[item.type]` truthy check — a `type` of
   `'constructor'` or `'toString'` would otherwise resolve through
   `Object.prototype`. Cheap, and in keeping with this codebase's defensiveness.
   Keep the descriptors data (strings and builder function references), not
   branching logic, so Leg 4 adds a key rather than editing a function body.
3. **Sectioning** (AC3): derive the present kinds from the rows, section when the
   distinct-kind count is ≥2, and emit headings in the order the rows already
   appear. Do not re-sort — the existing code does not, and the
   `data-pick-index` → model index mapping depends on order being untouched.
4. **Then the extraction.** New controller, constructed in `renderer.js` beside
   the existing controllers; spread its `overlayStates`. Follow
   `vault-controller.js`'s construction shape (subscriptions inside the factory,
   per AC6), but keep the module separate from it.
   **⚠ Temporal dead zone**: the controller is constructed around `renderer.js:424`,
   but the `openOverlayMenu` const is not declared until `:796`. Pass it the way
   `vault-controller.js` already does — as an unevaluated closure
   (`openOverlayMenu: (...args) => overlayMenuClient.open(...args)`), never a
   direct reference to the const, which would hit the TDZ.
5. **Measure the budget LAST**, after `npm run format`, since Prettier decides
   the final line count. `seam-contract.test.js:290-298` records that a prior
   budget bump's estimate "undercounted the wrapper-function/comment-block cost"
   of an extraction — expect the add-back (import + construction + spread) to eat
   12-16 of the ~47 gross lines removed, landing ~30-35 net against a required
   15. If the extraction under-delivers, extract more from the same challenge
   flow rather than reaching into unrelated surfaces.

## Edge Cases

- **A `note` item in the picker model.** Today it renders as a login (`:312`'s
  `!==`). `kindOf` must keep that. Do NOT add a `note` table entry — notes are
  not fillable and are not in the picker's reachable set; adding one would be
  new behaviour.
- **`secondaryLineFor` is exported** and used outside the row loop — keep it
  exported with its current signature; route its internal branch through the
  same table rather than giving it a private second one.
- **`buildRowBadges`** is family-independent — leave it alone.
- **A model that is not an array**, and a `null` item inside the array: both are
  already handled (`Array.isArray` guard; `item || {}`). Preserve both.
- **The capture card's `aria-label`** is derived from the heading with
  `heading.slice(0, -1)` — that must keep producing "Save password" / "Update
  card" exactly.

## Files Affected

- `src/shared/vault-picker-template.js` — dispatch table, 8 branch sites, copy
  constant
- `src/shared/vault-capture-template.js` — dispatch table, 4 branch sites
- `src/renderer/chrome/auth-challenge-controller.js` — **new**
- `src/renderer/renderer.js` — remove 2 subscriptions + 2 overlay states, add
  construction + spread
- `src/renderer/chrome/vault-controller.js` — header comment only (AC6b)
- `test/unit/seam-contract.test.js` — `RENDERER_LINE_BUDGET` only
- `test/unit/vault-picker-template.test.js` — ADD the AC2/AC3b/AC4 pins
- `missions/.../flight-log.md` — leg entry

## Citation Audit

Every citation in this artifact re-probed against the working tree at
2026-09-20, on branch `flight/03-identity-fill-and-capture` (base `016e540`):

- `renderer.js` = 1577 by the test metric; `RENDERER_LINE_BUDGET` = 1577 at
  `seam-contract.test.js:300` — **confirmed**.
- Picker branch sites `:120,312,313,318,319,324,336,352`; copy at `:303` —
  **confirmed by direct read**.
- Capture branch sites `:124,127,132,133` — **confirmed**.
- Challenge subscriptions at `renderer.js:1357-1381` (the first draft said
  1356; that line is blank — corrected at design review); overlay states at
  `:498-519` — **confirmed**.
- Audit hooks already extracted to `chrome/audit-hooks.js`, destructured at
  `renderer.js:1189-1190`, seam entries at `:1565-1566` — **confirmed**.
  *(This corrects the flight's round-2 review note, which described the audit
  hooks as part of the extractable block; they were extracted at M20 F2 Leg 1
  and only their binding remains.)*
- Dispatch no-op cases for `auth-basic`/`cert-picker` live in
  `chrome/overlay-dispatch.js:134,141`, NOT in `renderer.js` — **confirmed**;
  they are therefore out of this leg's extraction scope.
- `...vaultController.overlayStates` spread precedent at `renderer.js:528` —
  **confirmed**.

---

## Post-Completion Checklist

- [x] All acceptance criteria verified — **AC1-AC11b all verified. AC9's
      blocker was resolved by AC11's amendment (two source-location pins
      retargeted, not loosened); AC11b's neuter-verification is recorded in
      flight-log.md; AC10 gates are fully clean.**
- [x] Tests passing — **5291/5291 pass (3 pre-existing todo, unrelated); 0 fail**
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed`
- [x] Check off this leg in flight.md
- [x] Do NOT commit — this flight batches review and commit after the last
      autonomous leg (flight Technical Approach)
