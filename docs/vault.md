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
- **Fill-only automation.** The five MCP vault tools can unlock, browse metadata, read a
  live TOTP code, fill a matching credential into a page, or answer a pending HTTP
  basic-auth prompt — but a password is **never** returned across the automation boundary.
- **Unrecoverable by design.** Lose the master password *and* the recovery key and the data
  is permanently gone. There is no backdoor and no vendor recovery path (see *Threat model*).

Module layout:

| Concern | Module |
|---|---|
| Pure crypto core (KDFs, AES-256-GCM, four envelope ops, `.gfvault` serialize/parse, TOTP) | `src/main/vault/vault-crypto.js` |
| Stateful store (`manager.json` + `.gfvault` persistence, MRK model, unlock lifecycle, rotations, export/import, delete) | `src/main/vault/vault-store.js` |
| Per-session automation vault context (fill-only) | `src/main/vault/vault-context.js` |
| Human fill orchestration (picker model, gesture fill, capture hold/settle) | `src/main/vault/vault-human.js` |
| Broadened capture-gesture classification + entry-ordinal resolution (main world) | `src/preload/vault-gesture-policy.js` |
| Password-field role classification (sign-in / sign-up / rotation) + login-scope widening | `src/preload/password-field-roles.js` |
| Generate-in-picker policy: `passwordrules` parser, `resolvePolicy`, `generateCandidates` | `src/shared/password-policy.js` |
| Isolated-world Generate-in-picker fill (`fillGeneratedForm`) | `src/preload/vault-fill-fields.js` |
| Isolated-world entry observer (detection, value-bound provenance, DD3h snapshot) | `src/preload/vault-entry-observer.js` |
| Main-world entry-tracker policy (install lifecycle, gesture-time snapshot read, fill routing) | `src/preload/vault-entry-tracker.js` |
| Item schema SSOT (per-type secret/non-secret maps) | `src/shared/vault-item-schema.js` |
| Origin matcher (exact vs. registrable-domain opt-in) | `src/shared/origin-match.js` |
| Vendored Public Suffix List resolver (shared with `trackers.js`, squawk 0035) | `src/main/psl.js` (+ `public_suffix_list.dat`) |
| Chrome-owned entry/display sheets | `src/renderer/menu-overlay.js` + `src/shared/vault-*-template.js` |
| MCP vault tools + audit | `src/main/automation/mcp-tools.js`, `mcp-server.js` |

## On-disk format

Everything lives under `userData/vaults/`:

- **`manager.json`** — one per profile, owned by `vault-store.js` (format id `gfmanager`,
  version 1 or 2 — see the v2 note below). It holds no item data — only the wrapped
  Manager Root Key and the KDF params (v1 shown):

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

  **The admin fields are optional at BOTH versions (M18 F2 Leg 1 for v2; relaxed to v1
  M18 F3 Leg 2).** A manager document may omit `mrk.admin` and `adminPublicKeyB64`
  entirely — an unprovisioned (or compromise-revoked, or never-minted-on-adopt) admin
  slot is a deliberate state, not corruption. When present they are validated identically
  at both versions, and they are present *together* or absent *together* (a lone seal or
  lone public key is malformed → `VaultFormatError`). v1 originally required the pair
  (every profile `setup()` writes it, so no legitimately-created v1 profile changes
  behavior); the relaxation is what makes a no-admin fresh adopt of a v1-effective bundle
  legal — see Portability below. The trade-off, accepted: a slot-deletion tamper on a v1
  manager now degrades to the no-admin *state* instead of a loud format error; envelope
  integrity itself stays GCM/AAD-protected regardless. Manager envelopes bind the
  *document's* stated version in their AAD, and a document's envelopes are always
  homogeneous: v2 is written only by operations that rewrite the full envelope set
  (compromise-mode rotation, and a bundle-driven fresh adopt whose bundle happens to be
  v2-effective); single-slot rotations preserve the document's existing version.

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

**KDF params validated on read (fail-closed).** `manager.json`'s KDF params are checked
against sane bounds on *every* read — not just on import — because `_readManager` calls
`validateImportedKdf(doc.kdf)` on the parsed document. Every unlock / rotate / recover /
export path funnels through `_readManager`, so an out-of-bounds parameter (an
attacker-lowered scrypt `N`, say) makes the manager **refuse to open** (fail-closed) rather
than silently deriving the master key under a weakened work factor. `setup()` is the only
writer of these params and only ever writes in-bounds values, so there is no legitimate
manager to repair — recovery from a tampered `manager.json` is by re-importing from a
trusted bundle. This closes the **silent-KDF-downgrade** vector: an attacker who lowered `N`
on the un-step-up-gated recovery path could previously weaken the master-password derivation
undetected; the read-path check now rejects it before any derive or write.

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
- **Credential sheets survive window blur (M18 F3 L1, operator ruling).** Every sheet that
  takes a TYPED secret — `vault-unlock`, `vault-set`, `vault-stepup`, `vault-import` (opened
  as `vault-import-unlock`), `vault-change-master`, `vault-recover`, `vault-compromise`, and
  `vault-compromise-recover` — keeps its half-entered field state through a window
  blur/refocus (app switch), so a value copy-pasted from another secrets manager isn't lost
  mid-paste. **Accepted trade-off: half-typed secret material persists in a blurred window
  until the operator submits, explicitly dismisses (Escape/Cancel/backdrop, where permitted),
  locks the vault, or closes the window** — those four still close every credential sheet
  exactly as before; only the incidental window-blur close is suppressed. Membership is a
  single shared allowlist (`src/shared/vault-blur-survival.js`), applied once at the chrome-side
  open funnel (`src/renderer/chrome/overlay-menus.js`) — never decided per call site. The
  dismiss-locked one-time-key displays above and the no-typed-secret `vault-capture` /
  `vault-picker` sheets are **not** part of this axis (the show sheets are already
  blur-immune via `dismissible: false`; the metadata-only sheets have nothing to protect).
- **Close on vault lock.** Locking the vault (manual, or the idle autolock timer) closes any
  open allowlisted credential sheet — the conservative answer once half-typed secrets can
  outlive an app switch: the operator walked away, so wiping in-progress new-master material
  is safer than leaving it live in a backgrounded window. **`vault-unlock` is exempt** —
  locking is its own precondition, not its invalidation, so a lock broadcast never closes the
  prompt the operator needs in order to unlock. `vault-recover` and `vault-compromise-recover`
  (both reachable from a locked vault) close like every other allowlisted sheet; the flow
  simply reopens from the locked state.
- **Sequential dismiss-locked one-time sheets (M17 F4 L3).** Opening a second sheet
  immediately after a dismiss-locked one-time sheet is NOT safe: `menu-overlay-manager.js`'s
  `openMenu` treats any open-while-open as a model-replace and fires `'superseded'` on the
  still-open sheet (its `if (currentMenu) { … }` branch), clobbering the first secret before
  it is acknowledged — a lockout-class trap for an unrecoverable value. Fresh-profile adopt
  (the first flow to surface two one-time secrets in one operation — a rotated recovery key
  and a rotated admin private key) establishes the idiom instead: stash the second secret,
  show only the first sheet, and chain the second on the first's explicit acknowledgment. See
  `src/main/register-overlay-ipc.js`'s `menu-overlay:vault-import` handler (`stashAdoptAdminKey`
  + the `vault-recovery-show` send) and its `menu-overlay:activated` handler (the
  `vault-recovery-show` branch that calls `takeAdoptAdminKey` and sends `vault-adminkey-show`
  only on that ack). Reuse this stash-then-chain shape for the next multi-one-time-sheet flow
  rather than opening both sheets in succession.
- **Human fill dispatch.** For a gesture fill, `vault-human.js` resolves the credential by
  `(vaultId, itemId)` under the MRK **in main** and hands `{ wcId, credential }` to the fill
  effect. The picker model and the activated selection are metadata / an index only — the
  password is read and dispatched solely in main, never in the model, the selection, or a
  return value.

