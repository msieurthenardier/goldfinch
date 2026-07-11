# Leg: retire-machinery

**Status**: completed
**Flight**: [ESM Conversion of src/shared/](../flight.md)

## Objective

Retire the compensating machinery the conversion made obsolete (CP3):
slim `renderer-globals.d.ts` per DD6, remove the shared injected-globals
from the eslint renderer block and consolidate the sourceType overrides,
repurpose the two vm nets into script-tag contract tests, and land the
pointer-level doc updates (CLAUDE.md DD10(b) pointer + the leg-5 stale-
rationale follow-ups).

## Context

- **No runtime change in this leg** — types, lint config, tests, and
  docs only. The runtime end-state landed in leg 5. Verification is the
  static gates plus `npm run a11y` (the flight's Post-Flight
  verification; it also live-exercises the renderer seam the a11y audit
  drives).
- **d.ts slim (DD6)**: shared-global declares OUT — the url-safety +
  keydown-action block (`:256-288` region) and the post-menu-controller
  shared block (`:324-495` region: isSafeColor, deriveSiteInfo,
  buildContainerModel, BURNER, resolveNewTabContainer,
  buildJarPageModel, PALETTE, pickNewJarColor, JAR_DATA_CLASSES +
  JarDataClass typedef, jarDataClassById, inheritContainerDecision,
  inheritFromPartition, buildAutomationIndicatorModel, pageContextModel,
  windowPage, countNewer, activeLogOf, reduceAudit, pageCount, pageList).
  STAY: everything before `:256` (automation/audit typedefs +
  window.goldfinch bridge surface) and the menu-controller block
  (`:289-322`, `menuController` `:313` + `focusItem` `:322` — DD6
  carve-out). CAUTION: a deleted typedef may be referenced by a kept
  bridge declare — check references before deleting each typedef;
  typecheck arbitrates (keep any typedef a kept declare needs).
