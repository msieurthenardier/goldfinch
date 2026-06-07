# Leg: hat-and-alignment

**Status**: completed
**Flight**: [Kebab Menu](../flight.md)

## Objective

Guided human acceptance test: the operator exercises the live kebab menu and tunes its feel until satisfied; fix any issues inline and re-verify.

## Context

- Optional interactive leg (HAT) — not autonomously executed; the Flight Director guides the operator against the running app (`npm run dev:debug`, `:9222`).
- Run after the autonomous build + the `verify-integration` automated gates (behavior test, a11y, regressions) passed.

## Acceptance Criteria
- [x] Operator confirms the kebab placement (toolbar row, right of Shield), the ⋮ glyph, and the menu feel are acceptable.
- [x] Any operator-requested tweaks are implemented and re-verified.
- [x] Offline gates (`typecheck`/`lint`/`test`) remain green after tweaks.

## HAT Session Outcome

Operator reviewed the live kebab menu (placement, glyph, keyboard flow) → **feel approved, no layout/glyph changes requested.**

Operator requested fixing the two non-blocking behaviors the flight Reviewer flagged:

1. **Menu mutual exclusion** — opening the kebab now closes an open container (▾) menu, and opening the container menu closes an open kebab menu. (`openKebabMenu` calls `closeContainerMenu()` first; `openContainerMenu` calls `closeKebabMenu()` first — both close fns are idempotent.)
2. **Tab closes the kebab menu** — `Tab`/`Shift+Tab` inside the open kebab menu now `preventDefault()`s, closes the menu, and restores focus to the kebab trigger.

(These deliberately diverge from the container menu's looser behavior — the kebab is the fuller APG implementation, per DD5.)

### Re-verification (live, trusted CDP after reload)
- Mutual exclusion both directions ✓ (open container→open kebab: container closed, kebab open; reverse: kebab closed, container open).
- Tab closes kebab menu + focus restored to trigger ✓ (`kebabOpen=false`, `aria-expanded=false`, `activeElement=#kebab`).
- Regression: kebab still opens, `ArrowDown` navigates (→ `#kebab-exit`), `Escape` closes + restores focus ✓.
- Offline gates after the fix: `npm run typecheck` 0, `npm run lint` 0, `npm test` 147/147.

### Manual Exit check (SC4) — performed at the end of this session (destructive)
- Trusted click on the kebab **Exit** item → app terminated gracefully: `npm run dev:debug` exited code 0, no electron/goldfinch processes remained, `:9222` stopped responding (curl `http_code=000`). **SC4 verified** (Windows/Linux; macOS deferred to a mac HAT per the flight/mission).

## Files Affected
- `src/renderer/renderer.js` — `openKebabMenu`/`openContainerMenu` mutual-exclusion calls; `Tab` branch in the kebab-menu keydown handler.

---

## Post-Completion Checklist
- [x] Operator satisfied with kebab feel
- [x] HAT-requested fixes implemented + re-verified
- [x] Manual Exit-quits (SC4) confirmed
- [x] Flight log updated
- [x] Status set to `completed`
