# Flight: MCP-Compatible Local Server + Transport

**Status**: in-flight
**Mission**: [First-Class Browser Automation Surface](../../mission.md)

## Contributing to Criteria
- [ ] **SC6** — the capabilities are exposed over an **MCP-compatible interface**: an external MCP
  client (e.g. a Claude Code session) can **discover and invoke** them as tools and drive the browser
  end to end.
- [ ] **SC7** — the surface is **local-only**: it binds only to the loopback interface and a
  non-loopback connection attempt cannot reach it; the open web cannot reach it either — which requires
  **Origin/Host allow-listing in addition to the loopback bind** (a `127.0.0.1` server is reachable
  from a page via DNS-rebinding, and *this very browser* renders the hostile pages).

> **Scope boundary (mission sequencing).** This flight delivers the **transport + tool surface +
> structural network defenses** (loopback bind, Origin/Host allow-list). It does **NOT** add the
> opt-in toggle, key authentication, or the audit log — those are **Flight 4**. Per the mission's
> explicitly-accepted interim risk, Flight 3 stands up an **ungated** server; it is **dev-gated** (see
> DD4) so the ungated window never reaches a shipped build — nothing ships until Flight 4 lands.

---

## Pre-Flight

### Objective

Expose the landed drive engine (Flight 1: nav / trusted input / tab management) and observe engine
(Flight 2: screenshot / DOM / a11y) — all 16 `engine.js` ops — as **MCP-discoverable tools** over a
**loopback-only Streamable-HTTP transport** built on the **official MCP SDK**, with **Origin/Host
allow-listing from the start**, so an external MCP client can connect to the already-running browser,
list the tools, and drive it end to end. Ship an example client + consumer docs. The transport replaces
the dev-only `automation:dev-invoke` seam as the single automation entry point (still dev-gated until
Flight 4 adds opt-in + key + audit).

### Open Questions
- [ ] **(load-bearing — answer before scaffold)** Does the MCP SDK's `StreamableHTTPServerTransport`
  accept the raw Node `http` `(req, res)` pair, or does it need Express / a Fetch-API shim? → the
  scaffold leg's **first** step is a live SDK check; a negative answer triggers the divert to hand-roll
  (DD2 premise). Also confirm it mounts cleanly inside the Electron main process under Electron `^42`.
- [ ] Session model: stateful (per-connection session id) vs stateless Streamable-HTTP for a
  single-local-consumer surface? → resolve at `mcp-server-scaffold`; default to whatever the SDK makes
  simplest for one attached client, documented.
- [x] **Dev gate** → **RESOLVED (DD4):** gate the server on **`--automation-dev`** (decoupled from
  `--remote-debugging-port`); add a `dev:automation` launch script. (`isAutomationDevEnabled` already
  accepts `--automation-dev` — verified.)
- [x] **Loopback port** → **RESOLVED (DD2):** fixed default **`127.0.0.1:7777`** + `GOLDFINCH_MCP_PORT`
  override (avoids CDP 9222 / Node-inspector 9229; clean static endpoint for the example client +
  `.mcp.json`). Conflict check is a prerequisite.
- [x] **DNS-rebinding guard** → **RESOLVED (DD3):** our own loopback Origin/Host guard lands **with the
  server** in the scaffold leg, defense-in-depth over any SDK option (verify the SDK option exists, but
  never rely on it alone).
- [ ] Result/error mapping at the MCP boundary for the observe **`debugger-unavailable` refusal** vs the
  `resolveContents` **throws** — see DD6 (decided; the open part is the exact MCP content/`isError`
  shape, confirmed at `observe-tools`).

### Design Decisions

**DD1 — MCP implementation: the official MCP SDK (`@modelcontextprotocol/sdk`) — Goldfinch's first
runtime dependency (operator go/no-go, 2026-06-13).**
- Choice: adopt the official TypeScript MCP SDK for the server + transport + capability negotiation.
- Rationale (operator): spec compliance and correct transport/handshake framing out of the box, faster
  to a discoverable server, lower MCP-spec-maintenance burden than hand-rolling. Chosen over **hand-roll
  over Node `http`** (preserves zero-dep but owns the spec) and **FastMCP (TS)** (rejected — it is a
  layer *on top of* the official SDK, so it is the SDK **plus** more transitive deps: the heaviest
  supply-chain/bundle surface, the hardest break of the zero-dep identity).
