# Goldfinch Password Vault

A reference for Goldfinch's built-in password vault (Mission 12) — an encrypted,
per-jar-and-global credential store with an explicit-gesture human fill path and a
deliberately **fill-only** automation surface. The vault is the browser's own manager: it
is not an autofill engine, and no stored secret is ever readable from web content except
the one credential a fill effect injects.

> **Zero runtime dependencies.** The entire cryptographic core (`src/main/vault/vault-crypto.js`)
> imports only `node:crypto` plus Node built-ins. Nothing in the vault adds to Goldfinch's
> dependency surface — the one sanctioned runtime dep (`@modelcontextprotocol/sdk`) is the
> MCP transport, not the vault.

## Overview & goals

- **Encrypted at rest, authenticated.** Every item is sealed with AES-256-GCM under a
  random 256-bit vault key. A wrong key or any tampered byte fails GCM authentication and
  throws a typed error — never a corrupt buffer, never a silent partial read.
- **Structural compartmentalization.** There is a **global** vault plus one lazily-created
  vault per persistent cookie jar. Unlocking one jar's vault does not open another's; burner
  and internal partitions have no vaults at all. The boundary is enforced by key derivation,
  not policy.
- **Master-equivalent secrets never touch the vault page DOM.** Master password, recovery
  key, per-jar access secret, and admin private key are entered and displayed only through
  the chrome-owned menu-overlay **sheet**, over a dedicated dual-zeroized Buffer channel.
- **Fill-only automation.** The four MCP vault tools can unlock, browse metadata, read a
  live TOTP code, and fill a matching credential into a page — but a password is **never**
  returned across the automation boundary.
- **Unrecoverable by design.** Lose the master password *and* the recovery key and the data
  is permanently gone. There is no backdoor and no vendor recovery path (see *Threat model*).

Module layout:

| Concern | Module |
|---|---|
| Pure crypto core (KDFs, AES-256-GCM, four envelope ops, `.gfvault` serialize/parse, TOTP) | `src/main/vault/vault-crypto.js` |
| Stateful store (`manager.json` + `.gfvault` persistence, MRK model, unlock lifecycle, rotations, export/import, delete) | `src/main/vault/vault-store.js` |
| Per-session automation vault context (fill-only) | `src/main/vault/vault-context.js` |
| Human fill orchestration (picker model, gesture fill, capture) | `src/main/vault/vault-human.js` |
| Item schema SSOT (per-type secret/non-secret maps) | `src/shared/vault-item-schema.js` |
| Origin matcher (exact vs. registrable-domain opt-in) | `src/shared/origin-match.js` |
| Vendored Public Suffix List resolver | `src/main/vault/psl.js` (+ `public_suffix_list.dat`) |
| Chrome-owned entry/display sheets | `src/renderer/menu-overlay.js` + `src/shared/vault-*-template.js` |
| MCP vault tools + audit | `src/main/automation/mcp-tools.js`, `mcp-server.js` |

## On-disk format

Everything lives under `userData/vaults/`:

- **`manager.json`** — one per profile, owned by `vault-store.js` (format id `gfmanager`,
  version 1). It holds no item data — only the wrapped Manager Root Key and the KDF params:

  ```json
  {
    "format": "gfmanager",
    "version": 1,
    "kdf": { "algo": "scrypt", "N": 131072, "r": 8, "p": 2, "maxmem": 201326592 },
    "adminPublicKeyB64": "<base64-spki-der>",
    "mrk": {
      "master":   { "keyId": "master",    "type": "scrypt",        "salt": "<b64>", "iv": "<b64>", "ct": "<base64-ciphertext>", "tag": "<b64>" },
      "recovery": { "keyId": "recovery",  "type": "hkdf-recovery", "salt": "<b64>", "iv": "<b64>", "ct": "<base64-ciphertext>", "tag": "<b64>" },
      "admin":    { "keyId": "admin-pub", "type": "x25519",        "salt": "<b64>", "epk": "<b64>", "iv": "<b64>", "ct": "<base64-ciphertext>", "tag": "<b64>" }
    }
  }
  ```

  The only plaintext of consequence is `adminPublicKeyB64` (a *public* key). All three MRK
  wraps are ciphertext.

