# Leg: esm-pilot

**Status**: completed
**Flight**: [ESM Conversion of src/shared/](../flight.md)

## Objective

Convert the DD2 pilot slice — `burner.js`, `container-menu.js`,
`jar-page-model.js` — to real ES modules, retag both consuming pages, and
prove load-order survival live on BOTH load paths plus main-process
require(esm) in a real app boot. HARD GATE: the sweep legs do not start
until this lands green (CP1).

## Context

- **DD2**: this exact 3-module slice proves order-survival on the chrome
  path (`container-menu.js` reads burner on `index.html`) AND the
  internal-page path (`jar-page-model.js` reads burner on `jars.html`) AND
  main-process require(esm) (`jars.js:41`, `jar-ipc.js:40` both
  `require('../shared/burner')` unconditionally at module load, before
  `app.ready`).
- **DD3 (transitional defer rule)**: converting a page's first module means
  deferring EVERY remaining classic script on that page. Module scripts and
  `defer` classic scripts join the same after-parse in-order execution
  queue, so document order is preserved; a non-defer classic script would
  execute during parse, BEFORE any module — inverting order.
- **DD4**: the vm-replay nets and the eslint `sourceType: 'commonjs'`
  binding for `src/shared/**` break on the FIRST converted file (probe-
  reproduced) — this leg carries its own net adaptation and eslint
  override. Sharper than the flight text: the chrome net's tag regex
  (`chrome-shared-scripts.test.js:43`) matches only the exact form
  `<script src="../shared/X.js"></script>` — BOTH the `type="module"`
  retags and the DD3 `defer` additions fall out of its match, so without
  adaptation the non-empty guard (`:50`, `>= 5`) fails on the DD3 edit
  alone. The jars net's regex (`jars-page-shared-scripts.test.js:39`)
  requires `src` as the first attribute — attribute order matters there.
  Net adaptation is therefore tag-parsing rework, not just list filtering.
- **DD5**: hybrid require-or-global branches are deleted in the same leg as
  their producer. Here: `container-menu.js:35-37` (`RESOLVED_BURNER`) and
  `jar-page-model.js:23-25` (`RESOLVED_BURNER`) both become
  `import { BURNER } from './burner.js'`.
