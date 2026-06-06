# Leg: unified-pill-control

**Status**: completed
**Flight**: [Tab-Bar Control Restructure](../flight.md)

## Objective
Unify the `+` (`#new-tab`) and `▾` (`#new-tab-menu`) buttons into a single golden, pill-shaped
control that **leads** the tab strip (left of the open tabs), with an internal divider and a
contrast-safe keyboard focus ring, and re-anchor the container menu to the now-leading trigger —
preserving every existing ID, click handler, and ARIA attribute (SC1, SC8).

## Context
- Flight **DD1**: the pill is **two real `<button>`s in a styled wrapper**, not a composite
  control. Keep `#new-tab` and `#new-tab-menu` as distinct buttons with their existing IDs, click
  handlers (`renderer.js:387-392`), `aria-label`s, and the `▾` menu-button semantics
  (`aria-haspopup="menu"` / `aria-expanded`). The change is almost entirely declarative (HTML
  reorder + CSS) so the audited a11y surface and the `els.newTab`/`els.newTabMenu`/
  `els.containerMenu` wiring stay intact — no re-implementation of the container-menu logic.
- **DD1 focus-order note**: today `#new-tab`/`#new-tab-menu` follow `#tabs` (`index.html:15-26`).
  Moving them *ahead* of `#tabs` means `Tab` traversal reaches the pill buttons **before** the
  roving-tabindex tab. `tab-keyboard-operability` Step 3 ("Tab until a tab is focused") tolerates
  the extra stops, so no regression is expected — this leg states the new DOM/focus order
  explicitly (pill `+` → pill `▾` → first tab in `#tabs`) so the verify-leg regression run isn't
  surprised, and so the pill sits sensibly relative to leg 4's reserved window-control zone.
  - **Intended end-state Tab order** (confirmed at design): pill `+` → pill `▾` → tabs (roving) →
    toolbar → (leg 4/5) window controls in the reserved right zone. Making `+` the first app-wide
    Tab stop is intentional; leg 4/5 append the window controls after the toolbar, so leg 1 does
    not pre-empt that decision. The DD2 focus-ring confirmation is **fully deferred** to
    `verify-integration`'s focused-vs-unfocused screenshot delta — no interim screenshot is taken
    in this autonomous leg.
- Flight **DD2**: the global keyboard focus ring is `outline: 2px solid var(--accent)` (gold —
  `styles.css:103-127`), and `#new-tab`/`#new-tab-menu` are `.icon-btn`s that pick up the gold
  ring via `styles.css:110-119`. A gold ring on a **gold pill** is effectively invisible. Override
  the pill buttons' `:focus-visible` with a ring that meets ≥3:1 against the gold fill — the dark
  `--accent-fg` (`#1e1f25`) on gold (`#f5c518`) clears 3:1 comfortably. Mirror the existing
  `#address:focus-visible` specificity-exception comment pattern (`styles.css:121-127`) — the
  codebase already documents one id-specificity carve-out and maintainers expect the same.
  - **DD2 premise status (verify-at-HAT, not known-true)**: the global rule uses
    `outline-offset: 2px` (`styles.css:119`), so the ring sits 2px *outside* the button — whether
    that lands on the gold pill or the dark `#tabstrip` depends on final pill padding. Adding the
    contrast-safe override is the safe choice; `unified-tab-controls` Step 5 (focused-vs-unfocused
    screenshot delta) confirms it empirically and the optional HAT leg tunes the feel.
