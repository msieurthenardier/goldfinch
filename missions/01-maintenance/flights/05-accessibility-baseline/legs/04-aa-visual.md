# Leg: aa-visual

**Status**: completed
**Flight**: [Accessibility — Keyboard & Screen-Reader Baseline](../flight.md)

## Objective
Close the WCAG 2.1 AA *visual & motion* gaps (F24b): honor `prefers-reduced-motion`, add non-color cues to color-only state, raise small-text and switch-track contrast to AA, and give each media-pick checkbox an accessible name.

## Context
- Flight **F24b** scope: `prefers-reduced-motion` for panel/player/switch/toast animation; non-color cues for Shields on/off + alert + active-tab + active-filter state; raise `--fg-dim` (small text) and the `.switch` off-track per **DD5**; `aria-label` per media-pick checkbox.
- **DD5 verification split**: axe `color-contrast` (text-only, WCAG 1.4.3) verifies the `--fg-dim` small-text fix. It does **NOT** check non-text/UI contrast (1.4.11 — switch track) or color-independence (1.4.1 — state cues) — those go to **screenshot/manual review**. Labeling the media-pick checkbox enables the `label` rule, which (with `color-contrast`) now joins the **F24b + verify** axe gate (the full WCAG-tag set; see flight DD3).
- **DD4**: renderer `@ts-check`'d. Offline gates stay clean. The live axe run is deferred to `verify-a11y`.
- This is the **last autonomous leg** (4 of 5); after it, the flight-level review + single commit run, then the operator-gated `verify-a11y` leg. Legs 1-3 done/uncommitted; citations re-located against current `main` after leg 3.

## Inputs
- `src/renderer/styles.css` — tokens `--bg-2 #282a32` (`:3`), `--bg-3 #32343d` (`:4`), `--fg-dim #9a9ca6` (`:6`), `--accent #f5c518` (`:7`); transitions at `:219` (media panel width), `:550` (toast bar width), `:641` (privacy panel width), `:796` (`.switch` background), `:810` (`.switch::after` left); color-only state `.tab.active` (`:67`), `.text-btn.active` (`:166`), `.filter.active` (`:263`), `#toggle-privacy.alert` (`:738`); `.switch` (`:787`) off-track `background:#555` (`:793`).
- `src/renderer/renderer.js` (line numbers below corrected against the post-legs-1-3 working tree per design review) — media-pick checkbox built in `mediaCard`: `cb.type='checkbox'` (`:497`), checked/selected wiring (`:498-504`); filter click handler (`els.filters.forEach`, `:453-460`); panel toggles `togglePanel` (`:423-432`) / `togglePrivacy` (`:978-989`); `closePrivacyPanel` (`:973-976`, on the media-open mutual-exclusion path); `updatePrivacyBadge` sets `#privacy-count` text + `.alert` (`:1048-1053`).
- `src/renderer/index.html` — filter buttons `.filter` (`:73-77`, "All" has `.active`); `#toggle-media` (`:30`)/`#toggle-privacy` (`:33`) panel toggles.

## Outputs
- Animations are suppressed under `prefers-reduced-motion: reduce`; active tab/filter and panel-toggle/alert states have non-color cues; `--fg-dim` text and the switch off-track meet AA contrast; every media-pick checkbox is named.
- Offline gates green; F24b axe rules (`color-contrast`, `label`) designed to pass; non-text contrast + color-independence ready for screenshot review (both at `verify-a11y`).

