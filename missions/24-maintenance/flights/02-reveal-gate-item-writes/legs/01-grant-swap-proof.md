# Leg: grant-swap-proof

**Status**: completed
**Flight**: [Reveal Gate Covers Vault Item Writes](../flight.md)

## Objective

Prove or disprove, with tests driven through the real IPC handlers and a real vault store, that an admin-scripted `goldfinch://vault` document can (chain 3) read a different item's password under a grant the operator gave for a harmless item, and (chain 2) make the reveal dialog name an item by a title the script just wrote.

## Context

- Flight finding #2 (maintenance report 2026-11-18): this was traced statically and never run. The flight's Adaptation Criteria say: **if the swap does not reproduce, divert** (re-rate to Advisory). This leg is that checkpoint, which is why it is a tests-only leg. The tests are written to assert the CORRECT (fixed) behaviour, so on today's code they FAIL; leg `item-write-grants` makes them pass. Nothing is committed until the flight ends, so failing tests in the working tree are expected between legs.
- Grants: `src/main/reveal-gate.js` — `createDocumentMarks().grant(wcId, key)`, where key = `` `${vaultId}\u0000${itemId}` ``, and `confirm()` returns `'confirmed'` with no dialog when `hasGrant(wcId, key)` holds.
- Reveal path: `src/main/register-vault-ipc.js` — `gatedItemRead('reveal', 'internal-vault-reveal', …)`. The dialog subject is `itemMeta(...).title`, from the store's `listItemsMeta`.
- Ungated writes: `register-vault-ipc.js` — `internal-vault-item-save` (`saveItemPreservingSecrets`), `internal-vault-item-delete` (`deleteItem`), `internal-vault-item-copy` (`copyItem(sourceVaultId, itemId, destVaultId, { resolution, matchId })`).
- `docs/vault.md` *Copying an item to another vault*: a `replace` resolution keeps the destination item's id.

## Inputs

- The harness pieces exist:
  - `test/helpers/reveal-gate-fixture.js` (`makeTestRevealGate({ admin: true })`, which uses a REAL `createDocumentMarks`, a fake dialog answered with `rg.dialogs[i].answer(1)`, and `rg.event(id)`).
  - `test/unit/reveal-gate-registrars.test.js` (`internalEvent(rg, id)` builds an internal-page event that passes `registerInternalHandler` and the gate).
  - The real-store setup in `test/unit/vault-copy-item.test.js` (`vs.load(dir, { scryptParams: FAST_SCRYPT, listJars, now, getAutoLockMinutes })` + `setup({ masterPassword })`).

## Outputs

- New `test/unit/reveal-gate-item-writes.test.js`.
- Flight log entry recording, for each test, whether it FAILS on today's code (reproduced) or PASSES (not reproduced), with the failing assertion's message.

## Acceptance Criteria

- [ ] **Chain 3, the grant swap, driven end to end** through `registerVaultIpc`'s real handlers (`handlers.get('internal-vault-reveal')`, `'internal-vault-item-save'`, `'internal-vault-item-copy'`), with a real `VaultStore` and `makeTestRevealGate({ admin: true })`:
  1. Seed S (a login with password `pw-SECRET`) in the global vault, and B (password `pw-harmless`) in a jar vault.
  2. Reveal B from document 7; the test answers the one dialog with confirm, and the reply is B.
  3. From document 7, re-shape B through `internal-vault-item-save` only as far as needed so that copying S into B's vault collides with B. Read `src/shared/vault-copy-plan.js` / `_copyItem` for the match rule, and use the fewest page-reachable writes.
  4. Copy S into B's vault with `resolution: 'replace'`, `matchId: B.id`.
  5. Reveal B again from document 7.
  - The test asserts the CORRECT behaviour: step 5 raises a NEW dialog (`rg.dialogs.length` grows), and when that dialog is denied the reply is `{ refused: 'not-confirmed' }`, never `pw-SECRET`.
  - It also asserts the precondition that makes the test meaningful: after step 4, `store.revealItem(jarVault, B.id).password === 'pw-SECRET'`. This proves the copy really put S's secret under B's id; the test must fail loudly, not vacuously, if the store behaves differently.
