# Leg: os-registration-and-settings

**Status**: completed
**Flight**: [Default Browser](../flight.md)

## Objective

Make the packaged app discoverable as a web browser — Linux `.desktop` URL-scheme MimeTypes, a Windows NSIS include writing the browser-registration keys (update-safe) — and add a `goldfinch://settings` "Default browser" row backed by two narrow internal-bridge actions that report live status and perform the platform's make-default action.

## Context

- Flight DD5 (Linux registration), DD6 (Windows NSIS include), DD7 (settings row + two handlers, win32 status unknown, AppImage unsupported, `ok:false`). Read them in `../flight.md` — authoritative.
- Leg 1 landed (uncommitted on this branch): OS URL intake already works in dev; the behavior test `default-browser-handoff` passed 7/7. This leg does NOT touch the intake (`app-lifecycle.js` intake, `launch-urls.js`, the external-urls controller).
- The Windows half cannot be verified from WSL — it is accepted in leg 3's HAT. This leg's Windows evidence is: the include is wired, syntactically plausible, and the Windows NSIS build (if runnable here, see Verification) or the CI `build-windows.yml` task consumes it.
- Internal-bridge security model (CLAUDE.md): new actions are `registerInternalHandler` channels (origin + internal-session checked BEFORE the handler); they take NO page-supplied arguments.

## Inputs

- `package.json` `build`: `appId: com.goldfinch.browser`, `nsis: { oneClick: false, allowToChangeInstallationDirectory: true }`, `linux: { target: [AppImage, deb], category: Network, maintainer }`, `directories.buildResources: build`. No `protocols`, no top-level `desktopName`.
- electron-builder (`node_modules/app-builder-lib`): `build.protocols` → Linux `.desktop` `MimeType=x-scheme-handler/…` (`out/targets/LinuxTargetHelper.js` ~:288-294) and macOS `CFBundleURLTypes`; NOT consumed by the NSIS target. `desktopName` + `linux.syncDesktopName` (`LinuxTargetHelper.js` ~:205-216, :250-257). NSIS hooks `customInstall` (`templates/nsis/installSection.nsh` ~:81), `customUnInstall` (`templates/nsis/uninstaller.nsh` ~:156; `${isUpdated}` used at ~:164).
- `src/main/register-settings-ipc.js` — `registerSettingsIpc({...deps})`; `automation:get-status` / `automation:set-port` / `automation:find-free-port` are the exemplar internal actions returning live state.
- `src/main/main.js` — the `registerSettingsIpc({...})` call site (deps injection).
- `src/preload/internal-preload.js` (~:155-180, `automationGetStatus` etc.) and `src/renderer/renderer-globals.d.ts` `GoldfinchInternalBridge` (~:636+).
- `src/renderer/pages/settings.html` — `<section id="appearance">` "Startup & appearance" (~:38-80), restore-session fieldset pattern (`fieldset.shields-group.startup-toggle-group`), `p[role=status]` status lines.
- `src/renderer/pages/settings.js` — button → bridge call → render returned status pattern (~:700-745, the automation port controls).
- `test/unit/register-settings-ipc.test.js` — handler test harness.

## Outputs

- `src/main/default-browser.js` (new) — Electron-free, injected deps; + `test/unit/default-browser.test.js` (new)
- `src/main/register-settings-ipc.js` — two new `registerInternalHandler` channels; `main.js` wires deps
- `src/preload/internal-preload.js`, `src/renderer/renderer-globals.d.ts` — two bridge methods
- `src/renderer/pages/settings.html`, `src/renderer/pages/settings.js` (+ `styles` only if needed) — "Default browser" row
- `package.json` — `desktopName`, `build.protocols`, `build.linux.syncDesktopName`, `build.nsis.include`
- `build/installer.nsh` (new)
- `test/unit/default-browser-packaging.test.js` (new) — package.json + installer.nsh pins
- Docs: `CLAUDE.md` (short entry), `docs/RELEASING.md` (installer registration note), `build/README.md` if it lists build resources

## Acceptance Criteria

