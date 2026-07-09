# Flight Log: Side-Panel Slide Composition (#27 / SC10)

**Flight**: [Side-Panel Slide Composition](flight.md)

## Summary

Planning began 2026-07-06. Focused SC7/#27/SC10 flight, inserted as Flight 9 (operator decision) —
the mission's tentative plan folded panel work into Flight 6 (bundled with parity-sweep + land); this
is the panel-slide piece pulled out as a small, verify-first flight, matching the F7/F8 insertion
pattern. **In flight as of 2026-07-06** on branch `flight/09-panel-slide-composition` off the mission
branch. Two legs + one conditional: `01-slide-probe` (autonomous MCP probe + `panel-slide` Witnessed
run, CP1 gate) → `02-hat-and-certify` (interactive HAT, CP2) → `03-fix-slide` (conditional,
pre-authorized). Batch model: single flight-level review + commit after the last autonomous leg;
Leg 2 (HAT) is operator-guided, not spawned.

---

## Reconnaissance Report (Phase 1b)

Source: the mission's SC7 + Mission-04 Flight-6 (`missions/04-browser-conveniences/flights/06-polish-and-mcp-hygiene/`)
#27 record.

| Item | Classification | Evidence | Recommendation |
|------|----------------|----------|----------------|
| #27 = side-panel **overlay** over guest? | `already-refuted` | The M04 record is explicit: "#27 — side-panel open-**animation** glitch; `#media-panel` animates `width 0.18s` + `margin-right`; both `.collapsed {width:0}`." Not overlay-vs-inset. | Framed correctly as the slide animation (DD1). |
| M04 `slidePanel`/transform-composited fix | `reverted` | `togglePanel` (`src/renderer/renderer.js`) now only toggles `.collapsed`; no `slidePanel`/`slideState`/`beforeReveal` in source (grep-clean). The transform machinery was reverted at the M04 Flight-6 HAT (mission Context: "three CSS mechanisms failed identically"). | Current state = plain CSS `width 0.18s` slide (`styles.css:558-560`) + per-frame guest re-bound via the `#webviews` `ResizeObserver` → `sendActiveBounds` (`renderer.js:2614`, `:937`). This is what Leg 1 verifies on the native surface. |
| F1 spike SC7 prediction | `needs-live-verify` | Mission Flight-1 line: "#27 mis-composite does not reproduce under native views; SC7 looks free." | The premise this flight tests; not yet verified on the shipped surface since the M04 revert. |
| Privacy-panel asymmetry (M04) | `confirmed-live-risk` | M04 log: "Media smooth, Shields glitches, despite identical CSS — Shields content population *during* the slide." | DD3: exercise privacy WITH populated body. |

**Current panel mechanism (verified in source, 2026-07-06):** `#media-panel`/`#privacy-panel` are
`flex:none` chrome-DOM siblings of `#webviews` in `#main` (`display:flex`); `.collapsed {width:0}` →
`width: var(--panel-w)` (360px) with a `width 0.18s` CSS transition; the `#webviews` `ResizeObserver`
fires `sendActiveBounds()` (debounced one-shot rAF) which re-bounds the active guest to
`measureWebviewsSlotDIP()` as the slot resizes. No overlay view involved. **Chrome view is opaque and
below the guests** (`main.js:860/863` add chrome first, `#1e1f25`; guests added after) — which is why
panels must inset, not overlay (DD1). No source changes required unless Leg 1/2 find a glitch (Leg 3).

---

## Flight Director Notes

### 2026-07-06 — Flight planning

- Operator clarified the intent: panels must **compress the content side-by-side, not overlay it** —
  which reframed the flight entirely (my initial framing offered the overlay migration, which the
  operator does not want). #27/SC10 confirmed via the M04 record to be the **slide animation**
  smoothness, not overlay-vs-inset — a much smaller, better-aligned flight.
- Decisions: **focused Flight 9 (panel-slide only)** (defer F5 parity + macOS + land);
  **verify-and-certify (minimal)** — fix only if a glitch surfaces.
