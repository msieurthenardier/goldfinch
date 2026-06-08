# Flight Debrief: Wire Existing Controls (Shields + Home Page) into Settings

**Date**: 2026-06-08
**Flight**: [Wire Existing Controls (Shields + Home Page) into Settings](flight.md)
**Status**: landed
**Duration**: 2026-06-08 (single agentic session via `/agentic-workflow`)
**Legs Completed**: 7 of 7

## Outcome Assessment

### Objectives Achieved
The global Shields toggles (`enabled`/`block`/`strip`/`isolate`/`farble`) and the home page are now operable
from `goldfinch://settings`, persisting and taking live effect, two-way-consistent with the slide-out panel —
backed by a new **durable, secure settings store** (`settings-store.js`) and an **origin-checked internal-page
bridge** (`internal-ipc.js` `registerInternalHandler`). The Flight-4/5 internal-bridge Known Issue is closed
for all drivable vectors (real privileged IPC is gated at the main process by a sender-frame origin +
internal-session check).

### Mission Criteria Advanced
- **SC7** — met + verified (`settings-controls` behavior test PASS; persistence to `shields.json`/
  `settings.json`; take-effect; two-way panel sync). **This was the mission's last open success criterion —
  all of mission 02's SC1–SC9 are now met.** (Global toggles only; per-site overrides are future — Known
  Issues.)
- **SC8** — met (chrome + guest a11y clean with the wired controls).

### Checkpoints
All five In-Flight checkpoints met: store persists/repairs/validates; bridge rejects non-internal senders +
chrome channels intact; home page editable/persisted/new-tab-opens-to-it; Shields toggles settable + panel
reflects; `settings-controls` PASS + a11y + regressions green.

## What Went Well

- **The pure-module purity standard paid off twice.** `settings-store.js` and `internal-ipc.js` are both
  Electron-free with injected dependencies (path; ipcMain), so the security-critical decision logic is
  unit-tested under plain `node --test` with no stub (29 new tests). `settings-store.js` mirrors **and
  improves** `shields.js` — atomic temp+rename (vs direct `writeFileSync`), per-key validation with a
  throw-on-reject contract (vs silent swallow), schema-versioned + repair-on-corrupt.
- **The mandatory bridge wrapper test caught a real bug — and the Reviewer, not the Developer, found it.**
  The flight-level Reviewer flagged the `!!`-coercion that defeated the predicate's strict `=== true`; fixed
  pre-commit with a pinning regression test (`__goldfinchInternal: 1 → reject`). The "MANDATORY
  (security-critical) wrapper test" leg-2 criterion + the adversarial review are the system working as
  intended.
- **Leg specs were high-fidelity where it mattered.** The Node-vs-Blink `INTERNAL_ORIGIN` gotcha made it from
  the spec into a code comment; the three explicit `createTab(HOMEPAGE,…)` sites were enumerated (preventing
  the classic "fixed the default param, missed the call sites" miss); the `applyConfig` echo-loop guidance
  (assign `.checked`, never `.click()`) was followed.
- **Trust-domain separation is clean and self-documenting.** `internal-*` channels (origin-locked) vs the
  chrome `shields-*`/`settings-get` channels (`file://` trust domain) — with a load-bearing
  "INTENTIONALLY NOT behind the internal-sender guard" comment so a future contributor doesn't "fix" the
  asymmetry and collapse the boundary.
- **The Flight-5/6 split held.** Flight 6 did not balloon into pin-system territory; the HAT styling
  iterations were bounded (cosmetic; gates stayed 211/211). The recon report (Phase 1b) correctly classified
  the carry-forwards (origin-check / HOMEPAGE / shields-sync = live → this flight; menuController / escaping /
  comment = Flight 7).

## What Could Be Improved

### Process
- **New UI controls had no styling acceptance criteria — the gap surfaced at the HAT.** Legs 3–4 specified
  the *functional* controls (`<input>`, `<button>`, `<fieldset>`, checkboxes) but no *visual* criteria, so
  they shipped as raw browser defaults on the dark theme — operator-flagged as "surprisingly poor," costing
  ~3 unplanned styling iterations at the HAT. **Lesson (actionable):** any leg that adds visible controls to
  a branded/themed UI should carry an explicit styling criterion — e.g. "controls match the design system
  (dark bg / gold accent); checkboxes render as `.switch`-style pill toggles; no raw browser-default chrome"
  — and the Developer's verify step should include a **screenshot check before the HAT**, turning the HAT
  into a confirmation pass rather than a discovery pass.

### Technical
- **`ipcRenderer.on` listeners in the internal preload have no unsubscribe.** `onSettingsChanged`/
  `onShieldsChanged` register permanent listeners. Benign while the settings webview is persistent, but the
  HAT incidentally showed the guest **does reload** (electronmon restarts on served-asset edits) — on reload,
  listeners would accumulate. Address before Flight 7 adds more subscriptions (return an unsubscribe handle,
  or guard re-registration).
