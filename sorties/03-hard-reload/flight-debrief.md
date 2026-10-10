# Flight Debrief: Hard Reload

**Date**: 2026-10-10
**Flight**: [Hard Reload](flight.md) (Sortie 03, no parent mission; the charter stands in)
**Status**: landed
**Duration**: 2026-10-10 (planned, executed and debriefed the same day)
**Legs Completed**: 1 of 1 (no HAT leg, by operator choice)
**Plugin version**: mission-control 1.2.0
**Commit / PR**: `c7d8840` on `sortie/03-hard-reload`, PR #251

## Outcome Assessment

### Objectives Achieved
Goldfinch now has a cache-bypassing reload.
- A new `hard-reload` chrome-shortcut action and a new `reloadIgnoringCache` `tab-navigate` verb carry it from every trigger to `wc.reloadIgnoringCache()`:
  - the chrome DOM keydown handler;
  - the web-guest `before-input-event` forwarder;
  - the menu-overlay sheet forwarder;
  - Shift+click on `#reload`.
- Plain F5 is now a normal reload.
- MCP `reload` gained an optional strict-boolean `ignoreCache`, and `pressKey` gained `F5`.
- Behavior test `hard-reload` passed 14/14 checkpoints, including 11 physical operator trials.

### Charter Criteria (the sortie's only criteria assessment)
| Criterion | Result | Note |
|---|---|---|
| Ctrl+Shift+R, Shift+F5, Ctrl+F5 and Shift+click reload without the cache, from page focus, chrome focus, and with a sheet open | **Met** | Page and chrome focus: behavior run checkpoints 6–9 and 11 (synthetic), then physical trials 3–5, 8, 9 and 11; each moved the server-side `asset` count by exactly +1 with `Cache-Control: no-cache`. Sheet open: the classifier pair, the parity corpus and a real-sheet `window-factory` test (the sheet is not scriptable live). |
| Ctrl+R, F5 and a plain click still do a cached reload | **Met** | Checkpoints 4, 5, 10, 12 and 13a, plus physical trials 1, 2, 6, 7 and 10: `asset` flat, `transferSize` 0. |
| No-op on internal and welcome tabs | **Met (trigger level)** | Covered by `shortcut-controller.test.js` (internal, welcome/null-wcId and no-tab cases) and the web-only allowlist entry (`guest-forward-allowlist.test.js`, `guest-wiring.test.js`). The main-side verb has no internal refusal, at parity with `reload` (a deliberate FD ruling). |
| Unit tests cover the classifier, allowlist, dispatch, button and main verb | **Met** | 11 test files extended; the suite went from 5828 to 5885 tests, all green. |

Charter constraints were all honored, as the Reviewer confirmed:
- no security-boundary loosening (the verb reads no `args`; the action is web-only and not repeat-safe);
- lockstep classifier edits;
- `renderer.js` untouched (1545/1546);
- no change to Electron's default menu or any global hook.

## What Went Well
- **Squawk-first qualification.** It routed correctly: the squawk gate failed on criterion 3 (shared interfaces, the allowlist) and on the new-behavior rule, and the work went to a sortie with its rationale on record.
- **Two design reviews caught every test-inventory trap before code existed.** The Architect flight review and the Developer leg review found:
  - the `sheet-accelerator.test.js` Ctrl+Shift+`R` → `null` negative loop;
  - the shared `[42]` call-shape loop in `automation-mcp-tools.test.js`;
  - the persisted-HTTP-cache hazard (fixed with a per-`/reset` nonce);
  - the ✕-state click race;
  - `PRESS_KEY_NAMES` living in `mcp-tools.js` (exposing a latent F6 omission);
  - the gap between synthetic input and native accelerators.
