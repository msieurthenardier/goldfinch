# Leg: pin-a11y-baseline

**Status**: completed
**Flight**: [Internal Page Scheme (`goldfinch://`)](../flight.md)

## Objective
Turn `scripts/a11y-audit.mjs` from a "fail on any violation" gate into a **baseline-diffing** gate —
fail only on violations **not** in a small, hand-curated committed `ACCEPTED` allowlist — and add a
**guest-target axe mode** so a `<webview>` guest (the forthcoming `goldfinch://settings` page) can be
audited, not just the chrome `index.html` target.

## Context
- **Flight DD7** — pin the long-missing a11y baseline as a small, hand-curated committed `ACCEPTED`
  allowlist (`{ id, selector, reason }`), NOT an auto-generated golden dump. Operator clarified the
  user-global snapshot-not-committed rule targets binary clutter/PII, not small text config — so a
  reviewed allowlist is in the same category as the already-committed `nested-interactive` disable.
- **Why now**: the a11y gate has lacked a baseline since mission-01 Flight 5; "no *new* violations" has
  only ever been a manual, by-hand node-target judgment (Flight 1 → 2 → 3 debriefs, thrice-flagged).
  This flight adds a whole `goldfinch://settings` surface (Flight 5 adds much more), where manual
  diffing stops being credible.
- **The harness today** (`scripts/a11y-audit.mjs`): picks the renderer target whose URL ends
  `index.html` (`:81-83`), injects axe, drives 4 UI states (`base-chrome`, `media-panel`,
  `privacy-panel`, `lightbox`), aggregates violations mapped to `{ id, impact, nodes (count), help,
  state }` (`:151-155`), and `process.exit(1)` on any (`:202-210`). It does **not** capture node
  target selectors and never connects to `<webview>` guest targets.
- **Live-truth boundary** (important): the *authoritative* contents of `ACCEPTED` require the live axe
  output, which needs the GUI (`npm run dev:debug`) the autonomous harness can't launch. So this leg
  **builds the mechanism + seeds `ACCEPTED` from the debrief-documented findings**; the **live reconcile
  of the seed against a real run — and the matching update to the mission Known-Issue text — is leg 6
  (`verify-integration`)**, not here. Seed entries are marked so leg 6 can confirm/adjust them.

## Inputs
What exists before this leg runs:
- `scripts/a11y-audit.mjs` (current "fail on any" form).
- The debrief-documented current findings (to seed `ACCEPTED`): per Flight 2 debrief, `npm run a11y`
  reports ~8 moderate structural findings — `region` on `#tabs` / `#brand` / `#address-wrap`,
  `landmark-one-main`, `page-has-heading-one`; per the mission Known Issues, 2
  `scrollable-region-focusable` (WCAG 2.1.1, serious) on the privacy-panel body + the lightbox scroll
  container. These are the seed set (subject to leg-6 live reconcile).
- `package.json` `a11y` script (`node scripts/a11y-audit.mjs`).

## Outputs
What exists after this leg completes:
- `scripts/a11y-audit.mjs` captures node target selectors per violation and diffs the aggregated
  violations against a curated `ACCEPTED` allowlist; exits 0 when every violation is accepted, 1 on any
  **new** (non-accepted) violation; prints accepted violations as informational and new ones as the
  failure list.
- A `--target` (or equivalent) mode that selects a **guest** target by URL substring (e.g.
  `--target=goldfinch://settings`) instead of the `index.html` chrome target, runs axe there, and
  diffs against the same `ACCEPTED` list (scoped/usable by state label).
- `ACCEPTED` seeded with the debrief-documented findings, each annotated `{ id, selector, reason }`
  with a `VERIFY-LEG6` marker in the reason where the entry is seeded-from-debrief and awaits live
  confirmation.
- Offline gates green (`npm test` / `npm run typecheck` / `npm run lint`); no behavior change to the
  4-state chrome sweep other than the accepted-vs-new partition.

## Acceptance Criteria
- [ ] Each aggregated violation now carries its node **target selectors** (e.g.
  `nodes: v.nodes.map(n => n.target)` or equivalent), not just a count, so allowlist matching is by
  `id` + selector, not by `id` alone.
