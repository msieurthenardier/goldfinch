# Flight: Doc Promotions

**Status**: ready
**Mission**: [Codebase Health — 2026-07-11 Maintenance](../../mission.md)

## Contributing to Criteria

- [ ] CLAUDE.md carries the three promoted patterns, post-ESM (criterion 4)
- [ ] Gates stay green (criterion 5) — the two ride-along invariant tests
      (F2 debrief Recs 2–3, operator-ruled onto this flight 2026-07-11) are
      additive suite pins, not a mission criterion of their own

---

## Pre-Flight

### Objective

Land the pattern promotions recommended across M06's debriefs plus the M07
F1/F2 debrief carries, written for the post-ESM codebase: four CLAUDE.md
edits (three M06 promotions + the F1 MockTimers recipe), a full rewrite of
the shared-module sections that still describe the retired dual-export
world (F2 debrief Rec 1 — the doc-debt window closes here), and two small
boot-free unit tests pinning the invariants the rewrite documents (F2
debrief Recs 2–3). This flight is deliberately sequenced last so the docs
describe what exists.

### Open Questions

N/A — reconnaissance (flight log, 2026-07-11) verified every source item
against the post-Flight-2 tree; all confirmed-live, no retirements.

### Design Decisions

**DD1 — Edit 3 widens from "rewrite the checklist" to "rewrite the
shared-module story" (F2 debrief Rec 1)**: recon confirmed the stale
surface is larger than the DD10(b) pointer — `### src/shared/ dual-export
predicate` (whole section) and the dual-export half of `### Recurring
module shapes` describe the retired world, `:74` still calls the vm-replay
nets "current exemplars" (they are script-tag contract tests since F2 leg
6), and two stray `dual-export` attributions remain at `:142`
(`page-context-model.js`) and `:150` (`sheet-accelerator.js`). The rewrite
covers: the ESM pattern (import/export with explicit `.js` extensions,
module script tags), the PRELOAD-REACHABLE constraint + eslint parse-guard
pair (the 4 CJS-by-design files, why renderer-side preload require has no
require(esm)), the flat-served import rule (internal pages import flat
specifiers per the `INTERNAL_PAGES` map; disk-true specifiers 404), the
renderer evaluate-seam closed-set rule (18 entries, consumer-tagged, FD
ruling to grow), and DD3-as-permanent (all-documents defer/module pin,
now contract-tested). Consistency is gated by a full-file sweep, not
section spot-checks.

**DD2 — Ride-along invariant tests (operator ruling, 2026-07-11)**: the
two F2-debrief test recommendations land here as a second leg rather than
deferring to the next maintenance cycle — docs and enforcement land
together. Trade-off accepted: the flight is no longer docs-only (two new
test files under `test/unit/`).

**DD3 — Both new tests are static/boot-free by design**:
- *Require-cache test*: `require('../../src/shared/automation-dev')` and
  `require('../../src/shared/internal-page')`, then assert nothing in
  `require.cache` under `src/shared/` resolves to a file whose source
  contains ESM `export` syntax — pinning the preload-graph-ESM-free
  invariant (the F2 leg-1 blocker class: a future `require()` edge from a
  CJS-by-design file to a converted module). `require.cache` manipulation
  precedent: `test/unit/settings-store.test.js:37`.
- *Seam-contract test*: statically parse the `Object.assign(globalThis,
  {…})` seam block at the tail of `src/renderer/renderer.js` (one closed
  block, comment-delimited) and cross-check that every identifier
  `scripts/a11y-audit.mjs` drives is present in the seam — closed-set
  drift fails in the suite instead of at a live audit. **Extraction MUST
  be two-tier (design review 2026-07-11, probe-verified)**: (a) direct
  `evaluate(client, wcId, …)` literal/template-literal arguments (6
  identifiers) AND (b) the `SHEET_STATES` table's `open:` string literals
  (`scripts/a11y-audit.mjs:395-401`, 5 identifiers) — the sheet states
  are invoked indirectly via `evaluate(client, wcId, state.open)`, so a
  call-site-only regex silently covers ~half the real audit surface
  (probe: naive pattern yields 6/11). Union today: 11 identifiers, all
  present in the seam. No boot, no vm execution — string/AST-level
  checks only. Exact-name assertions are on the a11y-audit consumer only
  (its literals are in-repo); behavior-spec and dogfooding entries are
  covered by the seam-side 18-entry closed-set count, not by parsing
  prose specs.

### Prerequisites