- **Nothing became late rework.** The leg landed with zero deviations and the Reviewer confirmed on the first cycle.
- **The server-side observable (DD6).** A zero-dependency `node:http` fixture counting `/asset.js` requests, read with `curl`, gave a browser-independent cache signal that made every verdict unambiguous. The nonce made it re-runnable against a persistent profile.
- **The premise was verified before it was trusted (DD7).** The headless `Menu.getApplicationMenu()` probe at planning surfaced Electron's default *Force Reload* on the very chord being bound. The design refused to accept synthetic `pressKey` evidence for it. Physical trial 8 (address-bar Ctrl+Shift+R) closed it with one reload and the chrome marker and pid unchanged.
- **The operator turned a vague by-eye row into a systematic matrix.** "I tried a few things, saw nothing" was unattributable (4 loads, 3 hard). The operator's call to run every trigger one at a time produced the 11-row table that is now the record for real-input behavior.

## What Could Be Improved

### Process
- **Run by-eye rows as a controlled matrix from the start.** Spec step 15 named only two presses and gave no attribution protocol. The first operator attempt was wasted, and the matrix was improvised mid-run. A by-eye row that checks several triggers should list them one per line, with a read between each.
- **Behavior-test batching was an improvisation.** Strict one-checkpoint-per-turn would have cost about 28 round-trips for 14 checkpoints. The Orchestrator batched the Executor (checkpoints 4–8 and 9–13), kept per-step before/after evidence files, and had the Validator judge each step separately. It worked, and it is recorded in the run log, but the skill doesn't sanction it.
- **The Validator lost its live state between messages.** Each `SendMessage` resumed it from its transcript. That was harmless here, but the agent repeatedly warned that its run would end.

### Technical
- **Debt: the classifier hand-mirror grew again.** Two more branches each in `keydown-action.js` and `sheet-accelerator.js`. `shortcut-classifier-parity.test.js` keeps it safe, but every accelerator now costs a parallel edit (Architect, debt 1).
- **Debt: duplicated main-side fallback.** `register-tab-ipc.js`'s `reload` and `reloadIgnoringCache` branches repeat the empty-history `loadURL` fallback (about 10 lines). The flight allowed a shared helper but none was taken; the next navigation verb would copy it a third time.
- **Debt: the default menu is still un-owned.** Electron's default application menu stays installed. DD7 proved it doesn't double-fire on this Electron version, on Linux/WSLg, for this chord, but nothing pins that. macOS (Cmd+Shift+R) and Windows were not exercised.
- **Debt: two key-name lists that can drift.** `KEY_MAP` (`input.js`) and `PRESS_KEY_NAMES` (`mcp-tools.js`) are separate hand lists. F6 drifted for six missions before this flight caught it.
- **Developer test-gap claims, corrected by the Flight Director:**
  - The Developer listed "Shift+click on ✕ → stop" and "held Ctrl+Shift+R" as untested. Both are pinned: `navigation-controller.test.js` *"…stop glyph wins…"* and `guest-wiring.test.js` *"web guest auto-repeat Ctrl+Shift+R is preventDefaulted but NOT sent"*.
  - Genuinely untested: a hard reload while a load-failure or crash panel is shown (parity with `reload`, which is also unpinned there), and the chrome-focus held-key repeat (DD3 parity, deliberate).

### Documentation
- The modifier-less accelerators in the classifier pair are now F12, F6 and F5. The "decide before the modifier gate, `!alt`, sheet-exempt" shape is documented only in source comments.
- The DD7 result belongs with the existing "every Electron major bump re-runs…" rule in CLAUDE.md, since an Electron bump could change the default-menu behavior.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|---|---|---|
| F6 added to `PRESS_KEY_NAMES` (not in the original flight) | The leg review found the list never had F6; a cheap drift fix on a touched line | Yes: fix adjacent drift on a touched line, logged in the flight log |
| The `window-factory` harness gained a real `sheetAcceleratorAction` option (optional in the leg) | The only way to cover the sheet path, which is not scriptable live | Yes: the standard way to test sheet-forwarded accelerators |
| Behavior-test Executor batched across checkpoints | 14 checkpoints, all judgeable from per-step server-side files | Yes, when each step leaves its own before/after evidence file; otherwise no |
| Step 15 expanded from 2 presses to 11 controlled trials | Operator request after an unattributable first attempt | Yes: author by-eye rows as one-trigger-per-line matrices |
| Steps 9–10 `document.hasFocus() === false` ruled non-blocking | The rows assert reload and cache behavior, not focus; real focus was covered by step 15 | Yes: the crew focus rule applies only to focus-asserting rows (worth saying in the crew file) |

