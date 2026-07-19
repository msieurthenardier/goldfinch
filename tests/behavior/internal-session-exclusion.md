# Behavior Test: Internal session is excluded from the automation surface

**Slug**: `internal-session-exclusion`
**Status**: draft
**Created**: 2026-06-13
**Last Run**: 2026-07-08-18-17-19 (pass — see `internal-session-exclusion/runs/2026-07-08-18-17-19.md`)

> **AUTHORED-ONLY (Flight 3 / leg `behavior-test-specs`).** The surface this spec drives is fully built (Flight 3), so it *could* run — but it is **deferred to Flight 6** (behavior-spec migration) by operator sequencing, and is **not part of Flight 3's acceptance**. Authored now so the Witnessed backing exists; **do not** treat a `/behavior-test internal-session-exclusion` invocation before Flight 6 as a flight-acceptance run.

## Intent

Verify the current two-tier internal-session boundary across the MCP transport. A **jar identity** must never enumerate or reach the privileged `goldfinch://settings` session, including when handed its `wcId` directly. The env-gated **admin identity** may enumerate and perform the approved observation operations (`readDom`, `captureScreenshot`, `readAxTree`) on an internal tab, but arbitrary page execution and debugger attachment remain excluded: `evaluate` and `openDevTools` must refuse even for admin. A normal web tab is the control. This needs a behavior test rather than a unit test because the boundary only becomes meaningful across the real transport, identities, and genuinely marked internal session (`wc.session.__goldfinchInternal === true`).

## Preconditions

- Goldfinch is running via **`npm run dev:automation`** (no `--remote-debugging-port`); MCP server up on `127.0.0.1:$GOLDFINCH_MCP_PORT`.
- Both a resolved-default-jar key and the env-gated admin key, captured from a launch with `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1`.
- Two MCP clients connected to `http://127.0.0.1:$GOLDFINCH_MCP_PORT/mcp`, one per identity.
- The internal Settings tab openable from the chrome (kebab ⋮ → Settings). The admin client obtains its `wcId` from `enumerateTabs`; the jar client must not see that row.
- **Port (load-bearing for every URL below).** Pin the listen port with **`GOLDFINCH_MCP_PORT`** (default `49707`); export it once at launch and reuse it in all client/curl calls.
- **Apparatus note:** the apparatus is the two authenticated SDK clients over `127.0.0.1:$GOLDFINCH_MCP_PORT` (app via `npm run dev:automation`). No out-of-band inspector or `:9222` CDP path qualifies.

## Observables Required

- mcp (jar/admin `enumerateTabs` arrays, successful admin observation results, and the `isError` + discriminated text from jar-key and op-local refusals)
- browser (the chrome UI to open Settings; the rendered Settings stub as confirmation the internal tab exists)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **Active-precondition probe.** Connect both jar and admin MCP clients; `initialize`; `tools/list`. | Both identities initialize successfully. `tools/list` includes `enumerateTabs`, `readDom`, `readAxTree`, `captureScreenshot`, `evaluate`, and `openDevTools` — presence-checked, not an exact count. **If any are absent, halt.** |
| 2 | In the running chrome, open the kebab (⋮) menu and select **Settings** so `goldfinch://settings` opens in its own internal-session tab. | A tab opens to `goldfinch://settings` and renders the settings stub (e.g. "Settings — coming soon" / `<h1>Settings</h1>`). The internal guest now exists. *(setup — confirms the internal tab is live)* |
| 3 | Call `enumerateTabs` with each identity. Record the internal row's wcId **I** from the admin result. | The jar-key array contains only that jar's web tabs and **no** `goldfinch://` row. The admin array includes the live `goldfinch://settings` row with numeric wcId **I**. |
| 4 | With the **jar key**, directly supply **I** to `readDom(I)`, `captureScreenshot(I)`, and `readAxTree(I)`. | Every call is `isError: true` with `automation: internal-session`; directly knowing the handle does not bypass jar isolation and no operation runs. |
| 5 | With the **admin key**, call `readDom(I)`, `captureScreenshot(I)`, and `readAxTree(I)`. | All three approved observation operations succeed: DOM object, PNG image content, and AXNode array respectively. This is the deliberate admin relaxation, not a general page-execution grant. |
| 6 | Still as admin, call `evaluate(I, "1+1")` and `openDevTools(I)`. | Both are `isError: true` with their op-local `automation: evaluate — internal-session excluded` and `automation: openDevTools — internal-session excluded` messages. Admin observation does not permit arbitrary JS or debugger attachment. |
| 7 | **Web control.** Take a normal web wcId **W** and call the same five operations used in Steps 5–6. | `readDom`, `captureScreenshot`, `readAxTree`, `evaluate`, and `openDevTools` succeed on **W** (close DevTools afterward). The internal refusals are session/op-specific, not tool failures. |

## Out of Scope

- **The internal-scheme web-reachability boundary** (a hostile page cannot navigate to / embed / `fetch` `goldfinch://`) — covered by `tab-scheme-guard`. This spec is the automation identity/op boundary.
- The internal session's CSP / partition isolation internals — out of scope; here we assert only identity-scoped enumeration/observation plus representative op-local exclusions.
- `bad-handle` / `no-such-contents` rejection paths — those are the `observe-refusal-contract` spec's `isError` cases; this spec isolates the **`internal-session`** path.

## Variants (optional)

- Could parametrize the jar-key denial across every wcId-first operation or add the other admin op-local internal exclusions (zoom, print, find, injectScript) once one representative per enforcement class is established.
