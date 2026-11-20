# Squawk 0229: Compromise rotation does not tell the operator which vaults it skipped

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-11-19
**Completed**: 2026-11-19

## Report
Since squawk 0191, compromise rotation re-encrypts every readable vault, leaves an unreadable file untouched on disk, and returns `skipped: [{ id, reason }]` with one log line for each skipped vault (operator ruling 2026-11-19). The list stops in main. `vaultCompromiseRotate` in `main.js` forwards only `recoveryKey` and `revoked`, so the sheet shows a successful rotation with no hint that a vault was left out.

A skipped vault stays under the OLD master key, cannot be opened with the new one, and keeps its access envelopes. Its id is also missing from `revoked.vaultIds`. During a compromise, the operator needs to know this in order to restore that vault from a bundle or delete it. Found in the 2026-11-19 batch review (0190/0191).

## Evidence
- `src/main/main.js`, `vaultCompromiseRotate`: `return { ok: true, recoveryKey: res.recoveryKey, revoked: res.revoked };`
- `src/main/vault/vault-store.js`, `compromiseRotate`: the `skipped` return (squawk 0191).
- `src/main/register-overlay-ipc.js`: the `menu-overlay:vault-compromise` and `-recover` handlers, which stash the result for the recovery-show sheet.
- Scope note: the natural display is the recovery-show sheet (a secret, dismiss-locked card). If the fix has to change that card's protocol rather than add a count line, it fails the squawk gate (security-sensitive surface) and goes to a sortie.

## Corrective Action
Only a COUNT now travels past main; ids and reason codes stay in the store's log. No new channel, message type, dismiss-lock, scrub or token change: one optional field on the existing `vault-recovery-show` payload and init model, plus one `textContent` line on the card.
- `src/main/vault/vault-sheet-errors.js` `compromiseRotateReply(res)` (new, pure): reduces `res.skipped` to `skippedCount`. `src/main/main.js` `vaultCompromiseRotate` returns it instead of the hand-built `{ ok, recoveryKey, revoked }`.
- `src/main/register-overlay-ipc.js` `skippedCountOf` (positive integer or 0): both `menu-overlay:vault-compromise` and `-recover` handlers pass it to `stashCompromiseReveal` and add `skippedCount` to the `vault-recovery-show` send only when above 0 (zero leaves the payload as before).
- `src/main/vault/vault-wiring.js` `stashCompromiseReveal`, `pending-compromise-reveals.js` `stash`, `resurface-compromise-reveal.js`: the count is kept with the pending reveal and re-sent when a reveal resurfaces after a window died.
- `src/renderer/chrome/vault-controller.js` `onVaultRecoveryShow` puts a valid count in the sheet model; `renderer-globals.d.ts` typed.
- `src/shared/vault-recovery-template.js`: `skippedVaultsLine(count)` holds the sentence; the card gains a hidden `skippedLede` line, cleared by `scrub()`. `src/renderer/menu-overlay.js` `renderRecovery` fills it from `model.skippedCount` on every init.

## Verification
(criteria as reported)
- After a rotation that skipped a vault, the operator sees how many vaults were not rotated and that those vaults still open only with the old key.
- The message shows a count and a fixed sentence: no vault content, and no vault ids beyond what the vault page already shows.
- A unit test pins the forwarding through `vaultCompromiseRotate` and the handler.

Run results:
- New `test/unit/vault-compromise-skipped-count.test.js`: 13 tests, all pass (reply helper, both handlers for count/zero/non-integer, store plus resurface, sentence singular/plural/invalid, card line and scrub, three source pins for the main.js return, the sheet render and the chrome forward). `main.js` and `menu-overlay.js` are not loadable under node, hence the source pins; the main.js pin is backed by the behavioural `compromiseRotateReply` test.
- Neuter check: reverted main.js to the hand-built reply, blanked the sheet line, and made `skippedCountOf` return 0: 4 tests failed (handler master and recover, both source pins); restored, all pass.
- Existing vault-compromise-handlers, resurface-compromise-reveal, vault-recovery-template, report-surface tests still pass.
- `npm test`: 7468 tests, 7463 pass, 0 fail (rest skipped). `npm run lint`, `npm run typecheck`, `npm run format:check`: clean.
- Live: not checked. Reaching a skipped vault needs an unreadable `.gfvault` plus a compromise rotation, and the sheet card is unobservable to automation.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the eleventh 2026-11-19 turnaround)
**Verdict**: confirmed, no issues. Only a count leaves main (`compromiseRotateReply` reduces `skipped` to `skippedCount`; the handlers, stash and push accept only a positive integer; no vault id or reason in any payload, log or DOM). The spread into the pending-reveal store and the resurface path is the same reported path: the count must survive a reveal that resurfaces in a new window. The card line is `textContent`-only and `scrub()` clears it. Neuter: forcing the count to 0 fails three tests. Not checked live: a skipped vault needs a hand-corrupted `.gfvault`, and the recovery-show sheet is unobservable to automation. **By-eye check still owed by the operator.** Gates at review: `npm test` 7,485 tests (7,480 pass, 0 fail, 1 skipped, 4 todo); lint, typecheck and format:check clean.
**Commit**: the `squawk: turnaround 2026-11-19` commit on `squawk/turnaround-2026-11-19-k`
