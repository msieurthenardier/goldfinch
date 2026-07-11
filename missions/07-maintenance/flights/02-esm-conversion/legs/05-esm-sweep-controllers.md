# Leg: esm-sweep-controllers

**Status**: completed
**Flight**: [ESM Conversion of src/shared/](../flight.md)

## Objective

Convert the four page controllers — `renderer.js`, `pages/jars.js`,
`pages/settings.js`, `menu-overlay.js` — to ES modules importing their
shared dependencies, delete ALL transitional `globalThis` bridges from
the 13 converted shared modules, and publish an explicit
evaluate-reachable seam from `renderer.js` so the automation/dogfooding
pattern survives module scoping.

## Context

- **This is the bridge-retirement leg**: the transitional bridges existed
  solely for these four classic consumers. After conversion, the 13
  converted shared modules export only — no `globalThis` publication.
  `menu-controller.js` (DD6) remains the ONLY classic script in the
  product, still publishing `menuController`/`focusItem` globals, which
  the converted controllers may keep reading as bare globals (modules
  read globals fine; its eslint injected-global entries and d.ts declares
  stay until a future cycle).
- **Module scoping breaks evaluate-reachable functions — deliberate seam
  ruling (FD)**: a classic script's top-level `function` declarations are
  page globals; a module's are module-scoped. Product code never calls
  renderer functions by global name (`executeJavaScript` sites in
  `src/main/automation/observe.js` are self-contained snippets /
  caller-provided expressions — verified), but the evaluate-driven
  dogfooding pattern does (`openJarsPage()` at `renderer.js:600`,
  `kebabActionSettings()` `:219`, `openContainerOverlay` `:351` — used
  by this flight's own live-boot procedure and by behavior-test specs).
  Ruling: `renderer.js` publishes an explicit, commented
  `globalThis` seam for evaluate-reachable entry points. This is NOT the
  collision class (deliberate assignments from module scope, not
  top-level declares in a shared lexical scope). **Seam membership —
  FD-approved 18-entry set (design-review sweep of `tests/behavior/*.md`,
  `docs/mcp-automation.md`, AND evaluate-driving scripts —
  `scripts/a11y-audit.mjs:330-399` drives 11 entries by name and is run
  by this flight's Post-Flight `npm run a11y` verification)**:
  dogfooding trio `openJarsPage`, `kebabActionSettings`,
  `openContainerOverlay`; behavior-spec entries `createTab`, `makeBurner`
  (popup-jar-inheritance, jar-data-controls primary paths), `newIdentity`
  (farbling-correctness), `measureWebviewsSlotDIP` (panel-slide),
  `openFind` (tab-surface-geometry); a11y-audit entries `navigate`,
  `togglePanel`, `togglePrivacy`, `openLightbox`, `closeLightbox`,
  `applyToolbarPins`, `openKebabOverlay`, `openSiteInfoOverlay`,
  `openNewContainerOverlay`, `openPageContextMenuForAudit`. Tag each
  entry in the seam comment with its consumer class
  (dogfooding / behavior-spec / a11y-audit). No silent growth beyond
  these 18. The other three controllers host no seam: they are
  IIFE-wrapped (no page-global functions even today), the two internal
  pages refuse evaluate anyway, and sheet-targeted evaluate calls are
  DOM-only expressions (design-review sweep).
- **Import maps per controller** (from the leg 3/4 consumer inventories):
  - `renderer.js` (file://, `../shared/*.js`): `BURNER`,
    `buildContainerModel`, `buildAutomationIndicatorModel`,
    `isSafeColor` (`:2034` direct read), `isSafeTabUrl`,
    `isSafePosterUrl`, `isInternalPageUrl`, `keydownToAction`,
    `deriveSiteInfo`, `pageContextModel`, `resolveNewTabContainer`,
    `inheritContainerDecision`, `inheritFromPartition`
  - `pages/jars.js` (goldfinch://jars flat srcs, `./*.js`): `BURNER`,
    `buildJarPageModel`, `PALETTE`, `pickNewJarColor`,
    `JAR_DATA_CLASSES`, `isSafeColor`
  - `pages/settings.js` (goldfinch://settings flat srcs): `activeLog`
    (see rename below), `windowPage`, `reduceAudit`, `pageList`,
    `pageCount` (audit-paging), `isSafeColor`
  - **Flat-served specifier vs tsc — FD ruling**: the two internal
    pages' imports MUST be flat (`./safe-color.js`) — INTERNAL_PAGES is
    an exact-match flat map, so a disk-true `../../shared/*.js`
    specifier 404s at boot — but tsc cannot resolve flat specifiers
    against the disk layout (probe: 6× TS2307). Ruling: `// @ts-ignore`
    on each of the six flat-served import lines, with a one-line comment
    (serving-path vs disk-path mismatch; bindings type as `any`,
    matching today's ambient-global typing — no regression). Do NOT
    restructure the protocol map (trust-sensitive, out of scope).
    Backlog-note the mismatch for a future typing cycle.
  - `menu-overlay.js` (file://, `../shared/safe-color.js`): `isSafeColor`
- **audit-paging canonical-name completion (leg 3 ruling)**:
  `settings.js:1028` renames `activeLogOf(state)` → `activeLog(state)`;
  the `:901` globals comment updates to describe imports. The
  `activeLogOf` bridge alias dies with the bridges.
- **Both vm nets need the SAME prescribed amendment leg 4 gave the
  chrome net**: converting `jars.js` empties the jars net's replay list,
  and its in-test transitional guard
  (`jars-page-shared-scripts.test.js:112`, ≥1 classic) fails on empty —
  same early-return one-liner, same leg-6-disposition comment. The
  chrome net needs NO further change (its replay list emptied in leg 4;
  its DD3 pin goes vacuous when renderer.js stops being classic —
  vacuous is correct).
- **The repurposed jar-data-classes bridge test dies with the bridges**
  (leg 3 set this up explicitly): delete the bridge-contract test cases
  from `test/unit/jar-data-classes.test.js` — suite count drops
  accordingly (design review pins the exact number).
- **eslint**: the four controllers currently parse under the
  `src/renderer/**` block's `sourceType: 'script'` — `import` syntax is
  a parse error there. Add an override block scoping
  `sourceType: 'module'` to exactly the four controller files (leg 6
  consolidates). The injected shared globals in the renderer block become
  unused but STAY this leg (removal is leg 6's).
- **d.ts untouched this leg** (leg 6 slims): ambient shared-global
  declares are legally shadowed by the controllers' module-scope imports.
- Retags: `index.html` renderer.js `defer` → `type="module"`;
  `jars.html` jars.js; `settings.html` settings.js; `menu-overlay.html`
  menu-overlay.js (menu-controller.js STAYS classic `defer`, positioned
  before menu-overlay.js — document order preserved in the shared queue,
  so its globals exist when menu-overlay.js executes).
- Boot gate: `renderer.js`'s bottom `Promise.all([...settingsGet,
  jarsBoot]).then(createTab)` runs at module evaluation — same queue
  position as today's defer; timing unchanged.

## Inputs

- Working tree with legs 1-4 landed (uncommitted): 1285/1285 @ ~1.0s,
  typecheck, lint green; CP2 checked; four surfaces live-proven.
- The four controllers (`renderer.js` 2923 lines, `pages/jars.js` 1375,
  `pages/settings.js` 1104, `menu-overlay.js` 506 — all `'use strict'`
  classic).
- The 13 converted shared modules' transitional bridge blocks.
- The four documents' controller script tags (all `defer` classic).
- `test/unit/jars-page-shared-scripts.test.js:112` (transitional guard),
  `test/unit/jar-data-classes.test.js` (bridge-contract cases),
  `eslint.config.mjs` (renderer block + module override at 15 files).

## Outputs

- Four controllers on ESM with explicit imports; zero transitional
  bridges left in `src/shared/`; the renderer.js evaluate seam published
  and documented.
- `menu-controller.js` the only classic script in the product.
- Suite green at the post-deletion count; all four surfaces live-proven.

## Acceptance Criteria

- [x] Each controller: `'use strict'` removed, import block added
      (exactly the symbols in Context's import map — explicit `.js`
      extensions, relative to the document's SERVING path; the six
      flat-served imports carry the ruled `// @ts-ignore` + comment), NO
      other logic change except the settings.js rename and the
      renderer.js seam
- [x] `settings.js:1028` calls `activeLog(state)`; the `:901` comment
      describes imports; no other settings.js logic change
- [x] `renderer.js` seam: a single commented block at the end publishing
      EXACTLY the FD-approved 18 entries on `globalThis`, each tagged
      with its consumer class ("evaluate-reachable automation/dogfooding
      seam — module scope hides top-level functions; NOT the collision
      class")
- [x] All 13 converted shared modules: transitional bridge blocks and
      their comments DELETED — `grep -rn "globalThis)\." src/shared/`
      returns zero; `grep -rn "Transitional (flight 02)" src/` returns
      zero
- [x] Retags: the four controller tags `type="module"`;
      `menu-controller.js` still classic `defer` before menu-overlay.js;
      document comments updated (index.html's DD3 block now describes a
      fully-module page; menu-controller carve-out noted on
      menu-overlay.html)
- [x] Jars net: EXACTLY the one prescribed change (the `:112` guard →
      early return on empty classic list, leg-6-disposition comment);
      everything else byte-unchanged. Chrome net: byte-unchanged this
      leg. Any other net change → STOP and report
- [x] `test/unit/jar-data-classes.test.js`: the bridge-contract test
      deleted (a single `test()` at `:104-112` — design-review pinned);
      post-deletion suite count is exactly **1284**, nothing else removed
- [x] eslint: one new override block, `sourceType: 'module'` scoped to
      exactly the four controller files, placed AFTER the
      `src/renderer/**/*.js` block (flat config, later wins — before it,
      `sourceType: 'script'` wins back and `import` is a parse error);
      renderer-block globals untouched (leg 6)
- [x] NO change to: `menu-controller.js`, `find-overlay.js`,
      `renderer-globals.d.ts`, main-process files, preloads, the 4
      plain-CJS shared modules
- [x] Suite green at 1284 (< 1.5s), typecheck green (with the ruled
      ts-ignores), lint green
- [x] LIVE BOOT, all four surfaces (leg 2/3 procedure): chrome boots with
      a live tab (boot gate ran as a module); jars page renders rows +
      swatch grids via `openJarsPage()` THROUGH THE NEW SEAM; settings
      page renders the activity pager via `kebabActionSettings()` (seam)
      — proving the `activeLog` rename live; container sheet renders jar
      rows + dots via `openContainerOverlay(0)` (seam); launcher stderr
      clean across all four — in particular ZERO `ReferenceError`
      (the signature of a missed bridge deletion or import gap)

## Verification Steps

- `npm test && npm run typecheck && npm run lint`
- The two greps in the ACs (zero bridge assignments; zero transitional
  comments)
- `node --test` isolation: both nets + `jar-data-classes.test.js` +
  `jars.test.js`, `menu-overlay-manager.test.js`,
  `menu-overlay-value.test.js`, `menu-controller.test.js` (match real
  filenames — there is no settings-controller test)
- Live boot per AC; evidence in the flight-log entry
- `git diff --stat` — this leg adds exactly: 13 shared files (bridge
  deletions), 4 controllers, 4 documents,
  `test/unit/jars-page-shared-scripts.test.js`,
  `test/unit/jar-data-classes.test.js`, `eslint.config.mjs` on top of
  legs 1-4 (+ artifact files)

## Implementation Guidance

1. **One surface at a time, innermost first, suite + targeted checks
   between each**: (a) menu-overlay.js (smallest, single import), (b)
   settings.js (import + rename), (c) jars.js, (d) renderer.js (largest,
   + seam). For each: convert controller + retag its document + delete
   the bridges whose LAST classic consumer just converted.
2. **Bridge-deletion schedule (complete, design-review-verified)**:
   step (b) → audit-paging (settings-only); step (c) → jar-page-model +
   jar-data-classes (jars-page-only); step (d) → the remaining 10
   (burner, container-menu, safe-color incl. the `:2034` read,
   automation-indicator-model, and the six chrome providers — all have
   renderer.js as their last classic reader). After step (d) the grep AC
   must be clean.
3. **Jars net amendment** rides step (c) (the leg that empties its
   replay list).
4. **jar-data-classes bridge-test deletion** rides step (c)'s bridge
   deletion? NO — jars.js converting removes the last consumer of the
   JAR_DATA_CLASSES bridge at step (c); delete bridge + test together
   there.
5. **The seam block last** (step d), then the full live boot.
6. The seam sweep is CLOSED (the 18 entries) — if implementation
   surfaces an evaluate caller outside it, STOP and report rather than
   growing the seam. Known follow-ups for the flight-log entry (FD
   schedules the wording fixes): three behavior specs carry now-stale
   "classic script → window properties" rationale text
   (`popup-jar-inheritance.md`, `jar-data-controls.md`,
   `farbling-correctness.md` — their calls keep working through the
   seam), and `scripts/a11y-audit.mjs:336-338` makes the same stale
   claim (pointer update candidate for leg 6).

## Edge Cases

- **Import-name collisions with ambient declares**: module-scope imports
  legally shadow `renderer-globals.d.ts` declares — expected, no
  typecheck error; do NOT touch the d.ts.
- **`window.goldfinch` / `window.goldfinchInternal` preload bridges**:
  contextBridge surfaces are unaffected by module scope — no change.
- **Event-handler wiring**: all four controllers attach listeners
  programmatically (no inline `onclick=` HTML attributes referencing
  their functions — verify with a quick grep per document before
  converting; an inline handler would be a seam-class break).
- **menu-overlay.js reads `menuController`/`focusItem` bare globals**
  (from the classic menu-controller.js) — keeps working; eslint injected
  globals still present this leg.
- **Suite-count change is expected and pinned** (jar-data-classes bridge
  cases) — any OTHER count drift is a red flag; investigate before
  landing.
- **If the live boot fails**: `[BLOCKED:<reason>]`, stop.

## Files Affected

- `src/renderer/renderer.js`, `src/renderer/pages/jars.js`,
  `src/renderer/pages/settings.js`, `src/renderer/menu-overlay.js` —
  module conversion (+ renderer.js seam; settings.js rename)
- 13 `src/shared/*.js` files — bridge-block deletion
- `src/renderer/index.html`, `pages/jars.html`, `pages/settings.html`,
  `menu-overlay.html` — controller retags + comment updates
- `test/unit/jars-page-shared-scripts.test.js` — prescribed guard
  amendment
- `test/unit/jar-data-classes.test.js` — bridge-contract cases deleted
- `eslint.config.mjs` — controller module override

---

## Post-Completion Checklist

**Complete ALL steps before finishing (commit is deferred to end of
flight):**

- [x] All acceptance criteria verified (live boot included)
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry (per-surface evidence;
      any seam-candidate behavior-test references found)
- [x] Set this leg's status to `landed`
- [x] Check off this leg in flight.md (add to the Legs list if the FD's
      entry names it differently)

## Citation Audit

Verified at leg design time against the working tree (legs 1-4 landed,
uncommitted): `renderer.js:219` (`kebabActionSettings`), `:351`
(`openContainerOverlay`), `:600` (`openJarsPage`), `:2034` (direct
`isSafeColor` read), bottom boot gate (`Promise.all` +
`window.goldfinch.settingsGet`) OK; controller sizes/heads (`'use
strict'` on all four: renderer.js 2923, jars.js 1375, settings.js 1104,
menu-overlay.js 506 lines) OK; `settings.js:901` (globals comment),
`:1028` (`activeLogOf` call) OK; `jar-data-classes.test.js:104-112`
(single bridge-contract test, deletion pin 1285→1284) OK;
`scripts/a11y-audit.mjs:330-399` (11 evaluate-driven entries),
`:336-338` (stale classic-script comment) OK;
`jars-page-shared-scripts.test.js:112`
(transitional guard, ≥1 classic) + `:80` (tag-count guard ≥4, unaffected)
OK; `observe.js` executeJavaScript sites (self-contained snippets;
`:198`, `:349` region) OK; import maps derived from leg 3/4 verified
consumer inventories OK. 15 citations, all OK.
