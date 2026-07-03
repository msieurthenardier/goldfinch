# Leg: cutover-retire-freeze

**Status**: completed
**Flight**: [Menu Overlay Sheet](../flight.md)

## Objective

Make the sheet the ONLY menu mechanism and delete the freeze-frame apparatus wholesale: remove
the `GOLDFINCH_MENU_OVERLAY_DEV` gate (sheet path unconditional), delete
`freezeGuest`/`unfreezeGuest`/`guestFrozen`/`capture-active-guest`, the five chrome-DOM menu
surfaces + the chrome new-container dialog (DOM/CSS/registrations/positioners), stop loading
`menu-controller.js` in chrome, extend `scripts/a11y-audit.mjs` with sheet-target menu states
(DD6), and delete the probe badge. **CP4**: no freeze references remain (grep-verified),
unit/typecheck/lint green, a11y green including the new sheet-target states. Spec/docs
dispositions (DD11 re-authoring, CLAUDE.md bundles) are **Leg 5b** — this leg is code only.

## Context

- **Split (pre-authorized flight variation)**: the DD11 inventory grew across Legs 3–4; this
  leg is the code cutover, `05b-specs-and-docs` executes the artifact dispositions. Split point
  per the flight's "Acceptable variations".
- **Flip = gate removal, not new wiring**: since Leg 4, gate-ON is full behavior. Cutover
  deletes `MENU_OVERLAY_DEV` (`src/main/main.js` — 4 references), the `menuOverlayDev` preload
  flag + renderer reads (2 each), and every gate-OFF branch — the sheet path becomes the only
  path. The `?probe=1` badge machinery (query in `createSheetView`, `#probe-badge` in the sheet
  page) is deleted with the gate (Leg-1 Workaround Log).
- **Freeze deletion inventory (code)** — current references (27 across renderer.js / main.js /
  chrome-preload.js; re-grep at implementation, lines shift):
  - `src/renderer/renderer.js`: `freezeGuest` / `unfreezeGuest` definitions (state flag
    `guestFrozen`, `#webviews` background-still painting), the `guestFrozen` early-return in
    `sendActiveBounds` + the `onTriggerSendBounds` no-op guard, all call sites (they live
    inside the old menu entries being deleted).
  - `src/main/main.js`: `ipcMain.handle('capture-active-guest')` and its comment block. The
    guest `context-menu` FORWARDER (`main.js:1036-1048`) STAYS — its comment names
    `freezeGuest`/`captureActiveGuest` and gets a re-comment, not deletion.
  - `src/preload/chrome-preload.js`: `captureActiveGuest` bridge (+ its comment framing at
    `:84-85`/`:115-118`). Stale freeze PROSE that survives the symbol grep — `styles.css`
    `#webviews` freeze-swap comment (~`:536-538`), renderer "freeze-frame approach" comments,
    `main.js:2063`-area framing — re-comment in the same pass (AC1's grep is symbols-only;
    prose is cheap to fix now rather than defer).
  - **Do NOT delete the overlay touches in `tab-hide`/`tab-set-active`** — dual-purpose
    (flight design-review): re-comment only, deleting the freeze *framing* from comments.
