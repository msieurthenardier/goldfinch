# Flight: History Panel Content

**Status**: landed
**Mission**: [Per-Jar Browsing History](../../mission.md)

## Contributing to Criteria

- [x] The history panel supports browsing recent visits, text search,
      deleting an individual entry, and clearing all history for that jar.
      *(primary charter)*
- [x] History participates in the jar data controls: clearing history via
      the data-class control and wiping a jar both remove that jar's
      history alongside its other data classes.
- [x] Each jar has its own retention policy (initial value 30 days),
      editable on the manage-jars page; entries older than the jar's
      retention are removed automatically. *(the EDIT control lands here;
      storage/default/pruning landed in Flight 1)*
- [ ] History adds no network egress *(search half — all queries local —
      SATISFIED this flight; criterion stays open pending Flight 4's
      suggestion-query half)*.

---

## Pre-Flight

### Objective

Fill the History panel with its real content — browse recent visits with
cursor paging, debounced text search, per-entry delete, and clear-all —
and complete history's integration into the jar data model: a `history`
data class in `JAR_DATA_CLASSES` (whose clear control auto-lands in the
History panel via Flight 2's `panelForDataClass` routing), history purge on
jar wipe AND jar delete (extracting the wipe composition into a shared
helper at its fourth copy), and the per-jar retention edit control with
prune-on-change. The panel content lives in a NEW page module — the DD2
growth trigger fires this flight — keeping `jars.js` under control.

### Open Questions

- [x] Does `identity-new` (per-tab fingerprint reroll) also clear history?
      → **No.** See DD3.
- [x] Retention edit control shape → preset select, instant apply. See DD5.
- [x] Lazy vs eager visit fetching → lazy on expand. See DD6.
- [x] Controller split (Flight 2 DD2's ~1,800-line trigger) → fires now;
      panel content is its own module. See DD7.

### Design Decisions

**DD1 — `history` joins `JAR_DATA_CLASSES`; discriminator-first dispatch;
the page work is NOT zero.** *(Reworked per Architect review.)*
`jar-data-classes.js` gains `{ id: 'history', label: 'History',
storages: null, custom: 'history' }` — the `custom` discriminator exists
because `storages: null` is already the cache sentinel.
- **`handleClearData` dispatches on the discriminator FIRST** (Architect
  HIGH: a naive `storages`-falsy fallthrough would run `ses.clearCache()`
  instead of the history purge — the operator would click "Clear History",
  get `{ok:true}`, and history would survive while the cache got wiped):
  `if (d.custom === 'history') → historyStore.clearJar(id)` +
  `history-changed { jarId }` when rows were deleted; `else if
  (d.storages) → clearStorageData`; `else → cache path`. The 3-line
  duplication of `history-ipc.js`'s `handleClear` body is CONSCIOUS (M06
  DD3 three-lines-don't-couple precedent). `registerJarIpc` deps gain
  `historyStore`.
- **The page-side auto-generation premise was FALSE** (Architect HIGH):
  post-F2, the history region renders a static hint and never calls
  `buildRegionControls()` (`panelButtonRows` has no `history` entry — the
  per-class button loop would silently skip the new descriptor), and
  `CONFIRM_REGIONS` is `['cookies','site-data','footer']`. Leg 2
  therefore: adds `'history'` to `CONFIRM_REGIONS`; builds a
  `buildRegionControls()` block in the history region (registered in
  `panelButtonRows`/`confirmAreas`/`confirmOpenKeys`) so the
  auto-generated Clear-History button + confirm land there; adds the
  `CLEAR_COPY`/`CLEAR_OK_NOTE` entries.
- The UI clear-history control keeps the **auto-generated
  `jarsClearData({ classes: ['history'] })` runner** — one mechanism for
  all classes, and the UI itself exercises the mission's data-class
  criterion path. (Rejected alternative, considered at review: routing
  the button through `bridge.historyClear` — avoids nothing once the
  server branch is fixed, and forks the mechanism.)

**DD2 — Wipe composition extracts at its fourth copy.** `handleWipe` and
`handleRemove` both gain history purge. That makes the
storage+cache+seed(+history) composition appear four times; per the M06
DD3 clause the jar-ipc pair extracts into ONE module-local helper
(`wipeJarData(ses, jarId)` — exact name at leg design) used by both
handlers. `main.js`'s `identity-new` copy stays as-is (cross-module
coupling for three lines was rejected in M06 F4 DD3's rationale and stands;
it also deliberately does NOT purge history — DD3).
- **Failure isolation** *(Architect review)*: the history purge gets its
  OWN try/catch, independent of the session-wipe `wiped` tracking —
  fail-soft (a purge throw never flips the op to `{ok:false}`, is logged
  `console.error('[history]', …)`, and never blocks the session wipe or
  the `jar-wiped` broadcast). Order: session wipe first, purge second.
- **`handleWipe` broadcasts `history-changed { jarId }`** when the purge
  deleted rows (`n > 0` gate) — DD6's collapsed-panel count refresh
  depends on it (a wipe leaving "23 visits" on the button would be a
  stale-count bug). `handleRemove` needs no broadcast (the section leaves
  the DOM entirely).

**DD3 — `identity-new` does NOT clear history.** The per-tab "new
identity" affordance rerolls the fingerprint persona and wipes session
storage — it is an anti-tracking identity break, not a data-visibility
control. History is the operator's own record; silently losing it on a
fingerprint reroll would violate the mission's visibility-and-control
identity. The mission names only the data-class control and jar wipe as
history-clearing surfaces. (Jar DELETE also purges — that's data hygiene
for a jar that no longer exists, closing Flight 1's orphan-GC stopgap.)

**DD4 — Retention mutation: `setRetention` + twins + prune-on-change via a
NEW single-jar store method.** *(Reworked per Architect review —
CRITICAL: the draft called `pruneExpired({ [id]: days })`, whose orphan-GC
contract treats every ABSENT jar id as orphaned and would have deleted
every other jar's entire history on any retention edit.)*
- `history-store.js` gains **`pruneOneJar(jarId, days, now)`** — runs only
  the per-jar cutoff delete, NO orphan sweep; safe by construction for
  single-jar callers; returns the deleted count; unit-pinned including a
  no-collateral test (other jars' rows untouched).
- `jars.js` (store) gains `setRetention(id, days)` — validates as an
  integer 1–3650 (REJECTS invalid with `null` return, unlike load-time
  coercion), persists, returns the updated record.
- New IPC twins `jars-set-retention` / `internal-jars-set-retention`
  (jar-ipc pattern, fail-closed `jars: set-retention — <code>` static
  strings): on success broadcast `jars-changed` FIRST, then run
  `historyStore.pruneOneJar(id, days, Date.now())` and broadcast
  `history-changed { jarId }` when rows were deleted (order stated
  deliberately) — shortening retention takes effect at once.
- Synchronous-delete cost accepted: the delete rides the
  `visits_jar_time` index; the Flight-1 scale probe measured ~2 ms
  queries at 51k rows — a retention-shrink delete is the same order.
  The mission's felt-instant criterion concerns suggestion queries, not
  this write path.

**DD5 — Retention control: preset select, instant apply.** Inside the
panel module's owned mount (DD7), at the top (above search; exact position
HAT-variable): a labeled `<select>` with presets (7, 14, 30, 90, 180, 365
days); if the jar's current value is not a preset, it renders as an extra
option (never silently moved). `change` applies instantly via the bridge
(instant-apply house pattern, like swatches); failure reverts the select
and surfaces the section error line via the module's `onError` hook.
Copy: "Keep history for: [N days]".

**DD6 — Panel content: lazy fetch, patch-in-place, cursor paging.**
- Visits are fetched when the History panel is EXPANDED (first expand per
  section triggers the fetch; collapsed panels never query). Rendered:
  up to 50 rows (title-or-URL primary line, host + local time secondary),
  each with a per-row delete (×) button; a "Show more" button pages via
  the `before` cursor; an empty state ("No visits recorded").
- A search input above the list: debounced (~250 ms), non-empty query
  switches the list to `historySearch` results (same row shape, same
  per-row delete); clearing the input returns to the recent list.
- `history-changed { jarId }` while expanded: re-run the CURRENT view
  (recent list or active search) top-page; while collapsed: refresh only
  the count (Flight 2's existing wiring). **The focused search input is
  never rebuilt** — the list container re-renders, the input persists
  (M06 F4 DD6 discipline inside the region).
- Per-row delete calls `historyDelete({ jarId, visitId })`; the
  `history-changed` broadcast drives the repaint (render-from-broadcast
  rule); no optimistic row removal.
- **Stale-response guard** *(Architect review)*: the module keeps a
  monotonic view-generation token (bumped on every query change, paging
  reset, and `history-changed` refresh); an async response may paint ONLY
  if its captured token is still current (the `stillOpen` precedent from
  `buildDataConfirm`). Out-of-order search responses and a late Show-more
  landing on a reset list are both discarded.
- Clear-all is NOT bespoke: it is the DD1 data-class control riding the
  existing confirm machinery in this panel's region (jars.js-owned block —
  see DD7's DOM contract).

**DD7 — The growth trigger fires: panel content is its own page module.**
`src/renderer/pages/jars-history-panel.js` (ESM page module, flat-served):
exports `createHistoryPanel({ bridge, jarId, regionEl, onError })` → a
self-contained controller owning the region's content DOM (search input,
list, paging, retention select) with `{ onExpanded, onHistoryChanged,
onJarsRow, destroy }` hooks — exact surface at leg design. `jars.js` builds
one per persistent-jar section and delegates; projected jars.js growth
stays ~+100 lines instead of ~+400 (post-F2 count: 1,671; the ~1,800
trigger would otherwise certainly fire). Registration: three-point
onboarding (jars.html module tag, exact form; `INTERNAL_PAGES.jars` entry;
script-tag test self-derives). The module is page-scoped (not
`src/shared/` — it owns DOM), mirroring how `pages/settings.js` organizes
controllers; it stays Electron-free and testable only via typecheck/lint
(page controllers have no unit suite — house practice).
- **DOM contract for the history region** *(Architect review — DD1's
  jars.js-owned controls and DD7's module-owned content would otherwise
  fight)*: the region has EXACTLY TWO children. Child (a): the
  jars.js-owned `.jar-data-controls` block from `buildRegionControls()`
  (Clear-History button + this region's confirm area — registered in
  `panelButtonRows`/`confirmAreas`/`confirmOpenKeys`, with `'history'`
  added to `CONFIRM_REGIONS`). Child (b): a mount `<div>` owned by
  `createHistoryPanel` — the MOUNT element (never the raw region) is what
  the module receives as `regionEl`. jars.js never writes inside (b);
  the module never touches (a) or the region node itself.
- The module never imports or reaches `ui`/`sectionMap` — its only
  channels are the constructor deps and its returned hooks (divert
  criterion below guards this).

**DD8 — Verification split.** Store/IPC semantics (clear branch, purge on
wipe/delete, setRetention validation + prune-on-change) are unit-pinned.
Panel UX is rendered-pixels territory (probes at verify-integration +
mission Flight 6 HAT). The mission criterion "clearing history via the
data-class control and wiping a jar both remove that jar's history" gets a
**DB-observable live probe** (filesystem read of history.db before/after —
the Flight-1 behavior-test read path), not a new Witnessed spec: the
existing `jar-data-controls` behavior spec covers the IPC surface shape,
and internal-page DOM stays non-automation-observable by design.

### Prerequisites

- [x] Flights 1–2 landed on the stacked branches (store API incl.
      `clearJar`/`pruneExpired`; panel regions + `regionForAction` +
      per-region confirms; `historyCount` wiring).
- [x] `DATA_ACTIONS`/`CLEAR_COPY` are built from `JAR_DATA_CLASSES`
      (recon-verified in F2) — a new descriptor auto-generates its button;
      only the copy tables need entries.
- [x] `retentionDays` on every jar record with validated load (Flight 1).

### Pre-Flight Checklist

- [x] All open questions resolved
- [x] Design decisions documented
- [x] Prerequisites verified
- [x] Validation approach defined
- [x] Legs defined

---

## In-Flight

### Technical Approach

Leg 1 (backend): `jar-data-classes.js` descriptor (+ TWO named breaking
tests *(Architect review)*: the hardcoded
`ids === ['cookies','storage','cache']` assertion AND the incidental
`jarDataClassById('history') === null` "unknown id" example — both in
`test/unit/jar-data-classes.test.js`; the F2 panel-model totality test
already anticipates `history`),
`jar-ipc.js` historyStore injection + clear branch + `wipeJarData`
extraction + purge in wipe/remove + `setRetention` twins +
prune-on-change, `jars.js` store `setRetention`, `main.js` deps update,
preload (`jarsSetRetention` both preloads? internal only — the page is the
only consumer; chrome parity NOT needed this flight) + d.ts. Unit tests
across jars/jar-ipc/history-ipc suites.

Leg 2 (panel UI): `pages/jars-history-panel.js` + `jars.js` integration +
`CLEAR_COPY`/`CLEAR_OK_NOTE` entries + retention select + CSS +
registrations.

Leg 3 (verify): live probes (browse/search/delete/clear-all/retention
change incl. DB-observable wipe/delete purge), gates, CLAUDE.md updates
(data-classes now four; history panel content; new module), flight close.

### Checkpoints

- [x] Backend leg: clear-data with `classes:['history']` empties exactly
      that jar's rows; wipe AND delete purge history; setRetention
      validates, persists, prunes immediately; suite ~1s.
- [x] Panel leg: expanded panel lists real visits; search narrows; per-row
      delete works; clear-all confirm rides the region; retention select
      applies instantly; focused search input survives broadcasts.
- [x] Live: DB-observable purge probes pass; count + list + search coherent
      against the real store.

### Adaptation Criteria

**Divert if**: the panel-module seam forces `jars.js` internals
(`ui`/`sectionMap`) across the module boundary in a way that couples both
files (would mean DD7's split shape is wrong — stop and re-plan).

**Acceptable variations**: row copy/format, preset list, debounce value,
page size, exact module hook names, error-string codes (static +
discriminable).

### Legs

> Tentative; created one at a time.

- [x] `data-class-and-retention-backend`
- [x] `history-panel-ui`
- [x] `verify-integration`

---

## Post-Flight

### Completion Checklist

- [x] All legs completed
- [ ] Code merged *(stacked PR; merges after human review)*
- [x] Tests passing
- [x] Documentation updated

### Verification

Unit: clear-branch, purge composition, setRetention, copy-table entries.
Live: rendered-pixel probes for the panel UX + filesystem (history.db)
probes for the purge criteria. HAT (mission Flight 6) owns final UX feel.
