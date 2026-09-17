# Behavior Test: Crash and Hang Surfaces

**Slug**: `crash-and-hang-surfaces`
**Status**: active
**Created**: 2026-09-16
**Last Run**: 2026-09-17-00-22-28 — partial (14/16; row 6 inconclusive on the by-eye guest-visibility clause → HAT; row 12 FAIL fixed in-run and re-verified as 12b PASS; run log `crash-and-hang-surfaces/runs/2026-09-17-00-22-28.md`)

## Intent

Verifies Mission 20 Flight 3 on the live app with real process signals: a
guest whose renderer is killed shows the crash panel (never a gray surface),
Reload revives it with its history intact, the strip marks it, and the
census says `crashed`; a stopped renderer shows the hang bar after one input
event, Wait hides it for the episode, Kill-and-reload revives the tab, and a
renderer that resumes clears the bar on its own; a killed CHROME renderer
comes back with every tab and the same active tab while the guests keep
compositing, and a crash loop pauses after three reloads in a minute; every
event leaves a redacted local record and a local minidump with no network
attempt. Process death and revival across main, registry, chrome, and the
census are only observable on the live app.

## Preconditions

- The live rig is up: `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation`
  (WSLg). The admin key is captured from the printed `AUTOMATION_DEV_MINT`
  line into a scratch file and referenced ONLY as
  `GOLDFINCH_MCP_ADMIN_KEY=$(cat <file>)` — never printed, echoed, or read
  into a transcript. The dev profile's `crash-log.jsonl` is noted (size/line
  count) before step 0 and the `crashDumps` directory (the dev profile's
  `Crashpad/pending` and `Crashpad/completed` subdirectories) listed.
- Fixtures: `python3 -u -m http.server {P} --bind 127.0.0.2 --directory tests/behavior/fixtures/keyboard-nav`
  (`links.html`, `form.html` for history); `tests/behavior/fixtures/crash/busy.html`
  served from the same server or a second port `{B}` (a page with a
  "Busy loop 20 s" button).
- **No operator action is required** — every row is automatable with OS
  signals; the operator may watch.
- Optional network tripwire for step 12: launch with `HTTPS_PROXY`/`HTTP_PROXY`
  pointed at a refusing port (`http://127.0.0.2:{Q}`) or with
  `--log-net-log=<scratch>/netlog.json`, so any upload attempt is visible.

## Observables Required

- rendered chrome state — `captureScreenshot` of the CHROME wcId (hidden
  guest under the panel) and `captureWindow` once a guest is visible again;
  the chrome a11y tree (`readAxTree`)
- app tab state — `enumerateTabs` rows incl. `loadState`, `loadError`,
  admin `pid`; `enumerateWindows` incl. `booted`, `activeTabWcId`,
  `chromePid`
- guest DOM — `readDom` of the revived page; history via admin `evaluate`
  of `window.goldfinch.tabHistorySnapshot({ webContentsId })` on the chrome
