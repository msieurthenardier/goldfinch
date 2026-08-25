# Leg: hat-welcome-alignment

**Status**: ready
**Flight**: [Welcome Branding and Alignment](../flight.md)

## Objective

The operator walks the restyled welcome surface and the Settings preference controls in every state on their own dev build, and the Flight Director fixes look-and-feel issues inline until the operator is satisfied — closing the mission's last open question (what the branded page looks like).

## Context

- **HAT leg** (interactive — no autonomous Developer/Reviewer cycle): the Flight Director presents one verification step at a time, the operator performs it and reports, and issues are fixed inline per flight DD8 — a look-and-feel FIX rides the inline protocol (a Developer spawn per fix, structural tests kept green); anything that adds behavior a user would notice as new is a FEATURE and gets a scoped design review before implementation; a fix spanning more than one surface (welcome + Settings + chrome) gets a lightweight design-review pass first. The fix-vs-feature line is the FD's call, made out loud in the flight log.
- Leg 1 (`a3d147a`) delivered the first pass: `.welcome-column` (max-width 600 px) > `header.welcome-brand` (`img.welcome-mark` 48 px + `#welcome-heading` + `p.welcome-tagline` "Set up the two things Goldfinch won't guess for you.") > `#welcome-burner-note.welcome-notice` > `#welcome-home-block.welcome-card` > `#welcome-engine-block.welcome-card` with `#welcome-engine-options.welcome-engine-grid` (two columns, one under 560 px; radio-cards via `:has()`); Settings `.settings-btn--secondary` on both Clear buttons. All in `src/renderer/styles.css` (welcome block), `src/renderer/chrome/welcome-controller.js` (build section), `src/renderer/pages/settings.css`/`.html`.
- **The DOM contract (DD2) still binds every inline fix**: ids, class hooks, and `.hidden` toggles in the contract list are never renamed or removed; controller logic (`render`/`settle`/`show`/`submitHome`/`submitEngine`) is never touched; the structural tests in `test/unit/search-engines.test.js` and `test/unit/settings-page-shared-scripts.test.js` must stay green after every fix. If a fix needs a DOM hook change, a spec row changes with it — that is a divert per the flight's Adaptation Criteria, not an inline fix.
- No behavior spec is re-run per fix unless the fix touches a DOM hook (then `welcome-home-first` — the cheapest spec — re-runs at the end of the session).

## Inputs

- Leg 1 committed on `flight/03-welcome-branding` (`a3d147a`); draft PR #170 open
- The operator's own dev build: `npm run dev` (no automation surface needed), on a scratch profile they are willing to reset (`XDG_CONFIG_HOME=<empty dir> npm run dev` gives a fresh first launch)
- `npm test` green at 3765

## Outputs

- Look-and-feel fixes in `styles.css` / `settings.css` / wrapper DOM, each with its flight-log entry (what the operator saw, what changed, gate counts before → after)
- Operator sign-off per state recorded in the flight log
- The mission's Branding open question marked resolved with a one-line description of the settled look
- `flight.md`: leg 2 checked; status `landed`; mission Flight 3 checked

## Acceptance Criteria

Each row is an operator verification on their own build; the leg lands when every row carries an operator "satisfied" in the flight log.

- [ ] **A — First launch (both unset)**: on a fresh profile the welcome tab shows the mark, heading, tagline, the home-page card, and the engine card as a two-column grid of radio-cards; the whole thing reads as Goldfinch, not as an unstyled form
- [ ] **B — Engine choice**: hovering/selecting a radio-card gives a clear selected state (gold border) and a visible focus ring when tabbing; the descriptions are readable at their size
- [ ] **C — Home-only welcome**: with the engine set and the home page cleared (Settings → Clear), Ctrl+T shows the home-page card alone, centered, not orphaned
- [ ] **D — Search handoff**: with the engine cleared and a home page set, a typed search opens the welcome tab with the *Where should we search for "…"?* heading — the query reads clearly, a long query wraps inside the card
- [ ] **E — Burner welcome**: a burner tab's welcome surface shows the notice ("This choice is saved for all of Goldfinch.") prominently above the card
- [ ] **F — Settings**: the Clear buttons read as secondary actions beside the gold Save; the two unset hints and the "Saved"/"Cleared" status lines look intentional
- [ ] **G — Narrow window**: at ~600 px wide the grid collapses to one column and nothing overflows horizontally
- [ ] **H — Overall**: the surface is coherent with the rest of the chrome (dark tokens, gold accent) — the operator is satisfied with the first-run feel

## Verification Steps

The Flight Director presents A–H one at a time; the operator reports what they see (a screenshot pasted into the conversation is ideal). For each issue: FD classifies fix vs feature out loud → Developer spawn for a fix (CSS/DOM only; `npm test` + typecheck + lint green; note in the flight log) → operator re-checks the same step → next step.

## Implementation Guidance

1. Present each step with the exact actions (which profile, which keys, what to look at).
2. On a reported issue: name it, classify it (fix/feature; single- or multi-surface), spawn the Developer with the precise change and the DD2 constraint, run gates, ask the operator to reload (a new welcome tab picks up CSS only after a chrome reload — quit/relaunch `npm run dev`; Settings picks up CSS on a fresh tab since internal pages are served from disk per request).
3. Record every sign-off and every fix in the flight log under Flight Director Notes.
4. When H is satisfied: update the mission's Branding open question, check the leg and flight, set the flight `landed`, commit, mark PR #170 ready.

## Edge Cases

- **Operator asks for a preset list, a "skip for now" button, animation with state, a light theme** → feature / out of scope per the flight's Adaptation Criteria — record the ask for the mission debrief, don't build it in the HAT.
- **A fix wants a new id or class the specs read** → divert; re-plan the row.
- **A fix touches `renderer.js`** → it is one line under budget; refuse, find another seam.

## Files Affected

- `src/renderer/styles.css`, `src/renderer/pages/settings.css` — fixes
- `src/renderer/chrome/welcome-controller.js` (build section only), `src/renderer/pages/settings.html` — only if a wrapper/class change is needed
- `missions/16-search-and-startup-choice/flights/03-welcome-branding/flight-log.md`, `flight.md`, `mission.md`

## Citation Audit

2026-08-25 against `a3d147a`: the leg-1 DOM/CSS structure above verified by the flight-end Reviewer's report; test counts 3765.

---

## Post-Completion Checklist

- [ ] All acceptance criteria verified (operator sign-off per state in the flight log)
- [ ] Tests passing (count + wall-clock recorded after the last fix)
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `completed` (in this file's header)
- [ ] Check off this leg in flight.md
- [ ] If final leg of flight:
  - [ ] Update flight.md status to `landed`
  - [ ] Check off flight in mission.md
- [ ] Commit all changes together (code + artifacts)
