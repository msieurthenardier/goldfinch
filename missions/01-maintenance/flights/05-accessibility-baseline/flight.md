# Flight: Accessibility — Keyboard & Screen-Reader Baseline

**Status**: ready
**Mission**: [Codebase Health — 2026-06-05 Maintenance](../../mission.md)

## Contributing to Criteria
- [ ] F22 — tabs keyboard-operable with correct ARIA roles/state
- [ ] F23 — icon-only chrome controls have accessible names and a visible focus indicator
- [ ] F24 — remaining WCAG AA gaps addressed

---

## Pre-Flight

### Objective
Make the browser chrome operable by keyboard and screen-reader users, starting with the completely-inoperable tab strip, then accessible names and focus visibility, then the remaining WCAG 2.1 AA gaps.

### Open Questions
N/A.

### Design Decisions
N/A — deferred to leg design.

### Prerequisites
- [ ] N/A (independent of the other flights; sequenced last per project stage)

### Pre-Flight Checklist
- [ ] N/A — maintenance flight, Pre-Flight skipped

---

## In-Flight

### Technical Approach

One finding maps to one leg. F22 and F23 first (make the chrome operable at all); F24 as a follow-on pass.

- **F22 — tab strip operability (Action Required).** Tabs are `<div class="tab">` with only a click listener — no `tabindex`, `role`, `aria-selected`, or keyboard handler; the close affordance is a `<span>` (`src/renderer/renderer.js:122-132`). Keyboard/SR users cannot switch, identify, or close tabs. **Fix:** give the strip `role="tablist"`, make tabs focusable `role="tab"` elements with `aria-selected` and arrow-key navigation, and make close a focusable `<button>` with an accessible name ("Close tab: {title}"). Author a behavior-test spec for keyboard tab switching/closing.
- **F23 — accessible names + focus visibility (Action Required).** Icon-only buttons (back/forward/reload/new-tab/menu, media-card actions, player transport) expose names only via `title`; the reload button's `title` stays "Reload" while it acts as Stop (`src/renderer/renderer.js:182-183,264`); the Shields switches have `role="switch"`+`aria-checked` but **no accessible name** (`:867-874`); and no control has a visible `:focus`/`:focus-visible` style (the address bar sets `outline:none`, `src/renderer/styles.css:101`). **Fix:** add `aria-label` to every icon-only button, keep the reload name in sync with Stop/Reload state, label each Shields switch via `aria-label`/`aria-labelledby`, and add a visible `:focus-visible` indicator (≥3:1 contrast) across interactive chrome.
- **F24 — remaining WCAG AA pass (Advisory).** Batch the rest: `prefers-reduced-motion` for panel/player/switch/toast animations; `role="status"`/`aria-live` on `#toasts` and the media-list/empty region; focus management + Escape for panels, the jar menu, and `role="dialog"` on the lightbox; `aria-label` on the address bar plus toolbar/panel landmarks and real headings; non-color cues for Shields on/off, alert, and active-tab state; raised contrast for `--fg-dim` small text and the off-state switch track; and a naming `aria-label` on each media-card pick checkbox.

### Checkpoints
- [ ] Tabs keyboard/AT operable + behavior-test spec (F22)
- [ ] Accessible names and visible focus across chrome (F23)
- [ ] Remaining WCAG AA gaps closed (F24)

### Adaptation Criteria

**Divert if**:
- Retrofitting `role="tab"` semantics onto the webview-backed tab model causes focus-management conflicts that need a design rethink.

**Acceptable variations**:
- Splitting F24 into multiple smaller legs if the batch is too large for one session.

### Legs

> Tentative.

- [ ] `tab-strip-a11y` - F22 (+ behavior-test spec)
- [ ] `control-names-and-focus` - F23
- [ ] `wcag-aa-followups` - F24

---

## Post-Flight

### Completion Checklist
- [ ] All legs completed
- [ ] Code merged
- [ ] Behavior-test spec for keyboard tab operability passes

### Verification
A keyboard-only user can focus the tab strip, switch and close tabs, and reach every chrome control with a visible focus indicator; a screen reader announces meaningful names for icon buttons and Shields switches and announces dynamic updates; reduced-motion is respected; contrast and color-independence meet WCAG 2.1 AA.
