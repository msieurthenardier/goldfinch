# Flight Log: Per-Jar Data Controls

**Flight**: [Per-Jar Data Controls](flight.md)

## Summary

Flight 4 of Mission 06 (Cookie Jar Management). Legs 1-3 (substrate, relayout,
data-controls UI) implemented, flight-reviewed, and committed; legs 4-5
(verify-integration, HAT) pending.

---

## Reconnaissance Report

Source artifacts: Flight 3 debrief (`../03-jar-management-page/flight-debrief.md`,
Recommendations 2-3 + Action Items) and the Flight 3 behavior-test run logs'
Validator carry-forwards. Every item the debrief assigns to Flight 4 planning was
walked against current code at design time (2026-07-10).

| item | classification | evidence | recommendation |
|------|----------------|----------|----------------|
| R2a: reuse page idioms (swatch grid, `ui.mode` exclusivity, in-page confirm, F6 icon-button convention) for data controls | confirmed-live (design input, not a gap) | `src/renderer/pages/jars.js` — `ui.mode` at :467-:614, icon buttons via `buildIcon`, in-page confirm block | Adopt as flight design constraint |
| R2b: `reconcileUi` cross-surface race has zero live witness | confirmed-live | `src/renderer/pages/jars.js:599` (`reconcileUi`); no test file references the path; F3 debrief untested-inventory | Deliberately exercise at this flight's HAT (row deleted elsewhere while its editor/panel is open) |
| R2c: create/edit Escape-dismiss paths human-witnessed only against confirm-delete | confirmed-live | `src/renderer/pages/jars.js:587` — single `ui.mode !== null` Escape handler covers all modes; only confirm-delete exercised at F3 HAT | Deliberately exercise at this flight's HAT |
| R2d: burner storage isolation asserted by partition NAMING only — cookie-write/read cross-check never pinned | confirmed-live | `tests/behavior/popup-jar-inheritance.md` step 4 asserts `jarId` string distinctness; Validator closing item 3 names the gap | Candidate behavior-test variant this flight (cookie set in burner A not visible in burner B) |
| R3: self-deriving broadcast-invariant net ("every settings-mutating IPC handler broadcasts `settings-changed`") | confirmed-live | No such test exists; broadcast sites scattered (`src/main/main.js:1715,1906,1921,1926,1931,2440`; `src/main/jar-ipc.js:139`) | Scope decision for the crew interview: this flight vs Flight 5 (F4's data-clear channels do not mutate settings, so shared surface is thin) |
| Validator carry-forward (jar-delete run): Burner's partition-less identity object unpinned | confirmed-live | Run log 2026-07-10-16-39-03 Validator closing item 5; no spec asserts the shape | Pin in this flight's data-controls behavior spec if one is authored |

No items classified `already-satisfied` / `partially-satisfied` — nothing to retire.

### Code-interrogation findings (design inputs)

- **A full-wipe primitive already exists**: `identity-new` (`src/main/main.js:2461`)
  composes `clearStorageData()` + `clearCache()` + `rerollSeed(ses)` per partition,
  exposed per-tab as the privacy panel's "New identity" button
  (`src/renderer/renderer.js:2331`, preload `chrome-preload.js:62`). Flight 4's
  "full identity wipe" is the same operation with a jar-scoped entry point.
- **Jar delete already composes the same wipe** (`src/main/jar-ipc.js:handleRemove`,
  :115-142) — wipe → reroll → revoke → broadcasts. The twin-registration pattern
  (chrome-trusted + `internal-jars-*` origin-gated, shared handler bodies) is the
  template for any new data-controls channels.
- **Class-granular clearing is natively supported**: Electron's
  `ses.clearStorageData({ storages: [...] })` accepts `cookies`, `filesystem`,
  `indexdb`, `localstorage`, `shadercache`, `websql`, `serviceworkers`,
  `cachestorage` (electron.d.ts `ClearStorageDataOptions`); HTTP cache is the
  separate `ses.clearCache()`. The mission's "extensible clearable-data-class
  list" maps onto a pure shared module (class id → label + storages/method),
  the house dual-export truth-table pattern.
- **The existing privacy handlers are per-TAB/origin scoped** (`privacy-cookies`,
  `privacy-clear-cookies`, `privacy-clear-storage`, `src/main/main.js:2475-2545`)
  — adjacent but distinct semantics; per-jar controls are new channels, not
  extensions of these.
- **Fingerprint seeds are per-session in-memory** (`farbleSeeds` WeakMap,
  `src/main/main.js:1951`) — reroll needs no persistence work.

---

## Flight Director Notes

### Flight start (2026-07-10)
- Phase file `leg-execution.md` loaded and validated (Crew / Interaction Protocol /
  Prompts all present). Crew: Developer + Reviewer, both Sonnet. Deferred-review
  mode: per-leg design reviews; single flight review + commit after leg 3 (legs
  1-3 are the implementation legs; leg 4 verifies against the committed baseline —
  the F3 two-commit shape).
- Flight `ready` → `in-flight`; branch `flight/04-per-jar-data-controls` created
  from main (`4e1d980`). ARTIFACTS.md defines no transition-time handling.

### Leg 1 design review (cycle 1 — approve with changes)
- Developer reviewer (Sonnet) verified the leg empirically. Standout find: the DD8
  invariant net's premise "F7 closed all known gaps" was FALSE —
  `automation:set-port` (main.js:1865-1869) mutates settings with no broadcast, a
  genuine pre-existing convention violation that would fail the net on first run.
  **FD ruling: fix the handler in this leg** (one line, matching the mint/revoke
  siblings), recorded as an incidental convention fix — the net's first real catch,
  at design time, before the net exists. Do-not-allowlist stance upheld.
- Also adopted: jar-ipc.test.js `makeHarness` fakes are ZERO-ARG recorders — the
  new assertions need an args-capturing, multi-call-per-session extension that must
  not break the 23 existing tests' `{ fn, partition }` reads (guidance rewritten);
  CLAUDE.md doc anchors added (:98, :175); two citation drift repairs
  (INTERNAL_PAGES.jars is :118-125; payload-guard comment at :60); shared-scope
  name-collision eyeball note added for the new module's top-level names.
- All changes are direct adoptions of the reviewer's own recommendations → cycle 2
  skipped (F3 FD-ruling precedent). Leg → `ready`. [HANDOFF:review-needed]

### Leg 2 design review (cycle 1 — approve with changes)
- Developer reviewer (Sonnet) killed two false premises in my draft, both by
  direct trace: (1) **the scroll container was inverted** — settings.css:24-31's
  own comment mandates BODY-scrolls (overflow on `main` is an axe
  scrollable-region-focusable violation); my draft told the implementer to make
  `main` scroll, which would have re-introduced the exact violation the donor
  file documents against. AC + guidance corrected (also: the donor layout is
  flexbox, not grid as my draft said). (2) **the create panel's focus-survival
  "property" does not exist** — render() rebuilds the panel on EVERY pass
  (jars.js:621, :465-466), so today an unrelated broadcast mid-typing destroys
  the create input. Promoted from an Edge Cases aside to a dedicated acceptance
  criterion: the survival must be BUILT this leg.
- FD rulings on the reviewer's open questions: aria-live goes on the page error
  line + per-section error lines ONLY (never the sections container —
  announcement spam); a single **uniform focus rule** replaces per-widget
  carve-outs (any container holding document.activeElement is patched in place,
  never rebuilt — name inputs, swatch grids, AND the nav, resolving the
  keyboard-focus-loss question the reviewer raised); jars.css drops the old
  centered-column layout in favor of the settings flex dialect; dead list-era
  CSS selectors are retired explicitly.
- Verified-clean notes from the review worth keeping: Escape precedence via
  bubble-phase reasoning is sound; the store never reorders surviving entries
  (add pushes, remove splices) so the reconcile never moves a focused section;
  the id rename `#jars-list` → `#jars-sections` breaks no CSS/test/spec;
  jar-delete-closes-tabs acts purely via IPC, so the relayout can't break it.
- Corrections are direct adoptions of reviewer traces + FD rulings derived from
  the reviewer's own recommendations; no new mechanism was authored → cycle 2
  skipped. Leg → `ready`. [HANDOFF:review-needed]

### Leg 3 design review (cycle 1 — approve with changes; scoped cycle 2 — sound with amendments)
- Cycle 1 (Sonnet): the leg-2 delete-confirm pattern does not generalize —
  `buildDataControlsBlock` is a flat five-button block with no confirm slot, and
  the delete mechanism swaps a single area's content (confirm REPLACES button),
  while the data actions need sibling buttons visible/clickable during a confirm.
  Also: the four confirms use confirm-LOCAL error lines (delete precedent), not
  the shared section line; `.jar-error-line` is err-colored so success feedback
  needs an `is-ok` modifier (red "Cookies cleared." caught before it shipped);
  message discipline last-write-wins with guarded timeouts; citation drift fixed.
  Reviewer verified clean: single-window premise, internal-tab sweep exclusion,
  no unit test pins the button DOM.
- **FD ruling (authored delta)**: ONE shared data-confirm area below the
  always-visible button row, diffed on the open `(action, rowId)` pair with the
  updateDeleteArea transition discipline — simpler refs than the reviewer's
  per-action wrappers, same guarantees. Per the F3 precedent, FD-authored deltas
  get a scoped cycle-2.
- Scoped cycle 2: **sound with amendments**, all adopted into the AC: (a) the
  transition key must be the (action,rowId) pair, not a boolean (sibling-swap
  correctness); (b) in-flight guards — resolve handlers verify `ui` still
  matches before mutating, and the triggering button disables while its action
  is in flight (stale-close + double-fire races the sibling-visible design
  opens; delete never had them because its success path removes the row);
  (c) confirm-open focuses the Confirm button (the shared below-the-row area
  otherwise leaves keyboard/SR users with no signal — the one real cost of the
  shared-area choice vs per-action wrappers, mitigated). Cycle 2 also cleared
  the uniform-focus-rule interaction (key-based skip is a strict superset) and
  noted the copy is deliberately name-free (comment required). Leg → `ready`.
  [HANDOFF:review-needed]

### Flight review (deferred, after leg 3) — [HANDOFF:confirmed]
- Reviewer (Sonnet, fresh context, no implementer reasoning) verified all leg 1-3
  acceptance criteria against code with live gates (1269/1269, typecheck, lint):
  handler guards/composition/failure paths exact; the security boundary intact
  (twin registerInternalHandler registration, no new bare channels, zero diff to
  internal-ipc.js/INTERNAL_ORIGINS); the (action,rowId) transition key,
  double-fire prevention, uniform focus rule, create-panel survival, and Escape
  precedence all confirmed by trace; the jar-wiped sweep independent of
  refreshOpenTabJars; the broadcast-invariant net genuinely self-deriving with
  anti-vacuous floors; no operator-identity leaks.
- Two NON-BLOCKING findings, both carried to the HAT crib notes: (1) an
  abandoned in-flight action that later SUCCEEDS still paints its success note
  into the section's shared status line (spec-compliant and documented-deliberate
  — the note is truthful row information — but operator may adjust presentation);
  (2) an abandoned in-flight action that later FAILS is silent by spec (its
  confirm-local error line no longer exists) — operator to weigh at HAT.