**Accepted limitation — internal-page a11y gap.** The a11y audit drives the app over the MCP
surface, and the eval/observe tools exclude the internal session even for admin. So the
menu-overlay sheet states (including the vault sheets) *are* axe-audited, but the
`goldfinch://vault` page itself cannot be audited via `--target` — the settings-class a11y
gap the mission explicitly accepted. The page's item filter (Mission 22, Flight 1 — a
non-secret display-only narrowing field in the "Vaults" section, matching only the
non-secret metadata fields listed in `vault-item-schema.js`'s `SCHEMA[type].nonSecret`) is
page-side chrome, not a sheet, so it inherits this same gap; its accessible-name/role/status
contract and hidden-row-absent-from-AX-tree behavior are covered instead by the
`vault-filter` behavior test and an operator screen-reader spot-check.

## The MCP automation surface

Five tools expose the vault over MCP as a deliberately **fill-only** surface —
`vaultUnlock` / `vaultList` / `vaultTotp` / `vaultFill` / `vaultAnswerAuth`
(`src/main/automation/mcp-tools.js`).
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
- **`vaultAnswerAuth` mirrors `vaultFill`'s gates** (M14 F1) against the browser-owned HTTP
  basic-auth prompt: the same jar-membership check, then an origin match against the pending
  **challenge URL's** origin. On success the challenge's native callback resolves inside
  Goldfinch and a visible credential sheet closes; the credential is never returned —
  `{ answered, id, origin }` or a normal `{ answered: false, reason }` (`locked` /
  `no-challenge` / `no-match` / `origin-mismatch` / `ambiguous`). Client-certificate
  choosers are human-only — never visible to or answerable by this tool.
- **Metadata only.** `vaultList` returns `{ vaultId, id, title, origin, username, hasTotp }`;
  `vaultTotp` returns the current code only. No password, TOTP secret, or card data crosses
  the wire.
- **Session-scoped teardown.** A session's vault keys are Buffers, `.fill(0)`-zeroized on
  transport teardown (a graceful `DELETE` or a dropped SSE stream), with a per-session idle
  timer as a belt-and-suspenders backstop. There is no singleton coupling with the human lock
  in either direction — each holds its own fresh-buffer copies.
- **Audit surface = origin + unlock count, never a secret.** `deriveAuditDetail`
  (`mcp-server.js`) records the resolved fill **origin** for `vaultFill`, the item id +
  resolved **origin** for `vaultAnswerAuth`, the **count** of
  vaults opened for `vaultUnlock` (never the ids-as-secrets), and the item id for
  `vaultTotp` — and reads the `accessKey` / password / TOTP secret / vault key from neither
  the args nor the result.

## Origin matching

Fill matching is **exact-origin by default**. A per-item opt-in
(`matchMode: 'registrable-domain'`) widens a match to the registrable domain (eTLD+1) behind
a **fail-closed** matcher (`src/shared/origin-match.js`):

- Widening requires the same scheme *and* a non-null, equal registrable domain on both hosts,
  computed by a **vendored Public Suffix List** resolver (`src/main/psl.js`, parsing
  `public_suffix_list.dat`). Any uncertainty — a non-opt-in item, an unparseable/opaque
  origin, a scheme mismatch, or a PSL miss on *either* host — degrades to the exact
  byte-for-byte compare.
- The PSL resolver **deviates from the standard algorithm to fail closed**: where the
  reference applies an implicit `*` default for an unknown TLD, this returns `null`, so an
  unlisted suffix can never widen a fill. It honors both the ICANN and PRIVATE sections, so
  distinct multi-tenant tenants (`*.github.io`, `s3.amazonaws.com`, …) resolve to distinct
  registrable domains and never share a credential. IP literals resolve to `null`.
- **Staleness is *mostly* — but not purely — fail-closed** (corrected, PR#112 finding 10). A
  not-yet-listed suffix resolves to `null` → exact fill (safe). But a **new private
  (multi-tenant) suffix introduced beneath an already-known TLD**, while the vendored `.dat`
  predates it, over-collapses two tenants (`alice.newplatform.example`,
  `bob.newplatform.example`) to the same registrable domain and **widens a credential across
  them** — an *open* failure a stale list can cause. This is bounded by an **expiry gate**:
  once the snapshot (its `// VERSION:` header date) is older than `PSL_MAX_AGE_MS` (365 days),
  `registrableDomainSafe` returns `null` unconditionally, disabling *all* registrable-domain
  widening (every fill degrades to exact origin) until the `.dat` is refreshed. Keep the list
  current; staleness within the window is a small bounded residual, staleness beyond it is
  fail-closed by force. The custom PSL is still used because a curated tracker-classification
  suffix subset would over-collapse *unlisted* suffixes far more readily and leak across siblings.
- **Only the picker and fill paths widen** (`widen: true`); **credential capture stays
  exact** — a subdomain submit must never disposition as an update to an eTLD+1 item.

### Payment cards are NOT origin-matched (issue #152)

Everything above governs **logins**. A `card` item is deliberately **not gated on origin at
all** — neither exactly nor by registrable domain — and `reachableCardItems(jarId)` takes no
origin argument.

The reasoning is that the two families have different owners. A login belongs to the site that
issued it, so an origin match is the natural authorization and a mismatch is genuinely
suspicious. A payment card belongs to the **operator** and is legitimately presented at any
merchant; gating it on a stored origin would make a card unfillable at every shop the operator
has not already recorded — that is, all of them. This matches how dedicated password managers
treat cards, and it is the behavior the feature is for.

What still authorizes a card fill is every *other* gate the login path relies on, unchanged:

| Gate | Applies to cards? |
|---|---|
| Vault UNLOCKED | yes |
| Tab resolves a **persistent jar** (never a burner) | yes |
| Scope is the tab's own jar vault + the global vault | yes |
| **Top-frame only** (`webContents.send` + the guest-side `window.top` guard) | yes |
| Explicit per-fill operator selection in the chrome-owned picker | yes |
| Stored-origin match | **no — by design** |

Two structural properties keep this from widening anything else:

- **The branch is chosen by the STORED ITEM's own `type`**, inside `fillHuman`, after the item
  has been resolved from the vault under the MRK. Nothing the guest, the page, or the chrome
  sends selects it, so a hostile page cannot steer a login request onto the un-origin-gated
  path.
- **Cards ride their own main→preload channel** (`vault-fill-card`, distinct from `vault-fill`)
  because they land on different DOM anchors, and the guest-side gesture binding is
  **kind-tagged** — a login fill can never consume a card binding, or vice versa.

**Card capture** (a submitted payment form) adds one gate with no login equivalent: the
submitted number must be **plausibly a card** — 12–19 digits passing Luhn
(`src/main/vault/card-identity.js`). A password field is self-identifying and a password has no
checkable structure, but a card field is detected heuristically, so this is what stops a
false-positive detection from writing an arbitrary submitted form value into the vault as a
"card". Capture **identity is the full PAN** (digits-compared), never the last four — two cards
can share a last4, and dispositioning on it would silently overwrite a different card.

The card's PAN, CVV and expiry are **secret** per `vault-item-schema.js` and never leave main:
the picker row, the capture offer and the sheet carry only `title` / `cardholder` / `brand` /
`last4`. The **MCP automation surface stays login-only** — `vaultList` and `vaultFill` still
refuse non-login items, and the documented "never card data" guarantee in
`docs/mcp-automation.md` is unchanged by this work.

### Identity items (Mission 21, Flights 2-3)

A fourth item type, `identity` — one name/email/phone/address profile, at most one per vault.
**Flight 2 shipped the detector and the item type; Flight 3 wired fill, capture, and the
capture sheet into the live page** — `classifyCapture`/`identityProfileOf` (below) are called
live from `disposeIdentityCapture` (`src/main/vault/vault-human.js`). The Flight 2/3 split
mirrors Flight 1's own lesson: a single leg that tried to design detection, fill, capture *and*
the sheets at once would have repeated a mistake that cost Flight 1 six review rounds. Flight
3's own fill/capture mechanics (the two-icon placement, `isClaimedByCard`, the value-layer
admission gate, the `identitySecrets` buffer, the multi-hold presentation queue shared with
login/card) are documented in CLAUDE.md's Password vault pattern rather than duplicated here.

