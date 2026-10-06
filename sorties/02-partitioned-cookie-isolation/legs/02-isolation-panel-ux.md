# Leg: isolation-panel-ux

**Status**: completed
**Flight**: [Partitioned-cookie-aware third-party isolation](../flight.md)

## Objective
Make the privacy panel and `goldfinch://settings` tell the truth about restart-to-apply cookie isolation. This covers:
- what is in force versus what is configured;
- the restart-pending state at both the master switch and the isolate row;
- the browser-wide note for paused sites;
- a guarded **Restart now** action;
- a privacy panel that no longer destroys focus on every network push.

The leg finishes with the full `third-party-cookie-isolation` behavior run.

## Context
- Flight DDs in scope: DD4 (UI half), DD5, DD6 (display), DD11. Leg 01 landed the main side: the `shields-isolation-state` / `internal-shields-isolation-state` channels return `{ isolateEffective, operatorOverride }`, with preload entries and `.d.ts` typings, and `decideStartup` lives in `src/main/third-party-cookies.js`.
- **Leg 01 live findings that drive this leg** (flight log, AC11 run 2026-10-06-01-29-15):
  - Switching isolate off makes the row's count **vanish** and shows no restart copy, while isolation is demonstrably still enforced (DD6 gap).
  - The always-visible "Reload to apply" footer could be confused with restart copy.
  - A `:has(.shield-count)` selector misses the row when its count element is removed. Rows need `data-shield` keys.
- **Shared mechanism this leg changes:** the privacy panel's render/refresh cycle (`renderPrivacy()` → `body.innerHTML = ''` on every `onPrivacyNet` push and every `shields-changed`). Per the CLAUDE.md shared-mechanism rule, every other section rendered by that cycle must be asserted unaffected: Jar/identity, Connection, Trackers, Third-party domains, Cookies, Fingerprinting, Permissions.
- `src/renderer/renderer.js` is exactly at `RENDERER_LINE_BUDGET` (1546), so **no `renderer.js` edits** and `SEAM_COUNT` stays 41. `privacy-controller.js` already calls `window.goldfinch.*` directly.

## Inputs
- `src/renderer/chrome/privacy-controller.js`:
  - `shieldsConfig` loaded via `shieldsGet` and refreshed on `onShieldsChanged`;
  - `SHIELD_ROWS`, `pShields()`: `const dim = !cfg.enabled || paused`, with the count shown only when `cfg[key] && !dim && eff[0]`;
  - the "Reload to apply" footer;
  - `renderPrivacy()` clears `body.innerHTML = ''` and rebuilds every section.
- `src/renderer/pages/settings.html`: the `#privacy` fieldset, with checkboxes `#shield-enabled|block|strip|isolate|farble` and the note "These are global Shields defaults, applied to every site."
- `src/renderer/pages/settings.js`: the shields controller (`KEYS`, `applyConfig`, `shieldsGet`/`shieldsSet`/`onShieldsChanged`, pagehide `off…`). It imports shared modules with flat specifiers (e.g. `./default-browser-row-model.js`), each with an `internal-page-map.js` route and a `<script type="module">` tag.
- `src/main/register-settings-ipc.js`: the leg 01 isolation-state pair. `src/main/app-lifecycle.js`: the bare `ipcMain.on('app-quit', () => app.quit())`. `src/main/window-registry.js` `getWindowForChrome(sender)`.
- `src/main/settings-store.js`: `restoreSession` (default `true`).
- Tests: `test/unit/privacy-controller.test.js`, `test/unit/settings-page-shared-scripts.test.js`, `test/unit/register-settings-ipc.test.js` (exact channel-list pin, plus harness), `test/unit/third-party-cookies.test.js`.

