# Flight Log: Accessibility — Keyboard & Screen-Reader Baseline

**Flight**: [Accessibility — Keyboard & Screen-Reader Baseline](flight.md)

## Summary
Not yet started.

---

## Reconnaissance Report

**Date**: 2026-06-06 · **Source artifact**: [maintenance/2026-06-05.md](../../../../maintenance/2026-06-05.md) (Accessibility addendum — F22, F23, F24)

The maintenance report's cited line numbers predate Flights 1–4, which edited `renderer.js` and `styles.css` (poster sanitize, container-color validation, whole-repo lint/format/typecheck). All cited locations **drifted** but were re-located against current `main`; every gap was then re-verified. **No items are already-satisfied — all three findings are confirmed-live.** Re-located citations below supersede the report's numbers.

| Item | Classification | Evidence (current `main`) | Recommendation |
|------|----------------|---------------------------|----------------|
| **F22** — tab strip non-operable by keyboard/SR | `confirmed-live` (drifted from report's `renderer.js:122-132`) | Tabs are `<div class="tab">` built at `renderer.js:160-177` with a click-only listener (`:169-175`); close is a `<span class="tab-close">✕` (`:168`); no `tabindex`/`role`/`aria-selected`/keydown. Strip container `#tabs` is a bare `<div>` (`index.html:15`). `activateTab` toggles only a `.active` class (`:198-212`). | Real work. `role="tablist"`/`role="tab"` + roving tabindex + arrow-key nav + `aria-selected`; close becomes a focusable `<button>` with an accessible name. Pin with a behavior test. |
| **F23** — missing/stale accessible names; no visible focus | `confirmed-live` (drifted from report's `:182-183,264`/`:867-874`/`styles.css:101`) | Reload `title="Reload"` is static (`index.html:26`) while `renderer.js` swaps only `textContent` ⟳↔✕ for Stop (`:233,236,351`). Shields switches set `role="switch"`+`aria-checked` but **no** accessible name (`toggle()`, `:1053-1060`). Icon-only toolbar buttons name via `title` only (`index.html:16-17,24-26`); media-card `iconBtn` title-only (`:499-509`); player transport title-only (`index.html:75-77`). `#address` has `outline:none` (`styles.css:153`); **no `:focus-visible` rule anywhere**. | Real work. `aria-label` on every icon-only control; sync reload name with Stop/Reload; label each switch; add a global `:focus-visible` indicator (≥3:1). |
| **F24** — remaining WCAG 2.1 AA gaps | `confirmed-live` (drifted; 7 sub-items) | No `prefers-reduced-motion` (animations at `styles.css:189-191,593-595,748,762,514`). No live regions (`#toasts` `index.html:98`, `#media-empty` `:66`). Lightbox lacks `role="dialog"`/focus-trap (`index.html:101`; Escape exists `renderer.js:641-647`); container menu + panels lack Escape/focus mgmt (`:88-119`). `#address` unlabeled (`index.html:28`); toolbar/tabstrip are bare `<div>`s (`:14,22`). Color-only state (`.tab.active` `styles.css:67`, `#toggle-privacy.alert` `:690`, `.filter.active` `:227`). `--fg-dim #9a9ca6` small-text + `.switch` off-track `#555` contrast (`styles.css:6,745`). Media-pick checkbox unlabeled (`renderer.js:421-435`). | Real work, batchable. Sub-items are independent; may split if one leg is too large. |

**Recon outcome**: nothing to retire; no scope reduction. The only correction vs the source artifact is the drifted citations (recorded above and to be reflected in the flight's Technical Approach). Carried into the flight per the methodology — no items silently dropped.

---

## Leg Progress

---

## Flight Director Notes

### 2026-06-06 — Flight start (`/agentic-workflow`)
- Phase file loaded: `.flightops/agent-crews/leg-execution.md` (valid — Crew / Interaction Protocol / Prompts present). Crew: Developer (Sonnet), Reviewer (Sonnet, never Opus).
- **Accessibility Reviewer** crew exists but is `Enabled: false` (project config). Decision: respect the config — do not auto-spawn per leg. This flight's a11y gate is the `tab-keyboard-operability` Witnessed behavior test + the `npm run a11y` axe sweep + screenshot review (the verify-a11y leg), backed by the per-leg Reviewer checking criteria compliance. Will reconsider spawning one Accessibility Reviewer at the single flight-review stage given the flight is wholly a11y work.
- Branch `flight/05-accessibility-baseline` created off `main`; planning artifacts (flight.md, flight-log.md, tab-keyboard-operability.md) committed as the flight-start commit. Flight status `ready → in-flight`.
- Total legs: 5 — `tab-strip-a11y`, `control-names-and-focus`, `aa-semantics`, `aa-visual`, `verify-a11y`. Legs 1–4 autonomous; `verify-a11y` is operator-gated (runs `/behavior-test` + axe). Per the deferred model, code review + commit batch after the last **autonomous** leg (aa-visual); the verify leg runs separately.

## Decisions

---

## Deviations

---

## Anomalies

---

## Session Notes

### 2026-06-06 — Flight planning (`/flight`)

Fleshed the `ready` stub into a codebase-validated spec. Recon (above): F22/F23/F24 all confirmed-live; only line numbers drifted. Operator decisions: **4 implementation legs** (F24 split into `aa-semantics` + `aa-visual`), **axe-core audit** for F23/F24 breadth alongside the F22 behavior test, **no HAT leg**; a final `verify-a11y` leg added per the Flight 2/3/4 `verify-*` house pattern.

Authored behavior-test spec `tests/behavior/tab-keyboard-operability.md` (`draft`) for F22. Apparatus (both axes, premise-audited): a CDP client **attached to the app's `:9222`** (Playwright MCP `--cdp-endpoint` or raw CDP — `chrome-devtools` MCP disqualified, launches its own browser), driving the **renderer** target (not a guest) with trusted key events; observing via a11y tree + `document.activeElement` + screenshot.

**Design review — 2 cycles (Architect, Sonnet):**
- Cycle 1 → *approve with changes*. Key catch: axe would **false-pass** F23/F24 controls in collapsed/hidden DOM (Shields switches, media cards, lightbox don't exist until opened; media needs an HTTP-served fixture). Also: axe `color-contrast` is text-only (can't verify switch-track 1.4.11 / color-independence 1.4.1); apparatus framing vs registered tools; F23 contrast gate unsatisfiable before F24b; global arrow/Delete key-hijack undesigned + untested; Step 4 non-discriminating observable; webview ids + title-tracking close label. All incorporated (DD1/DD2/DD3/DD5, checkpoints, legs, behavior-spec Steps 2/4/8).
- Cycle 2 → all 7 prior issues RESOLVED; 3 small mechanical follow-ups applied directly (axe rule-subset `--rules` param so per-checkpoint sweeps skip deferred contrast; behavior-spec offline-network claim reconciled; media fixture pinned to `tests/behavior/fixtures/a11y-media/`, HTTP-served, single-leg ownership). Within the max-2 cycle budget; follow-ups were minor → no 3rd cycle.