- [ ] An `ACCEPTED` allowlist (array of `{ id, selector, reason }`, optional `state`) exists in the
  script. Matching is **per node, not per violation**: explode each violation into `(id, nodeSelector)`
  pairs and match each pair independently against `ACCEPTED` (same `id` + selector; `state` as optional
  tiebreak). A pair with no matching entry is a **NEW** finding. A single accepted selector must NOT
  suppress a *different* unaccepted node of the same rule id.
- [ ] The script exits **0** iff there are **no** unmatched `(id, nodeSelector)` pairs, **1** otherwise;
  accepted pairs are printed as informational (not silently dropped), unmatched ones as the failure
  list **with their specific selectors** (so leg-6 seed reconciliation is cheap).
- [ ] `ACCEPTED` is seeded with the debrief-documented findings (region ×{#tabs,#brand,#address-wrap},
  `landmark-one-main`, `page-has-heading-one`, 2× `scrollable-region-focusable`), each with a `reason`;
  seeded-from-debrief entries are marked `VERIFY-LEG6`.
- [ ] A guest-target mode (`--target=<url-substring>`) is **statically present and correct**: a
  target-selection predicate matching `type === 'page' || type === 'webview'` by URL substring, plus a
  guest axe-run path that skips the chrome-only state driving. **Offline verification is static only** —
  live target selection against `goldfinch://settings` is deferred to leg 6 (the scheme isn't served
  until leg 2 and isn't embeddable until leg 3, and no http(s) guest is autoloaded in autonomous mode).
  **Flagged assumption for leg 6**: Electron `<webview>`/`goldfinch://` guests may NOT appear in the
  flat CDP `/json` list — if not, the mode needs `Target.getTargets`/`setAutoAttach` rather than the
  flat-list `find`; note this in the code so leg 6 isn't surprised.
- [ ] `nested-interactive` stays disabled (unchanged accepted pattern); existing `--rules` / `--tags`
  / `--url` flags still work.
- [ ] Header comment updated to describe the baseline-diff behavior and the `ACCEPTED` curation rule
  (curated, reviewed-in-PR, NOT auto-dumped). **Keep the existing DD3 origin line and ADD DD7** (the
  file's CSP-injection rationale still traces to DD3); reference DDs by id, not line numbers.
- [ ] Offline gates green: `npm run lint` (which **does** cover `scripts/**` as ESM —
  `eslint.config.mjs`) and `npm test` (unchanged count). **Note: `npm run typecheck` does NOT exercise
  this file** — `jsconfig.json` `include` is `src/**` only, so `.mjs` scripts are out of tsc scope. The
  real correctness net for this leg is `lint` (parse/unused) + the static read-through below, not
  typecheck.

## Verification Steps
- `npm run lint` → 0 problems (ESLint covers `scripts/**` as ESM per `eslint.config.mjs`; this is the
  gate that actually exercises the file — parse + `no-unused-vars`).
- `npm test` → unchanged pass count (this leg touches no `src/**` or `test/unit/**`; pure tooling).
- `npm run typecheck` → still 0, but **does not cover this `.mjs`** (`jsconfig.json` `include` is
  `src/**` only) — run it to confirm no regression elsewhere, not as verification of this change.
- **Static read-through** of `a11y-audit.mjs` (the primary correctness net): the **per-node**
  accepted-vs-new partition is correct (an unmatched `(id, nodeSelector)` pair → exit 1; an accepted
  pair does not, and does not suppress a sibling unaccepted node); the guest-target selector matches
  `type === 'page' || type === 'webview'` by URL substring and `fail()`s clearly if none match; the
  default (no `--target`) path is behavior-equivalent to today apart from the partition.
- **Deferred to leg 6 (live)**: run `npm run dev:debug` + `npm run a11y` and confirm the real
  violations match the seeded `ACCEPTED` (adjust seed, drop/keep the `VERIFY-LEG6` markers), and audit
  `goldfinch://settings` via the guest-target mode. This leg does NOT run the live gate.

## Implementation Guidance

1. **Capture node targets** (`runAxe`, `a11y-audit.mjs:151-155`)
   - Extend the mapped violation object to include selectors, e.g.
     `nodes: v.nodes.map((n) => n.target.flat(Infinity).join(' '))` — axe `target` is
     `CrossTreeSelector[]` and shadow-DOM entries are arrays-of-arrays (`axe.d.ts`), so **flatten
     before join** or a shadow target becomes `"#a #b,#c"`. Keep `impact`, `help`, `state`;
     `nodes`-as-count can become `count: v.nodes.length` if the report still wants a count.

2. **Add the `ACCEPTED` allowlist + partition** (near the top, then applied in `main`'s report block)
   - `const ACCEPTED = [{ id, selector, reason }, …]` — curated, each entry annotated. Seed with the
     debrief findings (see Inputs). Mark seeded-from-debrief reasons with `VERIFY-LEG6`.
   - After aggregation (`allViolations`), explode to per-node `(id, nodeSelector, state)` pairs and
     partition: a pair is **accepted** iff some `ACCEPTED` entry has the same `id` and a `selector`
     matching that node selector (optional `state` tiebreak). Every other pair is **NEW**. (Per-node,
     so an accepted selector never suppresses a sibling unaccepted node of the same rule id.)
   - Report: print accepted pairs under an "accepted (baseline)" heading (informational), NEW pairs
     under "NEW violations" **with their selectors**. `process.exit(0)` iff there are no NEW pairs.

3. **Add the guest-target mode**
   - A new arg (e.g. `--target=<url-substring>`); when present, a sibling `findGuestTarget` selects
     `list.find(t => (t.type === 'page' || t.type === 'webview') && t.url.includes(substring))` instead
     of the `index.html` match, and `main` skips the chrome 4-state UI driving (a guest page has no
     `togglePanel`/`togglePrivacy`/`openLightbox`) — it just injects axe and runs the diff once on the
     guest DOM, assuming the guest is already loaded (no `navigate()`/fixture-load in this mode). Clear
     `fail()` if no matching target. **Leave a code comment** noting the flat `/json` list may not
     surface `<webview>` guests — leg 6 may need `Target.getTargets`/`setAutoAttach` (live-confirmed).
   - Keep the default (no `--target`) path byte-equivalent in behavior to today except the
     accepted-vs-new partition.

4. **Update the header comment** (`a11y-audit.mjs:1-21`)
   - Document: baseline-diff via curated `ACCEPTED` (reviewed in PR, NOT auto-dumped — DD7); the
     `--target` guest mode; that the live reconcile of the seed is leg 6.

5. **Do NOT touch** `mission.md` Known Issues in this leg — that reconciliation needs the live run and
   is leg 6's. Do NOT add a `--update`/auto-dump mode (DD7 forbids it).

## Edge Cases
- **A seeded `ACCEPTED` selector that no longer matches a real violation** (stale seed): harmless here
  — it simply never suppresses anything; leg 6 prunes it. Do not fail on unused `ACCEPTED` entries.
- **Multiple nodes for one violation id, some accepted some not**: partition per **node**, not per
  violation id — an accepted selector must not suppress a *different* node of the same rule. (Capturing
  per-node selectors in step 1 enables this.)
- **Guest target not found** (mode used before the scheme exists): `fail()` with a clear message; this
  leg doesn't run it against `goldfinch://settings`.
- **`n.target` nested arrays** (axe shadow-DOM targets are arrays-of-arrays): flatten/join defensively.

## Files Affected
- `scripts/a11y-audit.mjs` — node-target capture, `ACCEPTED` allowlist + partition, guest-target mode,
  header comment.
- (No `src/**`, no `test/unit/**`, no `mission.md`, no `package.json` change expected.)

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**
*(Batched-commit flight: the Developer implements and updates artifacts but does NOT commit — commit is
deferred to the flight's single review+commit after the last autonomous leg. Signal
`[HANDOFF:review-needed]`, not `[COMPLETE:leg]`.)*

- [ ] All acceptance criteria verified (static + offline gates; live deferred to leg 6)
- [ ] Offline gates passing (`npm test` / `typecheck` / `lint`)
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `landed` (in this file's header)
- [ ] Check off this leg in flight.md
- [ ] Do NOT commit; do NOT signal `[COMPLETE:leg]` — signal `[HANDOFF:review-needed]`
