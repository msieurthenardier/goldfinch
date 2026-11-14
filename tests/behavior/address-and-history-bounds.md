# Behavior Test: The address bar hides URL credentials and a page cannot stall the browser through history

**Slug**: `address-and-history-bounds`
**Status**: active
**Created**: 2026-11-14
**Last Run**: 2026-11-14 — pass (8/8), [run log](address-and-history-bounds/runs/2026-11-14-06-00-24.md)

## Intent

Verify, on the running browser, three bounds added by Mission 23 Flight 1's leg `prompts-and-bounds`: the address bar never shows the `user:pass@` part of a URL (the classic `trusted.example@evil.example` disguise); a page that changes its title as fast as it can does not stall the browser and cannot store an enormous title; and an enormous address is not written into history. Unit tests pin the helpers and the limiter with a fake clock; only a live run shows the address bar the operator actually sees and the main process actually staying responsive.

## Preconditions

- Goldfinch running via `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1 npm run dev:automation`; admin key from the printed `AUTOMATION_DEV_MINT` line; client attached with `connectAutomation()` (`scripts/lib/mcp-client.mjs`). **Never** a registered MCP server.
- The fixture server `tests/behavior/fixtures/page-containment-probe/server.cjs` on `127.0.0.1:8231`, serving `/redir` (a redirect to a URL carrying `probeuser:probepass@`) and `bounds.html`, a page with three functions the run calls by `evaluate`: `titleFlood(ms)` — sets `document.title` to a fresh 100 KB string in a tight loop for the given time, then sets it once to the short marker title `bounds:done`, and resolves with the number of changes made; `longPush(n)` — calls `history.pushState` with an address `n` characters long and resolves; `shortPush(tag)` — calls `history.pushState` with a short address containing `tag`.
- A persistent jar for the test tabs (called **A**).
- **Non-vacuity**: leg `prompts-and-bounds` recorded what the pre-change build did. Step 2 demonstrates a fix (the pre-change address bar showed the redirect's credentials). Steps 4 and 5 are **regression guards**: the pre-change build slowed to 93 ms at worst under the same flood and did not stall. Step 3 is a guard too — a credentials URL passed directly may be cleaned by Chromium before the product sees it; no pre-change reading exists.
- **Apparatus (act)**: `openTab`, `navigate`, `evaluate` on the tab. **Apparatus (observe)**: `evaluate` on the chrome target for the address field's value (`document.getElementById('address').value`) and the active tab's title text; `enumerateTabs`; the admin `getHistory` tool for jar **A**; wall-clock timing of `enumerateWindows` round trips.
- **Unobservable, not asserted here**: the sign-in card and the client-certificate picker (sheet menu types automation cannot read) — `[by-eye]` in the HAT leg.

## Observables Required

- mcp (`enumerateWindows`, `enumerateTabs`, `openTab`, `navigate`, `evaluate`, `getChromeTarget`, `getHistory`)
- shell (fixture server lifecycle; timing)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **Active-precondition probe.** Attach with the admin key; `tools/list`; `enumerateWindows`; `getChromeTarget`; confirm the fixture answers on `/bounds.html`. Time five `enumerateWindows` round trips and record the slowest as **B0**. | Attach succeeds; the listed tools are present; one booted window; the fixture answers 200. **If not, halt.** |
| 2 | **Credentials in a redirect.** `openTab` on `http://127.0.0.1:8231/redir` in jar **A**; record its wcId **T**; wait for the load. With **T** active, `evaluate` the address field's value on the chrome target. `enumerateTabs` and note **T**'s URL. | The page loaded (the redirect target). The address field's value contains no `probeuser`, no `probepass` and no `@`; it shows the same host, port and path as the page's real address. *(What `enumerateTabs` reports for the URL is recorded, not judged — the census keeps the real URL by design.)* |
| 3 | **Credentials typed directly.** `navigate` **T** to `http://someone:secret@127.0.0.1:8231/bounds.html`; wait for the load; `evaluate` the address field's value; `evaluate` `location.href` on **T**. | The page loaded and its own `location.href` is the fixture's `bounds.html`. The address field's value contains no `someone`, no `secret` and no `@`. |
| 4 | **Title flood.** Start `evaluate` `titleFlood(5000)` on **T** without waiting for it; while it runs, time an `enumerateWindows` round trip every 250 ms and record each; then collect the flood's result. | The flood reports several thousand title changes. **No `enumerateWindows` round trip during the flood took longer than one second** (state the slowest, and **B0** beside it). |
| 5 | Wait 2 s. `evaluate` the active tab's title text in the chrome; `getHistory` for jar **A** and find the entry for `bounds.html`. | The tab's title in the chrome and the history entry's title are both `bounds:done` — the last title was kept. No history title in the result is longer than 512 characters. |
| 6 | **An enormous address.** `evaluate` `shortPush('before')`, then `longPush(400000)`, then `shortPush('after')` on **T**, a second apart. `getHistory` for jar **A**. `evaluate` the address field's value length on the chrome target. | History has entries for the `before` and `after` addresses and **no entry whose address is longer than 8,192 characters**. The browser is still responsive (the calls returned). |
| 7 | **A long search.** Call `getHistory` for jar **A** with a query of 2,000 space-separated short words, timing it. | The call returns (an empty or small result is fine) in under one second. |
| 8 | `enumerateTabs`; `enumerateWindows`; confirm the app's main process is still running; close **T**. | **T** was still listed before closing; one booted window; the process is alive. |

## Out of Scope

- The sign-in card's realm text and the client-certificate picker — `[by-eye]`, HAT leg; unit-tested.
- Whether a `user:pass@` URL authenticates — unchanged behaviour, not this leg's subject.
- Long subdomains in the address bar — not changed by this flight (squawk).
- History recording basics and jar scoping — `history-recording`, `history-automation-isolation`.