**Schema** (`src/shared/vault-item-schema.js`'s `SCHEMA.identity`) is conservative: only `title`
and `fullName` are non-secret (metadata a picker row can show without unmasking); everything
else — `firstName` / `lastName` / `email` / `phone` / `street` / `street2` / `city` / `region` /
`country` / `postalCode` — is secret, same as a login's password. Field names are the detector's
own role names verbatim (below), with no translation layer, so the schema and the detector cannot
drift on naming.

**Admissibility has neither of the other two families' anchors.** Login has a structural one
(`input[type=password]`); card has a narrow, well-known vocabulary plus a plausibility gate
(Luhn). Identity has neither — "name", "email", "phone", "address" are among the most common
words on the web — so admissibility is the entire security story
(`src/preload/vault-identity-fields.js`):

- **A SCOPE ANCHOR gates the form; token rules then gate the field.** A scope (a `<form>`, or the
  whole document for a form-less field) is an identity context only if it contains BOTH (1) an
  admissible **postal** role — `street`, `street2`, `postalCode`, or a PREFIX-qualified `city` /
  `region` / `country` (prefixes: `billing`, `shipping`, `delivery`, `mailing`, `contact`, `home`,
  `work` — one list, reused for `street`'s compound alternatives too, which settles
  `billingAddress`) — AND (2) a **non-postal** role: `fullName`, `firstName`, `lastName`, `email`,
  or `phone`. Absent either, the scope contributes NOTHING — not even fields that would otherwise
  resolve a role. Both conditions exist for a reason found only at design review, not at first
  draft: a postal anchor alone is not a person (a shipping-cost estimator — `zip` + `country`, no
  name — would otherwise qualify as an identity form), and a non-postal role alone over-admits a
  bare `email` field, which is one of the most overloaded widgets on the web (newsletter signup,
  contact form, password reset, "email a friend" — none of them identity contexts).
- **`address` is NEVER admissible bare** — neither at the anchor nor as a field, always prefixed
  or compound (`address1`, `addr1`, `streetAddress`, `address-line1`, `billingAddress`, …). A bare
  `{address}` alternative would create a reachable TIE: `emailAddress` tokenizes to
  `["email","address"]`, which would match `email`'s `{email}` and a bare street `{address}` at
  EQUAL length, decided by whichever the code happens to check first — exactly the ambiguity the
  next point exists to remove. (Found in two passes: round 1 of design review made bare
  `address` non-anchor-eligible, which stops it from anchoring a scope on its own; round 2 found
  that protects only the ANCHOR phase and leaves the identical tie reachable at FIELD-role
  resolution once some other field has already anchored the scope — closed by dropping bare
  `address` from the vocabulary entirely, not just from anchor-eligibility.)
- **Matching is ALTERNATIVES, not a flat token set.** A role is a list of alternatives, each an
  all-tokens-required set; matching is conjunctive WITHIN an alternative, disjunctive ACROSS
  alternatives (and across roles), and the alternative matching the MOST tokens wins
  (`fallbackResolution`). A flat token set cannot reach the motivating page's own street field —
  `billingAddress1` tokenizes to `["billing","address1"]`, which contains no bare `"address"`
  token at all — and cannot tell `firstName`/`lastName`/`fullName` apart, since `billingFirstName`
  and `billingLastName` both carry a `"name"` token; only alternative length (`{first,name}` at 2
  tokens beating `{name}` at 1) disambiguates them.
- **The vocabulary is written TWICE, in two structurally different tables — this is a trap, not
  an oversight, and a future edit must not "consolidate" them.** Autocomplete VALUES are resolved
  by `resolveAutocompleteToken`, which splits only on whitespace — a hyphen survives, so
  `AUTOCOMPLETE_ROLES` is written as literal (possibly hyphenated) WHATWG token strings like
  `'postal-code'`. Name/id FALLBACK haystacks go through `normalizeFieldHaystack`, which turns
  BOTH `-` and `_` into spaces before matching — so `ROLE_ALTERNATIVES` must be written as
  already-split, hyphen-free token arrays (`['postal', 'code']`). A literal `"postal-code"`
  pasted into `ROLE_ALTERNATIVES` would be a DEAD ENTRY that can never fire, silently — the
  fallback token set never contains a hyphenated string. The shared tokenizing primitives
  themselves (`normalizeFieldHaystack`, `resolveAutocompleteToken`, `fieldHaystack` — the
  name/id/placeholder/aria-label haystack builder) live in the family-agnostic
  `src/preload/field-tokenizer.js`, extracted from and now also consumed by
  `vault-card-fields.js`, so card and identity read the identical four attributes and cannot
  silently drift on which ones feed detection.
- **Login wins a contested field.** `resolveLoginEntry` (`vault-fill-fields.js`, untouched by this
  work) picks the login username as the LAST text/email/tel input preceding a password field, by
  DOCUMENT POSITION ONLY — it never reads name, id or autocomplete. So any identity-admissible
  field sitting before a password is claimed by login regardless of spelling; the contest is
  structural, not a naming coincidence. `isClaimedByLogin` (built on the already-exported
  `findAllLoginFields`) filters every login-claimed field out of identity's candidate list BEFORE
  role resolution — including as the scope's own anchor candidate, so a scope whose ONLY
  street-shaped field sits immediately before a password loses its anchor entirely, not just that
  field's role.
- **Named accepted false positive.** A form carrying a third party's address plus the reporter's
  own name and email clears every gate above. The detector's founding principle — nothing is
  inferred from shape, position or value — structurally forbids the one signal (label proximity)
  that could tell whose address it is, so this shape is irreducible to a vocabulary-only detector.
  Accepted rather than pretended away; the backstop is the conflict rule below, which guarantees a
  differing captured value never silently overwrites a stored one.

**One profile per vault, enforced at every write path, not only the interactive one.**
`_saveItem` refuses outright (no write at all) when saving an `identity` item that has a
different id from an already-stored profile — a straightforward caller error there, since a human
editor can ask "which one did you mean." The two BULK write paths cannot ask that, so they use a
weaker, non-interactive rule instead: `mergeVaultItems` KEEPS the destination's existing profile
and reports the incoming one as skipped (never as a conflict copy, which is exactly how every
OTHER item type diverges — landing a second identity item as a copy would recreate the very
one-profile invariant this rule exists to protect), and `capSingleIdentity` caps a bundle's own
item array to at most one identity item before it is ever compared to a destination (used at
`_importVault`'s writes and at `restoreProfile`'s COMMIT and PREVIEW). All three read the same
canonical accessor, `identityProfileOf(items)` (`src/main/vault/identity-profile.js`) — never
`items.find(it => it.type === 'identity')`, which would silently pick whichever item sorts first
and hide a duplicate instead of surfacing one via the accessor's `extra` return.

**Bundle import is now tolerant of unknown item types, and REPORTS them.** A new sibling to the
existing (unchanged, still strict) `validateImportedItems`, `partitionImportedItems` drops any
item whose `type` isn't recognized and records its type name in a deduplicated `skippedTypes`
list instead of throwing — at all three call sites that decrypt and validate a bundle's items:
`_importVault`, `restoreProfile`'s COMMIT (which additionally now catches per-entry, so one
malformed or unrecognized entry no longer aborts an entire multi-vault restore including vaults
that already landed), and `restoreProfile`'s PREVIEW (so the Secret step's `itemCount` never
silently under-counts before any destination is even chosen — filtering silently at preview would
itself be the swallow this rule forbids). **This deliberately softens Mission 18's "load loudly"
stance, but ONLY for these three bundle-import call sites** — `validateImportedItems` itself is
unchanged, and the `.gfvault` PARSE path (which never called it in the first place) keeps loading
loudly on any malformed vault. A merge collision on an identity profile (previous bullet) folds
into this SAME `skippedTypes` array rather than a second reporting mechanism.

