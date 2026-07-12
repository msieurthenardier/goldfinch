# Leg: history-panel-ui

**Status**: completed
**Flight**: [History Panel Content](../flight.md)

## Objective

Build `src/renderer/pages/jars-history-panel.js` (the panel-content module
per flight DD5–DD7) and integrate it into `jars.js`: browse/search/paging/
per-row delete inside the module's mount, the retention select, the
Clear-History data-class control riding the region confirm machinery, and
the CSS — honoring the two-children DOM contract and every focus/staleness
discipline.

## Context

- Flight DD5 (retention select), DD6 (lazy fetch, patch-in-place, cursor
  paging, view-generation token, render-from-broadcast), DD7 (module seam
  + DOM contract) — read all three in full.
- Leg 1 landed: `history` in `JAR_DATA_CLASSES` (auto-generates the
  `clear-history` action in `DATA_ACTIONS`), `jarsSetRetention` bridge,
  server-side clear/purge/prune.
- Post-F2 jars.js facts: `CONFIRM_REGIONS = ['cookies','site-data',
  'footer']` (data-driven `updateConfirmAreas`); the history region
  currently renders a static hint and never calls `buildRegionControls()`;
  `panelButtonRows`/`confirmAreas`/`confirmOpenKeys` are the registration
  maps; `regionForAction` routes `clear-history` → `history` (already
  live via `panelForDataClass`); `fetchHistoryCount` owns the count span.

## Module Contract (implement exactly)

`createHistoryPanel({ bridge, jarId, mountEl, onError, getRetentionDays })`
→ `{ onExpanded, onHistoryChanged, onJarsRow, destroy }`. ESM page module,
`// @ts-check`, no imports needed (bridge injected); never touches
`ui`/`sectionMap`/anything outside `mountEl`.

- **Mount DOM** (module-owned, built once at construction, all
  `textContent` — never markup from data):
  1. Retention row: the `<select>` NESTED INSIDE the `<label>` "Keep
     history for:" (the house implicit-association pattern — the
     name-input convention; *design review*) with presets
     7/14/30/90/180/365 days (option text "N days"); if
     `getRetentionDays()` is not a preset, an extra option for it. On
     `change`: `bridge.jarsSetRetention({ id: jarId, days })`; on
     `{ok:false}`/reject → revert the select to the last known value and
     `onError('Could not update retention')`-style message (static copy).
  2. Search row: `<input type="search">` with `aria-label`, placeholder
     "Search history". Debounced 250 ms; composing a non-empty query
     switches the view to search mode.
  3. List container `<ul role="list">` + status line (empty state /
     "Showing N of many") + "Show more" button (hidden when no more).
- **Views + token**: one `viewGen` counter. `refresh()` bumps it,
  captures it, queries (`historyList({ jarId, limit: 50 })` or
  `historySearch({ jarId, query, limit: 50 })`), and paints ONLY if the
  token is still current. **Cursor semantics pinned** *(design review)*:
  the first fetch OMITS `before`; "Show more" (recent view only — search
  is single-page at limit 50) passes `before: <numeric id of the LAST
  rendered row>` (the store resolves that row's `(visited_at, id)`
  compound cursor; unknown/foreign id → `[]`, fail-closed) and APPENDS
  its page if the captured token is still current; any reset (query
  change, history-changed refresh) bumps the token so late pages are
  discarded. **"Show more" visibility pinned**: responses carry no
  hasMore flag — show the button iff the last page's
  `visits.length === 50` (the limit); hide otherwise.
- **Rows**: `<li>`: primary line `title || url`; secondary line
  `host · localeTimeString` where host is derived defensively —
  `try { new URL(row.url).host } catch { '' }` *(design review: rows
  carry no host field; never throw)* — and time is
  `new Date(visitedAt).toLocaleString()`; a per-row delete button
  (`×`, `aria-label` "Delete visit: <primary>") calling
  `bridge.historyDelete({ jarId, visitId })` — NO optimistic removal;
  the `history-changed` broadcast triggers the repaint. Delete failures →
  `onError` (static copy).
- **Patch discipline**: the search input and retention select are built
  ONCE and never rebuilt; only the list container's children and the
  status line are replaced on paint. If the search input holds focus, a
  paint must not disturb it (it lives outside the repainted subtree by
  construction).
- **Hooks**:
  - `onExpanded()`: first call triggers the initial fetch (lazy — flight
    DD6); subsequent calls no-op if a view is already painted.
  - `onHistoryChanged()`: if a fetch has ever run (panel was expanded),
    re-run the CURRENT view top-page (recent or active search); else
    no-op (collapsed panels only refresh the count — jars.js's existing
    wiring, untouched).
  - `onJarsRow()`: NO argument *(design review — the page-model `JarRow`
    lacks `retentionDays`; passing it would feed `undefined` on every
    broadcast)* — the module re-reads `getRetentionDays()` and updates
    the select UNLESS it currently holds focus (patch-in-place rule).
  - `destroy()`: clear the debounce timer, bump the token (kills late
    paints), empty the mount.

## jars.js integration

1. Add `'history'` to `CONFIRM_REGIONS` — FIRST in the list, matching
   `JAR_PANELS` order (cosmetic; iteration is order-independent).
