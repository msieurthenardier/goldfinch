# Flight: Portability + Rotation + Hardening + Docs

**Status**: landed
**Mission**: [Built-in Password Manager](../../mission.md)

## Contributing to Criteria

- [ ] **Portability is file-based**: an exported vault imports on a fresh profile and unlocks with
      the master password and, independently, with the recovery key — no network egress.
- [ ] **Durable-grant operations demand step-up re-auth**: rotating the recovery key requires a fresh
      master-password confirmation (the mint half landed in F1/F3; recovery rotation is here).
- [ ] **First-run setup** — establishes recovery; **rotation** (recovery/master) completes the
      "either secret unlocks; recover after a forgotten master" criterion.
- [ ] **Fill is origin-bound** — the **registrable-domain per-credential opt-in** (hardened matching,
      never the `trackers.js` tracker-suffix set) completes the mission's fill-scope sub-property.
- [ ] **Locking is comprehensive** — jar **wipe spares** the vault (already true); jar **delete
      removes** it after offering an export first.
- [ ] **The MCP wire audits origin** — the result-aware audit hook records the resolved fill origin
      (mission Known Issue #2).
- [ ] **Docs reflect the feature** — `CLAUDE.md` architecture + a `docs/` vault file-format +
      threat-model page (incl. "lose both master password and recovery key = cryptographically
      unrecoverable by design").

Deferred (documented): **admin-key rotation** lands here too (F1 DD12 + F3's from-scratch-provision
carry-forward). **Internal-page-op auditing** is explicitly OUT of scope — it's a new idea (F1 scoped
the audit log to automation), not the mission's Known Issue #2; noted as a possible future item, not
committed (see DD6).

---

## Pre-Flight

### Objective

Complete the mission's portability, rotation, hardening, and docs: per-vault file **export/import**
(a self-contained bundle unlockable by the master password or recovery key on a fresh profile), **key
rotation** (recovery / master / admin, plus the from-scratch admin provision F3 deferred), the
**registrable-domain per-credential fill opt-in** behind a hardened matcher, the **audit-origin** fix,
the **jar-delete → vault-removal** (offer-export-first) lifecycle hook, and the **docs + threat-model
page**. All crypto reuses F1's envelope ops; rotations rewrite only `manager.json` (the MRK is never
re-keyed, so `.gfvault` files are untouched).

### Open Questions

- [x] **Export bundle format** → **DD1: Option A** (Architect-ruled — B contradicts "export not
      re-prompted" + the one-recovery-key model; A bundles the manager's `mrk.master`+`mrk.recovery`
      envelopes + kdf, no step-up, one recovery key).