- **Chrome menu DOM/CSS/code deletion inventory** (accumulated in flight-log DD11 bookkeeping,
  Legs 3–4):
  - `index.html`: `#kebab-menu`, `#container-menu`, `#site-info-popup`, `#page-context-menu`
    nodes, `#new-container-dialog` block, and the chrome `<script src="menu-controller.js">`
    tag (`index.html:212`) — the sheet keeps ITS copy (`menu-overlay.html:23`); the FILE is
    unchanged and stays (dual-export; its global listeners now serve only the sheet document —
    exactly DD4's "retire chrome-side globals" by unload, not edit).
  - `styles.css`: the menu/dialog CSS regions (`.cm-item`/`#kebab-menu`/`#container-menu`/
    `#site-info-popup`/`#page-context-menu`/`.new-container-dialog` blocks — locate by
    selector, not stale line ranges).
  - `renderer.js`: old entries (`kebabEntry`/`containerEntry`/`siteInfoEntry`/
    `pageContextEntry` registrations + their `onOpen`/`onClose`/`closeX` wrappers +
    positioners `positionKebabMenu`/`positionSiteInfoPopup`/`positionPageContextMenu` + the
    offset translation + the `queueMicrotask` defer + `buildPageContextSections` +
    `buildSiteInfo`'s DOM renderer (the pure `deriveSiteInfo` STAYS — it feeds the sheet
    model) + `initNewContainerDialog` + old container-menu innerHTML builder + gate-OFF
    branches in all trigger handlers/subscriptions/audit hook + `els.*` references to deleted
    nodes.
  - **One gate-ON survivor must ALSO be deleted** (design-review catch): `openOverlayMenu`
    calls `menuController.closeAll()` (`renderer.js:333`) — parallel-run mutual exclusion
    with the old chrome menus; with the script tag removed it throws `ReferenceError` on
    every open. Delete the call (+ its comment) — sheet-side exclusion is main's
    model-replace.
  - **eslint/d.ts globals STAY** (design-review correction): the renderer globals block
    (`eslint.config.mjs:45`) matches ALL of `src/renderer/**/*.js` including
    `menu-overlay.js`, which uses `menuController`/`focusItem` heavily — removing them breaks
    lint; same for their `renderer-globals.d.ts` declarations (`checkJs` covers the sheet
    page). The d.ts/preload cleanup is limited to `captureActiveGuest`, `menuOverlayDev`,
    and freeze framing in comments. Removing the chrome script tag orphans NO eslint config
    (the `menu-controller.js` block is file-glob-based; the file survives for the sheet).
- **`menu-controller.test.js` disposition (DD4/DD11 — code-adjacent, so THIS leg)**: the module
  file is unchanged and now exercised by the sheet document only. Contract tests (roving,
  Escape/Tab, trigger-keydown, mutual exclusion) remain valid — keep. Tests/comments that
  frame the global pointerdown/blur listeners as CHROME dismissal behavior: re-frame
  comments/names to the sheet context (the rename-not-delete rule); no assertion inversions
  expected (the file's behavior is identical — verify, and if an assertion truly pins
  chrome-only behavior, invert/rename per the leg-skill test-audit rule and record it).
- **DD6 a11y extension**: `scripts/a11y-audit.mjs` currently audits chrome states incl. a
  `page-context-menu` state driven via the audit hook (`a11y-audit.mjs:322` —
  `runAxe(client, wcId, axeSource, 'page-context-menu')` against the CHROME wcId). Post-cutover
  menus live in the sheet: the audit gains **sheet-target states** — open each surface from
  chrome via `evaluate` (kebab, container, site-info, new-container dialog, page-context via
  the audit hook), discover the sheet's wcId (probed id-space walk, the F7 technique; add a
  deliberate discovery hook ONLY if probing proves brittle in-script), `runAxe` against the
  sheet wcId per state, then dismiss between states — **dismissal must be SHEET-SIDE**
  (Escape via `evaluate` on the sheet wcId, or `pressKey` Escape to it — Escape is not in the
  DD13 forward set and keydown delivery to the sheet is proven): a chrome-side
  `menuOverlayClose` would leave the sheet DOM rendered (the deliberate persist-after-
  main-close design, Leg-2 log) and break the DOM-closed check. The old chrome
  `page-context-menu` state re-targets the sheet. Chrome base states unchanged.
  **Baseline discipline (design-review)**: the audit gates via the hand-curated `ACCEPTED`
  allowlist (`a11y-audit.mjs:117-134`); the sheet's bare document will near-certainly fire
  `region`-class findings per state (the chrome precedent: the old open-menu state needed a
  state-scoped `region` exception at `:125`). Handle these via **curated, state-scoped
  ACCEPTED additions** (reviewed in the diff, never auto-dumped — the script's own rule);
  retire/re-point the now-orphaned chrome `#page-context-menu` entry; note the state-unscoped
  `landmark-one-main`/`page-has-heading-one` `html` entries will match the sheet document
  too (deliberate). Fix in MARKUP only genuine semantics violations. (Operator answer folded
  in: curated additions are sanctioned — CP4's "a11y green" means the gated run passes with a
  reviewed baseline, chrome precedent; a landmark wrapper in the sheet doc is optional if
  trivial, not required.) The sheet was built clean (lang/title/roles verified at review) —
  region/landmark is the expected class.
- **What must keep passing untouched**: manager/protocol/close-family unit suites, sheet
  templates, DD13 forwarding, DD8 resolver tests, `deriveSiteInfo`/`pageContextModel`/
  `sheet-accelerator`/`safe-color`/`menu-overlay-value` suites, find-overlay suite, and the
  full remaining unit corpus (1042 tests pre-leg; deletions will remove none of these — only
  chrome-side dead code).
- **Behavior-spec re-authoring is NOT this leg** (Leg 5b): `internal-tab-menus.md`,
  `tab-surface-geometry.md`, `menu-dismissal.md`, `kebab-menu.md`, `page-context-menu.md`,
  `find-overlay-geometry.md` step-6 reframe + F7 errata, CLAUDE.md menu/freeze architecture +
  F7 pattern bundle, docs/mcp-automation.md if the audit story changed.

## Inputs

- Legs 1–4 landed (uncommitted): all five surfaces on the sheet gate-ON at CP3-complete;
  DD11 code inventory recorded in the flight log (Legs 3–4 entries).
- Fresh grep counts at design time: `MENU_OVERLAY_DEV|menuOverlayDev` — main.js 4,
  renderer.js 2, chrome-preload.js 2; freeze family — 27 refs across the three files;
  `menu-controller.js` loaded by `index.html:212` (chrome) + `menu-overlay.html:23` (sheet).
- `scripts/a11y-audit.mjs`: `runAxe(client, wcId, axeSource, stateLabel)` (`:194`), existing
  states incl. `page-context-menu` (`:322`), wcId-parameterized throughout (DD6 premise,
  verified at flight planning).
- Apparatus: as prior legs (free-port + SDK client; litmus; canary). The a11y audit runs via
  `npm run a11y` against a dev:automation instance (see the script's header for its own
  apparatus expectations, incl. the fixture server — `a11y-audit.mjs:42-43`).

## Outputs

- Modified: `src/renderer/renderer.js` (large deletion + unconditional sheet paths),
  `src/renderer/index.html` (menu DOM + script-tag removal), `src/renderer/styles.css` (menu
  CSS removal), `src/main/main.js` (gate + capture-active-guest removal),
  `src/preload/chrome-preload.js` (flag + captureActiveGuest removal),
  `src/renderer/menu-overlay.{html,js,css}` (probe-badge removal),
  `src/renderer/renderer-globals.d.ts` (deleted-symbol cleanup), `eslint.config.mjs`
  (renderer globals cleanup if applicable), `scripts/a11y-audit.mjs` (sheet-target states),
  `test/unit/menu-controller.test.js` (re-framing only, unless a true chrome-only pin
  surfaces).
- Behavior: menus work identically with NO env vars; freeze-frame gone; a11y audits the
  sheet's menu states.

## Acceptance Criteria

- [x] **AC1 — Source absence (CP4 grep gate).**
  `grep -rn "freezeGuest\|unfreezeGuest\|guestFrozen\|capture-active-guest\|captureActiveGuest" src/ scripts/`
  → zero matches; `grep -rn "MENU_OVERLAY_DEV\|menuOverlayDev\|probe-badge\|probe=1" src/` →
  zero matches. (tests/ and mission artifacts may still reference them — Leg 5b's domain.)
- [x] **AC2 — All five surfaces work with no env gate.** Plain `npm run dev:automation` launch
  (no `GOLDFINCH_MENU_OVERLAY_DEV`): kebab, container (+ new-container dialog), site-info,
  page context (right-click + audit hook), toolbar-unpin — all open from the sheet over the
  LIVE guest (pixels: ticking fixture visible under an open menu — the anti-freeze property,
  now the only path), dismiss correctly (Escape/outside-click), focus-return per the reason
  maps.
- [x] **AC3 — Chrome DOM is menu-free.** `readDom(chromeWcId)` contains none of the five menu
  nodes nor the dialog; `index.html` no longer loads `menu-controller.js`; the sheet still
  does; no dangling `els.*` lookups (typecheck + a startup console free of null-deref
  warnings).
- [x] **AC4 — Freeze-era dual-purpose touches preserved.** `tab-hide`'s `hideFindOverlay()` +
  sheet-hide and `tab-set-active`'s re-adds remain (re-commented without freeze framing);
  find-overlay behavior intact (open find → switch tab → restore semantics unchanged);
  DD5 hide/restore under menus unchanged (it rides `closeMenuOverlay`, not the freeze).
- [x] **AC5 — a11y audit extended and green (CP4 gate).** `npm run a11y` audits the sheet's
  wcId for each menu state (kebab / container / site-info / new-container dialog /
  page-context full-section) plus the existing chrome states, and passes. The audit's
  page-context state targets the sheet, not chrome.
- [x] **AC6 — Unit corpus intact + dispositions.** `npm test` green with NO deletions from the
  1042 pre-leg tests except any `menu-controller.test.js` re-frames (recorded); typecheck +
  lint green (deleted globals cleaned from `.d.ts`/eslint config).
- [x] **AC7 — No behavioral regressions on the shared paths.** Spot-checks: DD13 accelerators
  (Ctrl+W under menu; Ctrl+= zoom; Ctrl+F menu-close→find); mutual exclusion swaps; dialog
  create round-trip; internal-tab kebab (DD7). All on the ungated build.

## Verification Steps

- AC1: the greps, verbatim.
- AC2/AC7: apparatus preamble (litmus + canary), then the surface sweep on the ungated
  instance — one grab per surface over the ticking fixture + dismissal/focus spot-checks
  (evidence under `/tmp/behavior-tests/goldfinch/menu-overlay-cp4/<ts>/`).
- AC3: `readDom(chromeWcId)` + grep `index.html`; launch console scan.
- AC4: find open → tab switch → back (restore with text); find open → kebab open/close
  (DD5 hide/restore) — pixels.
- AC5: `npm run a11y` (with its documented apparatus); confirm the report lists the new
  sheet-state labels and exits green.
- AC6: `npm test && npm run typecheck && npm run lint`; diff review of
  `menu-controller.test.js` changes (re-frames only).

## Implementation Guidance

1. **Order the deletion for reviewability**: (a) gate removal (make sheet paths
   unconditional, delete env reads + preload flag + probe machinery); (b) chrome menu code
   deletion (renderer entries/builders/positioners/dialog init + DOM + CSS + script tag);
   (c) freeze family deletion (renderer defs + guards, main handler, preload bridge) with the
   dual-purpose re-comments; (d) `.d.ts`/eslint cleanup; (e) a11y extension; (f) test
   re-frames. Run gates between (d) and (e).
2. **Grep-driven, not line-driven**: every inventory item above is located by symbol/selector
   at implementation time (four legs have shifted lines repeatedly). The flight-log DD11
   bookkeeping entries (Legs 3–4) are the checklist.
3. **`sendActiveBounds`**: remove the `guestFrozen` early-return and its comment; the
   surrounding rAF-debounce logic stays byte-identical. Same for the `onTriggerSendBounds`
   guard.
4. **a11y states**: follow the script's existing state pattern (`:270-322`; rewrite the
   state-6 comment block `:310-319` — it describes the retired chrome menu) — for each menu
   state: `evaluate` on chrome to open (trigger clicks for kebab/container/site-info; the
   audit hook for page-context; **new-container has NO chrome-side trigger** — open the
   container menu, then `evaluate` on the SHEET wcId clicking the "+ New container…" item via
   `document.activeElement.click()` after ArrowDown-ing to it, the Leg-3 workaround — or
   sanction an `evaluate`-reachable top-level `openNewContainerOverlay()` once the gate
   unwrap puts it at module scope), settle, discover sheet wcId ONCE per run (probe walk
   AFTER the first open — lazy singleton, wcId stable across states unless crashed; the
   identifying URL is `menu-overlay.html`, no `?probe=1` post-cutover), `runAxe(client,
   sheetWcId, axeSource, 'sheet:<state>')`, dismiss SHEET-SIDE (see Context), verify closed
   before the next state (DOM-closed + settle suffices; the Witnessed spec owns rendered
   authority).
5. **Do not touch**: manager, preloads' channel APIs, sheet templates (beyond badge removal),
   menu-controller.js source, main.js handlers other than the two deletions, find-overlay
   code, `deriveSiteInfo`/`pageContextModel`/shared modules.
6. **`els` map cleanup**: remove deleted-node entries (`kebabMenu`, `containerMenu`,
   `siteInfoPopup`, `pageContextMenu`, dialog elements) and any survivors that reference them.

## Edge Cases

- **`focusItem`/`menuController` still needed chrome-side?** Grep after deletion — expected
  zero chrome-side uses once the `openOverlayMenu` `closeAll()` line goes; if a non-menu
  consumer surfaces (unexpected), keep the script tag and record why instead of forcing the
  removal.
- **`freezeTabWidths`/`widthsFrozen`/`releaseTabWidths` are UNRELATED** (tab-strip width
  freezing, `renderer.js:~1422-1434`) — the AC1 symbol grep is precise; do not over-delete on
  the word "freeze".
- **styles.css shared-rule traps**: `.cm-item:focus-visible` sits inside a multi-selector
  focus-ring rule (~`:264`) — prune the selector from the list, don't delete the rule; a
  second `.cm-dot` block lives in the site-info region (~`:1459`).
- **`menu-controller.test.js` re-frame scope**: no assertion pins chrome dismissal (verified —
  DOM stubs never exercise the global listeners); the pass may normalize stale
  cross-references in the TEST file (e.g. old-flight "leg 5" comments) while the module file
  stays untouched.
- **Chrome-wcId-while-open audit state**: considered and NOT added (base-chrome covers
  trigger semantics; aria-expanded is dynamic state, not new DOM; keeps the state matrix
  small) — recorded FD call.
- **`captureActiveGuest` external consumers**: grep `tests/`/`scripts/` for the bridge name —
  behavior specs referencing it are Leg 5b's re-author list, not blockers; no script should
  call it (verify).
- **a11y sheet-wcId discovery brittleness**: if the probe walk misfires in-script (id drift
  across states), THEN add the deliberate admin-only discovery hook (flight DD6 authorizes
  it at leg design) — smallest viable: an admin-tier-only op or env-gated log line; record
  the choice.
- **Startup with zero menus in chrome**: any code that iterated menu entries (e.g. a global
  Escape handler or resize hook touching `menuController.current`) must be gone with the
  registrations — the AC3 console scan catches stragglers.
- **The `#new-container-dialog` old DOM**: deleting it removes the gate-OFF fallback for a
  known-broken flow — intended (the sheet dialog is the fix; operator ratifies at HAT).

## Files Affected

- `src/renderer/renderer.js`, `src/renderer/index.html`, `src/renderer/styles.css` — deletions
- `src/main/main.js`, `src/preload/chrome-preload.js` — gate + freeze/capture removal
- `src/renderer/menu-overlay.{html,js,css}` — probe badge removal
- `src/renderer/renderer-globals.d.ts`, `eslint.config.mjs` — symbol cleanup
- `scripts/a11y-audit.mjs` — sheet-target menu states
- `test/unit/menu-controller.test.js` — re-framing per disposition

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[HANDOFF:review-needed]`** (batch flight: review + commit
are deferred to flight end — do NOT commit, do NOT set `completed`):

- [x] All acceptance criteria verified (CP4 verdict + evidence paths in the flight log)
- [x] Tests passing (`npm test`, `npm run typecheck`, `npm run lint`, `npm run a11y`)
- [x] Update flight-log.md with leg progress entry (deletion counts, a11y state list, any
  `menu-controller.test.js` re-frames)
- [x] Set this leg's status to `landed` (in this file's header)

---

## Citation Audit

Verified against the post-Leg-4 working tree on `flight/08-menu-overlay-sheet` (2026-07-02):

- Gate/flag counts (`MENU_OVERLAY_DEV|menuOverlayDev`: main.js 4, renderer.js 2,
  chrome-preload.js 2) and freeze-family count (27 refs) — **fresh grep this session**;
  implementation re-greps (grep-driven rule).
- `src/renderer/index.html:212` chrome `menu-controller.js` script tag;
  `src/renderer/menu-overlay.html:23` sheet copy — **OK**
- `scripts/a11y-audit.mjs:194` `runAxe` signature, `:270-322` state pattern incl.
  `page-context-menu` at `:322`, `:42-43` fixture-server note — **OK**
- Deletion inventories: carried from the flight-log DD11 bookkeeping entries (Legs 3–4) and
  the flight's own cutover step (Technical Approach step 5, incl. the re-comment-not-delete
  rule for `tab-hide`/`tab-set-active`) — symbol-form by design, located at implementation.