- [ ] **A delete-then-recreate variant** asserts the same "a write drops the grant" rule for `internal-vault-item-delete`: confirm B, delete B, then any later item reachable under B's id (if the store can re-use the id) or B itself must ask again. If ids are never reused, the test documents that and asserts only that a reveal after delete does not return `'confirmed'` from a stale grant (the grant is gone, checked via the gate's marks).
- [ ] **Chain 2, the title spoof**: with `admin: true`, rename item S (title `Bank`) to `Test` through `internal-vault-item-save` from document 7, then request a reveal of S. The test asserts the CORRECT behaviour: the dialog message (`rg.dialogs[0].options.message`) names `Bank`, the title before the automation-time write, and its `detail` says the item was changed while automation was active (exact wording is leg 2's; assert with a case-insensitive `/changed/` match and the `Bank` subject).
- [ ] **Control, behaviour that must NOT change**: with the gate NOT applying (`makeTestRevealGate()` with no admin and no scripted mark), the same save, copy and reveal sequence raises no dialog and returns today's replies byte for byte. This test PASSES today and must stay passing.
- [ ] Each chain-2 and chain-3 test FAILS on the current code, OR the Developer reports `[BLOCKED:not-reproduced]` with the exact reason (which guard prevented it, with `file:symbol`).
- [ ] `npm run lint` and `npm run format:check` are clean for the new file. `npm test` is red ONLY in the new chain-2 and chain-3 tests.

## Verification Steps

- `node --test test/unit/reveal-gate-item-writes.test.js`: the chain 2 and 3 tests fail with assertion messages naming the leak (e.g. "reveal after replace returned pw-SECRET without a dialog"); the control passes.
- `npm test 2>&1 | tail`: failures limited to that file.
- `npx eslint test/unit/reveal-gate-item-writes.test.js && npx prettier --check test/unit/reveal-gate-item-writes.test.js`.

## Implementation Guidance

1. **Build the harness once.**
   - A real store in a temp dir (copy the shape of `mk()` in `vault-copy-item.test.js`: `FAST_SCRYPT`, `listJars` returning one jar, and a fixed clock).
   - `registerVaultIpc({ ipcMain: { handle: (c, fn) => handlers.set(c, fn) }, revealGate: rg.gate, registerInternalHandler, getVaultStore: () => store, jars: { list: () => [...] } })`.
   - Use `internalEvent(rg, 7)` as in `reveal-gate-registrars.test.js`. Copy that small helper rather than importing from another test file.
   - Clean up the temp dir in `t.after`.
2. **Drive the dialog.** Each gated reveal awaits a fake dialog: start the invoke (do not await), `await flush()` (`setImmediate`), assert `rg.dialogs.length`, then `rg.dialogs[n].answer(1)` (confirm) or `answer(0)` (Cancel), and await the reply.
3. **Make each failing assertion's message explicit**, so the flight log can quote it.
4. **Do not change any file under `src/`.** If reproducing the chain needs a write the page cannot make, stop and report `[BLOCKED:not-reproduced]` — that is the divert signal, not a reason to change the source.

## Edge Cases

- **The copy plan matches on a field the page cannot set:** the chain does not reproduce through copy alone. Report which field, and whether an editor save can set it. If even that fails, report `[BLOCKED:not-reproduced]`.
- **`saveItemPreservingSecrets` refuses a re-shape** (e.g. an origin change clears something): note it and try the minimal alternative.
- **The 60 s confirm timeout:** never let a dialog sit; answer every dialog the test raises.

## Files Affected

- `test/unit/reveal-gate-item-writes.test.js` (new).

## Citation Audit

Checked 2026-11-18 against `main` @ 693a3e6:
- `reveal-gate.js` `createDocumentMarks` / `grant` / `hasGrant` and the grant-key format in `confirm`: present.
- `register-vault-ipc.js` `gatedItemRead`, and the `internal-vault-item-save` / `-delete` / `-copy` registrations: present, none calls `revealGate`.
- `vault-store.js` `copyItem` (a gated store op, sync), `deleteItem`, `saveItemPreservingSecrets`: present.
- `test/helpers/reveal-gate-fixture.js` `makeTestRevealGate`: present, with real document marks.
