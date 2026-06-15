# Leg: example-client-and-docs

**Status**: completed
**Flight**: [MCP-Compatible Local Server + Transport](../flight.md)

## Objective

Ship the SC6 discoverability deliverables: an example MCP-SDK-client script that connects to the loopback server, lists the 16 tools, and drives a short end-to-end sequence; consumer docs (endpoint, Origin/Host requirement, tool list, refusal semantics, the a11y stale-handle caveat); a `.mcp.json` entry registering Goldfinch's own server; and the CLAUDE.md/README updates that close out the Leg-1 "full consumer docs land later" placeholder.

## Context

- **Flight SC6 / checkpoint 4** — "Example client + consumer docs + `.mcp.json` entry + `CLAUDE.md`/README updates (incl. the SDK as the sanctioned first runtime dep)." This is the leg that makes the surface **discoverable and usable by an external consumer**, which SC6 requires.
- **The surface is built** (Legs 1–3): a stateful Streamable-HTTP MCP server on `127.0.0.1:7777` (override `GOLDFINCH_MCP_PORT`), gated on `--automation-dev` (`npm run dev:automation`), with all **16 tools** registered (12 drive: `enumerateTabs`, `openTab`, `closeTab`, `activateTab`, `navigate`, `goBack`, `goForward`, `reload`, `click`, `typeText`, `scroll`, `pressKey`; 4 observe: `captureScreenshot`, `captureWindow`, `readDom`, `readAxTree`). Result semantics: drive ops → JSON text (`{ok:true}` for void ops, boolean for close/activate, wcId/null for openTab); screenshots → image content; `readDom`/`readAxTree` → JSON text; the `debugger-unavailable` refusal → **normal** result; genuine throws → `isError`.
- **Transport endpoint shape** — `mcp-server.js`'s `onRequest` runs the Origin/Host guard then hands **every** request (any path) to `transport.handleRequest(req, res)`; it does **not** route on `req.url`. So the path is a documentation choice. **Decision (FD): document the endpoint as `http://127.0.0.1:7777/mcp`** — the example client and `.mcp.json` use that path; since the server ignores the path, this is purely a convention for a clean, conventional URL. (Confirm at leg time the server still path-agnostic; if a later leg added routing, align.)
- **SDK is already a dependency** (Leg 1, DD1) — the example client uses the **SDK client** (`@modelcontextprotocol/sdk/client/...` + `StreamableHTTPClientTransport`), demonstrating the real consumer path, not a hand-rolled HTTP client. This mirrors the project's `scripts/*.mjs` convention (`cdp-driver.mjs`, `a11y-audit.mjs` are attach-don't-launch Node scripts) — but over the SDK, not raw CDP.
- **Origin/Host requirement is consumer-relevant** — a consumer must send a **loopback `Host`** and (if any) a **loopback `Origin`**, or get a `403` (DD3). The SDK client over loopback satisfies this by default; the docs must state it so a consumer behind an odd proxy/header-rewriter understands a `403`.
- **Scope boundaries (do NOT overreach):**
  - The README **thesis reframe** (media-panel → control/privacy/automatability) is explicitly **Flight 8** (mission Flight-8 deliverable). This leg makes only a **modest** README addition (the `dev:automation` dev command + a pointer to the consumer doc) — **not** the reframe.
  - The Playwright `.mcp.json` entry's **removal** is **Flight 7** (SC11). This leg **adds** the Goldfinch entry alongside it; it does **not** remove Playwright.
  - This is a docs/example leg — **no production code change** to the engine/transport. The example script is a consumer artifact, not wired into the app.
- **CLAUDE.md state** — the MCP section already documents the transport, the SDK-as-first-runtime-dep, the SC7 guard, and the `--automation-dev` gate (Leg 1). It ends with: *"The full consumer-facing docs (tool list, refusal semantics, example client, `.mcp.json`) land in a later leg."* This leg **replaces that sentence** with the tool list / refusal semantics summary + a link to the new consumer doc.