- **`<vaultId>.gfvault`** — one per vault (`global.gfvault`, then `<jarId>.gfvault` created
  lazily on the first credential save into that jar). Format id `gfvault`, version 1, owned
  by `vault-crypto.js`. It is a self-contained JSON document:

  ```json
  {
    "format": "gfvault",
    "version": 1,
    "vaultId": "<hex-or-jar-id>",
    "kdf": { "...": "scrypt params" },
    "envelopes": [
      { "keyId": "mrk",       "type": "mrk",        "iv": "...", "ct": "<base64-ciphertext>", "tag": "..." },
      { "keyId": "<mint-id>", "type": "hkdf-access", "salt": "...", "iv": "...", "ct": "<base64-ciphertext>", "tag": "..." }
    ],
    "items": { "iv": "...", "ct": "<base64-ciphertext>", "tag": "..." }
  }
  ```

  `items` is the AES-256-GCM-sealed JSON array of items. Each `.gfvault` carries exactly one
  `mrk` envelope (its vault key wrapped under the MRK) plus zero or more `access` envelopes
  (that same vault key wrapped under a per-jar automation secret).

Writes go through `atomic-write` (`writeFileAtomic`). Every envelope's `keyId` + `type` and
the document `version` are bound as GCM AAD, so relabelling an envelope or downgrading a
version fails authentication rather than silently succeeding — the load path (`parseVault`,
`_readManager`) trusts the parsed plaintext header only because tampering it breaks the tag.

**Load-loudly, never quarantine.** A truncated, tampered, or unknown-version `manager.json`
or `.gfvault` throws a typed `VaultFormatError` / `VaultAuthError`. The file is never
renamed, quarantined, or recreated — the operator's ciphertext is treated as sacred. (This
is the deliberate opposite of `app-db.js`, which quarantines a corrupt config row and boots
on defaults.)

## Key hierarchy — the MRK model

`setup()` mints **one random 256-bit Manager Root Key (MRK)**. The MRK is never stored in
plaintext; it is wrapped three independent ways in `manager.json`:

| Slot | Wrapping-key derivation | Grantee |
|---|---|---|
| `master`   | `scrypt(password, salt, params)` — async, stretched (only the master password is low-entropy) | the human's master password |
| `recovery` | `hkdf(recoveryMaterial, salt, info)` — high-entropy | the one-time printed recovery key |
| `admin`    | X25519 ECDH → `hkdf(sharedSecret)` — asymmetric seal to the admin public key | the operator-held admin private key |

Every **vault key** (the global vault's and each jar vault's) is in turn wrapped under the
MRK — a single `mrk` envelope on each `.gfvault`. So:

- **master OR recovery OR admin** unwraps the MRK, which unwraps **every** vault key —
  including jar vaults created *after* setup, with no new operator secret at jar creation
  (the "seal to future" property). See `wrapMaster`/`wrapRecovery`/`sealToAdmin` in
  `vault-crypto.js` and `_writeVaultForKey` in `vault-store.js`.
