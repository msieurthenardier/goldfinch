# Flight: Reveal Gate Covers Vault Item Writes

**Status**: landed
**Mission**: [Maintenance](../../mission.md)

## Contributing to Criteria

- [x] A reveal-gate grant covers one item's content, not one item id, and `admin-reach-refusal` passes in full.
- [x] Opening a downloaded program from admin-scripted code has an operator ruling, implemented and documented.

---

## Pre-Flight

### Objective

Restore the reveal gate's stated rule: "a confirmed reveal or code read of `(vaultId, itemId)` covers that item's later reveals and code reads in the same document and nothing else". Today a script evaluated by an admin key in `goldfinch://vault` can get around it. Item save and copy are ungated (deliberately: they return no secret). But a Replace-copy keeps the destination item's id, and grants are keyed by id. So one confirmation of a harmless item lets the script swap in any other login's password and read it with no further dialog. A rename can also make the dialog name a different item. The flight proves the swap with a failing test, closes it, rules on the related "open a downloaded program" gap, and gets the gate's behavior spec passing in full.

Operator rulings 2026-11-18 ("merged, begin"): fix shape (A), open-download (B), F10g left out; this flight flies first.

### Open Questions

- [x] **Fix shape (report decision 4):** → (A), see Design Decisions.
  - (A) Drop an item's grants on any save, Replace-copy or delete, AND show the item's title as it was when the grant was made (or the first reveal began), so a rename cannot mislead the dialog.
  - (B) Drop grants on any write, AND, while `revealGate.applies(event)`, run `confirm` on item-save and item-copy.
  - Delete drops grants under either option and is not gated (it returns no secret).
