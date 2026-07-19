# Flight Log: Top-Bar Download Indicator + Downloads Popup

**Flight**: [Top-Bar Download Indicator + Downloads Popup](flight.md)

## Summary

Flight execution in progress via `/agentic-workflow` (Flight Director orchestration). Branch
`flight/01-indicator-and-popup` created off `main`. Three autonomous feature-slice legs
(`chrome-trust-file-actions`, `indicator-button-and-state`, `downloads-popup`) implemented in a batch
with a single flight-end review + commit, then a guided `hat-and-alignment` leg for the operator.

---

## Flight Director Notes

- **Phase 1 (context load)**: mission `active`, flight `ready` → transitioned to `in-flight`. Crew file
  `leg-execution.md` validated (Crew / Interaction Protocol / Prompts present). Optional Accessibility
  Reviewer is `Enabled: false` in project config — not overridden; a11y coverage rides the `npm run a11y`
  gate baked into Leg 3's acceptance instead.
- **Design lineage**: mission + flight passed two Architect gates (mission viability, flight design
  review). Flight-design review returned "approve with changes"; all changes incorporated pre-execution
  (id-based row dispatch, open-by-id completion gate, full Leg-3 chrome-wiring enumeration, `role=dialog`,
  `#automation-indicator` precedent). FD ruling recorded in flight DD3: the `a11y-audit.mjs` CLOSED-SET
  `globalThis` audit-opener seam addition is approved, scoped solely to the `npm run a11y` sweep, matching
  the `openTabContextMenuForAudit` precedent.
- **Leg order**: L1 (`chrome-trust-file-actions`) ⊥ L2 (`indicator-button-and-state`); L3
  (`downloads-popup`) depends on both. Implementing L1 → L2 → L3 sequentially.
- **L1 risk-tier: HIGH** — security-sensitive surface (renderer→main trust boundary; `shell.openPath`
  on a resolved filesystem path). Per-leg design review spawned before implementation.

---

## Leg Progress

### `chrome-trust-file-actions` — landed

**Status**: landed (tests green; deferred to flight-end commit).

**Changes made**:
- `src/main/register-download-ipc.js`: added a module-local `resolveDownloadRecord(id)` helper (closes over
  `getDownloadsManager`; returns `null` for non-numeric id, absent manager, or no matching record). Added two
  chrome-trust `ipcMain.handle` channels — `open-downloaded-file` (gated on `record.state === 'completed'`,
  returns `{ ok: !error, error: error || undefined }` mirroring the internal open body) and
  `reveal-downloaded-file` (`{ ok: true }` on a resolved record, `{ ok: false }` otherwise). Both take a
  numeric id only, never a path. Refactored the internal `internal-downloads-action` record lookup onto the
  shared helper (byte-identical behavior; the `manager` local is kept for the pause/resume/cancel/remove/retry
  branches). The legacy path-trusting `show-item-in-folder` handler is left intact.
- `src/preload/chrome-preload.js`: added `openDownloadedFile(id)` / `revealDownloadedFile(id)` bridges on
  `window.goldfinch` next to `showItemInFolder`.
- `test/unit/register-download-ipc.test.js`: extended the handler-set assertion to include the two new sorted
  channels; added `state: 'completed'` to the shared harness record plus a distinct second progressing record
  (`{ id: 2, state: 'progressing', savePath: '/trusted/partial' }`) for the completion-gate test; added six
  tests covering open/reveal resolve-by-id, unknown-id `{ ok: false }` (no shell call), the completion gate,
  and path-arg ignorance (strict-deepEqual success shape `{ ok: true, error: undefined }`).

**Notes/anomalies**: None. `register-download-ipc.test.js` green (7 tests); full suite green (2220 tests,
0 fail). No source files touched outside leg scope.

### `indicator-button-and-state` — design

**FD risk-tier: LOW** — additive, single-surface (chrome renderer); mirrors the `#automation-indicator`
precedent (pure model → DOM apply); no schema / shared-interface break / persistence / cache / security
surface; does not contradict a prior leg. The rubric's "state-machine/lifecycle" high-risk trigger targets
persisted states with infra-foreclosure risk, not this ephemeral in-memory view-model reducer, which is
covered by its own unit tests + the flight-end Reviewer. Per-leg design review skipped.

**FD leg-content refinement**: the `context.js` `IDS` entry for the button moved from Leg 3 (as listed in
flight DD3) into Leg 2 — the button's id registration travels with its markup. Leg 3 consumes
`els.downloadsIndicator`; the rest of DD3's chrome-wiring stays in Leg 3.

