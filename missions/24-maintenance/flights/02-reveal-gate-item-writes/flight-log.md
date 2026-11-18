# Flight Log: Reveal Gate Covers Vault Item Writes

**Flight**: [Reveal Gate Covers Vault Item Writes](flight.md)

## Summary

In flight (2026-11-18). Operator rulings recorded in the flight spec. Branch `flight/02-reveal-gate-item-writes`.

---

## Leg Progress

### Leg 01 `grant-swap-proof` - landed (2026-11-18)

Added `test/unit/reveal-gate-item-writes.test.js` (real `registerVaultIpc` handlers, real `VaultStore`, real reveal gate with a fake dialog; no `src/` change). The swap REPRODUCES through page-reachable writes: one `internal-vault-item-save` (re-shape B to S's origin/username, `unchangedSecrets: ['password']`) plus one `internal-vault-item-copy` (`replace`, `matchId: B`). Preconditions asserted and held (copy outcome `replaced`; `store.revealItem('work','B').password === 'pw-SECRET'`).

- chain 3 grant swap: FAILS today (reproduced): "reveal after replace raised no dialog and returned "pw-SECRET" (stale grant) -- 0 !== 1".
- chain 3 delete variant: FAILS today (reproduced): "grant for (work, B) still held by document 7 after the item was deleted -- true !== false".
- chain 2 title spoof: FAILS today (reproduced): 'dialog named the rewritten title instead of "Bank": Show the secrets stored in "Test"?'.
- control (gate not applying): PASSES, no dialog, today's replies.

`npm test`: 7320 pass, 3 fail (exactly the three above). eslint and prettier clean on the new file.

### Leg 02 `item-write-grants` - landed (2026-11-18)

Implemented the note model as specified. `reveal-gate.js`: marks gain `dropGrant` / `noteWrite` / `writeNote` / `clearWriteNote`; the gate gains `itemWritten`, `itemCopied`, `itemDeleted`, `dropAllGrants` (all swallow throws) and `confirm` reads the note after the grant-hit return; `buildOptions` takes it as a third argument; `CHANGED_NOTE` / `CREATED_NOTE` exported. `register-vault-ipc.js`: save (pre-read title via `itemMeta`, post-write call with the returned id), copy (destination id snapshot, id resolved for replaced / copied / kept-both, live title read), delete (`deleted === true`); registration throws when any of the four methods is missing. `main.js`: five dep lines plus one `revealGate.dropAllGrants()` after `restoreProfile` (source-scan pinned). Fixture wired identically. Docs: CLAUDE.md, docs/vault.md, docs/mcp-automation.md.

Tests: item-writes file 8 pass (chain 3 tightened, delete, chain 2 with `CHANGED_NOTE`, chains A and B, control, no-note control, wiring pin); `reveal-gate.test.js` +6; AC17 extended. Full `npm test`: 7332 pass, 0 fail.

Neuter checks (each run, then restored):
- Copy-side call removed: chain 3, chain A, chain B fail (as required: chain 3 and chain B).
- Save-side call removed: chain 2, chain A, chain B fail (chain 2 as required).
- Delete-side call removed: the delete test fails.
- (Extra) `dropAllGrants()` removed from `main.js`: the wiring pin fails.

Deviation to flag: the leg's AC says chain 3's new dialog after the Replace-copy carries `CREATED_NOTE`. The normative table gives that case a STRING note (the destination's live title right after the copy, S's own), and the dialog rule gives a string note `CHANGED_NOTE`. Followed the table: the dialog names S's title with `CHANGED_NOTE`, and the later rename of B still shows S's title with `CHANGED_NOTE`. `CREATED_NOTE` is covered by the gate unit test (null note).

---

### Leg 03 `open-download-ruling` - landed (2026-11-18)

- **Implemented.** `ACTIONS['open-download']` with its own `detail(reason)` (the other actions' detail text is byte-for-byte unchanged, unit-tested). `register-download-ipc.js` `openDownload(event, id, channel)` is async: record checks first (today's `{ ok: false }`, no dialog), then `revealGate.confirm`, proceed on `not-applicable` / `confirmed`, a re-resolve after `confirmed`, `{ ok: false, refused: 'not-confirmed' }` otherwise (`busy: true` for `busy` / interrupted `gone`). No grant. `shell.openPath` stays in the one function, as ONE call site (a first draft had two and flipped the existing pin; restructured). `registerDownloadIpc` throws without a `revealGate`. New Electron-free `reveal-gate-senders.js`; `main.js` spreads it and passes `revealGate` (the only two edits besides the require line). `downloads.js` `runAction` shows `Not opened.` on `res.refused` (grep-asserted; no controller test exists); `renderer-globals.d.ts` `downloadsAction` result typedef gained `refused` / `busy`. The chrome's downloads-controller ignores the reply (unchanged).
- **Pins re-targeted.** (1) `register-download-ipc.test.js` callers pin: from `/return openDownload\(id\);/` x2 to a wrap-insensitive per-channel regex asserting each call site's event, id and channel literal, plus an `openDownload(` total of 3; neuter (rename one caller's channel literal) flips it. (2) `reveal-gate-wiring-invariant.test.js`: `GATED` gained `register-download-ipc.js` `action: 'open-download'`; the registrar-throws list gained `registerDownloadIpc`; a separate `main.js` scan asserts `revealGate` in the `registerDownloadIpc({` call (the generic `[^}]{0,60}` form is too short for that call). (3) New `reveal-gate-senders.test.js` main.js pin (spread present, no inline `windowFor` / `isActive`), neuter-verified by replacing the spread.
- **Pin re-targeted (4).** `reveal-gate-stranding-wiring.test.js`: the `main.js` `isActive:` lambda pin became (a) the `...createGateSenderResolvers(registry)` spread inside the `createRevealGate({` block and (b) the guest active-tab predicate in `reveal-gate-senders.js`; two neuters (remove the spread; replace the predicate with `return true`) both flip a pin.
- **Tests.** Scenarios drive the REAL `open-downloaded-file` handler (chrome-shaped event) and the REAL `internal-downloads-action` handler through a real gate and a real `createRevealGate`: Cancel never opens, Open opens once, no applicability means no dialog and today's reply, no dialog for unknown / in-progress / path-less records, record removed while the dialog is up, busy answer, no grant stored. Senders tests: guest in front / behind, chrome, unknown, throwing registry.
- **Consumers of the shared mechanism (resolver change).** The chrome branch in `windowFor` / `isActive` does not alter any previously gated channel: `internal-vault-reveal`, `internal-vault-totp-code`, `internal-vault-export`, `internal-vault-export-profile`, `internal-jars-cookies-value`, `automation:jar-key-mint`, `automation:admin-key-mint` are all internal-class and `registerInternalHandler` refuses a chrome sender first.
- **Chrome-mark residual recorded** in CLAUDE.md's reveal-gate paragraph (after one admin chrome `evaluate`, every open from that window asks until it closes; fail-safe).
- **Docs.** CLAUDE.md (gated list, definition, Downloads DD9 bullet), `docs/mcp-automation.md` tier section. `docs/dev-testing.md` unchanged.

