# Leg: aa-semantics

**Status**: completed
**Flight**: [Accessibility — Keyboard & Screen-Reader Baseline](../flight.md)

## Objective
Close the WCAG 2.1 AA *semantics* gaps (F24a): announce dynamic updates via live regions, make the lightbox a proper focus-trapping modal dialog with focus restore, give the container menu and side panels Escape + focus management, label the address bar, and add toolbar/complementary landmarks and panel headings.

## Context
- Flight **F24a** scope: live regions on toasts + media-empty; `role="dialog"` + focus trap + Escape on the lightbox; Escape + focus management on the container menu and the media/privacy panels; `aria-label` on the address bar; toolbar/landmark roles + real headings. Audited via axe `landmark-*`/`heading-order`/`aria-*` (the leg-2 harness, run at verify).
- **Modal vs non-modal**: the lightbox is a **modal** dialog → focus trap + `aria-modal="true"` + focus restore on close. The container menu and side panels are **non-modal** → move focus in on open, Escape closes + restores focus, but **no focus trap** (they sit alongside live content).
- **DD4**: renderer `@ts-check`'d, `sourceType:"script"` — cast `document.activeElement` (`Element|null`) when storing/restoring focus. Offline gates must stay clean.
- **axe gate = WCAG A/AA tags, NOT axe's full default (flight-level clarification — see DD3 update).** axe's default rule set includes **best-practice** rules that assume a *document*, not an app shell — `region` (all content in a landmark), `landmark-one-main`, `page-has-heading-one`. A browser-chrome UI legitimately has no `<main>`, no `<h1>`, and content outside landmarks. So the axe gate (per-checkpoint subsets **and** the verify full sweep) runs `--tags=wcag2a,wcag2aa,wcag21a,wcag21aa` (+ the `nested-interactive` exclusion), **not** the full default. Best-practice rules (`heading-order`, `landmark-unique`, `region`, …) run **advisory** at verify (reviewed, not hard-gated).
- **What axe actually verifies for F24a is narrow.** axe (WCAG tags) checks the *validity/naming* of the new ARIA — `aria-dialog-name` (the lightbox has a name), `aria-allowed-attr`/`aria-valid-attr-value`/`aria-required-attr`/`aria-roles` (toolbar/status/dialog/live attrs are valid), and the address-bar input name. It does **not** verify live-region *announcement*, focus trap, Escape, or focus restore (4.1.3 status messages + focus management aren't statically detectable) — those are verified **behaviorally at `verify-a11y`** (and by the `tab-keyboard-operability`-style manual a11y pass), not by axe. The leg's ACs reflect this split.
- Headings: keep `<h2>`s in order; the chrome has no `<h1>` (fine under the WCAG tag set; `page-has-heading-one` is best-practice/advisory). Labeled `<aside>` complementary landmarks each get a *unique* `aria-label`.
- Leg 3 of 5. Legs 1 (`tab-strip-a11y`) + 2 (`control-names-and-focus`) are done/uncommitted. Citations re-located against current `main` after leg 2.

## Inputs
- `src/renderer/index.html` — `#tabstrip` (`:14`), `#container-menu` (`:26`), `#toolbar` (`:29`), `#address` (`:35`), `#main` (`:46`), `#media-panel` aside (`:49`), `#media-panel-header` + "Media on this page" span (`:50-51`), `#media-list` (`:72`), `#media-empty` (`:73`), `#privacy-panel` aside (`:92`), `#privacy-header` + "Privacy on this page" span (`:93-94`), `#toasts` (`:105`), `#lightbox` (`:108`).
- `src/renderer/renderer.js` — `openContainerMenu` (`:88-115`), `closeContainerMenu` (`:117`), `togglePanel` (`:414`), `renderMedia` media-empty toggle (~`:456`), `openLightbox` (`:624`), `closeLightbox` (`:639`), the lightbox `keydown` with `Escape` + zoom keys `+`/`-`/`0` (`:693-699`), `closePrivacyPanel` (`:919`), `togglePrivacy` (`:924`), `toast` (`:1280`). `els` cache (top of file) has `lightboxClose`, `mediaClose`, `privacyClose`, `mediaEmpty`, `toggleMedia`, `togglePrivacy`, `newTabMenu`, `containerMenu`, `panel`, `privacyPanel`, `lightbox` (add `mediaStatus`).
- `src/renderer/styles.css` — panel header rules (`#media-panel-header`, `#privacy-header`), `.hidden { display:none }`.

## Outputs
- Dynamic toasts and the media-empty state are announced by AT; the lightbox traps focus and restores it on close; the container menu + panels are keyboard-dismissible with managed focus; the address bar, toolbar, panels, and panel titles are properly named/structured.
- Offline gates green; the F24a axe rule subset (`landmark-*`/`heading-order`/`aria-*`) is designed to pass (verified live at `verify-a11y`).

## Acceptance Criteria
- [x] `#toasts` (`index.html:105`) is a live region: `role="status"` + `aria-live="polite"` (+ `aria-atomic="false"`), so appended download/error toasts are announced. (It's always in the DOM and visible, so injected toast content mutates a live region — announces reliably.)
- [x] A dedicated **always-present, visually-hidden** media status region exists (e.g. `<div id="media-status" class="sr-only" role="status" aria-live="polite">`) and `renderMedia` writes its text on change ("No media on this page" when empty, "N media items" otherwise). **Rationale:** `#media-empty` is toggled via `.hidden` (`display:none`) with constant text — un-hiding a `display:none` region does **not** reliably announce (a live region speaks on content mutation while present, not on visibility change). The dedicated `sr-only` region is the reliable pattern; `#media-empty` stays as the *visual-only* empty cue (no `role="status"` on it). Add a `.sr-only` utility class to `styles.css`.
- [x] The lightbox (`index.html:108`) has `role="dialog"`, `aria-modal="true"`, and an accessible name (`aria-label="Image viewer"`).
- [x] `openLightbox` stores the previously-focused element, then moves focus into the dialog (e.g. `els.lightboxClose`); `closeLightbox` restores focus to the stored element. While open, **focus is trapped** within the lightbox (Tab/Shift+Tab cycle among its focusable controls; focus cannot leave to the page behind). Escape still closes (existing handler).
- [x] The container menu is keyboard-managed: `openContainerMenu` moves focus to its first item; pressing `Escape` while it is open closes it and restores focus to `#new-tab-menu`. (No `role="menu"` is added — the items are real `<button>`s; adding a menu role without full arrow-key menu semantics would be worse. Documented choice.)
- [x] The media and privacy panels are keyboard-managed (non-modal): opening either moves focus into the panel (its close button); pressing `Escape` while focus is within the panel closes it and restores focus to the corresponding toggle (`#toggle-media` / `#toggle-privacy`). No focus trap (non-modal).
- [x] `#address` (`index.html:35`) has `aria-label="Address and search bar"`.
- [x] Each side panel `<aside>` has a unique `aria-label` (`#media-panel`→"Media panel", `#privacy-panel`→"Privacy panel"). (**`role="toolbar"` is NOT added** to `#toolbar` — the `toolbar` role carries a WAI-ARIA arrow-key navigation expectation we're not implementing, the same half-measure declined for `role="menu"` above; the toolbar's controls are already individually Tab-focusable and labeled from leg 2, which is sufficient.)
- [x] The panel titles "Media on this page" (`:51`) and "Privacy on this page" (`:94`) are real `<h2>` headings (with CSS so they don't disrupt the existing header layout).
- [x] `npm test` (147 pass), `npm run typecheck` (0 errors), `npm run lint` (0 problems) all clean.
- [ ] **Deferred to `verify-a11y`** (noted, not run here): the WCAG-tag axe run (`npm run a11y -- --tags=wcag2a,wcag2aa,wcag21a,wcag21aa`) showing the new ARIA is valid + named (dialog/toolbar-less/status/live/address-input); and the **behavioral** checks axe can't do — live-region announcement (toasts + media-status), lightbox focus trap + restore, container-menu/panel Escape + focus management.

## Verification Steps
- `grep -n 'role="status"\|aria-live' src/renderer/index.html` → on `#toasts` and `#media-empty`.
- `grep -n 'role="dialog"\|aria-modal' src/renderer/index.html` → on `#lightbox`.
- `grep -n 'role="toolbar"\|aria-label="Media panel"\|aria-label="Privacy panel"\|aria-label="Address and search bar"' src/renderer/index.html` → landmarks/labels present.
- `grep -n '<h2' src/renderer/index.html` → panel titles are headings.
- `grep -n 'lbReturnFocus\|restoreFocus\|focus()' src/renderer/renderer.js` → focus save/restore in lightbox open/close; focus-in on menu/panel open.
- `grep -n "Escape" src/renderer/renderer.js` → Escape handling for container menu + panels (in addition to the existing lightbox one).
- `npm run typecheck` → 0 errors; `npm run lint` → exit 0; `npm test` → 147 pass.
- Deferred to `verify-a11y`: `npm run a11y` F24a subset (landmark/heading/aria rules clean).

## Implementation Guidance

1. **Live regions** —
   - `index.html` `#toasts` (`:105`): `<div id="toasts" role="status" aria-live="polite" aria-atomic="false"></div>`.
   - `index.html`: add a dedicated visually-hidden region, e.g. right after `#toasts`: `<div id="media-status" class="sr-only" role="status" aria-live="polite"></div>`. Add an `els.mediaStatus` entry to the `els` cache.
   - `styles.css`: add an `.sr-only` utility (`position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; border:0;`).
   - `renderer.js` `renderMedia` (where `#media-empty` is toggled, ~`:456`): set `els.mediaStatus.textContent = filtered.length ? \`${filtered.length} media item${filtered.length === 1 ? '' : 's'}\` : 'No media on this page';`. Keep `#media-empty` as the visual cue (do **not** put `role="status"` on it — `display:none` un-hiding doesn't announce).
   - Leave `aria-live` off the high-churn `#media-count`. For download toasts, `aria-live="polite"` coalesces rapid progress updates; if it proves chatty, mark the live progress `.bar`/`.dl-name` nodes `aria-hidden="true"` (acceptable variation).

2. **Lightbox dialog (`index.html:108`)** — `<div id="lightbox" class="hidden" role="dialog" aria-modal="true" aria-label="Image viewer">`.

3. **Lightbox focus management (`renderer.js`)** — add a module-scoped `let lbReturnFocus = null;`.
   - In `openLightbox` (`:624`), before showing: `lbReturnFocus = /** @type {HTMLElement|null} */ (document.activeElement);` and after removing `.hidden`: `els.lightboxClose.focus();`.
   - In `closeLightbox` (`:639`), after hiding: `if (lbReturnFocus) lbReturnFocus.focus(); lbReturnFocus = null;`.
   - **Focus trap**: the existing lightbox `keydown` handler is at `:693-699` and is an if/else-if chain handling `Escape` **and** the zoom keys `+`/`=`/`-`/`0` (gated on `!els.lightbox.classList.contains('hidden')`) — **preserve those branches**; add a `Tab` branch as another `else if`. Collect `const f = els.lightbox.querySelectorAll('button')` (the four toolbar controls, `index.html:112-116`). Trap logic must also handle focus **outside** the button set (clicking the image/backdrop blurs to `<body>`): if `document.activeElement` is not among `f`, pull focus to `f[0]` (or `f[f.length-1]` on Shift+Tab) and `preventDefault()`; otherwise wrap at the boundaries (Tab past last → first; Shift+Tab past first → last) with `preventDefault()`.

   > **Register listeners ONCE, at module scope — not inside the open functions.** `openContainerMenu`/`togglePanel`/`togglePrivacy` run on every open, so a `keydown` listener added *inside* them stacks duplicates. Put only the `.focus()` calls in the open paths; register the Escape `keydown` listeners once near the existing `els.lightboxClose`/`els.mediaClose`/`els.privacyClose` listener block (~`:421-422`, `:645`, `:936-937`).

4. **Container menu (`renderer.js`)** — in `openContainerMenu` (`:88`), after `m.classList.remove('hidden')` (`:115` area): focus the first item — `const first = /** @type {HTMLElement|null} */ (m.querySelector('.cm-item')); if (first) first.focus();`. Register **once** a `keydown` on `els.containerMenu` for `Escape` → `closeContainerMenu(); els.newTabMenu.focus();`. (The existing document-click close stays. `openContainerMenu` rebuilds `innerHTML` each open, so `querySelector('.cm-item')` resolves the fresh first item.)

5. **Panels Escape + focus (`renderer.js`)** —
   - In `togglePanel` (`:414`), **only when actually opening** (guard on the computed `show` being truthy — note `togglePanel` is also called as `togglePanel(false)` by `togglePrivacy` and at init, which must NOT grab focus): `els.mediaClose.focus();`.
   - In `togglePrivacy` (`:924`), only when opening: `els.privacyClose.focus();`.
   - Register **once** at module scope: a `keydown` on `els.panel` for `Escape` → `togglePanel(false); els.toggleMedia.focus();`; a `keydown` on `els.privacyPanel` for `Escape` → `togglePrivacy(false); els.togglePrivacy.focus();`.
   - Non-modal: do not trap focus in the panels.

6. **Address bar + landmarks (`index.html`)** — `#address` (`:35`): add `aria-label="Address and search bar"`. `#media-panel` (`:49`): add `aria-label="Media panel"`. `#privacy-panel` (`:92`): add `aria-label="Privacy panel"`. (Do **not** add `role="toolbar"` to `#toolbar` — see AC rationale.)

7. **Headings (`index.html` + `styles.css`)** — change the title spans to headings: `:51` → `<h2>Media on this page</h2>`, `:94` → `<h2>Privacy on this page</h2>`. In `styles.css`, neutralize default `<h2>` chrome inside the headers so layout is unchanged: `#media-panel-header h2, #privacy-header h2 { margin: 0; font-size: inherit; font-weight: inherit; }` (the header divs already set `font-weight:600`).

## Edge Cases
- **Lightbox trap with one focusable**: if only the close button is present at some moment, Tab wrapping is a no-op on itself — acceptable.
- **Escape priority**: the lightbox keydown is on `document` and gated on lightbox-visible; the new panel/menu Escape handlers are on their own elements and only fire when focus is within them — no conflict with the lightbox handler or the global shortcuts handler (`:1336`, which early-returns without a modifier).
- **Focus restore when the trigger is gone**: if the element stored in `lbReturnFocus` was removed (e.g. a media card re-rendered), `.focus()` is a harmless no-op; guard with the null check.
- **`@ts-check`**: cast `document.activeElement` to `HTMLElement|null` before storing; `querySelector('.cm-item')`/`querySelector('button')` return `Element|null`/NodeList — cast to `HTMLElement` for `.focus()`.
- **Heading semantics**: two `<h2>`s with no `<h1>` is fine under the WCAG tag set (`page-has-heading-one` is best-practice/advisory); do not add a synthetic `<h1>`.
- **`window.prompt` in `addContainer` (`renderer.js:122`)**: a native browser dialog — inherently accessible, intentionally out of scope (no custom focus/ARIA work needed).
- **Duplicate listeners**: the single biggest implementation hazard here — see the callout under item 3. Verify with `grep -c "els.panel.addEventListener('keydown'" → should be 1`.

## Files Affected
- `src/renderer/index.html` — live-region attrs on `#toasts`; new `#media-status` sr-only live region; `role="dialog"`/`aria-modal`/`aria-label` on `#lightbox`; `aria-label` on `#address`; `aria-label` on both `<aside>` panels; title spans → `<h2>`. (No `role="toolbar"`.)
- `src/renderer/renderer.js` — `els.mediaStatus` cache entry + `renderMedia` status text; lightbox focus save/restore + trap (incl. focus-outside-buttons case); container-menu focus-in + Escape (listener once); panel focus-in (guarded on open) + Escape (listeners once, media + privacy).
- `src/renderer/styles.css` — `.sr-only` utility; `<h2>` reset within panel headers.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified (offline; axe F24a subset deferred to verify)
- [x] Tests passing (`npm test` + `npm run typecheck` + `npm run lint`)
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `completed`
- [ ] Check off this leg in flight.md
- [x] (Not the final leg — no flight-level status change)
- [ ] Commit handled at the deferred flight-level review/commit

## Citation Audit
Citations re-located against current `main` after leg 2 and verified `OK`: `index.html:14,26,29,35,46,49,50-51,72,73,92,93-94,105,108`; `renderer.js:88-115` (openContainerMenu), `:117` (closeContainerMenu), `:414` (togglePanel), `~:456` (renderMedia media-empty toggle), `:624` (openLightbox), `:639` (closeLightbox), `:693-699` (lightbox keydown — Escape **+ zoom keys `+`/`-`/`0`**, corrected from `:693-695` in design review), `:919` (closePrivacyPanel), `:924` (togglePrivacy), `:1280` (toast), `:1336` (global shortcuts keydown). All `OK`. Lightbox focusable controls confirmed at `index.html:112-116` (four `<button>`s).