- chrome DOM drive — admin `evaluate` clicks on `#load-failure-reload`,
  `#hang-notice-wait`, `#hang-notice-kill`; `click` on the hung tab (the
  input event Chromium's hang monitor needs)
- shell — `kill -SEGV|-KILL|-STOP|-CONT <pid>`; `crash-log.jsonl` tail; the
  `crashDumps` directory listing; the net-log / proxy tripwire

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 0 | Enumerate tabs and windows; record `crash-log.jsonl` line count `{N0}` and the dump directory listing (`Crashpad/pending` + `Crashpad/completed` file counts under the dev profile). | Every row `loadState: "ok"`; admin rows carry a numeric `pid`; the window row carries `chromePid` and `booted: true`. |
| 1 | Open a tab via `openTab` to `http://127.0.0.2:{P}/links.html`; then `navigate` it to `http://127.0.0.2:{P}/form.html` (two history entries). Read its `pid`. From the shell: `kill -SEGV <pid>`. Wait up to 5 s (settle: two identical census reads 500 ms apart). Capture the chrome; read the chrome a11y tree; enumerate tabs. | The page area shows the crash panel — heading "This page crashed", the address `…/form.html`, the raw `crashed (139)` line, a **Reload** button — never a gray surface. Census: `loadState: "crashed"`, `loadError.name` `crashed`, `loadError.code` `139`, `pid: null`, `url` `…/form.html`. The strip entry carries the glyph and a "— crashed" suffix. |
| 2 | `evaluate` a click on `#load-failure-reload`. Wait up to 10 s (settle). `captureWindow`; `readDom`; enumerate tabs; read the tab's history snapshot via `evaluate` on the chrome. | The page (`form.html`) is visible again; census `loadState: "ok"`, a NEW numeric `pid`; the history snapshot has two entries with index 1 (back is available). |
| 3 | `navigate` the same tab to `http://127.0.0.2:{P}/links.html`; read the new `pid`; `kill -KILL <pid>`; settle; read the chrome a11y tree; enumerate tabs. | Crash panel with the "closed by the system" (killed) wording and `killed (9)`; census `loadState: "crashed"`, `loadError.name` `killed`, `loadError.code` `9`. |
| 4 | Open a second tab via `openTab` to `about:blank` (active). Enumerate tabs; capture the chrome. | The first tab stays `crashed` in the background with its strip mark; the active tab is ordinary; no panel on the active tab. |
| 5 | `activateTab` the first tab. Capture the chrome. | The crash panel is projected again. |
| 6 | Reload it via `#load-failure-reload`; settle; enumerate tabs and read the tab's NEW `pid`. Then `kill -STOP <pid>` on that tab; issue one `click { wcId, x: 10, y: 10 }` on the tab; wait up to 40 s polling the census every 2 s for `loadState: "hung"`. Read the chrome a11y tree; capture the chrome. | Within the wait the census reads `loadState: "hung"`; a bar under the toolbar reads "This page isn't responding" with **Wait** and **Kill and reload**; the guest remains visible `[by-eye]` (a `SIGSTOP`ped renderer produces no compositor frame, so `captureWindow`/`captureScreenshot` time out for the whole hang — this clause is a HAT check, not an automation read); the strip entry carries a "— not responding" suffix. |
| 7 | `evaluate` a click on `#hang-notice-wait`. Read the a11y tree. | The bar is hidden; census still `hung`; the guest untouched. |
| 8 | `kill -CONT <pid>`. Wait up to 15 s polling for `loadState: "ok"`. Read the a11y tree. | The renderer answers; census `ok`; the bar stays hidden (cleared by `responsive`); the strip suffix is gone. |
| 9 | `navigate` the tab to `http://127.0.0.2:{B}/busy.html`; read its `pid`; `click` the "Busy loop 20 s" button (a REAL renderer hang — a `SIGSTOP`ped process cannot service the kill, leg-2 anomaly); poll for `hung`; then `evaluate` a click on `#hang-notice-kill`. Wait up to 15 s. `captureWindow`; enumerate tabs. | The tab goes hung → reloading → the page is visible again with a NEW `pid`; at no point does the census read `crashed` (the kill-reload path bypasses the crash panel); the bar is gone. |
| 10 | Read `chromePid` from `enumerateWindows`. Record the census (wcIds, active). `kill -SEGV <chromePid>`. Poll `enumerateWindows` every 500 ms up to 15 s: expect `booted: false` then `booted: true`. Then enumerate tabs; `captureWindow`. | The window recovers: `booted` returns true with the SAME `activeTabWcId`; `enumerateTabs` lists the same wcIds as before (all `ok`, the crashed-then-reloaded ones included), in the same order as the earlier census; the window composite shows the strip, the toolbar, and the active page. `chromePid` is a new number. |
| 11 | Storm: open two more tabs to `links.html`; read their pids; from the shell send `kill -SEGV` to BOTH within one second. Settle. Enumerate tabs; capture the chrome. | Both read `crashed`; the active one shows the panel; no tab reloaded on its own (`pid` stays null for both until Reload). |
| 12 | Chrome crash loop: `kill -SEGV <chromePid>` three more times, waiting for `booted: true` between each; then a fourth within the same minute. Poll `enumerateWindows` for 20 s. | The first three each recover (`booted` true again); after the fourth, `booted` stays false for the whole poll (the first post-kill read may still show the pre-crash state — a signal race, not a regression) AND the window's `enumerateWindows` row carries `recoveryPaused: true` — recovery paused (observed as `booted: false` persisting AND `recoveryPaused: true`; the title text itself is a HAT-only read on wayland); the app process is still alive (MCP answers). |
| 13 | Tail `crash-log.jsonl`: count lines since `{N0}`; parse the new lines. | At least 8 new lines (illustratively: guest crashes ×≥3, hang-kill ×1, storm ×2, chrome ×5 — a collateral crash of a same-process sibling tab adds its own line); every line has EXACTLY these eight keys and no others: `ts kind reason exitCode origin jarKind windowId recovery`; guest lines carry `origin: "http://127.0.0.2:{P}"` with no path, no query, no fragment, and no `links.html`/`form.html`/title anywhere in the value; chrome lines carry `kind: "chrome"` and a `recovery` of `reloaded` (×4) then `paused` (×1). |
| 14 | List the dump directory; compare with step 0. Check the network tripwire (net-log or proxy port log). | At least one new `.dmp` file exists; no request left the app for it (no net-log upload entry / no connection to the tripwire). |
| 15 | Relaunch the app (the paused window cannot recover by itself). Enumerate windows. | Fresh boot; `booted: true`; the session restore brings the tabs back at their addresses (cleanup verified). |

**Row notes**: Leg 3's smoke found `kill -SEGV` against a SANDBOXED guest
renderer unreliable in one session (the chrome view, `sandbox:false`, crashed
every time; a sandboxed web guest twice stayed `ok`) — if a guest stays `ok`
5 s after SEGV, the Executor sends `kill -ABRT` (still `reason: crashed`,
same wording) and only then `-KILL` (`reason: killed`, exit code `9`, the
"closed by the system" wording); the Validator judges the crash-panel wording
and `loadError` fields against whichever signal actually landed, not
necessarily SEGV. Step 12's observation of the pause is `booted: false`
persisting AND `recoveryPaused: true` (the title text itself is out of
automation reach on Wayland — a HAT-only read). The `[a11y]`-flagged
`crashed`/`hung` chrome states are audited by `npm run a11y` via the
`showCrashPanelForAudit()`/`showHangNoticeForAudit()` seam hooks, not by this
spec.

## Out of Scope

- Sleep/resume itself (not reproducible on the rig) — the storm rows stand
  in.
- A real OOM (optional variant).
- #216 keyboard reach after a typed failure (Known Issue) — the panel's
  Reload button is verified by `evaluate` click and at the HAT.
- Chrome-only state lost across chrome recovery (find text, welcome tabs,
  pending queries) — documented drop, not tested.

## Variants (optional)

- **`oom`** — a fixture page that allocates until the renderer dies; expect
  `reason: "oom"` and the out-of-memory wording. Skippable.
