# Behavior Test: Setting-gated session restore across a real quit + relaunch

**Slug**: `session-restore`
**Status**: draft
**Created**: 2026-07-16
**Last Run**: never — **authored at M09 F9 leg 4; the RUN is HAT-scoped (F10).**

> ## ⚠️ WHY THIS SPEC IS AUTHORED-BUT-UNRUN (DD9 NO-GO)
>
> Session restore's whole point is observable only **across a process restart**: quit the app,
> relaunch it, and see the windows/tabs come back. The goldfinch automation MCP **cannot
> self-relaunch** — once the app quits, the MCP transport dies with the process. So this spec needs
> an **out-of-band relaunch harness**: the Orchestrator (not the in-app Executor) drives the clean
> quit, then **relaunches the OS process and reconnects the admin MCP client**.
>
> **F9's DD9 probe returned NO-GO in the authoring session** — no goldfinch MCP was registered, no
> admin key was set, and no dev instance was running, so the relaunch cycle could not be exercised.
> Per DD9 this is a real, honest outcome: the **structural proof** lives in the unit layer (leg 2's
> `session-store`/`session-snapshot`/`persist-jar-gate` both-directions tests, leg 3's wiring
> source-scans), and the **live E2E cycle is HAT-scoped to F10**, where the operator has the rig.
> This spec is written so F10 can run it as-is. **Do not mark it `active` until it runs clean.**
>
> **The clean quit itself is in-band** (DD9): the `window.goldfinch.windowClose()` chrome bridge —
> the same one `tab-tearoff` row 9 drives — fires the per-window `close` capture and, on the last
> window, `window-all-closed → app.quit()`. Only the **relaunch + admin-MCP reconnect** is
> genuinely out-of-band. A `SIGKILL` must NOT be used — it fires no clean-quit handler, so no
> snapshot is written and there would be nothing to restore.

## Intent

Verify, against the real app, that when "Restore session on startup" is **on**, a clean quit writes
the open window/tab topology and the next launch rebuilds those windows with their tabs **created
fresh** at their saved **addresses** in their saved **cookie jars** — with **burner tabs excluded by
construction** — and that with the setting **off** (the default) startup is unchanged. This is
real-environment behavior (process lifecycle + persistence + jar routing across a restart) that no
unit test can observe; the unit layer pins the pure pieces, this pins the end-to-end truth.

## Preconditions

- The live rig is up: `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation`
  (Wayland). **Bind-probe for a free port** — `ss -ltn` cannot see WSL2 ports held by Windows-side
  listeners. A live sibling Goldfinch may hold the default profile's port — leave it untouched.
- The admin MCP key is available **by env-var reference ONLY, never a command literal** (standing
  carry — an F6 executor leaked one). Capture it from the launch's `AUTOMATION_DEV_MINT` line.
- **The out-of-band relaunch harness is available**: the Orchestrator can (a) drive a clean quit via
  the `windowClose` bridge, (b) relaunch the same `dev:automation` process against the **same
  userData profile** (so `session.json` persists across the restart), and (c) reconnect the admin MCP
  client to the relaunched instance. **This is the DD9 premise — confirm it before running.**
- At least **two** persist jars exist (e.g. `work` and `personal`) plus the default jar, so a
  multi-jar restore is observable.

## Observables Required

- **browser** — window/tab topology across a restart, measured via the goldfinch admin MCP
  (`enumerateWindows`, `enumerateTabs` → `{ wcId, url, title, jarId, active, windowId }`), plus the
  Settings-page toggle driven via `evaluate`/`click`.
