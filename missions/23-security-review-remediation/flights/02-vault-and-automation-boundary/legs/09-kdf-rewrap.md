# Leg: kdf-rewrap

**Status**: completed
**Flight**: [Vault and Automation Boundary](../flight.md)

## Objective

A master-password re-wrap never uses key-derivation parameters weaker than the app's own, so tampered or inherited weak parameters cannot outlive the next password change, recovery or rotation.

## Context

- Flight DD6, the half that needs no format change. Mission finding 12 (key-derivation downgrade). Split from `vault-binding` at its design review so that an independent, easily reversed security fix is not held behind a large refactor.
- **The defect.** The master envelope is keyed by the password and `manager.kdf`, so altered parameters make the password fail — the vault does not silently open weaker. The route is: tamper `manager.json`'s `kdf`, wait for the operator to get in by recovery key, and the next master re-wrap reuses the tampered values. Separately, a profile adopted from a bundle made with weak parameters keeps them forever.
- **The three sites that wrap a new master envelope with a fresh password in hand** (`src/main/vault/vault-store.js`): `changeMasterPassword`, `recoverMasterPassword`, `compromiseRotate`. All pass `params: manager.kdf`. The first two assign only `manager.mrk.master` and never write `manager.kdf`; rotation writes `kdf: manager.kdf` into its new manager.
- **Reachability matters for the tests** (design review): `changeMasterPassword` and rotation's master-password branch first step-up-unwrap the **existing** envelope with the stored parameters. A manager whose `kdf` was merely edited fails that step-up, so those two can never reach their re-wrap from a tampered edit — only `recoverMasterPassword` and rotation's recovery branch can. For the other two the weak case is a **genuinely weak** profile: an envelope actually wrapped under weak parameters, as an adopted bundle's would be.
- **The earlier ruling this narrows.** Mission 18, flight 02 (compromise-mode rotation), design review Q2, recorded in a comment at compromise rotation: "PRESERVE manager.kdf — the document's existing params … never the bare SCRYPT_PARAMS constant and never a silent swap of an adopted profile's params." Its rationale, from that flight's log and its leg 03, was consistency with the other rotations and respect for an adopted donor profile's parameters — no cross-device or export requirement. Under this leg: parameters at or above the default are still preserved; only weaker ones are raised, and only where a fresh password is in hand. An adopted profile keeps its donor's parameters at adopt (no fresh password there — the donor's envelope is carried verbatim).
- **A fact about the memory bound** (measured at design review): `validateImportedKdf` accepts `maxmem >= 128 * N * r`, but Node's scrypt needs about `128 * r * (N + p + 2)` and fails at exactly `128 * N * r`. So "the stored `maxmem` fits" must use the real requirement, not the validator's; and a test fixture's `maxmem` must be roomy.
- The store's default is the injected `this.scryptParams` (production N=2^17, r=8, p=2, 192 MiB; tests inject N=2^12, r=8, p=1, 64 MiB — that N is the validator's minimum, so "weaker" in tests is built through `r` or `p`, or by injecting a larger default).
- No in-process cache is keyed on the parameters; later step-ups re-read the manager and pick up the new values.

## Inputs

- Legs 01–08 landed (uncommitted). `vault-store.js` has no uncommitted change from this flight except what leg `vault-lifecycle` added (`idleMs`, the `revealItem` option, the suspended getter) — keep it.
- `test/unit/vault-store-kdf-read-validation.test.js`, `vault-key-rotation.test.js`, `vault-compromise-rotate.test.js`, `vault-export-import.test.js`, `vault-bundle-v2.test.js`.

## Acceptance Criteria