- Scope kept to CSS/animation + guest-bounds-sync; no overlay view, no shared-overlay-base extraction
  (that F8-debrief item is unrelated and stays a separate maintenance concern).
- `panel-slide` Witnessed spec drafted (status draft) — settled-state compositing net; smoothness is
  HAT-authoritative (DD4 apparatus limit).

---

## Flight Director Notes

### 2026-07-06 — Flight start + Leg 1 design

- Flight `ready` → `in-flight`; branch `flight/09-panel-slide-composition` off the mission branch.
  Crew file `leg-execution.md` validated this session (F8, unchanged).
- Leg 1 (`01-slide-probe`) designed: autonomous **probe** (no source changes) — run the
  `panel-slide` Witnessed spec + capture settled-state frame/geometry evidence, CP1 gate. This is an
  **FD-driven behavior-test leg** (like a HAT): the FD brings up the apparatus and invokes
  `/behavior-test panel-slide` directly per the agentic-workflow behavior-test rule; no autonomous
  Developer is spawned for implementation.
- Developer design review: **approve with changes** — zero highs; all 10 citations verified exact
  (`box-sizing:border-box` confirms the 360px Δ includes the 1px border — no off-by-one), the
  no-DEV_MINT standing-key launch confirmed correct (`main.js:2449` requires both flags to mint),
  and the DD3 privacy-false-pass premise confirmed against `renderPrivacy` (early-returns only when
  collapsed; `Trackers`/`Third-party domains` `.ps-big` stats readable + async). Applied: [med]
  "mid-slide geometry" over-promised → reworded to settled-state objective + best-effort
  non-authoritative coarse mid-frame (true smoothness = HAT); [med] added an explicit CP1
  "objective net INCOMPLETE" outcome (privacy-deferred / capture-BLOCKED) that hands Leg 2 the
  missing *objective* settled-composite checks, not just smoothness; [low] privacy stat is async →
  load/refresh before asserting; [low] stale-key fallback + CLAUDE.md-divergence cross-note; [low]
  npm gates baseline against HEAD (no NEW failures). Suggestions folded (exact stat titles;
  keyboard-toggle path explicitly Leg-2-HAT scope, not objectively covered here).
- FD call: prescribed clarifications applied faithfully, no new design surface → second cycle
  skipped. Leg 1 → `ready`.

---

## Leg Progress

### 2026-07-06/07 — Leg 1 (`01-slide-probe`) — landed

**CP1 verdict: PASS — objective net COMPLETE + CLEAN. Certify candidate for the Leg-2 HAT.**

- FD-driven behavior-test leg (no autonomous Developer). Apparatus: standing `goldfinch-development`
  MCP → dev instance on 49252, launched plain (`GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_MCP_PORT=49252
  npm run dev:automation`, NO `DEV_MINT` — the hash-persisted key held; zero re-mint confirmed).
