# Leg: invariant-pins

**Status**: completed
**Flight**: [Doc Promotions](../flight.md)

## Objective

Add two boot-free unit tests under `test/unit/` pinning the invariants the
leg-1 rewrite documents: the preload-graph-ESM-free invariant (require-cache
test, flight DD3a) and the renderer evaluate-seam ⊇ a11y-audit-driven-set
contract (static seam-contract test, flight DD3b).

## Context

- **Flight DD2**: operator ruled the two F2-debrief test recommendations onto
  this flight — docs and enforcement land together. No production-code
  changes.
- **Flight DD3**: both tests are static/boot-free by design — no app boot, no
  vm execution; string-level checks plus a real `require()` of the two
  preload-reachable modules.
- **Architect design review (flight log, 2026-07-11)**: DD3a mechanics
  empirically confirmed — require(esm) lands a readable `require.cache` entry
  under `node --test`; `node --test` per-file process isolation rules out
  cross-file cache pollution; `automation-dev.js` / `internal-page.js` have
  zero own `require()` calls today, so the cache walk is a **pure forward
  pin** (it guards the future edge, the F2 leg-1 blocker class). DD3b
  extraction MUST be two-tier — a call-site-only regex recovers 6/11
  identifiers (probe-verified).
- **Leg 1 aftermath**: the seam block now carries a trailing comment on the
  `openContainerOverlay` line (the sanctioned consumer-tag fix). Seam
  extraction must strip trailing `//` comments — five other entries
  (`createTab`, `makeBurner`, `newIdentity`, `measureWebviewsSlotDIP`,
  `openFind`) already had them: **6 trailing-comment entries total**
  (design-review-corrected count).
- **CP2 (flight.md)**: each test must be demonstrated to FAIL on a synthetic
  violation during verification (mutate a copy, not the tree).
- **Adaptation criterion (flight.md)**: if the seam-contract test cannot be
  made reliable at the string level, divert to a seam-side-only 18-name
  closed-set pin and carry the consumer cross-check forward with a flight-log
  note.

## Inputs

- `src/renderer/renderer.js:2952 — "Object.assign(/** @type {any} */ (globalThis), {"`
  — the seam block (unique anchor: the only `Object.assign` on `globalThis`
  in the file; the other, `:1661 — "Object.assign(bulk, {"`, does not match),
  comment-banner-delimited, closing `});` at end of file, 18 identifier
  entries with `//` group headers and some trailing comments
- `scripts/a11y-audit.mjs` — 6 direct literal `evaluate(client, wcId, …)`
  call sites (`:330` navigate template-literal, `:346` togglePanel, `:351`
  togglePrivacy, `:356` openLightbox template-literal, `:377` closeLightbox,
  `:379` applyToolbarPins double-quoted) + `SHEET_STATES`
  (`scripts/a11y-audit.mjs:394-402`) with 5 single-quoted `open:` literals;
  the non-literal sites (`:256` definition, `:292` `expr`, `:405`
  `state.open`) must NOT be matched
- `src/shared/automation-dev.js`, `src/shared/internal-page.js` — the two
  PRELOAD-REACHABLE CJS-by-design modules (header notes; zero own requires)
- Precedent: `test/unit/settings-store.test.js:35-39 — "delete require.cache[resolved]"`
  (require-cache manipulation idiom)
- House test conventions: `'use strict';` + `const { test } = require('node:test');`
  + `const assert = require('node:assert/strict');` (CJS test files; see
  `test/unit/internal-assets.test.js`); self-derived-from-disk static tests
  precedent: `test/unit/chrome-shared-scripts.test.js` (glob the real files,
  never hand-maintain a list; include an anti-vacuous tag-count guard)

## Outputs

- `test/unit/preload-graph-esm-free.test.js` (name = suggestion; acceptable
  variation) — the DD3a require-cache pin
- `test/unit/seam-contract.test.js` (name = suggestion) — the DD3b static
  cross-check
- Updated flight-log.md (leg entry incl. the CP2 fail-on-violation
  demonstrations)
- No changes under `src/` or `scripts/`

## Acceptance Criteria

- [x] **AC1 — Require-cache test exists and pins DD3a**: it
      `require('../../src/shared/automation-dev')` and
      `require('../../src/shared/internal-page')`, then walks
      `require.cache` and asserts that no cached entry resolving to a file
      under `src/shared/` has source containing top-level ESM `export`
      syntax. The ESM-detection check is a **pure, exported-or-in-file
      function** (e.g. `sourceHasEsmExport(src)`) so it can be truth-table
      tested in the same file.
- [x] **AC2 — Require-cache test self-verifies its detector**: synthetic
      truth-table cases pin the detector — REQUIRED cases: `export function x(){}`
      → true; `export async function x(){}` → true (design review found this
      shape live in the repo — `scripts/lib/mcp-client.mjs:58` — and absent
      from the naive detector); `export const X = 1` → true; `export default …`
      → true; `// export nothing` (comment) → false; `module.exports = {}` →
      false; a string mentioning the word export inside prose/comments → false.
