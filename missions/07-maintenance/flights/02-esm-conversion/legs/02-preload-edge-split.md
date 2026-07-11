# Leg: preload-edge-split

**Status**: completed
**Flight**: [ESM Conversion of src/shared/](../flight.md)

## Objective

Break the preload→burner require edge by moving `resolveAutoMintTarget`
into a main-process module, then complete the pilot's transferred
live-boot verification (CP1) — unblocking leg 1
(`[BLOCKED:preload-require-esm]`, operator-confirmed divert re-plan; see
flight-log Decisions).

## Context

- **The blocker (leg 1 live boot)**: the chrome view runs
  `sandbox: false, contextIsolation: true` (`main.js:878` area), so
  `chrome-preload.js` executes with the RENDERER process's Node require —
  which has NO require(esm) support. `chrome-preload.js:8` →
  `require('../shared/automation-dev')` → `automation-dev.js:10`
  `require('./burner')` → the converted ESM burner.js →
  `SyntaxError: Unexpected token 'export'` → preload dead →
  `window.goldfinch` undefined → entire chrome dead.
- **Why the split is clean**: `chrome-preload.js:8` destructures ONLY
  `isMcpAutomationEnabled` — a pure argv predicate that never touches
  BURNER. The burner require exists solely for `resolveAutoMintTarget`
  (`automation-dev.js:80-83`, JSDoc `:67-79`), whose only callers are
  `main.js:2683` (main process — require(esm) live-proven by leg 1's boot)
  and `test/unit/automation-dev.test.js:166-180` (node --test —
  require(esm) probe-verified).
- **Standing constraint established by this divert (sweep legs inherit
  it)**: modules reachable from any preload's require graph must stay CJS
  and must not require any converted module. The complete preload→shared
  surface is exactly two edges: `chrome-preload.js:7` →
  `internal-page.js` (dependency-free CJS leaf) and `chrome-preload.js:8`
  → `automation-dev.js`. After this leg both graphs are ESM-free by
  construction.
- Leg 1's conversion work (3 shared files, 2 pages, 2 nets, eslint) sits
  uncommitted in the working tree, all static gates green — this leg
  builds directly on it and does NOT touch those files.
- Leg 1 stays `in-flight`; when this leg's live boot passes, BOTH legs
  land (leg 1's live-boot AC is evidenced by this leg's run).

## Inputs

- Working tree on `flight/02-esm-conversion` with leg 1's uncommitted
  implementation (1285/1285 @ ~936ms, typecheck, lint green).
- `src/shared/automation-dev.js` (burner require `:10`,
  `resolveAutoMintTarget` `:67-83`, exports `:85`).
- `src/main/main.js` (4-symbol destructure from automation-dev `:26-31`,
  call site `:2683`).
- `test/unit/automation-dev.test.js` (imports `:11-17` incl.
  `resolveAutoMintTarget` and `BURNER`; describe block `:166-180`).
- `src/shared/internal-page.js` (no requires — gets a constraint comment
  only).

## Outputs

- New `src/main/auto-mint.js` — `resolveAutoMintTarget` moved verbatim
  (behavior identical), with its burner require and JSDoc.
- `automation-dev.js` — burner-free, three predicates, preload-constraint
  note in header.
- `main.js` — require split, no behavior change.
- New `test/unit/auto-mint.test.js` — the 4 moved test cases.
- Live-boot verification completed for CP1; legs 1 AND 2 → `landed`.

## Acceptance Criteria

- [x] `src/main/auto-mint.js` exists: `resolveAutoMintTarget` moved with
      its JSDoc (`automation-dev.js:67-79`) and behavior unchanged;
      `const { BURNER } = require('../shared/burner')` at top (main
      process require(esm) — live-proven); exports
      `{ resolveAutoMintTarget }`; header comment explains WHY it lives
      main-side (preload require graphs must stay ESM-free — the flight-02
      divert)
- [x] `src/shared/automation-dev.js`: burner require (`:10`) and
      `resolveAutoMintTarget` (`:67-83`) deleted; exports exactly
      `{ isMcpAutomationEnabled, shouldAutoMint, shouldBindAutomation }`;
      header gains a PRELOAD-REACHABLE note (required by
      chrome-preload.js via renderer-side require — must stay CJS and
      must never require a converted ESM module)
- [x] `src/shared/internal-page.js`: same one-line PRELOAD-REACHABLE
      note in its header; NO code change
- [x] `src/main/main.js`: `resolveAutoMintTarget` removed from the
      automation-dev destructure (`:26-31`); new
      `const { resolveAutoMintTarget } = require('./auto-mint');`
      alongside; call site `:2683` and all other lines untouched
- [x] Tests moved, not rewritten: the 4 cases from
      `automation-dev.test.js:166-180` land in `test/unit/auto-mint.test.js`
      (requiring `../../src/main/auto-mint` and `../../src/shared/burner`)
      with assertions verbatim; `automation-dev.test.js` drops the
      describe block and the now-unused `resolveAutoMintTarget`/`BURNER`
      imports; total suite count unchanged (1285)
- [x] Preload graph proven ESM-free:
      `node -e "require('./src/shared/automation-dev'); require('./src/shared/internal-page'); process.exit(Object.keys(require.cache).some(k => k.includes('burner')) ? 1 : 0)"`
      exits 0
- [x] NO change to leg 1's files (3 shared modules, 2 pages, 2 nets,
      eslint config) or any other file outside this leg's Files Affected
