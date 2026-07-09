# Leg: docs-and-spec-cleanup

**Status**: completed
**Flight**: [Conveniences & Event-Seam Re-architecture](../flight.md)

## Objective

Bring the project documentation in line with the post-migration reality: update the stale `<webview>`-era
architecture descriptions in `CLAUDE.md` (adding the freeze-frame pattern, the `capture-active-guest`
chrome-only contract, and the `INTERNAL_PARTITION` import-never-derive rule), fix the drifted
`tab.webview.reload()` citation in `farbling-correctness.md`, and confirm (clarify only if needed) the
`capture-active-guest` comment invariant in `main.js`.

## Context

- **Flight DD3 / recon.** `CLAUDE.md` still describes tabs as `<webview>` elements (`already-satisfied`
  in code since Flight 3, but the docs drifted); `farbling-correctness.md:51` cites a `tab.webview.*`
  call that no longer exists; the `capture-active-guest` comment may already state its invariant.
- **Docs-only leg.** No runtime behavior changes. `npm test`/`typecheck`/`lint` must stay green
  (markdown is not covered by them; the only `.js` touched is a *comment* in `main.js`).
- **Citations must be re-located against CURRENT code.** Legs 1 and 2 already shifted renderer line
  numbers (find-rehome touched `find.js`; active-view-consolidation renamed symbols and swapped 14 sites
  in `renderer.js`). Do **not** trust any pre-shift line number in this leg — re-locate every symbol
  freshly (`grep`/read) and prefer durable symbol-form citations over bare line numbers.
- **Don't double-write.** The `capture-active-guest` comment (`main.js`, the `ipcMain.handle('capture-active-guest', …)`
  block) already explains internal-capture-required + why-it's-not-a-leak. Confirm it states the
  chrome-only / no-exfiltration invariant; only add a clarifying sentence if a gap remains.

## Inputs

- `CLAUDE.md` (repo root) — stale `<webview>` descriptions. As of this leg design, the stale/▷-to-update
  passages are (re-verify line numbers — they are stable in CLAUDE.md but confirm):
  - Architecture **Main** bullet: "guest tabs remain `<webview>` until Flight 3" (~:21).
  - Architecture **Renderer** bullet: "Each tab is a `<webview>`." (~:23).
  - Cross-cutting: "**Webviews run with `contextIsolation:false`** (set in `will-attach-webview`)" (~:27).
  - "**`asar:false`** … so the webview preload loads from disk" (~:28) — **corrected reason (design
    review):** `asar:false` + `files: src/**/*` keeps `src/**/*` as unpacked disk files so the
    internal-page `path.join(__dirname, …)` resolver works in packaged builds (`main.js:62-63`). The
    webview preload is also served from disk this way, but that is no longer the primary reason — reword
    to the internal-pages-resolver reason.
  - The "⚠️ `<webview>` native-surface gotcha — DOM correct ≠ render correct" block (~:33) — **keep the
    lesson** (it is the mission's SC2 discipline and applies verbatim to `WebContentsView`, also a native
    compositing surface); reframe `<webview>` → `WebContentsView`, update the cross-refs.
  - Two-point security: "before a `<webview>` is created" (~:56).
  - Internal-page model: "the internal webview wouldn't see it" (~:65), "the trusted webview's
    `partition` attribute" (~:66), "every web-origin webview keeps …" (~:72), "**The internal webview
    runs context-isolated + sandboxed.** `will-attach-webview` branches on `params.partition === …`"
    (~:75) — `will-attach-webview` is **gone**; internal prefs are now set at construction on the
    main-process view per the `tabCreate { trusted:true }` path.
    "calls `existing.webview.loadURL('goldfinch://settings/#privacy')`" (~:78) — now a `wcId`-addressed
    `tabNavigate`/loadURL path.
  - DevTools: "detached only — `<webview>` guests can't host docked DevTools" (~:104) — **corrected
    (design review):** still `mode:'detach'`, but the real reason is that in-window docked DevTools via
    `setDevToolsWebContents` is a BACKLOG item (not yet implemented); detached is the shipped mode.
    Reword CLAUDE.md AND the `devtools.js` JSDoc (~:26-27) accordingly.
  - Chrome view `webviewTag` (~:31): "the `webPreferences`/`webviewTag` live on the chrome view" — the
    chrome `WebContentsView`'s `webPreferences` no longer carries `webviewTag` (guests are explicit
    views); drop the `webviewTag` claim, don't just reword it.
  - Preloads bullet: clarify `webview-preload.js` is now injected via the web-branch view's
    `webPreferences.preload` at construction (not a `<webview>` `webpreferences` attribute).
  - "~:65 internal webview wouldn't see it" — the substance (session-scoped `protocol.handle`) is still
    accurate; replace "internal webview" with "internal `WebContentsView`" (served from the dedicated
    internal session), no broader rewrite needed.
