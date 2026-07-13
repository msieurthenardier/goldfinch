# Flight Debrief: History Panel Content

**Date**: 2026-07-13
**Flight**: [History Panel Content](flight.md)
**Status**: landed
**Duration**: 2026-07-12 (single-day flight)
**Legs Completed**: 3 of 3 (`data-class-and-retention-backend`, `history-panel-ui`, `verify-integration`)

## Outcome Assessment

### Objectives Achieved

Landed the History panel's real content — browse / search / paging / per-row
delete / clear-all, a per-jar retention `<select>`, and the `history` data class
integrated into the jar data controls (clear-history + wipe both purge history
alongside the other classes). Backend: `pruneOneJar`, `setRetention`, and the
discriminator-first `handleClearData`/`wipeJarData` surface, all unit-pinned. 7
live acceptance probes (browse, search, per-row delete, clear-all, retention edit
+ immediate prune, wipe purge, delete purge) passed with DB-observable evidence
and zero implementation bugs. Suite green throughout (1423/1423 at flight close).

> **Superseded-UI note.** The panel's *renderer* content (paging model, row
> interactivity, delete glyph, status line) was substantially reworked by Flight 06
> HAT (H1/H2/H3/H5). The backend it landed was untouched through HEAD.

### Mission Criteria Advanced

- **"Browse recent visits, text search, delete an individual entry, clear all"** —
  closed this flight.
- **"History participates in the jar data controls (clear-class + wipe both remove
  history)"** — closed this flight.
- **"Each jar has its own retention policy (30-day initial), editable on the page;
  older entries removed automatically"** — closed this flight.
- **"No network egress"** — the search half closed here (suggestion half closed in
  Flight 4).

## What Went Well

- **The backend design was excellent and permanent.** `jar-ipc.js`, the `jars.js`
  store methods, and `jar-data-classes.js` were untouched after this flight through
  HEAD — the data class, discriminator-first dispatch, purge composition, and
  retention twins needed zero rework. The two-cycle design-review investment on the
  backend paid off entirely; all later churn was renderer UX.
- **Two data-loss-class bugs caught at design review before any code:**
  - **CRITICAL:** the draft's `setRetention` prune used a single-key
    `pruneExpired({[id]: days})` — the store's orphan-GC contract would have deleted
    *every other jar's* history on any retention edit. Reworked to a new single-jar
    `pruneOneJar` (no orphan sweep, no-collateral unit pin).
  - **HIGH:** `handleClearData` needed discriminator-FIRST dispatch; a naive
    `storages`-falsy fallthrough would have run `clearCache()` while reporting history
    cleared.
- **The DD7 page-controller module seam was the highest-leverage structural call.**
  `createHistoryPanel` owning its mount (two-children DOM contract, no `ui`/`sectionMap`
  leak, grep-enforced) absorbed a *near-total* UI rewrite in Flight 06 (320 → 558
  lines) without the divert criterion ever firing. Strong evidence the split was
  placed correctly.
- **The DD2 growth trigger was fired proactively** (panel content → its own module,
  jars.js +55 vs. +400 if inlined), which is precisely why the later HAT rework had a
  bounded blast radius.
- **Verification was honestly scoped:** retention-cutoff prune needs time-travel, so
  probe 5 verified only the no-collateral 0-broadcast path; the cutoff itself is
  unit-pinned. Correct scoping, not a gap.

## What Could Be Improved

### Process

- **The content/polish boundary for interactive panels needs a sharper line.** The
  mission split "content" (this flight) from "HAT polish" (Flight 06), but paging
  *mechanism* and row *interaction model* are arguably content decisions that got
  re-litigated in HAT. This flight built a full cursor-paging implementation
  (`before`-based "Show more" with same-timestamp tiebreak) that Flight 06 discarded
  in favor of a numbered offset pager — which required a total-count query this
  flight had deliberately avoided. The HAT gate should catch "this is a mechanism
  rework, not a polish pass" earlier; the leg could have deferred the pager *shape*
  rather than building a version that was then replaced.