## Outputs
- **New `src/shared/shields-isolation-model.js`** (ESM, pure, DOM-free, never throws, indicator-model pattern). It exports:
  - `effectiveAfterRestart(cfg, operatorOverride)`: `'disabled'` → false; `'enabled'` → true; otherwise `!!cfg.enabled && !!cfg.isolate`.
  - `isolationModel({ cfg, isolateEffective, operatorOverride, paused })`, returning:
    - `inForce` (= `isolateEffective`);
    - `restartPending` (= `effectiveAfterRestart(...) !== isolateEffective`);
    - `pendingDirection` (`'on'|'off'|null`);
    - `isolateRow: { dim, showCount, note }`:
      - `dim` = `!inForce` (never keyed to `cfg`/pause while in force);
      - `showCount` = `inForce`;
      - `note` is a copy key: `'browser-wide'` when in force and the site is paused; `'stays-on-until-restart'` / `'turns-on-after-restart'` when restart is pending; else null;
    - `masterNote`: `'isolation-stays-on-until-restart'` when `!cfg.enabled && inForce`; else null;
    - `copy`: a frozen map from key to exact user-facing string, single-sourced here.
- **Drift guard** (`test/unit/shields-isolation-model.test.js`): for every `(enabled, isolate, operatorOverride)` combination, `effectiveAfterRestart` equals leg 01's `decideStartup({ configured: isolateConfigured(cfg), enableFeatures, disableFeatures }).isolateEffective`, with the operator flags built to match the override.
- **`privacy-controller.js`:**
  - Fetch `shieldsIsolationState()` once at init, beside `shieldsGet`. This follows the staleness contract (it is a process constant, re-fetched only on document load).
  - `pShields()` renders the isolate row from the model:
    - count shown, and not dimmed, while in force;
    - a note element (`.shield-note`) for browser-wide or restart-pending;
    - a **Restart now** control inside the Shields section whenever `restartPending`.
  - The master switch row shows the `masterNote`.
  - Every row carries `data-shield="<key>"`, the master row `data-shield="enabled"`.
  - **Footer copy:** "Reload to apply" stays (it applies `block`/`strip`/`farble` changes). A visible line beside it, "Cookie isolation changes need a restart", appears only while `restartPending`, so the two can't be confused.
  - **Patch in place (DD4 panel-rebuild fix):** see Round 1 amendment 5, which is authoritative. A persistent `shieldsNode` is always `body`'s first child and is never removed. Its children are always patched by key and never rebuilt. On rebuild, remove every `body` child except `shieldsNode`. `toggle()` returns an updatable handle (element plus `set(on)`), so switch class and `aria-checked` are patched in place, and its click reads live `shieldsConfig[key]`.
  - No restart copy sits in a live region. If the panel has an `aria-live` region, the note is outside it.
- **Restart now (DD11):**
  - `src/main/` gets a new Electron-free pure helper, `relaunch-options.js`: `relaunchOptions({ env })` **reads only `env.APPIMAGE`** and returns `{ execPath: env.APPIMAGE }` or `{}`. Electron 44 `RelaunchOptions` is `{ args?, execPath? }` with no `env`; default `args` is kept. The handler does the DEV_MINT strip by deleting `GOLDFINCH_AUTOMATION_DEV_MINT` from the injected **live** `env` (the real `process.env` object).
  - Two state-changing handlers in `register-settings-ipc.js`:
    - chrome: `ipcMain.handle('shields-restart-to-apply')`, sender-validated (`registry.getWindowForChrome(event.sender)` non-null, else refused);
    - internal: `registerInternalHandler(ipcMain, 'internal-shields-restart-to-apply')`.
  - Both take **no page arguments**.
  - **Business gate:** both re-check main-side `effectiveAfterRestartFromConfigured(shields.isolateConfigured(shields.get()), operatorOverride) !== isolateEffective`. `effectiveAfterRestartFromConfigured` is a CJS function in `third-party-cookies.js` that takes the configured **boolean**. If nothing is pending they return `{ ok:false, reason:'not-pending' }`. **On pass, the order is: delete `GOLDFINCH_AUTOMATION_DEV_MINT` from the live env → `app.releaseSingleInstanceLock()` → `app.relaunch(relaunchOptions(...))` → `app.quit()`** (the normal quit path, so `before-quit`/`will-quit` run). Releasing the lock first avoids the relaunched child losing `requestSingleInstanceLock()` to the still-exiting parent and silently exiting.
  - On pass they run the order stated above: delete `GOLDFINCH_AUTOMATION_DEV_MINT` from the live env, `app.releaseSingleInstanceLock()`, `app.relaunch(relaunchOptions(...))`, then `app.quit()` (the normal quit path, so `before-quit`/`will-quit` run).
  - The handlers receive `app`, `registry` and `isolateEffective`/`operatorOverride` via injected deps; no `require('electron')` in a new pure module.
  - Preload: `chrome-preload.js` `shieldsRestartToApply()`; `internal-preload.js` `shieldsRestartToApply()`. Both `renderer-globals.d.ts` interfaces gain it. The register test's channel-list pin and the harness are updated.
  - **Never admitted to automation:** there is no MCP op. Admin chrome `evaluate` can reach it, exactly like `appQuit`. That is accepted, and documented in a code comment.
