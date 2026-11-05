# Flight Log: Non-blocking Save Prompt

**Flight**: [Non-blocking Save Prompt](flight.md)

## Summary
Sortie planned 2026-11-04. Charter and mockup approved by the operator; flight design in progress.

---

## Leg Progress

- Leg 1 `save-prompt-surface`: designed 2026-11-04 (status planning → design review).
- Leg 1 `save-prompt-surface`: **landed** 2026-11-04 (Developer, Sonnet). Phases A/B/C complete; all four gates green (below). **AC29 (live) NOT run** — the Flight Director runs it with the operator. Not committed; leg status `landed`.
  - **Gate results**: `npm test` 6233 tests / 6229 pass / 0 fail / 4 todo (todos pre-existing) · `npm run typecheck` clean · `npm run lint` clean · `npm run format:check` clean. `src/renderer/renderer.js` = **1504 lines** (budget 1505; only the `:476` comment was edited, line count unchanged) · `bookmarks-bar.js` 1076 (budget 1100). `SEAM_COUNT` unchanged (41); no seam added.
  - **New main modules**: `save-prompt-manager.js`, `save-prompt-geometry.js`, `register-save-prompt-ipc.js`, `save-prompt-drop-router.js`, `vault-lock-teardown.js` (the `runVaultLockTeardown` extraction, AC15). **New shared**: `save-prompt-close-effects.js`. **New renderer/preload**: `save-prompt.{html,js,css}`, `save-prompt-globals.d.ts`, `save-prompt-preload.js`, `chrome/save-prompt-client.js`.
  - **Wiring touched**: `vault-human.js` (`onCaptureDropped`, `offered`, `captureTabOf`, `cause:'superseded'`), `guest-wiring.js` + `register-browser-ipc.js` (offers carry `wcId`, active-tab gate main-side), `register-tab-ipc.js` (`closeSavePromptAndDrop` helper + 7 call sites + re-raise + `syncBounds`), `html-fullscreen.js`, `window-factory.js`, `window-registry.js` (`savePrompt` slot, `isSavePromptContents`, extracted `recordForOverlaySender`), `window-census.js`, `chrome-recovery.js`, `menu-overlay-manager.js` (`onVisibilityChanged`), `main.js`, `automation/{resolve,engine,mcp-server,mcp-tools}.js`, `vault/vault-context.js`, `chrome-preload.js`, `renderer-globals.d.ts`, `vault-controller.js`, `eslint.config.mjs`.
  - **Retired (DD8)**: the `vault-capture` template/TEMPLATES entry/kind/dispatch in `menu-overlay.js`, its markup tag in `menu-overlay.html`, its CSS block, `menu-overlay-preload.js` `captureSave` + `.d.ts` entry, `menu-overlay:vault-capture-save` + the `vaultCaptureSave` injection, `openCaptureSheet`/`sheetOpen`/`pendingCaptureId`/`OCCLUSION_CLOSE_REASONS`/`reportNoCaptureOffer`/`dismissQueuedOffers` and the `'vault-capture'` overlay state in `vault-controller.js`.

### Leg 1 landing report (Developer)

**Tests — new**: `save-prompt-manager` (47), `save-prompt-geometry`, `save-prompt-ipc` (19), `save-prompt-close-effects`, `save-prompt-client`, `save-prompt-drop-router`, `save-prompt-automation-guard` (10), `save-prompt-css-drift`, `save-prompt-page`, `vault-human-capture-dropped` (11), `vault-lock-teardown`. **Extended**: `register-tab-ipc` (+10 handler-level call-order/matrix cases), `window-factory` (+7, real manager for the AC16 blur/sheet feeds; harness gained an opt-in `createSavePromptManager`), `chrome-recovery` (+3), `html-fullscreen` (+3), `menu-overlay-manager` (+6 `onVisibilityChanged`), `csp-pins` (+1, and the prompt page joins the strict-overlay loop), `guest-wiring` / `register-browser-ipc` (exact `deepEqual`s now include `wcId`; +1 non-active case each), `window-census` (exact shapes + 2).

**Tests — REWRITTEN, none silently deleted**:
- `vault-controller-capture.test.js` — the capture-queue half rewritten case by case onto the prompt channel (every old AC5/5b/5c/5d/6/7/8/9 case maps to a DD6-table case; the three occlusion/resolution loops became close-reason table cases; the sheet-era "superseded wedge" regressions became one no-op pin). The vault-indicator / lock / unlock-now cases are byte-preserved.
- `vault-capture-template.test.js` — the shell test pins the non-modal shape (role=dialog, labelledby/describedby, NO aria-modal, no backdrop); three identity tests dropped their `aria-label` assertion in favor of `aria-labelledby`; +2 (`resultNounOf`, disabled choice).
- `vault-capture-handler.test.js` — **every case moved** to the `save-prompt:save` channel (success w/ no password, refusal passthrough, foreign sender, stale token, malformed captureId) plus a retired-channel-is-gone pin and the new KIND-guard case. Not deleted.
- `modal-card-controller.test.js` — **comment/label edit only**: it had no capture-specific case (all generic shared-helper cases); nothing to remove, so not rewritten beyond wording.
- Mechanical: 11 offline overlay-handler suites (`auth-submit-handler`, `register-overlay-ipc`, `vault-{admin-key,compromise,compromise-report-surface,import,rotation,setup,stepup-mint,unlock}-handlers`) wrap their fake registry with `test/helpers/fake-overlay-registry.js` (D11).
- Not broken by the retirement, so untouched: `seam-contract`, `vault-capture-drop-safety`, `automation-scope`, `automation-mcp-tools`.

