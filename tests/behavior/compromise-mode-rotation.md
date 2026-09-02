# Behavior Test: Compromise-Mode Rotation — Full Sever and Surfacing

**Slug**: `compromise-mode-rotation`
**Status**: active
**Created**: 2026-09-01
**Last Run**: 2026-09-02-02-22-01

> Finalized 2026-09-01 against the shipped Flight 2 surfaces (leg-4
> handoff). This is a **hybrid witnessed** test (mission constraint): the
> vault sheets are excluded from automation by design, so every sheet
> step is performed and attested by the **operator**; the Executor drives
> only page surfaces and reads only automation-visible observables
> (`sheetVisible`, page DOM, on-disk state). Shipped surface facts: entry
> row "Think a key or your master password leaked?" + danger button
> "Rotate Everything…" (both lock states, bottom of Settings); confirm
> modal per ruling R3; ONE combined credential sheet (menuType
> `vault-compromise`: current + new + confirm, switch link "Use your
> recovery key instead" → `vault-compromise-recover`); recovery reveal
> rides `vault-recovery-show` with `replacing: true`; completion card
> "Everything rotated" (uniform "Revoked" rows); dismiss channel
> `internal-vault-compromise-dismiss`.

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
- **Old-recovery-key provisioning** (run-1 lesson: an original recovery
  key structurally predates the run and can never be captured mid-run):
  perform ONE throwaway rotation before step 1 and record its displayed
  recovery key to the evidence dir as the "old recovery key"; take the
  step-1 baseline snapshots AFTER this throwaway rotation.
- Pre-rotation copies of `manager.json` and every on-disk `.gfvault`
  taken to the evidence directory, **hashes mirrored to a second
  location at capture time** (run-1 lesson: the evidence dir was wiped
  once mid-run) — the "captured old material" for negative assertions.
- Operator present (sheet steps are operator-performed), briefed on the
  run protocol: **keep app focus through step 4** (window blur dismisses
  the credential sheet and destroys the reject-then-accept sequence);
  **read the inline rejection copy aloud verbatim at the moment it
  renders**; **hold the reveal un-acked until the Orchestrator confirms
  the disk capture landed** (explicit ack-gate); **no off-script
  rotations until step 8's probes complete**.

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

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | (Setup) Verify preconditions incl. the throwaway-rotation old-recovery-key provisioning; snapshot `manager.json` + every on-disk `.gfvault` (hashes mirrored to a second location); record minted access-key secret. | (empty) |
| 2 | Executor: read vault page DOM (locked AND unlocked states). | Entry row present in both states at the bottom of Settings ("Think a key or your master password leaked?" + "Rotate Everything…") — lock-state matrix half 1. |
| 3 | Executor: click "Rotate Everything…", read modal DOM. | Confirm modal matches ruled copy (R3): lede, three steps, "Your admin key and all jar access keys will be revoked…", checkbox gating Continue. |
| 4 | Operator (app focus held; Executor's timeline poll already running): check the box, Continue; on the single combined credential sheet enter current password + new password + confirm — trying the OLD password as "new" first and reading the rejection copy aloud verbatim; then the genuine new password, ON THE SAME SHEET INSTANCE (an aborted sheet restarts this row). | Operator attests: reuse rejected inline with the verbatim copy ("Your new master password must be different from your old one."), sheet stays open; then a different new password is accepted and the sheet shows its pending state. Executor's timeline shows `sheetVisible` true continuously across reject and accept. |
| 5 | (Wait point — Executor polls `enumerateWindows` AND stats/hashes `manager.json` + every on-disk `.gfvault` on every ~2s tick, **until `sheetVisible` goes false**, never on a sample-count cutoff.) | `sheetVisible` remains true through the credential→reveal swap (the boolean cannot distinguish the two sheets — the operator's step-6 attestation identifies the reveal); **at least one tick shows the rotation committed on disk (manager rewritten — `version: 2`, new envelope set, no admin slot; every on-disk `.gfvault` mrk envelope + item ciphertext changed) while the sheet is still up and before the Orchestrator-relayed ack** — commit-before-surfacing, mechanically ordered. |
| 6 | Operator: read + record the new recovery key verbatim, **hold un-acked until the Orchestrator confirms the step-5 capture**, then acknowledge the dismiss-locked recovery sheet. | Operator attests: single sheet (no admin sheet follows), dismiss-locked, key shown once. No unlock challenge appears after the rotation credential; the page lands unlocked. |
| 7 | Executor: read the page. | "Everything rotated" completion card present with admin-key row ("Revoked") + one row per revoked vault (display labels) — judged for the entry state(s) this run exercised (the full entry matrix closes via the Variants). A rotation with nothing left to revoke instead renders the card's correct empty state — but a rotation that revoked keys must list them. |
| 8 | Executor (shell): replay captured old material against the rotated profile via the Electron-free store harness — the provisioned old recovery key, old access-key secret (with the snapshot-profile capture-validity control), a well-formed dummy admin key (structural absence probe, with the with-admin-snapshot control), snapshotted old manager/vault files; positives: operator-witnessed lock→unlock with the new master password (Executor observes the transition), and operator-witnessed sheet auth for the new recovery key if exercised (never disclose live secrets to agents). **Profile frozen — no rotations between step 6 and these probes.** | Every captured old credential fails (auth class for keyed probes; the admin probe fails with the no-admin STATE error on the live profile and an auth error on the with-admin snapshot); the new master password unlocks (witnessed transition); the new recovery credential class authenticates where exercised. (Live-session death via `revalidate` is unit-pinned, not re-proven here.) |

## Out of Scope

- Multi-vault restore/adopt surfacing (Flight 3's spec covers it).
- Interruption safety (covered by fault-injection unit tests — not
  reproducible deterministically against the live app).
- Item-content integrity beyond decrypt-success (unit-tested).

## Variants

- **Entry-state matrix**: run 2026-09-02-02-22-01 exercised the
  LOCKED-page entry; a subsequent pass covers the unlocked entry
  (closing checkpoint 7's matrix qualifier).
- **Recovery-branch rotation** (`vault-compromise-recover`: recovery key
  + new master; includes the test-unwrap reuse rejection): witnessed
  off-script in run 2026-09-02-02-22-01 (operator's third rotation —
  reuse correctly rejected, flow completed); should be run on-script for
  full evidence.
