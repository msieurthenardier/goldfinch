# Flight Log: ESM Conversion of src/shared/

**Flight**: [ESM Conversion of src/shared/](flight.md)

## Summary

Landed 2026-07-11, same-day, 6 legs (3 planned → 6 as-built: a divert leg
after the pilot hit the preload-require(esm) blocker, and the sweep split
into internal/chrome/controllers). `src/shared/` is real ESM: 15
dual-export modules converted (imports with explicit extensions, hybrids
deleted), 4 CJS-by-design remain (2 preload-constrained per the divert
Decision, 2 by zero-benefit ruling — all lint-parse-guarded); the four
page controllers are modules importing their dependencies;
`menu-controller.js` is the product's only classic script (DD6). The
collision class is structurally gone and its machinery retired:
`renderer-globals.d.ts` 495 → 289 lines (bridge + menu-controller
declares only), eslint shared-globals block down to
menuController/focusItem, vm replay retired with the nets repurposed as
all-documents script-tag contract tests (permanent DD3 pin +
all-shared-tags-module pin), `audit-paging`'s activeLog/activeLogOf
mismatch resolved to one canonical name. renderer.js publishes an
explicit 18-entry evaluate seam (dogfooding / behavior-spec / a11y
consumers). Gates: 1284/1284 @ ~1.0s, typecheck, lint, `npm run a11y`
("No NEW violations"), live boots of all four surfaces across legs
2/3/4/5, code delta −194 lines (excl. artifacts). Flight review:
`[HANDOFF:confirmed]` first pass, 4 non-blocking stale comments fixed
pre-commit.

---

## Leg Progress

### Leg 1 — esm-pilot (2026-07-11) — BLOCKED at live boot (CP1 divert criterion)

**Static gates (before → after):**

- Suite: 1283/1283 pass @ ~1000ms → **1285/1285 pass @ ~936ms** (+2 = the two
  new DD3-pin tests, one per vm net; none removed)
- Direct-consumer isolation run (both nets + container-menu + jar-page-model +
  jars + jar-ipc): 168/168 pass
- `npm run typecheck`: green; `npm run lint`: green (pilot `sourceType: 'module'`
  override in place)
- Diff footprint (`git diff --stat`, code files): `src/shared/burner.js`,
  `src/shared/container-menu.js`, `src/shared/jar-page-model.js`,
  `src/renderer/index.html`, `src/renderer/pages/jars.html`,
  `test/unit/chrome-shared-scripts.test.js`,
  `test/unit/jars-page-shared-scripts.test.js`, `eslint.config.mjs` — exactly
  the leg's allowed set (+ artifact files)

**Live boot (LIVE BOOT criterion): FAILED — blocking incompatibility the probes
missed.** `npm run dev:automation` with admin/dev-mint env: the app **main
process boots fine** (AUTOMATION_DEV_MINT line printed — `jars.js:41` /
`jar-ipc.js:40` `require('../shared/burner')` under require(esm) IS proven live
in the main process). But the **chrome preload fails to load**, killing
`window.goldfinch` and with it the entire chrome. Launcher `--enable-logging`
stderr (paths made repo-relative):

```
INFO:CONSOLE:2 "Unable to load preload script: src/preload/chrome-preload.js"
INFO:CONSOLE:2 "SyntaxError: Failed to construct 'ContextifyScript': Unexpected token 'export'"
INFO:CONSOLE:125 "Uncaught TypeError: Cannot read properties of undefined (reading 'jarsList')", source: src/renderer/renderer.js (125)
```