## Key Learnings
- **Synthetic input proves plumbing; physical input proves native accelerators.** `sendInputEvent` reaches `before-input-event` and the DOM keydown handler, but not necessarily the OS/native menu-accelerator path. Any shortcut colliding with an Electron default-menu role needs a physical-keypress check.
- **Electron's default menu is live in Goldfinch.** It has *Reload* `CmdOrCtrl+R`, *Force Reload* `Shift+CmdOrCtrl+R`, *Toggle DevTools*, zoom, *Minimize* `CmdOrCtrl+M` and *Close* `CmdOrCtrl+W`. On `BaseWindow`, Linux/WSLg and Electron 44, its *Force Reload* did not double-fire when the handlers `preventDefault()`.
- **A server-side counting fixture is the right observable for network and cache behavior.** It is browser-independent and cheap, and per-run nonces make it rerunnable.
- **The cost of a new keyboard shortcut is about nine closed sets:**
  - the classifier pair;
  - the parity corpus;
  - the guest-forward allowlist (web versus internal);
  - the chrome dispatch `switch`;
  - the sheet map;
  - `PRESS_KEY_NAMES`/`KEY_MAP` (if automatable);
  - the README shortcut table;
  - `docs/mcp-automation.md`;
  - the line budgets.

  This sortie's leg is a good template.

**Test metrics** (Developer run on `c7d8840`):
- **Counts**: 5885 tests in 25 suites; 5881 pass, 0 fail, 0 skipped, 4 todo (the known `save-moment-corpus` cases).
- **Wall-clock**: 7.94 s, against 6.54 s at sortie 02, 6.0 s at sortie 01 and 6.45 s at M22 F1. This is at the top of the 5.2–7.9 s band.
- **Cause of the slowdown**: host noise is the likely cause, not this flight. The untouched vault suites ran about 1.3–1.7× slower in isolation (`vault-compromise-rotate` 3.8 s vs 2.4 s; `vault-context` 2.7 s vs 1.6 s; `vault-txn` 2.6 s vs 1.9 s). This flight's touched files run 94–234 ms each, except `navigation-controller` at 1.45 s, unchanged from sortie 01's 1.44 s.
- **Next step**: re-measure on a quiet host before declaring a new band.
- **Flakes**: none. Squawk 0110 (`listItemsMeta`) stays open.
- **Line budgets**: `renderer.js` is 1545/1546 and `bookmarks-bar.js` is 1076/1100, both unchanged.

## Methodology Observations
All observations below are against plugin version 1.2.0.

1. **behavior-test skill, Phase 4 (checkpoint loop): no sanctioned batching.**
   - **What the skill did**: it requires one Executor turn per checkpoint, so 14 checkpoints means about 28 agent round-trips even in live mode.
   - **What was expected**: an explicit allowance to batch consecutive checkpoints when each leaves an independently judgeable evidence file, with the Validator still judging each one separately.
   - **Cost**: none here, because the Orchestrator improvised and logged it. But it is an off-protocol call each time, and a stricter Orchestrator would have spent roughly twice the wall-clock.
2. **behavior-test skill, live mode: Validator lifetime messaging.**
   - **What happened**: the Validator ended each turn with "my run ends at this handback, send later steps to a fresh or resumable Validator". `SendMessage` resumed it from its transcript every time.
   - **What was expected**: crew prompts that tell live-mode agents they will be resumed. Without that, every message carried a disclaimer, and an Orchestrator could misread it as a lost agent and re-spawn needlessly.
   - **Cost**: noise only.
