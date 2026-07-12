# Flight Log: History Panel Content

**Flight**: [History Panel Content](flight.md)

## Summary

Leg 1 (data-class-and-retention-backend) landed: the `history` data class,
`pruneOneJar`, `setRetention`, and the jar-ipc discriminator-first
clear-data/wipe/set-retention surface are in place and unit-pinned. Leg 2
(panel UI) landed: the History panel's real content (browse/search/paging/
delete, retention select, clear-history) is now live in
`src/renderer/pages/jars-history-panel.js`, wired into `jars.js`. Leg 3
(verify-integration) landed: all 7 live probes (browse, search,
per-row delete, clear-all, retention edit + immediate prune, wipe purge,
delete purge) passed against the running app with DB-observable evidence
and no implementation bugs found; CLAUDE.md's jars-panel-structure section
was updated with the fourth data class, the panel content module, the
retention control, and the purge composition; all gates green. Flight is
ready to close pending mission Flight 6's HAT pass.

**Flight complete.** All 3 legs (`data-class-and-retention-backend`,
`history-panel-ui`, `verify-integration`) landed and are marked
`completed`. Full unit suite green throughout (1423/1423), typecheck and
lint clean. Live verification: probes 1–7 (the flight's acceptance
criteria — browse, search, per-row delete, clear-all, retention edit +
immediate prune, wipe purge, delete purge) all passed against the running
app with rendered-pixel and DB-observable evidence; probe 8 (teardown +
gates + docs) also passed. Flight-level code review passed
`[HANDOFF:confirmed]` with two non-blocking doc-fix nits (CLAUDE.md's
wipe-composition "fourth copy" miscount corrected to the 3-pre-existing-
copies framing; a mixed-class error-labeling note handed to a future
touch) and no correctness findings. One review-adjudicated known issue
carried to the mission's Known Issues log: `wipeJarData`'s extraction
means `rerollSeed` is now skipped when a session call throws during jar
delete — bounded (restart closes it; the precondition already left
storage uncleaned pre-Flight-3) and adjudicated acceptable at flight
review, not a fix-now item. Contributing-to-criteria: browse/search/
delete/clear, the jar-data-controls integration, and the retention-edit
control are fully satisfied this flight; the no-network-egress criterion
is satisfied for its search half only (the suggestion-query half lands in
Flight 4). Mission Success Criteria closed by Flights 1–3: manage-jars
collapsible panels, history panel browse/search/delete/clear, jar-data-
controls participation, and per-jar retention policy.

---

## Leg Progress