- FD: committed legs 1-3 + artifacts as the flight's first batch (two-commit
  shape); leg 4 verifies against this committed baseline. No PR opened —
  consistent with the F2/F3 operator workflow (sign-off → local --no-ff merge).

### Leg 4 design review (cycle 1 — approve, zero issues)
- First clean approve of the flight. The reviewer verified all seven staked
  premises against the committed baseline `13c6329`: chrome wrapper names +
  return shapes exact; the full jar-wiped → onJarWiped → sweep → wc.reload()
  chain (same wcId, in-place reload; enumeration's tabs Map untouched by
  navigation); exactly ONE jar-wiped emission site (handleWipe success);
  document.cookie is un-intercepted platform behavior (live store round-trip);
  createTab/makeBurner remain window properties (strict mode does not affect
  top-level function installation — and the popup-run precedent proved the
  route live); all four rejection combinations return {ok:false} pre-session;
  apparatus facts (dev:automation script, port 49707 default, Bearer +
  mcp-session-id) drift-free; crew file well-formed; no runs/ dir yet for the
  new spec.
- Adopted suggestion: the settle-then-recapture allowance extended to step 3's
  post-clear cookie read (same platform-timing assumption class as step 5's
  reload probe). Also noted for future legs: cite precedent runs that postdate
  the code they vouch for. Cycle 2 unnecessary. Leg → `ready`.
  [HANDOFF:review-needed]

