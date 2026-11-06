# Flight Log: Automation Honors the Vault Lock

**Flight**: [Automation Honors the Vault Lock](flight.md)

## Summary
Sortie planned 2026-11-05 from an operator-found defect (MCP session kept vault access after Lock
now; bad-key unlock read as "already unlocked"). Charter agreed; operator rulings: both manual and
idle lock zeroize automation; failed unlock reports held vaults; option (b) held cue + Lock now
while locked; badge + label; both menu items; HAT leg included. Flight design in progress.

---

## Leg Progress

---

## Decisions

---

## Deviations

---

## Anomalies

---

## Session Notes

- 2026-11-05: Investigation (Flight Director). `vault-context.js` per-session keys are zeroized only
  on transport teardown or the session's op-reset idle timer; the store's `onLock`
  (`main.js` → `runVaultLockTeardown`) never reaches them; `docs/mcp-automation.md:849-851` documents
  the decoupling. Responses are JSON (`enableJsonResponse: true`), so there is no SSE stream whose
  drop would tear a session down — a long-lived client keeps its session (and keys) indefinitely
  while it keeps making vault calls. Confirmed `unref()`'d timers fire in Electron main (scratch
  probe, with and without a ref'd http server), ruling that out. No "already unlocked" string exists
  in `src/`: a bad-key `vaultUnlock` returns `{ unlocked: [] }` while earlier keys survive, which the
  agent read as already-unlocked.
- 2026-11-05: Architect design review (cycle 1, Sonnet): **approve with changes**, no blockers. The
  scenario trace completed for all three entry points, and `lockNow()` fires `onLock`
  unconditionally, so the Divert condition doesn't trigger. Incorporated:
  - a source-scan wiring pin (`main.js` is untestable);
  - the enumerated test breakages and controller-harness mocks;
  - a separate `heldPushed` init flag;
  - an aggregate computed from ctx key sizes, with a live get-handle and chrome-only fan-out;
  - once-per-flip semantics;
  - Lock-while-locked re-running the full teardown (drops pending locked save offers), accepted and
    documented;
  - "lock ends current access, not the grant" wording;
  - behavior-test default-jar precondition, Step 5 relabel and a `readDom` attribute fallback.

  Flight Director rulings on the Architect's questions: the audit detail stays `unlocked=<n>`; the
  dropped locked-vault offer on Lock-while-locked is accepted; no badge while the operator is
  unlocked (operator ruling). Changes were clarifications and test enumeration, not design shifts,
  so there was no second review cycle.