- **AC1 PASS** — wiring litmus (chrome wcId 1, this instance's tabs) + **OS-grab capture canary**
  (find bar visible in pixels → NOT the WSLg fallback). Network confirmed up (real tracker page
  reachable).
- **AC2 PASS** — `/behavior-test panel-slide` ran **6/6 PASS** (live two-agent Witnessed; Executor
  `afe73252b9f2fd693`, Validator `ac24f63dbc5cae3a3`). Settled compositing clean across baseline →
  media compress → restore → privacy-on-real-page → cross-switch → return. Run log:
  `tests/behavior/panel-slide/runs/2026-07-07-00-17-13.md`.
- **AC3 PASS** — guest genuinely re-bounds: any single panel open compresses `#webviews` 1398→1038
  (Δ **exactly −360** = the 360px panel width); every close returns byte-identical to baseline;
  cross-switch held 1038 (single-panel, no double-inset). Flush on pixels (no gap/overlap); the
  cream-fixture reflow tell (scrollbar + clipped line appear under compression, vanish on restore)
  independently proved re-layout, not overlay.
- **AC4 PASS** — objective net **complete** (privacy NOT deferred — cnn.com fired real blocked
  trackers: Trackers=3, Third-party domains=16, read from live `.ps-big` DOM) and **clean** (no
  gross tear/gap in any settled frame). Outcome (a): certify candidate. Handoff to Leg 2:
  **inter-frame smoothness** (the no-tear-during-the-0.18s-slide call) is HAT-only and NOT covered
  here; the **keyboard-toggle re-bound path** (Ctrl+M / Ctrl+Shift+P, observer-only, DD6) is also
  NOT objectively covered — both are Leg-2 HAT scope. Two Validator spec-quality flags folded into
  the spec post-run: step 2 (cream fixture) is the PRIMARY flush-seam assertion (dark-on-dark real
  pages are less crisp); the real-page step is network-dependent (INCONCLUSIVE, not fail, if offline).
- **AC5 PASS** — no `src/`/`scripts/` diff (only artifacts + the run log); `npm test` 1050/1050,
  typecheck + lint clean (probe touched no source).
- Evidence: `/tmp/behavior-tests/goldfinch/panel-slide/2026-07-07-00-17-13/` (per-step JSON
  sidecars; rendered frames were Validator-side captures — the F8 captureWindow-inline-PNG limit
  recurred, noted for the apparatus carry-forward). The `panel-slide` spec stays `draft` until the
  Leg-2 HAT certifies (per the leg).
- **F1 "SC7 looks free" prediction CONFIRMED on settled compositing.** The smoothness half is the
  HAT's; CP1 gives it a strong green baseline.

---

## Decisions

*(none yet)*

---

## Deviations

*(none yet)*

---

## Anomalies

*(none yet)*

---

## Session Notes

### 2026-07-06 — Planning

- Flight spec + `panel-slide` behavior spec drafted; recon report above.
- Architect design review: **approve with changes** — zero design flaws; all issues spec/recon
  accuracy. Applied: [HIGH] `panel-slide` step-4 false-passed the privacy-population goal
  (`renderPrivacy` always appends its ~8 sections, so a child-count check on the static fixture is
  trivially true; the real M04 asymmetry is async-populate-during-open, an inter-frame property) →
  reframed to require a **real tracker-heavy page** with a non-zero stat signal + moved the
  async-reflow concern to the Leg-2 HAT (DD3 rewritten). [MEDIUM] transition duration corrected
  `0.2s` → **`0.18s`** in the recon report + spec (the `0.2s` was the unrelated toast bar,
  `styles.css:889`). [LOW] keyboard-toggle path (Ctrl+M/Ctrl+Shift+P at `renderer.js:2354-2360`
  skips the explicit `sendActiveBounds`) → added to the Leg-2 HAT (DD6). Suggestions folded:
  DD6 records the structural ~1-frame guest-bounds IPC lag (why "free" must be earned at CP1/CP2,
  not rubber-stamped, and why Leg 3 is pre-authorized); find/menu-overlay-simultaneous-with-panel
  noted out-of-scope in the spec. Reviewer confirmed DD1 (chrome opaque + below guests → panels
  MUST inset), the M04 revert (grep-clean), and the apparatus on both axes.
- FD call: issues were prescribed accuracy corrections applied faithfully, no new design surface →
  second review cycle skipped. Flight → `ready` (pending operator walkthrough).

### 2026-07-07 — Leg 2 (`02-hat-and-certify`) HAT + Leg 3 (`03-fix-slide`) fix — SC7 CERTIFIED

**CP2 initially FAILED, then resolved by Leg 3. SC7/#27/SC10 CERTIFIED CLOSED.**

- **Leg-2 HAT step 1 reproduced the M04 #27 glitch** "exactly the same" across the migration — on the
  ticking fixture, the media panel slide showed the chrome (toolbar/tabs/controls) transiently
  shrinking to content width then snapping back, and the guest doing likewise. CP2 fail → Leg 3
  (pre-authorized) triggered.
- **Diagnosis (FD + operator, live)** — full write-up in `legs/03-fix-slide.md`. Slowed the CSS
  transition to 2s then 10s (temporary diagnostic edits) and instrumented via `evaluate`: the app
  layout is **provably correct** (toolbar/tabstrip/main rock-solid 1398px, zero horizontal overflow,
  `#webviews` snaps to compressed 1038 at t=0 — the guest does NOT animate; only the chrome panel box
  slides). Operator mid-slide **screenshots** showed the *composited* output is wrong (whole window
  misaligned — chrome ~150px narrow, guest shifted left, panel clipped off the right; operator's
  catch: panel header reaches the edge while the body/scrollbar clip ~90px short). **Root cause:** the
  guest snaps in one step while only the chrome panel box animates — a mismatched half-animation whose
  sustained chrome repaint **mis-composites the native views on WSLg** (DOM-correct, render-wrong).
  Same root cause as M04's three failed mechanisms. It IS a captured render defect (corrected the
  Leg-1 mis-timed "capture stable" reading — captures had landed on settled frames).