**`classifyCapture(stored, captured)`** (`src/main/vault/identity-profile.js`, pure; its live
caller is `disposeIdentityCapture`, Mission 21 Flight 3 Leg 4) is the conflict rule made real and
unit-tested rather than left as a paper decision: `{ kind: 'match' | 'gap-fill' | 'conflict', gapFilled: [{field, to}],
conflicting: [{field, from, to}] }`. Only fields PRESENT in the capture are judged. Equality is
BYTE-EXACT — no trimming, no case-folding, no normalisation — so `"555-1234"` vs `"5551234"` IS a
conflict; softening that would be a judgement call this module has no business making silently.
`kind` is `'conflict'` if any field conflicts (an operator-facing "here's what would change, never
overwritten silently" prompt), else `'gap-fill'` if at least one gap was filled (an offer to
merge), else `'match'` (no offer). **Named residual, stated rather than hidden**: on a FRESH
profile every captured field is a gap, so the rule's own motivating scenario — a gift-shipping
checkout carrying a stranger's name and address — classifies as an ordinary gap-fill merge if it
happens to be the very first identity capture the vault ever sees. Still an offer, never a silent
write, so the rule's hard invariant holds; it just doesn't catch its own headline case in that one
situation.

**Four type sources must be edited in parallel to add (or change) an item type — not one
cascading into the other, and the fourth is easy to miss.** `vault-item-schema.js`'s `SCHEMA`;
`vault-store.js`'s own independent `ITEM_TYPES` `Set` literal, checked at three separate call
sites; `vault-editor-model.js`'s `EDITOR_LAYOUT` / `EDITOR_TYPES`, pinned to the schema by an
`assert.deepEqual` drift-guard test that goes red the moment a type is added to the schema until
the editor layout gains a UI label for every one of its fields; and `vault.js`'s
`ITEM_SUBSECTIONS`, a separately hardcoded list that renders only the types it names. That fourth
one is the trap: `partitionItemsByType` learning a new type buckets an item of that type
correctly — but if `ITEM_SUBSECTIONS` doesn't also name it, the bucket is simply never rendered,
and the item is not `unknown` either, so it also misses `renderUnknownItems`'s "nothing
unbucketable is silently lost" guarantee. It would ship as a correctly-stored, invisible item.
This was found at design review, not by any test.

**The MCP automation surface stays login-only for identity too, structurally, with no code
change required.** `vault-context.js` filters every vault-tool resolution (`listItems`, the
`vaultFill`/`vaultTotp` item lookup) to `item.type === 'login'` — the same mechanism that already
excludes `card` items. `vaultList` and `vaultFill` therefore never see or expose an identity
profile.

### The save moment: broadened capture, value-bound provenance, and the null-username collapse

Mission 21, Flight 1 replaced the original single-`submit`-listener capture trigger
(`webview-preload.js`) with a broader one: a trusted `click` on any button-like element (no
`type` requirement — the motivating shape is a plain `<button>` OUTSIDE every `<form>`, wired to
a JS click handler and posting via fetch/XHR), or a trusted `Enter` keystroke while focus is in a
field. Broadening the trigger past a structurally-unambiguous `submit` event meant the *value*
axis needed its own defense, since a page can dispatch a same-origin script-authored click far
more easily than it can forge a real `submit`.

**Value-bound provenance is that defense.** A field's value is admitted into a capture snapshot
**only if** the field carries operator provenance, and that provenance is bound to the **exact
string** it certifies:

- Provenance is **granted** at the instant of a trusted `input`/`keydown` on the field, or a
  Goldfinch-originated fill (`src/preload/vault-entry-observer.js`, running in a dedicated
  **isolated world** immune to main-world prototype/accessor spoofing — `vault-fill-fields.js`'s
  own `setFieldValue` proves a page can write `.value` and dispatch untrusted events with no
  trusted event at all, which is exactly what value-binding closes).
- At snapshot time, the field is admitted **only while its live value still equals the value
  recorded at the granting instant**. A mismatch — the operator typed something, then a script
  silently overwrote it — is treated as **unprovenanced, never as "trust the newer value."** A
  field that was never granted at all is likewise absent, never an empty-or-untrusted value used
  anyway.
- Provenance is also **bounded in time** (15 minutes, `PROVENANCE_TTL_MS`) — an active timer
  evicts a grant on expiry, alongside the existing eviction on field detachment, value change
  (implicit in the equality check), and document unload. This is a genuinely **worse** exposure
  profile than the pre-flight design (a plaintext password previously existed only transiently
  inside one synchronous `submit` handler; the isolated world's provenance map now holds a
  plaintext string for a bounded window, with more un-zeroable hops before the `Uint8Array`
  encode) — stated as a deliberate, bounded trade-off rather than claimed as parity.

**The wire shape is three-state, not binary**, per detected field: `{ detected: true, value }`
(provenanced and matching), `{ detected: true, value: null }` (detected but unprovenanced or
mismatched), or the key **absent entirely** (never detected at all). The third state matters
because `normUsername` (`vault-human.js`) deliberately collapses `''`/`null`/`undefined` into a
single `null` bucket, so that a genuine password-only submit compares equal to a stored
null-username item — correct behavior for that case. Left unaddressed, an
absent-because-unprovenanced username would land in the SAME bucket, letting a page suppress
provenance on a real username field and steer disposition into matching (and overwriting) an
unrelated stored item that happens to have no username. **The fix**: the capture payload carries
an explicit `usernameDetected: boolean`, separate from the (possibly-null) `username` value —
"a username field was detected on the page" is not the same claim as "that field's value is
trustworthy." When `usernameDetected` is true and `username` is null, disposition may only offer
`save`, never `update` — applied as a downgrade immediately AFTER the ordinary disposition
computation (`disposeCapture` itself is unmodified). When NO username field was detected at all,
existing null-username matching is unchanged. Never overwrite; a duplicate save is the
recoverable failure mode.

**Read at gesture, release at settle.** The isolated-world snapshot is read via a same-process
`webFrame.executeJavaScriptInIsolatedWorld` call issued synchronously in response to the trigger
gesture — never at settle, since a navigation's `did-navigate` fires AFTER the new document
commits, by which point the old page's isolated world (and its provenance map) no longer exists.
The read result is held **main-side**, in a new `mode: 'pending-settle'` capture record
(`vault-human.js`), distinct from `mode: 'locked'` — until "settled": a per-tab navigation
commit, or a preload-reported field detachment (the SPA case, where a submit handler
`preventDefault()`s and posts via fetch with no navigation). A gesture that never settles — a
decoy Cancel button, a flow that neither navigates nor removes its fields — is dropped, silently,
never offered; the existing `CAPTURE_DROP_MS` safety-timeout continues to cover this new held
state via the same drop choke point Leg 1 hardened (vault lock, window close, tab close, TTL).
Origin is derived and **frozen at gesture time** — never re-derived at settle, since the tab may
already show a different origin by the time a navigation-commit settle fires.

### Password-field roles: sign-up, sign-in, and rotation

Mission 21, Flight 4 fixed a live defect: on a change-password form (current + new + confirm),
the capture pipeline read the FIRST password field in the form — the CURRENT password — so a
rotation would have saved the OLD one. `src/preload/password-field-roles.js` classifies every
password field in a login **scope** (a `<form>`, or the whole document for form-less fields) as
`current`, `new`, or `confirm`, using three layers in order:

1. `autocomplete` — `new-password` → new, `current-password` → current; a SECOND
   `new-password` field in the same scope resolves `confirm` (the WHATWG-recommended way real
   sign-up forms mark both the password and confirm-password fields).
2. Name/id/placeholder/aria-label tokens, for whatever layer 1 left unresolved (confirm > current
   > new precedence within one field — `confirmNewPassword` resolves confirm, not new).
