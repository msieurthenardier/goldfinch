# Squawk 0086: Card expiry round-trip broken for a single-digit month

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-09-19
**Completed**: 2026-09-19

## Report

A hand-typed card expiry of `2/27` saves to the vault successfully and can then
never be filled back: number, cardholder and CVV fill correctly while the expiry
field stays blank. Found live by the operator during Mission 21 Flight 1's HAT.

`parseExpiry` accepts only 4 or 6 digits, so a single-digit month yields 3 digits
and returns `null`; `fillCardForm` then writes nothing for expiry. The vault holds
a value it can never use, while the save appeared to succeed.

**Pre-existing** — predates Flight 1; the old submit-listener capture path had the
identical hole. No Flight 1 code caused it.

## Evidence

- `src/preload/vault-card-fields.js:parseExpiry` — `if (digits.length !== 4 && digits.length !== 6) return null;`
- Probed against the real modules: `parseExpiry("4/29")` → `null`;
  `parseExpiry("04/29")` → `{ month: '04', year: '2029' }`.
- `src/preload/vault-card-fields.js:fillCardForm` — `const exp = parseExpiry(card.expiry); if (exp) { ... }`,
  so a `null` parse silently fills nothing.

## Scope note (qualification gate)

The original report had a second half — "normalise at capture so the vault never
stores an unparseable expiry". That half is **deliberately not in scope, and is
rendered unnecessary by the first**: once `parseExpiry` accepts `M/YY`, every
already-stored `2/27` becomes fillable retroactively. Fixing the reader rather than
the writer avoids touching the capture wire, needs no migration for existing
vaults, and keeps this squawk-sized. A capture-side validation pass would be a
flight, not a squawk.

## Corrective Action

Fixed the reader only, as scoped. `parseExpiry` (`src/preload/vault-card-fields.js`)
now tries a separator-aware match first: `^(\d{1,2})[/\- ]+(\d{2}|\d{4})$`. When a
recognized separator (`/`, `-`, or whitespace) is present, it marks exactly where
the month digits end, so a 1- or 2-digit month is unambiguous — the month is
zero-padded (`2` → `02`) and month-range validation (1–12) runs unchanged. When
there is no separator match, the function falls through to the ORIGINAL digit-
strip logic unmodified (`replace(/\D/g, '')`, accept only 4 or 6 total digits) —
byte-for-byte the old behavior, so every previously-accepted or previously-rejected
separator-less input parses exactly as before.

**Ambiguity ruling (explicit, not incidental):** a separator-less single-digit
month is deliberately NOT newly accepted. `227` could be read as `2/27` (1-digit
month) or `22/7` (2-digit month + 1-digit year, itself not a supported year
width) with no separator to disambiguate — it stays rejected, exactly as it was
before this fix (3 digits was never one of the two accepted separator-less
lengths). No special-case code was needed for this: keeping the no-separator
fallback exactly as it was already rejects every 3-digit run. This matches the
squawk's own note that the reported input (`2/27`) always carries a separator,
so the ambiguous case is not the reported symptom.

Nothing else changed: `fillCardForm`, `formatCombinedExpiry`, `setChoiceValue`,
detection, and the capture path are untouched. No new normalisation or validation
was added at capture — per the squawk's scope note, accepting `M/YY` at the
reader makes every already-stored `2/27`-shaped value fillable retroactively,
with no migration needed.

## Verification

- Extended `test/unit/vault-card-fields.test.js`:
  - `2/27` → `{ month: '02', year: '2027' }`; `4/29` → `{ month: '04', year: '2029' }`
    (plus `2/2027`, `2-27`, `2 27` variants) — the new single-digit-month-with-
    separator support.
  - `0429`, `042029`, `04/2029`, `02/27`(existing), `12/28`, `12/2028`, `12-28`,
    `12 28`, `1228` still parse exactly as before.
  - `13/27` (out-of-range month via the new single-digit path) and `0/27` (month
    0 invalid even zero-padded) still return `null`.
  - `227` and `429` (separator-less, 3 digits) pinned as rejected — the deliberate
    ambiguity ruling, tested explicitly either way as instructed.
  - New round-trip test: `fillCardForm` against a combined `cc-exp` field
    (`maxLength: 7`) with a stored `expiry: '2/27'` now writes `'02/2027'` — this
    is the actual reported symptom (field stayed blank) and it is now covered.
- `npm test` (`node --test` over `test/unit/**`): 5169 tests, 5166 pass, 0 fail,
  3 pre-existing `todo` (unrelated to this change).
- `npm run lint` — clean.
- `npm run typecheck` — clean.
- `npm run format` — no changes needed (`npx prettier --check` confirms both
  touched files already match Prettier style).
- Diff scope confirmed via `git diff --stat`: exactly `src/preload/vault-card-fields.js`
  and `test/unit/vault-card-fields.test.js` touched.

## Sign-Off

**Reviewer**: independent Reviewer agent (leg-execution crew), batch review of the
2026-09-19 turnaround
**Verdict**: confirmed — corrective action correct, tested, and confined to the
reported surface; non-vacuousness verified by running both functions against the
pre-fix file and confirming the new tests would fail there
**Commit**: see `squawk: turnaround 2026-09-19`