- **Restart confirm (two-step, in-surface):**
  - The first click on Restart now changes it to a confirm state: button "Restart Goldfinch", plus an explanatory line "Goldfinch will close and reopen."
  - When `restoreSession === false` the line adds "Open tabs won't be reopened."
  - The confirm state reverts on any of the triggers in Round 1 amendment 7, plus a 6 s timeout and focus leaving the Shields section. A second activation invokes the channel.
  - Read `restoreSession` via the existing settings read (`settingsGet` in the chrome; `settings-changed` already flows to both surfaces).
- **`goldfinch://settings`:**
  - The `#privacy` fieldset shows the same model-driven notes: the master note under `#shield-enabled`, the isolate note under `#shield-isolate`.
  - It gets the same two-step Restart now control (ids `#shields-restart`, `#shields-restart-note`, stable contract).
  - It imports `shields-isolation-model.js` with a flat specifier, `// @ts-ignore` and `any`.
  - New `internal-page-map.js` route `'/shields-isolation-model.js': shared('shields-isolation-model.js')`.
  - New `<script src="shields-isolation-model.js" type="module">` tag (CLAUDE.md new-shared-module checklist). The page fetches `goldfinchInternal.shieldsIsolationState()` on load.
  - **Patch in place:** checkbox state is already patched (`.checked`), and the note and restart elements are patched with `textContent`/`hidden`, never rebuilt.
- **Spec:** `tests/behavior/third-party-cookie-isolation.md`:
  - un-defer and finalize the Leg 02 assertions (step 10's restart-pending copy plus count shown and not dimmed; step 11's copy gone; `[data-shield="isolate"]` selectors);
  - add the Validator's "Reload to apply vs restart copy are distinct" expectation;
  - set Status `active`.
- **Docs:**
  - CLAUDE.md, in the Shields cross-cutting area: one line covering the model, the persistent Shields node (patch in place), and Restart now (sender-validated, business-gated, `DEV_MINT` stripped).
  - `docs/mcp-automation.md`: a note that `shields-restart-to-apply` isn't an MCP op.

## Acceptance Criteria
- [ ] **AC1** The `shields-isolation-model` unit matrix passes: every `(enabled, isolate, isolateEffective, operatorOverride, paused)` combination yields the documented `inForce`/`restartPending`/`pendingDirection`/`isolateRow`/`masterNote`. In particular:
  - in force on a paused site → not dimmed, count shown, note `browser-wide`;
  - configured off but in force → `stays-on-until-restart`, count shown, not dimmed;
  - configured on but not in force → `turns-on-after-restart`, dimmed, no count;
  - operator `--disable-features` with config on → **no** restart pending (no permanent hint);
  - master off while in force → `masterNote` set.
- [ ] **AC2** Drift guard. The shared ESM `effectiveAfterRestart(cfg, override)` agrees, for every combination, with (a) leg 01's `decideStartup` and (b) `effectiveAfterRestartFromConfigured(isolateConfigured(cfg), override)`. `isolateConfigured` must ignore `pausedSites` and other keys. A new side throws or goes red until the others catch up.
- [ ] **AC3** `privacy-controller` unit tests, extending `privacy-controller.test.js` with its existing DOM harness:
  - rows carry `data-shield`;
  - the isolate row renders count, note and dimming from the model in each AC1 state;
  - the footer restart line appears only while pending;
  - **patch in place:** a focused element inside the Shields section (the isolate switch, and Restart now) is the **same node** and still `document.activeElement` after a simulated `onPrivacyNet` push and after an unrelated `shields-changed`;
  - the other sections still render after a push (shared-mechanism assertion: each section heading is present and its content updates).
