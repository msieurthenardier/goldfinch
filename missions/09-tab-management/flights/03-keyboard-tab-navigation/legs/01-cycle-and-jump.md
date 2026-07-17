# Leg: cycle-and-jump

**Status**: completed
**Flight**: [Keyboard Tab Navigation Parity](../flight.md)

## Objective

Land tab cycling (`Ctrl+Tab`/`Ctrl+Shift+Tab`, `Ctrl+PgDn`/`Ctrl+PgUp`) and
position jumps (`Ctrl+1..8`, `Ctrl+9`=last) across all three capture points,
with the i18n rulings applied, unit pins, live capture-point checks, and the
`tab-cycling` behavior spec authored.

## Context

Flight DD1–DD4 (read them — the i18n rulings, the sheet-test loop landmine,
the single-tab wrap note, and the address-replace semantics are all embedded
there). Key code anchors: `src/shared/keydown-action.js` (classifier — add
`alt` to the descriptor, default false), `src/renderer/renderer.js`
(`dispatchChromeAction` + the chrome keydown listener must pass `alt:
e.altKey`), `src/main/main.js` `handleGuestChromeShortcut` (pass
`input.alt`) and the internal-guest branch (`INTERNAL_CHROME_ACTIONS` gains
the new actions), `src/shared/guest-forward-allowlist.js` (both guest
kinds), `src/shared/sheet-accelerator.js` (union mapper — hand-mirrored
classifier; must gain the same mappings AND the alt handling in lockstep),
plus the sheet's `before-input-event` in main.js passing `input.alt`.

## Acceptance Criteria

- [x] `keydownToAction` maps: Ctrl+Tab→`tab-next`, Ctrl+Shift+Tab→`tab-prev`,
      Ctrl+PageDown→`tab-next`, Ctrl+PageUp→`tab-prev`, Ctrl+1..8→
      `tab-jump-1`..`tab-jump-8`, Ctrl+9→`tab-jump-last`. Digits gated on
      `!alt` (AltGr); digits match regardless of `shift` (AZERTY); none are
      lightbox-deferred; `alt` param defaults false (existing pins
      untouched); Ctrl+Shift+T still classifies null (reservation intact).
- [x] `dispatchChromeAction` implements the actions over `orderedTabIds()` +
      `activateTab`: cycling wraps both ends; out-of-range jump is a no-op;
      `tab-jump-last` activates the last id; single-tab cycle is a harmless
      self-activate.
- [x] Guest capture point: both web and internal guests forward the new
      actions (allowlist entries + `INTERNAL_CHROME_ACTIONS`), with
      `preventDefault` so guests never see the raw key; `input.alt` threaded.
- [x] Sheet capture point: `sheet-accelerator.js` union gains the chrome-class
      entries with identical semantics (incl. alt/shift rules); the existing
      loop test's `'Tab'` entry removed in the same change; a tab switch from
      an open menu closes it via the existing `tab-switch` reason (no new
      plumbing).
- [x] Unit pins: new classifier mappings incl. `Ctrl+Alt+7 → null` and a
      shifted-digit case; allowlist per-kind pins; sheet union pins;
      Ctrl+Shift+T reservation pins unedited and green.
- [x] Live capture-point checks (dev:automation + admin MCP): cycle from
      address-bar focus; cycle with keys delivered INTO a web guest; cycle
      from an internal `goldfinch://settings` tab; jump after a reorder
      follows visual order; sheet-open cycle closes the menu and switches.
      Record outcomes in the flight log. (Ctrl+PageDown/PageUp live delivery
      hit an automation-surface gap — `pressKey` has no `PageDown`/`PageUp`
      key name; substituted `Ctrl+Tab`, same action-string dispatch path;
      see flight log Anomalies.)
- [x] `tests/behavior/tab-cycling.md` authored per flight DD4 (draft,
      `Last Run: never`): steps for chrome-focus cycling (address REPLACED
      by target URL — assert the replace), guest-delivered cycling,
      PgDn/PgUp equivalence, jumps (1/N/last/out-of-range no-op with a
      positive control), wrap, post-reorder visual-order jump (pinned
      prediction), sheet-open cycle, internal-tab cycle, single-tab wrap
      note. House apparatus preconditions (pin-if-free port, fixture
      distinctness, numeric-first reads).
- [x] `npm test`, lint, typecheck green; flight log leg entry.

## Verification Steps

- `node --test test/unit/keydown-action.test.js test/unit/guest-forward-allowlist.test.js test/unit/sheet-accelerator.test.js`
- Live checks per AC; suites; spec read-through.

## Implementation Guidance

1. Classifier first (+ pins), then dispatch, then guest path (check the
   cross-view-nav branch ORDER holds as verified — unmodified-Tab handoff
   first, modified falls through), then sheet mapper (lockstep alt), then
   live checks, then the spec.
2. The dispatch switch: compute `ids = orderedTabIds()`, `cur =
   ids.indexOf(activeTabId)`; next/prev = `(cur±1+len)%len`; jumps direct.
   Keep it inside `dispatchChromeAction`'s existing switch — ~30 lines.
3. For `preventDefault` on the guest path: the existing forward branch
   already prevents; confirm PageDown doesn't scroll the guest when
   forwarded (live check).
4. Spec: follow tab-reorder.md's house style; note the single-tab wrap and
   address-replace semantics explicitly.

## Edge Cases

- **Zero web tabs** cannot occur (never-zero invariant).
- **Ctrl+Tab held (auto-repeat)**: `before-input-event` has isAutoRepeat
  guards for some branches — decide: allow repeat cycling (Chrome allows) —
  do NOT add an isAutoRepeat guard for these actions; note in flight log.
- **Lightbox open**: cycling still works (not deferred) — matches
  new-tab/close-tab precedent.
- **During a drag**: keyboard cycle mid-pointer-drag — cancelDrag() on
  activation change is NOT wired; the drag is per-pointer and tab-list
  mutation cancels it; an activation change mid-drag only changes which tab
  is active (the drag continues on its captured tab — Chrome behaves the
  same). Leave as-is; note if the live check shows weirdness.

## Files Affected

- `src/shared/keydown-action.js`, `src/shared/guest-forward-allowlist.js`,
  `src/shared/sheet-accelerator.js`
- `src/renderer/renderer.js`, `src/main/main.js`
- `test/unit/keydown-action.test.js`, `test/unit/guest-forward-allowlist.test.js`,
  `test/unit/sheet-accelerator.test.js`
- `tests/behavior/tab-cycling.md` (new)
- flight-log.md

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed`
- [ ] Do NOT commit — the flight commits once after review
