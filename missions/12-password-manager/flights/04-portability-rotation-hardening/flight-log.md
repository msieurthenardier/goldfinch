# Flight Log: Portability + Rotation + Hardening + Docs

**Flight**: [Portability + Rotation + Hardening + Docs](flight.md)

## Summary

Flight 4 of Mission 12 — the crypto-risk cluster split from the original F3 (operator-approved
2026-07-20): per-vault export/import (MRK-bundle format), recovery/master/admin key rotation +
from-scratch admin provision, the registrable-domain PSL fill opt-in, the audit-origin fix, the
jar-delete→vault-removal hook, and the docs/threat-model page.

Status: **completed** — all 7 legs completed; whole-diff flight-end review CLEAN (`[HANDOFF:confirmed]`,
2638 tests / 0 fail, typecheck + lint clean); committed `cf31cc3`; draft PR #111 (stacked on flight/03);
debrief written (`2a981d8`); **operator go/no-go PASSED 2026-07-21 — marked completed.** Executed
leg-by-leg under the pre-approved "design + implement F4."

**Branch**: `flight/04-portability-rotation-hardening`, **stacked on `flight/03-...`** (F1–F3 unmerged;
F4 builds on F3's sheet family + F1's crypto). Rebases onto main as the stack merges.

**Architect design review (1 cycle, approve with changes)** — crypto buildability verified; two novel-leg
DDs corrected: **DD1 → Option A** (B contradicts "export not re-prompted" `mission.md:150` + the
one-recovery-key model; A bundles the manager's mrk envelopes, no step-up, one recovery key);
**DD5 → bundled PSL** (a curated set can't make "never shares across a ccTLD sibling" true — an unlisted
suffix silently leaks; my "exclude platforms" wording was backwards, `trackers.js` correctly *includes*
them; a vendored `.dat` is data-not-a-package → zero-dep). **[HIGH] DD7** — no per-vault "manager row"
exists (`deleteVault` = unlink + evict cached key only). **[MED]** import needs a destination-target
model (global/chosen-jar, refuse-on-collision); **[MED]** recovery/admin *unlock* secret entry routes
through the sheet+Buffer (DD2); **[MED]** the audit fix threads THREE hops (fill return → MCP tool result
→ `deriveAuditDetail(op,args,result)`). Sizing: **one flight** confirmed (only 2 legs carry novel design;
pinning DD1/DD5 now removes the risk concentration; per-leg gates handle the rest). Reviewer-specified →
no second flight-level pass; the per-leg design reviews for legs 1 (export) & 3 (PSL) deeply validate the
revised designs.

---

## Reconnaissance Report

Two code-interrogation sweeps mapped the F4 crypto + hardening substrate against the current tree.

**Portability / rotation crypto:**
- **No export/import exists** (net-new — no store op, IPC, or bridge). Two bundle shapes: **Option A**
  (bundle the manager's `mrk.master`+`mrk.recovery` envelopes + kdf → shares the source MRK,
  whole-manager) vs **Option B** (re-wrap the vault key under fresh master/recovery envelopes at export
  → self-contained per-vault). → **DD1: Option B** (provisional, flagged).
- `changeMasterPassword` **exists but is entirely unwired**; requires unlocked; **no old-password
  verify** → DD3 adds a step-up.
- Recovery rotation, admin rotation, from-scratch admin provision all **net-new**, mirroring
  `changeMasterPassword` (rewrite one `manager.mrk.*` slot). The **admin provision MUST mint anew** —
  F3's setup-minted admin key was discarded (`register-overlay-ipc.js:152`), so the current admin seal
  is orphaned. `unlockWithRecovery`/`unlockWithAdmin` are caller-less (F4 first-wires them).
- **Rotations touch only `manager.json`** — the MRK is never re-keyed, so `.gfvault` files are
  untouched (the MRK-indirection payoff).

**Hardening:**
- **Audit-origin**: `deriveAuditDetail(op, args)` is args-only; the `result` is already computed at the
  call site (`mcp-server.js:451`). Fix = `(op, args, result)` **+ widen `vault-context.fill` to emit the
  resolved `tabOrigin`** (currently not in the return). Audit-log data layer unchanged. **Internal-page
  ops are NOT audited at all** — a new design question (F1 scoped audit to automation), **out of scope
  per DD6**.
- **Registrable-domain**: `trackers.js registrableDomain`/`MULTI_SUFFIX` is the non-PSL curated set —
  **must NOT be reused** (it collapses multi-tenant platforms like `github.io`, dangerous for
  credentials). Fill matches **exact-origin only** at three sites (`vault-context.js:324`,
  `vault-human.js:201`, `vault-store.js:885`). A hardened matcher is a **new module** (curated
  credential-safe set OR bundled PSL `.dat`) → DD5.
- **Jar-delete→vault-removal**: hook into `handleRemove` after `revokeJarKey` (`jar-registry-ipc.js:83`);
  **no `deleteVault` op exists** (net-new — unlink `_vaultPath` + prune the manager row). Jar **wipe
  confirmed to spare the vault**.
- **Docs**: `docs/` exists (no vault doc); `CLAUDE.md` `## Patterns` is the home for a new
  `### Password vault` subsection. `docs/vault.md` (format + threat model) is net-new.

---

## Decisions

### Flight Director Notes — design phase

Designed F4 as the crypto-risk cluster (6 legs). Two genuine design decisions flagged for the
Architect: **DD1** (export bundle Option B vs A) and **DD5** (curated credential-safe matcher vs a
bundled PSL). One deliberate scope call: **DD6** keeps audit work to the mission's Known Issue #2 (the
MCP fill-origin) and holds internal-page-op auditing OUT (a new idea from the F3 debrief, not a mission
item) — surfaced, not silently expanded. F4 spans four domains (portability / rotation / hardening /
docs) but most is wiring on F1's existing crypto ops; the security-novel work is concentrated in leg 1
(bundle format) and leg 3 (matcher), each getting its own per-leg design-review gate. Sizing to be
confirmed at the Architect review (if it recommends a split, surface to the operator).

---

## Session Notes

- **2026-07-21** — F4 spec drafted (DD1–DD8, 6 legs). Architect design review pending.

## Leg Progress

### export-import
**Status**: landed
**Risk tier**: **HIGH** — the export bundle format + the two import modes (fresh-profile adopt-manager vs existing-profile re-key) + fresh-profile install + the import unlock sheet. Runs the per-leg design review.