2. History region build *(shape pinned by design review)*: MERGE the
   current `if (panel.id === 'history') {static hint} else
   {buildRegionControls}` branches — BOTH paths call
   `buildRegionControls()` (**zero-arg** — the real signature; the CALLER
   registers the returned `{ root, buttonRow, confirmArea }` into
   `panelButtonRows`/`confirmAreas`/`confirmOpenKeys`, exactly as the
   existing else-branch does); then, for `history` only, additionally
   append `<div class="jar-history-mount">` as the region's SECOND child
   and call `createHistoryPanel({ bridge, jarId: row.id, mountEl,
   onError: <the existing section error-line mechanism>,
   getRetentionDays: () => currentRowFor(row.id)?.retentionDays ?? 30 })`.
   **`currentRowFor(id)` is a NEW jars.js helper** —
   `state.containers.find(c => c.id === id) || null` — reading the RAW
   store records (which carry `retentionDays`), never the page-model
   rows (which don't). Capture the instance into the `refs` literal at
   construction (`historyPanel`), not a post-hoc mutation. The old
   static hint paragraph is dropped.
3. `CLEAR_COPY.history` + `CLEAR_OK_NOTE.history` entries — **keyed by
   the CLASS id, not the action id** *(design review, HIGH —
   `DATA_ACTIONS` sources copy via `CLEAR_COPY[cls.id]`; a
   `'clear-history'` key would render an undefined confirm)*. Add a
   one-line comment at the tables' declaration noting they are keyed by
   `cls.id` (defensive, this mistake nearly shipped). Name-free copy,
   e.g. "Clears this jar's browsing history." / "History cleared."
   (exact words HAT-variable).
4. Panel toggle handler: when the HISTORY panel expands, call
   `refs.historyPanel?.onExpanded()`.
5. The existing module-level `onHistoryChanged` handler: in addition to
   the count refresh, call `refs.historyPanel?.onHistoryChanged()` for
   the matching section.
6. `updateJarSection`: call `refs.historyPanel?.onJarsRow()` (no arg —
   the module re-reads via its `getRetentionDays` callback).
7. Section removal path (`renderSections` cleanup): call
   `refs.historyPanel?.destroy()` beside the status-timer clearing.
8. Registrations: `jars.html` gains
   `<script src="jars-history-panel.js" type="module"></script>`;
   jars.js gains the flat `// @ts-ignore` import
   (`import { createHistoryPanel } from './jars-history-panel.js'`,
   matching the existing import block); `INTERNAL_PAGES.jars` gains
   `'/jars-history-panel.js'`. **Static-net honesty** *(design review,
   verified)*: the contract test's `resolveScriptFile` DOES resolve
   pages-dir bare filenames (existence is covered), but `isSharedSrc`
   checks only SHARED_DIR — so the module-pin test SKIPS this tag and
   nothing in CI enforces its `type="module"`. Double-check the
   attribute manually; a miss fails loudly at first live page load
   (the file uses `export`).
9. CSS (`jars.css`): retention row, search input, list rows (primary/
   secondary type scale, delete button alignment), status line, Show
   more button — token palette, no animations.

## Acceptance Criteria

- [x] Module exists per contract (ESM, @ts-check, DOM only inside mount,
      token-guarded paints, hooks as specified); jars.js integration
      points 1–7 in place; registrations (8) done; CSS (9) done.
- [x] `'history'` in `CONFIRM_REGIONS`; clear-history button + confirm
      render from the auto-generated action (no bespoke clear path).
- [x] Grep-ACs: `grep -n "sectionMap\|ui\." src/renderer/pages/jars-history-panel.js`
      → zero hits (module isolation); `grep -c "innerHTML" …` → 0.
- [x] `npm test` / `npm run typecheck` / `npm run lint` green; script-tag
      contract test green; report new jars.js line count (target: stays
      well under 1,800).
- [x] No unit suite for the module (house practice for page controllers)
      — static nets only; live behavior is leg 3.

## Verification Steps

Gates + grep-ACs. Leg 3 owns live probes.

## Edge Cases

- Jar with zero visits: empty state renders on expand; count button label
  already says "no visits" (F2 wiring, untouched).
- Search query cleared back to empty: view returns to recent list
  (token-bumped refresh).
- `historyList` `{ok:false}` (e.g. unknown-jar race at teardown): paint
  nothing, `onError` once — never throw.
- Rapid expand/collapse: `onExpanded` no-ops after first paint; collapse
  does not cancel an in-flight first fetch (token still current → paints
  into the hidden region — harmless, correct on next expand).
- Retention select focused during a jars-changed broadcast: not
  overwritten (onJarsRow guard).

## Files Affected

- `src/renderer/pages/jars-history-panel.js` — new
- `src/renderer/pages/jars.js`, `src/renderer/pages/jars.css`,
  `src/renderer/pages/jars.html`
- `src/main/main.js` (INTERNAL_PAGES entry)

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry (incl. jars.js line
      count)
- [x] Set this leg's status to `landed`
- [x] Do NOT commit

## Citation Audit

Post-F2 jars.js facts (CONFIRM_REGIONS list, history-region hint branch,
registration maps, regionForAction, fetchHistoryCount ownership) verified
in the two Flight-3 design-review cycles against the live tree. The
script-tag contract test's treatment of a pages-dir module file must be
verified at implementation (named in step 8).
