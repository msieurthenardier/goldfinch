# Flight Log: Default Browser

**Flight**: [Default Browser](flight.md)

## Summary

Sortie 01 chartered 2026-09-29 (issue #202). Design approved 2026-09-29 after two Architect reviews. **Landed 2026-09-29.** Legs 1–2 (autonomous) completed, reviewed, committed; leg 3 (Windows HAT) H0–H10 passed with two look-and-feel fixes. Behavior test `default-browser-handoff` 7/7. PR #239. Debriefed 2026-09-29 (`flight-debrief.md`); status `completed`.

---

## Leg Progress

### launch-url-intake

**Status**: landed
**Started**: 2026-09-29
**Completed**: 2026-09-29 (landed, not yet committed/completed — FD owns the transition)

#### Changes Made

- `src/shared/launch-urls.js` (new): pure `filterLaunchUrls` / `extractLaunchUrls(argv)` (argv[0] ignored, `-` tokens dropped, http/https only via `new URL`, `isSafeTabUrl`, normalized `href`, dedupe, cap 20). `test/unit/launch-urls.test.js` (10 cases).
- `src/main/main.js`: `app.requestSingleInstanceLock()` after the dev redirect, before `crashReporter.start(`; loser `app.exit(0); process.exit(0)`. Crash-reporter comment adjusted. New deps (`extractLaunchUrls`, `filterLaunchUrls`, `queueChromeSend`) threaded into `registerAppLifecycle`. `test/unit/single-instance-lock-order.test.js` (new order + exit-shape pin, regex mutations under `assertMutated`).
- `src/main/app-lifecycle.js`: single pending buffer seeded from argv; `second-instance` / `open-url` registered beside `login`; pre-ready arrivals buffer only (no registry access, deduped/capped across arrivals); creation block uses `{ noBootTab: true }` only when the buffer is non-empty (no-URL path still `createWindow()` argless), captures `firstRec`, flushes to it via `queueChromeSend`; post-ready target = last-focused with paused-record fallback, raise (`restore`/`show`/`focus`/`noteFocus`) before send; darwin zero-window creates `{ noBootTab: true }` window; other platforms drop+log; logs count only. `test/unit/app-lifecycle.test.js` harness extended (argv, trackRecords registry fake with real-create last-focused seeding, recording `queueChromeSend`, win recorders, `restoreOnNullSnapshot`); 14 new cases (40 total).
- `chrome-preload.js` `onOpenExternalUrls`; `renderer-globals.d.ts` entry.
- `src/renderer/chrome/external-urls-controller.js` (new) + `test/unit/external-urls-controller.test.js` (7 cases); `src/renderer/chrome/audit-states.js` (new; the two audit hooks moved verbatim, getters for `loadFailureController`/`hangNoticeController`).
- `renderer.js`: controller constructed above the boot `Promise.all`; `.finally(() => externalUrls.releaseBoot())` on the whole chain; audit hooks extracted. `test/unit/external-urls-wiring.test.js` (source-scan pin incl. neuters). Budget: **1550 -> 1546** (measured after `npm run format`); `test/helpers/renderer-line-budget.js` = 1546, accounting paragraph added to `seam-contract.test.js`, CLAUDE.md figure updated. SEAM_COUNT stays 41.
- Docs: CLAUDE.md gotcha entry; `docs/dev-testing.md` single-instance note + relaunch-wait rule.

#### Verification

- `npm test` 5722 pass / 0 fail (one earlier full run showed a single unrelated flake, `listItemsMeta returns metadata for all three types with NO secret field/value`; green on immediate re-run — see Anomalies), `npm run typecheck`, `npm run lint`, `npm run format:check` all green.
- **AC2 neuter (real `main.js`, by hand, restored after each)**: `app.exit(0)` -> `app.quit()` in the loser branch: `single-instance-lock-order.test.js` 2 pass / 2 fail (red); lock block moved above the dev redirect: 3 pass / 1 fail (red); restored: 4/4 green. `dev-profile-redirect-order`, `crash-reporter-pins`, `app-user-model-id` unmodified and green.
- **AC7 grep** (`grep -n "open-external-urls\|onOpenExternalUrls\|external-urls-controller" -r src`), 10 hits, all judged clean: `app-lifecycle.js:50` comment; `:239`, `:392` the two `queueChromeSend(..., ['open-external-urls', { urls }])` sends (main, no createTab); `renderer-globals.d.ts:248` type; `renderer.js:35` import; `:1216` the only construction (passes `onOpenExternalUrls` + `createTab` — no trusted, no container); controller `:2` comment, `:12`/`:18`/`:25` its own deps/subscription (createTab called only as `createTab(url, null[, { background: true }])`); `chrome-preload.js:219` the preload forward. No external-URL path reaches `createTab` other than via the controller; none passes `trusted` or a container.
- **Live smoke (AC9)**: stopped the pre-leg instance (SIGTERM, waited for exit), relaunched new code (single launch minted exactly one `AUTOMATION_DEV_MINT` line; admin key attached via `scripts/lib/mcp-client.mjs`). A second `node scripts/dev-launch.mjs <https URL with ?x=1&y=2>` exited 0 and `enumerateTabs` showed `https://example.com/goldfinch-smoke?x=1&y=2` active in jar `personal`, window 1. Hostile second launch (`goldfinch://settings`, `file:///etc/passwd`, `javascript:alert(1)`) exited 0 and left the census unchanged. Primitives exercised against the new state: `enumerateTabs`, `enumerateWindows` (booted, lastFocused, recoveryPaused false), `captureWindow`, `captureScreenshot`, `evaluate` (`document.title` -> "Example Domain"), `readDom`, plus `getChromeTarget`.
- **DD9 premise re-runs**: (1) singleton files (`SingletonLock`/`SingletonSocket`/`SingletonCookie`) land under `~/.config/goldfinch-dev` — lock follows the redirect (no installed Goldfinch present here to run alongside; keyed-on-userData confirmed by location). (2) single launch mints and attaches; the losing launch printed no `AUTOMATION_DEV_MINT` line (`grep -c` = 0 in its output) and the running instance's log still holds exactly one mint line and its admin key kept working after the hand-off. Grep of `docs/dev-testing.md` and `scripts/` found no recipe running two instances on one profile concurrently (a11y/mcp docs are single-attach). (3) relaunch recipe: waited for the old PID (and its launcher) to be fully gone before relaunching; docs now state this. (4) `crash-reporter-pins.test.js` and `dev-profile-redirect-order.test.js` green unmodified. (5) By code reading + live: `isRestorePending` compares `tabViews.size` to `restoreTabs.length` per record and only ever sees extra tabs as `have` growing; URL tabs are created after the restore createTab calls (barrier) and through the normal createTab path, so the count is not skewed in practice. Cold-boot restore ordering (URL tab after restored tabs, restore-on) is not exercised by me — behavior-test rows 7-8, FD.

#### Notes

- Prettier re-breaks the boot chain into an indented member chain once `.finally(...)` is appended (`])` / `.then(` / `.finally(` on their own lines), so the diff re-indents the `.then` body (no logic change; net line count was still within budget: 1546). The wiring pin is written against the semantic shape (`.finally` follows the `.then(...)` closing paren) not the literal `}).finally`.
- `activate` handler left keyed on `getAllWindows().length === 0` (real BaseWindow list, equal to registry records outside a mid-close moment); the darwin test proves it adds no second window in the harness where both are tracked.
- Edge: a restore snapshot with zero windows (unreachable via `sessionStore.read()`, which returns null for it) would leave the buffer unflushed; not handled.
- Running instance left up: launcher PID recorded in the final report; log `.../scratchpad/dev-automation.log`.

### os-registration-and-settings

**Status**: landed
**Started**: 2026-09-29
**Completed**: 2026-09-29

#### Changes Made

- `src/main/default-browser.js` (new, Electron-free): `createDefaultBrowser({app, shell, platform, env, logger})` -> `getStatus()` / `makeDefault()`; `WIN_DEFAULT_APPS_URL` is the sole `openExternal` target; never throws.
- Channels `default-browser:get-status` / `:make-default` in `register-settings-ipc.js` (`registerInternalHandler`, arguments ignored); wired in `main.js`; bridge methods in `internal-preload.js` + `renderer-globals.d.ts` (`DefaultBrowserStatus`).
- `src/shared/default-browser-row-model.js` (pure copy model) + exact route in `internal-page-map.js` (`internal-page-map.test.js` list updated) + `<script>` tag; `settings.html` "Default browser" fieldset (`default-browser-status`, `default-browser-failure`, `default-browser-make-default`); `settings.js` IIFE (render from returned state only, coalesced refresh, stale-response drop via a monotonically issued counter, refresh on load/visibilitychange/focus, patch-in-place).
- `package.json`: `desktopName`, `build.protocols`, `build.linux.syncDesktopName`, `build.nsis.include`. `build/installer.nsh` (new; `customInstall` + `${isUpdated}`-guarded `customUnInstall`).
- Tests (new): `default-browser.test.js`, `default-browser-row-model.test.js`, `default-browser-packaging.test.js`; extended `register-settings-ipc.test.js` + `settings-ipc-harness.js`.
- Docs: `CLAUDE.md` (Default browser entry), `docs/RELEASING.md` (installer registration note), `build/README.md` (installer.nsh row). `scripts/` and `docs/dev-testing.md` contain no WM_CLASS/app_id assumption (grep clean).

#### Verification

- `npm test` 5748 pass / 0 fail; `npm run typecheck`, `npm run lint`, `npm run format:check` green (after `npm run format`).
- AC7: `npm run pack` OK; `npx electron-builder --linux deb` OK (`dist/goldfinch_0.17.2_amd64.deb`, gitignored). `dpkg-deb -x` payload: `usr/share/applications/goldfinch.desktop` has `Exec=/opt/Goldfinch/goldfinch %U`, `StartupWMClass=goldfinch`, `MimeType=x-scheme-handler/http;x-scheme-handler/https;`. NSIS build NOT run: no `wine`/`makensis` on this host; the Windows build is exercised by CI `build-windows.yml` / leg 3.
- AC8: `dist/linux-unpacked/goldfinch --user-data-dir=<scratchpad>/pkg-ud --no-sandbox` stayed up past 12 s (did not hand off); killed afterwards, no leftover processes. Row/click NOT exercised (see residuals).
- AC9: dev instance cleanly quit via chrome-tier `appQuit()`, old PID confirmed gone, relaunched on this leg's code (ADMIN + DEV_MINT). Settings tab opened via `kebabActionSettings()`. `readDom` shows `#default-browser-status` = "Available in installed builds only.", `#default-browser-make-default` `disabled`, fieldset legend "Default browser". **`readAxTree` accepted the internal settings tab**: legend "Default browser" (group), the status text present in the tree, the button named "Make default" with `disabled: true`. Warm hand-off `node scripts/dev-launch.mjs https://example.com/?leg2=1` exited 0 and produced a `personal`-jar tab. Primitives exercised once each: `enumerateTabs`, `enumerateWindows`, `captureWindow`, `captureScreenshot`, `evaluate` (chrome tier), `readDom`, `readAxTree`.

#### Notes

- Residuals (recorded): (1) packaged-Linux row + make-default click not run (packaged builds have no automation surface; a successful `xdg-settings` write is global) - covered at unit level (AC4a) and live on Windows by leg 3; (2) desktops keyed on `default-web-browser` may still show another browser (only xdg `default-url-scheme-handler` is written); (3) NSIS output unverified here (no wine); (4) `xdg-settings` missing -> `isDefault:false` and make-default `ok:false`, no separate state (FD ruling).
- `getStatus` treats a throwing `isDefaultProtocolClient` as `isDefault:false` plus one log line.
- Running dev instance: electron main PID 1149555 (leg-2 code).

---

## Decisions

---

## Deviations

---

## Anomalies

- Flaky test observed once in a full `npm test` run: `listItemsMeta returns metadata for all three types with NO secret field/value` (vault, unrelated to this leg); passed on immediate re-run and in the two subsequent full runs. For the FD to squawk if it recurs.
---

## Session Notes

### 2026-09-29 — Flight design

- Charter agreed (default jar; Windows + Linux accepted, macOS wired only; restore-then-add on cold launch; daily-driver readiness).
- Planning probe: electron-builder's NSIS target ignores `build.protocols` (only the Linux desktop helper / macOS plist consume it) → Windows registration needs a custom `build/installer.nsh` (DD6). The issue's proposed config alone would register nothing on Windows.
- Operator rulings: Linux make-default sets directly; open every safe URL (cap 20, last active); Windows HAT only; author behavior test `default-browser-handoff`.
- Architect review 1 — approve with changes. Applied: `renderer.js` at 1550/1550 budget → new `chrome/external-urls-controller.js` + matching extraction; barrier can't wedge; paused-record fallback; single pending-URL buffer; background-open for all but last URL; AppImage unsupported + `ok:false`; install-mode wording (HKCU/HKLM per installer choice); behavior-test welcome observability, exact launch commands, loser-mints-nothing check.
- Architect review 2 — approve with changes. Applied: no top-level `return` in `main.js` (TS1108 under `checkJs`) → `app.exit(0); process.exit(0)`; barrier `.finally` on the whole boot chain (bookmarks boot can reject); unseeded `defaultId` → burner, logged; named flush hook + `noBootTab` peek site; win32 `isDefault` reported as unknown (Electron's check reads `Classes\<scheme>`, not `UserChoice`) with HAT verification; `#welcome-surface` `.hidden` observable.
- Gate re-check (sortie criteria 2–3): one decision cluster (OS URL intake + registration); 2 legs + Windows HAT — at the soft limit, not over.
- Operator approved the design; charter criterion 4 narrowed on Windows (Default-apps hand-off, no claimed status unless HAT shows Electron's win32 check is reliable). Status → `ready`.

### Flight Director Notes

- 2026-09-29: Execution started via `/mission-control:agentic-workflow sortie 01`. Loaded `.flightops/agent-crews/leg-execution.md` (structure valid: Crew / Interaction Protocol / Prompts). Branch `sortie/01-default-browser` created; sortie status `ready` → `in-flight`. 3 legs planned (2 autonomous + Windows HAT).
- Dev automation instance launched for the operator before execution (`npm run dev:automation` with ADMIN + DEV_MINT; log in the FD scratchpad) — runs pre-leg code.
- Leg 1 `launch-url-intake` designed. **Risk tier: HIGH** — installs global hooks (`requestSingleInstanceLock`, `second-instance`, `open-url`), changes boot ordering/lifecycle, touches the hostile-URL boundary (security-sensitive), and changes `renderer.js` under its zero-headroom budget. → per-leg design review.
- Extraction choice for the renderer budget: the two audit helpers (not the restore block) — `session-restore-wiring.test.js` pins the restore branch's text inside `renderer.js` (16 refs), so moving it would force a suite retarget unrelated to this leg.
- Leg 1 design review (Developer) — approve with changes. Applied: [high] cold-launch target is the FIRST created record (`window-registry.js` `create()` seeds `lastFocusedId` on every create, so `getLastFocused()` after restore names the LAST window) — `getLastFocused()` only for post-ready intakes; AC6 proof is a source-scan pin (a Promise-semantics unit test would be a tautology); harness extensions spelled out; no-URL path keeps `createWindow()` argless; darwin zero-window rule for both `open-url` and `second-instance` (no double window with `activate`); buffer capped + deduped across arrivals; sent form = `new URL().href`; log counts only; measure the renderer budget first.
- **Deviation from DD2 (intentional)**: `extractLaunchUrls(argv)` drops the `{ isPackaged }` parameter — scheme filtering already discards the exe, the dev app-path `.` and flags, so the offset parameter would be dead. DD2's behavior is unchanged.
- Design changes were substantive but targeted and resolve every issue the review raised; FD call: no second review cycle (the changes adopt the reviewer's own recommendations verbatim). Leg 1 → `ready`.
- Leg 1 AC9 live gate: `/mission-control:behavior-test default-browser-handoff` → **PASS 7/7** (run log `tests/behavior/default-browser-handoff/runs/2026-09-29-21-01-11.md`; live mode). Spec wording tightened after the run (welcome tabs excluded from restore by design; "first window" defined; ps method). Operator settings restored to run-start values; dev instance left running on leg-1 code.
- Anomaly carried from leg 1 (Developer): one full-suite flake in a vault test (`listItemsMeta returns metadata for all three types with NO secret field/value`), passed on re-run; FD re-ran the full suite (5722/0). Unrelated to this sortie → to be logged as a squawk at flight end.
- Observation from the run (not a sortie defect): restored `127.0.0.1:8765` tabs whose fixture server was down report `loadState: ok` with title "New tab" after restore (were `failed` pre-quit). Pre-existing session-restore behavior, outside this sortie's charter → squawk candidate.
- Leg 1 → landed (legs_completed 1/2 autonomous). Leg 2 `os-registration-and-settings` designed. **Risk tier: HIGH** — first `shell.openExternal` in `src/`, two new internal-bridge channels (security-sensitive trust boundary), installer registry writes on Windows (hard to reverse on user machines), packaging config changes (`desktopName` alters the Linux app_id). → per-leg design review.
- Leg 2 design review (Developer) — approve with changes; all premises confirmed (`APP_EXECUTABLE_FILENAME` = `Goldfinch.exe`; `customInstall`/`customUnInstall` hooks; `${isUpdated}` + `SHELL_CONTEXT` available; `build.protocols` has NO NSIS consumer — no `Classes\http` hijack; `shell` already imported in main; `--user-data-dir` isolates the packaged lock; `dist/` gitignored). Applied: AC8 cut to its automatable part — the packaged-Linux row/click becomes a **recorded residual** (packaged builds have no automation surface; a successful `xdg-settings` write is global and would rewrite the operator's real default); new pure `default-browser-row-model.js` with a full copy-matrix unit test (the row's supported states were otherwise untested); exact-handler-list + harness updates named; a11y audit can't reach the internal session → `readAxTree` substitute; refresh coalescing + stale-response drop; structural pin-test rules; `StartMenu`/`FriendlyTypeName` keys; single-`openExternal` source pin; unsupported states never spawn `xdg-settings`; unknown platform → unsupported. FD rulings: no `no-xdg` state; `default-web-browser` stays a residual. Substantive but reviewer-directed changes → no second cycle. Leg 2 → `ready`.
- Leg 2 → landed (legs_completed 2/2 autonomous). Flight review (Reviewer, all changes vs `main`): **[HANDOFF:confirmed]**, no blocking issues; gates re-run by the Reviewer (npm test 5748 pass / 0 fail / 4 todo; typecheck, lint, format:check clean). Non-blocking: (1) misplaced `settings.js` section header → fixed by a Developer (comment-only; FD verified the diff, no re-review cycle); (2) **residual**: on win32, a focus/visibility refresh issued while make-default is in flight drops the make-default result by the stale check — only the transient failure line is lost, the fresh status still renders; accepted; (3) flight/leg check-offs — done by FD now; (4) NSIS/Windows behavior → leg 3 HAT.
- Legs 1–2 → `completed`. Committing the flight's autonomous work as one commit; leg 3 (`03-hat-windows`, interactive) follows with the operator.
- Leg 3 `hat-windows` (interactive) started. Operator chose a prerelease tag over a local Windows build: `v0.18.0-rc.1` pushed on `623512b` → Build installers run 36641463356, all jobs success; published as GitHub prerelease (not latest). **H0 PASS** — NSIS installer compiled with `build/installer.nsh` on `windows-latest` (`Goldfinch-Setup-0.18.0-rc.1.exe`, 117 MB).
- **H1 PASS** — "Only for me" install; Goldfinch listed in Settings → Apps → Default apps (with icon, beside Chrome); operator set it as the default browser.
- **H2 PASS** — row reads "Choose Goldfinch under Windows Default apps."; "Open Default apps" button hands off to Windows Default apps. Operator: a previous Goldfinch version was already installed on the HAT machine (the H1 install therefore ran the OLD uninstaller — no customUnInstall macro; expected). HAT finding H2-a (FD call: look-and-feel **FIX**, single surface — settings page CSS/markup — inline protocol, no design review): the "Default browser" group has no top spacing/separator (butts against the restore-session note) and its legend is visibly indented vs the status text. Developer spawned to fix; re-verify on a batched rc build.

### hat-windows

- H2-a fix: added scoped `.default-browser-group` rules in `src/renderer/pages/settings.css` (12px top margin; the legend is floated full-width with zero side padding and carries the same `1px rgba(255,255,255,0.08)` divider + 12px padding as `.startup-toggle-group`, the next sibling clears it), so the group has the neighbours' separator/spacing and the legend aligns with the status text; verified by before/after screenshots (`h2a-before.png` / `h2a-after.png`).
- **H3 PASS** — warm hand-off on Windows: `start https://example.com/?hat=3` and a link clicked in another app both open in the running Goldfinch (operator report: "works").
- **H4 PASS** — minimized window restores and comes forward on a hand-off (`start https://example.com/?hat=4`); new tab active. H2-a fix verified by FD from the dev after-screenshot (separator + spacing, legend aligned); rides the rc.2 re-check.
- **H5 PASS** — `start "" "https://example.com/?q=a b&x=1"` → one tab, query intact (space encoded, `&x=1` present).
- **H6 PASS** — cold launch via `start https://example.com/?hat=6` opens Goldfinch with the URL as the active tab. Out-of-scope observations (pre-existing, not introduced by this sortie; squawk candidates at flight end): (a) a cold launch from cmd attaches main's console output: Node `MODULE_TYPELESS_PACKAGE_JSON` warning on first `require()` of a `src/shared/` ESM module (`password-generator.js`, M21) — fix needs a design call because of the CJS-by-design quartet in `src/shared/`; (b) `[app-lifecycle] pruning crash dumps under <path>` — a `logger.debug?.` (M20 F3) that prints in packaged builds because the logger is `console`; leaks a local path to the console.
- **H7 PASS** — `Goldfinch.exe file:///C:/Windows/win.ini` against the running instance opens nothing.
- **H8 PASS (confirms DD7)** — `reg query HKCU\Software\Classes\http\shell\open\command` → key not found, while Goldfinch IS the operator's default (H1). Electron's win32 `isDefaultProtocolClient` reads that key, so it would report false for a correctly-selected default → the row's "status unknown, hand off to Default apps" design stands; no change.
- **H9 PASS** — re-running the rc.1 installer over the rc.1 install (this build's own `${isUpdated}`-guarded uninstaller) kept Goldfinch as the HTTP/HTTPS default; `start https://example.com/?hat=9` still opens in Goldfinch.
- **H10 PASS** — "Anyone who uses this computer" install (HKLM via SHELL_CONTEXT) lists Goldfinch in Default apps; a real uninstall removes it. All HAT steps H0–H10 pass; H2-a spacing fix pending operator confirmation on the rc.2 build.
- rc.2 (`v0.18.0-rc.2`, run 36644866323, all jobs success) re-check: separator/legend OK per operator; HAT finding H2-b (look-and-feel **FIX**, same single surface): the gap between the status line and the "Open Default apps" button is too tight. Operator ruling: verify in the dev instance, no new installer.
- H2-b fix: added scoped `.default-browser-group > button { margin-top: 12px; }` in `src/renderer/pages/settings.css` (carried by the button so the empty zero-height failure line adds no phantom gap; status-to-button gap 0px to 12px), verified by before/after screenshots (`h2b-before.png` / `h2b-after.png`).
- Out-of-scope findings logged as squawks (deferred, routine): **0110** vault `listItemsMeta` one-off flake; **0111** restored background tabs report `loadState: ok` before loading (`automation/tabs.js:61` default); **0112** crash-dump prune `logger.debug` prints in packaged builds. The `MODULE_TYPELESS_PACKAGE_JSON` warning FAILED the squawk gate (needs a design call: the CJS-by-design quartet in `src/shared/` blocks a plain `"type": "module"`) → recommended to the operator as a future sortie, not logged as a squawk.
- Leg 3 → completed (all H0–H10 pass; H2-b verified by the operator in the dev instance). Docs verified: CLAUDE.md (lifecycle gotcha + Default browser entry + renderer budget), docs/dev-testing.md, docs/RELEASING.md, build/README.md updated during legs 1–2; HAT fixes were CSS-only. Sortie status → `landed`; PR #239 marked ready for review. Prereleases `v0.18.0-rc.1` / `rc.2` remain published (operator's call whether to delete). [COMPLETE:flight]
- Flight debrief written (Developer + Architect interviews; human interview skipped — log comprehensive). Debrief follow-ups logged as squawks 0113 (Windows HAT prerelease runbook) and 0114 (behavior-test liveness check). Prereleases `v0.18.0-rc.1`/`rc.2` deleted at operator request. Sortie → `completed`.
