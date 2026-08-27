# Dev testing — launch states, keys, and driving the running app

Operational recipes for live verification (human or agent): how to launch the app in each
state, capture automation keys, attach a consumer, and run the a11y audit. The full MCP
consumer contract (endpoint, auth model, tool reference, refusal semantics) lives in
`mcp-automation.md` — this page is the "what do I actually type" companion.

## Launch states

| Command | Profile | Automation surface | Keys |
| --- | --- | --- | --- |
| `npm start` | production `userData` | binds only on the Settings `automationEnabled` toggle (human-only) | Settings → Keys UI |
| `npm run dev:automation` | dev (`…/goldfinch-dev`, isolated) | force-bound (`--automation-dev`, `!app.isPackaged`-gated) | none minted — every request is rejected unless a previously minted dev key is supplied; admin-tier ops refused without an admin key |
| `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation` | dev | force-bound | jar + admin keys minted at startup, printed once |

The last row is the **canonical dev/test launch** — always use it unless you specifically
want a keyless run. It is dev-only and profile-isolated; there is no downside to minting.

`scripts/dev-launch.mjs` (behind `npm run dev:automation`) also decides the ozone platform:
it passes `--ozone-platform=wayland` when a Wayland socket is reachable (X11 under WSLg
swallows the first cross-window click-to-activate; decision logic in
`src/main/ozone-platform.js` — it lives in the launcher because Electron resolves ozone
before `main.js` runs). A caller-provided `--ozone-platform*` flag wins; non-WSLg X
desktops are untouched.

## Key capture

Startup prints exactly one parseable stdout line:

```
AUTOMATION_DEV_MINT {"key":"<jarKey>","adminKey":"<adminKey|null>"}
```

- `key` — a fresh key for the resolved **default jar**; `null` (with a parseable stderr
  notice) when the default is Burner.
- `adminKey` — minted only when `GOLDFINCH_AUTOMATION_ADMIN=1`; otherwise `null`.
- Only key *hashes* persist — the plaintext on this line is shown once and never
  re-derivable. Every mint is therefore a **new** key: a static `.mcp.json` entry goes
  stale at the next mint, so agents attach via env-var + script (below), not static MCP
  client config (which also can't be re-registered mid-session).

Export what the consumer needs:

```bash
export GOLDFINCH_MCP_ADMIN_KEY=<adminKey>   # admin/chrome work (a11y chrome sweep, enumerateWindows, getChromeTarget)
export GOLDFINCH_MCP_KEY=<jarKey>           # jar-scoped guest work
```

Every `GOLDFINCH_*` variable read by `src/`/`scripts/` has a placeholder entry in
`.env.example` at the repo root — copy it to `.env` (gitignored) and fill in real values as a
starting point.

## Attaching a consumer

Attach model: the app is launched out-of-band; the script connects to the already-running
loopback server (default `http://127.0.0.1:49707/mcp`) — it never spawns the app.

- **`scripts/lib/mcp-client.mjs` → `connectAutomation()`** — the reusable seam; reads
  `GOLDFINCH_MCP_ADMIN_KEY` (preferred) / `GOLDFINCH_MCP_KEY` from env and attaches the
  `Authorization: Bearer` header. Exemplar consumer: `scripts/a11y-audit.mjs`.
- **`scripts/mcp-example-client.mjs`** — runnable end-to-end reference (connect → list
  tools → open tab → navigate → screenshot → read DOM).
- **Raw `curl`** — fine for a one-shot poke, but the Streamable-HTTP handshake
  (initialize → `mcp-session-id` header on every subsequent call,
  `Accept: application/json, text/event-stream`) makes the lib the right choice for
  anything multi-step.

Tiers: a jar key drives only its own jar's tabs; the admin key adds chrome/window
targeting and the app-level tools. Admin-tier scope and the still-refused-even-for-admin
list: `mcp-automation.md` → *Dogfooding / dev key acquisition* and *Tool reference*.

## a11y audit (`npm run a11y`)

axe-core audit (`scripts/a11y-audit.mjs`) against the RUNNING app over the MCP surface
(zero CDP). Verify-only — NOT part of headless CI (needs the live GUI).

- **Attach**: canonical admin launch (above), then `export GOLDFINCH_MCP_ADMIN_KEY=<adminKey>`
  (chrome mode) or `GOLDFINCH_MCP_KEY=<jarKey>` + `--target=<url-substring>` (guest mode).
- **Coverage**: five chrome states + eight sheet states; the sheet's wcId is resolved once
  per run from `enumerateWindows` with **no fallback** — a failed read fails the run loudly.
- **Gate**: violations are diffed against the curated `ACCEPTED` allowlist baked into the
  script — only NEW `(rule id, node-selector)` findings fail. Tag convention:
  `--tags=wcag2a,wcag2aa,wcag21a,wcag21aa` (axe's full default set adds non-conformance
  advisories like `region`, the documented app-shell exception); `nested-interactive` is
  always disabled (the tab/close-button pattern is accepted APG).
- **Fixture**: serve `tests/behavior/fixtures/a11y-media/` via `python3 -m http.server` at
  `http://127.0.0.1:8000/`.
- **Exclusions**: `goldfinch://settings` cannot be audited via `--target` (the eval tools
  exclude the internal session even for admin); the find overlay is not audited here (its
  a11y rests on the verbatim attribute carry-over + HAT keyboard pass).
- **Exit codes** (squawk 0031): `0` clean (no new violations), `1` NEW violations found,
  `2` apparatus/setup failure (couldn't attach, target not found, missing key, etc. — the
  audit did not run to completion) — distinct from `1` so a caller can tell "not run" from
  "red".

## Debug flags

### `GOLDFINCH_VAULT_TRACE`

Opt-in trace of the vault capture → hold → unlock → finalize lifecycle
(`src/main/register-browser-ipc.js`). That sequence spans three processes, so a failure
anywhere in it otherwise presents to the operator as "no prompt appeared" with nothing to go
on. OFF by default and therefore silent in every normal run.

```bash
GOLDFINCH_VAULT_TRACE=1 npm run dev:automation
```

Logs each step (tagged `[vault-capture]`) to the main process's console via `logger.info`.
What it prints is bounded **by construction** to non-secrets — the opaque main-minted
`captureId`, the tab's `wcId`, the disposition mode, and the finalize outcome — **never** a
password, a username, or an origin.

## Test layers

- `npm test` — offline unit suite (`node --test` over `test/unit/**`); pure helpers, no app.
- `tests/behavior/` — behavior specs, driven against the running app over the MCP surface.
- `npm run a11y` — the audit above; live GUI required.
- `npm run lint` / `npm run typecheck` / `npm run format:check` (or `npm run format` to fix) round out the local gate set that CI also runs.