- **Transitional global bridges (this leg's key transitional mechanism)**:
  the classic page controllers do NOT convert this flight leg —
  `renderer.js` reads `BURNER` (`:131`, `:608`) and `buildContainerModel`
  (`:352`) as bare globals; `pages/jars.js` reads `BURNER` (`:1347`),
  `buildJarPageModel` (`:1326`), `PALETTE` (`:275`, `:1197`),
  `pickNewJarColor` (`:1295`). Each converted module therefore keeps an
  UNCONDITIONAL `globalThis.X = X` assignment (the `typeof module` dual-
  export tail is deleted; the global publication stays, marked
  transitional). Module scope makes the collision class structurally
  impossible regardless — a module's top-level `const` never lands in the
  page's shared lexical scope.
- **Flight 1 lesson carried**: suite is ~1.0-1.2s — run the full suite
  freely between steps.
- `renderer-globals.d.ts` declares for the pilot symbols (`:350`, `:359`,
  `:375`, `:386`, `:395`) STAY — classic consumers still read the globals.
  d.ts slimming is leg `retire-machinery` (DD6), gated on consumers
  converting during the sweep.

## Inputs

- Branch `flight/02-esm-conversion` at `840a28e` equivalent (clean tree,
  1283/1283 green at ~1.2s internal).
- `src/shared/burner.js` (dual-export tail `:25-29`),
  `src/shared/container-menu.js` (hybrid `:35-37`, body use `:67`,
  dual-export tail `:92-96`),
  `src/shared/jar-page-model.js` (hybrid `:23-25`, body uses `:71-75`,
  dual-export tail `:112-118`).
- `src/renderer/index.html:191-203` (10 shared classic tags + `renderer.js`,
  none deferred), `src/renderer/pages/jars.html:16-20` (4 flat-src classic
  tags + `jars.js` defer; header comment `:8-15` describes the classic
  shared scope — update it).
- `test/unit/chrome-shared-scripts.test.js`,
  `test/unit/jars-page-shared-scripts.test.js`, `eslint.config.mjs:10-11`
  (base `src/shared/**` commonjs block).

## Outputs

- Three `src/shared/` files as real ESM: `export` statements, explicit-
  extension relative imports, hybrids deleted, transitional `globalThis`
  bridges, `'use strict'` pragmas removed (modules are strict by default).
- Both pages retagged per DD3 (modules + all-defer classics).
- Both vm nets adapted (attribute-tolerant tag parsing; module-tagged
  scripts excluded from the shared-scope replay; DD3 defer rule pinned).
- `eslint.config.mjs` gains a pilot-file `sourceType: 'module'` override.
- Flight log updated; leg → `landed` (commit deferred to end of flight).

## Acceptance Criteria

- [x] `burner.js` is a module: `export const BURNER = Object.freeze(...)`;
      transitional `globalThis.BURNER = BURNER` retained with a comment
      naming it transitional (removed when the classic consumers convert)
- [x] `container-menu.js` / `jar-page-model.js` are modules importing
      `{ BURNER } from './burner.js'` (explicit `.js` extension — Node/
      browser ESM resolvers both require it); `RESOLVED_BURNER` bindings
      and both `typeof module` tails deleted; exported API unchanged
      (`buildContainerModel`; `buildJarPageModel`, `PALETTE`,
      `pickNewJarColor`); transitional `globalThis` bridges for all four
      page-consumed symbols
- [x] `index.html`: `burner.js` + `container-menu.js` tags carry
      `type="module"`; every remaining classic `<script>` on the page (the
      8 other shared tags AND `renderer.js`) carries `defer` (DD3)
- [x] `jars.html`: `burner.js` + `jar-page-model.js` tags carry
      `type="module"`; `jar-data-classes.js` + `safe-color.js` gain
      `defer` (`jars.js` already has it); the `:8-15` script-order comment
      updated to describe the mixed module/defer-classic queue
- [x] Both vm nets: tag parsing tolerates attributes in any order
      (`type="module"`, `defer`); module-tagged scripts are EXCLUDED from
      the shared-scope replay (correct semantics — modules get their own
      scope in a real document) and classic-tagged scripts (deferred or
      not) still replay in document order; non-empty guards still pass on
      the retagged pages; a new assertion pins DD3 on both pages: if any
      script tag is `type="module"`, every classic script tag on that page
      must carry `defer`
- [x] `eslint.config.mjs`: an override block AFTER the base `:10-11` block
      scoping `sourceType: 'module'` to exactly the three pilot files
      (flat-config later-wins; globals merge, so node globals persist)
- [x] NO change to `src/main/jars.js`, `src/main/jar-ipc.js` (their
      `require('../shared/burner')` works via require(esm) — probe-
      verified), `src/renderer/renderer.js`, `src/renderer/pages/jars.js`,
      `renderer-globals.d.ts`, or any test file other than the two nets
- [x] Suite green: all pre-existing 1283 tests pass (net test count may
      grow with the DD3 assertion; none removed), internal duration
      < 1.5s; `npm run typecheck` and `npm run lint` green
- [x] LIVE BOOT (CP1 core) — **satisfied by leg 2's live-boot run**
      (flight-log "Leg 2 — preload-edge-split (2026-07-11)" entry: chrome
      evaluate true for buildContainerModel/BURNER, jars page rendered
      with the Burner row via readDom + screenshot, stderr clean both
      pages, AUTOMATION_DEV_MINT non-null): from the working tree, the app boots (this
      alone proves main-process require(esm) — `jars.js`/`jar-ipc.js`
      require burner.js before `app.ready`); the chrome loads with zero
      uncaught console errors and the container picker works (
      `buildContainerModel` reachable — burner sentinel row present);
      `goldfinch://jars` renders the jar list with the Burner row (proves
      `jar-page-model.js` module + import chain on the internal-page
      path); zero uncaught errors on the jars page — jars-page error
      evidence comes from the launcher's `--enable-logging` stderr (no
      in-page evaluate channel exists for internal sessions; see
      Verification Steps)