- [ ] **AC1 — One pure helper.** `chooseRewrapKdf(stored, dflt)` returns `stored` **unchanged (same object)** when `stored.algo` is scrypt, each of N, r and p is at least the default's, and `stored.maxmem >= 128 * r * (N + p + 2)` for its own values; otherwise it returns the default set whole. Never a mix of components; never a product comparison. Anything unexpected (missing field, non-number, another `algo`) → the default. Unit table: equal; weaker by N, by r, by p; stronger in all; mixed (one higher, one lower → default); all at or above the default but `maxmem` too small → default; non-scrypt → default.
- [ ] **AC2 — Three sites, envelope and parameters together.** Each site computes the choice as a **local** before wrapping, wraps the new master envelope with it, and — when it differs from the stored value — writes it to `manager.kdf` in the **same** manager write as the new envelope. `manager.kdf` is not mutated in memory before the existing-envelope step-ups and the rotation's reuse probe, which must keep using the stored parameters. In rotation the choice feeds both the wrap and the new manager's `kdf`.
- [ ] **AC3 — The tampered-edit scenario, from its real trigger.** Set up with a default the test can undercut; edit `manager.json`'s `kdf` to weaker-but-valid values with a roomy `maxmem` (for example r=4 against r=8); confirm the master password now fails; unlock by recovery key and call `recoverMasterPassword` with a new password → the persisted `kdf` equals the default, the new password unlocks, the recovery key still works. The same through `compromiseRotate`'s recovery branch.
- [ ] **AC4 — The genuinely-weak scenario.** Build a profile whose master envelope really is wrapped under weak parameters with `manager.kdf` saying so (write the manager with `wrapMaster` at the weak values — what an adopted weak bundle produces; also do it once through the real adopt path from a bundle exported by a store with a weaker default). `changeMasterPassword` → persisted `kdf` equals the default; the new password unlocks. `compromiseRotate` by master password → the same. Immediately after adopt, before any password change, the parameters are still the donor's (pin).
- [ ] **AC5 — Stronger is kept.** Stored parameters stronger than the default survive all three operations unchanged, and the manager's `kdf` object is not rewritten.
- [ ] **AC6 — Nothing else changes.** No floor on read: a manager with weak-but-valid parameters still opens (pin); `validateImportedKdf` is untouched; `rotateRecovery`, `rotateAdminKey` and access-key minting (step-up unwrap only, no master re-wrap) are untouched; exports still carry the manager's current `kdf`, consistent with its envelope. The existing assertions that pin "preserved" stay green as they are — their stored parameters equal their store's default.
- [ ] **AC7 — The ruling is updated in place.** The comment at compromise rotation states the narrowed rule, dated, naming Mission 23 Flight 2 and that it supersedes the Mission 18 ruling in part, with one line on why (a fresh password is the one moment the parameters can be raised without locking anyone out).
- [ ] **AC8 — Docs.** `docs/vault.md` (the key-derivation section): what is raised and when; that a profile adopted from weaker settings is raised at its next password change, recovery or rotation, and unlock then takes the normal time for this version; that there is no floor on read. Record for the Flight Director, in the flight log: the validator's memory bound is looser than scrypt's real requirement (a manager at exactly `128 * N * r` passes validation and then fails to derive) — a candidate squawk, not fixed here.
- [ ] **AC9 — Gates.** `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check` pass.

## Verification Steps

- AC1: a new table test beside the store's kdf tests. AC2–AC6: `vault-store-kdf-read-validation.test.js`, `vault-key-rotation.test.js`, `vault-compromise-rotate.test.js`, `vault-export-import.test.js`.
- AC7, AC8: read by the Flight Director.

## Implementation Guidance

1. The helper and its table.
2. `recoverMasterPassword`, then `changeMasterPassword`, then `compromiseRotate` — each with its scenario test before the next.
3. Comment and docs. Do not commit. Leg `landed`, flight log entry, `[LAND:leg]`.

## Edge Cases

- **`recoverMasterPassword` installs the master key before its wrap awaits** (existing behaviour): a wrap failure leaves the store unlocked with nothing written — unchanged.
- **A re-wrap interrupted between deriving and writing**: the envelope and the parameters are one manager write; the existing generation checks apply.
- **Rotation's interruption matrix** must still pass with the choice in place.
- **A test default equal to the validator's minimum N**: build "weaker" through `r` or `p`, or inject a larger default; never by lowering N below the validator's bound.
- **Anything needing a design call**: `[BLOCKED:<reason>]`.

## Files Affected

- `src/main/vault/vault-store.js` (helper, three sites, comment).
- The test files named above; `docs/vault.md`.

## Citation Audit

Developer design review of `vault-binding` (Sonnet, 2026-11-14), which read these for this purpose: the three re-wrap sites and their step-up order; that `changeMasterPassword` and `recoverMasterPassword` assign only the master envelope; rotation's probe → step-up → wrap sequence; `validateImportedKdf`'s bounds and the measured scrypt memory requirement; the Mission 18 ruling's source (`missions/18-vault-portability-and-compromise-mode/flights/02-compromise-mode-rotation/flight-log.md` and that flight's leg 03); the tests pinning "preserved". Tier: **high** (key hierarchy). No separate pass for this file — it is the reviewed half of `vault-binding` with that review's corrections applied.

---

## Post-Completion Checklist

Completion steps — status transitions, flight-log update, checking off in the parent flight, and commit — are Flight Control protocol, driven by the execution workflow. Not repeated here.
