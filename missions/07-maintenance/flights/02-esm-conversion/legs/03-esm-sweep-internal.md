# Leg: esm-sweep-internal

**Status**: completed
**Flight**: [ESM Conversion of src/shared/](../flight.md)

## Objective

Convert the internal-surface provider modules plus the cross-surface
`safe-color.js` (and, per DD5, its hybrid partner
`automation-indicator-model.js`) to ESM — `jar-data-classes.js`,
`audit-paging.js`, `safe-color.js`, `automation-indicator-model.js` —
retagging all four consuming documents, with transitional bridges keeping
every classic consumer working.

## Context

- **Sweep partition (FD, post-pilot)**: leg 3 = internal-surface providers
  + safe-color (cross-surface: index.html, jars.html, settings.html,
  menu-overlay.html ALL load it — converting the file forces retags on all
  four documents at once, since a classic tag loading an `export`-syntax
  file is a SyntaxError). Leg 4 = remaining chrome-surface providers +
  the two dead-global modules. Leg 5 = page controllers convert + bridges
  removed. Leg 6 = machinery retirement (flight's leg-5 content).
- **DD5 forces `automation-indicator-model.js` into this leg**: its hybrid
  (`:47-48`) resolves `safe-color`'s `isSafeColor` — producer and hybrid
  convert together so the branch is deleted (→
  `import { isSafeColor } from './safe-color.js'`), not ported.
- **audit-paging name mismatch resolved here (flight Technical Approach)**:
  CJS exports `activeLog` (`:236`); the global branch publishes
  `activeLogOf` (`:240`); `settings.js:1028` calls the GLOBAL name.
  Ruling: **canonical ESM name = `activeLog`** (unit test unchanged); the
  transitional bridge publishes `activeLogOf` — exactly what the page
  reads today — so `settings.js` is untouched this leg. When settings.js
  converts (leg 5), its call site renames to the canonical name.
- **Preload constraint (flight-log Decisions)**: none of this leg's four
  modules is reachable from any preload require graph (only
  `internal-page.js` + `automation-dev.js` are, both staying CJS) —
  verified, no new edge.
- **Nets are self-adapting now**: the pilot's rework derives replay lists
  from the live HTML and excludes `type="module"` tags — this leg's retags
  drop the converted files from the replay automatically; the DD3 pin
  keeps holding (settings.html is already all-defer; menu-overlay.html
  gets DD3 here). NO net code changes expected this leg — verify only.
- **Main-process requires unaffected in code, exercised via require(esm)**:
  `jars.js:40` (`isSafeColor`), `jar-ipc.js:41` (`jarDataClassById`) —
  same proven mechanism as burner (leg 1/2 boots).
- Live-boot pattern and admin-attach recipe: leg 1's Verification Steps +
  leg 2's flight-log entry (working procedure with evidence shapes).

## Inputs

- Working tree with legs 1-2 landed (uncommitted): 1285/1285 @ ~1s,
  typecheck, lint, CP1 live-proven.
- `src/shared/jar-data-classes.js` (dual tail `:55-59`; exports
  `JAR_DATA_CLASSES`, `jarDataClassById`), `src/shared/safe-color.js`
  (tail `:24-27`; exports `isSafeColor`), `src/shared/audit-paging.js`
  (tail `:235-244`; 6 functions, `activeLogOf` alias at `:240`),
  `src/shared/automation-indicator-model.js` (hybrid `:47-48`, use `:62`,
  tail `:127`).
- Documents: `index.html` (safe-color + automation-indicator-model tags,
  currently `defer`), `pages/jars.html` (jar-data-classes + safe-color,
  `defer`), `pages/settings.html:8-13` (audit-paging + safe-color,
  `defer`; settings.js stays classic-defer), `menu-overlay.html:19-21`
  (safe-color classic NON-defer + menu-controller.js + menu-overlay.js —
  DD3 fires here).
- Classic consumers reading the bridged globals: `renderer.js`
  (`buildAutomationIndicatorModel`; AND a direct bare-global
  `isSafeColor` read at `:2034` — defense-in-depth re-validation in
  `renderAutomationIndicator`; leg 5's bridge-removal inventory must
  include it), `pages/jars.js` (`JAR_DATA_CLASSES` `:749`/`:781`,
  `isSafeColor` `:234` etc.), `pages/settings.js` (`isSafeColor`
  `:572`/`:616`; five audit-global call sites in `:1028-1079` —
  `activeLogOf`, `windowPage`, `pageCount`, `pageList`, `reduceAudit`;
  `countNewer` appears only in the `:901` comment — bridge all six
  anyway, matching the old global branch), `menu-overlay.js`
  (`isSafeColor` `:201`).
- eslint pilot override block (files array + `sourceType: 'module'`,
  currently listing the three pilot files).

## Outputs

- Four more `src/shared/` files as ESM with transitional bridges; hybrid
  count now zero (all three DD5 hybrids deleted).
- All four documents retagged; menu-overlay.html on the DD3 mixed queue.
- eslint override extended to seven files.
- Flight log updated; leg → `landed`.

## Acceptance Criteria

- [x] `jar-data-classes.js`: `export const JAR_DATA_CLASSES`,
      `export function jarDataClassById` (or export list — API unchanged);
      tail deleted; transitional bridges publish BOTH current global names
      (jars.js reads `JAR_DATA_CLASSES`; `jarDataClassById` bridged for
      symmetry with the old global branch), with the standard transitional
      comment (leg 1 precedent, incl. the runs-under-require() note)
- [x] `test/unit/jar-data-classes.test.js:104-119` (the global-branch
      mini vm-replay — the ONLY test outside the two nets that replays a
      converting file's source; design-review probe confirmed it is the
      sole suite breakage) REPURPOSED: it now asserts the transitional
      bridge populates `globalThis.JAR_DATA_CLASSES` /
      `globalThis.jarDataClassById` under `require()` — pinning the
      bridge contract classic consumers depend on until the controllers
      convert (removed together with the bridges). Test count unchanged
- [x] `safe-color.js`: `export function isSafeColor`; tail deleted;
      transitional bridge (classic consumers: pages/jars.js,
      pages/settings.js, menu-overlay.js)
- [x] `audit-paging.js`: all six functions exported under their CJS names
      (`windowPage`, `countNewer`, `activeLog`, `reduceAudit`, `pageList`,
      `pageCount`); tail deleted; transitional bridges publish the CURRENT
      page-global names — including `activeLogOf` for `activeLog`
      (`settings.js:1028` untouched this leg); header comment documents
      the canonical-name ruling (page call site renames at controller
      conversion)
- [x] `automation-indicator-model.js`: hybrid `:47-48` replaced with
      `import { isSafeColor } from './safe-color.js'` (body use `:62`
      renamed); `export function buildAutomationIndicatorModel`; tail
      deleted; transitional bridge
- [x] `index.html`: safe-color + automation-indicator-model tags `defer` →
      `type="module"` (F7 order comment still true — update if wording
      references "classic"); `jars.html`: jar-data-classes + safe-color
      tags → `type="module"` (header comment updated); `settings.html`:
      audit-paging + safe-color tags → `type="module"` (settings.js stays
      classic `defer`); `menu-overlay.html`: safe-color →
      `type="module"` AND (DD3) `menu-controller.js` + `menu-overlay.js`
      gain `defer`, with a DD3 comment in the leg-1 style
- [x] eslint pilot override's `files` array extended with the four new
      module paths (seven total); no other config change
- [x] Both vm nets pass UNCHANGED (self-derived replay lists drop the
      newly-module tags; DD3 pin green on both pages) — if either net
      needs a code change, STOP and report why (that contradicts the
      pilot's rework and the FD needs to know)
- [x] NO change to: page controllers (`renderer.js`, `pages/jars.js`,
      `pages/settings.js`, `menu-overlay.js`), `menu-controller.js` (DD6),
      `renderer-globals.d.ts`, main-process files, preloads, nets, any
      test file EXCEPT `jar-data-classes.test.js` (repurpose above)
- [x] Suite green (1285/1285, < 1.5s), typecheck green, lint green
- [x] LIVE BOOT, four surfaces (leg 1 procedure + leg 2 evidence shapes):
      (a) chrome — clean boot, chrome-tier evaluate:
      `typeof globalThis.buildAutomationIndicatorModel === 'function' &&
      typeof globalThis.isSafeColor === 'function'` true;
      (b) jars page — `openJarsPage()`, `readDom`: rows + palette swatch
      grids render (JAR_DATA_CLASSES/safe-color chain live);
      (c) settings page — open `goldfinch://settings` (drive the chrome
      the same way; if no direct helper exists, a new tab navigated from
      the chrome UI path the product uses), `readDom`: the activity
      viewer's pagination renders (audit-paging bridge chain live,
      `activeLogOf` resolving);
      (d) menu-overlay sheet — open the container picker via chrome-tier
      evaluate of the same entry the product uses; `captureWindow` (or
      equivalent) shows jar rows with color dots (safe-color chain live in
      the sheet document);
      launcher `--enable-logging` stderr clean of uncaught errors across
      all four

## Verification Steps

- `npm test && npm run typecheck && npm run lint`
- `node --test test/unit/chrome-shared-scripts.test.js
  test/unit/jars-page-shared-scripts.test.js test/unit/audit-paging.test.js
  test/unit/safe-color.test.js test/unit/jar-data-classes.test.js
  test/unit/automation-indicator-model.test.js` (isolation; skip any that
  don't exist under those exact names — match the real test files for the
  four modules)
- Live boot per AC; evidence in the flight-log entry
- `git diff --stat` — this leg adds exactly: the 4 shared files, 4 html
  documents, `eslint.config.mjs`, `test/unit/jar-data-classes.test.js`
  on top of legs 1-2 (+ artifact files)

## Implementation Guidance

1. **Modules first, one at a time, suite between each** (the nets +
   consumer tests catch a bad tail deletion immediately; the suite is
   ~1s). For each: delete `'use strict'`, convert exports, delete tail,
   add bridges + transitional comment (copy the leg-1 wording from
   burner.js).
2. **audit-paging.js**: keep the header's dual-export paragraph updated —
   it currently cites the url-safety UMD idiom (`:9-12`); rewrite for
   ESM + bridge, and document the `activeLog`/`activeLogOf` ruling where
   the alias bridge sits.
3. **Retags next**, page by page, suite between each (the DD3 pin and
   replay derive from the HTML — they'll catch a missed defer).
   menu-overlay.html needs the fuller edit: retag + 2 defers + DD3
   comment. menu-controller.js MUST come before menu-overlay.js in the
   defer queue (it already does in document order — preserve it).
4. **eslint**: extend the override's files array only.
5. **Live boot last.** For surface (c): `kebabActionSettings()`
   (renderer.js `:219-221`, top-level function, chrome-tier evaluate)
   opens `goldfinch://settings` — there is no `openSettingsPage` helper.
   For (d): `openContainerOverlay(0)` (renderer.js `:350-352`, top-level
   lexical const, evaluate-reachable) opens the container sheet; the
   sheet is a separate document, so `readDom` may not target it —
   `captureWindow` of the whole window with the sheet open is sufficient
   evidence (jar rows + color dots visible). If a surface cannot be
   driven scriptably, report exactly which check is unreachable rather
   than skipping silently.
6. **DD3 on menu-overlay.html is NOT machine-pinned** (no net covers
   that document) — eyeball the final tag block explicitly: safe-color
   `type="module"`, menu-controller + menu-overlay both `defer`, order
   preserved.

## Edge Cases

- **A classic tag pointing at a converted file is a parse-time
  SyntaxError** — the retag set must be complete per file. safe-color has
  FOUR tags (one per document); grep the tree for every `<script` tag
  referencing each converted file before calling the retag done
  (`grep -rn 'safe-color.js"' src/`).
- **jarDataClassById has no renderer consumer** (main-only via
  `jar-ipc.js:41`) — bridge it anyway (symmetry with the old global
  branch; costless, and leg 5 removes all bridges together).
- **audit-paging typedefs** (`AuditEntry`, `PagerState`, `PageWindow`)
  are JSDoc-only — they stay valid in a module; typecheck confirms.
- **menu-overlay.html is a chrome-class document** (file://, ../shared/
  relative path) — same load path the pilot proved on index.html; no new
  protocol-map work. settings.html serves flat srcs via INTERNAL_PAGES —
  entries already exist (the page loads these files today); safe-color.js
  has no imports, so no NEW map entries are needed anywhere.
- **menu-overlay.html carries an explicit CSP meta (`script-src 'self'`)**
  — the only converting document with one (the pilot's file:// module
  proof ran on CSP-less index.html). CSP source lists treat module and
  classic scripts identically, so no failure is expected — but if
  live-boot (d) fails, check CSP first.
- **Settings' activity viewer needs audit entries to page** — an
  automation-driven boot generates audit entries itself; pagination
  chrome rendering (even "page 1 of 1") is sufficient evidence that the
  audit-paging chain resolved — do not chase multi-page state.
- **If the live boot fails**: `[BLOCKED:<reason>]`, stop, no workarounds
  (divert criterion applies afresh).

## Files Affected

- `src/shared/jar-data-classes.js`, `src/shared/safe-color.js`,
  `src/shared/audit-paging.js`,
  `src/shared/automation-indicator-model.js` — ESM + bridges
- `src/renderer/index.html`, `src/renderer/pages/jars.html`,
  `src/renderer/pages/settings.html`, `src/renderer/menu-overlay.html` —
  retags (+ DD3 on menu-overlay)
- `eslint.config.mjs` — override files array

---

## Post-Completion Checklist

**Complete ALL steps before finishing (commit is deferred to end of
flight):**

- [x] All acceptance criteria verified (live boot included)
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry (live-boot evidence,
      all four surfaces)
- [x] Set this leg's status to `landed`
- [x] Check off this leg in flight.md (add it to the Legs list alongside
      the sweep entry if not already listed) — CP2 stays open (chrome
      providers remain)

## Citation Audit

Verified at leg design time against the working tree (legs 1-2 landed,
uncommitted; ranges corrected per design review): `jar-data-classes.js:55-60`
(tail) OK; `safe-color.js:24-28` (tail) OK; `audit-paging.js:9-12` (UMD
header note), `:104-106` (`activeLog` fn), `:235-244` (tail; `activeLogOf`
alias `:240`) OK; `automation-indicator-model.js:47-49` (hybrid incl.
global-branch arm), `:62` (use), `:127` (tail) OK;
`jar-data-classes.test.js:104-119` (global-branch mini vm-replay) OK;
`renderer.js:219-221` (`kebabActionSettings`), `:350-352`
(`openContainerOverlay`), `:2034` (direct `isSafeColor` read) OK; `settings.html:8-13` (3 tags, all defer) OK; `menu-overlay.html:19-21`
(3 classic non-defer tags) OK; `find-overlay.html:27` (own script only —
out of scope, confirmed) OK; `settings.js:572`, `:616` (isSafeColor),
`:901` (globals comment), `:1028` (`activeLogOf` call), `:1029`, `:1045`,
`:1051`, `:1079` (audit-global uses) OK; `pages/jars.js:749`, `:781`
(JAR_DATA_CLASSES), `:234` (isSafeColor) OK; `menu-overlay.js:201`
(isSafeColor) OK; `renderer.js:352` (openOverlayMenu container entry) OK;
`jars.js:40` / `jar-ipc.js:41` (main requires) OK; index.html/jars.html
post-pilot tag forms (defer/type=module mix + DD3 comments) OK. 26
citations, all OK.
