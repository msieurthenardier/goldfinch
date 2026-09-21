# Squawk 0096: renderer.js's line count is pinned independently in two test files

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-09-20
**Completed**: 2026-09-21

## Report

`src/renderer/renderer.js`'s line count is asserted in **two** unrelated test
files, each carrying its own hardcoded copy of the number:

1. `test/unit/seam-contract.test.js` — `RENDERER_LINE_BUDGET`, the house
   line-budget pin documented in CLAUDE.md, with a `<=` comparison.
2. `test/unit/vault-restore-workflow-invariants.test.js:126` — a bare
   `assert.equal(lines, 1577, …)`, an EXACT-equality pin left over from
   M18 F3 Leg 3's "renderer.js is untouched by this leg" invariant.

Only the first is documented anywhere. The second is discoverable only by
grepping for the literal number, and its own comment history shows it has been
retargeted in lockstep on at least eight prior legs that legitimately changed
renderer.js — every one of those legs had to rediscover it.

Found during Mission 21 Flight 3 Leg 1, whose design-time citation audit searched
for `RENDERER_LINE_BUDGET` and therefore missed the second copy entirely. The leg
landed red until it was retargeted by hand.

This is the defect class Flight 2's debrief named: *"Two type sources is a
documented fact; four is a defect class. Enumeration claims decay silently.
Search for unclaimed sites; don't confirm claimed ones."* Same shape, different
constant.

## Evidence

```
$ grep -rn "renderer.js" test/unit/vault-restore-workflow-invariants.test.js
25:const RENDERER_JS_PATH = path.join(REPO_ROOT, 'src/renderer/renderer.js');
126:  assert.equal(lines, 1577, 'renderer.js line count matches the current landed source');

$ grep -n "RENDERER_LINE_BUDGET" test/unit/seam-contract.test.js
300:const RENDERER_LINE_BUDGET = 1577;
```

Both were `1577` before M21 F3 Leg 1; that leg moves both to its landed value.

## Corrective Action

Chose the **preferred shape**: single-sourced the number into a new
`test/helpers/renderer-line-budget.js` (matching the existing `test/helpers/`
convention — `'use strict'`, plain CJS, `module.exports = { … }`, e.g.
`source-scan.js`/`electron-stub.js`), and had both `test/unit/seam-contract.test.js`
and `test/unit/vault-restore-workflow-invariants.test.js` `require()` it instead of
each carrying its own literal `1550`.

Both assertions read the SAME constant deliberately, not as a compromise:
`RENDERER_LINE_BUDGET`'s own documented policy for `renderer.js` is
**zero-headroom** — "No slack banked beyond the landed value, per the leg's own
AC8" (seam-contract.test.js's comment, Mission 21 Flight 3 Leg 1) — unlike
`BOOKMARKS_BAR_LINE_BUDGET` or vault.js's budget, which deliberately carry
headroom above their landed size. Because renderer.js's ceiling and its landed
line count are the same number by policy, the `<=` budget test and the
exact-equality invariant correctly resolve to one shared value rather than
needing two independently-tracked constants — the "delete one" and "cross-pin
assertion" alternatives from the original candidate list were both unnecessary
once that policy was made explicit in the helper's own comment. Test files
don't `require()` each other (per the squawk's own constraint, `node --test`
would execute the required file's tests too), so the helper module is the
correct home.

Also updated CLAUDE.md's "Formatting is Prettier's" bullet: it no longer says
the next leg "must retarget BOTH" — it now says both tests import
`RENDERER_LINE_BUDGET` from `test/helpers/renderer-line-budget.js`, so a future
retarget touches one module and both tests move together automatically.

## Verification

- **RED proof**: temporarily changed `test/helpers/renderer-line-budget.js`'s
  `RENDERER_LINE_BUDGET` from `1550` to `1549` (below the true 1550-line count, so
  both the `<=` ceiling and the exact-equality pin would fail) and ran:
  `node --test test/unit/seam-contract.test.js test/unit/vault-restore-workflow-invariants.test.js`.
  Both failed, sourced from the one edited value:
  ```
  not ok 1 - renderer.js remains a thin composition root within its RENDERER_LINE_BUDGET line budget
    error: 'renderer.js has 1550 lines; budget is 1549'
  not ok 14 - renderer.js is untouched by this leg (DD11: no renderer.js change, or a named bump)
    renderer.js line count matches the current landed source (test/helpers/renderer-line-budget.js)
    1550 !== 1549
  ```
  Restored the constant to `1550`; re-ran the same command — all 34 tests in
  both files passed (`# pass 34`, `# fail 0`).
- `npm test` — `# tests 5459`, `# pass 5456`, `# fail 0`, `# cancelled 0`,
  `# skipped 0`, `# todo 3` (pre-existing todos, unrelated to this change).
- `npm run lint` — clean, no output.
- `npm run typecheck` — clean, no output.
- `npm run format` — no files rewritten (`(unchanged)` throughout); confirms the
  new helper and edited test files were already Prettier-formatted.
- `npm run format:check` — `All matched files use Prettier code style!`
- `node -e "console.log(require('fs').readFileSync('src/renderer/renderer.js','utf8').split(/\r?\n/).length)"`
  → `1550`, confirming `renderer.js` itself was untouched and still measures
  1550 lines by the suite's own counting convention.

Scope of the change, confirmed via `git status --short`: `test/helpers/renderer-line-budget.js`
(new), `test/unit/seam-contract.test.js`, `test/unit/vault-restore-workflow-invariants.test.js`,
`CLAUDE.md`, and this squawk file — no production code touched.

## Sign-Off

**Reviewer**: independent Reviewer agent (leg-execution crew), batch review of the
2026-09-21 turnaround
**Verdict**: confirmed — corrective action correct, complete, and confined to the reported surface; gates green (`npm test` 5455 pass / 0 fail / 3 todo, lint, typecheck, format:check, build:preload), leak scan clean
**Commit**: see `squawk: turnaround 2026-09-21`

## Disposition at logging (superseded)

Deferred to a turnaround — it is not in Mission 21 Flight 3's path (that flight
retargets both copies by hand, which is what every prior leg did). Completed in
the 2026-09-21 turnaround (see Corrective Action / Verification above).