- [ ] **AC4** Restart now handlers, unit-tested with fakes and no Electron:
  - the chrome channel refuses a non-chrome sender;
  - both channels return `not-pending` when nothing is pending, and **do not** call `relaunch`/`quit`;
  - when pending, they call `app.relaunch` once with options from `relaunchOptions` (no `GOLDFINCH_AUTOMATION_DEV_MINT`; `execPath` = `APPIMAGE` when set) and then `app.quit` once, in that order;
  - the channel-list pin is updated.
- [ ] **AC5** `relaunchOptions` unit tests: `APPIMAGE` → `{ execPath }`; absent → `{}` (no `env` key ever). Handler unit tests (with AC4): at the moment `app.relaunch` is called, the injected `env` no longer has `GOLDFINCH_AUTOMATION_DEV_MINT`, and its other keys are untouched.
- [ ] **AC6** Two-step confirm (unit, both surfaces):
  - the first activation shows the confirm state without invoking the channel;
  - the second invokes it;
  - a 6 s timeout, Escape, or focus leaving the section reverts the state;
  - the `restoreSession:false` copy includes "Open tabs won't be reopened."
- [ ] **AC7** Settings page:
  - shows the master and isolate notes and the Restart now control from the model;
  - the new route exists in `internal-page-map.js` (`internal-page-route-closure.test.js` green);
  - `settings-page-shared-scripts.test.js` covers the new module tag;
  - `eslint.config.mjs` needs no change (`pages/settings.js` is already listed), and this is verified by lint.
- [ ] **AC8** `renderer.js` is untouched (`git diff --stat` shows no change), `SEAM_COUNT` is unchanged, and the line budgets are green.
- [ ] **AC9** Accessibility:
  - The restart note and Restart now are reachable and labeled. Restart now is a real `<button>` with a non-empty accessible name in both states.
  - No restart copy is in a live region that re-announces on push.
  - Run `npm run a11y -- --restart-states` (see Round 2 amendment R2-3) and show no NEW violations for the restart-pending and confirm states, including color contrast in both themes. The default sweep is unchanged. Attempt the `--target=goldfinch://settings` pre-check once and record the outcome.
- [ ] **AC10** Full behavior run, `/mission-control:behavior-test third-party-cookie-isolation`, run by the Flight Director: all steps except the struck step 9 pass, including the previously deferred Leg 02 assertions.
- [ ] **AC11** Live smoke of every existing apparatus primitive against the new state (CLAUDE.md planning rule): `enumerateTabs`, `enumerateWindows`, `captureWindow`, `captureScreenshot`, `evaluate` (guest and chrome), `readDom`/`readAxTree` on a guest, `scroll`. Each is exercised once while the privacy panel is open in the restart-pending state, and each behaves. Recorded in the flight log; the Flight Director performs this with the AC10 run.
- [ ] **AC12** `npm run format:check`, `npm run lint`, `npm run typecheck` and `npm test` all pass. CLAUDE.md and `docs/mcp-automation.md` are updated.

## Verification Steps
- AC1–AC8, AC12: `npm test` (new and updated unit files), `npm run lint`, `npm run typecheck`, `npm run format:check`, and `git diff --stat src/renderer/renderer.js` (empty).
- AC9: `npm run a11y` against a running dev instance (the Flight Director runs it live), plus the unit assertions on button and name.
- AC10/AC11: behavior run log under `tests/behavior/third-party-cookie-isolation/runs/`, plus a flight-log entry.