- [ ] **AC1 — Status/action module.** `src/main/default-browser.js` exports a factory `createDefaultBrowser({ app, shell, platform, env, logger })` (Electron-free: every live handle injected) returning `{ getStatus(), makeDefault() }`:
  - `getStatus()` → `{ supported, reason, isDefault, platform }`. `supported: false, reason: 'dev'` when `!app.isPackaged`; `supported: false, reason: 'appimage'` when `platform === 'linux'` and `env.APPIMAGE` is set; `supported: false, reason: 'platform'` for any platform other than `linux`/`darwin`/`win32`; otherwise `supported: true, reason: null`. In every unsupported state `isDefaultProtocolClient` is NEVER called (on Linux each call spawns `xdg-settings`). `isDefault`: on `linux`/`darwin` = `app.isDefaultProtocolClient('http') && app.isDefaultProtocolClient('https')`; on `win32` = `null` (unknown — DD7); when unsupported = `null`.
  - `makeDefault()` → `{ ok, status }`. Unsupported → `{ ok: false, status }` with NO side effect. `win32` → `shell.openExternal('ms-settings:defaultapps?registeredAppUser=Goldfinch')` (the literal, defined once as a module constant; never derived from input), `ok` = the promise resolved. `linux`/`darwin` → `app.setAsDefaultProtocolClient('http')` AND `('https')` (both called even if the first returns false), `ok` = both returned true. `status` is a fresh `getStatus()` after the action.
  - Never throws: a throwing/rejecting dep yields `{ ok: false, status }` and one logger line (no URL/secret content).
  - Unit tests with fakes cover: dev → unsupported, no calls; AppImage → unsupported, no calls; linux both-true → ok + isDefault true; linux one-false → ok:false (both still called); darwin path; win32 → exact literal passed to `openExternal`, `isDefault` null, `setAsDefaultProtocolClient` never called; unknown platform → unsupported; unsupported states never call `isDefaultProtocolClient`; throwing dep → ok:false. Plus a source-scan pin: exactly one `openExternal(` call site in `src/**` (comment-masked), in `default-browser.js`, whose argument is the module constant.
