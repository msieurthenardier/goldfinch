# Flight: Welcome Branding and Alignment

**Status**: landed
**Mission**: [Search and Startup Choice](../../mission.md)

## Contributing to Criteria

- [x] When a preference is needed but unset, the user arrives at a **branded** Goldfinch page offering to set exactly the missing one. *(this flight: the branded half — Flight 2 delivered the functional surface)*
- [x] Mission open question — Branding: what the branded page actually looks like → resolved by the HAT session in this flight
- [x] Flight 2 debrief, operator feedback — Settings Clear buttons render as bare UA buttons (no CSS rule); the welcome page is functionally right but visually underwhelming
- [x] Flight 2 debrief, Recommendation 2a — the home-first-then-engine order on a both-unset tab is reasoned about, never observed → `welcome-home-first` spec (leg 1). **Correction at design review**: the debrief's Architect note that "the next new tab will offer it again" is wrong — `openNewTab()` returns a plain home-page tab once a home page is set; the abandoned engine choice returns only through the search handoff. The spec pins the real mechanism.
- [x] Flight 2 debrief, Recommendation 2b — the burner welcome path shows the app-wide note → **already covered**: `tests/behavior/welcome-home-routing.md` step 5 asserts "the burner tab is a welcome tab carrying the burner note"; passed on the 2026-08-25 run. Kept as a re-run in this flight's regression net, not re-authored.
- [x] Flight 2 debrief — `#welcome-burner-note` is the surface's only mitigation for the burner mental-model mismatch and is muted prose; make it a first-class element

---

## Pre-Flight

### Objective

Give the welcome surface its visual identity and let the operator align it by hand. Leg 1 ships a first pass — branded and minimal: the Goldfinch mark, a one-line welcome, the two choices as cards, the engine chooser as a compact grid — on the existing dark tokens with the brand gold as accent, styles the two Settings Clear buttons as secondary buttons, and promotes the burner note to a visible notice; it changes CSS and adds wrapper DOM only, with the surface's DOM contract (every id, class hook, and `.hidden` toggle the specs and structural tests read) pinned by a test so the restyle cannot break Flight 2's behavior. Leg 2 is the HAT: the operator walks the surface in every state on their own build and iterates live until satisfied. The mission's last open question — what the branded page looks like — closes in that session.

### Open Questions

