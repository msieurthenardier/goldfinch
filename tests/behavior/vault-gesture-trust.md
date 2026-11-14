# Behavior Test: Only a real click on the fill icon raises the vault sheet

**Slug**: `vault-gesture-trust`
**Status**: active
**Created**: 2026-11-13
**Last Run**: 2026-11-14 — pass (11/11), [run log](vault-gesture-trust/runs/2026-11-14-04-02-54.md)

## Intent

Verify that a page cannot raise the vault picker (or its unlock sheet) by itself. Mission 23 Flight 1 found that a page in a tab can send the fill-icon gesture message with no click at all, including from a background tab. After leg `vault-fill-trust`, the main process witnesses real pointer input on each tab and honours the gesture message only when it saw a real click inside the icon's reported box, in the active tab, at most once per click. This needs a behavior test because the property exists only across the real process boundary, with real injected input and a real guest sender.

## Preconditions

- Goldfinch running via `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_IPC_TRACE=1 npm run dev:automation`, stdout captured to a file the Executor can read; admin key from the printed `AUTOMATION_DEV_MINT` line; client attached with `connectAutomation()` (`scripts/lib/mcp-client.mjs`). **Never** a registered MCP server.
- The dev profile's vault is **set up** (locked or unlocked — both raise a sheet: the unlock sheet when locked, the picker when unlocked). The run never types a master password.
- The fixture server `tests/behavior/fixtures/page-containment-probe/server.cjs` on `127.0.0.1:8231`, serving `gesture.html`: a login form, plus the same hook as `refusal.html` that lets the page keep the IPC object it is handed, and three functions the run calls by `evaluate` — `sendGestureNoClick()`, `sendGestureWithBox(box)`, `sendIconMenuNoClick()`.
- **Non-vacuity is established outside this spec**: leg `vault-fill-trust` recorded one run of `sendGestureNoClick()` against the pre-change build in which the sheet opened.
- **Apparatus (act)**: MCP `click` (input injected below the page — real input to the main process), `evaluate` on the tab for the page's own functions and for script-synthesised clicks, `activateTab`. **Apparatus (observe)**: `enumerateWindows()` `sheetVisible`; the captured stdout's `[vault-gesture]` and `[ipc-gate]` trace lines; `readDom` / `captureScreenshot` of the tab for the icon.
- **Unobservable, not asserted here**: which card the sheet shows and anything inside it; the native icon menu. Step results that would need them are marked `[by-eye]` and are not judged.
- **Accepted residual, not a failure**: a page that sends the message itself can claim a box around a real click the operator made elsewhere on that page. No step asserts otherwise.

## Observables Required

