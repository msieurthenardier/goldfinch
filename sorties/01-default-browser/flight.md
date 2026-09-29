# Sortie: Default Browser

**Status**: landed

Tracks GitHub issue #202.

## Charter

### Outcome

Goldfinch can be set as the system default browser on Windows and Linux, and a link clicked in another app opens as a new tab in the running Goldfinch, in the default jar.

### Why Now

Daily-driver readiness — the operator wants Goldfinch as their actual browser, and today links from other apps can't reach it.

### Success Criteria

- [ ] **Windows**: a packaged, installed Goldfinch appears under Settings → Apps → Default apps for HTTP/HTTPS; once selected, a link clicked elsewhere opens as a new active tab (default jar) in the last-focused Goldfinch window — no second process stays running.
- [ ] **Cold launch**: with Goldfinch not running, an external link launches it and opens the URL as a new active tab; with *restore session* on, the session restores first and the URL tab is added in the first window.
- [ ] **Safety**: a non-`http:`/`https:` launch argument (`goldfinch://`, `file://`, `javascript:`, flag-like args) never opens a tab; external URLs only ever pass the untrusted `isSafeTabUrl` gate.
- [ ] **Settings**: `goldfinch://settings` offers a "Make default" action — on Linux it shows whether Goldfinch is the default and sets it directly; on Windows it sends the operator to the system Default apps page (Windows default status is not claimed unless the HAT shows Electron reports it reliably — DD7).

### Constraints

- Never widen the hostile-URL boundary; never the trusted `createTab` path for an external URL.
- Dev/unpackaged launches register nothing (`app.isPackaged` gate); profile-isolated dev and behavior-test instances must still run alongside an installed Goldfinch (lock follows the userData redirect).
- Linux = `.desktop` MimeType + URL intake; the Windows half is accepted by a human test on Windows, not from WSL.
- macOS `open-url` is wired but not accepted in this sortie.

---

## Pre-Flight

### Objective

Give Goldfinch a single-instance URL intake — argv at cold launch, `second-instance` argv while running, `open-url` on macOS — that turns every safe `http(s)` argument into an ordinary untrusted tab in the default jar of the last-focused window, after any session restore. Then make the packaged app discoverable as a browser: `.desktop` MimeType on Linux, a custom NSIS include writing the Windows browser-registration keys, and a `goldfinch://settings` "Default browser" row that reports live status and offers the platform's make-default action.

### Open Questions

- [x] Which jar? → DD4 (default jar via `createTab(url, null)`)
- [x] Which platforms? → Windows + Linux accepted; macOS wired, unaccepted (charter)
- [x] Cold launch with restore on? → restore first, then URL tab(s) (DD3)
- [x] Several URLs in one launch? → open each safe URL, capped, last active (DD2)
- [x] Linux make-default action? → set directly via `setAsDefaultProtocolClient` (DD7)
- [x] HAT scope? → Windows HAT only; Linux accepted by behavior test + unit pins
- [x] Behavior test? → yes, `default-browser-handoff` (DD8)

### Design Decisions

**DD1 — Single-instance lock at module scope; the losing instance `app.exit(0)`s before any side effect.**
`app.requestSingleInstanceLock()` runs in `src/main/main.js` at module scope, immediately after the dev-profile `setPath('userData', …)` redirect (`main.js:282-284`) and BEFORE `crashReporter.start` (`:299`), `createCrashLog`, and `registerAppLifecycle(` (`:2678`). On failure: `if (!gotLock) { app.exit(0); process.exit(0); }` — no top-level `return` (ESLint's commonjs config would accept it, but `tsc` over `jsconfig.json`'s `checkJs` rejects it with TS1108; `process.exit` is safe because nothing has been opened yet) — never `app.quit()`, which would still run the `whenReady` chain (`app-lifecycle.js:254`): open the shared `app.db`, create a window, and write this loser's session snapshot into the running instance's store via `before-quit` (`:406-428`). The lock applies in ALL builds (dev included) — Electron keys it on the userData dir, so installed (`goldfinch`) and dev (`goldfinch-dev`) coexist, and dev keeps the second-instance path testable.
- Rationale: the lock must follow the redirect or dev and installed builds would block each other (the coexistence premise that broke twice before — M3 F7 debrief). Exiting before `registerAppLifecycle` means the loser never mints a DEV_MINT key (`app-lifecycle.js:375`), opens stores, or starts the crash reporter.
- Pinned by a source-order test in the style of `dev-profile-redirect-order.test.js` / `crash-reporter-pins.test.js`: redirect < lock < `crashReporter.start` < `registerAppLifecycle(`, with a sanity-marker check (no vacuous pass), and the failure branch contains `app.exit(` and no `app.quit(`.
- Trade-off: two concurrent `npm run dev:automation` launches now hand off instead of running side by side (they already collide on the MCP port, so nothing working is lost).