## Implementation Guidance
1. **Model first.** Write `src/shared/shields-isolation-model.js` with tests and the drift guard. Unit tests `require()` the ESM file (Node ≥22), as other shared modules do. The copy strings live here.
2. **Main side.** Write `relaunch-options.js` plus the two restart handlers in `register-settings-ipc.js`, with deps injected from `main.js` at the existing `registerSettingsIpc({…})` call. That call already receives `isolateEffective`/`operatorOverride` from leg 01; add `app` and `registry` if they aren't already passed.
   - **Business-gate rule:** keep one main-side CJS function, `effectiveAfterRestart` (in `third-party-cookies.js` beside `decideStartup`), and drift-guard it against the shared ESM one. Don't import ESM from main.
   - Apply the CLAUDE.md verbatim-extraction TDZ checklist to anything moved.
3. **Preloads and typings.** Add `shieldsRestartToApply()` to both preloads and both `.d.ts` interfaces, and update the register channel-list pin and harness.
4. **Privacy panel.**
   - Restructure `renderPrivacy()` per Round 1 amendment 5: `body.children = [shieldsNode, …rebuilt sections]`.
   - Shields children are always patched by key and never rebuilt.
   - Keep `toggle()` usage. Add `data-shield`.
   - The Shields section lives in a new `src/renderer/chrome/shields-section.js` **from the start** (Round 1 amendment 6). The `chrome/**` eslint glob covers it.
5. **Settings page.** Add the module tag, the route, the import, and the patch-in-place notes and restart elements in `#privacy`. Two-step confirm as specified.
6. **Two-step confirm.** Factor it as a tiny pure state reducer in the shared model module (`restartConfirmReducer(state, event)`), so both surfaces share it and unit tests drive it without timers. Inject the clock and timers per the CLAUDE.md MockTimers recipe.
7. **Spec and docs.** Finalize the behavior spec's Leg 02 assertions and update CLAUDE.md and mcp-automation.md.
8. **Don't touch** `renderer.js`, leg 01's startup/accounting/permission logic (except adding the CJS `effectiveAfterRestart`), or any Shields strategy semantics.

## Completion (overrides any older in-file checklist)
Implement to the ACs. AC9's live `npm run a11y` run, AC10 and AC11 are performed by the Flight Director after landing; the Developer runs the unit and static gates. Update the flight log's Leg Progress entry, set this leg to `landed`, **do not commit**, and signal `[LAND:leg]`.

## Design Review Round 1: amendments (authoritative where they conflict with the text above)
Developer review, 2026-10-06: approve with changes. Incorporated as follows.

1. **Relaunch.** `env` is not a RelaunchOptions field; see the corrected Outputs and AC5. The handler mutates the injected `env`.
2. **Real-trigger proof (DD11 scenario), replacing `appQuit` in the spec's restart steps.** `tests/behavior/third-party-cookie-isolation.md` steps 10–12 are rewritten so each restart is driven by the **real UI**:
   - toggle isolate via the `[data-shield="isolate"]` switch;
   - then Restart now, then Restart Goldfinch, in the privacy panel for step 11, and on a `goldfinch://settings` tab for step 12's restore.

   Each restart asserts:
   - the old PID exits;
   - a new PID is alive and serving MCP on the same port, which proves the single-instance lock handoff;
   - the **same** `adminKey` still authenticates, because DEV_MINT was stripped and no re-mint happened;
   - `shieldsIsolationState().isolateEffective` flipped.

   If the relaunched child loses the lock and exits, that is a **fail** and gets recorded. The spec's "this run's PID" tracking follows the new PID. Under `dev:automation` the child is an orphan of the npm wrapper; that is acceptable.
3. **Live DD4/DD5 triggers.** The spec gains rows that use the real chrome controls to:
   - (a) turn the master Shields switch off while isolation is in force, then read the master note in the panel and on the settings page, then turn it back on;
   - (b) pause the current site with the Pause button, then read the isolate row: count shown, not dimmed, note "Applies browser-wide". Then resume.

   These run in the AC10 full run.
4. **Harness (AC3).** Extend `test/unit/privacy-controller.test.js`'s DOM fake as follows:
   - a real child list with `parentNode`, `removeChild`, `insertBefore` and a deep `contains`;
   - `querySelector('[data-shield=…]')`, `dataset` and `hidden`;
   - `focus()` that sets `document.activeElement`;
   - multi-listener `addEventListener`;
   - `focusout` dispatch with `relatedTarget`.

   Drive pushes through the harness's stored `callbacks.net`/`callbacks.shields` after `togglePrivacy(true)`. The primary assertion is **node identity**: the isolate switch and the Restart now button are the same objects, still attached, after a push. `activeElement` is asserted too, now that `focus()` sets it.