- [x] Suite green (1285/1285, internal duration < 1.5s); `npm run
      typecheck` and `npm run lint` green
- [x] LIVE BOOT (CP1, transferred from leg 1): execute leg 1's
      Verification Steps live-boot procedure in full — app boots, chrome
      loads with zero uncaught console errors, chrome-tier evaluate
      confirms `buildContainerModel`/`BURNER` globals, `openJarsPage()` +
      `readDom` confirm the jars page renders with the Burner row,
      launcher `--enable-logging` stderr clean of uncaught errors for
      both pages; positive signal for the moved function: with the
      dev-mint env set, stdout prints the `AUTOMATION_DEV_MINT` line with
      a non-null key — direct live evidence that
      `main.js → auto-mint.js → burner.js` (require(esm)) works at boot

## Verification Steps

- `node --test test/unit/auto-mint.test.js test/unit/automation-dev.test.js`
  — moved tests green in isolation
- `npm test && npm run typecheck && npm run lint`
- The require-cache one-liner above (preload graph ESM-free)
- Live boot per leg 1's Verification Steps (admin-tier attach recipe
  there); capture evidence in the flight-log entry
- `git diff --stat` — this leg adds exactly: `src/main/auto-mint.js`,
  `src/main/main.js`, `src/shared/automation-dev.js`,
  `src/shared/internal-page.js`, `test/unit/auto-mint.test.js`,
  `test/unit/automation-dev.test.js` on top of leg 1's footprint
  (+ artifact files)

## Implementation Guidance

1. **auto-mint.js first**: create with the moved function + JSDoc +
   burner require. Keep `// @ts-check` and `'use strict'` (it is CJS).
2. **automation-dev.js**: delete the require and the function; leave the
   three predicates untouched. Add the PRELOAD-REACHABLE header note —
   this is the constraint comment future sweep legs read. (In
   internal-page.js the note may legally precede the `'use strict'`
   directive — comments don't break the directive prologue.)
3. **main.js**: minimal require reshuffle only.
4. **Tests**: move the describe block verbatim; update the moved file's
   header comment to name its subject.
5. **Live boot last**, after all static gates green — follow leg 1's
   procedure exactly (dev:automation + admin env, chrome-tier evaluate,
   `openJarsPage()`, `readDom`, stderr scan). On pass: check leg 1's
   live-boot AC in its artifact (cite this leg's flight-log entry as
   evidence), set BOTH leg statuses to `landed`, check off both legs and
   CP1 in flight.md.

## Edge Cases

- **Do not lazy-require as a shortcut** — the operator explicitly chose
  the split over the lazy-require variant; the point is structural
  (preload graphs ESM-free by construction, no call-time landmine).
- **`internal-preload.js` mentions of shared files** (`:329` comment
  referencing jar-data-classes.js) are comments, not requires — no edge,
  no change.
- **Frozen identity across the split**: auto-mint.js and jars.js/jar-ipc.js
  all require burner.js — require(esm) caches, single frozen instance;
  the `getDefault() => BURNER` identity test case stays valid.
- **If the live boot fails again for a NEW reason**: stop, signal
  `[BLOCKED:<reason>]` — the divert criterion applies afresh; do not
  stack workarounds.

## Files Affected

- `src/main/auto-mint.js` — new (function moved in)
- `src/shared/automation-dev.js` — function + require out, header note
- `src/shared/internal-page.js` — header note only
- `src/main/main.js` — require split
- `test/unit/auto-mint.test.js` — new (tests moved in)
- `test/unit/automation-dev.test.js` — tests moved out

---

## Post-Completion Checklist

**Complete ALL steps before finishing (commit is deferred to end of
flight):**

- [x] All acceptance criteria verified (live boot included)
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry (live-boot evidence
      for CP1)
- [x] Set this leg's status to `landed` AND leg 1's status to `landed`
- [x] Check off both legs in flight.md and CP1

## Citation Audit

Verified at leg design time against the working tree (leg 1 implementation
uncommitted): `automation-dev.js:10` (burner require), `:67-79` (JSDoc),
`:80-83` (function), `:85` (exports) OK; `chrome-preload.js:7` (internal-page
require), `:8` (automation-dev require, isMcpAutomationEnabled only) OK;
`main.js:26-31` (destructure), `:2683` (sole call site), `:878` area
(sandbox:false chrome view — from leg 1's boot trace) OK;
`automation-dev.test.js:11-17` (imports incl. BURNER at `:17`), `:166-182`
(describe block incl. closing braces, 4 cases) OK; `internal-page.js` (zero requires — grep
empty) OK; `internal-preload.js:329` (comment-only mention) OK. 12
citations, all OK.