- **A per-jar automation access key** wraps the individual vault key **directly** (an
  `access` envelope on that jar's `.gfvault`). It holds no envelope for the MRK, so it opens
  only its own vault — never the global vault or a sibling jar. This is the structural
  compartmentalization the mission demands: it is cryptographic, not a policy check.

**Why the indirection.** Because vault keys are wrapped under the MRK (not under the master
password directly), a rotation rewrites only `manager.json` — the (potentially large) set of
`.gfvault` files is never touched. Changing the master password, rotating the recovery key,
or rotating the admin key each re-wraps a single MRK slot and rewrites `manager.json` alone.

The manager-envelope AAD binds the **manager** document version (`gfmanager`), while the
`mrk` envelope on each `.gfvault` binds the **vault** document version (`gfvault`); the two
version spaces are owned separately so a future bump of one never silently relabels the
other's AAD.

## Unlock lifecycle

- **Keys live in the main process only, as Buffers.** `vault-store` holds `this.mrk` and a
  `this.vaultKeys` Map; the automation path (`vault-context`) holds its own per-session
  `keys` Map. Nothing is written to disk in plaintext and nothing crosses to the renderer.
- **Three unlock paths, one choke point.** `unlock` (master password), `unlockWithRecovery`,
  and `unlockWithAdmin` each unwrap the MRK and funnel through `_installMrk`, which resets
  prior key state and fires the `onUnlock` hook. `this.mrk` is assigned only after a
  successful unwrap, so a failed unlock leaves the manager locked.
- **Idle auto-lock.** Every store operation calls `_touch`, which re-arms an idle timer
  (`getAutoLockMinutes`, default 10) whose fire calls `lockNow`. The timer is `unref`'d so it
  never keeps the process alive.
- **Lock on quit + zeroization.** `lockNow` `.fill(0)`-zeroizes the MRK and every cached
  vault key, clears the maps, and fires `onLock`; the app wires `before-quit → lockNow`. A
  re-unlock zeroizes any prior state first (`_resetKeys`).
- **Step-up re-auth gate.** Durable-grant operations (mint an access key, and every
  rotation) require a fresh re-unwrap of the current master (or recovery) envelope even while
  already unlocked — the step-up precedes any write, so a wrong secret rewrites nothing. This
  hardens against a hijacked already-unlocked session.

## The fill trust boundary (F2 DD5 / F3)

The vault management page (`goldfinch://vault`) is an internal page, but **no
master-equivalent secret ever enters that page's DOM**. Master password entry, recovery-key
and admin-key display, access-key minting, import, and every rotation are hosted on the
chrome-owned **menu-overlay sheet** (`src/renderer/menu-overlay.js` +
`src/shared/vault-*-template.js` — `vault-unlock`, `vault-set`, `vault-recovery`,
`vault-stepup`, `vault-accesskey`, `vault-adminkey`, `vault-import`, `vault-change-master`,
`vault-recover`, plus the `vault-picker` / `vault-capture` fill sheets). The sheet holds no
business logic and no privileged APIs; it renders a model and runs the APG keyboard contract.

- **Dual-zeroized Buffer channel.** A secret submitted from a sheet is encoded to a
  `Uint8Array` — **never a JS string on the wire** (a string is immutable and un-zeroizable).
  Main receives it, does its crypto, then zeroizes both its own Buffer copy and the
  transferred array (dual-zeroize); the sheet-side copy is `.fill(0)`'d after the round-trip.
  These ride dedicated channels (e.g. `menu-overlay:vault-setup`, `…:vault-change-master`),
  never the generic activation channel.
- **Dismiss-locked one-time displays.** The recovery key and the admin private key are shown
  exactly once. Their sheets are registered `dismissible: false`: Escape, backdrop click, and
  window-blur do not close them — only an explicit "acknowledge" does (the value is
  unrecoverable, so an accidental dismiss must not lose it). On close the reference is dropped
  and the DOM text is scrubbed; a model-replace never re-emits a stale key.
- **Human fill dispatch.** For a gesture fill, `vault-human.js` resolves the credential by
  `(vaultId, itemId)` under the MRK **in main** and hands `{ wcId, credential }` to the fill
  effect. The picker model and the activated selection are metadata / an index only — the
  password is read and dispatched solely in main, never in the model, the selection, or a
  return value.

**Accepted limitation — internal-page a11y gap.** The a11y audit drives the app over the MCP
surface, and the eval/observe tools exclude the internal session even for admin. So the
menu-overlay sheet states (including the vault sheets) *are* axe-audited, but the
`goldfinch://vault` page itself cannot be audited via `--target` — the settings-class a11y
gap the mission explicitly accepted.

## The MCP automation surface

Four tools expose the vault over MCP as a deliberately **fill-only** surface —
`vaultUnlock` / `vaultList` / `vaultTotp` / `vaultFill` (`src/main/automation/mcp-tools.js`).
They are **non-engine-op**: they dispatch to a per-session vault context
(`vault-context.js`), never the automation engine, and hold no cross-session state. Full
consumer reference: `docs/mcp-automation.md` (*Vault tools*).

- **Two access-key tiers, cryptographically scoped by session identity** (not a tool
  argument):
  - A **jar key** session interprets `vaultUnlock`'s `accessKey` as that jar's per-jar vault
    access secret and unlocks only that jar's vault (`unlockVaultWithAccessKey`) — it
    structurally cannot reach the global vault or a sibling.
  - An **admin key** session interprets `accessKey` as the X25519 admin private key (base64),
    opens the MRK, and unlocks every vault (`openAllWithAdminKey`), including jar vaults
    created after setup.
- **`vaultFill` gates twice** before handing `{ wcId, credential }` to the internal fill
  effect: jar membership (a jar session naming a foreign tab → `automation: out-of-jar`, the
  same session-object-identity check the drive/observe tools use; admin may target any tab),
  then a top-frame origin match against the item. The credential is never returned —
  `{ filled, id, origin }` on success, or a normal `{ filled: false, reason }` otherwise.
- **Metadata only.** `vaultList` returns `{ vaultId, id, title, origin, username, hasTotp }`;
  `vaultTotp` returns the current code only. No password, TOTP secret, or card data crosses
  the wire.
- **Session-scoped teardown.** A session's vault keys are Buffers, `.fill(0)`-zeroized on
  transport teardown (a graceful `DELETE` or a dropped SSE stream), with a per-session idle
  timer as a belt-and-suspenders backstop. There is no singleton coupling with the human lock
  in either direction — each holds its own fresh-buffer copies.
- **Audit surface = origin + unlock count, never a secret.** `deriveAuditDetail`
  (`mcp-server.js`) records the resolved fill **origin** for `vaultFill`, the **count** of
  vaults opened for `vaultUnlock` (never the ids-as-secrets), and the item id for
  `vaultTotp` — and reads the `accessKey` / password / TOTP secret / vault key from neither
  the args nor the result.

## Origin matching

Fill matching is **exact-origin by default**. A per-item opt-in
(`matchMode: 'registrable-domain'`) widens a match to the registrable domain (eTLD+1) behind
a **fail-closed** matcher (`src/shared/origin-match.js`):

- Widening requires the same scheme *and* a non-null, equal registrable domain on both hosts,
  computed by a **vendored Public Suffix List** resolver (`src/main/vault/psl.js`, parsing
  `public_suffix_list.dat`). Any uncertainty — a non-opt-in item, an unparseable/opaque
  origin, a scheme mismatch, or a PSL miss on *either* host — degrades to the exact
  byte-for-byte compare.
- The PSL resolver **deviates from the standard algorithm to fail closed**: where the
  reference applies an implicit `*` default for an unknown TLD, this returns `null`, so an
  unlisted suffix can never widen a fill. It honors both the ICANN and PRIVATE sections, so
  distinct multi-tenant tenants (`*.github.io`, `s3.amazonaws.com`, …) resolve to distinct
  registrable domains and never share a credential. IP literals resolve to `null`.
- A stale list only ever fails **closed** (a not-yet-listed suffix → exact fill), never open,
  so staleness is a UX gap, not a credential leak. The custom PSL is used precisely because a
  curated tracker-classification suffix subset would over-collapse unlisted suffixes and leak
  credentials across siblings.
- **Only the picker and fill paths widen** (`widen: true`); **credential capture stays
  exact** — a subdomain submit must never disposition as an update to an eTLD+1 item.

## Portability

`exportVault(target)` builds a self-contained, portable **bundle** (format
`gfvault-bundle`, version 1 — the mission's "Option A"). It requires the manager unlocked as
a policy choice (every input is already on disk) and takes **no password**. The bundle
carries, all as ciphertext:

- the manager's **three** MRK envelopes (`master`, `recovery`, `admin`),
- the KDF params,
- the admin **public** key (`adminPublicKeyB64`),
- the target `.gfvault` document (its `mrk` envelope + item ciphertext).

No plaintext secret ever enters the bundle. Carrying all three MRK envelopes preserves both
recovery-key and admin portability on the far side.

`importVault(bundle, opts)` does all crypto **before any write** (a wrong secret throws and
writes/installs nothing). The source **master password** (a Buffer) or the source **recovery
key** (a base32 display string) opens the bundle:

- **Fresh profile** (`!isSetUp()`): **adopt** the bundle's manager — write the vault file
  first (to `global`, the only target resolvable on a jar-less fresh profile, so a failure
  never flips `isSetUp()` true without a vault), then `manager.json` from the bundle, then
  install the MRK (leaving the profile unlocked). The source master password / recovery key
  unlock this profile on restart.
- **Existing profile** (set up + unlocked): **re-key** the source vault key under the
  destination profile's own MRK at the resolved destination target; a collision is refused
  unless `overwrite`. The transient bundle MRK and vault key are zeroized.

## Rotation & recovery

All rotations require the manager unlocked and a **step-up re-auth**, rewrite exactly **one**
`manager.json` slot, and never re-key the MRK — item ciphertext, the other MRK slots, and
every `.gfvault` file are untouched:

| Operation | Step-up | Effect |
|---|---|---|
| `rotateRecovery` | master-password re-unwrap | mints a fresh recovery key, re-wraps `mrk.recovery`, returns the new one-time display |
| `changeMasterPassword` | **old**-password re-unwrap | re-wraps `mrk.master` under the new password |
| `recoverMasterPassword` | the **recovery key IS the step-up** | works **from locked**: the recovery key unwraps and installs the MRK (leaving the user unlocked), then re-wraps `mrk.master` under a new password |
| `rotateAdminKey` | master-password re-unwrap | mints a **fresh** X25519 keypair unconditionally (also the from-scratch provision), re-seals `mrk.admin`, overwrites `adminPublicKeyB64`, returns the new one-time private key; the prior admin key is invalidated |

`recoverMasterPassword` is a single dedicated op — not an `authenticated` flag on
`changeMasterPassword` (which would bypass the old-password step-up). `rotateAdminKey` mints
anew every time because F3's setup-minted admin private key was discarded; both the sealed
envelope **and** the stored public key are overwritten together (a stale public key would
mismatch the seal and corrupt a subsequent export).

## Lifecycle

- **Jar wipe spares the vault.** Wiping a jar's browsing data clears cookies / history /
  storage but leaves its `.gfvault` intact.
- **Jar delete removes the vault.** `handleRemove` (`src/main/jar-registry-ipc.js`) composes:
  remove → wipe → revoke automation key → `deleteVault` → broadcasts. The vault removal is
  fail-soft (the registry entry is already gone), ENOENT-tolerant (a jar with no `.gfvault` is
  a clean no-op), and guards the global vault internally. The renderer can call `hasVault`
  first to offer an export before the delete. There is no per-vault "manager row" to prune —
  `manager.json` holds only the MRK set + KDF + admin public key.
- **`deleteVault` refuses `global`.** A jar delete can never remove the manager-wide global
  vault; the global vault is independent of any jar and is removed by no jar operation.

## Threat model

**Unrecoverable by design (the headline property).** The MRK is wrapped only under the master
password, the recovery key, and the admin key. If the operator loses the master password
**and** the recovery key (and holds no admin key), the MRK cannot be reconstructed and the
data is **permanently gone**. There is no backdoor, no escrow, and no vendor recovery path.
This is a deliberate security property, not a gap — it is the direct consequence of storing
no plaintext key and adding no fourth recovery route.

**What the vault protects against:**

- **At-rest disk theft.** All items and all vault keys are ciphertext on disk; only the admin
  *public* key is plaintext. A stolen profile yields nothing without the master password,
  recovery key, or admin private key. A wrong key fails GCM authentication.
- **Per-jar isolation.** A per-jar automation access key opens only its own vault (it holds
  no MRK envelope). Burner and internal partitions have no vaults.
- **The automation scope boundary.** The fill-only wire never returns a stored password;
  `vaultFill` enforces jar membership and a top-frame origin match; the audit records origin
  and counts, never secrets.
- **Web content.** No vault secret is readable from a web page except the single credential a
  fill injects — and master-equivalent secrets never enter any page DOM (they route through
  the chrome-owned sheet).

**What it does NOT protect against (out of scope, stated plainly):**

- **A compromised main process.** Once unlocked, the MRK and vault keys are live Buffers in
  the main process; code executing there can read them. Zeroization is best-effort and bounds
  the exposure window, not a defense against in-process compromise.
- **A keylogger at master entry.** Capturing the master password as the human types it into
  the sheet is outside the vault's control.

**The admin key — break-glass / multi-vault.** The X25519 admin key is the intended path for
opening every vault at once (multi-vault automation, operator break-glass). Handing the admin
private key over an automation tool argument is the supported admin-automation unlock, though
the Settings UI recommends against embedding it in config. It is also the only per-op route
that reaches jar vaults created after setup.

**Burner / internal exclusion.** Burner jars and the internal `goldfinch://` session are
never vault-bearing — there is no vault to unlock, fill, or export for them.

**Per-op whole-vault decrypt (an accepted, documented characteristic).** Each vault operation
decrypts the **whole** vault document (the entire item array), not a single item — `items` is
one AES-256-GCM blob per vault. This is an accepted design property, not a defect: vault sizes
are bounded (a personal credential set), the plaintext exists only transiently in the main
process, and it is not persisted. It is called out here so it is a recorded, deliberate trade
rather than an undocumented owe carried forward from F1/F3.
