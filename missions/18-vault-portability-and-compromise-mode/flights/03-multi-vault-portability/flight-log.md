# Flight Log: Multi-Vault Portability

**Flight**: [Multi-Vault Portability](flight.md)

## Summary

*(execution not yet started — planning phase)*

---

## Reconnaissance Report

*(Phase 1b, 2026-09-02 — every item the source artifacts treat as
outstanding Flight-3 work, walked against `main` at 5eaec48. Sources:
Flight 2 debrief recommendations/technical items, Flight 1 debrief
recommendation 2, mission Open Questions. Classifications:
`confirmed-live` / `already-satisfied` / `partially-satisfied` /
`needs-human-recheck` / `drifted`.)*

| # | Source item | Classification | Evidence | Recommendation |
|---|-------------|----------------|----------|----------------|
| 1 | v2-bundle AAD unimportability / bundle `managerVersion` field (F2 flight-review finding, carried in summary notes) | **already-satisfied** | Shipped in F2 leg 1 (DD7): export writes `managerVersion` (`vault-store.js:1486`), import validates it (`:1568-1573`) and threads it into both unwraps (`:1625`, `:1630`); comment at `:1562-1566` names the exact fixed failure | Retire — confirm-and-cite only. Note: no v2 `.gfvault` exists (`vault-crypto.js:44` — `VERSION = 1`); AAD version threading is manager-space only |
| 2 | Busy-error collapse on sibling delegates (F2 debrief technical item, annotated on squawk 0058) | **already-satisfied** | Squawk 0058 (PR #200) shipped reason-forwarding on five sheet channels + renderer copy mappers; delegates now map `'busy'` (`main.js:1865-1866`, `:1883-1884`, `:1900-1901`, `:1926-1928`); pinned by `test/unit/vault-sheet-error-copy.test.js` | Retire |
| 3 | Extract main.js vault glue before Flight 3 builds there (F2 debrief rec 1) | **partially-satisfied** | Stores ARE extracted (`pending-imports.js`, `autolock-suppression.js`, `pending-compromise-reveals.js`). Still inline: the error-class→reason ladder at nine main.js delegate sites (`main.js:1119`, `:1757`, `:1798`, `:1834`, `:1865`, `:1883`, `:1900`, `:1926`) with transcribed copies in ≥3 suites, and the `resurfaceCompromiseReveal` composition (`main.js:934`, wired `:2333`) | Remainder is live work; Flight 3 adds a tenth delegate site — schedule the extraction ahead of the restore delegates |
| 4 | Consume `vault-txn` for the restore write (F2 debrief rec 2) | **confirmed-live** | `vault-txn.js:374-383` exports confirmed; sole caller today is compromise rotation (`vault-store.js:1373-1400`, committed-flag idiom) | Design decision needed on granularity: mission rules restore per-vault atomicity with rerun recovery, NOT full transactionality — vault-txn use is per-vault or per-phase, not one profile-wide txn |
| 5 | Per-vault result shape designed at flight level (F2 rec 2 + mission OQ) | **confirmed-live** | `importVault` returns a single `{ imported, fresh, vaultId, ... }` (`vault-store.js:1681-1687`) — no multi-vault shape exists | Flight-level DD |
| 6 | Held-bundle lifetime matrix (F2 rec 2 + mission OQ decrypt-before-mapping) | **confirmed-live** | `_pendingVaultImports` (`main.js:823`, `pending-imports.js`) has NO window-close, lock, timeout, or quit teardown — `releaseVaultHoldsForWindow` (`main.js:1488`) drops adopt keys + suppression holds but not held bundles; held bundle never touches autolock suppression | Flight-level DD; fix the existing window-close leak in the same reshape |
| 7 | Re-derive the one-window reveal argument for the new adopt shape (F2 rec 2) | **confirmed-live** | Adopt still runs F4's two-sheet stash-then-chain: `register-overlay-ipc.js:408-411` (stash + recovery sheet), `:180-185` (admin sheet chained off the ack), `_pendingAdoptAdminKeys` (`main.js:850-868`) | Owned by the DD8 removal leg |
| 8 | DD8: adopt stops minting admin; stash-then-chain removed; 0051 adopt callers deleted (F2 DD8, mission criterion 6) | **confirmed-live** | Code names this flight: `vault-store.js:1664-1666` — "The adopt admin-minting removal is Flight 3 (DD8), not here". Six assertion sites in `vault-export-import.test.js` need rename/invert: `:247-248`, `:268-269`, `:284-289`, `:346-347`, `:353-354`, `:369-373` | Core leg work; inversions per the rename-not-silent-edit rule |
| 9 | Bundle v2 multi-vault | **confirmed-live** | Exactly one gate rejects it: `vault-store.js:1559-1561` (`bundle.version !== BUNDLE_VERSION`); bundle shape single-vault by construction (`:89-95`) | Core leg work |
| 10 | O2 IPC reshape: commit-time destination binding + decrypted-labels leg (F1 rec 2) | **confirmed-live** | Destination bound at PICK time today (`main.js:1049-1052` holds `destinationTarget`); fresh mode is already destination-less — unification deletes modal complexity, as F1 predicted | Core leg work |
| 11 | Unified import/restore = one button/workflow (mission criterion 5, operator-emphatic O2) | **partially-satisfied** (structurally) | Import and restore already share ONE modal, split by `opts.fresh` (`vault.js:644-661`); one entry button per page state (`vault.js:1185`, `:824-829`) | The remaining work is the mapping step + fresh/existing convergence, not a button merge — smaller than the criterion reads |
| 12 | Restore/import joins gated-op list + race pins (F2 rec 2) | **confirmed-live** | Eight gated ops enumerated (`vault-store.js` §; `_enterGatedOp` sites confirmed); `vault-rekey-gate.test.js:6/:81/:84` hard-codes "eight" and enumerates by name | A ninth op updates the suite's wording + enumeration |
| 13 | Blur-dismissal design ruling, then pin (F2 rec 4) | **needs-human-recheck** (a ruling) | Asymmetry confirmed unruled/unpinned: credential sheets die on blur, dismiss-locked reveals survive | Rule at this flight's interview; pin either way |
| 14 | Report generation-identity field (F2 technical item) | **confirmed-live** | Revocation report held main-side with no nonce/timestamp; consecutive reports content-identical | Fold into this flight's vault-state surface work (additive field) |
| 15 | On-script recovery-branch behavior variant (F2 rec 2, spec Variants) | **confirmed-live** | `tests/behavior/compromise-mode-rotation.md:106-110` — witnessed off-script only | Schedule in this flight's behavior/HAT leg |
| 16 | Adopt-chain calibration walk: export→wipe→re-adopt (F1 deferred, "Flight 3 owes this one") | **needs-human-recheck** (operator session) | No run has walked the adopt chain end-to-end since R5/DD8 reshaped it | Owned by the adopt behavior test + HAT |
| 17 | Fresh-adopt jar-creation ordering (mission OQ) | **confirmed-live** | `isSetUp()` = manager file exists (`vault-store.js:807-809`); vault-before-manager invariant doc'd (`:1512-1515`); `jars.add(name, color)` callable directly from main (`jars.js:400-419`) — no IPC round-trip needed | Flight-level DD (N vaults + jar-registry write ordering) |
| 18 | Item-level merge semantics (mission OQ, O3) | **confirmed-live** | No merge machinery exists; existing-profile import is whole-vault replace-with-confirm (`vault-store.js:1696-1711`, `VaultCollisionError`) | Genuine design cluster — likely its own leg, per F1 debrief |
| 19 | Master-sever offer: transient vs persistent (mission OQ, criterion 8) | **confirmed-live** | No offer exists on any adopt path (no `vault-change-master` send there); `changeMasterPassword` hard-requires the old password (`vault-store.js:1000-1002`) — unsatisfiable on a recovery-kind adopt, confirming the mission's pre-named inline adopt-window re-wrap under the live MRK as the viable shape | Flight-level DD |
| 20 | Re-verify vault-store citations by symbol (F2 rec 2) | **already-satisfied** | This recon re-located every citation against `main` at 5eaec48 | Done by this report |

**New findings surfaced by recon** (not in any source artifact):

- **Jar id IS the vault-file basename** (`vault-store.js:463-465`) and
  `jars.add` uniquifies colliding slugs with a `-N` suffix
  (`jars.js:400-419`) — a multi-vault restore that creates jars has a
  real id-reconciliation problem (the bundle's vault id ≠ the created
  jar's id when the slug collides). Needs a DD.
- **Jar identity = name + color only** — there is no icon field
  (`jars.js:8` store shape). The bundle's "jar identity metadata"
  (mission criterion 4) is exactly `{ name, color }`.
- **`_pendingVaultImports` leaks on window destroy** — record retained
  for process lifetime if the owning window closes without modal
  dismissal (`main.js:1488` teardown omits it). Low severity today
  (ciphertext); fix belongs in this flight's held-bundle reshape.

---

## Leg Progress

*(none yet)*

---

## Decisions

*(none yet)*

---

## Deviations

*(none yet)*

---

## Anomalies

*(none yet)*

---

## Session Notes

- 2026-09-02: Flight planning opened post-PR-#200 merge; local `main`
  synced to 5eaec48. Recon report produced before spec drafting.
- 2026-09-02: Operator interview ruled six open questions (merge
  identity = item id; collisions = keep-both-mark-incoming, no picker;
  held bundle drops on lock/close; sever offer = session card; vault
  credential sheets SURVIVE blur — reverses the shipped default;
  separate guided HAT leg). Spec drafted (DD1–DD12) + behavior spec
  `multi-vault-adopt` drafted.
- 2026-09-02: Architect design review cycle 1 — **approve with
  changes**. Highest finding: the draft's new no-step-up sever op fired
  the flight's own hijack-hardening divert trigger at review; DD7
  re-ruled to route the sever card to the EXISTING step-up-carrying
  ops (`changeMasterPassword` / `recoverMasterPassword`) — no new
  crypto surface. Also folded in: DD8's dual-sited blur mechanism
  (main + renderer guard sites, new blur-survival axis, allowlist);
  DD6's expanded inversion list (`vault-manager-v2.test.js:509-569`,
  `:601-646` need structural rework; `window-factory.test.js:301-366`)
  and the adopt-reveal stash/resurface gap; DD3's jar-registry
  fail-soft verify, single-directory vault-txn fact, and restore
  concurrency note; DD2's pinned-shape casualties; DD11 (new):
  renderer.js budget at ceiling, lockstep registries, focus-driven
  access-key refresh. Citation drifts corrected (`:1668-1669`,
  `:1707`). Note: the recon report above retains its original
  pre-drift citations as a snapshot; flight.md carries the corrected
  ones.
- 2026-09-02: Architect design review cycle 2 (delta-scoped) —
  **approve with changes**, no third cycle needed. DD7's re-ruled
  routing verified on all four axes (`secretKind` is a literal
  parameter at `main.js:1081`; both routes sever; card trigger rides
  existing bare-trigger IPC; post-lock covered). Three small gaps
  folded in: DD3's registry-verify step is NEW jars.js surface (named
  as such); DD6's reveal-store reuse obstacles named (baked reason
  string, ack-boolean flow discrimination at `main.js:914-919`); DD8
  allowlist membership ruled — `vault-unlock` in scope (the operator's
  literal scenario; operator may veto at spec walk), with
  `vault-controller-capture.test.js:163`'s `'blur'` case handled under
  the pin rules. Spec walk with operator is next; status stays
  `planning` until operator approval.
- 2026-09-02: Spec walk-through presented (flagging the DD7 re-rule
  cost, the `vault-unlock` blur-allowlist ruling, and the no-picker
  merge shape); operator approved as-is. Flight marked `ready`;
  `/agentic-workflow` invoked, starting with `substrate-prep`.