### `indicator-button-and-state` — landed

**Status**: landed (tests green; deferred to flight-end commit).

**Changes made**:
- `src/renderer/index.html`: added the `#downloads-indicator` `<button class="icon-btn hidden">` in `#tabstrip`
  immediately before `#window-controls` (after `#tabstrip-drag`) — Lucide download glyph `.tb-glyph`,
  `#downloads-indicator-badge` span, `aria-haspopup="dialog"` / `aria-expanded="false"` / `aria-label="Downloads"`,
  plus an app-scoped/NOT-pinnable HTML comment. Mirrors `#automation-indicator`.
- `src/renderer/chrome/context.js`: added `downloadsIndicator` / `downloadsIndicatorBadge` to the `IDS` map.
- `src/renderer/styles.css`: `-webkit-app-region: no-drag` for the button (clickable inside the strip's drag
  region); added it to the icon+badge positioning group; new visual block mirroring `#automation-indicator`
  (`.downloads-active` accent + gentle pulse, reduced-motion static; `.downloads-recent` steady accent; badge
  tint). Idle-hidden via the shared `.hidden` class.
- `src/renderer/chrome/downloads-indicator-model.js` (new): pure, DOM-free/timer-free reducer over
  `{ progress | done | acknowledge | expire }` + `deriveModel(state)` → `{ visible, active, activeCount,
  recentCount, ariaLabel }`. Implements DD5 exactly: progress upserts inFlight (keyed by main-side id); done
  deletes inFlight + prepends to recent (newest-first, cap 25 evict oldest), stamps `lastCompletionAt`, resets
  `acknowledged=false`; acknowledge sets `acknowledged=true`; expire clears recent only when inFlight-empty AND
  `now - lastCompletionAt >= 5*60*1000` (time-injected, no clock). `visible = inFlight.size > 0 ||
  (recent.length > 0 && !acknowledged)`. State conveyed in words via `ariaLabel`.
- `src/renderer/chrome/downloads-controller.js` (new): `createDownloadsController({ els, goldfinch })` —
  subscribes INDEPENDENTLY to `onDownloadProgress` / `onDownloadDone` (coexists with media-controller's toast;
  no change there), renders the model→DOM (`.hidden` / `.downloads-active` / `.downloads-recent` / badge /
  aria-label), owns the resettable 5-min `setTimeout` idle-expiry, and exposes `acknowledge()`, `getSnapshot()`
  (in-flight-first then recent, each item flagged), `isVisible()`, and the `forceShowForAudit()` a11y seam.
- `src/renderer/renderer.js`: imported + instantiated the controller next to the others, retained as
  `downloadsController` (no reader yet — a single scoped `eslint-disable-next-line no-unused-vars` bridges to
  Leg 3's popup consumer; NOT added to the FD-ruled evaluate seam — that is Leg 3's a11y-audit concern).
- `test/unit/downloads-indicator-model.test.js` (new): 20 tests covering every DD5 transition (§7) — progress
  visible+active+count, same-id dedupe, done→recent move + newest-first + never-seen-in-progress + null-savePath,
  acknowledge hide, done-after-ack re-show, active-wins-over-ack, cap-25 eviction, expire past/before/with-inFlight/
  no-history, and the active/paused/recent/idle ariaLabel strings; plus reducer purity.

**Verification**: full suite green (2240 tests, 0 fail); `npm run typecheck` clean; `npm run lint` clean. Greps
confirm the button is in `#tabstrip` before `#window-controls` and is NOT referenced by any
`toolbarPins`/`applyToolbarPins`/unpin/Appearance-pins path. `media-controller.js` untouched — the toast
subscriber and the new indicator subscriber coexist.

**Notes/anomalies**: None. No source files touched outside leg scope.

---

### `downloads-popup` — design

**FD risk-tier: HIGH** — extends the shared menu-overlay system with a fifth template kind (strict
one-shot-activation + chrome-popup focus/dismissal invariants), touches the shared `renderer.js` overlay
dispatch, the `a11y-audit.mjs` sweep, and the FD-ruled `globalThis` audit-opener seam. Additive, but the
sheet regime's subtlety + id-dispatch correctness warrant a per-leg design review before implementation.

**Design review — 2 cycles (max), resolved:**
- Cycle 1: "needs rework" — 2 HIGH (fixedTriggerMenu misuse → `state.ariaTarget()` throws; disabled-first-
  button focus trap), plus TEMPLATES union typecheck gap, Tab-closes-vs-cycles, stale refs. All incorporated
  — custom state literal, in-progress rows render as text+progress with NO buttons (dissolves the trap),
  Tab cycles (input-dialog regime), `| 'downloads'` union, refs fixed, `.dl-*` → menu-overlay.css.