- [x] Flight 2 landed (hard dependency — the rewrite depends on what ESM
      retired) — landed 2026-07-11, merged to main (PR #71)

### Pre-Flight Checklist

N/A — maintenance flight.

---

## In-Flight

### Technical Approach

**Leg 1 — `claude-md-promotions` (docs).** Four edits + the DD1 rewrite,
all in `CLAUDE.md`:

1. **Uniform focus rule** — append to the existing focus-idioms section
   (`### Cross-view focus + tab-type idioms`): any DOM container currently
   holding `document.activeElement` is patched in place, never rebuilt —
   applies uniformly (name inputs, swatch grids, nav) on every
   broadcast-rendered page. Source: M06 F4 DD6 + debrief.
2. **`action:rowId` confirm-transition key** — new short subsection near
   the focus idioms: a shared confirm area serving N sibling-visible
   actions keys its open/swap transition on the `(action, rowId)` string
   pair, never a boolean — a boolean silently breaks the same-row action
   swap. Source: M06 F4 leg 3 design review.
3. **Shared-module story rewrite (DD1)** — replace the dual-export
   predicate section and the stale half of the module-shapes section with
   the post-ESM pattern set (ESM pattern, PRELOAD-REACHABLE + parse-guard
   pair, flat-served import rule, seam closed-set rule, DD3-as-permanent);
   rewrite the DD10(b) onboarding checklist for the post-ESM world
   (retired items out; page `<script type="module">` tag + `INTERNAL_PAGES`
   entry stay; ADD the preload-bridge declare rule — bridge methods are
   contextBridge surface, not shared modules, so ESM does NOT retire it);
   fix the stray stale attributions (`page-context-model.js`,
   `sheet-accelerator.js`). Two accuracy guards from design review:
   preserve the still-true `guest-forward-allowlist.js`
   "main-side-only, plain CJS" sentence (CLAUDE.md:67 — accurate content
   adjacent to stale framing; do not over-delete), and fix the seam's
   `openContainerOverlay` consumer tag while describing the seam rule
   (tagged dogfooding-only in `renderer.js`, but also driven by
   `a11y-audit.mjs`'s `sheet:container` state — a comment-only edit,
   sanctioned because DD1 documents the seam as consumer-tagged).
4. **MockTimers recipe** — testing-patterns note (per-test `enable`, never
   file-global; drain with real `setImmediate` around single-step ticks;
   never one big tick). Source: M07 F1 debrief Rec 1.

Also note in the flight log that the behavior-test AUTHORING.md pointer
verification is already satisfied mission-control side (recon item 5 —
no goldfinch-side action).

**Leg 2 — `invariant-pins` (tests, DD2/DD3).** Two new files under
`test/unit/`: the require-cache preload-graph test and the static
seam-contract test. Suite/typecheck/lint green; no production-code
changes.

### Checkpoints

- [ ] CP1: four edits + rewrite landed; CLAUDE.md internally consistent
      with the post-Flight-2 tree — full-file consistency sweep: grep
      CLAUDE.md for `dual-export`, `typeof module`, vm-replay/replay-net
      phrasing, eslint shared-globals block, `renderer-globals.d.ts`
      shared-global mentions; every hit judged exempt-or-real (grep-AC
      convention)
- [ ] CP2: both invariant tests in the suite and green; each test
      demonstrated to FAIL on a synthetic violation during leg
      verification (mutate a copy, not the tree), proving it pins what it
      claims

### Adaptation Criteria

**Divert if**: the seam-contract test cannot be made reliable at the
string/AST level (e.g. a11y-audit call sites turn out not to be
statically enumerable) — in that case land it as a simpler seam-side
closed-set pin (18 names, exact) and carry the consumer cross-check to
the next cycle with a flight-log note.

**Acceptable variations**: wording, section titles, placement of the
MockTimers note; test file names; whether the two tests share a file.

### Legs

- [ ] `claude-md-promotions` — the four edits + shared-module rewrite +
      consistency sweep (CP1)
- [ ] `invariant-pins` — require-cache preload-graph test + static
      seam-contract test (CP2)

---

## Post-Flight

### Completion Checklist

- [ ] All legs completed
- [ ] Tests passing (suite + the two new pins)
- [ ] Documentation updated (this IS the documentation)

### Verification

- Consistency sweep per CP1; suite/typecheck/lint pass
- New tests fail-on-violation demonstrated per CP2
- No behavior changes under `src/` — the only `src/` diff is the
  comment-only `openContainerOverlay` consumer-tag fix in
  `src/renderer/renderer.js` (design-review-sanctioned); everything else
  is docs + tests
