# Leg: claude-md-promotions

**Status**: completed
**Flight**: [Doc Promotions](../flight.md)

## Objective

Land the four CLAUDE.md pattern promotions (uniform focus rule, `action:rowId`
confirm-transition key, the DD1 shared-module story rewrite, MockTimers recipe)
plus the sanctioned comment-only seam-tag fix in `src/renderer/renderer.js`,
gated by a full-file consistency sweep (CP1).

## Context

- **DD1 (flight.md)**: edit 3 is a full rewrite of the shared-module story, not
  just the DD10(b) checklist — recon confirmed the stale surface spans two
  sections plus stray attributions. Consistency is gated by a full-file sweep,
  not section spot-checks.
- **Flight sequencing**: this flight runs last in the mission deliberately so
  the docs describe the post-ESM tree (Flight 2 landed, PR #71 merged).
- **Design review (flight log, 2026-07-11)**: two accuracy guards are REQUIRED —
  preserve the still-true `guest-forward-allowlist.js` "main-side-only, plain
  CJS" sentence, and fix the seam's `openContainerOverlay` consumer tag
  (comment-only `src/` edit, sanctioned in flight.md Verification).
- All content sources are verified-live (recon report in flight-log.md); the
  factual claims below were re-verified against the tree at leg design time
  (see Citation Audit).

## Inputs

- `CLAUDE.md` at its post-Flight-2 state (267 lines; anchors verified — see
  Citation Audit)
- Source artifacts for content:
  - M06 F4 `flight.md` DD6 (uniform focus rule) —
    `missions/06-cookie-jar-management/flights/04-per-jar-data-controls/flight.md:152-170`
  - M06 F4 leg 3 cycle-2 amendment (a) (`action:rowId` key) —
    `missions/06-cookie-jar-management/flights/04-per-jar-data-controls/legs/03-data-controls-ui.md:70-81`
  - M07 F2 flight-debrief `### Documentation` + Recommendations 1 (rewrite scope)
  - M07 F1 flight-debrief `### Documentation` (MockTimers recipe)
- `src/renderer/renderer.js` seam block (tail of file, comment-delimited,
  18 entries)
- `eslint.config.mjs` CJS-by-design carve-out comments (the parse-guard story)

## Outputs

- `CLAUDE.md` — four edits + rewrite, internally consistent with the tree
- `src/renderer/renderer.js` — comment-only consumer-tag fix in the seam block
  (the ONLY `src/` change in this leg)
- `flight-log.md` — leg entry + the recon-item-5 note (behavior-test
  AUTHORING.md pointer already satisfied mission-control-side; no goldfinch
  action)

## Acceptance Criteria

- [x] **AC1 — Uniform focus rule** appended to `### Cross-view focus +
      tab-type idioms` (CLAUDE.md:200) as a third convention: any DOM container
      currently holding `document.activeElement` is patched in place, never
      rebuilt — applies uniformly (name inputs, swatch grids, nav) on every
      broadcast-rendered page; a rebuild that replaces the focused element
      loses the caret and fires blur → spurious commit. Source-attributed:
      M06 F4 DD6 (name-input case) + the F4 leg-2 design-review FD ruling
      (generalization to swatch grids/nav —
      `missions/06-cookie-jar-management/flights/04-per-jar-data-controls/legs/02-page-relayout.md:174-178`).
- [x] **AC2 — `action:rowId` confirm-transition key** as a new short
      subsection near the focus idioms: a shared confirm area serving N
      sibling-visible actions keys its open/swap transition on the
      `(action, rowId)` string pair, never a boolean — a boolean silently
      breaks the same-row action swap (cookies→wipe on one row would skip the
      rebuild and keep stale copy/handlers). Source-attributed (M06 F4 leg 3
      design review).
- [x] **AC3 — Shared-module story rewritten (DD1)**, covering ALL of:
      - `### src/shared/ dual-export predicate` (:38-51) replaced by the ESM
        pattern: real `import`/`export` with explicit `.js` extensions;
        pages load via `<script type="module">`; the chrome (`file://`)
        imports disk-relative specifiers (`../shared/url-safety.js`), internal
        pages import **flat** specifiers (`./safe-color.js`) per the
        `INTERNAL_PAGES` flat map — disk-true specifiers 404 at boot (the
        flat-served import rule, with the `@ts-ignore` serving-path caveat).
      - The dual-export half of `### Recurring module shapes` (:62-76)
        rewritten: second bullet becomes ESM pure decision modules; the
        `guest-forward-allowlist.js` "main-side-only, plain CJS" sentence
        (:67) PRESERVED, reframed under CJS-by-design; the vm-replay
        "current exemplars" sentence (:74) updated — `chrome-shared-scripts.test.js`
        / `jars-page-shared-scripts.test.js` are **script-tag contract tests**
        since F2 leg 6 (tag-count guard, DD3 defer/module pin), not
        collision nets.
      - **PRELOAD-REACHABLE constraint + eslint parse-guard pair**: the four
        CJS-by-design files (`automation-dev.js` + `internal-page.js`
        preload-reachable — renderer-side preload `require` has no
        require(esm); `dev-profile.js` + `guest-forward-allowlist.js` by
        zero-benefit ruling); they bind `commonjs` in `eslint.config.mjs` and
        the `src/shared/**` module block's `ignores` entry is LOAD-BEARING
        (later-wins would re-bind them to module and delete the parse guard —
        an `export` in a preload-reachable file must FAIL lint).
      - **Renderer evaluate-seam closed-set rule**: module scope hides
        top-level functions from `evaluate`; the explicit
        `Object.assign(globalThis, {…})` seam at the tail of `renderer.js`
        republishes exactly the FD-approved 18-entry set, consumer-tagged
        (dogfooding / behavior-spec / a11y-audit); CLOSED SET — growing it
        requires an FD ruling.
      - **DD3-as-permanent**: the all-documents defer/module pin (every
        classic `<script>` on a module-loading page carries `defer`) is now
        the permanent rule, contract-tested in the script-tag contract tests.
      - **DD10(b) checklist rewrite** (:69): the pointer paragraph replaced by
        a real post-ESM onboarding checklist — retired items (dual-export
        tail, the shared-module ambient declares in `renderer-globals.d.ts` —
        the file itself survives with its `menu-controller`/bridge declares,
        eslint shared-globals entries) OUT; still-live items (page `<script type="module">` tag,
        `INTERNAL_PAGES` pathname→file entry for internal-page subresources)
        IN; ADD the **preload-bridge declare rule** — bridge methods are
        contextBridge surface, not shared modules, so ESM does NOT retire
        their type declares.
      - **Stray attribution fixes**: :142 `page-context-model.js` and :150
        `sheet-accelerator.js` no longer described as "dual-export" (both are
        ESM since F2).
- [x] **AC4 — MockTimers recipe** landed as a testing-patterns note (new short
      subsection under Patterns, near the Grep-AC convention): per-test
      `t.mock.timers.enable({ apis: [...] })`, never file-global; drain with
      real `setImmediate` around single-step ticks; never one big tick.
      Exemplar: `test/unit/automation-find.test.js`. Source-attributed
      (M07 F1 debrief).
- [x] **AC5 — Seam consumer-tag fix** (`src/renderer/renderer.js`):
      `openContainerOverlay` in the seam block is currently tagged under
      `// dogfooding` only, but `scripts/a11y-audit.mjs` also drives it via
      the `SHEET_STATES` `sheet:container` entry (`open: 'openContainerOverlay(0)'`).
      Fix the comment to reflect both consumers. **Comment-only** — no code
      change, no entry moved, and this is the leg's ONLY `src/` diff.
- [x] **AC6 — CP1 consistency sweep clean** (grep-AC convention): grep
      CLAUDE.md for `dual-export`, `typeof module`, `vm-replay` / `replay net`
      / `replay-net`, eslint shared-globals block mentions, and
      `renderer-globals.d.ts` shared-global mentions. Every hit individually
      judged exempt-or-real; the only acceptable survivors are deliberate
      historical framing (e.g. "the retired dual-export world" in a
      what-changed sentence). No section may still DESCRIBE the retired world
      as current.
- [x] **AC7 — Gates green**: `npm test`, `npm run typecheck`, `npm run lint`
      all pass (no `npm run a11y` — no UI change).
- [x] **AC8 — Flight log updated**: leg entry with changes summary + the
      recon-item-5 note ("behavior-test AUTHORING.md pointer verification
      satisfied mission-control-side; no goldfinch-side action").

## Verification Steps

- AC1/AC2/AC4: read the new sections; confirm each is source-attributed and
  placed per the criterion (AC1 inside the existing `### Cross-view focus +
  tab-type idioms`; AC2 its own nearby subsection; AC4 near the Grep-AC
  convention).
- AC3: read the rewritten sections top to bottom against the bullet list;
  specifically confirm (a) the `guest-forward-allowlist.js` sentence survives,
  (b) the checklist names the preload-bridge declare rule, (c) the flat-served
  vs disk-relative specifier split is stated for internal pages vs chrome.
- AC5: `git diff src/` shows exactly one hunk, in the seam block comments of
  `src/renderer/renderer.js`; `node -e` not needed — comment-only.
- AC6: run the sweep greps verbatim and record each hit + judgment in the
  flight log (or leg completion notes):
  `grep -n -i 'dual-export\|typeof module\|vm-replay\|replay net\|replay-net\|shared-globals\|renderer-globals' CLAUDE.md`
- AC7: `npm test && npm run typecheck && npm run lint` (use a timeout; suite
  is ~1s post-F1).
- AC8: read flight-log.md.

## Implementation Guidance

1. **Read the sources first**: M06 F4 DD6 (flight.md:152-170) and leg 3
   cycle-2 amendments (legs/03-data-controls-ui.md:70-81); M07 F1 debrief
   Documentation section; M07 F2 debrief Documentation + Deviations table
   (the 18-entry-seam and eslint-ignores rows carry exact framing worth
   reusing). Write CLAUDE.md content in CLAUDE.md's own voice — dense,
   bold-fronted pattern statements with file anchors — not debrief prose.
2. **Edit order**: do the AC3 rewrite first (it moves the most text and may
   shift line numbers), then AC1/AC2/AC4 insertions, then AC5, then the AC6
   sweep last.
3. **AC3 mechanics**: the two sections to rewrite are `### src/shared/
   dual-export predicate` (whole section, including the code block —
   replace with a short ESM example, e.g. `url-safety.js`'s
   `export function isSafeTabUrl…` + the renderer's
   `import { isSafeTabUrl } from '../shared/url-safety.js'`) and the second
   bullet + trailing paragraphs of `### Recurring module shapes`. Retitle
   both sections to match their new content (Acceptable variation per
   flight.md). Defect class 2 in the :71-75 paragraph ("Classic-`<script>`
   shared top-level lexical-scope collision") must be reframed: the
   collision class is structurally gone for `src/shared/` (modules have
   their own scope); the surviving residue is `menu-controller.js`, the
   one remaining classic script (DD6 carve-out), and the contract tests
   now pin script-tag shape (defer/module), not collision avoidance.
4. **Keep accurate content adjacent to stale framing** (design-review
   guard): do not over-delete. The `mkdirSync`-before-persist defect class
   (:73) is still true and stays; only the collision-class half changes.
5. **AC5**: in the seam block, change the `openContainerOverlay` line's
   grouping comment — it currently sits under `// dogfooding (flight
   live-boot procedures, docs/mcp-automation.md)`; annotate it as
   dual-consumer (dogfooding + a11y-audit `sheet:container`) rather than
   relocating the entry (relocation would churn the a11y-audit grouping
   claim; an inline trailing comment is the minimal fix).
6. **Flight log**: append the leg entry under `## Leg Progress` and the
   recon-item-5 note under Session Notes (or the leg entry's Notes — agent's
   choice per ARTIFACTS.md flight-log format).

## Edge Cases

- **Sweep hits in sanctioned historical sentences**: the rewrite itself will
  likely say "the retired dual-export pattern" once — that is an exempt hit;
  record the judgment, don't contort the prose to dodge the grep.
- **Line-number drift inside CLAUDE.md**: the anchors in this leg (:38, :62,
  :67, :69, :74, :142, :150, :200) are pre-edit positions; after the AC3
  rewrite the later anchors shift. Locate by heading/snippet, not by line.
- **Do not touch** `docs/renderer-menu.md`, `docs/mcp-automation.md`, or
  README — the flight scopes the rewrite to CLAUDE.md (plus the one seam
  comment).

## Files Affected

- `CLAUDE.md` — four edits + rewrite (the bulk of the leg)
- `src/renderer/renderer.js` — seam-block comment only
- `missions/07-maintenance/flights/03-doc-promotions/flight-log.md` — leg
  entry + recon-item-5 note

---

## Citation Audit

12 citations verified against current code at leg design time (main @ post-PR-#71, branch `flight/03-doc-promotions`):

- `CLAUDE.md:38 — "### src/shared/ dual-export predicate"` — OK
- `CLAUDE.md:43 — "typeof module !== 'undefined'"` — OK
- `CLAUDE.md:62 — "### Recurring module shapes"` — OK
- `CLAUDE.md:67 — "stays plain CJS — e.g. guest-forward-allowlist.js"` — OK
- `CLAUDE.md:69 — DD10(b) pointer paragraph ("The full checklist rewrite lands with the M07 Flight 3 doc promotions")` — OK
- `CLAUDE.md:74 — "are the current exemplars" (vm-replay nets)` — OK
- `CLAUDE.md:142 — page-context-model.js "dual-export, unit-tested"` — OK
- `CLAUDE.md:150 — sheet-accelerator.js "pure dual-export"` — OK
- `CLAUDE.md:200 — "### Cross-view focus + tab-type idioms"` — OK
- `src/renderer/renderer.js` seam block (tail, `Object.assign(/** @type {any} */ (globalThis), {…})`, 18 entries, `openContainerOverlay` under `// dogfooding`) — OK
- `scripts/a11y-audit.mjs:394-402 — SHEET_STATES` (flight.md cites :395-401; drifted by ~1 line; symbol-cited here, no repair needed in this leg) — drifted (cosmetic)
- `eslint.config.mjs:17/:28-34 — CJS-by-design commonjs block + load-bearing ignores` — OK

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed` (in this file's header) — flight-level
      review/commit is deferred to end of flight per the agentic workflow
- [x] Check off this leg in flight.md