3. Structure, for whatever layers 1-2 left unresolved: three fields → current + new + confirm in
   document order; two fields → current + new if either already resolved current, otherwise new +
   confirm; one field → no structural signal.

A scope with nothing resolved at all (or exactly one field resolved null/current) is `sign-in` —
capture is byte-identical to before this flight, including for a single field whose
`autocomplete` LIES about being `new-password` (it still captures as a sign-in, and — because a
one-field scope never carries a `current` role — it can never reach the rotation-disposition
match below). A scope that resolves to exactly one `new`, at most one `current`, at most one
`confirm`, and no unresolved field is `classified`; anything else is `ambiguous` — a MISSED
capture, never a wrong value (a fully unmarked two-field current+new form is the one named,
accepted gap: indistinguishable from new+confirm, so it captures nothing).

**On a classified scope**, the planner captures the `new` field's provenanced value, admitted
only when a present `confirm` field is ALSO provenanced and byte-equal to it (a mismatch, or an
unprovenanced confirm, means no login is captured at all — the site will reject the submit
anyway). When a `current` field exists and is provenanced, its value rides the capture too, as a
second secret alongside the new password.

**Rotation disposition.** A capture carrying a current-password value is matched against the
operator's stored logins BEFORE the ordinary origin+username rule: main reads every reachable
login's full stored item and looks for one whose password equals the captured current value
byte-for-byte (and whose username agrees, when the capture's own username was provenanced).
Exactly one match → the existing item is UPDATED with the new password — this is what makes a
change-password form with no username field at all resolve correctly, instead of filing the
rotation as a brand-new username-less login. Zero or several matches fall back to the ordinary
rule unchanged (never guess among several current-password matches). The matched row's own
username is preserved on the update even when the change-password page itself showed no
provenanced username — a rotation never silently blanks a stored username.

### Generate in picker

Clicking the in-field badge on a field whose scope classifies as a sign-up or rotation `new`
field (see above) offers **"Generate strong password"** as the first row of the same picker —
even while the vault is **locked**. Choosing it:

1. Main generates a CSPRNG password honouring the field's `minlength`/`maxlength` attributes and
   its `passwordrules` attribute (a strict subset of the WebKit proposal: `required:`/`allowed:`
   classes and `[...]` custom sets, `minlength:`/`maxlength:`/`max-consecutive:`; any syntax error
   voids the whole attribute rather than partially applying it). Availability (the "Generate" row
   shows at all) and generation are decided by the SAME function, `resolvePolicy`, run twice — once
   at the gesture (to decide whether to offer the row) and again when the row is chosen (never
   trusting what the chrome was told earlier).
2. Main sends TWO candidates to the guest in one message — a full-policy password and an
   alphanumeric-only fallback — so a page's `pattern` attribute (evaluated ONLY in the guest, never
   main-side, to avoid running a page-supplied regex in the browser process) can pick whichever one
   it accepts without a second main round-trip.
3. The guest fills the generated value into the scope's `new` and (when present) `confirm` fields,
   in the isolated world, granting provenance in the same call — never `current`, never a username.
4. The ordinary broadened-capture gesture (a submit-button click, same as a typed password) then
   captures the generated value through the exact same save path described above — including the
   rotation-disposition match when the form also has a provenanced current password.

**The chrome never receives or holds the generated password at any point** — the picker's
"Generate strong password" row is a fixed, non-secret action id, never a credential row; the
`vaultFillGenerated` bridge call carries only the (re-validated) field constraints out, and only
`{ filled: boolean }` back. Generation is fill-only-on-decorator: it is NOT exposed on the MCP
automation surface (the automation vault-human dependency block never receives the generate fill
delegate).

A stale gesture (the picker sat open past the fill-target's 60s TTL, or the page mutated the form
between the gesture and the fill) fills nothing — deliberately, with **no first-field fallback**
unlike the ordinary login fill: a generated password landing in the wrong form is worse than no
fill at all.

## Portability

Two generations of the export/import surface coexist. `exportVault(target)` /
`importVault(bundle, opts)` are the original **single-vault** ops (bundle format
`gfvault-bundle`, version 1 — the mission's "Option A"); `exportProfile()` /
`restoreProfile(bundle, opts)` (M18 F3, Multi-Vault Portability) are the **whole-profile,
multi-vault** ops (bundle version 2) layered on the same format id and the same adopt
core. `restoreProfile` also accepts a v1 bundle, normalizing it internally to a one-row
v2 shape — the "one-row case" of the same flow.

**`exportVault`/`exportProfile`** both require the manager unlocked as a policy choice
(every input is already on disk) and take **no password**. Everything carried is
ciphertext:

- the manager's MRK envelopes — `master` and `recovery` always; the `admin` envelope +
  the admin **public** key (`adminPublicKeyB64`) only when an admin key is provisioned
  (a no-admin manager, e.g. after a compromise-mode rotation or a no-admin adopt, exports
  without them),
- the KDF params,
- the source manager's stated version (`managerVersion`; absent ⇒ 1 in old bundles) — the
  envelopes are AAD-bound to it, so import unwraps at the bundle's stated version,
- `exportVault`: the target `.gfvault` document (its `mrk` envelope + item ciphertext) —
  keyed by the target's plaintext `sourceVaultId` (legacy, single-vault, unchanged; see the
  bundle-identity-opacity note below).
  `exportProfile`: an array of `{ entryHandle, identity, vault }` entries — the global vault
  plus every jar vault that **exists on disk** (a lazily-never-saved jar vault is simply
  absent; the array itself names what was carried). **Bundle identity opacity (M18 F3 Leg
  5):** each entry is keyed by an opaque `entryHandle` (a random token, minted at export,
  carrying no identity) instead of a readable id, and EVERY entry — including the global
  vault — carries its identity (`{kind:'global'}` or `{kind:'jar',name,color}`; everything
  else on the jar record is destination-local) as an **encrypted** `identity` envelope, keyed
  off the bundle MRK via the same generic wrap primitives the MRK envelopes use
  (`deriveHkdfKey` + `wrapVaultKey`, AAD-bound to the bundle context + the entry's OWN
  entryHandle) — nothing human-readable, including which entry is global, appears before the
  bundle secret is entered. (The embedded `.gfvault` document's own `vaultId` field is also
  scrubbed to the entryHandle before embedding — it otherwise duplicated the same leak one
  level down and plays no role once inside a bundle.) `decryptIdentity` is the paired reader
  (a tampered envelope fails GCM authentication loudly, never a silent unnamed jar, and
  independently refuses a plaintext-tagged envelope — see the v1 note below);
  `restoreProfile` itself never reads `identity` — the caller's explicit mapping step
  supplies `newJar.{name,color}` instead. `exportProfile()` returns `{ bundle, carried }`:
  `bundle` is the file-shaped object; `carried` is a parallel, MAIN-PROCESS-ONLY list of the
  real jar/Global names actually carried (never serialized into the bundle file) that the
  export-completion notice uses. A v1 bundle carries no such opacity: its single
  `sourceVaultId` is plaintext, an unchangeable property of the legacy single-vault format —
  `restoreProfile`'s v1 normalization synthesizes a fresh `entryHandle` plus a PLAINTEXT
  `identity` tagged `identityPlaintext: true` (an internal marker `normalizeRestoreBundle`
  writes only on that path and never reads from an incoming bundle, so a v2 JSON entry cannot
  smuggle the tag to bypass authenticated decrypt); the uniform identity-resolution step uses
  that plaintext value as-is instead of decrypting.

No plaintext secret ever enters the bundle. Carrying the MRK envelope set preserves
recovery-key (and, when provisioned, admin) portability on the far side.

Both import paths do all crypto **before any write** (a wrong secret throws and
writes/installs nothing). The source **master password** (a Buffer) or the source
**recovery key** (a base32 display string) opens the bundle:

