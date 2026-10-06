# Flight Log: Partitioned-cookie-aware third-party isolation

**Flight**: [Partitioned-cookie-aware third-party isolation](flight.md)

## Summary
**Landed 2026-10-06.** All three legs are completed:
- Leg 01: native cookie isolation.
- Leg 02: panel/settings UX and Restart now.
- Leg 03: operator HAT, 9/10 steps passed, step 9 skipped, plus one inline FEATURE fix (HAT-F1).

All four charter criteria are met. Commits `31be656` and `ac56929`; PR #246.

---

## Leg Progress

### 01-native-cookie-isolation
- **Status**: landed (Developer; AC10-AC12 live runs pending, Flight Director). Not committed.
- **Started**: 2026-10-05
- **Completed**: 2026-10-05

**Changes Made**
- New `src/main/third-party-cookies.js` (`FEATURE`, `decideStartup`, `isValidPartitionedSetCookie`, `refusedThirdPartySetCookie`), `src/main/shields-startup.js` (`readStartupShieldsConfig`, fail-closed, never throws).
- `app-db.js`: `peekDocumentReadOnly` (`{ readOnly: true }`, no create), `SELECT_DOC_SQL` single-sourced with `selectDoc`. `shields.js`: pure `parseShieldsConfig(raw, deserialize)` (`parseAndRepair` delegates), `isolateConfigured`.
- `main.js`: startup block between the single-instance lock and `crashReporter.start(`; `isolateEffective` / `isolateOperatorOverride` consts threaded into `createSessionRuntime` and `registerSettingsIpc`.
- `session-runtime.js`: isolate Cookie/Set-Cookie deletion removed (DD3); DD6 accounting in `onHeadersReceived` (pass-through, independent of pause); DD7 storage-access denial in both permission handlers.
- `register-settings-ipc.js`: bare `shields-isolation-state` + `internal-shields-isolation-state` returning `{ isolateEffective, operatorOverride }`; both preloads and both `renderer-globals.d.ts` interfaces gain `shieldsIsolationState()`.
- Tests: new `third-party-cookies.test.js` (AC1/AC2), `shields-startup.test.js` (AC3/AC4 incl. `readOnly` pin), `third-party-cookie-startup-order.test.js` (AC5); updated `session-runtime.test.js` (stripping test renamed+inverted, AC7, AC8), `register-settings-ipc.test.js` + harness (AC9).
- Fixture `tests/behavior/fixtures/third-party-cookies/` (`serve.mjs`, `gen-certs.mjs`, `README.md`, `.gitignore`). Spec `third-party-cookie-isolation.md` corrected (log schema incl. `search`, `data-ready` signal, Leg-01 `.shield-lbl` selector); status left `draft`. `CLAUDE.md` (Shields line, DD8 partition note, Electron-bump rule beside the `node:sqlite` rule) and `docs/RELEASING.md` ("Electron major bump" note) updated.