## Acceptance Criteria
- [x] A `@media (prefers-reduced-motion: reduce)` block neutralizes non-essential motion — at minimum the transitions at `styles.css:219,550,641,796,810` (panel widths, toast bar, switch) reduced to `none` (or near-instant). Use a targeted block (e.g. `*, *::before, *::after { transition: none !important; animation: none !important; scroll-behavior: auto !important; }` inside the media query). JS-driven `transform` zoom/pan is not a CSS transition and is unaffected.
- [x] **`--fg-dim` already passes AA** (computed in design review: 5.23:1 on `--bg-2`, **4.53:1 on `--bg-3`** — a razor-thin pass). This AC is therefore an **optional defensive margin bump**, not a fix: optionally raise `--fg-dim` from `#9a9ca6` to ~`#b4b6bf` (7.08:1 / 6.13:1) to clear the 4.53 edge, **without washing out the "dim" hierarchy**. If kept as-is, that's acceptable — do not claim it was a contrast *failure*.
- [x] **Real color-contrast failure — fix it:** `.ps-main.bad` (`#ff6b6b`, the "Not secure — HTTP" text) on `--bg-3` is **4.47:1 (<4.5, FAIL)**, and the verify sweep reaches it (the HTTP fixture renders the privacy panel's insecure-connection state). Raise it to ≥4.5:1 — e.g. `#ff8a8a` (5.46:1). (Other status colors — `.ps-main.ok`, `.ps-sub.warn`, `.tag.*`, `.lcd` — were checked and pass or carry text; the verify full sweep is the backstop for any straggler, fixed in the verify commit if found.)
- [x] The `.switch` off-state track (`:793`, currently `#555`) is raised to meet ≥3:1 (WCAG 1.4.11 non-text contrast) against the panel background (`--bg-3`) it sits on — e.g. a lighter track and/or a border. (Screenshot-verified; axe `color-contrast` does NOT cover this.)
- [x] Color-only state gains non-color cues:
  - **Active tab** (`.tab.active`): a non-color indicator in addition to the background — e.g. an accent inset top-bar (`box-shadow: inset 0 2px 0 var(--accent)`) and/or `font-weight:600`. (Screenshot-verified.)
  - **Active filter** (`.filter.active`): `aria-pressed` reflects the active filter (set in the filter click handler + initial state in HTML), giving AT a non-color signal; keep a clear visual fill.
  - **Panel toggles** (`#toggle-media`/`#toggle-privacy`): `aria-expanded` reflects whether the panel is open (initial `false` in HTML). **Must be synced on ALL paths**: `togglePanel` (media), `togglePrivacy` (privacy), **and `closePrivacyPanel()`** — opening media calls `closePrivacyPanel()` directly, which collapses the privacy panel but (without instrumentation) would leave `#toggle-privacy` `aria-expanded="true"` stale.
  - **Shield alert** (`#toggle-privacy.alert`): confirm the numeric `(N)` tracker count in `#privacy-count` is the non-color cue (it already renders, e.g. "Shield (3)"); document this — no color-only reliance. (Optional: a leading symbol.)
- [x] Each media-pick checkbox gets `aria-label` naming its item (e.g. `Select ${item.label || item.name}`), set where the checkbox is created (`renderer.js:497` area). **Note:** the checkbox is wrapped in `<label class="media-pick">` containing the badge text, so it likely *already* passes axe `label` (name present) — this is a **name-quality** improvement (a unique, descriptive name per item instead of just the type badge), not a fix for a current failure.
- [x] `npm test` (147 pass), `npm run typecheck` (0 errors), `npm run lint` (0 problems) all clean.
- [ ] **Deferred to `verify-a11y`**: full WCAG-tag axe sweep (now incl. `color-contrast` + `label`) clean; screenshot review of reduced-motion, switch-track contrast, and the active-tab/filter/alert non-color cues.

## Verification Steps
- `grep -n 'prefers-reduced-motion' src/renderer/styles.css` → block present.
- `grep -n '\-\-fg-dim' src/renderer/styles.css` → value raised from `#9a9ca6`.
- `grep -n 'aria-pressed\|aria-expanded\|aria-label' src/renderer/renderer.js` → filter pressed-state, toggle expanded-state, checkbox label wired.
- `grep -n 'aria-pressed\|aria-expanded' src/renderer/index.html` → initial filter/toggle states.
- `grep -n 'box-shadow: inset' src/renderer/styles.css` (or equivalent) → active-tab non-color cue.
- `npm run typecheck` → 0 errors; `npm run lint` → exit 0; `npm test` → 147 pass.
- Deferred to `verify-a11y`: `npm run a11y -- --tags=wcag2a,wcag2aa,wcag21a,wcag21aa` clean (incl. color-contrast + label); screenshot review of the non-text/color-independence items.

## Implementation Guidance

1. **Reduced motion (`styles.css`)** — append near the end:
   ```css
   @media (prefers-reduced-motion: reduce) {
     *,
     *::before,
     *::after {
       transition-duration: 0.01ms !important;
       animation-duration: 0.01ms !important;
       animation-iteration-count: 1 !important;
       scroll-behavior: auto !important;
     }
   }
   ```

2. **`--fg-dim` (`styles.css:6`) — OPTIONAL margin bump.** It already passes (5.23:1 bg-2, 4.53:1 bg-3). Optionally set `#b4b6bf` for margin (7.08 / 6.13); or leave `#9a9ca6`. Not a required fix.

2b. **`.ps-main.bad` (`styles.css` ~`:749`, `#ff6b6b`) — REQUIRED fix.** 4.47:1 on `--bg-3` fails AA; raise to `#ff8a8a` (5.46:1). This is the one real text-contrast failure the verify sweep reaches.

3. **Switch off-track (`styles.css:793`)** — change `background:#555` (1.66:1 vs `--bg-3`, fails) to a lighter track ≥3:1, e.g. `#7c7f8a` (3.10:1 — clears but thin). **Pair it with a `1px solid` border in a contrasting tone for robustness** (the 3.10 margin is fragile). Keep the `.switch.on` accent fill. (Non-text — screenshot-verify, not axe.)

4. **Active-tab cue (`styles.css:67`, `.tab.active`)** — add a non-color indicator, e.g. `box-shadow: inset 0 2px 0 var(--accent); font-weight: 600;` alongside the existing `background: var(--bg-3)`.

5. **Filter `aria-pressed` (`renderer.js` filter handler ~`:415` + `index.html:73-77`)** — in the `els.filters.forEach(... click ...)` handler, after toggling `.active`, set `aria-pressed` on each filter (`f.setAttribute('aria-pressed', String(isActive))`). In `index.html`, add `aria-pressed="true"` to the "All" button and `aria-pressed="false"` to the others as the initial state.

6. **Panel-toggle `aria-expanded` (`renderer.js` + `index.html:30,33`)** — sync on **all three** paths: in `togglePanel` (~`:423-432`) set `els.toggleMedia.setAttribute('aria-expanded', String(show))`; in `togglePrivacy` (~`:978-989`) set `els.togglePrivacy.setAttribute('aria-expanded', String(show))`; **and in `closePrivacyPanel()` (~`:973-976`) set `els.togglePrivacy.setAttribute('aria-expanded','false')`** (the media-open path calls it directly — without this the privacy toggle keeps a stale `true`). Initial `aria-expanded="false"` on both in `index.html`. Optionally add `aria-controls="media-panel"`/`"privacy-panel"` to complete the disclosure semantics.

7. **Media-pick checkbox label (`renderer.js:497` area)** — after `cb.type = 'checkbox'`, add `cb.setAttribute('aria-label', \`Select ${item.label || item.name}\`);`.

8. **Shield alert cue** — verify `updatePrivacyBadge` renders `Shield (N)` when trackers are present (the `(N)` is the non-color cue); add a brief code comment noting the count satisfies 1.4.1 so the red `.alert` isn't color-only. (No behavior change required if the count already renders.)

## Edge Cases
- **`--fg-dim` over-lift**: raising it too far washes out the intended "dim" hierarchy. Pick the minimum that passes 4.5:1; if a specific large-text usage (e.g. `.ps-big`, 26px) only needs 3:1, that's automatically satisfied by the 4.5:1 bump.
- **Reduced-motion global override**: using `transition-duration:0.01ms` (not `none`) avoids breaking any code that listens for `transitionend`; none currently does, but this is the safe idiom.
- **`aria-pressed` vs `aria-expanded`**: filters are toggle buttons (pressed); panel toggles control a disclosure (expanded). Don't mix them.
- **`@ts-check`**: `els.filters` is a `NodeListOf<HTMLElement>`; `f.setAttribute` is fine. `els.toggleMedia`/`els.togglePrivacy` are typed buttons. The checkbox `cb` is a freshly-created `HTMLInputElement` — `setAttribute` is fine. No new casts expected.
- **Screenshot items can't be gated offline**: the active-tab/filter cues, switch-track contrast, and reduced-motion are confirmed by screenshot at `verify-a11y` — this leg's offline gate only proves the CSS/JS is present and typechecks/lints.

## Files Affected
- `src/renderer/styles.css` — `@media (prefers-reduced-motion)` block; `.ps-main.bad` color fix (`#ff6b6b`→`#ff8a8a`); `.switch` off-track + border; `.tab.active` non-color cue; (optional) `--fg-dim` margin bump.
- `src/renderer/renderer.js` — filter `aria-pressed`; panel-toggle `aria-expanded` on `togglePanel` + `togglePrivacy` + `closePrivacyPanel`; media-pick checkbox `aria-label`; shield-alert comment.
- `src/renderer/index.html` — initial `aria-pressed` on filters, `aria-expanded` on panel toggles.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified (offline; axe color-contrast/label + screenshot review deferred to verify)
- [x] Tests passing (`npm test` + `npm run typecheck` + `npm run lint`)
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `completed`
- [ ] Check off this leg in flight.md (deferred to the flight-level review per orchestrator instruction)
- [ ] (Last autonomous leg — but flight is NOT landed until `verify-a11y`; do NOT set flight `landed` here)
- [ ] Commit handled at the deferred flight-level review/commit (after this leg)

## Citation Audit
styles.css citations exact and `OK`: `:3,4,6,7` (tokens), `:219,550,641,796,810` (transitions), `:67` (.tab.active), `:166` (.text-btn.active), `:263` (.filter.active), `:738` (#toggle-privacy.alert), `~:749` (`.ps-main.bad #ff6b6b`), `:787` (.switch), `:793` (off-track `#555`); `index.html:30,33,73-77`. **renderer.js citations corrected (design review — earlier draft used committed-`main` numbers; the working tree is +legs-1-3):** media-pick checkbox `:497-504` (exact), filter handler `:453-460`, `togglePanel` `:423-432`, `togglePrivacy` `:978-989`, `closePrivacyPanel` `:973-976`, `updatePrivacyBadge` `:1048-1053`. **Computed contrast (design review)**: `--fg-dim` 5.23/4.53:1 (PASS — bump optional); `.ps-main.bad` 4.47:1 (FAIL — fixed here); `.switch` off-track `#555` 1.66:1 (FAIL — fixed here). All re-verified `OK`.
