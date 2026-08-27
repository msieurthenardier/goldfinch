# Squawk 0041: Inline `/** @type {any} */` casts and `@ts-ignore` sites inside multi-line constructs are fragile under reformatting

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-27
**Completed**: 2026-08-27

## Report

Flight 5's reformat re-attached a `/** @type {any} */` cast to the wrong operand of a multi-line `&&` chain in `src/main/app-db.js` (fixed by binding the cast to a local — `const anyErr = /** @type {any} */ (err);`). `grep -c '/** @type {any} */' src/` → 151 occurrences: 49 already bound to a local, **102 inline**. Most inline casts wrap a single argument and cannot straddle a reflow boundary; the ones inside multi-line boolean chains, multi-line argument lists, or ternaries can. Audit those sites (and the ~25 `@ts-ignore` / `@ts-expect-error` lines) and bind the fragile ones to locals in the `anyErr` idiom; leave single-argument casts alone. Verification: `npm run typecheck` clean, `npx prettier --check .` clean, and a note in the Corrective Action listing each site changed with its shape. If more than ~15 sites need changing, complete the mechanical ones and record the rest here rather than expanding scope.

Source: Flight 5 debrief (Mission 17), recommendation 1b; the Leg 1 Deviation's option (c), never executed.

## Evidence

- `src/main/app-db.js:124-126` — the fixed idiom (PR #182)
- `grep -rn '/\*\* @type {any} \*/' src | wc -l` → 151; `grep -rn -E '@ts-(ignore|expect-error)' src | wc -l` → ~25

## Corrective Action

`/** @type {any} */` casts: 151 total (`grep -rn '/\*\* @type {any} \*/' src`). Of these, 2 (`src/preload/webview-preload.bundle.js:242,943`) are in a generated file (gitignored, "do not edit; regenerate: npm run build:preload") and excluded from the audit — the source it's built from (`src/preload/webview-preload.js:354`, `src/preload/vault-card-fields.js:284,290`) is already single-line/atomic. Of the remaining 149 source sites: 148 safe, 1 fragile (fixed), 0 remaining unfixed.

Classification method: a site is fragile only if the cast sits inside a currently multi-line boolean/ternary chain, a multi-line argument list, or a multi-line construct where a value-cast comment could reattach to a different operand on reflow. Most inline sites are JSDoc parameter-type annotations (`(/** @type {any} */ e) =>`) glued to their own parameter token — these can't drift to a different parameter under reflow, so they're safe regardless of surrounding multi-line structure (confirmed against `git log -p -1 339e808` patterns, e.g. `automation/engine.js`'s multi-line `dragPointer` param list). Likewise casts wrapping a single parenthesized atomic expression on one line (a lone argument, an array index, a property access, a default-param `= /** @type {any} */ ({})`) are safe — Prettier has no reason to alter an already-fitting line, so there's no reflow boundary to straddle. `src/main/register-overlay-ipc.js:581` was checked closely (a `@type {any}` cast nested inside a `.find()` call that itself sits inside a multi-line `&&` chain) — the cast's own line is self-contained and 17 chars under printWidth (120), so it does not share the shape of the app-db.js bug (a cast standing as a direct operand of a multi-line logical chain); classified safe.

One site reproduces the app-db.js shape closely enough to fix: a boolean-guarded ternary carrying two separate inline casts on its two branches, matching "wrong operand of a chain" risk almost exactly.

Fixed (1):
- `src/renderer/pages/settings.js:929` — before: `'Error: ' + (e && /** @type {any} */ (e).message ? /** @type {any} */ (e).message : 'failed');` → after: hoisted to `const anyE = /** @type {any} */ (e);` before the statement, ternary now reads `'Error: ' + (e && anyE.message ? anyE.message : 'failed')`. No behavior change (short-circuit and truthiness checks preserved — `e` itself still gates both the `&&` and the cast is unconditional, matching original semantics since a cast is a no-op at runtime).

Remaining: none — no other source site met the fragile bar.

`@ts-ignore`/`@ts-expect-error`: 25 grep hits, of which 2 are prose mentions inside comments (`renderer.js:3`, `settings.js:5`), leaving 23 real directives. All 23 verified immediately precede the line carrying their diagnostic — including the two multi-line-import cases already fixed by squawk 0040 (`src/renderer/pages/vault.js:15`, `src/renderer/pages/jars.js:30`, both placed directly before the `} from '...'` line that TS reports the diagnostic on) and `src/renderer/chrome/tab-controller.js:1170` (placed directly before the assignment it suppresses). No displaced directives found; no changes needed.

## Verification

- `npm run typecheck` — clean
- `npx prettier --check .` — clean ("All matched files use Prettier code style!")
- `npm run lint` — clean
- `timeout 300 npm test` — 3839/3839 passing, 0 failures

## Sign-Off

**Reviewer**: Reviewer agent (independent, no knowledge of the Developers' reasoning) — one review round, clean; the Reviewer independently re-classified five borderline cast sites and agreed; one non-blocking count-wording nit fixed at close-out; batch turnaround 2026-08-27 (batch 4)
**Verdict**: confirmed
**Commit**: `squawk: turnaround 2026-08-27 (batch 4)` on `squawk/turnaround-2026-08-27-4` (PR number recorded on the PR itself)

Batch gates at review: 3843/3843 tests, lint clean, typecheck clean, prettier --check clean.
