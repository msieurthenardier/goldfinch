# Leg: esm-sweep-chrome

**Status**: completed
**Flight**: [ESM Conversion of src/shared/](../flight.md)

## Objective

Convert the remaining eight dual-export modules — the six chrome-page
providers (`url-safety.js`, `keydown-action.js`, `site-info.js`,
`page-context-model.js`, `default-routing.js`, `inherit-container.js`)
plus the two dead-global-branch modules (`sheet-accelerator.js`,
`cross-view-nav.js`) — completing the provider sweep (CP2, with the
recorded CJS carve-outs).

## Context

- **Partition**: this is sweep leg 2 of 2 (flight-log FD notes). After
  this leg every dual-export module is ESM; what remains is controllers
  (leg 5) and machinery retirement (leg 6).
- **The 4 plain-CJS modules STAY CJS — recorded ruling.**
  `automation-dev.js` + `internal-page.js` are preload-constrained
  (flight-log Decisions — MUST stay). `dev-profile.js` +
  `guest-forward-allowlist.js` are left by leg-design judgment (flight
  Acceptable Variations): zero page consumers, no global branch to
  retire, no criterion benefit. (`dev-profile.test.js:43` does a
  readFileSync + regex pin on the source — NOT a vm replay; it would
  survive conversion. The stay-CJS ruling stands on the zero-benefit
  ground alone.) CP2 is checked with this annotation.
- **Dead global branches deleted, not bridged**: `sheet-accelerator.js`
  and `cross-view-nav.js` have NO page `<script>` tag anywhere and no
  renderer reader — their `globalThis` branches
  (`sheetAcceleratorAction`/`isGuestActionAllowed`; `crossViewNavAction`)
  are dead code (maintenance-report finding, re-verified at leg design).
  They convert to pure `export` modules: no bridges, no retags, no
  live-boot dependency. Their consumers are main
  (`main.js:43`/`:44`) and tests — require(esm), proven mechanism.
- **The six chrome providers get transitional bridges** (leg 1 wording,
  but name `renderer.js` as the sole classic consumer): consumers are
  `renderer.js` ONLY among renderer files (13 code read sites; no other
  renderer file reads any of the nine globals — verified).
  Bridged names: `isSafeTabUrl`, `isSafePosterUrl`, `isInternalPageUrl`
  (url-safety); `keydownToAction`; `deriveSiteInfo`; `pageContextModel`;
  `resolveNewTabContainer`; `inheritContainerDecision`,
  `inheritFromPartition` (inherit-container).
- **Main requires exercised via require(esm)** (no code change):
  `main.js:11` + `settings-store.js:21` + `automation/nav.js:29`
  (url-safety), `main.js:49` (keydown-action), `main.js:43-44`
  (sheet-accelerator, cross-view-nav). Preloads: none of the eight
  (constraint verified — the two preload edges are the CJS-staying
  automation-dev/internal-page).
- **No cross-requires among the eight** — eight independent conversions,
  no import statements needed between them.
- **After this leg the chrome net's replay list is EMPTY** (all 10 shared
  tags on index.html are `type="module"`; renderer.js is the sole classic,
  `defer`). The top-level tag-count guard (`:79`, all shared tags 10 ≥ 5)
  and the DD3 pin stay green — but the replay test carries an IN-TEST
  transitional guard (`chrome-shared-scripts.test.js:105`,
  `assert.ok(files.length >= 1, 'expected at least one classic ... during
  the transitional window')`) that FAILS on an empty list (design-review
  probe: 1284/1285 without the amendment). This leg therefore carries ONE
  prescribed chrome-net change: replace that assertion with an early
  return when the classic list is empty, commented as "sweep complete —
  vacuously green; leg 6 owns this test's final disposition". The jars
  net stays byte-unchanged (its replay retains classic `jars.js` —
  probe-verified).
- Live-boot procedure: leg 2/3 flight-log entries (admin attach recipe,
  evidence shapes). Only index.html changes this leg → chrome is the
  surface to prove; the other three surfaces were proven in leg 3 and
  their documents are untouched.

