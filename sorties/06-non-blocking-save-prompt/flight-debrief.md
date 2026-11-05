# Flight Debrief: Non-blocking Save Prompt

**Date**: 2026-11-05
**Flight**: [Non-blocking Save Prompt](flight.md)
**Status**: landed
**Duration**: 2026-11-04 - 2026-11-05
**Legs Completed**: 4 of 4 (3 code legs + HAT)
**Plugin version**: mission-control 1.2.3

## Outcome Assessment

### Objectives Achieved
The blocking save surfaces are gone. A form submit now raises a small, content-sized prompt in the top-right corner (its own per-window overlay view, under the vault key icon). The page stays fully usable beneath it. It closes on its own after 10 s, pauses on hover, focus or window blur, and drops on tab switch, fullscreen or lock. A locked vault gets the same prompt with "Unlock & save": the unlock sheet opens only on that click, and the save completes after unlock through a consent-gated finalize. The `vault-capture` sheet and the auto-raised `keepFocus` unlock are retired. Shipped in `5ba446b` (implementation) and `c91d877` (HAT artifacts), PR #280.

### Charter Criteria (sortie: met / not met)
| Criterion | Result | Note |
|---|---|---|
| Page fully usable under the prompt, locked or unlocked | **Met** | HAT H1/H6; Leg 1 AC29 run 1 (prompt at 0.3 s, page navigated, no sheet). |
| Unlocked Save saves/updates with no further dialog; locked Save → unlock → completes with no further blocking dialog | **Met** | H3 (saved; resubmit raises no offer), H7 (consent `granted` → finalize `saved`), H9 (unlock via key icon converts in place). Update path and destination-vault choice are unit-covered. |
| ✕ / Not now / 10 s removes the prompt and discards the held credential | **Met** | H1, H4 (re-submit re-offers, so nothing saved), H8 (slow unlock shows "expired" and writes nothing). |
| Keyboard-reachable and operable, announced to a screen reader, timer pauses on pointer/focus | **Partly met** | Keyboard (H10) and pause (H2) verified by eye. **Screen-reader announcement UNVERIFIED** (no screen reader on the rig; P3). |

## What Went Well
- **DD1 (separate per-window view, not the sheet) held completely.** No flicker on show, hide or tab switch, and the squawk-0100 hide-before-sync order needed no rework. Find overlay, sheet and save prompt now form a consistent three-overlay pattern.
- **Census booleans made the by-eye HAT judgeable.** `savePromptVisible` and `savePromptPaused` (no wcId, so the fail-closed guard holds) plus `GOLDFINCH_VAULT_TRACE` let the FD read every operator action from the log. Examples: window-blur pause in H2, hidden F6 hops in H10, "no capture at all" rather than "no prompt" in H11. Several "did it work?" questions were answered from the log instead of from memory.
- **A7 was caught live and fixed before landing.** Leg 1's only full live run hit a vault idle-lock and found that the TTL drop silenced the expired notice. Leg 2 reproduced it red on the interim path first, then fixed it, and H8 confirmed the fix live at ~191 s.
- **Consent-gated finalize (DD7)** extended the four-guard pattern without redesign. The FD spot-check of `vault-capture-finalize` (sender, owner = caller, active tab, then a record match) found it tight.
- **Pure close-effects table (DD6)** shared by main and chrome, with drift tests. The Leg 1 `CLIENT_HANDLED_REASONS`/`DEFERRED_REASONS` split worked as a clean handoff between legs.
- **`renderer.js` stayed at 1504/1505**, because offers carry their wcId and the active-tab gate lives main-side.
- **Out-of-scope defects stayed out.** The two fullscreen defects found in H11 were control-tested (reproduced with no prompt; the Windows build is clean) and filed as squawks 0170/0171 instead of being folded in.

## What Could Be Improved

