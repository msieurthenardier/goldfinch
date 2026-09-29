# Behavior Test: External URL handoff into the running browser (warm and cold)

**Slug**: `default-browser-handoff`
**Status**: draft
**Created**: 2026-09-29
**Last Run**: 2026-09-29-21-01-11 (pass, 7/7)

## Intent

Verify, against the real app, that a URL handed to Goldfinch by the operating system — as a launch argument — opens as an ordinary untrusted tab in the **default jar**, activated, in the **last-focused window** of the already-running instance (warm), or in the first window after session restore (cold), and that the handing-off process exits instead of becoming a second browser. Also verify that hostile or non-web arguments never open anything. This needs a behavior test because the observable spans two OS processes and a process restart: single-instance hand-off, boot ordering against restore, and the jar the tab lands in are only visible in the running app. The pure argv filter is unit-pinned separately.

## Preconditions

- The live rig is up: `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation` (Wayland). Bind-probe for a free port — `ss -ltn` cannot see WSL2 ports held by Windows-side listeners. Leave any sibling Goldfinch (installed or other profile) untouched.
- The admin MCP key is referenced **by env var only, never as a command literal**. Capture it from the launch's `AUTOMATION_DEV_MINT` line. Drive the instance only through an attach-only client with the run's freshly minted key (`scripts/lib/mcp-client.mjs` pattern) — never session-registered `mcp__goldfinch*` tools.
- **Out-of-band relaunch harness** (for the cold rows): the Orchestrator can (a) cleanly quit the instance, (b) confirm the old PID is fully gone (a still-dying instance holds the single-instance lock, so a relaunch would hand off and exit), (c) relaunch against the same dev profile with extra positional args, and (d) re-mint and reconnect. Relaunch re-mints keys and renumbers windows — re-resolve windows by last-focused (squawk 0082).
- At least one persist jar other than the default exists, and the default jar is **not** Burner — so "landed in the default jar" is distinguishable from "landed in the active tab's jar" and from a burner fallback.
- A reachable test page: the local fixture server (preferred) or any stable `https://` page. Call its URL `U1`; a second, different page `U2`.
- "Restore session on startup" and the home-page setting are recorded before the run and put back afterwards. For this run, **unset the home page** (so the boot tab is the welcome surface — the case where a stray boot tab would be easiest to miss).
- **Launch commands** (state them exactly in the run log):
  - *Rig launch / cold relaunch*: `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 node scripts/dev-launch.mjs --enable-logging --no-sandbox --automation-dev [URL…]` — the same flags `npm run dev:automation` passes, plus any URLs as trailing positional args.
  - *Hand-off launch* (warm rows): `node scripts/dev-launch.mjs <args…>` with **no** `GOLDFINCH_AUTOMATION_*` env. Note: every `dev-launch.mjs` run rebuilds the preload bundle first, so allow for it in the timeout.

## Observables Required

- **browser** — tab/window topology via the goldfinch admin MCP: `enumerateTabs` rows `{ wcId, url, jarId, active, windowId }`, `enumerateWindows` (booted, last-focused); `captureWindow` for rendered confirmation of the active tab. `enumerateTabs` lists only tabs with a view — **viewless welcome tabs are invisible to it** (`automation/tabs.js`) — so tab-strip counts and welcome presence are read from the chrome DOM via admin `getChromeTarget` + `evaluate` (count `.tab` buttons in the tab strip; `#welcome-surface` is always in the DOM and toggled by `.hidden`, so "welcome shown" = it lacks `.hidden`), corroborated by `captureWindow`.
- **shell** — the hand-off process's exit code, its stdout, and its absence within a timeout (Bash); `ps` for PID liveness across the relaunch. Save `ps` output to evidence, and filter on the electron main binary or check explicit PIDs (`ps -p <pid>`) — a `grep dev-launch` pattern matches the polling shell's own command line.

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Open two windows. In window B, open a tab in a non-default persist jar and make it active. Focus window B last. Record the full tab census and which jar is the default. | (setup row, no judgment) |
| 2 | From a shell, run `node scripts/dev-launch.mjs U1` against the same dev profile while the instance is running. | Within 30 s: the shell process has exited with code 0, printed no `AUTOMATION_DEV_MINT` line, and no second Goldfinch process remains; the running instance's admin key still works (the next MCP call succeeds). The census has exactly one new tab, at `U1`, in **window B**, `active: true`, `jarId` equal to the **default** jar (not window B's active-tab jar, not a burner). `captureWindow` of window B shows `U1`'s page as the visible tab. No other tab changed. |
| 3 | From a shell, run `node scripts/dev-launch.mjs U1 U2`. | Within 30 s: the shell process exits 0. Two new tabs in window B at `U1` then `U2` (strip order), both in the default jar; `U2` is the active one. |
| 4 | Focus window A. From a shell, run `node scripts/dev-launch.mjs goldfinch://settings file:///etc/passwd "javascript:alert(1)" about:blank --automation-dev` — non-web schemes, `about:blank`, and a flag token arriving in the running instance's `second-instance` argv. | Within 30 s: the shell process exits 0 and no second Goldfinch remains. The tab census and the chrome tab-strip count are **unchanged** in every window — no tab opened, no internal page opened, window A's active tab unchanged. |
| 5 | From a shell, run `node scripts/dev-launch.mjs U2` with window A focused. | The new `U2` tab opens in **window A** (the last-focused window moved), default jar, active. |
| 6 | Turn "Restore session on startup" **on**. Note the census. Cleanly quit the instance; confirm its PID is gone. Relaunch the rig with `U1` appended to the launch args; re-mint and reconnect. | (setup row, no judgment) |
| 7 | (wait point, no actions) | Within 30 s: every window/tab from the step-6 census is restored (same URLs and jars; burners and viewless welcome tabs excluded by design — viewless records never enter snapshots), AND exactly one additional tab at `U1` exists in the **first** restored window (the first entry in `enumerateWindows`, i.e. registry insertion order), in the default jar, and it is that window's **active** tab (restore did not steal activation back). |
| 8 | Turn "Restore session on startup" **off**. Cleanly quit; confirm the PID is gone. Relaunch with `U1` appended; re-mint and reconnect. | Within 30 s: one window exists; its chrome tab strip holds exactly **one** tab — `U1`, default jar, active — and `#welcome-surface` carries `.hidden` (chrome-DOM read), corroborated by `captureWindow`. |
| 9 | Cleanly quit; confirm the PID is gone. Relaunch with **no** URL args; re-mint and reconnect. | Startup is unchanged from pre-sortie behavior: the chrome tab strip holds exactly one tab and `#welcome-surface` lacks `.hidden` (chrome-DOM read + `captureWindow`); no `U1` tab is re-opened (launch URLs are consumed once). |

## Out of Scope

- Window raise / restore-from-minimized on hand-off — WSLg focus APIs are unreliable; accepted in the Windows HAT (Sortie 01 leg 3).
- OS registration (Windows Default apps, Linux `xdg-settings`, NSIS keys) and the settings "Default browser" row — leg 2 unit pins, packaged-Linux smoke, Windows HAT.
- macOS `open-url` — wired, not accepted in Sortie 01.
- The argv filter's full matrix (flag offsets, dedupe, cap) — `extractLaunchUrls` unit tests.
- Session restore correctness itself — `session-restore`.

## Variants (optional)

- **Burner default**: repeat step 2 with Burner set as the default jar — the `U1` tab lands in a burner (the operator's default is honoured).
