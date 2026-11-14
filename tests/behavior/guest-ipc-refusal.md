# Behavior Test: A page in a tab cannot drive a chrome-trust IPC channel

**Slug**: `guest-ipc-refusal`
**Status**: active
**Created**: 2026-11-13
**Last Run**: 2026-11-14 — pass (9/9), [run log](guest-ipc-refusal/runs/2026-11-14-01-38-14.md)

## Intent

Verify that web content in a tab cannot change browser state or read chrome-only data through the main process's IPC handlers, even though (Mission 23 Flight 1, `probe-results.md` Q1) a page can come to hold the guest preload's IPC object. The boundary is the main-side caller-class gate: a call that arrives from a tab's webContents on a chrome-class channel is refused before the handler runs. This needs a behavior test because the property only exists across the real process boundary, with a real guest sender.

## Preconditions

- Goldfinch running via `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_IPC_TRACE=1 npm run dev:automation`, its stdout captured to a file the Executor can read; admin key taken from the printed `AUTOMATION_DEV_MINT` line; client attached with `connectAutomation()` (`scripts/lib/mcp-client.mjs`). **Never** the registered `goldfinch-dev` MCP server.
- The fixture server `tests/behavior/fixtures/page-containment-probe/server.cjs` serving on `127.0.0.1:8231` (port free beforehand).
- **Non-vacuity is established outside this spec**: leg `ipc-gate` recorded in the flight log one run of the same fixture against the pre-gate build in which both calls succeeded. A pass here means the gate refused, not that the page could not call.
- **Apparatus (act)**: the fixture page `refusal.html`, which on a signal makes exactly two calls from the page's own world using the IPC object it was handed: an invoke of `settings-get` and a send of `toggle-bookmarks-bar`. It writes what it reached and what each call returned into its own DOM. **Apparatus (observe)**: the page's DOM via `readDom` / `evaluate` on the tab; the chrome's state via `evaluate` on the chrome target (`getChromeTarget`); the captured stdout for `GOLDFINCH_IPC_TRACE` lines.
- No step targets the sheet, a toast, the save prompt or a cross-site iframe.

## Observables Required

- mcp (`enumerateWindows`, `openTab`, `readDom`, `evaluate` on the tab and on the chrome target)
- shell (the app's captured stdout)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **Active-precondition probe.** Attach with the admin key; `tools/list`; `enumerateWindows`; `getChromeTarget`. | Attach succeeds; `enumerateWindows`, `openTab`, `readDom`, `evaluate`, `getChromeTarget` are present; one booted window. **If not, halt.** |
| 2 | On the chrome target, `evaluate` `window.goldfinch.settingsGet('bookmarksBarEnabled')`; record the value **B0**. Record the current line count **L0** of the captured stdout. | A boolean is returned. *(baseline)* |
| 3 | `openTab` on `http://127.0.0.1:8231/refusal.html`; record its wcId **T** from the `openTab` return value (a restored session may already hold an older fixture tab — never reuse one). On the chrome target, call `window.goldfinch.rescanMedia({ wcId: T })` — the chrome's own bridge call, the same main → guest message the media panel sends. Then `readDom(T)`. | The page's status element reports that it holds the IPC object (`reached: true`). **If `reached` is false the test is vacuous — halt and report; do not mark pass.** |
| 4 | On tab **T**, `evaluate` the page's own `runCalls()` and wait for its status element to report completion. `readDom(T)`. | The page reports the `settings-get` invoke **rejected** (an error, no settings object, and no text containing `automationKeyHashes`), and that it issued the `toggle-bookmarks-bar` send (a one-way send has no result; step 5 carries that half). |
| 5 | On the chrome target, `evaluate` `window.goldfinch.settingsGet('bookmarksBarEnabled')`. | Equals **B0** — the page's send did not toggle the bar. |
| 6 | Read the captured stdout after line **L0**. | Two refusal trace lines: one naming `settings-get`, one naming `toggle-bookmarks-bar`, each naming the required class `chrome` and the sender kind `tab`. Trace format: `[ipc-gate] refused channel=<channel> required=<class> sender=<kind>`. No trace line contains a URL, a title or an argument value. Electron's own `Error occurred in handler for …` block after a refused invoke is expected and is not a trace line. Record the line count **L1** here. |
| 7 | **Chrome control.** Read stdout from **L1** onward for this step. On the chrome target, `evaluate` `window.goldfinch.toggleBookmarksBar()`, then `settingsGet('bookmarksBarEnabled')`; then toggle it back and read again. | The value becomes the opposite of **B0**, then returns to **B0**. No new refusal trace line names `toggle-bookmarks-bar` for these two calls — the gate refuses by sender, not by channel. |
| 8 | Record the stdout line count **L2**. On tab **T**, `evaluate` the page's own `runOverlayCalls()` and wait for its status element to report that second batch complete; `readDom(T)`. Read stdout after **L2**. *(added by leg `ipc-gate-complete`; needs that leg's fixture function)* | The page reports its invoke of `menu-overlay:vault-unlock` returned a refusal (an error or a not-ok result — no success), and that it issued sends of `find-overlay:query` and `save-prompt:dismiss`. Three new refusal trace lines, one per channel, naming the required classes `sheet`, `find` and `save-prompt` and the sender kind `tab`. `enumerateWindows` still reports `sheetVisible: false` and `savePromptVisible: false`. |
| 9 | `enumerateTabs`; `readDom(T)`; `enumerateWindows`; confirm the app's main process is still running. | Tab **T** is still listed and still shows the fixture page; the app did not crash or navigate. |

## Out of Scope

- The 13 guest-preload channels: a page in a tab is their intended sender, so there is nothing to refuse here; their class rules are unit-tested and smoke-tested in leg `ipc-gate-complete`.
- Whether the page can obtain the IPC object at all (it can; Mission 23 accepts guests at `contextIsolation:false`).
- Vault picker raise by a page — spec `vault-gesture-trust`.