- **shell** — the out-of-band quit-and-relaunch of the OS process (Bash), and a free-port bind-probe.

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **Active-precondition probe.** Connect the admin MCP client; `tools/list`; call `enumerateWindows()` and `enumerateTabs()`. | `tools/list` includes (presence-checked) `enumerateWindows`, `enumerateTabs`, `openTab`, `evaluate`, `getChromeTarget`. `enumerateWindows` returns ≥1 window. If not, halt — preconditions not met. |
| 2 | **Enable the setting.** Navigate a tab to `goldfinch://settings`; via the Settings UI toggle "Restore session on startup" **on** (`click` the labeled checkbox, or `evaluate` the internal `settingsSet('restoreSession', true)` on that origin). Read it back. | The toggle reads **on** (`settingsGet('restoreSession') === true`). (setup row) |
| 3 | **Build a known session with a burner.** In window W1, open three tabs at distinct fixture URLs: **T-work** in jar `work`, **T-personal** in jar `personal`, and **T-burner** in a **burner** jar. Make **T-work** the active tab. Record the exact set via `enumerateTabs()`: for each, `{ url, jarId, active, windowId }`. | `enumerateTabs` shows the three tabs with the expected `jarId`s (`work`, `personal`, and the burner's ephemeral id), exactly one `active: true` (T-work). (setup row — the burner is present NOW; step 6 asserts it is GONE after restore.) |
| 4 | **Clean quit (in-band).** Drive `evaluate(chrome, "window.goldfinch.windowClose()")` on W1 (the last/only window) → the `close` capture fires, then `window-all-closed → app.quit()`. Confirm the OS process has exited (Bash: the pid is gone). **Do NOT SIGKILL.** | The process exits cleanly (a clean quit fired the snapshot write). The MCP transport is now dead — expected. |
| 5 | **Relaunch (out-of-band) + reconnect.** Bash: relaunch `dev:automation` against the **same userData profile**; bind-probe a free port; reconnect the admin MCP client; capture the new admin key by env reference. | A new instance is up and the admin client is reconnected. `enumerateWindows()` returns. |
| 6 | **Restore verdict — the RIGHT observable.** `enumerateTabs()` on the relaunched app. | **Exactly two** restored tabs: **T-work** (jarId `work`) and **T-personal** (jarId `personal`), at their saved URLs, with **T-work** `active: true`. **The burner tab is POSITIVELY ABSENT** — assert no tab carries the burner's jarId and the total restored count is exactly 2 (not "≥2"). *(This is the assertion that matters — a bare "the window came back" would pass over a burner that leaked into the snapshot. Burner exclusion is the mission's absolute constraint; assert its ABSENCE explicitly.)* No navigation back-history is expected (DD5 — restore is address+jar only). |
| 7 | **Two-window menu-Exit regression guard (the DD3 two-writer bug).** Fresh session: open **window W1** (a tab in `work`) and a **second window W2** (a tab in `personal`). Quit via the **menu Exit** path (`app-quit`/`evaluate(chrome,"window.goldfinch.appQuit()")` — NOT closing windows one by one). Relaunch + reconnect (as steps 4–5). `enumerateWindows()` + `enumerateTabs()`. | **BOTH** windows are restored — `enumerateWindows` shows **two** windows, each with its saved tab and jar. *(A single-window E2E would pass over the exact bug the two-writer coordination fixes: on menu-Exit the naive per-close write shrinks the snapshot to just the last-closed window. This row fails if only one window comes back.)* |
| 8 | **Default-off is unchanged.** Toggle "Restore session on startup" **off**. Build a session (a couple of tabs). Clean-quit, relaunch, reconnect. `enumerateWindows()` + `enumerateTabs()`. | Startup is **unchanged**: exactly **one** window with the default boot tab (whatever the app boots with cold), **none** of the prior session's tabs restored. *(The absolute regression-baseline constraint: off ⇒ nothing restored.)* |

## Out of Scope

- **Navigation back/forward history** and **window geometry (size/position)** on restore — **DD5**,
  not persisted (the criterion is "addresses + jar assignments"; F8 proved this rig's window
  coordinates a cached fiction). Reopen (`tab-tearoff`/F4) owns history; restore owns address+jar.
- **Crash recovery** — **DD6**, clean-quit only. A `SIGKILL` writes no snapshot; do not test restore
  after a kill (there is nothing to restore, by design).
- **Strip order fidelity** beyond the manifest's array (insertion) order (DD3 note).
- **Closed-tab (reopen) stack cross-restart persistence** — DD-Scope, explicitly deferred.

## Variants (optional)

- **Deleted-jar drop (DD4 edge):** enable restore, open a tab in jar `personal`, quit, **delete jar
  `personal`**, relaunch. Expect that tab to be **dropped** (not home-substituted into the default
  jar) — the manifest entry whose jarId no longer resolves is skipped (`resolveRestoreContainer`
  returns null → the boot loop `continue`s). Positively assert no tab lands in the default jar in its
  place.