- [x] What visual direction? → **DD1** (operator, 2026-08-25): branded & minimal — mark + one line, choices as cards, compact engine chooser, brand gold on the dark tokens.
- [x] Does the restyle need a DOM harness or snapshot tests to be safe? → **DD2/DD5**: no — the DOM contract is pinned by a grep-shape structural test, Flight 2's behavior specs re-run as the regression net, and the visual judgment is the HAT's job. Snapshot baselines are never committed in this repo.
- [x] Secondary or primary styling for Clear? → **DD3**: secondary. A gold Clear beside a gold Save reads as two equal calls to action; Clear is the reversible, lesser one.
- [x] Do the engine descriptions stay visible? → **DD1**: yes, compact. A privacy browser's engine list is credible because it explains the privacy-first options; hiding the copy behind a tooltip would lose that. The grid makes eight visible descriptions fit.
- [x] Everything the operator wants changed after seeing it → the HAT leg, by design. *(Resolved 2026-08-26: six changes made and signed off across states A–H — see the flight log; two of them, the engine block staying visible and Set saving-and-staying, were behavior changes taken through scoped design reviews and pivoted Flight 2's DD7.)*

### Design Decisions

**DD1 — Visual language: branded & minimal, on the existing tokens.** A centered column (max-width ~600 px) under the toolbar: the Goldfinch mark (`src/renderer/assets/goldfinch_color.png` — the same asset `#brand` in `index.html:64` already loads from the chrome's `file://` origin; no new asset route needed), `h2` "Welcome to Goldfinch", one muted line beneath it, then the home-page card and the engine card. The engine chooser becomes a two-column grid of radio-cards (each still a real `<input type="radio">` with its `<label>`, so a11y checked-state and the specs' radio reads are unchanged — **the native radio must stay in the accessibility tree**: visible, or hidden only by an AT-safe technique such as `opacity: 0` positioned over the card; never `display: none` / `visibility: hidden`, which drop it from `readAxTree`), label bold, description compact and muted. `#welcome-engine-options` gains `role="radiogroup"` with `aria-labelledby="welcome-engine-heading"` while the wrapper is being touched (pre-existing gap, cheap here). Accent: `--accent` (#f5c518) for the primary Set button, focus rings, and the selected radio-card border; everything else on `--bg/--bg-2/--bg-3/--fg/--fg-dim/--border`. Dark-only, like the rest of the chrome — a light theme is not this mission's work. Rationale: the mission calls the page "branded"; the tokens and the mark exist; a first pass on them gives the HAT something concrete to react to without inventing a palette.

**DD2 — The DOM contract is frozen; the restyle is CSS plus additive wrapper DOM.** Every id and class the Flight 2 specs, `welcome-controller.js`'s logic, and the structural tests read stays exactly as it is: `#welcome-surface`, `#welcome-heading`, `#welcome-home-block`, `#welcome-home-input`, `#welcome-home-set`, `#welcome-home-status`, `#welcome-burner-note`, `#welcome-engine-block`, `#welcome-engine-heading`, `#welcome-engine-options`, `.welcome-engine-row`, `#welcome-engine-<id>` radios, `#welcome-engine-status`, the `.muted` hint, and `.hidden` as the visibility mechanism on the two blocks and the note. New wrapper elements (a brand header, card containers, the grid) may be added around them; nothing is renamed or removed. `render`/`settle`/`show`/`submitHome`/`submitEngine` are not touched. A grep-shape structural test in `test/unit/search-engines.test.js` (the file that already pins `welcome-controller.js`'s shape) asserts the id set is still created — the restyle cannot silently break a spec. Rationale: the specs and the leg-2 gate fixes are the surface's contract; a HAT that iterates on CSS must never be able to regress behavior.

**DD3 — Settings Clear buttons: a secondary variant of the existing button language.** `settings.css` gains `.settings-btn--secondary` (transparent fill, `1px solid var(--border)`, `--fg` text, `--bg-2` on hover, the same radius/padding/focus ring as `.settings-btn`), and `settings.html` puts `class="settings-btn settings-btn--secondary"` on `#home-page-clear` and `#search-engine-clear` (`settings.html:45`, `:59`). `#home-page-clear` sits beside `#home-page-save` with the same 8 px gap — note `#home-page-save`'s gap comes from its own `margin-left: 8px` rule (`settings.css` `#home-page-save`), not from `.settings-btn`, so `#home-page-clear` needs an explicit `margin-left: 8px` (or the row moves to `.settings-row` flex gap) — the leg must add it, not assume it. No JS change; the buttons' ids and handlers are untouched. A structural test in `test/unit/settings-page-shared-scripts.test.js` asserts both buttons carry the class and the rule exists. Rationale: `.settings-btn` was written to be the reusable shape (its comment says so); a secondary variant is the smallest addition that gives Clear a correct visual weight.

**DD4 — The burner note becomes a visible notice.** `#welcome-burner-note` keeps its id, its `.hidden` toggle, and its text, but drops `.muted` for a notice style: a card-width strip with a `--accent-muted` left border and `--fg` text, placed directly under the heading so it is read before either choice. Rationale: the Flight 2 debrief named it the surface's only mitigation for "a preference set from a burner tab persists app-wide"; muted 13 px prose does not mitigate anything.

**DD5 — Verification apparatus.** Three nets, none of them pixel snapshots: (1) structural tests — the DOM-contract id set (DD2) and the Clear-button class/rule (DD3), grep-shape per the house convention for files without a DOM harness; (2) behavior re-runs — `welcome-first-launch` and `welcome-home-routing` on the restyled build, whose rows read the same ids and a11y states (act: chrome `click`/`typeText`/`evaluate` on the ids; observe: `captureWindow`, `readAxTree`, `evaluate` probes — both axes unchanged from Flight 2 because the ids are unchanged); (3) the new `welcome-home-first` spec, authored with this flight, pinning the home-first order: the immediate attach with the engine left `null`, the plain new tab that follows (no re-offer), and the address-bar handoff that brings the abandoned choice back — negative claims ("no provider URL committed") carried by diffed `enumerateTabs` snapshots, `welcome-search-handoff`'s pattern. The visual judgment itself is the HAT leg. Rationale: snapshot baselines are never committed here, and no DOM harness exists for the chrome; the contract-plus-behavior net catches everything a restyle can break short of "it looks wrong", which is what the operator is there for.

**DD6 — Layout stays a full-bleed child of `#webviews`.** `#welcome-surface` remains `position: absolute; inset: 0; overflow: auto` with an opaque `--bg` background (the anti-white-flash rule at `styles.css` "#webviews" — nothing composites over a welcome tab, so no z-order work). The centered column lives inside it. Rationale: recorded as a Flight 3 constraint in the Flight 2 debrief; the alternative (a floating card over a transparent slot) needs layout work and buys nothing.

**DD7 — Budgets and boundaries.** `renderer.js` is one line under its `RENDERER_LINE_BUDGET` (1649 / 1650, `test/unit/seam-contract.test.js`) — this flight does not touch it. `welcome-controller.js` grows only by wrapper-element creation in its build section; `styles.css` gains a `/* Welcome surface */` block replacing the current 60-line placeholder; `settings.css` gains one variant rule. New image assets, if the HAT asks for one, go in `src/renderer/assets/` (chrome origin) — never `build/` (packaging).

**DD8 — HAT protocol.** Leg 2 follows the agentic-workflow HAT rules: the Flight Director walks the operator through one state at a time on the operator's own dev build (`npm run dev` — no automation surface needed); look-and-feel fixes ride inline (a Developer spawn per fix, structural tests kept green, `welcome-home-first` or the relevant Flight 2 spec re-run only if a fix touches DOM hooks); anything that adds behavior a user would notice as new (a preset list, a "skip" button, an animation with state) is a feature and gets a scoped design review before implementation. Multi-surface fixes (welcome + Settings + chrome) get a lightweight design-review pass first.

### Prerequisites

- [x] Mission 16 active; Flight 2 completed and merged to `main` (`bb053d3`, PR #167); debrief merged
- [x] Squawk turnaround PR #169 merged (crew-file apparatus notes for the behavior re-runs) — recommended before the leg-1 gate, not blocking
- [x] Flight branch `flight/03-welcome-branding` created at flight start
- [x] Automation surface live before the leg-1 behavior runs — decay-prone, probe at run time (`npm run dev:automation` with `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1`)
- [x] Fresh-profile scratch fixture procedure (empty `XDG_CONFIG_HOME`) — proven 2026-08-24/25
- [x] For the HAT: the operator's own dev build running (`npm run dev`), with a scratch profile they are willing to reset to exercise first launch

### Pre-Flight Checklist

- [x] All open questions resolved (the visual verdict is the HAT's by design)
- [x] Design decisions documented
- [x] Prerequisites verified (three are run-time)
- [x] Validation approach defined
- [x] Legs defined (tentative)

---

## In-Flight

### Technical Approach

Two legs. Leg 1 (autonomous) is a single visual slice: the welcome-surface restyle (DD1/DD4/DD6) with its wrapper DOM, the Clear-button secondary variant (DD3), the DOM-contract and Clear-button structural tests (DD2/DD3), and the `welcome-home-first` spec; the Flight Director runs `welcome-home-first` and re-runs `welcome-first-launch` and `welcome-home-routing` at the gate. Leg 2 (HAT) is the alignment session — no autonomous implementation; fixes inline per DD8. The flight lands when the operator says the surface is right.

### Checkpoints

- [x] Leg 1 green: the restyled surface renders in every state (both-unset, home-only, engine-only with and without a pending query, burner) with the brand mark and cards; the Clear buttons are styled as secondary; `npm test` / typecheck / lint green with wall-clock recorded; `welcome-home-first` passes; `welcome-first-launch` and `welcome-home-routing` re-runs pass
- [x] Leg 2 green: the operator has walked every state on their own build and is satisfied; every inline fix has its structural tests green; the mission's branding question is recorded as resolved

### Adaptation Criteria

**Divert if**:
- The restyle cannot be done without renaming or removing a DD2 contract id (a spec row would have to change) — stop and re-plan; the contract is the point
- The HAT asks for behavior that fails DD8's fix-vs-feature gate and the scoped design review says it needs more than a leg (e.g. home-page presets — resolved out of scope at mission level)
- The operator wants a light theme — that is a chrome-wide decision, a separate mission

**Acceptable variations**:
- Card geometry, type scale, spacing, the grid's column count, where the mark sits, copy of the one-line welcome and hints
- Whether the burner notice sits above or below the cards
- Whether the engine radio-cards use the description as a second line or a tooltip-free caption (the description stays visible either way — DD1)

### Legs

> **Note:** Tentative; legs are planned and created one at a time as the flight progresses.

- [x] `first-pass-visual-design` — welcome-surface restyle on the dark tokens with the brand mark, cards, and engine grid (DD1/DD6), burner notice (DD4), Settings Clear secondary variant (DD3), DOM-contract and Clear-button structural tests (DD2/DD3), `welcome-home-first` spec authored; FD runs `welcome-home-first`, re-runs `welcome-first-launch` and `welcome-home-routing`
- [x] `hat-welcome-alignment` — **HAT leg**: guided walkthrough of the surface in every state and the Settings preference controls on the operator's build; look-and-feel fixes inline (DD8); the mission's branding question closes here

---

## Post-Flight

### Completion Checklist

- [x] All legs completed
- [ ] Code merged
- [x] Tests passing
- [x] Documentation updated (CLAUDE.md's welcome-surface note gains the DOM-contract rule)

### Verification

- `npm test`, `npm run typecheck`, `npm run lint` green — wall-clock beside the count in every gate entry
- Structural: the DD2 id set is created by `welcome-controller.js`; both Clear buttons carry `.settings-btn--secondary` and the rule exists
- `/behavior-test welcome-home-first` passes; re-runs of `welcome-first-launch` and `welcome-home-routing` pass on the restyled build
- HAT: operator sign-off recorded in the flight log per state walked
