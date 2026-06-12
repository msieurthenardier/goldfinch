# Flight Debrief: Pinnable Toolbar Items (Media + Shields)

**Date**: 2026-06-11
**Flight**: [Pinnable Toolbar Items (Media + Shields)](flight.md)
**Status**: landed
**Duration**: 2026-06-07 – 2026-06-08
**Legs Completed**: 8 of 8 (6 autonomous + verify-integration + HAT)

## Outcome Assessment

### Objectives Achieved

The generic pin/unpin system shipped end to end (PR #34, released v0.4.9):

- **`toolbarPins` in the settings store** — boolean map with an explicit validator (rejecting the
  `typeof null === 'object'` trap), a `NORMALIZERS` deep-merge for forward-compat (a future third
  pinnable item defaults to pinned for old configs, with zero consumer changes), `freshDefaults()`
  killing the shared-reference hazard, and a `getAll()` deep-copy. 10 new unit tests.
- **Icon + count-badge toolbar** — Media/Shields converted from text to icon buttons (Lucide inline
  SVG after the HAT swap); badge carries the count (WCAG 1.4.1 non-color cue preserved); dynamic
  `aria-label`s; `applyToolbarPins` show/hide at startup + live on the `settings-changed`
  broadcast; keyboard shortcuts survive unpin; focus-restoration guards for hidden buttons.
- **Right-click → "Unpin"** — native menu, main-owned write (no new renderer write channel).
- **Appearance pin-icon toggles** — `aria-pressed` toggle buttons over the secured bridge, two-way
  synced; internal-preload listener-handle (`on…` → numeric handle / `off…`) cleanup pattern, with
  `pagehide` cleanup retrofitted to all three settings-page controllers.
- **"Site settings →" rewired** to `goldfinch://settings/#privacy` (reuse-or-create) — the settings
  page is now the canonical destination; the slide-out panel is optional.
- **Flight-6 deferred debt retired on the touched surfaces**: `buildSiteInfo` defensive escaping,
  the `isInternalTab` cross-reference comment, the preload unsubscribe fix. `menuController`
  graduation assessed → correctly not triggered (no 4th consumer).

### Mission Criteria Advanced

- *Flight-local* (no mission SC) — **SC8 preserved**: chrome + guest a11y clean against the pinned
  baseline; all new controls keyboard-operable.

## What Went Well

- **The live behavior test caught a real cross-process bug that no offline gate could.** The
  Appearance pin toggle worked once then silently no-op'd: `settingsSet` resolves with the **full
  config**, the controller applied the resolution, `current.media` became `undefined`, the next
  write failed validation, and `.catch` swallowed it. Found at leg 7, root-caused, fixed (apply the
  locally-computed `next`), re-verified across three consecutive toggles. This is precisely the
  bug class the behavior-test apparatus exists for — the strongest single data point yet for live
  verification of cross-process settings flows.
- **The Flight-6 lessons were systematically applied.** The reconnaissance table walked every
  Flight-6 debrief carry-forward against current `main` with per-item classification; the styling
  lesson (explicit styling acceptance criteria + a pre-HAT screenshot at the Developer verify step)
  was baked into the leg specs — CSS/layout needed no HAT rework, only the glyph swap.
- **The store pattern is an architecture win.** VALIDATOR + NORMALIZER + `freshDefaults()` is now
  the documented convention for any future structured settings key; the normalize-at-load home
  means no consumer ever spreads defaults.
- **Main-owned write for the context menu** — the narrowest-surface principle held: the renderer
  fires a one-way `send`; main validates, writes, broadcasts; both surfaces update through the one
  `settings-changed` broadcast.
- **DD5's debt-folding model worked**: each deferred item rode the leg that touched its surface,
  rather than accreting into a separate cleanup flight.

## What Could Be Improved

### Process

- **Leg 4's spec nearly specified the bug.** It wrote `settingsSet('toolbarPins', next).then(apply)`
  without constraining what `apply` receives — and the resolution-is-the-full-config contract was
  knowable (it's the store's `set()` return, in place since leg 1). The home-page controller avoids
  the same bug only by ignoring the resolution. Spec lesson: when an IPC's resolved value differs
  from the written value, the leg spec must say "apply the locally-computed state, never the
  resolution" explicitly.
- **Icon design deferred entirely to the HAT.** The placeholder Unicode glyphs (▤/◈) were always
  going to be judged at the HAT, and the operator rejected them — a full icon swap landed as the
  final commit. Flights adding icon-level UI should review icon options at leg design, not first at
  the HAT.
- **Flight-log hygiene at landing**: the log's Summary line still reads `in-flight`, and legs 7–8
  have no Leg Progress entries (their detail lives in the leg files + flight.md checkboxes). Minor,
  but the log is the ground-truth artifact; the landing step should sweep it.
- **Witnessed-pattern deviation (standing, third occurrence)**: `toolbar-pins` was FD-driven
  (act + observe by one agent) rather than the two-agent Executor + Validator pattern, with the
  same compensating control as Flights 5–6 (every verdict cites a raw machine-read value). The
  formal `/behavior-test` runs remain an open carry-forward.

### Technical

- **DD2's no-SVG clause was an avoidable mis-prediction.** Inline SVG *markup* is not a loaded
  resource and is CSP-safe under `default-src 'self'` — reasoning DD3 applied correctly to the
  guest at the same planning session, while DD2 concluded the opposite for the chrome. The cost: a
  known-placeholder shipped through seven legs and was swapped at the HAT. Rule to standardize:
  inline-SVG-is-markup-not-a-resource, uniformly across chrome and guest.
- **The `settingsSet` resolution contract is a standing trap.** The bridge's `settingsSet` resolves
  with the full config; nothing in its JSDoc or the d.ts says so. Either document it at the bridge
  (preferred short-term) or change the contract to resolve with the keyed value / `void`
  (maintenance candidate).
- **`get()` vs `getAll()` deep-copy asymmetry**: `settings.get('toolbarPins')` returns the live
  nested object reference (the context-menu handler spreads it safely, but a mutating consumer
  would corrupt store state); `getAll()` deep-copies. Document the no-mutation contract on `get()`
  or deep-copy nested values there too.
- **Preload listener hygiene is now inconsistent**: the internal preload has the careful
  handle/`off…` pattern; `chrome-preload.js`'s `onSettingsChanged` / download / window-state
  listeners remain bare accumulating `ipcRenderer.on` registrations. Benign (the chrome process
  never reloads) but the asymmetry will confuse the next reader — a hygiene-pass candidate.
- **The pins controller has no offline coverage and structurally can't** (the guest is
  non-importable). The live behavior test is its only regression gate — which raises the value of
  running it formally (Witnessed) rather than ad hoc.

