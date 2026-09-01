# Behavior Test: Compromise-Mode Rotation — Full Sever and Surfacing

**Slug**: `compromise-mode-rotation`
**Status**: draft
**Created**: 2026-09-01
**Last Run**: never

> **DRAFT — authored at Mission 18 Flight 2 planning.** Step details are
> finalized during the flight's behavior-spec leg once the implemented
> surfaces exist; the key observables, apparatus split, and step skeleton
> below are the planning-time contract. This is a **hybrid witnessed**
> test (mission constraint): the vault sheets are excluded from automation
> by design, so every sheet step is performed and attested by the
> **operator**; the Executor drives only page surfaces and reads only
> automation-visible observables.

## Intent

Verifies the mission's "full sever, one action" and "compromise-mode
surfacing" criteria against the real app: one operator action re-keys the
entire vault hierarchy (fresh MRK, fresh vault keys, re-encrypted items,
access envelopes dropped, admin provision removed), the new one-time
recovery key is surfaced exactly once on a dismiss-locked sheet **only
after the durable commit**, the profile stays unlocked through the
acknowledgment, and afterward no previously captured key material opens
anything. Unit and fault-injection tests pin the store; this test pins the
real IPC/sheet/page composition and the on-disk end state — the layer
where F4's debrief showed stubs go stale.

## Preconditions

- Dev app running (`npm run dev:automation`), admin-tier MCP attached
  (`GOLDFINCH_AUTOMATION_ADMIN=1`; keys minted per docs/dev-testing.md).
- Dev vault set up with a known master password; at least two jar vaults
  with items; at least one per-jar automation access key minted (its
  secret captured for the post-rotation negative probe).
- Pre-rotation copies of `manager.json` and one `.gfvault` taken to the
  evidence directory (filesystem apparatus) — the "captured old material"
  for negative assertions.
- Operator present (sheet steps are operator-performed).

## Observables Required

- **browser** — page DOM/screenshots of `goldfinch://vault` (entry row,
  confirm modal, completion card) via the goldfinch-development MCP
  (admin tier; internal-page capture). Sheets are NOT observable here by
  design — sheet presence only via `enumerateWindows` `sheetVisible`.
- **filesystem** — `userData/vaults/manager.json` + `*.gfvault` before
  and after (version, envelope set, byte-diff of item ciphertext) via
  Bash/Read.
- **operator** — witnessed attestation of sheet contents and one-time
  display semantics (dismiss-locked, shown once).
- **shell** — negative probes: replay captured old material against the
  rotated profile via the store's test harness (node script), exit
  codes/errors.

## Steps (skeleton — finalized in-flight)

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | (Setup) Verify preconditions; snapshot `manager.json` + one jar `.gfvault`; record minted access-key secret. | (empty) |
| 2 | Executor: read vault page DOM (locked AND unlocked states). | Entry row present in both states at the bottom of Settings ("Think a key or your master password leaked?" + "Rotate Everything…") — lock-state matrix half 1. |
| 3 | Executor: click "Rotate Everything…", read modal DOM. | Confirm modal matches ruled copy (R3): lede, three steps, "Your admin key and all jar access keys will be revoked…", checkbox gating Continue. |
| 4 | Operator: check the box, Continue; complete the credential sheet (current password + new password + confirm; reuse of old password first). | Operator attests: reuse rejected inline ("must be different"); different password accepted. Executor observes `sheetVisible` true during the step. |
| 5 | (Wait point) | Within timeout: `sheetVisible` transitions to the recovery-show sheet; **filesystem shows the rotation committed** (manager rewritten — `version: 2`, new envelope set, no admin slot; every `.gfvault` mrk envelope + item ciphertext changed) BEFORE the operator acks — commit-before-surfacing. |
| 6 | Operator: read + acknowledge the dismiss-locked recovery sheet (records the new key for step 8). | Operator attests: single sheet (no admin sheet follows), dismiss-locked, key shown once. Profile remained unlocked throughout (no unlock sheet reappears). |
| 7 | Executor: read the page. | "Everything rotated" completion card present with admin-key row ("Revoked") + per-jar rows — regardless of the lock state the flow was entered from (both-entry variant run). |
| 8 | Executor (shell): replay captured old material against the rotated profile via the Electron-free store harness — old recovery key, old access-key secret, snapshotted old manager/vault files; then verify the NEW master password and NEW recovery key unlock. | Every old credential fails (GCM/auth errors); the new master password and new recovery key both unlock. (Live-session death via `revalidate` is unit-pinned, not re-proven here; a live jar-tier attach held across the rotation is an optional variant, not a precondition.) |

## Out of Scope

- Multi-vault restore/adopt surfacing (Flight 3's spec covers it).
- Interruption safety (covered by fault-injection unit tests — not
  reproducible deterministically against the live app).
- Item-content integrity beyond decrypt-success (unit-tested).

## Variants

- Entry from locked state (recovery-key branch: forgot-password path sets
  the new master via the recovery credential) — run once implemented.