- **Fresh profile** (`!isSetUp()`): **adopt** the bundle's manager, but not verbatim — a
  fresh adopt **forces a recovery rotation** before the profile is usable, and **mints no
  admin key at all** (the adopt-no-admin change; both `importVault`'s fresh branch and
  `restoreProfile`'s fresh branch route through the same shared adopt core, so they stop
  minting admin at the same commit). Every carried vault is written first (`restoreProfile`:
  in per-vault directive order; `importVault`: to `global`, the only target resolvable on a
  jar-less fresh profile) — so a failure never flips `isSetUp()` true without at least the
  vaults that landed; then, still under the bundle's live MRK, mint a fresh recovery key and
  write **that** envelope (`mrk.recovery`) into the adopted `manager.json` instead of the
  donor's, with **no** `mrk.admin` and **no** `adminPublicKeyB64` at all — so the donor
  retains neither the recovery key nor any admin access into the adopted vault, and the
  adopted profile simply has no admin key to retain or discard, ever. The donor's
  `mrk.master` envelope is carried over unchanged (see the master-residual note under
  Rotation & recovery and the threat model), so the source **master password** still
  unlocks the adopted profile on restart — but the source **recovery key is rotated away**
  and no longer opens it. This is legal at **either** manager version the bundle carries
  (v1's admin-optional relaxation above is what makes a no-admin v1-effective adopt valid —
  the mission's default, never-rotated-profile scenario). Finally install the MRK (leaving
  the profile unlocked). The new one-time recovery key is the only secret the adopt result
  surfaces; the profile stays unlocked until it is acknowledged.
- **Existing profile** (set up + unlocked): **re-key** the source vault key under the
  destination profile's own MRK at the resolved destination target; a collision is refused
  unless `overwrite` (`importVault`) or an explicit `mode: 'replace'`/`'merge'` directive
  (`restoreProfile`). The transient bundle MRK and vault key are zeroized — `restoreProfile`
  holds at most ONE bundle vault key live at a time across its per-vault loop (stricter than
  `changeMasterPassword`'s collect-then-zeroize-in-one-`finally` shape, which needs to hold
  every rotated key at once for its batch-then-one-write shape; this loop writes each vault
  immediately, so there is nothing to batch).

`restoreProfile` additionally: takes an explicit per-`entryHandle` directive
(`'existing' | 'new' | 'skip'`, with `mode: 'replace' | 'merge'` on a collision) — every
bundle vault demands one, loudly, before any write; commits **per-vault atomically** (DD3),
so a mid-list failure (today: a `'new'` directive whose jar registration doesn't durably
verify) leaves earlier vaults landed and later ones untouched, with the manager left absent
on a fresh profile so a rerun re-adopts over the residue; **merges non-interactively** on
id identity (same id + identical content skips; same id + differing content lands the
incoming item as a marked copy under a fresh id; different ids always coexist — zero data
loss, no picker); is guarded by an **instance-level single-flight lock** in addition to the
usual gate, since two concurrent restores are not otherwise mutually exclusive; and returns
an ordered per-vault result plus a **generation** field (`{ completedAt, nonce }`) that
distinguishes one restore's evidence from another's.

### The restore workflow (multi-vault, M18 F3 Leg 3)