- Flight **DD3**: `#container-menu` is positioned at `top:36px; right:8px` (`styles.css:834-845`)
  for a *trailing* `▾`. With `▾` moved to the leading pill, swap `right:8px` → a `left` near the
  pill (~`left:6px`, matching `#tabstrip`'s left padding at `styles.css:44`) so the popup belongs
  to its trigger instead of floating to the far right. Open/close/Escape/focus behavior is
  otherwise untouched.
- This is leg 1 of the flight; no prior legs. The `unified-tab-controls` behavior-test spec was
  authored during planning (`tests/behavior/unified-tab-controls.md`, `draft`); its live run is
  deferred to the `verify-integration` leg, not this leg.
- **Tooling/type note**: the renderer is whole-codebase `@ts-check`'d, `sourceType:"script"`. This
  leg adds no new `els.*` DOM lookups (the pill reuses the existing `#new-tab`/`#new-tab-menu`
  references), so no new JSDoc casts are required. Leg ACs still include the offline gates
  (`npm test` + `npm run typecheck` + `npm run lint` + `npm run format`).

## Inputs
What must be true before this leg runs:
- `src/renderer/index.html` — `#tabstrip` (`:14`) contains `#tabs` (`:15`, the `role="tablist"`),
  then `#new-tab` (`:16`), then `#new-tab-menu` (`:17-26`); `#container-menu` (`:28`) is a sibling
  after `#tabstrip`.
- `src/renderer/styles.css` — `#tabstrip` flex row (`:40-46`); `#tabs` (`:47-53`); `.icon-btn`
  base (`:138-147`) + `:hover` (`:148-150`); global `.icon-btn:focus-visible` (`:110-119`);
  `#address:focus-visible` specificity-comment pattern (`:121-127`); `#new-tab-menu` (`:830-833`);
  `#container-menu` (`:834-845`).
- `src/renderer/renderer.js` — `els.newTab`/`els.newTabMenu`/`els.containerMenu` (`:9-11`);
  `openContainerMenu` (`:89-120`); `closeContainerMenu` (`:121-124`); click handlers (`:387-392`).
- Offline gates currently green (`npm test`, `npm run typecheck`, `npm run lint`).

## Outputs
What exists after this leg completes:
- A new pill wrapper element leads `#tabstrip`, before `#tabs`, containing `#new-tab` and
  `#new-tab-menu` with an internal divider; golden fill (`--accent`) + dark glyphs
  (`--accent-fg`).
- Pill buttons carry a `:focus-visible` ring that contrasts against gold (≥3:1).
- `#container-menu` anchors to the left (under the leading pill), not the right.
- All existing IDs, click handlers, and ARIA attributes preserved; container menu open/close/
  Escape/focus behavior unchanged.
- All offline gates green; no new WCAG A/AA violations introduced (full check at verify leg).

## Acceptance Criteria
- [x] In `index.html`, `#new-tab` and `#new-tab-menu` are wrapped in a new pill container element
  (e.g. `<div id="newtab-pill">`), and that pill is the **first** child of `#tabstrip`, **before**
  `#tabs`. Both buttons keep their existing `id`, `class`, `title`, and `aria-label`; `#new-tab-menu`
  keeps `aria-haspopup="menu"` and `aria-expanded`.
- [x] The pill renders with the brand-gold background (`var(--accent)`) and dark glyphs
  (`var(--accent-fg)`), pill-shaped (rounded), with a visible **internal divider** between `+`
  and `▾`.
- [x] The pill buttons have a `:focus-visible` outline that is **not** `var(--accent)` and meets
  ≥3:1 contrast against the gold fill (e.g. `var(--accent-fg)`), added with an explanatory comment
  mirroring the `#address:focus-visible` pattern (`styles.css:121-127`).
- [x] `#container-menu` is anchored to the **left** (≈`left:6px`) rather than `right:8px`, so it
  opens at the leading pill's left edge (its `min-width:210px` covers the pill, including the `▾`).
- [x] DOM/focus order is `#new-tab` → `#new-tab-menu` → first `.tab` in `#tabs` (pill precedes the
  tablist).
- [x] Behavior is preserved **structurally** (no JS logic change required) — `+` opens a plain new
  tab; `▾` toggles the container menu; menu items open container/burner tabs; Escape closes the
  menu and returns focus to `#new-tab-menu`; outside-click closes the menu. *In-leg this is proven
  by an empty `renderer.js` control-flow diff + green offline gates; the live behaviors (SC2/SC8)
  are witnessed at `verify-integration`, not in this leg.*
- [x] `npm test`, `npm run typecheck` (0 errors), `npm run lint` (0 problems), `npm run format`
  (no diff) all clean. *(Renderer files clean; pre-existing `.github/dependabot.yml` prettier
  warning is out-of-scope — see flight-log anomaly.)*

## Verification Steps
- `grep -n 'newtab-pill' src/renderer/index.html` → pill wrapper present; confirm by inspection it
  is the first child of `#tabstrip` and wraps both `#new-tab` and `#new-tab-menu`, before `#tabs`.
- `grep -n '#newtab-pill' src/renderer/styles.css` → gold fill + divider styling present.
- `grep -n 'newtab-pill.*focus-visible\|#new-tab.*focus-visible' src/renderer/styles.css` → a
  pill-scoped `:focus-visible` override exists and does **not** use `var(--accent)` as the outline
  color.
- `grep -n -A12 '#container-menu' src/renderer/styles.css` → `left` set, `right` removed in the
  `#container-menu` block (scoped to avoid the file-wide `left:` noise).
- `git diff src/renderer/renderer.js` → **empty** (no handler logic changed; the pill is
  declarative).
- `npm run typecheck` → `0 errors`; `npm run lint` → exit 0; `npm test` → all pass;
  `npx prettier --check .` → no formatting issues (non-mutating gate; equivalently `npm run format`
  then a clean `git status`).
- Deferred to `verify-integration`: `/behavior-test unified-tab-controls` (live mouse+keyboard run
  + focus-ring-on-gold screenshot delta) and the `tab-keyboard-operability` regression.

## Implementation Guidance

1. **`index.html` — wrap and move the buttons (`:14-27`).** Restructure `#tabstrip` so the pill
   leads:
   ```html
   <div id="tabstrip">
     <div id="newtab-pill">
       <button id="new-tab" class="icon-btn" title="New tab (Ctrl+T)" aria-label="New tab">+</button>
       <button
         id="new-tab-menu"
         class="icon-btn"
         title="New tab in a jar / container"
         aria-label="New tab in a container"
         aria-haspopup="menu"
         aria-expanded="false"
       >
         ▾
       </button>
     </div>
     <div id="tabs" role="tablist" aria-label="Open tabs"></div>
   </div>
   ```
   Keep `#container-menu` (`:28`) where it is (sibling after `#tabstrip`). Do **not** change any
   attribute on the two buttons beyond their new parent/position.

2. **`styles.css` — pill container.** Add a `#newtab-pill` rule near the tab-strip styles
   (after `#tabs`, ~`:53`): a gold pill that groups the two buttons.
   ```css
   #newtab-pill {
     display: flex;
     align-items: center;
     flex: none;
     align-self: center;
     background: var(--accent);
     border-radius: 999px;
     overflow: hidden;
   }
   /* Pill buttons sit on the gold fill: dark glyphs, transparent bg so the pill shows. */
   #newtab-pill .icon-btn {
     color: var(--accent-fg);
     border-radius: 0;
     height: 26px;
   }
   #newtab-pill .icon-btn:hover {
     background: rgba(0, 0, 0, 0.12); /* darken on gold — the global white-overlay hover is faint here */
   }
   /* Internal divider between + and ▾ (DD1: visual grouping, two focus stops). */
   #newtab-pill #new-tab-menu {
     border-left: 1px solid var(--accent-fg);
   }
   ```
   Tune exact dimensions/padding at HAT; the floor requirement is "pill-shaped, gold, dark glyphs,
   visible divider." Keep `#new-tab-menu`'s existing `font-size`/`width` (`:830-833`) or fold the
   width into the pill rule — either is fine as long as the `▾` stays legible.

3. **`styles.css` — contrast-safe focus ring (DD2).** Add, with an explanatory comment mirroring
   the `#address:focus-visible` carve-out (`:121-127`):
   ```css
   /* The global .icon-btn:focus-visible ring is var(--accent) (gold). On the gold pill that ring
      is gold-on-gold and effectively invisible, so the pill buttons override it with the dark
      accent-fg, which clears WCAG 1.4.11 3:1 non-text contrast against the gold fill. (Same
      id/scoped-specificity carve-out idea as #address:focus-visible above.) */
   #newtab-pill .icon-btn:focus-visible {
     outline: 2px solid var(--accent-fg);
     outline-offset: -2px;
   }
   ```
   `outline-offset: -2px` keeps the ring inside the button so it lands on the gold fill regardless
   of pill padding (sidesteps the DD2 "ring may sit on the dark tabstrip" uncertainty); the verify
   leg's screenshot delta confirms.

4. **`styles.css` — re-anchor the container menu (DD3, `:834-845`).** In the `#container-menu`
   rule, replace `right: 8px;` with `left: 6px;` (matching `#tabstrip` left padding at `:44`).
   Leave `top: 36px` and everything else as-is.

5. **`renderer.js` — no logic change.** Do not touch `openContainerMenu`/`closeContainerMenu` or
   the click handlers. The reorder is purely structural; the existing `els.newTab`/`els.newTabMenu`/
   `els.containerMenu` references resolve to the same elements in their new location.

## Edge Cases
- **Focus ring offset landing on dark tabstrip (DD2 premise)**: using `outline-offset: -2px` on
  the pill override forces the ring inside the gold button, so it is visible regardless of padding.
  If the HAT prefers an outside ring, switch to a layered dark/light ring — but the inside ring is
  the safe default the behavior test will pass.
- **Hover legibility on gold**: the global `.icon-btn:hover` uses a white overlay
  (`rgba(255,255,255,0.08)`, `:148-150`) which is faint on gold; the pill override darkens hover
  so it reads. Non-blocking polish, but included so hover doesn't look dead.
- **Divider vs. focus ring**: with `outline-offset:-2px`, a focused `▾` may visually overlap its
  left divider — acceptable; the ring still reads. HAT can fine-tune.
- **`#tabs` flex**: `#tabs` keeps `flex:1` so it still consumes remaining width; the pill is
  `flex:none` so it never shrinks. (Responsive shrink of the *tabs* is leg 2's job — do not change
  `#tabs { overflow-x:auto }` here.)
- **Container-menu absolute positioning**: `#container-menu` is `position:absolute` against the
  initial containing block (no positioned ancestor). Switching `right`→`left` keeps it viewport-
  anchored near the leading pill; no positioned-ancestor change is introduced.
- **Roving-tabindex contract**: the pill buttons are **outside** `#tabs`/the `tablist`, so the
  roving-tabindex and Arrow/Home/End/Delete handler (scoped to `els.tabs`) are untouched. Tab
  order simply gains two stops before the first tab.

## Files Affected
- `src/renderer/index.html` — `#tabstrip` restructured: new `#newtab-pill` wrapper leads the
  strip, wrapping `#new-tab` + `#new-tab-menu`, before `#tabs`.
- `src/renderer/styles.css` — new `#newtab-pill` rules (fill, divider, dark glyphs, hover),
  pill `:focus-visible` override (DD2), `#container-menu` re-anchored left (DD3).
- `src/renderer/renderer.js` — **no change expected** (declarative restructure).

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]` (commit is deferred to the flight-level
review/commit per `/agentic-workflow`):**

- [ ] All acceptance criteria verified
- [ ] Tests passing (`npm test` + `npm run typecheck` + `npm run lint` + `npm run format`)
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `landed` (in this file's header) — flight-level commit promotes to
  `completed`
- [ ] Check off this leg in flight.md
- [ ] (Not the final leg — no flight-level status change)
- [ ] Commit handled at the deferred flight-level review/commit, not per-leg

## Citation Audit
Citations verified against current code at leg design time — all `OK`: `index.html:14-28`
(`#tabstrip`/`#tabs`/`#new-tab`/`#new-tab-menu`/`#container-menu`); `styles.css:40-53`
(`#tabstrip`/`#tabs`), `:103-127` (`.tab:focus-visible` + global `.icon-btn:focus-visible` +
`#address:focus-visible` comment pattern), `:138-150` (`.icon-btn` base/hover), `:830-845`
(`#new-tab-menu`/`#container-menu`); `renderer.js:9-11` (`els` lookups), `:89-124`
(`openContainerMenu`/`closeContainerMenu`), `:387-392` (click handlers).