- Trade-off: **breaks the zero-runtime-dependency identity** — this is the deliberate, identity-level
  call the mission reserved for Flight 3. Mitigations: pin the SDK to an exact version; document it in
  `CLAUDE.md` as the *one* sanctioned runtime dep and why; keep the SDK confined to the transport layer
  (the engine modules stay dependency-free and SDK-agnostic — the MCP layer is a thin adapter over
  `engine.js`).

**DD2 — Streamable-HTTP over loopback, in the Electron main process; fixed default port + override.**
- Choice: the SDK's `StreamableHTTPServerTransport` on a Node `http` server bound to **`127.0.0.1`
  only**, started in `main.js` after `createWindow()`. The server **attaches to the already-running
  app** (it lives in the process that holds the operator's tabs) — which is why **stdio does not fit**
  (stdio assumes the client launches the server). **Port: fixed default `127.0.0.1:7777`**, overridable
  via the `GOLDFINCH_MCP_PORT` env var.
- Rationale: Streamable-HTTP is the current MCP standard transport with the best client compatibility;
  loopback HTTP is the natural attach-to-running shape. A **fixed** default (vs ephemeral) gives the
  example client + `.mcp.json` a clean static endpoint (better SC6 discoverability DX); `7777` avoids
  CDP's `9222` and the Node-inspector `9229`. The env override handles the rare conflict.
- Trade-off: a fixed port can collide on a busy dev machine (hence the override + the prerequisite
  conflict check). An HTTP server lifecycle now lives inside the Electron main process (start/stop with
  the app; clean shutdown on `window-all-closed`). Acceptable; single server instance.
- **Premise to verify at leg time (do NOT assume):** that the SDK's `StreamableHTTPServerTransport`
  accepts the **raw Node `http` `(req, res)` pair** (not an Express `(req,res,next)` or a web-platform
  `Request`/`Response`). The scaffold leg's **first** step is a live SDK check; if it needs Express or a
  Fetch-API shim, the **divert to hand-roll** (the rejected zero-dep alternative) triggers immediately —
  do not push forward.

**DD3 — Origin/Host allow-list from the start (SC7), defense-in-depth — lands WITH the server (never a
window where the server binds without the guard).**
- Choice: every request is checked against a **loopback Origin/Host allow-list** before any MCP
  processing; the guard is wired in the **same leg that binds the server** (`mcp-server-scaffold`), so
  the server is never reachable without it. Applied as our own guard on the Node `http` server **in
  addition to** any SDK-provided DNS-rebinding option (defense-in-depth — the SDK option may differ by
  version; never rely on it alone).
- **Reject / pass policy (resolves the no-Origin-header question):**
  - **Reject (403)** any request whose `Host` is non-loopback, OR whose `Origin` header is present and
    non-loopback (a rendered hostile page *always* sends an `Origin`), OR whose peer socket is not a
    loopback address.
  - **Pass** a request with **no `Origin` header** *iff* its `Host` is loopback — a missing `Origin`
    means a non-browser local tool (the MCP client, `curl`), not a hostile page.
- Rationale: a `127.0.0.1` bind is necessary but **not sufficient** — *this very browser renders hostile
  pages*, and a page can reach a loopback server via DNS-rebinding unless Origin/Host are pinned. This is
  the load-bearing SC7 control and the reason the surface can be ungated-but-safe-in-dev in this flight.
- Trade-off: a strict allow-list may reject an oddly-configured client; documented in consumer docs. The
  allow-list **predicate is pure** (host/origin string + peer address → allow/deny) and unit-tested
  exhaustively; the reject paths are integration-tested.

**DD4 — Dev-gated via `--automation-dev` (decoupled from the CDP port); the MCP server replaces the
`automation:dev-invoke` seam.**
- Choice: the server starts **only** when `isAutomationDevEnabled(process.argv)` is true, **never in a
  shipped build**. That predicate already accepts a dedicated **`--automation-dev`** flag *or*
  `--remote-debugging-port` (verified `src/shared/automation-dev.js`). Flight 3 gates the MCP server on
  the **`--automation-dev`** path specifically — **decoupled from `--remote-debugging-port`** — and adds
  a **`dev:automation` npm script** that launches with `--automation-dev --no-sandbox`
  (WSL) and **no** `--remote-debugging-port`. The dev-invoke IPC seam's role (the one automation entry
  point) is **folded into / replaced by** the MCP server; the seam may remain temporarily as a fallback
  apparatus until the MCP path is proven, then be removed here or noted for Flight 7.