---

## Leg Progress

### Leg 1 — data-classes-and-ipc (2026-07-10, landed)

Implemented the Electron-free substrate for per-jar data controls (CP1):

- `src/shared/jar-data-classes.js` (new): the frozen, ordered `JAR_DATA_CLASSES`
  list (`cookies` → `['cookies']`; `storage` → the six-value site-storage set;
  `cache` → the `null` sentinel) + `jarDataClassById(id)`, dual-exported following
  `jar-page-model.js:80-85`. Top-level names checked for collision against
  `jars.html`'s shared script scope (`jars.js` is IIFE-wrapped, so it declares
  nothing top-level; no collision with `BURNER`/`PALETTE`/`buildJarPageModel`/
  `isSafeColor`/etc.).
- Four-part onboarding: `eslint.config.mjs` globals entry, `renderer-globals.d.ts`
  declares, `jars.html` script tag (placed right after `burner.js`, before
  `safe-color.js` — script-order comment updated), and `INTERNAL_PAGES.jars`
  gained `'/jar-data-classes.js'` (`src/main/main.js`).
- `src/main/jar-ipc.js`: `handleClearData` (strict fail-closed — every requested
  class id validated before any session call runs; applies in payload order;
  cache sentinel → `clearCache()` + `clearStorageData({ storages: ['shadercache'] })`)
  and `handleWipe` (storage → cache → reroll → `broadcast('jar-wiped', { id })` →
  resolve; a thrown session call returns `{ ok: false, error }` with no broadcast
  and no reroll), each twin-registered on `jars-clear-data`/`internal-jars-clear-data`
  and `jars-wipe`/`internal-jars-wipe` (8 registrations → 16 channels total across
  both trust domains). Partition lookup is inline `jars.list().find(...)`, per the
  design-review ruling — no `get(id)` helper added.
- Preload wrappers: `jarsClearData`/`jarsWipe` added to both `internal-preload.js`
  (internal-origin-gated) and `chrome-preload.js` (chrome-trusted). No
  `onJarWiped` listener this leg, as scoped — it lands in leg 3 with the reload
  sweep it feeds.
- DD8 broadcast-invariant net (`test/unit/broadcast-invariant.test.js`, new):
  self-deriving source scan over `src/main/main.js` (registration-site
  extraction — every handler there is an inline callback) and
  `src/main/jar-ipc.js` (function-body extraction — every handler there is a
  named `function handleX` referenced by the registration calls). Both extraction
  passes run against a comment-masked copy of the source (a `//`/`/* */`
  stripper that preserves string literal contents and overall length) so neither
  the regex matching nor the mutation/broadcast marker checks can be fooled by
  text that only appears in a comment — caught live during implementation:
  `main.js:996` has a doc comment literally reading `ipcMain.handle('tab-create')`,
  which the unmasked version would have registered as a bogus (if harmless)
  extra match. The net found the design-review-flagged `automation:set-port` gap
  before the fix (confirmed by temporarily reverting the fix locally and
  re-running the net, then restoring — the Verification Steps' sanity check);
  after the fix (see below) it passes with the allowlist empty, pinned by a
  dedicated test.
- Incidental convention fix (DD8-found, FD ruling at design review):
  `automation:set-port` (`src/main/main.js`) now broadcasts
  `broadcastToChromeAndInternal('settings-changed', settings.getAll())`,
  matching the mint/revoke siblings — a genuine pre-existing gap the F7 fix did
  not cover.
- `test/unit/jar-ipc.test.js` extended: the `makeHarness` fake session's
  `clearStorageData`/`clearCache` now record an `args` field (additive — the
  original `{ fn, partition }` shape every pre-existing assertion reads is
  unchanged) so multiple sequential calls with different options on one session
  are individually assertable. Added coverage for the class-mapping (incl. the
  cache-sentinel two-call sequence), the full rejection matrix, duplicate-class
  handling, wipe composition order + failure containment, and both internal
  twins; extended the registration-surface and untrusted-sender assertions to
  the two new channel pairs.
- `test/unit/jar-data-classes.test.js` (new): shape/frozen-ness, id
  order/uniqueness, the Electron `ClearStorageDataOptions` taxonomy subset check
  (literal copy, citing electron.d.ts:20369), per-class mapping, `jarDataClassById`
  round-trip/unknown-id, and a `vm`-based check that the classic-`<script>`
  (`globalThis`) branch actually populates both globals correctly (not just
  collision-free, which `jars-page-shared-scripts.test.js` already covers as a
  side effect of the new script tag).
- CLAUDE.md: the jar-IPC prose (anchor :98) and the `internal-jars-*` channel
  enumeration (anchor :175) both updated to mention `jars-clear-data`/`jars-wipe`
  and their trust-domain twins.
- **Gates**: `npm test` 1269/1269 (was 1242/1242 on the Flight 3 baseline — +27
  from the two new test files plus the `jar-ipc.test.js` extensions); `npm run
  typecheck` clean; `npm run lint` clean.
- No deviations from the leg spec; the two citation drift repairs and the
  harness-rewrite guidance flagged at design review were followed as written.

### Leg 2 — page-relayout (2026-07-10, landed)

Reworked `goldfinch://jars` from the flat row list into the settings-style
master-detail layout (CP2):

- `src/renderer/pages/jars.html`: body restructured to `<nav aria-label="Jars">`
  (`#jars-nav` link list + the relocated `#jars-new` button) + `<main>`
  (`<h1>` + verbatim description + `#jars-page-error` + `#jars-create-panel` +
  `#jars-sections`). `<head>`'s script list left byte-identical (verified by
  `jars-page-shared-scripts.test.js`, still green).
