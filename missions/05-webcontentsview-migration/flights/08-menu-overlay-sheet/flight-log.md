# Flight Log: Menu Overlay Sheet

**Flight**: [Menu Overlay Sheet](flight.md)

## Summary

In flight as of 2026-07-02. Executing on branch `flight/08-menu-overlay-sheet` off
`mission/05-webcontentsview-migration`. Six legs planned. Leg 1 (`01-scaffold-sheet`) landed —
**CP1 transparency probe PASS, DD2 gate cleared.** Leg 2 (`02-menu-protocol-and-kebab`) landed —
**CP2 PASS** (kebab at parity over live guest; protocol + close family + DD5/DD13/DD8 all in;
1006/1006 tests). Leg 3 (`03-container-and-site-info`) landed — **CP3-partial PASS** (container
▾, site-info 🔒, and the new-container dialog all render from the sheet behind the gate; the
dialog-occlusion defect is fixed on the sheet path — pixel-proven; per-template registry +
shared derivations + namespaced ids + channel-4 `value`; 1031/1031 tests). Leg 4
(`04-page-context-and-unpin`) landed — **CP3-COMPLETE PASS**: page context (guest right-click at
1:1 coords, chrome keyboard, toolbar-unpin, gate-aware audit hook) render from the sheet behind
the gate; all five surfaces now on the sheet; old paths intact gate-OFF; pure `pageContextModel`
builder + generalized `overlayMenus` entry shape (ariaTarget/refocus policy) + INDEX-dispatched
spelling with bounds validation; 1042/1042 tests. Leg 5 is split per the flight's
pre-authorized variation (the DD11 inventory ballooned as anticipated):
`05-cutover-retire-freeze` (code cutover) + `05b-specs-and-docs` (DD11 spec/docs
dispositions). Leg 5 (`05-cutover-retire-freeze`) landed — **CP4 PASS**: the sheet is the
ONLY menu mechanism (gate + probe machinery deleted), the freeze-frame apparatus is fully
retired (AC1 greps zero), the five chrome-DOM menu surfaces + chrome dialog are deleted,
`npm run a11y` audits five new sheet states and passes with three curated state-scoped
baseline additions, 1042/1042 tests + typecheck + lint green, 27/27 live sweep checks.
Leg 5b (`05b-specs-and-docs`) landed — all twelve DD11/doc dispositions executed (six specs
re-authored/updated, `menu-overlay.md` reconciled, CLAUDE.md rewritten to the sheet reality +
the F7 Rec-3 pattern section, `docs/renderer-menu.md` refreshed, `docs/mcp-automation.md`
DD8/addressability touched, F7 Rec-3/Rec-4 action items checked off with dated annotations);
AC1/AC4 greps clean; gates re-proven green. Next: Leg 6 (HAT).

---

## Flight Director Notes

### 2026-07-02 — Flight start

- Phase file `.flightops/agent-crews/leg-execution.md` loaded and validated (Crew / Interaction
  Protocol / Prompts sections present).
- Flight status `ready` → `in-flight`; branch `flight/08-menu-overlay-sheet` created off the mission
  branch per the long-running-branch constraint (`main` untouched).
- Execution model: per-leg design + design review, batched implementation, single flight-level code
  review and commit after the last autonomous leg. Leg 6 (`06-hat-and-alignment`) is interactive
  (HAT) — guided with the operator, not spawned autonomously.
- Untracked WSL junk file noted in working tree (`src/renderer/assets/ChatGPT Image ...png:Zone.Identifier`)
  — left untouched, not part of this flight. Design review echoed this: delete/ignore it before the
  flight-end commit so it doesn't ride along.

### 2026-07-02 — Leg 1 (`01-scaffold-sheet`) design + review

- Leg designed against current code; 24 citation groups verified clean (same-day tree as flight
  design — no drift).
- Developer design review (spawned, read-only): **approve with changes** — all citations
  independently re-verified; Ctrl+Shift+M confirmed conflict-free on both capture paths;
  Electron-free manager + injected `createSheetView` confirmed consistent with repo injection
  patterns and `node --test`-able; CP1 probe design (canary → two grabs) confirmed sound.
- Issues incorporated: [medium] dev-mode **focus trap** — once the sheet is shown, page clicks
  focus the sheet and strand an OS-keyboard toggle; fixed by making MCP `pressKey` (guest wcId,
  fires `before-input-event` regardless of OS focus) the canonical stimulus driver + an explicit
  "show() never focuses the sheet" AC2 clause. [low] `warn` dep dropped from the manager (unused
  param would trip lint). [low] null-content-view contract pinned to F7 parity (state-preserving
  no-op) + AC9 test case. [low] capture-path canary now disambiguates "find never opened" from
  "fallback path" before signaling `[BLOCKED:capture-apparatus]`.
- Designer answers to review questions recorded in the artifact: no-focus promoted to AC2;
  null-window = state-preserving no-op; `pressKey` accepted as canonical driver.
- Fixes were targeted spec tightenings, not redesign → second review cycle skipped (FD call).
- Leg status → `ready`.

### 2026-07-02 — Leg 2 (`02-menu-protocol-and-kebab`) design + review round 1

- Leg designed against the post-Leg-1 tree (main.js anchors re-derived fresh — Leg 1 shifted
  them). Locks the four flight-deferred decisions: 300 ms same-menuType suppress window; chrome-
  minted monotonic open-token echoed in channels 4/5/7; idempotent `closeMenuOverlay` in the
  manager (unit-tested); DD13 union set with a pure dual-export mapper + main-side dispatch +
  new `chrome-shortcut-action` channel.
