# Flight Debrief: Copy a Vault Item to Another Vault

**Date**: 2026-10-13
**Flight**: [Copy a Vault Item to Another Vault](flight.md) (Sortie 04, no parent mission; the charter stands in)
**Status**: completed
**Duration**: 2026-10-12 – 2026-10-13 (planned, executed, HAT'd and debriefed across one working session)
**Legs Completed**: 3 of 3 (2 autonomous + HAT)
**Plugin version**: mission-control 1.2.0
**Commit / PR**: `9bd9bb7` (legs 1–2) + `7a01396` (HAT fixes, run log, landing) on `sortie/04-copy-item-to-vault`, PR #255

## Outcome Assessment

### Objectives Achieved
Every typed item row on `goldfinch://vault` has a **Copy to…** action that copies the item into any other persistent jar's vault or Global, main-side, through `internal-vault-item-copy` → `VaultStore.copyItem` (the 13th gated op). A pure planner (`src/main/vault/copy-plan.js`) matches per type (login origin+username with opaque origins never matching, card digits, note title, identity singleton); the two-call protocol asks **Skip / Replace / Keep both** (identity: **Replace / Cancel**), never overwrites an item the operator wasn't shown (the DD3 outcome table), and never writes on Skip. The page flow lives in a new injected-deps `vault-item-actions-controller.js`, which also took over the delete and revoke-access-key confirms, taking `vault.js` from 2152 to 2104 lines. The HAT added three fixes: the page notice scrolls into view, the identity collision step names the existing profile, and the destination picker starts on a disabled `Choose a vault…` placeholder.

### Charter Criteria (the sortie's only criteria assessment)

| Criterion | Status | Notes |
|---|---|---|
| Copy-to on every row; lists every vault but the item's own; carries every field; source untouched; creates a jar's vault on first copy | **met** | Behavior checkpoints 2, 3, 8 (fresh id, password/notes/number/cvv digests equal, `hasVault` false → true); unit AC8/AC9 (field carry incl. unknown extras, fresh id/`createdAt`, stale `vaultKeys` replaced). Unknown-type rows get no button. |
| Nothing written on a match until Skip / Replace / Keep both; per-type match rule; identical → "already there"; identity → Replace / Cancel only | **met** | Every DD3 table cell is a store test (zero-write cells byte-compared); behavior 4, 5, 6, 7, 9, 10, 10a. Identity collision text was generic until HAT fix F2 (leg 2 AC7 had asked for the title). |
| No secret field value reaches the page DOM (narrowed from "no field value" at design review, operator-accepted) | **met** | Behavior 11: full `readDom` / `outerHTML` / AX-tree scans found only the non-secret positive control; unit AC7 asserts no secret key or marker in any reply; controller renders `textContent` only. |
| No MCP tool can start a copy; locked or mid-rotation copies write nothing and show a visible error | **met** | `vault-copy-boundary.test.js` (no automation reference, 35 tools, none `/copy/i`); `{locked}` → refresh to the locked page; `busy` → "A vault rotation is in progress…" status line — **unit-tested only** (a rotation can't be held open from the apparatus; spec Out of Scope). |

### Checkpoints
All four met. Behavior test `vault-copy-item` passed 14/14 plus an Orchestrator-added checkpoint 12b (`tests/behavior/vault-copy-item/runs/2026-10-13-01-29-59.md`); HAT H1–H8 accepted.

## What Went Well
- **Main-side plan, ids-only page contract.** The page never holds a field value; the collision reply is `metadataOf`-whitelisted. This made criterion 3 structurally true rather than tested-into-being, and the step-11 scan confirmed it on the real DOM.
- **Design review earned its cost.** Review 1 caught five real highs before a line of code: a stale Skip that would have written, `_normalizeItem` silently keeping the source id/`createdAt`, a notice set after the render that shows it, no mechanism for "modal closed by render", and `canonicalOrigin` returning the *string* `'null'` for opaque origins. Each would have shipped as a bug.
- **DD3 as an evaluation order plus an outcome table.** Once restated that way (review 2), leg 1 implemented every cell with no rework and the tests map 1:1 to the table.
- **Disjoint legs ran in parallel.** Leg 2 was designed and design-reviewed while leg 1 was implemented (different files), saving a full review cycle of wall-clock.
- **Extraction over compaction.** Moving the delete *and* revoke confirms into the new controller paid for the feature and gave both confirms their first unit coverage.
- **Digest-only secret comparison** in the behavior test kept every password out of agent transcripts and the committed run log.
- **The Validator's caveat produced a better test.** Step 12 couldn't separate "closed by the lock" from "closed by the toolbar click"; checkpoint 12b used the page's own `lockVault()` with no click and showed the close by 102 ms.

## What Could Be Improved

### Process
- **Two of the three HAT fixes were foreseeable at planning.** F2 (identity message names the profile) was already leg 2 AC7 and was simply dropped in implementation — no unit test asserted the identity copy text. F3 (no default destination) is a standing heuristic: a write-targeting picker must not silently default to a real destination; in the run the default was the operator's own "Personal" jar. F1 (notice off-screen) was latent in the pre-existing `pendingNotice` contract, which assumed the page sits at scroll top.
- **AC-vs-AC contradiction inside one leg.** Leg 2 AC7 (step-2 submit label follows the selection) was unimplementable under AC13 (`openModal` unchanged) because `openModal` has a static `submitLabel` and no setter. Neither the flight review nor the leg review checked an AC against the actual signature of the primitive it depends on.
- **The vault-page live smoke could not run inside the leg that built it.** Unlock is an operator step, so leg 2's live smoke moved to the start of the HAT. That's the right call, but it should be planned at design time for any vault-page leg, not discovered at leg design.
- **Behavior spec authored with avoidable friction.** Step 0 depended on step 1's setup; the spec assumed jar names ("Personal") that collided with the operator's real dev data; step 10's distinguishing field (fullName) wasn't distinguishing in the actual profile; cross-row recorded values were implicit. All fixed in the HAT re-author.

### Technical
- `vault.js` is at 2104 of a 2105 budget. The next vault-page feature needs an extraction first.
- The step-2 submit stays a fixed "Apply" (operator-accepted). Removing it needs `openModal.setSubmitLabel` — a shared-mechanism change.
- The controller recovers the destination name by parsing its label (`lastIndexOf(' — ')`); `copyDestinationOptions` should return `{ vaultId, name, label }`. A jar name containing " — " would mis-parse.
- The render epoch is a one-consumer mechanism, because `closeActivePageModal` skips `onCancel`. Browser import and restore have the same stale-continuation shape and could reuse it.
- `scrollIntoView` now runs for every `pendingNotice` user (export-raced-lock included) but only the copy path was exercised live.
- No cross-window `vault-changed` broadcast (DD9, accepted; H7 confirmed the second window is stale until refresh).
- The browser-import destination picker still defaults to Global — the same hazard F3 fixed here.

### Documentation
- CLAUDE.md doesn't yet carry the copy-item invariants (two-call protocol with the stale rule, `renderEpoch`, "no default destination for a write-targeting picker") or the two apparatus facts below. `docs/vault.md` covers the feature itself.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|---|---|---|
| Charter criterion 3 narrowed to "no *secret* field value" | The collision step must show title/username, which rows already render | no (one-off) |
| DD3 restated twice at design review | First draft contradicted itself on `new` + resolution and on a stale `allowed` set | **yes** — lead any stale-commit/state-machine DD with its outcome table |
| Destination labels reuse "— N secrets" instead of DD8's "N items" | Consistency with the restore and browser-import pickers | yes |
| Revoke confirm moved with delete confirm | Delete alone netted ≈ −4..+2 lines against a zero-headroom budget | yes — at-budget files pay with an extraction sized up front |
| Leg 1 AC10(c) guard tightened (identity replace must land under the displaced id) | The specified comparison could not go red under its own stub | yes — write guard ACs as "this mutation must turn the test red" |
| Step-2 submit fixed at "Apply" | `openModal` has no label setter; AC13 forbade changing it | no — operator-accepted |
| Live smoke + behavior test moved from leg 2 to the HAT | Vault unlock is operator-only | yes — plan it at design time for vault-page legs |
| Behavior apparatus = dev mode scripts, not the registered MCP server | Operator ruling; the registered server also failed to connect | **yes** — operator standing preference |
| Step 12 rerun + supplementary 12b | The operator's toolbar left-click (opens the vault page by design) dismissed the dialog before the lock | yes — isolate cause with a no-click action; operator action as by-eye confirmation |
| Three HAT fixes (F1–F3) | Real-page review | — |

## Key Learnings
- **Write-targeting pickers start on a disabled placeholder.** A first-option default silently aimed copies at the operator's real vault; the dev profile's isolation is the only reason that finding was harmless.
- **Check every AC against the real signature of each primitive it depends on.** `openModal`'s fixed `submitLabel` was readable at design time.
- **A pinned guard test must be shown able to fail.** AC10(c) as specified could never go red.
- **Notices must be visible from where the operator acted**, not just present in the DOM. A page that keeps its scroll position across a re-render needs the notice brought into view.
- **Apparatus facts for spec authors.** `evaluate` takes `expression`, and a wrong key silently returns `{ok:true}`. The `reload` tool refuses internal tabs, so use `location.reload()` via `evaluate`. A toolbar left-click on the vault indicator opens the vault page and re-renders, which closes any page modal (squawk 0099 design).

**Test metrics** (Developer run on `7a01396`): 5968 tests / 25 suites; 5964 pass, 0 fail, 0 skipped, 4 todo (the known `save-moment-corpus` cases); no flakes; **6.43 s** wall-clock. Versus sortie 03's 5885 tests at 7.94 s, that's +83 tests and −1.5 s, back on the M22 F1 baseline (6.45 s), which supports sortie 03's host-noise reading. Slowest files run alone: `vault-compromise-rotate` 2.56 s (2.4 s quiet / 3.8 s noisy in sortie 03; untouched), `vault-import-logins` 2.38 s, `vault-txn` 2.01 s, `vault-context` 1.60 s, `navigation-controller` 1.43 s, **`vault-copy-item` 1.18 s (new — the first new file in the top six; real crypto/KDF, so it grows with the file)**, `download-path` 1.11 s, `dev-profile` 0.97 s. The other new files are cheap: `vault-item-actions-controller` 88 ms, `vault-copy-plan` 64 ms, `vault-copy-boundary` 57 ms. Note that `npm test` is the glob `node --test test/unit/*.test.js`; pointing `node --test` at the directory errors.

## Human Interview
- **Apparatus**: the operator confirmed that Goldfinch **dev mode is a standing preference**: `dev:automation` + `DEV_MINT`, key captured per launch, `connectAutomation()` scripts, never the registered `goldfinch-dev` MCP server. Future flights' behavior tests and live smokes plan on it by default. It is carried into the CLAUDE.md squawk below so the rule outlives this debrief.
- **Flow and legs**: no further concerns raised; the operator accepted the HAT and moved straight to release.

## Methodology Observations
All observed on mission-control **1.2.0**.

1. **Flight skill, Phase 4/5b (design review), state-machine DDs.** A stale-commit protocol was drafted as prose bullets (DD3). The Architect found it self-contradictory in review 1 (a Skip that writes) and again in review 2 (an `allowed` set the payload couldn't carry, and `new` + resolution read two ways). Expected: the skill prompts a designer to express any lifecycle or stale-state protocol as an evaluation order plus an outcome table *before* review. Cost: one extra review cycle (the second of the two allowed) spent on a table that could have been written first.
2. **Agentic-workflow, Phase 2a leg design review — no cross-AC feasibility check.** The leg-design-review prompt checks ACs against the codebase, not against each other or against the signatures of the primitives they lean on. Leg 2 AC7 (dynamic submit label) contradicted AC13 (`openModal` unchanged), which surfaced only at implementation as a deviation and then as a HAT ruling. The flight-level Architect prompt has a decision-consistency item (10); the leg-level prompt has none. Cost: a deviation and an operator ruling; the feature ships with a weaker affordance.
3. **Agentic-workflow, Phase 2b — no slot for an operator-assisted step inside an autonomous leg.** The project rule says a leg's live smoke exercises every apparatus primitive, but vault-page smoke needs an operator unlock, and autonomous legs have no human in the loop. The FD moved the smoke and behavior test into the HAT leg at leg-2 design time. Expected: the flight skill asks at design whether any leg's live verification needs an operator action, and places it explicitly. Cost: the smoke ran one leg later than the code it verified (no defect resulted).
4. **Behavior-test skill, Phase 4 — no defined shape for a supplementary checkpoint.** The Validator's step-12 causation caveat was best answered by an extra checkpoint (12b) not in the spec. The skill has no notion of an Orchestrator-added checkpoint, so it was handled ad hoc (explicit expected result, recorded in the run log under its own heading, then folded into the spec at re-author). Cost: none here, but the run-log format has no slot, and a different Orchestrator might have rerun the spec row instead of isolating the cause.
5. **Behavior-test skill, Execution Modes — live mode was available without the documented flag.** The skill says live `SendMessage` continuation needs `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`; in this session `SendMessage` was available as a deferred tool and live mode worked across 15 checkpoints. Expected: the skill's mode check describes availability by tool presence, not by the env var. Cost: none — recorded so a sweep can tell whether the docs drifted.
6. **Sortie skill, step 2 charter vs flight design.** The charter's "no item field value in the DOM" criterion had to be narrowed during flight design (Architect review 1) and re-confirmed with the operator. The charter step agreed a criterion before the design that determined what was feasible. Cost: one charter amendment, surfaced to and accepted by the operator.

**Sortie vehicle fit**: right-sized. There was one decision cluster (collision semantics, stale-commit protocol, page contract, apparatus) and two legs plus a HAT. No second cluster surfaced, and the three HAT fixes refined that same cluster. A squawk would have been wrong: a security-sensitive cross-vault write path, a new IPC channel and a state machine needed design. A mission would have been ceremony.

## Recommendations
1. **Extract before the next vault-page feature.** `vault.js` sits at 2104/2105; plan the extraction as the leg's first step, not an adaptation criterion.
2. **Add two planning checks to the project rules in CLAUDE.md:** (a) a write-targeting picker never defaults to a real destination; (b) every AC that depends on an existing primitive's capability is checked against that primitive's actual signature at design review.
3. **Apply the F3 placeholder to the browser-import destination picker** — the same unsafe default (squawk candidate below).
4. **Return a structured destination name** from `copyDestinationOptions` instead of parsing labels (squawk candidate below).
5. **If a second multi-window vault feature lands, build the `vault-changed` broadcast once**, and give `openModal` a `setSubmitLabel`. Both are shared-mechanism changes that need their own flight or sortie with a non-regression list.

## Action Items
- [ ] Squawk **0146** (defect, routine): browser-import destination picker defaults to Global — start it on a disabled placeholder like the copy picker
- [ ] Squawk **0147** (servicing, routine): `copyDestinationOptions` returns `{ vaultId, name, label }`; the controller stops parsing `lastIndexOf(' — ')`
- [ ] Squawk **0148** (servicing, routine): CLAUDE.md notes — copy-item two-call protocol + stale rule, `renderEpoch`, write-picker placeholder rule, AC-vs-primitive-signature check, dev mode as the standing apparatus, and the apparatus facts (`evaluate` takes `expression`; `reload` refuses internal tabs)
- [ ] Recommendation (design needed, not a squawk): cross-window `vault-changed` broadcast + `openModal.setSubmitLabel` — next vault-page flight