5. **Structure.**
   - `body.children` stays `[shieldsNode, …rebuilt sections]`: on rebuild, remove every child **except** `shieldsNode`. There is no `restNode` container, so the existing Jar-section tests still work.
   - The Shields children are **always patched by key and never rebuilt**. The signature/rebuild path is dropped.
   - Patched switches read the **live** `shieldsConfig[key]` at click time (`setShield(key, !shieldsConfig[key])`), never a closed-over `on`. A unit test covers two successive clicks.
   - Patching also runs when the panel opens (`togglePrivacy(true)`), because `renderPrivacy` early-returns while collapsed.
   - Focus loss in the *other* sections on rebuild is pre-existing and out of scope.
6. **Extraction from the start.** The Shields section moves to a new `src/renderer/chrome/shields-section.js` (covered by the `chrome/**` eslint glob). It is created by `privacy-controller.js` and imports `../../shared/shields-isolation-model.js` statically with a disk-relative specifier. It is **not** a renderer.js dep. Timers (`setTimeout`/`clearTimeout`) are injected with global defaults; tests follow the MockTimers recipe.
7. **Escape and reset contract (AC6 additions).**
   - In the confirm state, the first Escape reverts it **only**, calling `stopPropagation()` + `preventDefault()` so `#privacy-panel`'s close-on-Escape doesn't fire. A second Escape closes the panel as today.
   - The confirm state and its 6 s timer reset on `togglePrivacy(false)`, on a `renderPrivacy` that finds the panel collapsed, and on any tab switch (which calls `renderPrivacy`).
   - Failure or `not-pending`: revert, then `toast()` in the chrome, or inline status text on the settings page.
   - One Restart now control per surface (the master note points to it), not one per row.
   - The confirm button's accessible name differs from the idle one ("Restart now" vs "Restart Goldfinch"), and focus stays on the same node.
8. **a11y (AC9 replacement).**
   - Add audit states to `scripts/a11y-audit.mjs`:
     - `privacy-panel-restart-pending`: chrome evaluate `shieldsSet({isolate:false})` then `togglePrivacy(true)`;
     - `privacy-panel-restart-confirm`: first activation of Restart now.
   - Both are restored afterwards (`shieldsSet({isolate:true})`), in both themes.
   - Running `npm run a11y` shows no NEW violations, including color contrast for the new `.shield-note` and confirm states.
   - New CSS goes in Outputs: `src/renderer/styles.css`, near the existing `.shield-row.dim`/`.shield-foot`/`.shield-count` rules, and the settings page stylesheet.
   - Attempt the `--target=goldfinch://settings` pre-check once and record the outcome.