The vault page exposes **one** workflow behind both its entry points (the not-set-up page's
"Import a vault bundle" and the Settings section's "Import…") — five steps, each holding no
more state than it needs:

1. **Pick.** The page runs the open dialog (main-side), reads + parses the bundle, and HOLDS
   `{ bundle, handle }` main-side, keyed by the owning window's chrome id. No destination is
   picked here — that decision moves entirely to step 3.
2. **Secret.** Continue opens the chrome-owned `vault-import-unlock` sheet, which runs a store
   **preview** — the master password or recovery key, verified by unwrapping the bundle MRK,
   with per-vault item counts and jar names/colors decrypted (decrypt-then-discard: nothing is
   written, no destination is resolved). A malformed *plaintext* bundle (GCM-authentic
   ciphertext whose decrypted content fails validation) is refused **here**, before any
   destination exists to write to. On success the sheet closes and the page is notified
   (`vault-import-labels-ready`, no payload); the page then fetches its own window's labels —
   `{ entryHandle, identity, itemCount }` per bundle vault, never a secret or the ciphertext,
   and never the entryHandle shown to the operator (the page renders the decrypted name).
3. **Mapping.** The page renders one row per bundle vault: skip / create a new jar (name+color
   prefilled from the label) / use an existing vault, with an explicit Replace-or-Merge choice
   once a real destination collision is confirmed. Every row demands an explicit directive
   before Commit enables. The verified secret is held (Buffer, main-side) for up to **five
   minutes** past the secret step — a bounded safety-drop timer (the `vault-human.js`
   captured-credential precedent) — so the operator can read labels and decide without being
   rushed, but a bundle secret never lingers indefinitely; if it expires, Commit gets a loud
   "start over" refusal and the whole flow re-enters from Pick (no partial write, ever).
4. **Commit.** The page sends `{ handle, mapping }`; main consumes the held record (the
   verified secret + the operator's directives), runs `restoreProfile`, zeroizes the secret,
   and returns the per-vault outcomes + the generation field. A fresh adopt's one-time
   recovery key is shown on the dismiss-locked `vault-recovery-show` sheet — stashed
   main-side *before* that sheet is opened, so the reveal survives even if the window dies
   mid-send (the same window-death-safe stash/ack/resurface machinery compromise-mode
   rotation uses; adopt's recovery reveal now rides that SAME store, distinguished only by an
   internal reason tag — there is no separate admin-key reveal chain any more, because a
   fresh adopt no longer mints an admin key at all, see Portability above).
5. **Sever offer.** Every fresh adopt additionally surfaces a dismissible session card on the
   vault page: "The previous owner's master password still opens this profile — set your own?"
   (see the threat-model bullet below). Its action reuses the existing change-master or
   recover flow (whichever the adopt's `secretKind` and the current lock state make
   reachable) — no new sheet, no new store operation.

**Held-bundle lifetime.** The held record (and any verified secret it carries) is dropped on:
vault lock (manual or idle — autolock is never suppressed for a held bundle), the owning
window's close, the vault page's own `pagehide` (best-effort — the safety-drop timer above is
the authoritative bound, not this), the safety-drop timer's expiry, an explicit cancel/dismiss
at either the pick or the mapping step, and a successful commit. Re-entering the secret always
fully resumes the flow from Pick — unlike a one-time reveal, nothing about a held bundle is
ever unrecoverable.

**A lock-state broadcast closes the mapping modal in every window it reaches** (the shipped
autolock-mid-modal invariant — every vault-page modal closes on every `vault-lock-state` push,
without exception, so no stale modal can ever survive a security event). A *forced* close this
way does **not** drop the held record (only the lifetime matrix's own paths, above, do) — the
page instead offers a cheap "Resume restore" affordance that re-enters the mapping step from
the still-held record, with no secret re-entry. An explicit Cancel, by contrast, drops the
record and the affordance disappears with it.

**Export** (the vault page's Export modal) offers a source choice: **whole profile**
(`exportProfile`, the DEFAULT — one bundle, one secret) or a **single vault** (`exportVault`,
global or any jar). Leg 3 (DD1 ruling 7) had made the modal whole-profile-only; the operator
vetoed that at the HAT (M18 F3 L4, HAT fix 1) and asked for both choices back, restoring the
modal's pre-leg-3 per-vault source picker alongside the whole-profile default. The jars page's
delete-time "Export this vault first" offer remains a separate, always-single-vault caller of
`exportVault`, untouched by either leg.

### Browser import (Chromium browsers)

Mission 19's Browser Credential Import (Flight 1, generalized to the Chromium family in
Flight 2) adds a **second, unrelated** import surface alongside the portable-bundle
restore above: importing a Chromium-family password-manager CSV export (Chrome, Edge, or
another Chromium browser's password manager → Settings → Export passwords) directly into
a vault. It shares no code, no held-record store, and no page modal with restore — the
two are deliberately kept apart (a plaintext CSV has no secret to unwrap, so there is no
chrome-owned secret sheet in this flow at all — "chrome-owned" there is goldfinch's own
window-chrome, unrelated to the browser).

**Mechanism.** The vault page's "Import from a browser…" button (Settings → Import /
Export, unlocked only) opens a pick modal that runs a main-side `dialog.showOpenDialog`
(`src/main/vault/browser-import-flow.js`, `createBrowserImportFlow`). The picked file is
read as a **Buffer** (never a `utf8` string — the read Buffer IS the plaintext credentials
from the moment it exists) and size-capped before parsing (`MAX_PAYLOAD_BYTES`, 16 MiB,
`src/main/vault/browser-import.js`); a hand-rolled RFC-4180 parser
(`src/main/vault/csv-parse.js`) and a header-based export detector reject an unrecognized
or oversized file loudly, never mis-parsing it. The detector (internally still named
`detectChromeExport`/`CHROME_HEADER` — an acceptable, non-user-facing naming choice, M19
F2 DD2) keys on the exact header `name,url,username,password,note`, which is the header
the whole Chromium family shares — a real Edge export was verified byte-identical to
Chrome's (M19 F2 DD1), so it passes the same detector unchanged. Accepted rows adapt into
`login` candidates via the DD3 content-identity dedupe (origin + username), with
degenerate rows (a federated/no-password entry, a non-web `android://` origin, a
malformed row, an over-length field) accounted for as a skip reason — never silently
dropped, never fatal to the whole import. The operator then picks a destination (Global
or any persistent jar) and, for a non-empty destination, Replace or Merge — the same
choice restore's mapping modal offers, reusing `restoreDestinationOptions`
(`src/shared/vault-page-model.js`) for the jar-row half.

**Held-payload lifetime.** The read Buffer is held main-side in its own store
(`src/main/vault/pending-browser-imports.js`, `createPendingBrowserImportStore` — a
SIBLING of the restore held-import store, not a shared instance: the restore store's
record shape and untimed hold are pinned to their own contract, and a browser import has
no secret step to arm a timer at, so this store arms its safety-drop timer (5 minutes)
**at hold**, not later) — never sent to the page. It is dropped, and the payload
zeroized, on: vault lock (manual or idle), the owning window's close, an explicit
cancel/dismiss at either the pick or the destination step, the safety-drop timer's
expiry, and (via the commit's own `finally`) a successful or refused commit. The page's
own `pagehide` also best-effort drops it (no delivery guarantee — the safety-drop timer
is the authoritative bound, same idiom as restore).

**The native-confirm commit gate.** Because this flow has no chrome-owned secret sheet,
it has no equivalent of restore's sheet-as-commit-gate either — so the commit is instead
gated by an **awaited, main-side native `dialog.showMessageBox`** confirm, stating the
destination and, for Replace, the exact count of existing items it will delete (a FRESH
`listItems(target).length` read, taken immediately before the confirm renders — never the
page's display-only presence snapshot, which can be stale by the time the operator acts
on it). The confirm is awaited **before** the held record is consumed (`pending.take()`):
`showMessageBox` does not block the event loop, so a lock or window-close firing while the
dialog is open must still be able to drop the payload through the normal fan-out — taking
the record first would strand it, un-timed, in the handler's local scope until the
operator dismissed. A declined confirm leaves the record held (the operator can pick a
different destination and retry, bounded by the same 5-minute timer); an accepted one
re-checks the record is still held (a concurrent lock could have dropped it during the
await) before proceeding.

**Why the confirm is load-bearing, not cosmetic (mirrors the DD13 automation finding
below).** Removing the chrome sheet from this flow also removes the sheet's automation
refusal as an incidental commit gate. Two facts hold instead, at *every* tier including
admin: (a) the native open-file dialog has no automation surface, so no tier can
*initiate* an import; (b) a native `dialog.showMessageBox` likewise has no automation
surface, so no tier can drive the commit's operator-affirmative click — an admin-driven
`evaluate` in the vault-page realm can read the held handle and call the commit IPC
directly, but the write still will not proceed without a real click on the native dialog.
Credentials never leaving main (the plaintext payload is held main-side and never crosses
to the page) is the read-side half of this guarantee; the native confirm is the write-side
half.

**The plaintext-file bounded exception.** Unlike every other vault surface, this feature's
whole *point* is to read an operator-supplied plaintext-credential file from disk — the
vault's "goldfinch writes no plaintext" guarantee is about what goldfinch **produces**, not
about the export file the browser already wrote. The completion modal's final line states this
plainly: "Delete the exported CSV file now — it contains your passwords in plain text."
Goldfinch itself never writes a plaintext copy of it anywhere; the read Buffer lives only
in memory, zeroized on every exit path above.

**Automation refusal.** No MCP tool can name this feature (the tool-name boundary test
asserts no tool matches `/import|csv|chrome|browser/i`, excluding the pre-existing
`getChromeTarget`), and `src/main/automation/**` contains zero references to the flow
module or its four IPC channel names — the same structural, at-every-tier refusal the
DD13 discussion above describes for the confirm gate.

## Rotation & recovery

The four **single-slot** rotations require the manager unlocked and a **step-up re-auth**,
rewrite exactly **one** `manager.json` slot, and never re-key the MRK — item ciphertext,
the other MRK slots, and every `.gfvault` file are untouched. (**Compromise mode**, below,
is the deliberate exception: it re-keys everything.)

| Operation | Step-up | Effect |
|---|---|---|
| `rotateRecovery` | master-password re-unwrap | mints a fresh recovery key, re-wraps `mrk.recovery`, returns the new one-time display |
| `changeMasterPassword` | **old**-password re-unwrap | re-wraps `mrk.master` under the new password |
| `recoverMasterPassword` | the **recovery key IS the step-up** | works **from locked**: the recovery key unwraps and installs the MRK (leaving the user unlocked), then re-wraps `mrk.master` under a new password |
| `rotateAdminKey` | master-password re-unwrap | mints a **fresh** X25519 keypair unconditionally (also the from-scratch provision), re-seals `mrk.admin`, overwrites `adminPublicKeyB64`, returns the new one-time private key; the prior admin key can no longer unwrap the MRK |

`recoverMasterPassword` is a single dedicated op — not an `authenticated` flag on
`changeMasterPassword` (which would bypass the old-password step-up). `rotateAdminKey` mints
anew every time because F3's setup-minted admin private key was discarded; both the sealed
envelope **and** the stored public key are overwritten together (a stale public key would
mismatch the seal and corrupt a subsequent export).

**Compromise mode (`compromiseRotate`, M18)** is the one rotation that *does* re-key the
MRK — the answer to "a party already extracted my key material". One operator action
(Settings → "Rotate Everything…" → confirm → the combined credential sheet) mints a fresh
MRK **and** a fresh key for every vault, re-encrypts every vault's items, **drops every
per-jar access envelope**, **removes the admin provision** (the manager is rewritten at
version 2 with no admin slot — re-provision afterward via `rotateAdminKey`), and re-wraps
under a required **new** master password (new ≠ old, enforced on both branches). Two
credential branches, both reachable from either lock state: the current master password,
or the recovery key (the "forgot password" switch on the sheet). The whole rewrite is a
crash-safe multi-file transaction with load-time recovery: any pre-commit failure leaves
disk and live state untouched ("nothing changed; your existing keys remain valid" is
literal truth), and once the op resolves the rotation is durable and the profile ends
**unlocked** (the fresh MRK is installed). The new recovery key is shown **once**, on the
dismiss-locked recovery sheet, only **after** the durable commit; acknowledging it
completes the flow, and the page then shows a persistent completion card naming the
revoked admin key and every vault whose access keys were dropped (held in memory for the
app session — dismissing it or relaunching clears it). While a rotation is in flight,
every other vault write refuses with a transient busy error ("a rotation is already in
progress") — retry after it completes.

- **Scope of the sever**: compromise mode severs the **live profile** — after it, no
  previously issued or extracted key material (old master password, old recovery key,
  admin private key, per-jar access keys, even a raw captured MRK or vault key) opens
  anything in this profile. It does **not** reach previously exported bundle files the
  operator holds: a pre-rotation `.gfvaultbundle` still opens with the secrets it was
  exported under (it carries its own envelope set), so treat old bundles as carrying the
  old keys and re-export after a rotation.
- **Accepted residual — quitting during the reveal**: the one-time recovery-key display
  is held only in memory between the commit and its acknowledgment. If the owning window
  dies mid-flow the reveal re-surfaces on the next window; but quitting the app entirely
  while it is still pending loses the display. This is not a lockout — the operator just
  set the new master password and can mint a fresh recovery key from it (Master-key
  management → Rotate recovery key).

**Fresh-profile adopt forces this recovery-key rotation up front and mints no admin key at
all.** Adopting a bundle onto a fresh profile (see Portability) mints a fresh recovery key
**inline under the live bundle MRK** — no master-password step-up, since the live MRK
already authenticates the wrap — so the donor cannot retain recovery access into the
adopted vault; the adopted manager carries no admin provision whatsoever (no admin
keypair is minted on adopt, donor or otherwise — the adopt-no-admin change), so there is
nothing for the donor's admin key to retain either. It does **not** rotate the donor's
master envelope: severing the donor's master password is a `changeMasterPassword` (or a
full compromise-mode rotation) the adopter runs afterward, not part of adopt.

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
  `vaultFill` / `vaultAnswerAuth` enforce jar membership and an origin match (top-frame
  origin / challenge-URL origin respectively); the audit records origin
  and counts, never secrets.
- **Web content.** No vault secret is readable from a web page except the single credential a
  fill injects — and master-equivalent secrets never enter any page DOM (they route through
  the chrome-owned sheet).
- **Automation reach into the secret sheet (PR#112 finding 1; narrowed by M15 F3 DD1).** The
  chrome-owned menu-overlay **sheet** — where the master password is typed and one-time
  recovery/access/admin keys render as `textContent` — is admitted by the automation resolver
  **only when BOTH allowlists pass**: the sheet's *current* menuType is in
  `AUTOMATABLE_MENU_TYPES` (`src/main/automation/resolve.js`; seeded `bookmarks-overflow` and
  `bookmark-edit` — non-secret bookmark surfaces) **and** the operation is one of exactly three
  reads (`readDom`, `readAxTree`, `captureScreenshot`). Everything else throws
  `automation: secret-sheet` at **every tier, admin included**: every `vault-*` and `auth-*`
  menuType, a `null` current menu (nothing open, or the sheet hidden), every other wcId-first
  op — `evaluate`, `injectScript`, `click`, `typeText`, `pressKey`, `navigate`, `printToPDF`,
  `findInPage`, `dragPointer`, … — and any op or menuType added later, which is refused **by
  default** because it did nothing to be admitted. Its wcId stays *discoverable* via
  `enumerateWindows` (`sheetWcId`).
  - **No vault sheet is ever readable.** `vault-unlock` / `vault-set` / `vault-stepup` /
    `vault-recovery-show` / `vault-accesskey-show` / `vault-adminkey-show` / `vault-import` /
    `vault-change-master` / `vault-recover` / `vault-compromise` / `vault-compromise-recover`
    are all off the allowlist, so a script can neither
    install an input listener on the sheet (no `evaluate`/`injectScript` at any tier, ever) nor
    read the secrets it renders.
  - **The DOM is scrubbed at CLOSE, not at the next open (DD1f).** `closeMenuOverlay` sends the
    sheet a close/reset message that immediately clears the rendered card, so a closed vault
    card's `textContent` is never co-resident with a later allowlisted menu. Without it the
    admission above would rest on a false premise.
  - **Whole-window pixel capture no longer leaks the sheet either (DD1c — a REVERSAL).** This
    paragraph previously *accepted* `captureWindow` compositing the visible sheet as "what a
    human sees, not a covert channel". That was a real read path by a second door: at admin
    tier the composite returned pixels of `vault-unlock` and of the dismiss-locked one-time
    recovery-key and admin-key displays. `captureWindow`'s sheet layer is now gated on the
    **same** menuType allowlist (imported, not re-typed), with a post-await re-check on the
    menuType so a mid-capture model-replace cannot slip vault pixels into the composite. The
    layer is simply dropped under any non-admitted menu. **Closed, not accepted.**

**What it does NOT protect against (out of scope, stated plainly):**

- **A compromised main process.** Once unlocked, the MRK and vault keys are live Buffers in
  the main process; code executing there can read them. Zeroization is best-effort and bounds
  the exposure window, not a defense against in-process compromise.
- **A keylogger at master entry.** Capturing the master password as the human types it into
  the sheet is outside the vault's control.
- **The exported CSV file itself, once the operator leaves it on disk (M19 F1, generalized
  M19 F2).** A Chromium-browser password export is plaintext by construction — goldfinch
  reads it, imports it, and holds
  the read Buffer only in memory (zeroized on every exit path), but it never touches the
  file on disk and cannot delete it for the operator. The completion modal's final line
  ("Delete the exported CSV file now — it contains your passwords in plain text.") is the
  full extent of the mitigation; a forgotten export file remains a genuine plaintext-secret
  exposure on that disk until the operator removes it.
- **A party that already extracted the MRK — answered by compromise mode (M18), with a
  stated scope.** Single-slot rotation re-wraps envelopes and never re-keys the MRK, so it
  cannot revoke an extracted MRK. **Compromise-mode rotation now exists for exactly this
  case** (see Rotation & recovery): it mints a fresh MRK and fresh vault keys, re-encrypts
  every item, drops every access envelope, and removes the admin provision — after it,
  extracted pre-rotation material (old MRK and vault keys included) fails against the live
  profile. Two bounds stay out of scope, stated plainly: it severs the **live profile
  only** — previously exported bundle files the operator (or an attacker) holds still open
  with the secrets they were exported under, so old bundles must be treated as carrying
  the old keys; and an app-quit while the one-time recovery-key reveal is still pending
  loses that display (accepted residual, not a lockout — the operator knows the new
  master password and can re-mint a recovery key from it).
- **The donor's master password after a fresh-profile adopt — alive until sever, dead
  after (M18 F3 Leg 3, DD7).** A fresh adopt rotates the recovery key away from the donor
  (and, per the no-admin-mint change above, never mints an admin key for the adopted profile
  at all), but it does **not** rotate the donor's master envelope — **the donor's master
  password stays LIVE and keeps unwrapping the adopted vault's MRK until the operator
  explicitly severs it.** This is a genuine, real capability the donor retains, not a
  theoretical one: anyone who still holds that master password can unlock the adopted
  profile, indefinitely, with no additional signal to the adopter. Every fresh adopt
  therefore surfaces a dismissible session card on the vault page naming exactly what it
  severs ("The previous owner's master password still opens this profile — set your own?").
  The card's action reuses an EXISTING flow that already carries a real step-up — a
  master-kind adopt (while unlocked) routes to `changeMasterPassword` (the operator
  re-enters the donor password they already know, as its own step-up); a recovery-kind
  adopt, or any kind while locked, routes to `recoverMasterPassword` (the just-rotated
  recovery key IS the step-up) — no new sheet, no new store operation, and no
  cryptographic mutation happens without one of those two real proofs. The moment either
  flow completes, the donor's master password is **dead**: `changeMasterPassword` /
  `recoverMasterPassword` both replace the master envelope outright. Declining the offer
  (Dismiss) leaves the profile fully usable — the risk is accepted, not blocking. The offer
  itself is non-secret, in-memory session state (the same idiom as the compromise-mode
  report card above) — it gates nothing cryptographic and is gone after a relaunch or an
  explicit dismiss, at which point the donor's master password is simply, silently, still
  alive, exactly as before this leg. Full severing is also always reachable directly
  (`changeMasterPassword` from the rotation section) — or, for the suspected-compromise
  case, a full compromise-mode rotation — without ever seeing the offer card.

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
