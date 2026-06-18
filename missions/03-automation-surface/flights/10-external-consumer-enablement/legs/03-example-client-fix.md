# Leg: example-client-fix

**Status**: completed
**Flight**: [External-consumer enablement + README reframe](../flight.md)

## Objective
Fix `scripts/mcp-example-client.mjs` so it **authenticates against the current key gate** (attaches an
`Authorization: Bearer <key>` from an env var) and correct its stale "17 tools" references to 21, so the
documented getting-started a consumer copies actually works.

## Context
- **DD6 / Architect H1 (HIGH)**: the example client constructs a bare `StreamableHTTPClientTransport`
  with **no auth header**, so it `401`s on the MCP `initialize` handshake against the Flight-4+ key gate
  (`src/main/automation/mcp-server.js:490-491,533-537`). Its comment block (lines 65-68) still claims
  "connects without auth" — true at its Flight-3 origin, **false** since Flight 4 added key gating.
- **Architect M1 (MED)**: the comment claims "the 17 Goldfinch tools … getChromeTarget (the 17th)";
  the surface advertises **21** tools (`src/main/automation/mcp-tools.js:443`).
- **The pattern to mirror**: `scripts/lib/mcp-client.mjs:79-81` —
  `new StreamableHTTPClientTransport(endpoint, { requestInit: { headers: { Authorization: 'Bearer ' + key } } })`,
  with the key read from env (`GOLDFINCH_MCP_KEY` guest / `GOLDFINCH_MCP_ADMIN_KEY` admin).
- **Keep it SDK-only**: the example client's value is being a standalone, copy-pasteable consumer
  example (dependency only on the MCP SDK). Do **not** refactor it to import the repo's internal
  `scripts/lib/mcp-client.mjs` — inline the Bearer header so the example shows exactly what an external
  consumer writes.
- **Env var coordination**: the example drives **guest/jar** tabs (`openTab`/`navigate`/`captureScreenshot`/
  `readDom`/`enumerateTabs` — all jar-scoped, no admin), so it reads the **per-jar key** from
  `GOLDFINCH_MCP_KEY`. Leg 2 (`consumer-contract`) names this same env var in the getting-started.

## Inputs
- `scripts/mcp-example-client.mjs` exists, connects with no auth, comments say "17 tools".
- `scripts/lib/mcp-client.mjs` exists as the working Bearer-auth reference (`:58-84`).
- The key gate requires a valid Bearer token on every request incl. `initialize`
  (`mcp-server.js:490-491,533-537`).

## Outputs
- `scripts/mcp-example-client.mjs`:
  - reads a key from `GOLDFINCH_MCP_KEY` (env), attaches it as `Authorization: Bearer <key>` on the
    transport,
  - fails fast with a clear message if the key is absent (pointing at how to obtain a per-jar key),
  - "17 tools" comment text corrected to 21 (and the stale "connects without auth" narrative fixed),
  - otherwise unchanged in its drive sequence.

## Acceptance Criteria
- [ ] The transport is constructed with
      `{ requestInit: { headers: { Authorization: 'Bearer ' + key } } }` (mirrors
      `scripts/lib/mcp-client.mjs:80`).
- [ ] The key is read from `process.env.GOLDFINCH_MCP_KEY` (per-jar/guest key — matches the env var
      named in leg 2's getting-started).
- [ ] If the key is missing, the script exits with a non-zero code and a message explaining it needs a
      per-jar key and (briefly) how to get one — it does **not** silently attempt an unauthenticated
      connect that will 401 with a cryptic error.
- [ ] The "17 tools" / "17th" comment text is corrected to **21**; the stale "connects without auth"
      explanation is removed or rewritten to reflect that the client authenticates with a per-jar key.
- [ ] The `getChromeTarget` aside (line ~67) is corrected: it is admin-only and refused for a jar key
      because the jar key **lacks admin scope**, not because the client is unauthenticated (the stale
      "calling it unauthenticated will be refused" wording must go).
- [ ] The header-comment **usage block** (lines ~14-22) lists `GOLDFINCH_MCP_KEY=<key>` as a
      precondition alongside `npm run dev:automation`.
- [ ] The drive sequence (openTab → navigate → screenshot → readDom → enumerateTabs) is otherwise
      unchanged; no engine source touched.
- [ ] `node --check scripts/mcp-example-client.mjs` passes (valid syntax).

## Verification Steps
- `node --check scripts/mcp-example-client.mjs` — syntax OK.
- `grep -n 'Authorization' scripts/mcp-example-client.mjs` — Bearer header present on the transport.
- `grep -n 'GOLDFINCH_MCP_KEY' scripts/mcp-example-client.mjs` — key read from the agreed env var.
- `grep -nE '17 (tools|th)' scripts/mcp-example-client.mjs` — returns nothing (no stale count).
- Running with no key set exits non-zero with the guidance message (e.g.
  `node scripts/mcp-example-client.mjs` with `GOLDFINCH_MCP_KEY` unset).
- Live end-to-end drive against an enabled surface is deferred to the `verify-and-close` leg.

## Implementation Guidance
1. **Read the key** near the endpoint resolution (top of the module):
   `const key = process.env.GOLDFINCH_MCP_KEY;` and guard: if falsy, `console.error(...)` a message
   naming `GOLDFINCH_MCP_KEY` + a one-line pointer to obtaining a per-jar key (Settings Keys UI in
   production; the `AUTOMATION_DEV_MINT` line for dev — see `docs/mcp-automation.md`), then
   `process.exit(1)`.
2. **Attach the header** on the transport:
   `new StreamableHTTPClientTransport(endpoint, { requestInit: { headers: { Authorization: 'Bearer ' + key } } });`
3. **Fix the comments**: update lines ~65-68 — drop "connects without auth", state the client sends a
   per-jar Bearer key; correct "17 tools"/"17th" to 21; rewrite the `getChromeTarget` aside so it says
   the tool is admin-only and refused for a jar key because the **jar key lacks admin scope** (not
   because the client is unauthenticated). Update the header-comment usage block (lines ~14-22) to list
   the `GOLDFINCH_MCP_KEY` precondition alongside `npm run dev:automation`.
4. **Optionally improve the failure hint**: the bottom `main().catch` prints "Is the app running with
   `dev:automation`?" — a present-but-wrong key yields a 401 there. A second hint line ("if
   `GOLDFINCH_MCP_KEY` is set but rejected, the key may be wrong/revoked") is a nice-to-have, not required.
5. **Leave the drive sequence, `printResult`, and `parseWcId` untouched.**

## Edge Cases
- **Admin-only tools in discovery**: `listTools` is not identity-filtered, so all 21 tools still appear
  in discovery even with a jar key; `getChromeTarget` remains admin-only and is not called by this
  example — the comment may note this but should not imply the jar key can call it.
- **Whitespace/format in key**: read the env var verbatim; do not trim in a way that corrupts a valid
  key (a plain `process.env.GOLDFINCH_MCP_KEY` is fine).
- **Don't over-engineer**: no admin-mode branch needed — the example is the guest/jar happy path. Keep
  it minimal and readable as a copy-paste template.

## Files Affected
- `scripts/mcp-example-client.mjs` — Bearer-auth transport + key-from-env guard + corrected comments.

---