- **Row interactivity should have been an explicit Open Question at flight design.**
  H2 (rows are non-navigable — you could see history but not revisit it) leans more
  "foreseeable functional gap" than "feel-tuning miss." "Browse recent visits" in the
  charter arguably implies "revisit." For any browse/list surface, make
  *click-to-act* an explicit design question rather than defaulting to view-only.

### Technical

- **Adjudicated debt to schedule:** the `wipeJarData` extraction moved `rerollSeed`
  inside the uncaught session-call block, so a session throw during jar *delete* now
  also skips `rerollSeed` (previously unconditional). Bounded (restart closes it;
  the precondition already left storage uncleaned pre-flight) and accepted at review —
  a candidate mission-end hardening touch, already in the mission's Known Issues.
- **Mixed-class clear error labeling:** a `['history','cookies']` clear that partially
  fails attributes to one branch's static fragment only. Non-blocking; noted for a
  future touch.
- **The offset pager Flight 06 chose is O(offset) in SQLite;** this flight's cursor
  design was the more scalable primitive. The trade (scale-elegance for total-count +
  numbered UX) was made under UX pressure, not measured — acceptable at history sizes,
  worth remembering.

### Documentation

- CLAUDE.md's jars-panel section was updated and each claim source-checked at Leg 3;
  the one doc defect (a "fourth copy" wipe-composition miscount) was caught at flight
  review and corrected pre-commit. No outstanding doc debt *from this flight*, but its
  panel description was later reworked by F06 — mission debrief should confirm F06
  refreshed it.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| New `pruneOneJar` store method added (not `pruneExpired` reuse) | Single-jar reuse of the bulk method would orphan-delete every other jar's history | Yes — "reuse a bulk method for a single-item mutation" is a recurring trap; keep the concerns split |
| `eslint.config.mjs` ESM entry for the new panel module (beyond Files Affected) | The file didn't exist when the spec was written; same touch was needed for `jars.js`/`settings.js` historically | Yes — a new ESM page-module always needs the eslint block entry |
| `handleClearData` reworked to discriminator-first dispatch | Naive fallthrough would clear cache while reporting history cleared | Yes — dispatch on the explicit discriminator, never on falsy fallthrough |

## Key Learnings

- **The design-review live-probe gate keeps catching silent data-loss bugs.** The
  single-key-prune orphan-delete would have been catastrophic and invisible to a
  unit test written against the buggy spec — the same pattern as Flight 1's findings.
- **A well-placed page-controller module seam makes later rework cheap.** DD7's owned-
  mount contract absorbed a full UI rewrite without touching the surrounding shell.
- **Page-controller logic (debounce, paging math, stale-token discard) ships on
  live-probe verification alone.** Both this flight and Flight 06 shipped ~300–550
  lines of renderer logic with no unit suite (house practice: internal-page DOM isn't
  eval-observable). Consider extracting the non-DOM logic (token staleness, page math,
  debounce) to a jsdom-testable or pure seam without violating the no-Electron rule.

## Recommendations

1. **Sharpen the content-vs-HAT-polish boundary** so paging mechanism and row
   interaction are settled (or explicitly deferred) at content-flight design, not
   rebuilt in HAT.
2. **Make row interactivity an explicit design question** for any browse/list surface.
3. **Extract page-controller non-DOM logic to a testable seam** (both this flight and
   F06 relied entirely on live probes for it).
4. **Schedule the `rerollSeed`-skip-on-delete-throw Known Issue** and the O(offset)
   pager as mission-end hardening candidates (both adjudicated-acceptable, both live).

## Action Items

- [ ] Confirm (in the mission debrief) that Flight 06 refreshed the CLAUDE.md panel
      description to the reworked UI.
- [ ] Track the `rerollSeed`-skip-on-delete-throw item in the mission's hardening /
      routine-maintenance ledger.
- [ ] Evaluate extracting the panel's token/paging/debounce logic to a unit-testable
      seam.
- [ ] Add "row interactivity: navigable?" to the leg-design checklist for browse/list
      surfaces.
