# Squawk 0098: `isLivePasswordField` / `isLiveCardNumberField` have no production callers

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-20
**Completed**: 2026-09-21

## Report

Mission 21 Flight 3 Leg 3 (DD9, AC11) changed `fillLoginForm` and `fillCardForm`'s
third parameter from a node target to an integer ordinal. Each of these two
helpers had exactly ONE production caller — inside the fill function whose node
parameter was removed — so both are now exported symbols with no production
consumer. Liveness is structural under the ordinal design: a freshly enumerated
`findAll<Family>Fields(doc)[ordinal]` is live by construction.

Left in place by Leg 3 (AC11c) because removing a still-exported symbol was out of
that leg's scope.

## Evidence

- `src/preload/vault-fill-fields.js` — `isLivePasswordField`, exported
- `src/preload/vault-card-fields.js` — `isLiveCardNumberField`, exported
- Pre-Leg-3 callers: `vault-fill-fields.js:141`, `vault-card-fields.js:498` only.

## Corrective Action

**Caller search** — grepped the whole repository (`src/`, `test/` including
`test/helpers/` and `test/fixtures/`, `scripts/`, `docs/`, `CLAUDE.md`, plus a
dedicated check of `test/unit/vault-entry-observer-bundle.test.js`'s inlined-names
list) for both symbol names, case-insensitive:

- `isLivePasswordField` hits: its own definition + export in
  `src/preload/vault-fill-fields.js`; a mention inside `vault-card-fields.js`'s
  doc comment for `isLiveCardNumberField` ("The card twin of
  `isLivePasswordField`" — prose only, not a code reference); its own dedicated
  test block in `test/unit/vault-fill-fields.test.js` (import + one `test(...)`);
  and historical mission/flight-log prose in
  `missions/21-saving-not-just-filling/flights/03-identity-fill-and-capture/`
  (immutable leg record + flight log — not edited).
- `isLiveCardNumberField` hits: its own definition + export in
  `src/preload/vault-card-fields.js`; its own dedicated test block in
  `test/unit/vault-card-fields.test.js` (import + one `test(...)`); and the same
  historical mission/flight-log prose (not edited).
- No hits at all in `test/helpers/`, `test/fixtures/`, `scripts/`, `docs/`, or
  `CLAUDE.md`.
- `test/unit/vault-entry-observer-bundle.test.js`'s "inlines the observer core
  and the pure field modules" test lists inlined names to assert-present
  (`createEntryObserver`, `fillLoginForm`, `findAllLoginFields`, `fillCardForm`,
  `findAllCardFields`, `fillIdentityForm`, `findAllIdentityFields`) — neither
  `isLivePasswordField` nor `isLiveCardNumberField` was ever in that list, so no
  change was needed there; confirmed by rerunning the test after the rebuild
  (below) — still 8/8 green.

Scope gate cleared: neither symbol has any consumer beyond its own definition,
export, and a test that exists solely to test it.

**Changes made**:
- `src/preload/vault-fill-fields.js` — removed `isLivePasswordField` (function +
  its doc comment) and dropped it from the `module.exports` object.
- `src/preload/vault-card-fields.js` — removed `isLiveCardNumberField` (function
  + its doc comment) and dropped it from the `module.exports` object; also
  removed the doc comment on the deleted function itself (it referenced
  `isLivePasswordField` by name), so no dangling reference to either removed
  symbol survives in either file.
- `test/unit/vault-fill-fields.test.js` — deleted the whole
  `test('isLivePasswordField: true only for a password input present in the doc', ...)`
  block (it exercised nothing but that function) and dropped
  `isLivePasswordField` from the destructured import. No other test in this file
  touches the removed symbol.
- `test/unit/vault-card-fields.test.js` — deleted the whole
  `test('isLiveCardNumberField only accepts a live detected number field', ...)`
  block (same reasoning) and dropped `isLiveCardNumberField` from the
  destructured import. No other test in this file touches the removed symbol.
- Regenerated `src/preload/vault-entry-observer-bundle.generated.js` via
  `npm run build:preload` (gitignored generated artifact — both preload files
  are inlined into it, so the stale pre-edit bundle still contained both dead
  names until rebuilt).

## Verification

- `npm run build:preload` — regenerated the observer bundle; confirmed via grep
  that neither `isLivePasswordField` nor `isLiveCardNumberField` appears in the
  regenerated `vault-entry-observer-bundle.generated.js`.
- `node --test test/unit/vault-entry-observer-bundle.test.js` — 8/8 pass
  (bundle-integrity pin unaffected; the inlined-names assertion list never named
  either removed symbol).
- `npm test` — full suite: 5455 pass, 0 fail, 3 todo (pre-existing todos,
  unrelated).
- `npm run lint` — clean.
- `npm run typecheck` — clean.
- `npm run format` then `npm run format:check` — no drift; "All matched files
  use Prettier code style!".

## Sign-Off

**Reviewer**: independent Reviewer agent (leg-execution crew), batch review of the
2026-09-21 turnaround
**Verdict**: confirmed — corrective action correct, complete, and confined to the reported surface; gates green (`npm test` 5455 pass / 0 fail / 3 todo, lint, typecheck, format:check, build:preload), leak scan clean
**Commit**: see `squawk: turnaround 2026-09-21`

## Disposition

Deferred to a turnaround — out of M21 F3's path.