- `src/renderer/pages/jars.css`: adopted settings.css's flex layout dialect —
  `<body>` owns the scroll (never `main`, per settings.css:24-31's own
  scrollable-region-focusable rationale), the nav is `position: sticky` +
  self-scrolling. Dropped the old single-column centering; retired all dead
  list-era selectors (`.jars-list`, `.jar-row*`, `.jar-icon-btn`, etc.); kept
  the button/form/swatch/error-line vocabulary from the row layout.
- `src/renderer/pages/jars.js`: rewritten render half on a keyed per-id
  reconcile (`sectionMap`/`navMap`), replacing the wholesale `listEl.textContent
  = ''` rebuild. Edit mode fully removed (no `'edit'` ui.mode, no
  `buildEditRow`, no `ICON_EDIT`; `ICON_DELETE`/`buildIcon`/`SVG_NS` also
  dropped as now-dead code — the Delete control is a plain labeled button, no
  icon). `ui` is now `{ mode: 'create'|'confirm'|null, rowId, action, draft }`
  (this leg's only `action` is `'delete'`).
  - **Instant apply (DD6)**: name input commits on Enter/blur via
    `jarsRename`, page-side trim is the sole whitespace enforcement; swatch
    click invokes `jarsRename({ color })` directly, with a short-lived
    `pendingColor` per section giving the click's own synchronous `paint()`
    immediate feedback (and reverting via a new `syncSwatchSelection` helper
    on failure, since a failed rename has no broadcast to self-correct).
  - **Uniform focus rule**: one guard pattern applied in three places — name
    inputs skip value-sync while focused, swatch grids patch
    `aria-checked`/`.selected` in place while focused (rebuild otherwise, so
    the 13th "current" swatch can still change), and the nav patches entries
    in place (via `insertBefore` reordering, which never drops focus) instead
    of wholesale-rebuilding when a nav link is focused.
  - **Create-panel focus survival (new work, not preexisting)**: added a
    `createPanelMode` tracker so `renderCreatePanel()` runs only on an actual
    ui-mode transition, never on a state-only broadcast pass — confirmed by
    the self-check greps (no wholesale rebuild in the render path) and by
    static trace (an unrelated `render()` call with `ui.mode` still `'create'`
    now short-circuits before touching `#jars-create-panel`'s DOM).
  - **Scroll-spy**: `observeSectionsIfChanged` lifts settings.js's
    IntersectionObserver pattern (same `rootMargin`), re-observing only when
    the section id set changes; `setActiveNav` strips the `jar-` id prefix to
    resolve the nav entry.
  - **Burner section**: structurally driven by `row.isBurner` (never an
    `id === 'burner'` check) — read-only, no name input/swatches/make-default/
    data-controls/delete, just the header line + the verbatim F4 hint copy.
  - **Data-controls block**: structural only this leg — one disabled button
    per `JAR_DATA_CLASSES` entry (`Clear ${label.toLowerCase()}`) plus a
    disabled "New identity" button, no handlers (leg 3 wires them).
  - **aria-live**: kept to `#jars-page-error` and each section's own error
    line (name-input errors and the delete-confirm's own error line); the
    sections container carries none, per the FD ruling against announcement
    spam.
- Self-check greps (leg spec Verification Steps): zero hits for `'edit'` mode
  string, `buildEditRow`, `ICON_EDIT`, and a wholesale `listEl.textContent = ''`
  clear in the render path.
- **Gates**: `npm test` 1269/1269 (unchanged from the leg-1 baseline — this leg
  adds no unit tests, matching DD9's HAT-owned page-DOM split;
  `jars-page-shared-scripts.test.js` still passes against the unchanged script
  list); `npm run typecheck` clean (one JSDoc fix needed — `SectionRefs`'
  Burner-only fields had to use `?:` optional-property syntax, not a
  `|undefined` union, for `tsc` to accept the narrower Burner-section object
  literal); `npm run lint` clean.
- **Manual smoke**: launched `XDG_CONFIG_HOME=<scratch> npm run dev` against an
  isolated scratch profile (confirmed via the single running Electron main
  process's `--user-data-dir`, which pointed at the scratch dir, not the
  operator's real profile). stdout showed a clean boot — only expected WSLg
  ozone/Wayland warnings and Electron's own deprecation/CSP-dev-mode notices,
  no renderer errors — and stayed clean over the observation window. The
  instance was torn down by killing the Electron main pid directly (never
  `npm`/`^C`, which doesn't cascade). See Anomalies below: the goldfinch MCP
  automation surface, when probed, resolved to a DIFFERENT already-running
  session (not the scratch instance), so the GUI-behavior half of the smoke
  checklist (nav contents, focus survival while typing, live recolor, delete
  confirm, Burner control-freeness) was **not** machine-verified this leg and
  remains HAT/verify-leg-owned, consistent with DD9's page-DOM split (the
  observe.js guards refuse internal-page DOM even when the surface is
  reachable).

### Leg 3 — data-controls-ui (2026-07-10, landed)

Wired the data controls end-to-end and landed the DD4 chrome reload sweep (CP3):

- `src/renderer/pages/jars.js`: `buildDataControlsBlock(id)` restructured into
  an always-visible button row (`.jar-data-controls-buttons`, five ENABLED
  buttons) + ONE shared `dataConfirmArea` below it, per row/section. Each
  button's click handler is `openDataConfirm(id, action)` — a generalized
  sibling of `openConfirmDelete` that sets `ui = { mode: 'confirm', rowId,
  action }` and re-renders; the delete area's own mechanism is untouched.
  - **`DATA_ACTIONS` table**: `clear-cookies`/`clear-storage`/`clear-cache`
    entries are built by iterating `JAR_DATA_CLASSES` (`'clear-' + cls.id`,
    `bridge.jarsClearData({ id, classes: [cls.id] })`); `wipe` is a fourth
    literal entry (`bridge.jarsWipe({ id })`). Each entry carries `{ copy,
    run, okNote, failNote }`. The four confirm-copy strings and the four
    success notes are the verbatim AC strings; a code comment on the table
    documents that the copy is deliberately name-free and that adding
    `{name}`-interpolation would require widening the transition key.
  - **`updateDataConfirmArea(refs, row)`**: cycle-2 AC (a) — the transition
    key is `ui.action + ':' + row.id` (string) or `null`, NOT a boolean, so a
    same-row action swap (e.g. clear-cookies → wipe) is itself a key change
    and forces a rebuild. Cycle-2 AC (c) — on an actual key change to
    non-null, the newly built Confirm button is focused synchronously.
  - **`buildDataConfirm(id, action, refs)`**: cycle-2 AC (b) in-flight guards
    — Confirm disables itself AND this action's row-button
    (`refs.dataButtons.get(action)`) the instant it's clicked (disabling the
    trigger makes a mid-flight swap-away-and-back to the same action
    impossible by construction, closing the double-fire hole the
    sibling-visible design opens); both re-enable unconditionally on settle.
    Resolve/reject additionally check `ui.mode === 'confirm' && ui.rowId ===
    id && ui.action === action` before closing the confirm or writing the
    confirm-LOCAL error line, so an abandoned promise from a swapped-away
    confirm can't stomp a newer one. On success the row's shared status line
    gets the past-tense note regardless of that guard (it's informational
    about the row, not about which confirm is currently open).
  - **`setSectionStatus(refs, text, ok)`** (new shared helper): centralizes
    every write to a section's `errorLine` — toggles the `is-ok` modifier
    class, and on a truthy `ok` write arms a `DATA_STATUS_OK_TTL_MS` (4s)
    timeout that clears the line only if its content is still unchanged
    (last-write-wins). The pre-existing rename/recolor error paths
    (`handleColorSelect`, `commitOrRevertName`) were switched to it too, so
    an `is-ok` note is never left stranded green by an unrelated later error.
    `renderSections`' section-removal cleanup now clears a departing
    section's pending handle before removing its DOM.
- `src/renderer/pages/jars.css`: `.jar-data-controls-buttons` (the flex row,
  split out of the old single `.jar-data-controls` rule),
  `.jar-data-confirm-area:not(:empty)` (top margin only when populated), and
  `.jar-error-line.is-ok` (`color: var(--ok)`).
- `src/preload/chrome-preload.js`: `onJarWiped: (cb) => ipcRenderer.on('jar-wiped', ...)`,
  the exact `onJarsChanged` one-liner shape, no `off*` (chrome preload has
  none). The leg-1 comment reserving it for this leg was removed.
- `src/renderer/renderer.js`: subscribed once beside the `onJarsChanged`
  handler (:133); the sweep iterates `tabs.values()`, matches
  `t.container.id === payload.id`, and fires `tabNavigate({ wcId, verb:
  'reload', args: [] })` for every match that's `isWebTab(t)` with a live
  `wcId` — the same guard/idiom as `newIdentity`'s own reload
  (renderer.js:~2346). `refreshOpenTabJars` untouched.
- `CLAUDE.md`: the DD10(b) shared-global onboarding checklist paragraph added
  to the "Recurring module shapes" note (four numbered parts — eslint global,
  d.ts declare, page `<script>` tag, `INTERNAL_PAGES` entry — plus one
  rationale sentence on why the first two are gate-enforced and the fourth is
  runtime-enforced).
- **Gates**: `npm test` 1269/1269 (unchanged — this leg adds no unit tests,
  matching DD9's HAT/behavior-test split for page-DOM confirm flows and the
  reload sweep); `npm run typecheck` clean; `npm run lint` clean.
- Verification-step greps all clean: zero `disabled = true` hits inside
  `buildDataControlsBlock`; `onJarWiped` present in `chrome-preload.js` and
  subscribed exactly once in `renderer.js`; all four action strings
  (`clear-cookies`/`clear-storage`/`clear-cache` via `'clear-' + cls.id`,
  `wipe` literal) present in `jars.js`.
- Live/HAT-level verification of the confirm flow and the reload sweep was
  **not** attempted — DD9 (flight.md) rules page-DOM behavior HAT-owned; the
  goldfinch MCP `evaluate`/`readDom`/etc. ops refuse internal-page DOM by
  design (`observe.js` guards), so there is no machine path to drive
  `goldfinch://jars` even with the automation surface live. A stdout-only
  boot smoke (`XDG_CONFIG_HOME=<scratch> GOLDFINCH_AUTOMATION_DEV_MINT=1
  GOLDFINCH_AUTOMATION_ADMIN=1 npm run dev:automation`, torn down via
  `timeout`) confirmed a clean boot (mint key printed, only the usual WSLg
  ozone/Wayland + Electron deprecation/CSP-dev-mode noise) but did not
  navigate to the jars page. End-to-end confirm/reload behavior is leg 4's
  `jar-data-controls` spec and the leg-5 HAT, per plan.

### Leg 4 — verify-integration (2026-07-10, completed)

Gates on the committed baseline `13c6329`: suite 1269/1269, typecheck clean,
lint clean. Two behavior-test runs, both live two-agent continuation, each on
its own fresh stage (per-run staging ruling; both instances torn down after;
fallback port 49709 — fifth and sixth consecutive observations):

- **`jar-data-controls` 2026-07-10-22-10-41 — 7/7 PASS (first run; spec
  `draft` → `active`)**. Live-proven: class-granular clears act on exactly the
  requested class (cookie clear left localStorage; storage clear then removed
  it), stay jar-contained (personal cookie survived work clears), and do NOT
  reload; the full wipe reloads the jar's tabs in place (in-memory expando
  sentinel gone, wcId unchanged) via the jar-wiped sweep; all four
  burner/unknown rejection combinations return {ok:false} on both channels;
  two burner tabs do not share cookie storage. CLOSES both declared
  carry-forwards (Burner identity shape; burner storage isolation).
- **`jar-delete-closes-tabs` 2026-07-10-22-24-45 — 5/5 PASS (re-run)**. The F4
  relayout did not disturb the closure/registry/fallback contract; zero
  payload-shape drift vs run 1. Validator scope caveat (correct, by design):
  state-level pass only — the rendered-layout half of the relayout risk is
  HAT-owned per DD9.
- Validator carry-forwards for future spec revisions (debrief items): cookie-only
  cross-jar containment could probe all three classes; bare `{ok:false}`
  rejections are observationally identical across causes (a `reason` field would
  make path regressions detectable); burner isolation is one-directional;
  step-5's prose settle could be a poll-until condition; no spec teardown
  convention.
- Notable operational: the Executor's attempt to stash the admin key in a helper
  file was denied by the permission layer and correctly rerouted to
  header-only use — key discipline held; no key material in any committed
  artifact (leak-grep clean, operator-identity grep clean).

### Leg 5 (HAT) design review (cycle 1 — approve with changes) + pre-HAT fix
- The HAT-script review earned its keep before the operator spent a minute:
  **it found a real bug in the leg-2 code by tracing the script's own step 6** —
  `commitOrRevertName` had no dirty tracking, so blurring a focused-but-untyped
  name input after a cross-page rename would commit the STALE name back,
  silently reverting the other surface's rename (the exact opposite of the
  code's documented sync-on-blur contract).
- **FD call, made out loud per the mini-leg gate: FIX, not feature** (contradicts
  documented intent; scoped one-file change). Developer spawned pre-HAT:
  `nameDirty` flag set only by the input listener; non-dirty blur now syncs the
  display instead of committing; Escape and all commit paths clear the flag;
  comments updated to keep the contract truthful. Gates re-run green
  (1269/1269, typecheck, lint). The HAT's step 6 is promoted to a REQUIRED
  check as the fix's live witness (page DOM is HAT-owned per DD9 — no unit seam).
- Script corrections adopted from the review: step 3 ends with the jar renamed
  back to "HatOne" (later steps reference the label); step 4 names the picker
  row precisely ("New Jar"), notes its open-a-tab side effect, and names the
  second quick-create jar ("HatRace2") for cleanup accounting; step 7 lists the
  full cleanup set and carries two crib notes (HatTwo's tabs close on delete —
  expected F3 behavior; the delete control is currently a full-size "Delete
  jar…" text danger button, presentation operator-adjustable).
- Leg → `ready`. HAT is operator-interactive from here.

### Leg 5 — hat-jar-data-controls (2026-07-10, completed — all 7 steps PASS)

**Backfilled 2026-07-10 from the session transcript after a WSL crash killed the
FD session mid-leg.** The crash lost the log writes, not the work: all fixes
below are on the working tree and were re-verified post-crash (suite 1277/1277,
typecheck, lint — all green).

- **Step 1 (layout + entry points): PASS** ("functions well") with three
  look-and-feel findings, all FIX under the inline protocol, implemented in one
  Developer spawn and re-verified by the operator:
  - **F1** — "Make default" moved into the section header, occupying the same
    spot as the Default pill (the two swap in place as the flag moves).
  - **F2** — wipe button relabeled "New identity" → **"Clear identity"**
    (`jars.js:794`); success note aligned ("Identity cleared — …"). The privacy
    panel's separate per-tab "New identity" button was deliberately left
    untouched — different surface; rename it only if the operator asks.
  - **F3** — delete button gains a leading trashcan icon (Flight 3's CSP-safe
    `buildIcon` helper restored from `4e1d980`).
  - Side Q&A recorded: "Clear identity" = full data wipe **plus fingerprint
    persona reroll** (fresh farbling seed), vs the three data buttons which
    clear stored data only and leave the persona linkable.
- **Step 2 (create from sidebar): PASS** after two findings, fixed and
  re-verified:
  - **F4** — create panel repositioned: now a single stable node anchored
    inside `#jars-sections` immediately before the Burner section, so the form
    opens where the new jar's section will land (was: form at top, result at
    bottom). One conditional `insertBefore` per render; contents still rebuilt
    only on mode transitions, focus/caret preserved.
  - **F5** — `pickNewJarColor` added to `jar-page-model.js` (beside PALETTE):
    new-jar preselected swatch is uniformly random among palette colors not
    already in use, whole-palette fallback when all are used. +8 unit tests
    (rng determinism, used-color exclusion, all-used fallback, garbage-input
    safety) — suite 1269 → **1277**.
- **Step 3 (instant-apply editing): PASS** — operator reported "all pass"
  covering the F4/F5 re-verification and the step-3 checklist (Enter commit,
  blur commit, whitespace revert, Escape revert-and-blur, swatch recolor,
  rename back to "HatOne").
- **F6 (open at crash)** — operator finding outside the script: with the
  settings tab open, renaming/recoloring a jar on the jars page does not update
  the settings tab's jar display (automation key list renders jar name + color
  but refreshes only on `settings-changed`; `jars-changed` is never
  subscribed). FD ruled it a genuine cross-surface staleness bug **predating
  this flight**; call: FIX, inline protocol. The Developer spawn for it was
  interrupted ~90s in by the WSL crash — **no F6 code landed** (`settings.js`
  untouched). Resumption re-spawns it.
- **F6 fixed on resume** (Developer re-spawned with the original brief):
  diagnosis confirmed — settings.js's automation key list refreshed only on
  `settings-changed`; `jars-changed` (the rename/recolor broadcast) was never
  subscribed. Fix subscribes both settings-page IIFEs via the internal
  preload's existing `onJarsChanged`/`offJarsChanged` (the jars.js:1359
  convention: subscribe + pagehide cleanup), reusing the existing `refresh()`
  path — no parallel render path. **The Developer found a second instance of
  the same bug class during diagnosis**: the automation activity viewer's
  `jarNames` map (session labels) was seeded once from `automationKeysOnce()`
  and never refreshed — also fixed, rebuilt from the broadcast payload.
  One file (`settings.js`, +27), gates green (1277/1277, typecheck, lint).
  Operator re-verification pending.