### Process
- **HAT steps were written without checking the operator could perform them.** H12's "unpin the vault icon" was impossible: the vault indicator isn't pinnable, and every pinnable button sits left of it. H12's "change chrome zoom" isn't operator-reachable either, since zoom actions target the tab. H11's "find bar open, then prompt" ordering can't happen with a navigating login, because navigation closes the find bar before settle. This repeats the project rule "check every AC against the primitive's actual signature" (Sortie 04) and the unobservable-surfaces spec-authoring rule, this time for operator actions rather than automation. Cost: about 4 wasted HAT runs and one operator confusion moment.
- **Deferring live checks to the HAT moved risk to the end.** The operator called the Leg 1 live smokes fragile, and they were: scripted submits raced the operator's focus, and the vault idle-locked mid-run. But A7 was found only because run 2 happened before the deferral. The HAT then took two sessions; one cause was the 10 s prompt window being tight for multi-key steps (H10 needed three attempts, H12 two).
- **The F6 hop needed Fn on the operator's keyboard.** The first H10 run failed silently. The operator calls it a fluke: not a defect, and no design change to the F6 hop.

### Technical
- **Test wall-clock regression: about 6.5 s on every `npm test`.** The suite went from about 7.4 s (sortie 05) to 13.3 s. `save-prompt-manager.test.js`, `save-prompt-ipc.test.js` and `save-prompt-consent.test.js` each take 10–12.7 s run alone (FD re-measured): a real 10 s offer timer (`save-prompt-manager.js` default `setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms)`) is left pending, and the process waits for it to exit. The manager already injects a clock; the tests apply the MockTimers recipe sparsely. The flight-end Reviewer didn't flag it because the review prompt doesn't ask for runtime deltas.
- **A1 is residual debt.** Prompt geometry is computed only at show time, and nothing re-stacks it when the find bar opens or closes. The operator accepted it ("edge case and is recoverable"); the fix is a restack on find show/hide across two main-side surfaces.
- **Squawk-0100 ordering relies on call-site discipline.** `window-factory`, `register-tab-ipc`, `html-fullscreen` and `chrome-recovery` each carry prompt close calls that must run before bounds sync or capture drops. The order is pinned by tests, not by structure.
- **Several source-scan pins need upkeep:** the exact allowlist of `captureSave(` call sites, and `isSavePromptContents` grep-pinned at both engine sites. A per-window overlay base for find, sheet and save prompt is a possible later consolidation.
- **Unit-only coverage:** card and identity offers (only login was exercised by eye), anchor freshness under unpin and chrome zoom (A2), and the automation guard (A4).

### Documentation
- The CLAUDE.md save-prompt paragraph is accurate but very dense. A short lifecycle and close-reason diagram in `docs/vault.md` → *The save prompt* would help the next flight in this area.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| Spikes P1/P2 ran live at Leg 1 landing, not as throwaway spikes first | The find overlay was close precedent; it saved a spike leg | No — only when a working precedent exists |
| DD2 amended: keys inside the prompt read main-side via its `before-input-event`, no `save-prompt:key` channel | No page-trusted key channel; matches `handleCrossView` | Yes — pattern for never-focused views |
| `teardown` close reason gets `dismissShown: true` (DD6 table gap) | A chrome crash skips the window-close sweep | n/a (fix) |
| Leg 1 live AC29 steps after run 2 deferred to the HAT (operator ruling) | Scripted live smokes judged fragile | No — operator: a one-off for this interaction's complexity |
| Design review cycle 2 skipped on Legs 2 and 3 (FD, with recorded rationale) | Cycle-1 changes were mechanical | n/a |
| H12 unpin/chrome-zoom sub-steps dropped; H11 find-first ordering replaced by prompt-first | Not operator-reachable | No — catch at HAT design |

## Key Learnings
- **A new push channel can shadow an existing silent path.** A7 happened because the drop push removed the pending-unlock entry that the "expired" notice depended on. Any design adding a main→chrome push for an existing lifecycle event should list every timer and silent-drop path the push now races, and walk each one to the visible end state.
- **Window blur is a real pause input during HAT.** Many "it never counted down" observations were the operator sitting in the terminal. Reading `savePromptPaused` together with window focus avoided chasing ghosts. A HAT that drives submits from a script should tell the operator to click into the app first, every time.
- **On WSLg, control-test before calling something pre-existing.** The fullscreen mis-render looked like a prompt bug until a no-prompt control and the operator's Windows build cleared the sortie.
- **An unobservable surface still needs a scripted driver.** Pairing operator eyes with FD-scripted submits, census polling and traces gave a precise record of a surface MCP cannot see.

## Methodology Observations
All observed on mission-control **1.2.3**.

