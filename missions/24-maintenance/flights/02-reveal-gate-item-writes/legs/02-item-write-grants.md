# Leg: item-write-grants

**Status**: completed
**Flight**: [Reveal Gate Covers Vault Item Writes](../flight.md)

## Objective

Make an item write drop that item's reveal-gate grants in every document. When an item was written through an internal page while the gate applied, its reveal and code dialogs name the title that belongs to the item's CURRENT secrets, as it was before automation could rename it, and say that the item was changed while automation was active. Together these make leg 1's three failing tests pass (with chain 3 tightened), with no other behaviour change.

## Context

- **Flight Design Decision (A)**, as interpreted in the flight log's Flight Director Notes (2026-11-18):
  - A grant must not outlive a write to its item.
  - The dialog cannot be misled by a title an automation-era write set.
  - Save and copy stay UNGATED: no new dialogs on writes. Delete is not gated.
- **Design review, cycle 1** (flight log): approve with changes. It found that recording "the title before the write" is wrong for a Replace-copy, because the item then holds the copied item's secrets. The model below fixes that. **The note records the title that belongs to the item's current secrets.**
- **Design review, cycle 2**: approve with changes. A note must TRAVEL with copied secrets; otherwise rename-then-copy launders a spoofed title, onto a replaced id or a brand-new copy. Folded in: `itemCopied` carries the source item's note to the destination for every copy outcome that writes an item, and the kept-secrets test is simplified to "the item existed and `unchangedSecrets` is a non-empty array", because the store has validated every name by the time the save returns.
- **Leg 1** (flight log, Leg 01) reproduced all three chains on today's code:
  - Chain 3, the grant swap: one `internal-vault-item-save` re-shapes B to S's origin and username (`unchangedSecrets: ['password']`). Then `internal-vault-item-copy` with `resolution: 'replace', matchId: B` puts S's password under B's id.
  - Delete leaves the grant behind.
  - Chain 2, the title spoof.
- **Where grants live:** `src/main/reveal-gate.js` `createDocumentMarks()` keeps `grants: Map<wcId, Set<key>>`, key = `` `${vaultId}\u0000${itemId}` ``. `clearGrants()` runs on every vault lock (`main.js` `onLock`).
- **How the gate reads them:** `createRevealGate` takes `hasGrant` / `addGrant` / `grantEpoch` as injected deps. These are wired at `main.js` `const revealGate = createRevealGate({` and in `test/helpers/reveal-gate-fixture.js` `makeTestRevealGate`.
- **Dialog text:** built only in `reveal-gate.js` `buildOptions(request, reason)`. The subject goes through `cleanDisplayText`.
- **Secret fields per type:** `src/shared/vault-item-schema.js` `secretFieldsFor(type)`.

## The note model (normative)

Notes are per item key, process-lifetime, and held in the document marks. A note is `{ title: string | null }`. Each write below drops the item's grants first, then updates the note as listed.