- **F6 re-verified by operator: PASS** (key-list name + swatch update live on
  rename/recolor from the jars page; post-crash relaunch).
- **Step 4 (focus preservation): PASS** — caret survived a picker quick-create
  broadcast mid-edit ("HatRace"); create panel + typed text survived a second
  quick-create ("HatRace2"). DD6's hard requirement holds live.
- **F7 (operator UX change, settings page)** — FD call, out loud: look-and-feel
  FIX class, inline protocol (presentation swap on existing elements, no new
  behavior/state; operator explicitly waved it through). Spec: in the
  automation key list, (1) jars WITH a minted key show the robot icon in place
  of the color square; (2) jars without a key show a color dot matching the
  tab-strip presentation.
- **F7 implemented**: keyed jars show the robot glyph (hand-reproduced from the
  tab strip's `#automation-indicator` SVG via `createElementNS` — the original
  is static markup, so no shared builder existed; `currentColor` + inline
  jar-color tint, the indicator's own convention), unkeyed jars show an 8px
  dot mirroring the tab strip's `.tab-jar` (deliberately NOT the jars page's
  larger bordered dots — spec said "match the tab"). Same 12×12 slot footprint
  either way; choice re-derives on every `renderJars()` so mint/revoke/
  rename/recolor update live. **Net-new hardening flagged by the Developer**:
  the old swatch set `jar.color` UNGUARDED and settings.html didn't even load
  `safe-color.js` — the fix wires it in (`INTERNAL_PAGES.settings` in main.js +
  script tag, per the jars-page precedent) and applies the
  `isSafeColor`/`FALLBACK_COLOR` idiom. Files: settings.{js,css,html} +
  main.js (page-serving wiring only). Gates green (1277/1277, typecheck,
  lint). Operator re-verification pending.
