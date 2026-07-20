# Leg: vault-crypto

**Status**: landed
**Flight**: [Vault Core + Automation Surface](../flight.md)

## Objective

Create the pure, headless, `node:crypto`-only cryptographic core and `.gfvault` file
format for the password manager: KDFs, AES-256-GCM item encryption, the four envelope
operations, and RFC 6238 TOTP generation — Electron-free and fully unit-tested offline.

## Context

- This is **Leg 1 of 4** in Flight 1; nothing before it. Legs 2–4 (`vault-store`,
  `vault-mcp-wire`, `vault-fill`) compose this module with persistence, state, and the
  MCP surface. This leg has **no persistence, no Electron, no state** — it is functions
  over `Buffer`s and plain objects.
- **Flight design decisions that bind this leg** (see `flight.md`):
  - **DD2** — all primitives from `node:crypto`: `scrypt` (async), `aes-256-gcm`,
    `hmac`, X25519 (`generateKeyPair('x25519')` + `diffieHellman`), `randomBytes`,
    `hkdf`. Zero new runtime dependencies. Verified available on Node v22.22.0 (Electron ^42).
  - **DD3** — envelope-set format: one random 256-bit vault key encrypts item data; the
    vault key is stored wrapped independently by each grantee; **each envelope carries a
    plaintext grantee key-id readable without any key**; a wrong key fails GCM
    authentication; master-password change / recovery rotation is re-wrap-only.
  - **DD11** — async `crypto.scrypt` (never `scryptSync`), benchmarked, `maxmem` raised
    as needed.
- **Module location decision**: create a `src/main/vault/` directory (mirroring
  `src/main/automation/`), since the vault feature spans many files across F1–F3. This
  leg adds `src/main/vault/vault-crypto.js`.
- **Convention match** (from existing pure modules like `src/main/trackers.js` and tests
  like `test/unit/settings-store.test.js`): `'use strict'` + `// @ts-check` header, a
  descriptive top-of-file comment, `node:test` + `node:assert/strict`, no Electron stub
  (the module never `require('electron')`).

### Envelope-key derivation (leg design decision, from DD2/DD3)