- mcp (`enumerateWindows`, `enumerateTabs`, `openTab`, `activateTab`, `click`, `evaluate`, `readDom`, `captureScreenshot`, `getChromeTarget`)
- shell (the app's captured stdout)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **Active-precondition probe.** Attach with the admin key; `tools/list`; `enumerateWindows`; `getChromeTarget`; on the chrome target `evaluate` the vault lock-state bridge call. | Attach succeeds; the listed tools are present; one booted window with `sheetVisible: false`; the vault reports it is set up. **If not, halt.** |
| 2 | `openTab` on `http://127.0.0.1:8231/gesture.html` with an explicit `jarId` naming a persistent (non-burner) jar; record its wcId **T** from the return value. On the chrome target call `window.goldfinch.rescanMedia({ wcId: T })`, then `window.goldfinch.focusActiveGuest()` (gives the guest OS focus — without it no focus event fires and no icon appears). MCP `click` on the page's username field. `evaluate` `document.hasFocus()` on **T** as a positive control. `readDom(T)`, `captureScreenshot(T)`, and `evaluate` the icon element's bounding box, **keeping a reference to the icon element in a page variable** (the icon is removed when the field loses focus; its listeners stay attached). Record the box as **BOX** and the stdout line count as **L0**. | The page reports it holds the IPC object. The fill icon (`[data-goldfinch-vault-lock]`) is present and visible beside the field, with a non-empty box. **If the icon is absent the positive case cannot run — halt and report apparatus failure; do not mark pass.** |
| 3 | **No click at all.** Wait 3 s first, so step 2's real click on the field is older than the witness window. `evaluate` `sendGestureNoClick()` on **T** (the page sends the gesture message itself, with **BOX**). Wait 1.5 s. `enumerateWindows`. Read stdout after **L0**. | `sheetVisible` is `false`. One `[vault-gesture] refused` line with `reason=no-real-input`. No `accepted` line. *(This is the step the pre-change build fails: there the sheet opened.)* |
| 4 | **Script-synthesised click.** `evaluate` on **T**: dispatch a `click` MouseEvent on the kept icon element twice (the icon is SVG and has no `.click()` method; the fixture's `synthesizeIconClicks()` does this). Wait 1.5 s. `enumerateWindows`. Read new stdout. | `sheetVisible` is `false`. Every new `[vault-gesture]` line is `refused reason=no-real-input`, and there is at least one. *(The sheet also stayed closed before this change, by the page-side check; the trace line is what shows main now refuses it.)* |
| 5 | **Real click elsewhere, honest box.** MCP `click` on a point of the page well away from **BOX** (the page heading); within the same script, `evaluate` `sendGestureWithBox(BOX)` (the heading click removes the icon, so the page sends the message itself with the icon's true box). Wait 1.5 s. `enumerateWindows`. Read new stdout. | `sheetVisible` is `false`. A `[vault-gesture] refused` line with `reason=outside-box`. |
| 6 | **Real click on the icon.** Wait 3 s. Call `focusActiveGuest()` on the chrome target again (guest focus is lost after a sheet or tab change), then MCP `click` on the username field (at its left half, outside **BOX**) to bring the icon back; re-read **BOX**; MCP `click` at the centre of **BOX** (zoom is 1, so the box centre in CSS pixels is the click coordinate). Poll `enumerateWindows` for up to 3 s. Read new stdout. | `sheetVisible` becomes `true`. Exactly one `[vault-gesture] accepted` line. *(Which card is showing: `[by-eye]`, not judged.)* |
| 7 | **One click, one raise.** Immediately (same script) `evaluate` `sendGestureWithBox(BOX)` on **T**. Wait 1 s. Read new stdout. | A `[vault-gesture] refused` line with `reason=no-real-input` — the witnessed click was already consumed. No second `accepted` line — that, not `sheetVisible` (still `true` from step 6), is what this step judges. |
| 8 | **Dismiss by tab switch.** `openTab` on `http://127.0.0.1:8231/benign.html` (it becomes active); `enumerateWindows`. | `sheetVisible` is `false`. |
| 9 | **Background tab.** With **T** now in the background, `evaluate` `sendGestureNoClick()` and then `sendIconMenuNoClick()` on **T**. Wait 1.5 s. `enumerateWindows`. Read new stdout. | `sheetVisible` is `false`. Two `[ipc-gate] refused` lines, for `guest-vault-gesture` and `guest-vault-icon-menu`, each `required=tab-guest sender=tab`. No `[vault-gesture] accepted` line. |
| 10 | **Icon menu with no click, active tab.** `activateTab(T)`; `evaluate` `sendIconMenuNoClick()`. Wait 1.5 s. Read new stdout. | One refused line for the icon menu with `reason=no-real-input`. *(That no native menu appeared: `[by-eye]`, not judged.)* `sheetVisible` is `false`. |
| 11 | `enumerateTabs`; `readDom(T)`; `enumerateWindows`; confirm the app's main process is still running; inspect every `[vault-gesture]` and `[vault-icon-menu]` line in the stdout for a URL, a number, a title or item data (the reason token `outside-box` is not a hit). | Tab **T** still shows the fixture; one booted window; the process is alive; no `[vault-gesture]` line carries a URL, coordinate, title or item data. |

## Out of Scope

- Everything inside the sheet: the destination line, arming, no selected row, the card / identity confirmation, the certificate warning, and an actual fill — `[by-eye]` in the `hat-and-alignment` leg.
- A physical pointer click (the apparatus injects input) — the same HAT leg.
- A real right-click on the icon: it opens a native menu the apparatus can neither observe nor dismiss. The right-button witness is unit-tested and smoke-tested with an app restart in leg `vault-fill-trust`.
- A page claiming a box around a real click made elsewhere on it — the accepted residual; the picker's own controls are the defence.
- Capture (`guest-vault-capture*`) and the save prompt.
