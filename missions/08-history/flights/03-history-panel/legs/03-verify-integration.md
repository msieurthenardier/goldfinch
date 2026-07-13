# Leg: verify-integration

**Status**: completed
*(FD design note: procedure mirrors F2 leg 3's proven apparatus —
admin SDK client, rendered-pixel probes on the internal page, filesystem
probes on history.db; no new seams to audit.)*
**Flight**: [History Panel Content](../flight.md)

## Objective

Verify the history panel content and the data-model integration in the
running app: browse/search/paging/per-row delete, clear-all via the
data-class control, retention edit + immediate prune, and the
DB-observable purge criteria (clear-data, wipe, delete) — plus docs and
gates.

## Verification Procedure (Developer-driven; evidence to /tmp/f3-verify)

Launch/connect/teardown identical to F2 leg 3 (mint envs, scripted SDK
client, openJarsPage via chrome evaluate, appQuit at the end). Seed
browsing first: visit 3–4 distinct titled pages in the default jar and 2
in `work` (fixture server or example.com/org — any titled http pages).

1. **Browse**: expand the default jar's History panel. captureScreenshot →
   retention select ("Keep history for: 30 days"), search input, visit
   rows (title primary, host · time secondary, × per row), count in the
   button label consistent with rows.
2. **Search**: type a query matching ONE seeded page into the search
   input (click + typeText). Screenshot → list narrowed to matches;
   clear the input → recent list returns.
3. **Per-row delete**: note the DB count for a specific seeded URL
   (node -e readOnly); click its row's ×; wait ~1s; screenshot + re-query
   → row gone from the list AND from the DB; count label decremented.
4. **Clear-all via data-class control**: click "Clear History" in the
   History region; screenshot → confirm INSIDE the history region with
   real copy; confirm it; re-query DB → zero rows for that jar; panel
   shows empty state; count label "no visits". Other jars' rows intact
   (no-collateral).
5. **Retention edit + immediate prune**: seed one OLD visit into the
   default jar directly in the DB? NO — the app holds the DB; instead use
   the IPC path: seed an old visit via... (the store accepts only live
   navigation) — INSTEAD: set retention to 7 days via the select
   (screenshot: select shows 7 days), then verify `containers.json` has
   retentionDays 7 for that jar (filesystem read) AND the DB rows (all
   fresh today) survive (prune-on-change deleted nothing — 0-broadcast
   path). Then set back to 30. The old-row prune path is unit-pinned
   (pruneOneJar cutoff tests); live verification of the cutoff would
   need time travel — out of scope, noted.
6. **Wipe purges history (DB-observable)**: with rows present in `work`,
   run the wipe via chrome evaluate
   `window.goldfinch.jarsWipe({ id: 'work' })`; re-query DB → zero rows
   for `work`; if the jars page is open, its work History count shows
   "no visits" (history-changed broadcast path). Screenshot.
7. **Delete purges history (DB-observable)**: create a probe jar (chrome
   `jarsAdd`), open a tab in it (admin openTab jarId), visit a page,
   confirm a DB row exists for it; delete the jar via the footer Delete
   confirm (or chrome `jarsRemove`); re-query DB → zero rows for the
   probe jar id.
8. Teardown + gates (`timeout 120 npm test`, typecheck, lint) + docs:
   update CLAUDE.md's history/jars sections (fourth data class; panel
   content module; retention control; setRetention twins; pruneOneJar)
   — verify each claim against code; keep tight.

## Acceptance Criteria

- [x] Probes 1–7 pass on rendered pixels + DB reads (evidence under
      /tmp/f3-verify, referenced in the flight log).
- [x] Gates green post-docs; flight log carries the probe table.

## Files Affected

- `CLAUDE.md`; flight-log.md

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed`
- [x] Do NOT commit

## Citation Audit

Apparatus carried from F1 behavior-test run + F2 leg 3 (same session);
no new source citations.