- [x] **Opening a downloaded program from admin script (report decision 3; finding #3):** → (B), see Design Decisions.
  - (A) Accept it as admin-in-chrome power, like quitting, and document it in `docs/mcp-automation.md` *What each tier can reach*.
  - (B) Reuse the native confirmation before `openDownload` while `applies()` holds.
  - The Security Reviewer advises against stretching the gate's definition. Either way the ruling is recorded.
- [x] **F10g (optional; finding #5):** → left out of this flight and carried as Advisory (not ruled on). `vault-eligible` returns `{ eligible, unlocked }` to web main frames and popups. Decide whether to fix it (drop `unlocked`) in this flight, or accept it formally.

### Design Decisions

**Item writes drop grants; the dialog shows the title as of grant time** (operator, 2026-11-18, option A).
- Every save, Replace-copy and delete of `(vaultId, itemId)` drops that item's grants in every document. Delete stays ungated (it returns no secret).
- The confirmation dialog's subject is the item title captured when its grant was made (or when the first reveal began), so a rename cannot make it name a different item.
- Save and copy stay ungated, as `docs/vault.md` already records.
- Rationale: closes chain (3) (grant swap) and chain (2) (title spoof) without adding dialogs to automation's write paths.
- Trade-off: a write while the gate applies still needs no confirmation. Its effect on secrets is bounded because the next reveal re-asks.

**Opening a downloaded file asks first while the gate applies** (operator, 2026-11-18, option B).
- `openDownload` runs the reveal gate's native confirmation before `shell.openPath` when `revealGate.applies(event)` holds: an admin session active in the window, or the sender's document marked scripted.
- Otherwise (an ordinary operator click) the behavior is unchanged, and DD9 still holds: the operating system's confirmation is the only one for a plain open.
- Rationale: an admin-scripted page must not be able to download and run a program unseen.
- Trade-off: this widens the gate's stated definition (secret-returning, key-minting, bundle-destination) by one "runs a program" case. Record that in `docs/mcp-automation.md` *What each tier can reach* and in CLAUDE.md's reveal-gate paragraph.

**`isOperatorInput` lands here, not as a squawk** (finding #28): the two inline `injectedInput.isInjecting` checks, in `guest-wiring.js` (the click witness) and `reveal-gate.js` (`handleRevealInputEvent`, optional-chained), become one predicate in `automation/injected-input.js`. It touches a security surface, which fails squawk criterion 3, and this flight already owns the reveal gate.

### Prerequisites

- [x] Operator answers the two open questions (2026-11-18).
- [x] Squawk 0194 (`admin-reach-refusal` spec poller and tolerance) completed, or folded in as this flight's first leg.

### Pre-Flight Checklist

- [x] All open questions resolved
- [x] Design decisions documented
- [x] Prerequisites verified (squawk 0194 folds in as leg `admin-reach-full-run`)
- [x] Validation approach defined
- [x] Legs defined

---

## In-Flight

### Technical Approach

- **Finding #2: grant swap and title spoof.**
  - **Evidence:**
    - `src/main/register-vault-ipc.js`: `internal-vault-item-save` and `internal-vault-item-copy` have no `revealGate` call.
    - `src/main/reveal-gate.js`: grants keyed `(wcId document, vaultId + itemId)`; the dialog subject is the item title.
    - `docs/vault.md` *Copying an item to another vault*: Replace keeps the destination id.
    - `docs/vault.md` *What the gate covers*: save and copy are listed "Not gated: none returns a secret", a ruling written before grants existed.
  - **Step 1 is a failing unit test.** Confirm a reveal of B, Replace-copy S over B, then reveal B again: no dialog, and S's password is returned. **If it does not reproduce, divert** (see Adaptation Criteria).
  - **Then the chosen fix shape:**
    - Grant invalidation lives in the gate's per-document store and is called from every item write path: save, copy-Replace, delete, and any store-level write a page can trigger.
    - Add any newly confirming channels to `GATED` in `test/unit/reveal-gate-wiring-invariant.test.js`.
    - Re-word `docs/vault.md`'s "Not gated" line and the tier table in `docs/mcp-automation.md`.
  - Architect: Action Required.
- **Finding #3: open a downloaded program.**
  - **Evidence:** `src/main/register-download-ipc.js`: `openDownload` (the one `shell.openPath` caller) is reached from `open-downloaded-file` (chrome) and the downloads page's `open` action. Neither has a scripted or admin check.
  - **Fix:** implement and document the operator's ruling.
- **Finding #28: one `isOperatorInput` predicate.**
  - **Fix:** `isOperatorInput(wcId, input)` in `injected-input.js`; both consumers call it; the trailing allowance and the real-press/key filter are unchanged.
  - **Pins:** `injected-input-invariant.test.js` and the reveal-gate stranding tests keep passing.
- **Finding #38 (part): `admin-reach-refusal`.** Squawk 0194 (spec poller and tolerance), then one witnessed full run with the operator present to unlock (steps 5, 10, 11 have never passed). Live-run rules: real native dialogs, never click them, `callTool` timeout over 60 s, leave none open.

### Checkpoints

- [x] Grant-swap test written and failing on `main`.
- [x] Fix landed; swap test and title test green; `GATED` updated.
- [x] Open-download ruling implemented and documented.
- [x] `admin-reach-refusal` passes in full (run log committed).

### Adaptation Criteria

**Divert if**:
- The grant-swap test does not reproduce: the trace missed a guard. Re-rate finding #2 to Advisory, reduce the flight to the dialog-subject fix, and consider making it a squawk.
- The fix needs a change to the vault file format or the store's public API: re-plan.

**Acceptable variations**:
- Grant invalidation implemented as a generation counter per item rather than an explicit delete.
- F10g folded in or left out, as the operator rules.

### Legs

> **Note:** These are tentative suggestions, not commitments. Legs are planned and created one at a time as the flight progresses. This list will evolve based on discoveries during implementation.

- [x] `grant-swap-proof` - Failing unit test for the Replace-copy grant swap and the rename-spoofed dialog.
- [x] `item-write-grants` - Grant invalidation on every item write plus the chosen dialog/confirm shape; `GATED`, `docs/vault.md` and `docs/mcp-automation.md` updated.
- [x] `open-download-ruling` - Implement and document the operator's ruling on admin-scripted `openDownload`.
- [x] `operator-input-predicate` - One `isOperatorInput` in `injected-input.js` for the click witness and the reveal gate.
- [x] `admin-reach-full-run` - Squawk 0194, then a witnessed full `admin-reach-refusal` pass.

---

## Post-Flight

### Completion Checklist

- [x] All legs completed
- [ ] Code merged
- [x] Tests passing
- [x] Documentation updated

### Verification

- The grant-swap and title-spoof tests fail when the invalidation call is removed (neuter-verified).
- `reveal-gate-wiring-invariant.test.js` lists the new channels.
- An `admin-reach-refusal` run log shows every step passing.
