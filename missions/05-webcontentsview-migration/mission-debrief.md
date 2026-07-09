# Mission Debrief: WebContentsView Migration

**Date**: 2026-07-09
**Mission**: [WebContentsView Migration](mission.md)
**Status**: completed
**Duration**: 2026-06-23 (spike) → 2026-07-09 (shipped v0.6.0)
**Flights Completed**: 9 of 9 (F1–F4, F7–F9, F5, F6 — all completed)

## Outcome Assessment

### Success Criteria Results
| Criterion | Status | Evidence |
|-----------|--------|----------|
| SC1 — Native guest surface | ✅ Met | Web + internal tabs render via `WebContentsView`; `<webview>` machinery removed (F3); source-absence re-verified (F6 Leg 2). |
| SC2 — Spike-gated commitment on pixels | ✅ Met | F1 clean GO on pixel/assertion evidence; recorded go decision. |
| SC3 — Browser-behavior parity | ✅ Met | Browsing/tab/chrome-UI corpus PASS 8/8 on the native surface (F6 Leg 1). |
| SC4 — Conveniences parity (event-seam) | ✅ Met | Convenience corpus + `npm run a11y` PASS (F5); the ~130-line D1 find workaround deleted (F4). |
| SC5 — Privacy & trust preserved | ✅ Met | Farbling, per-jar Shields, partition isolation, internal trust model re-verified live (F5); byte-exact partition transfer (F3). |
| SC6 — Automation (MCP) parity, no drift | ✅ Met | `mcp-*` + automation corpus PASS end-to-end on the view surface (F5). |
| SC7 — Side-panel compositing (#27/SC10) | ✅ Met | Certified F9 — pursued only where free; closed by retiring the un-animatable slide. |
| SC8 — Frameless window & controls, per platform | ✅ Met | Linux/WSLg in-loop; **macOS by build-readiness** (installer builds green; runtime deferred — the mission's standing caveat). |

### Overall Outcome
**The mission achieved its stated outcome and shipped it as v0.6.0.** Goldfinch renders guest pages as native
main-process `WebContentsView`s on a `BaseWindow` at full behavior parity — the privacy/trust model, the
conveniences, and the full MCP automation surface all survived, proven against the behavior-test corpus. The
architectural constraint behind the five recurring "DOM-correct ≠ render-correct" failures is addressed (see the
founding-thesis verdict below). Bonuses beyond scope: SC7 (#27) certified, the long-standing WSLg find cold-start
count bug root-caused and fixed (F7), and **docked DevTools is now structurally unblocked** (guest has a native
host region) though not yet built.

**Founding-thesis verdict — MITIGATED (root cause split, handled in two halves):**
- **"Renderer can't position/observe the guest" → ELIMINATED.** Guest geometry is now main-process-authoritative:
  find `{0,0}` cold-*position* gone, `found-in-page` delivers to the main `webContents` (D1 deleted), context-menu
  coordinate double-counting gone (sheet covers the guest 1:1).
- **"The out-of-process compositing surface itself" → RELOCATED UNCHANGED, then fenced by invariant.** F9 proved a
  `WebContentsView` guest re-bounds in one discrete `setBounds` step exactly as `<webview>` did — **un-animatable on
  every platform**. #27 was closed by *retiring* the slide animation, not by making animation work; the invariant
  ("never animate chrome layout that resizes the guest slot") is now in CLAUDE.md. Sharp finding: the three cited
  "recurring failures" had **three different root causes** (F7 = inverted `findNext` semantics; F8 = WSLg
  XWayland input; F9 = the genuine compositing case) — unified only by the *detection methodology*, not the thesis.

## Flight Summary
| Flight | Status | Key outcome |
|--------|--------|-------------|
| F1 — Spike & decision gate | completed | Clean GO on pixels; retired a multi-flight structural risk in one session. |
| F2 — Window shell | completed | `BaseWindow` + chrome `WebContentsView`; the engine accessor-contract flip caught in review. |
| F3 — Tab surface | completed | Guest tabs (web + internal) as views; byte-exact partition trust; `<webview>` machinery removed; pivot to freeze-frame. |
| F4 — Conveniences & event-seam | completed | Find re-home (D1 deleted); the apparatus 3rd axis (*wiring*) named; convenience corpus deferred. |
| F7 — Floating overlay find bar | completed | Overlay-view pattern; inverted-`findNext` cold-start bug fixed (bonus). |
| F8 — Menu overlay sheet | completed | All menus on a live-guest overlay sheet; freeze-frame deleted; multi-view keyboard bridge flagged as architectural. |
| F9 — Panel slide composition | completed | SC7 certified; the un-animatable-guest-geometry invariant (the mission's deepest finding). |
| F5 — Keyboard bridge & parity sweep | completed | Cross-view keyboard bridge; SC4/SC5/SC6 certified; two false-alarm security triages via Witnessed. |
| F6 — Parity land & v0.6.0 release | completed | SC3 corpus; `nav.js` hardening; `<webview>` sweep; merged to `main`; **shipped v0.6.0**. |

## What Went Well
- **Spike-gated commitment (F1).** A throwaway spike with a validated pixel apparatus converted a "high-risk
  migration" into "mechanical migration with a proven per-flight approach," and honestly enumerated what it did
  NOT test (macOS, sub-frame transient) so the GO couldn't be mis-read.
- **Trust transferred for free (F3).** Because the boundary keys on **session-object identity**, not the
  `<webview>` substrate, byte-exact `INTERNAL_PARTITION` reuse carried the entire internal trust model onto the new
  surface with zero gate-code change — the highest-leverage structural fact of the mission.
- **The overlay-view pattern (F7→F8)** answered "HTML cannot float over a native content view" (F3's structural
  finding): main-owned overlay `WebContentsView`s over the live guest, which let the freeze-frame apparatus be
  deleted outright.
- **The three-axis apparatus premise (act / observe / *wiring*) + the wiring litmus.** Earned in F4 (the
  foreign-instance blocker), it was the single most repeatedly-valuable methodology pattern — in F5 the litmus
  caught the reserved-port `EADDRINUSE` *before* a whole corpus ran mis-bound.
- **The Witnessed driver≠judge separation** caught **two** scary-looking "security regressions" (F5 admin-vs-jar
  confusion; F6 dev-vs-prod profile mismatch) that were observation-setup artifacts, not product defects.
- **Debt is named and ranked in the debriefs, not discovered at the retrospective** — the failure mode was
  *deferral of known cleanups*, not hidden fragility.
- **Operator-gated release discipline (F6):** parity → merge → CI dry-run → STOP → tag; the build-only dry-run
  validated publish *gating* and licensed the irreversible tag.

## What Could Be Improved
- **macOS was runtime-unverified for the entire mission (the largest ship-with risk).** Named as accruing debt
  as early as F2, it was never resolved — no in-loop mac venue existed. v0.6.0 ships a mac arm that is
  **runtime-unverified, arm64-only, and unsigned**. This should have forced an explicit mid-mission decision
  (acquire a venue, or scope mac out), not accrued silently to the landing gate.
- **Overlay-view consolidation slipped twice.** F7 Rec 6 and F8 Rec 2 ("extract a shared `createOverlayView` base
  *before* Flight 9") both recommended it; it did not happen. The find overlay lives inline in a 2545-line
  `main.js` (75 refs) while the menu sheet is cleanly extracted — two divergent hand-rolled copies of the same
  lifecycle. **The #1 structural debt shipped.**
- **Parity inheritance carried defects (F7).** The migrated find code faithfully reproduced an inverted `findNext`
  reading because the original had it. Migration ACs need *parity plus a spot-check of the underlying API contract*.
- **Compositing/render defects were invisible to DOM + automated captures every time** (F2 captureWindow-lies,
  F7, F8, F9) — each required a human HAT or a native platform to surface. Real, recurring methodology cost.
- **Apparatus gotchas were re-learned per flight** (no-double-unwrap; `evaluate` arg is `expression`; readiness
  wait; `openTab` http-only; the reserved port; the dev-vs-prod profile). These belong in a committed project
  automation runbook, not re-discovered each corpus.

## Lessons Learned
- **Guest geometry is un-animatable — a permanent capability ceiling** (F9; now a CLAUDE.md invariant). Split-view
  drag, sliding/animated panels, and any feature that animates layout resizing the guest slot are foreclosed for
  an out-of-process guest; float-over-guest (find bar, menu sheet) or instant transitions are the only options.
- **Trust is a session property, not a DOM property** (F3) — any future view construction for internal content
  must import `INTERNAL_PARTITION`, never derive the string.
- **Pixel probes gate compositing, NOT OS input/focus** (F8) — a probe is structurally blind to click-swallow and
  focus-ring; those need a real-pointer harness or a live HAT. And a green probe reports "no defect at sampled
  settled frames," never "clean" — it must never soften a HAT gate (F9).
- **Cross-platform control before blaming the rig** (F9) — "the last two were WSLg" is not evidence the next one
  is; F9's glitch was cross-platform, corrected at debrief.
- **Test-shape-as-acceptance-criterion for privileged-path guards** (F6 DD6) — a guard whose only meaningful
  exercise is the admin/relaxed path needs a test *constructed on that path*, or coverage is illusory.
- **Substrate-guard audit** (F3) — when a migration changes a substrate's opacity/compositing/DOM-presence, grep
  every guard keyed on the old substrate's properties before shipping.

## Methodology Feedback (upstream to Flight Control / mission-control)
These earned patterns are mission-neutral and belong in the skills, not this project:
1. **Standardize the apparatus-wiring litmus** as a mandatory pre-corpus gate for any apparatus-gated sweep (the
   3rd apparatus axis — act/observe/**wiring**).
2. **The Executor→independent-Validator corpus model with raw-payload evidence from the start** — the driver≠judge
   separation held the Witnessed discipline at scale and caught both false alarms; raw payloads (not prose) should
   be the default, not adopted mid-flight.
3. **Test-shape-as-acceptance-criterion** for privileged-path guards — add to `/leg` guidance.
4. **The operator-gated outward-facing release sequence** (parity→merge→dry-run→STOP→tag) is a reusable
   release-flight template; the build-only dry-run before a tag validates publish *gating*, not just the build.
5. **"Build-readiness" for a multi-arch platform must enumerate which arches the CI runner produces** — don't let
   "mac builds green" quietly mean "arm64 only."
6. **Per-unit (per-spec) artifact granularity makes long agent legs resilient** to transient API failures — two
   529 overloads mid-F5-Leg-1 cost no work because run logs are per-spec and timestamped.
7. **Behavior-test AUTHORING:** promote the `captureWindow`-WSLg-fallback / `readDom`-authoritative apparatus
   hierarchy (F4), and the pixel-probes-gate-compositing-not-input rule (F8).

## Action Items (→ next mission / between-mission maintenance)
- [ ] **Pay down the overlay-view debt FIRST** — extract a shared `createOverlayView(...)` base and retrofit the
  inline find overlay onto it; shrinks the 2545-line `main.js` god file and gives find the offline-testable seam
  the menu sheet has. Should gate any future overlay surface (no third hand-rolled copy).
- [ ] **Stand up a macOS runtime venue** and run the deferred mac HAT set (keyboard bridge cross-view Tab + Ctrl+L,
  find float, menu sheet, instant panel, traffic lights/drag, CDP-conflict, find match-count, focus-ring,
  spellcheck squiggle). Decide **x64/universal** mac arch; add **Developer-ID signing + notarization** once a cert exists.
- [ ] **Resolve the settings-page a11y strategy** — how to audit internal `goldfinch://` pages without weakening the
  DD5 internal-session exclusion that keeps them safe (security-vs-auditability tension).
- [ ] **Design future guest-region features against the un-animatable ceiling** (no split-view/animated-panel
  without a different mechanism).
- [ ] **Docked DevTools** — the unclaimed "now-free" capability the migration unblocked; natural first parity→features step.
- [ ] Smaller carry-forwards: belt-and-suspenders live two-agent re-run of the 2 BLOCKING security specs;
  re-observe the page-context Escape target per invocation and reconcile `page-context-menu.md`; promote any
  still-`draft` regression specs to `active`; decide on an `input.js` op-local internal guard; commit a project
  automation runbook (the apparatus gotchas + port 8899 + the `goldfinch-dev` profile); set `desktopName` in the
  electron-builder linux block; consider `update-readme` → PR instead of push-to-`main`.

**Recommended next step:** `/routine-maintenance` — a between-mission codebase health pass is the right vehicle to
scope the overlay-view consolidation + the macOS venue + the runbook into a maintenance mission before the next
feature mission opens the door from parity to new capability.
