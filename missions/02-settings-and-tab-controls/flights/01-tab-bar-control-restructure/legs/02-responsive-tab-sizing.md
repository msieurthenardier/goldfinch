# Leg: responsive-tab-sizing

**Status**: completed
**Flight**: [Tab-Bar Control Restructure](../flight.md)

## Objective
Make tabs **shrink and grow to share** the available strip width — flexing down to a usable floor
(favicon + close button stay visible, title ellipsizes) and engaging horizontal scroll only when
even the floor can't fit — replacing today's fixed `min-width:120px`/`max-width:220px` tab with an
always-on scrollbar (DD4; flight-local, no mission SC).

## Context
- Flight **DD4**: replace `#tabs { overflow-x: auto }` (`styles.css:47-53`) + `.tab {
  min-width:120px; max-width:220px }` (`styles.css:85-97`, post-leg-1) with tabs that flex to
  share available width down to a
  usable **floor** (favicon + close stay visible, title ellipsizes); horizontal scroll returns
  only when even the floor can't fit. The floor value and the scroll-onset count need empirical
  tuning — an explicit flight **open question**, deferred to HAT / this leg's default.
- **Why the scrollbar feels "always-on" today**: `.tab` carries `min-width:120px` and no
  `flex-grow`, so with more than a handful of tabs the row overflows and `overflow-x:auto`
  (`styles.css:50`) shows a scrollbar. Making tabs *shrink* (a small floor + `flex` share) is the
  fix; `overflow-x:auto` is already correct (it only renders a scrollbar when content overflows) —
  it just never got the chance because tabs wouldn't shrink.
- This leg is **CSS-only**. It does not touch `renderer.js` or `index.html`. The
  `tablist`/roving-tabindex contract, the close `<button>`, and the favicon `<img>` are all from
  the a11y baseline (mission 01) and stay exactly as-is.
- **Builds on leg 1**: leg 1 made `#newtab-pill` a `flex:none` leading sibling and left `#tabs`
  with `flex:1`. This leg changes only the *tabs inside* `#tabs`, so the pill is unaffected.
- **Seam for leg 3 (deferred resize-on-close)**: leg 3 freezes each remaining tab's measured pixel
  width on pointer-close by setting an **inline** style, then clears it on `mouseleave` to let flex
  re-expand. For that to work cleanly, this leg's tab flexing must be overridable by an inline
  `flex`/`width` and must re-expand once the inline style is removed — `flex: 1 1 0` satisfies both
  (an inline `flex: 0 0 <px>` freezes; removing it restores the shared flex). Leg 3 owns the JS;
  this leg just must not hard-code widths in a way that blocks the freeze.
- Live verification is the `responsive-tab-strip` behavior test (`tests/behavior/responsive-tab-strip.md`),
  **Steps 2–4** (shrink/grow + scroll-onset) and **Step 8** (keyboard-close reflow), deferred to
  the `verify-integration` leg. In-leg verification is the CSS presence + offline gates.
- **Tooling**: renderer is `@ts-check`'d but this is pure CSS — no type/lint surface beyond
  `npm run format`. Offline gates (`npm test` + `npm run typecheck` + `npm run lint` +
  `npx prettier --check`) must stay green.

## Inputs
What must be true before this leg runs:
- Leg 1 (`unified-pill-control`) landed: `#newtab-pill` leads `#tabstrip`; `#tabs` keeps `flex:1`.
- `src/renderer/styles.css` — **line refs are post-leg-1** (leg 1 inserted the `#newtab-pill`
  block at `:54-84`, shifting `.tab*` rules down ~31 lines): `#tabs` (`:47-53`, `overflow-x:auto`,
  `flex:1`, `scrollbar-width:thin`); `.tab` (`:85-97`, `min-width:120px; max-width:220px;
  white-space:nowrap`); `.tab.active` (`:98-104`); `.tab .tab-title` (`:105-109`,
  `overflow:hidden; text-overflow:ellipsis; flex:1`); `.tab .tab-fav` (`:110-115`, `flex:none`);
  `.tab .tab-close` (`:116-129`, `flex:none`); `.tab-jar` dot (`:855-860`, `width:8px; flex:none`).
- Offline gates green.

## Outputs
What exists after this leg completes:
- `.tab` flexes to share `#tabs` width (`flex: 1 1 0`), bounded by a usable **min-width floor**
  and a **max-width** cap; the title ellipsizes as tabs shrink; favicon + close stay visible at
  the floor.