- **eslint consolidation (flight leg-6 text)**:
  1. Base commonjs block (`:10-11`): drop `src/shared/**` from `files`;
     add the four CJS-by-design shared files explicitly
     (`automation-dev.js`, `internal-page.js`, `dev-profile.js`,
     `guest-forward-allowlist.js`).
  2. Replace the 15-file module override (`:20-37`) with ONE
     `src/shared/**` module block — it must now carry
     `globals: { ...globals.node }` and the house `no-unused-vars` rule
     itself (it no longer inherits them from the base block once
     src/shared/** leaves it) — AND an
     `ignores: [the four CJS-by-design files]` entry. WITHOUT the
     ignores, later-wins silently re-binds the four to `module` (their
     base-block entries become dead config) and the lint parse guard is
     lost on exactly the preload-constrained files — an `export` added
     to automation-dev.js (the leg-1 blocker class) would lint GREEN
     (design-review probe confirmed both the failure and the fix).
  3. Renderer block (`:66-` area): remove the 24 shared injected
     globals; KEEP `menuController` + `focusItem` (DD6 — provider stays
     classic). The flight text says "26 named entries" — 24 is the
     as-built number to remove; the 2 menu-controller entries stay
     (recorded imprecision, flight-log FD notes).
  4. The four-controller module override (`:81-87`) STAYS (they are
     modules; the renderer block default remains `script` for
     menu-controller.js's sibling `find-overlay.js`).
- **vm nets → script-tag contract tests (repurpose, same filenames)**:
  the collision class is structurally gone (module scope), so the vm
  replay machinery retires — delete the `vm` import, the replay tests,
  and the leg-4/5 vacuous-return transitional guards. KEEP and sharpen
  what still guards real regressions:
  1. tag parsing + the non-empty tag-count guards (page loads what we
     think it loads),
  2. the jars net's existence-resolution test (`:50-56` region — a
     typo'd flat src 404s at boot; this is the only static net for it),
  3. the DD3 pin, now stated as the permanent rule: any classic script
     tag on a page with module scripts must carry `defer`,
  4. NEW pin: every `src/shared/*.js` script tag is `type="module"` (a
     classic tag on an ESM file is a parse-time SyntaxError only a live
     boot would catch).
  **Pin scope — FD ruling (design-review question)**: pins 3 and 4 sweep
  ALL documents, self-derived from `src/renderer/**/*.html` (one glob,
  hosted in the chrome net, whose header renames accordingly) — NOT just
  the two netted pages. menu-overlay.html (`:31`, classic
  menu-controller.js `defer`) is the ONLY place the DD3 rule actually
  binds post-conversion and previously had no net; settings.html's
  module tags likewise gain static coverage. The jars net keeps its
  flat-src existence-resolution specialty. Header comments rewritten:
  these are script-tag contract tests; the shared-scope replay history
  is summarized in one paragraph pointing at this flight. Suite count
  pinned by design review: **1284/1284** total; nets contribute 7 tests
  (chrome 3: count guard / all-documents DD3 pin / all-documents module
  pin; jars 4: its own three + existence-resolution) — the replay→pin
  swap is one-for-one per net.
- **CLAUDE.md DD10(b) pointer update ONLY** (`CLAUDE.md:69` — the
  "Shared-global onboarding checklist"): the four-part dual-export
  checklist describes a world that no longer exists. Replace the body
  with a short pointer: `src/shared/` is real ESM as of M07 Flight 2
  (imports + explicit extensions; the four CJS-by-design files carry
  PRELOAD-REACHABLE notes; evaluate-reachable renderer entries live in
  the renderer.js seam); full checklist rewrite lands with the M07
  Flight 3 doc promotions. Do NOT write the new full checklist here —
  Flight 3 owns it.
- **Leg-5 stale-rationale follow-ups (FD-scheduled here)**:
  `scripts/a11y-audit.mjs:336-338` comment (top-level fns → window
  globals) updates to name the seam; three behavior specs' rationale
  wording updates the same way (`tests/behavior/popup-jar-inheritance.md:45`
  region and `farbling-correctness.md:26` region carry stale claims to
  REPLACE; `jar-data-controls.md:55` has no stale sentence — its bare
  `window.createTab`/`window.makeBurner` recipe gains a one-line seam
  attribution instead) — wording only, no Action/Expected change (specs'
  calls already work through the seam).

## Inputs

- Working tree with legs 1-5 landed (uncommitted): 1284/1284 @ ~0.93s,
  typecheck, lint green; all surfaces live-proven; seam published.
- `src/renderer/renderer-globals.d.ts` (495 lines; structure above).
- `eslint.config.mjs` (blocks at `:10-11`, `:20-37`, `:62-63`, `:66+`,
  `:81-87`).
- `test/unit/chrome-shared-scripts.test.js`,
  `test/unit/jars-page-shared-scripts.test.js` (post-leg-4/5 state).
- `CLAUDE.md:69` (DD10(b) checklist), `scripts/a11y-audit.mjs:336-338`,
  the three behavior specs.

## Outputs

- d.ts ~half its size, shared declares gone; eslint at its end-state
  shape; two slim script-tag contract tests; docs pointer-updated.
- CP3 checked; flight ready for end-of-flight review.

## Acceptance Criteria

- [x] `renderer-globals.d.ts`: all shared-global declares deleted; the
      pre-`:256` bridge/typedef section and the menu-controller block
      remain; any typedef referenced by a kept declare remains;
      `npm run typecheck` green (this is the proof the controllers'
      imports fully replaced the ambient surface) — 495 → 289 lines;
      `grep -n "declare "` → exactly 2 lines (`:280` menuController,
      `:289` focusItem)
- [x] eslint end-state: base block without `src/shared/**` but with the
      four named CJS files; one `src/shared/**` module block (node
      globals + house rule carried, `ignores` on the four CJS files);
      `npx eslint --print-config src/shared/automation-dev.js` reports
      `sourceType: "commonjs"` (the parse-guard proof — verified for all
      four CJS files; burner.js spot-checked `"module"`); renderer block's
      injected globals reduced to exactly `menuController` + `focusItem`;
      controller override intact; `npm run lint` green with ZERO
      unused-disable warnings
- [x] Both nets repurposed per Context: vm import + replay + transitional
      guards gone; tag parsing + count guards kept; jars
      existence-resolution kept; the permanent DD3 pin and the
      all-shared-tags-are-module pin sweep ALL `src/renderer/**/*.html`
      self-derived (FD ruling — menu-overlay.html's classic
      menu-controller.js is the live DD3 case); headers rewritten; suite
      green at exactly 1284 (nets contribute 7: chrome 3 + jars 4)
- [x] CLAUDE.md DD10(b) body replaced with the pointer (no new full
      checklist); no other CLAUDE.md change
- [x] `scripts/a11y-audit.mjs:336-338` comment names the seam; no
      behavioral change to the audit script (comment-only diff; audit ran
      green after the edit)
- [x] The three behavior specs' rationale wording updated (calls
      unchanged)
- [x] NO change to: any `src/` runtime file, any preload, the four
      CJS shared modules, `menu-controller.js`, `find-overlay.js`
      (diff footprint verified — leg touched only the 9 allowed files
      + artifacts)
- [x] Suite green (1284/1284 @ ~954ms), typecheck green, lint green
- [x] `npm run a11y` green — "No NEW violations", all ten states driven
      through the seam; boot-log error scan 0 hits (flight-log Leg 6
      entry)

## Verification Steps

- `npm test && npm run typecheck && npm run lint && npm run a11y`
- `node --test` isolation on both repurposed nets
- `grep -n "declare " src/renderer/renderer-globals.d.ts` — returns
  exactly 2 lines (`menuController`, `focusItem`; the kept bridge/window
  section is all `interface`, zero `declare` lines — expected)
- `git diff --stat` — this leg adds exactly: the d.ts, eslint config,
  both net files, CLAUDE.md, `scripts/a11y-audit.mjs`, the three spec
  files on top of legs 1-5 (+ artifact files); the flight's
  strongly-net-negative delta check uses
  `git diff --stat -- . ':!missions' ':!BACKLOG.md'` (design-review
  measure: 437+/686− = net −249; the raw stat is positive only because
  the flight log grew)

## Implementation Guidance

1. **d.ts first** (typecheck arbitrates typedef references), then
   eslint, then nets, then docs — each gated by its check.
2. For the nets, write the contract tests fresh against the CURRENT
   documents rather than editing around the replay corpse — the files
   keep their names and their self-derived-from-HTML discipline (no
   hand-maintained lists).
3. CLAUDE.md: keep the DD10(b) heading (other docs reference the name);
   replace the body paragraphs only.
4. Run `npm run a11y` LAST (it boots the app; kill stale instances
   first, shut down after — leg 4/5 hygiene).

## Edge Cases

- **`countNewer`/`activeLogOf` declares**: delete both — `countNewer`
  has no page call site (leg 3 finding) and `activeLogOf` no longer
  exists anywhere (renamed at leg 5); if typecheck complains, a missed
  consumer exists — investigate, don't re-declare.
- **The nets' "self-derived" discipline is the load-bearing property** —
  the new pins must still parse the real HTML, not assert hardcoded tag
  lists.
- **a11y audit failures**: the audit drove the seam green in leg 5's
  probe; a failure here means THIS leg broke tooling (likely the
  a11y-audit comment edit went beyond a comment) — fix, don't waive.
- **d.ts deletion order**: delete in blocks with a typecheck run between
  (the file is 495 lines; a single mega-edit that breaks typecheck is
  hard to bisect).

## Files Affected

- `src/renderer/renderer-globals.d.ts` — shared declares out (206
  lines, 495 → 289)
- `eslint.config.mjs` — consolidation
- `test/unit/chrome-shared-scripts.test.js`,
  `test/unit/jars-page-shared-scripts.test.js` — repurpose
- `CLAUDE.md` — DD10(b) pointer
- `scripts/a11y-audit.mjs` — comment
- `tests/behavior/popup-jar-inheritance.md`, `jar-data-controls.md`,
  `farbling-correctness.md` — rationale wording

---

## Post-Completion Checklist

**Complete ALL steps before finishing (commit is deferred to end of
flight):**

- [x] All acceptance criteria verified (`npm run a11y` included)
- [x] Tests passing (1284/1284)
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed`
- [x] Check off this leg in flight.md AND CP3 AND the
      Contributing-to-Criteria checkbox (all three CPs now met)

## Citation Audit

Verified at leg design time against the working tree (legs 1-5 landed,
uncommitted): d.ts structure — shared declares `:256-262` (url-safety),
`:268` (keydownToAction), menu-controller block `:289-322`
(`menuController` `:313`, `focusItem` `:322`), shared block `:324-495`
(`isSafeColor` `:330` … `pageList` `:490`), file 495 lines OK;
`eslint.config.mjs:10-11` (base incl. src/shared/**), `:20-37` (15-file
module override), `:62-63` (menu-controller block), `:66+` (renderer
block), `:81-87` (controller override) OK; `CLAUDE.md:69` (DD10(b)
checklist heading) OK; `scripts/a11y-audit.mjs:336-338` (stale comment,
leg-5 review) OK; behavior-spec stale-rationale sites (leg-5 review:
popup-jar-inheritance.md:45, jar-data-controls.md:55,
farbling-correctness.md:26) OK — carried from the leg-5 design review's
verified sweep (jar-data-controls.md:55 is the bare recipe, no stale
sentence — attribution added, not replaced); jars net
existence-resolution at `:71-77` (resolveScriptFile) / `:97-101` (test)
OK (corrected from ":50-56" per design review);
`menu-overlay.html:31` (classic menu-controller.js defer — the live DD3
case) OK. 15 citations, all OK.