### Leg 04 `operator-input-predicate` - landed (2026-11-18)

- Added and exported `isOperatorInput(store, wcId)` in `src/main/automation/injected-input.js` (true for no store, or a store answering exactly `false`; false for a non-function, a throw, or any other answer; never throws). `guest-wiring.js` (witness listener, mouse-type filter first) and `reveal-gate.js` `handleRevealInputEvent` (after `isRevealCancelInput`) both call it; no `isInjecting(` call remains in `src/main/**` outside `injected-input.js` (grep AC, also a test). `isJarInjecting` untouched.
- Pins touched: `injected-input-invariant.test.js` witness pin and its "witness gate" mutation entry re-targeted (`assertMutated` kept); new pin for `handleRevealInputEvent` (calls `isOperatorInput`, no `.isInjecting`) with an inline mutation; new no-`isInjecting(` scan. `reveal-gate-stranding-wiring.test.js` does not name `isInjecting`: no change.
- Neuter checks: reverting the witness call to the old inline form fails 3 invariant tests; reverting the reveal-gate call fails 1.
- Tests added: predicate unit test (null, undefined, `{}`, throwing, `1`, `undefined`, `true`, `false`); guest-wiring test that a throwing store does not throw out of the witness listener and feeds nothing to the witness.
- CLAUDE.md: reveal-gate and *Raising the picker* paragraphs now name `isOperatorInput`. Stale comments in `guest-wiring.js` updated.
- Gates: format:check, lint, typecheck green; `npm test` 7350 pass, 0 fail.

### Leg 05 `admin-reach-full-run` - part A done

- Spec `tests/behavior/admin-reach-refusal.md` edited: steps 3, 6, 7 monotonic-clock timing with wall clock informational; step 6 poller keyed on channel AND `decision=timeout` / byte offset; step 8 `__firedAt`/`__settledAt` with a 60-66 s band and skew named as not a failure; step 9 allows the `open-downloaded-file` timeout line; new step 12 (rename then reveal, dialog names the original title plus CHANGED_NOTE) and step 13 (open a downloaded text file, dialog names the file); preconditions and by-eye list updated.
- Squawk 0194 Corrective Action and Verification written; Status left `in-progress`, Sign-Off blank for the Flight Director.
- Part B (live run with the operator) outstanding; leg stays `in-flight`.

## Decisions

## Flight Director Notes