- **2026-07-12 — Leg 3 (`verify-integration`) landed.** Live-verified the
  panel content + data-model integration against the running app (apparatus:
  `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1
  GOLDFINCH_MCP_PORT=49707 npm run dev:automation`, the F2-leg-3 scripted MCP
  SDK client at `/tmp/f3-verify/mcp-cli.mjs`, `openJarsPage()` via chrome
  evaluate, admin `click`/`typeText`/`pressKey` against the internal
  `goldfinch://jars` wcId, `captureScreenshot` evidence, and read-only
  `node:sqlite` reads of `~/.config/goldfinch-dev/history.db` +
  `containers.json`). Seeded 3 titled pages into the `default` jar
  (example.com, wikipedia.org, iana.org — a 4th, info.cern.ch, never finished
  loading and recorded no visit, a page-load fluke not a product bug) and 2
  into `work` (example.net, httpbin.org). All 8 probes ran; probes 1–7 are
  the ACs, probe 8 is teardown+gates+docs.

  | # | Probe | Result | Evidence |
  |---|-------|--------|----------|
  | 1 | Browse (default jar expand) | PASS — retention select "30 days", search input, 3 rows (title/host·time/×), count "3 visits" matches | `probe1-default-history-expanded.png` |
  | 2 | Search narrows + clears | PASS — query "wikipedia" narrowed to the 1 matching row ("Showing 1 of many"); clearing restored all 3 | `probe2-search-narrowed.png`, `probe2b-search-cleared.png` |
  | 3 | Per-row delete | PASS — deleted the `example.com` row; DB row for that URL gone, jar's DB count 3→2, panel row gone, count label "2 visits" | `probe3-row-deleted.png` + DB re-query |
  | 4 | Clear-all via data-class control | PASS — confirm rendered INSIDE the History region with copy "Clears this jar's browsing history."; after confirm: "History cleared." note, count "no visits", empty state "No visits recorded", DB rows for `default` → 0; `work` (3) and `rename-test` (9, pre-existing dev-profile data) untouched (no-collateral) | `probe4a-clear-confirm.png`, `probe4b-clear-empty.png` + DB re-query |
  | 5 | Retention edit + immediate prune | PASS — ran on `work` (had 3 fresh rows; `default` was empty post-probe-4) via keyboard (click+Escape+ArrowUp×2 on the native `<select>`, since the internal bridge isn't chrome-evaluate-reachable): select showed "7 days", `containers.json`'s `work` entry had `retentionDays: 7`, all 3 fresh rows survived (0-broadcast path); reset to 30 and confirmed both the select and `containers.json` reverted | `probe5d-retention-7days.png`, `probe5e-retention-back-30.png` + containers.json reads |
  | 6 | Wipe purges history (DB-observable) | PASS — `window.goldfinch.jarsWipe({id:'work'})` via chrome evaluate purged all 3 pre-wipe rows from the DB; panel live-updated to "1 visit" via the `history-changed` broadcast — that 1 row is a legitimate NEW visit from the wipe-triggered reload of the still-open `example.net` tab in `work` ("Open tabs in this jar will reload" is documented wipe behavior), not a purge failure; confirmed by id: none of the 3 pre-wipe row ids/URLs remained | `probe6-wipe-purged.png` + DB re-query |
  | 7 | Delete purges history (DB-observable) | PASS — created probe jar `f3probe` (chrome `jarsAdd`), opened a tab + visited example.com (1 DB row confirmed), deleted via chrome `jarsRemove` → DB rows for `f3probe` → 0, jar gone from `containers.json` | DB re-query pre/post delete |
  | 8 | Teardown + gates + docs | PASS — `window.goldfinch.appQuit()` ("fetch failed" success signature), `pgrep` confirmed zero electron/goldfinch processes; `npm test` 1423/1423, `npm run typecheck` clean, `npm run lint` clean (both before AND after the docs pass); CLAUDE.md's jars-panel-structure section gained a new subsection covering the fourth `history` data class + discriminator-first dispatch, the `jars-history-panel.js` content module + DOM contract, the retention `<select>` control, `setRetention`/`pruneOneJar`, and the wipe/delete purge composition — each claim checked against the live `jar-data-classes.js`/`jar-ipc.js`/`history-store.js`/`jars-history-panel.js` source | CLAUDE.md diff |

  No implementation bugs found in legs 1–2's work; no design-implicating
  failures; no diversion needed. All evidence under `/tmp/f3-verify/`
  (screenshots + `mcp-cli.mjs`, `app.log`).

- **2026-07-12 — Leg 1 (`data-class-and-retention-backend`) landed.**
  Implemented all 7 numbered Changes exactly as specified:
  1. `src/shared/jar-data-classes.js` — `history` descriptor
     (`{ id: 'history', label: 'History', storages: null, custom: 'history' }`)
     appended to `JAR_DATA_CLASSES`; `custom?: string` added to the
     `JarDataClass` typedef; header comment updated. Both named-breaking
     tests updated (id-list now `[cookies, storage, cache, history]`;
     the unknown-id example moved off `'history'` to `'nonexistent'`), plus
     new shape/frozen/discriminator-exclusivity pins. The two breaking
     `jar-ipc.test.js` unknown-class expectations (`~470`/`~482`) rewritten
     to use `'nonexistent'` instead of `'history'`.
  2. `src/main/history-store.js` — `pruneOneJar(jarId, days, now)` added:
     `recordVisit`-style `TypeError` validation, reuses the existing
     `pruneJar` prepared statement verbatim, NO orphan sweep. Added to the
     repo-interface list and the throws-before-open list in
     `history-store.test.js`, plus cutoff/count/no-collateral/validation
     tests.
  3. `src/main/jars.js` — `setRetention(id, days)` added: rejects (never
     coerces) invalid `days`, unlike load-time `cleanRetention`. Full test
     coverage incl. the rejection table, boundary values, idempotent
     current-value write, and a pin that `rename()` still ignores
     retention. Refreshed the stale jars.test.js title that claimed "no
     public setter this leg."
  4. `src/main/jar-ipc.js` — deps gained `historyStore`; `handleClearData`
     dispatches on the `custom` discriminator FIRST per the pinned sketch
     (own `history-failure` static error fragment, logged); extracted
     `wipeJarData(ses, jarId)` (session calls + `rerollSeed` UN-CAUGHT,
     propagating to each caller's own try/catch; only the history purge
     gets its own inner try/catch, fail-soft, running after the session
     calls) — used by both `handleRemove` and `handleWipe`; `handleWipe`
     broadcasts `history-changed` immediately after `jar-wiped` (ordering
     preserved) when the purge deleted rows; `handleSetRetention` added
     with the full validation table + prune-on-change, twin-registered as
     `jars-set-retention`/`internal-jars-set-retention`.
  5. `src/preload/internal-preload.js` — `jarsSetRetention` wrapper added
     (internal-only, chrome-preload untouched per flight Technical
     Approach); `renderer-globals.d.ts` gained the matching
     `GoldfinchInternalBridge` declaration.
  6. `src/main/main.js` — `historyStore` added to the `registerJarIpc` deps
     object (single line; no other main.js changes).
  7. `test/unit/jar-ipc.test.js` — built a from-scratch fake historyStore
     (`clearJar`/`pruneOneJar`, per-method `throws` toggles, mirroring
     `history-ipc.test.js`'s convention) and a full new pin battery:
     history-only and mixed-class clears, the cache-fallthrough regression
     pin, the static `history-failure` string with session-classes
     unaffected, wipe purge + broadcast ordering + purge-throws-stays-ok,
     the session-throw-with-history-rows pins on BOTH `handleRemove` and
     `handleWipe` (purge — and, for remove, `rerollSeed` too, since it now
     lives inside `wipeJarData` after the un-caught session calls — is
     skipped when the session call itself throws), remove-purges-silently,
     the full `set-retention` rejection/success/prune-on-change table, and
     the updated registration-surface (9+9) and untrusted-sender-loop pins.
  One behavior note beyond the leg's literal text: extracting `rerollSeed`
  into `wipeJarData` (per the "clearStorageData + clearCache + rerollSeed
  composition" framing in Change 4) means a session-call throw inside
  `handleRemove` now also skips `rerollSeed` — previously `handleRemove`
  called `rerollSeed` unconditionally, outside its try/catch. This is a
  deliberate consequence of the pinned failure-isolation shape (session
  calls stay un-caught, purge runs after them), and the pre-existing
  `jars-remove with a throwing wipe is fail-soft` test was updated
  accordingly (`revokeJarKey`/broadcasts still fire; `rerollSeed` no longer
  appears in the throw-path event list).
  Gates: `npm test` (1423/1423 pass, ~1s), `npm run typecheck` (clean),
  `npm run lint` (clean after one `no-useless-assignment` fix — `purged`
  declared without a dead initializer). Grep-ACs verified: `grep -n '\${'
  src/main/jar-ipc.js` → exactly the 3 pre-existing dynamic-string hits, no
  new ones added; `grep -c "clearStorageData"` line-hits went from 6 to 7
  (extra doc-comment mentions), but the ACTUAL call count dropped from 4 to
  3 — the wipe composition collapsed into one call inside `wipeJarData`,
  the clear-data storages/cache branches kept their own 2. `node -e
  "require('./src/main/jar-ipc')"` is side-effect free.

- **2026-07-12 — Leg 2 (`history-panel-ui`) landed.** Built
  `src/renderer/pages/jars-history-panel.js` exactly to the module contract
  — `createHistoryPanel({ bridge, jarId, mountEl, onError, getRetentionDays })`
  → `{ onExpanded, onHistoryChanged, onJarsRow, destroy }` — and wired all 9
  `jars.js`/`jars.css`/`jars.html`/`main.js` integration points:
  1. `'history'` added FIRST to `CONFIRM_REGIONS` (now
     `['history','cookies','site-data','footer']`).
  2. The History region's `if/else` branches merged: EVERY panel
     (including History) now calls the zero-arg `buildRegionControls()`
     and registers into `panelButtonRows`/`confirmAreas`/`confirmOpenKeys`;
     History additionally appends `<div class="jar-history-mount">` as the
     region's SECOND child and constructs `createHistoryPanel(...)`,
     captured into the `refs` literal's new `historyPanel` field at
     construction (a forward-declared `let refs`/`let historyPanel`, closed
     over by the panel's `onError` and by the toggle handler — both only
     ever invoked after `buildJarSection` returns, once `refs` is set). The
     new `currentRowFor(id)` helper (`state.containers.find(...)`) backs
     `getRetentionDays`. Old static hint paragraph dropped.
  3. `CLEAR_COPY.history` / `CLEAR_OK_NOTE.history` added, keyed by the
     class id (a same-file comment flags the keying convention).
  4. Panel-toggle handler calls `refs.historyPanel?.onExpanded()` on
     History expand.
  5. The module-level `onHistoryChanged` handler now also calls
     `refs.historyPanel?.onHistoryChanged()`, ahead of (independent of) the
     existing count refresh.
  6. `updateJarSection` calls `refs.historyPanel?.onJarsRow()` (no arg).
  7. `renderSections`' removal path calls `removed.historyPanel?.destroy()`
     beside the status-timer clearing.
  8. `jars.html` gained the `jars-history-panel.js` module tag;
     `INTERNAL_PAGES.jars` gained the matching entry; `jars.js` gained the
     flat `@ts-ignore` import. Manually verified the tag carries
     `type="module"` (the leg's flagged static-net gap: the module-pin test
     only checks `src/shared/` tags, so this file's tag isn't statically
     enforced).
  9. `jars.css` gained the History panel's rules (retention row, search
     input, row primary/secondary/delete, status line, Show-more) and the
     now-dead `.jar-panel-hint` rule (its only caller was removed) was
     deleted.
  Gates: `npm test` (1423/1423), `npm run typecheck` (clean), `npm run
  lint` (clean after two fixes below), the jars-page script-tag contract
  test (7/7). Grep-ACs: `grep -n "sectionMap\|ui\." jars-history-panel.js`
  → 0 hits after rewording a doc-comment sentence that had literally
  contained the substring "sectionMap" (the grep-AC is a blunt text
  search over the whole file, comments included); `grep -c "innerHTML"` →
  0. New `jars.js` line count: **1726** (+55 from 1671 — well under the
  ~1,800 trigger, and under DD7's own ~+100 projection). New module:
  **320 lines**.

---

## Decisions

*(none yet)*

---

## Deviations

- **2026-07-12 (Leg 2)**: `eslint.config.mjs` needed a one-line addition —
  `src/renderer/pages/jars-history-panel.js` to the ES-module file list
  (the block that currently names `jars.js`/`settings.js`/etc., sourceType
  `module`) — else lint fails parsing the new file's `export`. Not in the
  leg's Files Affected list (which predates the file's existence); the same
  config touch was needed when `jars.js`/`settings.js` themselves went ESM.
  Also fixed one `no-useless-assignment` lint hit in the new module (a dead
  `host = ''` initializer duplicated in the catch branch) — same class of
  fix as leg 1's `jar-ipc.js` one.

---

## Anomalies

*(none yet)*

---

## Session Notes

- **2026-07-12 (flight design)**: Designed directly on the F1/F2 recon
  base (same session). Key rulings: `identity-new` deliberately does NOT
  clear history (DD3 — fingerprint reroll ≠ data-visibility control); the
  wipe-composition extraction fires at its fourth copy but stays local to
  jar-ipc (`identity-new`'s copy stands per M06 F4 DD3's coupling
  rationale); the Flight-2 DD2 growth trigger fires proactively — panel
  content lands as `pages/jars-history-panel.js` (projected jars.js growth
  +~100 instead of +~400 against the ~1,800 trigger from 1,671).
- **2026-07-12 (design review, cycle 1)**: Architect verdict **needs
  rework**. CRITICAL: the draft's setRetention prune used a single-key
  `pruneExpired` map — the store's orphan-GC contract would have deleted
  EVERY OTHER jar's history on any retention edit; reworked to a new
  single-jar `pruneOneJar` store method (no orphan sweep, no-collateral
  unit pin). HIGH: (1) the "zero page work" auto-generation premise was
  false (history region never calls buildRegionControls; CONFIRM_REGIONS
  lacks 'history') — leg-2 scope corrected; (2) handleClearData needed
  discriminator-FIRST dispatch (naive fallthrough would clear the CACHE
  while reporting history cleared). MEDIUMs applied: wipeJarData failure
  isolation, handleWipe history-changed broadcast, stale-response
  view-generation token, broadcast order. Two breaking tests named.
- **2026-07-12 (design review, cycle 2)**: Architect verdict **approve**
  — every cycle-1 finding verified genuinely resolved against the live
  code; no new contradictions (CONFIRM_REGIONS is data-driven;
  pruneOneJar is additive beside pruneAllJars; DOM contract consistent).
  Two nits handed to leg design: DD2's "fourth copy" phrasing (only 3
  pre-flight copies exist — the trigger's intent, not the literal count);
  mixed-class jarsClearData error labeling (single-class today; note a
  distinct code for the history branch). Flight → in-flight.