**DD2 — Pure `extractLaunchUrls(argv, { isPackaged })` in `src/shared/`.**
Skips `argv[0]` (exe), and in unpackaged runs also the app-path argument (`.`); skips every `-`-prefixed token (our flags, Chromium's injected second-instance switches such as `--original-process-start-time`); keeps only tokens that parse as `http:`/`https:` URLs AND pass `isSafeTabUrl` (`src/shared/url-safety.js:13`) — `about:blank`, `file:`, `goldfinch:`, `javascript:` all dropped; de-duplicates; caps at 20 per launch. Matrix includes `about:blank` (dropped despite `isSafeTabUrl` admitting it), mixed-case schemes (`HTTPS://`), and the dev (`[electron, '.', …]`) vs packaged (`[exe, …]`) offsets — Windows' packaged `"%1"` argv carries no `.`. Every URL that survives becomes a tab; the last one is activated.
- Rationale: one pure, unit-pinned decision; mirrors `isMcpAutomationEnabled` / `decideInsecureTlsFixtures`. Main re-checks with the same function at each intake point.
- Trade-off: a URL whose first character is `-` can't arrive as a bare arg — not a real OS handoff shape.

**DD3 — One delivery channel, gated in the chrome by a boot barrier.**
Main never calls `createTab`. Every intake (cold argv, `second-instance`, `open-url`) resolves a target record and pushes a NEW owner-routed channel `open-external-urls { urls }` through `queueChromeSend(rec, …)` (`register-tab-ipc.js:47`). A dedicated channel, not `open-tab`: `onOpenTab` stamps `scriptOpened: true` (`renderer.js:1207-1211`), which would let the page `window.close()` itself.
- **Target**: `registry.getLastFocused()` (`window-registry.js:175`, membership-validated); never `getChromeContents()`. If that record is `chromeRecoveryPaused` (where `queueChromeSend` silently drops sends), fall back to the first non-paused record; if none, the URLs are dropped and logged (accepted residual — every window's chrome is crash-paused). Cold launch: the first record created (the first restored window when restore is on).
- **One main-side pending buffer**: `second-instance` (which can fire before `whenReady` or while no record exists), `open-url` and the cold argv all append to a single pending-URL list. It is flushed right after the window-creation block in `whenReady` (`app-lifecycle.js:300-308`), still through `queueChromeSend` (the chrome hasn't served `window-boot-config` yet). `noBootTab` is decided at that same site by peeking the buffer — `createWindow({ noBootTab: pending.length > 0 })` for both the no-restore branch (`:307`) and the restore-but-null-snapshot branch. Residual (accepted, recorded): a `second-instance` arriving after the first `createWindow` but before its chrome boots still gets the normal boot tab beside the URL tab. On macOS with zero windows (app resident), an arrival creates a window with `noBootTab: true`.
- **Chrome side — new `src/renderer/chrome/external-urls-controller.js`**: `renderer.js` is at its zero-headroom budget (1550/1550, `RENDERER_LINE_BUDGET`), so the handler and the barrier live in a new controller with injected deps (`createTab`, `jarsClient`, the boot-ready promise); `chrome/**` is already lint-globbed as a module. The controller owns a boot-ready deferred; its `onOpenExternalUrls` listener is registered at module top level (above the `windowBootConfig()` invoke at `renderer.js:1397`, where registrations are guaranteed live before queued sends flush — `:1385-1395`). The barrier resolves via `.finally(() => barrier.resolve())` chained on the WHOLE boot chain `Promise.all(...).then(...)` — not inside the `.then`, which never runs if `Promise.all` rejects (`bookmarksClient.boot`, `bookmarks-client.js:143`, has no catch). A test pins that a rejected boot chain still resolves it. Since `jarsClient.boot` is in the same `Promise.all`, the barrier always follows it; but `jarsClient.boot` swallows its own errors (`jars-client.js:50-53`), so after a jars IPC failure `defaultId` can still be `undefined` — then the URL opens in a **burner** (safe: never a jar nobody chose, never lost) and the controller logs the degradation. Leg 1 frees the lines it adds with a matching extraction from `renderer.js` — candidates: the restore/boot-tab body of the boot `.then` (`renderer.js:1416-1441`, ~26 lines, the exact block the barrier gates, into the new controller) or the audit helpers `showCrashPanelForAudit`/`showHangNoticeForAudit` (`:1443-1462`, re-published by name at the seam); anything moved that references `createTab`/controllers takes getters (TDZ checklist). The controller needs no evaluate-seam entry (`SEAM_COUNT` stays 41) and keeps `test/helpers/renderer-line-budget.js` in step if the count changes (CLAUDE.md: extraction, not compaction). Queued sends flush BEFORE the boot-config reply (`app-lifecycle.js:189-251`), so without the barrier the URL tab would be created before the restored tabs and lose activation to restore.
- **Opening N URLs**: `createTab(url, null, { background: true })` for all but the last, then `createTab(last, null)` (activates) — one activation, strip order preserved; never the two-arg bag-as-container form (M15 F1 debrief). The payload has no `wcId`, so the gap-queue dedupe (keyed on `payload.wcId`) never collapses two arrivals — pinned by a test.
- **Cold boot tab**: when launch URLs exist and restore is off — or restore is on but `sessionStore.read()` returns null (no snapshot / zero windows, `session-store.js:157`) — the first window is created with `noBootTab: true`: no stray home/welcome tab beside the external URL. Restored windows already carry `noBootTab`. Unit-pinned, including restore-on with every saved tab unresolvable (empty window + URL tab).
- **Raise**: on `second-instance`, `if (win.isMinimized()) win.restore(); win.show(); win.focus(); registry.noteFocus(win.id)` — `noteFocus` is mandatory (WSLg `focus()` emits no event). Minimize/restore is new code (no prior `restore()` in `src/main`).
- **macOS `open-url`**: `event.preventDefault()`, registered before ready (it fires during will-finish-launching), feeding the shared pending buffer.
- **Chrome recovery**: URLs are delivered once through the send queue; recovery re-adopts existing tabs (`window-boot-config` `recoverTabs`) and never re-sends, so a chrome crash can't reopen them.
- **Hand-off during quit** (lock owner in `before-quit`/update): the loser exits and the URL is lost — accepted residual, recorded; no retry.
- Rationale: one path for warm and cold, reusing the sanctioned boot gate; the barrier is the single ordering rule.
- Trade-off: a URL that arrives during a slow restore waits for it (queue-and-wait on the last-focused window, not re-targeting to a booted one — the operator's focus wins).

**DD4 — External URLs open in the default jar.**
`createTab(url, null)` resolves through `resolveNewTabContainer(jarsClient.containers, jarsClient.defaultId)` (`tab-controller.js:352`, `shared/default-routing.js:21`) — the same jar a user-opened new tab gets. If the operator has made Burner their default (`defaultId === null`), external links honour that. Never `activeContainer()`.

**DD5 — Linux registration via electron-builder config.**
`package.json`: `build.protocols: [{ name: "Web", schemes: ["http", "https"] }]` (emitted as `MimeType=x-scheme-handler/http;x-scheme-handler/https;` in the generated `.desktop`, `LinuxTargetHelper.js:290-294`; also yields macOS `CFBundleURLTypes`), top-level `desktopName: "goldfinch.desktop"` and `build.linux.syncDesktopName: true` so `xdg-settings` and Electron's `setAsDefaultProtocolClient` name a real desktop file and the WM_CLASS / app_id matches it.
- Trade-off: setting `desktopName` changes the Linux app_id / WM_CLASS — taskbar grouping on Linux may change once; accepted (it's the documented fix for the M5 F6 unset-`desktopName` warning).

**DD6 — Windows registration via a custom NSIS include, additive only.**
Verified at planning: the NSIS target does NOT consume `build.protocols` (only the Linux desktop helper and macOS plist do), so the issue's proposed config alone registers nothing on Windows. `build/installer.nsh` wired via `build.nsis.include`:
- The assisted installer (`nsis.oneClick: false`, no `perMachine`) offers "only me / all users", so `SHELL_CONTEXT` is HKCU or HKLM per the operator's pick — the registration is the same shape under either (HKLM is the usual Chrome/Firefox placement). The HAT covers both install modes.
- `customInstall` (`installSection.nsh:81`) writes, under `SHELL_CONTEXT`: a ProgID `Software\Classes\GoldfinchHTML` (`shell\open\command` = `"$INSTDIR\Goldfinch.exe" "%1"`, `DefaultIcon`); `Software\Clients\StartMenuInternet\Goldfinch` with `Capabilities` (`ApplicationName`, `ApplicationDescription`, `URLAssociations` `http`/`https` → `GoldfinchHTML`); `Software\RegisteredApplications\Goldfinch` → that Capabilities path.
- `customInstall` also runs on every update and rewrites the keys — idempotent by design.
- `customUnInstall` (`uninstaller.nsh:156`; `${isUpdated}` is already used in that file at `:164`) deletes those keys ONLY when `${isUpdated}` is false — electron-builder runs the old uninstaller during an update, and deleting the ProgID there would reset the operator's default choice on every update (the same uninstall-during-update mechanism behind #65's lost taskbar pin, squawk 0002).
- Does not touch shortcuts, AUMID, or `appId` (`com.goldfinch.browser`, kept stable). #65 is NOT fixed here; this include is additive and the shared surface is noted for #65/#101.
- Rationale: Windows 10/11 lists a browser in Default apps only via RegisteredApplications + Capabilities; `setAsDefaultProtocolClient` cannot set the default (UserChoice is user-confirmed).
- Trade-off: cannot be verified from WSL — accepted by the Windows HAT with the residual recorded.

**DD7 — Settings "Default browser" row, narrow internal-bridge actions.**
Two `registerInternalHandler` channels (pattern: `automation:*` in `register-settings-ipc.js:71-78`), taking NO arguments from the page:
- `default-browser:get-status` → `{ supported, reason, isDefault, platform }`. `supported` is false for unpackaged builds (`reason: 'dev'`) and for a Linux AppImage (`process.env.APPIMAGE` set, `reason: 'appimage'` — it installs no system `.desktop`, so xdg has nothing to name; the row explains integrating it or using the .deb). `isDefault` = `isDefaultProtocolClient('http') && …('https')` on linux/darwin. On **win32** it is `null` (unknown): Electron's Windows check reads `Software\Classes\<scheme>\shell\open\command`, not the user's Default-apps `UserChoice`, so it would report false after a successful pick — the row instead says "Choose Goldfinch in Windows Default apps" and always offers the button (never an optimistic or false claim). The HAT confirms Electron's actual win32 answer; if it proves reliable, the row may use it.
- `default-browser:make-default` → win32: `shell.openExternal('ms-settings:defaultapps?registeredAppUser=Goldfinch')` — a hard-coded literal, the first `shell.openExternal` in `src/`, never page-supplied; linux/darwin: `setAsDefaultProtocolClient('http')` and `('https')` directly. Returns `{ ok, status }` with the fresh status; a `false` return from `setAsDefaultProtocolClient` is `ok: false` and the row shows a failure message (distinct from unsupported). Refuses when unsupported.
- Linux residual: only xdg's `default-url-scheme-handler` path is exercised; desktops that key on `default-web-browser` may still show another browser — recorded in the packaged-Linux smoke.
- UI in `settings.html`'s "Startup & appearance" section: status text derived from the returned state (never optimistic — squawks 0108/0109), a "Make default" button hidden when already default and disabled with an explanation when unsupported; status re-queried on `visibilitychange`/`focus` because the Windows choice happens outside the app.
- Not a settings-store key: nothing persisted, no `settings-changed` broadcast (the OS is the source of truth), and it avoids the un-allowlisted `internal-settings-set` path (maintenance F10a).
- Plumbing per CLAUDE.md: `internal-preload.js` exposure, `renderer-globals.d.ts` `GoldfinchInternalBridge` entries.

**DD8 — Behavior-test apparatus: shell to act, MCP to observe.**
`tests/behavior/default-browser-handoff.md`.
- **Act**: shell — `node scripts/dev-launch.mjs <args…>` (positional args are forwarded, `dev-launch.mjs:49,69`) against the same dev profile. Warm = second launch while one runs; cold = Orchestrator-driven kill-and-relaunch (squawk 0054 recipe).
- **Observe**: MCP `enumerateTabs` rows `{url, jarId, active, windowId}` (`automation/tabs.js:37-58,131-174`) and `enumerateWindows` (booted / last-focused); shell — the second process's exit code and absence within a timeout.
- **Not observable here** (→ HAT): window raise/restore-from-minimized (WSLg focus APIs unreliable, M9 F6), Windows Default apps listing, the Settings page hand-off.
- Hostile args: a second launch with `goldfinch://settings`, `file:///etc/passwd`, `javascript:alert(1)` must leave the tab census unchanged.

**DD9 — Global-hook premise re-runs (project rule).**
The lock, `second-instance` and `open-url` are app-wide hooks. Premises they could change, re-run in leg 1's live smoke:
1. Installed/dev coexistence (lock keyed on the redirected userData — confirm the lock's singleton files land under `goldfinch-dev`).
2. `npm run dev:automation` + `DEV_MINT` attach flow — a single launch still mints and attaches; a losing launch prints no `AUTOMATION_DEV_MINT` line and the running instance's keys stay valid. Also grep `docs/dev-testing.md` and `scripts/` for any recipe that runs two instances on one profile concurrently.
3. The behavior-test relaunch recipe (squawk 0054): the killed PID must be fully gone before relaunch, or the relaunch now hands off to the dying instance and exits — the recipe waits for the lock owner's exit.
4. `crashReporter` dev-profile ordering pins (`crash-reporter-pins.test.js`) and `dev-profile-redirect-order.test.js` still green.
5. Session-snapshot gate `isRestorePending` (squawk 0073): URL tabs created after restore don't satisfy or skew the restore count; each new tab arms `scheduleSnapshot` through the normal `createTab` path.

### Prerequisites

- [x] No other mission/sortie touches `app-lifecycle.js` boot, settings, or packaging (no active missions; #101/#65 backlogged)
- [x] NSIS target ignores `build.protocols` — verified in `node_modules/app-builder-lib` (electron-builder ^26.15.3)
- [x] Dev launcher forwards positional args (`scripts/dev-launch.mjs:49,69`)
- [ ] Windows machine available to the operator for the HAT (packaged NSIS build via `npm run dist` or the CI package artifact)
- [ ] Live dev instance + MCP attach for the behavior test (`npm run dev:automation`, fresh DEV_MINT)

### Pre-Flight Checklist

- [x] All open questions resolved
- [x] Design decisions documented
- [x] Prerequisites verified (HAT Windows machine and live dev rig are execution-time prerequisites, confirmed at leg start)
- [x] Validation approach defined
- [x] Legs defined

---

## In-Flight

### Technical Approach

Leg 1 builds the intake end to end and is fully testable in dev: the pure extractor, the lock + loser exit in `main.js`, `second-instance`/`open-url` listeners registered in `registerAppLifecycle` beside `login`, cold-launch argv captured at boot and routed to the first record (with `noBootTab`), the `open-external-urls` channel (chrome-preload `onOpenExternalUrls`, typed in `renderer-globals.d.ts`), and the renderer handler in the new `chrome/external-urls-controller.js` behind the boot-ready barrier (with a matching `renderer.js` extraction to stay inside the line budget). Leg 2 adds OS-facing registration (package config, NSIS include) and the settings row — none of which changes the intake. Leg 3 accepts the Windows half on real Windows.

Tests: unit — `extractLaunchUrls` matrix (dev/packaged offsets, flags, hostile schemes, dedupe, cap); lock-placement source-order pin; `app-lifecycle.test.js` harness extended for `second-instance` (the fake `app` gains only what's used); a grep-AC that no external-URL path passes `trusted`; settings handler tests (unpackaged refusal, win32 literal target, linux calls both schemes); a package.json pin for `protocols`/`desktopName`/`nsis.include`. Live — behavior test `default-browser-handoff`.

Docs: `CLAUDE.md` (a short gotcha: lock placement + loser `app.exit`; external URLs never trusted), `docs/dev-testing.md` (two dev launches now hand off), `docs/RELEASING.md` if the NSIS include needs a release note.

### Checkpoints

- [ ] Lock + loser exit pinned; dev/installed coexistence re-verified
- [ ] Warm and cold handoff observed live (behavior test green)
- [ ] Settings row live-tested in dev (unsupported state) and packaged Linux build (xdg)
- [ ] Windows HAT: Default apps listing, link handoff, update preserves default

### Adaptation Criteria

**Divert if**:
- The boot-ready barrier can't be placed without restructuring `window-boot-config` (then extract that handler first — it is flagged "extract on next touch", squawk 0084 — and re-check criterion 3)
- Leg 1's renderer work can't be paid for by a clean extraction from `renderer.js` (budget 1550/1550) without touching unrelated boot logic
- The Windows registration needs more than an additive include (e.g. changing install mode or `appId`) — that crosses into #101/#65 territory; escalate

**Acceptable variations**:
- Exact channel/handler names, cap value, settings copy
- Which `renderer.js` block is extracted to free the budget lines
- macOS `open-url` buffering shape

### Legs

> **Note:** These are tentative suggestions, not commitments. Legs are planned and created one at a time as the flight progresses.

- [x] `01-launch-url-intake` — single-instance lock + loser exit, `extractLaunchUrls`, shared pending buffer for `second-instance`/`open-url`/cold argv, paused-record fallback, `open-external-urls` channel, new `chrome/external-urls-controller.js` with the boot-ready barrier (resolved in `finally`) plus a `renderer.js` extraction to stay within budget, window raise, cold `noBootTab`; unit pins; DD9 premise re-runs; behavior test `default-browser-handoff` run live
- [x] `02-os-registration-and-settings` — `protocols`/`desktopName`/`syncDesktopName`, `build/installer.nsh` (install + update-safe uninstall), settings "Default browser" row + two internal handlers; unit pins; packaged Linux smoke
- [x] `03-hat-windows` — Guided HAT on Windows (both "only me" and "all users" installs): install → Default apps listing → the settings button's `ms-settings:defaultapps?registeredAppUser=Goldfinch` deep link lands on Goldfinch's page → what `isDefaultProtocolClient` reports after the pick → select → link from another app (warm and cold) → minimized-window restore → a URL containing spaces/`&` → settings row status → update install keeps the default; residuals recorded

---

## Post-Flight

### Completion Checklist

- [x] All legs completed
- [ ] Code merged
- [x] Tests passing
- [x] Documentation updated

### Verification

Charter criteria map: Windows → leg 3 HAT; Cold launch → behavior test (cold rows) + HAT; Safety → `extractLaunchUrls` unit matrix + behavior test hostile-args row + trusted-path grep-AC; Settings → handler unit tests + packaged-Linux smoke + HAT.