- `tests/behavior/farbling-correctness.md` — the New Identity variant (~:51) cites `tab.webview.reload()`
  / `renderer.js:1756` and `newIdentity()` / `renderer.js:1750`. **Verified current symbols (design
  review):** `newIdentity()` now lives at ~`renderer.js:2310`; it calls
  `window.goldfinch.identityNew({ partition: tab.container.partition })` (IPC `identity-new`, main
  handler ~`main.js:1678`) then reloads via `window.goldfinch.tabNavigate({ wcId: tab.wcId, verb: 'reload',
  args: [] })` (~`renderer.js:2317`). No `tab.webview.reload()` exists anywhere. Fix the spec's citation
  to the `tabNavigate` reload (symbol-form), and re-verify the `newIdentity()` and `webview-preload.js`
  `SEED` citations (webview-preload.js untouched by Legs 1-2, so its `SEED` lines are likely stable —
  grep-confirm).
- `src/main/main.js` — the `capture-active-guest` handler + its comment (confirm invariant); **plus two
  stale code comments** referencing removed machinery: ~`:1367` ("matching will-attach-webview's
  internal branch") and ~`:1397` ("see will-attach-webview for the web branch") — `will-attach-webview`
  is gone; reword to the construction-time `tab-create` branch framing (comment-only, lint-safe).
- `src/main/devtools.js` — the `mode:'detach'` JSDoc (~:26-27) still blames "`<webview>` guests have no
  native host region for docked DevTools." Reword to the accurate current reason (comment-only).

## Outputs

- `CLAUDE.md` describing the WebContentsView tab surface accurately, with the freeze-frame pattern, the
  `capture-active-guest` chrome-only contract, and the `INTERNAL_PARTITION` import-never-derive rule
  documented.
- `farbling-correctness.md` New Identity variant citing the real current reload path.
- `capture-active-guest` comment confirmed (or minimally clarified) to state its chrome-only /
  no-exfiltration invariant.
- `grep -rn "<webview>" CLAUDE.md` returns only intentional historical references (if any), not
  present-tense architecture claims.

## Acceptance Criteria

- [x] Every stale present-tense `<webview>` architecture claim in `CLAUDE.md` (the passages above)
  rewritten to describe per-tab `WebContentsView`s constructed in main (no `will-attach-webview`, no
  `webviewTag`-attribute framing). Genuinely historical references (e.g. "until Flight 3", removed
  machinery) may remain as past-tense history but must not read as current.
- [x] `CLAUDE.md` gains a **freeze-frame pattern** description: opening a chrome menu captures a still
  of the active guest into `#webviews` `backgroundImage`, hides the live view (`tabHide`), so HTML chrome
  composites above; dismiss restores via `tabSetActive`. (Single source: `freezeGuest`/`unfreezeGuest`
  in `renderer.js`.)
- [x] `CLAUDE.md` documents the **`capture-active-guest` chrome-only contract**: the only caller is the
  trusted chrome renderer's freeze helper; it captures a page the chrome already displays; it is not an
  automation op and crosses no trust boundary (so internal capture is permitted there).
- [x] `CLAUDE.md` documents the **`INTERNAL_PARTITION` import-never-derive rule**: the partition string
  is single-sourced in `src/shared/internal-page.js` and must be imported byte-for-byte by both main and
  renderer, never re-derived/retyped. (Reconcile with the existing "single-sourced" note at ~:66 — fold,
  don't duplicate.)
- [x] `farbling-correctness.md` New Identity variant cites the real current reload call (re-located
  symbol-form), not `tab.webview.reload()`; the `newIdentity()` citation re-verified.
- [x] `capture-active-guest` comment in `main.js` confirmed to state the chrome-only / no-exfiltration
  invariant (clarifying sentence added only if a gap is found; otherwise left as-is and noted in the
  flight log).
- [x] Bounded stale-code-comment sweep: the two `will-attach-webview` comments in `main.js` (~:1367,
  ~:1397) and the `<webview>`-detach JSDoc in `devtools.js` (~:26-27) reworded to current framing
  (comment-only — no code/behavior change). (Scoped to exactly these three; not an open-ended sweep.)
- [x] `npm test` / `npm run typecheck` / `npm run lint` still green (the only `.js` changes are comments).
- [x] `grep -rn "will-attach-webview\|webviewTag" CLAUDE.md` returns nothing present-tense; the
  `will-attach-webview` comments in `main.js` no longer reference removed machinery as if current.

## Verification Steps

- Read each rewritten `CLAUDE.md` passage against current code (`main.js`, `renderer.js`,
  `internal-page.js`) and confirm accuracy.
- `grep -rn "<webview>" CLAUDE.md` and `grep -rn "tab\.webview" tests/behavior/farbling-correctness.md`
  → no stale present-tense / dead-symbol references.
- `npm test && npm run typecheck && npm run lint` → green.

## Implementation Guidance

1. **Re-locate before editing.** For every renderer/main symbol referenced (`freezeGuest`,
   `unfreezeGuest`, `tabSetActive`, `tabHide`, `newIdentity`, the reload call, `capture-active-guest`,
   `INTERNAL_PARTITION`), grep current code to get the real location/shape — Legs 1–2 moved lines.
2. **CLAUDE.md `<webview>` sweep.** Rewrite each stale passage to the WebContentsView reality. Preserve
   the security model's substance (the four gates, trusted-embedder model, internal session) — only the
   *mechanism* wording changes (`will-attach-webview` branch → construction-time `webPreferences` on the
   main-process view keyed off the `tabCreate { trusted }` arg). Keep the "DOM correct ≠ render correct"
   gotcha block — reframe to `WebContentsView`, it is now MORE relevant (it underpins the two new
   behavior specs). Update its self-referential cross-ref (the old DevTools-docking example is now
   circular); cite the **freeze-frame** path introduced in this flight as the canonical current example.
3. **Add the three new doc notes** (freeze-frame, capture-active-guest contract, INTERNAL_PARTITION
   rule) in the most fitting existing sections (e.g. freeze-frame near the menu/`menuController`
   discussion; the capture contract near the freeze-frame note; the partition rule folded into the
   existing internal-session "single-sourced" bullet). Describe destinations semantically; do not
   invent rigid new headings if an existing section fits.
4. **farbling-correctness.md citation.** Replace the `tab.webview.reload()` (`renderer.js:1756`)
   reference with the real `wcId`-addressed reload the current `newIdentity()` triggers; re-verify the
   `newIdentity()` and `webview-preload.js` `SEED` citations are still accurate (update if drifted).
5. **capture-active-guest comment.** Read the current comment; if it already states chrome-only +
   no-exfiltration (it appears to), leave it and record "already correct" in the flight log. If the
   "Leg 3 HAT fix"/"after Leg 3" references read as confusingly current, optionally clarify they are
   *Flight-3* history — but do not rewrite a correct comment for its own sake.

## Edge Cases

- **Historical vs current tense.** Some `<webview>` mentions are legitimately historical (migration
  history, removed machinery). Convert only present-tense *architecture claims*; keep accurate history as
  past tense. Do not scrub the word `<webview>` indiscriminately.
- **Don't duplicate the partition rule.** CLAUDE.md already has a "single-sourced" `INTERNAL_PARTITION`
  bullet — extend it with the import-never-derive emphasis rather than adding a second, divergent note.
- **Lint scope.** ESLint runs over `.js`; the `main.js` comment edit must not change code. Markdown is
  not linted — but keep CLAUDE.md internally consistent (no contradictory old/new claims left side by
  side).

## Files Affected

- `CLAUDE.md` — `<webview>` → WebContentsView sweep + three new doc notes.
- `tests/behavior/farbling-correctness.md` — New Identity reload citation fix.
- `src/main/main.js` — `capture-active-guest` comment (confirm; clarify only if needed); two
  `will-attach-webview` code comments (~:1367, ~:1397) reworded.
- `src/main/devtools.js` — `mode:'detach'` JSDoc reworded to the BACKLOG-item reason.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[HANDOFF:review-needed]`** *(deferred-commit model — do NOT
commit per-leg):*

- [x] All acceptance criteria verified
- [x] Tests passing (`npm test` / `typecheck` / `lint`)
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed`
- [ ] Check off this leg in flight.md (deferred — orchestrator handles at commit time)

---

## Citation Audit

Citations are described **semantically** in this leg (symbol-form) precisely because Legs 1–2 shifted
renderer/main line numbers; the implementing Developer re-locates each against current code (step 1).
The approximate CLAUDE.md line anchors (`~:21,23,27,28,33,56,65,66,72,75,78,104`) were verified present
at leg design time but are advisory — CLAUDE.md content is matched by passage text, not line number.
`tests/behavior/farbling-correctness.md:51` (`tab.webview.reload()`) and the `capture-active-guest`
handler/comment in `main.js` verified present at design time.
