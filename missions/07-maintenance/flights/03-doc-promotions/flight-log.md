# Flight Log: Doc Promotions

**Flight**: [Doc Promotions](flight.md)

## Summary

Flight landed 2026-07-11. Both legs completed in one execution session:
leg 1 rewrote CLAUDE.md's shared-module story for the post-ESM world and
landed the four pattern promotions (uniform focus rule, `action:rowId`
confirm-transition key, DD1 rewrite, MockTimers recipe) plus the sanctioned
comment-only seam-tag fix; leg 2 added the two boot-free invariant pins
(`preload-graph-esm-free.test.js`, `seam-contract.test.js`), both
fail-on-violation demonstrated per CP2. Flight-level review (batched):
zero issues, `[HANDOFF:confirmed]`. Gates at landing: 1293/1293 (~970ms),
typecheck clean, lint clean.

---

## Reconnaissance Report (2026-07-11, pre-design)

Source items walked against the current tree (post-Flight-2, main @ 5a3d8eb).
Sources: maintenance report 2026-07-11 finding 5 (doc promotions), F1 debrief
action item (MockTimers), F2 debrief Recommendations 1–3.

| Item | Classification | Evidence | Recommendation |
|------|---------------|----------|----------------|
| 1. Uniform focus rule (M06 F4 DD6) | confirmed-live | Absent from CLAUDE.md; the target section `### Cross-view focus + tab-type idioms` exists (CLAUDE.md:200) with two conventions, no patch-in-place rule | Keep as planned |
| 2. `action:rowId` confirm-transition key (M06 F4 leg 3 review) | confirmed-live | No mention anywhere in CLAUDE.md (grep `rowId`/confirm-transition → 0 relevant hits) | Keep as planned |
| 3. DD10(b) checklist rewrite | confirmed-live — scope WIDENED by F2 debrief Rec 1 | CLAUDE.md:69 is pointer-only (as F2 left it); but `### src/shared/ dual-export predicate` (:38–51) and the dual-export half of `### Recurring module shapes` (:62–76) still describe the retired world; :74 calls the vm-replay nets "current exemplars" (they are script-tag contract tests since F2 leg 6); two further stale `dual-export` attributions at :142 (`page-context-model.js`) and :150 (`sheet-accelerator.js`) — both converted to ESM in F2 | Widen edit 3 from "rewrite the checklist" to "rewrite the shared-module story": both stale sections + a full-file `dual-export`/`typeof module` sweep; new content per F2 debrief (ESM pattern, PRELOAD-REACHABLE + parse-guard pair, flat-served import rule, seam closed-set rule, DD3-as-permanent) |
| 4. MockTimers recipe (F1 debrief action item) | confirmed-live | Absent (grep `MockTimers` → 0); recipe lives only in the landed F1 leg 1 spec | Add as fourth edit (mission.md Flight-3 bullet already annotated) |
| 5. Behavior-test AUTHORING.md pointer verification | already-satisfied (note-only) | Mission-control-side commit already landed; no goldfinch-side action existed to begin with | Note in flight log at execution, per the original spec |
| R2. Require-cache unit test (F2 debrief Rec 2) | confirmed-live candidate | No test pins the preload-graph-ESM-free invariant; `require.cache` idiom precedent exists (`test/unit/settings-store.test.js:37`) | Operator decision: ride this flight or defer |
| R3. Seam-contract static test (F2 debrief Rec 3) | confirmed-live candidate | Seam is one statically-parseable `Object.assign(globalThis, {…})` block at the tail of `src/renderer/renderer.js`; `scripts/a11y-audit.mjs` drives entries via literal `evaluate(client, wcId, '<name>(…)')` strings — both sides greppable without a boot | Operator decision: ride this flight or defer |

---

## Leg Progress

### Leg 1 — `claude-md-promotions` (landed 2026-07-11)

Implemented per spec. Changes:

- **AC1 (uniform focus rule)**: third bullet appended to `### Cross-view focus
  + tab-type idioms` — patch-in-place for any container holding
  `document.activeElement` (name inputs, swatch grids, nav), source-attributed
  to M06 F4 DD6 + the F4 leg-2 design-review FD ruling.
