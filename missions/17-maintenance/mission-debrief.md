# Mission Debrief: Codebase Health — 2026-08-27 Maintenance

**Date**: 2026-08-30
**Mission**: [Codebase Health — 2026-08-27 Maintenance](mission.md)
**Status**: completed
**Duration**: 2026-08-27 (scaffolded from the maintenance report) – 2026-08-30 (last flight merged, PR #194)
**Flights Completed**: 5 of 5 substantive (Flight 6 optional, deliberately unrun)

## Outcome Assessment

### Success Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| 1 · Keyboard-only focus chrome→active view | **Met** | F1/#188. Shared `tab-boundary.js` used by chrome + both guest preloads; F6/Shift+F6 both directions; Enter-in-address-bar hands off on commit. Verified by `chrome-guest-keyboard-nav` 15/15 + `npm run a11y`. Residual: trailing-iframe forward-Tab wrap ruled non-trap (WCAG 2.1.2, F6 is the standard exit), routed to Flight 2/#147 — not owed by this mission. |
| 2 · Omnibox suggestion highlighting exposed to AT | **Met** | F1/#188. `#suggest-status` `role="status" aria-live="polite"` fed by pure `suggestionAnnouncement(model)` on the existing cross-view channel (DD12); invalid `aria-expanded` retired (DD11). `omnibox-suggestion-announcement` 8/8. |
| 3 · Internal-session boundary is tier-based | **Met (on a reframed definition)** | F2/#191. **Reframed mid-mission (2026-08-28):** the original "refuse internal even for admin" was inverted to non-admin-refused / admin-may-reach-internal-guests / secret-sheet-walled-for-all. `resolve.js` non-admin wall at `:233`; sheet gate `:210-214` not lifted by `allowInternal`; `AUTOMATABLE_MENU_TYPES` unchanged. `resolve.js` shipped an **empty diff** (the wall was never touched). The single largest scope decision of the mission — see Lessons (false-premise incident). |
| 4 · vaultFill/vaultAnswerAuth through the same allowlist path + download validation | **Met** | F2/#191. `vault-context.js resolveTarget` (`:426`) threads sheet/tab/popup identity into both resolve paths, never `allowSheet`; `register-download-ipc.js` resolves via `getTabContents` and validates `show-item-in-folder` paths against `approvedDownloadDirs`/known records. |
| 5 · Sheet lifecycles have executable verification (no source-text-only) | **Met at the ruled level (partial vs. the ideal)** | F3/#192. All **19** register sites → `createSheetEntry` (0 raw `menuController.register`); secret-show scrubs relocated to importable template `scrub()` closures, pinned red-on-delete. The criterion's literal text is met. **Carried gap:** each sheet's `onOpen`/`onClose` behavioral middle still lives in the un-importable `menu-overlay.js` IIFE and is unit-tested by none; rendered-state verification of the non-secret sheets (the coverage the *cut* Lever A would have given) remains absent. Do not let the next mission assume these sheets are behaviorally covered. |
| 6 · manager.json KDF validated on read + fresh adopt forces rotation | **Met** | F4/#194. `validateImportedKdf` at the `_readManager` choke point (`:390`, fail-closed); fresh adopt rotates recovery+admin inline under the live MRK (donor envelopes discarded, donor **master** retained as the documented DD4 residual). `npm test` 4003/0; guided HAT passed with on-disk confirmation. |
| 7 · Prettier enforced | **Met** | F5/#182,#184. `prettier --check .` clean; `format:check` in both CI definitions; `.git-blame-ignore-revs` carries the reformat sha; line budgets re-based and still enforced. Squawks 0039–0043 closed. |
| 8 · All gates stay green (suite, typecheck, lint) | **Met** | Re-run on `main` at debrief: prettier exit 0, typecheck exit 0, lint exit 0, `npm test` **4003/4003, 0 fail / 0 skip / 0 todo**. Zero-skip/zero-todo streak held across the whole mission. |

**Summary: 7 met, 1 met-at-the-ruled-level (criterion 5). No criterion unmet or silently dropped. Criterion 3 was met on a mid-mission reframed definition (fully recorded).**

### Overall Outcome

The mission achieved its outcome — resolve the codebase-health issues surfaced by the
2026-08-27 maintenance inspection — and the outcome was still the right goal at the end.
Across five flights the system's architecture **improved net**: new shared seams
(`tab-boundary.js`, `createSheetEntry`) that removed real duplication, a materially
tighter and honestly-documented vault trust boundary, a simplified-and-provable automation
trust model, and enforced formatting. Every gate is green on `main`. The one structural
ceiling surfaced but not removed — the un-importable `menu-overlay.js` IIFE — is named and
now has an incremental path (`createSheetEntry`) rather than a big-bang one.

## Flight Summary

| Flight | Status | Key Outcome |
|--------|--------|-------------|
| F1 · Keyboard reachability & omnibox semantics | completed (#188) | Chrome↔guest focus handoff via shared `tab-boundary.js`; AT-exposed suggestion announcements on the existing cross-view seam |
| F2 · Automation internal-session invariant | completed (#191) | Automation trust collapsed to one resolver-tier wall + the secret-sheet lock; non-admin wall proven untouched (empty `resolve.js` diff); criterion reframed on corrected facts |
| F3 · Sheet lifecycle verification | completed (#192, +squawk 0050/#193) | 19 sheets → `createSheetEntry`; secret scrubs relocated to red-on-delete template closures; Lever A (allowlist widening) cut |
| F4 · Vault trust-boundary hardening | completed (#194) | Read-path KDF fail-closed; fresh-adopt forced recovery+admin rotation with sequential one-time-sheet surfacing + autolock suppression; DD4 master residual named |
| F5 · Prettier adoption | completed (#182, #184) | One-time reformat under the existing config; `format:check` in both CI defs; budgets re-based, pins re-targeted |
| F6 · DOM harness for chrome *(optional)* | not run | Conditional on the four scaffolded flights landing with spare capacity; they did not — skipping honored the plan. Now **owed** debt (see Action Items). |

## What Went Well

- **Risk-tiered per-leg design review with an empowered reviewer — the mission's
  standout methodology win, and it paid for itself repeatedly *before code was written*.**
  F1 caught a renderer-budget off-by-one and a false "zero renderer lines" premise; F2
  caught a plumbing regression; F3 caught an *unsatisfiable acceptance criterion*; F4
  caught two lockout-class failures (the `'superseded'` sheet clobber and an unsafe
  autolock fallback) and restructured the flight. Standardize: HIGH-tier legs get a
  mandatory pre-implementation review empowered to restructure legs and upgrade guards.
- **RED/GREEN neuter-scrub per pin.** Every structural pin was proven to go red when its
  guarded line is removed — F4's per-leg records, F5's twelve-row per-pin table, F1's
  structural pins. This is what made F5's ~17k-insertion reformat reviewable and F4's
  crypto changes trustworthy.
- **Choke-point validation and injected-deps testable factories.** F4's
  `validateImportedKdf`-at-`_readManager`, F2's resolver-as-the-one-wall, and
  `createSheetEntry` are the same instinct — put the check/seam where every path funnels
  and prove the funnel.
- **Honest residual accounting.** DD4 (donor master envelope still unwraps the adopted
  vault) and the criterion-5 per-sheet gap are named as half-retired invariants, not
  papered over. The next mission inherits truthful boundaries.
- **The methodology-feedback loop itself worked** — every flight debrief independently
  surfaced the same recurring lessons (below), which is the signal that the debrief
  discipline is doing its job.

## What Could Be Improved

- **Verify falsifiable premises, not just mechanics (the mission's most important process
  lesson).** F2's security DD rested on "admin is dev-only, cannot exist in a packaged
  build," which was **false** — it survived recon, two design reviews explicitly tasked
  with the security reasoning, and Leg 1, caught only when a Leg-4 doc subagent had to
  cite the mint-gating code. Everyone verified *which gate fires when* without verifying
  *can admin exist packaged*. The outcome is sound (operator re-decided keep-as-is on
  corrected facts), but a mission-scope security decision rode partly on a false claim.
  The convergent fix — **state each "X cannot happen" premise as a falsifiable claim and
  cite the gating code before the ruling** — recurs in F4 as "read the callee's
  preconditions before citing it as a reuse target" (the `rotateRecovery` step-up miss).
- **The line-budget metric trap** (`wc -l` vs `split(/\r?\n/).length`) recurred across F5
  and F1 — encode it once as a leg-design checklist item.
- **Metric-of-record hygiene.** F3 propagated an unmeasured "3988" into commit/PR/log
  (real count 3982); F5 inherited two stale planning baselines. Same fix: measure every
  number at its actual base commit before it enters an artifact.
- **The recurring unit-test transient flake (F2/F3) is still unidentified** and on
  standing watch — three debriefs now carry it unclosed. The next red-then-green run must
  capture the failing test name immediately.

## Lessons Learned

- **"Adopt inherits a trustworthy donor manager" is now half-retired** — killed for
  recovery+admin, still standing for the master envelope (DD4). Any future portability
  work must treat the *entire* donor manager as untrusted.
- **Admin-tier trust is deliberately concentrated post-F2-pivot** — an enabled admin
  session on a packaged build has full `evaluate`/`injectScript`/DevTools reach into the
  Settings and vault *pages* (backstopped by the high enablement bar + the sheet wall).
  This is an accepted capability trade, and the deferred god-mode mission widens it
  further — it must be treated as first-class there (candidate mitigation: an audit log of
  every admin-tier internal-page op, restoring visibility without re-narrowing the
  capability).
- **Grep-shape pins are a liability that keeps recurring** — F3's brittle
  `sheet-automation-gate-invariant` AC8, F5's reformat-fragile source-text pins, F13's
  `welcome-controller.js` grep-only contract. The Flight-6 DOM harness is the enabling
  refactor that would let several of these become behavioral tests.

## Methodology Feedback

Seven checklist/rule items have accumulated across the four flight debriefs and are
**overdue for a single batched mission-control review** (each debrief flagged them as
unreviewed carries): (1) the security-premise citation-audit item (F2); (2) the
line-budget-metric item (F1/F5); (3) the design-time testability-premise audit (F3); (4)
the callee-preconditions check (F4); (5) re-measure-baselines-at-base-commit (F5); (6) the
whole-tree-transform-must-gate-on-typecheck hazard class (F5); (7) the AUTHORING.md
negative-assertion-needs-instrumented-read rule (F1). Recommend one pass to fold these into
the `agentic-workflow` leg-design risk checks and the behavior-test authoring guide.

**Orchestration experience (mission ran fully agent-orchestrated).** The mission was driven
as a sequence of orchestrated flights — the operator initiated each ("do flight N") and the
Flight Director ran design reviews, agent spawns, HATs, and commits. The pattern held up:
handoffs between design-review / Developer / Reviewer agents were clean, the single-deferred-
commit-per-flight model kept dangerous intermediate states (e.g. F4's rotate-but-unsurfaced)
from ever shipping, and the two HATs (F1, F4) surfaced real issues automated checks could not
(F4's HAT caught the multi-jar export-scope UX gap). The friction points were premise-level,
not coordination-level: the false-premise incident and the metric-hygiene slips came from
agents verifying mechanics thoroughly while under-checking the claim underneath — which is
exactly what the batched checklist items above target.

## Action Items

- [ ] **Scaffold a "Vault Portability & Compromise-Mode" mission** (recommendation,
  operator go pending) — bundle the four interlocking pieces that share the vault envelope
  model and F4's one-time-sheet surfacing: (a) DD4 master-envelope severing
  (`changeMasterPassword` re-wrap on adopt); (b) F6 MRK re-key / compromise-mode rotation;
  (c) the multi-jar export/adopt enhancement (flight-log Anomalies; *re-enters F4's
  forced-rotation + surfacing branch*, so design with it, not apart); (d) the deferred
  admin "god mode" — which must ship as one atomic capability (enforced-isolation gate +
  tested kill switch + a fourth `build*IndicatorModel` all-access indicator), never the
  read-surface widening alone. Carry the F2 admin-trust-concentration audit-log candidate
  into it.
- [ ] **Batched mission-control methodology review** — fold the seven accumulated checklist
  items (above) into `agentic-workflow` and `behavior-test/AUTHORING.md`.
- [ ] **Complete the open squawks** — **0051** (window-teardown clear untested — real,
  lockout-adjacent), **0052** (`SCRYPT_PARAMS`/`validateImportedKdf` guard-test — latent
  but cheap), **0053** (document the sequential dismiss-locked sheet pattern). Deferred
  a11y squawks **0044** (toolbar focus ring) and **0049** (shadow-DOM tabSequence) remain
  carried with revisit-triggers.
- [ ] **Restore the chrome-MCP behavior-test apparatus, then author two regression specs** —
  the fresh-adopt surfacing chain (recovery→ack→admin, no clobber, unlocked) and, when
  god-mode runs, the isolation-gate + kill-switch refusal. Both are currently *un-runnable*
  (the `goldfinch`/`goldfinch-development` MCP servers failed to connect this session —
  AUTH_HEADER_REJECTED / CONNECT_TIMEOUT); the apparatus fragility across sessions is itself
  a standing methodology risk to name.
- [ ] **Flight-6 DOM harness is now owed debt** (not free) — F13 `welcome-controller.js`
  factory-deps harness, F18 `helpers/fake-dom.js` extraction, F16 `internal-preload.js`
  pin; the enabling refactor for turning several brittle grep pins into behavioral tests.
  First-class candidate for the next maintenance cycle (alongside F4 MCP rate limiting and
  #150, already listed as next-cycle carries).
- [ ] **Pay down the remaining F34 docs** (popup + drag subsystem chrome-indicator
  subsections) on the next flight touching those files; extract `_mintRecoveryAndAdmin` if a
  third recovery+admin minting site appears; give `_pendingVaultImports` the teardown hook
  its neighbor now has.