- **Witnessed-pattern deviation (carry-forward).** `settings-controls` was Flight-Director-driven (machine-
  read verdicts), not the two-agent Executor+Validator crew — same as Flight 5's `settings-shell`. The
  standing recommendation to run the formal Witnessed `/behavior-test` once remains open.
- **In-session origin-check vector not driven** (web content *inside* the internal session calling the
  bridge) — structurally hard post-Flight-5 (nav lock + immutable `webPreferences`). Asserted structurally +
  unit-tested (the wrapper exercises the extraction path); honestly logged as a gap per DD5. Acceptable for
  the current trust model; the main-side check operates on the Chromium-serialized origin, which the renderer
  cannot forge.

### Documentation
- CLAUDE.md + README updated (leg 5); the internal-bridge security model + settings-store sections are
  accurate, and the Flight-4/5 Known-Issue-closed update landed. No gaps found.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| Leg-5 (docs) per-leg design review waived → flight-level Reviewer | Docs-only; no codebase cross-ref for a design review | Yes — for pure-docs legs |
| HAT styling iterations (controls unstyled post-leg-4) | No styling criteria in the leg specs | Lesson — add styling criteria to UI-control leg specs (above) |
| Per-site "exceptions" copy corrected → "global Shields defaults" + future need recorded | Copy overclaimed a feature that doesn't exist (toggles are global/lock-step) | Yes — settings copy must match actual behavior; future features go to Known Issues, not aspirational UI text |
| `!!`-coercion hardening (raw value → strict predicate) | Reviewer precision finding on the security boundary | Yes — extraction must let the predicate's strict check be the single source of truth |
| Branch from `main` (no stacking) | Flights 4+5 already merged + released | n/a — normal once dependencies are in main |

## Key Learnings
- **A fully-green offline suite (211/211) still coexisted with a real visual-quality gap that only the HAT
  caught.** Offline tests verify logic, not appearance; the renderer/settings-page is `nodeIntegration:false`
  / non-importable, so the behavior test + a11y + the HAT are the only surfaces for UI quality. Styling
  belongs in leg acceptance criteria + a pre-HAT screenshot, not discovered at the HAT.
- **The secured-bridge primitives generalize.** `registerInternalHandler` (one-place security contract) +
  `broadcastToChromeAndInternal` (the two-audience fan-out, structural because `mainWindow.webContents` isn't
  an internal-session content) + the pluggable codec seam are reusable for Flight 7's pin state and the
  future per-site overrides — no anticipatory rework needed.
- **Test-metric trend** (seeds future comparison): flight 3 = 147 → flight 4 = 161 (+14) → flight 5 = 182
  (+21) → **flight 6 = 211 (+29)** pass, ~102 ms wall (vs ~89 ms flight 5 — the delta is settings-store
  temp-dir setup/teardown, not a regression), 0 flakes, lint + typecheck clean. The +29 is the largest jump,
  entirely pure-helper unit tests (`internal-ipc` 15, `settings-store` 14) authored alongside their modules —
  the correct shape.

## Recommendations
1. **Add explicit styling acceptance criteria to any leg that introduces visible UI controls** (reference the
   design-system tokens + a concrete reference element, e.g. `.switch`), and add a **pre-HAT screenshot
   check** to the Developer verify step. This is the single highest-leverage process fix from this flight.
2. **Flight 7 (pin system + "Site settings →" rewire):** pin keys go into `settings-store.js`
   `DEFAULTS`/`VALIDATORS` (boolean, default `true`); reuse `broadcastToChromeAndInternal('settings-changed',…)`
   and `registerInternalHandler`; fold the deferred `buildSiteInfo` defensive `escapeHtml` + the `isInternalTab`
   coupling comment (both on the touched surface); assess the `menuController` module-graduation threshold at
   leg design.
3. **Fix the preload `ipcRenderer.on` listener accumulation** (return an unsubscribe / guard re-registration)
   before Flight 7 wires pin state through the same subscription path — the guest demonstrably reloads.
4. **Run the formal Witnessed `/behavior-test settings-controls` once** to establish the two-agent run log
   (standing carry-forward from the Flight-5 debrief).
5. **Per-site Shields overrides (more-strict-only)** — a future flight; the store + bridge are well-positioned
   (a validator that rejects any per-site key looser than the global + a new `internal-*` channel via
   `registerInternalHandler`). No anticipatory store/bridge prep needed now.

## Action Items
- [ ] **Methodology/leg specs:** require a styling acceptance criterion (+ pre-HAT screenshot) for legs that
  add visible UI controls.
- [ ] **Flight 7:** pin keys in `settings-store` (DEFAULTS/VALIDATORS); reuse the broadcast + bridge
  primitives; retire `buildSiteInfo` escaping + `isInternalTab` comment debt; assess `menuController`
  graduation.
- [ ] **Flight 7 (or sooner):** add unsubscribe handles to the internal preload's `onSettingsChanged`/
  `onShieldsChanged` to prevent listener accumulation across guest reloads.
- [ ] Run the formal Witnessed `/behavior-test settings-controls`.
- [ ] Mission 02: all SC met — candidate for `/mission-debrief` after Flight 7 (or now, if the pin system is
  treated as a separate effort).
