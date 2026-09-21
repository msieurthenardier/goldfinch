# Flight Log: Identity Fill and Capture

**Flight**: [Identity Fill and Capture](flight.md)

## Summary

**Legs 1-4 (all autonomous legs) landed, passed flight-end code review
(`[HANDOFF:confirmed]`, no blocking issues), and are committed.** Leg 5
(`hat-and-alignment`, optional) is pending the operator.

- **Leg 1** `sheet-type-dispatch` — type-keyed dispatch in both vault sheet
  templates; auth/cert challenge flow extracted to `auth-challenge-controller.js`;
  `renderer.js` 1577 → 1550. Zero behavioural assertions touched.
- **Leg 2** `multi-hold` — one pending capture per (tab, family); `captureRelease`
  returns an array; a serial chrome-side offer queue incl. the locked-vault drain;
  a per-family detach watch. Post-landing: a stuck-`sheetOpen` defect found and
  fixed in scope.
- **Leg 3** `identity-fill` — identity fillable end to end (detection, third icon
  kind, picker, `fillHuman`); the fill-precision regression closed for all three
  families by reusing `resolveOrdinalInFamily`.
- **Leg 4** `identity-capture` — identity capture with fail-closed three-way
  dispatch, zeroize-every-Buffer, `classifyCapture` wired to a live caller, a
  field-labels-only offer model, and `billing-jostens` promoted to `offers`.

Suite 5294 → **5432** tests, 0 failing. Squawks opened and deferred: **0096**,
**0097**, **0098**. Five enumeration misses by the Flight Director across planning
and legs, each caught by review before shipping — the recurring theme of this
flight, and the main input its debrief should examine.

---

## Reconnaissance Report

Source artifacts walked against current code at planning (2026-09-20): Flight 2's
debrief action items and carry-forwards, and Mission 21's Known Issues. Every row
carries a literal probe, per Flight 2's debrief recommendation 1.

| item | classification | evidence | recommendation |
|---|---|---|---|
| Fill-precision regression (M21 F1 Leg 3; mission Known Issue 3) | `confirmed-live` | `webview-preload.js:441,453` call `consumeFillTarget` and discard the returned node; `vault-entry-observer-bootstrap.js` `fillLogin(cred)` / `fillCard(card)` pass no target arg; `fillLoginForm`'s `targetPassword` param still present and functional at `vault-fill-fields.js:145` | close in Leg 3 via an integer ordinal (DD9) |
| `renderer.js` line budget | **`drifted` — worse than the debrief recorded** | Debrief says "1576 against 1577 = one line of slack". `wc -l` = 1576, but `seam-contract.test.js:373` measures `split(/\r?\n/).length` = **1577** against `RENDERER_LINE_BUDGET` **1577** (`:300`). **Zero slack.** The debrief's figure came from the wrong metric | extraction is mandatory and must be its own first leg (DD3) |
| "11 `isCard` sites (7 picker + 4 capture)" | `partially-satisfied` — count depends on what is counted | **Corrected at design review.** `vault-capture-template.js`: 4 (`:124,127,132,133`). `vault-picker-template.js`: 8 (`:120,312,313,318,319,324,336,352`). Total **12** branch sites, plus `:303`, a three-way COPY line that is not a branch. This flight's own first recon said 13, and miscited `:303` as a branch and `:312` as `===` when it is `!==` — recorded rather than quietly fixed, because the flight claims probe-backed inputs | Leg 1 scopes against 12 + 1 copy (DD3) |
| Unwired `classifyCapture` (debrief rec 4) | `confirmed-live` | `identity-profile.js` exports `classifyCapture` / `identityProfileOf`; `grep -rn classifyCapture src/` finds zero callers outside its own module | hard-zero AC in Leg 4 (DD10) |
| LD3 family precedence decided, never exercised | `confirmed-live` | `isClaimedByLogin` at `vault-identity-fields.js`; `findAllIdentityFields` has no caller anywhere in `src/` | Leg 3 enacts; Leg 4's gesture arm exercises it |
| Identity corpus fixtures | `confirmed-live`, detection-only | `manifest.js`: `billing-jostens` and `incident-report-third-party`, both `tier: 'gated', assert: 'detects', family: 'identity'` | promote per DD4, `tier` and `assert` together |
| Vault page renders/edits identity by hand | `already-satisfied` | `vault.js:1083` `ITEM_SUBSECTIONS` includes `{ type: 'identity', … }`; `vault-editor-model.js:65` `EDITOR_LAYOUT.identity` | **retired** — this flight owns only the page-facing path |
| Automation must stay login-only | `already-satisfied` (structurally) | `vault-context.js:357` (`item.type !== 'login'` continue), `:493`, `:549` (`resolveItem(…, item => item.type === 'login')`) | **retired as work**; kept as a negative AC pin (DD7) |
| Squawks 0093 / 0094 / 0095 | `confirmed-live`, out of scope | all three `**Status**: open`; all are Flight 2 documentation/sign-off hygiene | route to a squawk turnaround, not this flight |
| Mission Known Issue 2 (bounded plaintext retention, DD3i) | `confirmed-live`, accepted | `vault-entry-observer.js` `PROVENANCE_TTL_MS = 15 * 60 * 1000` | unchanged; identity inherits the same bound, no new decision |
| Backfill a M21 F1 debrief (debrief action item) | `needs-human-recheck` | `ls missions/21-saving-not-just-filling/flights/01-the-save-moment/` → `flight-log.md`, `flight.md`, `legs` — no `flight-debrief.md` | operator's call; outside this flight |

### Two structural findings not present in any source artifact

Both were found by code interrogation during this planning pass, not carried
forward from a prior debrief.

**1. One hold per tab, and a checkout spans two families.** `holdGestureLogin`
(`vault-human.js:501`), `holdGestureCard` (`:561`) and `capture` (`:431`) each
evict **every** capture record for the wcId before storing — predicate
`rec.wcId === wcId`, family-blind. `captureRelease(wcId)` (`:607`) returns the
**first** pending-settle record. `resolveGestureTarget`
(`vault-gesture-policy.js`) returns exactly one `{kind, ordinal}`. So one gesture
yields at most one offer, and on the mission's own motivating page (card fields
plus billing identity fields) the card wins and the billing identity is never
offered. Mitigated by DD1. Mitigating fact, also probed: the three **bulk**-drop
functions are already family-blind and key on `wcId` alone, so they cover a
second concurrent record with no new drop wiring.

**2. Identity has no secret-bearing role.**
`snapshotHasProvenancedSecret(entrySnapshot, kind)` gates on exactly one role per
family (`password` / `number`, via `secretRoleForKind`). Identity has eleven
roles and no anchor-of-value, so "is this capture worth holding?" is an open
value-layer question with no existing answer. Mitigated by DD2.

### Design-review note on a third finding

`vault-item-schema.js`'s `SCHEMA.identity` declares ten of eleven identity fields
**secret** (only `title` and `fullName` are not). The existing capture sheet is
metadata-only by design. Rendering DD2's (Flight 2) "naming exactly which fields
change" as from/to value pairs would therefore put PII into a sheet model for the
first time. Closed by DD6 — field names only, values consumed main-side.

---

## Flight Director Notes

**Phase file loaded**: `.flightops/agent-crews/leg-execution.md` — structure
validated (Crew / Interaction Protocol / Prompts all present, every prompt
fenced). Developer and Reviewer both Sonnet; Accessibility Reviewer disabled.

**Branch**: `flight/03-identity-fill-and-capture`, cut from `main` (`016e540`).
Flight 2's debrief commit (`31452bb`) is unmerged on its own branch and is
deliberately NOT in this base — it lands via its own PR. Side effect worth
noting so nobody reads it as a regression: on this branch
`missions/21-.../02-identity-items/flight.md` reads `landed`, not `completed`,
because the `completed` transition lives in that unmerged commit.

**Flight status**: `ready` → `in-flight`.

**Leg 1 risk tier: HIGH** → design review runs. Three of the skill's triggers
fire: (1) shared-interface change — both sheet templates are consumed by
`menu-overlay.js`, and `secondaryLineFor` is an exported symbol with callers
outside the row loop; (2) the leg edits a pinned contract test
(`RENDERER_LINE_BUDGET`) sitting immediately beside `SEAM_COUNT`, which the leg
must NOT touch; (3) this exact surface already produced a false precedent claim
that survived into flight review round 1 and was only caught in round 2 — a
second pair of eyes on the same ground is cheap insurance. The leg is otherwise
the flight's only 0-unproven-axes leg, so the tier is driven entirely by blast
radius, not by design uncertainty.

**Leg 1 design review — round 1 verdict `approve with changes`; round 2
deliberately SKIPPED, per this project's own standardized lesson.** Flight 2's
debrief standardized "match the review instrument to the defect class, stated out
loud" (marked *Yes* to standardize). All three substantive findings here were
**precedent/enumeration defects** — mechanically checkable by reading two files —
and I verified each one myself with a probe before accepting it, rather than
taking the reviewer's word:

- **[HIGH] AC6 invented a controller shape.** The draft required a separate
  "subscription wiring function". Verified: `vault-controller.js` wires its
  bridge subscriptions inside the factory (from `:185`) and returns
  `{ overlayStates, handleActivation, … }`; `downloads-controller.js` does the
  same (`:162-166`) returning `{ overlayState, … }`. Neither exposes a subscribe
  step. AC6 rewritten to the established single-factory shape — which also
  removes a contradiction with the leg's own Implementation Guidance step 4.
- **[MEDIUM] A real, silent output divergence in AC3's generalization.**
  Verified by probe: today `hasLogins = rows.some(r => r && r.type !== 'card')`
  excludes a null entry from the kind evidence, while the render loop treats that
  same null as a login. For `[null, {type:'card'}]` today renders **unsectioned**;
  a natural `rows.map(kindOf)` reimplementation flips it to **sectioned**. No
  existing test covers it, so it would have passed AC9's gate. AC3 now mandates
  `rows.filter(Boolean)` for the kind-set, and AC3b adds a pinning test.
- **[MEDIUM] `vault-controller.js:16-18` would be left saying something false**
  ("stays in renderer.js"). Folded into the leg as AC6b rather than deferred —
  a comment that lies about a boundary is worse than one that is merely stale.
- **[LOW]** Citation off-by-one (`:1356` is blank; the block starts `:1357`) —
  corrected in the Citation Audit.

Also applied from the review's non-blocking suggestions: an explicit TDZ warning
(the controller is constructed ~`:424`, `openOverlayMenu` is not declared until
`:796`, so it must be passed as an unevaluated closure exactly as
`vault-controller.js` already does); `hasOwnProperty`/`Set` membership in
`kindOf` rather than a bare truthy lookup; the historical budget-undercount note
from `seam-contract.test.js:290-298`; AC9 reworded to explicitly sanction the
`RENDERER_LINE_BUDGET` edit; and `overlay-menus.test.js` dropped from Inputs
(verified to carry zero `auth-basic`/`cert-picker` references — its relevance was
overstated).

A second design-review round would have re-read the same two controller files to
re-derive facts already probe-confirmed. Leg status → `ready`.

**Leg 2 (`multi-hold`) risk tier: HIGH** → design review runs. Three triggers:
(1) **state-machine / lifecycle change** — the capture record's concurrency model
changes from one-per-tab to one-per-(tab, family), and the `mode` lifecycle
(`pending-settle` → `locked`/`save`/`update`) now has two records in flight at
once; (2) **shared-interface change with existing consumers** —
`captureRelease`'s return contract goes object-or-null → array, with **30
references across three test files** (grepped, not assumed); (3)
**security-sensitive surface** — every path here holds, copies, or zeroizes a
plaintext secret Buffer, and the aliasing hazard `captureRelease` already guards
(copy-before-drop, because `dropCapture` zeroizes) becomes a per-iteration
concern inside a loop.

The leg carries one leg-scoped decision of its own, **LD1**, settling the
flight's deferred detach-watch question: per-family watched sets, settle stays
payload-free and tab-scoped, with the early-release of a sibling family's hold
named as an accepted wrong-moment cost. Adding a `kind` to the settle payload
was considered and rejected — it would let a guest-supplied value steer which
held record is released, against that channel's own documented trust shape.

**One explicit carry-over correction from Leg 1**: that leg's AC9 made "an
existing assertion changed" a failure signal. Leg 2 deliberately breaks a return
contract, so tests asserting the old one MUST change. The leg states this
distinction directly (AC13) so the implementing Developer does not inherit Leg
1's stop-and-report reflex where it does not apply — the discipline there is
same-strength contract updates, never a loosened assertion.

Leg 2's citation audit also applied squawk 0096's lesson directly: it grepped
`captureRelease` across the whole tree to find UNCLAIMED consumers, rather than
confirming only the sites the flight spec named.

**Leg 2 design review — round 1 verdict `approve with changes`; one HIGH that
would have shipped the exact bug the leg exists to fix.**

- **[HIGH] A FOURTH family-blind supersession loop, uncited in the leg, in DD1,
  and in my Citation Audit.** `vault-human.js:765-767`, inside `captureCard`
  itself. Verified independently: `grep -n "\.wcId === wcId"` returns
  `:431, :510, :563, :611, :766, :1028` — four supersession loops (`:611` is
  `captureRelease`'s pending finder, `:1028` is a bulk drop that is correctly
  family-blind). Also verified `capture`/`captureCard` have **no callers
  anywhere in `src/` outside `captureRelease`**, so every card release re-enters
  `:766`; left family-blind it would find and zeroize the login offer `capture()`
  had created moments earlier in the same synchronous pass. The leg would have
  landed green against AC1-AC3 and still shipped the defect.
  **Why my audit missed it**: I grepped the spelling `rec.wcId === wcId`.
  `captureCard` binds its loop variable as `prior`. The reviewer found it by
  grepping the SHAPE (`\.wcId === wcId`) instead. Leg artifact, DD1, and the
  Citation Audit all corrected; AC1b added with its own two-order test.
- **This is the THIRD enumeration miss of this flight** — the renderer
  line-count pin (squawk 0096), the audit-hooks location in Leg 1, and now this.
  All three share one root cause: I searched for the shape I expected to find
  rather than the shape the code could take. Squawk 0096's lesson was "search for
  unclaimed sites"; the sharper version this finding teaches is **search by
  shape, not by spelling**. Recorded here because the pattern is now a trend, not
  an incident.
- **[MEDIUM] The two chrome queues had two advance points.** Guidance 4 said
  `handleClosed` is the single advance site; Guidance 5 said the locked drain and
  presentation queue are "separate lifecycles" — which, followed literally, wires
  two independent on-close triggers off one event, the exact race Guidance 4
  forbade. Resolved as AC5b with the reviewer's own proposed reading confirmed:
  a locked entry, once finalized, is pushed onto the SAME presentation queue, so
  there is genuinely one `advance()` with an explicit order.
- **[MEDIUM] AC10's "not unit-testable" was a resignation, not a fact.** True
  that `webview-preload.js` cannot be required under `node --test`; false that
  the LD1 logic therefore cannot be tested. It touches only `MutationObserver`
  and `.isConnected`, both injectable, and CLAUDE.md names Electron-free
  injected-deps modules the default for exactly this class, with
  `vault-entry-tracker.js` as the standing precedent for this same boundary.
  AC10 now REQUIRES extraction into a pure module, AC10b pins its behaviour.
  Accepted without argument: resigning one of the leg's two unproven axes to a
  grep-AC was the wrong call.
- **[LOW]** Four `vault-controller.js` citations off by one (each landing on the
  comment above the target). Corrected; the guidance to resolve by grep rather
  than line number stands.
- Suggestions applied: the synchronous-loop invariant (AC12b); AC12's grep
  compared against a baseline of 4 rather than empty.

**Round 2 WILL run**, unlike Leg 1's. The instrument matches the defect class
here: Leg 1's findings were precedent-matching, closable by reading two files I
then read myself. These changed the leg's MECHANISM (a required extraction, a
unified advance point) and exposed an enumeration blind spot that has now
recurred three times in one flight. A second adversarial pass over the amended
leg is warranted on that record alone.

**Leg 2 design review — round 2 verdict `needs rework`. Cycle cap reached;
ESCALATED to the operator.**

Round 2 confirmed all five round-1 fixes held, then found **two HIGHs, both
inside the `advance()` design I wrote to close round 1's MEDIUM.** Verified
independently before accepting:

