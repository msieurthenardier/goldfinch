# Squawk 0095: Document the drift-guard pattern in CLAUDE.md

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-20
**Completed**: —

## Report

The codebase now uses the same shape three times — a pure module's constant
asserted equal to another module's derived value by a unit test, so a new entry in
one goes red until the other catches up — but the pattern is not written down
anywhere. It belongs under CLAUDE.md's *Recurring module shapes*, alongside the
Electron-free injected-deps and pure-decision-module entries.

It is cheap, and it has already caught real holes: the editor guard is what forces
a new item type to gain a UI label for every field, and this feature's four
independent type sources are cross-tied by three such guards.

Found during the Flight 2 debrief (2026-09-20).

## Evidence

Three live instances:
- `test/unit/identity-profile.test.js:16` — `IDENTITY_FIELDS` asserted equal to
  `vault-identity-fields.js`'s `POSTAL_ROLES ∪ NON_POSTAL_ROLES`.
- `vault-editor-model.js`'s `EDITOR_LAYOUT`/`EDITOR_TYPES` ↔ `vault-item-schema.js`'s
  `SCHEMA`, pinned by `assert.deepEqual`.
- `test/unit/bookmarks-bar-css-pin.test.js` — the CSS↔JS constant pair (same shape,
  source-scan flavour).

Note the related but distinct item this does NOT cover: the four hand-edited
`ITEM_TYPES` sources are real accidental complexity and collapsing them needs
design work, so that is a flight-scope item, not a squawk (it fails criterion 2).

## Corrective Action
*(written at completion)*

## Verification

## Sign-Off
*(written at completion)*