- **AC2 (`action:rowId` confirm-transition key)**: new `### \`action:rowId\`
  confirm-transition key` subsection immediately after the focus idioms —
  string-or-null `(action, rowId)` pair, never a boolean; source-attributed to
  the M06 F4 leg 3 design review.
- **AC3 (DD1 shared-module story rewrite)**: `### src/shared/ dual-export
  predicate` retitled/replaced with `### src/shared/ ESM modules` (real
  import/export, explicit `.js` extensions, the disk-relative-vs-flat
  specifier split for chrome vs internal pages, the `@ts-ignore` flat-import
  caveat). The `### Recurring module shapes` section's second bullet rewritten
  to ESM pure decision modules (the `guest-forward-allowlist.js`
  main-side-only/plain-CJS sentence PRESERVED, reframed under a new
  "CJS-by-design quartet + eslint parse-guard pair" paragraph); added the
  renderer evaluate-seam closed-set paragraph, the DD3-as-permanent
  defer/module-pin paragraph, and rewrote the DD10(b) pointer into a real
  onboarding checklist (retired items out — dual-export tail, shared-predicate
  ambient `declare`s; still-live items in — `<script type="module">` tag,
  `INTERNAL_PAGES` entry; added the preload-bridge declare rule). Defect class
  2 (`mkdirSync`... left untouched; the lexical-scope-collision class)
  reframed as retired-for-`src/shared/`, with `chrome-shared-scripts.test.js`
  / `jars-page-shared-scripts.test.js` redescribed as script-tag contract
  tests (tag-count guard + DD3 pin + module pin), not collision nets. Stray
  `dual-export` attributions fixed at the `page-context-model.js` and
  `sheet-accelerator.js` mentions (both now "ESM").
- **AC4 (MockTimers recipe)**: new paragraph under Patterns, right after the
  Grep-AC convention — per-test `enable`, real-`setImmediate` single-step
  drain, never one big tick; exemplar `test/unit/automation-find.test.js`;
  source-attributed to the M07 F1 debrief.
- **AC5 (seam consumer-tag fix)**: `src/renderer/renderer.js` —
  `openContainerOverlay`'s seam-block entry gained a trailing comment
  (`// also driven by scripts/a11y-audit.mjs (SHEET_STATES 'sheet:container')`)
  instead of relocating the entry. `git diff src/` confirms exactly one hunk,
  comment-only — the leg's ONLY `src/` change.
- **AC6 (CP1 consistency sweep)**: see the dedicated section below.
- **AC7 (gates)**: `npm test` 1284/1284 pass, `npm run typecheck` clean,
  `npm run lint` clean (no `npm run a11y` — no UI change, per spec).
- **AC8 (flight log)**: this entry + the recon-item-5 note below.

Leg status: `ready` → `in-flight` → `landed` (this session; no ARTIFACTS.md
transition-time handling defined for this project). Flight-level review and
commit deferred to end of flight per the agentic workflow.

#### AC6 — CP1 consistency sweep record

Verbatim sweep command:

```
grep -n -i 'dual-export\|typeof module\|vm-replay\|replay net\|replay-net\|shared-globals\|renderer-globals' CLAUDE.md
```

Hits (post-rewrite CLAUDE.md), each individually judged:

| Line | Hit | Judgment |
|------|-----|----------|
| 83 | `renderer-globals.d.ts` mentioned in the new preload-bridge declare rule bullet | **Exempt** — describes the file's current, still-true role (bridge-method declares survive ESM); not describing a retired world as current. |
| 84 | `dual-export` (the tail literal), `typeof module` (quoted retired snippet), `renderer-globals.d.ts` (twice), `shared-globals` (eslint entries) | **Exempt** — the whole sentence is explicitly framed as "Retired by the ESM conversion, no longer needed"; this is the sanctioned historical-framing case named in the leg's Edge Cases section, not a section describing the retired world as current. |

