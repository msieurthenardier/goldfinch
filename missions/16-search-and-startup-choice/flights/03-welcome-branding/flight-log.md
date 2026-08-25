# Flight Log: Welcome Branding and Alignment

**Flight**: [Welcome Branding and Alignment](flight.md)

## Reconnaissance Report

Source: the Flight 2 debrief (`../02-welcome-surface/flight-debrief.md`, 2026-08-25) — the items it routed to Flight 3, walked against `main` at `bb053d3`.

| Item | Classification | Evidence | Recommendation |
|------|----------------|----------|----------------|
| Settings Clear buttons unstyled | `confirmed-live` | `src/renderer/pages/settings.css` has rules for `#home-page-save` and `.settings-btn` but none for `#home-page-clear` or `#search-engine-clear`; `settings.html:45`, `:59` carry no class | Fix in leg 1 (DD3) |
| Welcome page visually underwhelming | `confirmed-live` | `src/renderer/styles.css` welcome block comment: "Presentable and unstyled — Flight 3 owns the visual language"; no brand mark on the surface | Leg 1 first pass (DD1), HAT (leg 2) |
| Burner note as a first-class element | `confirmed-live` | `welcome-controller.js` builds `#welcome-burner-note` with `className = 'muted hidden'` — 13 px dim prose | Leg 1 (DD4) |
| Layout constraints (full-bleed under `#webviews`, `.hidden` toggling) | `confirmed-live` (constraint, not work) | `styles.css` `#welcome-surface { position: absolute; inset: 0 }`; blocks toggled by `classList.toggle('hidden', …)` in `render()` | Carried as DD2/DD6 |
| Behavior row: home-first-then-engine on a both-unset tab | `confirmed-live` (premise corrected) | No spec row exercises it — `welcome-first-launch` steps 4–6 choose the engine first; `submitHome` attaches unconditionally (`welcome-controller.js` `submitHome`). The F2 debrief's claim that "the next new tab will offer it again" does not hold: `tab-controller.js` `openNewTab` — `if (home != null) return createTab(home, container)` — never reaches the welcome path once a home page is set; the abandoned choice returns only via `navigation-controller.js` `handoffSearch` | New spec `welcome-home-first` in leg 1, authored to the real mechanism |
| Behavior row: burner welcome shows the app-wide note | `already-satisfied` | `tests/behavior/welcome-home-routing.md` step 5 — Expected Result "The burner tab is a welcome tab carrying the burner note ("saved for all of Goldfinch") in the burner jar"; passed on run `2026-08-25-02-45-35` (10/10) | Retire as new work; keep the spec in the leg-1 re-run net (its row will exercise the DD4 restyle) |

*(runtime decisions recorded here during execution)*

---

### Flight Director Notes

**2026-08-25 — Flight designed.** Operator direction at the interview: branded & minimal; first-pass leg plus a HAT leg; author the debrief's behavior rows in leg 1. Recon retired one of the two rows (burner note — already asserted by `welcome-home-routing` step 5). Spec `welcome-home-first` drafted with the flight.

**2026-08-25 — Flight design review: 1 cycle, needs rework → fixed; second pass scoped to the rewritten spec.** **[high]** the draft `welcome-home-first` steps 3–5 asserted that Ctrl+T after a home-first Set re-offers the engine block — a category-level trace; the value-level trace (`openNewTab` returns `createTab(home, container)` the moment `currentHomePage()` is non-null, which the synchronous `chrome-welcome-set` broadcast guarantees before the next action) shows a plain home-page tab, with the abandoned choice returning only through `handoffSearch`. Rewritten: step 3 pins the plain tab (engine still `null`), step 4 the handoff to a new welcome tab with the pending query and no provider URL (diffed `enumerateTabs`), step 5 the choice running the search in place. The Flight 2 debrief's contrary sentence is annotated in this flight's Contributing section rather than rewritten. **[medium]** DD1 now forbids `display:none`/`visibility:hidden` on the native radios (AT-safe hiding only) and adds `role="radiogroup"` to `#welcome-engine-options`. **[low]** DD3 states the explicit `margin-left` `#home-page-clear` needs (the Save gap is Save's own rule, not `.settings-btn`'s); DD7 corrected to one line of headroom. Confirmed sound: the DD2 id list is verbatim-complete against the controller; the asset reuse is CSP-safe (`img-src 'self'`); DD6's anti-white-flash citation; DD8 matches the HAT rules and ~40 prior HAT legs; leg 1 is low-risk by the tiering. Suggestion carried as a follow-up: add the welcome surface to `scripts/a11y-audit.mjs`'s audited states after the HAT settles the design.

**2026-08-25 — Flight design review, second pass (scoped to the rewrite): approve with changes → applied.** All four rewritten rows traced TRUE at the value level (row 2 same-tab attach with `searchEngine` untouched; row 3 `openNewTab` → `createTab(home, container)`, plain tab; row 4 `toUrl` null → `handoffSearch` → `openWelcomeTab({reasons:['search'], pendingQuery})` beside the untouched tab, heading string exact, no `attachView`; row 5 `submitEngine` → `attachView(tab, buildSearchUrl(…))` on the same tab). **[medium]** row 4's "tab count +1 … diff the full tab list" conflated two apparatuses that disagree: `enumerateTabs` filters `wcId !== number` so the viewless welcome tab is absent until it attaches — the row now says strip count +1 from the chrome DOM and, separately, no new `enumerateTabs` entry. Confirmed: DD1's AT-safe constraint is correct for Chromium's tree; the radiogroup addition cannot regress any spec's a11y read; DD3's margin note and DD7's budget figure are accurate. Flight status → `ready` on operator approval.