- **F7 re-verified by operator: PASS** ("perfect") with one sizing follow-up,
  implemented by the same Developer (context continued): settings key-list
  slot 12→14px, robot glyph 12→14, unkeyed dot 8→10 (tab strip's own 8px
  `.tab-jar` untouched). Toolbar `#automation-indicator`: no literal CSS
  padding found — the "excess padding" impression is the robot artwork's
  viewBox whitespace (ink fills ~67% of the 24-unit box vs ~83% for Shields),
  so the glyph renders 16→18px via an id-scoped override; the 36×32 button box
  is unchanged (no toolbar height jump), viewBox left uncropped per the shared
  Lucide convention. Next notch if still light: 20px. Gates green (1277/1277,
  typecheck, lint). Sizing re-verification pending.
- **F7 sizing re-verified by operator: PASS** ("perfect") — 18px toolbar robot
  / 14px settings glyph / 10px dot stand.
- **Step 5 (data controls, confirm-everything): PASS** — confirm-below-row with
  focus landing, Cancel, Confirm + non-red success note, confirm SWAP on
  cross-action click, Escape dismiss all verified live. **CP5 presentation
  rulings**: operator passed the step with no change requests — (a) swapped-away
  success note painting the shared status line: KEEP as-is; (b) silent failure
  after swap-away: ACCEPTED as spec'd. Both closed.