**AC24 judged grep** — `rg -n "vault-capture'|'vault-capture|vaultCaptureSave|captureSave\(|#sheet-vault-capture|vault-capture-save" src test docs CLAUDE.md`. Every remaining hit, judged:
- EXEMPT (allowed survivors) — `vault-capture-offer` / `-dismiss` / `-finalize` / `-dropped` channel literals: `register-browser-ipc.js` (306/315/328), `guest-wiring.js:754`, `save-prompt-drop-router.js:26`, `chrome-preload.js` (459/460/464/474), and their tests (`guest-wiring.test.js`, `register-browser-ipc.test.js`, `save-prompt-drop-router.test.js`).
- EXEMPT — `vault-capture-template.js` `vault-capture-*` class names and the `vault-capture-choice` radio group name (lines 138-296).
- EXEMPT — `vault-human.js` `captureSave` (the API itself, line 1581) and every `human.captureSave({...})` in its own unit suites (`vault-capture`, `vault-card-capture`, `vault-identity-capture`, `vault-gesture-capture`, `vault-capture-drop-safety`, `vault-matchmode-fill`, `vault-human-capture-dropped`).
- EXEMPT — `guest-vault-capture*` guest→main channels (`register-browser-ipc.js:222`, `vault-capture-plan.js`, their tests): a different, unrelated family.
- REAL, intended — `window-factory.js:335` `captureSave: (arg) => getVaultHuman().captureSave(arg)` and `save-prompt-manager.js:24/665`: the SOLE new production caller of `captureSave`, reached only after the four `save-prompt:save` guards (the manager's `save()`).
- HISTORY comments (explicitly marked) — `main.js:2236`, `register-overlay-ipc.js:265`, `menu-overlay-preload.js:97`, `docs/vault.md:627`.
- TESTS pinning the retirement — `vault-capture-handler.test.js` (retired channel/injection gone), `save-prompt-css-drift.test.js` (`#sheet-vault-capture` absent from menu-overlay.css), `save-prompt-page.test.js`, `vault-controller-capture.test.js:474` (sheet-era no-op regression).
- No unjudged or leftover real hit. (`docs/dev-testing.md:191` `[vault-capture]` log tag is outside the grep's quoted forms and unchanged.)

**Behavior specs touched (AC24)**: `tests/behavior/vault-capture-save-update.md` — steps 2/4/5/6 retargeted from `captureWindow` pixels to `enumerateWindows().savePromptVisible` + `[by-eye]`, header/observables/variants updated (pixels were never observable: the prompt is excluded from `captureWindow`). `tests/behavior/vault-card-fill-capture.md` + `fixtures/vault-card/drive.mjs` — the offer signal is now `sheetVisible || savePromptVisible` (locked → unlock sheet, unlocked → prompt). `tests/behavior/save-prompt-non-blocking.md` — preconditions/Step 2/6/7 per AC27 (unique username AND password per submit; `capture.html`/`landed.html`).

**AC29 — made runnable, NOT run**: fixture capture mode (`tests/behavior/fixtures/vault-login/{capture,landed}.html` + README), census booleans, and the unit-proven guard are in. The live apparatus probe, P1/P2 by eye, the behavior test (Variant A) and the interim-locked by-eye step are the Flight Director's. **P3 stays unverified** (no screen reader).

**Live-only risks the unit suite cannot see** (watch at AC29): (1) `file://` module import of `../shared/vault-capture-template.js` from `save-prompt.js` under the prompt CSP — same shape as `menu-overlay.html`, but unproven for this page; (2) `require(esm)` of `vault-capture-template.js` and `save-prompt-close-effects.js` from CJS main under Electron 44 (unit tests run it under Node 22); (3) whether `pointerenter` fires for a never-focused view when the cursor is already over the card at show (P1); (4) the name-less GET fixture form being recognized by the capture scanner (D10); (5) WSLg transparent-view repaint on show/resize/hide (P2).

---

## Decisions

Leg 1 (Developer; each is the conservative option consistent with the flight's DDs, none a security-boundary question):

- **D1 — The `teardown` close reason dismisses the shown capture (`dismissShown: true`).** DD6's table says `teardown` = "dropped (DD5)" with a clear-queue. A chrome-renderer crash (`closeSavePrompt` hook) does NOT run the window-close capture sweep, so without `dismissShown` the shown capture would linger to the 2-min TTL. It is idempotent on a real window close (the sweep follows and finds nothing). `vault-lock` stays `dismissShown:false` per AC1 (`dropAllCaptures` follows).
- **D2 — 10 s timer starts when the prompt is SHOWN (after the first `:height`, or the 1500 ms fail-safe), not at `present()`.** AC4 says "each present() starts a fresh 10 s"; starting at show gives the operator the full 10 s of a visible prompt and is what the behavior spec's Step 5 wording ("the timer starts at presentation") needs. Pause inputs still apply from the moment it runs.
- **D3 — The deferred hide after a natural result-timer close only; every other close (tab/lock/teardown/dismiss/timeout) hides synchronously.** AC5 asks the deferral for result states; AC8's squawk-0100 ordering needs the other closes synchronous. A new `present()` cancels a pending deferred hide.
- **D4 — Result-only models (interim locked path) carry their own hold/close-reason table in the manager** (`unchanged` 2500 ms→`dismissed`; `expired`/`tab-changed` 4000 ms→`expired`; `locked`/`error` 4000 ms→`dismissed`). `tab-changed` text is "Not saved — the tab changed". Result-only `present()` still goes through gate 2 (active tab) but skips gate 3.
- **D5 — `save-prompt:save` returns the manager's `{saved, reason?}` on success paths and `{saved:false, reason:'refused'}` for any failed guard** (no secret either way). The page ignores the reply; state is driven by main-pushed events.
- **D6 — `chrome-preload.js`/`renderer-globals.d.ts`**: `vaultCaptureFinalize`'s declared return widened to include `{ reason }` (it always returned that; the typedef lagged).
- **D7 — `toast` is still ACCEPTED (not destructured) by `createVaultController`.** `renderer.js` passes it and is at its line budget; the chrome no longer uses it (the sheet-era toasts were invisible behind a guest anyway). Type kept in the JSDoc.
- **D8 — Chrome-side pre-check of "a sheet is open" covers only the vault controller's own `overlayStates`** (the other controllers' flags live in `overlay-menus.js`, unreachable without touching `renderer.js`). Main is the authority (`sheet-open`), so this only avoids a pointless round trip; documented in the code.
- **D9 — `CLIENT_HANDLED_REASONS`/`DEFERRED_REASONS` exported from `save-prompt-client.js`** are the chrome-side half of the AC1 drift test (every table reason is handled or explicitly deferred to Leg 2). The chrome applies the shared table; it hard-codes no reason branch.
- **D10 — Fixture capture mode uses a `name`-less GET form** (`capture.html` → `landed.html`) so neither credential reaches the URL or the static server log; the scanner keys off type/autocomplete + the trusted gesture. `index.html` is byte-unchanged. If the live AC29 step shows the scanner needs `name` attributes, add them and accept the query string (throwaway unique credentials).
- **D11 — Test helper `test/helpers/fake-overlay-registry.js`**: `registerOverlayIpc` now delegates sender resolution to `registry.recordForOverlaySender` (AC18 extraction); 11 offline overlay suites built minimal fake registries, so they are wrapped with this helper (same identity lookup). No test semantics changed.

---

## Deviations

- **AC2 "stays green across the whole suite" for the focus tripwire**: implemented as a throwing `focus()` on the fake view in `test/helpers/save-prompt-fakes.js`, shared by every suite that builds a manager — not a per-file fake.
- **AC13 "ONE helper"**: `closeSavePromptAndDrop` is exported from `register-tab-ipc.js` and `html-fullscreen.js` requires it from there (`html-fullscreen.js` → `register-tab-ipc.js`; no cycle, `register-tab-ipc.js` only receives the fullscreen module by injection).
- **AC19 "pre-checks the overlay `states[*].open` flags"** narrowed to the vault controller's own states (D8).
- **AC15 test of `onLock`**: the spec's `runVaultLockTeardown({ records, vaultHuman, closeSheets, broadcast })` shape is implemented verbatim in `src/main/vault-lock-teardown.js`; the source pin is a regex over comment-masked `main.js` with a built-in mutation check.
- **"1 of N"**: `queue.total` counts the offers still waiting AT OPEN TIME (resolved queue + pending-locked). A prompt that opens before its siblings arrive shows no counter (`total` 1); it is not live-updated. Accepted for Leg 1; the HAT should judge.

---

## Anomalies

For the Flight Director to log as squawks / HAT items (none fixed in this leg):

- **A1 — Find bar opened AFTER a visible prompt overlaps it.** The geometry stacks the prompt below the find bar only if the find bar is visible at `computeBounds` time; opening find later re-raises the find overlay ABOVE the prompt at the same top-right corner. No live re-position hook exists (`findOverlay.show()` does not notify the prompt). HAT item (find-bar stacking); fix candidate: a `findVisible` change notification into `rec.savePrompt.syncBounds`.
- **A2 — Anchor freshness is unit-proven only** (observer/resize re-send, live-zoom conversion). Pin-toggle hide, chrome zoom and window resize are by-eye (deferred to HAT per AC11/AC29).
- **A3 — A `tab-hide` for a BACKGROUND tab also drops that tab's held captures** (the helper drops unconditionally per DD5 "tab hide"). Consistent with the spec; worth a HAT look if the chrome ever sends `tab-hide` for panel swaps (welcome/crash/load-failure) on an active tab.
- **A4 — The AC25 automation guard is UNIT-PROVEN ONLY** (as the leg states). No live MCP op can obtain the prompt's wcId because the census omits it; it is defense in depth, not live-verified. An absent `isSavePromptContents` injection at admin is NOT refused by any other guard (documented + grep-pinned at both main.js sites; the app-lifecycle dev seam does not set `allowInternal`, so it is refused there by guard 5 and I did not thread the predicate into that seam).
- **A5 — `captureSave` early failures** (e.g. card update whose item vanished) drop the record without a result flash for the chrome-only path; the prompt shows `This save request expired` only because the manager treats `saved:false` with no reason as expired. No defect, noted for the HAT.
- **A6 — `test/unit/vault-controller-capture.test.js` keeps one sheet-era regression case** (`handleClosed({ menuType: 'vault-capture', reason: 'superseded' })`) as a no-op pin; it is judged exempt in the AC24 list.

---

## Session Notes

### 2026-11-04 — Planning
- Qualified as a sortie: one outcome (the save prompt stops blocking the page), one cluster of decisions (the floating surface, timer semantics, focus), one flight. No active mission covers it.
- Operator scope calls: BOTH lock states get the corner prompt (not just the locked one); a timeout DROPS the held credential (no toolbar reopen badge).
- Mockup approved: https://claude.ai/artifact/EZGk1AegmbB1grdKi3wrTc
- Code interrogation findings that shaped the design:
  - The menu-overlay sheet always covers the full guest and swallows clicks.
  - There is one sheet per window, so any other menu would supersede the prompt and drop the capture.
  - The toast layer is invisible behind a guest.
  - Locked captures can't be saved before `captureFinalize`.
  - Offers carry no `wcId`.
- Operator interaction calls: tab switch **drops** the prompt; **F6** reaches it; a locked save that turns out to be an update **re-asks** in the corner.
- Design review 1 (Architect): **approve with changes**, 5 high / 6 medium / 3 low. All 14 issues were folded into the spec:
  - The fixture can't produce an offer, so a fixture extension became a Leg 1 deliverable.
  - F6 really lives in `handleCrossView` / `cross-view-nav.js`.
  - The fail-closed automation guard needed an actual mechanism (`isSavePromptContents`).
  - Queued or visible locked offers after unlock are now converted in place.
  - Deferral has a single owner (the chrome queue), with "sheet visible" added as a pause input.
  - Squawk-0100 ordering is carried to the sites that would hit it.
  - Hide/restore matrix added.
  - Main-side drops now push `vault-capture-dropped` to the chrome.
  - Consent has a defined lifecycle and security pins.
  - Anchor freshness is declared.
  - Legs re-split: F6 and the announcement moved to Leg 2.
  - `savePromptPaused` added to the census.
  - DD8 retirement checklist enumerated.
- Design review 2 (Architect, final pass): **approve with changes**. All 14 prior issues are resolved (two only partially; both closed by this pass's fixes). It raised 12 new items (3 high, 5 medium, 4 low), all folded in:
  - N1 (high): Leg 1 would have left the locked path with no surface. Minimal convert-in-place moves into Leg 1 as the interim locked path.
  - N2 (high): extend the existing `vaultCaptureFinalize` rather than adding `vaultCaptureComplete`.
  - N3 (high): the refocus rule now applies only to `saved` / `dismissed`.
  - N4: main is authoritative for "a sheet is visible" (`save-prompt:open` refuses, never queues).
  - N5: unlock in another window converts every window's locked prompt.
  - N6: an unlock-abandonment row was added to the close table, unit-pinned.
  - N7: Leg 2 was split. F6 and the announcement became Leg 3, and the P3 probe moved to Leg 1.
  - N8: click-focus semantics stated.
  - N9: the anchor is re-sent on zoom changes.
  - N10: behavior-spec mechanics tightened.
  - N11: CSS ↔ builder class drift guard.
  - N12: explicit `renderer.js` ≤ 1505 AC.
  - Suggestion adopted: a pure `savePromptCloseEffects(reason)` table as the single source for per-reason effects.
- Sortie gate re-check: the leg count is now **3 + HAT**, over the soft limit of 2 + HAT. It is still one decision cluster (the non-blocking prompt's surface, lifecycle and interaction). Raised with the operator.
- Operator: **keep as a sortie at 3 legs + HAT** (the Architect's recommendation; one decision cluster, no escalation). No screen reader is available, so P3 is recorded as unverified and both announcement paths ship.
- Status → **ready** (2026-11-04). Execute with `/mission-control:agentic-workflow sortie 06`.

### Flight Director Notes
- 2026-11-04 Execution start: `/mission-control:agentic-workflow sortie 06`. Phase file `.flightops/agent-crews/leg-execution.md` loaded and valid (Crew / Interaction Protocol / Prompts). ARTIFACTS.md defines no transition-time handling. Branch `sortie/06-non-blocking-save-prompt` created off `main` `7cdbb4e`. Flight status ready → **in-flight**.
- Leg 1 risk tier: **HIGH**. It adds a new security-sensitive chrome-class view, an automation guard, a vault channel carrying four guards, and lifecycle changes across tab, window and lock. It also reverses a prior design: it retires the `vault-capture` sheet. Developer design review (Sonnet) is spawned.
- Leg 1 **deviation, spikes at landing rather than first**: P1/P2 run on the real surface at Leg 1 landing, with the operator watching, before Leg 2 is designed, rather than via a throwaway spike harness. Rationale:
  - The Flight Director may not write spike source, and a separate spike leg was not in the operator-approved 3+HAT shape.
  - The find overlay already proves that a content-sized view over a live guest renders on WSLg, which bounds the P2 risk.
  - P1's fallback is localized to one manager seam (Leg 1 AC9).
  - A P2 Divert still lands before any Leg 2/3 work.
- Leg 1 design corrections to the flight's DD citations (found while re-reading the code):
  - `onLock` calls `dropAllCaptures` BEFORE `closeVaultCredentialSheetsOnLock`. With the new `vault-capture-dropped` push, the prompt must close `vault-lock` first (AC15).
  - Overlay views are built in `window-factory.js`.
  - Spec precondition "no stored login for the origin" is replaced by "a unique username + password per step", because the fixture builder seeds a login for the origin (AC27).

- Leg 1 design review 1 (Developer, Sonnet): **approve with changes**. There were 0 high-severity items, 9 medium and 5 low, plus 6 questions. All are folded into the leg (the Design review 1 note in its Citation Audit).
- FD rulings:
  - moved-tab captures drop;
  - losing a capture still waiting on navigation, when a login opens a foreground new tab, is the accepted DD5 consequence, documented;
  - the window-blur pause input is event-only (never seeded from `isFocused()`, which is unreliable on WSLg);
  - `present()` refuses during HTML fullscreen;
  - the interim locked path gets a by-eye live step;
  - the active-tab gate lives main-side at both offer sends (zero `renderer.js` lines).
- The changes are substantive, so a second, scoped review is spawned (cycle 2 of 2).
- Leg 1 design review 2 (Developer, Sonnet, final cycle): **approve with changes**: 1 high, 3 medium, 3 low. All are folded in:
  - (high) result-only prompt models skip the capture↔tab gate, because their record is already dropped;
  - `recordForOverlaySender` is extracted to the registry;
  - supersession closes the prompt silently, not as "expired".

  Leg 1 status → **ready**. `[HANDOFF:review-needed]`: the leg design is finalized. A Developer (Sonnet) is spawned to implement.
- Leg 1 `[LAND:leg]` received. Developer reports:
  - 6229/6233 pass, 0 fail, 4 todo;
  - typecheck, lint and format are clean;
  - `renderer.js` is 1504 lines;
  - 63 tracked files changed.
- AC29 live session (FD, 2026-11-04):
  - Throwaway profile at scratchpad `live1/prof` (the app appends `-dev`), seeded by `build-fixtures.mjs`.
  - Fixture served on 127.0.0.1:8099; `capture.html` and `landed.html` both return 200.
  - Launched with `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation -- --user-data-dir=…`. The mint line was captured, and attached via a `connectAutomation()` env-key script (not the registered `goldfinch-dev` server).
  - **Step 1 apparatus probe: PASS.**
    - `tools/list` has 35 tools, including `click`, `typeText`, `evaluate`, `enumerateWindows`, `captureWindow` and `readDom`.
    - `enumerateWindows` rows carry `savePromptVisible:false` and `savePromptPaused:false` before any view was created, as specified (no wcId exposed).
    - `enumerateTabs`, `openTab` (jar-a), `evaluate`, `readDom`, `closeTab` and `captureWindow` (image) all work against the new build.
    - `document.hasFocus()` is false until the operator clicks the window, which is the spec's halt condition.
- AC29 live results, continued:
  - **Run 1 (unlocked): PASS.** The census showed `savePromptVisible` true 0.3 s after a trusted submit, with `sheetVisible` false throughout. The prompt timed out on its own at 10.5 s. The page navigated to `/landed.html`. The operator, by eye: placement and look fine, no flicker on appear or disappear (**P2 pass** for appear and timeout).
  - **Run 2:** the vault had idle-locked between runs, so the submit raised the unlock sheet (the interim locked path, as designed). The operator unlocked by hand.
  - **ANOMALY A7 (real defect, not test fragility): after unlock NO corner prompt appeared.** The census afterwards showed no prompt and no sheet. AC29 step 4 FAILED.
    - Cleared during first diagnosis: `overlay-menus.js` clears `state.open` before `onClosed`, so `advance()`'s `anyVaultSheetOpen()` pre-check is not stuck.
    - Not yet traced. Candidates:
      - close and lock-state ordering (an unlock-sheet close handled while `lockState.unlocked` is still false would run the abandon drop);
      - a `save-prompt:open` refusal (`invalid-model` / `not-active`) on the finalized model, which is dropped silently;
      - a present-then-immediate close.
    - Diagnose with `GOLDFINCH_VAULT_TRACE=1` plus a unit reproduction.
  - **Operator ruling (2026-11-04):** "maybe we leave this for the hat, these tests seem fragile". The remaining AC29 live steps (P1 hover, the Variant A behavior-test run) are **deferred to the HAT leg**. A7 is carried into **Leg 2** as its first AC (reproduce plus fix), because Leg 2 replaces the interim locked path's post-unlock drain, and that drain shares the finalize → `save-prompt:open` path. Leg 1 lands with AC29 recorded as partially run (step 1 PASS, run 1 PASS, step 4 FAIL → Leg 2, rest → HAT).
  - The dev app and fixture server were stopped. The throwaway profile stays in the scratchpad.
- A7 hypothesis (FD, from reading the landed code plus timing). The operator's unlock came minutes after the 20:31:26 submit, past `CAPTURE_DROP_MS`.
  - The TTL drop fired `onCaptureDropped` with `offered:true` (locked offers are released through `captureRelease`). Main pushed `vault-capture-dropped`. The chrome removed the `pendingCaptureUnlock` entry. The unlock then drained nothing, with no "expired" notice.
  - Main-side order on a successful unlock was verified: the lock-state broadcast arrives before the unlock sheet's close, so the abandon-drop race is ruled out.
- Leg 2 `locked-save-handoff` designed (status planning). AC1 reproduces A7 first and fixes it: a consented entry is marked `expired` rather than removed. Every live run is a HAT step, per the operator ruling.
- Leg 2 risk tier: **HIGH**. It is a security boundary (a vault write behind consent), extends the finalize channel's guards, and changes the lifecycle. A Developer design review (Sonnet) is spawned.
- Leg 2 design review 1 (Developer, Sonnet): **approve with changes**: 3 high, 6 medium, 4 low. The review confirmed the A7 TTL mechanism on the code (`offered` is true for locked offers; the drop push silences the "expired" that `captureFinalize` would otherwise return).
  - All items are folded in; see the leg's Design review 1 note.
  - The FD **skipped review cycle 2**. Every fix was corrective with a concrete mechanism, there was no redesign, the flight-end Reviewer covers the code, and the security pins are enumerated (AC10 items 1-12).
  - Leg 2 status → **ready**. `[HANDOFF:review-needed]`: the design is finalized. A Developer (Sonnet) is spawned to implement.

## Leg 2 Developer log (locked-save-handoff)

### Leg Progress
- Leg 2 status ready -> **in-flight**.
- **AC1 red run (INTERIM path, before any other change)**: new `vault-controller-capture.test.js` case "A7 (AC1): a TTL drop while the unlock sheet is up marks the entry EXPIRED ..." (locked offer -> `onVaultCaptureDropped` -> `vault-lock-state {unlocked:true}` -> unlock sheet channel-7 close) FAILED as hypothesized: `h.prompts.length` 0, expected 1 ("the operator typed a master password: the corner must answer"; `0 !== 1`). The TTL-drop mechanism is confirmed; no `[BLOCKED:a7-unexplained]`. The `.catch` hardening test also failed red (queue wedged).
- Checkpoints (a)-(f) done in order; `npm test` + `npm run typecheck` green at each. (a) A7 fix: `forgetCapture` marks a `pendingCaptureUnlock` entry `expired` (drain presents `{result:'expired'}` without finalize; `presentationQueue` entries are still removed) + `.catch` on the present chain. (b) vault-human: locked login/card offers carry `choices`/`defaultVaultId`; `captureConsent`; `rec.consent`/`rec.disposed`/`rec.downgraded`; consented write in `captureFinalize`. (c) `save-prompt:consent`, `saved` result kind, locked models admitted, traces, finalize sender + active-tab gates. (d) manager `beginConsent`/`endConsent`/`consentGranted`, dynamic `saved` result; page "Unlock & save"/"Unlock & review", lock note, preload `consent`. (e) chrome flip. (f) docs + gates.
- **Final gates**: `npm test` 6274 tests / 6270 pass / 0 fail / 4 todo; `npm run typecheck`, `npm run lint`, `npm run format:check` all clean; `src/renderer/renderer.js` 1504 lines (budget 1505); `SEAM_COUNT` untouched.
- New tests: `vault-capture-consent.test.js` (11), `save-prompt-consent.test.js` (13), `capture-save-allowlist.test.js` (1); extended `vault-controller-capture.test.js`, `register-browser-ipc.test.js` (finalize owner/active-tab), `save-prompt-ipc.test.js`, `vault-capture.test.js`, `vault-capture-template.test.js`, `save-prompt-page.test.js`.

### Decisions
- **Inverted/renamed Leg 1 tests** (not deleted; all in `vault-controller-capture.test.js`): "a LOCKED capture raises the unlock prompt..." -> "a LOCKED offer presents in the corner (locked model) and raises NO sheet"; "the unlock prompt still drops..." -> "the unlock sheet still drops the consented credential..."; "a successful unlock finalizes the held capture" -> "...the consented capture"; "every unlock-prompt close..." -> "every unlock-sheet close ... while still locked"; "AC21 resolved model", "AC21/AC19 finalize reasons", "AC21 sheet-open retry", "AC8 (interim) abandoned", "finalize never fired while locked" re-seeded via `onSavePromptClosed{unlock-requested}` (the `consentLocked` helper). The original A7 red test became the consented variant (AC1.3). Also inverted: `save-prompt-ipc.test.js` "locked ... refused" -> locked admitted; `vault-capture.test.js` "capture LOCKED" `defaultVaultId` undefined -> 'work' (AC2).
- **Downgrade detection (AC10.11)**: `applyUsernameDowngrade` does NOT change the username (it stays null), so a username-equality check alone cannot detect it. Added a record flag `rec.downgraded = true` (stamped by the downgrade) and the consented plain-save condition requires `!rec.downgraded`, in addition to origin/username/kind equality. Conservative: a downgraded disposition re-asks.
- `captureConsent` refusal reasons: `expired` (no record), `unlocked`, `refused` (record not `locked`-mode / unknown family), `bad-vault`. Consent on an identity requires `vaultId == null`.
- Finalize chrome map: finalize reasons outside {unchanged, expired, tab-changed, locked, error} speak as `error`; `refused` presents nothing and dismisses the entry. `finalizing` is a Map captureId -> shared promise (a concurrent second caller shares the first's promise rather than issuing a second invoke).
- The registered `labelChoice` (already returned by `createSavePromptClient`) is used for the `saved` vault label; no export/move needed.
- Convert-in-place of a queued locked head is done BEFORE the `anyVaultSheetOpen()` check (finalizing presents nothing).
- Finalize owner-gate in the existing `register-browser-ipc.test.js` harness: the chrome sender's `getWindowForChrome` now returns the same `ownerRecord` as `getWindowForGuest(5)` (previously a fresh object per call), plus a second window for the foreign-sender case.
- **AC10 `captureSave(` allowlist hits judged** (`rg -n "captureSave\(" src/`, comments excluded by the pin): `src/main/window-factory.js:335` (delegate bound to the manager's dep: the `:save` path) - legit; `src/main/save-prompt-manager.js:679` (the manager's single call in `save()`, after the four IPC guards) - legit; `src/main/vault/vault-human.js:1598` (the consented finalize, gated on `rec.consent`) and `:1679` (the definition) - legit. Pinned `{window-factory:1, manager:1, vault-human:2}` in `capture-save-allowlist.test.js` (throws on zero).
- Security boundary: the design kept the write behind the guarded consent record (no `[BLOCKED:consent-boundary]`).

### Deviations
- The AC1 red test's literal text ("presents `{result:'expired'}`") is retained in the consented variant; the interim-path (`pendingCaptureUnlock` at arrival) form no longer exists after AC4, so only the consented form runs now. The red run on the interim path is recorded above.
- `save-prompt-manager.test.js` was not extended: the manager's consent/`saved` behavior is covered through the real manager in `save-prompt-consent.test.js`.

### Anomalies (for the Flight Director)
- None blocking. Observation: `window-factory.js` `onCaptureDropped` for a VISIBLE locked prompt flips it to the `expired` result (existing Leg 1 behavior); consistent with the A7 intent, but not live-verified (HAT).
- Live HAT items still owed (deferred by operator): Variant B by eye; "Unlock & save" -> sheet -> "Password saved to ..."; unlock in another window converting; expired-after-unlock; P1 hover.
- Leg 2 `[LAND:leg]` received. Developer reports:
  - 6270/6274 pass, 0 fail, 4 todo; typecheck, lint and format clean; `renderer.js` at 1504 lines.
  - **A7 reproduced red on the interim path exactly as hypothesized** (0 prompts presented), then fixed.
  - The `captureSave(` allowlist is pinned (`window-factory` 1, `save-prompt-manager` 1, `vault-human` 2). No consent-boundary block.
- Leg 3 `keyboard-and-announce` designed (status planning).
  - FD decision: prompt keys are read main-side from the prompt view's trusted `before-input-event` (the `createSheetView` precedent) instead of DD2's page→main `save-prompt:key` channel. The page cannot spoof them, and the flight's acceptable variations allow channel changes.
- Leg 3 risk tier: **HIGH**. It changes a shared mechanism (the F6 cross-view routing, focus, a live region). One Developer design review (Sonnet) is spawned.
- Leg 3 design review 1 (Developer, Sonnet): **approve with changes**: 2 high, 6 medium, 4 low. Folded in as binding rulings R1-R11 in the leg:
  - the in-module registry lookup (no new dep);
  - eligibility decided before `preventDefault`;
  - the current-focus rule and capture order in `close()`;
  - Esc a no-op outside the offer state;
  - the `focusActiveGuest` extraction;
  - Shift+F6 into a taken-over tab falls back to `focus-content`;
  - a single `focusPrimary` site, with restore after a model-replace;
  - the announcement wording and `setTimeout` re-announce;
  - DD2 amended.

  The FD skipped cycle 2 (both highs resolved concretely). Leg 3 status → **ready**. `[HANDOFF:review-needed]`. A Developer (Sonnet) is spawned to implement.

## Leg 3 Developer log (keyboard-and-announce)

### Leg Progress
- Leg 3 status ready -> **in-flight** -> **landed** (not completed; no commit). `.flightops/ARTIFACTS.md` defines no transition-time handling for this project.
- Implemented per R1-R11: `src/main/save-prompt-keys.js` (pure `savePromptKeyAction`), `src/main/focus-active-guest.js` (R5; `tab-focus-guest` now `return focusActiveGuest(rec)`), manager `canFocusPrompt`/`focusPrompt`/`canDismissByKey`/held-focus + injected `focusActiveGuest`, the prompt view's `before-input-event` (`attachSavePromptKeys` at the manager construction site in `window-factory.js`), the in-module guest->prompt hop in `guest-wiring.js` `handleCrossView`, `refocusGuest: true` for `saved`/`dismissed`, the page `focusPrimary`/`onFocusFirst`/own status node, preload + `.d.ts`, `#save-prompt-status` in `index.html` + `savePromptAnnouncement` (shared, in `vault-capture-template.js`) + client write.
- **Gates**: `npm test` 6314 tests / 6310 pass / 0 fail / 4 todo; `npm run typecheck`, `npm run lint`, `npm run format:check` clean; `src/renderer/renderer.js` 1504 lines (budget 1505, untouched); `SEAM_COUNT` untouched.
- **AC9**: `git diff -- src/renderer/chrome/shortcut-controller.js` is EMPTY (0 bytes). `focus-content` (incl. the `focusLoadFailureHeading` branch) and `focus-chrome-end` are unmodified; R6's taken-over fallback reuses `focus-content` as-is. `test/unit/live-region-pin.test.js` pins the six existing regions' exact role/aria-live/aria-atomic (read from the current `index.html`: `#toasts` polite+atomic=false; `#media-status`/`#tab-status`/`#suggest-status` polite; `#zoom-percent` `aria-live="off"`; `#hang-notice` role=status only) and that `#save-prompt-status` is a self-closed sibling after `#suggest-status`.
- **AC10 - P3 UNVERIFIED**: no screen reader was available; the polite region in a non-focused chrome while the guest holds focus is NOT confirmed spoken. Both announcement paths ship (chrome region with "Press F6 to respond", prompt's own `role="status"` without it). The AC is unit/DOM level only. Recorded in `docs/vault.md`; carried to the debrief. HAT: F6 discoverability by eye, possible double speech.
- New tests: `save-prompt-keys.test.js`, `focus-active-guest.test.js`, `live-region-pin.test.js`; extended `guest-wiring.test.js` (8), `save-prompt-manager.test.js` (11, incl. the one-`webContents.focus(` source scan with a mutation), `save-prompt-close-effects.test.js`, `save-prompt-page.test.js`, `save-prompt-client.test.js` (3, MockTimers), `window-factory.test.js` (8, real handler); `guest-visibility-invariant.test.js` retargeted (see Decisions). `test/helpers/save-prompt-fakes.js` gained `allowFocus` (arms the throwing fake focus for `focusPrompt` tests only), a `focusActiveGuest` fake and `guestFocuses`.

### Decisions
- Keys read main-side (leg Context); DD2 annotated (R11) in `flight.md`; `cross-view-nav.js` header comment updated. No other F6-cycle doc exists (`docs/` has none), so `cross-view-nav.js` + `docs/vault.md` + a CLAUDE.md clause carry it.
- `guest-visibility-invariant.test.js` previously pinned `guestTakenOver(entry)` inside the `tab-focus-guest` body; retargeted to assert the handler is `return focusActiveGuest(rec);` and that `focus-active-guest.js` carries `guestTakenOver(entry)` (the pin's intent - the refusal - preserved, not deleted).
- Announcement wording: `savePromptAnnouncement(model, {withHint})` in `vault-capture-template.js` (KIND_TABLE nouns). Identity: save -> "Save your details for H?", update with changes -> "Update your saved details for H?", gap-fill -> "Add to your identity for H?" (the leg's literal phrase). Host from `new URL(origin).host`; empty origin omits the "for ..." clause.
- Esc/consent: `canDismissByKey()` false while saving/consenting/settling/result -> Esc is `preventDefault`ed and a no-op (R4). When the prompt is not visible, the handler returns before touching the key, so Esc reaches the page.
- Held focus: set from the prompt webContents `focus`, cleared on `blur`, on window blur and on view teardown; `close()` captures it at its top. For a deferred (result) close the refocus runs inside the deferred-hide callback after `hide()`; if a new prompt arrived before it fires, the refocus is skipped.
- Vault choice is a radio group (R10), so Esc simply dismisses the prompt; nothing extra to record.
- The `focusActiveGuest` throw-guard: manager wraps the injected call in try/catch so a destroyed-guest race can never wedge a close.
- Page restore: `hadFocus` is recorded before the model-replace repaint and `focusPrimary()` is re-run after it; skipped for result-only inits.

### Deviations
- AC1's "absent `savePromptFor` dep" case became "a record with no `savePrompt` / popup guest with no record" per R1 (tested).
- The internal-guest guest-wiring case only asserts the unchanged path for a non-matching prompt wcId; internal guests share `handleCrossView`, so no separate branch exists to pin beyond that.

### Anomalies (for the Flight Director)
- None blocking. HAT items owed (operator ruling, no live steps run this leg): F6 from page lands on the primary button with a visible focus ring; F6 again -> address bar; Shift+F6 -> page; Esc closes and returns focus to the page; Tab cycles inside; timer pauses while focused; P3 spoken output; possible double speech between the chrome region and the prompt's own status node.
- Observation: refocus after a `saved` close relies on the prompt webContents' `focus`/`blur` events firing reliably for a `WebContentsView` on WSLg/Wayland; if they do not, the refocus silently never happens (fail-safe: no focus steal). Verify at the HAT.
- Leg 3 `[LAND:leg]` received. Developer reports:
  - 6310/6314 pass, 0 fail, 4 todo; typecheck, lint and format clean; `renderer.js` at 1504 lines;
  - `shortcut-controller.js` diff empty (AC9); P3 recorded as unverified.
- legs_completed = 3/3 autonomous legs. Phase 2d: the flight-end Reviewer (Sonnet, no Developer context) is spawned over ALL uncommitted changes vs `main`. The Accessibility Reviewer is disabled in `leg-execution.md`, so it is not spawned; its concerns (the DD3 live region, F6) are covered by AC9's shared-mechanism pin and the HAT.
- Flight-end Reviewer (Sonnet): **`[HANDOFF:confirmed]`** with no blocking and no non-blocking issues. It re-ran the gates itself: 6310/6314 pass, 0 fail, 4 todo; typecheck, lint and format clean. It checked security items (a) through (f).
- The Reviewer did not trace the finalize guards or the `captureWindow` exclusion line by line, so the FD spot-checked both:
  - `vault-capture-finalize` (`register-browser-ipc.js` ~335-360): capture→tab, then owner record === caller record, then active tab, then `captureFinalize`.
  - The consented write (`vault-human.js` ~1580-1598): requires a plain `save`, login/card only, `!downgraded`, `consent.vaultId ∈ rec.choices`, and origin/username/kind equal to the consented offer.
  - The `captureWindow` exclusion is pinned (`save-prompt-automation-guard.test.js` ~229-235).
- Legs 1-3 → **completed**. Single flight commit next; the HAT leg follows.

### Leg 4 (HAT) — session 1, 2026-11-05 (paused before H12)
- FD relaunched a fresh fixture profile (`GOLDFINCH_VAULT_TRACE=1`) and drove submits via env-key scripts; operator watched and drove keyboard/mouse. H1–H11 passed; detail in `legs/04-hat-and-alignment.md` → HAT Progress.
- **A7 confirmed fixed live (H8)**: a >2 min unlock now shows the expired notice in the corner.
- **A1 operator ruling**: accepted as a known issue (find bar opened after the prompt overlaps its title/✕; recoverable). Carry to debrief.
- **Fix-vs-feature calls**: none needed; no code changes this session.
- **Out-of-scope defects** (squawks to file at HAT end, not folded into this sortie): WSLg HTML-fullscreen mis-render/shift (control-reproduced with no prompt; Windows build unaffected), and Esc not exiting HTML fullscreen on the Windows build.
- Apparatus note: keyboard focus in the find overlay starves MCP `typeText` into the guest (a submit with the find bar focused produced no capture at all) — an apparatus limit, not a product defect.

### Leg 4 (HAT) — session 2, 2026-11-05 (complete)
- H12 passed for resize and page zoom; the unpin and chrome-zoom sub-steps were unreachable by design of the existing toolbar (FD leg-design gap, recorded in the leg; anchor freshness for those inputs remains unit-test-only, A2).
- H13 recorded UNVERIFIED (no screen reader).
- Squawks 0170 and 0171 logged and deferred (out-of-scope fullscreen defects found in H11).
- No code changes during the HAT; no fix-vs-feature calls arose. Leg 4 → completed.
- **Debrief carry-forward**: P3 unverified; A1 accepted (find bar opened after the prompt overlaps it); A2 (unpin/chrome-zoom anchor freshness unit-test-only); DD5 (a login opening a foreground new tab loses its offer); F6 needs Fn on the operator's keyboard (not a defect, but discoverability); HAT-design miss on unreachable sub-steps.
- HAT coverage gaps vs the flight's leg line (for the debrief): only the LOGIN kind was exercised by eye (card/identity offers rely on unit tests), and the two-window variant of H9 was not run (H9 used the key-icon unlock route).
- Phase 3: all four legs `completed`; CLAUDE.md, `docs/vault.md` and `docs/mcp-automation.md` were updated by the Leg 1–3 Developers and confirmed by the flight Reviewer; no new commands/config. Flight → `landed`. `[COMPLETE:flight]`.