**Verification**
- `npm run format:check`, `npm run lint`, `npm run typecheck` clean; `npm test`: 5790 tests, 0 fail.
- Neuter-verified on the REAL sources: moving the startup block above the lock turns `third-party-cookie-startup-order` red (plus in-test neuters: after-crashReporter, whenReady wrap, duplicate switch); changing `readOnly` to `readonly` in `peekDocumentReadOnly` turns the AC4 pin red. Both restored.
- Boot smoke (isolated `XDG_CONFIG_HOME`, `npm run dev:automation -- --insecure-tls-fixtures`): app boots and every Electron process carries `--enable-features=ForceThirdPartyCookieBlockingEnabled,PdfUseShowSaveFilePicker` (our feature composed with Electron's own existing value). Not a substitute for AC11.
- Fixture smoke: `curl -k` of all 11 paths on 127.0.0.1, localhost and 127.0.0.2 returned 200 with the expected Set-Cookie headers (`/b/set-fp` b_fp; `/a/set-fp` a_none/a_lax/a_strict; `/b/frame` b_3p_unpart + `__Host-b_part ... Partitioned`; none for `?report-only=1`; `/b/api` echoes CORS for `Origin`); JSONL lines have the `{ts,host,path,search,cookieNames,setCookieNames}` shape, names only. Server stopped afterwards.

**Fixture launch for the live runs**
```
node tests/behavior/fixtures/third-party-cookies/gen-certs.mjs        # once; certs/ is gitignored
node tests/behavior/fixtures/third-party-cookies/serve.mjs --port {fx} --log {log}
```
Prints `third-party-cookies fixture listening on :::{fx}` (dual-stack; falls back to 0.0.0.0). `{fx}` != the app's `GOLDFINCH_MCP_PORT`. App launch exactly as in the spec Preconditions (isolated `XDG_CONFIG_HOME`, `--insecure-tls-fixtures`). `127.0.0.2` worked over curl in this WSL2 box.

**Deviations / notes for the Flight Director**
- Log gained a `search` field (raw query string) beyond the leg's listed shape so `/b/frame` vs `/b/frame?report-only=1` entries are distinguishable. Names-only rule intact.
- The `?part-only=1` query on `/b/frame` (set by `/a/embed?b=part-only`) makes the frame set and write only Partitioned cookies.
- The sa-frame button is at left:10 top:10, 280x40 inside the second 400x80 iframe, below the sandboxed frame; locate by `captureScreenshot`.
- **AC10 NOT done**: the premise check (does a denied `storage-access` reach `setPermissionRequestHandler`?) needs a live MCP-driven instance; the MCP link was unavailable to me and live runs are Flight Director scope. Step 9's panel-list assertion stays conditional on it.
- AC11/AC12 not run. AC12: confirmed the six specs exist and none pins header stripping; their fixtures/launch recipes are untouched on this branch. `isolateEffective` default in `createSessionRuntime`/`registerSettingsIpc` is `false`/`null` when absent; the settings harness defaults it to `true`.
- `operatorOverride` is exposed on the state channel for Leg 02's restart-pending computation (re-run `decideStartup` over the CURRENT configured value plus the same override).
- Observation: a pre-existing Electron-provided `enable-features=PdfUseShowSaveFilePicker` exists at startup; the composer preserves it. A repeated `--enable-features` on the command line is outside `getSwitchValue`'s single value (documented).
- Out of scope, noted: `npm run dev:automation` prints a `MODULE_TYPELESS_PACKAGE_JSON` warning for `src/shared/password-generator.js` (pre-existing, untouched).

### 02-isolation-panel-ux

- **Status**: landed (uncommitted; Flight Director commits after the flight-end review). Unit and static gates green; AC9 live a11y run, AC10 and AC11 are Flight Director scope.
- **Started**: 2026-10-06
- **Completed**: 2026-10-06

**Changes Made**
- New `src/shared/shields-isolation-model.js` (pure ESM): `effectiveAfterRestart`, `isolationModel`, `restartControl`, `restartConfirmReducer`, `createRestartConfirm` (injected timers, 6 s), frozen `COPY`. CJS twin `effectiveAfterRestartFromConfigured(configured, override)` added to `src/main/third-party-cookies.js` (only change to leg 01 logic).
- New `src/main/relaunch-options.js`; `register-settings-ipc.js` gains `app`/`registry`/`env` deps and two handlers, `shields-restart-to-apply` (chrome, sender-validated via `registry.getWindowForChrome`) and `internal-shields-restart-to-apply`. Gate recomputes from `shields.isolateConfigured(shields.get())` + `operatorOverride` vs `isolateEffective`. Order on pass: delete `GOLDFINCH_AUTOMATION_DEV_MINT` from live env, `releaseSingleInstanceLock()`, `relaunch(relaunchOptions({env}))`, `quit()`. `main.js` call site passes `app`, `registry`, `env: process.env`. Preload + `.d.ts` entries on both bridges.
- New `src/renderer/chrome/shields-section.js`: persistent Shields node (patched in place by `data-shield` key); `privacy-controller.js` keeps it as `#privacy-body`'s first child and removes every other child on rebuild; fetches `shieldsIsolationState()` once; `restoreSession` from the init `settingsGet()` plus its own `onSettingsChanged` subscription (`!== undefined`). Confirm resets on `togglePrivacy(false)`, `closePrivacyPanel`, a render while collapsed, and a tab-id change between renders. **`renderer.js` untouched** (`git diff --stat` empty).
- `goldfinch://settings`: notes + `#shields-restart` (+ `#shields-restart-note`) inside the `#privacy` fieldset after the rows, `aria-describedby` on the two checkboxes; model import (flat specifier + `@ts-ignore`), module tag, `internal-page-map.js` route; patch-in-place via `textContent`/`hidden`.
- CSS: `.shield-note`, `.shield-foot-note`, `.shield-restart` in `styles.css`; `.shield-note`, `.shields-restart-group` in `settings.css`. Notes use `--accent`.
- `scripts/a11y-audit.mjs`: opt-in `--restart-states`.
- Docs: CLAUDE.md (one cross-cutting bullet), `docs/mcp-automation.md` (not-an-MCP-op note incl. re-attach), `docs/dev-testing.md` (a11y recipe).
- Tests: new `shields-isolation-model.test.js` (AC1 full matrix, AC2 drift guard vs `decideStartup` and the CJS twin incl. `pausedSites`/other keys ignored, reducer/driver with MockTimers), `relaunch-options.test.js`; extended `privacy-controller.test.js` (new DOM fake with real child list/focus/dataset/focusout; AC3 identity + `activeElement` + other sections; live-config double click; two-step confirm, Escape consumed, 6 s, focus-out, panel close, tab switch; failure toast; no live region), `register-settings-ipc.test.js` + harness (channel pins; refusal for empty/internal/guest sender; not-pending with no relaunch/quit; order and env-at-call assertions; APPIMAGE), `settings-page-shared-scripts.test.js` (route, tag, import, ids, not-in-label, describedby, controller source pins), `internal-page-map.test.js`.
- Behavior spec `tests/behavior/third-party-cookie-isolation.md`: Status `active`; preconditions rewritten (single DEV_MINT mint, `appQuit()` teardown only, new-PID tracking, re-attach, 30 s bound, drivability notes); new steps listed below.

**Behavior spec step numbers (renumbered; FD runs these)**
- 1-8 unchanged; 9 struck.
- 10 not-pending guard (`shieldsRestartToApply()` -> `{ok:false, reason:'not-pending'}`, process unchanged).
- 11 DD5 pause: real `Pause on this site` -> isolate row not dimmed, count shown, note "Applies browser-wide"; Resume.
- 12 DD4 master off: master note "Cookie isolation stays on until restart" in panel and on settings page; footer restart line distinct from `Reload to apply`; switch back on.
- 13 (old 10) real-UI isolate toggle off -> "Stays on until restart", count not dimmed, still enforced.
- 14 (old 11) panel `Restart now` -> `Restart Goldfinch` -> restart attestation (old PID gone, new PID on `{port}` within 30 s, same adminKey after re-attach, `isolateEffective` flipped) -> isolation off.
- 15 (old 12) settings-page restore: tick `#shield-isolate` -> "Turns on after restart" -> `#shields-restart` twice -> attestation -> isolation on; teardown via `appQuit()` on the NEW PID.

**Selectors / ids for the live runs**
- Panel: `[data-shield="enabled|block|strip|isolate|farble|pause|restart|foot"]`, `[data-shield-note="enabled|isolate"]`, `#shields-restart` (`Restart now` / `Restart Goldfinch`), `#shields-restart-note`, `.shield-foot-note` (`.hidden` unless pending), count = `[data-shield="isolate"] .shield-count` (always present; `.hidden` + empty text when not shown). Hidden = class `hidden`.
- Settings: `#shield-enabled|block|strip|isolate|farble`, `#shield-enabled-note`, `#shield-isolate-note`, `#shields-restart`, `#shields-restart-note` (hidden via the `hidden` attribute).
- a11y: `npm run a11y -- --restart-states` (optionally `--tags=wcag2a,wcag2aa,wcag21a,wcag21aa`), with `GOLDFINCH_MCP_ADMIN_KEY` set and the media fixture on :8000. States added: `privacy-panel-restart-pending`, `privacy-panel-restart-confirm` (runs last; skipped with a message unless `isolateEffective === true`; restores `isolate:true` and closes the panel in a `finally`; never performs the relaunching second click). It navigates to the fixture first. Chrome has a single (dark) theme, so "both themes" is one pass. If NEW violations appear, add reviewed `ACCEPTED` entries only after inspection.

**Neuter verification (all went red, then restored)**
- AC3: `renderPrivacy` removing the Shields node too -> "AC3 patch in place" fails (node no longer first child / focus dropped; the DOM fake now clears `activeElement` when a focused subtree is detached).
- AC4: `releaseSingleInstanceLock` after `relaunch` -> order test and APPIMAGE test fail; removing the `DEV_MINT` delete -> order/env test fails.
- AC2: flipping the ESM `'enabled'` branch, and separately the CJS twin's return -> drift guard fails.

**Gates**: `npm run format` + `format:check`, `npm run lint`, `npm run typecheck`, `npm test` (5820 tests, 0 fail) all pass. `git diff --stat src/renderer/renderer.js` empty.

**Notes for the Flight Director**
- Precedence in the model: when a restart is pending AND the site is paused, the single isolate note shows the restart copy (not "Applies browser-wide"); browser-wide shows only when nothing is pending.
- With isolation configured off but in force, the isolate switch reads off while the count stays visible; the Restart control is ONE per surface (the master note points to the panel's single control).
- `--target=goldfinch://settings` pre-check NOT run (live scope). `scripts/a11y-audit.mjs` still carries the comment that the internal session is excluded from `evaluate`; the spec (R2-6) says admin `evaluate` reaches the internal tab. Confirm live and fix those two comments (header and `getGuestWcId`) if wrong.
- Not unit-testable here: the settings-page controller IIFE (no DOM harness for internal pages). Its logic is shared (`createRestartConfirm`/`restartControl`, fully tested) and the wiring is source-pinned; behavior steps 12/15 cover it live.
- Relaunch inherits `process.argv.slice(1)` and env (incl. `XDG_CONFIG_HOME`, `GOLDFINCH_MCP_PORT`, `--insecure-tls-fixtures`); if `dev:automation`'s launcher passes anything via a wrapper-only channel the child may differ: watch step 14's attestation.
- No out-of-scope defects found.

## Planning Notes

- **2026-10-01:** Root cause traced live. Shields isolation strips the claude.ai artifact frame's cookies, so the frame's server serves its app bundle as `text/plain` and the frame shows "This browser isn't supported". Squawk 0119 (the UA strip, PR #244) was the wrong first hypothesis and shipped as a preventive fix.
- **2026-10-05:** Charter agreed, with `document.cookie` in scope. Operator rulings: restart-to-apply is acceptable; the HAT is included.
- **2026-10-05:** Planning spike (scratch Electron 44 harness): `ForceThirdPartyCookieBlockingEnabled` works, CHIPS is kept, it's process-wide and restart-only, and Electron's cookie API has no partition data.
- **2026-10-05:** Architect round 1: approve with changes. Operator rulings: per-site pause doesn't cover isolation (browser-wide); master switch gets a restart-pending hint plus Restart now; the isolate row shows what's in force. Live pre-check: a real claude.ai artifact renders under the native flag with header isolation off.
- **2026-10-05:** Architect round 2: approve with changes, incorporated. The pre-check was re-run on `main` @ `99c4d34` (Electron UA present) and the artifact still renders, so the result is independent of #244. The operator's dev profile was restored (isolate on).
- **Gate re-check:** still one decision cluster (native restart-to-apply isolation and its consequences); 2 legs plus a mandatory HAT, within the soft limit.

### Flight Director Notes
- 2026-10-05: Flight started. Branch `sortie/02-partitioned-cookie-isolation` cut from `main` @ `99c4d34`; status set to in-flight. Crew file `leg-execution.md` loaded (Developer/Reviewer: Sonnet).
- 2026-10-05: Leg 01 `native-cookie-isolation` designed. **Risk tier: HIGH**: security-sensitive Shields surface, shared-interface changes (session-runtime deps, new IPC pair, preload bridge), startup ordering before `app.ready`, and it reverses the existing stripping pin. A Developer design review runs before implementation.
- 2026-10-05: Leg 01 design review round 1 (Developer): approve with changes, no blocking issues. All medium and low findings were incorporated (see the leg's Design Review section). The changes are additive spec precision, not redesign, so no second round: the skip-if-minor rule applies, since none of the fixes alters a design decision. `operatorOverride` was added to the state channel so restart-pending reflects "would a restart change anything". Leg 01 marked `ready`.
- 2026-10-05: **Leg 01 AC10 premise check (Flight Director, live, isolated `XDG_CONFIG_HOME` instance plus fixture on :48443).** The MCP `click` at the `sa-frame` button was delivered to the **top** document (`mousedown` target `IFRAME`, `clientX/Y` 160,200). Electron `sendInputEvent` doesn't route into cross-site OOPIFs, so `requestStorageAccess()` never ran: no report and no handler call. Whether a denied `storage-access` reaches `setPermissionRequestHandler` therefore **cannot be determined via the apparatus**. **Decision:** strike spec step 9 and step 11's "granted" control (an apparatus limit; any automated attempt is a false pass). DD7 stays covered by the AC8 unit tests. Live Storage Access verification moves to the Leg 03 HAT: the operator clicks `/b/sa-frame`'s button with isolation on, expecting `rejected:NotAllowedError`, and off, expecting `granted`, and notes whether the privacy panel lists the permission. Same session, also observed: the claude-shaped frame reported `cookieNames` = `__Host-b_part`, `js_part`, with the `js_unpart` write dropped, and the privacy panel showed "Isolate 3rd-party cookies · 1 isolated". Native blocking and DD6 accounting work live.
- 2026-10-06: AC11 run, checkpoint 2 observation: the main-side `/favicon.ico` fetch for `https://localhost:48443/b/set-fp`, 29 ms after the `b_fp` set, carried no `b_fp`. This is either a race with the cookie commit or a native-blocking effect on `session.fetch` favicons. **DD10(b) follow-up:** compare the favicon request's cookies with the feature on vs off (and a later favicon on an already-cookied page) during the AC12 re-runs before dispositioning.
- 2026-10-06: **AC11 behavior run: PASS** (Leg 01 partial). `tests/behavior/third-party-cookie-isolation/runs/2026-10-06-01-29-15.md`: 11/11 checkpoints pass, step 9 struck, four Leg-02 UI assertions deferred. Live mode (SendMessage continuation), isolated profile, three app launches. It proves:
  - native blocking on frame, `img`, credentialed `fetch` and `document.cookie`;
  - CHIPS cookies kept and partition-isolated (A vs C);
  - first-party cookies unchanged;
  - DD6 count "1 isolated" versus none for partitioned-only;
  - restart-to-apply in both directions, including cookies stored while off being withheld once back on;
  - the DD1/DD2 startup path, via a real relaunch.

  Spec updated with the Validator's edits (log-matching rules, restore noise, restart attestation, counting rule, selector note); the "Reload to apply" vs restart-copy expectation is deferred to Leg 02. **Leg 02 input:** the isolate count disappears on toggle-off with no restart copy while isolation is still enforced, so DD6 display is confirmed as needed.
- 2026-10-06: **DD10(b) favicon: resolved, unaffected.** In the AC11 run's fixture log, every `/favicon.ico` request carried `cookieNames []` in **all** states. That includes the isolation-OFF session (ts 1791250546526–1791250565204), while first-party `a_*` cookies existed for 127.0.0.1. The main-side favicon fetch is cookieless independently of `ForceThirdPartyCookieBlockingEnabled` (pre-existing behavior), so it is not a regression. The checkpoint-2 observation is closed.
- 2026-10-06: **Operator live evidence for criterion 1 (HAT pre-check).** The operator confirmed a real Claude Code artifact link works in the dev instance on this branch (native blocking, `isolateEffective:true`, signed-in dev profile on :49708) but not in their prod instance (header stripping). The Flight Director also observed another artifact's images (a cross-site frame subresource needing its partitioned cookie) rendering on this branch while broken under prod. The Leg 03 HAT still runs in full.
- 2026-10-06: **DD10(b) favicon: correction to the entry above.** The "cookieless independently of the feature" reading was wrong about the reason. In the `cross-jar-fetch-isolation` AC12 run (native blocking ON), the main-side `/favicon.ico` fetch **did** carry the jar's own first-party cookies (`gfx_pixel`, `gfx_track`), with no cross-jar values. In the AC11 3P fixture, the `a_*` cookies were set from `/a/set-fp` without a `Path` attribute, so they default to path `/a` and never apply to `/favicon.ico`. That is a fixture artifact. **Conclusion unchanged:** favicon fetches keep first-party cookies under native blocking, so there is no regression. *(Fixture note for a later spec touch: give `/a/set-fp` cookies `Path=/` if a favicon-cookie assertion is ever wanted.)*
- 2026-10-06: AC12 `core-browsing-shields`: **PASS 6/6** (batched; `tests/behavior/core-browsing-shields/runs/2026-10-06-13-24-48.md`). Tracker block, param strip and multi-tab are unaffected by native blocking. Steps 2 and 3 passed on intent because of pre-existing or external spec drift (the welcome tab is invisible to `enumerateTabs`; example.com's body changed); the spec was amended.
- 2026-10-06: AC12 `cross-jar-fetch-isolation`: **PASS 7/7** (batched; `tests/behavior/cross-jar-fetch-isolation/runs/2026-10-06-13-24-48.md`). DD10(a)/(b) are confirmed live: the main-side favicon fetch and the `goldfinch-media:` proxy keep the owning jar's first-party cookies under native blocking (verified via `/proc` cmdline), and there was no cross-jar leak. Step 4's spec wording was amended (no same-URL favicon refetch is pre-existing). The cross-site resource-host gap is accepted on the Architect planning probe's evidence.
- 2026-10-06: AC12 `web-compat-pdf` (first ever run): **PASS 6/6**, batched (`tests/behavior/web-compat-pdf/runs/2026-10-06-13-24-48.md`). DD10(d) is confirmed: the PDF viewer `chrome-extension:` subframe commits, renders and scrolls under native blocking, and the attachment download is unaffected. Steps 1/5/6 pass on intent with recorded limits. Cheap spec amendments were applied; structural ones were deferred. **Out-of-scope follow-up:** log a squawk for the web-compat-pdf structural amendments (step 1 timing, step 5 split, step 6 evidence) at flight close.
- 2026-10-06: AC12 `download-indicator`: **partial, 4 pass + 4 apparatus-inconclusive, 0 fail** (`tests/behavior/download-indicator/runs/2026-10-06-13-24-48.md`). DD10(c) is confirmed: downloads (4 KiB hash-verified; 4 MiB streamed) and the indicator states are unaffected by native blocking. Steps 5–8 can't be observed because the downloads popup sheet is refused (secret-sheet gate since 82f6eb2, 2026-07-24; a11y sheet skip since squawk 0045). That is pre-existing and unrelated to this sortie. **Out-of-scope follow-up:** squawk to re-scope the download-indicator spec, logged at flight close.
- 2026-10-06: **Out-of-scope defect observed (jar-data-surfaces run):** after `jarsSetRetention` with nothing aged out, no `jar-data-changed` fires (`handleSetRetention` broadcasts only when classes is non-empty), so `goldfinch://jars` panels stay stale (e.g. "Cookies (7)" while the session holds 8) until a manual refresh. This is pre-existing and not caused by this sortie. **Squawk to be logged at flight close.**
- 2026-10-06: AC12 `jar-data-surfaces`: **PASS 7/7 judged** (`tests/behavior/jar-data-surfaces/runs/2026-10-06-13-24-48.md`). DD8 is confirmed live: partition copies are ordinary duplicate rows with no label, `cookie_seen` merges them, Clear removes every copy, and there was no value exposure. DD8's per-row delete of a duplicate and its retention clause were not witnessed (the spec premise is unreachable on a fresh profile). **Key hygiene:** all launch logs with live `AUTOMATION_DEV_MINT` lines in the AC11/AC12 evidence dirs were redacted. **Squawks to log at flight close:** jar-data-surfaces spec amendments; CLAUDE.md doc drift on cookie values (e07e21a reveal); the "1 days" plural.
- 2026-10-06: AC12 `web-compat-oauth-popup` (first ever run): **PASS 8/8** (`tests/behavior/web-compat-oauth-popup/runs/2026-10-06-13-24-48.md`). Step 3's on-screen floating-window clause was confirmed by the **operator by eye**: "pass on the sign in with popup". DD10(e) is confirmed: popup and postMessage are unaffected by native blocking.
- 2026-10-06: **AC12 complete, with no regression across all six specs.** Results:
  - `core-browsing-shields`: 6/6.
  - `cross-jar-fetch-isolation`: 7/7.
  - `web-compat-pdf`: 6/6.
  - `web-compat-oauth-popup`: 8/8.
  - `download-indicator`: 4 pass + 4 apparatus-inconclusive (downloads sheet unobservable since 2026-07-24; not a regression).
  - `jar-data-surfaces`: 7/7 judged.

  Every AC12 test instance is torn down; the operator's :49708 dev instance is left as the operator uses it. **Leg 01 verification is complete** (AC1–AC13 met; AC10 dispositioned to the HAT; AC11 passed).
- 2026-10-06: Leg 02 `isolation-panel-ux` designed. **Risk tier: HIGH.** It adds a state-changing IPC that relaunches the app (security and lifecycle), changes the privacy panel's shared render/refresh cycle (shared mechanism: every panel section must be asserted unaffected), spans two surfaces (chrome panel and `goldfinch://settings`), and adds a new shared module with an internal-page route. A Developer design review runs before implementation. Design choices made by the FD:
  - Restart now uses a two-step in-surface confirm, not a sheet dialog, to avoid touching the menu-overlay mechanism.
  - The Shields section becomes a persistent patched-in-place node.
  - `effectiveAfterRestart` exists as an ESM shared twin plus a CJS main twin, drift-guarded against `decideStartup`.
- 2026-10-06: Leg 02 design review: round 1 approve-with-changes (relaunch has no `env` option; no real-click restart AC; harness gaps; Escape conflict; vacuous a11y; deps and authority), all incorporated as amendments. Round 2 approve-with-changes (single-instance lock race on relaunch; MCP re-attach; a11y mutation safety; stale sentences; naming), all incorporated, with stale text rewritten in place. **Max 2 rounds reached; no unresolved disputes, so no escalation.** Key FD calls:
  - `app.releaseSingleInstanceLock()` before `app.relaunch`;
  - the a11y restart states are opt-in (`--restart-states`);
  - the CJS twin is renamed `effectiveAfterRestartFromConfigured`;
  - the behavior spec's restarts are driven by real UI clicks, with a bounded 30 s wait.

  Leg 02 marked `ready`.
- 2026-10-06: **Leg 02 AC9 (a11y), Flight Director live run, isolated instance :49721, fixture :48761.**
  - `npm run a11y -- --restart-states --tags=wcag2a,wcag2aa,wcag21a,wcag21aa --url=…/a11y-media/` gave **exit 0, no NEW violations**. The restart-pending and restart-confirm privacy-panel states ran (no skip message), and the `finally` restored `isolate:true` and closed the panel (verified after the run).
  - **Target-mode pre-check: it WORKS** on `goldfinch://settings` under admin. The script header comment claiming internal pages are excluded is stale (low; noted for the squawk batch).
  - Settings page audited in the default state and in the **restart-pending** state (`#shield-isolate-note` "Stays on until restart" visible and `aria-describedby`-linked; `#shields-restart` "Restart now" visible): only **1 violation**, `color-contrast` on `.activity-kind` (automation activity section, `settings.css:696`, last changed 6f19909 2026-09-29, not in this sortie's diff). It is **pre-existing**, so no new violation comes from the leg 02 controls. **Squawk at flight close.**
  - Teardown done.
- 2026-10-06: **Leg 02 AC10 + AC11: PASS** (`tests/behavior/third-party-cookie-isolation/runs/2026-10-06-15-24-26.md`; 14/14 judged, step 9 struck). Both real-UI Restart now relaunches (panel and settings page) came back in about 0.6 s on the same port with the same key: the single-instance lock handoff and the DEV_MINT strip are proven live. DD5/DD6/DD11 are proven live; DD4's copy and state are proven live, and its focus retention is unit-only (AC3). The spec was amended per the Validator. **HAT agenda items** (carried to Leg 03):
  - settings-note placement;
  - duplicate notes when the master is off;
  - "Turns on after restart" vs the DD4 copy;
  - the panel turn-on direction;
  - live focus retention.

  **Squawk candidates:** settings sub-toggles not dimmed when the master is off; "Enable automation surface" reads OFF on a dev-flag launch.
- 2026-10-06: **Leg 02 verification complete** (AC1–AC12 met: AC9 a11y passed, AC10/AC11 passed). Both autonomous legs are landed, so the flight proceeds to Phase 2d (flight-end review + commit).
- 2026-10-06: **Flight-end review (Phase 2d): `[HANDOFF:confirmed]`**, Reviewer (Sonnet, independent). No blocking issues; the Reviewer re-ran gates: 5820 tests (0 fail), lint, typecheck and format clean, renderer.js untouched. Non-blocking:
  - the stale a11y-audit comments (squawk batch);
  - download-indicator is partial because of the pre-existing sheet gap (dispositioned);
  - live Storage Access rests on unit tests and is carried to the Leg 03 HAT.

  Legs 01 and 02 marked `completed`; committing.
- 2026-10-06: Flight committed `31be656`; draft PR #246. Leg 03 HAT designed (interactive; no Developer/Reviewer cycle). Lightweight design: 10 operator steps carrying every HAT-agenda item from Legs 01–02.
- 2026-10-06: **Leg 03 HAT progress.**
  - **Step 1 PASS:** real claude.ai artifacts (including an image-heavy one) render with isolation on. That is charter criterion 1, live.
  - **Step 2 PASS:** no isolate count on an artifact tab. Operator observation: the Cookies card reading "16 first-party · 35 third-party" under active isolation looks alarming. It is the stored-cookie list (incl. partition copies, DD8), not leakage. **Follow-up squawk candidate:** relabel it ("stored").
  - **Step 3 PASS:** panel turn-off → Restart now → Restart Goldfinch relaunched the signed-in profile, with tabs and sign-in kept; post-state `isolateEffective:false`.
  - **HAT-F1 (FEATURE):** the operator found "Reload to apply" confusing and chose "show only when needed". FD classified it as a FEATURE (new behavior/state), so it goes through a scoped design review before implementation, per the fix-vs-feature gate. Single surface. Design is in the leg 03 HAT Findings.
  - **HAT-F1 implemented (Developer):** `applyShieldsConfig` in `privacy-controller.js` (all four config-assignment sites), `reloadStale` on `blankPrivacy()`, a `reloadStale` input to `shields-section.js` `patch()` (button hidden by default, patched in place), and an immediate clear in `onReload`. `renderer.js` untouched. 8 new unit tests in `privacy-controller.test.js`; neuter-verified (isolate-only, boot resolve). Gates run; see the Developer report.
- 2026-10-06: **HAT-F1 review: `[HANDOFF:confirmed]`** (independent Reviewer: 5824 tests pass, 0 fail; lint, typecheck and format clean; renderer.js untouched). Non-blocking: the `privacy` typedef in `tab-controller.js:18` doesn't list `reloadStale` (strict:false; squawk batch). Committing HAT-F1 mid-HAT; the operator's dev instance is relaunched to load it before step 4.
- 2026-10-06: HAT **HAT-F1 live check PASS**: the reload button is hidden by default, appears after a Block-trackers toggle, and clears on click. **Step 4 PASS**: turning on from the panel showed "Turns on after restart", then Restart now → Restart Goldfinch relaunched with isolation in force again.
- 2026-10-06: HAT **step 5 PASS**: master-off notes on both rows (the operator accepts the double note), master-on clears them, and pause shows "Applies browser-wide" on an undimmed isolation row.
- 2026-10-06: HAT **step 6 PASS**: settings-page note and Restart now placement (below the rows) accepted by the operator ("it's fine"). The copy "Stays on until restart" / "Turns on after restart" is accepted in place of the DD4 draft wording.
- 2026-10-06: HAT **step 7 PASS**: live focus retention: a focused Shields control kept focus on a busy page while panel updates streamed in (DD4 patch-in-place, now proven live as well as by unit AC3).
- 2026-10-06: HAT step 6 follow-up: after step 6 the operator left isolate unticked (confirmed "forgot to tick it back on"). The relaunch correctly started with `isolateEffective:false` (startup logic behaved right). The FD re-enabled it and relaunched (with `--insecure-tls-fixtures` for step 8).
- 2026-10-06: HAT **step 8 PASS: Storage Access live (DD7; Leg 01 AC10 closed).** On the fixture A embed with isolation in force, a trusted operator click on the unsandboxed frame's button returned `storageAccess:"rejected:NotAllowedError"`, `hasStorageAccess:false`, and the frame saw only partitioned cookies. The privacy panel shows **"Permissions: 1 requested, denied — storage-access"**, so a denied `storage-access` **does** reach `setPermissionRequestHandler` (the Leg 01 AC10 premise is answered: yes).
- 2026-10-06: HAT **step 9 SKIPPED by the operator** (an optional extra cookie-heavy embed). The dev instance was relaunched normally (no `--insecure-tls-fixtures`) and the fixture stopped.
- 2026-10-06: HAT **step 10 PASS: packaged AppImage Restart now (DD11 `APPIMAGE` execPath).**
  - Built with `npx electron-builder --linux AppImage` (`dist/` is gitignored) and run in a scratch `XDG_CONFIG_HOME`.
  - WSL has no FUSE, so it ran with `APPIMAGE_EXTRACT_AND_RUN=1`, which still sets `APPIMAGE`.
  - The operator noted the Shields panel can't be opened from the welcome screen (by design: no web page). They used Settings → Privacy & Shields → untick → Restart now → Restart Goldfinch.
  - Old PID 1045497 exited; the new process was launched by the AppImage file itself (`dist/Goldfinch-0.18.2.AppImage`, PID 1046850 → extracted binary 1046857). The AppImage relaunch path is proven.
  - Test app closed and scratch profile deleted.
- 2026-10-06: **Leg 03 HAT COMPLETE**: steps 1–8 and 10 pass, step 9 skipped by the operator, HAT-F1 implemented, reviewed and committed (`ac56929`).
  - Operator rulings recorded: the double note when the master is off is accepted; the settings-page note placement is accepted; the "Stays on / Turns on after restart" copy is accepted.
- 2026-10-06: **Charter criteria (all met):**
  - (1) claude.ai artifacts render with Shields fully on: HAT step 1 (live, operator).
  - (2) Unpartitioned 3P cookies are withheld on HTTP and `document.cookie`: behavior runs 2026-10-06-01-29-15 and 2026-10-06-15-24-26.
  - (3) Accounting is truthful: spec step 8 and HAT step 2.
  - (4) Unit tests plus behavior spec: present.
- 2026-10-06: **Flight landed.** Flight status `landed`; PR #246 marked ready for review. Debrief next: `/mission-control:flight-debrief sortie 02`.
- **Squawk batch to log** (out of scope, discovered in flight):
  1. web-compat-pdf structural spec amendments;
  2. download-indicator spec re-scope (sheet unobservable);
  3. jar-data-surfaces spec amendments (aged-data premise, DD8 per-row delete);
  4. web-compat-oauth-popup step 3 `[by-eye]` split;
  5. 3P-cookies fixture `/a/set-fp` cookies `Path=/`;
  6. `goldfinch://jars` panels stale after a no-op retention sweep (**defect**);
  7. CLAUDE.md "cookie value never exposed" vs the e07e21a reveal (doc drift);
  8. "1 days" plural;
  9. stale a11y-audit comments about internal pages;
  10. `.activity-kind` color contrast on settings (**a11y defect**);
  11. "Enable automation surface" reads OFF on a dev-flag launch;
  12. settings Shields sub-toggles not dimmed when the master is off;
  13. privacy-panel Cookies card "N third-party" reads as leakage under isolation (copy);
  14. the `tab-controller.js` privacy typedef lacks `reloadStale`.