The master password is the only **low-entropy** secret, so it alone uses scrypt. All
other envelope inputs are high-entropy generated secrets and use fast HKDF (matching the
issue's rationale that "high-entropy input needs no stretching"):

| Envelope key-id | Wrapping-key derivation | Notes |
|---|---|---|
| `master` | `scrypt(password, salt, params)` → 32-byte key | low-entropy → stretched |
| `recovery` | `hkdf(recoveryKeyMaterial, salt, info)` → 32-byte key | high-entropy generated |
| `<access-key-id>` | `hkdf(accessKeySecret, salt, info)` → 32-byte key | per-jar symmetric grant |
| `admin-pub` | X25519 seal: ephemeral ECDH → `hkdf(sharedSecret)` → 32-byte key | asymmetric; only the admin private key opens it |

Each wrapping key then wraps the 32-byte vault key with AES-256-GCM (12-byte random IV,
16-byte tag). A wrong wrapping key fails `decipher.final()` (GCM auth), which the API
surfaces as a thrown, typed error — never a garbage return.

## Inputs

- No source files exist for the vault feature yet (greenfield).
- `node:crypto`, `node:test` available (built-in).
- The behavior spec `tests/behavior/vault-mcp-surface.md` and flight spec exist as
  design references (not consumed by this leg's code).

## Outputs

- `src/main/vault/vault-crypto.js` — the pure crypto + `.gfvault` format module.
- `test/unit/vault-crypto.test.js` — the offline unit suite.
- No changes to any existing source file (fully additive).

## Acceptance Criteria

- [ ] `src/main/vault/vault-crypto.js` exists, is `// @ts-check` clean, `require('electron')`-free, and imports only `node:crypto` (+ Node built-ins).
- [ ] **Vault key + item crypto**: a random 256-bit vault key encrypts a JSON-serializable items payload with AES-256-GCM and decrypts it back to a deep-equal payload; tampering with any byte of the ciphertext, IV, or tag makes decryption **throw** (GCM auth failure), never return corrupt data.
- [ ] **Four envelope operations**: the vault key can be wrapped and unwrapped under (1) a scrypt-derived master key, (2) an HKDF-derived recovery key, (3) an HKDF-derived per-jar access key, and (4) an X25519 seal to an admin public key opened only by the admin private key. Each round-trips to a byte-equal vault key.
- [ ] **Wrong key fails auth**: unwrapping any envelope with the wrong password / recovery material / access secret / admin private key throws a typed error, not a wrong `Buffer`.
- [ ] **Envelope independence**: given a `.gfvault` with all four envelope types, unwrapping via any one grantee yields the same vault key, and removing (revoking) one envelope leaves the others functional.
- [ ] **Per-envelope key-id readable without any key**: `parseVault(serialized)` exposes each envelope's plaintext `keyId` (`master` / `recovery` / `admin-pub` / the access-key's assigned id) from the raw file with no key material supplied. Access-key `keyId`s are assigned at mint (independent of the secret) and returned to the caller. `serializeVault` rejects a set with duplicate `keyId`s.
- [ ] **Authenticated envelope headers**: each envelope's `keyId` + `type` and the document `version` are bound as GCM AAD; altering any of them makes unwrap fail authentication (not silently succeed).
- [ ] **IV freshness**: successive `encryptItems` calls on one vault key produce distinct IVs.
- [ ] **X25519 seal round-trips through JSON**: the admin envelope's `epk` serializes (SPKI-DER base64) and re-imports so `openAdminSeal` recovers the vault key after a full `serializeVault`/`parseVault` cycle.
- [ ] **Re-wrap only**: changing the master password (or rotating the recovery key) re-wraps the same vault key under a new envelope without re-encrypting the items payload (verified: the items ciphertext is byte-identical before and after).
- [ ] **Serialization is self-contained + versioned**: `serializeVault` / `parseVault` round-trip through a single JSON document carrying format id, version, KDF params, per-file salts, the envelope set, and the item ciphertext; `parseVault` rejects a malformed or unknown-version document with a typed error.
- [ ] **TOTP (RFC 6238)**: `totp(secret, opts, timestampMs)` reproduces the RFC 6238 published test vectors for SHA-1 (and honors `algorithm`/`digits`/`period` overrides); `parseOtpauth(uri)` extracts secret + parameters from an `otpauth://totp/...` URI and a bare base32 secret.
- [ ] **scrypt is async + benchmarked**: the KDF uses `crypto.scrypt` (callback/promise), never `scryptSync`; the chosen N/r/p and `maxmem` are recorded in the flight log with the measured unlock latency (target ~250–500 ms on the dev rig).
- [ ] `node --test test/unit/vault-crypto.test.js` passes; `npm run typecheck` and `npm run lint` are clean.

## Verification Steps

- `node --test test/unit/vault-crypto.test.js` — all cases green (round-trip, tamper, wrong-key, envelope independence, re-wrap-only, key-id-without-key, TOTP vs. RFC vectors, malformed/unknown-version rejection).
- `npm run typecheck` — no errors (the module is `// @ts-check`).
- `npm run lint` — clean.
- `grep -n "require('electron')" src/main/vault/vault-crypto.js` — no matches (Electron-free).
- `grep -nE "scryptSync" src/main/vault/vault-crypto.js` — no matches (async scrypt only).
- Confirm the flight log records the chosen scrypt parameters + measured latency.

## Implementation Guidance

1. **Create `src/main/vault/vault-crypto.js`** with a header comment explaining it is the
   pure, Electron-free crypto + `.gfvault` format module (Leg 1), `node:crypto` only.

2. **Vault key + item crypto**
   - `newVaultKey()` → `crypto.randomBytes(32)`.
   - `encryptItems(payloadObject, vaultKey)` → `{ iv, ct, tag }` (all base64) via
     `createCipheriv('aes-256-gcm', vaultKey, iv)` over `JSON.stringify(payload)`;
     `iv = randomBytes(12)`; capture `getAuthTag()`.
   - `decryptItems({iv,ct,tag}, vaultKey)` → parsed object; `setAuthTag`, and let a bad
     tag throw from `final()` — wrap in a typed `VaultAuthError` (or documented error).
   - The module treats the items payload as opaque JSON (item *schemas* — Login / Card /
     Secure note — are vault-store's concern; document the expected shape in a typedef
     comment but do not validate item semantics here).

3. **Envelope operations** — each wraps the 32-byte vault key:
   - `deriveMasterKey(password, salt, params)` → `Promise<Buffer>` via async
     `crypto.scrypt(password, salt, 32, { N, r, p, maxmem })`.
   - `deriveHkdfKey(secretBuf, salt, info)` → `Buffer` via
     **`Buffer.from(crypto.hkdfSync('sha256', secretBuf, salt, info, 32))`**. NOTE:
     `hkdfSync` returns an `ArrayBuffer`, not a `Buffer` — wrap it, or `@ts-check` fails
     and any `.equals()`/Buffer-method use downstream throws. (Salt ≥ 16 bytes.)
   - `wrapVaultKey(vaultKey, wrappingKey, aad)` / `unwrapVaultKey(envelope, wrappingKey)` —
     AES-256-GCM as above, **binding the envelope header as AAD** (see AAD decision below).
   - `sealToAdmin(vaultKey, adminPublicKey)`: generate an ephemeral X25519 keypair,
     `crypto.diffieHellman({ privateKey: eph, publicKey: adminPub })` → shared secret →
     `hkdf` → wrapping key → AES-GCM wrap. **Serialization contract:** store the ephemeral
     **public** key as `epk` = `ephPub.export({ type:'spki', format:'der' }).toString('base64')`;
     `openAdminSeal` reconstructs it via `crypto.createPublicKey({ key: Buffer.from(epk,'base64'), format:'der', type:'spki' })`.
   - **Admin-key input types:** `sealToAdmin` accepts an X25519 **public** `KeyObject`;
     `openAdminSeal(envelope, adminPrivateKey)` accepts a **private** `KeyObject`. Provide
     `generateAdminKeypair()` → `{ publicKey, privateKey }` KeyObjects plus their SPKI/PKCS8
     base64 exports (the public half goes in manager metadata; the private half is
     operator-held — ownership/persistence is Leg 2's concern, not this module's).
   - Build each envelope as `{ keyId, type, salt?, epk?, iv, ct, tag }` — `keyId` and
     `type` are **plaintext** (and authenticated as AAD).

   **AAD decision (adopted from design review):** bind each envelope's `keyId` + `type`
   and the document `version` into the GCM wrap via `cipher.setAAD(...)` (and `decipher.setAAD`
   on unwrap). This makes envelope-relabel and version-downgrade tampering fail
   authentication — load-bearing because Leg 2's load-loudly-never-quarantine rule trusts
   the parsed header. Same AAD (the format `version`) binds the `items` blob.

4. **Key/identifier generation**
   - `generateRecoveryKey()` → `{ display, material }`: `material = randomBytes(20)`
     (20 bytes → a clean 32-char base32 with no padding); `display` = grouped base32
     (uppercase, hyphen-grouped, e.g. `XXXXX-XXXXX-…`) for printing. Parsing the display
     string back to `material` must round-trip.
   - `generateAccessKey()` → `{ secret, keyId }`: `secret = randomBytes(32).toString('base64url')`
     (matches the transport-key idiom in `automation-auth.js:generateKey`); `keyId` = a
     **separate** random `randomBytes(8).toString('base64url')`, independent of the secret,
     used as the envelope's plaintext key-id and for revoke/reference.

5. **Serialization** — `serializeVault(vaultObj)` / `parseVault(buf|string)`:
   - One JSON document: `{ format: 'gfvault', version: 1, vaultId, kdf: {algo:'scrypt',N,r,p,maxmem}, envelopes: [...], items: {iv,ct,tag} }`.
   - `parseVault` validates `format`/`version` and shape; throw a typed error on
     malformed/unknown-version input (this feeds vault-store's load-loudly-never-quarantine
     rule in Leg 2 — the parse must be strict). **Reject duplicate `keyId`s** in the
     envelope set (revoke-by-keyId and envelope-independence both assume unique ids).
   - Expose `listEnvelopeKeyIds(parsed)` → `string[]` readable with no key material (the
     behavior test's step-8 apparatus).

6. **TOTP (RFC 6238)** — `src/main/vault/vault-crypto.js` or a sibling; keep it in this
   module for Leg 1:
   - `totp(base32Secret, { algorithm='SHA1', digits=6, period=30 }, timestampMs)` →
     zero-padded code string. Counter `= floor(timestampMs/1000/period)` as an 8-byte
     big-endian buffer; `createHmac(algorithm, decodedSecret).update(counter)`; RFC 4226
     dynamic truncation; `% 10**digits`, left-pad.
   - **Take the timestamp as an explicit argument** so tests can pin the RFC 6238 vectors
     (do not call `Date.now()` inside the pure function — callers pass the clock).
   - `parseOtpauth(uri)` → `{ secret, algorithm, digits, period, issuer?, label? }`;
     accept a bare base32 secret too. Implement base32 decode locally (no dependency).

7. **scrypt parameters (DD11)** — start at `N=2**16, r=8, p=1`; benchmark
   `deriveMasterKey` latency on the dev rig; raise `N` toward ~250–500 ms and set `maxmem`
   to comfortably exceed `128 * N * r` bytes (e.g. `N=2**16, r=8` ≈ 64 MiB → `maxmem`
   ~96–128 MiB). **Record the final N/r/p, maxmem, and measured latency in the flight log.**

8. **Write `test/unit/vault-crypto.test.js`** covering every acceptance criterion:
   - **RFC 6238 SHA-1 vectors** — secret ASCII `12345678901234567890` → base32
     `GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ`. **These are 8-digit vectors**, so call
     `totp(secret, { digits: 8 }, t)`: `59s → 94287082`, `1111111109s → 07081804`,
     `1111111111s → 14050471`. Keep a **separate** assertion for the product default
     (`digits: 6`) so the default path is also pinned.
   - **Fast round-trips**: run functional envelope/item round-trips at a small scrypt
     `N` (e.g. `2**14`) to keep `npm test` quick; keep **one** separate test asserting the
     production `N/r/p` derives a key and that `maxmem < 128*N*r` throws
     `ERR_CRYPTO_INVALID_SCRYPT_PARAMS` (documents the sizing relationship).
   - **IV freshness**: two successive `encryptItems` calls on the same vault key yield
     different IVs (pins nonce-uniqueness for the long-lived vault key).
   - **AAD binding**: an envelope whose plaintext `keyId`/`type` (or the document
     `version`) is altered fails unwrap authentication.

## Edge Cases

- **Wrong key** on any envelope → typed throw (GCM auth), never a wrong Buffer. Test each envelope type.
- **Tampered ciphertext/IV/tag** on items or an envelope → throw. Test at least one flipped byte per field.
- **Unknown / missing `version`** or malformed JSON in `parseVault` → typed throw (Leg 2 depends on strict parse for load-loudly).
- **base32 with/without padding, lowercase, and `otpauth://` percent-encoding** in `parseOtpauth` → normalized correctly.
- **TOTP across a period boundary** — counter increments exactly at `timestampMs` divisible by `period*1000`.
- **Empty/zero-length items payload** → encrypts/decrypts to an empty structure without error.
- **scrypt `maxmem` too low for chosen N** → surfaces as a clear error, not a silent OOM; the benchmark step must set `maxmem` before landing.

## Files Affected

- `src/main/vault/vault-crypto.js` — **new**: pure crypto + `.gfvault` format + TOTP.
- `test/unit/vault-crypto.test.js` — **new**: offline unit suite.
- `missions/12-password-manager/flights/01-vault-core-and-automation/flight-log.md` — append the leg progress entry + the chosen scrypt parameters/latency.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing (`node --test test/unit/vault-crypto.test.js`), typecheck + lint clean
- [ ] Update flight-log.md with leg progress entry (including scrypt params + latency)
- [ ] Set this leg's status to `completed` (in this file's header)
- [ ] Check off this leg in flight.md
- [ ] (Not the final leg — do not land the flight)
- [ ] Do NOT commit (flight-end batch commit per the agentic-workflow deferred-commit model)

---

## Citation Audit

No `file:line` citations to source code (this leg is greenfield — it creates the first
vault files). Symbol references are to APIs that exist and were verified during flight
design: `node:crypto` (`scrypt`, `createCipheriv('aes-256-gcm')`, `hkdfSync`,
`generateKeyPairSync('x25519')`, `diffieHellman`, `createHmac`, `randomBytes`) confirmed
available on Node v22.22.0 by two Architect passes; `automation-auth.js:generateKey`
(the `randomBytes(32).toString('base64url')` idiom this leg mirrors) verified present.
No citations required repair.
