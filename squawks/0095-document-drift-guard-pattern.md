# Squawk 0095: Document the drift-guard pattern in CLAUDE.md

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-20
**Completed**: 2026-09-21

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

## Widening

Mission 21 Flight 3's debrief (`missions/21-saving-not-just-filling/flights/03-identity-fill-and-capture/flight-debrief.md`,
Action Items / Recommendation 3) ruled to fold two more recurring shapes into
this same squawk — same file, same "Recurring module shapes" section — rather
than opening separate squawks: the **planner/actuator split** (a pure planner
producing one action per independent unit of work, and a dumb actuator loop
with a per-iteration `try/catch` and no early exit, proved by Flight 3 Leg 6's
`vault-capture-plan.js` fix) and the **structural superset over a named list**
(LD7, `vault-human.js`'s `dropCapture`). This document-only completion covers
all three shapes in one edit.

## Corrective Action

Added three bullets to CLAUDE.md's "### Recurring module shapes" section
(documentation only — no source or test file touched):

- **Drift guard**, citing `test/unit/identity-profile.test.js`'s `IDENTITY_FIELDS`
  drift-guard test, `test/unit/vault-editor-model.test.js`'s `assert.deepEqual`
  pin tying `vault-editor-model.js` to `vault-item-schema.js`, and
  `test/unit/bookmarks-bar-css-pin.test.js` (source-scan flavor).
- **Planner/actuator split**, citing `src/preload/vault-capture-plan.js`'s
  `planCaptures` plus the actuator loop in `onCaptureGesture`
  (`src/preload/webview-preload.js`).
- **Structural superset over a named list**, citing `vault-human.js`'s
  `dropCapture` (`Buffer.isBuffer` over `Object.values(rec)`).

All three exemplars were re-verified against the current code before writing
(not just copied from the squawk's own Evidence section or the debrief) —
each citation's line/symbol was read directly.

## Verification

- `npm run format` — no changes to `CLAUDE.md` or this file (already
  Prettier-clean).
- `npm run format:check` — "All matched files use Prettier code style!"
- `npm test` — 5350 top-level subtests / 5458 total, 5455 pass, 0 fail, 3 todo
  (pre-existing, unrelated).
- `git diff --stat CLAUDE.md` — only the "Recurring module shapes" section
  changed (10 lines: +3 bullets); no source or test file touched by this
  squawk.

## Sign-Off

**Reviewer**: independent Reviewer agent (leg-execution crew), batch review of the
2026-09-21 turnaround
**Verdict**: confirmed — corrective action correct, complete, and confined to the reported surface; gates green (`npm test` 5455 pass / 0 fail / 3 todo, lint, typecheck, format:check, build:preload), leak scan clean
**Commit**: see `squawk: turnaround 2026-09-21`