Also manually re-read (outside the literal grep match, since a backtick
between "vm" and "-replay" in the rewritten prose breaks the literal
`vm-replay` substring) the `` `vm`-replay collision nets `` mention at line 89
(the retired-collision-class paragraph): **exempt** — same historical framing
("The former `vm`-replay collision nets ... are retargeted as script-tag
contract tests ... not collision nets"), noted here for transparency rather
than relying on the grep miss.

The `**Shared-global onboarding checklist**` heading (line 79, matched by
`shared-global`/`shared-globals` loosely but not by the exact sweep regex)
was also reviewed: **exempt** — the heading titles the still-current,
live checklist (what to do when adding a module today), not a description of
the retired dual-export world.

No section describes the retired dual-export/vm-replay world as current.
Sweep clean per AC6.

#### Recon-item-5 note (AC8)

Recon item 5 (behavior-test AUTHORING.md pointer verification) — already
satisfied mission-control-side; confirmed again at leg-1 implementation time
that no goldfinch-side action was ever required for this item.

### Leg 2 — `invariant-pins` (landed 2026-07-11)

Implemented per spec. Two new boot-free unit test files under `test/unit/`;
no changes under `src/` or `scripts/` (confirmed via `git status`/`git diff`
— the only `src/renderer/renderer.js` diff in the tree is leg-1's
already-landed comment-only `openContainerOverlay` tag fix).

- **AC1/AC2 (require-cache pin, DD3a)** — `test/unit/preload-graph-esm-free.test.js`:
  `require()`s `src/shared/automation-dev` and `src/shared/internal-page`
  (extensionless, as `chrome-preload.js` does), walks `require.cache` for
  every entry resolving under `src/shared/`, and asserts none of their
  sources trip the pure `sourceHasEsmExport(src)` detector
  (`/^export\s+(?:default\b|async\b|const\b|let\b|var\b|function\b|class\b|\{|\*)/m`).
  Anti-vacuous: asserts the walk found ≥ 2 cached `src/shared/` paths.
  Forward pin: does NOT assert the cache contains ONLY the two required
  files. The detector's truth table (AC2) pins all REQUIRED cases from the
  spec, incl. `export async function` / `export async function*` (the
  design-review-found gap, live at `scripts/lib/mcp-client.mjs:58`), plus
  `module.exports = {}` and an "export" mention inside prose/a string → both
  false.
- **AC3/AC4/AC5 (seam-contract pin, DD3b)** — `test/unit/seam-contract.test.js`:
  reads `src/renderer/renderer.js` and `scripts/a11y-audit.mjs` as text (no
  boot, no vm). `extractSeamIdentifiers` locates the unique
  `Object.assign(/** @type {any} */ (globalThis), {` anchor (asserts exactly
  one occurrence), takes the block up to the next `});`, strips trailing
  `//` comments and full-line `//` group headers in one pass, and asserts
  **exactly 18** identifiers (`SEAM_COUNT` constant — growing the seam needs
  an FD ruling + this constant's update). `extractAuditTier1` recovers the 6
  direct `evaluate(client, wcId, '<name>(...)')` literal/template-literal
  call sites; `extractAuditTier2` recovers the 5 `SHEET_STATES` `open:`
  literals. Lower-bound anti-vacuous guards (≥6, ≥5) rather than exact
  counts, so a future audit addition that's also seam-covered doesn't break
  the suite. `findAuditIdentifiersMissingFromSeam` asserts the union (11
  identifiers today) is a subset of the seam (18) — empty-miss-list
  assertion with a helpful message naming any drifted identifier. All
  extraction/check helpers are pure, in-file functions with their own
  truth-table tests (comment-stripping, zero/multiple-anchor throws,
  tier-1/tier-2 literal-vs-variable discrimination, and the AC5 violation
  case: an audit-driven identifier absent from a synthetic seam is
  detected).
- **AC6 (CP2 fail-on-violation demonstrations)** — both tests' LIVE pin
  paths (not just the in-suite synthetic cases) were demonstrated to fail on
  a real violation, on scratch-dir copies, never the tracked tree. Records
  below.
- **AC7 (gates)** — `timeout 120 npm test`: **1293/1293 pass** (1284
  baseline + 9 new: 2 in `preload-graph-esm-free.test.js`, 7 in
  `seam-contract.test.js`), wall-clock **~971ms** (within the ~1s band,
  both tests are static). `npm run typecheck` clean. `npm run lint` clean.
- **AC8 (artifacts)** — this entry; leg status `ready` → `in-flight` →
  `landed` (no ARTIFACTS.md transition-time handling defined for this
  project); leg checked off in `flight.md`.

#### AC6 — CP2 fail-on-violation demonstration records

**(a) Require-cache pin (DD3a) — synthetic CJS→ESM require edge, scratch dir**
(outside the tracked tree; `run-demo.js` duplicates the exact
`sourceHasEsmExport` detector and require.cache walk from the test file):

- `src/shared/violation-esm.js` (scratch): `export const X = 1;` — a
  synthetic converted-to-ESM shared module.
- `src/shared/fake-preload-reachable.js` (scratch): a synthetic
  PRELOAD-REACHABLE CJS-by-design module (`require('./violation-esm'); module.exports = {};`)
  — the exact require-edge shape the pin guards against.
- Ran `node run-demo.js`: the walk found both scratch `src/shared/` paths in
  `require.cache` (anti-vacuous confirmed working), then failed exactly as
  expected:

  ```
  AssertionError [ERR_ASSERTION]: .../scratchpad/cp2-dd3a/src/shared/violation-esm.js is reachable via
  require() from a PRELOAD-REACHABLE src/shared/ module but contains a top-level ESM export — this is the
  preload-graph-ESM-free invariant (DD3a): a require() edge onto a converted module breaks under real
  Electron (require(esm) is unsupported there), even though vanilla Node loads it transparently.
  true !== false
  ```

  Exit code 1. Confirms the LIVE require-cache walk (not merely the
  detector's truth table) fails on this violation class.

**(b) Seam-contract pin (DD3b) — mutated copies of the real files, scratch dir**
(AC5's synthetic case is the permanent in-suite demonstration; this is the
additional live-path demonstration against copies of the actual tracked
files, per the leg spec):

- Copied `src/renderer/renderer.js` → scratch `renderer.js.copy` (unmodified
  — the real 18-entry seam).
- Copied `scripts/a11y-audit.mjs` → scratch `a11y-audit.mjs.copy`, then
  inserted one line after the existing `closeLightbox()` call:
  `await evaluate(client, wcId, 'notInSeamFunction()');` — a synthetic
  evaluate-driven identifier absent from the seam.
- Ran `node run-demo.js` (duplicating `extractSeamIdentifiers` /
  `extractAuditTier1` / `extractAuditTier2` / `findAuditIdentifiersMissingFromSeam`
  from the test file, unmodified logic, against the copies): seam count 18
  (unchanged, confirms the mutation was audit-side only); tier1 recovered 7
  identifiers (the 6 real + `notInSeamFunction`); tier2 recovered the 5 real
  identifiers; the subset check failed exactly as expected:

  ```
  AssertionError [ERR_ASSERTION]: a11y-audit.mjs drives ["notInSeamFunction"] via evaluate(), but the
  renderer.js seam block does not republish it — either add it to the seam (FD ruling required) or fix
  the audit script
  + actual - expected
  + [ 'notInSeamFunction' ]
  - []
  ```

  Exit code 1. Confirms the LIVE seam-vs-audit extraction (not merely the
  in-suite synthetic truth-table case) fails on this violation class.

No tracked files were mutated for either demonstration — both ran against
files under the session scratchpad (`/tmp/.../scratchpad/cp2-dd3a/`,
`/tmp/.../scratchpad/cp2-dd3b/`), outside the repository tree, cleaned up
after the demonstration.

---

## Decisions

*(none yet)*

---

## Deviations

*(none yet)*

---

## Anomalies

*(none yet)*

---

## Session Notes

### Flight design session (2026-07-11)

- Reconnaissance pass (report above) against main @ 5a3d8eb: all source
  items confirmed-live; edit 3 widened per F2 debrief Rec 1; operator
  ruled both F2-debrief test recommendations (Recs 2–3) onto this flight
  as leg 2 (`invariant-pins`).
- Architect design review (probe-based, read-only): **approve with
  changes**. All CLAUDE.md line anchors verified byte-accurate; DD3(a)
  require-cache mechanics empirically confirmed (require(esm) lands a
  readable `require.cache` entry under `node --test`; synthetic
  violation detected; `node --test` per-file process isolation rules out
  cache pollution; `automation-dev.js`/`internal-page.js` have zero own
  requires today — pure forward pin). One medium issue folded into DD3:
  seam extraction must be two-tier (direct `evaluate` literals + the
  `SHEET_STATES` `open:` literals — naive pattern recovers only 6/11
  identifiers). Two suggestions folded into leg-1 guidance: preserve the
  still-true `guest-forward-allowlist.js` sentence; fix the seam's
  `openContainerOverlay` consumer tag (comment-only `src/` edit,
  sanctioned in the spec's Verification section). Fixes adopted verbatim
  from the reviewer's probe-proven recommendations — second review cycle
  skipped.

### Flight Director Notes — execution session (2026-07-11)

- Crew file `leg-execution.md` validated (Crew / Interaction Protocol /
  Prompts present). Flight branch `flight/03-doc-promotions` created off
  main; flight status `ready` → `in-flight` (no transition-time handling
  defined in ARTIFACTS.md).
- **Leg 1 design** (`01-claude-md-promotions.md`): designed from the recon
  report + flight DD1; all 12 code citations re-verified against the tree
  at design time (all OK; one cosmetic drift — a11y-audit SHEET_STATES
  :395-401 → :394-402, symbol-cited instead). Developer design review:
  **approve with changes** — one low issue (AC1 source attribution: DD6
  covers the name-input case only; the generalization is the F4 leg-2
  design-review FD ruling) + one clarity suggestion (renderer-globals.d.ts
  survives; only its shared-module ambient declares retired). Both applied.
  Reviewer independently dry-ran the AC6 sweep grep (7 hits, all inside
  AC3's target sections) and confirmed the gate baseline green (1284/1284,
  typecheck, lint). Changes cosmetic → second review cycle skipped
  (per-skill discretion). Leg 1 status → `ready`.
- **Leg 1 implementation**: Developer spawn implemented all 8 ACs; gates
  green (1284/1284, typecheck, lint); `git diff src/` = one comment-only
  hunk as sanctioned. Leg 1 `landed`, uncommitted per the batched-review
  workflow.
- **Leg 2 design** (`02-invariant-pins.md`): designed from flight DD2/DD3 +
  the Architect's probe rulings; 9 citations verified (a11y-audit
  SHEET_STATES symbol-cited; the flight's `:395-401` is `:394-402` in the
  tree). Developer design review (empirical, scratch-dir probes):
  **approve with changes** — [medium] the suggested ESM-detector regex
  missed `export async function` (live pattern at
  `scripts/lib/mcp-client.mjs:58`; probe-confirmed false negative) →
  `async\b` alternative + truth-table case now REQUIRED; [low/med] the
  seam trailing-comment count was 6, not 5/"three" — corrected. Reviewer
  independently reproduced the full extraction (18 seam / 6+5 audit /
  union ⊆ seam) and the require-cache mechanics. The reviewer's
  vanilla-Node require(esm) observation was ruled a non-reopener: the F2
  constraint is Electron-42-empirical, and the pin is source-text based —
  valid under either runtime behavior (edge-case note added to the leg).
  Fixes adopted verbatim from probe-proven recommendations — second
  review cycle skipped. Leg 2 status → `ready`.
- **Leg 2 implementation**: Developer spawn implemented all 8 ACs; both
  CP2 fail-on-violation demos reproduced on scratch copies and recorded;
  gates green (1293/1293 = 1284 + 9 new, ~971ms; typecheck; lint); no
  `src/`/`scripts/` changes. Leg 2 `landed`.
- **Flight review (batched, Phase 2d)**: Reviewer spawn (Sonnet, fresh
  context) evaluated ALL uncommitted changes against both legs' ACs +
  flight DD1–DD3/CP1/CP2; independently re-ran the CP1 sweep, both CP2
  violation demos, and all three gates. Zero issues (blocking or
  non-blocking); `[HANDOFF:confirmed]` on the first cycle — no fix loop
  needed.
- **Landing**: leg statuses → `completed`; CP1/CP2, Contributing to
  Criteria, and the Post-Flight checklist checked; flight status →
  `landed`; Flight 3 checked off in mission.md. Phase-3 documentation
  check: CLAUDE.md IS the deliverable; no new commands/endpoints/config —
  README and docs/ correctly untouched. Single flight commit + draft PR
  per the batched workflow, PR marked ready at landing.
