# Flight Debrief: Automation Honors the Vault Lock

**Date**: 2026-11-06
**Flight**: [Automation Honors the Vault Lock](flight.md) (Sortie 07, standalone)
**Status**: landed
**Duration**: 2026-11-05 (operator bug report, planning) to 2026-11-06 (HAT sign-off; PR #283 ready)
**Legs Completed**: 2 of 2 (`automation-honors-vault-lock`, `hat-and-alignment`)
**Plugin version**: mission-control 1.2.3

## Outcome Assessment

### Objectives Achieved
The operator's vault lock is now authoritative over MCP automation.
- **One-way coupling.** Lock now, from every surface, plus the idle auto-lock and quit, zeroizes
  every live MCP session's vault keys through one isolated `onLock` teardown step. Sessions stay
  open, and an agent's unlock never changes the operator's lock state.
- **Truthful unlock results.** `vaultUnlock` reports `held`, so the operator-found "bad key looks
  already unlocked" misread is gone.
- **Visible agent access.** A chrome-only `vault-automation-held` push drives an indicator dot, a
  tooltip, and an explanatory right-click menu (a note, Unlock now, End automation access). The
  operator can see and end agent vault access even while their own vault is locked.

### Charter Success Criteria
| Criterion | Status | Notes |
|---|---|---|
| Lock now → the session's `vaultList` returns `[]`, TOTP `null`, fill/answer refused; re-unlock works | **met** | Behavior test steps 5–8 (lock-while-locked) and HAT H3 (lock from the operator-unlocked state); unit AC7b drives the real store's `lockNow()` |
| Idle auto-lock does the same | **met** | HAT H6 (1-min setting; J's own 10-min timer ruled out by timestamps); unit AC7b(b) drives the real store idle timer |
| A wrong-key `vaultUnlock` returns `unlocked: []` + `held`, with keys untouched | **met** | Behavior test steps 4 and 6; vault-context unit cases |
| Locked + held → badge + label; menu offers Unlock now + a lock-out item that clears the badge | **met (amended)** | Behavior test steps 3/7–9 and HAT H4/H5/H8. The menu copy was amended in the HAT to [note, Unlock now, **End automation access**] plus a tooltip; same id and dispatch |
| Docs and CLAUDE.md describe the new coupling, and nothing still asserts the decoupling | **met** | AC18 and the AC19 grep, Reviewer confirmed; HAT copy reflected in CLAUDE.md and `docs/mcp-automation.md` |

All checkpoints were met: unit cases, behavior test PASS 10/10
(`tests/behavior/vault-mcp-lock-coupling/runs/2026-11-06-05-34-20.md`), and HAT H1–H8 signed off.

## What Went Well
- **The investigation hit the root cause before planning.** It found the per-session key copies,
  the `onLock` path that never reaches them, the documented decoupling (`docs/mcp-automation.md`),
  and the no-SSE JSON-response session lifetime. It ruled out `unref`'d timers with a scratch
  Electron probe. The charter then had the right shape on the first pass.
- **The option (b) gap question at charter time** (the operator can't reach Lock now while their
  own vault is locked) caught the scenario that actually matters for an agent holding its own
  access key. Without it, the fix would only have worked when the operator happened to be
  unlocked.
- **Two review layers each caught something the other missed.** The flight Architect review
  enumerated the test breakages and the lock-while-locked side effects. The leg Developer review
  found:
  - [high] an AC that couldn't be built (an injected-throw ctx);
  - the substitute-call scenario gap, closed by AC7b, a real-trigger integration unit through the
    real store `lockNow()` and idle timer;
  - a stale-flag hole where `stop()` clears `sessions` before `onclose`.
  Every change adopted the reviewer's own fix, with no second cycle.
- **Live mode with a persistent driver made the behavior test meaningful.** Vault keys live per
  MCP session, so the Executor's long-lived attach-only driver kept the same session J from
  unlock through lock and re-unlock, with session-id continuity recorded at every step. The
  driver also did `$ENV` secret substitution and output redaction, so no secret reached any
  evidence file.
- **The pure model plus stable action ids paid off in the HAT.** The menu copy change touched
  only `page-context-model.js`, a `title` line in the controller, tests and docs. Dispatch,
  `renderer.js` and the line budget were untouched.
- **The test suite is healthy.** It runs in 6.5 s for 6333 tests, about 0.9 s faster than the
  sortie 05 median despite about 365 more tests. That confirms squawk 0172 removed Sortie 06's
  13.3 s real-timer regression.

## What Could Be Improved

### Process
- **The UX copy was ratified in the abstract.** DD6 named the locked+held item "Lock now"
  because the operator picked it from a text-only option list during flight design. The HAT then
  found it read as a no-op on an already-locked icon, and the dot had no explanation. The
  rejected alternative ("End automation access") was offered at the time but without a preview of
  the actual state. Cost: one HAT fix cycle and an app relaunch. **Lesson:** for any new
  operator-facing state, show an ASCII preview of the rendered state (icon, tooltip, menu) when
  asking for copy, and ask "what does the user see, and does each label describe its effect in
  this state?"
- **A claim that several paths "all cascade through X" went unverified until leg review.** DD4
  said every key-emptying path cascades through `onclose`, which was false for `stop()`. The
  flight Architect's scenario trace covered user scenarios but not teardown ordering. **Lesson:**
  when a design decision asserts that several paths converge on one funnel, trace each path's
  ordering explicitly at flight review.

### Technical
- **The held projection has three trigger classes:** the ctx flip, server lifecycle
  (`publishHeld()` after stop, start and swap), and the ctx hook through `onVaultHeldChange`. A
  future lifecycle path, such as a "revoke session" op, could miss a publish. Candidate refactor:
  move `publishHeld`/`lastPushedHeld` out of `main.js` into a small injected, unit-testable module
  and replace the source-pin-only coverage.
- **`renderer.js` sits at its 1505-line budget with zero headroom.** This flight stayed
  line-neutral (the `vaultMenuOpts()` spread), but the next chrome-side vault feature needs an
  extraction first. The vault indicator and menu glue in `vault-controller.js` is a natural
  candidate.
- **The "Automation has vault access" copy is not drift-guarded.** The phrase appears in the
  model note, the controller label/title, CLAUDE.md and the docs, against the project's norm for
  repeated copy.
- **Lock-while-locked re-runs the full teardown, dropping pending locked-vault save offers.** This
  was accepted in the HAT (H7). The operator cannot end only agent access without also dropping
  such offers; revisit if an agent-only revoke is ever wanted.
- **Test metrics** (full run, Developer): 6333 tests, 6329 pass, 0 fail, 0 skipped, 4 todo (the
  pre-existing `[known-unsolved]` capture-detection cases), 6.5 s, no flakes.
  - Slowest files solo: `vault-txn` 3.55 s, `vault-compromise-rotate` 2.36 s, `vault-context`
    1.68 s, `navigation-controller` 1.43 s, `vault-copy-item` 1.10 s, `automation-mcp-server`
    1.05 s (a new top-10 entrant from the real-store AC7b unit, which is cheap thanks to fast
    scrypt).
  - `vault-txn` was 2.31 s at sortie 05 and is unchanged this flight, so it is likely host noise.
    Re-measure it on a quiet host before calling a new band.

### Documentation
- CLAUDE.md's main↔chrome routing taxonomy doesn't name the new chrome-only `broadcastToChromes`.
  It is a chrome-only variant of class (2) broadcast fan-out.
- The behavior spec's Validator-suggested revisions are recorded in the run log but not applied:
  - fold Steps 5–7;
  - mandate the polling timeline, with the trigger defined as the prior call's return;
  - require and capture the Step 9 DELETE status;
  - add a positive teardown observable;
  - sanction the read-only `app.db` default-jar check.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|---|---|---|
| DD6 menu copy amended in the HAT (note + "End automation access" + tooltip) | Operator found the locked+held state not self-explanatory | yes — preview operator-facing copy at design time |
| AC7 throw-isolation moved to an exported `zeroizeVaultContexts` helper | The ctx is private to `createMcpServer`, so a throw couldn't be injected | yes — a testable pure helper over a factory-injection seam |
| AC7b real-trigger integration unit added | Leg ACs proved wiring only via substitute calls | yes — pair a source-scan wiring pin with a real-trigger test whenever "X reaches Y through hook Z" |
| `stop()` zeroizes before transport close, plus `publishHeld()` after lifecycle swaps | A transport close throw could orphan keys and stale the cue | yes — the zeroize-before-close ordering |
| Version bump made inside the PR (`--no-git-tag-version`), tag after merge | Operator asked to bump now and tag after merge; the documented flow bumps and tags together on `main` | no — operator's call for this release |

## Key Learnings
- **MCP sessions here are JSON-response (no SSE).** There is no stream whose drop tears a session
  down, so "disconnect equals cleanup" is false. A session's keys live until an explicit `DELETE`
  (`transport.terminateSession()`; plain `client.close()` sends none), the op-reset idle timer, or
  `stop()`. Any MCP session-security work must treat teardown as non-implicit.
- **`lockNow()` fires `onLock` unconditionally, even when already locked.** That is what made
  Lock-out-while-locked possible with no new IPC. It is also why every `onLock` consumer re-runs
  on a lock-while-locked, so new consumers must be idempotent and acceptable to re-run.
- **The held cue is a safe-direction approximation.** Access-key revocation or admin-key rotation
  drops keys lazily at the next vault op, so the cue can stay on briefly after access is already
  gone. It is not an authoritative live-access statement.
- **Behavior-test apparatus facts** (recorded in the run log and worth adding to the crew file's
  Project Apparatus Notes):
  - per-session state needs a persistent driver;
  - `evaluate` awaits Promises;
  - `readDom` with a selector returns the full chrome HTML;
  - `readAxTree` works on the chrome wcId;
  - `client.close()` doesn't DELETE.

## Methodology Observations
1. **sortie skill, Plan step 2 (charter interview) / flight skill, Phase 4 (crew interview):
   operator-facing copy was chosen from a text-only option list** ("Unlock now + Lock now" vs
   "Unlock now + 'End automation access'"). The skill did not prompt for a rendered preview of
   the new UI state.
   - Expected: copy decisions for a new operator-visible state carry a preview of what the
     operator will see (icon state, tooltip, menu), so the label is judged in context.
   - Cost: one HAT inline fix cycle, an app relaunch, and a design-decision amendment after
     review.
   - Plugin 1.2.3.
2. **flight skill, Phase 5b (Architect design review): the scenario-trace item (checklist 9)
   traced user scenarios but not a decision's convergence claim.** DD4's "all paths cascade
   through `onclose`" passed flight review and was caught only at leg design review
   (`stop()` ordering).
   - Expected: the checklist asks the Architect to trace each path a convergence or "all X go
     through Y" claim depends on.
   - Cost: a [medium] leg-review finding plus two extra ACs. It was caught before code, so there
     was no rework.
   - Plugin 1.2.3.
3. **behavior-test skill, Phase 2/3 (live mode): crew agents end their turn after each report,
   and `SendMessage` resumes them.** Each agent's hand-back says "this subagent run ends; re-spawn
   or continue me", which reads like a failure but is the normal resume path. Separately, the
   Validator's `[CLOSING]` summary arrived as a message only after its task notification. Briefly
   it looked like the project's known closing-summary transcript loss (Project Apparatus Notes),
   but it was a delivery delay.
   - Expected: the skill's live-mode text says resume-per-message is the live mechanism, and to
     wait for a late closing message before declaring loss.
   - Cost: none beyond Orchestrator uncertainty.
   - Plugin 1.2.3.
4. **sortie skill, vehicle check: a sortie was the right vehicle.** There was one cluster of
   decisions: how automation sessions couple to the operator's lock, plus the visibility needed
   to act on it. It took 1 autonomous leg plus HAT, within the soft limit. The charter's option
   (b) widened scope within the same cluster, and no second cluster surfaced. Brute-force
   detection was correctly deferred as a separate cluster.
   - Plugin 1.2.3.

## Recommendations
1. **Plan a brute-force-detection sortie for `vaultUnlock`** (rate limit, lockout or audit alert
   on repeated failures). It was deferred by charter at the operator's request and is a separate
   design cluster.
2. **Before the next chrome-side vault feature, extract the vault indicator and menu glue** out of
   `vault-controller.js` and `renderer.js`'s budget pressure (zero headroom at 1505). Move
   `publishHeld` into an injected, unit-testable module so new MCP lifecycle paths can't miss a
   publish.
3. **Add a design-time "operator-facing state" check:** a preview plus "does each label describe
   its effect in this state", for any flight introducing an indicator or menu state.
4. **Apply the behavior spec's Validator-suggested revisions** and add the run's apparatus facts to
   the crew file's Project Apparatus Notes.
5. **Name `broadcastToChromes` in CLAUDE.md's routing taxonomy,** and drift-guard the "Automation
   has vault access" copy.

## Action Items
- [ ] Brute-force detection for `vaultUnlock`: future sortie (needs design)
- [ ] Vault indicator/menu extraction + `publishHeld` module: next flight touching the vault chrome (needs design)
- [ ] Behavior spec `vault-mcp-lock-coupling` revisions + apparatus-notes update → squawk 0173
- [ ] CLAUDE.md routing taxonomy names `broadcastToChromes` → squawk 0174
- [ ] Drift-guard the "Automation has vault access" copy across model/controller → squawk 0175
- [ ] Re-measure `vault-txn` on a quiet host (3.55 s vs 2.31 s at sortie 05; file unchanged)