**Root cause (confirmed by require-graph trace):**
`chrome-preload.js:8` → `require('../shared/automation-dev')` →
`automation-dev.js:10` → `require('./burner')` → the converted ESM burner.js.
The chrome view runs `sandbox: false, contextIsolation: true` (`main.js:878`),
so its preload uses the **renderer process's Node require — which does NOT
support require(esm)** (the `ContextifyScript` CJS parser hits `export` and
throws). The design probes covered require(esm) in the **main process**
(Electron 42.4.0, probe-verified) and under `node --test`, but no probe covered
the **preload/renderer require surface**, and the leg's citation audit missed
the transitive edge `chrome-preload → automation-dev → burner` (automation-dev
is one of the 4 plain-CJS no-page modules; its burner require was not in the
pilot's input inventory).

**Scope of the class (swept for re-plan):** `src/preload/*.js` requires of
`src/shared/` are exactly `chrome-preload.js:7` (`internal-page.js` — plain
CJS, unconverted, fine) and `chrome-preload.js:8` (`automation-dev.js` — plain
CJS itself, but transitively pulls burner.js). No other preload requires any
shared module. The sweep re-plan must treat **"reachable from any preload's
require graph" as a conversion blocker** (or break the edge first): converting
any module in a preload require chain reproduces this failure.

**Verification NOT reached:** chrome-tier evaluate checks, `openJarsPage()`,
jars-page readDom/screenshot, jars-page stderr scan — all unreachable behind
the dead preload.

**Disposition:** implementation guidance step 6 followed — STOPPED, no
workaround attempted (a fix would touch `automation-dev.js` or
`chrome-preload.js`, both outside the leg's allowed file set). Working tree
left intact for re-plan; nothing committed. Leg remains `in-flight`
(NOT landed); CP1 not met; flight.md checkboxes untouched. Signaled
`[BLOCKED:preload-require-esm]`.

### Leg 2 — preload-edge-split (2026-07-11) — LANDED (CP1 met, leg 1 unblocked)

**Implementation (the operator-ruled split, Decisions below):**
`resolveAutoMintTarget` moved verbatim (JSDoc included) from
`src/shared/automation-dev.js` to the new `src/main/auto-mint.js` (CJS,
`@ts-check`, header explains the main-side placement — preload require
graphs must stay ESM-free); `automation-dev.js` dropped its burner require,
exports exactly the three predicates, and gained the PRELOAD-REACHABLE
header note; `src/shared/internal-page.js` gained the same note (comment
only, zero code change); `main.js` require split
(`resolveAutoMintTarget` out of the automation-dev destructure, new
`require('./auto-mint')` alongside — call site untouched); the 4
`resolveAutoMintTarget` test cases moved verbatim to
`test/unit/auto-mint.test.js`.

**Static gates:**

- Suite: **1285/1285 pass @ ~1048ms** (count unchanged — 4 cases moved,
  none added/removed); moved-file isolation run
  (`auto-mint.test.js` + `automation-dev.test.js`): 27/27 pass
- `npm run typecheck`: green; `npm run lint`: green (no eslint changes
  needed — auto-mint.js rides the default CJS binding)
- **Require-cache proof (preload graph ESM-free)**: the AC one-liner
  (`require automation-dev + internal-page` → burner in `require.cache`?)
  exits **0** (burner NOT pulled); positive direction verified too —
  `require('./src/main/auto-mint')` alone DOES pull burner via
  require(esm) (exit 0 on the inverted check)
- Diff footprint on top of leg 1's: exactly
  `src/main/auto-mint.js` (new), `src/main/main.js`,
  `src/shared/automation-dev.js`, `src/shared/internal-page.js`,
  `test/unit/auto-mint.test.js` (new), `test/unit/automation-dev.test.js`
  (+ artifact files); leg 1's files byte-untouched by this leg

**LIVE BOOT (CP1, transferred from leg 1): PASSED — full procedure per
leg 1's Verification Steps.** `npm run dev:automation` with
`GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1` (WSLg
Wayland display), admin-tier MCP attach via
`scripts/lib/mcp-client.mjs` (`connectAutomation`, Bearer admin key,
free-fallback port):

- **(a) Main require(esm)**: app boots to ready; stdout printed the
  positive auto-mint signal —
  `AUTOMATION_DEV_MINT {"key":"<non-null>","adminKey":"<non-null>"}` —
  direct live evidence that `main.js → auto-mint.js → burner.js`
  (require(esm)) resolves at boot (no mint-skip stderr notice; the key
  minted for a real resolved-default jar)
- **(b) Chrome path**: preload ALIVE (leg 1's failure mode gone) —
  chrome-tier `evaluate` returned `true` for both
  `typeof globalThis.buildContainerModel === 'function' &&
  globalThis.BURNER.id === 'burner'` and
  `typeof window.goldfinch === 'object' && typeof
  window.goldfinch.internalPartition === 'string'` (the contextBridge
  surface leg 1's dead preload killed)
- **(c) Jars page (internal path)**: `openJarsPage()` via chrome-tier
  evaluate → `{ok:true}`; `enumerateTabs` shows `goldfinch://jars/`
  active; `readDom` (admin, internal-capable): title
  "Cookie Jars — Goldfinch", full document (16,095 chars), **Burner row
  present** (nav entry `#jar-burner` link with `jar-nav-name` "Burner" +
  the `jar-section-burner` section, burner-orange `jar-dot`
  rgb(255,140,66)); `captureScreenshot` confirms the rendered page —
  sidebar nav with Default change / Work / Rename Test 2 (DEFAULT) /
  Burner, full jar sections with palette swatch grids
  (`buildJarPageModel` + `PALETTE` + ESM import chain live on the
  internal-page path)
- **Launcher `--enable-logging` stderr scan (both pages)**: CLEAN — 24
  lines total, zero `Unable to load preload` / `Uncaught` /
  `SyntaxError` / `Failed to construct`; the only CONSOLE line is the
  pre-existing dev-only Electron CSP advisory on the chrome page
  (unpackaged-build warning, not an error); the rest is WSLg
  Wayland/DRM noise identical to prior boots

**Leg 1's live-boot AC is satisfied by this run**: the evidence above
covers every clause of leg 1's LIVE BOOT criterion — app boots (main
require(esm) on burner.js proven by boot AND by the mint line), chrome
loads with zero uncaught console errors and `buildContainerModel`/`BURNER`
reachable (evaluate `true`), `goldfinch://jars` renders the jar list with
the Burner row (readDom + screenshot), jars-page stderr clean. Leg 1's
remaining AC is checked in its artifact citing this entry; both legs →
`landed`; CP1 checked in flight.md.

### Leg 3 — esm-sweep-internal (2026-07-11) — LANDED

**Implementation:** the four internal-surface/cross-surface providers converted
to real ESM with transitional bridges — `src/shared/jar-data-classes.js`
(exports `JAR_DATA_CLASSES` + `jarDataClassById`, both bridged),
`src/shared/safe-color.js` (exports `isSafeColor`, bridged),
`src/shared/audit-paging.js` (all six functions exported under their CJS
names; bridges publish the CURRENT page-global names incl. the `activeLogOf`
alias for `activeLog` — canonical-name ruling documented at the bridge block;
`pages/settings.js` untouched), `src/shared/automation-indicator-model.js`
(hybrid `RESOLVED_IS_SAFE_COLOR` deleted →
`import { isSafeColor } from './safe-color.js'`; exports
`buildAutomationIndicatorModel`, bridged). Hybrid count now ZERO (all three
DD5 hybrids deleted across legs 1+3). All four documents retagged:
`index.html` + `pages/jars.html` + `pages/settings.html` (safe-color /
automation-indicator-model / jar-data-classes / audit-paging tags `defer` →
`type="module"`), `menu-overlay.html` the fuller DD3 edit (safe-color →
`type="module"`; `menu-controller.js` + `menu-overlay.js` gain `defer`,
document order preserved — controller before overlay; DD3 comment added;
eyeballed per guidance, no net covers that document). Retag completeness
grepped: 8 `<script` tags across the tree reference the four converted files,
all `type="module"`. eslint pilot override extended to seven files (only
config change). `test/unit/jar-data-classes.test.js` global-branch mini
vm-replay REPURPOSED per the design-review HIGH: it now pins the transitional
bridge (`globalThis.JAR_DATA_CLASSES` / `jarDataClassById`, same frozen
instance) under `require()` — removed together with the bridges in leg 5.

**Static gates:**

- Suite: **1285/1285 pass @ ~1082ms** (count unchanged — the repurposed test
  replaces the vm-replay one-for-one); isolation run (both nets +
  audit-paging + safe-color + jar-data-classes + automation-indicator-model):
  80/80 pass
- **Both vm nets byte-UNCHANGED this leg** (the pilot's self-adapting replay
  claim held: retags dropped the converted files from the replay; DD3 pin
  green on both pages). During the modules-first window the nets correctly
  flagged each converted-but-not-yet-retagged classic tag (the documented
  parse-time-SyntaxError edge, 1283-1284/1285 mid-sequence) and went green
  page-by-page as the retags landed — no net code change
- `npm run typecheck`: green; `npm run lint`: green (override extension only)
- Diff footprint on top of legs 1-2: exactly the 4 shared files, 4 html
  documents, `eslint.config.mjs`, `test/unit/jar-data-classes.test.js`
  (+ artifact files); page controllers, menu-controller.js,
  renderer-globals.d.ts, main-process files, preloads, and both nets
  untouched by this leg

**LIVE BOOT: PASSED — four surfaces, leg 1 procedure / leg 2 attach recipe.**
`npm run dev:automation` with `GOLDFINCH_AUTOMATION_DEV_MINT=1
GOLDFINCH_AUTOMATION_ADMIN=1` (WSLg Wayland); `AUTOMATION_DEV_MINT` printed
with non-null key AND adminKey (main require(esm) chain live at boot);
admin-tier MCP attach via `scripts/lib/mcp-client.mjs` on the free-fallback
port 49709 (49707/49708 held by stale prior-leg instances — first attach 401'd
against the stale default-port instance; retargeted, not a product issue):

- **(a) Chrome**: chrome-tier `evaluate` returned **true** for
  `typeof globalThis.buildAutomationIndicatorModel === 'function' && typeof
  globalThis.isSafeColor === 'function'` (both module bridges live on
  index.html's module tags)
- **(b) Jars page**: `openJarsPage()` → `{ok:true}`; `readDom` (admin,
  internal-capable): title "Cookie Jars — Goldfinch", 16,089 chars, **4 nav
  rows, 8 jar-dot nodes, 6 swatch-grid + 36 swatch-btn nodes, Burner section
  present** — JAR_DATA_CLASSES/safe-color/jar-page-model chain live on the
  internal-page path
- **(c) Settings page**: `kebabActionSettings()` via chrome-tier evaluate →
  `{ok:true}`; `readDom`: title "Settings — Goldfinch", the activity viewer's
  pagination **renders un-hidden with 3 pager buttons** (`‹` disabled /
  `1` current / `›` disabled — page 1 of 1, sufficient per the leg's edge
  case) — audit-paging bridge chain live, `activeLogOf` resolving
- **(d) Menu-overlay sheet**: `openContainerOverlay(0)` via chrome-tier
  evaluate → true; `captureWindow` PNG shows the container picker rendered
  from the sheet document: **jar rows Default change / Work / Rename Test 2
  (DEFAULT badge) / Burner tab (evaporates), each with its color dot**, plus
  New Jar / Manage jars… — safe-color chain live in the sheet (the one
  converting document with an explicit CSP meta; no CSP failure)
- **Launcher `--enable-logging` stderr scan (all four surfaces)**: CLEAN — 23
  lines, zero `Uncaught` / `Unable to load preload` / `SyntaxError` /
  `Failed to construct` / `TypeError` / `ReferenceError`; the only CONSOLE
  line is the pre-existing dev-only Electron CSP advisory on the chrome page;
  the rest is the usual WSLg Wayland/DRM noise + two pre-existing Electron
  main-process deprecation notices (`canGoBack`/`canGoForward`), identical to
  prior boots; app exited cleanly (exit 0)

Leg → `landed`; `esm-sweep-internal` checked off in flight.md. CP2 stays open
(chrome-surface providers remain — leg 4).

### Leg 4 — esm-sweep-chrome (2026-07-11) — LANDED (CP2 met)

**Implementation:** the remaining eight dual-export modules converted —
15/15 dual-export conversions now complete; `grep -rn "typeof module"
src/shared/` returns ZERO hits. The two dead-global modules first:
`src/shared/sheet-accelerator.js` (exports `sheetAcceleratorAction` +
`isGuestActionAllowed`) and `src/shared/cross-view-nav.js` (exports
`crossViewNavAction`) converted to pure `export` modules with their
`globalThis` branches DELETED (dead code — pre-deletion grep over
`src/renderer/` for the three names returned nothing, and no `<script`
tag anywhere references either file); header comments updated (consumers
are main.js require(esm) + test runner; no renderer-documents claim).
Then the six chrome providers, one at a time with a suite run between
each: `url-safety.js` (exports + bridges `isSafeTabUrl`,
`isSafePosterUrl`, `isInternalPageUrl` — function bodies byte-untouched,
only the tail replaced; trust-model behavior identical),
`keydown-action.js` (`keydownToAction`), `site-info.js`
(`deriveSiteInfo`), `page-context-model.js` (`pageContextModel`),
`default-routing.js` (`resolveNewTabContainer`), `inherit-container.js`
(`inheritContainerDecision`, `inheritFromPartition`) — exactly the nine
page-consumed globals bridged, each with the standard transitional
comment (leg 1 wording; renderer.js named as the page's sole classic
consumer; runs-under-require() note). `index.html`: the six remaining
`defer` shared tags → `type="module"` in one edit, script order
unchanged; DD3 block comment updated — all ten `../shared/` tags are
modules, renderer.js is now the page's ONLY classic script (defer).
Chrome net: EXACTLY the one prescribed change — the `:105`
transitional-window assertion (`>= 1` classic) replaced by an early
return on an empty classic list, commented "sweep complete — vacuously
green; leg 6 owns this test's final disposition"; tag-count guard (`:79`,
10 shared tags ≥ 5) and the DD3 pin untouched and green. Jars net
byte-UNCHANGED this leg (no edit made to it; its replay retains classic
`jars.js`). eslint override `files` array extended to fifteen
`src/shared/*.js` entries (no other config change; glob consolidation
stays leg 6). The 4 plain-CJS modules untouched per the recorded ruling
(`automation-dev.js` + `internal-page.js` preload-constrained;
`dev-profile.js` + `guest-forward-allowlist.js` zero-benefit).

**Static gates:**

- Suite: **1285/1285 pass @ ~995ms** (count unchanged); during the
  providers-first window the chrome net correctly flagged each
  converted-but-not-yet-retagged classic tag (1284/1285 mid-sequence,
  exactly the leg-3 pattern), resolving at the retag + the prescribed
  net amendment
- Isolation run (the eight modules' unit tests + both nets +
  `guest-forward-allowlist.test.js`, the one direct-consumer test
  outside the eight — it requires the converted `keydown-action.js`):
  **217/217 pass**
- `npm run typecheck`: green; `npm run lint`: green (override extension
  only)
- AC greps: `grep -rn "typeof module" src/shared/` → **0 hits**;
  `grep -rn "sheetAcceleratorAction\|isGuestActionAllowed\|crossViewNavAction"
  src/renderer/` → **0 hits** (verified BEFORE deleting the branches and
  re-verified after)
- Diff footprint on top of legs 1-3: exactly the 8 shared files,
  `src/renderer/index.html`, `eslint.config.mjs`,
  `test/unit/chrome-shared-scripts.test.js` (+ artifact files); page
  controllers, `menu-controller.js`, `renderer-globals.d.ts`,
  main-process files, preloads, the 4 plain-CJS modules, and the jars
  net untouched by this leg

**LIVE BOOT (chrome surface): PASSED — leg 1 procedure / leg 2 attach
recipe.** Stale prior-leg instances holding ports 49707/49708 killed
before launch (the leg-3 lesson). `npm run dev:automation` with
`GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1` (WSLg
Wayland); `AUTOMATION_DEV_MINT` printed with non-null key AND adminKey
(main require(esm) chain — incl. url-safety's three-file main fan-out
via main.js/settings-store.js at boot — live); admin-tier MCP attach via
`scripts/lib/mcp-client.mjs` on the default port 49707 (no stale
instance this time):

- **(a) All nine bridged globals**: one chrome-tier `evaluate` against
  the chrome target (`getChromeTarget` → wcId 1) returned
  `typeof === 'function'` **true for all nine** — isSafeTabUrl,
  isSafePosterUrl, isInternalPageUrl, keydownToAction, deriveSiteInfo,
  pageContextModel, resolveNewTabContainer, inheritContainerDecision,
  inheritFromPartition
- **(b) Tab strip alive**: `enumerateTabs` returned a real active tab
  (`wcId 2`, `https://www.google.com/`, jar `rename-test`, active) —
  renderer.js's boot gate ran, i.e. the whole ten-module + defer-classic
  queue executed in order
- **Launcher `--enable-logging` stderr scan**: CLEAN — 21 lines, zero
  `Uncaught` / `Unable to load preload` / `SyntaxError` /
  `Failed to construct` / `TypeError` / `ReferenceError`; the only
  CONSOLE line is the pre-existing dev-only Electron CSP advisory on the
  chrome page; the rest is the usual WSLg Wayland/DRM noise + the two
  pre-existing `canGoBack`/`canGoForward` deprecation notices, identical
  to prior boots; app shut down cleanly after the run (no instance left
  holding a port)

Leg → `landed`; `esm-sweep-chrome` checked off in flight.md; **CP2
checked** with the annotation: all of `src/shared/` ESM **except the 4
CJS-by-design — 2 preload-constrained, 2 left by ruling**. Remaining:
controllers + bridge removal (leg 5), machinery retirement (leg 6).

### Leg 5 — esm-sweep-controllers (2026-07-11) — LANDED (bridge retirement)

**Implementation:** the four page controllers converted to ES modules in the
prescribed surface order (menu-overlay → settings → jars → renderer), each
with its document retag and the bridge deletions whose LAST classic consumer
had just converted: (a) `menu-overlay.js` (`'use strict'` dropped — modules
are strict by construction; single disk-true import
`../shared/safe-color.js`; `menu-overlay.html` retag with the DD6
carve-out noted — `menu-controller.js` is now the product's ONLY classic
script, still `defer` and still positioned ahead of the controller in the
shared after-parse queue); (b) `settings.js` (the two flat-served imports
`./audit-paging.js` + `./safe-color.js` with the ruled `// @ts-ignore` +
serving-path-vs-disk-path comment; the `:1028` call renamed
`activeLogOf(state)` → `activeLog(state)` — canonical-name completion; the
`:901` globals comment now describes imports; audit-paging's 6 bridges incl.
the `activeLogOf` alias DELETED); (c) `jars.js` (four flat-served imports,
same ts-ignore ruling; jar-page-model + jar-data-classes bridges DELETED;
the repurposed bridge-contract test deleted from
`test/unit/jar-data-classes.test.js` — the design-review-pinned single
`test()`; jars net `:112` transitional guard → empty-list early return with
the leg-6-disposition comment, byte-identical wording to the chrome net's
leg-4 amendment; everything else in the net untouched); (d) `renderer.js`
(13-symbol import block from 10 shared modules, disk-true `../shared/*.js`
so no ts-ignore; the remaining 10 bridges DELETED — burner, container-menu,
safe-color incl. the `:2034` direct read, automation-indicator-model,
url-safety, keydown-action, site-info, page-context-model, default-routing,
inherit-container; `index.html` retag + DD3 block rewritten as a
fully-module page). **The evaluate-reachable seam** published as a single
commented `Object.assign(globalThis, {...})` block at the bottom of
renderer.js: EXACTLY the FD-approved 18 entries, grouped and tagged by
consumer class (3 dogfooding / 5 behavior-spec with per-spec attribution /
10 a11y-audit), with the closed-set warning in the block comment. The
pre-existing `eslint-disable-next-line no-unused-vars` on
`openPageContextMenuForAudit` became a stale directive once the seam
referenced the function (lint flags unused directives) — removed, and its
doc comment now points at the seam instead of the classic-script window
rationale. eslint: ONE new override block (`sourceType: 'module'`, exactly
the four controller files) placed AFTER the `src/renderer/**/*.js` block
(flat-config later-wins); renderer-block injected globals untouched (leg 6).
Header comments in burner.js / safe-color.js / automation-indicator-model.js
updated (they named the "bridge below"); the flat-specifier typing mismatch
backlog-noted per the FD ruling (BACKLOG.md, "future typing cycle" entry).

**Static gates:**

- Suite: **1284/1284 pass @ ~1030ms** (1285 → 1284, exactly the pinned
  bridge-contract-test deletion; no other count drift). Mid-sequence the
  nets flagged each converted-but-not-yet-retagged window exactly as in
  legs 3-4, resolving at each retag
- Isolation run (both nets + `jar-data-classes.test.js` + `jars.test.js` +
  `menu-overlay-manager.test.js` + `menu-overlay-value.test.js` +
  `menu-controller.test.js`): **146/146 pass**
- `npm run typecheck`: green (the six ruled ts-ignores in place);
  `npm run lint`: green (override block only; zero warnings)
- **AC greps: `grep -rn "globalThis)\." src/shared/` → 0 hits;
  `grep -rn "Transitional (flight 02)" src/` → 0 hits** (all 13 bridge
  blocks and their comments gone)
- Seam-closure sweep re-run at implementation time: every renderer entry
  point called by name across `tests/behavior/*.md`,
  `scripts/a11y-audit.mjs`, and `docs/mcp-automation.md` is within the 18
  (16 of the 18 appear as literal calls; `openJarsPage`/
  `kebabActionSettings` are dogfooding-procedure entries). No caller
  outside the set — no STOP condition hit
- Diff footprint on top of legs 1-4: exactly the 4 controllers, 4
  documents, 13 shared files, `test/unit/jars-page-shared-scripts.test.js`,
  `test/unit/jar-data-classes.test.js`, `eslint.config.mjs` (+ artifact
  files incl. the ruled BACKLOG.md note); `menu-controller.js`,
  `find-overlay.js`, `renderer-globals.d.ts`, main-process files, preloads,
  and the 4 plain-CJS shared modules untouched by this leg

**LIVE BOOT (all four surfaces): PASSED — leg 1 procedure / leg 2 attach
recipe.** No stale instances (checked before launch — none held ports).
`npm run dev:automation` with `GOLDFINCH_AUTOMATION_DEV_MINT=1
GOLDFINCH_AUTOMATION_ADMIN=1` (WSLg Wayland); `AUTOMATION_DEV_MINT` printed
with non-null key AND adminKey; admin-tier MCP attach via
`scripts/lib/mcp-client.mjs` on the default port 49707:

- **(a) Chrome (boot gate ran as a module)**: `enumerateTabs` returned a
  real active tab (`wcId 2`, `https://www.google.com/`, jar `rename-test`,
  active) — the fully-module queue (10 shared modules + module renderer.js)
  executed and the bottom boot-gate `Promise.all` fired at module
  evaluation. One chrome-tier `evaluate` returned
  `{ allFunctions: true, missing: [] }` for all **18 seam entries**
  (`typeof globalThis[name] === 'function'` for every entry)
- **(b) Jars page THROUGH THE SEAM**: `openJarsPage()` via chrome-tier
  evaluate → `{ok:true}`; `enumerateTabs` shows `goldfinch://jars/` active;
  `readDom` (admin): title "Cookie Jars — Goldfinch", 15,963 chars, **4 nav
  rows, 4 exact-class jar-dot nodes, 6 swatch grids / 33 swatch buttons,
  Burner section present** — the flat-served import chain (burner /
  jar-data-classes / safe-color / jar-page-model → module jars.js) live on
  the internal-page path
- **(c) Settings page THROUGH THE SEAM — activeLog rename proven live**:
  `kebabActionSettings()` via chrome-tier evaluate → `{ok:true}`; `readDom`:
  title "Settings — Goldfinch", the activity pager present and
  **un-hidden** with its numbered buttons rendered — the pager render path
  runs through the renamed `activeLog(state)` import, so a broken rename
  would have left the pager dead/hidden
- **(d) Container sheet THROUGH THE SEAM**: `openContainerOverlay(0)` via
  chrome-tier evaluate → true; sheet document found by the
  background-tab-safe probe walk (wcId 5, skipping every enumerated tab +
  the chrome): **6 menuitems** (4 jar rows + New Jar + Manage jars…) with
  color dots; `captureWindow` PNG shows the picker rendered from the
  module sheet controller — rows Default change / Work / Rename Test 2
  (DEFAULT badge) / Burner tab (evaporates), each with its dot — the
  module menu-overlay.js + classic menu-controller.js mixed queue live
- **Launcher `--enable-logging` stderr scan (all four surfaces)**: CLEAN —
  zero `ReferenceError` (the missed-bridge/import-gap signature), zero
  `Uncaught` / `SyntaxError` / `Unable to load preload` /
  `Failed to construct` / `TypeError` across the full run INCLUDING
  shutdown; the only CONSOLE line is the pre-existing dev-only Electron CSP
  advisory on the chrome page; the rest is the usual WSLg Wayland/DRM noise
  + the two pre-existing `canGoBack`/`canGoForward` deprecation notices;
  app shut down cleanly after the run (no instance left holding a port)

**Known follow-ups (guidance step 6 — FD schedules the wording fixes, leg 6
pointer-update candidates):** three behavior specs carry now-stale
"classic script → window properties" rationale text —
`tests/behavior/popup-jar-inheritance.md:45` (explicit "renderer.js loads as
a classic non-module script..." parenthetical), `tests/behavior/jar-data-controls.md`
(same `window.createTab`/`window.makeBurner` recipe at `:55`), and
`tests/behavior/farbling-correctness.md:26` ("on the chrome renderer
global") — their calls keep working through the seam; and
`scripts/a11y-audit.mjs:336-338` makes the same stale claim ("top-level fns
in src/renderer/renderer.js → window globals"). No spec/script edits made
this leg (outside the file set).

Leg → `landed`; `esm-sweep-controllers` checked off in flight.md. All 13
transitional bridges retired; `menu-controller.js` is the only classic
script in the product. Remaining: machinery retirement (leg 6, CP3).

### Leg 6 — retire-machinery (2026-07-11) — LANDED (CP3 met, all CPs met)

**Implementation (no runtime file changed — types, lint config, the two
nets, docs only, in the gated order d.ts → eslint → nets → docs):**
(a) `renderer-globals.d.ts` slimmed per DD6 in two blocks with a typecheck
run between — the url-safety + keydown-action declares (`:256-288`) and the
entire post-menu-controller shared block (`:324-495`) deleted; the bridge/
typedef section (pre-`:256`) and the menu-controller block (MenuEntry +
`menuController` + `focusItem`) kept; **495 → 289 lines** (exactly the
design-review prediction); `grep -n "declare "` returns **exactly 2 lines**
(`menuController` `:280`, `focusItem` `:289`). (b) eslint end-state: base
commonjs block drops `src/shared/**` and names the four CJS-by-design files
explicitly; ONE `src/shared/**` module block carrying `globals.node` + the
house `no-unused-vars` itself AND the load-bearing
`ignores: [automation-dev, internal-page, dev-profile,
guest-forward-allowlist]` (the design-review HIGH — without it later-wins
re-binds the four to module and the parse guard on the preload-constrained
files is lost); renderer block's injected globals reduced to exactly
`menuController` + `focusItem` (24 shared entries removed); the
four-controller module override intact. (c) Both nets rewritten fresh as
script-tag contract tests (same filenames, self-derived-from-HTML
discipline, vm import + replay + leg-4/5 vacuous-return guards gone):
chrome net hosts the all-documents pins per the FD ruling — count guard on
index.html's shared tags, the permanent DD3 pin and the
all-shared-tags-are-module pin both sweeping ALL `src/renderer/**/*.html`
self-derived (one recursive-readdir glob; shared-file identification by
`../shared/` prefix or flat-name existence in `src/shared/` — no name
collisions exist, verified); jars net keeps its flat-src
existence-resolution specialty + page-scoped count/DD3/module pins; both
headers rewritten as contract tests with the replay history summarized in
one paragraph pointing at this flight. (d) Docs: CLAUDE.md DD10(b) body
replaced with the pointer (heading kept; no other CLAUDE.md change —
the stale dual-export pattern sections are Flight 3's doc-promotion scope);
`scripts/a11y-audit.mjs` `:333-340` comment now names the renderer.js
evaluate-reachable seam (comment-only — audit behavior unchanged, proven by
the green run below); the three behavior specs' rationale wording updated
(popup-jar-inheritance.md step 3 parenthetical replaced;
farbling-correctness.md "on the chrome renderer global" replaced;
jar-data-controls.md step 7 gains the one-line seam attribution — calls
unchanged in all three).

**Static gates:**

- Suite: **1284/1284 pass @ ~954ms** (exactly the design-review-pinned
  count; < 1.5s); nets isolation run: **7/7** — chrome 3 (count guard /
  all-documents DD3 pin / all-documents module pin) + jars 4 (count / DD3 /
  existence-resolution / module pin), the pinned per-net contribution
- `npm run typecheck`: green (run between d.ts blocks and at the end — no
  kept declare referenced a deleted typedef; `countNewer`/`activeLogOf`
  declares deleted with no complaint, as predicted)
- `npm run lint`: green, ZERO warnings (no unused-disable directives)
- **Parse-guard proof (AC)**: `npx eslint --print-config
  src/shared/automation-dev.js` → `sourceType: "commonjs"`; same for
  internal-page.js / dev-profile.js / guest-forward-allowlist.js; converted
  files (spot: burner.js) → `sourceType: "module"`
- **Net-negative delta measure** (`git diff --stat -- . ':!missions'
  ':!BACKLOG.md'`): 37 files, **496 insertions / 690 deletions = net −194**
  — strongly negative per CP3. (The design-review probe measured
  437+/686− = −249; the as-built delta differs because the fresh contract
  tests carry fuller headers — same shape, same conclusion.)
- Diff footprint this leg: exactly `src/renderer/renderer-globals.d.ts`,
  `eslint.config.mjs`, both net files, `CLAUDE.md`,
  `scripts/a11y-audit.mjs`, the three behavior specs (+ artifact files).
  NO change to any `src/` runtime file, any preload, the four CJS shared
  modules, `menu-controller.js`, or `find-overlay.js`

**`npm run a11y` (flight Post-Flight verification): PASSED.** Run LAST per
guidance; stale-instance check first (no electron instances; one stale
fixture `http.server` found and killed, fresh one served from
`tests/behavior/fixtures/a11y-media/`). `GOLDFINCH_AUTOMATION_ADMIN=1
GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation` (WSLg Wayland):
`AUTOMATION_DEV_MINT` printed with non-null key AND adminKey; audit attached
with the admin key and drove all ten states (five chrome + five sheet)
through the renderer seam: **"No NEW violations — every violation node is in
the ACCEPTED baseline"** (21 accepted baseline nodes, informational). Boot
log error scan: **0 hits** for
`Uncaught|SyntaxError|Unable to load preload|Failed to construct|ReferenceError`.
App and fixture server shut down after the run (no instance left holding a
port).

Leg → `landed`; `retire-machinery` checked off in flight.md; **CP3 checked**;
the Contributing-to-Criteria box checked (all three CPs met). Flight ready
for end-of-flight review; commit deferred per the flight workflow.

---

## Decisions

### Divert re-plan: split resolveAutoMintTarget out of the preload require graph

**Context**: Leg 1's live boot fired the flight's divert criterion —
renderer-side (preload) `require()` has no require(esm) support, and
`chrome-preload.js:8 → automation-dev.js:10 → burner.js` transitively pulls
the converted module, killing the chrome. `chrome-preload.js` imports only
`isMcpAutomationEnabled` (pure argv predicate, no burner dependency);
`resolveAutoMintTarget` (`automation-dev.js:80`) is the sole burner-dependent
function and its only callers are `main.js:2683` and unit tests — both
require(esm)-capable environments.
**Decision**: Operator-confirmed (2026-07-11, offered split / lazy-require /
halt): SPLIT — move `resolveAutoMintTarget` to a new main-side module
(`src/main/auto-mint.js`) so `automation-dev.js` drops its burner require
and preload require graphs are ESM-free by construction. New standing
constraint for the sweep: modules reachable from any preload require graph
(`internal-page.js`, `automation-dev.js`) stay CJS and must not require any
converted module.
**Impact**: New leg `02-preload-edge-split` (the unblocking leg) carries the
split + the pilot's transferred live-boot verification; leg 1 stays
`in-flight` and lands together with leg 2 once the live boot passes. Sweep
partitioning inherits the preload constraint. No change to the flight's
objective or end state.

---

## Deviations

*(none yet)*

---

## Anomalies

**2026-07-11 — Leg 1 live boot: renderer/preload require(esm) unsupported.**
The pilot's live boot surfaced that Electron's renderer-side Node require (the
non-sandboxed preload environment) cannot load ES modules — main-process
require(esm) works (probe-verified AND now live-boot-proven), but the same
`require()` call in a preload throws `SyntaxError: Unexpected token 'export'`.
Hit via `chrome-preload.js → automation-dev.js → burner.js`. This is the
flight's divert criterion (a blocking incompatibility the probes missed) —
see the Leg 1 entry under Leg Progress for full evidence and the re-plan
constraint (preload require graphs must stay ESM-free or have the edge broken
before conversion).

---

## Session Notes

### Flight Director Notes

**2026-07-11 — flight start.** Phase file `.flightops/agent-crews/leg-execution.md`
validated (Crew / Interaction Protocol / Prompts present). Flight `ready` →
`in-flight`; branch `flight/02-esm-conversion` created off `main` at
`840a28e` (clean tree, 1283/1283 green at ~1.2s internal). Three planned
legs (pilot → sweep → retire-machinery); sweep partitioning fixed after the
pilot lands (DD1 hard gate). Deferred-review workflow: single review +
commit at end of flight.

**Leg 1 design (esm-pilot).** FD derived the pilot design from source:
transitional `globalThis` bridges are the key mechanism (classic
`renderer.js` / `pages/jars.js` keep reading globals until they convert in
the sweep), and the DD4 net adaptation is tag-parsing rework, not list
filtering — the chrome net's exact-form regex drops BOTH module retags and
DD3 defer additions (its `>= 5` guard would fail on the defer edit alone).
Design review (Developer, Sonnet, 1 cycle): **approve with changes** — the
reviewer applied the full conversion in an isolated worktree and ran it
green (1285/1285 at 975ms incl. 2 new DD3-pin tests, typecheck, lint, zero
ExperimentalWarning on require(esm), globals-merge eslint claim confirmed,
INTERNAL_PAGES already maps both import URLs). 1 medium: the leg's live-boot
verification named tools that op-locally refuse internal sessions
(`evaluate`/`navigate` exclude `goldfinch://` even at admin tier —
`observe.js:342-345`) — verification rewritten to drive the chrome via
admin-tier evaluate (`openJarsPage()`), verify the jars page via
`readDom`/screenshot, and use `--enable-logging` stderr as the jars-page
console-error evidence channel. 3 low (admin-key recipe pointer; bridge
now also runs under require() — comment notes it's benign; line-range
inconsistency) — all applied as wording fixes. No substantive design
change → no second review cycle (skill 2a.4). Leg → `ready`,
`[HANDOFF:review-needed]` signaled, implementation spawn next.

**Leg 1 implementation → BLOCKED, divert, operator ruling.** Developer
(Sonnet) implemented the full pilot; all static gates green (1285/1285 @
936ms incl. 2 new DD3-pin tests, typecheck, lint, diff exactly the allowed
set) but the live boot failed: `[BLOCKED:preload-require-esm]` — see Leg
Progress and Anomalies. Developer correctly stopped per guidance step 6 (fix
was outside the leg's file set). FD traced the edge (chrome-preload uses
only the burner-free `isMcpAutomationEnabled`; `resolveAutoMintTarget` is
main-only) and swept the class (exactly two preload→shared edges exist).
Escalated to operator with three re-plan options; ruling: **split the
module** (see Decisions). Leg 2 (`02-preload-edge-split`) designed next as
the unblocking leg; leg 1 held `in-flight`, lands with leg 2.

**Leg 2 design (preload-edge-split).** FD authored the unblocking leg per
the operator's split ruling. Design review (Developer, Sonnet, 1 cycle):
**approve with changes** — the reviewer applied leg 1's diff + the split
in an isolated worktree and LIVE-BOOTED it clean (no preload error, chrome
bridge alive, `AUTOMATION_DEV_MINT` key minted through the new
`src/main/auto-mint.js` — require(esm) main-side re-proven), all static
gates green (1285/1285 @ ~1115ms, typecheck, lint, zero eslint changes
needed), require-cache one-liner verified in both directions, and swept
all five preloads: exactly the two known shared edges exist, both ESM-free
post-split. 1 medium (flight.md Legs list lacked the divert leg — FD
added it) + 2 low (artifact-files parenthetical in the diff check;
describe-block range `:166-182`) + 1 suggestion (pin the
`AUTOMATION_DEV_MINT` stdout line as the positive live signal — added to
the AC). All wording-level → no second review cycle. Leg → `ready`,
`[HANDOFF:review-needed]` signaled, implementation spawn next.

**Sweep partition fixed (post-pilot, FD).** Four remaining legs: 3 =
internal-surface providers + cross-surface safe-color (all four documents
load it — converting the file forces the four retags at once) + DD5
partner automation-indicator-model; 4 = chrome-surface providers + the
two dead-global modules (CP2); 5 = page controllers convert, bridges
removed; 6 = machinery retirement (CP3). Flight.md Legs list updated to
the fixed partition. audit-paging naming ruling: canonical ESM name =
`activeLog` (CJS/test name); the transitional bridge publishes
`activeLogOf` so settings.js is untouched until its controller converts.

**Leg 3 design (esm-sweep-internal).** Design review (Developer, Sonnet,
1 cycle): **approve with changes** — reviewer applied the full leg in an
isolated worktree: 1 HIGH, empirically proven — `jar-data-classes.test.js`
carries its own global-branch mini vm-replay (`:104-119`, the only such
test outside the two nets) and was the sole suite failure (1284/1285);
FD ruling: REPURPOSE it to pin the transitional bridge under require()
(guards against premature bridge removal during the window; deleted with
the bridges in leg 5; count stays 1285). Both vm nets passed
byte-UNCHANGED in the probe — the pilot's self-adaptation claim holds.
1 medium (renderer.js:2034 reads isSafeColor as a bare global directly —
consumer inventory corrected; feeds leg 5's bridge removal) + 2 low
(five not six audit call sites; citation off-by-ones) + 3 suggestions
(menu-overlay CSP edge case; concrete drive entries `kebabActionSettings()`
/ `openContainerOverlay(0)` — no openSettingsPage exists; DD3 eyeball note
for the net-less menu-overlay document) — all folded in. The HIGH fix is
exactly the reviewer's prescribed-and-probe-validated disposition → no
second review cycle. Leg → `ready`, `[HANDOFF:review-needed]` signaled.

**Leg 4 design (esm-sweep-chrome).** Design review (Developer, Sonnet, 1
cycle): **approve with changes** — 1 HIGH, empirically proven: the pilot's
chrome-net rework included an IN-TEST transitional guard
(`chrome-shared-scripts.test.js:105`, ≥1 classic required) that FAILS once
the replay list is empty — the leg's "nets byte-unchanged" claim was
false and the leg would have self-blocked (probe: 1284/1285). Fixed per
the reviewer's prescription: the leg now carries exactly one chrome-net
amendment (empty-list early return, leg-6-disposition comment) —
probe-validated at 1285/1285 @ ~0.96s with typecheck/lint green and
217/217 isolation. 2 low (dev-profile.test.js is a regex pin, not a vm
replay — stay-CJS ruling unchanged, rationale reworded; renderer.js code
reads = 13 not 23) + 2 suggestions folded in
(guest-forward-allowlist.test.js added to isolation — it requires
keydown-action.js directly; bridge comments name renderer.js as sole
classic consumer). Reviewer question answered in-leg: leg 6 owns the
vacuous chrome replay test's final disposition (flight leg-6 text already
covers net retirement). Reviewer-prescribed + probe-validated → no second
cycle. Also recorded: the 4 plain-CJS modules stay CJS (2
preload-constrained per Decisions; dev-profile +
guest-forward-allowlist by zero-benefit ruling — flight Acceptable
Variation); CP2 will carry that annotation. Leg → `ready`,
`[HANDOFF:review-needed]` signaled.

**Leg 5 design (esm-sweep-controllers).** The bridge-retirement leg; FD
identified the module-scoping hazard up front (a module's top-level
functions are not page globals — every evaluate-driven entry point dies)
and specced an explicit `globalThis` seam on renderer.js. Design review
(Developer, Sonnet, 1 cycle): **approve with changes** — 2 HIGH, both
probe-proven: (1) the flat-served internal-page imports (correct at
runtime — INTERNAL_PAGES is an exact-match flat map; disk-true specifiers
404) fail tsc with 6× TS2307 — FD ruling: `// @ts-ignore` per flat import
with comment (bindings type `any`, matching today's ambient typing; no
protocol-map restructure — trust-sensitive, out of scope; backlog-noted);
(2) the seam sweep scope missed `scripts/a11y-audit.mjs`, which drives 11
renderer entries by name via evaluate and is run by this flight's own
`npm run a11y` verification. Full FD-approved seam = 18 entries (3
dogfooding + 5 behavior-spec — createTab, makeBurner, newIdentity,
measureWebviewsSlotDIP, openFind — + 10 a11y-only), closed set, each
tagged by consumer class. 2 medium folded in (complete bridge-deletion
schedule: (b) audit-paging, (c) jar-page-model + jar-data-classes, (d)
the remaining 10; jars net needs the same `:112` early-return amendment
the chrome net got in leg 4) + 2 low (eslint override placement AFTER the
renderer block; real test filenames). Reviewer live-booted the full leg
incl. the 18-entry seam in a worktree: 1284/1284 (bridge-contract test
deletion pins the count), typecheck/lint green, all four surfaces green,
zero ReferenceError. Known follow-ups recorded for leg 6 / flight review:
three behavior specs + the a11y-audit comment carry now-stale
"classic script → window properties" rationale wording (calls still work
through the seam). Reviewer-prescribed + probe-validated → no second
cycle. Leg → `ready`, `[HANDOFF:review-needed]` signaled.

**Leg 6 design (retire-machinery).** The CP3 leg — types/lint/tests/docs
only, no runtime change; `npm run a11y` is its live gate. Design review
(Developer, Sonnet, 1 cycle): **approve with changes** — 1 HIGH,
probe-proven both ways: the consolidated `src/shared/**` eslint module
block silently re-binds the four CJS-by-design files to module
(later-wins makes their base-block entries dead config), losing the lint
parse guard on exactly the preload-constrained files — an `export` in
automation-dev.js (the leg-1 blocker class) would lint GREEN; fixed with
`ignores` on the module block + an eslint --print-config AC proof. 1
medium resolved by FD ruling: the permanent DD3 pin and the
all-shared-tags-module pin sweep ALL `src/renderer/**/*.html`
self-derived (hosted in the chrome net) — menu-overlay.html's classic
menu-controller.js is the only place DD3 actually binds and previously
had no net. 3 low (grep expectation: exactly 2 `declare` lines remain —
the kept bridge section is all `interface`; jars-net citation range;
jar-data-controls.md has no stale sentence — attribution added, not
replaced) + suggestions folded in (counts pinned: suite 1284, nets 7
tests; the flight's net-negative check excludes missions/ + BACKLOG.md —
design-review measure 437+/686− = −249; d.ts slims 495→289). Reviewer
probe ran the FULL leg green incl. `npm run a11y` ("No NEW violations",
run twice). Sweep answers recorded: no to-delete typedef is referenced
by kept declares; find-overlay.js typed by its own d.ts; no non-renderer
reader of the injected globals. Reviewer-prescribed + probe-validated →
no second cycle. Leg → `ready`, `[HANDOFF:review-needed]` signaled.

**End-of-flight review + commit.** Reviewer (Sonnet, fresh context)
independently re-measured every gate (1284/1284 @ 1069ms, typecheck,
lint zero warnings, a11y "No NEW violations", eslint --print-config
parse-guard proof, all three retirement greps, preload require-cache
proof, d.ts 289 lines / 2 declares, net delta −194) and live-booted the
tree (mint line, 18/18 seam entries, all four surfaces incl. the
settings pager proving the activeLog rename; stderr clean; BURNER
correctly absent as a page global). Trust-model files verified
behavior-identical (url-safety/internal-page bodies byte-identical
minus export syntax; preloads untouched; CJS quartet export-free).
Identity-leak scan clean. `[HANDOFF:confirmed]` first pass with 4
non-blocking stale-comment findings (leg-5 header-update pass missed
audit-paging.js:7-12, jar-data-classes.js:14-20,
jar-data-classes.test.js:7-10, jars.html:16-17 "vm net" wording) —
fixed by a Developer pre-commit (comment-only). Legs → `completed`,
single flight commit + draft PR per the deferred-review workflow;
operator's BACKLOG.md addition (renderer crash-resilience flight seed,
added mid-flight) rides the flight commit per operator instruction.

### Pre-execution design review (2026-07-11, before any leg work)

Operator-requested review of the flight spec against the tree at `1ffaeda`
before invoking /agentic-workflow. Reviewer (Developer, Sonnet) re-derived
the full conversion inventory and ran three isolated empirical probes.
**Assessment: approve with changes** — feasibility and the pilot-gate
strategy confirmed sound, but three HIGH findings would have failed the
pilot's own CP1 gate as originally scoped:

1. The vm-replay nets and the eslint `sourceType: 'commonjs'` per-glob
   binding break on the FIRST converted file (both empirically reproduced
   in a worktree) — machinery adaptation must ride every converting leg,
   not wait for leg 5 (now DD4).
2. Main-process require(esm) was outside the original probe coverage while
   7 of 15 dual-export modules are required by main (several at module
   load, pre-`app.ready`). Closed empirically: Electron 42.4.0 main-process
   require of `export`-syntax modules verified by isolated probe; made an
   explicit pilot acceptance criterion (DD2/CP1).
3. Partial-page conversion inverts classic-vs-module execution order;
   `renderer.js` tolerates it only by an unstated invariant — now guarded
   by the transitional defer rule (DD3).

Also corrected: hybrid set is container-menu/jar-page-model/
automation-indicator-model (NOT automation-dev, which is plain CJS);
pilot widened to include jar-page-model.js so order-survival is proven on
BOTH load paths; downloads.html has no shared scripts (dropped from retag
list); menu-overlay.html added (loads safe-color.js); audit-paging.js
activeLog/activeLogOf export-name mismatch identified; menu-controller.js
explicitly carved out (DD6 — d.ts slims, doesn't retire); counts fixed
(26 eslint globals, 18 typeof-module sites vs the report's 32/37). Flight
spec rewritten accordingly while still `ready` (pre-in-flight, updatable
per ARTIFACTS.md). The maintenance report itself left untouched —
inspection snapshot; corrections live here and in the flight spec.
