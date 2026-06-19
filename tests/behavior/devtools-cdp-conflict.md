# Behavior Test: DevTools vs MCP a11y read — CDP single-client conflict (recorded finding)

**Slug**: `devtools-cdp-conflict`
**Status**: active — macOS-authoritative; WSLg inconclusive tolerated
**Created**: 2026-06-13
**Last Run**: 2026-06-17-16-25-30 — [run log](./devtools-cdp-conflict/runs/2026-06-17-16-25-30.md) *(prior finding — see note)*

> **RE-STAGED — M04 Flight 3 (First-class DevTools), leg `verify-integration`, 2026-06-19.** This flight
> landed a **non-CDP human affordance** for opening DevTools (the `F12`/`Ctrl+Shift+I` shortcuts + the
> pinnable `#toggle-devtools` button → the `toggle-devtools` IPC → `wc.openDevTools({mode:'detach'})`, DD1).
> That is the **canonical SC5 vector** for putting Chromium DevTools onto a tab's `webContents` as the
> *single legitimate CDP client*, with **no** `--remote-debugging-port` and **no** MCP-tool intermediary —
> exactly the confound-free open this spec needs. The `Act` path (steps 3/4) is therefore re-staged onto
> that human affordance.
>
> **Prior finding (retained, not deleted):** the M03 automation mission ran this spec on 2026-06-17 via the
> MCP `openDevTools`/`closeDevTools` tools (the only DevTools-open path that existed then). That run was
> **confound-free but inconclusive** — `readAxTree` succeeded with DevTools "open", BUT under WSLg the
> detached DevTools window did not cleanly materialize, so it is unsettled whether a competing CDP client
> was genuinely established (`blink.mojom.Widget` "Message rejected" at open time). See the
> [prior run log](./devtools-cdp-conflict/runs/2026-06-17-16-25-30.md). That MCP-tool Act path is the
> *prior* vector; this re-stage replaces it with the human affordance for the definitive observation.
>
> **Authoritative venue (DD8):** the live detached-DevTools-window materialization + the resulting CDP
> single-client conflict are **macOS-authoritative**. On WSLg the detached window does not cleanly
> materialize (Flight 2 confirmed this class), so a WSLg run is **smoke / inconclusive-tolerated** — record
> what is observed, but do **not** assert a settled `attach-failed` (or its absence) from a WSLg run. This
> remains a **recorded finding, not a pass/fail gate**.
>
> **Banner reconciliation flag:** this spec previously carried three contradictory status banners that
> referenced **M03**-era flight numbering (an "ARCHIVED — Flight 9" banner, an "AUTHORED-ONLY — Flight 3 /
> deferred to Flight 6" banner, and an "UNBLOCKED — Flight 9 leg 2" banner). Those are **goldfinch M03
> flights** and are now stale under M04. They have been reconciled into this single note under the authority
> of the **M04 Flight 3** spec (DD7 directs the re-stage onto the new human affordance). One stale banner had
> said the spec was "deferred to Flight 6" — if the operator intended this spec to stay deferred, they can
> override; but the live M04 F3 flight spec directs the re-stage.

## Intent

**DD10 recorded finding.** Establish, in the confound-free venue (app launched **without** `--remote-debugging-port`, so the only CDP client contention is Chromium DevTools itself), **whether** opening DevTools on a tab causes the engine's MCP `readAxTree` to return the `attach-failed` refusal — and whether closing DevTools restores success. This is explicitly a **recorded finding, not a pass/fail**: Chromium's one-CDP-client-per-`webContents` behavior is what it is, and the purpose is to **observe and record** it for the flight log + the mission Open-Question closure, not to assert a required outcome. It needs a behavior test because the interaction is between two live CDP clients (DevTools and the in-process debugger) on a real `webContents` — nothing offline can observe it.

## Preconditions

- **macOS-authoritative venue (DD8).** The definitive observation is on **macOS with a real display**,
  where the detached DevTools window materializes cleanly. A WSLg run is **smoke / inconclusive-tolerated**:
  run it and record what is seen, but do not treat a WSLg result (refusal OR success) as settling the
  finding — under WSLg the detached window does not cleanly materialize (the prior-run caveat).
- Goldfinch is running via **`npm run dev:automation`** — **confirm there is NO `--remote-debugging-port`** in the launch (the confound-free venue; a `:9222` CDP attach would be a *third* client and muddy the finding).
- An MCP client connected to `http://127.0.0.1:$GOLDFINCH_MCP_PORT/mcp` (with `Authorization: Bearer <key>`).
- **DevTools is opened/closed via the NEW human affordance (M04 Flight 3, the SC5 vector), NOT the MCP
  `openDevTools`/`closeDevTools` tools.** The human path is: `F12` / `Ctrl+Shift+I` (or the pinnable
  `#toggle-devtools` toolbar button) → the `toggle-devtools` IPC → the shared `src/main/devtools.js` helper
  → `wc.openDevTools({mode:'detach'})` / `wc.closeDevTools()` (DD1). It is a `webContents` method — no
  `--remote-debugging-port`, no chrome UI port — so the only CDP client contention is Chromium DevTools
  itself, exactly as the finding requires. **Driving the human path:**
  - **HAT (recommended on macOS):** physically press `F12` on the focused web tab (or click the pinned
    `#toggle-devtools` button) to open; press `F12` / click again to close.
  - **Automated apparatus (WSLg smoke):** drive the chrome renderer's keydown/toggle path over the **admin**
    MCP chrome target (`getChromeTarget()` → chrome `wcId`, then `pressKey(wcId, 'F12')` / the
    `toggleDevtools({webContentsId:W})` chrome global) — this exercises the SAME `toggle-devtools` IPC →
    `openDevTools({mode:'detach'})` path a human triggers. Confirm the open/closed state via
    `is-devtools-open` / `wc.isDevToolsOpened()`. **Do NOT** establish the DevTools-open condition by calling
    the MCP `openDevTools`/`closeDevTools` tools — that is the *prior* vector (kept as a prior-finding), not
    this re-stage's Act path.
- **Port (load-bearing for every URL below).** Pin the listen port with **`GOLDFINCH_MCP_PORT`** (default `49707`); export it once at launch and reuse it in all client/curl calls.
- **Apparatus note:** the apparatus is the **MCP client over `127.0.0.1:$GOLDFINCH_MCP_PORT`** with the app launched via `npm run dev:automation` (**no CDP port**) for the **observe** path (`readAxTree`/`evaluate`); the DevTools-open **act** is the **human affordance** (`F12`/button → `toggle-devtools` IPC), driven by hand (HAT) or via the admin chrome target's keydown/toggle global. The `chrome-devtools` MCP **must not** be used (it launches its own browser AND adds another CDP client — double disqualification here).

## Observables Required

- mcp (the `readAxTree` MCP result — array success vs `debugger-unavailable` refusal vs `isError`; and the `evaluate`/`injectScript` results staying successful while DevTools is open; over the loopback transport)
- browser (DevTools open/closed state on the target tab — the contention condition, driven via the **human affordance**: `F12`/`#toggle-devtools` → `toggle-devtools` IPC → `wc.openDevTools({mode:'detach'})`; the open/closed state read via `is-devtools-open` / `wc.isDevToolsOpened()`, NOT the MCP `openDevTools`/`closeDevTools` tools)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **Active-precondition probe.** Confirm the app was launched via `dev:automation` **without** `--remote-debugging-port` (check the launch command / that `:9222` is NOT listening). Connect the MCP client (Bearer key); `initialize`; `tools/list`. Confirm the **human DevTools affordance** exists: `getChromeTarget()` returns a numeric chrome `wcId` (so the chrome keydown/`#toggle-devtools` path is drivable), and the `toggle-devtools`/`is-devtools-open` IPC is present in the build (M04 Flight 3). | The launch has **no** `--remote-debugging-port` (the confound-free venue). `tools/list` returns **>= 21** tools **including `readAxTree`** (presence-checked, not an exact count) — the **observe** path. The **act** path is the human affordance (`F12`/`#toggle-devtools` → `toggle-devtools` IPC), so `getChromeTarget()` returns a numeric chrome `wcId`. **If a CDP port is present, `readAxTree` is absent, the chrome target is unavailable, or tools/list fails, halt** — the venue is confounded. *(NOTE: the MCP `openDevTools`/`closeDevTools` tools are deliberately NOT required here — this re-stage opens DevTools via the human affordance, not those tools.)* |
| 2 | Open a web tab (record wcId **W**), let it load. Baseline: call `readAxTree(W)` with DevTools **closed**. | Baseline succeeds: `readAxTree(W)` returns a JSON-text **array** (`Array.isArray`), not `isError`, not the refusal. (Establishes that absent contention, the a11y read works — so any later refusal is attributable to DevTools.) *(If the baseline itself does not return an array, RECORD that — it is itself a finding about the venue.)* |
| 3 | **Open DevTools on tab W via the HUMAN affordance** — press `F12` (or click the `#toggle-devtools` button) on the focused web tab, routing through the `toggle-devtools` IPC → `wc.openDevTools({mode:'detach'})` (HAT: physically press `F12`; automated WSLg smoke: `pressKey(chromeWcId, 'F12')` / the chrome `toggleDevtools({webContentsId:W})` global). Confirm DevTools is open via `is-devtools-open` / `wc.isDevToolsOpened()===true` **before** reading. **Then call `readAxTree(W)` over MCP.** | **RECORD the outcome** — do not assert a required result. First confirm DevTools actually opened (`isDevToolsOpened()===true`); **on macOS** the detached window should materialize (authoritative), **on WSLg** it may not cleanly materialize — RECORD that (it is the inconclusive-tolerated case, mirroring the prior finding). Then capture exactly which of these `readAxTree(W)` outcomes occurred: (a) the `{ automation: "debugger-unavailable", reason: "attach-failed", wcId: W }` refusal (a normal result — the expected conflict), (b) a successful AXNode array (no conflict — e.g. WSLg where the window/CDP client never genuinely established), or (c) an `isError`. **Also confirm the CDP-free ops keep working while DevTools is open**: `evaluate(W, '1+1')` / `injectScript(W, …)` still succeed (per DD7 — only the debugger-attaching ops are gated). The run log notes the observed behavior verbatim for the flight log + the mission Open-Question closure. **The Expected Result is "the outcome is recorded", never "must return attach-failed"** — and **on WSLg, never settle the finding either way** (DD8 macOS-authoritative). |
| 4 | **Close DevTools on tab W via the HUMAN affordance** — press `F12` / click `#toggle-devtools` again → `toggle-devtools` IPC → `wc.closeDevTools()` (HAT or `pressKey(chromeWcId, 'F12')`). Confirm `is-devtools-open` / `wc.isDevToolsOpened()===false`. Then call `readAxTree(W)` again over MCP. | `readAxTree(W)` returns a JSON-text **array** again (success restored once the competing CDP client released the contents) — i.e. the conflict, if any, was transient and tied to DevTools being open. **RECORD** if it does not restore (also a finding). *(On WSLg, where step 3 may not have established a genuine conflict, this is a no-op restoration — record accordingly; the definitive open→refused→close→restored cycle is macOS-authoritative.)* |

## Out of Scope

- **The refusal-contract SHAPE** (that a `debugger-unavailable` result is a normal result with `reason`/`wcId`, that bad handles are `isError`, that screenshots are image content) — that contract is verified by **`observe-refusal-contract`**; this spec only **records** whether the DevTools-open condition triggers it in the no-CDP-port venue.
- **The `--remote-debugging-port` / `:9222` venue** — deliberately excluded (it would add a confounding third CDP client). The finding is scoped to the `dev:automation` venue.
- **The MCP `openDevTools`/`closeDevTools` tools as the Act path** — that was the *prior* (M03) vector, kept as a [prior-finding run log](./devtools-cdp-conflict/runs/2026-06-17-16-25-30.md); this re-stage opens DevTools via the **human affordance** instead (the canonical SC5 vector, no MCP-tool intermediary).
- **The DevTools button/shortcut/pin behaviors themselves** (open/close, inert-on-internal, pin/persist) — covered by `toolbar-pins` (M04 Flight 3) + the optional HAT; this spec only records the **CDP single-client conflict** the open condition induces.
- Pass/fail gating of any flight on the outcome — this is a **recorded finding**, not an acceptance gate. M04 Flight 3 (First-class DevTools) re-stages this spec to finally observe the conflict on the non-CDP human affordance; the definitive observation is **macOS-authoritative** (DD8), so a WSLg run does not gate the flight.

## Variants (optional)

- N/A. Could later record the same interaction in the `dev:debug` venue as a contrast (knowing it is confounded by the `:9222` client), purely to characterize the layered behavior.