- **2026-11-18, flight start.** Loaded `.flightops/agent-crews/leg-execution.md` (Developer = Sonnet, Reviewer = Sonnet). Flight marked `in-flight`. Branch `flight/02-reveal-gate-item-writes` cut from `main` @ 693a3e6.
- **Interpretation of ruling (A), recorded before leg 2 design.** "Show the title as it was when the grant was made" cannot by itself stop chain 2. In chain 2 the script renames the item BEFORE any grant exists, so there is no grant-time title to show. The faithful form of (A) is: an item written through an internal page while the gate applies keeps a note of its title from BEFORE that write, and its reveal and code dialogs name that title and say the item was changed while automation was active. This keeps the operator's intent (no extra dialogs on writes; the dialog cannot be misled) and closes both chains. It is flagged to the operator at the flight-end hand-off. Leg 1's chain-2 test asserts this form.
- **Leg 1 `grant-swap-proof`, tier: low.** Tests only, no `src/` change. It is a deliberate checkpoint: the flight's divert criterion depends on whether the swap reproduces, so it gets its own leg despite the "no tests-only legs" guideline. Design review skipped.
- **Leg 1 outcome.** The chains reproduced: chain 3 (grant swap), the delete variant, and chain 2 (title spoof) all fail on today's code; the control passes. No divert, and finding #2 stays Action Required.
- **Leg 2 `item-write-grants`, tier: HIGH.** It touches a security-sensitive surface (the reveal gate) and changes a shared interface (new required gate methods; every `registerVaultIpc` caller and the gate fixture are affected). A Developer design review was spawned (cycle 1).
- **Leg 2 design review, cycle 1: approve with changes.** One high issue: "the title before the write" is wrong for a Replace-copy. Medium issues: the other writers were unaudited, the delete-and-recreate path, and the coarse rule for operator writes. The leg was rewritten around a normative note model ("the note names the title belonging to the item's current secrets"), with an audited-writers table and `dropAllGrants()` at the restore commit.
- **Leg 2 design review, cycle 2: approve with changes.** One medium issue: a note must travel with copied secrets, or rename-then-copy launders a spoofed title. Folded in: `itemCopied` propagates the source note for every outcome that writes an item, the new id is resolved by diffing destination ids (no store API change), and the kept-secrets test is simplified. Cycle 2 raised no high issue, so the fixes were applied without a third review (the skill's limit is 2 cycles). Leg marked `ready`.
- **Leg 3 `open-download-ruling`, tier: HIGH.** It is a security surface, and it changes the gate's shared sender resolution (`windowFor` / `isActive` gain a chrome branch). Design review cycle 1: approve with changes, with no high issue. Folded in:
  - the resolvers extracted to a testable module;
  - scenario ACs through the real handlers with a chrome-shaped event;
  - the callers pin re-targeted;
  - the re-check after confirmation promoted to an AC;
  - a refusal notice on the downloads page;
  - the chrome-mark residual recorded.
  No second review: the changes are clarifications and one small extraction, and the flight-end Reviewer covers them.
- **Leg 3 consumers of the shared mechanism** (CLAUDE.md shared-mechanism rule): every channel gated today is an `internal`-class channel. `registerInternalHandler` refuses a chrome sender before the gate runs, so the chrome branch in `windowFor` / `isActive` changes nothing for them. The affected channels:
  - `internal-vault-reveal`
  - `internal-vault-totp-code`
  - `internal-vault-export`
  - `internal-vault-export-profile`
  - `internal-jars-cookies-value`
  - `automation:jar-key-mint`
  - `automation:admin-key-mint`
- **Leg 2 landed. One deviation was accepted by the Flight Director.** The leg's chain-3 acceptance criterion said "carries `CREATED_NOTE`", which contradicted the leg's own normative table: a copy whose source has no note records the destination's live title, a string note, so the dialog shows `CHANGED_NOTE`. The AC was a leftover from before cycle 2. The developer followed the table, which is correct, and the `CREATED_NOTE` wording is exercised by a unit test with a `null` note.
- **Leg 4 `operator-input-predicate`, tier: HIGH** (security surface, although the refactor is small). Design review spawned in parallel with leg 3's implementation. It is read-only and touches different files.
- **Leg 4 design review, cycle 1: approve with changes** (no high issue). Folded in:
  - the predicate is `=== false`, so it fails safe on a non-boolean return;
  - the "not a function" case is recorded as a deliberate tightening. It means a missed cancel, so the dialog waits out its 60 s timeout; it is not a security issue, and the production store is always well-formed;
  - the exact pins to re-target, plus a new reveal-side pin;
  - both CLAUDE.md edit points;
  - the third consumer (`window-factory.js`, through the shared function) and the out-of-scope `isJarInjecting` noted.
  No second review was needed.
- **Leg 5 `admin-reach-full-run`, tier: low for part A** (it edits only a spec and a squawk, no source). Design review skipped; the flight-end Reviewer covers the spec diff. **Part B is an interactive live run**, guided with the operator after the flight commit, as for HAT legs.

- **Flight review (Reviewer, Sonnet): [HANDOFF:confirmed]** on legs 01–04 + leg 05 Part A — npm test 7350 pass / 0 fail, lint/typecheck/format clean; no spoof sequence found. Two non-blocking mislabel residuals (operator copy over a noted item; restore keeps notes) recorded in docs/vault.md. Committed; leg 05 Part B (live run with the operator) outstanding.
