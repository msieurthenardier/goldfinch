# Leg: verify-integration

**Status**: completed
*(FD citation check in lieu of full design review: chrome-preload
`jarsAdd`/`jarsRename`/`jarsRemove` confirmed at chrome-preload.js:54-56;
admin `click`/`typeText` ops + `allowInternal` engine relaxation confirmed
at mcp-tools.js:268-295 / engine.js:24-46 — the probes' apparatus premises
hold on both the act and observe axes.)*
**Flight**: [Manage-Jars Page Panels](../flight.md)

## Objective

Verify the panel relayout in the real running app — rendered panels,
independent collapse, confirm flows inside regions, focus preservation
across broadcasts, live history count, hash deep-link, scroll-spy — via
the admin MCP apparatus with screenshot evidence, and land any doc
touch-ups. Internal-page DOM is not eval-readable (by design), so the
acceptance signal is **rendered pixels** (captureWindow/captureScreenshot)
plus indirect observables (IPC results, typed-text-lands-in-input pixels).

## Context

- Legs 1–2 landed uncommitted. The apparatus facts from the Flight-1
  behavior-test run apply: launch `npm run dev:automation` with
  `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1
  GOLDFINCH_MCP_PORT=49707`, capture the minted adminKey from stdout, use
  a scripted SDK client (the session MCP tools are jar-tier); admin CAN
  drive (click/type/reload) internal tabs — only the eval ops exclude the
  internal session; `openJarsPage()` / `kebabActionSettings()` /
  `createTab`+`makeBurner` are chrome-evaluate closed-set entries; quit
  via `window.goldfinch.appQuit()` evaluate (the 'other side closed'
  response race is the success signature).

## Verification Procedure (Developer-driven, evidence to /tmp)

1. Launch + connect (as above). Open `goldfinch://jars` via chrome
   evaluate `openJarsPage()`. captureWindow → **all panels collapsed**,
   three disclosure rows per persistent jar, Burner section unchanged
   (no panels), footer shows Wipe + Delete.
2. Click the default jar's History toggle (coordinates from the
   screenshot; the jars tab is admin-drivable). captureWindow →
   region expanded, hint visible, other panels still collapsed
   (independence); the History button label shows a real count
   ("History — N visits", N>0 expected — the dev profile has rows from
   the Flight-1 run).
3. **Live count probe**: with the jars page visible, open/navigate a tab
   in the default jar to any http page (admin openTab/navigate); wait
   ~2s; captureWindow → the History count incremented (history-changed →
   re-query worked).
4. **Confirm-in-region probe**: expand the Cookies panel; click "Clear
   cookies"; captureWindow → confirm UI renders INSIDE the Cookies
   region; click Cancel. Then open the footer's Delete confirm on a
   THROWAWAY jar (create one first via chrome evaluate or
   `jarsAdd` through the chrome bridge... simplest: `evaluate` on chrome
   `window.goldfinch.jarsAdd({ name: 'Probe Jar' })`); captureWindow →
   footer confirm with the F3 delete copy; confirm it; captureWindow →
   section removed (broadcast path; delete silentSuccess — no flash
   assertable, but end state correct).
5. **Toggle-with-open-confirm probe** (design-review-named scenario):
   expand Cookies on some jar, open its Clear-cookies confirm, then
   click the Cookies toggle to collapse. captureWindow → panel collapsed
   cleanly, no orphaned confirm visible anywhere, page still responsive
   (click another toggle works).
6. **Focus-preservation probe**: click into a jar's name input; type
   `abc`; from the chrome, `evaluate`
   `window.goldfinch.jarsRename({ id: '<other jar>', name: 'Renamed Probe' })`
   (fires jars-changed broadcast); type `def` into the still-focused
   input; captureWindow → the name input pixels show `...abcdef` (typing
   continued in place — focus survived the broadcast); press Escape
   (revert) so no rename commits.
7. **Hash deep-link probe**: navigate the jars tab (admin navigate) to
   `goldfinch://jars/#jar-<defaultJarId>--history`; captureWindow → page
   scrolled to that jar, History panel expanded.
8. **Scroll-spy sanity**: with several jars present, scroll the page
   (click a lower jar's nav link via coordinates); captureWindow →
   aria-current styling moved (the active nav row's highlight visibly on
   the lower entry).
9. Teardown: remove the probe jar(s) (via chrome `jarsRemove`), quit via
   appQuit, pgrep-confirm exit. Gates: `timeout 120 npm test`,
   `npm run typecheck`, `npm run lint`.
10. Docs: CLAUDE.md's jars-page description — add one short paragraph
    (or amend the existing internal-pages text) noting the panel
    structure + the double-hyphen id scheme + the count invariant; keep
    it tight (the full pattern story is in the flight artifacts).

## Acceptance Criteria

- [x] Probes 1–8 all show the expected rendered state (screenshot
      evidence saved under /tmp, referenced in the flight log — NOT
      committed).
- [x] Any probe failure → fix cycle before the flight-level review
      (report [BLOCKED] if a fix needs design input). *(No probe failed —
      no fix cycle needed. One apparatus deviation: probe 7 used
      chrome-evaluate `tabNavigate` instead of the `navigate` MCP tool,
      which refuses `goldfinch://` URLs by design — see flight log.)*
- [x] Gates green post-docs; flight log carries the probe results table.

## Files Affected

- `CLAUDE.md` — jars-page paragraph
- flight-log.md — probe results

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed`
- [x] Do NOT commit

## Citation Audit

Apparatus facts carried from the Flight-1 behavior-test run log
(2026-07-12-19-37-28) and the flight-2 design recon; no new line-form
source citations.
