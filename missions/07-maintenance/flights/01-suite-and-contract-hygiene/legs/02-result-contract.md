# Leg: result-contract

**Status**: completed
**Flight**: [Suite & Contract Hygiene](../flight.md)

## Objective

Standardize `{ ok: false, error: string }` on every failure branch of
`handleClearData` and `handleWipe` in `src/main/jar-ipc.js`, with stable
discriminable error strings, each branch unit-pinned.

## Context

- Maintenance report 2026-07-11 finding 4: `handleClearData` returns bare
  `{ ok: false }` on all five failure branches; `handleWipe` carries `error`
  on exactly one (the session catch) — asymmetry between AND within
  handlers. History adds callers to this contract next mission.
- The renderer never reads `result.error` (`src/renderer/pages/jars.js:752`
  area reads only `ok`; failure display is a static `failNote` spec'd by
  M06 F4 and HAT-approved) — **NO renderer change** in this leg.
- The automation/MCP surface does not expose these two channels (grep
  confirms no `jars-clear-data`/`jars-wipe` references in
  `src/main/automation/`), so the only consumers are the chrome and
  internal-page bridges — shape change is additive and low-risk.
- House idiom for discriminable failure text is `automation: <op> —
  <code>` (e.g. `find.js — "automation: findInPage — internal-session
  excluded"`). Mirror the idiom, not the literal prefix.
- Broadcast-order and fail-closed semantics are UNCHANGED: clear-data stays
  strict fail-closed (no partial application; no broadcast ever); wipe still
  broadcasts `jar-wiped` before resolving, success path only.

## Inputs

- Branch `flight/01-suite-and-contract-hygiene` with leg 1 landed
  (uncommitted; suite 1283/1283 at 958ms). Leg 1 is file-disjoint from this
  leg.
- `src/main/jar-ipc.js` (`handleClearData` at `:166`, `handleWipe` at
  `:204`), `test/unit/jar-ipc.test.js` truth tables.

## Outputs

- `src/main/jar-ipc.js` — every failure branch of both handlers returns
  `{ ok: false, error: <stable string> }`.
- `test/unit/jar-ipc.test.js` — truth tables pin each branch's exact error
  string.
