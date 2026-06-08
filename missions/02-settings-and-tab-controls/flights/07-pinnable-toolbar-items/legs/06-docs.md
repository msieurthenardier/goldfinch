# Leg: docs

**Status**: landed
**Flight**: [Pinnable Toolbar Items (Media + Shields)](../flight.md)

## Objective
Document Flight 7 in `README.md` + `CLAUDE.md`: the pinnable toolbar (Media/Shields icons), the `toolbarPins`
store key, the pin-icon Appearance controls + right-click Unpin, and the "Site settings →" destination change.

## Context
Flight 7 (legs 1–5) added, on top of Flight 6's settings store + bridge:
- **`toolbarPins`** (leg 1) — a `{ media, shields }` boolean map in `settings-store.js` (validator +
  normalize-at-load; both default `true`).
- **Icon toolbar** (leg 2) — Media/Shields are now **icon + count-badge** buttons; the chrome shows/hides each
  per its pin (`applyToolbarPins`, read at startup + on `settings-changed`); keyboard shortcuts (Ctrl+M /
  Ctrl+Shift+P) work regardless of pin.
- **Right-click Unpin** (leg 3) — `contextmenu` on a pinned icon → native Electron "Unpin {item}" menu →
  main writes `toolbarPins[item]=false` + broadcasts.
- **Appearance pin controls** (leg 4) — pin-icon toggle buttons (`aria-pressed`) in the settings Appearance
  section via the bridge; + internal-preload `off…` listener cleanup.
- **"Site settings →"** (leg 5) — now opens `goldfinch://settings#privacy` (reuse/open a settings tab) instead
  of the slide-out panel.

## Acceptance Criteria
- [ ] `README.md` (user/contributor): the toolbar Media/Shields controls are now **icons** that can be
  **pinned/unpinned** — pinned shows in the toolbar (icon + count), unpinned is managed from Settings →
  Appearance (the keyboard shortcut still works); **right-click a pinned icon → Unpin**; "Site settings →"
  (web site-info popup) opens the Settings page's Privacy & Shields section.
- [ ] `CLAUDE.md` (architecture/patterns): the `toolbarPins` store key (boolean map, normalize-at-load,
  forward-compat); `applyToolbarPins` + the `settings-changed` broadcast as the pin-state propagation; the
  native right-click context menu (main-owned write); the Appearance pin-icon toggles; the internal-preload
  `on…`-returns-handle + `off…` listener-cleanup pattern; the "Site settings →" destination change.
- [ ] References use **symbols**, not line numbers. No operator identity / absolute home paths.
- [ ] `npm run lint` stays green. Docs only — no source/behavior changes.

## Verification Steps
- `git diff` shows only `README.md` / `CLAUDE.md`.
- Read both: accurate vs landed code; symbols resolve (`toolbarPins`, `applyToolbarPins`,
  `toolbar-context-menu`, `offSettingsChanged`).
- `npm run lint` green.

## Implementation Guidance
1. **README** — in Features / the settings + toolbar area, add the pinnable icons + Settings→Appearance pin
   management + right-click Unpin + the "Site settings →" destination. User-facing, brief.
2. **CLAUDE.md** — extend the settings-store + internal-page patterns with `toolbarPins` (boolean map,
   normalize-at-load), the toolbar pin-apply + broadcast flow, the native context-menu write path, and the
   preload `off…` cleanup idiom. Symbols, no line numbers.

## Edge Cases
- **Don't overstate**: unpinned = toolbar-only removal (shortcut still works; re-pin from Appearance), not a
  full feature disable.
- Keep README user-altitude; implementation symbols belong in CLAUDE.md.

## Files Affected
- `README.md` — pinnable toolbar + right-click Unpin + "Site settings →" destination (user-facing).
- `CLAUDE.md` — `toolbarPins`, pin-apply/broadcast, native context-menu write, preload `off…` cleanup.

---

## Post-Completion Checklist
- [ ] All acceptance criteria verified
- [ ] `npm run lint` green
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `landed` (commit deferred)
- [ ] Check off this leg in flight.md
- [ ] Do NOT commit; do NOT signal `[HANDOFF:review-needed]`
