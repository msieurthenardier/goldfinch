# Leg: first-pass-visual-design

**Status**: completed
**Flight**: [Welcome Branding and Alignment](../flight.md)

## Objective

Give the welcome surface its first branded look — mark, one-line welcome, the two choices as cards, the engine chooser as a two-column grid of radio-cards, the burner note as a visible notice — on the existing dark tokens, style the two Settings Clear buttons as secondary buttons, and pin the surface's DOM contract with a structural test so the restyle (and the HAT that follows) cannot regress Flight 2's behavior; the FD then runs `welcome-home-first` and re-runs `welcome-first-launch` and `welcome-home-routing` as the gate.

## Context

- Flight DD1 (visual language, AT-safe radios, radiogroup), DD2 (frozen DOM contract — CSS plus additive wrapper DOM only; controller logic untouched), DD3 (Clear secondary variant + the explicit `margin-left`), DD4 (burner notice), DD6 (full-bleed child of `#webviews`, opaque `--bg`), DD7 (`renderer.js` not touched; new assets to `src/renderer/assets/` only if needed — none expected).
- **What exists** (verified 2026-08-25 against `main` `bb053d3`): `src/renderer/chrome/welcome-controller.js` builds, once, in `createWelcomeController(deps)`: `#welcome-heading` (h2) → `#welcome-home-block` (label / `#welcome-home-input` / `#welcome-home-set` / `p.muted` hint / `#welcome-home-status` role=status) → `#welcome-burner-note` (`p.muted.hidden`) → `#welcome-engine-block` (`#welcome-engine-heading` h3 / `#welcome-engine-options` / `#welcome-engine-status`), with one `.welcome-engine-row` per engine (`input[type=radio]#welcome-engine-<id>` name `welcome-search-engine`, `label[for]` > `span`, `p.muted` description). `render(tab)` toggles `.hidden` on `#welcome-home-block`, `#welcome-burner-note`, `#welcome-engine-block` and sets `engineHeading.textContent`. `src/renderer/styles.css` lines ~830–895 hold the placeholder rules (comment: "Presentable and unstyled — Flight 3 owns the visual language"). `index.html:171` is `<section id="welcome-surface" class="hidden" aria-labelledby="welcome-heading">`. `#brand` (`index.html:64`, `styles.css` `#brand`) loads `assets/goldfinch_color.png` at 22 px with `-webkit-user-drag: none; user-select: none`.
- Settings: `settings.html:45` `#home-page-clear`, `:59` `#search-engine-clear` — no class, no CSS rule; `settings.css` has `#home-page-save` (accent fill, `margin-left: 8px`) and the reusable `.settings-btn` / `.settings-row` (flex, `gap: 8px`).
- Structural-test conventions to follow: `test/unit/search-engines.test.js` reads `welcome-controller.js` source and asserts shapes by regex (the no-duplication test at `:229` and the `show`→`settle` test at `:254`); `test/unit/settings-page-shared-scripts.test.js` reads `settings.html`/`settings.js`/`settings.css` the same way. **The no-duplication test (`search-engines.test.js:229`) forbids any engine label/description literal in `welcome-controller.js` — the restyle must not hand-type engine copy.**
- Flight 2 debrief lesson applied at this leg's design: the behavior spec was traced at the value level in flight design review (two passes); the fixture is a fresh profile, no premise depends on this leg's CSS.

## Inputs