| Write | Gate applies? | Note afterwards |
|---|---|---|
| Save of an EXISTING item that KEPT at least one secret field (`unchangedSecrets` is a non-empty array) | yes | the existing note if there is one, else `{ title: <title before this save> }`. The kept secrets keep their pre-automation name. |
| Save of an existing item that kept NO secret field, or a save that creates a new item | yes | `{ title: null }`, overwriting. The secrets are the writer's own, so the live title is shown with a warning. |
| Any copy that writes an item (`replaced` onto the matched id; `copied` / `kept-both` onto the new id) | yes | the SOURCE item's note if it has one, because the secrets carry their note; otherwise `{ title: <the destination's live title right after the copy> }`, which is the source's own title. Overwriting. |
| Any copy that writes an item | no | the SOURCE item's note if it has one (overwriting); otherwise unchanged |
| A save | no | unchanged. An operator write leaves the note as it is. |
| Delete (`deleted === true`) | either | note removed. |

**Dialog**, when `request.grant` is present and a note exists:
- `title` is a non-empty string: the subject is `note.title`, and the detail gains `CHANGED_NOTE` = `This item was changed while automation was active; the name shown is the one its stored secrets had before that change.`
- `title` is `null`: the subject is the live title (`request.subject`), and the detail gains `CREATED_NOTE` = `This item was created or replaced while automation was active.`

Why each case holds:
- **Rename under automation (chain 2):** the secrets are kept, so the dialog shows the pre-rename title.
- **Replace-copy (chain 3):** the copied secrets arrive with their own title, so a later rename cannot hide them; it falls under the "kept a secret" row.
- **Rename S, then copy S anywhere (replace or new):** S's note travels with the secrets, so the destination's dialog names S's pre-rename title.
- **Create, or full secret replacement by script:** the script already knows every secret it wrote, so naming them by the script's title exposes nothing. The warning still shows.
- **Delete then re-create under the same id:** a create, as above.

## Inputs

- Leg 1 landed: `test/unit/reveal-gate-item-writes.test.js` has three failing chain tests and one passing control test.
- Working tree otherwise equal to `main` @ 693a3e6 plus the flight artifacts.

## Outputs

- `src/main/reveal-gate.js`: the marks gain grant-drop and note state; the gate gains `itemWritten`, `itemCopied`, `itemDeleted` and `dropAllGrants`, and uses the note in `buildOptions`.
- `src/main/register-vault-ipc.js`: save, copy (any outcome that writes an item) and delete call the gate after a successful write; registration requires the new gate methods.
- `src/main/main.js`: wiring only. The four new deps go into the `createRevealGate({` block, and one `revealGate.dropAllGrants()` call is added after a successful `restoreProfile` in the import-commit path.
- `test/helpers/reveal-gate-fixture.js`: wires the same deps.
- Tests: `test/unit/reveal-gate.test.js`, `test/unit/reveal-gate-registrars.test.js` (AC17), and `test/unit/reveal-gate-item-writes.test.js`.
- Docs: `CLAUDE.md` (reveal-gate paragraph), `docs/vault.md` (the "Not gated" line and the gate section), `docs/mcp-automation.md` (*What each tier can reach*).

## Acceptance Criteria

- [ ] **Marks.** `createDocumentMarks()` gains:
  - `dropGrant(key)`: removes `key` from EVERY document's set.
  - `noteWrite(key, title, { overwrite })`: records `{ title }` (a string or `null`). With `overwrite: false`, it records only when no note exists.
  - `writeNote(key)`: returns the note or `null`.
  - `clearWriteNote(key)`.
  - Notes survive `clearGrants()`, `onCommit` and `forget`.
  - Unit-tested, including a two-document `dropGrant`, and notes surviving `clearGrants`.
- [ ] **Gate.** `createRevealGate` takes four optional deps (`dropGrant`, `noteWrite`, `writeNote`, `clearWriteNote`) with no-op / `null` defaults, and exposes:
  - `itemWritten(event, { vaultId, itemId, kind, titleBefore })`, where `kind` is `'kept-secrets' | 'new-secrets'` (saves). It drops the grant, then applies the save rows using `applies(event)`; an unreadable state counts as applies.
  - `itemCopied(event, { srcVaultId, srcItemId, destVaultId, destItemId, titleAfter })`: drops the destination's grant, then applies the copy rows.
  - `itemDeleted(vaultId, itemId)`: drops the grant and removes the note.
  - `dropAllGrants()`: delegates to the marks' `clearGrants` through a fifth optional dep `clearAllGrants`.
  - None of these throws: a throwing dep is swallowed.
  - All note logic lives in `reveal-gate.js`; the registrar only gathers ids and titles.
  - Unit-tested for every table row, the gate-not-applying rows, and "earliest kept-secrets title wins across two renames".
- [ ] **Dialog.** In `confirm()`, after the grant-hit early return and before `buildOptions`, `writeNote(grantKey)` is read inside a `try`; a throw means no note. `buildOptions` takes the note as an optional third argument and applies the dialog rule above. `CHANGED_NOTE` and `CREATED_NOTE` are exported constants. There is no new decision value and no change to trace text. Unit tests:
  - the subject and detail for each note shape;
  - a throwing `writeNote` does not change the decision.
- [ ] **Registrar** (`src/main/register-vault-ipc.js`).
  - `itemMeta` does NOT need the item type (cycle 2).
  - Every gate call uses the PAYLOAD `vaultId` (the same string the reveal handler keys grants on). It runs only after `typeof vaultId === 'string'` and a string item id are checked, BEFORE any comparison (CLAUDE.md planning rule). A non-string skips the gate call and the reply is unchanged.
  - **Save:**
    - Before the write, read the stored item's title through the existing `itemMeta` (a `null` or `LOOKUP_FAILED` result means "new item").
    - After `saveItemPreservingSecrets` returns, `kind` is:
      - `'kept-secrets'` when the item existed and `unchangedSecrets` is a non-empty array (the store throws before writing on any invalid name, so a returned save means every listed name was a valid kept secret);
      - `'new-secrets'` otherwise.
    - The id is the RETURNED `saved.id`.
  - **Copy:** with string `sourceVaultId` / `itemId` / `destVaultId`:
    - Read the destination's item ids before the copy (the metadata projection; `copyItem` is synchronous, so there is no interleaving).
    - After a copy whose outcome writes an item, resolve the destination id. For `replaced` it is `matchId` (which must be a string). For `copied` / `kept-both` it is the ONE id present after the copy and absent before; if there is not exactly one, skip the call.
    - Read that item's live title, then call `itemCopied(event, { srcVaultId: sourceVaultId, srcItemId: itemId, destVaultId, destItemId, titleAfter })`.
    - The store API is unchanged.
  - **Delete:** on `deleted === true`, call `revealGate.itemDeleted(vaultId, itemId)`.
  - **Replies:** every reply to the page is byte-for-byte unchanged.
  - **Registration:** `registerVaultIpc` throws at registration when `itemWritten`, `itemCopied`, `itemDeleted` or `dropAllGrants` is not a function (same message style as `revealGate is required`), and the AC17 test is extended.
- [ ] **Restore / import commit.** In `main.js`'s import-commit path (`restoreProfile`, which can overwrite an existing item under the same id via `mergeVaultItems`), a successful restore calls `revealGate.dropAllGrants()` once. This is wiring only, and a source-scan or unit assertion pins it.
- [ ] **Wiring.** `main.js` passes `dropGrant`, `noteWrite`, `writeNote`, `clearWriteNote` and `clearAllGrants` from `documentMarks`. `test/helpers/reveal-gate-fixture.js` wires them identically.
- [ ] **Leg 1's file green and tightened.**
  - All four tests in `test/unit/reveal-gate-item-writes.test.js` pass.
  - Chain 3 is extended: the NEW dialog after the Replace-copy names S's title (the copied secrets' own), not B's, and carries `CREATED_NOTE`. A further rename of B to `Harmless` through save still shows S's title, with `CHANGED_NOTE`.
  - Chain 2 asserts `CHANGED_NOTE` exactly.
  - **New tests (cycle 2), each with a real save followed by a real copy:**
    - Chain A: rename S to `Harmless` (kept secrets), then Replace-copy S over B. B's dialog names S's ORIGINAL title, with `CHANGED_NOTE`.
    - Chain B: rename S to `Bank`, then copy S into another vault as a new item N. N's dialog names S's original title, with `CHANGED_NOTE`.
    - Control: with the gate not applying, copying an un-noted item records no note and raises no dialog.
  - **Neuter-verified, each recorded in the flight log:** removing the copy-side call fails chain 3 and chain B; removing the save-side call fails chain 2; removing the delete-side call fails the delete test.
- [ ] **No regression.** `npm test`, `npm run lint`, `npm run typecheck` and `npm run format:check` are green. `reveal-gate-wiring-invariant.test.js` is unchanged and green: no channel became a confirming channel.
- [ ] **Docs.**
  - CLAUDE.md's reveal-gate paragraph gains one sentence on grant drop and the title note.
  - `docs/vault.md`: the "Not gated" line, plus a short paragraph in the gate section giving the note table and the residuals below.
  - `docs/mcp-automation.md` *What each tier can reach*: a one-line change.

## Verification Steps

- `node --test --test-timeout=60000 test/unit/reveal-gate-item-writes.test.js test/unit/reveal-gate.test.js test/unit/reveal-gate-registrars.test.js test/unit/register-vault-ipc.test.js`
- The three neuter checks above, each run and then restored.
- `timeout 300 npm test && npm run lint && npm run typecheck && npm run format:check`
- `grep -n "itemWritten\|itemCopied\|itemDeleted\|dropAllGrants" src/main/register-vault-ipc.js src/main/main.js`

## Implementation Guidance

1. **`reveal-gate.js`:**
   - Add a `notes` Map and the marks methods.
   - Add one `grantKeyOf(vaultId, itemId)` helper used by `confirm` and the new methods.
   - Add the gate methods, the note lookup in `confirm`, `buildOptions`' third argument, and the two exported constants.
2. **`register-vault-ipc.js`:**
   - Save runs inside synchronous `catchLocked`: do the pre-read and the post-write call inside it.
   - Copy is async: pre-checks, a snapshot of the destination's ids, the copy, resolving the written id, the live-title read, then `itemCopied`.
   - Wrap each gate call in `try {} catch {}` so the reply can never change.
   - Add the registration check.
3. **`main.js`:** the five dep lines and the one `dropAllGrants()` after a successful `restoreProfile`. Change nothing else; Flight 3 extracts this block later.
4. **Fixture, tests and docs.**

## Edge Cases and Audited Writers

- **Locked vault on save or delete:** `{ locked: true }`, no write, no gate call.
- **Copy outcomes other than `replaced`:** no existing id was written, so no gate call.
- **Two documents:** `dropGrant` clears the key in every document.
- **Vault lock:** grants are cleared as before; notes survive by design.
- **Other writers of vault items**, audited by the design review (cycle 1):

| Writer | Reachable by script? | Disposition |
|---|---|---|
| `main.js` import commit → `restoreProfile` / `importVault` (merges by item id, `vault-store.js` `mergeVaultItems`) | No: native file picker + a secret on a chrome-owned sheet | `dropAllGrants()` on success (this leg) |
| `vault/browser-import-flow.js` `importLogins` (replace / merge) | No: native pick + native confirm; new ids are random | Accepted: stale grants name deleted ids only |
| `vault/vault-human.js` capture saves (`saveItem`, `recordConfirmedOrigin`, login rotation) via the chrome's `vault-capture-finalize` | No: operator-consented save prompt on web-page content | Accepted residual: a rotation changes a password to web-page data, not another item's secret |
| `jar-registry-ipc.js` `deleteVault` (jar delete) | Chrome-trust channel | Accepted: the vault is gone; grants for random ids go stale harmlessly |
| MCP vault ops (`vaultUnlock` / `List` / `Totp` / `Fill` / `AnswerAuth`) | — | Write no items |

- **Residuals, recorded in `docs/vault.md`:**
  - An operator write never clears a note, so the warning persists for the rest of the process.
  - The notes Map is unbounded. Each entry is tiny, and a script can only grow it by writing items into the vault itself.
  - A vault page reloaded or re-opened still shows the note, because notes are not per document.

## Files Affected

- `src/main/reveal-gate.js`, `src/main/register-vault-ipc.js`, `src/main/main.js` (wiring + one call).
- `test/helpers/reveal-gate-fixture.js`, `test/unit/reveal-gate.test.js`, `test/unit/reveal-gate-registrars.test.js`, `test/unit/reveal-gate-item-writes.test.js`.
- `CLAUDE.md`, `docs/vault.md`, `docs/mcp-automation.md`.

## Citation Audit

Checked 2026-11-18 against the flight branch (main @ 693a3e6 + leg 1), and re-checked by the cycle-1 design review:
- `reveal-gate.js`: `createDocumentMarks`, `confirm` (the grant key built inline; the grant hit comes before `busy`), `buildOptions(request, reason)`, `applies(event)`.
- `register-vault-ipc.js`: `itemMeta(vaultId, itemId, touch)` returning `{ title } | null | LOOKUP_FAILED`; save / delete via `catchLocked`; copy async through `copyItem(..., { resolution, matchId })` (the replace lands under `plan.matchIds[0]`, which a stale `matchId` cannot reach, `vault-store.js` `_copyItem`).
- `main.js`: the `const revealGate = createRevealGate({` block (~:1592); the import commit's `getVaultStore().restoreProfile(pending.bundle, …)` (~:1527).
- `vault-item-schema.js`: `secretFieldsFor(type)`.
- `docs/vault.md:763` "**Not gated**"; `docs/mcp-automation.md:798` "**Not gated, by design**".
