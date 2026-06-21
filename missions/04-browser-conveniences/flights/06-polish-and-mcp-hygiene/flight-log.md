# Flight Log: Polish & MCP Hygiene

**Flight**: [Polish & MCP Hygiene](flight.md)

## Summary

Flight planned 2026-06-20 — the closing flight of Mission 04 (Standard Browser Conveniences). Fixes the
two standing bugs the mission carried from day one (#27 side-panel animation glitch → SC10; #56 `pressKey`
top-level `anyOf` schema → SC9) and folds in operator-selected carry-forward debt: the settings-page
Downloads placeholder removal (operator-reported), the `wireDownloadHandler` payload-helper extraction
(Flight-5 debrief), the `goldfinch_new.png` app-icon wire-up (Flight-5 debrief), and resolution of the
behavior-test debt (harden `downloads-surface`; run-or-reclassify the two `draft` Flight-4 specs). The
macOS verification apparatus is **deferred** to `/mission-debrief` → `/routine-maintenance` (operator
decision). Status: **planning**.

---

## Reconnaissance Report

Source items: the mission roadmap (Flight 6 = #27, #56), the Flight-5 debrief action items, and the
mission Known Issues. Each verified against current `main` (commit at `27defad`) during planning:

| Item | Classification | Evidence | Recommendation |
|------|---------------|----------|----------------|
| #27 — side-panel open-animation glitch | `confirmed-live` | `styles.css:606-616` `#media-panel` animates `width 0.18s` + `margin-right 0.18s`; `#privacy-panel` `:~1024-1038` identical; both `.collapsed { width: 0 }` | Fix as DD1 (transform-composited slide). In scope (SC10). |
| #56 — `pressKey` top-level `anyOf` | `confirmed-live` | `mcp-tools.js:335` `anyOf: [{required:['name']},{required:['key']}]` at `inputSchema` top level | Fix as DD2 (flatten + runtime guard + hygiene test). In scope (SC9). |
| Peer tools with top-level schema combinator | `already-satisfied` (clean) | grep `anyOf|oneOf|allOf|not:` across `mcp-tools.js` → only `pressKey` | No peer fix needed; DD2 adds a standing hygiene test to keep it that way. |
| Settings "Downloads" placeholder (operator-reported) | `confirmed-live` | `settings.html:18` nav `<li><a href="#downloads">`, `:126-128` `<section id="downloads">…"will appear here."` | Remove both (DD3). In scope. |
| Settings spellcheck-note copy bug (found during recon) | `confirmed-live` | `settings.html:63` "Enabling **downloads** a one-time dictionary from Google" (should be "Enabling spellcheck downloads…") | Fold into DD3 (same file). In scope. |
| Flight-5 debrief: harden `downloads-surface` behavior test | `confirmed-live` | `tests/behavior/downloads-surface.md` lacks a required dedup step + single-download count assertion | Fix as DD5. In scope. |
| Flight-5 debrief: extract `wireDownloadHandler` payload helper + doc paused fact | `confirmed-live` | `main.js` `wireDownloadHandler` builds the payload inline; no pure helper, no direct unit coverage; paused/getState fact undocumented | Fix as DD4. In scope. |
| Flight-5 debrief: wire up `goldfinch_new.png` | `confirmed-live` | `src/renderer/assets/goldfinch_new.png` committed (`953bc83`), referenced nowhere; app icon is `build/icon.png` + `main.js:256` | Fix as DD5/`app-icon` leg; target ambiguity is an Open Question. In scope. |
| Mission Known Issue: two Flight-4 specs still `draft` | `confirmed-live` | `tests/behavior/page-context-menu.md` + `spellcheck.md` both `**Status**: draft` | Resolve as DD5 (run or reclassify HAT-only). In scope. |
| Mission Known Issue: macOS verification apparatus (3 specs deep) | `confirmed-live` | print-to-pdf OS dialog, devtools-cdp-conflict docking, downloads Open/Show — all defer to macOS | **Deferred** (operator) to `/routine-maintenance`. Out of scope. |
| Flight-5 debrief: `/leg` renderer-glue checklist (`renderer-globals.d.ts`/`eslint.config.mjs`) | `needs-human-recheck` | mission-control methodology item, not goldfinch code | Out of scope here (methodology change lives in mission-control, not this project flight). |

No `already-satisfied` items required retirement from scope beyond the clean peer-combinator audit (kept
as a `[x]` evidence note via the hygiene test in DD2).

---

## Decisions Log

- **2026-06-20** — Operator: fold all four offered carry-forwards into the closing flight (run the two
  draft behavior specs, harden `downloads-surface`, refactor `wireDownloadHandler` + doc, wire up the app
  icon). (→ DD4, DD5, legs)
- **2026-06-20** — Operator: **defer** the macOS verification apparatus to `/mission-debrief` →
  `/routine-maintenance` — it's infrastructure, not polish. (→ Objective "Explicitly deferred")
- **2026-06-20** — Operator: include the optional **HAT + alignment** leg (the #27 fix is visual). (→ legs)
- **2026-06-20** — Recon: peer schema-combinator audit came back clean (only `pressKey`); DD2 adds a
  standing hygiene test rather than a peer fix.
- **2026-06-20** — Operator (leg-5 design): `goldfinch_new.png` is **761×761**; the `build/icon.png` it
  replaces is **1024×1024** ("ideal" per `build/README.md`). Operator chose **"Ship 761 now"** — wire the
  new art in as-is (meets the ≥512 hard floor; the largest icon slot softens slightly), rather than block
  on a 1024 master or upscale (which would interpolate fake detail). A future 1024 master is noted as a
  follow-up. (→ leg 5 `app-icon`, option (a) pure asset swap.)

---

## Design Review

- **2026-06-20** — Architect review (1 cycle): **approve with changes**. All file:line citations verified
  against `main`; recon report accurate; the two core fixes (DD1, DD2) sound. Issues applied to the spec:
  - **[high]** The DD5/Open-Question observability premise for `page-context-menu` was contradicted by the
    repo's own spec — `page-context-menu.md` is a fully-elaborated 12-step MCP-runnable spec reading the
    chrome `#page-context-menu` DOM via `readDom(chromeWcId)`/`readAxTree`/`captureWindow` (chrome `wcId`
    from `getChromeTarget()`, `engine.js:95`; internal guest via `allowInternal`, `tabs.js:47`). →
    Open Question marked resolved (premise = **YES, runnable**); DD5 reframed from "run-or-reclassify" to
    "run, with per-row disposition."
  - **[medium]** The premise was over-generalized across two specs with different profiles — both are
    **mixed**, most rows runnable on WSLg, only native-render rows (squiggle paint, NSSpellChecker/`.bdic`)
    HAT/macOS-authoritative. → DD5 + the verify leg now adopt per-row disposition.
  - **[medium]** DD4's "pure electron-free helper" could not cover the two HAT behaviors —
    `filename=basename(item.getSavePath())` and `paused=item.isPaused()` are reads off the live
    `DownloadItem` (`main.js:561,582,594`), not transforms of plain data. → DD4 rewritten to
    **inject accessors** so the reads are unit-testable with fakes; hardened behavior test as the e2e
    backstop; payload-assembly-only as a documented fallback.
  - **[low]** DD1 — clarified the success criterion is "no _per-frame_ reflow" (a single discrete width
    swap synced with the transform is acceptable), and the leg must handle the 1px `border-left` that
    `.collapsed` removes (`styles.css:620`/`:1042`). Citation fix: `#privacy-panel` is `:1028-1043`.
  - **Suggestions applied:** noted `goldfinch_mono.png` is also orphaned (only `goldfinch_color.png` used,
    `index.html:58` `#brand`); marked the `app-icon` leg HAT/visual-only (no automated assertion owed);
    added the tool-count drift reconcile (`spellcheck.md:51` says 26 vs live 27) to the verify leg.
  - **Confirmed sound (no change):** the MCP dispatch try/catch surfaces a thrown `pressKey` guard as a
    tool error not a crash (`mcp-server.js:254-260`); the schema-hygiene test is feasible and
    count-agnostic via `buildToolRegistry().listTools()`; the flex-sibling reflow root-cause for #27; the
    settings scrollspy (`settings.js:42`) tolerates one fewer section/link cleanly.
  - Changes were direct adoptions of the architect's prescribed fixes (not independent redesign) → 2nd
    review cycle **skipped** (skill permits).

## Execution Notes

_(append-only during execution)_

### Planning-time HAT observations (dev instance, 2026-06-20)

Operator ran a dev instance (`npm run dev`, v0.5.7) during planning and exercised the panels:

- **#27 asymmetry — Media smooth, Shields glitches, despite identical CSS.** The width-transition CSS for
  `#media-panel` (`styles.css:606-616`) and `#privacy-panel` (`:1028-1043`) is byte-identical, yet Media
  animates cleanly and Shields glitches. Root cause is **content-population timing, not CSS**:
  `togglePrivacy()` (`renderer.js:1785`) synchronously calls `renderPrivacy()` (`:2309` — full
  `body.innerHTML=''` rebuild of ~7 sections) **and** `fetchCookies()` (async → a second `renderPrivacy()`
  a frame later) on open; `togglePanel()` (media, `:1209`) only flips the class. The rebuild + late
  re-render reflow *during* the slide. → DD1 expanded to a **two-prong** fix (CSS transform + decouple
  Shields content population from the open frame); `side-panel-animation` leg updated.
- **Settings Downloads placeholder still present (operator re-confirmed live).** `settings.html:18`
  (nav) + `:126-128` (section) — already in scope as the `settings-cleanup` leg (DD3). Live-confirmed,
  no scope change.

### Flight Director Notes

- **2026-06-20** — `/agentic-workflow` started. Phase 1 context loaded: mission `active`, flight
  `ready` → transitioned to **`in-flight`**. Branch `flight/06-polish-and-mcp-hygiene` cut from `main`;
  planning artifacts (flight spec/log + mission roadmap annotation) committed as the flight baseline
  (`56dda8d`). Crew per `.flightops/agent-crews/leg-execution.md` (Developer = Sonnet, Reviewer = Sonnet;
  Accessibility Reviewer disabled). Deferred-commit model: per-leg design review, code review + commit
  deferred to after the last autonomous leg. Starting the leg cycle at leg 1 `side-panel-animation`.
- **2026-06-20** — Leg 1 `side-panel-animation` designed (delegated design agent following `/leg`), then
  **2 Developer design-review cycles**. Cycle 1 *approve with changes*: **[high]** the mutual-exclusion
  close paths (`closePrivacyPanel()`, `togglePanel(false)`) collapse panels with no JS width sequencing →
  all four call sites must route through one shared `slidePanel(el, show)` helper or the cross-panel switch
  (the most common interaction) strands the closing panel; **[medium]** pin the exact open/close frame
  ordering (collapsed-at-rest `width:0`+`.collapsed`; open = set width → reflow read → rAF remove
  `.collapsed`); **[medium]** make the `transitionend` guards mandatory (propertyName + live-state re-read
  + fallback timeout) → promoted to AC11; **[low]** cookies `pList` grows panel after slide (don't
  pre-reserve), `box-sizing:border-box` already satisfies AC4. Cycle 2 *approve* (confirming): resolutions
  correctly incorporated, no new high-severity; 1 [low] (pin the Prong A↔B handoff — populate must complete
  before `slidePanel`'s rAF removes `.collapsed`) + AC11 scope wording applied. Leg 1 → `ready`.
  `[HANDOFF:review-needed]`. Then implemented by a Developer agent → `landed` (uncommitted). 938 tests pass.
- **2026-06-20** — Legs 2 (`presskey-schema-hygiene`) and 3 (`settings-cleanup`) — fully independent
  (disjoint files: `mcp-tools.js`+test vs `settings.html`; no dependency) — **designed in parallel**, then
  **design-reviewed in parallel** (1 cycle each, both *approve* — leg 2's review confirmed the two
  bug-pinning tests are the only ones and the thrown→tool-error chain; leg 3's confirmed the query-driven
  scrollspy + clean dangling-ref greps). Both → `ready` `[HANDOFF:review-needed]`, then **implemented in
  parallel** by two Developer agents → `landed`. To avoid a concurrent flight-log write race, implementers
  reported their log entries and the Flight Director appended them. Consolidated checkpoint: 940 tests pass,
  typecheck + lint clean (see Leg Progress). `legs_completed = 3/6`.
- **2026-06-20** — Leg 4 `downloads-handler-refactor` designed (delegated) + design-reviewed (1 cycle,
  *approve*; review confirmed the second payload site at `main.js:981` and endorsed routing it through the
  shared builder + passing `item` whole). Implemented by a Developer agent → `landed`. 950 tests pass
  (byte-identical behavior backstop held). `legs_completed = 4/6`. Next: leg 5 `app-icon` (also touches
  `main.js`, but the BrowserWindow-icon region `:256`, disjoint from leg 4's `:540`/`:981` — sequenced
  after leg 4 to avoid same-file implementation conflict).
- **2026-06-20** — Leg 5 `app-icon` — operator resolved the icon-resolution Open Question ("Ship 761 now",
  see Decisions Log). Designed (delegated) + design-reviewed (1 cycle, *approve*, no issues). Implemented
  by a Developer agent → `landed` (pure asset swap, staged via `git mv -f`). 950 tests pass.
  `legs_completed = 5/6`. Last autonomous leg is 6 `verify-and-behavior-tests`.
- **2026-06-20** — Leg 6 `verify-and-behavior-tests` designed (delegated) + design-reviewed (1 cycle,
  *approve*; review verified all reconcile targets + the per-row disposition + the feasibility split, and
  recommended treating the HAT leg as **non-optional** for this flight since it's the sole home for SC10
  visual verification, the app-icon eyeball, AND the deferred PART-D/a11y rows). Implemented (deterministic
  subset) by a Developer agent → `landed`; PART D live behavior runs + a11y explicitly deferred to the HAT
  leg. 950 tests pass. `legs_completed = 6/6` (deterministic). **Decision: the `hat-and-alignment` leg is
  treated as NON-OPTIONAL for this flight.** Next: Phase 2d flight-level review + single commit of legs 1-6,
  draft PR, then the HAT leg for live verification (mirrors Flight 5's land→PR→HAT sequence).
- **2026-06-20** — **Phase 2d flight-level review + commit (deferred-commit model).** Reviewer agent
  (Sonnet, fresh context) over ALL uncommitted changes (legs 1-6) → **[HANDOFF:confirmed]**, no blocking
  issues; gates re-run green (`npm test` 950 pass, typecheck + lint clean). Two non-blocking latent notes,
  **accepted** (recorded for debrief, not fixed — neither manifests): (1) the open-path `requestAnimationFrame`
  in `slidePanel` isn't tracked in `slideState` so a same-frame open-then-close on one panel could desync —
  reviewer traced every wired call site and confirmed this sequence is **not reachable** through the UI;
  (2) `buildDonePayload` reads `filename` from `getSavePath()` at done-time vs the original register-time
  capture — byte-identical in practice (Electron keeps savePath stable post-`setSavePath`). Legs 1-5 →
  `completed`; leg 6 stays `landed` (PART-D live ACs complete in HAT); legs 1-5 + leg-6-deterministic
  checked off in `flight.md`; flight stays **`in-flight`** (→ `landed` after HAT). Committing legs 1-6 +
  artifacts; draft PR to follow. `[COMPLETE:leg]` ×5 (legs 1-5).

### Leg Progress

#### Leg 1 — `side-panel-animation` (2026-06-20, Developer)

**#27-mechanism option chosen: (a-i) JS-sequenced discrete width swap synced to a `transform` slide.**
Preserves the existing beside-content flex layout (no overlay relationship change) and satisfies "box
released at rest" (AC3). The (a-ii) overlay fallback was **not** needed — (a-i) sequences cleanly across
open AND close, so no Divert/descope was invoked.

**Files changed:**

- **`src/renderer/styles.css`** — `#media-panel` (`:606-621`) and `#privacy-panel` (`:1028-1043`): replaced
  the `transition: width 0.18s, margin-right 0.18s` with `transition: transform 0.18s ease; will-change:
  transform`. The vestigial `margin-right` transition was removed (no rule set a non-zero margin-right).
  `.collapsed` now carries `transform: translateX(100%)` and **no longer sets `width:0`** — width is owned
  by the JS `slidePanel()` so the box can be present (360px) while the transform plays, then released to 0
  at rest. `overflow:hidden` + `border-left:none` on `.collapsed` preserved (AC4 belt-and-suspenders;
  `box-sizing:border-box` already makes a `width:0` panel truly 0). Reduced-motion block (`:1544-1553`)
  **unchanged** — confirmed by inspection it still matches `*` and reduces the new `transform` transition
  to 0.01ms (so `transitionend` still fires for the width-release; AC6).
- **`src/renderer/renderer.js`** —
  - Added the shared **`slidePanel(el, show, { beforeReveal })`** helper (before `togglePanel`). It owns
    ONLY the width-write / reflow-read / class-flip / guarded-`transitionend`-width-release. Open: set
    `width:var(--panel-w)` while `.collapsed` (off-screen) → run `beforeReveal` (pre-paint populate) →
    `void offsetWidth` reflow read → `requestAnimationFrame` removes `.collapsed` so only `transform`
    animates. Close: add `.collapsed` → release `width:0` on `transitionend`. **All three AC11 guards**
    implemented: (i) `propertyName === 'transform'` + `e.target === el`; (ii) `release()` re-reads live
    `.collapsed` state before writing width (a re-open that landed first wins); (iii) a `WeakMap`-tracked
    fallback `setTimeout(SLIDE_MS+60)` releases the box if `transitionend` never fires, and a new toggle
    cancels the prior pending end/timer so a stale close can't release width under a fresh open.
  - Seeded the at-rest collapsed inline `width:0` on both panels at module load (they boot `.collapsed` in
    `index.html`; since `.collapsed` no longer carries `width:0`, this keeps `#webviews` full-width on first
    paint — AC3).
  - Routed **all four** collapse/expand call sites through `slidePanel`: `togglePanel` (`slidePanel(els.panel,
    show)`), `togglePrivacy` (open: `slidePanel(…, true, {beforeReveal})`; close branch restructured to call
    `slidePanel(…, false)` then the focus guard), `closePrivacyPanel` (`slidePanel(els.privacyPanel, false)`),
    and the two mutual-close calls inherit it via `togglePanel(false)` / `closePrivacyPanel()` (AC11). The
    `aria-expanded` / `.active` / focus-restoration `.hidden`-guard logic stayed in the toggle functions —
    NOT folded into `slidePanel`.
  - **Prong B:** split `renderPrivacy()` into `renderPrivacy()` (badge + the load-bearing `.collapsed`
    early-return for event-driven callers) delegating to a new **`populatePrivacy()`** (the unguarded
    `#privacy-body` rebuild). The privacy open path passes `populatePrivacy` (+ `updatePrivacyBadge`) as
    `slidePanel`'s `beforeReveal`, so content is built in the pre-paint window (width set, still off-screen)
    BEFORE the slide reveals it — no empty body, no mid-slide rebuild (AC7). The `.collapsed` guard on
    `renderPrivacy` is intact, so net/permission/shields-config/tab-nav events still no-op on a closed panel
    (AC9).

**Cookies defer-vs-delta-patch choice: DEFER** (the spec's preferred minimal option). `fetchCookies()` is
no longer called synchronously in the open path; it is scheduled via `setTimeout(fetchCookies, SLIDE_MS+20)`
so its async `renderPrivacy()` re-render (the "Loading…" → count swap) lands after the slide completes, at
rest, never mid-slide (AC8). First paint shows "Loading…" already placed by the pre-slide populate. The
no-wcId early-return in `fetchCookies` is untouched (deferring doesn't break the internal/no-cookie path).
Delta-patching the Cookies section was not pursued — defer is the minimal correct change.

**Media path** (`togglePanel`) is functionally unchanged beyond sharing `slidePanel`; it has no content
rebuild, so no Prong-B work. Mutual exclusion and focus/aria/Escape behavior preserved.

**Test outcomes:** `npm test` → **938 pass / 0 fail** (867 named subtests across 12 suites; ~1.0s — no unit
coverage added or removed by this renderer-chrome leg, this was a regression check). `npm run typecheck` →
**clean** (exit 0). `npm run lint` → **clean** (exit 0).

**Deferred to HAT:** `npm run a11y` (chrome sweep, AC10) requires a live Electron GUI + MCP admin key and
does **not** run in this headless agent environment — deferred to the `hat-and-alignment` leg / flight-level
verification (expected, per the leg's Verification Steps). The **visual smoothness** criteria (AC5 top-chrome
stationary, AC7 no Shields pop-in, AC8 no mid-slide cookie reflow as *observed motion*) are HAT-verified
there; their code-inspectable halves are satisfied here.

**Deviations from the leg spec:** none material. Minor note for code review: `will-change: transform` is left
permanently set on both panels (the spec marked it optional) — a small standing compositor-layer hint;
acceptable for two always-present panels but flag if the reviewer prefers toggling it. No Divert/descope
needed.

#### Leg 2 — `presskey-schema-hygiene` (2026-06-20, Developer; designed + reviewed in parallel with Leg 3)

**#56/SC9: LANDED.** Flattened the `pressKey` ToolDef `inputSchema` — removed the top-level `anyOf` (the
strict-MCP-rejected combinator), kept `required: ['wcId']` and the "exactly one of name/key" text in the
description. Added a runtime guard in the tool `call` that throws the distinct error
`automation: pressKey requires 'name' or 'key'` when both `name` and `key` are absent (`== null`, so empty
strings still reach the engine's unknown-key throw); it surfaces as an `isError` tool result, not a crash
(`callTool` try/catch `mcp-tools.js:553-562` → `mcp-server.js:357/361/377`). Inverted the two assertions
that pinned the bug (`pressKeySchema.anyOf` now asserted `undefined`; the `withAnyOf` filter now expects
`[]`) and updated their "ONLY sanctioned anyOf" comments. Added a **standing, count-agnostic schema-hygiene
test** asserting no tool's `inputSchema` carries a top-level `anyOf`/`oneOf`/`allOf`/`not`, plus a
both-missing → distinct-error dispatch test (engine not called). Files: `src/main/automation/mcp-tools.js`,
`test/unit/automation-mcp-tools.test.js`. Gates green: `npm test` 940 pass (was 938, net +2), typecheck +
lint clean, `grep -nE 'anyOf|oneOf|allOf' mcp-tools.js` clean. No deviations. Stale tool-count comments
flagged (`automation-mcp-tools.test.js:8` "14 drive tools"→17; `mcp-server.js:328` "24 tools"→27) — owned
by Leg 6 per the flight. Design: 1 review cycle, *approve*.

#### Leg 3 — `settings-cleanup` (2026-06-20, Developer; designed + reviewed in parallel with Leg 2)

**LANDED.** Removed the dead Downloads nav `<li>` + the `<section id="downloads">` placeholder from
`goldfinch://settings` (nav now 5 links, `<main>` now 5 sections); fixed the garbled `#spellcheck-note`
copy to "Enabling spellcheck downloads a one-time dictionary from Google. Reload open tabs to enable."
(id/class unchanged). HTML-only — `settings.js`/`settings.css` untouched (the query-driven scrollspy
self-adjusts). Dangling-ref check clean: `grep -nE 'href="#downloads"|id="downloads"' settings.html` → no
output; the sole remaining `downloads` hit is the legitimate word in the corrected note; no
`downloads`/`spellcheck-note` refs in settings.js/css. Checks: `npm test` 0 fail, typecheck + lint clean
(a transient 2-failure run during the parallel window was Leg 2's mid-edit `mcp-tools.js`, not this leg —
green on the consolidated re-run; see below). Scrollspy live-tracking criterion deferred to HAT/verify.
**Handoff to Leg 6:** `tests/behavior/settings-shell.md:84` lists "Downloads" among the section-nav links
and is *already stale* (omits Automation, miscounts sections) — its reconcile (full nav inventory: 5 links
incl. Automation, 5 sections) is owned by `verify-and-behavior-tests`, not this HTML-only leg. Design: 1
review cycle, *approve*.

#### Consolidated checkpoint after Legs 1–3 (2026-06-20, Flight Director)

Ran a clean consolidated pass after the parallel Leg 2/3 implementations: **`npm test` 940 pass / 0 fail**
(12 suites, ~0.9s), `npm run typecheck` clean, `npm run lint` clean. Legs 1+2+3 coexist green; the transient
flake Leg 3 observed was the expected parallel-run artifact (suite read `mcp-tools.js` mid-edit). Uncommitted
working-tree files match the three legs' scopes exactly: `src/renderer/styles.css` + `src/renderer/renderer.js`
(leg 1), `src/main/automation/mcp-tools.js` + `test/unit/automation-mcp-tools.test.js` (leg 2),
`src/renderer/pages/settings.html` (leg 3). Commit deferred to flight-level per `/agentic-workflow`.

#### Leg 4 — `downloads-handler-refactor` (2026-06-20, Developer)

Extracted the download record + progress/done payload assembly out of `wireDownloadHandler` into a new
electron-free, accessor-injected helper `src/main/downloads-payload.js` (`displayFilename`,
`buildRegisterRecord`, `buildProgressPayload`, `buildDonePayload`; `@ts-check`, path-only; Electron-paused +
filename facts documented at the helper top). Refactored both `main.js` payload sites — `wireDownloadHandler`
(register/updated/done) and the `download-action` pause/resume push — to build via the helper, passing the
live `item` whole as the accessor bag; dropped the now-unused `savedName` local. Behavior-preserving: full
suite stayed green at **950 pass** (940 prior + 10 new helper tests), typecheck + lint clean — the
byte-identical backstop held. The 10 new tests discriminate the two HAT behaviors: filename =
`basename(getSavePath())` with a deduped `" (1)"` name differing from `getFilename()`; `paused = isPaused()`
true AND false while `getState()` returns `'progressing'`; plus done completed→real-savePath vs
non-completed→null and register mime present/absent. **NOTE (intended, safe):** single-source assembly
reduces `item.isPaused?.()` calls 2→1 at both sites (helper computes once, `manager.update` reuses
`payload.paused`); `isPaused()` is a pure getter and output is byte-identical, so this is not a regression.
Second progress site routed through the shared builder (preferred path, not the fallback) — progress shape
now has one definition. Design: 1 review cycle, *approve* (2 [low] notes honored). No deviations.

#### Leg 5 — `app-icon` (2026-06-20, Developer)

Swapped the orphaned `goldfinch_new.png` (761×761 RGBA) in as the app icon via
`git mv -f src/renderer/assets/goldfinch_new.png build/icon.png` — a pure asset swap, zero source/config
change (`main.js:257` BrowserWindow.icon + electron-builder `buildResources: "build"` already consume
`build/icon.png`). Orphan removed in the same staged move; `grep goldfinch_new src/ build/ package.json`
clean. **Dimension decision: option (a) — accept 761×761 as-is** (operator: "Ship 761 now"). Meets the
≥512 hard floor; below the 1024 "ideal" in `build/README.md`, so the largest `.icns` slot will upscale
(mild softness at max size only). **FOLLOW-UP:** a future 1024×1024 master can drop-in replace
`build/icon.png` for pixel-perfect parity at the top size — recorded for a later maintenance pass. Gates
unchanged (asset-only): `npm test` 950 pass, typecheck + lint clean. Window-icon + packaged-installer
visual confirmation deferred (HAT/build-time) to `hat-and-alignment` / a packaged build. **Still-orphaned
flag:** `src/renderer/assets/goldfinch_mono.png` is referenced nowhere (unrelated) — left in place, flagged
for the operator / a future dead-asset sweep, NOT deleted. Design: 1 review cycle, *approve* (no issues).

#### Leg 6 — `verify-and-behavior-tests` (deterministic pass) (2026-06-20, Developer)

Final autonomous leg, run as the deterministic split per the leg's Feasibility recommendation. PARTS A,
B, C-deterministic, and PART-D setup completed by the Developer agent; **PART D live behavior runs +
`npm run a11y` deferred to the operator-driven `hat-and-alignment` leg** (no live Electron GUI / minted
MCP admin key in the headless agent env — consistent with the leg-1/3/5 a11y deferrals).
- **PART A — `downloads-surface.md` hardened (stays `active`):** row 3 SHARPENED into a single-trigger ⇒
  exactly-one-record invariant (`N → N+1`, not `N+2`; distinct id, no duplicate) — the Flight-5
  double-`will-download` regression guard; new REQUIRED Step 6 — same-filename dedup asserting both records
  distinct + the second `savePath` carries the `uniquePath` ` (n)` suffix — the Flight-5 wrong-filename
  guard. Old persistence row renumbered to 7; dedup Variant retired to an optional note.
- **PART B — drift reconciled to live truth:** `settings-shell.md:84` nav inventory → 5 links (Appearance,
  Privacy & Shields, Automation, On startup, About — no Downloads) + 5 sections; tool-count comments →
  live: `spellcheck.md:50` 26→27, `automation-mcp-tools.test.js:8` 14→17 drive (comment), `mcp-server.js:328`
  JSDoc 24→27. AC5 doc-sweep: `docs/mcp-automation.md` + `CLAUDE.md` re-checked — **no drift** (already "27
  tools / 17 drive", pressKey as prose).
- **PART C — deterministic gates GREEN:** `npm test` 950/950 pass (baseline held — comment/spec-only edits),
  typecheck + lint clean. `npm run a11y` deferred to HAT.
- **PART D setup:** pre-wrote `SKELETON-PENDING-HAT-RUN.md` run-logs for downloads-surface,
  page-context-menu, spellcheck with per-row disposition tables pre-listed (downloads 7 rows; page-context-menu
  all 12 RUN; spellcheck rows 1-3/5-plumbing/6 RUN, row 4 + row 5 native-content INCONCLUSIVE-on-WSLg/
  macOS-deferred). No spec flipped draft→active (needs the green live run).
- **Deferred to HAT (recorded, not skipped):** AC7 (a11y), AC8 (downloads re-run), AC9 (page-context-menu →
  active), AC10 (spellcheck → active for runnable rows), AC11 (no-spec-draft), AC12 (evidence). Land inside
  the flight's commit after HAT. Design: 1 review cycle, *approve* (3 [low] notes honored).

#### HAT session — #27/SC10 reverted and deferred (2026-06-20→21, operator-driven)

The operator ran the live HAT (`npm run dev:automation` under WSLg). Sequence:
- **`Ctrl+M` minimizes the window** instead of toggling Media — pre-existing (no custom app menu → Electron
  default menu owns `Ctrl+M`; no page-focus forwarding branch). Out of scope → logged in mission Known
  Issues (operator decision). Not a Flight-6 regression.
- **#27 animation broke on open.** Operator: clicking Media → panel snaps in while the chrome + page content
  "slide in from left to right"; then "a whole third column." Flight Director reproduced live via the MCP
  admin surface (`getChromeTarget` + `evaluate` + `captureWindow`) and diagnosed:
  - The committed leg-1 mechanism (transform + JS discrete-width-swap) snapped (rAF coalescing) and the
    `<webview>` re-rastered on the width reflow → the visible content "slide."
  - A 2nd attempt (absolute overlay) and a 3rd (clipped overlay, `#main { overflow:hidden }`) were tried.
    The clip fixed the **at-rest/boot** state (verified pixel-correct: `body.scrollWidth` 1398, `#main`
    0..1400, both panels off-screen). **But panel *open* still broke**: content shifts/clips, panels
    mis-anchor (the "third column") — even though `getComputedStyle`/`getBoundingClientRect` report the
    boxes correct (`#main` 1..1399, panels `position:absolute right:0`, `#webviews` 1398).
  - **Root cause: the Electron `<webview>` native compositing surface mis-positions when the DOM layout
    changes around it under WSLg** — a native-surface/environment issue, NOT a CSS/DOM bug (boot is correct;
    only layout-change-on-open breaks). Confirmed by the DOM-geometry-correct / render-shifted gap across
    all three mechanisms. Evidence screenshots at `/tmp/gf-hat/*.png` (ephemeral, not committed).
- **Operator decision (2026-06-21): revert #27 entirely, land the other four wins, defer #27.** Leg 01
  reverted in full — `src/renderer/renderer.js` + `src/renderer/styles.css` restored to pre-flight `main`
  (both the committed leg-1 changes and the HAT-attempt working-tree changes); leg 01 → `aborted`; SC10 →
  deferred (not met this flight). `npm test` 950 pass after revert, typecheck + lint clean. #27 carried to
  the macOS/Windows verification pass (where `<webview>` composites differently) / a dedicated flight — see
  mission Known Issues.