- `#tabs` shows a horizontal scrollbar **only** when the summed floor widths exceed the strip
  width — no always-on scrollbar at moderate tab counts.
- No change to `renderer.js` / `index.html`; offline gates green.

## Acceptance Criteria
- [x] `.tab` uses `flex: 1 1 0` (or equivalent grow+shrink with a `0` basis) so tabs share the
  available `#tabs` width rather than sitting at a fixed content/`min-width`-driven size.
- [x] `.tab` has a **min-width floor** sized so the favicon (when shown), the `.tab-jar` dot (on
  container/burner tabs), AND the `.tab-close` button remain fully visible at the floor — the
  worst case is a **container tab with a favicon** (≈82px of non-shrinkable content; see arithmetic
  in Edge Cases), so the floor default is ≈ `88px` (tunable — see open question), with a
  **max-width** cap so a few tabs don't stretch absurdly wide (≈ `240px`).
- [x] `.tab` carries `overflow: hidden` as a **hard guarantee** that nothing spills past the tab's
  slot if the floor is ever tuned below the true content min (the close button must never paint
  outside its tab). (Safe for the focus ring: `.tab:focus-visible` uses `outline-offset:-2px`, and
  `outline` is not clipped by `overflow` regardless.)
- [x] `.tab .tab-title` can shrink to ellipsis inside the flex row — it carries `min-width: 0`
  (in addition to its existing `overflow:hidden; text-overflow:ellipsis`) so the flex item is
  allowed to shrink below its content width.
- [x] `.tab .tab-fav`, `.tab-jar`, and `.tab .tab-close` remain `flex: none` (never shrink away),
  so the floor guarantee holds.
- [x] `#tabs` retains `overflow-x: auto` (scrollbar only on overflow) — **not** `overflow-x:
  scroll` (which would force an always-on bar). It still has `flex: 1`.
- [x] No change to `src/renderer/renderer.js` or `src/renderer/index.html` (CSS-only leg).
- [x] `npm test`, `npm run typecheck` (0 errors), `npm run lint` (0 problems), and
  `npx prettier --check` on the changed file all clean.

## Verification Steps
- `grep -n -A14 '^\.tab {' src/renderer/styles.css` → `flex: 1 1 0`, a min-width floor, and a
  max-width cap present; old `min-width:120px` replaced.
- `grep -n -A4 '\.tab \.tab-title' src/renderer/styles.css` → `min-width: 0` present alongside the
  existing ellipsis rules.
- `grep -n -A6 '#tabs {' src/renderer/styles.css` → `overflow-x: auto` (not `scroll`), `flex: 1`.
- `git diff --name-only` → only `src/renderer/styles.css` changed.
- `npm run typecheck` → 0 errors; `npm run lint` → exit 0; `npm test` → all pass;
  `npx prettier --check src/renderer/styles.css` → clean.
- Deferred to `verify-integration`: `/behavior-test responsive-tab-strip` Steps 2–4 (few tabs grow
  to share, no scrollbar; many tabs shrink with favicon+close visible + ellipsis; scroll only past
  the floor) and Step 8 (keyboard-close reflow).

## Implementation Guidance

1. **`styles.css` — `.tab` flex + floor/cap (`:85-97`).** Replace the fixed sizing and add
   `overflow:hidden`:
   ```css
   .tab {
     display: flex;
     align-items: center;
     gap: 8px;
     flex: 1 1 0;        /* share #tabs width: grow to fill, shrink to the floor */
     min-width: 88px;    /* floor — favicon + jar dot + ellipsized title + close stay visible (tune at HAT) */
     max-width: 240px;   /* cap so a handful of tabs don't stretch absurdly wide */
     overflow: hidden;   /* hard guarantee: content never spills past the tab slot at the floor */
     padding: 7px 10px;
     background: var(--bg-2);
     border-radius: 8px 8px 0 0;
     cursor: pointer;
     font-size: 12px;
     white-space: nowrap;
   }
   ```
   (Only the sizing/overflow lines change — `min-width:120px`/`max-width:220px` → the flex + floor
   + cap + `overflow:hidden` above. Keep everything else in the rule.)

2. **`styles.css` — let the title ellipsize under flex (`:105-109`).** Add `min-width: 0`:
   ```css
   .tab .tab-title {
     overflow: hidden;
     text-overflow: ellipsis;
     flex: 1;
     min-width: 0; /* allow the title flex item to shrink below content width so ellipsis engages */
   }
   ```
   Without `min-width:0`, a flex item refuses to shrink below its content's intrinsic width, so the
   tab wouldn't reach the floor and the row would overflow prematurely.

