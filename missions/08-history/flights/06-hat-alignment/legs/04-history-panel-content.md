# Leg: history-panel-content

**Status**: completed
**Flight**: [HAT & Alignment](../flight.md)

## Objective

Three history-panel findings: **H1** numbered paging bar (`< 1 2 3 … >`)
replacing Show more; **H2** history rows become links that open the page
in a **new tab in the same jar**; **H3** the per-row delete `×` becomes a
trashcan icon. (**H5** — the "Showing X of many" bug when X < page limit —
dissolves into H1's pager, which replaces the status line.)

## Context & rulings

- HAT steps 1/4; rulings: H2 → **new tab, same jar**; H3 fix; H1/H5
  features (flight-log Decisions).
- Landed on Leg 03's tab shell — the History tab now hosts
  `createHistoryPanel` (`src/renderer/pages/jars-history-panel.js`); this
  leg reworks that module's list/paging/rows/delete.
- **Store** (`src/main/history-store.js`): `listRecent(jarId, { limit,
  before })` uses a `before` CURSOR (no offset); `countByJar(jarId)`
  returns the total; prepared statements built in `open()`.
- **IPC** (`src/main/history-ipc.js`): the panel is the SOLE UI consumer
  of `history-list` (cursor) and `history-search`. (Flight-5 automation's
  `getHistory` calls the store's `listRecent`/`search` DIRECTLY via the
  engine's injected accessors — NOT these IPC channels — so evolving the
  panel's IPCs does not touch automation.)
- **Open-tab path** (reuse for H2): main's `setWindowOpenHandler` already
  sends `getChromeContents().send('open-tab', { url, openerPartition })`
  (main.js:1147); the chrome renderer's `onOpenTab` (renderer.js:2799)
  resolves `openerPartition` → container via `inheritFromPartition` and
  `createTab`s in that jar, through the `isSafeTabUrl` gate. A jar's
  `partition` resolves to that jar's own container → "new tab, same jar"
  for free.

## Design

### H1 — numbered paging (store + IPC + panel)

- **Store**: add `listByPage(jarId, { page, pageSize })` — a new prepared
  `listByOffset` statement (`… WHERE jar_id=?1 ORDER BY visited_at DESC,
  id DESC LIMIT ?2 OFFSET ?3`; distinct placeholders per the pinned
  gotcha), `page` 1-based and CLAMPED/validated (positive integer; mirror
  the `MIN_LIMIT`/`MAX_LIMIT` clamp style for `pageSize`), OFFSET =
  `(page-1)*pageSize`. Add it to the repo-interface + throws-before-open
  test lists. Returns the page's rows.
  Total pages derive from `countByJar`. (Offset paging is O(offset) in
  SQLite but bounded by the `visits_jar_time` index range-scan and a
  human-scale page depth — note the tradeoff; keyset-per-page-number is
  not worth the complexity for a numbered bar.) Unit-pin: page boundaries,
  last-partial page, out-of-range page → empty, ordering identical to
  `listRecent`'s first page for page 1.
- **IPC**: add `history-page` / `internal-history-page` twin —
  `{ jarId, page, pageSize? }` → `{ ok, visits, total }` (total =
  `countByJar`). Fail-closed static strings (`history: page — <code>`);
  **validate BOTH `page` (positive integer — `page=0`/negative/fractional
  → `bad-args`, `isFiniteNumber` alone won't catch it) AND `pageSize`**
  *(design review)*. **REMOVE `history-list` / `internal-history-list`**
  *(design review, ruled)* — the panel is its only consumer and it
  migrates to `history-page`; automation uses the store's `listRecent`
  directly, not this IPC. Net twin count stays **6 (drop list, add page)**;
  update the closed-set registration test (`history-ipc.test.js:128`).
  `history-search` stays (search isn't migrated).
- **Panel**: replace the Show-more button with a numbered paging bar:
  `< 1 2 3 … >` (prev/next chevrons + page numbers with ellipsis for
  large counts; disabled prev on page 1, next on last). Page state per
  panel; a page click fetches `history-page` with a view-generation token
  (the existing stale-response guard). The status line's "of many" logic
  is removed (the pager replaces it) — **H5 closed**. Search view: keep
  `history-search` single-shot; if it returns a full page (limit hit),
  show a plain "showing first N" note (no "of many" ambiguity) — search
  is not numerically paged this leg (bounded matches).

### H2 — rows as links (new tab, same jar)

- **New internal IPC** `internal-open-tab-in-jar` (origin-gated via
  `registerInternalHandler`) — payload `{ jarId, url }`. **Register it
  DIRECTLY in main.js** *(design review)* beside the other
  directly-registered internal handlers (`internal-settings-get`, etc.) —
  it needs `getChromeContents()` (a main.js module-scoped closure, not
  injected anywhere) and `isSafeTabUrl` (already required in main.js);
  do NOT thread `getChromeContents` as a new jar-ipc dep. Main: validate
  the jar exists (`jars.list().find`), validate `isSafeTabUrl(url)`
  (defense-in-depth — the downstream `createTab` untrusted branch
  re-checks it too, the documented two-point boundary), then
  `getChromeContents().send('open-tab', { url, openerPartition:
  entry.partition })`. Fail-closed static strings. Preload:
  `openTabInJar(payload)` on `window.goldfinchInternal`; d.ts declare.
- **Panel**: each history row's primary line becomes an `<a href={url}>`
  (real anchor → hover shows destination, keyboard-focusable) with
  `textContent`-set label. **Intercept BOTH `click` AND `auxclick`**
  *(design review, MEDIUM — middle-click fires `auxclick`, NOT `click`; if
  left uncaught it falls through to the jars-page's own
  `setWindowOpenHandler` → forwards the INTERNAL partition → wrong jar
  (default), a jar-isolation surprise)*: both handlers `preventDefault()`
  and call `bridge.openTabInJar({ jarId, url })`, so left/ctrl/middle
  activation ALL route through the jar-scoped opener into the correct jar
  (foreground tab; no true background-tab affordance — accepted, noted).
  Style the `<a>`: `text-decoration:none` default, underline on
  hover/focus, no UA link-blue/visited-purple (neutral row styling).
  Per-row delete button stays separate (H3).
- **Open-target ruling**: NEW tab in the SAME jar (operator R/H2). The
  jars page stays open.

### H3 — trashcan delete icon

- Replace the row delete `×` glyph with the Lucide trash-2 icon. jars.js
  already has a module-scoped `buildIcon()` + `ICON_DELETE` (trash-2 path,
  git 4e1d980) but it is NOT exported and jars-history-panel.js must not
  reach into jars.js internals → **DUPLICATE `buildIcon`+`ICON_DELETE`
  into jars-history-panel.js** (~35 lines) with a comment cross-
  referencing jars.js's copy *(design review — this icon has already
  churned twice; duplication avoids a 3-file shared-module extraction and
  keeps jars.js/jars.html/main.js untouched)*. Inline SVG `aria-hidden`;
  the button keeps its `aria-label` "Delete visit: <title>". Reuse the
  existing `.jar-history-row-delete:hover { color/border: var(--err) }`
  danger hooks. Behavior unchanged (calls `historyDelete`, repaint on the
  `history-changed` broadcast — no optimistic removal).

## Acceptance Criteria

- [x] Store `listByPage` unit-pinned (boundaries, partial last page,
      out-of-range → empty, page-1 order == listRecent page-1); `npm test`
      green.
- [x] `history-page` twin registered AND `history-list` pair REMOVED (net
      twin count stays 6; closed-set registration test updated); static
      error strings verbatim-pinned incl. `page`/`pageSize` bad-args,
      unknown-jar refusal, `{ ok, visits, total }` shape; grep-AC no `${`
      added.
- [x] Panel shows a numbered pager (prev/next + numbers, disabled ends),
      page clicks fetch the right page with the stale-token guard; Show
      more removed; "of many" status logic gone (H5 closed).
- [x] History rows are links; left AND ctrl AND middle click all open the
      URL in a NEW tab in the SAME jar (both `click` + `auxclick`
      intercepted → `internal-open-tab-in-jar` → `open-tab` →
      `inheritFromPartition`); `isSafeTabUrl` re-validated main-side;
      anchor styled neutral (no UA link colors). (Static/code-level
      verification this leg — live click-feel deferred to
      hat-reverification, per house practice for internal-page DOM.)
- [x] Per-row delete is a trashcan icon, `aria-label` intact, behavior
      unchanged.
- [x] Focus/stale-response/render-never-writes-count invariants preserved;
      the tab shell (Leg 03) undisturbed.
- [x] `npm test` / typecheck / lint green; jars.js line count reported
      (History-panel work lands in `jars-history-panel.js`, not jars.js —
      confirm jars.js is not pushed toward the ~1,800 trigger).

## Files Affected

- `src/main/history-store.js` (+ test) — `listByPage` + statement
- `src/main/history-ipc.js` (+ test) — `history-page` twin
- `src/main/internal-ipc.js` or main.js — `internal-open-tab-in-jar`
  handler (match where the internal handlers register)
- `src/preload/internal-preload.js`, `src/renderer/renderer-globals.d.ts`
  — `openTabInJar` + `historyPage` bridge/declares
- `src/renderer/pages/jars-history-panel.js` — pager (a REWORK of the
  cursor/append `refresh()`/`fetchPage()` into direct-page fetches, not an
  additive patch — *design review*; ~320 lines today), row links, trashcan
  (+ duplicated `buildIcon`/`ICON_DELETE`)
- `src/renderer/pages/jars.css` (or the panel's styles) — pager + trashcan
  + anchor styling

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed`
- [x] Do NOT commit