## Inputs

- Working tree with legs 1-3 landed (uncommitted): 1285/1285 @ ~1.1s,
  typecheck, lint green; four surfaces live-proven.
- The eight modules' dual-export tails (verified `if (typeof module`
  lines): `url-safety.js:127` (globals `:130-132`),
  `keydown-action.js:78` (`:81`), `site-info.js:40` (`:43`),
  `page-context-model.js:127` (`:130`), `default-routing.js:29` (`:32`),
  `inherit-container.js:91` (`:94-95`), `sheet-accelerator.js:95`
  (`:98-99`), `cross-view-nav.js:42` (`:45`).
- `index.html`: six remaining `defer` shared tags (url-safety,
  keydown-action, site-info, page-context-model, default-routing,
  inherit-container) + the DD3 block comment.
- eslint override block (currently seven files).

## Outputs

- Eight modules on ESM (six with bridges, two pure); 15/15 dual-export
  conversions complete; zero `typeof module` sites left in `src/shared/`.
- index.html fully module-tagged for shared scripts (renderer.js sole
  classic, defer).
- eslint override at fifteen files.
- Flight log updated; leg → `landed`; CP2 checked (with the CJS-quartet
  annotation).

## Acceptance Criteria

- [x] Six chrome providers converted: `export` statements for their
      existing API names (unchanged), tails deleted, `'use strict'`
      removed, transitional bridges for exactly the nine page-consumed
      globals listed in Context, each with the standard transitional
      comment (leg 1 wording incl. runs-under-require() note)
- [x] `sheet-accelerator.js` + `cross-view-nav.js` converted with their
      global branches DELETED (no bridges — dead code removed); header
      comments updated (no more "renderer documents" claim); before
      deleting, re-verify emptiness:
      `grep -rn "sheetAcceleratorAction\|isGuestActionAllowed\|crossViewNavAction" src/renderer/`
      returns nothing and no `<script` tag anywhere references either file
      (verified: both greps empty, before deletion and after)