1. **agentic-workflow, Phase 2b (Interactive/HAT legs): HAT step design has no reachability check for operator actions.**
   - **What happened**: the FD wrote H12 ("unpin the vault icon", "change chrome zoom") and the H11 find-first ordering. None of the three can be performed in the real UI. The skill's HAT guidance ("keep it lightweight — the acceptance criteria are verification steps") has no step asking whether the operator can actually do each action, though the leg-design risk checks ask the analogous reachability question for code states.
   - **Expected**: the 2a *Reachability* risk check applied to HAT steps: for each operator action, confirm the UI affordance exists and the precondition can arise.
   - **Cost**: about 4 wasted HAT runs and one operator confusion moment; anchor freshness for those inputs stays unit-only.
2. **agentic-workflow, Phase 2d (Flight Review): the Review prompt doesn't check test-suite runtime.**
   - **What happened**: three new test files each hold the process about 10 s on a live timer, nearly doubling `npm test` (7.4 → 13.3 s). The flight-end Reviewer re-ran the gates and confirmed, but nothing asked it to compare wall-clock. The debrief's Developer metrics step caught it.
   - **Expected**: the Review prompt asks for a suite wall-clock delta against the previous flight and flags a large jump.
   - **Cost**: a regression shipped in the flight commit; a follow-up squawk is needed.
3. **agentic-workflow, Phase 2b/2d: no guidance for an operator deferring a leg's live AC to the HAT.**
   - **What happened**: mid-Leg-1 the operator deferred all remaining live checks to the HAT. The skill has no rule for recording which ACs moved, or for re-checking that the HAT covers each one. The FD did both by hand (the HAT leg's H-steps map the deferred ACs). The deferral pushed risk to the end: A7 was found only by the one run made before it.
   - **Expected**: when a live AC is deferred, the skill requires a mapping from each deferred AC to a HAT step, written into the HAT leg.
   - **Cost**: none this flight, thanks to the manual mapping; the risk is silent coverage loss.
4. **sortie, Plan step 5 (re-check the gate): leg count driven by blast radius, not decisions.**
   - **What happened**: the flight designed at 3 legs + HAT against the 1–2 + HAT soft limit. It held one decision cluster; the third leg came from Leg 1's size (63 files) and wanting the keyboard/announce work isolated. The operator kept 3 legs explicitly.
   - **Expected**: the gate's two options ("consolidate" or "escalate") fit; a third, "keep and record that it's blast radius, not a second cluster", was what happened and is not named.
   - **Cost**: none; noted for the sweep.

## Operator Interview
- **Live-check deferral**: "a one off due to the complexity of the interaction, should not make a permanent change."
- **F6 needing Fn**: "just a fluke, no big deal."
- **HAT instructions**: "good most of the time." The misses were the unreachable H12 sub-steps and one lost resize instruction.

## Recommendations
1. **Fix the save-prompt test timer leak** (squawk candidate): use the injected clock or MockTimers everywhere in `save-prompt-*` tests, or make sure every offer is closed in teardown. That recovers about 6 s per `npm test`. Pin it with a guard that no real timer outlives a test.
2. **Validate every HAT operator action against the real UI at HAT design time.** Treat an unreachable step like an unobservable surface: redesign it or pre-mark it. (The operator otherwise found the HAT instructions "good most of the time".)
3. **No standing change to live-smoke placement.** The operator ruled the Leg 1 deferral a one-off driven by this interaction's complexity, not a new default. The lesson stands only as a tactic: when scripted live runs are fragile, have the operator drive the input while the FD reads census and trace.
4. **Restack overlay geometry on find show/hide (A1)** in the next flight touching the find overlay or the save prompt. The same hook should cover anchor re-send on pin and zoom changes if the vault indicator ever becomes movable.
5. **Verify the screen-reader announcement (P3)** the first time a screen reader is available. Include checking that the chrome live region and the in-prompt status don't both speak.

## Action Items
- [ ] Squawk **0172**: save-prompt unit tests leave a real 10 s timer pending (+6.5 s per `npm test`) — logged; operator: fix right after the release
- [ ] P3 screen-reader check when a screen reader is available (carried; no rig today)
- [ ] By-eye check of card and identity offers in the next HAT that touches the vault
- [ ] A1 restack on find show/hide: next flight in this area
- [ ] Squawks 0170 (Windows Esc fullscreen) and 0171 (WSLg fullscreen mis-render): deferred, already logged