- 2026-11-05: Operator approved the design. Sortie 06 confirmed landed (PR #280). Status → **ready**.

### Flight Director Notes
- 2026-11-05: `/mission-control:agentic-workflow sortie 07` started. Phase file `leg-execution.md`
  loaded (valid: Crew / Interaction Protocol / Prompts). Branch `sortie/07-automation-honors-vault-lock`
  from `main` @ b85189c. Status → **in-flight**. 2 legs: 1 autonomous
  (`automation-honors-vault-lock`) + 1 HAT (`hat-and-alignment`).
- Leg 1 `automation-honors-vault-lock` designed. **Risk tier: HIGH**: it touches security-sensitive
  key zeroization, changes a shared interface (the `vaultUnlock` result shape, a new
  main→chrome channel, new contextBridge methods), adds a cache/freshness gate (`lastPushedHeld`),
  and reverses a documented decision. A Developer design review (Sonnet) was spawned.
- Leg 1 design review (cycle 1, Developer/Sonnet): **approve with changes**. Incorporated:
  - [high] the AC7 throwing-ctx case moved to an exported `zeroizeVaultContexts` helper, tested
    directly (FD ruling: helper over a factory-injection seam);
  - [medium] a new AC7b real-trigger integration unit (real store `lockNow()` locked + store idle
    timer → `onLock` → teardown → real server → session `vaultList` returns `[]`) (FD ruling: make
    it an AC);
  - [medium] the AC10 stale-flag hole: `stop()` zeroizes every ctx BEFORE closing transports,
    plus one `publishHeld()` called after server stop/start/swap (FD ruling: both);
  - [medium] the AC14 item shape (`type: 'item'`) and its JSDoc opts;
  - [medium] the AC16 `position: relative`;
  - [medium] the AC20 Proxy-fallback failure mode made explicit;
  - [low] the indicator-model deepEquals, the AC15 renderer source pin, the AC9 pin scoping, and
    the doc-grep split and judging.

  No second cycle: every change adopts the reviewer's own recommended fix and none alters a
  design decision. Leg status → **ready**. [HANDOFF:review-needed] (design finalized).

## Leg Progress - 01 automation-honors-vault-lock (Developer, 2026-11-05)

**Status**: landed (not committed). AC22 (behavior test) is left to the Flight Director.

**Changes**
- `vault-context.js`: `unlock()` returns `{ unlocked, held }`; new `heldIds()`; `onHeldChange` dep via
  `notifyIfFlipped(wasHeld)` (setKey, zeroize, revalidate-after-loop; try/caught); header bullet rewritten (one-way coupling).
- `mcp-server.js`: `onVaultHeldChange` option threaded into each per-session ctx (try/caught); exported
  `zeroizeVaultContexts(ctxs)`; API gains `zeroizeAllVaultSessions()` and `isVaultHeld()` (from ctx key state);
  `stop()` runs the helper before `sessions.clear()` and the transport closes.
- `vault-lock-teardown.js`: isolated `zeroizeAutomationVaults` step between capture drop and sheets.
- `broadcasts.js`: `broadcastToChromes`. `main.js`: `publishHeld()` + `lastPushedHeld` (push gate only), `onVaultHeldChange`,
  `onLock` passes `zeroizeAutomationVaults: () => mcpServer?.zeroizeAllVaultSessions()`, `publishHeld()` after the
  automationToggle stop wrapper and at the end of `startMcpServerInstance`, bare `vault-automation-held-get` (live), comments updated.
- Chrome: preload + d.ts (2 methods), `buildVaultIndicatorModel` third input, toolbar-vault branch of `pageContextModel`,
  `vault-controller.js` (`automationHeld`/`heldPushed`, subscribe-then-fetch, `renderVaultIndicator()` renders from both stashes,
  `vaultMenuOpts()`), `renderer.js` one-line swap, `styles.css` badge (`::after`, `position: relative`, `var(--accent)`).
- `mcp-tools.js` `vaultUnlock` description; `docs/mcp-automation.md`, `docs/vault.md`, `CLAUDE.md` (2 clauses).
- Tests: vault-context (new held/heldIds/onHeldChange cases; 3 deepEquals gain `held`; old decoupling test renamed/re-scoped,
  section header updated), automation-mcp-server (helper throw-isolation, zeroizeAll x2 sessions, stop(), AC7b real-trigger
  with real store + idle seam), vault-lock-teardown (order/isolation/absent + AC9 pin), broadcasts, vault-indicator-model
  (7 deepEquals updated + new cases), page-context-model, both controller harnesses (fake `getVaultAutomationHeld`; capture
  suite deferred fetch) + 4 new controller cases, new `renderer-vault-menu-opts-pin.test.js` (AC15 pin).

**Gates**: `npm test` 6333 tests / 6329 pass / 0 fail / 4 todo; `typecheck` clean; `lint` clean; `format:check` clean.
`renderer.js` = 1505 lines by `split(/\r?\n/).length` (budget 1505, untouched; line count unchanged by the swap; `SEAM_COUNT` 41).

**Neuter verification (real source mutation, then restored)**
- AC9: deleting the `zeroizeAutomationVaults: () => mcpServer...` line from `main.js` -> `AC9 source pin` fails (1 fail); restored -> passes. AC15 pin still passes.
- AC15: replacing `...vaultController.vaultMenuOpts()` with `vaultLocked: vaultController.isVaultLocked()` in `renderer.js` -> both pin tests fail; restored -> pass.

**Doc greps**: `rg "never empties a live automation|never empties a live MCP|a human \"Lock now\" never"` -> 0 hits after rewrite
(was 1: mcp-automation.md, rewritten). `rg "singleton coupling"` -> 0 hits after rewrite (was: mcp-automation.md, vault.md, 2 test titles
in vault-context.test.js (renamed/re-scoped), main.js ~1620 comment (reworded)). The automation->store direction ("an MCP unlock NEVER
changes the vault-store human lock state" test, main.js ~68-70) remains true and retained.

**Boot check (AC22 part)**: `GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation` booted, printed the mint line, no main-process
startup error (only web-page console noise from restored tabs). Ran under `timeout 40`.

**Deviations/anomalies**: `renderVaultIndicator` lost its `state` parameter (renders from both stashes; all 3 call sites updated).
Controller indicator test uses a new recording fake (the existing fake's `classList.toggle` is a no-op). Admin held flip count: one per ctx.
- Leg 1 AC22 (Flight Director): ran behavior test `vault-mcp-lock-coupling`. Result: **PASS, 10/10**,
  live mode, Sonnet Executor + Validator. Run log:
  `tests/behavior/vault-mcp-lock-coupling/runs/2026-11-06-05-34-20.md`. Run on the throwaway
  `vault-login` fixture profile; the app was stopped afterwards. Spec status → `active`.
  - Proven live: Lock now while locked zeroizes the same session's keys (`vaultList` returns `[]`,
    TOTP `null`, `held: []`) and the session stays connected; a bad key reports
    `held: ["jar-a"]`; the cue sets and clears in under ~0.16 s on unlock, lock, re-unlock and
    teardown; the apparatus sweep is clean; there are no main-process exceptions.
  - The Validator's spec-revision suggestions are recorded in the run log, not applied this
    flight: fold Steps 5–7, make the timeline mandatory, capture the DELETE status.
  - Still HAT-only: the right-click menu, badge pixels, lock from unlocked, and the operator's idle
    auto-lock.
- Flight review (Phase 2d, Reviewer/Sonnet, cycle 1): **[HANDOFF:confirmed]**, no blocking or
  non-blocking issues. The Reviewer's own gates: `npm test` 6333 / 6329 pass / 0 fail / 4 todo;
  typecheck, lint and format:check clean. It checked AC1–AC22 (AC22 from the run log), the
  security invariants (teardown and per-session isolation, stop-zeroizes-first, flip-only
  `onHeldChange`, push-gate-only dedup, chrome-only own channel, live `mcpServer` read, no TDZ, no
  secrets on any surface), and that the AC9/AC15 pins are mutation-guarded. Leg 1 status →
  **completed**. A Developer is spawned to commit (crew protocol); the draft PR follows. The HAT leg
  (`hat-and-alignment`) is next: interactive, guided by the FD with the operator.
- Leg 2 `hat-and-alignment` started (interactive). HAT env: throwaway fixture profile `/tmp/behavior-tests/goldfinch/sortie-07-hat/2026-11-06-05-48-51/`, fixture server on 127.0.0.1:8099, app in dev:automation, FD agent driver (sessions J = Jar A, A = admin).
- HAT H1–H4 PASS (operator). H5 PASS on behavior (menu Lock now cleared the cue, J `vaultList` →
  `[]`), with an operator UX finding: the locked+held state is not self-explanatory. The causes are
  an unexplained dot (hover tooltip just "Vault"), "Lock now" on an already-locked icon reading as
  a no-op, and no feedback.
  - **FD fix-vs-feature call: FIX** (copy/tooltip only, no behavior change; single surface — the
    toolbar vault indicator and its pure menu model; no design review needed).
  - Operator rulings: (a) the menu in locked+held becomes [note "Automation has vault access",
    separator, Unlock now, **End automation access**] with the id unchanged (`action:vault-lock`,
    same global lock); (b) the tooltip (title) shows "Vault locked — automation has vault access"
    while held; (c) NO confirmation toast (the cue clearing is the feedback).
  - Implemented by a Developer (Sonnet): `page-context-model.js`, `vault-controller.js` (title),
    tests, CLAUDE.md, `docs/mcp-automation.md`. Gates: 6333 / 6329 / 0 fail; typecheck, lint and
    format clean. Sheet focus is verified by code: the note is non-`menuitem`, so arrows land only
    on the two items.
  - This amends flight DD6's "Lock now" label for the locked+held state. Pending: by-eye re-check
    after an app relaunch.
- HAT H5 (remaining part) PASS: Unlock now raised the unlock sheet; Escape kept the vault locked
  and the cue on. A mid-step pause of ~37 min let J's own 10-min session idle timer zeroize it
  (expected; the step was redone).
- HAT H6 PASS (idle auto-lock): with `vaultAutoLockMinutes`=1 the operator unlocked at 15:51:31Z
  and the vault had auto-locked by 15:52:52Z. J was empty (`[]` / `held: []`) and showed no cue. J's
  own timer was armed at 15:49:34Z under the 10-min setting and would not have fired before
  ~15:59, so the operator's idle lock is what cut J off.
- HAT H7 PASS: locked + J held, the capture page submit raised the corner "Unlock & save" offer.
  Lock now made the prompt close (`savePromptVisible: false`), saved nothing, cleared the dot and
  locked J out. Accepted behavior; the operator found it reads acceptably.
- HAT H8 PASS after an app relaunch with the copy fix. The tooltip reads "Vault locked —
  automation has vault access", the menu is [note, separator, Unlock now, End automation access]
  with arrows on the two items only, and End automation access cleared the dot and locked J out.
  **Operator sign-off: "looks good".**
- Leg 2 `hat-and-alignment` → **completed**. The flight is landed. HAT env torn down (app, driver,
  fixture server stopped). The HAT copy fix is committed with the HAT artifacts.
- 2026-11-06: Flight debrief written (`flight-debrief.md`). Squawks 0173/0174/0175 logged from its action items. Status → **completed** (operator confirmed).