- Rationale: the opt-in toggle + key auth + audit are **Flight 4**; dev-gating keeps the accepted
  **ungated-server interim window confined to dev**. Decoupling from `--remote-debugging-port` matters
  for **two** reasons: (1) the mission is *retiring* the CDP path (SC11) — the new server must not depend
  on the flag it's replacing; (2) **DD10's confound-free DevTools test requires launching WITHOUT
  `--remote-debugging-port`**, which is only possible if the server doesn't need it. Single entry point
  (Flight-1 convention) preserved.
- Trade-off: external consumers cannot use a *shipped* build until Flight 4; in dev they launch via
  `dev:automation`. Matches mission sequencing.

**DD5 — Tool surface: the 16 `engine.js` ops mapped 1:1 to MCP tools.**
- Choice: each engine dispatch op becomes one MCP tool with a JSON input schema — drive (12):
  `enumerateTabs`, `openTab`, `closeTab`, `activateTab`, `navigate`, `goBack`, `goForward`, `reload`,
  `click`, `typeText`, `scroll`, `pressKey`; observe (4): `captureScreenshot`, `captureWindow`,
  `readDom`, `readAxTree`. The MCP layer is a **thin adapter** that validates input, calls
  `engine[op](...)`, and maps the result/error (DD6).
- Rationale: the engine is the single entry point (Flight-1 convention); the tool layer adds discovery +
  schemas + result shaping, not new capability or new security logic (the engine's `resolveContents`
  guard remains authoritative).
- Trade-off: 16 tools is a broad surface; element-addressing ergonomics (a11y-handle vs coords) stay raw
  (a Flight-9 concern). Tool naming/grouping tuned in the HAT.

**DD6 — Result/error semantics at the MCP boundary (implements the Flight-2 debrief contract).**
- Choice: **operational conditions → normal tool result**; **programmer/security errors → tool error**.
  Concretely: the observe **`debugger-unavailable` refusal object** is returned as a **normal tool
  result** (content describing the refusal) so the calling agent *sees* the condition and reacts;
  `resolveContents` **throws** (bad-handle / no-such-contents / **internal-session**) and other genuine
  failures are returned as a tool result with **`isError: true`**. Screenshots → MCP **image** content
  (base64 PNG); DOM/a11y → text/JSON content.
- Rationale: closes the Flight-2 debrief recommendation ("transport decides refusal mapping —
  consistently, documented"). A busy debugger is expected, not exceptional; a rejected internal-session
  drive is an error.
- Trade-off: the consumer must read tool-result content for refusals (documented in the tool schemas +
  consumer docs).

**DD7 — Fix the `captureScreenshot` opts-spread footgun before the tool layer exposes it.**
- Choice: restructure the engine API so `captureScreenshot`'s caller-tunable params (`delayMs` /
  `waitForPaint`) are a **named argument**, not merged into the injected-deps bag
  (`engine.js:66 — { ...deps(), ...opts }`). **Scope is `captureScreenshot` only** — `readAxTree` already
  passes `opts` as a separate third arg (`engine.js:69`), so it has no footgun; do not reshape its
  working signature.
- Rationale: Flight-2 debrief rec #1 — once the MCP transport exposes the engine API to real callers,
  the silent-override risk (an `opts` key clobbering injected `fromId`/`chromeContents`) becomes
  concrete. Fix it as the API solidifies. Bundled into `observe-tools` (same surface).
- Trade-off: a small engine-signature change + its unit tests. **The existing 10 `captureScreenshot`
  unit tests in `automation-observe.test.js` are the regression net** — the refactor must keep them
  green (update call sites in the tests as needed); low risk, contained.

**DD8 — Action-by-a11y-handle is OUT of scope; the a11y tool returns the raw snapshot + the
stale-handle caveat.**
- Choice: `readAxTree`'s tool returns the raw node array; `backendNodeId`/`frameId` are
  **CDP-session-scoped, stale-on-detach** handles — informational only. No re-attach/re-query mechanism
  this flight.
- Rationale: Flight-2 debrief rec #4 — action-linking by a11y handle needs a re-attach round trip; it is
  a later flight's design. Recorded as an explicit constraint so the tool docs don't overpromise.
- Trade-off: agents address elements by coordinates / selectors for now (Flight-9 ergonomics).