## Verification Steps

- `npm test` — full suite; `node --test test/unit/chrome-shared-scripts.test.js
  test/unit/jars-page-shared-scripts.test.js test/unit/container-menu.test.js
  test/unit/jar-page-model.test.js test/unit/jars.test.js test/unit/jar-ipc.test.js`
  — the direct-consumer files in isolation
- `npm run typecheck && npm run lint`
- Live boot: launch the working-tree app via `npm run dev:automation`
  (`--enable-logging` stderr is the console-error evidence channel) and
  drive it through the goldfinch MCP tools at ADMIN tier —
  `evaluate`/`getChromeTarget` and internal-tab visibility require the
  admin key (`GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1`,
  export `GOLDFINCH_MCP_ADMIN_KEY`; recipe in docs/mcp-automation.md
  "Dogfooding / dev key acquisition"). NOTE: `evaluate` and `navigate`
  op-locally REFUSE internal sessions even at admin tier
  (`observe.js:342-345`, `nav.js` internal guards) — do not attempt them
  against `goldfinch://jars`. Verify:
  (a) app reaches ready (main require(esm) proven by boot);
  (b) chrome window via chrome-tier `evaluate`:
  `typeof globalThis.buildContainerModel === 'function' &&
  globalThis.BURNER.id === 'burner'` true, no chrome page errors;
  (c) jars page: open it by driving the chrome (`openJarsPage()` is a
  top-level classic-script function in renderer.js, callable via
  chrome-tier evaluate), then verify via `readDom` / `captureScreenshot`
  (both pass internal at admin) — rows render, Burner row present in the
  DOM; jars-page console errors checked via the launcher stderr.
  Capture the evidence (evaluate results, readDom excerpt, stderr
  scan) in the flight-log entry.
- `git diff --stat` — exactly: the 3 shared files, 2 html files, 2 net
  test files, `eslint.config.mjs` (+ artifact files)

## Implementation Guidance

1. **burner.js**: delete `'use strict'` and the `:25-29` dual-export tail;
   `export const BURNER = ...`; append the transitional bridge:
   `/** @type {any} */ (globalThis).BURNER = BURNER;` with a
   `// Transitional (flight 02): classic consumers (renderer.js, pages/jars.js)
   // still read the global; remove when they convert. Unlike the old
   // dual-export else-branch, this also runs under require() (main
   // process, test runner) — benign and expected, not a bug.` comment.
   Trim the
   header comment's dual-export paragraph to describe the ESM + bridge
   state.
2. **container-menu.js / jar-page-model.js**: replace the hybrid
   `RESOLVED_BURNER` with `import { BURNER } from './burner.js';` at top;
   rename body uses (`container-menu.js:67`; `jar-page-model.js:71-75`)
   to `BURNER`; `export` the API bindings; delete the dual-export tails;
   add transitional bridges (`buildContainerModel`; `buildJarPageModel`,
   `PALETTE`, `pickNewJarColor`) with the same comment. The D1-lesson
   comments about not redeclaring `const BURNER` become historical —
   rewrite to note module scope now isolates top-level declarations.
3. **Pages**: retag + defer per the criteria. Keep the burner.js tag on
   both pages even though the importing module would pull it in anyway —
   explicit load order stays legible and the module map dedupes (single
   evaluation per URL).
4. **Nets**: rework tag extraction to a parse of all `<script ...>` tags
   capturing `src`, `type="module"` presence, and `defer` presence
   (attribute order-insensitive). Chrome net keeps its `../shared/`-only
   filter; jars net keeps flat-src + existence-based resolution
   (`jars-page-shared-scripts.test.js:50-56` unchanged). Replay = classic
   tags only, document order. Keep both non-empty guards meaningful
   (chrome: total shared tags still `>= 5`; jars: `>= 4`). Add the DD3
   pin (module present ⇒ all classics defer) to each net. Update both
   header comments: the net now guards the CLASSIC-scripts shared scope
   during the transitional window and shrinks as conversion proceeds
   (leg `retire-machinery` decides its final disposition).