### Documentation

- **Elevate the "apply locally-computed state, never the IPC resolution" rule** from a
  `settings.js` code comment to a named antipattern in CLAUDE.md's Patterns section, and state the
  resolution shape in the `settingsSet` JSDoc/d.ts.
- **Note the native-menu testability constraint** where the right-click Unpin is documented: the
  native `Menu.popup()` is not in the renderer DOM, is not CDP-drivable, and is HAT-verified only —
  and that this changes when the custom context-menu component replaces it.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| DD2 override at HAT: toolbar icons are inline Lucide SVG, not Unicode/CSS glyphs | Operator rejected placeholder glyphs; inline SVG confirmed CSP-safe live under both CSPs | Yes — inline SVG markup is CSP-safe under `default-src 'self'`; apply uniformly (chrome + guest) at planning |
| `toolbar-pins` behavior test FD-driven, not two-agent Witnessed | Same accepted deviation as Flights 5–6; every verdict cites a raw machine-read value | No — formal Witnessed runs remain the target; carry-forward stands |
| Docs leg design-review skipped (folded into flight-level Reviewer pass) | Docs-only; no codebase cross-reference for a review to add | Yes — established proportionality call (Flights 5–7) |

## Key Learnings

1. **Apply locally-computed state, never the IPC resolution.** When a controller writes a sub-key
   and re-renders, the rendered value must be the locally-computed `next` — the IPC's resolved
   value is a different shape (the full config) and validators downstream will reject its echo.
