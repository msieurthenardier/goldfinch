# Behavior Test: A download's name is clean and its retry stays in its jar

**Slug**: `download-true-type`
**Status**: active
**Created**: 2026-11-14
**Last Run**: 2026-11-14 — pass (8/8), [run log](download-true-type/runs/2026-11-14-04-54-01.md)

## Intent

Verify two download properties that only the running browser can show (Mission 23 Flight 1, leg `downloads`): a page-suggested file name cannot carry characters that disguise it, and a re-download goes through the jar the download came from. Unit tests pin the sanitiser's table and the retry's refusals; only a live run shows the name that actually lands on disk and the session a retry actually uses.

The spec keeps its original slug. Its scope was narrowed with the leg: it no longer asserts anything about file-type classification or a confirmation before opening, which the operator ruled are the operating system's job.

## Preconditions

- Goldfinch running via `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1 npm run dev:automation`; admin key from the printed `AUTOMATION_DEV_MINT` line; client attached with `connectAutomation()` (`scripts/lib/mcp-client.mjs`). **Never** a registered MCP server.
- The fixture server `tests/behavior/fixtures/download-true-type/serve.mjs` on `127.0.0.1:8261` (the Executor starts it and records its request-log path). It serves: `/` — a page that sets a per-jar cookie and links the files below; `/dl/<prefix>-report.pdf` — a small inert PDF as an attachment; `/dl/<prefix>-flaky.bin` — an attachment that is cut short on every request **while the break switch is on** and served whole when it is off; `/break` and `/heal` — the switch; every request is logged with its path and the names and short fingerprints of the cookies it carried. `<prefix>` is a run-unique string the Executor chooses and passes at start, so saved files cannot collide with the operator's own.
- Two persistent jars available; the non-default one is called **A** below.
- Saved files land in the operator's real Downloads folder (dev mode has no separate one). **The run never opens a downloaded file**, and the Executor deletes, by exact name, every file it saved before finishing.
- **Non-vacuity is established outside this spec**: leg `downloads` recorded, on the pre-change build, a saved name still containing the right-to-left override (step 3's case) and a retry arriving without jar A's cookie (step 6's case).
- **Apparatus (act)**: `openTab` on fixture pages; `evaluate` on the chrome target for the chrome's own `downloadMedia` bridge call (the call the media panel makes) and for opening the downloads page with the chrome's trusted tab-creation call; `evaluate` on the `goldfinch://downloads` internal tab (admin) to read rows and activate a row's control with the element's own `click()`. **Apparatus (observe)**: the admin `downloadsList` tool; the file system; the fixture's request log; `readDom` on the downloads page.
- **Unobservable, not asserted here**: the downloads popup on the sheet and the download toast.

## Observables Required

- mcp (`enumerateWindows`, `enumerateTabs`, `openTab`, `evaluate`, `readDom`, `getChromeTarget`, `downloadsList`)
- shell (fixture server lifecycle)
- filesystem (saved files; the fixture's request log)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **Active-precondition probe.** Attach with the admin key; `tools/list`; `enumerateWindows`; `getChromeTarget`; start the fixture server with a run-unique prefix; `downloadsList` and record the count **N0**. | Attach succeeds; `downloadsList`, `evaluate`, `openTab` and `readDom` are present; one booted window; the fixture answers 200 on `/`. **If not, halt.** |
| 2 | Open the fixture's `/` in a tab in jar **A**; record its wcId **TA** and, from the request log, the fingerprint of the cookie the fixture issued to jar A. | The page loads; the log shows jar A's request and the fixture's cookie — set on this request, or already carried if a restored tab in the same jar loaded the page first. *(setup)* |
| 3 | **A name that tries to disguise itself.** On the chrome target, `evaluate` `window.goldfinch.downloadMedia({ webContentsId: TA, url: '<fixture>/dl/<prefix>-report.pdf', suggestedName: … })` with the suggested name built in the script as `'<prefix>-invoice' + '‮' + 'fdp.pdf'` (a right-to-left override in the middle). Poll `downloadsList` until a new record is `completed`. `stat` the saved file and list the saved name's code points. | Exactly one new record, `completed`. Its `filename` is `<prefix>-invoice_fdp.pdf` and the file exists on disk under exactly that name. The name contains no U+202E and no other control or format character. The record's `partition` is jar A's. |
| 4 | **An interrupted download in jar A.** Request the fixture's `/break`. On the chrome target, `evaluate` `downloadMedia({ webContentsId: TA, url: '<fixture>/dl/<prefix>-flaky.bin' })`. Poll `downloadsList` for up to 20 s for a new record in state `interrupted`. Record its id **R** and the log lines for that path. | A new record for the flaky file reaches `interrupted`, with `partition` jar A's. Every log line for that path — Chromium retries by itself several times — carries jar A's cookie. **If the record completed instead, the fixture did not break — halt and report; do not mark pass.** |
| 5 | Request the fixture's `/heal`. Open the downloads page: on the chrome target `evaluate` an async wrapper around `createTab('goldfinch://downloads', null, { trusted: true })` returning a plain string; find its wcId **D** with `enumerateTabs`. `readDom(D)`; `evaluate` on **D** to find record **R**'s row and whether it has a Retry control. | The page lists **R** as interrupted and its row offers Retry (no "cannot retry" line). |
| 6 | **Retry goes through the owning jar.** Record the request log's length. `evaluate` on **D** a `click()` on **R**'s Retry control. Poll `downloadsList` for a new `completed` record for the flaky file. Read the request log delta; `stat` the saved file. | A new record completes, with `partition` jar A's, and its file exists. The log delta's request for the flaky path **carries jar A's cookie** — the retry went through jar A's session. |
| 7 | `readDom(D)` and `evaluate` on **D**: for record **R** (still interrupted) and for the completed rows, which rows have an Open control. | The interrupted row has **no** Open control; the completed rows do. *(That activating one opens the file is `[by-eye]` — the run never opens a file.)* |
| 8 | `downloadsList`; `enumerateWindows`; confirm the app's main process is still running; stop the fixture server; delete by exact name the files this run saved and confirm they are gone. | Record count is **N0** plus three (steps 3, 4 and 6); one booted window; the process is alive; the saved files are removed and port 8261 is free. |

## Out of Scope

- File-type classification and any confirmation before opening a download — by operator ruling the operating system's prompt covers running a downloaded program; that the download carries the internet-origin mark on Windows and macOS is a HAT item.
- The downloads popup, the toast, and how a long name is shortened.
- A record with no jar, a deleted jar, a burner whose tabs are gone, a non-web URL (not retryable), and the page's open action on an unfinished record — unit-tested.
- Media-list validation and the media proxy — `cross-jar-fetch-isolation`. Basic download recording — `downloads-surface`.
