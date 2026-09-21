# Squawk 0097: `setFieldValue` survives as a private copy in `vault-fill-fields.js`

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-20
**Completed**: 2026-09-21

## Report

Mission 21 Flight 3 Leg 3 (LD1) extracted `vault-card-fields.js`'s private
`setFieldValue` and `setChoiceValue` into a shared `src/preload/field-setters.js`,
consumed by the card and identity families. The **login** family's own private
`setFieldValue` in `vault-fill-fields.js` was deliberately left alone, so the
same four-line setter now exists as one shared definition plus one private copy.

It was left because confirming behavioural identity before merging is its own
small job, and folding it into a fill leg would have widened that leg for no gain.

## Evidence

- `src/preload/vault-fill-fields.js:92` — private `setFieldValue`
- `src/preload/field-setters.js` — the shared definition (from M21 F3 Leg 3)
- Leg 3's design review verified the two bodies byte-identical before the move.

## Corrective Action

**Identity proof (done first, before touching any file)**: diffed the two
`setFieldValue` bodies byte-for-byte —

```js
function setFieldValue(field, value) {
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
}
```

`vault-fill-fields.js:92` (pre-move) and `field-setters.js` matched exactly:
same assignment, same two events dispatched in the same order, same
`{ bubbles: true }` init option on each, nothing else in either body. Confirmed
identical → proceeded as a pure move.

**Change**: `src/preload/vault-fill-fields.js` now `require('./field-setters')`s
`setFieldValue` at the top of the file (with a short provenance comment citing
squawk 0097) instead of defining its own copy; the private `function
setFieldValue(...)` definition (and its JSDoc) was deleted. No other line in
the file changed — `module.exports` is unchanged (`setFieldValue` was never
exported), and every call site inside the file (`fillLoginForm`) is untouched
since the imported binding has the same name.

Also updated `field-setters.js`'s header comment, which said the login copy
was "deliberately untouched" — that's now stale, so it was reworded to
describe the consolidation as completed at squawk time (doc-only change, no
behavior).

**Checks performed**:
- No circular require: `field-setters.js` has zero `require(...)` calls of its
  own (confirmed by inspection), so `vault-fill-fields.js` requiring it
  introduces no cycle.
- Grepped `setFieldValue` across `src/` and `test/` (excluding generated
  `*.bundle.js`/`*.generated.js`): only `vault-card-fields.js`,
  `vault-identity-fields.js`, `vault-fill-fields.js`, and `field-setters.js`
  itself reference the symbol — all three consumer modules already imported it
  from `field-setters.js` (`vault-card-fields.js` since LD1;
  `vault-identity-fields.js` since Flight 3 Leg 3) or now do
  (`vault-fill-fields.js`, this change). No other file imported the private
  copy.

## Verification

- `npm run build:preload` — rebuilt the isolated-world observer bundle
  (`src/preload/vault-entry-observer-bundle.generated.js`) that inlines
  `vault-fill-fields.js`; succeeded with no errors.
- `node --test --test-timeout=60000 test/unit/vault-entry-observer-bundle.test.js`
  — 8/8 pass, including the "inlines the observer core and the pure field
  modules" and "wrapped script runs cleanly ... reports `{ installed: true }`"
  checks, confirming the rebuilt bundle still installs and fills correctly
  with the consolidated setter.
- `node --test --test-timeout=60000 test/unit/vault-fill-fields.test.js` —
  15/15 pass, **unmodified** (`git diff --stat test/` shows no changes to this
  file, or any test file, from this squawk — see below).
- `npm test` — 5457 pass / 0 fail / 3 todo (full suite, unaffected by this
  change).
- `npm run lint` — clean.
- `npm run typecheck` — clean.
- `npm run format` then `npm run format:check` — no diffs; "All matched files
  use Prettier code style!"
- `git diff --stat test/` — shows only the three test files already modified
  by squawks 0069/0084/0096 before this squawk started (`app-lifecycle.test.js`,
  `seam-contract.test.js`, `vault-restore-workflow-invariants.test.js`); zero
  changes attributable to squawk 0097.

## Sign-Off

**Reviewer**: independent Reviewer agent (leg-execution crew), batch review of the
2026-09-21 turnaround
**Verdict**: confirmed — corrective action correct, complete, and confined to the reported surface; gates green (`npm test` 5455 pass / 0 fail / 3 todo, lint, typecheck, format:check, build:preload), leak scan clean
**Commit**: see `squawk: turnaround 2026-09-21`

## Disposition

Deferred to a turnaround — out of M21 F3's path.