- `src/renderer/renderer-globals.d.ts:246-247` and the `jarsClearData`
  JSDoc `@returns` in `src/preload/internal-preload.js:334` — return types
  gain `error?: string` (`jarsWipe`'s JSDoc at `:345` already has it).

## Error-String Table

Exact wording is an acceptable variation (flight spec) — but whatever is
chosen must be branch-discriminable, stable (not exception-derived except
the session-failure suffix), and pinned verbatim in tests. Default table:

| Handler | Branch | `error` value |
|---|---|---|
| clearData | non-object payload (`jar-ipc.js:167`) | `jars: clear-data — malformed-payload` |
| clearData | unknown jar / burner (`:169`) | `jars: clear-data — unknown-jar` |
| clearData | missing/empty/non-array classes (`:170`) | `jars: clear-data — invalid-classes` |
| clearData | unknown class id (`:174`) | `jars: clear-data — unknown-class: <classId>` |
| clearData | session-call catch (`:192`) | `jars: clear-data — session-failure: <e.message>` |
| wipe | non-object payload (`:205`) | `jars: wipe — malformed-payload` |
| wipe | unknown jar / burner (`:207`) | `jars: wipe — unknown-jar` |
| wipe | session-call catch (`:213`) | `jars: wipe — session-failure: <e.message>` (replaces the current raw `String(e.message)`) |

## Acceptance Criteria

- [x] Every failure branch of `handleClearData` (5) and `handleWipe` (3)
      returns `{ ok: false, error }` with a branch-discriminable stable
      string; success shapes unchanged (`{ ok: true, cleared }` /
      `{ ok: true }`)
- [x] `test/unit/jar-ipc.test.js` pins each branch's exact error string:
      the clear-data rejection matrix (`:462`, 7 cases) asserts per-case
      full shapes; partial-unknown (`:480`), throwing-session (`:487`),
      wipe rejection matrix (`:518`, 4 cases), and wipe-throw (`:528`)
      updated to pin the new strings (wipe-throw pins the
      `session-failure:` prefix and that the thrown message is included)
- [x] Zero-side-effect assertions in those tests survive unchanged (no
      session touched on rejection; no broadcast/reroll on wipe throw;
      strict fail-closed on partial-unknown classes)
- [x] `renderer-globals.d.ts:246-247` and the internal-preload JSDoc
      `@returns` for both methods include `error?: string`
- [x] NO change to `src/renderer/pages/jars.js` or any other renderer file;
      NO change to `handleRemove` (its bare `{ ok: false }` at
      `jar-ipc.js:126`/`:128` is the delete channel — out of scope, and its
      test pins at `:409`/`:558` must still pass untouched)
- [x] Suite green (1283 tests; internal duration stays < 1.5s), typecheck
      and lint green

## Verification Steps

- `node --test test/unit/jar-ipc.test.js` — truth tables green
- `npm test` — full suite green, duration < 1.5s
- `npm run typecheck && npm run lint`
- `git diff --stat` — exactly: `src/main/jar-ipc.js`,
  `test/unit/jar-ipc.test.js`, `src/renderer/renderer-globals.d.ts`,
  `src/preload/internal-preload.js` (+ artifact files)

## Implementation Guidance

1. **jar-ipc.js**: replace each bare `return { ok: false }` in the two
   handlers with the table's string. `handleClearData`'s catch clause
   (`:189`, currently bare `catch {`) gains an `e` binding — `catch (e) {`
   — to source the `session-failure:` suffix, mirroring `handleWipe`'s
   existing catch; this binding change is in scope of "return-shape change
   only". Update the comment at `:191` ("a thrown session call returns
   { ok: false } with no partial-success shape") to match; `handleWipe`'s
   header comment (`:202`) already describes an error-bearing catch —
   verify, no change expected. Do not otherwise restructure control flow.
2. **Truth tables**: convert the rejection-matrix `cases` arrays to carry
   an expected-error third element and `assert.deepEqual` the full
   `{ ok: false, error }` shape per case (burner and unknown id both map to
   `unknown-jar` — same branch, per the store-miss design at
   `jar-ipc.js:154-160`). For the wipe-throw test keep the existing
   NO-broadcast/NO-reroll assertions verbatim and add prefix + message
   assertions on `result.error`.
3. **Type surfaces** (DD10(b) preload-bridge declare rule — this is the
   M06 F4-leg-3 / F5-leg-1 recurrence class, do not skip):
   `renderer-globals.d.ts:246` → `Promise<{ ok: boolean; cleared?:
   string[]; error?: string }>`; `:247` → `Promise<{ ok: boolean; error?:
   string }>`; in internal-preload only `jarsClearData`'s `@returns`
   (`:334`) needs `error?: string` added — `jarsWipe`'s (`:345`) already
   carries it (verify, no change expected). chrome-preload.js has no
   per-method JSDoc returns — leave it alone unless typecheck says
   otherwise.
4. **Internal twins need no separate handling** — `internal-jars-clear-data`
   / `internal-jars-wipe` register the same handler functions
   (`jar-ipc.js:238-239`); the shared-behavior tests (`:493`, `:539`) pin
   success shapes and stay green untouched.

## Edge Cases

- **Burner**: never a store entry, so it hits the `unknown-jar` branch —
  the tests' burner cases pin `unknown-jar`, not a burner-specific string
  (matching the deliberate design comment at `jar-ipc.js:154-160`).
- **Duplicate classes stay valid** (`:455` test) — not a failure branch;
  untouched.
- **Exception without message**: the catch normalization
  `String(e && e.message ? e.message : e)` stays as the suffix source —
  prefix it, don't replace it.
- **Do not "fix" handleRemove** or the other channels' `null`/`false`
  failure values — out of scope; the contract criterion covers the two
  data channels only.

## Files Affected

- `src/main/jar-ipc.js` — 8 failure-branch return shapes + 2 comment
  updates
- `test/unit/jar-ipc.test.js` — truth-table pins
- `src/renderer/renderer-globals.d.ts` — 2 return-type declares
- `src/preload/internal-preload.js` — 2 JSDoc `@returns`

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed` (in this file's header) — flight
      review and commit are deferred to end of flight
- [x] Check off this leg in flight.md (and CP2 if met)

## Citation Audit

Verified at leg design time against the working tree (leg 1 landed,
uncommitted): `jar-ipc.js:166` (handleClearData) OK; `:167`, `:169`,
`:170`, `:174`, `:192` (five clearData failure branches) OK; `:204`
(handleWipe), `:205`, `:207`, `:213` (three wipe failure branches, catch
carries error today) OK; `:126`/`:128` (handleRemove bare ok:false, out of
scope) OK; `:154-160` (burner store-miss comment) OK; `:238-239` (internal
twins) OK; `jar-ipc.test.js:462`, `:480`, `:487`, `:518`, `:528`, `:493`,
`:539`, `:409`, `:558`, `:455` OK; `renderer-globals.d.ts:246-247` OK;
`internal-preload.js:334` (@returns JSDoc) OK; `find.js — "automation:
findInPage — internal-session excluded"` (idiom precedent) OK. 25
citations, all OK.
