# Squawk 0041: Inline `/** @type {any} */` casts and `@ts-ignore` sites inside multi-line constructs are fragile under reformatting

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-27
**Completed**: —

## Report

Flight 5's reformat re-attached a `/** @type {any} */` cast to the wrong operand of a multi-line `&&` chain in `src/main/app-db.js` (fixed by binding the cast to a local — `const anyErr = /** @type {any} */ (err);`). `grep -c '/** @type {any} */' src/` → 151 occurrences: 49 already bound to a local, **102 inline**. Most inline casts wrap a single argument and cannot straddle a reflow boundary; the ones inside multi-line boolean chains, multi-line argument lists, or ternaries can. Audit those sites (and the ~25 `@ts-ignore` / `@ts-expect-error` lines) and bind the fragile ones to locals in the `anyErr` idiom; leave single-argument casts alone. Verification: `npm run typecheck` clean, `npx prettier --check .` clean, and a note in the Corrective Action listing each site changed with its shape. If more than ~15 sites need changing, complete the mechanical ones and record the rest here rather than expanding scope.

Source: Flight 5 debrief (Mission 17), recommendation 1b; the Leg 1 Deviation's option (c), never executed.

## Evidence

- `src/main/app-db.js:124-126` — the fixed idiom (PR #182)
- `grep -rn '/\*\* @type {any} \*/' src | wc -l` → 151; `grep -rn -E '@ts-(ignore|expect-error)' src | wc -l` → ~25

## Corrective Action

*(written at completion)*

## Verification

*(written at completion)*

## Sign-Off

*(written at completion)*
**Reviewer**: —
**Verdict**: —
**Commit**: —
