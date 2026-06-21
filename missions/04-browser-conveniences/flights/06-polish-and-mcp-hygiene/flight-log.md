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
