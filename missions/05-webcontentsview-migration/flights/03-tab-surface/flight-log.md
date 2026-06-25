# Flight Log: Tab Surface

**Flight**: [Tab Surface](flight.md)

## Summary

Planning baseline. Flight 3 migrates guest tabs (web **and** internal — DD0 operator decision) from
`<webview>` to per-tab `WebContentsView`s. Spec authored from the Flight-1 spike's carried approaches +
the Flight-2 debrief's forward-looking recommendations, code-interrogated against current `src/main` and
`src/renderer` state. Awaiting Phase-5b Architect design review (the DD5 geometry question is explicitly
routed there) before the flight goes `ready`.

---

## Reconnaissance Report

Source artifacts: the **Flight-2 debrief** forward-looking recommendations/action-items and the **Flight-1
debrief** carried approaches. Each item walked against current code (post-Flight-2 merge,
`mission/05-webcontentsview-migration`).

| Source item | Classification | Evidence (file:line) | Disposition in F3 |
|---|---|---|---|
| F2-debrief Rec 1 / F1 Rec 1: extend the seam — `getTabContents`/`getActiveTabContents` alongside `getChromeContents` | confirmed-live | `getChromeContents()` accessor exists (`main.js` Flight-2 DD2); no tab accessor yet | DD2; Leg 1 |
| F1 Rec 1: one-view-per-tab + `setVisible`; per-tab `webPreferences` at construction | confirmed-live | current show/hide is renderer CSS `.hidden` (`renderer.js:811`); per-tab prefs set by `will-attach-webview` (`main.js:330–346`), which won't fire for constructed views | DD1/DD3; Legs 1–2 |
| F2-debrief Rec 2: remove `webviewTag:true` + `will-attach-webview` once tabs are views | confirmed-live | `webviewTag:true` at `main.js:297`; hook at `main.js:330–346`; `getType()==='webview'` filter at `main.js:411` | DD4; Leg 3 (gated on Leg 2) |
| F2-debrief Rec 2: revisit `download-media` fallback (`wc \|\| getChromeContents()` → active-tab) | confirmed-live | `main.js:549` `const downloader = wc \|\| getChromeContents()` | DD7; Leg 3 |
| F2-debrief Rec 3: run security-identity specs FIRST + full F2-deferred corpus at HAT | confirmed-live | `tests/behavior/internal-session-exclusion.md`, `mcp-jar-scoping.md` present; F2 corpus deferred | DD-verification; Leg 4 |
| F1 Rec 1 / mission OQ: `contextIsolation:false` farble on directly-constructed views | already-de-risked (spike) | spike probes 6a/6b passed (F1 debrief); preload `webview-preload.js`, seed `main.js:1150–1163` | DD10; Leg 1 |
| F2-debrief Rec 1: carry the `isDestroyed()` wrong-object guard lesson | confirmed-live | F2 guard-conversion landed on chrome sends; tab sends are new | DD2 (guard the real send target); Legs 1–2 |
| F2-debrief Key Learning 5 / F1 Rec 4: name the accumulating macOS-unverified (DD5) risk | confirmed-live | no in-loop mac venue (mission Constraint) | DD9; carried, resolved at Flight 6 |
| F2-debrief Rec 5 / Action: update `responsive-tab-strip` spec (`evaluate()` reads, WSLg fallback, fixture-distinctness probe) | confirmed-live (deferred) | `tests/behavior/responsive-tab-strip.md` still asserts "no in-page numeric read" | NOT this flight — next behavior-test authoring pass; run as-is at Leg 4 |
| **NEW (this flight's code interrogation): `captureWindow` goes guest-blind when guests become sibling views** | confirmed-live | `observe.js:214` `chromeContents.capturePage()`; F1 spike Leg 1 proved per-view capture is sibling-blind | DD11 (forced into F3); Leg 1 |

**Recon outcome**: every source item is `confirmed-live` work for this flight or an explicit defer
(`responsive-tab-strip` spec rewrite → next authoring pass; broad MCP parity → Flight 5). One **new**
forced item surfaced during code interrogation (DD11 `captureWindow`) that no source artifact had named —
the tab-surface change breaks the whole-window composite capture. No items were retired as
`already-satisfied`.

---

## Leg Progress

_(none yet — flight in planning)_

---

## Decisions

### DD0 — Pull internal-page migration forward into Flight 3
**Context**: `webviewTag`/`will-attach-webview` removal (debrief Rec 2) requires that **no** tab be a
`<webview>`; the mission originally slated internal pages for Flight 5.
**Decision**: Operator chose to migrate **both** web and internal tabs in Flight 3 (AskUserQuestion,
2026-06-25), so the machinery is removed in one flight rather than across a two-flight hybrid.
**Impact**: Flight 3 is larger and touches the security-critical internal trust boundary; **Flight 5
shrinks to the automation (MCP) parity sweep**. Mission Flights list updated accordingly (traceability
note added there, original framing preserved as commentary).

### DD5 geometry — routed to Architect
**Context**: Per-tab-view bounds need a layout source; the renderer owns the chrome layout incl. the #27
panel sibling-resize.
**Decision**: Operator routed the renderer-measures-sends vs. main-computes-from-insets choice to the
Phase-5b design-review Architect rather than fixing it at interview. Spec records renderer-measures-sends
as the recommended approach and a divert trigger if rejected.
**Impact**: Leg 1 geometry locks only after the Architect confirms.

---

## Deviations

_(none yet)_

---

## Flight Director Notes

- **Planning inputs**: mission.md, Flight-1 debrief (carried approaches), Flight-2 flight.md +
  flight-log.md + debrief (DD patterns, accessor seam, grep gate, `isDestroyed()` lesson). Code
  interrogation via an Explore agent (full tab/`<webview>` architecture map, file:line) + direct reads of
  the two security seams (`will-attach-webview` `main.js:330–346`; `web-contents-created`
  `main.js:410–520`) and the capture path (`observe.js:212–214`).
- **Crew interview**: four forks put to the operator — tab scope (→ both, DD0), geometry (→ Architect),
  event boundary (→ tab-strip essentials only, DD6), verification (→ guided HAT, security-identity first,
  lean on corpus, no new spec).
- **Phase-5b Architect design review** (Sonnet, against the real codebase): **approve with changes.**
  Verdict: spec well-grounded; every DD traced to real code; two structural issues + DD5 details to fix
  before legs lock. Incorporated (one cycle — substantive but unambiguous, no second review needed):
  - **[HIGH] predicate-swap sequencing** — a directly-constructed `WebContentsView`'s
    `webContents.getType()` returns `'window'`, not `'webview'` (Architect-confirmed, Electron #44972), so
    the `web-contents-created` `getType()==='webview'` filter (`main.js:411`) must swap to a
    registry-membership predicate **in Leg 1** (when tab views first exist), or tab views get none of the
    popup/nav-guard/zoom/devtools/context-menu wiring — a silent dropped-guest regression. Moved DD4's
    predicate half into Leg 1; Leg 3 keeps only `webviewTag`/`will-attach-webview` deletion.
  - **[MEDIUM] convenience callsites** — DD6's "conveniences stay on their current path" was wrong: their
    path *is* the `<webview>` element Leg 1 deletes. Re-specified: find / media-rescan / privacy-stream
    callsites go **guarded-inert** in Leg 1, re-homed in F4. Named the three temporarily-dark features
    (in-page find, media-panel rescan, privacy counters) + flagged the media-panel-dark transient to the
    operator.
  - **[MEDIUM] DD7 download-media** → moved into Leg 1 (depends only on `getActiveTabContents`; deferring
    leaves a wrong-jar download window).
  - **[LOW] DD3 web spellcheck** — construct web views WITHOUT a `spellcheck` key (inherit default); the
    session-layer `applySpellcheck` owns the live toggle. **[LOW] DD6a** — per-tab Shields attribution
    keys off `webContentsId`+session, survives; noted for `core-browsing-shields`.
  - **DD5 geometry: ACCEPTED renderer-measures-sends** (divert did not fire) — the panels are flex
    siblings that reflow `#webviews` (`styles.css:526–616`), so only the renderer knows the post-reflow
    rect. Five apparatus requirements made load-bearing and folded into DD5/Leg 1: **DPR→DIP scaling**
    (`getBoundingClientRect` CSS-px vs `setBounds` DIP — test at DPR≠1), initial-bounds seed,
    set-bounds-before-reveal ordering, debounce strategy as a decision, in-`#webviews` overlay occlusion
    caveat.
- **Operator flag (carry to execution)**: the F3/F4 scope boundary leaves the **media panel's live rescan
  dark for one flight**. The operator chose "F3 = tab-strip essentials only"; the going-dark cost surfaced
  only at Architect review. If unacceptable, the minimal `rescan-media`/`found-in-page` send-target
  re-point can be pulled into F3 without the full F4 event-seam rewrite — operator's call at flight start.
- **Next step**: operator go-ahead → create `flight/03-tab-surface` off the mission branch, set flight
  `ready`, begin Leg 1 via `/agentic-workflow`.
