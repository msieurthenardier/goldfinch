# Flight Debrief: Automation-Surface Internal-Session Invariant

**Date**: 2026-08-28
**Flight**: [Automation-Surface Internal-Session Invariant](flight.md)
**Status**: landed
**Duration**: 2026-08-28 (single session — recon → pivot → Legs 1–4 → land)
**Legs Completed**: 4 of 4

## Outcome Assessment

### Objectives Achieved

The internal-session automation boundary is now **tier-based** (an operator-ruled pivot from the flight's original "enforce refusal even for admin" framing). Delivered: the admin tier reaches internal `goldfinch://` guests on every op (Leg 1 relaxed the op-local `evaluate`/`injectScript`/`openDevTools`/`closeDevTools` admin-refusals); the vault tools can no longer target the master-password **secret sheet** — refused for **all** tiers (Leg 2); `download-media` validates the renderer `webContentsId` against tab contents and `show-item-in-folder` validates paths against main-known values (Leg 3); and the docs, the behavior-crew apparatus note, and the Leg-1 code comments are trued to the tier model (Leg 4). PR #191.

The security wall that actually matters — a **non-admin (jar) key cannot reach an internal page** — already held at the resolver (`resolve.js:233`) and was left untouched: `resolve.js` has an **empty diff**, confirmed adversarially at the flight-end review.

### Mission Criteria Advanced

- **Criterion 3** — the internal-session boundary (reframed to tier-based): **met**.
- **Criterion 4** — vault tools share the resolver predicate set; `download-media` validates its `webContentsId`: **met**.

Verification: unit truth tables across `observe`/`vault-context`/`register-download-ipc` (admin-succeeds, non-admin-refused, sheet-refused-all-tiers, chrome-id-rejected), all neuter-verified; `npm test` 3966/3966.

## What Went Well

- **The resolver-as-the-real-wall framing (DD1).** Anchoring on "the non-admin wall already holds one layer down, don't touch it" kept three of four legs from ever risking that gate — and made it provable (empty `resolve.js` diff). The op-local checks were correctly read as redundant admin-only refusals.
- **Reconnaissance earned the pivot.** It caught F9's moved file, F1's inversion, and — decisively — the behavior-test crew's dependency on `captureScreenshot`/`readAxTree` against internal guests under admin. That dependency is what forced the enumerate-vs-act ruling and made the pivot necessary rather than optional.
- **Design reviews caught the hard implementation details before code.** Leg 2's `scopeCtx → engineDeps` plumbing (one hop, no remapping) and the jar-fake regression (threading `isTabViewWcId` newly activates the non-tab-contents guard for jar identity, breaking existing test fakes) were both anticipated at review and pre-empted in the spec — genuine catches, not luck.
- **The security-model reversal landed clean across every surface.** Post-correction, code, comments, tool descriptions, docs, and the crew note all agree (grep-clean of the false claim) — a hard thing to get consistent for an invariant reversal.
- **Two subagents refused to proceed on bad inputs.** The Leg-1 implementer's output carried a (context-blind) security-classifier flag that the FD verified against the diff; the Leg-4 docs implementer **blocked** rather than write a doc contradicting shipped code — which is how the false premise was caught.

## What Could Be Improved

- **A false security premise drove a real decision (the central lesson).** The flight's DD2 justification — "admin is dev-only, gated on `!app.isPackaged`, cannot exist in a packaged build" — was **false**. The admin tier is env-gated on `GOLDFINCH_AUTOMATION_ADMIN` (no `isPackaged`); its mint IPC is reachable from Settings in a packaged build; and `docs/mcp-automation.md:399-403` **already documented the truth** pre-flight. The FD conflated a `!app.isPackaged` gate on the *headless auto-mint harness* with the admin tier's actual gate, asserted it from memory, repeated it across turns, wrote it into DDs and shipped-code comments, and the operator made a keep/revert security decision partly on it. It survived recon, **two design reviews explicitly tasked with validating the security reasoning**, Leg 1's implementation, and the flight-end review's earlier passes — everyone verified the *mechanics* (which gate fires when) without independently verifying the *premise* (can admin exist in a packaged build) against the mint-gating code. A Leg-4 Developer caught it only because writing a citation-backed doc forced the check. The operator re-decided keep-as-is on corrected facts; the pivot is sound on the real justification, but the process failure was real and expensive.
- **Recon consulted the finding's cited code but not the adjacent contradicting doc.** `docs/mcp-automation.md:399-403` and `automation-dev.js:40-41` both stated the truth and were never read during design.

## Deviations

- **The flight was scaffolded toward the old model and pivoted at design time** — recorded per methodology (original framing preserved as commentary; the pivot in FD Notes; mission criterion 3 reframed in place; maintenance F1 annotated).
- **Leg 4 was re-run** after its first attempt correctly blocked on the false premise — the second run also scrubbed the false claim from shipped code (`observe.js`/`mcp-tools.js`) and added the crew-note fix.
- **F1 inverted** — the maintenance finding's fix shape ("add refusals to input/observe") flipped to "remove the admin refusals"; the non-admin boundary those ops were "missing" already held at the resolver.

### Technical / Test Metrics

`npm test` on the landed branch: **3966/3966 pass, 0 fail/skip/todo**, 13 suites, node `--test` ≈3196–3312 ms (wall-clock ~3.7 s), stable across 5 debrief runs. Prior: Flight 5 3839/3839 ≈3064 ms; Flight 1 3941/3941 ≈3502 ms. This flight's base drifted to 3843 across intervening turnaround/branch merges, landing at **3966** — **+123 total, ~+16 net from this flight's own unit tests** (Leg 1 +4, Leg 2 +6, Leg 3 +6, Leg 4 docs +0). Wall-clock is flat-to-improved vs Flight 1 despite more tests — machine/load variance, consistent with prior debriefs' "wall-clock doesn't track test count linearly."

**Recurring flake — unresolved.** Legs 2 and 3 each reported one transient, non-attributed flake that cleared on retry; the debrief's 5 consecutive runs did **not** reproduce it, and the flight log doesn't name the test/suite. It remains an open **standing watch item** — the next debrief that sees a red-then-green run should capture the failing test name immediately.

## Key Learnings

1. **A security-model DD grounded in an "X cannot happen in production" claim must cite the specific gate/env-check BEFORE the ruling is recorded — the same citation-audit discipline the legs apply to line numbers, applied one level up to claims about *mechanism*.** State the premise as a falsifiable claim, then grep the code that would falsify it. This is the flight's central lesson (both crew interviews converged on it).
2. **The security boundary is the resolver tier; scattered op-local checks that only ever fire post-resolver are redundant, not defense-in-depth** — reading them as the latter (two barriers) overstates the protection.
3. **A subagent forced to write a citation-backed artifact is a real (if late) correctness backstop** — the docs leg caught what recon and two design reviews missed. Cheaper to move that "state the claim, cite the code" step earlier.

## Architectural Debt / Residual Risk (for the operator and Flight 3)

| Item | Nature | Disposition |
|------|--------|-------------|
| **Admin-tier trust concentration.** The boundary is now one gate (the resolver) + the sheet wall. Admin, once enabled on a packaged build, has full `evaluate`/`injectScript`/DevTools reach into Settings and the vault *page*. | A real defense-in-depth reduction, acknowledged in the DD2 correction (not hidden). Backstops: the high, operator-local enablement bar; secrets never enter the page DOM; the sheet wall (DD3). | **Operator-accepted (keep-as-is on corrected facts).** Follow-up candidate: an **audit-log emphasis** — log every admin-tier internal-page op — gives retroactive visibility without re-narrowing the deliberately-widened capability. Not code-narrowing. |
| **`injectScript` on the vault page (admin)** is asserted safe by design invariant (secrets never in the page DOM), **not exercised by a test.** | Untested access-control edge. | Follow-up: a unit/behavior test that injected code in the vault renderer cannot reach a master-equivalent secret through the page's own IPC surface. |
| **Leg 01/04 spec bodies retain historical "dev-only" phrasing** (covered by correction banners; shipped surfaces are grep-clean). | Planning-artifact hygiene. | Optional servicing squawk if the project wants leg specs retroactively scrubbed. |

## Skill Effectiveness (Flight Control methodology)

- **Add a design-review checklist item for security-model DDs:** "state each 'X cannot happen' premise as a falsifiable claim and cite the gating code that would falsify it — before the operator ruling." Both crew interviews independently recommended this; it is the concrete methodology fix from the false-premise incident. Joins the Flight-5 and Flight-1 debriefs' unreviewed methodology items for a batched pass.
- **Recon should consult adjacent authoritative docs, not only the finding's cited code** — the truth was in `docs/mcp-automation.md:399-403` and never read.
- The tier-model documentation of a **shared gate with multiple consumers** (Leg 2's vault-tool note in the sheet section) is a good reusable template.

## Follow-Up Actions

1. **Flight 3 constraint (carry-forward):** preserve BOTH DD3 gates — `resolve.js:210`'s ungated `isSheetContents` check and the now-threaded vault-tool predicate set; any `AUTOMATABLE_MENU_TYPES` widening must stay test-scoped and never touch the sheet gate.
2. **Follow-up (design/decision):** whether to add an audit-log emphasis for admin-tier internal-page ops (retroactive visibility for the accepted trust concentration).
3. **Follow-up (test):** exercise the `injectScript`-on-vault-page safety invariant rather than asserting it.
4. **Standing watch:** the unidentified recurring test flake — capture the failing test name on the next red-then-green run.
5. **Methodology:** the "verify security premises against code, with citations, before the ruling" checklist item + the recon-reads-adjacent-docs note (batched with the prior debriefs' methodology items).
6. **Optional servicing:** scrub the historical "dev-only" phrasing from the leg 01/04 spec bodies.