- Developer design review round 1: **approve with changes** — all anchors verified; token +
  idempotency design confirmed to close the double-blur and cross-sender-reorder races. Three
  HIGHs (all in the DD4/DD5 gap class): (1) escape/activated refocus needs **main-side
  `getChromeContents().focus()`** — chrome element focus alone can't move view-level focus off
  the sheet (F7 precedent), and `readDom` activeElement checks would false-pass; (2) DD5
  restore-skip set incomplete — `tab-hide` (and explicitly `tab-close`) must skip restore like
  `tab-switch`, else the Ctrl+T-with-find-live path paints the find bar over a hidden guest;
  plus a `closed`-handler ordering pin (find teardown before `closeMenuOverlay('teardown')`);
  (3) the sheet page's blur-reason attribution can't win a listener-order race with
  menu-controller's own blur→closeAll — fixed by defaulting `lastStimulus='blur'` and resetting
  after every send (unattributed closes = blur flavor), which preserves the suppress-window
  mechanism. Two MEDIUMs: DD13 guest-class dispatch gains the internal-tab
  (`isInternalContents`) guard the original capture got for free; blur dismissal flavor is
  HAT-scoped (scripted focus can't fake OS blur — apparatus limit). Lows: Tab→escape-flavor
  attribution; `dispatchChromeAction(action): boolean` preserves conditional preventDefault.
- Designer answers: `closed`-ordering pinned (no reason-split needed — nulled
  `findOverlayTabWcId` makes teardown-restore a natural no-op); channel 2 gains
  `reason:'toggle'` for trigger re-click (distinct from `'superseded'`, no focus move);
  minimize deliberately NOT in the close family (blur covers it where the platform fires it;
  menu-survives-minimize recorded as accepted variation, HAT observes).
- Sizing (reviewer offered an AC8+AC9 split as acceptable-either-way): kept as ONE leg — the
  protocol/close-family/DD5/kebab core is only verifiable together, and DD8/DD13 are additive,
  independent tail work. If the implementing Developer stalls, the FD will split at exactly
  that boundary (`02b-accelerators-and-hardening`) per the reviewer's recommendation.
- All fixes incorporated → second review cycle spawned (substantive changes; max-2 rule).

### 2026-07-02 — Leg 2 design review round 2 (final)

- Verdict: **approve with changes** — all round-1 fixes verified incorporated; NO new design
  gaps. The reviewer's adversarial probes on the fix interactions all cleared: `toggle` vs
  suppress/token coherent (tokenless channel 2 races resolve via idempotency); `focusChrome` on
  `activated` doesn't fight actions that move focus (channel 7 before channel 6, action wins);
  default-`blur` attribution can't misreport main-initiated closes (stale-token drop covers the
  hidden page's late `dismissed`).
- Round-2 issues (all incorporation-consistency, not design): [high] step-2's
  `restoreFindOverlay` snippet still showed the pre-fix two-reason skip set while
  prose/ACs/tests locked three — snippet corrected (implementers follow snippets); [medium]
  channel-2 `'toggle'` reason threaded into the step-2 handler + step-6 preload signature
  (`menuOverlayClose({reason})`, allowlisted); [low] `focusChrome` added to the step-1 deps
  enumeration (a duplicate enumeration from the edit was also cleaned); [low] step-4 suppress
  wording re-anchored to the re-open branch. Suggestions adopted: Ctrl+F over an internal tab =
  full no-op (menu stays open, symmetric with the guard); new Edge Case records that sheet DOM
  deliberately persists after main-initiated closes (no redundant close channel; flagged for
  the Leg-5 a11y driver).
- FD call: round-2 issues were consistency slips in incorporating already-agreed decisions, not
  new design issues → no third cycle (max-2 rule satisfied; the skill's "re-review once more"
  clause reserved for new HIGH design issues, which round 2 explicitly found none of).
- Leg status → `ready`.

### 2026-07-02 — Leg 3 (`03-container-and-site-info`) design + review round 1

- Operator call on the `#new-container-dialog` (flight Open Question) put to the operator via
  question prompt; no response in the window → FD proceeded with **fix via the sheet** (the
  flight's own parity-plus-correctness option; operator had independently confirmed the defect
  matters). Recorded as pending ratification at the Leg-6 HAT; revert path kept contained.
- Design review round 1: **needs rework** (contained). [high] The specced
  "model-replace / superseded, no hide-re-show" new-container flow contradicted the frozen
  Leg-2 machinery — main closes with `reason:'activated'` BEFORE channel 6, so the re-open is
  necessarily a fresh open. Designer decision: **accept activated-close-then-fresh-open**
  (one-round-trip blink accepted; freeze-era was worse; machinery stays frozen), with a live
  transient-only check and the DD5 find-bar flash on the chained open recorded as an accepted
  cosmetic edge case. [high] AC1/AC2 assumed runtime `jars-add` visibility that doesn't exist
  in the product (one-shot startup seed, no broadcast, no call sites) — ACs retreated to
  parity; seeding via the new dialog itself + an `evaluate` push recipe the reviewer verified.
  [medium] Sheet-side color validation aligned to the product's actual `isSafeColor` domain
  (extracted to `src/shared/`, reused; stricter hex-only rule would have silently broken legal
  colors). [medium] Per-template controller entries made explicit (info-popup/input-dialog
  register WITHOUT items; all dismissal flows through the controller's global listeners;
  attribution state hoists; Tab handling template-conditional) — the single-entry closure
  restructure acknowledged as the leg's largest sheet-side change. [low] Channel-4 value
  validation extracted to a pure unit-testable helper (preload edits are type-only no-ops;
  manager untouched). [low] Whitespace-name guard pinned page-side with trim. [low] One stale
  citation repaired (`containers` seed `:113-119`). Suggestions adopted: `deriveSiteInfo` made
  a mandatory pure unit-tested extraction; chip `aria-expanded` recorded as deliberate
  improvement for the Leg-5 a11y pass; 🔒 trigger-keydown parity added; dialog centers via CSS
  (anchor ignored).
- Needs-rework → round-2 review mandatory.

### 2026-07-02 — Leg 3 design review round 2 (final)

- Verdict: **approve with changes** — all six round-1 resolutions verified faithful and
  code-accurate (activated-close-then-fresh-open matches the real channel-4 handler ordering;
  parity retreat factually grounded; shared `isSafeColor` domain exact; per-template entries
  consistent with the controller's guards). Prompted sanity checks clean: suppress window is
  blur-armed only (dialog's `'activated'` close can't suppress the ▾); Cancel's explicit-send
  pattern already precedented; `src/shared` extraction safe for CommonJS + eslint.
- Round-2 catches, both applied: [medium] **sentinel-id collision** — `jars.slug("New
  Container")` produces id `new-container`, and the new dialog makes that name reachable, so
  flat-id channel-6 dispatch would shadow a real jar → model ids namespaced (`jar:<id>` /
  `action:new-container` / `action:burner`), prefix dispatch, collision unit-covered; [low]
  info-popup Tab pinned to the `'escape'` flavor (unattributed Tab would default `'blur'` and
  silently drop today's chip refocus). Suggestions adopted: jars.js re-export (not move) so
  its test keeps passing; dialog's guest-region-scoped modality recorded as accepted DD12
  variation for the HAT; renderer eslint-globals bookkeeping noted; fallback dot noted as
  dead-code defense-in-depth.
- Two review cycles complete. Leg status → `ready`.

### 2026-07-02 — Leg 4 (`04-page-context-and-unpin`) design + review round 1

- Leg designed against the post-Leg-3 tree (anchors re-derived; renderer.js 3,069 lines).
  Core design: pure `pageContextModel` builder (dual-export, unit-tested), 1:1 guest coords on
  the sheet path (DD2 payoff — offset translation bypassed, deletable at Leg 5), namespaced
  ids with INDEX-dispatched spelling suggestions (guest strings never round-trip as commands),
  four gate-branched invocation modes incl. the gate-aware a11y audit hook.
- Design review round 1: **approve with changes**. Two HIGHs: (1) AC8 asserted an unreachable
  interaction — a guest-region right-click while a sheet menu is open is swallowed by the
  sheet (outside-click dismissal; no `context-menu` event can fire; also parity with the
  frozen-guest era) → AC8/edge cases rewritten to the dismissal contract, supersede coverage
  moved to the audit-hook drive; (2) the naive `returnFocus`-as-trigger registration collided
  with the generic channel-1/7 machinery four ways (aria stamped on address/body/foreign
  triggers; same-menuType-replace stale-close orphaning aria on a CHANGED element;
  activated-refocus contradicting the reason map; open-time getter call destroying a
  clear-on-read target) → fixed via a **generalized `overlayMenus` entry shape**
  (`ariaTarget: () => el|null` — null for page-context — + per-entry reason→refocus policy;
  read-only guarded getter; cleared after use; Leg 5 inherits). Mediums: point-anchor clamp
  must measure AFTER unhide (`display:none` → zero offsets); AC1's positional target moved to
  a new mid-page fixture link (the bottom-left link sits in y-clamp territory and is the
  Leg-6 spec's contract — untouched). Lows: validated-no-op discipline on every dispatch id;
  separator/note type-branch before the id guard + `MENU_LABELS` entry. Suggestions adopted:
  right-click apparatus premise verified at schema level (fallback plan kept primary-ready);
  panel-open Shift+F10 clamp + guest-zoom skew recorded as accepted variations; DD11
  bookkeeping added to the post-completion checklist; two-derivations-until-Leg-5 stated
  plainly. Designer answers: AC8 = dismissal parity (no sheet contextmenu forward); entry
  shape generalized (not special-cased); fixture image = same-origin sibling PNG.
- Substantive changes → round-2 review spawned.

### 2026-07-02 — Leg 4 design review round 2 (final)

- Verdict: **approve with changes** — all six round-1 resolutions verified incorporated and
  grounded (AC8 swallow contract mechanically confirmed: no button filter on the sheet's
  pointerdown dismissal, no contextmenu forward in `createSheetView`; the generalized entry
  shape confirmed renderer-only, no manager/main.js edits; clamp-after-unhide implementable;
  read-only getter + stale-token drop-whole closes both the open-time-destruction and
  cross-open-leak modes). Three lows applied inline: AC3's unpin focus attributed to the
  dispatch body (not the reason map — keeps page-context escape-only); all four gate-ON
  branches must capture `pageCtx` like their gate-OFF bodies; a one-line gate-ON kebab
  Escape-refocus spot-check added (the refactor rewrites lines Legs 2-3 verified live).
  Suggestions adopted: sibling PNG listed as a fixture asset; `MENU_LABELS` literal pinned
  (`'Page actions'`, index.html:54); audit-hook coords pinned to translated-for-determinism.
- Two review cycles complete. Leg status → `ready`.

### 2026-07-02 — Leg 5 (`05-cutover-retire-freeze`) design + review (single cycle)

- FD split executed (pre-authorized flight variation): Leg 5 = code cutover; new Leg 5b =
  DD11 spec/docs dispositions. Rationale: the DD11 inventory grew across Legs 3–4 exactly as
  the flight anticipated.
- Design review: **approve with changes** — zero highs. All citations verified (gate refs
  4/2/2; freeze family 27; a11y script anchors exact). Verified clean by the reviewer:
  `menu-controller.test.js` needs re-framing only (no assertion pins chrome dismissal — DOM
  stubs never exercise the global listeners); no chrome keydown/resize/Escape handler outside
  gate-OFF blocks reads menu state; lightbox gate independent. Four mediums applied, all
  instruction/inventory corrections pre-validated by the reviewer: (1) a11y **ACCEPTED
  baseline discipline** — sheet states will fire region-class findings (chrome precedent at
  `a11y-audit.mjs:125`); curated state-scoped additions sanctioned, markup fixes reserved for
  genuine semantics; (2) eslint/d.ts globals **stay** (menu-overlay.js is in the same
  renderer glob and uses menuController/focusItem — the original cleanup instruction would
  have broken lint); (3) the surviving gate-ON `menuController.closeAll()` in
  `openOverlayMenu` (renderer.js:333) named as a mandatory deletion (would ReferenceError
  post-script-tag removal); (4) the a11y new-container state needs a sheet-side open recipe
  (no chrome trigger exists). Lows: main.js context-menu forwarder + stale freeze PROSE are
  re-comment-not-delete; styles.css shared-rule traps; sheet-side-only dismissal between
  audit states; freezeTabWidths guard note. FD answers: curated ACCEPTED sanctioned for CP4
  "a11y green"; chrome-wcId-while-open state NOT added (recorded); test-file cross-ref
  normalization allowed, module untouched.
- FD call: zero highs, corrections pre-validated → second cycle skipped (Leg-1 precedent).
- Leg status → `ready`.

### 2026-07-02 — Leg 5b (`05b-specs-and-docs`) design + review (single cycle)

- Writing leg: executes the DD11 dispositions + F7 Rec-3/Rec-4 bundles against the post-Leg-5
  tree. Design review: **approve with changes** — zero highs; ground-truth summary verified
  accurate throughout (channels, close family, suppress constant, DD8 guard, a11y states, the
  fixture). Mediums applied: (1) item-12's known-item location corrected (it lives in the F7
  FLIGHT LOG Leg-2 + HAT entries, not the debrief action items; F7's final disposition was
  accepted-as-correct, so the annotation says "mechanism restructured in F8; live behavior
  ratified at Leg-6 HAT" — never "resolved"); (2) CLAUDE.md region list gained both site-info
  bullets (the "Site settings →" ¶ names the deleted `buildSiteInfo`) + the stale
  "only trusted call site" claim, and AC4 gained a negative whole-file deleted-symbol grep
  (live-symbols-only rule; retired-predecessor mentions exempt — designer answer); (3) the
  kebab-menu disposition deepened (step-8 "Settings is inert" INVERTS post-M04; Observables
  count pin; Print modal-trap caution joins the Exit caution). Lows: page-context spec gains
  the Escape-focus-return change + node-identity note; the incidental "freeze" mentions in
  `settings-activity-viewer`/`responsive-tab-strip` are UNRELATED concepts → expected
  no-change (the draft's "update minimally" would have misfired); item-8 aligned with the
  no-code rule (record, don't edit); AC1's prose-vs-table check made mechanical.
- FD call: zero highs, all corrections pre-validated → second cycle skipped.
- Leg status → `ready`.

---

## Leg Progress

### 2026-07-02 — Leg 1 (`01-scaffold-sheet`) — landed

**Changes made:**
- New `src/main/menu-overlay-manager.js` — Electron-free sheet lifecycle manager
  (`createMenuOverlayManager({ getContentView, createSheetView })`): lazy singleton,
  destroyed-recreate guard, `did-finish-load` readiness flag (Leg-2 hook point),
  `render-process-gone` self-teardown, show = add-after-guest + `setVisible(true)` (never
  focuses the sheet — AC2; state-preserving no-op on null content view), hide =
  visibility-gated `removeChildView`, `syncBounds` store-always/apply-while-visible,
  full `teardown`.
- New sheet surface: `src/renderer/menu-overlay.{html,css,js}` (fully transparent document,
  empty `#menu-root`, `?probe=1`-gated `#probe-badge`) + `src/preload/menu-overlay-preload.js`
  (minimal `window.menuOverlay` contextBridge stub; DD4 channels come in Leg 2).
- `src/main/main.js`: `createSheetView()` (chrome-class webPreferences,
  `setBackgroundColor('#00000000')`, probe query only under `GOLDFINCH_MENU_OVERLAY_DEV`),
  manager wiring, Ctrl+Shift+M dev-stimulus branch in the guest `before-input-event`
  (gate + `menuOverlayDevShown` toggle — Workaround Log), touches in `tab-set-active`
  (sync + re-add strictly after guest re-add and find re-assert), `tab-set-bounds`
  (`syncBounds` identity), `tab-hide` / `tab-close` (active-tab hide), window `closed`
  (teardown + toggle reset). Sheet never enters `tabViews` (DD8); no `entry.trusted`
  gating anywhere in the sheet path (DD7).
- New `test/unit/menu-overlay-manager.test.js` (15 tests, fake injected deps — all AC9 cases).
- New `tests/behavior/fixtures/menu-overlay/index.html` (ticking-seconds liveness fixture +
  bottom-left outside-click link, per the Leg-6 spec's step-1/step-3 requirements).
- `eslint.config.mjs`: `menu-overlay-preload.js` added to the chrome-class node-globals block.

**CP1 checkpoint verdict: PASS (on the OS-grab pixel path).**
- Capture-path canary passed first: Ctrl+F via MCP `pressKey` on the guest wcId opened the
  find overlay and the bar is visible in the `captureWindow` pixels
  (`canary-01-find-open.png`) — OS-grab path confirmed (the WSLg fallback cannot composite
  overlay views); this also verified the `pressKey` → `before-input-event` stimulus path.
- Clean probe run (find closed): sheet toggled on over the ticking fixture —
  (a) probe badge visible bottom-right (sheet present, top-of-stack);
  (b) ticking region fully legible through the sheet and differing between two grabs
  ~2 s apart (16:42:03/ticks 158 → 16:42:05/ticks 160) — guest live and visible through
  the transparency, no black/opaque wash, no frozen still;
  (c) guest full-height, no push-down or strip artifacts. Toggle-off grab: badge and sheet
  gone, baseline restored.
- Evidence: `/tmp/behavior-tests/goldfinch/menu-overlay-cp1-probe/20260702T163502/`
  (`canary-01-find-open.png`, `probe-10-baseline-clean.png`, `probe-11-sheet-on-grabA.png`,
  `probe-12-sheet-on-grabB.png`, `probe-13-sheet-off-final.png`; an earlier probe pair with
  the find bar co-visible — `probe-01/02/03` — shows the same result with the find bar
  rendering under the sheet). Geometry/lifecycle evidence: `geo-01-maximized.png`,
  `geo-02-restored.png`, `geo-03-media-panel.png` (sheet coincident with the shrunken guest
  region beside the open panel), `geo-04-internal-tab.png` (sheet above `goldfinch://settings`
  — DD7), `geo-05-back-to-web.png`, `ac7-01/02` (kebab freeze round-trip: sheet hides with
  the frozen guest, restores on unfreeze), `ac7-03` (active-tab close: no residue),
  `ac8-01…06` (no-gate parity sweep).
- **DD2 gate: PASS — the flight proceeds on the full-guest transparent sheet; no divert.**

**Verification summary (per AC):** AC1 pass (above); AC2/AC3 pass (no `require('electron')`
in the manager; sheet construction only in `createSheetView`; no `tabViews` registration);
AC4 pass (files present, transparent, badge query-gated); AC5 pass (maximize / restore /
media-panel toggle all keep the sheet coincident with the guest); AC6 pass (sheet above the
internal settings tab and back over the web guest on switch); AC7 pass (kebab freeze
round-trip, active-tab close; `closed` teardown + crash rebuild covered structurally +
by unit tests); AC8 pass (relaunch without the gate: Ctrl+Shift+M is a no-op AND no sheet
webContents exists at all — probed wcIds absent; kebab / container / site-info /
toolbar-unpin menus behave exactly as today); AC9 pass (15/15); AC10 pass
(`npm test` 969/969, `npm run typecheck`, `npm run lint` all green).

**Notes / anomalies:**
- **Apparatus deviation (recorded):** the harness-configured goldfinch MCP client is pinned
  to port 49152, but the operator's installed Windows Goldfinch.exe holds 127.0.0.1:49152
  (WSL mirrored networking shares the port space), so a dev instance can never bind there
  while it runs. Rather than driving the wrong instance (or blocking), the leg was verified
  by launching on a free port (43117) and driving it over the same loopback MCP transport
  with an SDK client (the `scripts/mcp-example-client.mjs` pattern), authenticated with the
  admin key minted by this instance's own stdout — a strictly stronger instance-identity
  guarantee than the shared-port client. Wiring litmus passed (`getChromeTarget` +
  `enumerateTabs` listed a uniquely-named tab opened by the driver). The operator's
  instance was never touched. Follow-up for the operator: the pinned client port will
  conflict with dev instances whenever the installed build is running.
- The find bar reappeared during the first probe pair: the chrome's per-tab find-state
  restore re-opens the overlay on tab re-activation (existing designed behavior) — the
  "close find via tab switch" shortcut in the run plan was undone by it. Closed properly
  via Escape delivered to the probed find-overlay wcId; clean probe re-run recorded. Not a
  defect; noted for future run plans.
- Port 49152 first appeared bindable from Linux checks (`ss` shows nothing) — the holder
  is only visible via Windows `netstat`. Recorded as rig lore for WSL mirrored networking.

### 2026-07-02 — Leg 2 (`02-menu-protocol-and-kebab`) — landed

**Changes made:**
- `src/main/menu-overlay-manager.js` — grew from lifecycle-only to the DD4 menu-open
  state machine: `openMenu(payload)` (model-replace on open-while-open, superseded
  channel 7 with the OLD token, `hideFindOverlay` hook, pending-init queue latest-wins,
  focus AFTER init), `closeMenuOverlay(reason, token?)` (idempotent, stale-token drop,
  channel 7, `focusChrome()` for escape/activated only, `restoreFindOverlay(reason)`),
  `render-process-gone` now emits the teardown close BEFORE destroying. New injected
  deps: `sendToChrome`/`hideFindOverlay`/`restoreFindOverlay`/`focusChrome`. Still
  Electron-free.
- `src/main/main.js` — channels 1/2/4/5 ipcMain handlers (sender-validated: chrome for
  1/2, the sheet's own webContents for 4/5; channel-7 emitted before channel-6 on
  activation); manager wired with the four deps incl. the DD5 three-reason skip set
  (`tab-switch`/`tab-hide`/`tab-close`) and `focusChrome`; close-family re-point of the
  Leg-1 touches (`tab-close`→`'tab-close'`, `tab-hide`→`'tab-hide'`, `tab-set-active`
  different-tab→`'tab-switch'` / same-tab→`show()`, window `closed`→teardown close
  after `teardownFindOverlayView()` per the DD5 ordering pin); new `mainWindow.on('blur')`
  → `'blur'`; DD13 `before-input-event` forwarding in `createSheetView` (union set via
  the pure mapper, guest-class replicated against the active guest with the
  `isInternalContents` guard + Ctrl+J exempt + Ctrl+F closes-then-opens, chrome-class →
  `chrome-shortcut-action`); Leg-1 stand-ins (`menuOverlayDevShown`, Ctrl+Shift+M
  branch) deleted; `isTabViewWcId: (id) => tabViews.has(id)` threaded into BOTH
  `createEngine` call sites.
- `src/shared/sheet-accelerator.js` (new, dual-export, `// @ts-check`) — pure DD13 mapper
  (`sheetAcceleratorAction` + `isGuestActionAllowed`), table-driven union set,
  autoRepeatGuard flags matching the guest branches (print deliberately unguarded).
- `src/renderer/menu-overlay.{html,css,js}` — sheet page now loads the SHARED
  `menu-controller.js` and renders the menu model under `#menu-root` (role=menu,
  textContent labels — DD8), APG via the shared controller, reason attribution
  (`lastStimulus` default 'blur' + capture-phase escape/Tab→'escape',
  outside-pointerdown→'outside-click'), exactly-one activated/dismissed per token.
- `src/preload/menu-overlay-preload.js` — channels 3/4/5 (`onInit`/`sendActivated`/
  `sendDismissed`); `src/preload/chrome-preload.js` — `menuOverlayDev` flag + channels
  1/2/6/7 + `onChromeShortcutAction`.
- `src/renderer/renderer.js` — kebab split on the gate: gate-OFF keeps today's
  chrome-DOM+freeze path byte-for-byte; gate-ON drives the sheet (model builder,
  chrome→sheet anchor translation with y-clamp, open-token, 300 ms same-menuType
  blur-suppress, reason-resolved refocus map). The four item bodies extracted into
  named `kebabAction*` functions shared by both paths (Exit verified by code-identity —
  never activated live). `dispatchChromeAction(action): boolean` extracted from the
  keydown handler and reused by `onChromeShortcutAction` (conditional preventDefault
  preserved).
- `src/main/automation/resolve.js` + `engine.js` — DD8 `isTabViewWcId` guard
  (`non-tab-contents` throw, admin-exempt via `allowInternal`); the three "SOLE
  relaxation" doc sites updated to name BOTH admin relaxations.
- Types: `src/renderer/renderer-globals.d.ts` grew the menu-overlay bridge; new
  `src/renderer/menu-overlay-globals.d.ts` (sheet-page `window.menuOverlay` shim,
  find-overlay pattern).
- Tests: `test/unit/menu-overlay-manager.test.js` +16 (open/close family, idempotency,
  token staleness, model-replace+superseded, DD5 hook incl. the 3-reason skip,
  focusChrome escape/activated-only, pending-init queue, crash-teardown);
  `test/unit/sheet-accelerator.test.js` (new — full union, APG exclusions, internal
  guard); `test/unit/automation-resolve.test.js` +6 DD8 cases.

**CP2 checkpoint verdict: PASS (on the OS-grab pixel path).**
- Apparatus: gate-ON instance `GOLDFINCH_MENU_OVERLAY_DEV=1 …DEV_MINT=1 …ADMIN=1
  GOLDFINCH_MCP_PORT=43117 npm run dev:automation`, driven over the loopback MCP
  transport via the SDK-client pattern (admin key from this instance's own stdout — the
  recorded port-49152 conflict workaround stands; the operator's Windows Goldfinch was
  never touched). Wiring litmus PASS (`getChromeTarget` wcId 1 + a uniquely-named
  fixture tab in `enumerateTabs`). Capture-path canary PASS (find bar visible in
  `captureWindow` pixels — `01-canary-find-open.png`; OS-grab path confirmed). Sheet
  wcId probed via the id-space walk: `readDom(5)` → `menu-overlay.html?probe=1`.
- **Pixels (anti-freeze):** kebab opened over the LIVE ticking guest; two grabs 3 s
  apart differ under the open menu (`03…grabA` ticks 51 / `04…grabB` ticks 54) — guest
  live & full-height through the transparent sheet, menu right-aligned flush at the top
  edge, SHEET badge present. Contrast gate-OFF: `20-gateoff-kebab-freeze.png` shows the
  static frozen still (guestFrozen=true), the still-image tell.
- **Keyboard contract:** roving tabindex (exactly one item tabIndex 0), ArrowDown/Up
  wrap, Home/End jump, role=menu/menuitem — all corroborated by `readDom(sheetWcId)`.
- Evidence: `/tmp/behavior-tests/goldfinch/menu-overlay-cp2/20260702T182012/`
  (`01`…`13` gate-ON sweep + `20` gate-OFF freeze).

**Per-AC results:**
- AC1 (channel set + sender validation) — PASS: handlers identity-check chrome (1/2) /
  sheet (4/5); token in 1/3/4/5/7; unit-covered.
- AC2 (manager close path) — PASS: single hide path, idempotent, model-replace +
  superseded, openMenu focus-after-init; unit-covered (16 new tests).
- AC3 (close family complete) — PASS live: `tab-switch` (MCP `activateTab`), `tab-close`
  (Ctrl+W), `tab-hide` (freeze cross-mechanism), blur, teardown; unit-covered.
- AC4 (kebab at parity, CP2) — PASS live: click + Enter open channel 1; Settings /
  Downloads / Print all round-trip channel 4→6 and open the right tab / fire print
  (`goldfinch://settings`, `goldfinch://downloads` appeared; Print opened the OS dialog —
  see anomaly); Exit verified by shared-body code-identity (never activated).
- AC5 (APG in the sheet) — PASS live (roving/wrap/Home/End/Escape, role attrs,
  textContent labels).
- AC6 (dismissal reasons + refocus) — PASS live: Escape → chrome refocuses `#kebab`
  AND `document.hasFocus()` true on chrome + false on sheet (real focus corroboration,
  not just activeElement); outside-click swallowed (`enumerateTabs` URL unchanged, no
  refocus-steal); re-click toggle closes without blink; aria resets every reason.
- AC7 (DD5 find interplay) — PASS live: find+query → open kebab → bar hidden in pixels
  (`11`) → Escape/outside-click → bar restored with "tick" intact (`12`/`13`). Blur
  flavor: unit-tested (HAT covers live per spec).
- AC8 (DD13 forwarding) — PASS live: Ctrl+= zooms (2.5→3) menu stays; Ctrl+F closes menu
  + opens find; Ctrl+W closes active tab + menu closes; over an internal tab Ctrl+= and
  Ctrl+F are full no-ops (menu stays). Full mapping + guard unit-tested.
- AC9 (DD8 resolver + docs) — PASS: `non-tab-contents` guard added, admin-exempt; three
  doc sites updated; jar key refused live on the sheet wcId (`out-of-jar`, the
  scope-façade baseline); unit-covered (baseline + guard + admin-unaffected + absent-
  predicate).
- AC10 (unit suites) — PASS: 1006/1006.
- AC11 (zero regression w/o gate) — PASS live: relaunch without the gate →
  `menuOverlayDev=false`, NO sheet webContents (probes 4/5/6 no-such-contents), kebab
  chrome-DOM + freeze (guestFrozen=true), open/close works.
- AC12 (gates) — PASS: `npm test` 1006/1006, `npm run typecheck` clean, `npm run lint`
  clean.

**Notes / anomalies:**
- **Print opens a modal GTK dialog that froze the guest** (expected — `wc.print()` with
  a printer picker). On the WSLg rig the dialog is not MCP-dismissable (no window-manager
  tooling), so the guest renderer blocked until the tab was closed. Print firing IS the
  live verdict; recovered by `closeTab` (destroys the guest + its dialog) and continuing
  on a fresh fixture. No "print failed" logged. Future run plans: verify Print's channel
  4→6 round-trip via the aria-reset + closed-menu observable, avoid leaving the dialog up.
- Port-conflict workaround reused verbatim (Leg 1): pinned client port 49152 held by the
  operator's installed build; drove a free port (43117 / gate-OFF 43118) via the SDK
  client with the instance's own minted admin key.
- All instances PID-scoped-killed on completion; fixture http.server stopped; the
  operator's Goldfinch untouched throughout.

---

### 2026-07-02 — Leg 3 (`03-container-and-site-info`) — landed

**Changes made:**
- New shared modules (dual-export, unit-tested): `src/shared/safe-color.js`
  (`isSafeColor` extracted from `jars.js` — jars.js now RE-EXPORTS it, not moved,
  so `test/unit/jars.test.js` keeps requiring it from `src/main/jars`); `src/shared/
  site-info.js` (`deriveSiteInfo` — the ONE derivation source shared by the
  gate-OFF chrome popup and the gate-ON sheet model); `src/shared/container-menu.js`
  (`buildContainerModel` — NAMESPACED id space `jar:<id>` / `action:burner` /
  `action:new-container`, round-2 collision fix). New `src/main/menu-overlay-value.js`
  (`sanitizeActivatedValue` — pure channel-4 `value` validator, string ≤24; NOT in
  the manager — the manager never touches channel 4).
- `src/renderer/menu-overlay.{js,css,html}` — sheet page generalized to a TEMPLATE
  REGISTRY keyed by menuType: `menu` (kebab, container — APG roving via the shared
  controller; container dot via `style.background` after the shared `isSafeColor`
  check, invalid → `#9aa0ac`; `max-height`+scroll for long lists; cm-title header),
  `info-popup` (site-info — note/row/action rows, no items getter, local Escape/Tab
  keydown), `input-dialog` (new-container — centered card, label+input(maxlength 24)
  +Create/Cancel, dialog-local Tab-cycle input→Create→Cancel, page-side whitespace
  guard, backdrop dim over the guest region only per DD12). Per-open token/`sent`/
  `lastStimulus` attribution HOISTED to module scope, shared across the three
  entries; Tab→'escape' attribution is menu-template-only (info-popup owns its Tab,
  dialog cycles). `menu-overlay.html` loads `../shared/safe-color.js` before
  `menu-controller.js`.
- `src/renderer/renderer.js` — ▾ and 🔒 split on the gate (mirroring the Leg-2 kebab
  split): gate-OFF keeps today's chrome-DOM menus + freeze path byte-for-byte
  (including the broken chrome new-container dialog — the fix lives ONLY on the sheet
  path until Leg-5 cutover); gate-ON drives the sheet. New `overlayMenus` entries
  (container/site-info/new-container), generic `openOverlayMenu`/`overlayTriggerClick`
  helpers, left-aligned anchor translation (`leftAnchorOf`, clamp≥0, y=0), model
  builders (`buildContainerModel(containers)`, `siteInfoModel(activeTab())`),
  namespaced channel-6 dispatch, activated-close-then-fresh-open for
  `action:new-container` (`openNewContainerOverlay`), shared `createContainerAndOpenTab`
  submit body (used by BOTH the old dialog and the sheet's `create`), shared
  `openSiteSettingsTab` (used by both site-info renderers), reason-resolved refocus
  on the ▾/🔒 triggers. `deriveSiteInfo` narrowing used `=== true` (project's
  strictNullChecks-off typecheck doesn't narrow the discriminant by truthiness).
- `src/main/main.js` — channel-4 handler forwards an optional `value` via
  `sanitizeActivatedValue` (dropped if non-string/oversize; payload still forwarded).
- `src/main/jars.js` — `isSafeColor` require-and-re-export.
- Types/lint: `renderer-globals.d.ts` + `menu-overlay-globals.d.ts` grew the
  template-shaped model + channel-4 `value` + `isSafeColor`/`deriveSiteInfo`/
  `buildContainerModel` declarations; `eslint.config.mjs` renderer-globals gained the
  three new globals; `index.html` loads the two renderer-side shared modules;
  `menu-overlay-preload.js` JSDoc updated (no functional preload edit — payloads pass
  whole).
- Tests: `test/unit/safe-color.test.js`, `site-info.test.js`, `container-menu.test.js`
  (incl. the "New Container"/"Burner" sentinel-collision cases pinned against real
  `jars.slug`), `menu-overlay-value.test.js`. Suite 1006 → 1031, all green.

**CP3-partial checkpoint verdict: PASS (3 of 5 surfaces on the sheet).**
- Apparatus: gate-ON `GOLDFINCH_MENU_OVERLAY_DEV=1 …DEV_MINT=1 …ADMIN=1
  GOLDFINCH_MCP_PORT=43119 npm run dev:automation`, driven over the loopback MCP
  transport via the SDK-client pattern (admin key from this instance's own stdout —
  the port-49152 conflict workaround stands; the operator's Windows Goldfinch was
  never touched). Wiring litmus PASS (`getChromeTarget` wcId 1 + a uniquely-named
  fixture tab in `enumerateTabs`). Capture-path canary PASS (find bar visible in
  `captureWindow` pixels — `01-canary-find-open.png`; OS-grab path confirmed). Sheet
  wcId probed via the id-space walk: `readDom(5)` → `menu-overlay.html?probe=1`.
- **Dialog-fix pixel evidence (AC4 — the defect this leg exists to prove):**
  `20/21-ac4-dialog-chained-*` show the new-container dialog CENTERED and fully
  visible over the live guest (the guest dims through the sheet backdrop) — contrast
  `71-ac7-gateoff-dialog-occluded.png`, where the gate-OFF chrome dialog is DOM-open
  + input-focused yet INVISIBLE (the live guest composites above it — the
  pre-existing occlusion defect). The chained open (activated-close-then-fresh-open)
  read as transient on the grab pair; no stuck intermediate frame.

**Per-AC results:**
- AC1 (container on sheet) — PASS live: ▾ click opens menuType `container`, model
  rebuilt from the SAME `containers` array (Default+jars+Burner+New container…),
  left-anchored flush at the top, color dots from data via `isSafeColor`, roving
  tabindex; jar activation opens a tab in that jar (`enumerateTabs` partition
  corroboration — Personal jar tab); a container created via the AC4 dialog appears
  on the next open (per-open rebuild observable). Evidence `10/11/23`.
- AC2 (long-list scroll) — PASS live: 11 containers (seeded via `jarsAdd`+push
  recipe), 13 menuitems, `scrollHeight 400 > clientHeight 292` (capped at CSS
  max-height), End roved to the last item with `scrollTop 108` (native
  scroll-into-view), no sheet overflow. Evidence `30/31`.
- AC3 (site-info on sheet) — PASS live: 🔒 opens menuType `site-info`; web tab →
  host/Connection/Trackers/Permissions rows + "Site settings →" (values from
  `deriveSiteInfo`, corroborated `readDom`); internal tab (`goldfinch://settings`) →
  secure-page note, no action, over the internal view (DD7, `41`); "Site settings →"
  navigates the internal tab to `#privacy`; Escape → chip focused + `hasFocus` true;
  Tab → chip focused ('escape' flavor — parity); outside-click over the guest link →
  closes without navigating (URL unchanged). Evidence `40/41`.
- AC4 (new-container dialog — the fix) — PASS live: activate "+ New container…" →
  container closes (activated) → chrome re-opens `new-container` fresh; dialog
  centered/visible over the live guest (pixels), input focused, maxlength 24;
  "Shopping" + Enter → jar `shopping` created + tab opened in it (`enumerateTabs`);
  reopen ▾ → Shopping listed; whitespace-only + Enter → dialog stays open, no jar
  (page-side guard); Escape/Cancel → close, no jar, focus back to ▾
  (keystroke-corroborated `focusedId:new-tab-menu`, `hasFocus` true); Tab cycles
  input→Create→Cancel→input, Shift+Tab reverses. Evidence `20/21/22/23`.
- AC5 (channel-4 value hardening) — PASS: main validates via
  `sanitizeActivatedValue` (string ≤24; else dropped, payload still forwarded);
  unit-covered (`menu-overlay-value.test.js`).
- AC6 (mutual exclusion + close family) — PASS live: kebab→container→site-info
  model-replace swaps (each superseded trigger's `aria-expanded` resets, incoming
  set — corroborated); dialog closed by tab-switch (`activateTab`) and by Ctrl+W
  (DD13 forwarding closes the tab → tab-close family) with NO jar created and jar
  count unchanged. Evidence `50/51/52`.
- AC7 (gate-OFF parity) — PASS live (separate gate-OFF instance, port 43120):
  `menuOverlayDev=false`, NO sheet webContents (probes 4/5 no-such-contents); ▾ →
  chrome-DOM container menu + `guestFrozen=true`; old new-container dialog DOM-open +
  focused but occluded in pixels (`71` — the pre-existing defect, expected); 🔒 →
  chrome-DOM site-info popup + freeze, host correct. Evidence `70/71/72`.
- AC8 (unit + gates) — PASS: `npm test` 1031/1031, `npm run typecheck` clean,
  `npm run lint` clean.
- DD5 find interplay — PASS live: find open → ▾ open → bar hidden in pixels (`60`) →
  Escape → bar restored with query intact (`61`). Blur dismissal flavors: unit-test
  only (HAT covers live, per spec).

**Evidence:** `/tmp/behavior-tests/goldfinch/menu-overlay-cp3/20260702T193007/`
(`01` canary; `10/11/23` AC1; `20/21/22` AC4 dialog-fix; `30/31` AC2 scroll;
`40/41` AC3 site-info; `50/51/52` AC6 swaps; `60/61` DD5 find; `70/71/72` AC7
gate-OFF parity incl. the occluded chrome dialog).

**DD11 bookkeeping (for the Leg-5 deletion inventory):** the chrome new-container
dialog DOM (`index.html:58-67`) + CSS (`styles.css` `.new-container-dialog` block)
+ the `initNewContainerDialog` IIFE (`renderer.js`) join the Leg-5 deletion
inventory — the sheet's `input-dialog` template replaces them at cutover. The
extracted `createContainerAndOpenTab` body stays (shared); only the old dialog's
wiring/markup is retired. (This is in addition to the DD11 items already enumerated
in the flight for the other freeze surfaces.)

**Notes / anomalies:**
- **Dialog decision pending HAT ratification (recorded at design):** fixing the
  `#new-container-dialog` via the sheet was the FD call on the flight's open
  question (operator confirmed the defect matters; revert path contained). The
  guest-region-scoped modality (backdrop dims the guest only, toolbar clicks
  blur-dismiss AND act) is the accepted DD12 variation — the HAT observes it.
- **`pressKey` Enter did not activate a focused sheet menuitem** (End→Enter on the
  container menu left the menu open). The sheet menuitems activate on `click`, and
  `sendInputEvent` keyDown/keyUp on a focused `<button>` does not synthesize a DOM
  `click` the way a real Enter does in this multi-view sheet context. Worked around
  by driving `document.activeElement.click()` via `evaluate` (a stronger
  same-element activation). Enter DID work inside the dialog input (its own keydown
  handler). Recorded as an apparatus nuance for future run plans; not a product
  defect (real keyboard Enter fires the button's native click — HAT covers it).
- Port-conflict workaround reused verbatim (Legs 1-2): pinned client port 49152 held
  by the operator's installed build; drove free ports (gate-ON 43119 / gate-OFF
  43120) via the SDK client with each instance's own minted admin key. Fixture served
  on 127.0.0.1:8130.
- All dev instances PID-scoped-killed on completion; fixture http.server stopped;
  ports 43119/43120/8130 confirmed free; the operator's Goldfinch untouched
  throughout. No operator username/home paths written into artifacts.

---

### 2026-07-02 — Leg 4 (`04-page-context-and-unpin`) — landed

**Changes made:**
- New `src/shared/page-context-model.js` (pure, dual-export, `// @ts-check`) —
  `pageContextModel(params, toolbarItem)` ports `buildPageContextSections`' section
  logic to a TYPED item array (`item`/`separator`/`note`), NAMESPACED ids
  (`link:*`/`image:*`/`sel:*`/`edit:*`/`spell:<index>`/`action:inspect`/
  `action:unpin:<item>`), INDEX-dispatched spelling (guest strings never round-trip
  as commands — DD8), image `srcURL||imageURL` + `mediaType==='image'` gate,
  edit-flag gating (omit-if-none), selection truncation(30)+quote, suggestions
  sliced to 8, note fallback, always-Inspect, toolbar short-circuit. Truncation
  rule inlined (a shared module must not reach into renderer.js). Loaded in
  `index.html` before renderer.js. New `test/unit/page-context-model.test.js`
  (11 tests, all AC2 cases).
- `src/renderer/renderer.js` — page-context migrated onto the sheet behind the
  gate across ALL FOUR invocation modes:
  - **Generalized `overlayMenus` entry shape** (design-review decision, Leg 5
    inherits): `fixedTriggerMenu(trigger)` factory (aria on trigger; escape/
    activated→trigger focus) for kebab/container/site-info/new-container; a
    bespoke `page-context` entry with `ariaTarget: () => null` (transient trigger
    — aria never stamped, closing the same-menuType-replace stale-close orphan)
    and an **escape-only** `refocus(reason)` → guarded `pageCtx.returnFocus`
    (isConnected, !==body) else `els.address`, cleared after use. The generic
    open path and channel-7 close both guard on `ariaTarget()`; channel 7 now
    calls `st.refocus(reason)` (was inline).
  - `openPageContextOverlaySheet(anchor)` (module-scoped `let`, assigned in the
    gate-ON block) builds the model from captured params and opens with a POINT
    anchor. Four gate branches: guest right-click subscription (gate ON: open at
    `params.x/y` DIRECTLY — 1:1, NO offset translation, NO microtask defer; gate
    OFF: today's freeze+microtask body); chrome-focused Shift+F10/ContextMenu and
    `openToolbarContextMenu` (gate ON: `chromePointToSheet(r.left,r.bottom)`
    chrome→sheet translate, y-clamp≥0); `openPageContextMenuForAudit` (gate ON:
    same synthetic params through the sheet, coords translated for determinism).
    All four capture `pageCtx` exactly as their gate-OFF bodies before opening.
  - **Channel-6 `page-context` dispatch**: same `window.goldfinch` calls as the
    gate-OFF `item(...)` closures, reading `pageCtx.params`/`wcId` captured at
    open (TOCTOU). **Validated-no-op on EVERY id** (vanished linkURL/imgSrc/
    selectionText → no-op, never `createTab(undefined)`; edit action re-checked
    against the allowlist; `spell:<i>` parses the int and validates
    `Array.isArray && 0<=i<min(len,8) && typeof===string` before dispatch;
    Inspect guards `wcId!=null`). Unpin ids → `unpinToolbarItem` +
    `els.address.focus()` (dispatch-body refocus, parity — NOT the reason map).
- `src/renderer/menu-overlay.js` — `menu` template extended for the Leg-4 item
  types: **type-branch BEFORE the id-string guard** (`separator`→role="separator";
  `note`→aria-disabled) so id-less items don't vanish; the `items()` getter still
  returns only `[role=menuitem]` so roving skips them for free. Point-anchor
  clamping added to `positionNode` (`x∈[4,innerWidth-w-4]`, `y∈[0,innerHeight-h-4]`)
  — `renderMenu` now **unhides before positioning** (offsetWidth/Height are 0 under
  display:none; clamp measures). `page-context`→`menu` in TEMPLATES; `'Page
  actions'` in MENU_LABELS (parity, index.html:54).
- `src/renderer/menu-overlay.css` — `#sheet-menu[data-menu-type='page-context']`
  min-width 200px; `.cm-sep` + `.cm-item[aria-disabled]` styles (chrome parity,
  literal values — sheet doc doesn't load styles.css).
- `tests/behavior/fixtures/menu-overlay/index.html` — added mid-page link (AC1
  positional target), same-origin sibling `sample-image.png` (real downloads path,
  no external resources), selectable paragraph, editable input; ticking display +
  bottom-left `#outside-link` (Leg-6 contract) UNTOUCHED. New
  `sample-image.png` fixture asset (229-byte deterministic PNG — served asset, not
  a snapshot baseline; committable).
- Types/lint: `renderer-globals.d.ts` + `menu-overlay-globals.d.ts` model unions
  gained `'item'|'separator'`; new `pageContextModel` declaration; `eslint.config.mjs`
  renderer-globals gained `pageContextModel`.

**CP3-COMPLETE checkpoint verdict: PASS — all five surfaces render from the sheet
behind the gate; old paths intact gate-OFF.**
- Apparatus: gate-ON `GOLDFINCH_MENU_OVERLAY_DEV=1 …DEV_MINT=1 …ADMIN=1
  GOLDFINCH_MCP_PORT=43121 npm run dev:automation`, driven over the loopback MCP
  transport via the SDK-client pattern (admin key from this instance's own stdout
  — the port-49152 conflict workaround stands; the operator's Windows Goldfinch
  was never touched). Wiring litmus PASS (`getChromeTarget` wcId 1 + uniquely-named
  fixture tab wcId 3). Capture-path canary PASS (find bar visible in `captureWindow`
  pixels — `01-canary-find-open.png`; OS-grab path confirmed). Sheet wcId probed
  via the id-space walk: `readDom(5)` → `menu-overlay.html?probe=1`.
- **Right-click apparatus premise: POSITIVE** — MCP `click {button:'right'}` on the
  guest wcId DOES fire the real `context-menu` path (the sheet materialized at
  wcId 5 with the correct link section). AC1's positional claim is verified live
  (NOT HAT-carried): the sheet menu opened with top-left at `530px,330px` == the
  click point (0px deviation, ≤2px tolerance), over the LIVE guest (ticks 90→93
  across the grab pair, `10/11-ac1-rightclick-menu-grab*`).

**Per-AC results:**
- AC1 (guest right-click 1:1, gate ON) — PASS live: menu at the click point, no
  offset translation, sections reflect real params (link → link items; plain area
  → Inspect-only), live guest through the transparent sheet. Evidence `10/11`.
- AC2 (pure model builder) — PASS: 11 unit tests (section order/presence,
  separators-between-not-before-first, image gate + srcURL preference, edit
  omit-if-no-flag, truncation(30)+quote, slice-8, note fallback, toolbar
  short-circuit, namespaced + `spell:<i>` ids).
- AC3 (keyboard + toolbar, gate ON) — PASS live: chrome-focused Shift+F10 on
  `#reload` opened the sheet at the translated anchor (`120px,0px`, y-clamped),
  focus on Inspect; ContextMenu key on a focused pin button did NOT open
  (double-fire exclusion held); right-click on the pinned DevTools button opened
  the single "Unpin DevTools" item at the translated anchor (`1180px,0px`) —
  activating it hid the icon, persisted `devtools:false`, and landed focus on the
  address bar (dispatch-body refocus, not the reason map). Evidence `20`.
- AC4 (actions round-trip, gate ON) — PASS live: `link:open` (new tab wcId 6);
  `link:copy` + `sel:copy` + `image:copy` all verified by paste-back into the
  editable field (system clipboard round-trip — `navigator.clipboard.readText`
  is permission-blocked on this rig, so paste-verify was used); `sel:search`
  (search tab wcId 7); `edit:cut`→`edit:paste` round-trip (field emptied then
  restored via clipboard); `image:save` (dialog-free download record present,
  completed, 229 bytes); `spell:0` INDEX dispatch fired cleanly (menu closed, app
  healthy, no console errors) — the misspelled-word suggestion section did not
  populate on the WSLg rig (spellchecker did not surface `dictionarySuggestions`
  for typed input; see anomaly), so `spell:0` was exercised via the audit-hook's
  synthetic suggestions AND a hand-injected note model. `action:inspect` fired the
  channel-6 body (toggleDevtools on the captured wcId) but DevTools does not
  actually open on this WSLg rig (isDevtoolsOpen stays false via BOTH the human
  IPC and the MCP `openDevTools` op, gate-ON and gate-OFF alike — environmental,
  not a regression; see anomaly). No print/modal traps hit.
- AC5 (sheet template extensions) — PASS live: separators render `role="separator"`
  and are excluded from roving (13-item full-section menu: 13 ArrowDowns wrapped
  exactly back to the first item, tabIndex 0 count == 1); `note` items are
  `aria-disabled`, non-focusable (`tabIndex:-1`, not a button) and skipped by
  Arrow (injected note model: ArrowDown from "the" landed on "Inspect"); near
  bottom-right-edge right-click clamped inside the sheet (`right:1394 ≤ iw 1398`,
  `bottom:806 == ih-4`). Evidence `30/40`.
- AC6 (focus return) — PASS live: Escape after a keyboard invocation → focus back
  to the invoking `#reload` (`hasFocus` true on chrome, false on sheet); Escape
  after the audit-hook open → `els.address`; outside-click (sheet click) → NO
  refocus (`#reload` retained its focus, chrome un-focused); `returnFocus` never
  leaked — a second open overwrote it (kbd-open then audit-open, Escape landed on
  the audit's target `address`, not the kbd's `reload`).
- AC7 (audit hook gate-aware) — PASS live: `openPageContextMenuForAudit()` opened
  the full 13-item menu (4 separators) on the sheet gate-ON (`readDom(5)`,
  `40-ac7-audit-sheet.png`) and on chrome DOM gate-OFF (`readDom(1)` #page-context-
  menu, no sheet webContents).
- AC8 (dismissal parity + close family) — PASS live: a right-click in the guest
  region while a sheet menu was open was SWALLOWED by the sheet (dismissed via
  outside-click, no `context-menu` reached the guest, no navigation, no new menu —
  `enumerateTabs` URL unchanged); supersede coverage via the audit hook (opened
  while the kebab was up → model-replace to page-context, kebab `aria-expanded`
  reset to false, page-context's transient trigger left un-stamped); tab-switch
  (`activateTab`) closed the open menu; DD5 find interplay held (find+query → menu
  open hides the bar → Escape restores it with "tick" intact, `50/51/52`).
- AC9 (gate-OFF parity, all five surfaces) — PASS live (separate gate-OFF instance,
  port 43122, `menuOverlayDev=false`, NO sheet webContents — probes 4/5/6/7
  no-such-contents): old context menu with OFFSET translation (right-click
  `530,330` → menu at `531px,419px`, wvTop 89) + FREEZE (`backgroundImage`
  data-URL present), Escape unfreezes; toolbar-Unpin single item; kebab (freeze);
  container (13 items: Default/Personal/Work/…); site-info (host `127.0.0.1:8140`);
  old new-container dialog (DOM-open, `#new-container-name` focused); audit hook on
  chrome DOM (13 items, 4 separators). Evidence `60-ac9-gateoff-oldmenu-freeze.png`.
- AC10 (gates) — PASS: `npm test` 1042/1042 (11 new page-context-model cases),
  `npm run typecheck` clean, `npm run lint` clean.
- **Refactor regression spot-check** (the entry-shape change rewrote lines Legs 2-3
  verified live) — PASS gate-ON: open kebab → Escape → `#kebab` focused,
  `aria-expanded` reset to false, `document.hasFocus()` true.

**Evidence:** `/tmp/behavior-tests/goldfinch/menu-overlay-cp3-final/20260702T202201/`
(`01` canary; `10/11` AC1 1:1 + liveness; `20` AC3 unpin; `30` AC5 edge-clamp;
`40` AC7 audit-on-sheet; `50/51/52` AC8 DD5 find interplay; `60` AC9 gate-OFF old
menu offset+freeze).

**DD11 bookkeeping (additions to the Leg-5 deletion inventory):** the following
gate-OFF page-context artifacts join the cutover deletion inventory — `pageCtx`'s
gate-OFF-only fields (`keyboard`, and the `x`/`y` that only the offset path reads),
`buildPageContextSections` (`renderer.js`), `positionPageContextMenu` + its
`#webviews`-rect OFFSET TRANSLATION (the DD2 payoff — 1:1 on the sheet makes it
deletable), the `queueMicrotask` blur-settle defer in the subscription, the
`freezeGuest` call in `pageContextEntry.onOpen` (+ its `unfreezeGuest` in onClose),
the entire `pageContextEntry` registration + `closePageContextMenu` wrapper +
`pageContextItems`, and all four gate-OFF invocation branches (the
`if (MENU_OVERLAY_SHEET) …; menuController.open(pageContextEntry, 0)` tails). The
extracted shared bodies stay (the channel-6 dispatch already reuses the same
`window.goldfinch` calls). This is in addition to the DD11 items enumerated in the
flight and in the Leg-3 entry.

**Notes / anomalies:**
- **DevTools does not open on this WSLg rig.** `action:inspect`'s channel-6 body
  fires `toggleDevtools({webContentsId})`, but `isDevtoolsOpen` stays false — via
  BOTH the human `window.goldfinch.toggleDevtools` IPC and the MCP `openDevTools`
  op, and identically on the gate-OFF instance. This is environmental (the CDP/
  DevTools front-end doesn't attach under this headless-ish WSLg session), NOT a
  regression from this leg — the dispatch wiring is correct and the app stayed
  healthy (no throw, no console error). The "close DevTools in the same step"
  caution was therefore moot (nothing opened to change window composition). Real
  Inspect open/close is HAT-covered (Leg 6).
- **Spellcheck suggestions did not surface for typed input on WSLg.** Typing a
  misspelled word into the editable field and right-clicking it produced no
  `misspelledWord`/`dictionarySuggestions` in the params (only Paste/Undo), even
  with the `en-US` `.bdic` present and `spellcheck` enabled. The Leg-3/M04-F4 note
  already records the squiggle render as inconclusive on WSLg. `spell:<i>` INDEX
  dispatch + bounds validation is therefore verified via the audit hook's synthetic
  suggestions (`the`/`ten`/`tea`) and a hand-injected note model (the non-focusable
  fallback), plus the unit suite; live real-spellcheck spelling correction is
  HAT-carried (Leg 6).
- **Clipboard read is permission-blocked on the rig** (`navigator.clipboard.readText`
  → NotAllowedError, "Document is not focused" on the guest / "Read permission
  denied" on the chrome). All clipboard round-trips (`link:copy`/`sel:copy`/
  `image:copy`) were verified by pasting back into the editable field via the
  menu's own `edit:paste`, which reads the same OS clipboard the chrome-side
  `clipboardWriteText` wrote to — a stronger end-to-end check than a same-context
  read.
- Port-conflict workaround reused verbatim (Legs 1-3): pinned client port 49152 held
  by the operator's installed build; drove free ports (gate-ON 43121 / gate-OFF
  43122) via the SDK client with each instance's own minted admin key. Fixture
  served on 127.0.0.1:8140.
- All dev instances PID-scoped-killed on completion; fixture http.server stopped;
  ports 43121/43122/8140 confirmed free; the dev profile `settings.json` restored
  from a pre-run backup (the DevTools-unpin test wrote `devtools:false`; reverted);
  the `~/sample-image.png` download artifact removed; the operator's Goldfinch
  untouched throughout. No operator username/home paths written into artifacts.

---

### 2026-07-02 — Leg 5 (`05-cutover-retire-freeze`) — landed

**Changes made (deletion-dominant — the CP4 cutover):**
- **Gate removal (sheet paths unconditional):** `MENU_OVERLAY_DEV` deleted from
  `src/main/main.js` (4 refs: comment block, const, probe-query load option), the
  `menuOverlayDev` preload flag from `chrome-preload.js` (2 refs) and its renderer reads
  (2 refs: the `MENU_OVERLAY_SHEET` const + comment), plus the `renderer-globals.d.ts`
  declaration. Every gate-OFF branch deleted; the former gate-ON block unwrapped to module
  scope (openKebabOverlay / openContainerOverlay / openSiteInfoOverlay /
  openNewContainerOverlay / openPageContextOverlaySheet are now top-level bindings — the
  a11y drivers ride them). The four page-context invocation sites (right-click
  subscription, chrome keyboard, toolbar-unpin, audit hook) are now single-path.
- **Probe machinery deleted with the gate** (Leg-1 Workaround Log): `?probe=1` query in
  `createSheetView`, the `#probe-badge` div + IIFE + CSS block in
  `menu-overlay.{html,js,css}`.
- **Chrome menu DOM/CSS/code deleted (per the DD11 bookkeeping, Legs 3–4):**
  `index.html` — `#kebab-menu`, `#container-menu`, `#site-info-popup`,
  `#page-context-menu`, `#new-container-dialog`, and the chrome
  `<script src="menu-controller.js">` tag (the sheet keeps its copy — the file is
  unchanged; its globals now serve only the sheet document, DD4's retire-by-unload);
  `styles.css` — the menu/dialog/site-info CSS regions (~207 lines; `.cm-item` pruned
  from the multi-selector focus-ring list rather than deleting the rule; the SECOND
  `.cm-dot` block KEPT — it serves the privacy panel's Jar section — re-commented);
  `renderer.js` — kebabEntry/containerEntry/siteInfoEntry/pageContextEntry registrations
  + onOpen/onClose/close-wrappers + positioners (`positionKebabMenu`,
  `positionSiteInfoPopup`, `positionPageContextMenu` incl. the offset translation),
  `buildPageContextSections`, `buildSiteInfo`, `pageContextItems`, `truncateLabel`,
  `initNewContainerDialog`, the container-menu innerHTML builder, the `queueMicrotask`
  defer, `pageCtx`'s gate-OFF-only fields (`x`/`y`/`keyboard`), and the deleted-node
  `els.*` entries (kebabMenu/containerMenu/siteInfoPopup/pageContextMenu). The
  design-review-mandated **`menuController.closeAll()` in `openOverlayMenu` deleted**
  (would have thrown ReferenceError post-script-tag). Survivors kept per spec:
  `deriveSiteInfo`/`siteInfoModel`, `openSiteSettingsTab`, `createContainerAndOpenTab`,
  `basenameFromUrl`, `chromePointToSheet`, `KEBAB_ACTIONS`, `freezeTabWidths` family
  (unrelated tab-strip width freeze).
- **Freeze family deleted (27 refs → 0):** `freezeGuest`/`unfreezeGuest` definitions +
  `guestFrozen` flag + the `sendActiveBounds`/`onTriggerSendBounds` early-returns
  (surrounding rAF-debounce byte-identical) in `renderer.js`; the
  `capture-active-guest` handler + comment block in `main.js`; the `captureActiveGuest`
  bridge + comments in `chrome-preload.js` + `renderer-globals.d.ts`. Dual-purpose
  touches PRESERVED and re-commented without freeze framing: the guest `context-menu`
  forwarder, `tab-hide`'s hideFindOverlay + sheet-close, `tab-set-active`'s re-adds,
  the find-overlay "hidden-but-live guest" note, the `#webviews` background comment in
  styles.css.
- **eslint/d.ts:** renderer globals block **unchanged** per the design-review correction
  (menu-overlay.js uses menuController/focusItem from the same glob); d.ts cleanup
  limited to `captureActiveGuest` + `menuOverlayDev` + freeze comment framing.
- **`scripts/a11y-audit.mjs` extended (DD6):** five sheet-target states (see below),
  `findSheetWcId` probe walk (id-space 1..64, identifying URL `menu-overlay.html`,
  discovered ONCE per run) hardened to **skip every enumerateTabs wcId + the chrome**
  (evaluate is foreground-first — probing a background TAB activates it, a tab-switch
  that closes the menu under audit; found live, see anomalies), sheet-side dismissal
  (synthesized Escape keydown on the open template node, evaluated in the sheet doc)
  + DOM-closed verification between states. The retired chrome `page-context-menu`
  state's `#page-context-menu` ACCEPTED entry replaced by its sheet successors.
- **`test/unit/menu-controller.test.js` re-frames (2, comments only, no assertion
  changes):** the header now names the sheet document as the module's only loader
  post-cutover; the `sameNode` fake's "page-context-style consumer" framing re-pointed
  to the sheet template entries (trigger === menu). Module file untouched; no assertion
  pinned chrome dismissal (as the design review verified).
- File deltas: `renderer.js` 3252→2648 (−604), `styles.css` 1534→1327 (−207),
  `index.html` 215→192, `main.js` 2484→2442, `menu-overlay.{html,js,css}` −4/−8/−17
  (probe badge), `a11y-audit.mjs` 374→468 (+94, the sheet states).

**a11y state list (final `npm run a11y`, full rule set, exit 0):** base-chrome,
media-panel, privacy-panel, lightbox, devtools-button (chrome states unchanged) +
**sheet:kebab, sheet:container, sheet:site-info, sheet:new-container,
sheet:page-context** (all audited against the sheet's wcId; page-context re-targeted
from chrome to the sheet). The `new-container` state opens via the module-scope
`openNewContainerOverlay()` (the same body the container menu's
`action:new-container` activation runs) — the leg's sanctioned alternative to the
ArrowDown+click recipe; recorded as the chosen option.
**Curated ACCEPTED additions (3, all state-scoped, reviewed in the diff):**
- `region` / `#sheet-menu` @ `sheet:kebab` — transient role="menu" sheet overlay;
  floating menu is not document content requiring a landmark (chrome
  `#page-context-menu` precedent class).
- `region` / `#sheet-menu` @ `sheet:container` — same class.
- `region` / `#sheet-menu` @ `sheet:page-context` — direct successor of the retired
  chrome `#page-context-menu` entry.
The `sheet:site-info` and `sheet:new-container` states fired NO findings (role="dialog"
templates sit outside the region rule) — no entries needed, no markup changes required
(the sheet was built clean; only the expected region/landmark advisory class appeared).
The pre-existing state-unscoped `landmark-one-main`/`page-has-heading-one` `html`
entries match the sheet document too (deliberate, noted in the baseline).

**CP4 checkpoint verdict: PASS (on the OS-grab pixel path, ungated build).**
- Apparatus: plain `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1
  GOLDFINCH_MCP_PORT=43123 npm run dev:automation` (NO `GOLDFINCH_MENU_OVERLAY_DEV` —
  cutover is the only path), driven over the loopback MCP transport via the SDK-client
  pattern with the instance's own minted admin key (the recorded port-49152 conflict
  workaround stands; the operator's Windows Goldfinch was never touched). Wiring litmus
  PASS (`getChromeTarget` wcId 1 + a uniquely-named `?cp4=<ts>` fixture tab in
  `enumerateTabs`). Capture-path canary PASS (find bar visible in `captureWindow`
  pixels — `01-canary-find-open.png`). Sheet wcId probed via the skip-tabs id-space
  walk; **the sheet URL carries NO `?probe=1`** (`menu-overlay.html`, clean).
- **Pixels (anti-freeze, now the only path):** kebab open over the LIVE ticking guest —
  grabs 2.6 s apart differ under the open menu (clock 21:36:12→:15, ticks 6→9;
  `10/11-kebab-grab*`); page-context at the 1:1 right-click point over the live guest
  (`40`); the new-container dialog CENTERED and fully visible over the dimmed guest
  region (`21` — the fixed defect, now the only path); kebab rendered above the opaque
  internal `goldfinch://settings` view (DD7, `12`); find bar hidden under the open menu
  and restored with "tick" intact (`50/51`).
- Live sweep: **27/27 checks** (`cp4-checks.json`).

**Per-AC results:**
- AC1 (source absence, CP4 grep gate) — PASS: both verbatim greps return zero matches
  over `src/` + `scripts/` (tests/ and mission artifacts are Leg 5b's domain).
- AC2 (all five surfaces, no env gate) — PASS live: kebab (4 items, Escape → `#kebab`
  focused + `document.hasFocus()`), container ▾ (model-replace swap from kebab, aria
  swap corroborated), new-container dialog (End→activate "+ New container…" → fresh
  open → "CP4Jar" + Enter → jar `cp4jar` created + tab opened in it; Escape → ▾
  refocused), site-info 🔒 (real host rendered; outside-click dismisses AND is
  swallowed — guest URL unchanged), page-context (guest right-click at 1:1 coords,
  0 px deviation; audit hook full-section), toolbar-unpin (single "Unpin Media" item;
  activation hides the button, persists the setting, lands focus on the address bar —
  dispatch-body refocus). All over the live ticking fixture.
- AC3 (chrome DOM menu-free) — PASS: `readDom(chromeWcId)` contains none of the five
  menu nodes nor the dialog; `index.html` no longer loads `menu-controller.js` (the
  sheet still does); trigger buttons intact; startup console free of
  ReferenceError/TypeError/null-deref (scan of the ungated launch log).
- AC4 (dual-purpose touches preserved) — PASS live: find open → tab switch → back
  restores the bar with "tick" intact; find open → kebab open hides the bar (pixels,
  `50`) → Escape restores it (`51`) — DD5 rides `closeMenuOverlay`, not the freeze.
- AC5 (a11y extended + green) — PASS: `npm run a11y` exit 0 with the five sheet states
  + unchanged chrome states; page-context targets the sheet. Baseline additions above.
- AC6 (unit corpus + dispositions) — PASS: `npm test` 1042/1042 (zero deletions from
  the pre-leg corpus), `npm run typecheck` clean, `npm run lint` clean;
  `menu-controller.test.js` changes are the two comment re-frames only.
- AC7 (shared-path regressions) — PASS live: DD13 Ctrl+= under open menu zooms the
  guest (1.1→1.25) with the menu staying open; Ctrl+F closes the menu and opens find;
  Ctrl+W closes the active tab + menu; mutual-exclusion kebab→container model-replace;
  dialog create round-trip; internal-tab kebab (DD7) — all on the ungated build.

**Evidence:** `/tmp/behavior-tests/goldfinch/menu-overlay-cp4/20260702T212133/`
(`01` canary; `10/11` kebab anti-freeze pair; `12` DD7 internal; `20/21` container +
dialog; `30` site-info; `40` page-context 1:1; `50/51` DD5 find interplay; `60`
unpin; `cp4-checks.json` 27/27; `app.log`/`app2.log` launch + console-scan logs).

**Notes / anomalies:**
- **Foreground-first probe hazard (apparatus lesson, fixed in-script):** the first
  sweep run failed 4 checks because the sheet-wcId probe walk evaluated background
  TAB wcIds — `evaluate` is foreground-first, so each probe activated that tab,
  firing a `tab-switch` close of the menu under test (and switching the visible
  fixture). Fix: skip every `enumerateTabs` wcId (+ the chrome) in the walk — the
  sheet is never in `enumerateTabs` (DD8), so nothing is lost. Applied to BOTH the
  sweep driver and `scripts/a11y-audit.mjs`; the final a11y run validated the
  hardened walk under multi-tab conditions. This is the "probe brittleness" branch
  the leg pre-authorized — resolved in-script; NO admin discovery hook needed
  (recorded as the choice).
- The internal `goldfinch://settings` tab is invisible to both `enumerateTabs` and
  the eval tool (by design), so the "Settings opened" observable was re-based on the
  chrome's own tab state (`activeTab().url` + address-chip `data-state="internal"`).
- Known nuances honored: sheet menuitem activation via `evaluate`
  `document.activeElement.click()` (pressKey Enter doesn't activate — Leg-3 note);
  Print and kebab Exit never activated (modal-dialog / quit traps); DevTools not
  chased (rig limitation, Leg-4 note).
- Port-conflict workaround reused verbatim (Legs 1-4): pinned client port 49152 held
  by the operator's installed build; drove free port 43123 via the SDK client with
  the instance's own minted admin key. Fixtures served on 127.0.0.1:8000 (a11y) and
  127.0.0.1:8150 (CP4 sweep).
- All dev instances PID-scoped-killed on completion; fixture http.servers stopped;
  ports 43123/8000/8150 confirmed free; the dev profile `settings.json` restored from
  a pre-run backup (the Unpin check wrote `media:false`) and the sweep-created
  `cp4jar` container removed from `containers.json`; evidence JSON scrubbed of home
  paths; the operator's Goldfinch untouched throughout. No operator username/home
  paths written into artifacts.

---

### 2026-07-02 — Leg 5b (`05b-specs-and-docs`) — landed

**Writing leg — no source-code changes (`src/`, `scripts/`, `test/` untouched; verified by the
gates and the diff).** Per-disposition summary:

1. **`tests/behavior/internal-tab-menus.md` — RE-AUTHORED.** The authoritative
   `#webviews backgroundImage` freeze tell (+ its stale `renderer.js:1076,1091` citations) replaced
   by sheet observables: menu rendered from the probed sheet wcId over the LIVE internal view,
   pixels authoritative on the OS-grab path; kebab/container/**site-info** all covered over
   `goldfinch://` tabs (DD7); trigger `aria-expanded` stays chrome-side. Folded in the Leg-5
   apparatus lessons: `evaluate` refuses internal wcIds by design → internal-tab checks re-based
   on chrome tab state (address-chip `data-state="internal"`) + pixels; background-tab-safe probe
   walk; `pressKey`-Enter activation nuance; Print/Exit cautions. The panel-resize row now drives
   the panel via Ctrl+M (the toolbar buttons are disabled on internal tabs — pre-existing M04
   behavior the old draft step missed). Freeze-era mentions survive only in the re-author
   preamble as explicitly-retired prose.
2. **`tests/behavior/tab-surface-geometry.md` — freeze rows RE-AUTHORED, geometry rows intact.**
   Steps 2–4 are now live-guest rows: baseline liveness, menu-over-live-guest (ticking delta
   between grabs ~2 s apart + flush-at-guest-top DD12 framing), dismiss-with-nothing-to-restore.
   Setup re-based on the `fixtures/menu-overlay/` ticking fixture (a static page can't witness
   liveness). Panel rows 5–6 and find-float rows 7–8 untouched in substance. Caveat rewritten:
   the WSLg fallback may not composite sibling overlay views; absence-authoritativeness added.
3. **`tests/behavior/menu-dismissal.md` — RE-AUTHORED.** The retired chrome window-blur/pointerdown
   mechanism framing is gone; the user-observable contract (outside-click dismisses AND is
   swallowed, Escape closes with trigger refocus, mutual exclusion, toggle-close without blink,
   keyboard trigger-open with startIndex) is re-expressed against sheet-era observables (pixels +
   chrome `aria-expanded`; channel-7 reasons stated as internal, not asserted). Apparatus-limit
   notes codified from the flight: injected-clicks-bypass-hit-testing → OS-pointer interception is
   HAT-only (spec asserts dismiss-without-forwarding on the probed sheet wcId); scripted focus
   can't fake OS blur → blur flavor HAT-scoped. Three-wcId bookkeeping (chrome/guest/sheet)
   replaces the old two-wcId note.
4. **`tests/behavior/kebab-menu.md` — UPDATED (deeper than the count, per design review).** All
   three "exactly two items" pins (Intent, Observables count pin, step 3) corrected to the real
   four (Settings/Downloads/Print…/Exit); **step 8 INVERTED** — "Settings is inert placeholder"
   became "Settings opens the trusted internal `goldfinch://settings` tab" (address-chip
   `data-state="internal"` + pixels; enumerateTabs-absence explained as the internal exclusion,
   not a nothing-happened tell); the Intent's placeholder "Not covered" framing replaced (Print
   observability note instead). Menu DOM/AX reads moved chrome-wcId → probed sheet wcId
   (background-tab-safe walk); `aria-expanded` stays chrome-side. Apparatus notes gained the
   **Print modal-dialog trap** (Leg-2 anomaly: `wc.print()` opens a blocking GTK dialog, not
   MCP-dismissable on this rig — verify Print via aria-reset/menu-closed observables, never leave
   the dialog up) beside the standing do-NOT-activate-Exit caution, and the pressKey-Enter nuance
   (scripted activation via `evaluate` `activeElement.click()`; real-keyboard Enter is HAT).
5. **`tests/behavior/page-context-menu.md` — UPDATED.** Node identity `#page-context-menu` → the
   sheet's `#sheet-menu[data-menu-type="page-context"]`; coordinates now 1:1 guest-relative
   (offset-translation framing deleted; 0 px deviation cited from Leg 4); **step 8's Escape
   focus-return changed** — guarded `pageCtx.returnFocus` (keyboard invocations) else the address
   bar, never the guest; right-click via MCP `click {button:'right'}` recorded as the **proven
   canonical driver** (Leg 4); spelling dispatch-by-index noted; Inspect devtools-open recorded as
   rig-limited (Leg-4 finding) — HAT-carried; WSLg spellcheck-suggestions limitation recorded;
   fixture re-pointed at `fixtures/menu-overlay/` (all four targets); Unpin steps note the
   dev-profile settings.json location + post-run pin restore.
6. **`tests/behavior/find-overlay-geometry.md` — step 6 REFRAMED + F7 errata bundle (Rec 4).**
   Step 6's assertion unchanged (DD5); wording now menu-overlay + `closeMenuOverlay` restore. All
   four errata folded in from the 2026-07-02 run log's Validator closing: probe-direction
   "around" (+ the Leg-5 background-tab-safe skip), step-2 pixel-tolerance band (≤5 px pass /
   >10 px fail), menu DOM-bracketing technique, DOM-anchored control location; plus the
   absence-authoritativeness rule and the optional step-8 reopen-check (reset-on-next-open).
7. **`tests/behavior/menu-overlay.md` — RECONCILED, status stays `draft`.** Step 1 now names the
   existing `fixtures/menu-overlay/` fixture (ticking display, bottom-left `#outside-link`,
   mid-page link, image, editable — built Legs 1+4); apparatus notes gained the three proven
   lessons (background-tab-safe probe walk; pressKey-Enter nuance with `evaluate`
   `activeElement.click()` activation; right-click driver proven).
8. **`test/unit/menu-controller.test.js` — INSPECTED, no edit.** Spec-reading revealed no missed
   pin beyond the two comment re-frames Leg 5 already applied (header + sameNode framing, both
   verified accurate against the sheet reality). No code gap recorded.
9. **CLAUDE.md — REWRITTEN per region (surgical).** a11y command description (five `sheet:*`
   states + probed addressability + the background-tab-safe walk; find-UI note retained,
   re-phrased to enumerable-vs-addressable); renderer architecture ¶ (chrome = triggers/models/
   actions, sheet = presentation + APG via `menu-controller.js` now loaded ONLY by the sheet
   document); find-overlay ¶ (DD5 wording, admin-tier addressability); `WebContentsView` gotcha ¶
   (sheet is the live example; freeze-frame named as retired predecessor); "only trusted call
   site" claim corrected (kebab Settings/Downloads channel-6 dispatch bodies +
   `openSiteSettingsTab`); BOTH site-info bullets (chip → sheet `info-popup` template;
   `buildSiteInfo` → `siteInfoModel`/`deriveSiteInfo` + `openSiteSettingsTab`); toolbar-Unpin
   section (sheet toolbar-mode via `pageContextModel`, dispatch-body refocus); page-context
   section (guest→main→chrome capture survives; sheet render, 1:1 coords, namespaced ids,
   index-dispatched spelling, escape-only refocus); freeze-frame + `capture-active-guest`
   sections DELETED and replaced by one **menu-overlay-sheet section** (singleton lifecycle,
   channels 1–7, close family + token + 300 ms suppress, DD5, DD8 sender validation +
   non-tab-contents admin hardening, DD13, DD7); new **"Overlay-view patterns (M05 Flights
   7–8)"** section with all five Rec-3 entries (`findNext` inversion + adapter; pending-init
   queue; sender-resolved close refocus; Electron-free injected-deps module —
   `find-overlay-geometry.js` and `menu-overlay-manager.js`; enumerable-vs-addressable rule).
   Every symbol presented as live spot-verified against the tree (`createMenuOverlayManager`,
   `closeMenuOverlay`, `menu-overlay:*` channels, `sanitizeActivatedValue`, `sheet-accelerator`,
   `isTabViewWcId`, `chromePointToSheet`, `KEBAB_ACTIONS`, `openSiteSettingsTab`, `siteInfoModel`,
   `pageContextModel`, `openPageContextMenuForAudit`, `findOverlayLastQueryText`,
   `open*Overlay` helpers). Retired names appear only in explicitly-retired framing (2 sites).
10. **`docs/renderer-menu.md` — REFRESHED.** Loader re-pointed (sheet document only, module
    unchanged — moved consumers, not code); consumers now the three sheet template entries
    (shared `menu` entry for kebab/container/page-context; `info-popup`; `input-dialog` — all
    `trigger === menu`, programmatic open); division-of-labor note (chrome trigger-side vs sheet
    controller vs main close family); the sheet's capture-phase `lastStimulus` reason attribution
    documented as sitting ALONGSIDE the controller (default-blur + capture-phase stamping), not
    inside it; contract text (roving, constraints, recursion rule) preserved.
11. **`docs/mcp-automation.md` — TOUCHED.** The admin bullet's "(the **sole** relaxation)" claim
    replaced by the two-relaxation enumeration (internal-session + non-tab-contents, mirroring
    the Leg-2 resolve.js/engine.js comment updates); new "Overlay views are non-enumerable but
    probe-addressable" bullet (design choice, probe walk incl. the background-tab-safe skip, the
    a11y `sheet:*` states as consumers). The doc does NOT describe the a11y audit's state list,
    so no state-list edit applied there (recorded as the as-applicable outcome).
12. **F7 known-item annotations + debrief checkoffs (corrected location, per design review).**
    Additive dated annotations at BOTH F7 flight-log sites — the Leg-2 "Known/HAT-observation
    items" entry and the HAT session note where "unfreeze non-refocus ACCEPTED as correct" —
    wording "mechanism restructured in F8 … ratified at the F8 Leg-6 HAT" (never "resolved";
    F7's accepted-as-correct disposition stands). F7 debrief Action Items: ONLY Rec-3 and Rec-4
    checked off, each with a dated executed-by-F8-Leg-5b note; all other items left untouched.
    `mission.md` Known Issues is empty — nothing to annotate there (as the design review found).

**Inspection outcomes (expected no-change edge cases):**
- `tests/behavior/settings-activity-viewer.md` — its "freeze" is the audit-viewer
  freshness/page-2 freeze contract (F7 settings-page feature), unrelated to the guest
  freeze-frame → **no change** (confirmed by reading every mention: title, Intent, step 6/7,
  row conventions).
- `tests/behavior/responsive-tab-strip.md` — its "freeze" is the `freezeTabWidths`
  deferred-resize tab-width freeze (explicitly KEPT at Leg 5), unrelated → **no change**
  (step 8's "deferred-resize freeze" mention verified correct as-is).
- `tests/behavior/find-in-page.md` cold-start caveat — explicitly NOT this leg (F7 Rec 5 →
  Flight 5's owner) → untouched.
- Historical run logs under `tests/behavior/*/runs/` — immutable, untouched.

**Gate results:**
- **AC1** PASS — the verbatim grep over `tests/behavior/*.md` returns 3 matches, all in
  re-author preamble blockquotes (explicitly-retired prose), zero in any `## Steps` table or
  `## Observables Required` section; run logs untouched.
- **AC2** PASS — six dispositions executed as declared (re-author ×3, update ×2,
  reframe+errata ×1); every spec retains the Intent/Preconditions/Observables/Steps Witnessed
  shape; apparatus notes carry the proven Leg-3/4/5 techniques + HAT-only scopes.
- **AC3** PASS — `menu-overlay.md` reconciled, status `draft`.
- **AC4** PASS — CLAUDE.md truthful against the tree (live symbols spot-verified; freeze
  mentions retired-only); the deleted-symbol negative grep over CLAUDE.md + `docs/*.md` returns
  zero matches.
- **AC5** PASS — both docs refreshed as above.
- **AC6** PASS — Rec-3/Rec-4 checkoffs + dated annotations, additive only.
- **AC7** PASS — `npm test` 1042/1042, `npm run typecheck` clean, `npm run lint` clean
  (writing leg — no source change, proven).

**Files modified:** `tests/behavior/{internal-tab-menus,tab-surface-geometry,menu-dismissal,
kebab-menu,page-context-menu,find-overlay-geometry,menu-overlay}.md`, `CLAUDE.md`,
`docs/renderer-menu.md`, `docs/mcp-automation.md`,
`flights/07-find-overlay-view/{flight-log.md,flight-debrief.md}` (annotations/checkoffs),
plus this log + the leg artifact (status). No app launch was needed — the Leg-1–5 evidence set
and flight-log entries covered the observables cited.

---

## Decisions

*(none yet)*

---

## Deviations

*(none yet)*

---

## Anomalies

*(none yet)*

---

## Session Notes

### 2026-07-02 — Flight planning

- Direction set by operator: leverage the Flight-7 overlay breakthrough; retire freeze-frame outright.
  The F7 debrief's "investigate pause-hit-testing first" recommendation recorded as considered-and-
  overridden (flight.md DD1).
- Recon (read-only) mapped the freeze machinery: five menu surfaces, all through `menuController`, all
  calling `freezeGuest`/`unfreezeGuest`; capture → still → hide → z:60 DOM menu.
- Overlay shape interviewed with consequences on the table; operator selected the **full-guest
  transparent sheet** (DD2) over sized-to-menu views. Operator also locked: find bar hidden under open
  menus (DD5, parity), a11y auditing must be preserved (DD6), HAT leg yes.
- a11y observe-path premise verified against code at planning: `evaluate` resolves arbitrary wcIds
  (`src/main/automation/resolve.js:76-81`), `a11y-audit.mjs:runAxe` is wcId-parameterized.
- Behavior spec `tests/behavior/menu-overlay.md` drafted (status: draft).

### 2026-07-02 — Design review round 1 (Architect)

- Verdict: **approve with changes** (direction sound; completeness fixes, no rework). 14/16 citations
  exact; one drift repaired (`guestFrozen` guard is `renderer.js:979` + `2697-2698`, not 879-886).
- Two HIGHs, both in DD4's close-path enumeration — exactly the F7-debrief gap class the review was
  asked to stress: (1) no declared path for **main-initiated** sheet hides (BaseWindow blur — no such
  listener exists yet; tab lifecycle; teardown) → fixed with the `closeMenuOverlay(reason)` single
  close path + reason-resolved refocus; (2) the **trigger re-click-to-close race** (sheet blur fires
  before chrome's click → close-then-reopen blink) → named in DD4 with a default suppress-window
  mechanism, locked at Leg-2 design.
- Mediums fixed: DD11 now enumerates all **six** freeze-pinning artifacts (incl. `menu-dismissal.md`,
  `kebab-menu.md`, `menu-controller.test.js` — previously "the four specs"); cutover no longer deletes
  the dual-purpose `tab-hide`/`tab-set-active` overlay touches (re-comment only); the behavior spec's
  step 3 reframed around the injected-clicks-bypass-hit-testing apparatus limit (OS-pointer
  interception is HAT-only); DD13 added (accelerators forwarded via the existing `before-input-event`
  pattern — freeze-era shortcuts parity).
- Lows fixed: sheet renders model labels via `textContent` only (guest-controlled strings); DD2
  coordinate-identity nuance (toolbar anchors need chrome→sheet translation); DD8 gained the
  **jar-tier hardening** (non-`tabViews` wcIds resolve admin-only — a real gap: a jar key could have
  driven privileged menu actions via the probed sheet).
- Review pre-answered the `#new-container-dialog` open question from code: NOT a freeze consumer;
  `position:fixed; inset:0` chrome dialog shown post-unfreeze — latent pre-existing occlusion defect.
  Leg-3 disposition reframed (fix via sheet vs accept/record — operator call).
- Suggestions adopted: `menu-overlay-manager.js` extraction committed from Leg 1; Leg-5→5b split
  pre-authorized; concrete liveness fixture named in the spec; `aria-expanded="true"`-while-open
  assertion added; OS-grab `captureWindow` availability recorded as an execution-time prerequisite.

### 2026-07-02 — Design review round 2 (Architect, final)

- Verdict: **approve with changes** — round-1 incorporation verified sound (all corrected citations
  exact; re-comment-not-delete rationale confirmed in code; menu-controller "move not
  reimplementation" confirmed via dual-export). Two mediums + two lows, all targeted DD edits, all
  applied:
  - **DD8 premise corrected**: the jar-tier "gap" was not live — the scope façade
    (`scope.js:120-128` → `resolveContentsForJar`, `resolve.js:151-157`) already refuses the
    chrome-class sheet on session identity (pinned by `automation-scope.test.js:142-191`). Hardening
    retained as defense-in-depth; "SOLE relaxation" docs/tests flagged for same-pass update; Flight 5
    will not be sent hunting a non-existent vulnerability.
  - **DD13 set corrected**: guest-captured accelerators are a proper subset of the chrome-focus set
    (`keydownToAction`); forwarding set is now the union (Ctrl+W etc. would have dead-ended under
    the original wording). Phantom "Ctrl+Tab" example dropped.
  - **DD4 additions**: monotonic open-token echoed in channels 4/5/7 (same-menuType stale-close
    race) + `closeMenuOverlay` idempotency (double-blur on app switch) — both on the Leg-2 lock list.
  - Spec: step-4 `readDom(sheetWcId)` observable added to Actions; fixture-placement constraint
    (link away from the top-right menu rect) recorded in step 1.
- Two review cycles complete (max reached); spec is codebase-validated. Awaiting operator walkthrough
  → `ready`.

### 2026-07-02 — Flight review passed; legs 1–5b completed; batch commit

- Flight-level code review: **PASS** (`[HANDOFF:confirmed]`, zero blocking findings). Two
  non-blocking items fixed in commit prep: (1) stale `renderer.js` comment attributing the
  site-info chip's trigger keydown to `menu-controller.js` (which no longer loads in the chrome
  document post-cutover) reworded to point at the chip's own handler; (2) leg artifacts 02–05
  had unticked Acceptance Criteria / Post-Completion checkboxes despite landed status + PASS
  evidence — all ticked.
- Legs 01, 02, 03, 04, 05, 05b set to `completed` (landed + flight review passed) and checked
  off in flight.md. Flight stays `in-flight` — `06-hat-and-alignment` runs next as the
  interactive HAT.
- Single batch commit made on `flight/08-menu-overlay-sheet` (code + artifacts + specs + docs).
  No GitHub PR per the mission's local long-running-branch model; merge to the mission branch
  happens at flight landing after the HAT.

### 2026-07-02 — Flight Director: batch phase complete; HAT leg designed and ready

- Flight-level Reviewer (Sonnet, fresh context, no Developer reasoning): **[HANDOFF:confirmed]**,
  zero blocking issues across the full six-leg diff. Security sweep clean (sender validation,
  no tabViews registration, DD8 layering, text-only rendering, value hardening, internal
  guards); deletion integrity verified independently; 1042/1042 + typecheck + lint green.
  Two non-blocking items (stale comment phrasing; leg checkbox state) fixed in commit prep.
- Batch commit `32f4f0e` on `flight/08-menu-overlay-sheet`: 54 files, +7753/−1341. Legs
  01–05b → `completed`, checked off in flight.md. No push, no PR (mission's local
  long-running-branch model); merge to `mission/05-webcontentsview-migration` happens at
  landing, after the HAT.
- Leg 6 (`06-hat-and-alignment`) designed as the interactive HAT: 15-step guided script
  compiling every HAT-carried item from Legs 1–5b + the three operator-ratification items
  (dialog-fix decision, DD12 dialog modality, F7 focus restructuring) + the Witnessed
  `menu-overlay` run (port-49152 apparatus note) + re-runs/promotions of the re-authored
  specs. Lightweight design review: approve with changes — three missing sweep items (live
  Exit as the literal last action; Enter/Space/Tab keyboard completeness incl. the Print
  dialog; draft-spec promotion on passing re-runs) and two corrections (full Witnessed launch
  invocation; conditional gates re-run before merge) — all applied. Leg → `ready`.
- **Flight paused awaiting the operator**: the HAT requires a human at the screen. Signal on
  resume: FD guides steps one at a time per the leg script.

### 2026-07-02 — Leg 6 HAT session (live, operator + FD)

- Setup: flight build launched (`npm run dev`), ticking fixture served on :8123.
- Step 1 (live-guest float, 3 menus): **PASS** — page ticks under open menus, full-height,
  flush-top anchoring reads fine.
- Step 2 (OS-pointer dismissal): **PASS** — guest-region click dismisses AND is swallowed
  (no navigation) on all three; toolbar click dismisses AND acts. The dismissal-parity
  contract confirmed on real pixels + real pointer.
- Step 3 (trigger re-click toggle): **PASS** — clean close at all click speeds, no
  blink-reopen; cross-trigger open immediately after a close works (suppress is
  per-menuType).
- Step 4 (full keyboard contract): **PASS** for the menus themselves (Enter/Space/ArrowDown
  open + ArrowUp→last, roving/wrap/Home/End, Enter+Space activation, Print dialog fired and
  cancelled cleanly, Escape/Tab close with trigger refocus; ▾ and 🔒 spot-checked). THREE
  pre-existing keyboard-reachability observations recorded (none are F8 regressions — F8
  didn't touch guest focus or chrome traversal):
  1. Tab never leaves the guest page (no cross-view traversal — guest and chrome are
     separate webContents; nothing implements F6-style handoff).
  2. Ctrl+L is dead with guest focus — `focus-address` is not in the guest
     `before-input-event` capture set (only F12/Ctrl+Shift+I/zoom/P/F/J), so the page
     swallows it. Ironic post-F8 nuance: the SHEET forwards Ctrl+L (DD13) but the guest
     never did.
  3. Chrome-document Tab order does not cycle (stops at the end; return-to-start is a jump,
     not a wrap).
  → Follow-up candidate (debrief/maintenance): extend the guest capture set with the
  chrome-class accelerators (mirror the DD13 union), and consider chrome Tab-wrap +
  guest→chrome focus handoff. HAT entry-path workaround: mouse-click the address bar, Tab
  from there.
- **HAT defect (live, operator) — cross-window click-to-activate swallowed on menu-open blur.**
  With a sheet menu open, clicking ANOTHER OS window dismissed the menu (correct) but did NOT
  bring that window to the foreground on the first click — a second click was needed. This is
  an F8 regression vs the freeze-era menus (pure chrome-DOM hide on blur — no view removal).
  Hypothesis: `mainWindow.on('blur')` → `closeMenuOverlay('blur')` → `hide()` →
  `contentView.removeChildView(sheetView)` runs while the sheet's webContents holds focus and
  the OS is mid-activation of the other window; removing the focused view triggers a focus
  re-assertion inside our window (Electron re-focuses another view) that swallows the other
  window's click-to-activate under WSLg.
- **Inline fix (Developer, this session) — deferred removal on window-blur closes ONLY.**
  - `menu-overlay-manager.js`: `closeMenuOverlay(reason, token, opts)` grows
    `opts.deferRemoval` — the close runs the FULL close path unchanged (channel 7, DD5
    restore, currentMenu null, no refocus) but hides via `view.setVisible(false)` +
    `pendingRemoval` flag instead of `removeChildView`. `visible` stays true (it tracks
    child-attachment; the view IS still attached). New `completePendingRemoval()` finishes
    the removal (flag-gated → idempotent). Completion points: `mainWindow.on('focus')`
    (main.js wiring), the start of `show()`/`openMenu` (flag cleared; the re-add RAISES the
    already-attached child — the same idiom tab-set-active relies on — and `setVisible(true)`
    undoes the deferred close, so normalization needs NO transient detach), and `teardown()`
    (its visible-branch `removeChildView` covers the attached view; flag cleared).
  - `main.js`: the BaseWindow blur call site — and ONLY that one — passes
    `{ deferRemoval: true }`; a new `mainWindow.on('focus')` handler calls
    `completePendingRemoval()`. The sheet-page-initiated `dismissed{blur}` (channel 5,
    in-app blur, window still focused) keeps immediate removal. No other close reason,
    channel semantics, token, suppress, or refocus behavior changed; the manager stays
    Electron-free.
  - **F7 invariant note**: "hide = removeChildView, never setVisible(false)-only" remains the
    steady-state rule; the deferRemoval state is a documented TRANSIENT exception (window
    backgrounded; removal completes on focus) — recorded at both the manager module header
    and the blur call site.
  - Tests (`test/unit/menu-overlay-manager.test.js`, +5): deferRemoval close hides visually
    with NO removeChildView and unchanged close-path effects; completePendingRemoval removes
    exactly once (idempotent, safe when nothing pending); open-while-pending normalizes
    (flag cleared, re-add + setVisible(true), late focus-completion no-ops, later close
    removes normally); teardown-while-pending removes + clears; non-deferred sheet-initiated
    blur still removes immediately.
  - Gates: `npm test` 1047/1047 PASS; `npm run typecheck` clean; `npm run lint` clean.
    Not committed — awaiting operator live re-test (first-click activation of the other
    window with a menu open) before the FD commits.
- **Live re-test: attempt #1 FAILED — defect unchanged.** Operator controls prove it IS an F8
  regression: (control 1) with NO menu open, a cross-window click raises the other window
  first-click; (control 2) the freeze-era build with a menu open raises fine. Two flaws
  identified in attempt #1:
  1. It still called `setVisible(false)` on the FOCUSED sheet view during OS deactivation —
     the same focus-churn class as the `removeChildView` it deferred (any view mutation on
     the focused view mid-activation re-asserts focus inside our window).
  2. The defer decision lived at the BaseWindow-blur CALL SITE only. The close can arrive
     via the SHEET-initiated `dismissed{blur}` path instead (sheet webContents blur → page
     menuController closeAll → channel-5 IPC), which still did an IMMEDIATE
     `removeChildView` — if WSLg delivers sheet-blur before/instead of BaseWindow blur, the
     deferral never engages.
- **Inline fix attempt #2 (Developer, this session) — FULL visual deferral, ordering-immune.**
  - `menu-overlay-manager.js`: the defer decision moves INSIDE `closeMenuOverlay`, made at
    close TIME, not at any call site. New injected dep `isWindowFocused()` (main.js:
    `!!(mainWindow && mainWindow.isFocused())`; default `() => true` — manager stays
    Electron-free). A `'blur'`-reason close while `isWindowFocused()` is false performs
    **ZERO view operations** — no `removeChildView` AND no `setVisible(false)`: pure logical
    close (channel 7, DD5 restore hook, `currentMenu` null, no refocus) + `pendingHide`
    flag. Ordering immunity: BOTH blur delivery paths — `mainWindow.on('blur')` AND the
    channel-5 `dismissed{blur}` handler — funnel into the same close-time decision, so
    whichever WSLg fires first takes the deferral branch and the second is the usual
    idempotent no-op. `completePendingRemoval` renamed `completePendingHide` (it now
    performs the WHOLE hide): flag-gated → idempotent; does the real `hide()`
    (`removeChildView`, the existing shape). Completion points unchanged in spirit:
    `mainWindow.on('focus')`, `show()`/`openMenu` (flag cleared; re-add raises the
    still-attached child — same normalization reasoning as attempt #1, pinned test kept),
    `teardown()` (visible-branch removal covers it; flag cleared). In-app sheet blur
    (window still focused, e.g. toolbar click) keeps today's immediate hide.
  - `main.js`: blur call site back to plain `closeMenuOverlay('blur')` (no opts);
    `mainWindow.on('focus')` → `completePendingHide()`; `isWindowFocused` injected into the
    manager deps; channel-5 comment notes the sheet-first-blur deferral.
  - **Accepted trade-off (deliberate F7 hide-invariant exception, window-unfocused only,
    documented in the manager header + blur call site):** while the app is backgrounded with
    a menu logically closed, the sheet stays attached and its PIXELS may remain — normally
    the sheet page hides its menu DOM on its own window-blur (menu-controller's global
    blur → closeAll → `classList.add('hidden')`), leaving only a transparent attached
    sheet; if the page-level blur never fires (WSLg uncertainty), the painted menu persists
    until the window regains focus, where the `'focus'` handler hides it at activation. A
    re-activating click may land on the still-attached sheet for a frame; verified against
    the code that every resulting page report is dropped: an `activated` send carries the
    closed menu's token → dropped by main.js's `!cur || token !== cur.token` check; a
    `dismissed` send → dropped by `closeMenuOverlay`'s `!currentMenu` idempotency guard (or
    by the stale-token guard if a new menu opened meanwhile); a click with no open
    controller entry sends nothing at all (`reportDismissed` requires a live `currentToken`).
    Residual (accepted): that first re-activating click is consumed by the sheet rather than
    the guest beneath — one-frame, background-return-only.
  - Tests (`test/unit/menu-overlay-manager.test.js`, attempt-#1 tests reworked, net +7 over
    baseline): unfocused blur close performs ZERO view ops (view AND contentView call counts
    frozen) with the full logical close otherwise; focused (in-app) blur hides immediately;
    ordering-immunity test drives the sheet-first channel-5-shaped close (token-carrying)
    through the deferral with the BaseWindow blur as idempotent second; `completePendingHide`
    hides exactly once (idempotent, safe when nothing pending); open-while-pending
    normalization (pinned: no detach, re-add raises, late completion no-ops, later close
    removes normally); teardown-while-pending; non-blur reasons never defer even while
    unfocused; default (un-injected) dep preserves today's immediate blur hide. Both
    `isWindowFocused` branches are covered through the manager API via the injected probe.
  - Gates: `npm test` 1050/1050 PASS; `npm run typecheck` clean; `npm run lint` clean.
    Not committed — awaiting operator live re-test before the FD commits.
- **Live re-test: attempt #2 FAILED — defect unchanged.** Zero view operations on the blur
  close and the behavior is identical — the close handlers are exonerated; the view-operation
  hypothesis behind attempts #1 and #2 is dead.

### 2026-07-03 — Leg 6 HAT defect, attempt #3 (Developer, autonomous OS-level repro)

- **OS-level repro harness built (the leg's key deliverable).** Lives OUTSIDE the repo at the
  session scratchpad (`…/scratchpad/blur-diag/`): `win.ps1` (Windows-side driver via
  `powershell.exe` from WSL — window enumeration/rects, `GetForegroundWindow` truth,
  REAL input injection via `mouse_event` MOVE/ABSOLUTE + LEFTDOWN/LEFTUP, guarded
  `clickexpect` that refuses unless `WindowFromPoint` matches the expected window,
  `clickpoll` = click + 10 ms foreground polling; execution-policy-safe via
  `-EncodedCommand`, wrapped by `wd.sh`), `client.mjs` (MCP SDK one-shot CLI:
  `getChromeTarget`/`evaluate`/`captureWindow` against the dev automation server), and
  `repro.sh` (one verdict-emitting iteration: raise target window → real-click Goldfinch →
  optionally real-click the kebab open → ONE real click on the other window →
  RAISED/SWALLOWED from foreground truth). Click-away targets are freshly-spawned
  disposable windows (uniquely-titled conhost / xmessage / WinForms form) — never operator
  windows. Coordinate calibration is empirical (guest/chrome `mousedown` recorders via MCP
  evaluate), because `GetWindowRect` lies for WSLg RAIL windows (a ~32 px x11 /
  ~11-17 px wayland shadow margin, and EXTERNALLY MOVED RAIL windows desync visible
  pixels from input mapping entirely — never `SetWindowPos` a RAIL window).
- **Repro + discriminating power (all on real OS input + foreground truth):** the operator
  defect reproduces exactly — with a sheet menu open, the first click on another (native)
  window closes the menu but does NOT raise that window; the second click raises it
  (measured back-to-back: first SWALLOWED, second RAISED).
- **Diagnosis — NOT app code, NOT the sheet, NOT menu-specific: WSLg RAIL X11-path
  click-to-activate swallow.** Evidence chain:
  1. The trigger is ANY real pointer click into ANY Goldfinch surface (guest page click,
     chrome address-bar click, or kebab/menu) while foreground; after such a click, the
     first click on a NATIVE Windows window is swallowed (6/6 + 5/5 across protocols),
     while `SetForegroundWindow`-only activation (no real click into the app) leaves
     click-away working (3/3). A 5 s dwell does not clear the armed state.
  2. Target-type 2×2 (armed): native conhost SWALLOWED / native WinForms SWALLOWED /
     X-window xmessage RAISED / X-window overlapping-the-app RAISED — X/RAIL→X/RAIL
     activation always works; only X/RAIL→native is swallowed. Overlap is irrelevant.
  3. App exoneration: F8 baseline (attempts reverted), the freeze-era build (`0b861c0`,
     pre-cutover — operator control 2's build), and attempt #2's zero-view-op close all
     reproduce IDENTICALLY (freeze-era menu-open click-away: SWALLOWED under the harness).
     Env-gated main-side focus/blur instrumentation showed the app receives ONE clean
     `wc BLUR` + `window BLUR` at the swallowed click and never re-asserts focus — while
     Windows-side the foreground never moves. The click is consumed by the WSLg RAIL
     plumbing (msrdc/Weston), not by Goldfinch. xmessage (plain X app) clicked-into does
     NOT arm the swallow — the arming is Chromium-under-XWayland-specific.
  4. **The Wayland ozone backend is clean**: same harness, same protocols — menu-open
     click-away RAISED 5/5 (+3/3 confirmation on the final build), no-menu control RAISED
     5/5 (+2/2), menu still closes via the same blur path each time.
- **Fix — dev launcher selects the Wayland backend when a compositor socket is reachable.**
  The ozone platform CANNOT be chosen from app code: Electron resolves it before `main.js`
  runs — an in-app `app.commandLine.appendSwitch('ozone-platform', …)` changes what child
  processes REPORT but not the platform actually used (proven via `xwininfo`: the window
  stayed an X11/XWayland window), and `ELECTRON_OZONE_PLATFORM_HINT` was not honored in
  this setup either. So:
  - `scripts/dev-launch.mjs` (new; now behind `npm run dev` / `dev:automation` in
    package.json) — spawns electron with `--ozone-platform=wayland` iff the pure decision
    helper says a Wayland socket is actually reachable; a caller-provided
    `--ozone-platform*` flag always wins; otherwise launches exactly as before.
  - `src/main/ozone-platform.js` (new; Electron-free, injected `exists`) —
    `decideOzonePlatform`: absolute `WAYLAND_DISPLAY` → trust if socket exists; else
    `$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY`; else the **WSLg fallback**
    `/mnt/wslg/runtime-dir/$WAYLAND_DISPLAY` (some WSLg setups never mirror the socket
    into `XDG_RUNTIME_DIR`; libwayland honors an absolute `WAYLAND_DISPLAY`, which the
    launcher exports in that branch). No socket → `{ platform: null }` → x11 unchanged
    (real X-session desktops untouched). Chromium's own `--ozone-platform-hint=auto` was
    measured to resolve x11 under WSL (no `XDG_SESSION_TYPE`), hence the explicit probe.
  - `src/main/main.js` — a pointer comment at the old appendSwitch site explaining why the
    selection lives in the launcher; plus **`grabWindow` hardened for Wayland**: under
    `--ozone-platform=wayland` the `desktopCapturer` window-source path is skipped (the
    app's surface is not in the X-window source list — the best-size heuristic grabbed an
    UNRELATED window, verified live) and the capturePage composite runs directly; the
    composite now layers **find overlay + menu-overlay sheet** above chrome+guest (they
    were silently missing from Wayland-path `captureWindow` — an open menu IS on the real
    screen; verified by composite-vs-real-desktop screenshot comparison).
  - `CLAUDE.md` — dev-launch line updated to match.
- **Verification (final build, `npm run dev:automation`, Wayland confirmed via xwininfo
  absence of an X11 app window):** harness menu-open click-away **RAISED 5/5** (fresh-build
  confirmation 3/3), no-menu control **RAISED 5/5** (confirmation 2/2); in-app dismissals
  unaffected — trigger re-click toggle closes (real clicks), toolbar/address click closes
  AND acts (address focused), real-keyboard Escape closes AND refocuses the kebab trigger;
  pixel sanity — kebab menu renders correctly under Wayland (real-desktop screenshot:
  flush-top, right-anchored, roving focus ring, live guest beneath) and `captureWindow`
  now shows the same (sheet layer in the composite).
- **Attempts #1 + #2: REVERTED** (`menu-overlay-manager.js`, the `main.js` blur-close call
  sites, and their unit tests are back to the pre-attempt state; the combined diff is
  preserved in the scratchpad as `attempts-1-2-full.patch`). Rationale: their
  view-operation hypothesis is disproven (the swallow occurs with ZERO view ops, with no
  menu open at all, and on the freeze-era build), the machinery they added (deferred hide,
  `isWindowFocused` probe, pixels-persist-while-backgrounded trade-off) is dead weight
  under the real diagnosis, and attempt #2's accepted trade-off (stale sheet pixels while
  backgrounded) is a cost with no compensating benefit. The F7 "hide = removeChildView"
  invariant is restored unqualified.
- **Residual risk / operator notes:** (1) the fix changes the dev ozone backend — window
  decorations/DPI/IME under Wayland-RAIL may differ subtly; the HAT sweep items already
  passed on x11 were spot-rechecked only for menus (open/close/keyboard/pixels) — a quick
  operator eyeball of general chrome rendering under the new backend is advised at the
  re-test; (2) packaged Linux builds are unchanged (launcher is dev-only; real desktops
  don't exhibit the WSLg defect; the packaged operator build is native Windows); (3) the
  temporary diagnosis instrumentation was removed; the harness stays in the scratchpad
  (session-scoped) — the flight-log description above is sufficient to rebuild it.
- Gates: `npm test` **1050/1050 PASS** (attempt tests removed, +8 `ozone-platform` tests),
  `npm run typecheck` clean, `npm run lint` clean.
  Not committed — awaiting operator live re-test (first-click activation of another
  app's window, menu open, on the Wayland dev build) before the FD commits.

- **Blur click-swallow RESOLVED — operator-verified live** (Wayland dev build: menu open →
  single click on a native Windows window raises it first-click). Final classification: NOT
  an F8 regression and not a menu bug — a WSLg RAIL/XWayland environment behavior armed by
  any real click into the app, targeting native-Windows windows only (harness-proven on
  freeze-era + F8 + attempt-#2 builds alike; the original "freeze-era works" control had
  compared against the operator's NATIVE Windows build, which never had WSLg in its path).
  Fix: Wayland-aware dev launcher (`scripts/dev-launch.mjs` + `src/main/ozone-platform.js`,
  socket-probed, x11 fallback, packaged builds untouched) + `grabWindow` hardened for Wayland
  (and now compositing open sheet/find overlays — a latent captureWindow gap fixed). Fix
  attempts #1/#2 reverted (view-op hypothesis disproven; diff archived in the diag
  scratchpad). Gates 1050/1050 green.

- **HAT state at session restart (2026-07-06)**: steps 1–12 PASS (12 = DD13 composite
  ratified); 13 optional-skipped; three ratification items ACCEPTED; WSLg click-swallow fixed
  (Wayland dev launcher, committed `a25fbad`, operator-verified). REMAINING: step 14
  (Witnessed `/behavior-test menu-overlay` + spec re-runs/promotions) and step 15 (kebab Exit,
  literal last action), then flight landing per the leg's Post-Completion.
- **Apparatus (post-restart recipe)**: goldfinch MCP is now a PROJECT-scope server in
  mission-control `.mcp.json` (gitignored) with a SEMI-PERMANENT admin key — the key hash is
  persisted in the dev profile; relaunch with plain `npm run dev:automation` (NO
  `GOLDFINCH_AUTOMATION_DEV_MINT` / `GOLDFINCH_AUTOMATION_ADMIN`, which would re-mint and
  invalidate the stored key) on `GOLDFINCH_MCP_PORT=49152`; fixture server:
  `python3 -m http.server 8123 --directory tests/behavior/fixtures/menu-overlay`. Operator's
  installed Goldfinch must stay closed while 49152 is in use.

- **Step 14 — Witnessed run COMPLETE: `/behavior-test menu-overlay` PASS 6/6** (run
  2026-07-06-22-07-02, live two-agent mode, ~23 min). All four load-bearing properties verified
  on rendered pixels: live-guest float under an open menu (open-grab tick delta), dismiss-
  without-forwarding at the recorded link coordinates, DD5 find-bar hide/restore with query
  intact, return-to-baseline with zero sheet residue. Run log committed at
  `tests/behavior/menu-overlay/runs/2026-07-06-22-07-02.md`; spec promoted `draft` → `active`
  with three Validator wording tightenings folded in. The spec's two optional variants were
  deliberately deferred (both surfaces HAT-verified at steps 9/11). Re-runs of the four
  re-authored specs: DEFERRED to post-flight (operator's session time; `menu-overlay` was the
  flight's acceptance gate — the re-authored specs are regression nets whose first runs can
  ride the next automation session; `internal-tab-menus` + `page-context-menu` remain `draft`
  until first pass). Carry-forwards recorded in the run log: find-input focus not restored
  after menu-Escape (documented policy, UX decision candidate); captureWindow-to-file
  apparatus gap; expected-mutable-regions spec pattern.