- [x] **AC3 — Seam-contract test exists and pins DD3b**: it reads
      `src/renderer/renderer.js` and `scripts/a11y-audit.mjs` as text (no
      boot, no vm), extracts (a) the seam identifier set from the
      `Object.assign(…globalThis…, {…})` block and (b) the two-tier
      audit-driven identifier set — tier 1: identifiers opening a
      string/template literal third argument of `evaluate(client, wcId, …)`;
      tier 2: the `SHEET_STATES` `open:` string literals — and asserts every
      audit-driven identifier is present in the seam.
- [x] **AC4 — Closed-set + anti-vacuous guards**: the seam extraction asserts
      **exactly 18** seam entries (the FD closed set — growing the seam
      requires an FD ruling AND this pin's update, enforcement by design);
      the audit extraction asserts tier 1 yields ≥ 6 and tier 2 yields ≥ 5
      identifiers (a regex drifting to zero matches must fail loudly, the
      chrome-shared-scripts tag-count-guard pattern — lower bounds, not
      exact, so ADDING an audit state that also lands in the seam does not
      break the suite).
- [x] **AC5 — Seam-contract extraction is comment-robust**: trailing `//`
      comments on seam entry lines (5 entries carry them, incl. leg-1's
      `openContainerOverlay` tag) and full-line `//` group headers are
      stripped; extraction helpers are pure in-file functions with synthetic
      truth-table cases (incl. a violation case: an audit-driven identifier
      absent from a synthetic seam → detected).
- [x] **AC6 — CP2 fail-on-violation demonstrated for BOTH tests** on copies,
      never the tree: (a) require-cache — in a scratch dir, reproduce the
      walk against a synthetic CJS→ESM require edge (or equivalent
      demonstration that the live pin path, not just the detector, fails on
      violation) and record the failing output in the flight log; (b)
      seam-contract — the AC5 synthetic violation case doubles as the
      permanent in-suite demonstration; additionally demonstrate the live
      path fails by running the extraction against a mutated **copy** of
      `renderer.js`/`a11y-audit.mjs` in a scratch dir.
- [x] **AC7 — Both tests are in the suite and green**; `npm test` (full
      suite), `npm run typecheck`, `npm run lint` all pass. Suite wall-clock
      stays in the ~1s band (both tests are static — no timers, no boot).
- [x] **AC8 — Artifacts updated**: flight-log leg entry (incl. CP2 records);
      leg status transitions performed; leg checked off in flight.md.

## Verification Steps

- AC1/AC3: read both test files; confirm boot-free (no electron require, no
  app spawn) and that the require-cache test requires the EXTENSIONLESS
  specifiers (`…/automation-dev`, `…/internal-page`) exactly as
  `chrome-preload.js` does.
- AC2/AC5: `node --test test/unit/<file>` each standalone — synthetic cases
  visible in output.
- AC4: temporarily count — `grep -c` the seam entries (18) and confirm the
  test's constants match; confirm lower-bounds 6/5 for the audit tiers.
- AC6: run the scratch-dir demonstrations; paste failing assertion output
  into the flight log entry.
- AC7: `timeout 120 npm test` (expect 1284 + new count, 0 fail);
  `npm run typecheck`; `npm run lint`. Compare suite duration to the ~1s
  baseline.

## Implementation Guidance

1. **Require-cache test (DD3a)**:
   - Follow `settings-store.test.js`'s cache idiom but inverted: no cache
     deletion needed — require the two modules, then
     `Object.keys(require.cache).filter(k => k.includes(path.join('src','shared')))`
     (use `path.join` — WSL/Linux now, but keep it platform-safe) and for
     each, `fs.readFileSync(k, 'utf8')` + `sourceHasEsmExport(src)`.
   - Detector suggestion: `/^export\s+(?:default\b|async\b|const\b|let\b|var\b|function\b|class\b|\{|\*)/m`
     — anchored at line start, so `// export`-style comment mentions can't
     match (comments carry the `//` prefix at line start). The `async\b`
     alternative is REQUIRED (covers `export async function` and
     `export async function*` — probe-confirmed gap in the naive form).
     Truth-table it (AC2) rather than debating the regex in review.
   - Assert the walk found **at least the two required modules themselves**
     in the cache (anti-vacuous: an empty filter set must not pass silently —
     if the filter matched nothing, the test isn't walking what it thinks).
   - Keep it a forward pin: do NOT assert the cache contains ONLY those two
     files (a future legitimate CJS-by-design addition shouldn't fail this
     test; only an ESM-source file reached via require should).
2. **Seam-contract test (DD3b)**:
   - Seam extraction: locate the unique anchor substring
     `Object.assign(/** @type {any} */ (globalThis), {` (assert exactly one
     occurrence — a second `globalThis` assign in the file is itself drift
     worth failing on), take text to the next `});`, split lines, strip
     `//…` suffixes and whitespace/trailing commas, keep lines matching
     `/^[A-Za-z_$][\w$]*$/`.
   - Audit extraction tier 1: `/evaluate\(\s*client,\s*wcId,\s*['"`]([A-Za-z_$][\w$]*)\(/g`
     over `scripts/a11y-audit.mjs` — matches the 6 literal sites, cannot
     match `expr`/`state.open` (variable, no quote) or the function
     definition (no quote).
   - Audit extraction tier 2: `/open:\s*'([A-Za-z_$][\w$]*)\(/g` — the 5
     `SHEET_STATES` literals.
   - Contract assertion: `union(tier1, tier2) ⊆ seamSet`, with a helpful
     failure message listing the missing identifiers.
   - Write extraction + subset-check as pure in-file functions taking source
     strings, so the synthetic truth-table cases (AC5) exercise the same
     code as the live pin.
3. **File layout**: two files (per flight Technical Approach), each
   self-contained. Header comments in the house style: state WHAT invariant
   is pinned, WHY it exists (the F2 leg-1 blocker class / the closed-set
   seam rule), and what to do when the test fails legitimately (e.g. "seam
   grew with an FD ruling → update the 18 constant here + CLAUDE.md").
4. **CP2 scratch demos**: use a scratch directory outside the tree (e.g. the
   session scratchpad or `mktemp -d`) — copy the minimal files, inject the
   violation (an `export const X = 1` into a copied shared module wired via
   a copied CJS requirer; a fake audit driver `evaluate(client, wcId,
   'notInSeam()')` in a copied a11y-audit), run the same functions, record
   failures. Never mutate tracked files.
5. **Do not touch** `src/`, `scripts/`, or CLAUDE.md — if the seam or audit
   turns out to have drifted from the 18/11 expectation mid-leg, STOP and
   surface it (that would be an artifact discrepancy, not something this leg
   silently absorbs).

## Edge Cases

- **`node --test` process isolation**: each test file runs in its own
  process, so requiring the two CJS modules cannot pollute other test files'
  caches (design-review-verified). No cleanup needed.
- **Template-literal audit sites**: `:330`/`:356` use backticks with
  `${…}` interpolation AFTER the identifier — the tier-1 regex only needs
  the identifier + `(`, so interpolation is irrelevant. Keep the backtick in
  the regex quote class.
- **Windows line endings / BOM**: read with `'utf8'` and split on `/\r?\n/`
  if line-splitting; the repo is LF but don't build in the assumption.
- **False-positive `export` in shared-module comments**: `automation-dev.js`
  and `internal-page.js` headers mention "require(esm)" in prose — the
  line-anchored detector regex plus AC2's comment case covers this; verify
  against the real files (they must pass green).
- **Seam count vs entries with comments**: 18 identifiers across comment
  groups — the extraction must not count group-header comment lines or be
  thrown by the 6 trailing-comment entries.
- **require(esm) premise (design-review question, FD ruling)**: a scratch
  probe showed vanilla Node 22's `require()` loads top-level-`export` files
  transparently; the "no require(esm) in the renderer-side preload"
  constraint is the **Electron-42-empirical** F2 finding (the F2 leg-1
  blocker / preload-edge divert), which this design does not reopen. The
  pin is source-text based, so it is a valid forward pin under EITHER
  runtime behavior (hard throw or silent behavioral drift). Do not soften
  the source-file headers or CLAUDE.md based on the vanilla-Node probe.

## Files Affected

- `test/unit/preload-graph-esm-free.test.js` — new (DD3a)
- `test/unit/seam-contract.test.js` — new (DD3b)
- `missions/07-maintenance/flights/03-doc-promotions/flight-log.md` — leg
  entry + CP2 records

---

## Citation Audit

9 citations verified against current working tree (branch
`flight/03-doc-promotions`, leg 1 landed uncommitted) at leg design time:

- `src/renderer/renderer.js:2952 — "Object.assign(/** @type {any} */ (globalThis), {"` — OK (unique on `globalThis`; second `Object.assign` at `:1661` targets `bulk`)
- Seam block: 18 identifier entries, 3 group-header comments, 6 trailing-comment entries (incl. leg-1's `openContainerOverlay` tag) — OK (design-review-corrected: initial draft said 5)
- `scripts/a11y-audit.mjs:330/:346/:351/:356/:377/:379` — the 6 literal `evaluate(client, wcId, …)` sites — OK
- `scripts/a11y-audit.mjs:394-402 — SHEET_STATES` with 5 `open:` literals — OK (flight.md's `:395-401` cite drifted by ~1 line; symbol-cited here)
- `scripts/a11y-audit.mjs:256/:292/:405` — non-literal `evaluate` sites that must not match — OK
- `src/shared/automation-dev.js` / `src/shared/internal-page.js` — PRELOAD-REACHABLE headers, zero own `require()` calls (grep: only prose mentions of "require(esm)" in comments) — OK
- `test/unit/settings-store.test.js:35-39 — "delete require.cache[resolved]"` — OK (leg cites the idiom block; flight.md's `:37` points inside it)
- `test/unit/internal-assets.test.js:1-5 — node:test + assert/strict CJS header` — OK
- `test/unit/chrome-shared-scripts.test.js — self-derived static test + tag-count guard precedent` — OK

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed` (in this file's header) — flight-level
      review/commit is deferred to end of flight per the agentic workflow
- [x] Check off this leg in flight.md