## Inputs

What exists before this leg runs:
- The running surface: `src/main/automation/mcp-server.js` (loopback transport), `mcp-tools.js` (16 tools), `origin-guard.js` (SC7), the `dev:automation` script.
- `scripts/` — `cdp-driver.mjs`, `a11y-audit.mjs`, `update-readme.mjs` (the Node-`.mjs` script convention; ESLint covers them).
- `.mcp.json` — currently a single `playwright` server entry (stdio, CDP at `:9222`).
- `README.md` — sections: Download, Features, Run (~line 115), Keyboard shortcuts, Architecture (~line 140, with an Automation-relevant Architecture subsection). A `<!-- DOWNLOADS:START … -->` auto-generated block (do not hand-edit).
- `CLAUDE.md` — the `#### MCP transport …` subsection under `### Automation engine` with the "land in a later leg" placeholder.
- No `docs/` directory yet.

## Outputs

What exists after this leg completes:
- `scripts/mcp-example-client.mjs` (new) — an SDK-client example: connect over loopback Streamable-HTTP → `initialize` → `tools/list` (print the 16) → a short end-to-end drive (`openTab` to bootstrap a tab → use its `wcId` → `navigate` → `captureScreenshot` → `readDom`), printing results. Header comment with usage + the `--automation-dev` precondition (mirroring `cdp-driver.mjs`'s precondition note). **Endpoint override contract (FD decision, resolving the review):** the client reads `process.env.GOLDFINCH_MCP_URL` if set (a full URL); else composes `http://127.0.0.1:${process.env.GOLDFINCH_MCP_PORT || 7777}/mcp` — so the **same `GOLDFINCH_MCP_PORT` the server honors** (`mcp-server.js:resolvePort`) works on the client side too, with `GOLDFINCH_MCP_URL` as a full-URL escape hatch.
- `docs/mcp-automation.md` (new) — consumer-facing docs: what the surface is, how to launch it (`npm run dev:automation`), the endpoint + the **loopback Origin/Host requirement** (and why a `403` happens), the **16-tool reference** (name, input schema, result shape), the **refusal semantics** (`debugger-unavailable` is a normal result; throws are `isError`), the **a11y stale-handle caveat** (DD8), and a pointer to the example client. States the dev-gating + "nothing ships until Flight 4" status.
- `.mcp.json` — a new `goldfinch` server entry (HTTP transport at the loopback endpoint) **alongside** the existing `playwright` entry.
- `CLAUDE.md` — the "land in a later leg" placeholder replaced with the tool-count/refusal summary + a link to `docs/mcp-automation.md`.
- `README.md` — a modest addition: the `dev:automation` dev command (in or near the Run section) and a one-line pointer to `docs/mcp-automation.md`. **No thesis reframe** (Flight 8).

## Acceptance Criteria

- [ ] **Example client exists and is coherent.** `scripts/mcp-example-client.mjs` uses the MCP SDK client + `StreamableHTTPClientTransport` to connect to the loopback endpoint, runs `initialize` + `tools/list`, and drives a short end-to-end sequence (`openTab` first to guarantee a drivable `wcId`, then navigate/screenshot/readDom against it — `enumerateTabs` may be empty on a fresh launch), printing tool names and per-step results, handling `isError` results gracefully. Endpoint override per the contract above (`GOLDFINCH_MCP_URL` full-URL, else `GOLDFINCH_MCP_PORT`-composed, default `http://127.0.0.1:7777/mcp`). It does **not** launch the app (attach-don't-launch); the header documents the `npm run dev:automation` precondition. (Live execution against the running app is Leg 6 — this leg ships a correct, lint-clean script.)
- [ ] **Consumer docs complete.** `docs/mcp-automation.md` covers: launch command; endpoint; the loopback **Origin/Host** requirement + the `403` consequence; the **16-tool reference** (each tool's name, input schema, and result shape — drive JSON/void/boolean/null, screenshots as image content, DOM/a11y as JSON, refusal-as-normal-result); the **a11y stale-handle caveat** (`backendNodeId`/`frameId` are CDP-session-scoped, stale-on-detach — informational, no action-by-handle this flight); and the dev-gated / not-yet-shipped status. Tool names + schemas **match `mcp-tools.js` exactly** (cross-checked at leg time, not from memory).
- [ ] **`.mcp.json` registers Goldfinch.** A `goldfinch` entry is added with the correct HTTP-transport shape for Claude Code's `.mcp.json` (e.g. `{ "type": "http", "url": "http://127.0.0.1:7777/mcp" }` — verify the current schema key Claude Code expects for a Streamable-HTTP server). The existing `playwright` entry is **left intact** (its removal is Flight 7). The JSON remains valid.
- [ ] **CLAUDE.md placeholder closed.** The "full consumer-facing docs … land in a later leg" sentence is replaced with a brief tool-list/refusal-semantics summary and a link to `docs/mcp-automation.md`. The SDK-as-first-runtime-dep framing already present is left intact.
- [ ] **README modestly updated.** A short note documents the `dev:automation` command + a one-line pointer to `docs/mcp-automation.md`. (Note: the README Run section today only covers `npm install`/`npm start` — there is no existing dev-script list, so add a small "Development"/automation note rather than appending to a list that doesn't exist.) The auto-generated DOWNLOADS block is untouched. **No** media-panel→thesis reframe (that is Flight 8).
- [ ] **Docs are internally consistent with the code.** The endpoint, port, override env var, gate flag, launch script, tool names, and result/refusal semantics in the docs/example all match the actual Leg-1–3 implementation (no drift).
- [ ] **Gates green.** `npm run lint` (covers the new `.mjs`) and `npm run typecheck` pass; `npm test` still green (no test changes expected — but run it). `.mcp.json` parses as valid JSON.

## Verification Steps

- **Lint/type**: `npm run lint` clean (incl. `scripts/mcp-example-client.mjs`); `npm run typecheck` clean.
- **JSON validity**: `node -e "JSON.parse(require('fs').readFileSync('.mcp.json','utf8'))"` (or equivalent) exits 0; both `playwright` and `goldfinch` entries present.
- **Tool-reference accuracy**: diff the doc's tool list against `mcp-tools.js`'s `TOOLS` (16 names + input schemas) — they match.
- **Doc/code consistency**: grep the doc for `7777`, `GOLDFINCH_MCP_PORT`, `GOLDFINCH_MCP_URL`, `--automation-dev`, `dev:automation`, `127.0.0.1` — all match the implementation.
- **Example client static check**: `node --check scripts/mcp-example-client.mjs` passes (syntax). To prove the SDK client/transport **import subpaths actually resolve** without a live server (`--check` is syntax-only, it does NOT resolve imports), run a dry dynamic import, e.g. `node -e "import('@modelcontextprotocol/sdk/client/streamableHttp.js').then(()=>console.log('ok'))"`. Live run is Leg 6.
- **Tests**: `npm test` green.

## Implementation Guidance

1. **Read the surface before writing docs** — read `mcp-tools.js` (the exact 16 tool names, input schemas, descriptions, and result shapes), `mcp-server.js` (endpoint/port/guard), `origin-guard.js` (the Origin/Host policy), and `package.json` (`dev:automation`). Write the docs from the code, not from this leg's summary.
2. **Example client (`scripts/mcp-example-client.mjs`).**
   - ESM (`.mjs`), header comment in the `cdp-driver.mjs` style: what it is, the `npm run dev:automation` precondition, usage, the endpoint env override.
   - Import the SDK client (`@modelcontextprotocol/sdk/client/index.js` → `Client`) and `StreamableHTTPClientTransport` (`@modelcontextprotocol/sdk/client/streamableHttp.js`) — both verified to resolve under ESM in SDK 1.29.0. Resolve the endpoint: `const url = new URL(process.env.GOLDFINCH_MCP_URL || ('http://127.0.0.1:' + (process.env.GOLDFINCH_MCP_PORT || 7777) + '/mcp'))`.
   - Sequence: `connect` → list tools (print names) → **`openTab('https://example.com')` FIRST to obtain a drivable `wcId`** (a fresh launch may have no enumerable tab) → `navigate`/`captureScreenshot`/`readDom` against that `wcId` (note `captureScreenshot` returns image content) → optionally `enumerateTabs` to show the listing. Print each result; handle `isError` results gracefully. Clean disconnect at the end.
   - Keep it dependency-only-on-the-SDK (no new deps).
3. **Consumer docs (`docs/mcp-automation.md`).** Create the `docs/` dir. Sections: Overview; Launch (`npm run dev:automation`, dev-gated, not-yet-shipped); Endpoint + Origin/Host requirement (+ `403` explanation, DNS-rebinding rationale at a consumer-appropriate level); Tool reference (table or per-tool: name · input schema · result shape) for all 16; Result & refusal semantics (image content; JSON text; refusal-as-normal-result; throws→`isError`); a11y stale-handle caveat (DD8); Example client pointer. Anonymized (no operator paths/usernames — repo is public).
4. **`.mcp.json`.** Add the `goldfinch` entry alongside `playwright` using the confirmed Streamable-HTTP shape `{ "type": "http", "url": "http://127.0.0.1:7777/mcp" }`. Keep valid JSON, 2-space indent matching the file. The doc should note the registered entry is **inert until `npm run dev:automation` is running** (so a consumer doesn't read a connection failure as a config error).
5. **CLAUDE.md.** Replace the placeholder sentence (the `#### MCP transport …` subsection's last line) with: the 16-tool summary (12 drive + 4 observe), one line on refusal semantics, and `See docs/mcp-automation.md for the consumer reference.` Leave the rest intact.
6. **README.** Add `dev:automation` to the Run section (or wherever dev scripts are listed) with a one-liner, plus a single pointer line to `docs/mcp-automation.md`. Do not touch the DOWNLOADS block or reframe the project description.

## Edge Cases

- **SDK client subpath drift** — the exact import subpath (`/client/streamableHttp.js`) must match SDK 1.29.0; verify against `node_modules/@modelcontextprotocol/sdk` rather than assuming.
- **`.mcp.json` HTTP schema** — Claude Code's expected shape for a remote/HTTP MCP server may be `{ "type": "http", "url": … }`; confirm to avoid a silently-ignored entry. If uncertain, document the exact shape used and why.
- **Endpoint path** — the server is path-agnostic today; if the example client and `.mcp.json` use `/mcp` but a consumer uses `/`, both work. Note this in the doc so a consumer isn't confused.
- **Public-repo anonymization** — no `/home/<user>/…` paths, no usernames, in the docs or the example script.
- **Don't over-document unimplemented surface** — `readAxTree` `depth`/`properties` are not exposed (Leg 3); the docs must not list them. Action-by-a11y-handle is out of scope; the docs say so.

## Files Affected

- `scripts/mcp-example-client.mjs` — new, SDK-client example (attach-don't-launch).
- `docs/mcp-automation.md` — new, consumer reference.
- `.mcp.json` — add the `goldfinch` HTTP entry (Playwright left intact).
- `CLAUDE.md` — replace the "land in a later leg" placeholder with the tool summary + doc link.
- `README.md` — add `dev:automation` + a pointer to the consumer doc (no reframe).

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[HANDOFF:review-needed]` (autonomous leg — do NOT commit; the Flight Director defers review + commit to the end of the flight):**

- [ ] All acceptance criteria verified (live example-client run is Leg 6)
- [ ] `npm run lint` + `npm run typecheck` + `npm test` passing; `.mcp.json` valid
- [ ] Update flight-log.md with a Leg Progress entry (the documented endpoint path decision; the `.mcp.json` HTTP shape used)
- [ ] Set this leg's status to `landed` (NOT `completed`)
- [ ] Do NOT commit; do NOT check off the leg in flight.md yet