**DD9 — The behavior-test apparatus finally exists → author Witnessed specs this flight.**
- Choice: the **MCP client over the loopback transport** is the behavior-test apparatus the mission has
  been deferring against ("once the transport exists"). This flight **authors** Witnessed specs: the
  flight's own acceptance — `mcp-drive-end-to-end` (SC6) and `mcp-loopback-origin-guard` (SC7) — **and**,
  per the Flight-2 debrief operator decision (2026-06-13, "draft during Flight-3 planning, don't wait
  for Flight 6"), the carried-forward drafts the **Flight-6 migration** will run: `foreground-to-act`,
  `internal-session-exclusion`, `observe-refusal-contract`, and `devtools-cdp-conflict`.
- Rationale: stops the Witnessed-backing debt accumulating across Flights 1→2→3; the tool shapes are
  concrete by the time specs are authored (after the tool legs).
- Trade-off: spec authoring is real work (its own leg); running all of them is staged (SC6/SC7 run in
  `verify-integration` this flight; the four carried-forward specs *run* at Flight 6, but exist now).

**DD10 — Resolve the apparatus-confounded CDP-single-client question over THIS transport.**
- Choice: `verify-integration` runs the **genuine** DevTools-conflict test over the MCP transport, with
  the app launched **without** `--remote-debugging-port`, and **records** whether `readAxTree` returns
  the `attach-failed` refusal when DevTools is open on the target.
- Rationale: Flight-2's DD8 live test was confounded because the dev seam was only reachable over the
  CDP port (which relaxes Chromium's debugger exclusivity). The MCP transport removes that confound —
  this is the venue to finally observe the real behavior (Flight-2 debrief rec #2).
- Trade-off: still a recorded finding, not a hard assertion (the underlying Chromium behavior is what it
  is); the `attach-failed` code path stays unit-tested regardless.

### Prerequisites
- [x] Flights 1 & 2 landed — `engine.js` exposes all 16 ops; `resolveContents` internal-session guard is
  authoritative; the dev seam (`automation:dev-invoke`, `isAutomationDevEnabled`) exists. (Flight 2
  completed 2026-06-13.)
- [ ] **New runtime dependency**: `npm install @modelcontextprotocol/sdk` at an exact pinned version
  (the deliberate first runtime dep — DD1). Verify it installs and imports under Electron `^42` / Node 22.
- [ ] **Environment-conflict check (network service)**: confirm the chosen port **`7777`** (DD2) is
  free on the dev machine **before** the scaffold leg; it must not collide with CDP `9222`, Node
  inspector `9229`, or any other local service. *(Operator: anything else bound on loopback to watch
  for? `GOLDFINCH_MCP_PORT` overrides if so.)*
- [ ] An **MCP client** for verification: a local Claude Code session pointed at the loopback
  Streamable-HTTP endpoint, or the SDK's client in the shipped example script.
- [ ] Live GUI reachable (WSLg) for the integration smoke + HAT (as in Flights 1–2), launched via the
  new **`dev:automation`** script (DD4) — **no** `--remote-debugging-port` (required for DD10).
- [x] **`isSafeTabUrl` re-application** — already enforced by Flight 1: `nav.js:42` (`navigate`
  re-applies `isSafeTabUrl` before `loadURL`) and `tabs.js` openTab's untrusted branch. The MCP layer
  inherits the hostile-URL guard through the engine; no new gate needed (confirm-at-leg, not a gap).
- [x] **Session-type registry (`WeakMap<Session, type>`)** — **out of scope this flight.** The MCP
  server runs server-side in the main process; it introduces **no new `webContents` session category**.
  The mission's carried-in registry prerequisite applies when a new session category is created (a later
  flight), not here.

### Pre-Flight Checklist
- [ ] Open questions resolved (SDK-in-Electron-main, session model, SDK vs own DNS-rebinding guard, port)
- [x] Design decisions documented
- [ ] Prerequisites verified (SDK installs; port free; MCP client available)
- [ ] Validation approach defined (unit tests over the tool-adapter + allow-list predicate; live
  integration smoke via a real MCP client; SC6/SC7 behavior tests; guided HAT)
- [ ] Legs defined

---

## In-Flight

### Technical Approach

A new transport layer over the existing engine, SDK confined to it:

1. **`src/main/automation/mcp-server.js`** (new) — builds an MCP `Server` (SDK), registers the 16 tools
   from `engine.js`'s dispatch with JSON input schemas, and maps results/errors per DD6. The engine is
   injected (same injected-deps discipline as the rest of the module group) so the tool registration is
   unit-testable with a fake engine; the live SDK transport is integration-verified.
2. **Transport mount** — a Node `http.createServer` bound to `127.0.0.1:7777` (DD2), fronting the SDK's
   `StreamableHTTPServerTransport`, started in `main.js` behind the `--automation-dev` gate (DD4),
   stopped on shutdown. The **Origin/Host allow-list guard runs first on every request and is wired in
   the same leg that binds the server** (DD3) — the server is never reachable without the SC7 guard.
3. **Result shaping** — `captureScreenshot`/`captureWindow` → MCP image content; `readDom`/`readAxTree`
   → text/JSON; the `debugger-unavailable` refusal → normal result; `resolveContents`/other throws →
   `isError: true` result (DD6).
4. **Engine API tidy** — restructure `captureScreenshot`'s opts so tunables are a named arg (DD7).
5. **Example client + docs** — a small SDK-client script that connects, lists tools, and drives a short
   end-to-end sequence; consumer docs (endpoint, Origin/Host requirement, tool list, refusal semantics,
   the a11y stale-handle caveat); a `.mcp.json` entry registering Goldfinch's own server (the Playwright
   entry's *removal* stays Flight 7).
6. **Behavior-test specs** (DD9) authored to `tests/behavior/`.

The SDK appears **only** in the transport layer (`mcp-server.js` + the `main.js` mount). `engine.js` and
the `resolve`/`tabs`/`nav`/`input`/`observe` modules stay SDK-free and dependency-free.

### Checkpoints
- [ ] SDK installed (pinned); MCP `Server` + `StreamableHTTPServerTransport` on loopback Node http
  (`127.0.0.1:7777`) in the Electron main process, gated on `--automation-dev`; **the Origin/Host
  allow-list guard is wired with the server** (rejects non-loopback Host/Origin + non-loopback peers,
  403; pure predicate unit-tested); `initialize` handshake succeeds from a real client; `dev:automation`
  script added.
- [ ] 12 drive tools registered with schemas; `tools/list` shows them; `tools/call` drives the engine;
  error mapping correct.
- [ ] 4 observe tools registered (image content; refusal-as-result; `isError` on throw); `captureScreenshot`
  opts footgun fixed.
- [ ] Example client + consumer docs + `.mcp.json` entry + `CLAUDE.md`/README updates (incl. the SDK as
  the sanctioned first runtime dep).
- [ ] Behavior-test specs authored (`mcp-drive-end-to-end`, `mcp-loopback-origin-guard` + the four
  carried-forward Flight-6 drafts).
- [ ] Live smoke: real MCP client lists 16 tools + drives end to end; Origin/Host reject confirmed;
  SC6/SC7 behavior tests pass; DevTools-CDP-conflict outcome recorded over the transport (DD10); full
  unit suite + typecheck + lint green.
- [ ] Guided HAT: operator drives a real MCP client, tunes tool shapes/latency.

### Adaptation Criteria

**Divert if**:
- The MCP SDK's `StreamableHTTPServerTransport` cannot run inside the Electron main process without a
  full web framework, or pulls an unacceptable transitive-dep surface → re-open DD1 (reconsider
  hand-roll over Node `http`, which was the zero-dep alternative).
- The SDK's transport cannot be constrained to a loopback bind + Origin/Host allow-list (SC7
  non-negotiable) → add our own guard in front (already the DD3 default) or re-open the transport choice.

**Acceptable variations**:
- Stateful vs stateless Streamable-HTTP session model (per the SDK's simplest single-client path).
- Tool naming/grouping and input-schema shapes (tuned in the HAT).
- Whether the dev-invoke seam is removed in this flight or carried (annotated) to Flight 7.
- Merging `drive-tools` + `observe-tools` into one tool-surface leg if the adapter pattern makes the
  split redundant.

### Legs

> **Note:** Tentative; created one at a time as the flight progresses. May merge/split.

- [x] `mcp-server-scaffold` — **(first step: live SDK premise check — does `StreamableHTTPServerTransport`
  take a raw Node `(req,res)`? if not, divert to hand-roll, DD2).** Add the pinned
  `@modelcontextprotocol/sdk` dep; stand up the MCP `Server` + `StreamableHTTPServerTransport` on a
  `127.0.0.1:7777` Node http server in `main.js`, gated on **`--automation-dev`** (add the
  `dev:automation` script, DD4); **wire the SC7 Origin/Host allow-list guard in the SAME leg so the
  server never binds without it** — a pure loopback Origin/Host predicate (host/origin/peer →
  allow/deny, incl. the no-Origin policy in DD3) unit-tested exhaustively, + the 403 request guard
  in front of all MCP processing; `initialize` handshake works from a real client; resolve the
  SDK-in-Electron-main + session-model open questions live. (DD1, DD2, DD3, DD4)
- [x] `drive-tools` — register the 12 drive ops as MCP tools with JSON input schemas; thin adapter over
  `engine[op]`; DD6 error mapping (`isError` on `resolveContents` throws). Unit-tested with a fake
  engine. (DD5, DD6)
- [x] `observe-tools` — register the 4 observe ops; image content for screenshots; refusal-as-result vs
  `isError` (DD6); **fix the `captureScreenshot` opts-spread footgun (DD7) — keep the existing 10
  `captureScreenshot` unit tests green (the regression net); scope is `captureScreenshot` only,
  `readAxTree`'s opts is already a separate arg**; carry the `readAxTree` stale-handle caveat (DD8).
  Unit-tested. (DD5, DD6, DD7, DD8)
- [x] `example-client-and-docs` — example SDK-client script (connect → `tools/list` → short end-to-end
  drive); consumer docs (endpoint, Origin/Host requirement, tool list, refusal semantics, a11y
  stale-handle caveat); `.mcp.json` entry for Goldfinch's server; `CLAUDE.md`/README updates documenting
  the MCP layer + the SDK as the sanctioned first runtime dependency. (SC6)
- [x] `behavior-test-specs` — author the Witnessed specs (DD9): `mcp-drive-end-to-end` (SC6) and
  `mcp-loopback-origin-guard` (SC7) — **run this flight** (status `active`); plus the carried-forward
  Flight-6 drafts (`foreground-to-act`, `internal-session-exclusion`, `observe-refusal-contract`,
  `devtools-cdp-conflict`) — **authored-only, marked `draft` / "run at Flight 6"** (a clear status field
  + header note so a stray `/behavior-test` invocation doesn't produce a confusing partial run). (DD9 +
  Flight-2 debrief decision)
- [x] `verify-integration` — live smoke: a real MCP client lists 16 tools + drives end to end
  (navigate/click/type/screenshot/readAxTree/tab-mgmt); Origin/Host reject + non-loopback refusal
  confirmed; run `mcp-drive-end-to-end` + `mcp-loopback-origin-guard`; **record the DevTools-CDP-conflict
  outcome over the transport, app launched without `--remote-debugging-port` (DD10)**; full unit suite +
  typecheck + lint green.
- [ ] `hat-and-alignment` *(optional — included)* — guided HAT: operator drives a real external MCP
  client (or the example client) against the running server end to end, tuning tool shapes / latency /
  ergonomics.

---

## Post-Flight

### Completion Checklist
- [ ] All legs completed
- [ ] Code merged (PR stacked on the Flight-2 branch / `main` as appropriate)
- [ ] Tests passing (unit suite + typecheck + lint)
- [ ] Documentation updated (consumer docs; `CLAUDE.md` MCP-layer + first-runtime-dep note; README; `.mcp.json`)
- [ ] Flight debrief written (separate `/flight-debrief` step)

### Verification
- **Unit**: tool-adapter registration + dispatch + DD6 result/error mapping (fake engine); the
  Origin/Host allow-list **pure predicate**; the `captureScreenshot` named-opts refactor + its existing
  tests still green.
- **Live integration smoke**: a real MCP client (Claude Code session / the example script) connects over
  loopback Streamable-HTTP, `initialize` + `tools/list` shows all 16, and drives end to end; a
  non-loopback `Host`/`Origin` request is **403'd**; a non-loopback peer cannot reach the server.
- **Behavior tests**: `/behavior-test mcp-drive-end-to-end` (SC6) and `/behavior-test
  mcp-loopback-origin-guard` (SC7) pass. (The four carried-forward specs are authored this flight but
  **run** at Flight 6.)
- **DD10 finding**: DevTools-CDP-conflict over the transport, no `--remote-debugging-port` — recorded.
- **Static**: `npm run typecheck` and `npm run lint` clean.
- SC6 is *advanced and behavior-test-backed here*; SC7's structural half (loopback + Origin/Host) lands
  here, its key-gated half completes at Flight 4.