- Cycle 2: "approve with changes" — both prior HIGH resolved; 1 MEDIUM (acknowledge-on-close must live
  inside `refocus` as its first statement, before `isVisible()`, since `refocus` runs before
  `handleOverlayClosed`). Incorporated. Design finalized.

**Environment note for implementation**: `npm run a11y` drives the live app via the admin-key chrome sweep
(GUI). Headless gates (`npm test`, `npm run typecheck`, `npm run lint`) are required to pass in the
autonomous implement step; the live a11y sweep + the `download-indicator` behavior test are the HAT leg's
verification surface. If the implementing agent's environment can drive the sweep, great; if not, it defers
to HAT with the reason recorded — never a fabricated pass.

### `downloads-popup` — landed

**Status**: landed (all headless gates green + live a11y sweep PASSED; deferred to flight-end commit).

**Changes made**:
- `src/renderer/menu-overlay.js`: added the fifth template kind, `downloads` (`role="dialog"` `#sheet-downloads`
  node, `tabIndex=-1`, `.hidden`, registered via `menuController.register` WITHOUT an `items` getter — the
  chrome-popup regime). Local keydown owns `Escape` (close, escape flavor) and `Tab`/`Shift+Tab` (CYCLE focus
  among the enabled buttons — input-dialog regime, no dismissal, no `lastStimulus` write). `renderDownloads()`
  renders one `.dl-row` per snapshot item: COMPLETED → filename `<button class="dl-name">` (`dl:open:<id>`) +
  folder-reveal `<button aria-label="Show in folder">` (`dl:folder:<id>`, Lucide folder SVG via
  `createElementNS`, aria-hidden); IN-PROGRESS → filename `<span class="dl-name">` + `.dl-progress` text, NO
  buttons. Footer is ALWAYS a `<button>` (`dl:page`) — keeps `onOpen`'s `querySelector('button')` on an enabled
  control. Filenames via `textContent` only. Extended the `TEMPLATES` JSDoc union with `| 'downloads'`, added
  `TEMPLATES.downloads`, the `NODE_OF_ENTRY` pair, and the `onInit` dispatch branch (flat-array `modelShapeOk`).
- `src/renderer/menu-overlay.css`: `.dl-*` row / filename-button / filename-span / folder-button /
  `.dl-progress` / footer styles, matching the `.si-*` info-popup visual language (`--bg-*`/`--fg-*`/`--accent`
  tokens); CSS ellipsis on the filename for long/RTL names.
- `src/renderer/renderer.js`: `overlayMenus.downloads` as a CUSTOM state literal (NOT `fixedTriggerMenu`) with
  `ariaTarget: () => els.downloadsIndicator` and a guarded `refocus(reason)` calling
  `downloadsController.acknowledge()` as its FIRST statement (acknowledge-on-close, DD5). `#downloads-indicator`
  wired as the trigger (click toggle + APG keydown, guarded on `.hidden`). `openDownloadsOverlay()` builds the
  model from `getSnapshot()` (map `state` → `completed`), retains the open-time id-set for dispatch validation,
  no-ops on an empty snapshot. `dispatchOverlayActivation` `case 'downloads'`: `dl:page` → `openDownloads()`;
  `dl:open:<id>`/`dl:folder:<id>` parse + validate the id (integer, present in the snapshot → else no-op) then
  call `window.goldfinch.openDownloadedFile(n)` / `revealDownloadedFile(n)`. Added the two globalThis audit-seam
  functions (`showDownloadsIndicatorForAudit`, `openDownloadsOverlayForAudit`) to the CLOSED-SET seam, bumped its
  entry-count comment 19→21, and REMOVED the Leg-2 `eslint-disable no-unused-vars` on `downloadsController`.
- `src/renderer/renderer-globals.d.ts`: added the Leg-1 `openDownloadedFile(id)` / `revealDownloadedFile(id)`
  bridge type declarations (Leg 1 added the preload methods but not the `.d.ts` entries; Leg 3 is the first
  consumer, so `checkJs` flagged them — added here to unblock the typecheck gate).
- `scripts/a11y-audit.mjs`: added the `downloads-button` chrome state (force-show via
  `showDownloadsIndicatorForAudit()`) and the `sheet:downloads` sheet state (`openDownloadsOverlayForAudit()`);
  added `'sheet-downloads'` to both `SHEET_DISMISS_EXPR` and `SHEET_CLOSED_EXPR` id arrays.