- **Fix (Leg 3): remove the panel width animation** — panels open/close instantly
  (`src/renderer/styles.css`, `#media-panel` + `#privacy-panel` transition removed). No animated
  frames → no mid-slide mis-composite. Settled state unchanged + re-confirmed flush (`evaluate`:
  closed 1398 / open 1038 flush / reclosed 1398, no overflow). **HAT re-check: glitch GONE**
  (operator, click + Ctrl+M / Ctrl+Shift+P) — "no glitch and the user experience really doesn't lose
  anything." Gates green (1050 tests, typecheck, lint; a11y N/A — CSS-only).
- **#27/SC10 resolution framing:** the slide was structurally un-composite-able on the native-view
  architecture (guest can't animate in lockstep — it snaps), so M04's goal of a *smooth slide* was
  never achievable. F9 closes #27/SC10 by **retiring the un-animatable slide** — panels composite
  correctly over the live guest at rest (flush, Leg-1 Witnessed 6/6) AND on open/close (instant, no
  mis-composite), on every platform. A better outcome than a slide.
- **`panel-slide` spec promoted `draft` → `active`** (Leg-1 run passed; settled assertions unchanged
  by the fix; the inter-frame-smoothness caveat retired since there's no slide).
- Diagnostic slowdown edits (2s/10s) were superseded by the fix (no transition) — no diagnostic
  residue in `styles.css`.
- Deviation recorded (anticipated fix was "make the slide smooth"; actual fix retires the slide) —
  per the flight's mid-execution-scope-change discipline. CP2 now PASS (glitch gone). Leg 2 →
  completed, Leg 3 → completed.

### 2026-07-07 — DEBRIEF CORRECTION: WSLg was a red herring (operator observation)

- **The in-flight root-cause attribution to "WSLg mis-composites" was WRONG.** At the debrief the
  operator confirmed the **identical panel-slide glitch occurs on the native Windows build**, not
  just WSLg. Combined with "exactly the same as M04" (which ran under `<webview>`), the defect
  reproduces across **both architectures** (`<webview>` → `WebContentsView`) AND **both platforms**
  (WSLg → native Windows).
- **Corrected root cause (platform-independent):** the guest is a **separate compositing surface**
  whose bounds change in **one discrete step** — it cannot animate in lockstep. Animating chrome
  layout that resizes the guest slot produces a chrome-ramps-while-guest-steps mismatch that
  mis-renders the composited frame on **every** platform. WSLg is not the cause; the
  separate-surface-steps-discretely invariant is. This is *stronger* than the WSLg story: it
  explains all four #27 failures (M04's three + F9) under one mechanism and confirms the fix
  (retire the slide) is universally correct — which is why it works everywhere.
- Artifacts corrected accordingly (`flight.md` SC7 line, `legs/03-fix-slide.md` root cause,
  `tests/behavior/panel-slide.md`, the `styles.css` rationale comment, CLAUDE.md invariant). The
  fix and all verification are unaffected — only the *attribution* changed.
- **Methodology caution recorded:** I (FD) over-pattern-matched to WSLg because the two prior
  mission render issues (F7 find cold-start, F8 click-swallow) genuinely WERE WSLg — so a third
  render defect got the same label without a native-platform control. The operator's native-Windows
  observation was the control the crew (running on the WSLg repo) could not perform. Lesson: do not
  attribute a render defect to the rig without a cross-platform control; "the last two were WSLg" is
  not evidence the next one is.