3. **`styles.css` — `#tabs` unchanged in intent (`:47-53`).** Leave `overflow-x: auto`, `flex: 1`,
   `gap: 4px`, `scrollbar-width: thin`. Do not switch to `overflow-x: scroll`. (No edit needed
   unless confirming.)

4. **Do not touch the favicon/close flex.** `.tab .tab-fav` and `.tab .tab-close` are already
   `flex: none` — leave them, they are the floor guarantee.

## Edge Cases
- **Floor arithmetic (worst case = container tab with favicon)**: non-shrinkable content per tab,
  with `.tab` padding `7px 10px` (→ 20px horizontal) and `gap:8px` between children:
  - *Default tab* (3 children: fav, title, close → **2 gaps**): 20 (pad) + 14 (fav) + 16 (close)
    + 16 (2 gaps) = **66px** + title.
  - *Container/burner tab* (4 children: jar dot, fav, title, close → **3 gaps**): 20 + 8 (`.tab-jar`)
    + 14 (fav) + 16 (close) + 24 (3 gaps) = **82px** + title.
  The `88px` floor covers the 82px container worst case with a ~6px title sliver. `overflow:hidden`
  on `.tab` is the hard backstop if the floor is ever tuned lower. Exact floor is an open question —
  tune at HAT and confirm the close button never clips on a container tab.
- **Favicon hidden state**: the favicon starts `class="tab-fav hidden"`; `.hidden` is
  `display:none !important`, so a hidden favicon contributes neither width nor its gap — that path
  is strictly narrower than the computed worst case, so it is always safe at the floor.
- **Single tab / few tabs**: `flex:1 1 0` + `max-width:240px` means a handful of tabs cap at 240px
  and leave trailing space (they do not span the whole bar) — acceptable and matches modern
  browsers. **Read behavior-test Step 2's "expand to share the available width" as "grow well above
  the floor (toward the 240px cap)," NOT "fill edge-to-edge"** — the trailing gap at low tab counts
  is expected, not a failure. Likewise leg 3's "re-expand to fill" means returning to the *shared*
  width, not edge-to-edge.
- **Scroll onset**: with `gap:4px` between tabs, scroll engages when `N*floor + (N-1)*4 >
  clientWidth`. The exact onset count is window-width dependent (the behavior test asserts the
  qualitative "shrink first, scroll last", not a fixed count) — open question, tune at HAT.
- **Active tab**: `.tab.active` only adds a box-shadow inset + weight (`:98-104`); it does not change
  sizing, so the active tab shrinks/grows like the rest. No special case.
- **Leg 3 freeze compatibility**: `flex:1 1 0` is overridable by an inline `flex:0 0 <px>` (leg 3's
  freeze) and re-expands when that inline style is cleared — do not add `!important` or hard widths
  that would block leg 3.

## Files Affected
- `src/renderer/styles.css` — `.tab` sizing (flex share + floor + cap), `.tab .tab-title`
  (`min-width:0`). No other files.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[HANDOFF:review-needed]` (commit is deferred to the
flight-level review/commit per `/agentic-workflow`):**

- [x] All acceptance criteria verified
- [x] Tests passing (`npm test` + `npm run typecheck` + `npm run lint` + `npx prettier --check`)
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed` (in this file's header) — flight-level commit promotes to
  `completed`
- [x] (Not the final leg — no flight.md leg checkoff or flight-status change here; done at the
  flight-level commit)

## Citation Audit
Citations verified against the **post-leg-1 working tree** (leg 1's `#newtab-pill` block at
`:54-84` shifted `.tab*` rules down ~31 lines from the pre-leg-1 layout) — all `OK`:
`styles.css:47-53` (`#tabs`, unshifted — precedes the pill block), `:85-97` (`.tab` fixed min/max
sizing), `:98-104` (`.tab.active`), `:105-109` (`.tab .tab-title` ellipsis), `:110-115`
(`.tab .tab-fav` flex:none), `:116-129` (`.tab .tab-close` flex:none), `:855-860` (`.tab-jar` dot,
`width:8px; flex:none`). All Implementation-Guidance / Verification greps are pattern-based
(line-number-robust). Behavior-test alignment: `responsive-tab-strip` Steps 2–4 + 8.