- [x] `index.html`: the six tags `defer` → `type="module"`; DD3 block
      comment updated (renderer.js is now the page's ONLY classic script);
      script ORDER unchanged
- [x] eslint override `files` array extended to fifteen
      `src/shared/*.js` entries; no other config change (do NOT collapse
      to a glob yet — that is leg 6's consolidation)
- [x] `grep -rn "typeof module" src/shared/` returns ZERO hits
- [x] Chrome net: EXACTLY the one prescribed change (the `:105`
      transitional-window assertion → early return on empty classic list,
      with the leg-6-disposition comment); everything else in it
      byte-unchanged (tag-count guard `:79`, DD3 pin green). Jars net
      byte-UNCHANGED. Any OTHER net change needed → STOP and report
      (none needed)
- [x] NO change to: page controllers, `menu-controller.js`,
      `renderer-globals.d.ts`, main-process files, preloads, the 4
      plain-CJS shared modules, any test file except the chrome net's
      one-liner above
- [x] Suite green (1285/1285 @ ~995ms), typecheck green, lint green
- [x] LIVE BOOT (chrome surface): clean boot; chrome-tier evaluate
      returns true for typeof-function checks on ALL nine bridged
      globals; the tab strip is alive (a real tab exists via
      `enumerateTabs` — proves renderer.js's boot gate ran, i.e. the
      whole module/defer queue executed in order); launcher stderr clean
      of uncaught errors (evidence in flight-log "Leg 4 —
      esm-sweep-chrome (2026-07-11)")

## Verification Steps

- `npm test && npm run typecheck && npm run lint`
- `node --test` isolation on the eight modules' unit tests + both nets +
  `test/unit/guest-forward-allowlist.test.js` (it requires the converted
  `keydown-action.js` directly — the one direct-consumer test outside the
  eight files' own; match real test filenames)
- The two greps in the ACs (dead-global emptiness; zero `typeof module`)
- Live boot per AC; evidence in the flight-log entry
- `git diff --stat` — this leg adds exactly: the 8 shared files,
  `index.html`, `eslint.config.mjs` on top of legs 1-3 (+ artifact files)

## Implementation Guidance

1. **The two dead-global modules first** (no page dependency — pure
   conversions; suite verifies immediately via their unit tests +
   main.js typecheck).
2. **Then the six providers, one at a time, suite between each.**
3. **Then the six index.html retags in one edit** + DD3 comment update.
   (Interleaving retags per module also works but each intermediate
   state must keep the converted file's tag `type="module"` — a classic
   tag on a converted file is a parse-time SyntaxError; the leg-3
   pattern of module-then-retag with a suite run between is fine because
   the nets catch the unretagged window — expect the transient net
   failure mid-sequence exactly as leg 3 saw, resolving at the retag.)
4. **eslint** files-array extension.
5. **Live boot last** (chrome only): all nine typeof checks in one
   evaluate; `enumerateTabs` for the tab-strip liveness; stderr scan.

## Edge Cases

- **url-safety is required by THREE main-side files** (`main.js:11`,
  `settings-store.js:21`, `automation/nav.js:29` — the widest require
  fan-out of the sweep) — all the same require(esm) mechanism; the live
  boot exercises all three (settings-store loads at boot; nav.js loads
  with the automation surface).
- **`isInternalPageUrl` is trust-model-relevant** (internal-nav gating)
  — behavior must be byte-identical; the conversion touches only the
  export tail, never the function bodies.
- **dev-profile.test.js replays dev-profile.js source** — one more
  reason that file stays CJS; do not "tidy" it while in the directory.
- **If the live boot fails**: `[BLOCKED:<reason>]`, stop.

## Files Affected

- `src/shared/url-safety.js`, `keydown-action.js`, `site-info.js`,
  `page-context-model.js`, `default-routing.js`, `inherit-container.js`
  — ESM + bridges
- `src/shared/sheet-accelerator.js`, `cross-view-nav.js` — ESM, dead
  global branches deleted
- `src/renderer/index.html` — 6 retags + DD3 comment
- `test/unit/chrome-shared-scripts.test.js` — the one prescribed
  transitional-guard amendment
- `eslint.config.mjs` — override files array

---

## Post-Completion Checklist

**Complete ALL steps before finishing (commit is deferred to end of
flight):**

- [x] All acceptance criteria verified (live boot included)
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed`
- [x] Check off this leg in flight.md AND CP2 (annotate: "except the 4
      CJS-by-design — 2 preload-constrained, 2 left by ruling")

## Citation Audit

Verified at leg design time against the working tree (legs 1-3 landed,
uncommitted): dual-export `if (typeof module` lines — `url-safety.js:127`
(+globals `:130-132`), `keydown-action.js:78` (`:81`), `site-info.js:40`
(`:43`), `page-context-model.js:127` (`:130`), `default-routing.js:29`
(`:32`), `inherit-container.js:91` (`:94-95`), `sheet-accelerator.js:95`
(`:98-99`), `cross-view-nav.js:42` (`:45`) — all OK; main requires
`main.js:11`, `:43`, `:44`, `:49`, `settings-store.js:21`,
`automation/nav.js:29` OK; renderer-file consumer sweep (renderer.js the
only reader of the nine globals) OK; preload sweep (none of the eight)
OK — carried from the leg-2 review's five-preload sweep plus this leg's
grep; `dev-profile.test.js` replay confirmed via
`readFileSync/runInContext` grep OK; `chrome-shared-scripts.test.js:79` (tag-count guard), `:105`
(in-test transitional-window assertion — the prescribed amendment site)
OK; `dev-profile.test.js:43` (readFileSync + regex pin, not a replay) OK;
`main.js:423`/`:444`/`:1016` (dead-global-module main call sites) OK. 21
citations, all OK (design review corrected: renderer.js code reads = 13,
not 23).
