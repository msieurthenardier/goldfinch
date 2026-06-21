# Flight: Polish & MCP Hygiene

**Status**: landed
**Mission**: [Standard Browser Conveniences](../../mission.md)

## Contributing to Criteria
- [x] **SC9** — MCP schema hygiene: the automation surface's tool schemas are accepted by strict MCP
  consumers. Fix the `pressKey` top-level `anyOf` (#56) and assert no peer tool reintroduces a
  top-level schema combinator (*unit-test-backed*). **MET.**
- [ ] **SC10** — Side-panel animation polish (#27) — **DEFERRED (not met this flight).** Reverted at HAT:
  three mechanism attempts all failed under WSLg due to the Electron `<webview>` native surface
  mis-positioning on panel open (DOM geometry correct, render shifts). Deferred to the macOS/Windows
  verification pass / a dedicated flight (see mission Known Issues; leg 01 reverted).

> **Closing flight for Mission 04.** This is the final flight; it also clears the deck of carry-forward
> debt before `/mission-debrief`. Items beyond SC9/SC10 are debt cleanup, not new mission criteria, and
> are called out as such in the Objective.

---

## Pre-Flight

### Objective

Two standing-bug fixes the mission carried from day one, plus a focused sweep of carry-forward debt so
the mission lands clean:

**Core (SC9, SC10):**
1. **#27 — side-panel open-animation glitch.** `#media-panel` (`styles.css:606-616`) and `#privacy-panel`
   (`styles.css:1028-1043`) animate `width 0.18s` + `margin-right 0.18s` with `.collapsed { width: 0 }`.
   The panels are flex siblings of `#webviews` (`flex: 1`, `styles.css:532`) inside `#main`
   (`display: flex`), so `#webviews` width is the flex remainder — animating panel `width` forces a
   per-frame layout reflow of the web-content area (and the chrome above it), producing the jump. Replace
   with a GPU-composited **`transform` slide**; keep the top chrome stationary; preserve the existing
   `prefers-reduced-motion` neutralization (`styles.css:1539-1553`, a global `*` duration override that
   already covers `transform` transitions).
2. **#56 — `pressKey` top-level `anyOf` schema.** `mcp-tools.js:335` carries
   `anyOf: [{ required: ['name'] }, { required: ['key'] }]` at the **top level** of the tool's
   `inputSchema` — the construct strict MCP consumers reject. Flatten the schema and enforce the
   "name-or-key" requirement at runtime instead. Audit peer tools (recon: **clean** — `pressKey` is the
   only tool with a top-level combinator).

**Folded-in cleanup (operator-selected; debt, not new SC):**
3. **Settings "Downloads" placeholder removal** (operator-reported). `settings.html:18` (nav link) +
   `:126-128` (`<section id="downloads">…"will appear here."`) — a stub from before DD1 (Flight 5) made
   downloads an internal page, not a settings section. Remove both. Same-file copy bug folded in:
   `settings.html:63` reads *"Enabling **downloads** a one-time dictionary from Google"* — should read
   *"Enabling **spellcheck** downloads…"*.
4. **`wireDownloadHandler` payload-helper extraction + doc** (Flight-5 debrief). Extract the
   record/broadcast-payload construction into a pure, electron-free helper and unit-test the two
   HAT-fix behaviors (filename = `basename(getSavePath())`; `paused` = `isPaused()`); document the
   Electron `paused`/`getState()==='progressing'` fact.
5. **App-icon wire-up** (Flight-5 debrief). `goldfinch_new.png` is committed to `main` but referenced
   nowhere. Wire it in as the app icon — target to be resolved at leg design (see Open Questions).
6. **Behavior-test debt resolution** (Flight-5 debrief + mission Known Issues): harden the
   `downloads-surface` spec (regression-guard the double-download / wrong-filename HAT defects); and
   resolve the two `draft` Flight-4 specs (`page-context-menu.md`, `spellcheck.md`) — run them green
   where the apparatus can observe, else formally record them as HAT-only so they stop sitting in limbo.

**Explicitly deferred (operator decision, this planning):**
- **macOS verification apparatus** (3 deferred specs deep — OS print dialog, DevTools docking,
  Open/Show-in-folder) → carried to `/mission-debrief` → `/routine-maintenance` as its own scoped
  effort. Building a macOS run apparatus is infrastructure, not polish, and does not belong in this
  flight.

### Open Questions
- [ ] **#27 mechanism — does the panel keep its layout box or overlay?** A pure `transform` slide needs
  the panel to *not* re-trigger layout. Two viable shapes: (a) panel always occupies its `--panel-w` in
  layout, collapsed state translates it off-screen via `transform: translateX(100%)` and the content area
  is sized for the open width (panel "pushes" only via a non-animated width swap, the *visual* motion is
  the transform); (b) panel is positioned/overlaid so it slides over content. **(a) keeps the content
  reflow-free during the animation; (b) changes the content/panel relationship.** Resolve at leg design —
  pick the option that keeps the top chrome stationary and the web content from reflowing per-frame.
  *(Acceptable variation: exact technique, as long as no layout-triggering property is transitioned.)*
- [ ] **#56 runtime-validation error shape.** Flattening drops the schema-level "at least one of
  name/key". The `call` already does `args.name ?? args.key`; add an explicit guard that throws a clean,
  distinct error (e.g. `automation: pressKey requires 'name' or 'key'`) when both are absent, rather than
  passing `undefined` to the engine. Confirm the exact error string + that the MCP dispatch surfaces it
  as a tool error (not a crash) at leg design.
- [ ] **App-icon target.** `goldfinch_new.png` lives in `src/renderer/assets/` next to
  `goldfinch_color.png`/`goldfinch_mono.png`, but the **app/window icon** is `build/icon.png`
  (electron-builder `buildResources`, + `main.js:256` `BrowserWindow.icon`). *Recon note (architect):*
  only `goldfinch_color.png` is actually used (`index.html:58`, `#brand`); **`goldfinch_mono.png` is
  orphaned too** — same dead-asset status as `goldfinch_new.png`. Resolve at leg design by grepping
  usages: does `goldfinch_new.png` replace **(i)** the app/window icon (`build/icon.png`), **(ii)** the
  in-UI brand image (`goldfinch_color.png` at `#brand`), or **(iii)** both? Lowest-risk path for (i) is
  swapping the source `build/icon.png` (the build already consumes it via `buildResources: "build"`).
  electron-builder format/size constraints (Linux ≥512px `icon.png`; Windows `.ico`; macOS DMG) apply if
  (i).
- [x] **Behavior-test apparatus for `page-context-menu` + `spellcheck` — observability premise (resolved
  at planning, architect-corrected).** The renderer-chrome custom menu **is** readable on the admin
  apparatus: `page-context-menu.md` is already a fully-elaborated 12-step MCP-runnable spec reading the
  chrome `#page-context-menu` DOM via `readDom(chromeWcId)`/`readAxTree`/`captureWindow`, with the chrome
  `wcId` from `getChromeTarget()` (`engine.js:95`) and the internal guest reachable via `allowInternal`
  (`tabs.js:47`). So the premise is **YES, runnable** — not HAT-only. Both specs are **mixed**, not
  wholesale HAT-only: most rows are WSLg-acceptance observables (menu plumbing, opt-in state, correction
  round-trip), and only the **native-render rows** are HAT/macOS-authoritative — the spellcheck **red
  squiggle render** (native paint, not DOM) and the **native NSSpellChecker / `.bdic` egress**. Disposition
  is therefore **per-row**, not per-spec (see DD5).

### Design Decisions

**DD1 — #27: composite the panel slide with `transform`, never animate layout props.** Remove the
`width`/`margin-right` transitions from `#media-panel` and `#privacy-panel`; drive the open/close motion
with a `transform` (translate) that the compositor handles off the main thread, so neither the web
content nor the top chrome reflows per frame. The collapsed↔open *layout* change (if any) happens without
transition; only the transform is animated. Honor the existing reduced-motion block (`styles.css:1540`).
- **Success criterion is "no _per-frame_ reflow," not "zero layout steps" (architect [low]).** The
  collapsed state must still release the panel's layout box so `#webviews` reclaims the full width at rest
  — a single discrete width swap synchronized with the transform (at animation start/end) is acceptable
  and is the design target; what must go is the *per-frame* `width` interpolation. The leg must also
  handle the 1px `border-left` that `.collapsed` removes (`styles.css:620`/`:1042`) so it doesn't
  contribute to the at-rest content width when "closed."
- **Shields has a SECOND glitch source beyond the CSS — content population timing (planning-time HAT
  finding, 2026-06-20).** Live observation: with the *identical* width-transition CSS, the **Media panel
  is already visually smooth** but the **Shields panel glitches**. Root cause is not the CSS — it's that
  `togglePrivacy()` (`renderer.js:1785`), on open, synchronously calls **`renderPrivacy()`**
  (`renderer.js:2309`, a full `body.innerHTML=''` teardown + rebuild of ~7 sections) **and**
  **`fetchCookies()`** (async → triggers a *second* `renderPrivacy()` a frame later, the "Loading…" →
  cookie-count swap). `togglePanel()` (media, `renderer.js:1209`) does none of this — it only flips the
  class. So the heavy DOM rebuild + the late async re-render land *during* the slide and pop-in/reflow
  mid-animation. **The transform fix alone will NOT fully fix Shields.** The leg must also decouple
  content population from the open frame — e.g. populate while still off-screen/`width:0` *before* the
  slide starts, settle (or defer) the `fetchCookies()` re-render so it doesn't reflow mid-slide, and/or
  patch deltas instead of a full `innerHTML` rebuild. This is the difference between "Media smooth,
  Shields glitchy" the operator observed.
- Rationale: animating `width`/`margin` on a flex child is the documented cause of the jump; transforms
  are GPU-composited and layout-free — but for Shields the content rebuild is a co-equal cause.
- Trade-off: the Shields prong touches `renderer.js` toggle/render timing (not just CSS) — a slightly
  wider blast radius than a pure-CSS leg, scoped to the privacy panel's open path.

**DD2 — #56: flatten the schema, validate name-or-key in the handler.** Drop the top-level `anyOf`; keep
`required: ['wcId']`. Enforce "exactly/at-least one of `name`/`key`" in the tool `call` with a clean
thrown error. Keep the human-readable requirement in the tool `description`. Add a **schema-hygiene unit
test** asserting **no** tool's `inputSchema` contains a top-level `anyOf`/`oneOf`/`allOf`/`not` (a
standing guard against regressing SC9 on any future tool), plus a `pressKey` test for the both-missing
error path.
- Rationale: top-level combinators are the strict-MCP-rejected construct; runtime validation preserves
  the contract without the offending schema shape; the hygiene test makes SC9 durable, not a one-off fix.
- Trade-off: validation moves from declarative schema to imperative handler — acceptable and already
  half-present (`name ?? key`).

**DD3 — Settings cleanup is deletion + a copy fix; keep the scrollspy consistent.** Remove the
`#downloads` nav `<li>` (`:18`) and `<section id="downloads">` (`:126-128`); fix the `:63` note copy.
`settings.js:75` runs an `IntersectionObserver` scrollspy over the page's `<section>`s — verify it still
binds correctly with one fewer section/link (it queries dynamically, so removal should be clean, but the
leg confirms no dangling `#downloads` reference and the nav highlight still tracks). No new behavior.
- Rationale: the section is a dead stub; downloads live at `goldfinch://downloads` (Flight 5, DD1).
- Trade-off: none.

**DD4 — `wireDownloadHandler` payload extraction; the helper must take *accessors*, not plain primitives,
to actually cover the HAT behaviors (architect [medium]).** The two HAT defects were
`filename = basename(item.getSavePath())` and `paused = item.isPaused()` (`main.js:561,582,594`) — both
are **reads off the live Electron `DownloadItem`**, not transformations of already-extracted data. A
strictly pure helper that receives plain primitives would unit-test only payload *assembly* and would NOT
cover the two reads that actually broke. So the helper is built to make those reads testable:
**inject the extractors** — the helper (or a thin mapping fn) receives `{ getSavePath, isPaused, ... }`
accessors (electron-free; fed the real `item` methods in production, fakes in tests), so a unit test
asserts `filename === basename(getSavePath())` and `paused === isPaused()` with fakes. The hardened
`downloads-surface` behavior test (DD5) is the end-to-end backstop for the same two behaviors.
- Document the Electron fact (a paused `DownloadItem` stays `getState()==='progressing'`; `isPaused()` is
  the only truth) at the helper or in a short download-architecture note.
- Guard with the existing 938-test suite + the new accessor-injected helper tests.
- Rationale: the two HAT-found defects lived in this untested function; accessor injection is what makes
  the *reads* (not just the assembly) regression-proof at the unit level.
- Trade-off: a small main-process refactor with no functional change — verified behavior-preserving.
  *(Fallback if accessor injection proves awkward against the handler shape: scope the helper to payload
  assembly only and let the hardened `downloads-surface` behavior test own the `item.*` regression — but
  the unit-level guard is preferred.)*

**DD5 — Resolve the behavior-test debt by RUNNING it, with per-row disposition (architect-corrected).**
Harden `tests/behavior/downloads-surface.md` (promote the same-filename dedup variant to a required step +
add a "single download → exactly one new record" count assertion — regression guards for the
double-download and wrong-filename HAT defects). For `page-context-menu.md` and `spellcheck.md`: the
apparatus premise is **already answered YES** (Open Question, resolved) — both are MCP-runnable on the
admin surface. So **run them via `/behavior-test`** and adopt the **per-row disposition** the specs
already encode, NOT a binary run-vs-HAT-only-per-spec verdict:
- **Runnable-now rows** (the majority — menu plumbing, opt-in spellcheck state, the correction
  round-trip) → run green on the WSLg apparatus; flip the spec `draft` → `active`.
- **Native-render rows** (the spellcheck red-squiggle paint; the native NSSpellChecker / `.bdic` egress)
  → disposition **INCONCLUSIVE-on-WSLg / macOS-deferred**, folded into the HAT leg's acceptance, recorded
  in the run log — *not* used to demote the whole spec to "draft" or "HAT-only."
- Rationale: closes the Flight-5 debrief action item and the mission Known Issue in one pass; the specs
  are *mixed*, and demoting a mostly-runnable spec to HAT-only over a couple of native rows would waste
  the automation that already exists.
- Trade-off: a few rows remain macOS-authoritative (carried with the macOS apparatus deferral) — honest
  and already encoded per-row in the specs.

### Prerequisites
- [ ] Behavior-test apparatus runnable for the re-run/hardened `downloads-surface` (live Electron + MCP
  admin key + the existing `tests/behavior/fixtures/downloads/` fixture — landed Flight 5).
- [ ] Apparatus observability premise audited for `page-context-menu` + `spellcheck` **before** their leg
  runs (Open Question / DD5).
- [ ] electron-builder icon format/size constraints confirmed if the icon target is the app/window icon
  (Open Question).
- [ ] `prefers-reduced-motion` neutralization (`styles.css:1540`) confirmed to still cover the new
  transform after DD1.
- [ ] No new network services/ports introduced (none planned — renderer/CSS + schema + docs).

### Pre-Flight Checklist
- [ ] All open questions resolved (panel mechanism; pressKey error shape; icon target; the two specs'
  apparatus)
- [ ] Design decisions documented
- [ ] Prerequisites verified
- [ ] Validation approach defined (unit: schema-hygiene + pressKey + payload-helper; behavior:
  hardened `downloads-surface`, resolved `page-context-menu`/`spellcheck`; `npm run a11y`; HAT for #27)
- [ ] Legs defined (6 + optional HAT)
- [ ] Architect design review incorporated

---

## In-Flight

### Technical Approach

**#27 (renderer CSS).** Rework `#media-panel`/`#privacy-panel` open/close to a `transform`-driven slide
(DD1), removing the `width`/`margin-right` transitions; adjust positioning/markup minimally if needed so
the slide doesn't re-trigger layout; keep reduced-motion honored.

**#56 (automation).** Flatten `pressKey`'s `inputSchema` (drop top-level `anyOf`), add the handler-side
name-or-key guard with a distinct error, and add the schema-hygiene test asserting no top-level
combinators across all tools (DD2). Update `pressKey` tests.

**Settings (renderer).** Delete the downloads nav link + section, fix the spellcheck note copy, keep the
scrollspy consistent (DD3).

**Downloads handler (main).** Extract the payload-construction helper, unit-test it, document the Electron
paused fact (DD4).

**App icon (build/main).** Wire `goldfinch_new.png` to the resolved target; satisfy electron-builder
format requirements (DD5/Open Question).

**Behavior tests (specs + run).** Harden `downloads-surface`; premise-audit + run-or-reclassify the two
draft specs (DD5).

### Checkpoints
- [ ] Side panels (Media / Shields) open/close with no chrome jump and no per-frame content reflow;
  reduced-motion still neutralizes the animation. (#27 / SC10)
- [ ] `pressKey` `inputSchema` has no top-level `anyOf`; name-or-key enforced at runtime with a clean
  error; the schema-hygiene test passes and asserts no peer top-level combinator. (#56 / SC9)
- [ ] `goldfinch://settings` no longer shows a Downloads nav entry or section; the spellcheck note reads
  correctly; scrollspy nav highlight still tracks.
- [ ] `wireDownloadHandler` payload built by a unit-tested pure helper; filename + paused behaviors
  covered; the Electron paused fact documented.
- [ ] `goldfinch_new.png` is the wired app icon (window + packaged build, or the resolved target).
- [ ] `downloads-surface` behavior test hardened + green; `page-context-menu`/`spellcheck` resolved (run
  green or recorded HAT-only) — no spec left `draft`.
- [ ] Full unit suite + typecheck + lint clean; `npm run a11y` 0 new violations.

### Adaptation Criteria

**Divert if**:
- The `transform` slide can't keep the content area reflow-free without a structural panel-layout change
  bigger than a polish leg warrants — descope #27 to the minimal jump-removal that's safe, log the
  remainder as a follow-up (do not destabilize the panels for a closing flight).
- The `page-context-menu`/`spellcheck` apparatus audit shows the observables aren't readable — reclassify
  to HAT-only (DD5), don't build a test-only seam reactively.
- The app-icon format work balloons (multi-format generation tooling) — wire the window icon at minimum
  and log packaged-icon format work as a follow-up.

**Acceptable variations**:
- Exact #27 technique (any non-layout-animating approach).
- The `pressKey` error string and the exact form of the schema-hygiene assertion.
- Whether `goldfinch_new.png` replaces the build icon, the UI brand images, or both (per the audit).

### Legs

> **Note:** Tentative; planned and created one at a time as the flight progresses.

- [~] `side-panel-animation` — **REVERTED at HAT, #27/SC10 DEFERRED** (see leg 01 + mission Known Issues).
  Original scope follows: #27: rework `#media-panel`/`#privacy-panel` to a `transform`-composited
  slide (DD1), remove `width`/`margin` transitions, keep top chrome stationary + reduced-motion honored.
  **Two prongs (DD1):** (a) the CSS transform fix for both panels; (b) the **Shields-specific** fix —
  decouple `renderPrivacy()`/`fetchCookies()` (`renderer.js:1785`/`:2309`) from the open frame so content
  doesn't pop-in/reflow mid-slide (Media is already smooth; Shields is not, because of this synchronous
  rebuild). Renderer-CSS + a scoped `renderer.js` toggle/render-timing change. (SC10)
- [x] `presskey-schema-hygiene` — #56: flatten `pressKey` `inputSchema` (drop top-level `anyOf`),
  handler-side name-or-key guard with a distinct error, schema-hygiene unit test (no top-level
  combinator on any tool) + pressKey both-missing test (DD2). (SC9)
- [x] `settings-cleanup` — remove `#downloads` nav link + section, fix the `:63` spellcheck-note copy,
  keep the scrollspy consistent (DD3). Renderer-HTML.
- [x] `downloads-handler-refactor` — extract `wireDownloadHandler` payload construction into a pure
  electron-free helper, unit-test filename + paused behaviors, document the Electron paused/getState
  fact (DD4). Main-process + tests. *(Behavior-preserving; no functional change.)*
- [x] `app-icon` — wire `goldfinch_new.png` to the resolved target (window/build icon and/or the
  `#brand` UI image), satisfy electron-builder format constraints (DD5 / Open Question). *(HAT/visual-only
  — no automated assertion owed; verified by eye in the HAT leg.)*
- [x] `verify-and-behavior-tests` — **deterministic subset DONE** (completed): hardened `downloads-surface.md`
  (dedup-required step + sharpened exactly-one-record assertion); reconciled the drift (`settings-shell.md`
  nav inventory → 5 links/5 sections; tool counts → 27/17 in `spellcheck.md`/`automation-mcp-tools.test.js`/
  `mcp-server.js`); docs confirmed clean; full suite + typecheck + lint green; **a11y gate green** (0 new
  violations). **PART D (live behavior-test runs) DEFERRED** to a follow-up (operator decision after the #27
  detour): `downloads-surface` re-run + `page-context-menu`/`spellcheck` `draft→active` — recorded in mission
  Known Issues. (DD5 partially met.) *(verify-integration leg.)*
- [x] `hat-and-alignment` — **completed.** Caught the #27 regression → reverted/deferred (its purpose
  served). a11y gate green; app-icon + settings eyeballs non-blocking (icon wired+verified; settings
  a11y-clean + spec-reconciled); PART-D behavior runs deferred with leg 6.

---

## Post-Flight

### Completion Checklist
- [x] Legs resolved: 2/3/4/5 `completed`; 6 `completed` (deterministic; PART-D behavior runs deferred);
  7 (HAT) `completed`; **1 `aborted` (#27 reverted, SC10 deferred)**
- [ ] Code merged (draft PR #67 — ready for review after landing)
- [x] Tests passing (unit: schema-hygiene + pressKey + payload-helper — 950 pass; typecheck + lint clean;
  a11y 0 new violations). *Deferred: the `downloads-surface`/`page-context-menu`/`spellcheck` behavior runs.*
- [x] Documentation updated (tool-count reconciles; settings copy; #27 + Ctrl+M deferrals in Known Issues)
- [ ] Documentation updated (Electron paused fact; any icon/docs notes)

### Verification
- **SC9** — `pressKey` `inputSchema` carries no top-level combinator; name-or-key enforced at runtime;
  the schema-hygiene unit test guards every tool against reintroducing one. **MET (unit-test-backed).**
- **SC10** — **DEFERRED (not met).** The transform/overlay rework failed live HAT under WSLg (Electron
  `<webview>` native surface mis-positions on panel open; DOM geometry correct, render shifts). Leg 01
  reverted to pre-flight; #27 carried to the macOS/Windows verification pass / a dedicated flight.