- [ ] **AC2 — Internal channels.** `register-settings-ipc.js` registers `default-browser:get-status` and `default-browser:make-default` via `registerInternalHandler`, each ignoring every argument after `_event` and delegating to an injected `defaultBrowser` dep (wired in `main.js` with the real `app`, `shell`, `process.platform`, `process.env`). Neither is a bare `ipcMain.handle`, neither touches the settings store, neither broadcasts `settings-changed`. `register-settings-ipc.test.js` gains cases: both channels registered through `registerInternalHandler` (not `ipcMain.handle`), extra arguments ignored (a payload `'ms-settings:evil'` never reaches the dep), delegation returns the dep's value. That file's existing exact `deepEqual` list of internal handler names is updated to include both channels, and `test/unit/helpers/settings-ipc-harness.js` (which calls `registerSettingsIpc({...})` with an explicit dep list) gains a `defaultBrowser` fake so every existing harness user keeps working.
- [ ] **AC3 — Bridge + types.** `internal-preload.js` exposes `defaultBrowserGetStatus()` and `defaultBrowserMakeDefault()` (zero-argument invokes, JSDoc'd like the automation methods); `renderer-globals.d.ts` types both on `GoldfinchInternalBridge`.
- [ ] **AC4a — Row model (pure).** `src/shared/default-browser-row-model.js` (ESM, DOM-free, never throws) maps `{ status, lastResult, inFlight }` → `{ text, failureText, buttonHidden, buttonDisabled, buttonLabel }` for the full copy matrix below. Unit-tested over every state: `dev`, `appimage`, `platform`, linux/darwin `isDefault` true/false, win32 supported (`isDefault: null`), `lastResult.ok === false` on supported linux/darwin (failure text present), in-flight (button disabled), and a null/garbage status (safe fallback, no throw). `settings.js` receives it the way internal pages consume shared pure functions (CLAUDE.md: flat `./default-browser-row-model.js` specifier with `// @ts-ignore`, an exact `internal-page-map.js` route, and — if settings.js is not already a module-sourceType entry — the eslint module list; `internal-page-route-closure.test.js` / `settings-page-shared-scripts.test.js` stay green). This is the unit-level proof of the row's copy; the live proof of a supported state is the leg-3 HAT (Windows) plus the recorded Linux residual (AC8).
- [ ] **AC4 — Settings row.** In `settings.html`'s "Startup & appearance" section, a "Default browser" group (fieldset/legend in the existing `shields-group` style) with a status line (`role="status"`) and a "Make default" button. `settings.js` (patch-in-place; never rebuild what holds focus — CLAUDE.md gotcha):
  - on load and on `visibilitychange` → visible and window `focus`, calls `defaultBrowserGetStatus()` and renders from the RETURNED state only (never optimistic), through the AC4a model; refreshes are coalesced (one in flight at a time) and a response older than the latest issued request — including a `get-status` that resolves after a `make-default` — is dropped, so only the latest result renders;
  - status copy: unsupported `dev` → "Available in installed builds only." (button disabled); unsupported `appimage` → explains the AppImage has no system desktop entry (integrate it, or use the .deb) (button disabled); linux/darwin `isDefault: true` → "Goldfinch is your default browser." (button hidden); linux/darwin `isDefault: false` → "Goldfinch is not your default browser." (button shown); win32 (`isDefault: null`, supported) → "Choose Goldfinch under Windows Default apps." (button shown, label may read "Open Default apps");
  - click → `defaultBrowserMakeDefault()`; `ok:false` on a supported linux/darwin → a distinct failure line ("Couldn't set Goldfinch as the default browser.") and the returned status rendered; the button is disabled while the call is in flight;
  - ids are new and stable (`default-browser-status`, `default-browser-make-default`), all text via `textContent`.
- [ ] **AC5 — Linux packaging config.** `package.json`: top-level `"desktopName": "goldfinch.desktop"`; `build.protocols: [{ "name": "Web", "schemes": ["http", "https"] }]`; `build.linux.syncDesktopName: true`. A packaging pin test (`default-browser-packaging.test.js`) asserts all three and that `build.appId` is unchanged.
- [ ] **AC6 — Windows NSIS include.** `package.json` `build.nsis.include: "build/installer.nsh"` (electron-builder also auto-picks `build/installer.nsh` from `buildResources`; the explicit key documents it). `build/installer.nsh` defines `!macro customInstall` writing, under `SHELL_CONTEXT`: `Software\Classes\GoldfinchHTML` (default value e.g. "Goldfinch HTML Document", `FriendlyTypeName`, `URL Protocol` NOT set on the ProgID, `DefaultIcon` → `"$INSTDIR\${APP_EXECUTABLE_FILENAME}",0`, `shell\open\command` → `"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"`); `Software\Clients\StartMenuInternet\Goldfinch` (default value "Goldfinch", `DefaultIcon`, `shell\open\command` → `"$INSTDIR\${APP_EXECUTABLE_FILENAME}"`, `Capabilities` with `ApplicationName`, `ApplicationDescription`, `ApplicationIcon`, `StartMenu\StartMenuInternet` = `Goldfinch`, `URLAssociations\http` and `\https` = `GoldfinchHTML`); `Software\RegisteredApplications` value `Goldfinch` = `Software\Clients\StartMenuInternet\Goldfinch\Capabilities`. `!macro customUnInstall` deletes exactly those keys/value ONLY inside `${ifNot} ${isUpdated}`. The include touches no shortcut, AUMID, or `appId`. The packaging pin test (on the include with `;` comment lines stripped) asserts: the include path in package.json, both macro names present, every key path above present, `SHELL_CONTEXT` used (no hard-coded `HKLM`/`HKCU` outside comments), `${APP_EXECUTABLE_FILENAME}` the only executable reference and still defined by the installed electron-builder template (`node_modules/app-builder-lib/templates/nsis/common.nsh`), every `DeleteRegKey`/`DeleteRegValue` line structurally INSIDE the `${ifNot} ${isUpdated}` … `${endIf}` block, and `ms-settings:defaultapps?registeredAppUser=Goldfinch`'s `Goldfinch` equals the `RegisteredApplications` value name (drift guard between AC1's literal and the include).
- [ ] **AC7 — Build evidence.** `npm run pack` succeeds on Linux. A Linux `.deb` is built (`npx electron-builder --linux deb`; it downloads `fpm` — if the network/tooling is unavailable, skip and record) and its payload inspected (`dpkg-deb -x` into the scratchpad): the installed `.desktop` file is named `goldfinch.desktop` and contains `MimeType=x-scheme-handler/http;x-scheme-handler/https;`, `StartupWMClass=goldfinch`, and an `Exec=` line ending in `%U`. If an NSIS build can be produced here (`npx electron-builder --win nsis`; needs wine — skip without failing if unavailable), confirm it completes with the include; otherwise record that the Windows build is exercised by the CI `build-windows.yml` task / leg 3.
- [ ] **AC8 — Packaged Linux smoke (automatable part only).** Launch the `npm run pack` output: `dist/linux-unpacked/goldfinch --user-data-dir=<scratchpad dir> --no-sandbox` — the `--user-data-dir` flag is MANDATORY (without it the unpacked build shares `~/.config/goldfinch` and would hand off to any installed Goldfinch and exit). Verify the process stays up ≥ 10 s (it did not hand off), then quit it. Do NOT open the settings row or click make-default here: packaged builds have no automation surface, and a successful `xdg-settings` write is GLOBAL (it would rewrite the operator's real default browser). Do NOT install the .deb system-wide. The packaged-Linux row + click check is a **recorded residual** (flight log), covered at unit level by AC4a and live on Windows by leg 3.
- [ ] **AC9 — Dev regression.** In the running dev instance (automation surface), `goldfinch://settings` shows the row in the `dev` unsupported state with the button disabled (read via `readDom`/`captureScreenshot` on the settings tab, opened through the `kebabActionSettings()` seam); the leg-1 intake still works (one warm hand-off `node scripts/dev-launch.mjs https://example.com/?leg2=1` lands a default-jar tab). Every existing apparatus primitive (`enumerateTabs`, `enumerateWindows`, `captureWindow`, `captureScreenshot`, `evaluate`, `readDom`) exercised once against the new state. The row is read on the internal settings tab as admin via `readDom` and `readAxTree` (NOT `evaluate`, which the internal session refuses): the `dev` status text, the disabled button, the `role=status` line and the fieldset/legend are present in the accessibility tree. `npm run a11y` cannot audit `goldfinch://settings` (the eval path excludes the internal session — `scripts/a11y-audit.mjs` ~:258, `docs/dev-testing.md` ~:142); the `readAxTree` read is the substitute. Record whether `readAxTree` accepted the internal tab.
- [ ] **AC10 — Suite gates + docs.** `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check` green. `CLAUDE.md` gains a concise entry (e.g. under Settings store or a new "Default browser" line): the two internal actions take no page arguments; win32 status is not claimed (Electron's check reads `Classes\<scheme>`, not UserChoice); the NSIS include's uninstall is `${isUpdated}`-guarded; `ms-settings:` literal is the only `shell.openExternal` target. `docs/RELEASING.md` notes the installer now registers Goldfinch as a browser, that updates re-run `customInstall` and skip the guarded uninstall deletes, that upgrading FROM a pre-include version runs the old uninstaller (no macro — expected), and that leg 3's HAT is the acceptance. The docs note that `desktopName` also changes the dev app_id/WM_CLASS (dev runs `electron .` against this package.json); grep `scripts/` and `docs/dev-testing.md` for any WM_CLASS/app_id assumption and update it. `build/README.md` gains a row for `installer.nsh`. `CLAUDE.md` and `docs/dev-testing.md` already carry leg-1 edits in the working tree — keep leg-2 edits additive.

## Verification Steps

- AC1: `node --test --test-timeout=60000 test/unit/default-browser.test.js`
- AC2: `node --test --test-timeout=60000 test/unit/register-settings-ipc.test.js`
- AC3/AC4: `npm run typecheck`; `npm run lint`; AC9's live read of the row
- AC5/AC6: `node --test --test-timeout=60000 test/unit/default-browser-packaging.test.js`
- AC7: the build commands; `dpkg-deb -x … && cat …/usr/share/applications/goldfinch.desktop`
- AC8: packaged launch with `--user-data-dir` in the scratchpad; record outcome
- AC9: automation smoke via `scripts/lib/mcp-client.mjs` (never session-registered `mcp__goldfinch*` tools)
- AC10: `npm test && npm run typecheck && npm run lint && npm run format:check`; read the doc diffs

## Implementation Guidance

1. **`default-browser.js` first** (pure logic + tests), in the injected-deps style of `settings-store.js` / `automation/engine.js`: CJS (`'use strict'`, `module.exports`), no `require('electron')`.
2. **Channels** — add to `registerSettingsIpc`'s destructured deps (`defaultBrowser`), register beside the `automation:*` handlers; wire in `main.js`'s `registerSettingsIpc({...})` call with `createDefaultBrowser({ app, shell, platform: process.platform, env: process.env, logger: console })` (`shell` from `require('electron')` in main.js — check whether it is already imported).
3. **Bridge + types** — mirror the `automation*` entries exactly.
4. **Settings row** — place it right after the restore-session fieldset and its `p.muted` note, before the bookmarks-bar toggle; reuse existing classes (`shields-group`, `settings-btn`); add CSS only if the existing classes don't lay it out. The status line is `role="status"` like `home-page-status`.
5. **package.json** — add keys without reordering others; run `npm run format`.
6. **`build/installer.nsh`** — use `WriteRegStr SHELL_CONTEXT …` / `DeleteRegKey SHELL_CONTEXT …` / `DeleteRegValue SHELL_CONTEXT "Software\RegisteredApplications" "Goldfinch"`; `${APP_EXECUTABLE_FILENAME}` is defined by electron-builder's templates (verify the define name in `node_modules/app-builder-lib/templates/nsis/`). Header comment: why (Default apps listing), the `${isUpdated}` rationale (#65/squawk 0002 mechanism), and that it is additive.
7. **Builds** — `npm run pack`, then the deb build; artifacts go to `dist/` (gitignored — confirm). Clean up nothing the operator might want; do not commit `dist/`.
8. **Live checks** — the dev instance is running (log `/tmp/claude-1000/-home-cprch-projects-goldfinch/709fd4f6-02a5-45cf-a7db-5b465593f1a0/scratchpad/dev-automation.log`, key in its `AUTOMATION_DEV_MINT` line — read into an env var, never print). It runs leg-1 code; relaunch it on this leg's code for AC9 (clean quit via chrome-tier `window.goldfinch.appQuit()`, confirm the PID is gone with `ps -p`, relaunch detached with `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 nohup npm run dev:automation > <same log> 2>&1 &`). Leave it running on the new code.

## Edge Cases

- **`openExternal` rejects** (no `ms-settings` handler, e.g. Windows Server) → `ok:false`, the row shows the failure line.
- **Settings page left open while the user changes the default elsewhere** → re-queried on focus/visibility.
- **Both schemes must match**: http default but https not → `isDefault: false`.
- **Snap/Flatpak** — not targets; no handling.
- **`xdg-settings` missing on Linux** — `isDefault` false and make-default `ok:false` (failure line); no separate state (FD ruling).
- **Desktops keyed on `default-web-browser`** — not written; recorded residual (flight DD7).
- **An operator on the settings page with automation disabled** — unaffected; these channels aren't automation.

## Files Affected

- `src/main/default-browser.js` — new
- `src/main/register-settings-ipc.js`, `src/main/main.js`
- `src/preload/internal-preload.js`, `src/renderer/renderer-globals.d.ts`
- `src/shared/default-browser-row-model.js` — new (+ `internal-page-map.js` route, eslint list if needed)
- `src/renderer/pages/settings.html`, `src/renderer/pages/settings.js` (styles only if needed)
- `package.json`, `build/installer.nsh` (new)
- `test/unit/default-browser.test.js`, `test/unit/default-browser-packaging.test.js`, `test/unit/default-browser-row-model.test.js` — new; `test/unit/register-settings-ipc.test.js`, `test/unit/helpers/settings-ipc-harness.js` — extended
- `CLAUDE.md`, `docs/RELEASING.md`, `build/README.md` (if it lists resources)

---

## Post-Completion Checklist

Completion steps — status transitions, flight-log update, checking off in the parent flight, and commit — are Flight Control protocol, driven by the execution workflow. Not repeated here.

## Citation Audit

2026-09-29 (FD): verified — `package.json` `build` block (no `protocols`/`desktopName`; `nsis` oneClick false, no `perMachine`); `register-settings-ipc.js` automation handlers (`automation:get-status`/`set-port`/`find-free-port`, ~:71-78 in the file's current layout); `internal-preload.js` automation methods (~:163-178); `renderer-globals.d.ts` `GoldfinchInternalBridge` (~:636); `settings.html` `#appearance` section with restore-session fieldset; `settings.js` automation port click handlers (~:704-745); `test/unit/register-settings-ipc.test.js` exists. electron-builder line refs carried from the flight's planning probe and Architect review (not re-read this pass — the Developer re-verifies `${APP_EXECUTABLE_FILENAME}` and the hook names).