- **[HIGH] My "one caller, and nowhere else" rule made the locked drain
  unstartable.** A successful unlock closes the **`vault-unlock`** sheet, not
  `vault-capture` — `vault-controller.js:604-606` states this outright ("a
  SUCCESSFUL unlock closes this sheet too"). So `handleClosed`'s `vault-capture`
  branch never fires for it, and nothing could start the drain. A fresh
  already-unlocked offer arriving while idle had the same problem: no sheet to
  close. **Restricting callers was the wrong mechanism entirely** — safety
  belongs in an idempotent `sheetOpen` no-op guard INSIDE `advance()`, which
  makes extra callers harmless. Now three named callers (AC5b).
- **[HIGH] `advance()` would have fired on occlusion-class closes.** Verified:
  `vault-capture` is deliberately ABSENT from `VAULT_BLUR_SURVIVAL_MENU_TYPES`
  (`vault-blur-survival.js:24` names the exclusion), and `register-tab-ipc.js`
  closes any open sheet unconditionally on `tab-set-active`/`tab-hide`. The
  existing branch guards only `reason !== 'superseded'`, so blur, tab-switch,
  tab-hide and teardown all reach it — alt-tabbing would have popped the next
  save-password sheet open on an unfocused window, and a tab switch would have
  opened it over an unrelated tab. Closed by AC5c, reusing the codebase's OWN
  resolution-vs-occlusion vocabulary from `auth-challenges.js` rather than
  inventing a reason list. LD2 added: an occlusion close dismisses the remaining
  queue rather than orphaning it, consistent with the head offer already being
  dismissed on blur today.
- **[MEDIUM] `eslint.config.mjs` would have failed the AC14 lint gate.** There is
  no `src/preload/**` wildcard — only explicit `files:` lists — so AC10's new CJS
  module falls through to `sourceType: 'module'` and errors `'module' is not
  defined`. The reviewer proved it with a throwaway probe file rather than
  reasoning about it. AC13b added.
- **[MEDIUM] My own amendment left the document self-contradictory.** I corrected
  AC10 away from a grep-AC but never updated the matching Verification Steps
  bullet, which still said the watch was "NOT directly reachable". Fixed.

**Why this escalates.** The methodology caps design review at two cycles and says
to escalate if issues persist. They have — and the pattern matters more than the
count: round 1 found an enumeration gap, and my fix for it introduced two HIGHs
of a different class. Two of three of my design judgements on this leg have now
needed correction by review. The findings themselves are all closed above, each
against a named in-codebase precedent, so the leg is implementable as amended —
but the decision to proceed without a third adversarial pass is the operator's,
not mine.

**Operator ruling on the Leg 2 escalation (2026-09-20): proceed to implementation
as amended.** Three options were put: split the leg (FD recommendation — land the
twice-stable main-side half, give the chrome-side queues their own leg and review
budget), proceed as amended, or a third review round. The operator chose to
proceed, keeping the leg whole.

**What that means for risk, stated plainly**: the amended `advance()` design
(AC5b's three self-guarded callers), AC5c's resolution-vs-occlusion filter, and
LD2's drop-the-queue-on-occlusion policy have had **no adversarial review** —
round 2 reviewed the version BEFORE those fixes. The flight-end Reviewer
(Phase 2d) is therefore the only remaining net under them, and its prompt will
name them explicitly as the unreviewed surface rather than leaving it to find
them cold. Leg status → `ready`.

**Leg 2 post-landing: Flight Director OVERRULED the implementing Developer's scope
call on the stuck `sheetOpen`.** The Developer flagged it as out-of-scope and
recommended a squawk, reasoning that the `reason !== 'superseded'` carve-out
predates this leg. The carve-out does — but it was harmless until this leg placed
a new flag inside it. `sheetOpen` is state this leg introduced, so its lifecycle
defect is this leg's, and it sat squarely on the AC5c surface I had already named
as unreviewed. Verified before overruling: `sheetOpen` had exactly two writes
(`:144` true, `:733` false-inside-the-guard); `OCCLUSION_CLOSE_REASONS` at `:18`
already listed `'superseded'`, but the occlusion check sat inside the same guard,
making that entry DEAD; and the vault-unlock branch's own comment documents
`'superseded'` as reachable from an unrelated menu (kebab, suggestions).
Consequence had it shipped: opening the kebab or typing in the address bar while
a save sheet was up would have silently suppressed every later save offer in that
window for its whole life — the M20 "no silent failures" class exactly.

The fix Developer was required to VERIFY the unreachability premise itself before
applying the fix (and to stop if it found any second opener), not take my word
for it. It did: `openCaptureSheet` has one caller, inside `advance()`, behind the
`sheetOpen` guard — so a vault-capture sheet can never model-replace another, and
the carve-out's original protection is unreachable under the serial design. Fix
neuter-verified (22 pass / 3 fail with the guard restored). Suite
**5323 / 5320 pass / 0 fail / 3 todo**, re-run and confirmed by the Flight
Director.

**Calibration note**: the Developer did the right thing by surfacing it rather
than fixing it silently or burying it — only the classification was wrong. The
line worth writing down: *a pre-existing guard is out of scope; a new defect
created by placing new state inside that guard is not.*

**Leg 2 status: landed.** Total leg-2 delta: +29 tests (5294 → 5323).

**Leg 3 (`identity-fill`) risk tier: HIGH** → design review runs. Triggers:
(1) **security-sensitive surface** — a new main→guest IPC channel
(`vault-fill-identity`) carrying ten secret PII fields into a page, and a new
method on the isolated-world handle, which is the boundary DD3g exists to keep
node-free; (2) **shared-interface changes with existing consumers** —
`fillLoginForm`/`fillCardForm` gain an ordinal, `resolveTargetForAnchor` gains an
arm, the observer's snapshot shape and the tracker's `readSnapshot` shape check
both widen; (3) the generated observer bundle changes, with its own pinning test.

**Designed by shape, per the flight's standing lesson.** Every finder consumer
was enumerated with `grep -rn "findAllCardFields\|findAllLoginFields" src/` and
every family branch with a `=== 'card'` / `!== 'card'` / `kind ===` shape grep
across the fill path — not by confirming the sites the flight spec names. The leg
carries the full enumeration as a table in its Inputs.

**That shape grep found a Leg 4 trap, recorded now so it cannot be missed.**
Leg 2 introduced `familyOf` at `vault-human.js:82` as a BINARY function
(`rec && rec.kind === 'card' ? 'card' : 'login'`). When Leg 4 creates identity
capture records, `familyOf` maps them to `'login'` — an identity gesture would
evict a pending login hold and vice versa, defeating DD1 for precisely the family
it was built for. Not a Leg 2 defect (identity records do not yet exist) and not
Leg 3's to fix; carried in the Leg 3 artifact's own "Carry-forward for Leg 4"
section and will be a named AC in Leg 4.

**Two leg-scoped decisions of note**: LD1 extracts card's private `setFieldValue`
and `setChoiceValue` into a shared `field-setters.js` rather than creating a THIRD
private copy of `setFieldValue` for identity (two already exist, in
`vault-fill-fields.js:92` and `vault-card-fields.js:416`) — the login copy is
deliberately left alone and will be squawked. LD2 moves the empty-picker copy
change from Leg 4 to Leg 3, since Leg 3 is the leg that makes an identity appear
in the picker.

**Leg 3 design review — round 1 verdict `approve with changes`, two HIGHs.
Round 2 deliberately SKIPPED — and the reason differs from Leg 2's on purpose.**

- **[HIGH] AC9 specified a duplicate of an existing, exported function — the
  FOURTH enumeration miss of this flight.** `resolveOrdinalInFamily` at
  `vault-gesture-policy.js:117`, exported `:181`, already does exactly what AC9
  asked for, and its module header names fill precision as a stated purpose. I had
  read that function earlier in this session. The design-time audit enumerated
  every finder CALLER by shape and still missed it, because it never searched for
  an existing IMPLEMENTATION of the capability being specified. Flight DD9 was
  wrong at the source and is amended. **The lesson, sharpened a third time**: after
  "search for unclaimed sites" (squawk 0096) and "search by shape, not spelling"
  (Leg 2), now **"before specifying a new helper, search for one that already does
  the job."**
- **[HIGH] AC11 would have silently broken five regression tests.** Verified: they
  pass a node where the contract becomes an integer, and `findAll(doc)[node]` is
  `undefined`, so they would fall back to the first form and fail — and they are
  the PR#112 finding-9 tests, the exact precision DD9 restores. Now AC11b: rewrite
  in place at the same strength, never delete. `isLive*` become dead exports
  (squawk 0098).

**Why round 2 is skipped here, when it was NOT skipped for Leg 2.** Leg 2's round-1
fix INVENTED mechanism (an `advance()` with a caller restriction), and round 2
found that invented mechanism introduced two HIGHs. Leg 3's fixes do the
opposite: HIGH 1 DELETES specified mechanism in favour of an existing, already
unit-tested, already-shipped function; HIGH 2 clarifies a test contract. Replacing
new code with existing reviewed code is the lowest-risk class of change there is,
and every claim behind both fixes was verified by the Flight Director's own
probes before acceptance. The distinction worth keeping: **re-review when a fix
adds mechanism; a fix that removes it toward prior art does not need it.**

Suggestions applied: AC3b (one `IDENTITY_ROLES`, derived, imported by both the
observer and the ordinal call — which also dissolved the reviewer's
naming-collision concern); AC6 marked a mid-leg checkpoint; AC7 names the
`fillIdentity` tracker router; AC20 corrects the stale "Leg 4" comment.
Squawks **0097** (the surviving private login `setFieldValue`) and **0098** (the
dead `isLive*` exports) logged and deferred. Leg status → `ready`.

**Leg 3 accepted after independent verification**: suite 5384 / 5381 pass /
0 fail / 3 todo; exactly ONE `resolveOrdinal*` function in the tree (the
pre-existing `vault-gesture-policy.js:117` — no duplicate, AC9 honoured); exactly
ONE `IDENTITY_ROLES` definition (`vault-identity-fields.js:273`, derived) imported
by the observer; `renderer.js` untouched at 1550. The Developer's own listing of
11 additional pre-existing tests updated for the snapshot-shape widening
(`identities: []` added to deep-equals) was checked as a legitimate contract
update, not a weakening.

**Leg 4 (`identity-capture`) risk tier: HIGH on every trigger.** PII capture under
the zeroized-buffer discipline; a hard-zero wrong-type write risk; lifecycle
changes to the capture record; shared-interface changes to the gesture resolver,
the value-layer gate and the snapshot. **Honest axes count stated as 5**, not the
flight spec's 3.

**The central finding of Leg 4's design, found by shape-grep before writing a
line**: every capture-side family dispatch is binary with LOGIN as the
else-branch — `familyOf`, `captureRelease`, `captureFinalize`, `captureSave`, the
guest gesture dispatch, and `secretRoleForKind`. A missed site would not crash; it
would silently route identity into the login path. At `captureSave` that means
**writing an identity capture to the vault as a `type: 'login'` item** — the
mission's hard-zero class. LD1 makes every one of them explicit and FAIL-CLOSED
(an unrecognised kind is refused, never defaulted), and Guidance 1 orders LD1 to
land FIRST, while identity records still cannot exist, so the suite proves the
refactor safe on its own before identity builds on it.

**A Leg 3 output gap, closed as LD3**: Leg 3 stamped `entry.anchorRole` on the
detected entry and left a comment saying Leg 4's gate would read it — but the
observer snapshots only the eleven role keys, so `anchorRole` never reached the
snapshot. Reading it from the main-world entry instead would have introduced a
TOCTOU between two independent enumerations; LD3 carries it through the isolated
world so the gate reads anchor role and values from one enumeration.

**Two flight-level questions ruled here**: LD4 — no `fullName` composition (it is
inference, which DD1 forbids, and it would manufacture spurious byte-exact
conflicts proposing to overwrite a real name with a synthetic one); LD5 — DD12's
seam grant goes unused (`vault-capture` has had no audit hook since M12; adding
the first is an unrelated coverage improvement that would pull the leg into
`renderer.js`).

**One corpus call worth recording**: `incident-report-third-party` is deliberately
NOT promoted to `captures`. It is Flight 2's named ACCEPTED false positive, and
promoting it would gate a known false positive as desired behaviour. AC20 instead
pins the BACKSTOP it relies on — `conflict` with an existing profile, `gap-fill` on
a fresh vault — so DD10's residual is tested as a residual.

**Leg 4 design review — round 1 verdict `approve with changes`; two HIGHs, one a
SECURITY hole in my own LD2.** The reviewer found zero citation errors across the
whole Central Danger table and audit — the shape-grep discipline held for what it
covered. What it did not cover was a claim about what a mechanism COVERS.

- **[HIGH, SECURITY] LD2 would have left held PII un-zeroized — the fifth
  enumeration miss of this flight.** LD2 said the identity buffer is "zeroized by
  the existing `dropCapture` choke point." Verified false: `dropCapture` is the
  choke point every drop passes through, but its zeroize step walks a NAMED LIST,
  `['password', 'number', 'cvv']` (`vault-human.js:183`), under its own comment
  "A new secret field MUST be added here or it outlives the record." I conflated
  "every drop goes through it" with "it zeroizes everything on the record." The
  same conflation was harmless in Leg 2 only because the bulk drops happen to
  iterate records, not fields. Had it shipped: ten fields of name, address, phone
  and email held in plaintext past every lock, tab close, window close and TTL —
  exactly the property the mission's constraint says matters MORE under
  capture-on-gesture, not less.
  **Closed structurally, not by adding a fourth name (LD7):** `dropCapture` now
  zeroizes every own Buffer-valued field. Every Buffer on a capture record is
  secret by construction, so today's set is unchanged, `identitySecrets` is
  covered, and so is any future field — retiring the defect class, as Flight 2's
  debrief recommended for exactly this pattern. AC11's canary (an arbitrary new
  Buffer field is zeroized with no edit) proves the class is gone, and is itself
  neuter-verified.
- **[HIGH] AC1/AC2's fail-closed pins had no construction path.** `familyOf` was
  private and no public API can build a record with an unrecognised `kind`. Same
  defect class as Leg 2's AC10 ("a testing requirement stated without verifying
  it is reachable"). Adopted the reviewer's better fix: ONE exported
  `dispatchByFamily` helper for all three main-side dispatch sites — directly
  testable with a plain `{ kind: 'bogus' }`, and one fallback to get right instead
  of three to keep from drifting back to a login default.
- **[MEDIUM, DATA LOSS] A naive identity merge would blank saved fields.** A
  checkout captures only the fields it asks for; `{ ...existing, ...captured }`
  would overwrite a saved phone number with nothing on a form with no phone field.
  LD8 derives the write set from `classifyCapture`'s own output — exactly the
  fields the sheet named — so the offer and the write cannot disagree. AC16b pins
  it with a neuter-verified naive-spread counterexample.
- **[MEDIUM]** `vaultTrace` does not exist in Electron-free `vault-human.js`. LD9:
  an optional injected `trace` dep, the refusal pinned independently of it.
- Suggestions applied: the test helper's own binary sites (Guidance 3c); the
  observer's 416/425 budget (Guidance 3d).

**Round 2 WILL run.** LD7 and `dispatchByFamily` both ADD mechanism, and LD7 does
so at a security choke point — by the standing rule set at Leg 3 ("re-review when
a fix adds mechanism"), this is precisely the case that earns a second pass. It is
also the flight's highest-risk leg.

**Leg 4 design review — round 2 verdict `approve with changes`, NO blocking
issues. Cycle cap reached cleanly; no escalation.** Unlike Leg 2, round 2 did not
find new HIGHs in the round-1 fixes — the difference being that Leg 4's fixes were
reviewed on a leg whose round-1 findings were enumeration/coverage defects closed
structurally, not a newly-invented control-flow mechanism.

- **LD7 verified SAFE — the question that mattered most.** The reviewer enumerated
  every field any capture record carries, across every construction site: all
  flat, no nested Buffer anywhere, `rec.timer` is a Node `Timeout` that
  `Buffer.isBuffer` rejects, and every Buffer is secret by construction. No
  aliasing: `captureRelease` copies before dropping and the re-entrant
  `capture`/`captureCard` make their own fresh copy; `captureSave` decodes every
  secret to a string before its `finally { dropCapture }`. Zeroizing every Buffer
  is a strict, safe superset.
- **LD8 verified**: `classifyCapture`'s `isPresent` treats an absent key and `''`
  alike, so the write set is robust to either serialization; field lists are set
  exactly once, in exactly one of the two mutually exclusive dispose paths, before
  `captureSave` can read them — and a pre-dispose record already fails closed at
  `captureSave`'s existing `choices` check.
- **[MEDIUM, closed] The refusal sentinel was unspecified.** `FAMILY_REFUSED` now
  named; each call site drops-and-zeroizes then returns the value it ALREADY
  returns for a missing record (`captureRelease` omits; `captureFinalize`
  `{ reason: 'expired' }`; `captureSave` `{ saved: false }`) — literally true
  after the drop, so no new reason string and no new chrome handling. AC2b pins it.
- Suggestions applied: `captureIdentity` named as AC8b; LD9's trace uses the
  existing `[vault-capture]` prefix; the observer budget citation reconciled.
- Enumeration re-check found **no missed site** — `vault-controller.js` has zero
  family literals, `register-browser-ipc.js` uses per-family dedicated channels.

Leg status → `ready`.

**Leg 4 accepted after independent verification**: suite 5432 / 5429 pass /
0 fail / 3 todo; the grep-AC `rec.kind === 'card'` in `vault-human.js` returns 0;
`renderer.js` 1550; `SEAM_COUNT` 41.

Two hand-back details were checked rather than taken on report:
- **The `billing-jostens.html` edit is legitimate test data, not a corpus
  integrity breach.** The Developer added `value=` attributes to promote it. A
  fixture edited to make a heuristic pass would be exactly the "ratify rather than
  specify" pressure the mission forbids — so it was verified: with `value=`
  stripped, every changed line is byte-identical (names, ids, types,
  `autocomplete`, structure all untouched), and the corpus helper grants
  provenance only for non-empty `.value` (`save-moment-assertions.js:185-219`,
  "the corpus's stand-in for" typed input). Every other `offers` fixture already
  carries `value=` (2 / 4 / 4). Established convention.
- **`_seedCaptureForTest` is flagged for the flight-end Reviewer.** It is a WRITE
  seam — it injects an arbitrary record, Buffers included, into `captures` — on
  the production `createVaultHuman` object (`vault-human.js:1617`), against the
  Flight Director's "without exporting mutable internal state" instruction.
  Mitigations: main-process reachable only, no IPC exposes it, and
  underscore-prefixed state-mutating test seams have precedent in this very
  feature (`vault-entry-observer.js`'s `_grant`, `_expireField`). Reported
  transparently by the Developer; judgement deferred to the Reviewer rather than
  pre-decided here.

**All four autonomous legs landed.** Proceeding to Phase 2d — the flight-end
Reviewer over every uncommitted change. Per the commitment made at the Leg 2
operator ruling, the Reviewer is pointed BY LOCATION ONLY (no Developer reasoning
passed, preserving the separation rule) at the surfaces that never received an
adversarial review: Leg 2's amended `advance()` / resolution-vs-occlusion filter /
drop-the-queue-on-occlusion, and Leg 2's post-landing `sheetOpen` fix.

**Documentation landed BEFORE the commit — a deliberate reordering of the
workflow's steps.** The agentic-workflow skill places documentation verification
in Phase 3, after the Phase 2d commit. But CLAUDE.md stated facts this flight
made false (a 1577 line budget, identity as "foundations only" with "no live
caller", the fill-precision gap as an ACCEPTED regression, a named-list zeroize).
Committing that and correcting it afterwards would have produced a commit in
which the project's own guidance contradicts its code. One coherent commit
instead. **Standardize?** Yes, whenever the code commit makes documented facts
false.

**The docs Developer's own shape search found NOTHING beyond the Flight
Director's eight starting items** — the first enumeration of this flight that
held on first pass.

**But the Flight Director caught an inaccurate claim in its hand-back.** It
reported `CLAUDE.md:356` as "RENDERER_LINE_BUDGET 1577 → 1550". In fact it had
APPENDED "LOWERED AGAIN to **1550**" to the line's history parenthetical and left
the headline value reading `` `RENDERER_LINE_BUDGET` 1577 ``. That line's
convention is headline = current value, parenthetical = history; the previous
version was internally consistent (headline 1577, last history entry 1577), and
the edit broke it — a reader skimming the line would read 1577 as the budget.
Caught by a residual-literal count (`grep -c 1577` returned 1 where 0 was
expected, pointing at the one line that should not still say it). Corrected
directly by the Flight Director (a two-token documentation fix; an agent spawn
would have been disproportionate), along with the line's stale
`as of 2026-09-16` stamp → `2026-09-20`. The legitimate history clause "RAISED
again to 1577 at Leg 2" is preserved. **Lesson**: a count of the OLD literal is a
cheaper and more reliable check on a doc update than reading the agent's claim —
it turns "did you change it?" into "is it still there?".

---

## Leg Progress

### Leg 1: sheet-type-dispatch
**Status**: landed
**Started**: 2026-09-20
**Completed**: 2026-09-20

#### Changes Made

- **`src/shared/vault-capture-template.js`** (AC5): added a `KIND_TABLE` (login/card)
  supplying `noun`, `subjectLabel`, and `subjectValueText(model)` (including the
  `'(no username)'` / `'(card)'` fallbacks) per kind, plus a `kindOf(model)`
  resolver (membership via `Object.prototype.hasOwnProperty.call`, never a bare
  truthy lookup). All 4 binary `model.kind === 'card'` sites replaced;
  `renderVaultCaptureCard` now reads everything through `KIND_TABLE[kindOf(model)]`.
- **`src/shared/vault-picker-template.js`** (AC1-AC4): added the mirrored
  `KIND_TABLE` (login/card) supplying `sectionHeading`, `fallbackTitle`,
  `buildIcon`, and `secondaryLine(item)`, plus `kindOf(item)`. All 8 binary branch
  sites replaced. `secondaryLineFor` (exported, signature unchanged) now dispatches
  through the table. The empty-picker copy moved to a single named constant
  `EMPTY_PICKER_NOTE` (AC4 — grep count confirmed 1). Sectioning (AC3) now derives
  `presentKinds` from `rows.filter(Boolean).map(kindOf)` — a size ≥2 set sections —
  deliberately kept as a SEPARATE derivation from the render loop's `item || {}`
  handling, per the leg's AC3 rationale (a `[null, {type:'card'}]` model must stay
  unsectioned).
- **`src/renderer/chrome/auth-challenge-controller.js`** (new, AC6): extracted
  BOTH `onAuthChallengePresent`/`onCertChallengePresent` subscriptions and the
  `auth-basic`/`cert-picker` overlay states out of `renderer.js` verbatim, in the
  established single-factory shape (subscriptions wired inside
  `createAuthChallengeController(deps)` at construction time, returning
  `{ overlayStates }` only — no separate subscribe function invented).
- **`src/renderer/renderer.js`**: imports and constructs
  `authChallengeController` beside `vaultController` (same TDZ-avoiding
  `openOverlayMenu: (...args) => overlayMenuClient.open(...args)` closure
  precedent — `openOverlayMenu` the const is not declared until later in the
  file). Removed both subscription bodies and both inline overlay-state entries;
  `overlayMenus` now spreads `...authChallengeController.overlayStates`.
- **`src/renderer/chrome/vault-controller.js`** (AC6b): corrected the header
  comment's now-false "stays in renderer.js" note to point at
  `auth-challenge-controller.js`.
- **`test/unit/seam-contract.test.js`** (AC8, the one sanctioned test edit):
  `RENDERER_LINE_BUDGET` lowered 1577 → 1550, with a comment naming this leg,
  matching the `VAULT_PAGE_LINE_BUDGET`/`BOOKMARKS_BAR_LINE_BUDGET` idiom.
- **`test/unit/vault-picker-template.test.js`**: added 3 new tests (AC2 unknown/absent
  type → login; AC3b null-entry-alongside-card → unsectioned; AC4 single-literal
  grep). All 11 pre-existing tests in this file are byte-for-byte unmodified.
- Two `@ts-check` type errors surfaced by `npm run typecheck` on both new
  `kindOf` helpers (TS couldn't narrow the `hasOwnProperty`-guarded string to the
  `'card'|'login'` literal union) — fixed by binding the guard result and the
  cast to locals before the ternary, per CLAUDE.md's "Cast-to-local before a
  chain" rule (never an inline cast inside the ternary itself).

#### Acceptance Criteria Verification

- **AC1** (picker dispatch table): `grep -n "'card'" src/shared/vault-picker-template.js`
  → all 4 remaining hits are in the table's own `card:` entry, a doc comment, or a
  type annotation; zero `=== 'card'` / `!== 'card'` comparisons remain outside it.
- **AC2** (unknown types → login): new test `AC2: an unrecognised or absent type
  resolves as login, byte-identically` — PASS.
- **AC3 / AC3b** (null-entry sectioning divergence): implemented via the
  `rows.filter(Boolean).map(kindOf)` derivation kept separate from the render
  loop's `item || {}`; new test `AC3b: a null model entry alongside a card
  renders with NO section headings` — PASS.
- **AC4** (single copy constant): `grep -c "No saved logins or cards to fill here"
  src/shared/vault-picker-template.js` → `1`. New source-scan test added as a
  standing regression net — PASS.
- **AC5** (capture dispatch table): `grep -n "'card'" src/shared/vault-capture-template.js`
  → all remaining hits are the table's own `card:` entry, a doc comment, or a
  type annotation.
- **AC6 / AC6b** (extraction + comment fix): `grep -rn
  "onAuthChallengePresent\|onCertChallengePresent\|'auth-basic'\|'cert-picker'"
  src/renderer/renderer.js` → one hit, a comment documenting where the flow now
  lives (no subscription body, no overlay-state literal). `vault-controller.js`'s
  header no longer claims the flow stays in renderer.js.
- **AC7** (SEAM_COUNT unchanged, no audit hook added): `SEAM_COUNT` left at `41`
  in `seam-contract.test.js`; `node --test test/unit/audit-hooks.test.js` — 20/20
  PASS, unmodified; no new `open*ForAudit` hook added.
- **AC8** (budget lands lower, pinned): measured via
  `node -e "console.log(fs.readFileSync('src/renderer/renderer.js','utf8').split(/\r?\n/).length)"`
  → **1550** (AFTER `npm run format`, per the leg's own measure-last guidance).
  `RENDERER_LINE_BUDGET` set to **1550** in lockstep — 12 lines of margin under
  the leg's ≤1562 ceiling (better than the leg's own ~30-35-net estimate; the
  extraction removed more gross lines than the wrapper/comment add-back cost
  this time).
- **AC9** (zero behaviour change) — **BLOCKED, see Anomalies below.** `npm test`
  before this leg: 5292 tests (approx, pre-leg baseline not separately captured —
  see the two failures below for the delta). `npm test` after this leg: **5294
  tests, 5289 pass, 2 fail, 3 todo.** The two failures are both PRE-EXISTING
  source-scan pins against `renderer.js` that the leg's own citation audit did
  not catalog — see Anomalies. `git diff --stat test/` confirms no existing
  *assertion* was loosened or rewritten; the two failing tests were left
  untouched, per the leg's explicit instruction to stop and report rather than
  edit.
- **AC10** (gates): `npm run lint` — clean, zero findings. `npm run typecheck` —
  clean (after the two `kindOf` cast fixes above). `npm run format` then `npm run
  format:check` — clean, "All matched files use Prettier code style!"; `git
  status --short` confirms format touched none of the 6 modified files beyond
  what this leg already wrote. **Local Concourse CI requires an interactive login
  unavailable in this environment — these four local gates stood in for it. This
  is NOT a claim that the hosted CI pipeline ran.**

#### Notes

Test counts: `npm test` → **5294 tests total, 5289 pass, 2 fail, 0 cancelled, 3
todo, 0 skipped** (both failures are the AC9 blocker below, not new defects
introduced by unrelated code). No hang encountered in any targeted or full run;
every `node --test` invocation used `--test-timeout=60000` per instruction and
completed well inside it (full suite ~5.8-5.9s).

#### AC11 / AC11b completion (2026-09-20, following the Flight Director's amendment)

The Flight Director's amendment authorized exactly two test retargets (AC11) and
a neuter-verification of the first (AC11b), to resolve the AC9 blocker above.
Both retargets done; no other file touched.

- **AC11.1 — `test/unit/cert-picker-template.test.js` retargeted.** The
  `rendererSource` read (previously `fs.readFileSync(...'/src/renderer/
  renderer.js', 'utf8')`) was repointed at
  `src/renderer/chrome/auth-challenge-controller.js` and renamed
  `challengeControllerSource`, with a note explaining the AC6 move. All three
  regexes that previously matched against `rendererSource` — the `openOverlayMenu('cert-picker', { certs: Array.isArray(certs) ? certs : [], ...`
  object-model send, the `onCertChallengePresent(({ certs, host, popup }) =>`
  destructure, and the `...(typeof host === 'string' && host ? { host } : {})`
  spread — matched the moved code **verbatim, with no regex change needed**: the
  extraction landed the code with the exact same token sequence and whitespace
  shape the existing regexes already tolerated (`\s*`/literal spacing). The
  `sheetSource` (`menu-overlay.js`) read and its two assertions (the
  `modelShapeOk` gate, the `renderCertPickerSubtitle` call) were left completely
  untouched, per the leg's instruction. Assertion failure-message text was
  reworded from "renderer.js's cert-challenge-present handler…" to
  "auth-challenge-controller.js's cert-challenge-present handler…" (message
  strings only — not part of any assertion).
- **AC11.2 — `test/unit/vault-restore-workflow-invariants.test.js:126`
  retargeted.** `assert.equal(lines, 1577, ...)` → `assert.equal(lines, 1550,
  ...)`, matching `RENDERER_LINE_BUDGET` (`seam-contract.test.js:306`, set to
  1550 by the prior Developer's AC8 work). A new "Retargeted again (Mission 21
  Flight 3 Leg 1, sheet-type-dispatch, AC11.2 …)" comment was appended in the
  same style as the file's ~8 prior lockstep updates, naming the auth/cert
  challenge extraction as the reason and cross-referencing squawk 0096 (the
  underlying two-copies-of-one-fact duplication, logged and deferred rather than
  fixed in this leg).
- **AC11b — neuter-verification, cert-picker retarget.** Before restoring,
  the protected shape in `auth-challenge-controller.js` was temporarily broken —
  the `onCertChallengePresent` handler body was replaced with the bare-array
  form:
  ```js
  goldfinch.onCertChallengePresent(({ certs, host, popup }) => {
    openOverlayMenu('cert-picker', Array.isArray(certs) ? certs : [], null, 0);
  });
  ```
  `node --test --test-timeout=60000 test/unit/cert-picker-template.test.js` was
  then run against the broken file. **Observed RED** — the suite dropped from
  8/8 pass to **7 pass / 1 fail**; the TAP output for the failing subtest:
  ```
  not ok 6 - REGRESSION (M14 F3 HAT): the LIVE cert-picker model shape ({certs, popup?}) passes the sheet init gate — blank-sheet fix
    ---
    duration_ms: 0.913705
    type: 'test'
    location: 'test/unit/cert-picker-template.test.js:129:1'
    failureType: 'testCodeFailure'
    error: "auth-challenge-controller.js's cert-challenge-present handler must send the { certs, popup? } object model"
    code: 'ERR_ASSERTION'
    name: 'AssertionError'
  ```
  The file was then restored to its exact pre-break content (the multi-line
  object-model form shown in "Changes Made" above); rerunning the same test
  confirmed a return to 8/8 pass. Because `auth-challenge-controller.js` is a
  new file this flight (untracked, no committed baseline), the restoration was
  confirmed by re-running the test back to green rather than by `git diff`.
  This demonstrates the retargeted pin still bites — it is not a silently
  disabled test.
- **Final gates, full suite.** `npm test` → **5294 tests total, 5291 pass, 0
  fail, 0 cancelled, 3 todo, 0 skipped** (the 3 todo are pre-existing and
  unrelated to this leg). `npm run lint` — clean. `npm run typecheck` — clean.
  `npm run format` — no-op (tree already Prettier-formatted, only the two test
  files carried hand edits and both were written in Prettier's style). `npm run
  format:check` — "All matched files use Prettier code style!". `git status
  --short` after all gates confirms only the two intended test files
  (`test/unit/cert-picker-template.test.js`,
  `test/unit/vault-restore-workflow-invariants.test.js`) plus the pre-existing
  Leg 1 diff were touched — no incidental reformatting elsewhere. As before,
  local Concourse CI needs an interactive login unavailable in this environment;
  these four local gates stood in for it, and hosted CI did not run.
- **Final renderer.js line count**: **1550** lines (`split(/\r?\n/).length`,
  the standard metric), matched by both `RENDERER_LINE_BUDGET`
  (`test/unit/seam-contract.test.js:306`) and the retargeted
  `test/unit/vault-restore-workflow-invariants.test.js:126` pin — the two
  constants AC11.2 required to land in lockstep now agree.
- **AC9 unblocked; leg landed.** All acceptance criteria (AC1-AC11b) verified;
  leg artifact status set to `landed`; checked off in flight.md's Legs list.

---

### Leg 2: multi-hold
**Status**: landed
**Started**: 2026-09-20
**Completed**: 2026-09-20

#### Changes Made

- **`src/main/vault/vault-human.js`**: added the module-level `familyOf(rec)`
  helper (`rec.kind === 'card' ? 'card' : 'login'`) and applied it to all FOUR
  supersession loops (AC1/AC1b) — `capture` (login-scoped), `holdGestureLogin`
  (login-scoped), `holdGestureCard` (card-scoped), and `captureCard` (card-scoped
  — the loop variable there is `prior`, not `rec`, per the leg's own citation
  warning; grepped by the `\.wcId === wcId` SHAPE, not the spelling, to confirm
  all four). Rewrote `captureRelease(wcId)` (AC2/AC3/AC12b): it now snapshots
  every `pending-settle` record for the tab UP FRONT (never the live `captures`
  Map, which the loop's own calls into `capture`/`captureCard` mutate), then
  releases each one — copy-before-drop preserved PER RECORD inside the loop —
  and returns an array (`[]` for nothing pending, one `{captureId, model}` entry
  per record whose disposition produced an offer, in `captures` Map insertion
  order). The loop is fully synchronous end to end (no `await` between records,
  AC12b) — the ONLY thing that makes AC3's family-scoping argument hold, since an
  external bulk-drop could otherwise interleave mid-loop.
- **`src/main/guest-wiring.js`**: the `did-navigate` settle site now iterates
  `captureRelease`'s returned array, sending one `vault-capture-offer` per entry
  (release order preserved), all still before `tab-did-navigate` (AC4).
- **`src/main/register-browser-ipc.js`**: the `guest-vault-gesture-settle`
  detachment settle site does the same iteration; `vaultTrace('settle', …)` now
  reports `count`/`modes` (an array of mode strings) instead of the old
  `offered`/`mode` booleans-of-one — still no captureId or secret logged (AC4,
  Edge Cases).
- **`src/renderer/chrome/vault-controller.js`** (AC5-AC9): `pendingCaptureUnlock`
  changed from a scalar to an array; added `sheetOpen` (boolean), `presentationQueue`
  (array of `{captureId, model}`), and two new functions: `advance()` (the ONE
  place a vault-capture sheet is opened from a queue — idempotent via the
  `sheetOpen` no-op guard, three callers: `handleClosed`'s vault-capture branch on
  a resolution-class reason, `onVaultLockState`'s unlock-success continuation
  which starts the locked drain, and `onVaultCaptureOffer`'s already-unlocked
  branch) and `dismissQueuedOffers()` (LD2 — drains both `presentationQueue` and
  `pendingCaptureUnlock` and dismisses every captureId, used on an
  occlusion-class vault-capture close so no sibling is ever orphaned with nothing
  left to `advance()` it). A module-level `OCCLUSION_CLOSE_REASONS = new
  Set(['blur','superseded','tab-hide','tab-switch'])` mirrors (never imports —
  `auth-challenges.js` is main-process-only) the resolution/occlusion vocabulary
  for the `advance()` gate (AC5c); anything outside that set (escape,
  outside-click, activated, tab-close, teardown) is resolution-class and
  advances. `onVaultCaptureOffer`'s locked branch now pushes onto
  `pendingCaptureUnlock` and opens the `vault-unlock` prompt ONLY on the first
  push of an otherwise-empty drain (AC7); its already-unlocked branch pushes onto
  `presentationQueue` and calls `advance()` (AC5). `onVaultLockState`'s
  continuation now just calls `advance()` when the drain is non-empty and the
  vault is unlocked (AC5b/AC6), instead of directly awaiting
  `vaultCaptureFinalize` itself. `handleClosed`'s vault-unlock branch now drains
  and dismisses EVERY queued captureId on an abandoned unlock (AC8, was a single
  scalar dismiss). `handleClosed`'s vault-capture branch (kept the pre-existing,
  untouched `reason !== 'superseded'` carve-out per DD1's "no new close logic
  needed") now also resets `sheetOpen = false`, then branches: an
  occlusion-class reason calls `dismissQueuedOffers()` (AC5d); every other
  (resolution-class) reason calls `advance()` (AC9).
- **`src/preload/vault-gesture-detach-watch.js`** (new, AC10): a pure,
  injected-deps module (`createGestureDetachWatch({MutationObserver, root,
  onSettle})`) implementing the kind-keyed `Map<kind, fields[]>` state machine —
  `arm(kind, fields)` replaces one kind's set wholesale (last-wins, matching the
  pre-extraction single-kind semantics) without disturbing any other kind's
  armed set; the shared `MutationObserver` callback fires `onSettle()` and clears
  ONLY a kind whose fields are ALL disconnected (`fields.every(f => !f.isConnected)`)
  — see the neuter-note under Deviations below re: this being a deliberate
  strengthening over the pre-extraction "any one field disconnects" check, made
  to satisfy AC10b's explicit "a partially-detached set does not fire" wording.
  Fails closed (no observer created) when `MutationObserver` is unavailable or
  `root()` returns nothing yet; a later `arm()` call retries.
- **`src/preload/webview-preload.js`**: removed the inline
  `watchedGestureFields`/`gestureDetachObserver`/`armGestureDetachWatch` trio and
  replaced them with a `createGestureDetachWatch` instance (`root: () =>
  document.documentElement`, `onSettle: reportGestureSettle`) plus a thin
  `armGestureDetachWatch(kind, fields)` wrapper. Both call sites updated to pass
  their kind literal: the card branch passes `'card'`, the login branch passes
  `'login'`.
- **`eslint.config.mjs`** (AC13b): added
  `'src/preload/vault-gesture-detach-watch.js'` to the existing
  CJS-required-by-the-preload `files:` array (no `src/preload/**` wildcard
  exists — omitting this makes `npm run lint` fail with `'module' is not
  defined  no-undef`, exactly as the leg warned).

#### Acceptance Criteria Verification

- **AC1 / AC1b** — `test/unit/vault-gesture-capture.test.js`: new tests "AC1:
  supersession is family-scoped…", "AC1b: releasing a LOGIN-then-CARD pair — both
  offers actually SAVE…", "AC1b: releasing a CARD-then-LOGIN pair — both offers
  actually SAVE…". The AC1b tests deliberately go further than reading the
  returned offer MODEL (plain data, captured synchronously — it would still look
  intact even if the underlying held record had already been zeroized moments
  later): each one calls `captureSave` on BOTH offers and reads the persisted
  items back from the store. **Neuter-verified**: reverted `captureCard`'s loop
  to the family-blind `if (prior.wcId === wcId) dropCapture(id)` and reran —
  observed RED on exactly the three tests that should catch it (`AC1b`
  login-then-card, `AC1b` card-then-login, and `AC3`), 19 pass / 3 fail; restored
  the fix and reran — 22/22 pass. This confirms the fix is load-bearing and the
  tests actually bite (my first draft of the AC1b tests only asserted
  `released.length === 2` on the model shape and did NOT catch the reverted bug —
  caught and strengthened before neuter-verifying, per this leg's own AC1b
  citation about exactly this failure mode).
- **AC2** — same file: `captureRelease` nothing-pending test retargeted to
  `assert.deepEqual(…, [])`; every existing `released.model.X` /
  `released.captureId` read retargeted to `released[0].model.X` /
  `released[0].captureId` with a preceding `assert.equal(released.length, 1, …)`
  (an array-of-one where each previously asserted a bare object, per AC13's
  discipline) — 10 call sites across 7 pre-existing tests. Two additional
  null-returning assertions retargeted from `assert.equal(…, null, …)` to
  `assert.deepEqual(…, [], …)`.
- **AC3** — new test "AC3: captureRelease's own re-entry cannot evict its
  sibling…": releases a login+card pair in one call, asserts `released.length
  === 2`, then SAVES both and reads both persisted items back with their actual
  secret values (`hunter2`, the full PAN) — also covered by the AC1b neuter-run
  above (this test failed too when the fix was reverted).
- **AC4** — `test/unit/guest-wiring.test.js`: retargeted the existing
  single-offer test to wrap the fake `captureRelease` return in an array; added
  "AC4: did-navigate sends ONE vault-capture-offer per entry captureRelease
  returns, preserving release order, all before tab-did-navigate" (two entries,
  asserts send order AND the before-tab-did-navigate index ordering); retargeted
  the nothing-pending test from `return null` to `return []`.
  `test/unit/register-browser-ipc.test.js`: same pattern — the fake `human`'s
  default `nextOffer` changed from `null` to `[]`; the existing settle test
  retargeted to wrap its offer in an array; added "AC4: guest-vault-gesture-settle
  sends ONE vault-capture-offer per entry…" (two entries, asserts both sends and
  their order). `node --test` on both files: 88/88 and 23/23 pass respectively.
- **AC5 / AC5b / AC5c / AC5d / AC9** — `test/unit/vault-controller-capture.test.js`,
  9 new tests: "AC5: two already-unlocked offers open exactly one sheet…" (serial,
  never a model-replace); "AC5b: advance() is idempotent…" (an unrelated
  `onVaultLockState` broadcast with nothing queued while a sheet is open never
  double-opens); "AC5c: every OCCLUSION-class close reason (blur / tab-hide /
  tab-switch) drops the WHOLE queue and never advances" and its RESOLUTION-class
  sibling (escape / outside-click / tab-close — dismisses only the shown offer,
  presents the next); "AC9: an 'activated' close…skips the dismiss…but still
  presents the next queued offer"; "AC5d: a blur with two offers queued dismisses
  both captureIds and leaves the queue empty — nothing re-opens later" (plus
  proving a later unrelated lock-state broadcast doesn't resurrect anything).
  All pass; the pre-existing 13 tests in this file pass unchanged (the
  single-offer flows behave identically under the new queue machinery, since
  `sheetOpen` starts false and a lone offer always finds the queue/drain empty).
- **AC6 / AC7** — same file: "AC6: two LOCKED-mode offers, one unlock, both reach
  a sheet — serially…" (extends the harness with an optional `finalizeFor(id)`
  per-id resolver so two different locked captureIds finalize into two different
  models; asserts the SECOND is not finalized until the first sheet closes, via
  `h.finalized` after the first `await settle()`); "AC7: the unlock prompt opens
  exactly once for two locked-mode offers" (filters `h.opens` to `menuType ===
  'vault-unlock'`, asserts length 1) plus AC7 is also asserted inline inside the
  AC6 test.
- **AC8** — same file: "AC8: an abandoned unlock drops EVERY queued locked-mode
  record, not just the one that opened the prompt" — two locked offers, `escape`
  close on the `vault-unlock` sheet, asserts `h.dismissed` contains both.
- **AC10 / AC10b** — new `src/preload/vault-gesture-detach-watch.js` +
  `test/unit/vault-gesture-detach-watch.test.js` (9 tests, all against an
  injected fake `MutationObserver` constructor and plain `{isConnected}`
  stand-ins, no DOM/Electron): arming two kinds keeps both independently; one
  kind fully detaching fires settle exactly once and clears only that kind (a
  later unrelated mutation callback does not re-fire it); the sibling kind stays
  armed and fires on its OWN later, separate detachment; a partially-detached set
  (1 of 3, then 2 of 3 fields gone) does NOT fire, and fires only once the third
  and final field detaches; two kinds fully detaching in ONE mutation callback
  both fire (the "whole-page teardown" Edge Case); re-arming the SAME kind
  replaces its set wholesale without disturbing a different kind's armed set
  (the superseded field set no longer fires); an empty/all-falsy `arm()` call is
  a no-op (no observer created); fails closed with no `MutationObserver` ctor or
  no root (never throws, never watches); a second `arm()` call for any kind
  reuses the SAME `MutationObserver` instance (never a second attach). All 9
  pass. `webview-preload.js`'s own thin wiring (the real
  `document.documentElement` / `ipcRenderer.send`) remains unit-unreachable
  under `node --test` (it `require('electron')` at the top of the file and has
  top-level `window.addEventListener` calls) — per the leg's own Verification
  Steps note, that is true only of the thin wiring now, not of the state machine
  it delegates to.
- **AC11** — `test/unit/vault-gesture-capture.test.js`: two new tests, "AC11: the
  three bulk drops (tab close / window close / vault lock) already cover BOTH
  families for one tab, and each record's own CAPTURE_DROP_MS timer still fires
  independently" (`dropCapturesForTab`, asserts `dropped.length === 2`, both
  zeroized, both timers cleared, `captureRelease` then returns `[]`) and "AC11:
  dropAllCaptures (vault lock) also covers both families for one tab". No source
  change was needed (the leg's own citation — `:1024`/`:1046`/`:1064` were
  already family-blind by design) — pinned as explicitly requested.
- **AC12** — `grep -rn "identity" src/main/vault/vault-human.js
  src/renderer/chrome/vault-controller.js src/preload/webview-preload.js` →
  exactly 4 hits, matching the leg's stated baseline byte-for-byte (`card-identity`
  import, "identity" in a store-method doc comment, "PAN identity" in a comment,
  "node-identity-crosses-the-boundary" in a comment) — zero new hits. Also
  grepped the two new files (`vault-gesture-detach-watch.js` and its test) for
  "identity" — zero hits in either.
- **AC12b** — verified by reading `captureRelease`'s rewritten body: the release
  loop iterates a snapshot array (`pending`) built before any mutation, contains
  no `await`/`.then` anywhere in its body, and calls `dropCapture`/`capture`/
  `captureCard` synchronously per iteration.
- **AC13** — assertion counts (`grep -c 'assert\.'`), before (git HEAD, untouched
  by Leg 1) → after (this leg):
  - `test/unit/vault-gesture-capture.test.js`: 47 → 78 (+31: 6 new tests, plus
    every retargeted `captureRelease` call site gained an added
    `assert.equal(released.length, …)` alongside its retargeted read).
  - `test/unit/guest-wiring.test.js`: 239 → 243 (+4: 1 new test).
  - `test/unit/register-browser-ipc.test.js`: 73 → 74 (+1: 1 new test).
  - (`test/unit/vault-controller-capture.test.js`, the chrome-side consumer the
    leg's Inputs section also names: 29 → 58, +29 across 9 new tests — no
    existing assertion in this file needed retargeting, since its pre-existing
    tests exercise only the single-offer shape, which is unchanged.)
  Every edit either ADDED a new assertion or retargeted an existing one to the
  SAME strength against the new contract (an array-of-one length check plus an
  indexed read, where the old code read a bare object) — none was deleted or
  weakened. `git diff` confirms no `assert.*` line was removed from any of the
  four files without a same-or-stronger replacement.
- **AC13b** — `npm run lint` — clean, zero findings, confirming the added
  `files:` entry resolves the CJS/ESM `sourceType` for the new module (verified
  the failure mode too: temporarily removing the entry and rerunning lint
  reproduced `'module' is not defined  no-undef` against
  `src/preload/vault-gesture-detach-watch.js`, then the entry was restored).
- **AC14** — full suite `npm test` → **5320 tests, 5317 pass, 0 fail, 0
  cancelled, 3 todo, 0 skipped** (up from Leg 1's final 5294/5291 — +26 tests,
  exactly matching 6+1+1+9+9 new tests across the five touched/new test files).
  `npm run lint` — clean. `npm run typecheck` — clean. `npm run format` —
  reformatted 3 files this leg had hand-edited
  (`test/unit/vault-gesture-capture.test.js`,
  `test/unit/vault-controller-capture.test.js`, `src/preload/webview-preload.js`,
  all cosmetic line-wrap only); `npm run format:check` afterward — "All matched
  files use Prettier code style!". Re-ran the full suite + lint + typecheck AFTER
  formatting to confirm nothing regressed — same 5317/0/3 result, lint and
  typecheck both clean. `renderer.js` line count: **1550**
  (`split(/\r?\n/).length`), matching both `RENDERER_LINE_BUDGET`
  (`test/unit/seam-contract.test.js:306`, `= 1550`) and the retargeted
  `test/unit/vault-restore-workflow-invariants.test.js:134` pin (`= 1550`) —
  this leg made zero edits to `renderer.js` itself (confirmed via `git diff
  --stat -- src/renderer/renderer.js`, whose only diff is Leg 1's, and via
  `git status --short`, which shows no `renderer.js` edit from this session
  beyond what was already staged before this leg began). **Local Concourse CI
  needs an interactive login unavailable in this environment — these four local
  gates stood in for it. This is not a claim that hosted CI ran.**

#### Notes

- **A behavior refinement inside AC10's extraction, called out explicitly rather
  than silently shipped**: the PRE-extraction inline `armGestureDetachWatch` fired
  `reportGestureSettle()` the moment `watchedGestureFields.every(f =>
  f.isConnected)` was FALSE — i.e., as soon as ANY ONE watched field disconnected,
  not only when ALL of them did. AC10b's own wording ("a partially-detached set
  does not fire") is unsatisfiable under that literal pre-existing check, so the
  extracted module implements genuine full-detachment semantics
  (`fields.every(f => !f.isConnected)`) instead. In the SPA-teardown case this
  targets (a whole subtree/form removed in one DOM operation), every descendant
  field detaches in the same synchronous mutation regardless of which check is
  used, so this refinement is not expected to change observed behavior for the
  motivating scenario — it only stops a stray SINGLE field removal (that is not a
  real form teardown) from firing a settle early. Flagging this as a deliberate,
  AC-directed behavior change rather than a byte-for-byte extraction, per this
  leg's own "report rather than silently fix" discipline precedent (see the
  Citation Audit's enumeration-miss history above).
- **A latent gap found while reasoning through the design, NOT fixed (out of
  this leg's authorized scope) — reporting per the task's instruction to report
  rather than fold in**: `handleClosed`'s vault-capture branch's pre-existing
  `reason !== 'superseded'` top-level carve-out (DD1: "no new close logic is
  needed" for it) means that if an UNRELATED menu (kebab, suggestions, page-
  context, …) ever superseded an open `vault-capture` sheet, `sheetOpen` would
  stay stuck `true` and `pendingCaptureId` would stay stuck non-null forever for
  that window — `advance()`'s `sheetOpen` guard would then refuse to present any
  further queued offer until SOME OTHER event happened to reset it (there is
  none on this path). Investigated whether this is reachable: `capture()`/
  `captureCard()` have no live callers outside `captureRelease` (confirmed, this
  leg's own AC1b citation), and `captureRelease`'s own re-entrant same-family
  resubmit case no longer causes an immediate `openOverlayMenu` model-replace
  under the new serial-queue design (a same-family resubmit now QUEUES behind the
  open sheet instead, so it never triggers `openMenu`'s live `'superseded'`
  path against `vault-capture` at all) — so the ONLY way `'superseded'` can still
  reach this branch today is a genuinely unrelated menu opening on top. This is a
  narrow, pre-existing-shaped edge case (the STUCK-sheetOpen consequence is new
  this leg; the underlying `reason !== 'superseded'` carve-out is not), and DD1
  explicitly said this branch needs no new logic — implemented exactly as
  specified rather than re-litigating the design. Recommend the Flight Director
  log a squawk to decide whether `sheetOpen` should also reset (without
  dismissing `pendingCaptureId`, to preserve the existing carve-out's intent) on
  a `'superseded'` vault-capture close.
- Test counts across the touched/new files, before → after this leg: 16 → 22
  (`vault-gesture-capture.test.js`), 87 → 88 (`guest-wiring.test.js`), 22 → 23
  (`register-browser-ipc.test.js`), 13 → 22 (`vault-controller-capture.test.js`),
  0 → 9 (new `vault-gesture-detach-watch.test.js`). No hang encountered in any
  targeted or full run; every `node --test` invocation used
  `--test-timeout=60000` per instruction and completed well inside it (full
  suite ~6.2-6.6s).
- **AC12 leaves the eslint config change unremarked-on for "identity"** — the new
  `eslint.config.mjs` line names the new module by its literal filename, which
  contains no occurrence of the word "identity"; confirmed by re-reading the
  diff.

#### Post-landing fix: the stuck `sheetOpen` / dead `'superseded'` carve-out (Flight Director-classified in-scope, LD2/AC5b/AC5c/AC5d)

The Notes section above flagged, but explicitly deferred as out-of-scope, a
latent defect: `handleClosed`'s `vault-capture` branch guarded its whole body
on `reason !== 'superseded'` (a pre-existing, DD1-blessed carve-out — "no new
close logic needed"), which meant a `'superseded'` close of `vault-capture`
left `sheetOpen` stuck `true` forever, and `advance()`'s idempotency guard
(`if (sheetOpen) return;`) then refused every future call — no capture offer
could ever present again for that window. `OCCLUSION_CLOSE_REASONS` already
listed `'superseded'` (mirroring `auth-challenges.js`'s occlusion bucket), but
because the occlusion check sat *inside* the same `reason !== 'superseded'`
guard, that set entry was structurally dead — `'superseded'` could never reach
it. The Flight Director reviewed the deferral and overruled it: `sheetOpen` is
state this leg introduced, so its lifecycle bug is this leg's to fix now,
before Leg 2 is folded into the flight's single end-of-flight review/commit.

**Unreachability verification (required before touching anything.)** The task
required confirming, before applying any fix, that no path can open a
`vault-capture` sheet while one is already open — otherwise the old carve-out
would still be protecting something real. Grepped every caller of
`openCaptureSheet` and every `openOverlayMenu('vault-capture', …)` /
`"vault-capture"` site under `src/renderer/` and `src/shared/`:

```
$ grep -rn "openCaptureSheet\|'vault-capture'\|\"vault-capture\"" src/renderer/ src/shared/
src/renderer/menu-overlay.js:2865:  /** @type {{ ... | 'vault-capture' | ... }} */
src/renderer/menu-overlay.js:2880:    'vault-capture': 'vault-capture', // M12 F2 Leg 4 — the SEVENTH kind (see above)
src/renderer/menu-overlay.js:3005:              template === 'vault-capture' ||
src/renderer/menu-overlay.js:3100:    } else if (template === 'vault-capture') {
src/renderer/chrome/vault-controller.js:142:  function openCaptureSheet(captureId, model) {
src/renderer/chrome/vault-controller.js:152:    openOverlayMenu('vault-capture', { ...model, choices, captureId }, null, 0);
src/renderer/chrome/vault-controller.js:204:      openCaptureSheet(next.captureId, next.model);
src/renderer/chrome/vault-controller.js:481:    'vault-capture': {
src/renderer/chrome/vault-controller.js:730:    if (menuType === 'vault-capture' && reason !== 'superseded') {
```

The `menu-overlay.js` hits are the sheet's own template-dispatch/render plumbing
(not an opener); `vault-controller.js:481` is the `SHEET_STATES` config entry
(token/blur bookkeeping table, not a call site). `openCaptureSheet` (`:142`)
has exactly ONE caller — `advance()` at `:204` — and `openOverlayMenu(
'vault-capture', …)` (`:152`) has exactly one call site, inside
`openCaptureSheet` itself. `advance()` (`:200-201` at the time of the audit)
returns immediately whenever `sheetOpen` is `true`, before ever reaching the
`openCaptureSheet` call. Also grepped for a `vault-capture` audit-hook opener
(the `openVault*OverlayForAudit` family) — none exists for this menuType (the
family covers `vault-set`/`vault-recovery-show`/`vault-stepup`/
`vault-accesskey-show`/`vault-import-unlock`/`vault-change-master`/
`vault-recover`/`vault-adminkey-show`/`vault-compromise`/
`vault-compromise-recover`, never `vault-capture`). **Conclusion: a
`vault-capture` sheet can never model-replace another `vault-capture` sheet
under this leg's serial design — the carve-out's original justification (a
newer same-family capture model-replacing the open sheet) is unreachable, so a
`'superseded'` close of `vault-capture` can only mean an unrelated menu
(kebab, suggestions, page-context, address-bar) took over.** Proceeded to the
fix.

**The fix.** Removed the `reason !== 'superseded'` condition from the branch
guard (`if (menuType === 'vault-capture')` now covers every reason, matching
every other menuType's `handleClosed` branch). `'superseded'` now flows
through the SAME occlusion-class path as `'blur'` / `'tab-hide'` /
`'tab-switch'` (`OCCLUSION_CLOSE_REASONS` already contained it — no new set
entry needed): the shown record is dismissed, `dismissQueuedOffers()` drains
and dismisses the whole remaining queue (LD2), and `advance()` is deliberately
NOT called (advancing would pop a new vault-capture sheet open over the menu
the operator just opened). Replaced the stale carve-out comment with one
explaining the unreachability argument above and citing the two consequences
the bug caused (a permanently stuck `sheetOpen`, and an abandoned held record
surviving to the 2-minute TTL instead of being dismissed immediately).

**Tests** (`test/unit/vault-controller-capture.test.js`, three new, appended
after the existing AC8 test — none deleted, none weakened):
- *"regression: a "superseded" close of vault-capture (an unrelated menu taking
  over) drops the shown record, dismisses the queue, and does NOT wedge future
  presentation"* — opens one offer, closes it with reason `'superseded'`,
  asserts the record was dismissed, then pushes a brand-new offer and asserts
  it STILL opens a sheet (the actual regression: pre-fix this would never
  open).
- *"a "superseded" close of vault-capture dismisses the displayed record AND
  every queued offer, opening nothing"* — two offers queued, `'superseded'`
  close, asserts BOTH captureIds dismissed, nothing new opens, and a later
  unrelated `onVaultLockState` broadcast resurrects nothing (queue genuinely
  empty, not merely un-advanced).
- *"invariant: while a vault-capture sheet is open, a further offer is QUEUED,
  never opened — openOverlayMenu("vault-capture", …) fires at most once until a
  close"* — pins that a second offer while one sheet is open never opens a
  second `vault-capture` sheet, that a `'superseded'` close still opens
  nothing new, and that a THIRD, fresh offer arriving after that close is free
  to open its own sheet (proving the guard is a serialization invariant, not a
  permanent lock — this is the assertion that would have caught the stuck-state
  bug most directly).

**Neuter-verification.** Temporarily restored the old guard
(`if (menuType === 'vault-capture' && reason !== 'superseded') {`) via a
scoped `sed` edit, reran the targeted file, and observed RED on exactly the
three new tests:

```
# tests 25
# suites 0
# pass 22
# fail 3
# cancelled 0
# skipped 0
# todo 0
```

The three failures were, in order: the regression test (`h.opens.length`
stayed `1` — the fresh offer after the `'superseded'` close never opened,
i.e. the actual bug reproduced), the dismiss-the-whole-queue test (`deepEqual`
failure: expected `['cap1', 'cap2']`, got `[]` — nothing was dismissed because
the carve-out skipped the whole branch body), and the invariant test
(`1 !== 2` — the fresh third offer could not open its own sheet). Restored the
fix (`sed` reverted the same line) and confirmed the restored file is
byte-identical to the fix as applied (`diff` against a pre-neuter backup copy
showed no differences); reran the targeted file — 25/25 pass.

**Existing assertions.** No existing test in
`test/unit/vault-controller-capture.test.js` asserted the OLD `'superseded'`
carve-out behavior for the `vault-capture` menuType (the file's other
`'superseded'` reference, at the pre-existing "every unlock-prompt close…"
test, exercises the UNRELATED `vault-unlock` menuType's reason-agnostic drop
path and is untouched by this fix) — so no existing assertion required
retargeting; all edits here are additions. Also grepped every other test file
touching both `vault-capture` and `'superseded'`
(`vault-gesture-capture.test.js`, `vault-card-capture.test.js`,
`modal-card-controller.test.js`) — each use of "superseded" there is the
unrelated main-side held-record supersession vocabulary (a NEW gesture
evicting a prior held record), not this chrome-side close-reason path; none
needed changes.

**Assertion count** (`grep -c 'assert\.' test/unit/vault-controller-capture.test.js`):
58 (Leg 2 landed, per the Notes above) → **70** (+12, all three new tests,
0 removed — confirmed via `git diff` showing only added `assert.*` lines in
this file for this change).

**Test counts.** `test/unit/vault-controller-capture.test.js`: 22 → 25 (+3).
Full suite: **5323 tests, 5320 pass, 0 fail, 0 cancelled, 3 todo, 0 skipped**
(up from Leg 2's landed 5320/5317 — +3 tests, exactly the three new tests in
this one file; no other file changed).

**Gates.** `npm test` — 5320/5320 pass (3 todo, as above). `npm run lint` —
clean. `npm run typecheck` — clean. `npm run format` — no changes needed to
either touched file (`prettier --check` on both individually, and the
project-wide `npm run format:check`, both report "All matched files use
Prettier code style!"). `renderer.js` untouched by this fix and still 1550
lines (this defect and its fix are entirely inside
`src/renderer/chrome/vault-controller.js` and its test file — no `renderer.js`
edit was made, no `RENDERER_LINE_BUDGET`/pin re-check was needed beyond the
unchanged count already confirmed). **Local Concourse CI needs an interactive
login unavailable in this environment — these four local gates stood in for
it. This is not a claim that hosted CI ran.**

Leg 2's status remains `landed`; this fix is folded into the same leg entry
per the task's instruction (working tree stays uncommitted — review and
commit happen at end-of-flight per this project's single-review-per-flight
model).

---

### Leg 3: identity-fill
**Status**: landed
**Started**: 2026-09-20
**Completed**: 2026-09-20

#### Changes Made

- **LD1 extraction, its own first step**: `src/preload/field-setters.js` (new)
  holds `setFieldValue`/`setChoiceValue` moved VERBATIM out of
  `vault-card-fields.js`. Proven a pure move before any other edit:
  `git diff --stat test/unit/vault-card-fields.test.js` showed no output, and
  the file's 48 tests passed unmodified at that checkpoint. `vault-card-fields.js`
  and the new `vault-identity-fields.js` both now `require('./field-setters')`.
  `eslint.config.mjs` gained `'src/preload/field-setters.js'` in the
  CJS-required-by-the-preload `files:` array (AC23).
- **Detection** (`src/preload/vault-identity-fields.js`): `IDENTITY_ROLES =
  [...POSTAL_ROLES, ...NON_POSTAL_ROLES]` (AC3b — the ONE definition, replacing
  what would have been a third hand-typed copy). `isClaimedByCard(field, doc)`
  (AC1, DD5), built from `findAllCardFields` exactly as `isClaimedByLogin` is
  built from `findAllLoginFields`, checking all six card roles
  (`CARD_CLAIM_ROLES`) — applied in `candidateFields` alongside
  `isClaimedByLogin`. `identityEntryForScope` now stamps `entry.anchorRole`
  (the postal anchor's own role name) and `entry.nonPostalAnchor` (the scope's
  first non-postal field) at the one call site where both are already in scope
  (AC3).
- **Fill** (`src/preload/vault-identity-fields.js`): `fillIdentityForm(doc,
  identity, ordinal)` (AC5) — top-frame guard, resolves the entry by ordinal
  with fallback to entry 0, writes each of the eleven `IDENTITY_ROLES` fields
  via `field-setters.js` (`setChoiceValue` for a `<select>`), skips
  absent/empty values, returns the `{filled, fields}` contract.
- **Isolated world** (`src/preload/vault-entry-observer.js`,
  `vault-entry-observer-bootstrap.js`, `vault-entry-tracker.js`): the observer
  takes an injected `findAllIdentityFields`, imports `IDENTITY_ROLES` (AC3b —
  never hand-typed a third time), and `detect()`/`isDetectedField()`/
  `snapshot()` all gained an `identities` arm (AC4) — `snapshot()` now returns
  `{logins, cards, identities}`. `OBSERVER_LINE_BUDGET` raised 410 → 425
  (documented in the test file, same house idiom as its two prior raises).
  The bootstrap requires `findAllIdentityFields`/`fillIdentityForm`, exposes
  `fillIdentity({identity, ordinal})` (AC7), and `fillLogin`/`fillCard` now
  destructure `{cred, ordinal}`/`{card, ordinal}` instead of taking the
  credential/card directly (DD9's payload shape — `callScript` embeds exactly
  one JSON argument). `vault-entry-tracker.js`'s `resolveTargetForAnchor`
  gained a third, LAST arm (AC15, DD5 login>card>identity) resolving either of
  an identity entry's two icon fields to its postal `anchor` as the fill
  target; `EMPTY_SNAPSHOT` and `readSnapshot`'s shape check both gained
  `identities: []` / `Array.isArray(result.identities)`; the returned object
  gained `fillIdentity: (payload) => runFill('fillIdentity', payload)`.
- **AC9 (the ordinal fix — REUSED, no new helper)**: `webview-preload.js`'s
  three fill handlers (`vault-fill`, `vault-fill-card`, and the new
  `vault-fill-identity`) each call `vaultIcons.consumeFillTarget(kind)`, then
  `resolveOrdinalInFamily(target, findAll<Family>Fields(document),
  <FAMILY>_ROLES)` (imported from `vault-gesture-policy.js`, which already
  exported it, `LOGIN_ROLES`, and `CARD_ROLES`), and route `{<payload>,
  ordinal}` into `entryTracker.fill<Family>`. No new ordinal-resolution code
  was written anywhere.
- **AC11 (the ordinal contract)**: `fillLoginForm`'s and `fillCardForm`'s third
  parameter changed from a node target to `ordinal: number | null` — resolves
  `findAll<Family>Fields(doc)[ordinal]` when it's a valid in-range integer,
  else falls back to today's first-detected-entry heuristic. No overloading:
  the parameter is never both a node and a number. `isLivePasswordField(doc,
  targetPassword)` / `isLiveCardNumberField` are no longer called from either
  fill function (their sole production call site each) but are UNCHANGED,
  still exported, per AC11c (squawk 0098 already logs them as dead).
- **Icon** (`src/preload/vault-fill-icon.js`): `buildVaultLockIcon`'s `noun`
  is now three-way (`login`/`card`/`identity`); `identityAnchorsOf(entry)`
  returns `[entry.anchor, entry.nonPostalAnchor].filter(Boolean)`;
  `anchorKinds()` gained a THIRD walk over `identityEntries(doc)`, identity
  last, behind the same `!kinds.has(field)` guard (AC13 — the site DD8 warned
  the flight spec itself missed once); the local `targetForAnchor` fallback
  (used when no `resolveTarget` is injected) gained the matching identity arm.
  `webview-preload.js`'s controller construction now injects
  `findAllIdentityFields` and threads it into `resolveTarget`. The
  attribute-set pin (AC14 — no `data-kind`) passes unmodified; a new test
  re-asserts it against a rendered identity icon.
- **Main side**: `vault-store.js` gained `reachableIdentityItems(jarId)`
  (AC16) — the `reachableCardItems` shape (no origin, `[]` on locked/burner),
  reading through `identityProfileOf` (never `items.find`), returning
  `{vaultId, id, title, fullName}`. `vault-human.js`'s `reachableItems` gained
  a third arm stamping `type: 'identity'` (AC17, logins → cards → identity);
  `fillHuman` gained a third branch chosen by the stored item's own `type`
  (AC18, DD7 — not origin-gated) calling the new `fillIdentityDelegate` with a
  payload built from `identity-profile.js`'s exported `IDENTITY_FIELDS` (never
  re-typed). `main.js` wires `fillIdentityDelegate` beside `fillCardDelegate`
  (AC19).
- **Picker** (`src/shared/vault-picker-template.js`): `KIND_TABLE` gained an
  `identity` entry — heading "Identity", fallback title "Identity", a new
  `buildIdentityIcon` (person silhouette, same createElementNS discipline),
  secondary line = `fullName` (AC20). `EMPTY_PICKER_NOTE` updated to "No saved
  logins, cards, or identities to fill here" and its own comment corrected to
  name Leg 3 (not "Leg 4") as the leg that changes it — Leg 1's own review
  precedent for fixing a misattributing comment rather than leaving it stale.

#### Per-AC Verification

- **AC1/AC2** — `vault-identity-fields.test.js`: "AC1/AC2: a field claimed by
  the card detector (card_nameOnCard) does not resolve as identity fullName"
  and its control ("AC2 control: the SAME spelling with NO card number…"),
  plus two `isClaimedByCard` shape tests (all six roles; no-card-in-doc).
  4/4 pass.
- **AC3/AC3b** — "AC3: the entry carries anchorRole… and nonPostalAnchor…"
  and "IDENTITY_ROLES is the eleven roles, derived from POSTAL_ROLES +
  NON_POSTAL_ROLES" (also independently pinned in
  `vault-entry-observer.test.js`). Both pass.
- **AC4** — `vault-entry-observer.test.js`: 3 new identity-snapshot/grant
  tests pass; 3 PRE-EXISTING tests that `deepEqual` the FULL snapshot shape
  (`an untrusted (synthetic) input/keydown never grants…`, `a trusted input on
  a detected field grants provenance…`, `snapshot shape: detected+provenanced,
  detected+unprovenanced, and never-detected…`) were widened in place to
  expect `identities: []` — a direct, mechanical consequence of AC4's own
  shape change, not an AC11b regression test. The SAME consequence hit three
  more pre-existing tests in `test/unit/save-moment-extractor.test.js`
  (the extractor's own integration tests against `createEntryObserver`),
  widened identically. `vault-entry-tracker.js`'s `EMPTY_SNAPSHOT`/
  `readSnapshot` shape-check widening likewise required updating 5
  pre-existing mocked-payload tests in `vault-entry-tracker.test.js` (adding
  `identities: []` to both the mocked `execInWorld` resolution and the
  expected result) — none of these 8 are AC11b's five; they are AC4's/AC7's
  own ripple, listed here for completeness per the "list every test touched"
  discipline.
- **AC5** — `vault-identity-fields.test.js`: 8 `fillIdentityForm` tests
  (writes matching roles/skips empty; skips undetected role; `<select>` via
  `setChoiceValue`; `<select>` no-match leaves untouched; no entry on page;
  null identity; top-frame guard; ordinal fallback) — all pass.
- **AC6** — mid-leg checkpoint confirmed above (pure move, card's 48 tests
  unmodified and green before any other edit).
- **AC7** — `vault-entry-tracker.test.js`: "AC7: fillIdentity calls
  h.fillIdentity(...) with the {identity, ordinal} payload" — pass.
- **AC8** — `npm run build:preload` then
  `vault-entry-observer-bundle.test.js`: 13/13 pass, including the widened
  "inlines the observer core and the pure field modules" test (added
  `fillIdentityForm`/`findAllIdentityFields`, never removed the two prior
  names) and the "end-to-end" fill test, rewritten to the new
  `{cred, ordinal}` payload shape (a direct AC7 consequence, not AC11b).
- **AC9** — REUSED `resolveOrdinalInFamily` verbatim; grep confirms no new
  ordinal-resolution function exists anywhere under `src/preload/`:
  `grep -rn "function resolveOrdinal" src/preload/` → one hit,
  `vault-gesture-policy.js:117`, unchanged.
- **AC10** — code-reviewed in `webview-preload.js` (this file has no
  `node --test` harness of its own — its top-level `window`/`ipcRenderer`
  side effects throw in plain Node, per its own header note; the same reason
  every prior leg touching it verifies by code review + the bundle tests).
  All three handlers pass `{<payload>, ordinal}`, never a second positional
  argument.
- **AC11/AC11b** — the FIVE regression tests, rewritten in place at the SAME
  strength, never deleted:
  - `vault-fill-fields.test.js:242` → "ordinal 1 fills the SECOND login form,
    not the document-first (finding 9)" — passes ordinal `1`, still asserts
    form B filled and form A untouched.
  - `vault-fill-fields.test.js:264` → merged with `:270` into "a null /
    out-of-range ordinal falls back to the first-field heuristic (MCP path)"
    — passes `null` then `99`, still asserts the first-entry fallback both
    times (AC11b's own prescribed collapse of the null/foreign/detached cases
    into "an out-of-range ordinal").
  - `vault-card-fields.test.js:465` → "ordinal 1 selects the SECOND card form
    on a multi-card page" — passes ordinal `1`, still asserts form B filled,
    form A untouched.
  - `vault-card-fields.test.js:475` → "an out-of-range ordinal falls back to
    the first detected entry" — passes `99`.
  All five pass; `vault-fill-fields.test.js` 15/15, `vault-card-fields.test.js`
  48/48.
- **AC11c** — verified: after AC11, `isLivePasswordField` is called only
  inside `vault-fill-fields.test.js`'s own standalone test (zero production
  callers); same for `isLiveCardNumberField`. Both kept, both exports and
  standalone tests unchanged (squawk 0098 already covers the dead-export
  disposition).
- **AC12 — neuter-verified for all three families, RED output recorded.**
  For each family, the ordinal branch's condition was temporarily forced to
  `false` (a one-line edit, reverted immediately after capturing the failure),
  and the family's own "ordinal 1 selects/fills the SECOND form" test was
  re-run in isolation:
  - **Login** (`vault-fill-fields.js`, `fillLoginForm`): forced false →
    `node --test --test-name-pattern="ordinal 1 fills the SECOND login form"
    test/unit/vault-fill-fields.test.js` → **1 fail** — `AssertionError:
    Expected values to be strictly deep-equal` (the actual fill landed on
    form A's fields, empty, instead of form B's). Restored → 1/1 pass.
  - **Card** (`vault-card-fields.js`, `fillCardForm`): forced false →
    `node --test --test-name-pattern="ordinal 1 selects the SECOND card form"
    test/unit/vault-card-fields.test.js` → **1 fail** — `expected:
    '4242424242424242', actual: ''` (form B's number field never received the
    PAN). Restored → 1/1 pass.
  - **Identity** (`vault-identity-fields.js`, `fillIdentityForm`): forced
    false → `node --test --test-name-pattern="AC12 identity twin"
    test/unit/vault-identity-fields.test.js` → **1 fail** — `expected: '2
    Second Ave', actual: ''` (form B's street field never received the
    value). Restored → 1/1 pass.
  All three neuter-runs confirmed RED for exactly the targeted test and no
  other; the identity twin test ("AC12 identity twin: ordinal 1 fills the
  SECOND identity-anchored form, not the document-first") is the new pin AC12
  names — two identity-anchored forms, ordinal 1, the second is filled.
  Full suite re-run green after each restore.
- **AC13/AC14/AC15** — `vault-fill-icon.test.js`: 6 new tests (postal-anchor
  icon renders + is aria-labeled "identity"; the non-postal anchor ALSO gets
  an icon; the attribute-set pin re-asserted unmodified against an identity
  icon — AC14; DD5 login-wins-a-contested-field precedence; clicking either
  icon binds the entry's POSTAL anchor as the fill target; `consumeFillTarget`
  kind-isolation). `vault-entry-tracker.test.js`: 2 new `resolveTargetForAnchor`
  tests (the identity arm resolving either icon field to the postal anchor;
  DD5 login>card>identity precedence). All 8 pass; the pre-existing 16 icon
  tests and pre-existing `resolveTargetForAnchor` tests pass unmodified.
- **AC16-AC19** — new `test/unit/vault-identity-fill.test.js` (18 tests,
  modeled directly on `vault-card-fill.test.js`'s harness): the no-origin-gate
  fill at an unrelated merchant; a global identity filling on a jar tab; the
  fill result carries no identity data; the identity rides its own channel
  (never the login channel); locked/burner/cross-jar/closed-tab refusals; an
  omitted `fillIdentityDelegate` refuses rather than drops; the login path is
  untouched; `reachableItems` merges all three families with identity last and
  is metadata-only; `reachableIdentityItems` read through `identityProfileOf`
  directly. All 18 pass; `vault-human.test.js` (26) and `vault-card-fill.test.js`
  (unchanged) still pass, confirming no regression to the two existing
  branches.
- **AC20** — new `test/unit/vault-identity-picker.test.js` (12 tests, modeled
  on `vault-card-picker.test.js`): the identity secondary line/glyph/fallback
  title; three-way sectioning (`Logins`, `Cards`, `Identity`, in that order);
  the `data-pick-index` FULL-model-index invariant across three families and
  their headings. `vault-picker-template.test.js`'s two tests that literal-
  matched the OLD empty-picker copy were updated to the new three-family
  string (a direct AC20 consequence, not a new defect). All pass.
- **AC21** — 3 new tests in `vault-context.test.js` pin that `list()`,
  `fill()`, and `answerAuth()` each refuse a real `type: 'identity'` item
  (no-match / absent from the list) — no code change, as expected.
- **AC22** — `grep -n "identity" src/preload/vault-gesture-policy.js` →
  one hit, a pre-existing unrelated comment ("match by identity against every
  role", object identity, not the family) — `git diff --stat` on this file is
  empty; `resolveGestureTarget` untouched.
- **AC23** — verified: `eslint.config.mjs` lists
  `'src/preload/field-setters.js'` in the CJS `files:` array; `npm run lint`
  is clean.
- **AC24** — gates below.

#### Test counts

Full suite: **5323 → 5384 tests (+61)**, **5381 pass, 0 fail, 0 cancelled, 3
todo** (the same three pre-existing `[known-unsolved]` corpus fixtures — no
new todos). Per-file breakdown of the +61: `vault-entry-observer.test.js` +4,
`vault-entry-tracker.test.js` +3, `vault-identity-fields.test.js` +15,
`vault-fill-icon.test.js` +6, `vault-context.test.js` +3, new
`vault-identity-fill.test.js` +18, new `vault-identity-picker.test.js` +12 —
sums to 61. `vault-fill-fields.test.js`, `vault-card-fields.test.js`, and
`vault-entry-observer-bundle.test.js` net zero (tests rewritten in place, per
AC6/AC11b/AC7 respectively); `save-moment-extractor.test.js` net zero (3
tests widened in place per AC4's ripple).

#### Gates

`npm test` — 5381/5381 pass (3 todo, unchanged corpus gaps). `npm run lint` —
clean. `npm run typecheck` — clean (one fix needed: the bootstrap's
`fillLogin`/`fillCard`/`fillIdentity` handle methods gained explicit
`@param {{ cred?: any, ordinal?: number|null }}`-shaped JSDoc, since a bare
destructured-with-default parameter otherwise infers `{}` and `tsc` rejects
reading `.cred`/`.ordinal` off it). `npm run format` then `npm run
format:check` — clean; `npm run build:preload` re-run after every change
touching anything the isolated-world observer imports, per the leg's own
Implementation Guidance, and the bundle/webview-preload bundle test suites
re-run green after each rebuild. `renderer.js` untouched, still 1550 lines —
confirmed via `git diff --stat src/renderer/renderer.js` (this leg's diff is
empty) and a direct line-count read. **Local Concourse CI needs an
interactive login unavailable in this environment — these four local gates
stood in for it. This is not a claim that hosted CI ran.**

#### Design-review fixes carried in (recap)

Both HIGHs from the design-review round noted in the Flight Director Notes
above are reflected in the implementation as landed: AC9 reuses
`resolveOrdinalInFamily` (no new helper anywhere), and AC11b's five tests are
rewritten in place rather than deleted, at the same strength.

#### Deviations / out-of-scope findings

None beyond what the leg spec itself names as squawked (0097, 0098) or
carried to Leg 4 (`familyOf`'s three-way widening, the `fullName` composition
open question) — both already logged before this leg began.

Leg status → `landed`.

---

### Leg 4: identity-capture
**Status**: landed
**Started**: 2026-09-20
**Completed**: 2026-09-20

#### Changes Made

- **LD1 landed FIRST, alone, before any identity code existed** (`src/main/vault/vault-human.js`):
  `familyOf(rec)` is now three-way and fail-closed — `undefined`/absent `kind`
  → `'login'`, `'card'`/`'identity'` → themselves, ANYTHING else (an explicit
  `null`, `''`, `'constructor'`, an unrecognised string) → `null`. A new
  exported `dispatchByFamily(rec, { login, card, identity })` calls exactly the
  matching handler and returns the new exported frozen `FAMILY_REFUSED`
  sentinel when `familyOf(rec)` is `null` — invoking NO handler. `familyOf`,
  `dispatchByFamily`, and `FAMILY_REFUSED` are all added to `module.exports`.
  `captureRelease`, `captureFinalize`, and `captureSave` were each rewritten to
  route their family branch through `dispatchByFamily`; each site maps
  `FAMILY_REFUSED` to its OWN pre-existing "record is gone" behaviour after
  dropping+zeroizing the record itself (`captureRelease` omits it from the
  returned array; `captureFinalize` → `{ reason: 'expired' }`; `captureSave` →
  `{ saved: false }`) — no new reason string, no new chrome handling. The full
  suite stayed green through this step alone, with identity records still
  impossible to create (per Guidance 1).
- **LD7 landed SECOND, still before identity existed**: `dropCapture` no
  longer walks the named list `['password', 'number', 'cvv']` — it now
  zeroizes every own `Buffer.isBuffer` field on the record via
  `Object.values(rec)`, replacing the obsolete "a new secret field MUST be
  added here" comment with one stating the new invariant. A test-only seam,
  `_seedCaptureForTest(rec)` (inserts `rec` directly into the private
  `captures` Map, keyed by its own `captureId` — mirrors
  `vault-entry-observer.js`'s underscore-prefixed introspection precedent),
  was added to the returned API so AC2b and AC11(c) could exercise a record no
  public constructor can build (an unrecognised `kind`, or an arbitrary
  never-before-seen Buffer field) through the REAL `captureRelease`/
  `captureFinalize`/`captureSave`/`captureDismiss` rather than a synthetic
  stand-in.
- **Identity capture, built on both** (`vault-human.js`): `IDENTITY_FIELD_LABELS`
  (DD6 — a manually-paired mirror of `vault-editor-model.js`'s
  `EDITOR_LAYOUT.identity` labels; this module is main-only CJS and cannot
  import that real ES module) + `labelsFor(fields)`. `holdGestureIdentity`
  (AC9) and `captureIdentity` (AC8b) — the identity twins of the login/card
  hold/capture pair, same gate (set up, persistent jar, origin), same
  family-scoped supersession loop keyed on `familyOf(prior) === 'identity'`,
  same `mode: 'locked'` deferral when the vault is locked. `decodeIdentitySecrets(rec)`
  transiently decodes `rec.identitySecrets`' JSON (reusing `IDENTITY_FIELDS`,
  already imported from `identity-profile.js`) plus `rec.fullName`.
  `identityProfileFor(jarId)` (LD6) — jar vault checked before global, via
  `identityProfileOf` at each vault visited, returning as soon as either holds
  a profile (surfacing that vault's own `extra` for LD9). `disposeIdentityCapture(rec)`
  (AC13, DD10's first live wiring of `classifyCapture`): refuses outright
  (LD9, traced via the new optional `deps.trace`) when `found.extra.length >
  0`; else calls `classifyCapture(found?.profile ?? null, captured)` and maps
  `match` → no offer (dropped), `gap-fill`/`conflict` (an existing profile) →
  an `update` offer stamping `rec.identityGapFilled`/`rec.identityConflicting`
  (LD8's write-set) and returning `{ kind, origin, mode, addedFields,
  changedFields, defaultVaultId, choices }` with LABELS only (DD6), no profile
  anywhere → a `save` offer naming every captured field as `addedFields`.
  `captureSave`'s identity branch (LD4/LD8): a `save` writes a new
  `type:'identity'` item titled the fixed `"My details"` with every captured
  field; an `update` writes EXACTLY `rec.identityGapFilled ∪
  rec.identityConflicting` over the existing item — never a spread.
- **LD9** (`vault-human.js` + `main.js`): `VaultHumanDeps` gained an optional
  `trace(event, detail)`, defaulted to a no-op (`_trace`) inside
  `createVaultHuman` — the module stays Electron-free. `main.js`'s
  `getVaultHuman()` wires the real one behind the SAME `GOLDFINCH_VAULT_TRACE`
  env gate and the SAME `[vault-capture]` prefix `register-browser-ipc.js`'s
  own `vaultTrace` already uses.
- **Gesture + gate** (`src/preload/vault-gesture-policy.js`): imports
  `IDENTITY_ROLES`/`POSTAL_ROLES`/`NON_POSTAL_ROLES` from
  `vault-identity-fields.js` (never hand-typed a third time).
  `resolveGestureTarget` gained a third arm, checked LAST (DD5), reusing
  `resolveOrdinalInFamily` with `IDENTITY_ROLES` — no new resolver. A new
  `identitySnapshotHasProvenancedSecret(entrySnapshot)` implements AC6's
  value-layer gate (the snapshot's `anchorRole` must name a REAL member of
  `POSTAL_ROLES` whose field is provenanced, AND at least one
  `NON_POSTAL_ROLES` field must be provenanced too); `snapshotHasProvenancedSecret`
  dispatches identity to it instead of `secretRoleForKind`, which stays
  login/card-only and gained no identity branch.
- **LD3** (`src/preload/vault-entry-observer.js`): `snapshot()`'s identity
  mapping now spreads `anchorRole: typeof entry.anchorRole === 'string' ?
  entry.anchorRole : null` onto each identity snapshot entry — read from the
  main-world detector's own `entry.anchorRole` (Leg 3), never re-derived, so
  the value-layer gate reads anchor role AND values from ONE isolated-world
  enumeration. File landed at 423/425 lines (7 lines under the raised-at-Leg-3
  budget; the "carries no policy" forbidden-word source scan still passes — no
  `update`/`save`/`dispose`/`captureId`/IPC vocabulary was introduced). One
  pre-existing test (`vault-entry-observer.test.js`'s full-snapshot-shape
  `deepEqual`) was widened in place to include `anchorRole` — a direct,
  mechanical consequence of the shape change, matching the AC4/AC11b precedent
  Leg 3 set for this exact class of ripple. `npm run build:preload` re-run;
  `vault-entry-observer-bundle.test.js` and `webview-preload-bundle.test.js`
  both green after the rebuild.
- **Guest send** (`src/preload/webview-preload.js`): `onCaptureGesture`'s
  three dispatch sites (`resolveGestureTarget` call, the `entry` resolution,
  the `entrySnapshot` resolution) are now explicit three-way ternaries
  (login/card/identity), matching the leg's own citation of `:580`/`:590`/`:595`.
  A new identity branch builds LD2's single secrets object (`IDENTITY_ROLES`
  filtered to exclude `fullName` — the ten secret roles, reusing the existing
  import rather than a new list), JSON-encodes it, and sends
  `guest-vault-capture-identity { identitySecrets, fullName }`, then arms the
  per-family detach watch with kind `'identity'` over every one of the
  entry's eleven role fields present. `armGestureDetachWatch`'s JSDoc widened
  to `'login' | 'card' | 'identity'`.
- **Main IPC** (`src/main/register-browser-ipc.js`): new
  `guest-vault-capture-identity` handler — wcId from `event.sender.id`,
  forwards `{ identitySecretsBytes: identitySecrets, fullName }` to
  `getVaultHuman().holdGestureIdentity`, traces via the existing
  `vaultTrace('gesture-hold', { wcId, held, kind: 'identity' })` idiom. Holds
  only — never offers, matching the login/card twins.
- **Sheet** (`src/shared/vault-capture-template.js`): `KIND_TABLE` gained an
  `identity` entry with its OWN `heading(model)` function — MODE-DISPATCH
  WITHIN the family (AC17): `save` → "Save your details?"; `update` with an
  empty `changedFields` → "Add to your saved details?"; `update` with a
  non-empty `changedFields` → "Update your saved details?". `subjectValueText`
  joins `addedFields`/`changedFields` labels (a conflict names both groups,
  separated by " · "), falling back to `(no fields)`. `renderVaultCaptureCard`
  now calls `entry.heading(model)` when a kind supplies one, else the
  unchanged generic `${Save|Update} ${noun}?` construction — card/login are
  byte-identical, unaffected. `kindOf`'s JSDoc widened to include `'identity'`.
  AC18 (aria-label = `heading.slice(0, -1)`) required no code change — it
  already operates on the `heading` variable, whichever branch produced it.
- **Corpus** (`test/fixtures/save-moment/`): `billing-jostens.html` gained
  `value="…"` attributes on every field (AC19 — the corpus's own stand-in for
  "the operator typed this"; the fixture had none before, since it was
  `detects`-only) and its header comment updated; `manifest.js`'s entry
  promoted `tier`/`assert` together to `'gated'`/`'offers'` (the submit button
  sits INSIDE `<form id="billing-address">`, a real headlessly-provable native
  submission). `incident-report-third-party` was left untouched at
  `'gated'`/`'detects'` (AC20 — NOT promoted; it is Flight 2's named accepted
  false positive).
- **Test helper three-way widening** (`test/helpers/save-moment-assertions.js`,
  Guidance 3c): `buildProvenancedObserver` now also detects identities and
  grants provenance for their non-empty values, returning `identities`
  alongside `logins`/`cards`; a new `snapshotEntriesFor(snapshot, kind)`
  replaces the binary `resolved.kind === 'card' ? snapshot.cards :
  snapshot.logins` ternary at BOTH of its call sites
  (`resolveCaptureWorthyGesture` and `assertNoOffer`) — the exact class of
  defect the leg's Central Danger table warns about, caught here in a file
  the table itself said was out of its scan.

#### The Central Danger table, re-probed after landing

Per the leg's own instruction to report any site the table misses: the table
covered every capture-path site by shape-grep. The ONE additional site found
during implementation (not by the table, but by Guidance 3c, which explicitly
flagged the test helper as carrying its own binary sites) was
`save-moment-assertions.js`'s `resolveCaptureWorthyGesture`/`assertNoOffer`
snapshot-picking ternary — closed above. No other missed site was found; the
grep-AC below confirms the table's own citations are gone from the
implementation.

#### Per-AC Verification

- **AC1** — `vault-identity-capture.test.js`: "AC1: familyOf is three-way and
  fail-closed" — 8 assertions in one test (absent, no-record, card, identity,
  `'constructor'`, `''`, `'bogus'`, explicit `null`). Pass.
- **AC2** — "AC2: dispatchByFamily invokes exactly the matching handler…" —
  drives `dispatchByFamily` directly with three recording handlers; confirms
  each known family invokes exactly its own handler and a bogus kind invokes
  none, returning `FAMILY_REFUSED`. "AC2: FAMILY_REFUSED is a frozen
  sentinel…" pins `Object.isFrozen`. Both pass.
- **AC2b** — driven via the `_seedCaptureForTest` test seam (reported per the
  AC's own "whichever the implementer can reach" instruction — no public
  constructor can build an unrecognised-`kind` record, so a seam that inserts
  one directly into the private `captures` Map was added, rather than
  reconstructing each site's handlers standalone). Four tests: `captureRelease`
  omits the refused record and the id resolves gone afterward;
  `captureFinalize` maps it to `{ reason: 'expired' }` (twice, confirming
  idempotence); `captureSave` maps it to `{ saved: false }`; a refused
  record's own Buffer field is zeroized (not just dropped) via
  `captureRelease`. All 4 pass. A companion grep-AC test
  (`grep -n "rec.kind === 'card'" src/main/vault/vault-human.js` returns
  nothing) is also pinned directly in the test file, re-confirmed
  independently below.
- **AC3 — the hard-zero pin, NEUTER-VERIFIED.** "AC3: a held identity record
  saved through captureSave writes type:"identity", NEVER type:"login"" pins
  the positive claim (passes). **Neuter-verification**: `captureSave`'s
  `dispatchByFamily` call was temporarily replaced with the literal old-shape
  binary `rec.kind === 'card' ? handlers.card() : handlers.login()` (routing
  identity into the login handler, exactly the leg's central-danger scenario),
  and the AC3 test re-run in isolation:
  ```
  not ok 1 - AC3: a held identity record saved through captureSave writes type:"identity", NEVER type:"login"
    error: "Cannot read properties of undefined (reading 'toString')"
    at Object.login (vault-human.js:1493:36)
  ```
  RED confirmed — the neutered binary dispatch throws inside the login
  handler (`rec.password.toString('utf8')` on a record with no `password`
  field), which is itself a symptom of "an identity record silently entered
  the login path": with a login record shaped to also carry SOME password-ish
  field the write would have silently succeeded as `type:'login'` instead of
  throwing — either way, a real defect that the guard exists to prevent, and
  the guarded (`dispatchByFamily`) version passes cleanly. Restored via the
  saved backup; `diff` confirmed byte-identical to pre-neuter; full identity
  suite (31/31) re-run green after restore.
- **AC4** — "AC4: a login, card and identity hold coexist on one tab; a
  second identity gesture evicts only the identity record; captureRelease
  returns all three" — holds all three families on one tab, supersedes the
  identity hold with a second identity gesture, confirms the login/card holds
  survive, and confirms `captureRelease` returns exactly 3 offers (login,
  card, the SURVIVING identity). Pass.
- **AC5** — `vault-gesture-policy.test.js`: "AC5: resolveGestureTarget
  resolves an IDENTITY entry when neither login nor card matches, checked
  LAST" + "AC5: DD5 precedence — login beats card beats identity…" + "AC5:
  missing `identities` defaults to an empty array". 3/3 pass.
- **AC6** — same file: anchor-only (false), non-postal-only (false), both
  (true), missing `anchorRole` (false), an unrecognised `anchorRole` — both a
  real-but-non-postal role (`'email'`) and a wholly bogus string (false in
  both cases), and a confirmation that `secretRoleForKind('identity')` is
  never consulted. 6/6 pass.
- **AC7** — `vault-entry-observer.test.js`'s widened
  `snapshot() returns an identities array…` test now asserts `anchorRole:
  'street'` is present; the "carries no policy" source-scan test and the
  425-line-ceiling test both still pass (423/425). `npm run build:preload`
  re-run; `vault-entry-observer-bundle.test.js` (13/13) and
  `webview-preload-bundle.test.js` (unaffected, still green) both pass.
- **AC8** — verified by CODE READING, per the leg's own Verification Steps
  note: `webview-preload.js` has no `node --test` harness of its own (its
  top-level `window`/`ipcRenderer` side effects throw in plain Node — the
  same limitation Leg 3 recorded for this file). `onCaptureGesture`'s three
  dispatch sites are explicit three-way ternaries; the identity branch sends
  `guest-vault-capture-identity` with `{identitySecrets, fullName}`; the
  detach watch arms with kind `'identity'`. Cross-checked against
  `register-browser-ipc.test.js`'s new IPC-shape test (AC10, below), which
  confirms the wire shape the guest side must produce.
- **AC8b** — `captureIdentity` is exercised throughout
  `vault-identity-capture.test.js` (gate, supersession, save/update/locked
  paths) and is called ONLY by `captureRelease`'s identity closure in
  production code (verified by reading: `captureIdentity` has no other call
  site in `src/`), mirroring the login/card twins' own call graph.
- **AC9** — "AC9: holdGestureIdentity GATE…drops silently and wipes the
  incoming bytes" (a burner tab) and "AC9: holdGestureIdentity creates a held
  record with NO offer…" both pass; a burner-tab `captureIdentity` test also
  passes.
- **AC10** — `register-browser-ipc.test.js`: "vault capture identity (M21 F3
  Leg 4, AC10): guest-vault-capture-identity HOLDS only" — asserts the
  handler derives `wcId` from `event.sender.id`, forwards
  `{wcId, identitySecretsBytes, fullName}` to `holdGestureIdentity`, and never
  forwards a `vault-capture-offer` at hold time. Pass.
- **AC11 — LD7's canary, NEUTER-VERIFIED.** Split into three tests: (a)
  `password`/`number`/`cvv` still zeroized (today's behaviour, now a subset) —
  pass; (b) `rec.identitySecrets` zeroized via dismiss, proven indirectly (a
  later save against the dropped id reports the record gone) — pass; (c) THE
  CANARY — a record carrying an arbitrary field name (`someBrandNewSecretBuffer`)
  holding a Buffer is zeroized by `captureDismiss` with NO edit to
  `dropCapture` — pass. **Neuter-verification**: `dropCapture`'s
  every-own-Buffer loop was temporarily reverted to the old named-list form
  (`for (const field of ['password', 'number', 'cvv'])`), and the canary
  re-run in isolation:
  ```
  not ok 1 - AC11(c) — THE CANARY: an arbitrary, never-before-seen Buffer field is zeroized too, with NO edit to dropCapture
    error: 'the never-before-seen Buffer field was zeroized with no edit to dropCapture'
    expected: true, actual: false
  ```
  RED confirmed cleanly. Restored via the saved backup; `diff` confirmed
  byte-identical to pre-neuter; full identity suite (31/31) re-run green.
- **AC12** — "AC12: releasing a pending identity hold does not zeroize the
  copy used for disposition" — holds, releases, and confirms the released
  offer's model is a real `save` disposition (not a zeroized/empty one),
  proving `captureRelease`'s identity closure copies `rec.identitySecrets`
  BEFORE `dropCapture` runs. Pass.
- **AC13** — 5 tests: a fresh vault (no profile anywhere) offers `save`
  naming every captured field as `addedFields` with labels (never raw role
  names); saving it writes `title:'My details'` with every field (LD4); an
  identical re-capture against a stored profile is a `match` (no offer); a
  gap-fill capture (a genuinely new field) offers `update` naming only the
  new field; a conflict capture (a differing existing field) offers `update`
  naming only the changed field. All 5 pass.
- **AC14 — the DD6 sentinel probe.** "AC14: the offer model never carries a
  captured VALUE anywhere" — captures a profile whose every field (including
  `fullName`) holds a distinctive `SENTINEL-*` string, then regex-searches
  `JSON.stringify(offer.model)` for each sentinel and asserts none appear.
  Pass — the model carries only field LABELS (e.g. "Email", "Street address"),
  never the captured values.
- **AC15** — "AC15: a LOCKED vault holds the identity capture and defers the
  disposition to finalize" — locks the store, captures (mode `'locked'`, no
  field data in the model), unlocks, calls `captureFinalize`, confirms the
  deferred `save` disposition, then `captureSave` writes the item. Pass.
- **AC16/AC16b** — the save/update-merge behaviour is covered by AC13's tests
  plus a dedicated "AC16b (LD8): an update writes EXACTLY the named fields —
  a stored phone with no phone in this capture survives untouched" test.
  **Neuter-verified**: the identity `update` branch's field-set write loop
  was temporarily replaced with a naive `{ ...existing, ...captured }` spread,
  and the AC16b test re-run in isolation:
  ```
  not ok 1 - AC16b (LD8): an update writes EXACTLY the named fields — a stored phone with no phone in this capture survives untouched
    error: "phone was never captured this time — must survive untouched\n\n'' !== '555-1234'"
  ```
  RED confirmed — the naive spread blanked the stored `phone` to `''` exactly
  as LD8 predicts. Restored via the saved backup; `diff` confirmed
  byte-identical to pre-neuter; full identity suite (31/31) re-run green. The
  store's one-profile-per-vault refusal is respected: an `update` targets the
  existing profile's own id (passes `_saveItem`'s guard); `captureSave`
  deliberately does not catch a `saveItem` throw, so a racing `save` would
  surface as a `VaultStateError` through the unchanged generic "Couldn't
  save" chain (verified by reading — no new try/catch was added around
  `store.saveItem` in the identity branch).
- **AC16c** — two tests against a lightweight fake store (standing in for a
  hand-edited `.gfvault` that violated the one-profile-per-vault invariant —
  the real `VaultStore._saveItem` guard prevents writing this through the
  ordinary API, so a fake store is the only way to reach this code path at
  all): with `trace` injected, the offer is refused (`null`), exactly ONE
  trace call fires with `event: 'duplicate-profile'`, and the trace `detail`'s
  JSON contains none of the profiles' `fullName` values or the captured
  email — vault ids/counts only, per LD9. With `trace` OMITTED entirely, the
  refusal still happens (the no-op default). Both pass.
- **AC17/AC18** — `vault-capture-template.test.js`: 5 new tests — fresh save
  ("Save your details?" + vault choice shown); gap-fill ("Add to your saved
  details?" + no vault choice); conflict ("Update your saved details?",
  BOTH `addedFields` and `changedFields` named); the `(no fields)` fallback;
  a `textContent`-only render (a `<script>`-shaped label string renders as
  literal text, zero child elements). Each conflict/gap-fill/save test also
  asserts `refs.card.attributes.get('aria-label')` equals `heading.slice(0,
  -1)` (AC18) for its own heading. All 5 pass; the pre-existing 7
  card/login-shape tests in the same file pass unmodified (zero behaviour
  change to those two kinds).
- **AC19** — `save-moment-corpus.test.js`'s `[gated] billing-jostens` now
  runs `assertOffersEntry` (per the manifest's `assert: 'offers'`) and
  passes — the promoted fixture's submit button is a real, headlessly-
  provable native form submission.
- **AC20** — `identity-profile.test.js`: two new tests build the ACTUAL
  captured-record shape from the real `incident-report-third-party.html`
  fixture (via `extractFixtureFile` + `findAllIdentityFields`, never a
  hand-typed stand-in) — "an EXISTING profile classifies the captured
  stranger-address as a CONFLICT" and "(DD10 residual) on a FRESH vault the
  same capture is only a gap-fill, never a conflict". Both pass;
  `incident-report-third-party` remains `'gated'`/`'detects'` in the
  manifest, unpromoted.
- **AC21** — `save-moment-corpus.test.js`'s full run: every `negative-*`
  tier entry still passes `assertNoDetectableEntry`/`assertNoOffer`
  (18 gated + 3 todo, 0 fail); the standing canary
  ("CANARY: assertNoDetectableEntry must FAIL against a known-positive
  fixture…") still inverts and throws, proving the negative-tier harness
  still has teeth after the three-way widening of `buildProvenancedObserver`/
  `assertNoOffer`.
- **AC22** — `vault-context.test.js`'s full 39-test run (including Leg 3's
  three AC21 identity-refusal pins) passes unmodified — zero changes to
  `vault-context.js` were needed or made this leg.
- **AC23** — see Gates below.
- **Grep-AC, re-confirmed independently of the pinned test**:
  `grep -n "rec.kind === 'card'" src/main/vault/vault-human.js` → no output
  (exit code 1). Three PROSE comments that used to contain this exact
  substring (describing the OLD pattern being replaced) were reworded during
  implementation once the grep first caught them on the comments themselves —
  recorded here as a reminder that a literal grep-AC catches prose, not just
  code, and both must be clean.

#### Test counts

Full suite: **5384 → 5432 tests (+48)**, **5429 pass, 0 fail, 0 cancelled, 3
todo** (the same three pre-existing `[known-unsolved]` corpus fixtures — no
new todos). Per-file breakdown of the +48: new `vault-identity-capture.test.js`
+31, `vault-gesture-policy.test.js` +9, `vault-capture-template.test.js` +5,
`register-browser-ipc.test.js` +1, `identity-profile.test.js` +2 — sums to 48.
`vault-entry-observer.test.js` net zero (one pre-existing test widened in
place, per the AC4/AC11b Leg-3 precedent for this exact ripple class);
`save-moment-corpus.test.js`/`save-moment-assertions.js` net zero (an
assertion function's dispatch widened from binary to three-way, one fixture's
`assert` value changed — no test added or removed).

#### Gates

`npm test` — 5429/5429 pass (3 todo, unchanged corpus gaps; 0 fail).
`npm run lint` — clean (two errors surfaced and fixed during implementation:
an unused initial `let parsed = {}` assignment in `decodeIdentitySecrets`,
`no-useless-assignment`; an unused destructured `human` in an AC16c test that
didn't need the real-store harness at all — both fixed by simplifying, not
suppressing). `npm run typecheck` — clean. `npm run format` then
`npm run format:check` — clean. `npm run build:preload` re-run once after all
preload-side edits landed (LD3's observer change, plus the later
`webview-preload.js` gesture-dispatch changes, since `build-preload.mjs`
bundles both); `vault-entry-observer-bundle.test.js` (13/13) and
`webview-preload-bundle.test.js` re-run green after the rebuild.
`renderer.js` untouched, still 1550 lines (`git diff --stat
src/renderer/renderer.js` on this leg's edits is empty); `SEAM_COUNT` still
41 (LD5 — no audit hook added, per the leg's own ruling that the identity
offer is a new MODE of the existing `vault-capture` menuType, not a new
menuType, so no new seam coverage was needed). **Local Concourse CI needs an
interactive login unavailable in this environment — these four local gates
stood in for it. This is not a claim that hosted CI ran.**

#### Neuter-verification summary (all three RED outputs recorded above)

| AC | What was neutered | RED symptom |
|---|---|---|
| AC3 | `captureSave`'s `dispatchByFamily` call replaced with the old binary `rec.kind === 'card' ? … : <login>` | `TypeError: Cannot read properties of undefined (reading 'toString')` inside the login handler — an identity record has no `password` field |
| AC11(c) | `dropCapture`'s every-own-Buffer loop replaced with the old named list `['password', 'number', 'cvv']` | `AssertionError: expected: true, actual: false` — the canary's arbitrary Buffer field was left un-zeroized |
| AC16b | The identity `update` branch's named-field-set write loop replaced with a naive `{ ...existing, ...captured }` spread | `AssertionError: '' !== '555-1234'` — the stored `phone` field was silently blanked |

Each neuter was applied via a scripted, scoped edit (never hand-edited in a way that could leave stray state), the targeted test re-run in isolation to confirm RED, then restored from a pre-neuter backup and verified byte-identical via `diff` before re-running the full identity suite green.

#### Design-review fixes carried in (recap)

Round 1's three findings (LD2's un-zeroized-buffer HIGH, closed structurally
by LD7; AC1/AC2's no-construction-path HIGH, closed by the exported
`dispatchByFamily`; LD8's naive-merge data-loss MEDIUM) are all reflected in
the implementation as landed and independently re-verified above (AC11's
canary, AC2b's seam-driven tests, AC16b's neuter-verification respectively).
Round 2 raised no new blocking issues.

#### Deviations / out-of-scope findings

None. The one test-only addition beyond the leg's explicit Files Affected
list — `_seedCaptureForTest` in `vault-human.js` — is a direct, in-scope
consequence of AC2b's own instruction ("through a test seam, or by exercising
the exported helper… whichever the implementer can reach… report which");
reported here as required. No pre-existing defect outside this leg's scope
was found during implementation.

Leg status → `landed`.

---

## Decisions

*(runtime decisions not in the original plan — none yet)*

---

## Deviations

### Leg 1 amended while `in-flight` (AC11/AC11b added)

**Planned**: legs are immutable once `in-flight`; a requirements change means
abort, roll back, and create a new leg.

**Actual**: Leg 1 was amended in place with a dated, clearly-marked Amendment
block adding AC11 (retarget two source-LOCATION pins) and AC11b (neuter-verify
the retargeted one). Status left `in-flight`; no work rolled back.

**Reason**: this is a citation gap in my own leg design, not a change to what the
leg is for. Its intent — zero behaviour change, no behavioural assertion loosened
— is unchanged and unweakened; what was wrong was my ENUMERATION of which
mechanical pins track the moved code. Both misses trace to the same search error:
the citation audit looked for `RENDERER_LINE_BUDGET` and for template consumers,
never for the bare literal `1577` nor for source-scan pins in OTHER suites that
read `renderer.js`. That is precisely the defect class Flight 2's debrief named
(*"enumeration claims decay silently — search for unclaimed sites, don't confirm
claimed ones"*), repeated one flight later by the Flight Director. Aborting a
complete, correct implementation to re-issue a near-identical leg over a two-line
enumeration miss would destroy working code and lose the audit trail the
Amendment block preserves. Flagged to the operator rather than buried.

**Standardize?** The amendment mechanism, yes — a dated in-artifact Amendment
block beats both a silent edit and a ceremonial abort for a gap of this class.
The underlying miss, no: the fix for that is the probe-backed enumeration
discipline the debrief already recommends, applied to *unclaimed* sites.


### Leg 2 changed the detach watch's firing semantics — unintentionally, via my AC10b

**Planned**: AC10 was written to EXTRACT the detach-watch logic into a testable
module. Nothing in DD1, LD1, or AC10 set out to change when it fires.

**Actual**: the extracted module fires only when a kind's watched set is FULLY
detached. The pre-extraction inline code fired when ANY single watched field
disconnected (`const stillAttached = watchedGestureFields.every((f) =>
f.isConnected); if (stillAttached) return;`). The implementing Developer followed
AC10b literally and flagged the difference rather than hiding it.

**Reason**: the change came from MY AC10b wording ("a partially-detached set does
not fire"), which I wrote without reading what the old code did. A behaviour
change entered through a test specification, not through a design decision.
Owned here as such.

**Kept, not reverted**, because on inspection it is defensible and probably an
improvement: under any-field semantics, the known-unsolved
`framework-rerender-field-replacement` corpus shape (a re-render that swaps ONE
field node) would fire settle early and raise an offer while the operator is
still typing — a wrong-moment offer. Full-detachment semantics refuses that. The
motivating SPA-teardown case (a whole form wrapper unmounted) fires identically
under both. The residual cost: a flow that removes, say, the card-number field
while leaving the cardholder field on screen no longer settles by detachment and
falls back to the navigation-commit settle or the TTL drop.

**Carried to the HAT**: this is a live-behaviour change no headless test can
prove the full effect of (no corpus shape exercises detachment settle — `offers`
requires native form submission). The HAT walk must include one SPA-style flow.

**Standardize?** Yes — when a leg EXTRACTS logic, its tests must first pin the
extracted code's CURRENT behaviour before any AC may describe new behaviour.
"Extract" and "change" are different verbs and belong in different criteria.

---

## Anomalies

### AC9 blocker: two pre-existing test-file pins outside the leg's cited scope now fail

**Observed**: After implementing AC1-AC8 exactly as specified (dispatch tables in
both templates; the auth/cert challenge flow extracted verbatim into the new
`auth-challenge-controller.js`; `RENDERER_LINE_BUDGET` retargeted to the landed
1550), `npm test` reports exactly 2 failures beyond the pre-leg baseline, both in
test files the leg's Inputs / Files Affected / Citation Audit sections never
named:

1. `test/unit/cert-picker-template.test.js` — `REGRESSION (M14 F3 HAT): the LIVE
   cert-picker model shape ({certs, popup?}) passes the sheet init gate —
   blank-sheet fix`. This test source-scans `src/renderer/renderer.js` with a
   regex looking for the literal `onCertChallengePresent`/`openOverlayMenu(
   'cert-picker', ...)` handler body. That body is now (correctly, per AC6) in
   `auth-challenge-controller.js` instead, so the regex finds nothing in
   `renderer.js` and the assertion fails with `"renderer.js's cert-challenge-
   present handler must send the { certs, popup? } object model"`. The runtime
   behavior this test protects (the object-shape model, the host attribution
   field) is UNCHANGED and byte-identical — it simply now lives in a different
   file.
2. `test/unit/vault-restore-workflow-invariants.test.js` — `renderer.js is
   untouched by this leg (DD11: no renderer.js change, or a named bump)`. This is
   a hardcoded `assert.equal(lines, 1577, ...)` pin on `renderer.js`'s exact line
   count, left over from an unrelated M18 F3 Leg 3 grep-AC suite. Its own inline
   comment history shows this exact literal has been "retargeted" in lockstep
   with `seam-contract.test.js`'s `RENDERER_LINE_BUDGET` on every prior leg that
   legitimately changed `renderer.js`'s line count (documented for at least 8
   prior retargets). It was not retargeted this time because AC9 restricts
   sanctioned test edits to the `RENDERER_LINE_BUDGET` constant alone, and this
   leg's Inputs/Files-Affected citation audit did not surface this second,
   independent copy of the same fact.

**Severity**: blocking (for AC9's exact letter — "no test modified to
accommodate the refactor" beyond the one sanctioned edit).

**Resolution**: **Not resolved by this developer, by design.** AC9 states
explicitly: "An existing assertion that has to be loosened or rewritten is a
FAILURE of this leg, not a fix: if one blocks, stop and report rather than
editing it." Neither failure reflects a behavior change — both are source-
location/line-count pins invalidated purely by the file move AC6 mandates — but
editing either file was outside this leg's sanctioned edit list, so both were
left untouched and are reported here for the Flight Director's decision. Leg
status left at `in-flight` (not `landed`) pending that decision. Options for the
Flight Director: (a) amend the leg to explicitly authorize retargeting these two
pins (in which case both are mechanical one-line-value / one-file-target
updates, not a weakening of what either test verifies), (b) accept the 2
failures as a documented, scoped exception for this leg and land as-is, or (c)
some other disposition. No code implementation work is blocked — all of AC1-AC8
are complete, verified, and gate-clean; only the final "0 failures" state of
`npm test` is affected, by exactly these 2 tests.


### AC9 blocker: two pre-existing tests failed on the file move

**Observed**: after the AC6 extraction, `npm test` reported 5294 tests /
5289 pass / **2 fail** / 3 todo. Both failures verified independently by the
Flight Director, not taken on the Developer's report:

1. `cert-picker-template.test.js` — "REGRESSION (M14 F3 HAT): the LIVE
   cert-picker model shape…" — a two-ended source-contract pin whose renderer
   half regex-matches the `openOverlayMenu('cert-picker', { certs: … })` call in
   `renderer.js`. AC6 moved that call to `auth-challenge-controller.js`, so the
   regex finds nothing. The protected shape is byte-identical, only relocated.
2. `vault-restore-workflow-invariants.test.js:126` — `assert.equal(lines, 1577)`,
   a second independent copy of the renderer.js line-count fact.

**Severity**: blocking (a red suite cannot land) — but **non-behavioural**. Both
pin WHERE a fact lives, not what the code does. `git diff --stat test/` confirms
the only test edits made by the Developer were the sanctioned
`RENDERER_LINE_BUDGET` change and three ADDED tests.

**Resolution**: the Developer correctly STOPPED rather than editing, exactly as
AC9 instructs — the criterion did the job it was written to do. Flight Director
authorized both retargets via the Leg 1 Amendment (AC11), with AC11b requiring
the cert-picker retarget to be neuter-verified per CLAUDE.md's standing
re-target rule, so a relocated pin cannot become a silently disabled one. The
underlying duplication is logged as **squawk 0096** and deferred — it is not in
this flight's path.

---

## Session Notes

**2026-09-20 — planning.** Mission, Flight 2 spec/log/debrief read; code
interrogation across the preload observer/tracker/gesture layer, `vault-human.js`
capture lifecycle, the two sheet templates, the store's reachable-items surface,
and the fixture corpus. Reconnaissance report above presented to the operator,
who confirmed the mission's Flight 3 scoping stands with no adjustments. Four
crew-interview decisions taken, all at the recommended option: multi-hold with
sequential offers (DD1), value-layer gate mirroring LD2 (DD2), extraction as its
own first leg (DD3), and corpus promotion plus an operator HAT for acceptance
(DD4). Six further decisions (DD5–DD10) resolved by the Flight Director from the
code, and two questions deliberately deferred to the legs that raise them (the
detach-watch shape under multi-hold, to Leg 2; `fullName` composition, to Leg 4).

**2026-09-20 — design review (round 1).** Architect spawned per
`.flightops/agent-crews/flight-design.md`, with an explicit instruction to run
probes rather than reason (Flight 2's debrief: every HIGH in that flight came
from a reviewer who ran code, none from one who reasoned). Verdict **approve with
changes**, one HIGH.

- **HIGH, accepted and folded into DD1.** `capture()`/`captureCard()` gate on
  `store.isUnlocked()`, a single GLOBAL flag — so under DD1's multi-hold a locked
  vault makes EVERY released record return `mode: 'locked'` in one pass, and the
  chrome's scalar `pendingCaptureId` / `pendingCaptureUnlock` keeps only the
  last. One unlock would finalize one offer and silently zeroize the other two
  minutes later. Verified independently before accepting (`vault-human.js:460`;
  `vault-controller.js:66-70, 303-322, 344-360`). DD1 now specifies TWO queues;
  Leg 2's axes count rose 1 → 2 and its acceptance criteria gained the
  locked-vault case.
- **MEDIUM, accepted.** DD8 had mischaracterized the card family:
  `cardAnchorsOf` places the icon on FOUR fields, not on `number` — `number` is
  the FILL TARGET. Icon placement and fill-target resolution are different axes
  and the draft conflated them. DD8 now decides identity's placement explicitly
  (postal anchor + first non-postal role field, the same two fields DD2's gate
  names) and records what was rejected and why.
- **MEDIUM, accepted with a nuance of its own.** The branch-site recount above.
  The Architect's count of 8 in the picker is right and is adopted; its
  supporting claim that `:312` "is not a branch" because it uses `!==` is not —
  `:312` partitions rows by family and is squarely in Leg 1's scope. The COUNT
  was corrected; the reasoning behind one line of it was not adopted.
- **LOWs, all accepted.** Stale leg number in an open question (Leg 3 → Leg 2);
  DD3's vague "buy real headroom" replaced with a named extraction candidate
  (`renderer.js:1362-1387`, the auth/cert sheet-raising subscriptions — the
  M15 F2 Leg 1 precedent) and a numeric floor (≤1562); DD2 now pins the
  anchor-role propagation at the source rather than leaving the observer to
  reverse-map a node reference; DD1 names the
  `CAPTURE_DROP_MS`-starts-at-release trade-off.
- **Three Architect questions answered as decisions**, not left open: serial
  presentation, never a cross-family model-replace (because `handleClosed`'s
  `superseded` carve-out was written for same-family repeat submits and a
  cross-family replace would skip the dismiss-drop); `isClaimedByCard` checks all
  six card roles, not just `cardholder`; ordinal resolution is a shared helper in
  `vault-entry-tracker.js` beside `resolveTargetForAnchor`.
- **Also added**: DD12, an FD ruling granted in advance for `SEAM_COUNT` 41 → 42
  should Leg 4 need an identity capture-sheet audit hook. The mission's
  Constraints anticipate it; granting it at planning is cheaper than discovering
  a pinned budget mid-leg.
- Flight axes count restated at **seven**, up from six at drafting.

**2026-09-20 — design review (round 2).** Second Architect pass, scoped to
verifying round 1's closures and hunting what the amendments themselves
introduced. Verdict **approve with changes**: all four round-1 findings confirmed
closed, two new MEDIUMs and one LOW found. Cycle cap (2) reached; every remaining
finding was a mechanical closure of a demonstrated gap rather than a disputed
judgement, so all were folded in and the flight is ready — no escalation needed.

- **Round 1's HIGH confirmed fully closed, with no main-side gap.** The Architect
  walked the whole locked-vault path and found main's API already per-`captureId`
  and stateless about "the" pending offer: `captureFinalize`/`captureSave`/
  `captureDismiss` never re-run the family-blind eviction loop, so resolving one
  held record cannot disturb a sibling. The chrome-side two-queue design is
  sufficient; DD1's three listed main-side changes are the complete set. It also
  confirmed the underlying bug is real: without the family-scope fix,
  `captureCard()`'s own eviction loop — run mid-loop by a multi-hold
  `captureRelease` — would delete a still-pending identity record before it could
  be released.
- **[MEDIUM] DD8 omitted `anchorKinds()`, the function that actually gates
  whether an icon renders.** Verified: `placeVaultIcons` shows an icon only for
  `focusedField`, and eligibility plus kind come from `anchorKinds()`
  (`vault-fill-icon.js:390-403`), which carries its own inline two-family
  precedence walk independent of `isClaimedByLogin`/`isClaimedByCard`. Without a
  third walk there, the identity icon would never render regardless of how
  correct everything downstream was. DD8 now enumerates its modification sites
  and states that upstream filtering, not this guard, is what prevents a
  double-claimed field.
- **[MEDIUM] DD8's second icon anchor had no propagation path.** Verified:
  `identityEntryForScope` computes exactly that field as `nonPostalCandidate`
  (`vault-identity-fields.js:473`) but uses it only to gate admission and never
  exposes it on the entry. DD8 now decides the propagation at the source — the
  same call site DD2 already touches for `anchorRole`, so both land together —
  rather than leaving Leg 3 to re-derive it, which is the anti-pattern DD2
  explicitly forbids.
- **[LOW, and the sharpest finding of the round] DD3's precedent claim was
  false.** The draft justified extracting `onAuthChallengePresent` /
  `onCertChallengePresent` as "exactly the class the M15 F2 Leg 1
  renderer-extraction already moved out." Verified: that leg did the **opposite**
  — `legs/01-renderer-extraction.md:58` explicitly keeps both in `renderer.js`
  ("the challenge flow (M14), not the vault flow, despite adjacency… Scope
  discipline: vault only"), and `vault-controller.js:16-18` restates the boundary
  today. Left uncorrected, an implementer following the cited precedent would
  have folded this code into `vault-controller.js` and re-opened a boundary drawn
  on purpose. DD3 now names a NEW `auth-challenge-controller.js` as the
  destination and states that the precedent followed is the *shape*, not a prior
  move of this code. Leg 1's bullet names the destination too.
- **[LOW] Two of DD1's three eviction-loop citations were off** (`:501-503` and
  `:561-563`; the real loops are `:509-511` and `:562-564`). Corrected, with the
  note that Leg 2 resolves them by grepping the predicate rather than by line
  number. Worth recording: this flight corrected a citation slip in round 1 and
  then shipped two more into round 2, which is evidence for the debrief's
  probe-backed-input-claims recommendation rather than against it.
- **Residual folded into DD1**: `onVaultCaptureOffer`'s locked branch opens the
  unlock prompt unconditionally per offer; with N queued locked offers it must
  open once per drain and push subsequent ids without re-opening, so repeated
  model-replaces of the same menuType do not burn `KEEP_FOCUS_MAX`.

---

## Flight documentation

**2026-09-21 — documentation pass (post flight-end review, pre-commit).**
Brought CLAUDE.md and `docs/vault.md` in line with the code all four legs
landed. Working tree still uncommitted at the time of this pass. Every fact
below was verified against the code with a grep/read, not copied from the leg
artifacts.

### Stale facts corrected (starting list)

1. **`CLAUDE.md:355` (Formatting/Prettier bullet), `RENDERER_LINE_BUDGET`.**
   Was `1577`; is `1550` (confirmed live:
   `test/unit/seam-contract.test.js:306`, and
   `node -e "…renderer.js…".split(/\r?\n/).length` → `1550`). Updated in the
   bullet's existing chronological-history style, naming M21 F3 Leg 1
   (`sheet-type-dispatch`) and the auth/cert-challenge-subscription extraction
   into the new `src/renderer/chrome/auth-challenge-controller.js`. Also noted,
   per the task brief: the SAME line count is pinned a second, independent time
   in `test/unit/vault-restore-workflow-invariants.test.js`'s
   `assert.equal(lines, 1550, …)` (confirmed at `:134`) — squawk 0096 (open)
   tracks the duplication; the next leg that changes `renderer.js`'s line count
   must retarget both.
2. **`CLAUDE.md:343`, identity admissibility bullet header.** Was "Mission 21
   Flight 2, foundations only: this flight shipped detection + the item type;
   fill/capture/sheets are a follow-on flight, no live caller yet." Fill and
   capture are now shipped (Flight 3, Legs 3-4) — header shortened to "(Mission
   21 Flight 2)" with a pointer to the new "fill and capture" bullet.
3. **`CLAUDE.md:344`, `classifyCapture`'s "no live caller until Flight 3".**
   It now has a live caller: `disposeIdentityCapture`
   (`src/main/vault/vault-human.js:1144`, confirmed by grep) — updated in both
   CLAUDE.md and `docs/vault.md`.
4. **`CLAUDE.md:348` (isolated-world bullet), the "Accepted regression"
   (icon-triggered fill on a multi-form page always fills the FIRST detected
   entry).** Closed by DD9 (M21 F3 Leg 3): every fill (`vault-fill`/
   `vault-fill-card`/`vault-fill-identity`) now passes an integer ordinal,
   resolved via the existing `resolveOrdinalInFamily`
   (`src/preload/vault-gesture-policy.js:123`, confirmed reused — not
   reimplemented — at `webview-preload.js:451,464,480`), so an icon-triggered
   fill on a multi-form page fills the CLICKED form. Rewrote the bullet to
   state the residual that remains instead: the main-world ordinal resolution
   and the isolated-world ordinal lookup are still two independent DOM
   enumerations, so a mutation landing between them can still misassociate —
   narrows the mission's mutation-race Known Issue, does not close it.
5. **`CLAUDE.md:351`, "Held-capture hygiene".** Rewrote in full. Was: one
   pending hold per tab, `dropCapture` zeroizing three named fields. Now,
   confirmed against `src/main/vault/vault-human.js` and
   `src/renderer/chrome/vault-controller.js`: one hold per (tab, family) via a
   fail-closed `familyOf(rec)`; `captureRelease` returns an ARRAY (confirmed:
   used as `.map`/iterated in `guest-wiring.js` and
   `register-browser-ipc.js`); the chrome presents queued offers serially
   through one idempotent `advance()` (confirmed at
   `vault-controller.js:200-221`, with the resolution/occlusion close-reason
   split at `:6-17` and `OCCLUSION_CLOSE_REASONS` at `:17`); every capture-side
   family dispatch routes through one exported `dispatchByFamily` returning
   the frozen `FAMILY_REFUSED` sentinel for an unrecognised `kind` (confirmed:
   `vault-human.js:122,141,155,1621` exports `familyOf`/`dispatchByFamily`/
   `FAMILY_REFUSED`); `dropCapture` zeroizes every own Buffer-valued field via
   `Buffer.isBuffer(value)` over `Object.values(rec)`, not a named list
   (confirmed at `vault-human.js:271-290`, replacing the old
   `['password','number','cvv']` loop and its "a new secret field MUST be
   added here" comment). Also folded in the per-family gesture-detach watch
   (`src/preload/vault-gesture-detach-watch.js`, confirmed to fire on FULL
   detachment of one family's field set via its header comment and `Map<kind,
   fields[]>` shape) since it is the settle signal that feeds this same
   release path.
6. **`docs/vault.md:379-383`, "Identity items (Mission 21, Flight 2 —
   foundations only)" / "no live caller until the follow-on flight".**
   Section header changed to "(Mission 21, Flights 2-3)"; the "no fill,
   capture or sheet wiring exists yet" sentence replaced with a statement of
   what Flight 3 shipped and a pointer to CLAUDE.md's Password vault pattern
   for the fill/capture mechanics (kept out of vault.md to avoid duplicating
   CLAUDE.md, per the task brief). The second "no live caller until the
   follow-on flight" at `docs/vault.md:489-490` (the `classifyCapture`
   paragraph) was corrected the same way as CLAUDE.md's copy.
7. **`CLAUDE.md:27`, Architecture → Renderer bullet.** Added
   `auth-challenge-controller.js` to the controller list (it did not exist
   before M21 F3 Leg 1; confirmed present at
   `src/renderer/chrome/auth-challenge-controller.js`).
8. **`src/renderer/chrome/vault-controller.js`'s header note about the
   challenge flow.** Checked, not edited (source file, out of scope for this
   pass): still reads correctly per Leg 1's AC6b correction — confirmed at
   `vault-controller.js:1-25`, no contradiction with CLAUDE.md's updated text.

### New facts documented (verified against the code)

- **Identity fill** — new `CLAUDE.md` bullet "Identity items — fill and
  capture (Mission 21 Flight 3, Legs 3-4)": not origin-gated (DD7, same
  argument as card, confirmed `reachableIdentityItems(jarId)` takes no origin
  parameter); automation stays login-only with no code change (confirmed
  `vault-context.js`'s three `item.type !== 'login'` filters, unchanged); the
  two-icon placement (postal anchor + first non-postal role field) and
  `anchorKinds()` as the render-gating site (confirmed at
  `src/preload/vault-fill-icon.js`'s `anchorKinds()`, which now carries a
  third identity walk after the login and card walks).
- **Identity capture** — same new bullet: the value-layer admission gate
  mirroring the detection-layer scope anchor; `anchorRole` carried through the
  isolated-world snapshot as a plain role-name string (avoiding a TOCTOU from
  re-deriving it main-side); the ten secret identity fields crossing as ONE
  `Uint8Array`, held as `rec.identitySecrets`; disposition through
  `classifyCapture` + `identityProfileOf` (jar profile preferred over global;
  a violated one-profile invariant refuses the offer); the offer model
  carrying field LABELS only, never values; an `update` writing exactly
  `gapFilled ∪ conflicting` fields (confirmed at
  `vault-human.js:1144-1180`'s `disposeIdentityCapture`); no `fullName`
  composition, and why (inference the capture gate's founding rule forbids,
  plus the spurious-conflict risk against a hand-typed full name).
- **The capture-offer queue** in `vault-controller.js`: folded into the
  rewritten "Held-capture hygiene" bullet rather than a separate one, since it
  is one mechanism shared by all three families, not identity-specific:
  serial presentation through one idempotent self-guarded `advance()`;
  `advance()` runs only on resolution-class close reasons; an occlusion-class
  close (including `superseded`) dismisses the whole queue; the locked-vault
  unlock-to-save path drains an array serially and opens the unlock prompt
  once per drain.
- **Card beats identity** on a contested field: folded into the new
  fill-and-capture bullet — `isClaimedByCard`, all six card roles (confirmed
  at `src/preload/vault-identity-fields.js:427`), completing login > card >
  identity.
- **The per-family detach watch**
  (`src/preload/vault-gesture-detach-watch.js`): folded into the rewritten
  "Held-capture hygiene" bullet — fires on FULL detachment of a family's field
  set, confirmed against the module's own header comment.
- **`CLAUDE.md`'s Seam contract bullet**: added a sentence noting DD12's
  `SEAM_COUNT` 41→42 grant was made in advance but NOT used (LD5 — `Leg 4`
  found no new audit hook necessary) — count stays 41, confirmed live at
  `test/unit/seam-contract.test.js:107`.

### Stale sites found BEYOND the starting list

None found beyond the starting list's own eight items. A `grep`-by-shape pass
across `CLAUDE.md` and `docs/` for every symbol/constant/number/file name this
flight touched (`RENDERER_LINE_BUDGET`, `SEAM_COUNT`, `1577`, `familyOf`,
`dispatchByFamily`, `FAMILY_REFUSED`, `identitySecrets`, `anchorRole`,
`isClaimedByCard`, `resolveOrdinalInFamily`, `classifyCapture`,
`identityProfileOf`, `vault-gesture-detach-watch`, `auth-challenge-controller`,
`captureRelease`, "no live caller", "follow-on", "foundations only", "one per
tab", "first detected entry", "accepted regression", "login-only", "two
families", "login and card") turned up nothing outside the eight starting-list
sites and the `docs/vault.md` second "no live caller" instance already implied
by starting-list item 6. `docs/mcp-automation.md` and
`docs/behavior-specs-single-window-audit.md` were also checked for
identity-related drift; neither needed a change (identity's automation
exclusion is structural and required no code change, so no doc there claimed
otherwise). This is unlike every prior enumeration this flight ran (five
misses across planning and design review) — plausibly because this pass
started from the Flight Director's own list rather than a fresh code read, so
it is evidence of the list's completeness more than of this pass's own
thoroughness.

### Gates

- `npm run format` — no-op (tree already Prettier-formatted after the edits);
  `npm run format:check` — clean (confirms nothing was reflowed unexpectedly).
- `npm test` — 5429 pass / 0 fail / 3 todo (pre-existing, unrelated to this
  pass) / 5432 total.
- `npm run lint` — clean.
- `npm run typecheck` — clean.
- No source or test file was modified by this pass — confirmed by
  `git status --porcelain` showing only `CLAUDE.md`, `docs/vault.md`, and this
  flight's own `flight.md`/`flight-log.md` as touched beyond what the four
  legs already left in the working tree.

Nothing committed — signaling `[HANDOFF:review-needed]` per the task brief.
