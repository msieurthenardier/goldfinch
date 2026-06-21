# Leg: side-panel-animation

**Status**: aborted (reverted at HAT — #27/SC10 deferred)
**Flight**: [Polish & MCP Hygiene](../flight.md)

> **REVERTED 2026-06-21 (Flight-6 HAT, operator decision).** This leg landed in the autonomous pass but
> **failed live HAT verification** and was reverted in full (`src/renderer/renderer.js` +
> `src/renderer/styles.css` restored to pre-flight `main`). Three clean mechanism attempts — (1) the
> committed transform + discrete-width-swap, (2) an absolute overlay, (3) a clipped absolute overlay
> (`#main { overflow:hidden }`) — **all failed the same way**: on panel *open* the page content shifts/clips
> and the panel mis-anchors (the "third column"), even though the DOM geometry reads correct. Root cause is
> the **Electron `<webview>` native compositing surface mis-positioning when the layout changes around it
> under WSLg** — not a CSS/DOM bug (boot/at-rest is pixel-correct; only the layout-change-on-open breaks).
> This is environment-specific and disproportionate to debug blind for a polish item. **#27/SC10 deferred**
> to the planned macOS/Windows verification pass (where `<webview>` composites differently) or a dedicated
> flight — see the mission Known Issues. The design analysis below is retained for that future effort.

## Objective

Fix GitHub issue #27 (the side-panel open-animation glitch, → SC10) with the **two-prong** fix the
flight's **DD1** prescribes: (A) replace the layout-animating `width`/`margin-right` transitions on
`#media-panel` and `#privacy-panel` with a GPU-composited `transform` slide so neither the web content
nor the top chrome reflows per frame; and (B) decouple the Shields panel's heavy content population
(`renderPrivacy()` + the async `fetchCookies()` re-render) from the open frame so it doesn't pop-in/reflow
*during* the slide.

## Context

Cite, don't restate — the authoritative rationale lives in the flight:

- **DD1** (`flight.md`) — the root cause (animating `width`/`margin` on a flex child forces a per-frame
  reflow of `#webviews` and the chrome above it) and the two-prong remedy. Read DD1 in full; this leg
  implements it. Key constraints carried verbatim from the architect's `[low]` note:
  - **Success criterion is "no _per-frame_ reflow," NOT "zero layout steps."** A single discrete `width`
    swap synchronized with the transform (at animation start/end) is acceptable and is the design target.
    What must go is the *per-frame* `width` interpolation.
  - **The collapsed state must still release the panel's layout box** so `#webviews` reclaims the full
    width at rest. Do NOT permanently reserve `--panel-w` in layout when closed.
  - **Handle the 1px `border-left`** that `.collapsed` removes (`styles.css:620` / `styles.css:1042`) so
    it doesn't contribute to the at-rest content width when closed.
  - **Reduced-motion must still neutralize** the new animation (existing global `*` duration override,
    `styles.css:1544-1553`).
- **DD1 — Prong B (Shields content-population timing)** is a planning-time HAT finding (`flight-log.md`,
  "Planning-time HAT observations", 2026-06-20): with byte-identical CSS, Media is already smooth and
  Shields glitches. The difference is purely in the JS open path — `togglePrivacy()` synchronously calls
  `renderPrivacy()` (full `body.innerHTML=''` rebuild of ~7 sections) **and** `fetchCookies()` (async → a
  *second* `renderPrivacy()` a frame later: the "Loading…" → cookie-count swap), while `togglePanel()`
  (media) only flips the class. The heavy rebuild + late async re-render land mid-slide. **The transform
  fix alone will NOT fix Shields** — Prong B is co-equal.
- **Open Question (#27 mechanism)** in `flight.md` was left for leg design: option (a) panel keeps a
  layout box and slides off-screen via `transform`, vs (b) panel overlays content. This leg resolves it
  (see Implementation Guidance — a *hybrid* of (a): transform for the visual motion, discrete width swap
  for the layout box, so the box is released at rest).
- **Adaptation criterion (`flight.md`):** if the transform slide can't keep the content area reflow-free
  without a structural panel-layout change bigger than a polish leg warrants, **descope #27 to the
  minimal safe jump-removal and log the remainder** — do not destabilize the panels for a closing flight.
- **Scope boundary:** renderer CSS (`styles.css`) + a scoped `renderer.js` toggle/render-timing change.
  **No main-process change.** Internal/renderer-chrome pages are not auditable by the automation surface;
  the *visual smoothness* of this animation is **HAT-verified** (the optional `hat-and-alignment` leg),
  not asserted by `npm run a11y`. The observable, code-inspectable criteria are in Acceptance Criteria.

## Inputs

What exists before this leg runs (verified against `main` @ `56dda8d`):

- **Markup (`src/renderer/index.html`):** `#main` (`:117`) is `display:flex` and contains, in order,
  `#webviews` (`:118`, `flex:1`), then `<aside id="media-panel" class="collapsed">` (`:138`), then
  `<aside id="privacy-panel" class="collapsed">` (`:181`). The panels are flex siblings to the right of
  the web content; only one is ever open at a time (each toggle closes the other).
- **CSS — Media panel (`src/renderer/styles.css`):**
  - `#media-panel` (`:606-616`) — `width: var(--panel-w); flex: none; border-left: 1px solid var(--border);`
    and `transition: width 0.18s ease, margin-right 0.18s ease;` (lines 613-615 — *note: the
    `margin-right` transition is declared but no rule actually sets a non-zero `margin-right`; it is
    vestigial. Remove it with the `width` transition.*)
  - `#media-panel.collapsed` (`:617-621`) — `width: 0; overflow: hidden; border-left: none;`
- **CSS — Privacy panel (`src/renderer/styles.css`):**
  - `#privacy-panel` (`:1028-1037`) — identical shape to `#media-panel`, same `transition` (`:1035-1037`).
  - `#privacy-panel.collapsed` (`:1039-1043`) — `width: 0; overflow: hidden; border-left: none;`
- **CSS — layout anchors:** `#main` (`:526-531`, `flex:1; display:flex; min-height:0; position:relative`);
  `#webviews` (`:532-536`, `flex:1; position:relative`). `--panel-w: 360px` (`:11`).
- **CSS — reduced-motion (`styles.css:1539-1553`):** a global `@media (prefers-reduced-motion: reduce)`
  block setting `transition-duration: 0.01ms !important` on `*, *::before, *::after`. It already covers
  *any* transition including `transform`, so it neutralizes the new slide without edit — **confirm, don't
  assume** (Acceptance Criteria below).
- **JS — Media open path (`src/renderer/renderer.js`):** `togglePanel(force)` (`:1208-1225`) — flips
  `els.panel.classList.toggle('collapsed', !show)`, syncs `aria-expanded`, closes the privacy panel and
  moves focus on open. **No content rebuild.** `els.panel` = `#media-panel` (`:25`).
- **JS — Shields open path (`src/renderer/renderer.js`):** `togglePrivacy(force)` (`:1785-1803`) — flips
  `els.privacyPanel.classList.toggle('collapsed', !show)` (`:1788`), and **on open** (`:1791-1795`) calls
  `togglePanel(false)`, then `fetchCookies()` (`:1793`), then `renderPrivacy()` (`:1794`), then focuses.
  `els.privacyPanel` = `#privacy-panel` (`:45`), `els.privacyBody` = `#privacy-body` (`:46`).
- **JS — `renderPrivacy()` (`renderer.js:2309-2388`):** `updatePrivacyBadge()` first, then **early-returns
  if the panel is `.collapsed`** (`:2311` — `if (els.privacyPanel.classList.contains('collapsed')) return;`),
  else does `els.privacyBody.innerHTML = ''` (`:2316`) and appends ~7 sections (Shields, Jar, Connection,
  Trackers, Third-party, Cookies+storage, Fingerprinting, Permissions). The Cookies section (`:2352-2363`)
  renders `'Loading…'` until `tab.privacy.cookies` is populated. **This collapsed-guard is load-bearing
  for Prong B** — see Edge Cases.
- **JS — `fetchCookies()` (`renderer.js:1867-1876`):** `async`; awaits `window.goldfinch.privacyCookies(...)`,
  then calls `renderPrivacy()` again (`:1872`) a frame+ later — this is the second, async re-render that
  produces the "Loading…" → cookie-count swap mid-slide.
- **Other `renderPrivacy()` callers** (must keep working): refresh button (`:1847`), `onPrivacyNet`
  (`:1854`), `clearCookies`→`fetchCookies` (`:1883`→`:1872`), shields config load/change (`:1910`,`:1914`),
  tab activation/nav paths (`:831`, `:1009`, `:1050`, `:1864`, `:2180`, `:2188`). All already tolerate the
  collapsed early-return; do not change their behavior.

## Outputs

What exists after this leg completes:

- **`src/renderer/styles.css`** — `#media-panel` and `#privacy-panel` no longer transition `width`/
  `margin-right`; they transition `transform` instead. A non-transitioned discrete `width` swap drives
  the at-rest layout box (open = `--panel-w`, collapsed = `0`). The `.collapsed` `border-left: none` is
  preserved (or the border is handled so it never adds to at-rest content width). Reduced-motion block
  unchanged (confirmed to cover `transform`).
- **`src/renderer/renderer.js`** — `togglePrivacy()`'s open path is reworked so Shields content is
  populated **before** the visual slide begins (panel laid out but pre-paint / off-screen), and the async
  `fetchCookies()` re-render is settled or deferred so it does not reflow mid-slide. Media path
  (`togglePanel`) unchanged except as needed to share any new slide mechanism. Possibly a small change to
  the `renderPrivacy()` collapsed-guard so a pre-slide populate is permitted (see Edge Cases).
- **No new files. No main-process change. No test files required** (renderer-chrome behavior is not unit-
  testable in this harness; smoothness is HAT-verified). The SC9 schema-hygiene unit test belongs to a
  different leg.

## Acceptance Criteria

- [x] **AC1 — No layout-property transition remains on either panel.** `#media-panel` and `#privacy-panel`
  have **no** `transition` on `width` or `margin-right` (grep the two rules — the `width 0.18s` /
  `margin-right 0.18s` declarations at `styles.css:613-615` and `:1035-1037` are gone).
- [x] **AC2 — The slide is `transform`-driven.** Both panels animate via a `transform` (e.g.
  `translateX`) transition that the compositor handles off the main thread; opening/closing produces the
  visual slide via `transform`, not via interpolated `width`.
- [x] **AC3 — Layout box released at rest when closed.** When a panel is collapsed (closed), it occupies
  **zero** layout width — `#webviews` reclaims the full width (no permanent `--panel-w` reservation, no
  leftover gap). When open it occupies exactly `--panel-w`. (The discrete width swap is allowed; the
  per-frame width interpolation is not.)
- [x] **AC4 — The closed border adds no width.** The 1px `border-left` that `.collapsed` removes
  (`styles.css:620`/`:1042`) does not contribute to the at-rest content width when the panel is closed.
  *Note:* the global `box-sizing: border-box` (`styles.css:14-16`) already puts the border inside the
  `width` box, so a `width:0` panel is truly 0-width regardless — the `.collapsed { border-left: none }`
  removal is belt-and-suspenders, not load-bearing. Don't over-engineer border handling.
- [~] **AC5 — Top chrome stays stationary.** *(HAT-deferred — code-inspectable half satisfied: nothing
  animates a layout-affecting property on an ancestor; only `transform` transitions. Visual smoothness to
  `hat-and-alignment`.)* Opening/closing either panel does not move or reflow the
  toolbar/tab-strip chrome above `#main` (HAT-observable; code-inspectable that nothing animates a
  layout-affecting property on an ancestor).
- [x] **AC6 — Reduced-motion still neutralizes the animation.** Under `prefers-reduced-motion: reduce`
  the new `transform` transition is reduced to ~instant by the existing global block (`styles.css:1544-1553`);
  no separate reduced-motion rule needed for the panels, OR if one is added it neutralizes correctly. The
  panels still open/close (just without the slide).
- [~] **AC7 — Shields content is present before the slide starts.** *(HAT-deferred for the observed-motion
  half; code path verified: `populatePrivacy()` runs in `slidePanel`'s `beforeReveal` pre-paint window
  before `.collapsed` is removed.)* On opening the privacy panel, the ~7
  sections are populated (no empty `#privacy-body` painted during the slide). The Media panel (no content
  rebuild) remains smooth as before.
- [~] **AC8 — No second reflow from cookies mid-slide.** *(HAT-deferred for the observed-motion half; code
  path verified: `fetchCookies()` deferred via `setTimeout(SLIDE_MS+20)` so its re-render lands after the
  slide.)* The async `fetchCookies()` re-render (the
  "Loading…" → cookie-count swap) does **not** trigger a `renderPrivacy()` reflow *during* the slide; it
  is settled before the slide or deferred until after it completes (e.g. the swap lands after the
  transform finishes, or is patched in place rather than via full `innerHTML` rebuild).
- [x] **AC9 — Functional behavior preserved.** Only one right-side panel open at a time (opening Shields
  still closes Media and vice-versa); `aria-expanded` on both toggles tracks open/closed; Escape closes
  the open panel; focus is moved into the panel on open and restored to the toggle on close (the existing
  focus-restoration guards at `:1217-1223` / `:1796-1801` still hold); all other `renderPrivacy()` callers
  (refresh, net/permission events, shields config, tab nav) still update the panel when open.
- [~] **AC10 — Suite/typecheck/lint clean; a11y chrome sweep clean.** *(`npm test` 938 pass / `npm run
  typecheck` clean / `npm run lint` clean — DONE. `npm run a11y` chrome sweep needs a live GUI + MCP admin
  key, unavailable headless → deferred to `hat-and-alignment` / flight-level verification.)* `npm test` (node --test) passes;
  `npm run typecheck` and `npm run lint` clean; `npm run a11y` shows **0 new** WCAG A/AA violations in the
  chrome sweep. *(a11y/typecheck/lint require their environments; see Verification Steps.)*
- [x] **AC11 — Single shared slide mechanism, guarded (design-review [high]+[medium]).** *(code-verified:
  all four call sites route through `slidePanel`; all three `transitionend` guards present; cross-panel
  switch box-release verified by inspection — observed-motion cross-panel switch HAT-confirmed in
  `hat-and-alignment`.)* All collapse/expand
  paths — `togglePanel`, `togglePrivacy`, **`closePrivacyPanel`**, and the two mutual-exclusion close calls
  (`togglePanel(false)` from `togglePrivacy`; `closePrivacyPanel()` from `togglePanel`) — route through one
  shared `slidePanel(el, show)` helper (no call site flips `.collapsed` + width independently).
  `slidePanel` owns **only** the width/transform/`transitionend` mechanism — the toggle functions retain
  their `aria-expanded`/`.active`/focus logic and the per-button `.hidden` focus guards (`:1223`/`:1801`);
  do NOT fold those into `slidePanel` and drop them. The
  `transitionend` width-release handler checks `event.propertyName === 'transform'`, re-reads the panel's
  current intended state before mutating width, and has a fallback timeout. Verified: open Shields directly,
  open Media directly, and **switch directly from one to the other** — in all cases the closed panel
  releases its box (AC3 holds on the cross-panel switch) and neither strands at `--panel-w`.

## Verification Steps

- **AC1/AC2/AC3/AC4** — Inspect `styles.css` `#media-panel`/`#privacy-panel` and their `.collapsed`
  rules: confirm no `width`/`margin-right` in `transition`; confirm a `transform` transition; confirm the
  collapsed state yields a 0-width layout box (width swap, not reserved) and the border is handled.
  `grep -nE 'transition|transform|width|border-left' src/renderer/styles.css` around `:606-621` and
  `:1028-1043`.
- **AC6** — Inspect that `styles.css:1544-1553` still matches `*` (covers `transform`); confirm no panel
  rule sets `transition: ... !important` that would defeat it. HAT: with reduced-motion on, panels snap
  open/closed without a slide.
- **AC7/AC8/AC9** — Inspect the reworked `togglePrivacy()` open path and `renderPrivacy()`/`fetchCookies()`
  ordering in `renderer.js`; confirm content populates before the slide and the cookie re-render is
  deferred/settled. HAT (the optional `hat-and-alignment` leg, `npm run dev`): open/close Media and Shields
  repeatedly — both slide smoothly, top chrome stationary, no Shields pop-in/reflow, no "Loading…" flash
  jumping the layout mid-slide; reduced-motion variant snaps; Escape/focus/aria all behave.
- **AC10** —
  - `npm test` — node --test unit suite (~1s), expect green (no unit coverage is added or removed by this
    renderer-chrome leg; this is a regression check).
  - `npm run typecheck` — `tsc --noEmit -p jsconfig.json`, clean.
  - `npm run lint` — `eslint .`, clean.
  - `npm run a11y` — `scripts/a11y-audit.mjs`; **needs a live GUI + MCP admin** (WSLg/HAT environment).
    Expect 0 new violations in the chrome sweep. The internal/renderer pages aren't auditable by the
    harness, so the panel *animation* itself is **not** an `a11y` assertion — it's HAT-verified. If the
    a11y apparatus isn't available in the autonomous environment, defer this check to the `hat-and-alignment`
    leg and note it.

## Implementation Guidance

### Prong A — `transform`-composited slide (both panels), `styles.css`

Resolve the flight's #27-mechanism Open Question as a **hybrid of option (a)**: keep the visual motion in
a `transform` the compositor owns, but drive the *layout box* with a discrete (non-transitioned) `width`
swap so the box is released at rest (DD1's "no per-frame reflow, but still release the box").

1. **Replace the transition on both panel rules.** In `#media-panel` (`styles.css:613-615`) and
   `#privacy-panel` (`:1035-1037`), replace:
   ```css
   transition:
     width 0.18s ease,
     margin-right 0.18s ease;
   ```
   with a transform-only transition, e.g.:
   ```css
   transition: transform 0.18s ease;
   will-change: transform;          /* hint the compositor; optional */
   ```
   Keep `width: var(--panel-w); flex: none;` as the **open** layout box.

2. **Drive the slide with `transform` on the collapsed state.** In `.collapsed` (`:617-621` / `:1039-1043`),
   the panel must (i) slide off-screen and (ii) release its layout box. Because the panel sits at the
   right edge, translate it fully off to the right:
   ```css
   #media-panel.collapsed,
   #privacy-panel.collapsed {
     transform: translateX(100%);
     /* width swap happens WITHOUT transition (transition is transform-only above),
        so the box collapses in one discrete step, not per-frame */
     width: 0;
     overflow: hidden;
     border-left: none;
   }
   ```
   **Important nuance to validate during implementation:** with `width:0` *and* `translateX(100%)`,
   `100%` of a 0-width box is 0 — the translate would be a no-op and the panel would just snap to zero
   width (the old jump). You must ensure the element still has its `--panel-w` extent *while the transform
   plays*, then collapse the width. Two viable shapes — pick the one that holds reflow-free and keeps the
   box released at rest (this is the crux the architect flagged; see the Divert criterion if neither is
   clean):

   - **(a-i) JS-sequenced width swap synced to the transform (preferred; matches DD1's "discrete width
     swap synchronized with the transform at start/end").** Keep `.collapsed { transform: translateX(100%); }`
     but DON'T put `width:0` in `.collapsed`. Instead toggle width in JS around the transform:
     - *Open:* set `width` to `--panel-w` first (panel still translated off-screen via `.collapsed`),
       force a reflow read, then remove `.collapsed` so only the transform animates in.
     - *Close:* add `.collapsed` (transform animates out), then on `transitionend` set `width:0` to release
       the box. Use the existing reduced-motion path: under reduced motion the transition is ~instant so
       `transitionend` still fires (the comment at `styles.css:1541` documents this exact intent — 0.01ms
       not `none` precisely so `transitionend` listeners fire).
     - The translate base must be relative to the open width, so set `transform` origin/width before the
       class flip. This keeps `#webviews` at full width at rest (box released) and reflow-free during the
       slide (only `transform` animates).
   - **(a-ii) Pure-CSS overlay variant (fallback).** Position the panel `absolute`/overlay within `#main`
     (`position:relative` is already set, `styles.css:530`) so it never participates in `#webviews`'s
     flex sizing; slide it with `transform: translateX(100%)`; `#webviews` is always full width.
     **Trade-off:** this changes the content/panel relationship (panel overlays content instead of sitting
     beside it) — the flight's Open Question explicitly notes (b) "changes the content/panel relationship."
     Only take this if (a-i) proves to reflow; log the relationship change in the flight log.

   **Choose (a-i) first.** It preserves the existing beside-content layout and satisfies "box released at
   rest." If the `transitionend`/width-swap sequencing proves fragile across the open AND close directions,
   fall back to (a-ii) and note it. If *neither* holds reflow-free without a structural change bigger than
   a polish leg warrants, invoke the flight's **Divert** criterion: descope to the minimal safe
   jump-removal and log the remainder.

   **2a. CENTRALIZE the slide in ONE shared helper — all FOUR collapse/expand call sites must route
   through it (design-review [high]).** The privacy panel is collapsed by *three* paths, not just its own
   toggle: `togglePrivacy()` (`renderer.js:1785`), **`closePrivacyPanel()` (`renderer.js:1777-1783`,
   called from `togglePanel` open at `:1215`)**, and the media panel by **`togglePanel(false)`** (called
   from `togglePrivacy` open at `:1792`). Today these helpers just do `classList.add/toggle('collapsed')`
   with no JS width sequencing. If the width-swap/transform logic lives only in the click-handler path, the
   **mutual-exclusion cross-panel switch — the single most common interaction — strands the closing panel
   at `width:--panel-w` (box never released) or skips the transform.** Introduce a single
   `slidePanel(el, show)` helper that owns the entire open/close mechanism (width write, reflow read, class
   flip, `transitionend` width-release) and have **all** call sites route through it: `togglePanel`,
   `togglePrivacy`, `closePrivacyPanel`, and the two mutual-close calls. Recommended: make
   `closePrivacyPanel()` delegate to `slidePanel(els.privacyPanel, false)` and `togglePanel`/`togglePrivacy`
   call `slidePanel(...)` instead of `classList.toggle('collapsed', …)` directly. AC3 ("box released at
   rest") must hold on the cross-panel switch, not just the direct toggle.

   **2b. Pin the EXACT frame ordering (design-review [medium]).** Collapsed-at-rest = `width:0` (set by JS)
   + `.collapsed` (`transform: translateX(100%)`). The open and close sequences:
   - *Open:* (1) set `el.style.width = 'var(--panel-w)'` (or remove the inline `width:0`) while `.collapsed`
     is still present → the panel is `360px` wide AND `translateX(100%)` = fully off-screen right; (2) force
     a synchronous reflow read (`void el.offsetWidth`); (3) on the **next frame**
     (`requestAnimationFrame`), remove `.collapsed` so only `transform` animates to 0. Do NOT remove
     `.collapsed` synchronously in the same frame as the width write — the browser may coalesce both into
     one paint and skip the transform (snap = the old jump).
   - *Close:* add `.collapsed` (transform animates out), then release the box (`el.style.width = '0'` /
     restore the collapsed inline width) in the **`transitionend` handler**.
   - The `box-sizing: border-box` global (`styles.css:14-16`) means a `width:0` panel is truly 0 regardless
     of the 1px border — see AC4.

   **2c. The `transitionend` handler guards are MANDATORY, not advisory (design-review [medium]).** Because
   reduced-motion (0.01ms) + rapid/interrupted toggles can deliver a `transitionend` for a *stale* close
   while a new open is in flight (releasing width under an open panel — the easiest failure mode here), the
   handler MUST: (i) check `event.propertyName === 'transform'` (ignore any other property); (ii) re-read
   the panel's *current intended* state (is it still meant to be collapsed?) before mutating width — act on
   the live state, not the stale closure; and (iii) carry a **fallback timeout** (~the transition duration
   + slack) so the box still releases if `transitionend` never fires (e.g. the transform value didn't
   actually change, or the element became `display:none`). These three are acceptance-level requirements
   (see AC11), not suggestions.

3. **Border handling (AC4).** Keep `.collapsed { border-left: none; }` so the 1px border never adds to
   at-rest content width when closed. If approach (a-i) keeps the element rendered during the slide,
   ensure the border doesn't cause a 1px content shift at the open/close boundary — `box-sizing:
   border-box` on the panel (verify current value) or animating only `transform` (border is inside the
   transformed box) keeps it off the content reflow path.

4. **Reduced-motion (AC6).** Do NOT add a panel-specific reduced-motion rule unless needed — the global
   block (`styles.css:1544-1553`) already reduces `transition-duration` for `*`, covering the new
   `transform`. Confirm by inspection. If approach (a-i)'s JS relies on `transitionend`, the 0.01ms (not
   `none`) value guarantees the event still fires under reduced motion — preserve that behavior.

### Prong B — Shields content-population timing, `renderer.js`

The goal: populate Shields content **before** the slide starts and prevent the async cookie re-render from
reflowing mid-slide. The Media path stays as-is.

5. **Populate before the slide, in `togglePrivacy()` (`renderer.js:1785-1803`).** Today on open the order
   is: flip `.collapsed` off (`:1788`) → `togglePanel(false)` → `fetchCookies()` → `renderPrivacy()`.
   Because `renderPrivacy()` **early-returns while `.collapsed`** (`:2311`), the current code flips the
   class first so the render runs — which is exactly why the rebuild lands as the slide begins. Invert the
   ordering so the heavy DOM build happens before the panel is visually sliding in:
   - Populate `#privacy-body` while the panel is laid out at `--panel-w` but still translated off-screen
     (i.e. before removing `.collapsed`, or during the pre-paint frame of approach (a-i) where the box has
     width but the transform hasn't started). Practically: build the content first, then trigger the
     transform-in on the next frame (`requestAnimationFrame`).
   - **Pin the Prong A ↔ Prong B handoff (design-review cycle-2 [low]).** `slidePanel(el, true)` is what
     removes `.collapsed` on its rAF; the populate MUST complete in the pre-paint window (width set,
     `.collapsed` still present) *before* that rAF fires. Make the contract explicit in code — e.g.
     `slidePanel(el, true, { beforeReveal })` runs a pre-paint callback between the width-write and the
     rAF class-removal, and the privacy open path passes `populatePrivacy` as `beforeReveal`; OR the open
     path populates synchronously between `slidePanel`'s width-write and its class-removal. Do NOT call
     populate *after* `slidePanel` has already removed `.collapsed` (that reintroduces the mid-slide
     rebuild this leg exists to remove).
   - This requires the populate to run even though `.collapsed` is still present. Options: (i) relax the
     `renderPrivacy()` early-return so a caller can force a populate while collapsed (e.g. an internal
     `force`/`populate` flag, or split out a `populatePrivacy()` that does the build and let the
     `.collapsed` guard only gate the *event-driven* re-renders); or (ii) in `togglePrivacy()`, set the
     open layout state (width present, off-screen) before calling `renderPrivacy()`. **Keep the guard's
     intent intact for the other callers** — net/permission/shields-config events should still no-op when
     the panel is genuinely closed (AC9). The cleanest shape is a small `populatePrivacy()` the open path
     calls directly, while the `.collapsed` early-return continues to gate the event-driven `renderPrivacy()`
     calls.
6. **Settle/defer the cookie re-render (`fetchCookies`, `renderer.js:1867-1876`; AC8).** `fetchCookies()`
   awaits an IPC round-trip then calls `renderPrivacy()` again (`:1872`) — landing mid-slide as the
   "Loading…" → count swap. Prevent the mid-slide reflow by one of:
   - **Defer:** don't call `fetchCookies()` synchronously in the open path; schedule it after the slide
     completes (e.g. after the open `transitionend`, or via `requestAnimationFrame` chained past the
     transition duration), so its re-render lands once the panel is at rest. The first paint shows
     "Loading…" already in place (populated by step 5), and the count swaps in after the slide — no
     mid-slide layout jump. **Preferred** — simplest, and the cookie count is non-critical to first paint.
   - **Patch deltas instead of full rebuild:** have the cookie re-render update *only* the Cookies
     section's text/list (`renderer.js:2352-2363`) in place rather than `renderPrivacy()`'s full
     `innerHTML=''` rebuild. More surgical but a larger change; acceptable as an alternative or complement.
   - Whichever path: the **full `innerHTML` rebuild must not run during the slide**. Defer is the minimal
     correct change; the delta-patch is the more thorough one. Pick defer unless a delta-patch is trivial.
7. **Leave the Media path (`togglePanel`, `:1208-1225`) functionally unchanged** beyond sharing whatever
   transform/width-swap mechanism Prong A introduces (it already has no content rebuild, so it needs no
   Prong-B work). Verify both toggles still mutually-close (`togglePanel(false)` in `togglePrivacy`,
   `closePrivacyPanel()`/`togglePanel(false)` paths) and the focus/aria/Escape behavior is untouched.

### Sequencing

Do Prong A first (CSS) and HAT-confirm Media is still smooth (it should be — it was already smooth).
Then do Prong B and HAT-confirm Shields matches Media. This isolates which prong any residual glitch
comes from, mirroring the planning-time HAT diagnosis.

## Edge Cases

- **`renderPrivacy()` collapsed early-return (`:2311`) is load-bearing.** It currently prevents wasted
  rebuilds when events fire while the panel is closed. If you relax it for the pre-slide populate, ensure
  the *event-driven* callers (net/permission/shields-config/tab-nav) still skip rebuilding when the panel
  is genuinely closed — otherwise you reintroduce background churn. Prefer a dedicated populate entry
  point over weakening the shared guard.
- **`transitionend` not firing.** If approach (a-i) hangs the width-collapse on `transitionend` and the
  event never fires (e.g. the transform value didn't actually change, or the element is `display:none`),
  the box won't release. Guard with a fallback timeout, or ensure the transform value always changes on
  close. Under reduced-motion the 0.01ms duration still fires `transitionend` (preserve that).
- **Rapid open/close (toggle spam).** Toggling faster than the 0.18s transition must not strand the panel
  mid-slide or leave width/transform inconsistent. The class-driven approach self-corrects (the latest
  class flip wins); if you sequence with `transitionend`, debounce or key the width-swap to the current
  intended state, not the stale one.
- **Mutual exclusion timing.** Opening Shields calls `togglePanel(false)` to close Media (and vice-versa).
  Ensure the closing panel's transform-out and the opening panel's transform-in don't fight for the
  shared right-edge slot visually (they're separate elements, so this is mostly fine, but verify no double
  border or 1px shift appears during the cross-fade).
- **First-ever open with no cookie data.** The Cookies section shows "Loading…" (`:2354`) until
  `tab.privacy.cookies` is set. With the deferred fetch (step 6), first paint shows "Loading…" placed
  correctly and the count swaps in after the slide. The "Loading…" → "N first-party · M third-party" text
  swap is single-line-to-single-line (no height change), **but** the post-fetch render can also populate
  the cookie `pList` (up to ~50 rows, `renderer.js:2361-2362`), which **will** grow the panel height —
  after the slide, at rest. This is acceptable (the panel is no longer sliding); **do NOT try to
  pre-reserve list height** to avoid it (design-review [low]).
- **Reduced-motion + JS sequencing.** With motion reduced, the slide is ~instant; the populate-before-slide
  ordering still applies (it just isn't visible). Don't gate the populate on a non-reduced animation.
- **Internal/no-wcId tabs.** `fetchCookies()` early-returns when `tab.wcId == null` (`:1869`); the panel
  still opens and renders other sections. Deferring the fetch must not break this no-op path.

## Files Affected

- `src/renderer/styles.css` — Prong A: `#media-panel` (`:606-621`) and `#privacy-panel` (`:1028-1043`)
  rules + their `.collapsed` rules reworked from `width`/`margin-right` transitions to a `transform` slide
  with a non-transitioned discrete width swap; `border-left: none` on collapsed preserved. Reduced-motion
  block (`:1539-1553`) left unchanged (confirmed to cover `transform`).
- `src/renderer/renderer.js` — Prong A: a shared `slidePanel(el, show)` helper that all collapse/expand
  call sites route through — `togglePanel()` (`:1208`), `togglePrivacy()` (`:1785`), **`closePrivacyPanel()`
  (`:1777-1783`)**, and the two mutual-close calls (`togglePanel(false)` at `:1792`, `closePrivacyPanel()`
  at `:1215`) — owning the width-write / reflow-read / class-flip / guarded-`transitionend`-width-release
  (AC11). Prong B: `togglePrivacy()` open path reordered to populate before the slide; `renderPrivacy()`
  (`:2309`) gets a populate-while-collapsed entry point (or a split `populatePrivacy()`); `fetchCookies()`
  (`:1867`) re-render deferred past the slide (and/or delta-patch the Cookies section).

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified (AC1-AC6, AC9, AC10 by code inspection + suite/typecheck/lint;
  AC5/AC7/AC8 visual smoothness deferred to the `hat-and-alignment` leg's HAT pass per the flight)
- [ ] `npm test`, `npm run typecheck`, `npm run lint` pass; `npm run a11y` 0 new chrome-sweep violations
  (or deferred to HAT leg with a note if the a11y apparatus isn't available autonomously)
- [ ] Update flight-log.md with leg progress entry (note which #27-mechanism option (a-i)/(a-ii) was
  chosen, and whether any Divert/descope was needed)
- [ ] Set this leg's status to `completed` (in this file's header)
- [ ] Check off this leg in flight.md
- [ ] Not the final leg of the flight (leg 1 of 6) — flight-level review + commit deferred per
  `/agentic-workflow`

---

## Citation Audit

All code-location citations verified against current `main` @ `56dda8d` at leg design time. **1 drifted
(repaired), 0 gone.**

- **`drifted` (repaired):** `togglePanel` cited in the flight/prompt at `renderer.js:1209` is actually at
  **`renderer.js:1208`** (off by one) — corrected throughout this leg.
- **OK (verified):**
  - `styles.css:606-616` `#media-panel` (`width: var(--panel-w)` + `transition: width 0.18s, margin-right
    0.18s`), `:617-621` `.collapsed { width:0; overflow:hidden; border-left:none }`.
  - `styles.css:1028-1037` `#privacy-panel` (identical transition; the flight's DD1 `[low]` fix already
    corrected the range to `:1028-1043`), `:1039-1043` `.collapsed`. Border-left removal at `:620`/`:1042`.
  - `styles.css:532` `#webviews { flex:1 }`; `:526-531` `#main { flex:1; display:flex; position:relative }`;
    `:11` `--panel-w: 360px`.
  - `styles.css:1539-1553` reduced-motion block (global `*` duration override; the flight cites `:1540`
    for the `@media` line — the block body is `:1544-1553`).
  - `renderer.js:1785-1803` `togglePrivacy` (open path calls `fetchCookies()` `:1793` + `renderPrivacy()`
    `:1794`); `:1208-1225` `togglePanel`; `:2309-2388` `renderPrivacy` (collapsed early-return `:2311`;
    `innerHTML=''` `:2316`; Cookies "Loading…" `:2354`); `:1867-1876` `fetchCookies` (re-render `:1872`).
  - `index.html:117` `#main`, `:118` `#webviews`, `:138` `#media-panel.collapsed`, `:181`
    `#privacy-panel.collapsed`. `els` map: `panel:25`, `privacyPanel:45`, `privacyBody:46`.
  - `package.json` scripts: `test` (node --test), `typecheck`, `lint`, `a11y` (`scripts/a11y-audit.mjs`).

**Drift note for the implementing agent:** the `margin-right 0.18s` transition on both panels is
**vestigial** — no rule sets a non-zero `margin-right`, so removing it is pure cleanup (it was likely a
leftover from an earlier slide approach). This is not a behavior change.