- [x] **Master-password change step-up** → **DD3: yes** (old-password re-unwrap; distinct from
      recovery-rotation's master-password step-up).
- [x] **Hardened registrable-domain matcher** → **DD5: a bundled PSL snapshot + parser** (Architect-
      ruled — a curated set can't make "never" true; an unlisted suffix silently leaks; a vendored
      `.dat` is data-not-a-package → zero-dep).
- [x] **Import destination model** → **DD1** (import takes a destination target — global or a chosen
      persistent jar — re-keys under it, with a refuse-on-collision default).

### Design Decisions

**DD1 — Per-vault export = Option A (bundle the manager's MRK envelopes; no step-up; one recovery key).**
*(Architect-ruled: Option B contradicts two mission criteria — export must NOT re-prompt
(`mission.md:150`) yet B needs the master password to re-wrap; and B mints a confusing second recovery
key vs. the mission's "one printable recovery key". Option A satisfies both.)* The export bundle,
built while unlocked with **no password** (all inputs are on disk), contains: the manager's **all three
`mrk` envelopes (`master`, `recovery`, `admin`)** + the `kdf` + `adminPublicKeyB64`, and the target
`.gfvault` (its `mrk`-envelope + `items`). *(Leg-1 review [HIGH]: `_readManager` structurally requires
all three mrk slots, so the fresh-profile adopt must write all three — omitting `mrk.admin` wedges the
profile at boot; `mrk.admin` is ciphertext sealed to the pubkey, carries no plaintext, and preserves
admin-unlock portability.)* The operator's **existing** master password OR **existing** recovery key
opens it. Import unwraps the MRK from `bundle.mrk.master` (source master pw) or
`bundle.mrk.recovery` (recovery key) → unwraps the vault key → installs under the **destination** MRK
via `_writeVaultForKey`, bootstrapping `setup` first if the profile is fresh.
- **Import destination-target model (Architect [MED] — the likely stall point):** `_writeVaultForKey`
  writes `<vaultId>.gfvault`, but a usable vault must be `GLOBAL_ID` or a persistent jar in
  `listJars()` (`_resolveTarget` rejects anything else) — a *source jar* vault's random jarId won't
  exist on a fresh profile → orphaned/invisible. So import **must take a destination target**
  (`global`, or a chosen existing persistent jar) and re-key the vault key under it, with an explicit
  **collision policy** for an existing vault of that id (refuse by default; overwrite only on explicit
  confirm). Leg 1 designs this.
- Rationale: file-based, no network egress; export stays a frictionless unlock-window op; one
  recovery key; cross-machine works (see below). The mission's Known Issue #1 sanctions Option A.
- **Cross-machine / different-master-password (document in DD8):** the bundle's master envelope is
  under the **source** profile's master password. On a machine with a different master password, the
  operator supplies the **source** master password OR the recovery key to open the bundle; it is then
  re-keyed under the destination MRK. "Unlocks with the master password" therefore means the *source*
  master password — the recovery key is the cross-machine path when masters differ.
- Trade-off (accepted, mission-sanctioned): A exposes the manager's master/recovery envelopes, so
  cracking the bundle's scrypt master envelope yields the MRK (all vaults' key) rather than one vault
  key. Modest — the master password's entropy is the real protection either way; each bundle carries
  only one vault's ciphertext.

**DD2 — Every master-equivalent secret ENTRY routes through the chrome-owned sheet + Buffer channel;
the file I/O is a page action.** Per F3's DD5 invariant ("no master-equivalent secret in the page
DOM"), the following inputs live only on the sheet (dual-zeroized Buffer channel; one-time displays
dismiss-locked), NEVER the vault page DOM: the master password for rotation step-ups; the one-time
recovery-key display (recovery rotation) + admin-private-key display (admin provision); **and — new
in F4 — the recovery-key and admin-private-key ENTRY for `unlockWithRecovery`/`unlockWithAdmin`**
(both currently take *string* params, `vault-store.js:481,497`, and are caller-less — F4 first-wires
them; prefer Buffers and bind their entry to the sheet, not the page). Export (Option A) needs no
step-up. The actual bundle file write/read is a page-initiated save/open dialog; the bundle carries
only ciphertext + kdf.
- Rationale: keeps every master-equivalent secret on the chrome sheet; the bundle file plaintext-free.
- Trade-off: rotation/recovery-unlock are multi-surface (page action + sheet secret entry);
  consistent with F3.

**DD3 — Rotations rewrite only `manager.json`; recovery/master/admin each rewrap one MRK slot; master
change gets an old-password step-up.** Recovery rotation and admin rotation are net-new, mirroring the
existing `changeMasterPassword` shape (require unlocked → rewrap the one `manager.mrk.*` slot → write
manager → show the new one-time secret where applicable). `changeMasterPassword` is wired for the first
time (IPC + UI) and gains an **old-password step-up** (a re-unwrap of the current master envelope, like
`mintAccessKey`). Note the two distinct step-ups: **recovery rotation** re-prompts the **master
password** (mission-mandated, `mission.md:147-148`); **master change** re-prompts the **old master
password** (an intentional hardening beyond the literal criterion, against unlocked-session hijack).
The **MRK is never re-keyed**, so no `.gfvault` file is touched by any rotation — verified:
`changeMasterPassword` rewrites only `manager.mrk.master` (`vault-store.js:546`). This also first-wires
`unlockWithRecovery`/`unlockWithAdmin` (caller-less; per DD2 their secret entry is on the sheet).
- Rationale: the MRK indirection makes operator-secret rotation a constant-size manager rewrite;
  step-up matches the mission's durable-grant re-auth posture.
- Trade-off: none structural; secrets are Buffer-carried on the sheet per DD2.

**DD4 — Admin-key rotation = eager one-pass re-seal; the from-scratch provision MUST mint anew.** F3's
setup-minted admin private key was discarded (never surfaced), so the current `manager.mrk.admin` seal
is orphaned (no operator holds the private key). The **from-scratch provision** therefore mints a fresh
keypair, re-seals `manager.mrk.admin` under the new public key, overwrites `adminPublicKeyB64`, and
shows the new private key once — mechanically identical to the eager re-seal. Subsequent rotations may
optionally require the current admin key as a step-up (once one is provisioned). All while unlocked;
single-pass; no lazy stale-envelope window; no `.gfvault` touched.
- Rationale: closes F3's carry-forward; the eager path avoids the lazy re-seal window (F1 DD12).
- Trade-off: the setup-minted admin key is permanently unusable (accepted — it was never surfaced).

**DD5 — Registrable-domain opt-in = a per-credential `matchMode` behind a BUNDLED PSL matcher;
NEVER `trackers.js`.** *(Architect-ruled: a curated suffix set CANNOT literally satisfy the mission's
"never shares a credential across an unrelated ccTLD sibling" — an UNLISTED public suffix (e.g. a
missing `co.id`) silently over-collapses (`alice.co.id`+`bad.co.id` → `co.id`), a password leak that
"fall back to exact on uncertainty" cannot catch (`co.id` is shape-indistinguishable from
`example.com`). The mission explicitly allows "adopt a PSL", and a bundled `.dat` snapshot is **data,
not an npm package** → satisfies zero-runtime-dep.)* A new module — a **vendored
`public_suffix_list.dat` snapshot** + a hand-written parser handling the `*` wildcard / `!` exception
rules → `registrableDomainSafe(host)` (correct eTLD+1, incl. 3+-label + multi-tenant platforms). A
per-item **`matchMode`** field (`'exact'` default | `'registrable-domain'`, added to
`vault-item-schema.js` as a **non-secret** login field — flows through `metadataOf`'s whitelist)
branches the **three** exact-origin match sites: `vault-context.js:324` (automation fill),
`vault-human.js:201` (human fill), `vault-store.js:885` (`reachableLoginItems` picker filter — the
picker must widen too, or the item never surfaces to be filled). An editor toggle sets it, with a
distinct picker badge so a widened offer is visible.
- **Correction to a stale mission premise (record):** the mission says `trackers.js` "mis-resolves
  `example.co.uk` → `co.uk`" — that's stale; `co.uk` IS in `MULTI_SUFFIX` and resolves correctly
  today. `trackers.js` correctly *includes* `github.io`/`amazonaws.com`/`vercel.app` so tenants
  resolve distinct. Its real gap is *unlisted* suffixes + 3+-label entries — exactly the credential-
  leak vector, which is why a full PSL (not a hand-curated subset) is the credential-safe answer.
- **Fail-closed to exact:** `matchMode:'registrable-domain'` only ever *widens* from exact; any
  matcher uncertainty (IP literal, unparseable host, PSL miss) degrades to exact. `matchMode` defaults
  `'exact'`; legacy items with no field are exact.
- Rationale: exact-origin stays the safe default; the opt-in is per-credential; the PSL makes "never"
  literally true; zero runtime dependency (a data asset + parser).
- Trade-off: a ~200 KB vendored PSL asset + a parser + a documented refresh/staleness story; accepted
  for a security-critical credential matcher.

**DD6 — Audit-origin fix threads THREE hops; it is the mission's Known Issue #2 only; internal-page-op
auditing is OUT of scope.** The resolved origin must travel: (1) `vault-context.fill`'s return —
currently `{ filled, id }` (`vault-context.js:333`), **widened to carry the resolved `tabOrigin`**;
(2) the `vaultFill` MCP tool result — the tool (`mcp-tools.js:677`) must surface the origin into
`result.content` (the audit hook sees the *tool result*, not the raw fill return); (3)
`deriveAuditDetail(op, args)` → `(op, args, result)` reading the new `result` param (`result` is
already computed at the call site, `mcp-server.js:451`). Origin is non-secret. Also log `unlocked=N`
for `vaultUnlock` from the result (never the accessKey/code). The audit-log data layer is unchanged
(`detail` free-form). **Internal-page vault-management ops are NOT audited** — a new design question
(F1 scoped audit to automation; would need a new operator-identity model the mission never scoped),
noted as a possible future item, not this flight.
- Rationale: closes the actual mission Known Issue #2 with a minimal, contained change; avoids
  scope-creeping into a new audit-identity model the mission never asked for.
- Trade-off: page-side management ops remain unaudited (documented; revisit if desired later).

**DD7 — Jar-delete removes the vault after offering export; a net-new `deleteVault` op; wipe still
spares it.** `handleRemove` (`jar-registry-ipc.js:64-87`) gains a vault-removal step after
`revokeJarKey`, gated by an **offer-export-first** prompt (reusing DD1 export). **`deleteVault(vaultId)`
is just `fs.unlink(_vaultPath(vaultId))` + evict/zeroize any cached key in `this.vaultKeys`** —
*(Architect [HIGH] correction: there is NO per-vault "manager row" to prune. `manager.json` holds only
`{ format, version, kdf, adminPublicKeyB64, mrk }` and vault enumeration is `GLOBAL + jars.list()`, so
no manager mutation is needed — the jar registry entry is already removed by `jars.remove` and the
automation key by `revokeJarKey` in `handleRemove`.)* Jar **wipe** is confirmed to already spare the
vault (`jar-data-lifecycle.js` touches only session/history/cookies) — no change there.
- Rationale: completes the mission's "wipe spares / delete removes (offer export first)" lifecycle.
- Trade-off: delete becomes a two-step (offer export → confirm delete); acceptable for a destructive op.

**DD8 — Docs: a net-new `docs/vault.md` (file format + threat model) + a `CLAUDE.md` Patterns
subsection.** `docs/vault.md` documents the `.gfvault`/`manager.json` format (envelope model, the MRK
indirection), the threat model, and the load-bearing property that **losing both the master password
and the recovery key makes the vault cryptographically unrecoverable by design**. A new
`### Password vault (src/main/vault/)` subsection under `CLAUDE.md` `## Patterns` mirrors the existing
per-subsystem entries, with a one-line pointer in the Architecture cross-cutting facts. Carries the
F2/F3-originated threat-model facts (icon-spoofability, `isTrusted`-annoyance-only, the invoke-Buffer +
JS-string zeroization limits, the admin-could-readDom-sheet caveat, the per-op whole-vault-decrypt
decision, the DD9-of-F3 page-not-axe-auditable gap).

### Prerequisites

- [ ] F1 crypto/store primitives present (verified by recon): `serializeVault`/`parseVault`, the four
      envelope wrap/unwrap ops, `wrapMaster`/`wrapRecovery` over an arbitrary key, `changeMasterPassword`,
      `generateRecoveryKey`/`generateAdminKeypair`, `unlockWithRecovery`/`unlockWithAdmin`.
- [ ] F3's sheet family + the invoke-Buffer channel + the cross-renderer request idiom (for the export
      step-up + rotation prompts).
- [ ] `docs/` dir + `CLAUDE.md` Patterns section (present).
- [ ] A fresh-profile test harness (a second `userDataPath`) for the import round-trip.
- [ ] No new runtime dependency (the matcher ships a data set, not a PSL npm package).

### Pre-Flight Checklist

- [x] Open questions resolved (DD1 → Option A; DD5 → bundled PSL — both Architect-ruled)
- [x] Design decisions documented (DD1–DD8; DD1/DD5/DD6/DD7 revised per the Architect review)
- [x] Prerequisites verified (recon)
- [x] Validation approach defined (unit crypto round-trips + integration + a fresh-profile import test)
- [x] Legs defined (6 legs; one Architect design-review pass, approve-with-changes, all incorporated;
      sizing confirmed one-flight)

---

## In-Flight

### Technical Approach

Six legs. The crypto reuses F1's ops; rotations are constant-size `manager.json` rewrites; the
security-novel work is the export bundle format (leg 1) and the hardened matcher (leg 3).

1. **`export-import`** — the Option-A bundle (manager `mrk` envelopes + kdf + the target `.gfvault`;
   **no step-up** — export is a frictionless unlock-window op) + import with a **destination-target
   model** (global or a chosen persistent jar, re-keyed; refuse-on-collision) + the page save/open
   action + fresh-profile bootstrap. *(HIGH — crypto format + fresh-profile install.)*
2. **`key-rotation`** — recovery rotation + master-password change (wired, +old-pw step-up) + the
   recover-after-forgotten-master flow (`recoverMasterPassword`, recovery-key step-up, single op — NOT
   an `authenticated` skip-flag). *(HIGH — durable-credential crypto.)* *(Admin split out at review.)*
3. **`admin-key-provision`** — admin-key rotation + the from-scratch provision (mint anew; re-seal
   `mrk.admin` + overwrite `adminPublicKeyB64`; `vault-adminkey-show` one-time display); first-wire
   `unlockWithAdmin` if surfaced. *(HIGH — durable admin credential; split from key-rotation.)*
4. **`registrable-domain-optin`** — a **vendored PSL snapshot + parser** (`registrableDomainSafe`,
   fail-closed to exact) + the `matchMode` item field + the three match-site branches
   (automation/human/picker) + the editor toggle + picker badge. *(HIGH — a wrong matcher shares
   credentials across sites; the PSL is what makes "never" true.)*
5. **`audit-origin`** — `deriveAuditDetail(op,args,result)` + widen `vault-context.fill` to emit the
   resolved origin; `vaultUnlock` count. (Page-op auditing deferred, DD6.) *(MED.)*
6. **`jar-delete-vault-removal`** — the net-new `deleteVault(vaultId)` op + the `handleRemove` hook
   (offer-export-first, reusing leg 1) + confirm wipe spares. *(HIGH — destructive lifecycle.)*
7. **`docs-threat-model`** — `docs/vault.md` + the `CLAUDE.md` Patterns subsection + Architecture
   pointer. *(LOW.)*

Verification: crypto unit round-trips (export→import unlock by both secrets; each rotation re-unlocks
by the new secret + fails by the old; the matcher's include/exclude cases); integration (the IPC/store
ops, the step-up, `deleteVault` prunes cleanly); a **fresh-profile import** integration test (a second
userDataPath). The sheet/page interaction + a11y for any new sheet states ride the F5 HAT (DD9-of-F3).

### Checkpoints

- [ ] (a) Export produces a self-contained bundle; import on a **fresh profile** unlocks by the master
      password AND (independently) by the export recovery key; no plaintext in the file.
- [ ] (b) Recovery / master / admin rotation each re-unlock by the new secret and reject the old;
      from-scratch admin provision yields a usable admin key; only `manager.json` changed.
- [ ] (c) A `matchMode:'registrable-domain'` credential fills across the hardened-matched subdomain
      but NEVER across an excluded multi-tenant sibling; exact-origin stays the default.
- [ ] (d) `vaultFill` audit records the resolved origin; `vaultUnlock` records the count.
- [ ] (e) Jar delete offers export then removes the `.gfvault` + prunes the manager row; jar wipe
      leaves the vault intact.
- [ ] (f) `docs/vault.md` + the CLAUDE.md entry land, incl. the unrecoverable-by-design property.

### Adaptation Criteria

**Divert if**: Option B can't produce a fresh-profile-importable bundle (revisit DD1 → Option A);
a curated credential-safe suffix set proves too gap-prone to be safe (revisit DD4 → bundled PSL).

**Acceptable variations**: the exact bundle file shape/extension; the curated suffix-set contents;
whether master-change and recovery-rotation share a sheet flow; docs prose/structure.

### Legs

> **Note:** Tentative; planned one at a time as the flight progresses.

- [x] `export-import` — Option-A self-contained bundle + fresh-profile install (DD1, DD2). *(landed 2026-07-21)*
- [x] `key-rotation` — recovery rotation + master change(+old-pw step-up) + `recoverMasterPassword` (DD3). *(landed 2026-07-21)*
- [x] `admin-key-provision` — admin rotation + from-scratch provision (mint anew) (DD4). *(split from key-rotation; landed 2026-07-21)*
- [x] `registrable-domain-optin` — the vendored-PSL matcher + `matchMode` + 3 sites + toggle (DD5). *(landed 2026-07-21)*
- [x] `audit-origin` — result-aware `deriveAuditDetail` + fill-origin emit (DD6). *(landed 2026-07-21)*
- [x] `jar-delete-vault-removal` — `deleteVault` + the offer-export-first delete hook (DD7). *(landed 2026-07-21)*
- [x] `docs-threat-model` — `docs/vault.md` + CLAUDE.md (DD8). *(landed 2026-07-21)*

*(No per-flight HAT leg — the mission's closing HAT is Flight 5.)*

---

## Post-Flight

### Completion Checklist

- [ ] All legs completed
- [ ] Code committed; draft PR opened (stacked on F3)
- [ ] Unit + integration suites passing (`npm test`), typecheck, lint clean
- [ ] Fresh-profile import round-trip test passing
- [ ] Flight debrief written (the go/no-go before F5)

### Verification

- **Unit (crypto)**: export→import round-trip unlocks by master password AND by the export recovery
  key; wrong secrets fail auth; each rotation (recovery/master/admin) re-unlocks by the new secret and
  rejects the old; the matcher's credential-safe include (ccTLD second-levels) + exclude (multi-tenant
  platforms) cases.
- **Integration**: the export/import + rotation IPC/store ops (step-up refuses a wrong password;
  rotation touches only `manager.json`); `deleteVault` unlinks + prunes with no dangling row; the
  `matchMode` branch at all three fill/picker sites; `deriveAuditDetail(op,args,result)` records the
  fill origin + unlock count.
- **Fresh-profile import**: a second `userDataPath` imports the bundle and unlocks — the mission's
  portability criterion.
- **Deferred to F5 HAT**: the sheet/page interaction for export/rotation, and a11y for any new sheet
  states (internal page not axe-auditable, DD9-of-F3).
