# Leg: totp-and-generator

**Status**: completed
**Flight**: [Vault Management Page](../flight.md)

## Objective

Complete the TOTP story on `goldfinch://vault` — enroll a TOTP secret (paste an `otpauth://` URI or
a base32 secret, normalized via F1's `parseOtpauth`), and show the **live rotating code with a
countdown computed in main** (the seed never leaves main) — and add a pure password generator
offered in the editor for new logins.

## Context

- **Flight DD4** — TOTP codes are computed in **main**; the seed stays in main. The page requests
  `internal-vault-totp-code(itemId)` and gets `{ code, secondsRemaining }` (F1's `totp`); it
  refreshes with a countdown. The seed reaches the page only via the explicit leg-2 reveal path (like
  a password), never for the live display.
- **Flight DD7** — a pure `src/shared/password-generator.js` (length + charset options, in-page
  `crypto.getRandomValues`, no main round-trip, no vault key) offered in the editor's password field.
- **Leg 2 substrate** — the editor + the per-type schema (`totp` and `notes` are secret fields on a
  login; the editor masks/reveals them; `metadataOf` surfaces `hasTotp`). `parseOtpauth(uri)` /
  `totp(base32Secret, opts, timestampMs)` are F1 primitives in `vault-crypto.js` (exported).

## Inputs

- `src/main/vault/vault-crypto.js` — `parseOtpauth(uri)` → `{ secret, algorithm, digits, period,
  issuer?, label? }` (accepts an `otpauth://totp/…` URI OR a bare base32 secret); `totp(base32Secret,
  opts, timestampMs)` → zero-padded code. Both exported.
- `src/main/vault/vault-store.js` — `revealItem` (leg 2, MRK-gated single item), `saveItemPreservingSecrets`
  (leg 2), the `totp` secret field on a login item.
- `src/shared/vault-item-schema.js` (leg 2) — `totp` is a secret field (login).
- `src/main/register-vault-ipc.js` (leg 2) — the `registerInternalHandler` composition + the
  `catchLocked` → `{ locked:true }` wrapper.
- `src/renderer/pages/vault.{html,css,js}` + `src/shared/vault-editor-model.js` (leg 2) — the editor.

## Outputs

- **TOTP enrollment normalization — stores the canonical `otpauth://` URI STRING (Architect-ruled).**
  `item.totp` stays a **bare string** (as F1 stores it today), so the sole value-reader — the
  automation path `vault-context.js:248` `parseOtpauth(item.totp)` — is **unchanged and legacy items
  keep working**. `normalizeTotpField(rawInput)` (crypto/store layer): `parseOtpauth(raw)` →
  **range-validate** (`period` an integer **≥ 1**, `digits` ∈ **{6,7,8}**, `algorithm` ∈
  **{SHA1,SHA256,SHA512}**) → **re-serialize to a canonical `otpauth://totp/…` URI string**; throw a
  typed validation error on malformed OR out-of-range input (so a hostile/fat-finger otpauth can
  never be persisted or reach `totp()` — this also hardens F1's un-try/catch'd automation read).
  Applied in the `internal-vault-item-save` path only when `totp` is present and NOT in
  `unchangedSecrets` (an unchanged totp is the already-canonical stored string — do not re-normalize).
- **Live code op** — `internal-vault-totp-code(target, itemId)` via `registerInternalHandler` (+
  `catchLocked`): MRK-gated `revealItem` → if the item has a `totp` string, `const p =
  parseOtpauth(item.totp); totp(p.secret, p, now)` → return `{ code, secondsRemaining }`
  (`p.period - (⌊now/1000⌋ % p.period)`); `{ code:null }` if no totp. **Returns the code + countdown
  only — never the seed.** The page **polls per-period + counts down locally** (re-fetch on the
  period boundary / when `secondsRemaining` hits 0), not per-second — `revealItem` does a full-vault
  decrypt per call, so per-period keeps decrypts to ~1/period. Stop polling on hide/blur.
- **Bridge + types** — `internal-preload.js` `vaultTotpCode(...)` wrapper + `renderer-globals.d.ts`.
- **Generator** — `src/shared/password-generator.js` (pure): `generatePassword({ length, lower,
  upper, digits, symbols })` using **`globalThis.crypto.getRandomValues`** (available in the
  sandboxed internal page AND under `node --test` — NOT `window.crypto`, NOT `node:crypto`) with
  **unbiased** selection (rejection sampling, not modulo); guarantees ≥1 char from each enabled class;
  **unbiased Fisher-Yates** shuffle (not `sort(()=>rand)`); rejects/raises when `length` < enabled
  class count and rejects all-classes-off; defaults length 20 / all classes. Unit-tested.
- **Page UI** — the editor's login `totp` field gains an **enroll** input (paste otpauth/base32) and,
  when `hasTotp`, a **live code widget** (code + a countdown ring/number, refreshed via
  `vaultTotpCode` per second or per period). The password field gains a **Generate** button
  (`password-generator`) with length/charset controls. `textContent`-only; the live code is not a
  stored secret but treat the widget like other revealed state (stop polling on hide/blur).
- **Tests** — unit: `password-generator` (length, each enabled class present, disabled class absent,
  unbiased-sampling smoke, uses `crypto.getRandomValues`); `normalizeTotpField` (otpauth URI + bare
  base32 both normalize; garbage throws); the countdown math. Integration: `internal-vault-totp-code`
  (returns code+seconds for a totp item, `null` for none, `{locked:true}` when locked, **never the
  seed** — grep/assert); enroll round-trip (save a raw otpauth → stored normalized → code computes).

## Acceptance Criteria

- [x] Enrolling a `totp` (paste an `otpauth://totp/…` URI OR a bare base32 secret) normalizes via
      `parseOtpauth`, **range-validates** (`period≥1`, `digits∈{6,7,8}`, `algorithm∈{SHA1,SHA256,SHA512}`),
      and stores the **canonical `otpauth://` URI string**; malformed OR out-of-range input (incl.
      `period=0`, `digits=99`) throws a typed validation error in the editor (no crash, nothing stored).
- [x] **F1 automation `vaultTotp` still returns a code for a newly-enrolled item** — the stored value
      stays a string the automation `vault-context.js` `parseOtpauth` read consumes unchanged
      (compat test).
- [x] `internal-vault-totp-code(itemId)` returns `{ code, secondsRemaining }` matching F1's `totp`;
      `{ code:null }` when no totp; `{ locked:true }` when locked; the **seed is never in the result**
      (grep/assert). The page polls **per-period** (local countdown), stopping on hide/blur.
- [x] `generatePassword` produces a password of the requested length with ≥1 char from each enabled
      class and none from disabled classes, via **`globalThis.crypto.getRandomValues`** with unbiased
      selection + unbiased shuffle; rejects `length < class-count` and all-classes-off; offered as a
      Generate button in the editor.
- [x] Existing tests pass unmodified; `npm test`, `npm run typecheck`, lint clean.

## Verification Steps

- Unit: `password-generator` (length/charset/unbiased/getRandomValues); `normalizeTotpField`
  (otpauth + base32 normalize, garbage throws); countdown math.
- Integration: `internal-vault-totp-code` (code+seconds, null-no-totp, locked, no-seed); enroll
  round-trip (raw otpauth → normalized store → code computes).
- `npm test` full — no regressions. `npm run typecheck` + lint clean.
- Grep: the totp-code result carries no `secret`/seed; the generator uses `crypto.getRandomValues`
  (not `Math.random`).

## Implementation Guidance

1. **Generator first** (`src/shared/password-generator.js`, pure) — `generatePassword(opts)`:
   build the charset from enabled classes; **rejection-sample `globalThis.crypto.getRandomValues`**
   (`Uint32Array`) to avoid modulo bias; ensure ≥1 from each enabled class then **unbiased
   Fisher-Yates** shuffle (also via getRandomValues); reject `length < class-count` and all-off;
   defaults length 20 / all classes. Unit-test thoroughly (incl. a spy asserting `globalThis.crypto`
   is the source). In-page (no IPC). Add its `shared('password-generator.js')` route to the `vault:`
   block in `internal-page-map.js`.
2. **TOTP normalization** — `normalizeTotpField(raw)` (crypto/store layer): `parseOtpauth(raw)` →
   **range-validate** (`period` int ≥1, `digits` ∈ {6,7,8}, `algorithm` ∈ {SHA1,SHA256,SHA512}) →
   **re-serialize to a canonical `otpauth://totp/…` URI string** (store the STRING, not a structured
   object — keeps `vault-context.js:248`'s `parseOtpauth(item.totp)` read working). Throw a typed
   validation error on malformed/out-of-range. Wire into `internal-vault-item-save`: when the saved
   item carries a `totp` NOT in `unchangedSecrets`, normalize before `saveItemPreservingSecrets` (an
   unchanged/preserved totp is already the canonical string — don't re-normalize).
3. **Live code op** — add `internal-vault-totp-code` to `register-vault-ipc.js` (`catchLocked`):
   `revealItem` → `const p = parseOtpauth(item.totp)` → `totp(p.secret, p, now)` + `secondsRemaining`
   → return `{ code, secondsRemaining }` only. Bridge `vaultTotpCode` + d.ts. **Compat test**: assert
   the F1 automation `vaultTotp` (`vault-context.totp`) still returns a code for an item enrolled via
   this leg's normalization.
4. **Page** — editor totp field: an enroll input + (when `hasTotp`) a live widget that fetches
   `vaultTotpCode` once and **counts down locally**, re-fetching on the period boundary (stop on
   hide/blur); password field: a Generate button + length/charset controls calling
   `password-generator`. `textContent`-only.

## Edge Cases

- **Invalid otpauth/base32 OR out-of-range params** (`period=0`/NaN, `digits=0/99`, bad algorithm) —
  `normalizeTotpField` throws → typed validation error, nothing stored (prevents the `totp()`
  divide-by-zero / `10**99` crash that would otherwise hit BOTH this op and F1's automation read).
- **Legacy string totp items** (F1 fixtures) — keep working: storage stays a string, so
  `parseOtpauth(item.totp)` reads them unchanged in both the automation and the new op.
- **Unchanged totp on edit** — preserved by leg-2's `unchangedSecrets` (not re-normalized).
- **No totp** — `internal-vault-totp-code` → `{ code:null }`; the widget hidden (metadata `hasTotp`).
- **Locked mid-poll** — the op returns `{ locked:true }`; the page stops polling + routes to unlock.
- **Non-default period/algorithm/digits** — the stored params drive `totp`; the countdown uses the
  stored `period`.
- **Generator with all classes off** — reject / default to at least one class (don't produce empty).
- **Clock** — `totp` takes an explicit timestamp; main uses the real clock; no reliance on the page clock.

## Files Affected

- `src/shared/password-generator.js` (new) — pure generator.
- `src/main/vault/vault-store.js` (or crypto/schema layer) — `normalizeTotpField`.
- `src/main/register-vault-ipc.js` — `internal-vault-totp-code` + enroll normalization in save.
- `src/preload/internal-preload.js` + `src/renderer/renderer-globals.d.ts` — `vaultTotpCode` + types.
- `src/renderer/pages/vault.{html,css,js}` (+ `vault-editor-model.js`) — totp widget + generate button.
- `src/main/internal-page-map.js` — the `password-generator.js` shared-module route (if imported by the page).
- `test/unit/…` — generator, normalize, countdown, the totp-code handler + enroll round-trip.

---

## Post-Completion Checklist

**Complete ALL before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with the leg progress entry
- [x] Set this leg's status to `landed`
- [x] Check off this leg in flight.md
- [x] Do NOT commit (deferred-commit model — Flight Director commits at flight end)