9. **Main deps and authority.**
   - `registerSettingsIpc` gains `app`, `registry` and `env` deps at the `main.js` call site (`registry` is the module's `createWindowRegistry()` instance).
   - The harness gets defaults for them, a **realistic** `shields.get()` (`{enabled:true, isolate:true, …}`, not `{blockAds:true}`), `registry.getWindowForChrome`, and `app.relaunch`/`quit` spies.
   - **Main-side authority:** the business gate uses `shields.isolateConfigured(shields.get())` combined with `operatorOverride`. It goes through a CJS `effectiveAfterRestart(configured, operatorOverride)` in `third-party-cookies.js` that takes the *boolean* from `isolateConfigured`.
   - The shared ESM `effectiveAfterRestart(cfg, …)` is drift-guarded against **both** `isolateConfigured` (`pausedSites` and other keys never affect it) and `decideStartup`.
10. **Sender cases (AC4).** Explicit refusal cases for an internal-session sender and a guest sender on the bare chrome channel.
11. **`restoreSession`.** Reuse the controller's existing init `settingsGet()` result and update on `onSettingsChanged`, guarded with `!== undefined` (default `true`). The settings page does the same.
12. **settings.html.**
    - The Restart control and notes go **inside the fieldset after the rows**, never inside a `<label>`.
    - The notes are linked to their checkboxes with `aria-describedby`.
    - Patching uses `textContent`/`hidden` only.

## Design Review Round 2: amendments (authoritative; max review rounds reached)
Developer review, 2026-10-06: approve with changes. The stale sentences above have been struck or rewritten in place.

- **R2-1 Lock race.** `app.releaseSingleInstanceLock()` is called before `app.relaunch`, and AC4 asserts the call order: env strip → release → relaunch → quit. `test/unit/single-instance-lock-order.test.js` must stay green; the release lives in the handler, not the module-load block. The behavior spec allows a **bounded wait of up to 30 s** for the new PID to listen on the pinned MCP port before recording a fail.
- **R2-2 MCP re-attach.** After each relaunch the Executor **re-attaches** with a new `initialize`/connect using the **same** `adminKey`. The old session dies with the process. Same-key authentication holds because the key hash persists in `app.db`, re-minting needs `GOLDFINCH_AUTOMATION_DEV_MINT === '1'` (stripped), and `GOLDFINCH_MCP_PORT`, `GOLDFINCH_AUTOMATION_ADMIN` and argv are inherited.
- **R2-3 a11y states are opt-in.** The two restart states run only with `npm run a11y -- --restart-states`. They run **last**, assert `isolateEffective === true` (skipping with a message otherwise), wrap the mutation in `try/finally` that restores `shieldsSet({isolate:true})` and closes the panel, and don't touch the default sweep. `ACCEPTED` entries are added only after reviewing results. If the stale comment in `scripts/a11y-audit.mjs` about the internal session being excluded from evaluate is confirmed wrong during the pre-check, fix the comment.
- **R2-5 Naming.** The CJS function is `effectiveAfterRestartFromConfigured(configured: boolean, override)`. The shared ESM one stays `effectiveAfterRestart(cfg, override)`.
- **R2-6 Spec drivability (rewrite of `tests/behavior/third-party-cookie-isolation.md` steps 10–12 plus preconditions):**
  - Panel controls: read rects via chrome `evaluate` (`getBoundingClientRect`) and click chrome-relative. Make sure the Restart control is in view (scroll the panel body if needed). **Re-read the rect before the second (confirm) click.**
  - Settings page: open it with chrome `evaluate("kebabActionSettings()")`, never `openTab`. Admin `evaluate`/`click` reach the internal tab.
  - The restore uses the settings-page Restart.
  - Strike the precondition text that quits via `appQuit()` for restarts and says "a new key was minted". Keep `appQuit()` only for final teardown.
  - Teardown kills the relaunched child by its **new** PID (under `dev:automation` it is an orphan of the old wrapper).
  - Add a cheap live **not-pending** row: chrome `evaluate` `window.goldfinch.shieldsRestartToApply()` with nothing pending → `{ok:false, reason:'not-pending'}`, and the process is unchanged.
- **R2-7** Covered by the struck and rewritten Outputs: `toggle()` returns an updatable handle; `closePrivacyPanel`/`togglePrivacy(false)` reset the confirm state.

## Citation Audit
Checked 2026-10-06 on branch `sortie/02-partitioned-cookie-isolation` (leg 01 landed, uncommitted):
- `privacy-controller.js`: `shieldsGet` (175), `onShieldsChanged` (179), `SHIELD_ROWS` (347), `pShields` (353), `const dim` (375), the count condition (384), "Reload to apply" (411), `renderPrivacy` (484), `body.innerHTML = ''` (491).
- `settings.html` `#privacy` fieldset (186–199).
- `settings.js` shields controller (331–370) and shared imports (9–15).
- `internal-page-map.js` shared route (25).
- `app-lifecycle.js` `app-quit` (323).
- `window-registry.js` `getWindowForChrome` (188).
- `settings-store.js` `restoreSession` default (118).
- Leg 01 preload and `.d.ts` entries: `chrome-preload.js:118`, `internal-preload.js:132`, `renderer-globals.d.ts:187`/`648`.

All present.