**Design review cycle 1 (NEEDS REWORK → reworked)** — two HIGH crypto bugs in the guidance, both on the
riskiest paths, both fixed: **[HIGH]** the fresh-profile adopt wrote `manager.json` with only
`mrk.{master,recovery}`, but `_readManager` requires all three slots → the profile wedges at boot → the
bundle now carries all three mrk envelopes (`mrk.admin` is ciphertext, no plaintext, + preserves admin
portability; a DD1 flight-level correction); **[HIGH]** the recovery branch passed a Buffer to
`parseRecoveryKey` (throws on non-string) → `parseRecoveryKey(secret.toString('utf8'))` (master stays
Buffer — the flagged asymmetry). Plus **[MED]** explicit `MANAGER_VERSION` on the manager-envelope
unwraps; evict the destination cached key on re-key; write the vault file before manager.json (never flip
`isSetUp()` true without a vault); `_installMrk` on fresh-import (leave unlocked, like setup); `decryptItems`
provenance; export stays fully main-side (page can't write files). The two-mode model was affirmed correct.
Running a focused cycle-2 confirmation pass (HIGH crypto + needs-rework verdict).

**Design review cycle 2 (APPROVE)** — confirmed both HIGH bugs resolved (all-three-mrk bundle valid
against `_readManager`; recovery-string vs master-Buffer asymmetry correct), version spaces match, write
order + `_installMrk` + cache-eviction + main-side export all correct; no new crypto error. Folded three
non-blocking items: allowlist-`resolveTarget` the destination on the existing path (defense-in-depth on a
write path); zeroize the transient recovery material; adopt stamps `format`/`version`. Status → ready.

**Implementation (landed) — 2026-07-21.** All ACs met; the reworked crypto guidance implemented exactly.

#### Changes Made (files, one line each)
- `src/main/vault/vault-store.js` — `exportVault(target)` (bundle: all-three-mrk + kdf + adminPub + `.gfvault`, ciphertext-only, no password/write) + `async importVault(bundle, {destinationTarget, secret, secretKind, overwrite})` (all crypto before any write; fresh→adopt-manager+`_installMrk`; existing→re-key under dest MRK + collision refuse + cache evict); `BUNDLE_FORMAT`/`BUNDLE_VERSION` constants + exports.
- `src/shared/vault-import-template.js` — NEW pure DOM builder for the `vault-import-unlock` sheet (secretKind master|recovery radios + secret field + aria-live error + Import/Cancel).
- `src/renderer/menu-overlay.js` — wire the `vault-import` template (TWELFTH kind): register entry, submit → `menuOverlay.importVault({token, secret:Uint8Array, secretKind})`, attachModalCard, TEMPLATES/NODE_OF_ENTRY/init dispatch.
- `src/renderer/menu-overlay.css` + `src/renderer/pages/vault.css` — sheet + page import styles (mirror vault-stepup / autolock).
- `src/preload/menu-overlay-preload.js` (+ `menu-overlay-globals.d.ts`) — `importVault` sheet channel.
- `src/main/register-overlay-ipc.js` — `menu-overlay:vault-import` handler (sender/token gate, Buffer copy, DUAL-zeroize, VaultAuthError→`{ok:false}`; gated on `vaultImport`).
- `src/main/register-vault-ipc.js` — `internal-vault-export` (build bundle + `vaultSaveBundle` delegate; VaultLockedError→`{locked:true}`; gated).
- `src/main/register-browser-ipc.js` — `internal-vault-request-import` trigger (awaits `vaultImportBegin`, forwards bare `vault-request-import` on `{ok}`; gated).
- `src/main/main.js` — `_pendingVaultImport` held state + `vaultSaveBundleToFile` (save dialog + write) / `vaultImportBeginFromFile` (open dialog + read + hold) / `vaultImportFromSheet` delegates; wired into the three registrars.
- `src/preload/internal-preload.js` (+ chrome-preload.js, renderer-globals.d.ts) — page `exportVault`/`requestImport` + chrome `onVaultRequestImport` + types.
- `src/renderer/renderer.js` — `vault-import-unlock` overlay state + `onVaultRequestImport`→open sheet + `openVaultImportUnlockOverlayForAudit` seam entry.
- `src/renderer/pages/vault.js` — per-vault **Export…** button + an **Import a vault bundle** section (destination select + Import…). `textContent`-only.
- `scripts/a11y-audit.mjs` — `sheet-vault-import` in SHEET_NODE_IDS + `sheet:vault-import-unlock` SHEET_STATE.
- Tests: `vault-export-import.test.js` (store: export shape/ciphertext/locked; fresh-import adopt + unlock by master AND recovery + wrong-secret-nothing-installed; existing re-key + collision + unknown-target + wrong-secret-no-write + recovery path), `vault-import-handler.test.js` (sheet Buffer channel: dual-zeroize, sender/token, secretKind, no follow-up send), `vault-import-template.test.js` (aria/DOM), extended `vault-request-triggers.test.js` (+import trigger) + `register-vault-ipc.test.js` (+export handler); `seam-contract.test.js` SEAM_COUNT 23→24 (leg-authorized audit-hook, F3 precedent).

#### Results
- New/changed suites green; **full `npm test`: 2548 pass / 0 fail** (was 2547 pre-leg; +6 new suites net rolled in). `npm run typecheck` clean; `npm run lint` clean.

#### Deviations
- **Import request-trigger placed in `register-browser-ipc.js`, not `register-vault-ipc.js`** (the leg's Files Affected named the latter). Reason: register-vault-ipc has no `chromeForTab`/registry; the setup/unlock/mint cross-renderer triggers already live in register-browser-ipc for exactly that reason. Export stayed in register-vault-ipc as specified.
- **Fresh-profile import writes the adopted vault to `GLOBAL_ID`** (not the caller's `destinationTarget`). Reason: a jar-less fresh profile can only resolve `global`; this is the guaranteed-reachable portability target (DD1 edge-case: a source jar vault lands re-keyed at the destination, which on a fresh profile is global). The existing-profile path honors `destinationTarget` via `resolveTarget`.
- **Bundle held main-side** (`_pendingVaultImport`) between the page's file-open step and the sheet's secret step — the sandboxed internal page can't read files, so main owns the dialog + the ciphertext bundle; the sheet only carries the secret + secretKind. Dismiss-without-submit leaves a stale ciphertext-only record until the next import overwrites it (low risk; not cleared on sheet dismiss — a candidate hardening if desired).

#### Notes for the next legs (rotation etc.)
- **`vault-import-unlock` is the TWELFTH sheet kind** — the same modal-card / `report`-token / dual-zeroize Buffer-channel idiom as vault-set/stepup. Rotation sheets (recovery/master/admin) should mirror this shape. A `secretKind` radio toggle on one sheet is now a proven pattern.
- **Store op shapes the rotation legs build on**: `exportVault(target)` (unlock-window, no-password, ciphertext bundle) is reused by leg 5's jar-delete offer-export-first. `importVault` is `async`, does ALL crypto before ANY write, and returns `{ imported, fresh, vaultId }`. The MRK is never re-keyed anywhere — rotations rewrite only `manager.json`, so no `.gfvault` is touched (unchanged by this leg).
- **Cross-renderer request idiom** extended: `internal-vault-request-import` awaits a main-side file step BEFORE forwarding the bare chrome trigger (distinct from setup/mint which forward immediately) — a template for any future page-flow needing a main-side gate before the sheet opens.
- **Seam pin now 24** (`seam-contract.test.js` + CLAUDE.md) — any further audit-hook additions bump both.

### key-rotation
**Status**: ready → implementing
**Risk tier**: **HIGH** — durable-credential crypto: recovery/master/admin rotation + from-scratch admin provision + the recover-after-forgotten-master flow (each a step-up + a manager.mrk-slot rewrite). Runs the per-leg design review.

**Design review (1 cycle, approve with changes)** — crypto/step-up design sound (mirrors `mintAccessKey`).
**[HIGH]** the recover-after-forgotten-master flow must NOT be an `authenticated:true` flag on
`changeMasterPassword` (a step-up bypass — a transiently-unlocked session would skip the old-pw check),
nor a two-call `recoverUnlock`+`change` (same hole) → a **single `recoverMasterPassword({recoveryDisplay,
newMasterPassword})`** op where the recovery key IS the step-up (`unwrapRecovery` before any write).
**[MED] Split admin rotation/provision into its own leg** (`admin-key-provision`, F4 now 7 legs) — distinct
secret/crypto, independently testable, bounds this HIGH leg's blast radius (F2/F3 precedent). **[MED]**
citation drift (`mintAccessKey` step-up `:1119-1128`, not `:944`; `changeMasterPassword` `:548`). **[LOW]**
master-change + recover are NEW multi-field sheet templates (not simple reuse); Buffer|string guard
(mirror setup); renderer-side confirm check; assert old-secret-fails; recover ends unlocked; display-after-write.
Reviewer-specified → no second cycle; flight-end whole-diff review backstops.

**Implementation (landed) — 2026-07-21.** All ACs met; scope = recovery rotation + master change + recover
(admin split to `admin-key-provision`, NOT implemented here). Each op is a constant-size `manager.json`
rewrite (the MRK is never re-keyed → `.gfvault` files byte-untouched); each mirrors the `mintAccessKey`
step-up (re-unwrap the master envelope, throw `VaultAuthError` BEFORE any write).

#### Changes Made (files, one line each)
- `src/main/vault/vault-store.js` — `async rotateRecovery({masterPassword})` (master step-up → `generateRecoveryKey` → rewrap ONLY `mrk.recovery` → write → return display); EXTENDED `changeMasterPassword({oldMasterPassword,newMasterPassword})` with the **old-password step-up** + a `Buffer|string` guard (new `isNonEmptySecret` helper, mirrors `setup`); `async recoverMasterPassword({recoveryDisplay,newMasterPassword})` — single dedicated op (recovery key IS the step-up → `_installMrk` (ends UNLOCKED) → rewrap ONLY `mrk.master`), works FROM LOCKED.
- `src/shared/vault-change-master-template.js` — NEW pure DOM builder (`vault-change-master`: old + new + confirm password fields + aria-live error + Change/Cancel).
- `src/shared/vault-recover-template.js` — NEW pure DOM builder (`vault-recover`: recovery-key + new + confirm fields + error + Recover/Cancel).
- `src/shared/vault-stepup-template.js` — expose the `lede` ref so the sheet can be REUSED for recovery rotation's master-pw step-up (re-labeled at runtime; build-time default unchanged).
- `src/renderer/menu-overlay.js` — reuse vault-stepup for `mode:'rotate-recovery'` (branch submit → `rotateRecovery` channel, re-label lede/submit in `renderStepup`); wire the two NEW sheets (THIRTEENTH/FOURTEENTH kinds): register entries, submit → `menuOverlay.changeMaster`/`recoverMaster` (TWO Uint8Array secrets each, dual-zeroized; renderer-side confirm===new), attachModalCard, TEMPLATES/NODE_OF_ENTRY/init dispatch.
- `src/main/register-overlay-ipc.js` — `menu-overlay:vault-rotate-recovery` (single secret → open `vault-recovery-show` with the NEW key post-write), `:vault-change-master` + `:vault-recover` (TWO secrets each; sender/token gate; Buffer copies; DUAL-zeroize BOTH arrays + BOTH copies; `VaultAuthError`→`{ok:false}`); all three gated on their delegate injection.
- `src/main/main.js` — `vaultRotateRecovery`/`vaultChangeMaster`/`vaultRecover` delegates (VaultAuthError→`{ok:false}`; recover decodes recovery Buffer→string + broadcasts lock-state on the locked→unlocked transition); wired into `registerOverlayIpc`.
- `src/main/register-browser-ipc.js` — `internal-vault-request-rotate-recovery`/`-change-master`/`-recover` BARE triggers (no secret; `chromeForTab`).
- `src/preload/menu-overlay-preload.js` (+ `menu-overlay-globals.d.ts`) — `rotateRecovery`/`changeMaster`/`recoverMaster` sheet channels.
- `src/preload/chrome-preload.js` (+ `renderer-globals.d.ts`) — `onVaultRequestRotateRecovery`/`-ChangeMaster`/`-Recover` (the NEW recovery key reuses the existing `onVaultRecoveryShow`).
- `src/preload/internal-preload.js` (+ `renderer-globals.d.ts`) — page `requestRotateRecovery`/`requestChangeMaster`/`requestRecover`.
- `src/renderer/renderer.js` — `vault-change-master`/`vault-recover` overlay states; `onVaultRequest*`→open sheet (rotate-recovery → vault-stepup `{mode:'rotate-recovery'}`); `openVaultChangeMasterOverlayForAudit`/`openVaultRecoverOverlayForAudit` seam entries.
- `src/renderer/pages/vault.js` (+ `vault.css`) — unlocked **Master password & recovery key** section (Change master password / Rotate recovery key); locked-view **Forgot master password? Recover** affordance (reachable from LOCKED). `textContent`-only, NO secret in the page.
- `src/renderer/menu-overlay.css` — `vault-change-master`/`vault-recover` sheet styles (mirror vault-set/stepup).
- `scripts/a11y-audit.mjs` — `sheet-vault-change-master`/`sheet-vault-recover` in SHEET_NODE_IDS + the two SHEET_STATES (both dismissible/Escape-ok).
- Tests: `vault-key-rotation.test.js` (NEW — per-op slot-scoped rewrite + other-slots/`.gfvault` byte-unchanged; new-secret-unlocks/old-fails; wrong step-up → nothing written; recover from LOCKED → unlocked + new master, wrong recovery → nothing written/stays locked; Buffer old+new); `vault-rotation-handlers.test.js` (NEW — the three sheet Buffer channels: dual-zeroize BOTH arrays, sender/token, rotate-recovery opens recovery-show with the new key ONLY); extended `vault-request-triggers.test.js` (+3 triggers), `register-browser-ipc.test.js` (channel inventory +3), `seam-contract.test.js` (SEAM_COUNT 24→26 + CLAUDE.md), `vault-store.test.js` (the existing forgotten-master test rewritten to `recoverMasterPassword` — the intentional contract change: `changeMasterPassword` now REQUIRES the old password).

#### Results
- New/changed suites green with `--test-timeout=60000`; **full `npm test`: 2572 pass / 0 fail** (was 2548 pre-leg; +2 new suites + extensions rolled in). `npm run typecheck` clean; `npm run lint` clean. Grep AC verified: the rotation secrets ride ONLY the `menu-overlay:*` Buffer channels (dual-zeroized); the `internal-vault-request-*` triggers are BARE; no secret in the page DOM.

#### Deviations
- **`changeMasterPassword` contract change (intentional).** The old-pw step-up is a new REQUIRED arg. The one existing caller (`vault-store.test.js`'s forgotten-master test) was `unlockWithRecovery` + `changeMasterPassword` — semantically the recover flow, so it was rewritten to the new `recoverMasterPassword` op (preserving + strengthening every assertion: ends unlocked, items untouched, new master unlocks, old fails). Not a weakening.
- **Rotate-recovery reuses the `vault-stepup` sheet** (per the leg) rather than a new template — branched on a `mode` in the init model; the lede/submit are re-labeled at runtime and the submit routes to `menu-overlay:vault-rotate-recovery`. The vault-stepup template gained only a `lede` ref (build-time default and its test unchanged).
- **Recover affordance placed on the LOCKED view** (next to Unlock), change-master + rotate-recovery on the UNLOCKED rotation section — the logical split: recover is the forgotten-master path (reachable from locked; the op needs no MRK), the other two require unlocked.

#### Notes for `admin-key-provision` (the split-out next leg)
- **Mirror these exact patterns.** Step-up: re-unwrap the relevant envelope BEFORE any write, throw `VaultAuthError`, `.fill(0)` the transient (the `mintAccessKey`/rotateRecovery shape). One-time display: reuse the dismiss-locked show-sheet, opened AFTER the store op returns (post-write ordering) — admin provision needs a `vault-adminkey-show` sheet analogous to `vault-recovery-show`.
- **Sheet Buffer channel:** the `menu-overlay:vault-rotate-recovery` handler is the closest template for a single-secret step-up that drives a post-write one-time display; `:vault-change-master`/`:vault-recover` show the TWO-secret dual-zeroize shape if admin provision needs a second field. All gated on their delegate injection.
- **Cross-renderer trigger idiom:** `internal-vault-request-*` (bare) → `chromeForTab` → `onVaultRequest*` → `openOverlayMenu`. The vault-stepup sheet is now multi-mode (`mint` | `rotate-recovery`) — admin rotation could add another mode or its own sheet.
- **`recoverMasterPassword` proves the from-LOCKED op shape** (no `_requireMrk`; the secret is its own step-up + installs the MRK) if any admin path must work while locked. `manager.mrk.admin` is the slot to rewrap (re-seal to the new admin pubkey + overwrite `adminPublicKeyB64`); the MRK stays un-re-keyed so `.gfvault` files remain untouched.

### admin-key-provision
**Status**: ready → implementing
**Risk tier**: **HIGH** — durable admin X25519 credential (mint-anew provision + re-seal). Mirrors leg-2 rotateRecovery; a focused design review (the sealToAdmin reseal + dual mrk.admin/adminPublicKeyB64 update + openAllWithAdminKey round-trip + old-key invalidation).

**Design review (1 cycle, APPROVE)** — the crypto design + the leg-2 mirror are faithful/correct: both
`mrk.admin` AND `adminPublicKeyB64` overwritten (else a stale pubkey corrupts export); the
`openAllWithAdminKey` round-trip is genuine crypto invalidation (new opens, old GCM-fails); provision
correctly mints anew (F3's setup admin key confirmed discarded); step-up ordering mirrors the landed
`rotateRecovery`; re-seal touches only `manager.json` (`.gfvault` byte-untouched). Only LOW citation fixes
(`openAllWithAdminKey` `:1278`, `openAdminSeal` `vault-crypto.js:469`, `unlockWithAdmin` `:518`) + a
test-strengthening suggestion (assert `openAllWithAdminKey` opens ALL vaults with the new key). No cycle 2.

**Implementation (landed) — 2026-07-21.** All ACs met. `rotateAdminKey` is a constant-size
`manager.json` rewrite (the MRK is never re-keyed → `.gfvault` files byte-untouched); it mirrors the
landed `rotateRecovery` EXACTLY (master step-up: re-unwrap `mrk.master`, `VaultAuthError` BEFORE any
write, zeroize the transient) → `generateAdminKeypair` → re-seal ONLY `mrk.admin` to the new pubkey +
overwrite `adminPublicKeyB64` (BOTH) → write → return the one-time private key. Rotation AND the
from-scratch provision are the SAME op (mints anew unconditionally — F3's setup admin key was discarded).

#### Changes Made (files, one line each)
- `src/main/vault/vault-store.js` — `async rotateAdminKey({masterPassword})` (master step-up → `generateAdminKeypair` → re-seal ONLY `mrk.admin` via `sealToAdmin(this.mrk, admin.publicKey)` + overwrite `adminPublicKeyB64` → write → return `privateKeyB64`; `Buffer|string` via `isNonEmptySecret`).
- `src/shared/vault-adminkey-template.js` — NEW pure DOM builder (`vault-adminkey-show`: read-only one-time admin-private-key display + Copy + acknowledge; mirrors `vault-accesskey-show`, single secret, no keyId).
- `src/renderer/menu-overlay.js` — reuse vault-stepup for `mode:'rotate-admin'` (submit → `rotateAdminKey` channel; re-label lede/submit in `renderStepup`); wire the NEW dismiss-locked `vault-adminkey-show` sheet (FIFTEENTH kind): entry (`dismissible:false`), Copy/acknowledge, attachModalCard, TEMPLATES/NODE_OF_ENTRY/modelShapeOk/init dispatch, `renderAdminKey`.
- `src/renderer/menu-overlay.css` — `#sheet-vault-adminkey` + `.vault-adminkey-*` styles (mirror vault-accesskey).
- `src/main/register-overlay-ipc.js` — `menu-overlay:vault-rotate-admin` handler (single secret; sender/token gate; Buffer copy; DUAL-zeroize array + copy; `VaultAuthError`→`{ok:false}`; drives `vault-adminkey-show` with the NEW key post-write); gated on the `vaultRotateAdminKey` injection.
- `src/main/main.js` — `vaultRotateAdminKey` delegate (`VaultAuthError`→`{ok:false}`; returns `{ok, adminPrivateKeyB64}`); wired into `registerOverlayIpc`.
- `src/main/register-browser-ipc.js` — `internal-vault-request-rotate-admin` BARE trigger (no secret; `chromeForTab`).
- `src/preload/menu-overlay-preload.js` (+ `menu-overlay-globals.d.ts`) — `rotateAdminKey` sheet channel.
- `src/preload/chrome-preload.js` (+ `renderer-globals.d.ts`) — `onVaultRequestRotateAdmin` (bare) + `onVaultAdminKeyShow` (the new one-time key, main→chrome→sheet).
- `src/preload/internal-preload.js` (+ `renderer-globals.d.ts`) — page `requestRotateAdmin`.
- `src/renderer/renderer.js` — `vault-adminkey-show` overlay state; `onVaultRequestRotateAdmin`→open vault-stepup `{mode:'rotate-admin'}`; `onVaultAdminKeyShow`→open dismiss-locked adminkey-show; `openVaultAdminKeyShowOverlayForAudit` seam entry; the `vault-adminkey-show` activated no-op case.
- `src/renderer/pages/vault.js` — "Provision / rotate admin key" action in the leg-2 rotation section (→ `bridge.requestRotateAdmin()`). `textContent`-only, NO secret in the page.
- `scripts/a11y-audit.mjs` — `sheet-vault-adminkey` in SHEET_NODE_IDS + the SHEET_DISMISS_EXPR dismiss-locked branch + the `sheet:vault-adminkey-show` SHEET_STATES entry.
- Tests: `vault-admin-key-provision.test.js` (NEW — slot-scoped rewrite + other-slots/`.gfvault` byte-unchanged; new key opens the seal + ALL vaults global+jar via `openAllWithAdminKey`/`readVaultItems`; OLD key GCM-fails = invalidation; from-scratch/orphaned-seal provision yields a usable key; wrong step-up → nothing written; Buffer master; from-LOCKED → VaultLockedError; empty pw → VaultStateError); `vault-admin-key-handlers.test.js` (NEW — the `vault-rotate-admin` Buffer channel: dual-zeroize array+copy, sender/token, adminkey-show opened with the new key ONLY).
- Contract-pin extensions (minimal): `register-browser-ipc.test.js` (channel inventory +`internal-vault-request-rotate-admin`), `seam-contract.test.js` (SEAM_COUNT 26→27 + the paired `CLAUDE.md` 26→27-entry note).

#### Results
- New suites green with `--test-timeout=60000`; **full `npm test`: 2583 pass / 0 fail** (was 2572 pre-leg; +11 = the two new suites' 7+4 tests). `npm run typecheck` clean; `npm run lint` clean. Grep AC verified: `adminPrivateKey`/`privateKeyB64` appear ONLY on the main→chrome→sheet + store paths — none in `src/renderer/pages/` or `internal-preload.js`; the `internal-vault-request-rotate-admin` trigger is BARE; the display sheet is dismiss-locked.

#### Deviations
- **Rotate-admin reuses the `vault-stepup` sheet** (per the leg) via a third `mode` (`mint` | `rotate-recovery` | `rotate-admin`) — lede/submit re-labeled at runtime, submit routes to `menu-overlay:vault-rotate-admin`. No new step-up template.
- **`vault-adminkey-show` is a single-secret display** (admin private key only, no keyId) — mirrors `vault-accesskey-show` minus the keyId field/label.
- **Seam closed-set grew 26→27** (leg-authorized DD9 addition, the per-leg precedent) — `seam-contract.test.js` SEAM_COUNT and the goldfinch `CLAUDE.md` note updated together, as the pin instructs.

### Leg 4 — registrable-domain-optin

**Risk tier: HIGH (Flight Director call).** Security-novel: a wrong matcher silently shares a credential
across sites; the fail-closed-to-exact logic + the hand-written PSL parser (`*`/`!` rules) are exactly
where a subtle bug leaks a password. → per-leg design review (2 cycles).

**Design review — cycle 1 (approve with changes).** One genuine HIGH: `reachableLoginItems` has a FOURTH
consumer the first draft missed — the human capture save-vs-update disposition (`vault-human.js:251` →
`captureSave` origin-rewrite `:338-343`). A blanket widen would disposition a subdomain submit as an
update to the eTLD+1 item and rewrite its origin down → data-integrity regression. Fix: the widen is
**opt-in per call** (`{widen}`), picker passes true, capture stays exact. Plus M-fixes: `matchMode` moves
OFF `SCHEMA.login.nonSecret` (it trips the editor drift-guard `vault-editor-model.test.js:22` and would
render a text field) → modeled like `hasTotp` (metadata + dedicated toggle + `assembleSave`); the picker
filter cite corrected `vault-store.js:885`→`:1191` (`:885` is `_resolveTarget`; the same stale cite lives
in flight DD5 `flight.md:142` — flagged, not silently rewritten); `originMatches` inputs are opaque
`scheme://host:port` strings → `URL`-parse + fail-closed; picker rows are hand-built (`:1192-1199`) so the
badge needs an explicit `widened` row flag; positive `matchMode==='registrable-domain'` test; exception>
wildcard PSL priority; IDN/punycode noted.

**Design review — cycle 2 (approve).** All incorporations verified against real code: `reachableLoginItems`
has exactly two callers (picker `:158` / capture `:251`, no silent third), the widen-one-not-the-other is
implementable; `hasTotp` is genuinely a `metadataOf`-derived flag outside the nonSecret list (the mirror
path is real; note the write side is bespoke); `:1191` cite exact; fail-closed contract airtight. One
signature-precision note folded in: default the whole options object (`{ widen = false } = {}`) so the
unchanged 2-arg capture caller doesn't throw destructuring `undefined`.

**Implementation (landed) — 2026-07-21.** All ACs met. A vendored Mozilla PSL snapshot + a hand-written,
fail-closed parser (`registrableDomainSafe`) resolves the eTLD+1; a shared `originMatches(item, tabOrigin,
{widen})` is the single fill-decision point (exact by default; the widen is opt-in per call). The three
fill sites branch through it with `widen:true`; the picker path widens, the capture-disposition path stays
2-arg exact. `matchMode` is a `login` metadata flag (via `metadataOf`, modeled on `hasTotp`) with a
bespoke editor toggle + `assembleSave` handling — NOT in `SCHEMA.login.nonSecret`. The PSL parser deviates
from the reference algorithm by ONE deliberate rule: no implicit `*` default — an unlisted/unknown suffix
returns null (fail-closed), so an unknown TLD can never widen a fill.

#### Changes Made (files, one line each)
- `src/main/vault/public_suffix_list.dat` — NEW vendored Mozilla PSL snapshot (2026-07-20, MPL-2.0; 328 KB; source URL + refresh note recorded in `psl.js`). Redistributable data asset, not an npm dep → zero-runtime-dep preserved.
- `src/main/vault/psl.js` — NEW pure parser: reads the .dat ONCE at load into normal/wildcard/exception Set indexes (both ICANN + PRIVATE sections); `registrableDomainSafe(host)` (exception>wildcard>longest, +1 label; null on IP/empty/malformed/host-is-suffix/unknown-suffix). IDN reconciled via `url.domainToASCII` (Unicode .dat entries → punycode to match `URL.hostname`). Borrows only the `isIpLiteral` idea from trackers.js — never its matcher.
- `src/shared/origin-match.js` — NEW `originMatches(item, tabOrigin, {widen=false}={})` (CJS, main-consumed only — the guest-forward-allowlist precedent; page does NOT import it): exact string compare by default; positive `matchMode==='registrable-domain'` + same protocol + both `registrableDomainSafe` non-null-and-equal to widen; every uncertainty falls back to exact.
- `src/shared/vault-item-schema.js` — `metadataOf` surfaces `matchMode` for LOGIN items only (`'exact'`|`'registrable-domain'`; absent/legacy/other → `'exact'`), mirroring `hasTotp`; never a secret, never in nonSecret.
- `src/shared/vault-editor-model.js` — `assembleSave` accepts `matchMode` and always stamps it on a login item (whole-replace safety: an edit-and-save can't silently drop a prior opt-in).
- `src/main/vault/vault-store.js` — `reachableLoginItems(jarId, origin, {widen=false}={})` filters via `originMatches` and stamps an explicit `widened` flag per hand-built row (bypasses `metadataOf`); JSDoc + row-shape widened.
- `src/main/vault/vault-context.js` — automation fill (`:324`) branches through `originMatches(found, tabOrigin, {widen:true})`.
- `src/main/vault/vault-human.js` — human fill (`fillHuman`) via `originMatches(item, tabOrigin, {widen:true})`; the picker path (`reachableItems`) passes `{widen:true}`; the capture-disposition path (`:260`) stays 2-arg EXACT (no origin-rewrite regression).
- `src/shared/vault-picker-template.js` — a distinct "Subdomain match" badge (`textContent`-only) on a `widened` row.
- `src/renderer/pages/vault.js` (+ `vault.css`) — a login-only match-mode checkbox (default off; "Match any subdomain of this site" + hint) wired into the Save handler's `assembleSave` call.
- `src/renderer/renderer-globals.d.ts` — `vaultReachableItems` row type gains `widened: boolean`.
- `eslint.config.mjs` — `src/shared/origin-match.js` bound commonjs (the reserved-ids / vault-item-schema precedent: main-side files list + the `src/shared/**` module-block `ignores`).
- Tests: `psl.test.js` (NEW — rule classes + every fail-closed null case, multi-tenant distinct, sibling distinct, exception>wildcard, IDN reconciled); `origin-match.test.js` (NEW — exact unchanged, widen/refuse across sibling/tenant/scheme/either-null/both-null/parse-failure/legacy); `vault-matchmode-fill.test.js` (NEW — the three fill sites honor matchMode + **capture stays exact**: a subdomain submit is a SAVE, apex origin never rewritten). Extended `vault-store-reachable.test.js` (widen surfaces/refuses/legacy + `widened` in the row shape) and `vault-item-schema.test.js` (matchMode metadata flag).

#### Results
- New suites green with `--test-timeout=60000`; **full `npm test`: 2614 pass / 0 fail** (was 2583 pre-leg; +31 from the three new suites + the two extended suites). `npm run typecheck` clean; `npm run lint` clean. Grep ACs verified: `matchMode` is never in `SCHEMA.login.nonSecret` and never carries a secret; `psl.js`/`origin-match.js` reference trackers.js only in explanatory comments (no code reuse of `MULTI_SUFFIX`/`registrableDomain`, no require); the capture path is 2-arg exact.

#### Deviations
- **Stale cite recorded, not rewritten (per leg guidance):** flight DD5 (`flight.md:142`) cites the picker filter as `vault-store.js:885`; the real filter is `:1191` (`:885` is `_resolveTarget`). Noted here; the flight spec body is left untouched.
- **`origin-match.js` is CJS and NOT a page module.** The internal vault page only toggles the per-item flag — the match decision is entirely main-side — so the page does not import `origin-match.js` and no `internal-page-map.js` route is needed. It is main-consumed CJS (it require()s the main-only `psl.js`, which reads the .dat), following the guest-forward-allowlist precedent.
- **Editor label is generic, not interpolated.** The toggle reads "Match any subdomain of this site" rather than naming the concrete registrable domain, because the ~328 KB PSL is deliberately main-side only (not shipped to the CSP-restricted internal page); interpolating the exact eTLD+1 would require shipping the PSL to the renderer. The authoritative match is enforced in main regardless.
- **No seam / channel change.** The editor toggle adds no evaluate-reachable a11y driver and no new IPC channel — a plain fill-matching path, as the leg predicted; `seam-contract.test.js` SEAM_COUNT (27) untouched, verified.
- **Vendored .dat is 328 KB** (leg estimated ~200 KB) — accepted for a security-critical credential matcher; it fails only ever CLOSED as it ages.

### Leg 5 — audit-origin

**Risk tier: HIGH (Flight Director call).** Two HIGH triggers: a **shared-interface change**
(`deriveAuditDetail(op,args)`→`(op,args,result)` + `vault-context.fill`'s return, both with existing test
consumers) on a **security-sensitive surface** (the audit log's never-leak-a-secret invariant — a bug
here could write an accessKey into the log). → per-leg design review.

**Design review — 1 cycle (approve with changes).** The three-hop mechanic, the secret invariant, the
result-shape coupling, origin-exposure, and 2-arg back-compat all verified sound against real code. One
genuine HIGH: the fill success return is pinned by `deepEqual` at **three** sites across **two** files,
and Leg 4 had just added the second — `vault-context.test.js:230` **plus** `vault-matchmode-fill.test.js:86`
& `:87` (both drive a real matching origin, so their returns gain `origin`). My draft named only the first
file → the "existing tests pass" AC would have failed. Fixed: all three sites + the second file added to
scope. LOW folded: pin the `vaultUnlock` null-vs-0 logic — `parseResultJson===null → null` (preserves the
2-arg secret tests + malformed-result degradation), else `Array.isArray(parsed.unlocked) ?
parsed.unlocked.length : 0` (guard against a non-array `unlocked`). Changes tracked the review's own
recommendations (a missed test file + a logic pin) — no second cycle needed.

**Implementation (landed) — 2026-07-21.** All ACs met. The resolved fill origin now travels the three DD6
hops: `vault-context.fill`'s SUCCESS return gains `origin: tabOrigin` (the not-filled shapes are
unchanged; the credential/password is still never returned); `okResult` JSON-serializes it into
`result.content[0].text` automatically (no tool-def/`okResult` change); `deriveAuditDetail(op, args,
result)` reads it via a local `parseResultJson` try/catch helper (any malformed/absent/error result → null,
never throws). `vaultFill` appends ` origin=<origin>` only when the parsed result is `filled===true` with a
non-empty origin (else `item=<id>` unchanged); `vaultUnlock` returns `unlocked=<N>` (N = the array length,
`Array.isArray`-guarded) from the result, or `null` on a 2-arg/malformed call (preserving the secret-op
default). The accessKey/admin-key/password/TOTP secret is read from NEITHER args nor the result.

#### Changes Made (files, one line each)
- `src/main/vault/vault-context.js` — `fill` SUCCESS return widened to `{ filled: true, id: itemId, origin: tabOrigin }` (already-resolved top-frame origin; not-filled shapes untouched, credential still never returned); JSDoc return-shape updated.
- `src/main/automation/mcp-server.js` — `deriveAuditDetail` gains an optional 3rd `result` param + a local `parseResultJson` (reads `result?.content?.[0]?.text`, `JSON.parse` in try/catch → null on any failure); `vaultFill` case appends ` origin=<origin>` on a filled result, `vaultUnlock` case returns `unlocked=<N>` (Array.isArray-guarded) or null; call site (`:469`) threads the already-computed `result`.
- `src/main/automation/mcp-tools.js` — `vaultFill` tool description result-shape sentence updated to `{ filled: true, id, origin }` (origin non-secret, still no credential/password).
- `test/unit/vault-context.test.js` — the pinned fill-return `deepEqual` gains `origin: 'https://work.example'`; NEW dedicated fill-origin test (origin present on success, absent on locked/mismatch not-filled shapes); the secret-invariant test (`:447`) extended with a result-aware pass feeding an adversarial secret-laden result and asserting no secret leaks (+ the non-secret enrichments do surface).
- `test/unit/vault-matchmode-fill.test.js` — the two Leg-4 fill-return `deepEqual` assertions (`:86`,`:87`) gain their resolved origins (`https://accounts.example.com` / `https://example.com`).
- `test/unit/automation-mcp-server.test.js` — NEW `deriveAuditDetail` result-aware unit cases (vaultFill origin-appended / not-filled / 2-arg / malformed→no-throw; vaultUnlock count / empty→0 / non-array→0 / 2-arg→null / malformed→null); NEW driven integration test (real `.gfvault` fixture + origin-matching scopeCtx: a driven `vaultUnlock` records `unlocked=1` and `vaultFill` records `item=w1 origin=https://work.example`, neither leaking the secret).

#### Results
- **Full `npm test`: 2625 pass / 0 fail** (was 2614 pre-leg; +11 — 9 result-aware unit cases + 1 fill-origin vault-context test + 1 driven MCP integration test). `npm run typecheck` clean; `npm run lint` clean. Secret-invariant grep verified: the `vaultFill`/`vaultUnlock` cases read only `args.itemId`, `parsed.unlocked.length`, `parsed.filled`, `parsed.origin` — no `args.accessKey`/`adminKey`/password/code path feeds the detail (`accessKey`/`adminKey` appear only in comments).

#### Deviations
- **None.** Implemented exactly to the reviewed spec: all three pinned `deepEqual` sites across both files updated, the optional 3rd param keeps every existing 2-arg caller/test byte-identical, and the result-parse fallback degrades to the prior args-only/null detail on any malformed result.

### Leg 6 — jar-delete-vault-removal

**Risk tier: HIGH (Flight Director call).** Destructive, irreversible lifecycle — a jar delete permanently
removes the only copy of that jar's saved credentials — plus a state-machine change threaded into the
shared `handleRemove` composition. → per-leg design review.

**Design review — 1 cycle (approve with changes).** The main-side (load-bearing destructive) design was
fully validated against real code: `deleteVault` = ENOENT-tolerant unlink + `vaultKeys` evict/zeroize is
the COMPLETE teardown (`vaultKeys` is the only per-vault in-memory state; `mrk`/idle-timer are
store-global); no dangling `access` envelope (they live inside each `.gfvault`, never cross-vault); the
"no manager row" claim confirmed (`_readManager` validates only `{format,version,kdf,adminPublicKeyB64,
mrk}`, enumeration is GLOBAL + jars.list()) — so checkpoint (e)'s "prunes the manager row" is genuinely
stale (flag, don't rewrite); the GLOBAL guard is correct defense-in-depth (`isReservedId` already blocks
a live 'global' jar); fail-soft ordering + injection wiring (lazy `getVaultStore` accessor, no init-order
risk) both correct; wipe-spares-the-vault truthful (`wipeJarData` never touches `userData/vaults/`);
locked-export can't cause silent data loss (delete is a separate explicit Confirm, never chained off
export). One MEDIUM: I under-scoped the renderer offer as "minimal wiring / defer to F5" — it is a modal-
SHAPE change (`jars-confirm-modal.js`'s fixed 2-element focus cycle → 3-element for the export button;
`buildContent`'s static copy → vault-present branch). Fixed: the leg now OWNS the structural modal code +
a this-leg reachability smoke (Export button rendered AND in the focus cycle); only the full interactive
walkthrough + a11y audit ride F5. LOW folded: `hasVault` needs a NEW preload bridge method
(`internal-vault-state` can't answer per-jar file presence); the stale open-vault-page-row after a jar
delete is pre-existing and noted for F5, not chased here. Citations corrected (`handleRemove` `:64-87`,
`revokeJarKey` `:83`, deps `:8-18`, `DATA_ACTIONS.delete` `:590-596`). Changes track the review's own
recommendations — no second cycle; the flight-end whole-diff review covers the resulting code.

**Implementation (landed) — 2026-07-21.** All ACs met. The vault lifecycle is complete: a jar DELETE
removes its `.gfvault` (after offering to export it first), a jar WIPE spares it. Main-side (the
load-bearing, fully-tested part): `deleteVault(vaultId)` = GLOBAL-guard-first → ENOENT-tolerant
`fs.unlinkSync(_vaultPath)` (returns `{deleted}` — true iff a file was removed, false on the common
no-vault ENOENT case, other fs errors rethrown) → evict + zeroize the cached key via the exact `:853-854`
idiom (`vaultKeys.get(id)?.fill(0); vaultKeys.delete(id)`). `hasVault(jarId)` = `fs.existsSync(_vaultPath)`.
`handleRemove` calls `getVaultStore().deleteVault(removed.id)` **fail-soft** (try/catch mirroring the wipe
containment) right after `revokeJarKey`, before the broadcasts; a throw sets `vaultRemoved:false` but never
fails the delete. The store op is injected as a lazy `getVaultStore` accessor threaded main.js →
registerJarIpc → registerJarRegistryIpc (gated — offline tests omit it and skip the step). Renderer
offer-export-first (modal-shape change owned here): for a vault-bearing delete the confirm swaps to
permanence copy and renders an "Export vault first" button that reuses Leg 1's `exportVault` WITHOUT
closing the modal (rendering `{ok,path}` / `{locked}` → "unlock the vault to export" / `{canceled}`); Delete
stays the separate explicit Confirm click. The focus cycle widens to 3-element `[export, confirm, cancel]`
for that variant; a no-vault jar's confirm is byte-unchanged (2-element, static copy). Vault presence is
probed via a NEW `internal-vault-has` origin-locked channel + `hasVault` preload bridge method.

**Stale checkpoint flagged (not rewritten):** flight checkpoint (e) still says the delete "prunes the
manager row" — superseded by the DD7 Architect correction: there is **no per-vault manager row**
(`manager.json` holds only `{format,version,kdf,adminPublicKeyB64,mrk}`; enumeration is GLOBAL +
`jars.list()`), so the delete touches ONLY the `.gfvault` file. Grep-verified: `deleteVault` writes no
`manager.json` (touches only `_vaultPath` + `vaultKeys`).

**Carry-forward for F5 (not chased here):** an open `goldfinch://vault` page derives its rows from
`vaultState` (GLOBAL + `jars.list()`); `handleRemove` broadcasts `jars-changed` but no vault-specific
event, so the page may show a stale row for a just-deleted jar until refetch. Pre-existing (the jar row's
source is already gone), out of tight scope.

#### Changes Made (files, one line each)
- `src/main/vault/vault-store.js` — NEW `deleteVault(vaultId)` (GLOBAL-guard-first → ENOENT-tolerant unlink → evict/zeroize cached key; returns `{deleted}`) + NEW `hasVault(vaultId)` (`fs.existsSync(_vaultPath)`).
- `src/main/jar-registry-ipc.js` — `handleRemove` gains the fail-soft vault-removal step after `revokeJarKey` (try/catch → `vaultRemoved`); `getVaultStore` added to the deps (gated); composition comment updated to `… revoke → deleteVault → broadcasts`.
- `src/main/jar-ipc.js` — threads the optional `getVaultStore` accessor into `registerJarRegistryIpc`.
- `src/main/main.js` — passes `getVaultStore` (the lazy memoized accessor) into `registerJarIpc` (no init-order risk — registerJarIpc runs after `getVaultStore` is defined).
- `src/main/register-vault-ipc.js` — NEW `internal-vault-has` origin-locked channel (returns `{present}` from `hasVault`; non-secret, non-throwing on a locked store).
- `src/preload/internal-preload.js` — NEW `hasVault(vaultId)` bridge method (`invoke('internal-vault-has')`).
- `src/renderer/renderer-globals.d.ts` — `hasVault` type on the internal bridge.
- `src/renderer/pages/jars-section-controller.js` — `openDataConfirm` becomes async, probing `bridge.hasVault(id)` for the delete action → `ui.vaultPresent`; `DATA_ACTIONS.delete` gains `vaultPresentCopy` + `exportVault`; NEW `DELETE_VAULT_COPY` permanence constant; `DATA_ACTIONS` type widened.
- `src/renderer/pages/jars-confirm-modal.js` — `buildContent` branches copy + renders the "Export vault first" button (result line, keeps modal open) for the vault-present variant; the Tab focus cycle widens to 3-element `[export, confirm, cancel]` when the export button is present (2-element unchanged otherwise); return shape gains `exportBtn`.
- `test/unit/vault-store.test.js` — NEW `deleteVault` (unlink+evict/zeroize; ENOENT no-op; GLOBAL refusal never unlinks) + `hasVault` (true/false) unit tests.
- `test/unit/jar-registry-ipc.test.js` — NEW integration tests: `deleteVault` called after `revokeJarKey` + `vaultRemoved:true`; fail-soft (throw → `{ok:true, vaultRemoved:false}`); step skipped without injection; real-store global-survives-a-jar-delete; **jar-WIPE spares the `.gfvault`** (spare-on-wipe pin).
- `test/unit/helpers/jar-ipc-harness.js` — optional `getVaultStore` injection passthrough.
- `test/unit/jars-confirm-vault-reachability.test.js` — NEW renderer reachability smoke: vault-bearing delete renders the Export button, it's in the 3-element focus cycle, a locked export surfaces "unlock" without closing/faking success, and a no-vault delete is the byte-unchanged 2-element modal with static copy.
- `test/unit/register-vault-ipc.test.js` — channel-inventory pin updated (+`internal-vault-has`).

#### Results
- **Full `npm test`: 2638 pass / 0 fail** (was 2625 pre-leg; +13 — 4 vault-store unit + 5 jar-registry integration + 4 renderer-reachability smoke). `npm run typecheck` clean; `npm run lint` clean.
- Grep-verified: the delete path writes no `manager.json` (`deleteVault` touches only `_vaultPath` + `vaultKeys`); the GLOBAL vault path is guarded (`vaultId === GLOBAL_ID` → throw, FIRST, before any unlink); `handleRemove`'s vault step is fail-soft (try/catch → `vaultRemoved:false`, revoke/broadcasts run regardless).

#### Deviations
- **None.** Implemented exactly to the reviewed spec. Note: the export-result line reuses the neutral `.jar-confirm-text` class (no new CSS class needed); the modal reads the global `document` (existing module shape, no injected-doc dep) so the reachability smoke provides one via `globalThis.document` in its isolated test-file process.

### Leg 7 — docs-threat-model

**Risk tier: LOW (Flight Director call).** Docs-only, additive — `docs/vault.md` (net-new) + a
`### Password vault` subsection under CLAUDE.md `## Patterns` + an Architecture pointer; no source
changes. Per the risk-tiering gate, LOW/additive skips the per-leg design review — the flight-end
whole-diff Reviewer covers the resulting prose. The leg directs the implementer to document what F1–F4
actually built (reading the vault modules + flight artifacts, no invention), lead the threat model with
the **unrecoverable-by-design** property, and capture the debrief carry-forward (the per-op
whole-vault-decrypt characteristic F1/F3 owed documenting).

**Implementation (landed) — 2026-07-21.** All ACs met. `docs/vault.md` (net-new) documents the vault as
it actually exists across F1–F4, written from the code + flight artifacts (no invention; module + symbol
references over volatile line numbers so the doc ages gracefully). Eleven sections, matching the depth /
tone of `docs/mcp-automation.md`: Overview & goals (encrypted per-jar + global vaults, explicit-gesture
fill, scoped MCP, zero runtime deps) with a module-layout table; On-disk format (`.gfvault` +
`manager.json`, with placeholder-ciphertext example JSON, the GCM-AAD binding, and load-loudly-never-
quarantine); the MRK key hierarchy (one random 256-bit Manager Root Key wrapped three ways —
scrypt/master, HKDF/recovery, X25519/admin — every vault key under the MRK, per-jar access keys wrapping a
vault key directly, rotations rewrite only `manager.json`); Unlock lifecycle (main-process-only Buffers,
idle auto-lock, lock-on-quit `.fill(0)` zeroization, three-paths-one-`_installMrk`-chokepoint, step-up
gate); the Fill trust boundary (no master-equivalent secret in the `goldfinch://vault` PAGE DOM — entry
via the chrome-owned menu-overlay SHEET over the dual-zeroized Buffer channel; dismiss-locked one-time
recovery/admin displays; the accepted internal-page-a11y gap); the MCP automation surface (fill-only,
two access-key tiers, cryptographic scope by session identity, session-scoped teardown, audit = resolved
origin + unlock count); Origin matching (exact by default, the per-item registrable-domain opt-in behind
the vendored-PSL fail-closed-to-exact matcher, capture stays exact); Portability (the Option-A bundle =
three mrk envelopes + kdf + adminPublicKeyB64 + vault doc, all ciphertext; fresh-profile adopt vs
existing-profile re-key); Rotation & recovery (recovery rotation, master change with old-pw step-up,
recover-after-forgotten-master where the recovery key IS the step-up, admin rotation/provision minting
anew; each rewrites one manager.json slot — a table); Lifecycle (jar wipe SPARES the vault, jar delete
REMOVES it offering export first, global vault independent); and the **Threat model** led by the
**unrecoverable-by-design** property (no master + no recovery → data permanently gone, no backdoor),
covering protects-against vs. not (compromised main process / keylogger at master entry out of scope),
the admin key as break-glass/multi-vault, burner/internal exclusion, and the **per-op whole-vault-decrypt**
characteristic as an accepted, documented property (bounded sizes, plaintext main-process-only, zeroized —
closing the F1/F3 documentation owe). CLAUDE.md gained the `### Password vault` `## Patterns` subsection
(module layout, MRK-model one-liner, fill trust boundary, sheet family, the SEAM_COUNT=27 seam-contract
note, pointer to `docs/vault.md`) at the density of `### Automation engine` / `### Menu-overlay sheet`,
plus one Architecture cross-cutting-fact pointer mirroring how `docs/mcp-automation.md` is referenced.

#### Changes Made (files, one line each)
- `docs/vault.md` — NEW. The vault reference (11 sections: overview + module table, on-disk format, MRK key hierarchy, unlock lifecycle, fill trust boundary, MCP surface, origin matching, portability, rotation & recovery, lifecycle, threat model). Placeholder ciphertext only; repo-relative paths only.
- `CLAUDE.md` — NEW `### Password vault` subsection under `## Patterns` (module layout / MRK model / fill trust boundary / sheet family / automation surface / SEAM_COUNT=27 note / `docs/vault.md` pointer) + one Architecture cross-cutting-fact bullet pointing at the subsection and `docs/vault.md` + the vault-tools note appended to the MCP `30 tools` bullet.

#### Results
- **No source files changed** — docs + `CLAUDE.md` only. `git status --porcelain` shows `docs/vault.md` (new) + `CLAUDE.md` (modified) as this leg's only additions; every other modified/untracked path is the uncommitted F4 Legs 1–6 output under the deferred-commit model (Flight Director commits at flight end), not this leg's.
- **Full `npm test`: 2638 pass / 0 fail** (unchanged from Leg 6 — nothing executable moved). `npm run typecheck` clean; `npm run lint` clean.
- Grep-verified: no operator username / absolute home path / real secret in `docs/vault.md` or `CLAUDE.md` (all illustrative ciphertext is `<base64-ciphertext>` placeholders; all paths repo-relative or `userData/...`).

#### Deviations
- **None.** Documented strictly to the reviewed outline against the real code. Spot-checks landed: format vs `vault-store.js`/`vault-crypto.js`; MRK vs `vault-crypto.js` (four envelope ops) + `vault-store.js` (`_writeVaultForKey`, the rotations); matcher vs `origin-match.js`/`psl.js` (fail-closed, no-implicit-`*` deviation); MCP vs `mcp-tools.js` (`VAULT_TOOLS`) + `mcp-server.js` (`deriveAuditDetail`). The vault management page's internal host was verified as `goldfinch://vault` (`INTERNAL_HOSTS` in `url-safety.js`), so the a11y-gap prose names the real page.