- `src/renderer/chrome/welcome-controller.js` — the build section (`createWelcomeController`, lines ~20–125) and `render(tab)`
- `src/renderer/styles.css` — the welcome block (~830–895), `:root` tokens, `#brand`
- `src/renderer/index.html:171` — `#welcome-surface`
- `src/renderer/pages/settings.html:45`, `:59`; `src/renderer/pages/settings.css` — `#home-page-save`, `.settings-btn`
- `src/renderer/assets/goldfinch_color.png` — the mark
- `test/unit/search-engines.test.js`, `test/unit/settings-page-shared-scripts.test.js`
- `tests/behavior/welcome-home-first.md` (draft — this leg's acceptance), `welcome-first-launch.md`, `welcome-home-routing.md` (re-runs)
- `CLAUDE.md` — the welcome-surface note (M16 F2)

## Outputs

- `welcome-controller.js`: additive wrapper DOM only — a brand header (`<header class="welcome-brand">` with `<img class="welcome-mark" src="assets/goldfinch_color.png" alt="">` + the existing `#welcome-heading` + a new `p.welcome-tagline`), the home block and engine block each wrapped in (or given the class of) a `.welcome-card`, `#welcome-engine-options` given `role="radiogroup"` + `aria-labelledby="welcome-engine-heading"` and a grid class, each `.welcome-engine-row` styled as a radio-card (the radio stays a real, AT-visible input; the label wraps the row visually via `for`/CSS, not by moving the input). `#welcome-burner-note` loses `muted` (keeps `hidden`), gains `welcome-notice`, and moves directly under the brand header. Every id, class hook, and `.hidden` toggle in DD2's list is unchanged; `render`/`settle`/`show`/`submitHome`/`submitEngine` are untouched.
- `styles.css`: the placeholder block replaced by the `/* Welcome surface (M16 F3) */` block — centered column (max-width ~600 px), brand header, cards on `--bg-2` with `--border`, engine grid (two columns, collapsing to one under ~560 px), radio-card selected state via `:has(:checked)` (Chromium supports it) or `:checked + label` with `--accent` border, focus ring `--accent`, `.welcome-notice` (`--accent-muted` left border, `--fg` text), `.welcome-mark` (`-webkit-user-drag: none; user-select: none`, ~48 px). `#welcome-surface` keeps `position: absolute; inset: 0; overflow: auto; background: var(--bg)`.
- `settings.css`: `.settings-btn--secondary` (transparent fill, `1px solid var(--border)`, `color: var(--fg)`, hover `background: var(--bg-2)`, same radius/padding/font/focus ring as `.settings-btn`) and `#home-page-clear { margin-left: 8px }`; `settings.html`: `class="settings-btn settings-btn--secondary"` on both Clear buttons.
- Tests: `test/unit/search-engines.test.js` gains a DOM-contract structural test asserting `welcome-controller.js` still assigns every DD2 id (`welcome-heading`, `welcome-home-block`, `welcome-home-input`, `welcome-home-set`, `welcome-home-status`, `welcome-burner-note`, `welcome-engine-block`, `welcome-engine-heading`, `welcome-engine-options`, `welcome-engine-status`), the `welcome-engine-` radio id prefix, the `welcome-engine-row` class, and toggles `hidden` on the two blocks and the note in `render`; plus a check that the radiogroup role is set. `test/unit/settings-page-shared-scripts.test.js` gains a test that both Clear buttons carry `settings-btn settings-btn--secondary` and that `settings.css` defines `.settings-btn--secondary` and `#home-page-clear`'s margin.
- `CLAUDE.md`: the welcome-surface note gains the DOM-contract rule (ids/classes/`.hidden` hooks are a contract read by specs and tests; restyle by CSS and wrapper DOM only) and points at the structural test.
- Spec `tests/behavior/welcome-home-first.md`: `draft` → `active` after its first passing run (FD).

## Acceptance Criteria

- [x] The welcome surface renders the brand mark, heading, tagline, and cards; in each state the same blocks show/hide as before (both-unset: both cards; home-only; engine-only with the pending-query heading; burner: the notice) — verified by the behavior runs below, not by pixels *(2026-08-25: observed on all three runs — both-unset at `welcome-first-launch` 1, home-only at `welcome-home-routing` 3, engine-only with the query heading at `welcome-home-first` 4, burner notice at `welcome-home-routing` 5)*
- [x] Every DD2 id/class/`.hidden` hook is unchanged and pinned by the new structural test; the test goes red when any one id assignment is removed from the controller (hand-neuter check recorded)
- [x] Native radios remain in the accessibility tree (no `display:none`/`visibility:hidden` on `input[type=radio]` in the welcome CSS — grep-checked) and `#welcome-engine-options` carries `role="radiogroup"` + `aria-labelledby`
- [x] No engine label/description literal in `welcome-controller.js` (existing test stays green); `renderer.js` untouched (`git diff --stat` shows no change)
- [x] `#home-page-clear` and `#search-engine-clear` carry `settings-btn settings-btn--secondary`; the variant rule and the 8 px margin exist — structural test green
- [x] `npm test`, `npm run typecheck`, `npm run lint` green — count and wall-clock recorded before → after
- [x] CLAUDE.md's welcome-surface note carries the DOM-contract rule
- [x] **Behavior acceptance (FD-run)**: `/behavior-test welcome-home-first` passes; re-runs of `welcome-first-launch` and `welcome-home-routing` pass on this build. The leg does not land while any fails. *(2026-08-25: 5/5, 7/7, 10/10 — run logs in the flight log.)*

## Verification Steps

- Structural: `node --test test/unit/search-engines.test.js test/unit/settings-page-shared-scripts.test.js`; then temporarily delete one `.id = 'welcome-…'` assignment in the controller and confirm the contract test fails; restore.
- `grep -nE 'display:\s*none|visibility:\s*hidden' src/renderer/styles.css` within the welcome block — no hit applies to a radio.
- `git diff --stat src/renderer/renderer.js` — empty.
- Gates: `time npm test`, `npm run typecheck`, `npm run lint`.
- Visual smoke (Developer, not the acceptance): `npm run dev` on a scratch `XDG_CONFIG_HOME` and look at first launch; describe what renders in the flight-log entry. The judgment is the HAT's.
- Behavior: FD runs the three specs after the Developer lands.

## Implementation Guidance

1. **Wrap, don't rename.** In `createWelcomeController`, build the brand header first (`header.welcome-brand` > `img.welcome-mark` + existing `heading` + `p.welcome-tagline` — copy suggestion: "Set up the two things Goldfinch won't guess for you." — plain text, no engine names), append the burner note next (keep its id/text; class `welcome-notice hidden`), then the home block and the engine block with `classList.add('welcome-card')`. Keep element creation order such that `#welcome-heading` remains the `aria-labelledby` target. Do not touch `render`, `settle`, `show`, `unsetReasons`, `submitHome`, `submitEngine`, or the `change` listeners.
2. **Engine grid.** `engineOptions.className = 'welcome-engine-grid'`, `setAttribute('role','radiogroup')`, `setAttribute('aria-labelledby','welcome-engine-heading')`. Each `.welcome-engine-row` becomes the card: CSS `position: relative`; the radio stays first in DOM order; style the label/description as the card face; the selected state via `.welcome-engine-row:has(input:checked)` (Chromium ≥105 — the bundled Electron supports `:has`; confirm by grep of the electron version in `package.json` and note it in the flight-log entry) with `--accent` border; focus ring via `:has(input:focus-visible)`. The radio may be visually de-emphasized with `opacity` and positioned, never `display:none`.
3. **CSS.** Replace the placeholder block wholesale; keep the leading comment's DD1/DD6 references and add "M16 F3 Leg 1". Use only the `:root` tokens. Column: `max-width: 600px; margin: 0 auto; padding: 48px 24px`. Cards: `background: var(--bg-2); border: 1px solid var(--border); border-radius: 10px; padding: 20px`. Home input/Set: match `#home-page-input`/`#home-page-save`'s shape from `settings.css` (bg-2 fill, radius 6, accent Set). Notice: `border-left: 3px solid var(--accent-muted); padding: 8px 12px; background: var(--bg-2)`.
4. **Settings.** Add the variant rule after `.settings-btn:focus-visible` in `settings.css`; add `#home-page-clear { margin-left: 8px; }` beside `#home-page-save`'s rules; add the classes in `settings.html`. Nothing in `settings.js` changes.
5. **Tests.** Follow the regex-on-source convention exactly (see `search-engines.test.js:254` for the shape). For the contract test, assert each id via `new RegExp("\\.id = '" + id + "'")` against the controller source, the `render` body toggles via `/classList\.toggle\('hidden'/` count ≥ 3 inside the `render` function body, and `role', 'radiogroup'`. Do the neuter check by hand and record the red count.
6. **Docs.** CLAUDE.md welcome-surface note: add the contract rule and the test name.
7. **Status and log.** Set this leg `in-flight` at start and `landed` at the end (no transition-time handling is defined in `.flightops/ARTIFACTS.md`); write the flight-log entry (files touched, counts before → after with wall-clock, the neuter result, the electron version / `:has` note, what the smoke render looked like). Do NOT commit; do NOT run the behavior specs — the FD does.

## Edge Cases

- **Pending-query heading is user text** — it stays `textContent`; a long query must wrap inside the card (`overflow-wrap: anywhere` on `#welcome-engine-heading`), never overflow the column.
- **Burner note visibility** — it is toggled by `render` via `.hidden`; moving it in DOM order must not change which element `render` toggles (same `burnerNote` reference).
- **Narrow windows** — the grid collapses to one column under ~560 px; the column padding shrinks; nothing horizontal-scrolls (`#welcome-surface` is `overflow: auto`, vertical only in practice).
- **`:has` support** — if the bundled Chromium lacks it (it should not), fall back to `input:checked + label` styling on the label only; record which was used.
- **Home input autofill/`type=url`** — unchanged; the Set button remains a `button[type=button]` (no form submit).
- **Description copy length** — the eight descriptions vary; cards must not equalize by truncation (`text-overflow` forbidden — the copy is the point, DD1); use grid row alignment instead.

## Files Affected

- `src/renderer/chrome/welcome-controller.js` — wrapper DOM, classes, radiogroup attributes (build section only)
- `src/renderer/styles.css` — welcome block rewritten
- `src/renderer/pages/settings.css` — `.settings-btn--secondary`, `#home-page-clear` margin
- `src/renderer/pages/settings.html` — classes on the two Clear buttons
- `test/unit/search-engines.test.js` — DOM-contract structural test
- `test/unit/settings-page-shared-scripts.test.js` — Clear-button structural test
- `CLAUDE.md` — welcome-surface note
- `missions/16-search-and-startup-choice/flights/03-welcome-branding/flight-log.md` — leg entry

## Citation Audit

2026-08-25, against `main` `bb053d3` (branch `flight/03-welcome-branding` at `bcbc0d7`): `welcome-controller.js` build section and ids — verified by reading lines 1–130; `styles.css` welcome block at 830–895 and `#brand` — verified; `index.html:64` (`#brand`) and `:171` (`#welcome-surface`) — verified; `settings.html:45`/`:59` — verified; `settings.css` `#home-page-save` (`margin-left: 8px`), `.settings-btn`, `.settings-row` — verified; `search-engines.test.js:229`, `:254` — verified; `seam-contract.test.js` `RENDERER_LINE_BUDGET` 1650 vs `renderer.js` 1649 lines — verified by the flight's Architect.

---

## Post-Completion Checklist

- [ ] All acceptance criteria verified (including FD-run behavior specs)
- [ ] Tests passing (count + wall-clock recorded)
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `completed` (in this file's header)
- [ ] Check off this leg in flight.md
- [ ] If final leg of flight:
  - [ ] Update flight.md status to `landed`
  - [ ] Check off flight in mission.md
- [ ] Commit all changes together (code + artifacts)