3. **behavior-test authoring (AUTHORING.md, via the flight skill Phase 5): by-eye rows lack an attribution protocol.**
   - **What happened**: the spec's `[by-eye]` row bundled two physical presses into one checkpoint with no "one at a time, read between" instruction. The operator's first attempt was unattributable and had to be redone as a controlled matrix.
   - **What was expected**: authoring guidance that a by-eye row exercising more than one trigger lists them as separate, sequentially read trials.
   - **Cost**: one wasted operator round, plus an improvised matrix mid-run.
4. **agentic-workflow skill, Phase 2d (commit): the commit Developer returned an empty report.**
   - **What happened**: the commit agent's hand-back was literally `placeholder`. The commit itself (`c7d8840`) was correct, which the Flight Director verified with `git log` and `git show --stat`.
   - **What was expected**: the crew Commit prompt's "report the commit ref".
   - **Cost**: one verification step. Without it, the flight would have proceeded on an unconfirmed commit.
5. **sortie skill, Plan step 4 (flight design): the flight skill's Phase 6 "iterate until approved" was satisfied by the operator's original instruction ("let's log sortie and fix it").**
   - **What happened**: there was no separate approval gate before marking the sortie `ready`. That was correct for this operator, but the skill doesn't say whether an instruction to plan and fix counts as approval of the designed flight.
   - **Cost**: none; recorded for the sweep.

**Sortie vehicle fit**: right-sized. There was exactly one decision cluster (trigger set, F5, MCP option, default-menu premise), one leg, no HAT, and no second cluster surfaced. A squawk would have been wrong: there were real decisions (DD1, DD2, DD5, DD7) and a security-sensitive allowlist change. A mission would have been ceremony.

## Recommendations
1. **Add the DD7 check to the Electron-bump rule in CLAUDE.md.** Next to the existing "every Electron major bump re-runs the full store suite / the `third-party-cookie-isolation` spec", add: re-run `hard-reload` checkpoint 15, trial 8 (physical Ctrl+Shift+R with the address bar focused; the chrome must not reload). Default-menu accelerator behavior is version-dependent.
2. **Decide ownership of the application menu.** Choose between `Menu.setApplicationMenu(null)` and an owned menu. This is a global-hook decision with cross-platform consequences (macOS edit roles; *Minimize* on Ctrl+M collides with toggle-panel; *Close* on Ctrl+W), so it belongs in a future sortie with its own premise checks, not a squawk.
3. **Derive or guard `PRESS_KEY_NAMES` against `KEY_MAP`.** A drift-guard test, or deriving one list from the other, prevents a repeat of the six-mission F6 omission. *(Squawk 0142.)*
4. **Extract the shared empty-history reload helper in `register-tab-ipc.js`** before a third navigation verb copies it. *(Squawk 0143.)*
5. **Update the behavior-test authoring practice.** Write by-eye rows as one-trigger-per-line matrices with a read between each. The project crew file should say the focus-escalation rule applies only to rows that assert focus.

## Action Items
- [ ] CLAUDE.md: add the `hard-reload` physical-trial re-run to the Electron-bump rule (Recommendation 1)
- [ ] Future sortie candidate: application-menu ownership (Recommendation 2)
- [x] Logged as squawk **0142** (deferred): `PRESS_KEY_NAMES`/`KEY_MAP` drift guard (Recommendation 3)
- [x] Logged as squawk **0143** (deferred): shared empty-history reload helper in `register-tab-ipc.js` (Recommendation 4)
- [ ] Crew file (`behavior-tests-execution.md` apparatus notes): the focus rule's scope and the by-eye matrix practice (Recommendation 5)
- [ ] Re-measure suite wall-clock on a quiet host (7.94 s reading)