5. **eslint**: insert after the base block (the config object spanning
   `:7-13`, whose `files`/`sourceType` lines are `:10-11`):
   `{ files: ['src/shared/burner.js', 'src/shared/container-menu.js',
   'src/shared/jar-page-model.js'], languageOptions: { sourceType:
   'module' } }` — do not repeat globals/rules (flat-config merge keeps
   them).
6. **Live boot last**, after all static gates are green. If the boot
   surfaces a blocking incompatibility the probes missed, STOP — that is
   the flight's divert criterion; report `[BLOCKED:...]` rather than
   working around it.

## Edge Cases

- **require(esm) interop**: `const { BURNER } = require('../shared/burner')`
  destructures the module namespace — works unflagged (probe-verified in
  Electron 42.4.0 main process and under `node --test`). Expect possible
  benign `ExperimentalWarning` stderr noise on some Node builds — do not
  chase it (Flight 1 MockTimers precedent).
- **Frozen-object identity**: require(esm) caches the module — `BURNER`
  stays a single frozen instance across main-process require sites and
  test requires; no test pins should need touching.
- **Module scripts in the vm nets**: do NOT try `vm.SourceTextModule`
  (experimental, flag-gated) — exclusion is the correct model, not a
  compromise: real module scripts don't share the page's lexical scope.
- **d.ts shadowing**: inside the converted modules, module-local
  `BURNER`/imports legally shadow the ambient `declare const BURNER`
  (`renderer-globals.d.ts:359`) — no typecheck conflict; keep the
  `/** @type {any} */ (globalThis)` cast on bridge assignments.
- **Defer semantics**: `defer` does NOT isolate scope — deferred classic
  scripts still share the page's lexical environment; the nets keep
  replaying them together.
- **Boot environment**: if no display is available for the live boot,
  report `[BLOCKED:no-display]` — do not substitute a headless probe for
  the CP1 criterion.

## Files Affected

- `src/shared/burner.js` — ESM + bridge
- `src/shared/container-menu.js` — ESM, hybrid deleted, import, bridge
- `src/shared/jar-page-model.js` — ESM, hybrid deleted, import, bridges
- `src/renderer/index.html` — 2 module retags, 9 defer additions
- `src/renderer/pages/jars.html` — 2 module retags, 2 defer additions,
  comment update
- `test/unit/chrome-shared-scripts.test.js` — tag parsing, module
  exclusion, DD3 pin
- `test/unit/jars-page-shared-scripts.test.js` — same
- `eslint.config.mjs` — pilot sourceType override

---

## Post-Completion Checklist

**Complete ALL steps before finishing (commit is deferred to end of
flight):**

- [x] All acceptance criteria verified (live boot included)
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry (include live-boot
      evidence)
- [x] Set this leg's status to `landed` (in this file's header)
- [x] Check off this leg in flight.md and CP1 if fully met

## Citation Audit

Verified at leg design time against the working tree at flight start:
`burner.js:25-29` (dual-export tail) OK; `container-menu.js:35-37`
(RESOLVED_BURNER), `:67` (body use), `:92-96` (tail) OK;
`jar-page-model.js:23-25` (RESOLVED_BURNER), `:71-75` (body uses),
`:112-118` (tail) OK; `index.html:191-203` (script block, no defer
anywhere) OK; `jars.html:8-15` (comment), `:16-20` (tags, jars.js defer)
OK; `jars.js:41` / `jar-ipc.js:40` (main requires) OK;
`renderer.js:131`, `:352`, `:608` (global reads) OK; `pages/jars.js:275`,
`:1197`, `:1295`, `:1326`, `:1347` (global reads) OK;
`chrome-shared-scripts.test.js:43` (regex), `:50` (>= 5 guard), `:53`
(replay test) OK; `jars-page-shared-scripts.test.js:39` (regex), `:50-56`
(resolver), `:59` (>= 4 guard), `:68` (replay test) OK;
`eslint.config.mjs:10-11` (base commonjs block) OK;
`renderer-globals.d.ts:350`, `:359`, `:375`, `:386`, `:395` (pilot-symbol
declares, untouched this leg) OK. 27 citations, all OK.