- **Step 6 (wipe reload + cross-surface race): PASS, all three parts** —
  (1) HatTwo wipe visibly reloaded both its tabs, others untouched;
  (2) HatRace deleted from page B collapsed page A's open delete confirm
  silently, no stale editor; (3) **REQUIRED witness PASS**: focused-untyped
  name field in page A synced to page B's rename on blur instead of
  committing the stale name — the pre-HAT `commitOrRevertName` dirty-flag fix
  is live-verified. Both F3 carry-forward zero-witness paths now have live
  witnesses.
- **Step 7 (cleanup): PASS** — HAT jars deleted (HatOne, HatTwo, HatRace2;
  HatRace already removed by step 6's race), HatTwo's tabs closed on delete as
  expected (F3 behavior), all surfaces back to real jars only. Operator noted
  it's a dev instance and residual state is not a concern.
- **HAT COMPLETE — all 7 steps PASS.** Findings ledger: F1-F5 (steps 1-2,
  look-and-feel), F6 (cross-surface staleness, predates flight, + second
  instance in activity viewer), F7 (settings key-list robot/dot iconography +
  sizing pass incl. toolbar indicator 16→18px). All fixed inline, all
  operator-re-verified. CP5 checked; both F3 carry-forward zero-witness paths
  now live-witnessed. Leg 5 → `completed`, flight → `landed` per operator
  instruction ("land the flight including the debrief; merge to main; bump
  minor for a new installer").

---

## Decisions

*(none yet)*

---

## Deviations

- **Leg 3**: `renderer-globals.d.ts`'s `GoldfinchInternalBridge` interface was
  missing `jarsClearData`/`jarsWipe` declares — leg 1 exposed both on
  `internal-preload.js` (`src/preload/internal-preload.js:336,347`) but the
  d.ts declare half of leg 1's own four-part onboarding note (DD2) was not
  applied to them (they're preload-bridge methods, not a shared-global
  module, so the checklist didn't literally cover them, but the same
  "typecheck needs a declare" logic applies). `npm run typecheck` failed on
  `bridge.jarsClearData`/`bridge.jarsWipe` inside the new `DATA_ACTIONS`
  table until this leg added both to the interface. Fixed in place
  (`src/renderer/renderer-globals.d.ts`) since it blocks this leg's
  typecheck gate; not a leg-1 regression in shipped behavior, only a
  type-declaration gap.

---

## Anomalies

- **Leg 2 smoke check**: `mcp__goldfinch__enumerateTabs`, probed during the
  leg-2 manual smoke to see whether the automation surface could verify GUI
  behavior, returned tabs from a session that was clearly not this leg's
  scratch-profile launch (real-looking site content, a jar id already in use)
  while only one Electron main process was actually running on the box (this
  leg's scratch instance, confirmed via its `--user-data-dir`). The MCP call
  was not repeated and no `navigate`/`evaluate` calls were made against those
  wcIds — treated as a signal that the configured automation endpoint may
  reach a session outside this leg's isolated launch, so it was avoided
  entirely rather than risk touching a real profile. Worth a look before any
  future leg relies on the goldfinch MCP for jars-page smoke verification.

---

## Session Notes

- 2026-07-10: Flight design started (/flight 4). Context gathered; recon report
  above produced from the F3 debrief and run-log carry-forwards; all items
  confirmed-live, no retirements proposed.
- 2026-07-10: Operator relayout ruling reshaped the flight beyond "add data
  controls": settings-style master-detail (left link tree + always-expanded
  sections), edit button removed, "+ New jar" to the sidebar. Interview rulings:
  instant apply; confirm EVERY clear; auto-reload after full wipe only; all three
  scope add-ons ride (HAT, burner cookie cross-check, broadcast-invariant net).
- 2026-07-10: Architect design review (Sonnet, cycle 1): **approve with changes.**
  All nine flagged empirical premises verified against the tree — none failed (the
  F3 "asserted a nonexistent hook" class did not recur). Two medium issues, both
  mechanical wiring gaps, fixed inline: (1) the `jar-data-classes.js` page-serving
  path (jars.html script tag + `INTERNAL_PAGES.jars` entry) was unassigned → now
  explicitly leg 1, DD2/DD10 extended to the four-part onboarding checklist;
  (2) DD4's `jar-wiped` broadcast had no chrome-preload listener named → `onJarWiped`
  added to DD3, assigned to leg 3. Suggestions applied: DD3 names the
  `jars.list().find` lookup idiom (no `get(id)` helper exists); behavior spec step 6
  extended to all four burner/unknown-id rejection combinations across both
  channels; leg 1's description itemizes the cache-sentinel unit case. FD call:
  changes are mechanical/cosmetic — cycle 2 skipped per the skill's minor-fix rule.
- 2026-07-10: HAT session (legs 1-4 committed at `8fcd43c` beforehand). Steps 1-3
  passed with findings F1-F5 fixed inline and re-verified (detail in the Leg 5
  backfill entry under Leg Progress). Operator then reported F6 (settings-tab jar
  display staleness); the Developer spawn for it was cut off by a WSL crash that
  ended the session. Log entries for the HAT were lost with the session.
- 2026-07-10: Post-crash resume (new FD session). Tree verified intact; gates
  re-run green (1277/1277, typecheck, lint); HAT ledger reconstructed from the
  crashed session's transcript and backfilled above. Leg 5 `ready` → `in-flight`
  (it was already being executed; the status write was lost with the crash).
  Resuming at: F6 re-spawn, then HAT step 4.