2. **Live cross-process verification is load-bearing, not ceremonial.** The two-way-sync bug was
   invisible to 221 green unit tests, lint, and typecheck; only driving the real guest→main→chrome
   round-trip exposed it.
3. **Native OS menus read as foreign in a custom-dark-chrome app** — "OS-styled" in a planning
   trade-off understates the visual friction; expect an operator flag at HAT. The need is now a
   mission Known Issue (system-wide custom context-menu component), and that component is the
   likely `menuController` graduation event (its 4th consumer) — one flight away, not indefinitely
   deferred.
4. **Forward-compat belongs in the store, not in consumers** — normalize-at-load/set means a third
   pinnable item is a one-line `DEFAULTS` change.

## Recommendations

1. **[Important] CLAUDE.md + bridge JSDoc: name the `settingsSet` resolution antipattern** before
   the next settings-page controller is written (the next one with `.then(apply)` recreates the
   bug, and there is no offline net under it).
2. **[Important] Plan the custom context-menu component with `menuController` graduation as a
   prerequisite leg**, not an incidental — it's the 4th consumer that crosses the long-deferred
   threshold, and it migrates the right-click Unpin path onto a CDP-drivable, behavior-testable
   surface (retiring a HAT-only verification).
3. **[Important] Run the formal Witnessed `/behavior-test` passes** (`toolbar-pins`, plus the
   standing `settings-controls` carry-forward) against a running instance — the pins controller
   has no other regression gate.
4. **[Minor] Maintenance candidates**: chrome-preload listener-hygiene pass (match the internal
   preload's handle pattern); resolve the `get()`/`getAll()` deep-copy asymmetry; consider changing
   `internal-settings-set` to resolve with the keyed value or `void`.
5. **[Minor] Leg-spec convention**: icon-level UI gets design-time icon review; settings-controller
   specs state the apply-local-state rule explicitly.

## Action Items

- [ ] CLAUDE.md Patterns: add the named `settingsSet`-resolution antipattern; update the
  `settingsSet` JSDoc/d.ts to state the resolution shape (next docs-touching leg)
- [ ] Future flight (mission Known Issue): system-wide custom context-menu component, scoped to
  include `menuController` graduation + unit tests + migration of the toolbar Unpin; update the
  behavior spec to cover the migrated path
- [ ] Formal Witnessed runs: `/behavior-test toolbar-pins` and `/behavior-test settings-controls`
  next time a live instance is up (standing carry-forward from Flights 5–7)
- [ ] Maintenance list: chrome-preload listener hygiene; `get()` nested-value copy/contract;
  `internal-settings-set` resolution-shape reevaluation
- [ ] Flight-log landing sweep: update the Summary line + add leg 7/8 Leg Progress stubs (or fold
  this into the landing checklist so logs close out consistently)

---

## Test Metrics

Captured 2026-06-11 on `main` (v0.4.9, this flight included). Single run shared with the Flight-4
debrief (same codebase state):

- **`npm test`: 221/221 pass, 0 fail, 0 skipped, no flakes, ~92 ms wall-clock.**
- `npm run typecheck`: 0 errors. `npm run lint`: 0 problems.
- **Delta vs Flight 6's debrief: +10** (211 → 221), entirely the new `settings-store.js`
  `toolbarPins` tests — structurally correct, since the store is this flight's only pure-helper
  change (toolbar/preload/guest surfaces are non-importable offline by design).
- Trend across debriefs: 96 → 147 → 147 → 161 → 182 → 211 → **221**; wall-clock has held in the
  ~68–102 ms band throughout (this run ~92 ms, vs ~102 ms at Flight 6 — noise, not a signal; the
  settings-store temp-dir I/O dominates). No failures, no skips, no flakes at any point in the
  series.