- `test/unit/seam-contract.test.js` + `CLAUDE.md`: bumped the FD-approved evaluate-seam closed-set count 19→21
  (the two audit seams are the FD-ruled additions from flight DD3) — the seam-contract pin's documented protocol
  requires updating `SEAM_COUNT` and the CLAUDE.md reference together with the FD ruling.

**Gate results**: `npm test` — **2240 pass / 0 fail**. `npm run typecheck` — **clean**. `npm run lint` — **clean**.

**a11y-sweep disposition**: **RAN LIVE and PASSED.** The agent environment had a WSLg display (Wayland), so the
app was launched (`GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation`), the
minted admin key exported, the media fixture served on :8000, and `npm run a11y` run. Result: "No NEW violations
— every violation node is in the ACCEPTED baseline. ✅". The new `downloads-button` chrome state produced only
the accepted app-shell advisories (landmark-one-main / page-has-heading-one / region on #tabs/#brand) with no NEW
finding on the button itself; the `sheet:downloads` state raised NO region advisory (role="dialog" content, same
as info-popup/input-dialog) — **no ACCEPTED allowlist entry needed**, exactly as the leg predicted. Launched
processes (Electron + fixture server) were cleaned up afterward.

---

## Decisions

### DD5 refinement — acknowledge on popup CLOSE, not open

**Context**: Flight DD5 specified acknowledge-on-open (chosen to sidestep the close-reason ambiguity the
flight-design review flagged). Leg 3's design review surfaced that acknowledging on open flips the button's
visibility predicate to hidden *while its own popup is still open above it* (for the recent-only state) —
the trigger vanishes underneath the dialog.

**Decision**: acknowledge on **close** instead. A close always follows an open, so acknowledging on *any*
close reason is unambiguous (the earlier ambiguity only bit if different close reasons were treated
differently — they are not). This keeps the button visible for the lifetime of the open popup and hides it
only after dismissal when nothing is in-flight.

**Impact**: purely a Leg 3 wiring choice — Leg 2's `downloadsController.acknowledge()` method is unchanged;
Leg 3 calls it from the `downloads` menu's close path rather than from `openDownloadsOverlay()`. Flight DD5
text is annotated with a pointer to this entry.

### Leg-3 design simplification — in-progress rows have no buttons

Leg 3 design review (HIGH findings): rendering in-progress rows with a **disabled** filename button created
a focus trap (`onOpen` focusing a disabled first button drops keyboard focus; `getSnapshot()` returns
in-flight-first). Resolved by rendering in-progress rows as filename **text + progress, with no action
buttons** (only completed rows get open/reveal buttons). This satisfies "in-progress rows show progress and
aren't openable" more cleanly and removes all disabled-button focus handling. Also corrected pre-implementation:
`overlayMenus.downloads` must be a custom state literal (not `fixedTriggerMenu`, which would throw), Tab
cycles (input-dialog regime) rather than closes, and the `TEMPLATES` JSDoc union needs `| 'downloads'` or
`npm run typecheck` fails.

---

## Deviations

_Departures from the planned approach._

---

## Flight Review (Phase 2d)

Independent Reviewer (fresh context, Sonnet) evaluated the full uncommitted diff across legs 1-3 →
**`[HANDOFF:confirmed]`**. Re-ran the gates: `npm test` 2240/2240, `npm run typecheck` clean, `npm run lint`
clean. Verified the trust boundary (open/reveal by id only, main-side resolve, completion gate), the sheet
invariants (custom state literal not `fixedTriggerMenu`, no `items` getter, Tab cycles, `textContent`-only
filenames, id validated against the open-time snapshot), the DD5 accumulator, app-scoped button (not in
toolbar pins), and clean cross-leg integration. No out-of-scope files. Two **non-blocking** doc nits
(stale "acknowledge on open" comments in `downloads-controller.js`; `flight.md` legs checklist) — fixed at
finalization: legs 2-3 checked off in flight.md; the source comment fix folded into the commit.

Legs 1-3 transitioned `landed → completed`. Single flight-end commit staged (code + artifacts) on
`flight/01-indicator-and-popup`; draft PR opened with legs 1-3 checked, `hat-and-alignment` pending. Flight
stays `in-flight` — the interactive HAT leg runs with the operator next, then the flight lands.

## Anomalies

_Unexpected issues encountered._

---

## Session Notes

_Chronological notes from work sessions._
