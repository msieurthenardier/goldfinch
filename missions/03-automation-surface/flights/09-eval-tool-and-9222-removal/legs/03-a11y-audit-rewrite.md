# Leg: a11y-audit-rewrite

**Status**: completed
**Flight**: [Eval tool + DevTools tool + a11y/farbling migration + final :9222 removal](../flight.md)

## Objective
Rewrite `scripts/a11y-audit.mjs` from a CDP-over-WebSocket client against `:9222` into an **MCP client over the loopback automation surface** that uses the new `injectScript`/`evaluate` tools to inject `axe-core` and read its violation report — **preserving the curated baseline diff, per-node partition, 4-state chrome sweep, guest mode, and exit-code semantics unchanged** — so `npm run a11y` runs green on `dev:automation` with no `:9222`.

## Context
- **DD4 — the a11y gate is the last CDP-`:9222` consumer besides farbling; moving it is what lets `:9222` die (leg 6).** This leg swaps the *transport + target acquisition + auth* only; the audit logic (axe rules, state driving, baseline matching, reporting, exit codes) is preserved.
- **Depends on legs 1–2** (eval tool live; registry at 21). The leg-1 spike already proved `injectScript(axeSource)` + `evaluate('axe.run(...)')` returns the JSON report live.
- **DD2 inject-then-run pairing:** inject axe-core via `injectScript(wcId, axeSource)`, then **immediately** `evaluate(wcId, 'axe.run(document, opts).then(r => ...)')` — do not assume `window.axe` persists across a gap. The a11y driver controls its own session, so the window is small; enforce the immediate pairing.
- **Key provisioning — the F6/F7 dogfooding pattern (established).** A standalone script cannot reach the app's IPC to mint a key. The mechanism (built in F4 leg 5, `src/main/main.js` `shouldAutoMint` + `src/shared/automation-dev.js`): launching with `GOLDFINCH_AUTOMATION_DEV_MINT=1` **and** `--automation-dev` makes the app print **one** line to stdout — `AUTOMATION_DEV_MINT {"key":"<jarKey>","adminKey":"<adminKey|null>"}` — minting the `default` jar key always and the admin key only when `GOLDFINCH_AUTOMATION_ADMIN` is set. The client captures that line and sends `Authorization: Bearer <key>`. This is **dev-only** (double-gated; no-op on a packaged build; plain `dev:automation` with no `DEV_MINT` prints nothing → off-by-default preserved).
- **Transport — MCP SDK over Streamable-HTTP** (Flight 3). Endpoint `http://127.0.0.1:${GOLDFINCH_MCP_PORT||49707}/mcp`; `scripts/mcp-example-client.mjs` is the connection exemplar (`@modelcontextprotocol/sdk` `Client` + `StreamableHTTPClientTransport`) — but it connects **unauthenticated**, so this leg adds the Bearer-header wiring it lacks.
- **The a11y audit needs the ADMIN key** for its default mode: it drives the **chrome renderer's** 4 UI states (base-chrome → media-panel → privacy-panel → lightbox) via `getChromeTarget` (admin-only). Guest mode (`--target=<substr>`) uses `enumerateTabs` + a jar key. So `GOLDFINCH_AUTOMATION_ADMIN` must be set for the default chrome sweep.
- **`:9222` is NOT removed here** — that's leg 6 (sequenced last, after this + farbling migrate off it). This leg makes a11y *stop using* `:9222`; `dev:debug` still exists until leg 6.
- **CI:** the a11y gate is **local-only / verify-only** (not in any CI pipeline; needs a live display). The rewrite keeps that posture — no CI wiring.

## Inputs
- `scripts/a11y-audit.mjs` (current, ~350 lines): `CDP_HTTP = 'http://127.0.0.1:9222'` (`:44`); `findRendererTarget()` via `/json` (`:120-140`); `findGuestTarget(substr)` (`:154-179`); raw `WebSocket` CDP client `connect()`/`send()` (`:182-216`); `evaluate(cdp, expr, {awaitPromise})` → `Runtime.evaluate` `awaitPromise:true,returnByValue:true` (`:221-232`); `runAxe()` (re-inject axe, disable `nested-interactive`, `axe.run`, collect `v.nodes.map(n => n.target.flat(Infinity).join(' '))`) (`:237-253`); axe source `readFileSync(node_modules/axe-core/axe.min.js)` (`:262`); `main()` 4-state chrome sweep (`:256-301`) + guest `--target` mode (`:266-271`); **`ACCEPTED` allowlist inline** (`:101-117` — 5 app-shell `region`/`landmark`/`heading` exceptions + 2 state-keyed `scrollable-region-focusable` on `#privacy-body`/`#lightbox-stage`); partition into accepted/newPairs (`:304-323`); report + **exit 0 iff `newPairs.length===0`, else exit 1** (`:325-347`); args `--url`/`--rules`/`--tags`/`--target` (`:21-24`, fixture default `http://127.0.0.1:8000/` `:54`).
- `scripts/mcp-example-client.mjs` — MCP SDK connection exemplar (`:24-32` endpoint resolution; `:57-63` connect; `:77-106` `client.callTool({name, arguments})` → `{content, isError?}`); **unauthenticated** (no Bearer).
- `src/main/main.js` — `shouldAutoMint(argv, env)` + the `AUTOMATION_DEV_MINT` stdout print (`main.js:1036-1046`); `mintJarKey`/`mintAdminKey`.
- `src/shared/automation-dev.js` — `isMcpAutomationEnabled` + `shouldAutoMint` (`:62-64`).
- `src/main/automation/mcp-tools.js` — `evaluate` (`:344-359`) / `injectScript` (`:362-379`) tool contracts (post-legs 1-2); `getChromeTarget` (admin) / `enumerateTabs` shapes.
- `docs/mcp-automation.md` — transport (`:51-63`), Origin/Host guard (`:72-81`), auth gate (`:122-141`), result envelope (`:310-332`).
- `package.json` — `"a11y": "node scripts/a11y-audit.mjs"` (`:19`); `"dev:automation": "electron . --enable-logging --no-sandbox --automation-dev"` (`:12`); `"dev:debug"` (`:11`, still present until leg 6); `axe-core@^4.12.1` (`:73`).

## Outputs
- `scripts/a11y-audit.mjs` rewritten onto the MCP eval-tool apparatus (no `:9222`, no raw CDP/WebSocket), preserving baseline diff + exit codes.
- Authenticated MCP client wiring (Bearer header + `AUTOMATION_DEV_MINT` key capture) — either inline or as a small reusable helper (see guidance; the farbling leg 4 + the eventual `cdp-driver` retirement also want an authenticated client, so a shared helper is preferred).
- `npm run a11y` runs green on `dev:automation` (live, with a display), exercising the same 4 chrome states + the same baseline.
- Doc updates: the script header recipe, a dev key-acquisition recipe in `docs/mcp-automation.md`, and any `CLAUDE.md`/README mention of `dev:debug`-for-a11y repointed to `dev:automation` (without removing `dev:debug` itself — leg 6).

## Acceptance Criteria
- [x] **AC1 — transport swapped, zero `:9222`/CDP.** `scripts/a11y-audit.mjs` no longer references `127.0.0.1:9222`, `/json`, `WebSocket`, or `Runtime.evaluate`. Target acquisition is `getChromeTarget` (admin, default chrome mode) / `enumerateTabs` (jar, `--target` guest mode); axe is injected via `injectScript` and run via `evaluate`. `grep -n "9222\|/json\|WebSocket\|Runtime.evaluate" scripts/a11y-audit.mjs` returns nothing.
- [x] **AC2 — authenticated client (attach model).** The script connects via the MCP SDK (`StreamableHTTPClientTransport` with `requestInit.headers.Authorization: 'Bearer <key>'`), reading the key from env (`GOLDFINCH_MCP_ADMIN_KEY` for chrome mode / `GOLDFINCH_MCP_KEY` for guest mode) — the operator captured it from the `AUTOMATION_DEV_MINT` stdout line of a separately-launched `dev:automation`. Endpoint resolves from `GOLDFINCH_MCP_URL`/`GOLDFINCH_MCP_PORT` (default `:49707`), matching `mcp-example-client.mjs`. Missing key → clear error.
- [x] **AC3 — baseline + gate semantics preserved EXACTLY.** The `ACCEPTED` allowlist (all entries, incl. the 2 state-keyed `scrollable-region-focusable`), the per-node `(id, selector, state)` partition, the accepted/new split, the report format, and **exit 0 iff no NEW pairs / exit 1 otherwise** are byte-for-byte equivalent in behavior. The 4-state chrome sweep (base/media-panel/privacy-panel/lightbox) and `--target` guest mode both still work. No a11y *fixes* in this leg — baseline unchanged.
- [x] **AC4 — inject-then-run pairing (DD2).** axe-core is injected via `injectScript(wcId, axeSource)` immediately followed by a single `evaluate(wcId, 'axe.run(...)')` per state. `injectScript` makes **no persistence guarantee** (`mcp-tools.js:366-367`), so per-state re-inject is **required**, not merely defensive — exactly as the old `runAxe` re-`evaluate`d `axeSource` each state (`:237-253`).
- [x] **AC5 — `npm run a11y` green live.** With `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1` and a display, the audit completes and exits 0 against the current baseline (no NEW violations), reading the same axe report the CDP path did. Evidence (the run's accepted/new summary) recorded in the flight log. *(If no display is available in the implementer's environment, this is a live/HAT-deferred check — see Edge Cases; the implementer still runs the full unit/lint/typecheck gates and the FD runs the live a11y in the verify leg.)*
- [x] **AC6 — launch model documented.** The **attach + env key** model (DD-A) is implemented and documented in the script header + a `docs/mcp-automation.md` dev key-acquisition recipe (the `AUTOMATION_DEV_MINT` mechanism). `npm run a11y`'s usage text reflects the new prerequisites (`dev:automation` running + `GOLDFINCH_MCP_ADMIN_KEY` exported). If the optional self-spawn convenience is added instead, that choice + rationale is recorded in the flight log.
- [x] **AC7 — green gates.** `npm test`, typecheck, lint pass (the script is `.mjs`; ensure lint/typecheck config covers or appropriately ignores it as today).

## Verification Steps
- `grep -n "9222\|/json\|new WebSocket\|Runtime.evaluate\|webSocketDebuggerUrl" scripts/a11y-audit.mjs` — nothing.
- `grep -n "injectScript\|evaluate\|getChromeTarget\|enumerateTabs\|Bearer\|AUTOMATION_DEV_MINT" scripts/a11y-audit.mjs` — present.
- Live (manual / verify leg): in one shell `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation` (note the printed key / or the self-spawn handles it); serve the fixture (`tests/behavior/fixtures/a11y-media/` on `:8000`) as today; `npm run a11y` → exits 0, prints the accepted-pairs summary, no NEW pairs.
- Confirm guest mode still works: `npm run a11y -- --target=goldfinch://settings` audits the guest once (jar/admin per the target) — note the internal-session caveat (settings is the internal session; the eval tool refuses it even for admin, so a settings-page a11y audit via `evaluate` is **not possible** — see Edge Cases; the old CDP path could read it, the new one cannot. Decide disposition).
- `npm test`, `npm run typecheck`, `npm run lint` — green.

## Implementation Guidance

1. **DD-A — launch/auth model: ATTACH + env key (design-review decision; matches F6/F7 precedent).** The old script *attached* to a separately-launched app, `mcp-example-client.mjs` explicitly attaches, and every F6/F7 dogfooded run launched `dev:automation` out-of-band then attached. The rewrite **keeps the attach model** (lower WSLg fragility — no child Electron lifecycle, no stdout-flush race amid `--enable-logging` noise; the `:8000` fixture is already an external prereq):
   - **(Primary) Attach + env key:** the operator/FD runs `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation`, which prints `AUTOMATION_DEV_MINT {"key":…,"adminKey":…}` once; captures the key and exports it (`GOLDFINCH_MCP_ADMIN_KEY=<adminKey>` for chrome mode / `GOLDFINCH_MCP_KEY=<key>` for guest mode). `npm run a11y` reads the key from env, resolves the endpoint (`GOLDFINCH_MCP_URL`/`GOLDFINCH_MCP_PORT`, default `:49707`), connects the authenticated client, and runs the audit. Clear error if the env key is missing.
   - **(Optional convenience, not required) Self-contained spawn:** if a one-command gate is later wanted, the script may spawn `GOLDFINCH_AUTOMATION_DEV_MINT=1 [GOLDFINCH_AUTOMATION_ADMIN=1] electron . --automation-dev`, parse the `AUTOMATION_DEV_MINT` line from stdout, run, and **guarantee teardown on every exit path** (pass/fail/throw/SIGINT — no orphaned Electron). Only add this if the attach flow proves too clunky; record the choice + rationale in the flight log per AC6.

2. **Authenticated MCP client helper — extract `scripts/lib/mcp-client.mjs`** (design-review: worth it; leg 4 + the cdp-driver retirement reuse it; `scripts/**` is auto-linted, typecheck doesn't touch scripts). Export e.g. `connectAutomation({ port, key })` → a connected `Client`, and `callTool(client, name, args)` → unwrapped `{ value, isError }`. Reuse `mcp-example-client.mjs`'s transport setup; add the Bearer header via `new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: 'Bearer ' + key } } })` (confirmed SDK-supported). **Default the key from env** (`GOLDFINCH_MCP_ADMIN_KEY` / `GOLDFINCH_MCP_KEY`) so leg 4 reuses it without spawn coupling. A small unit test of the helper's `callTool` unwrapping (and, if the spawn path is added, the `AUTOMATION_DEV_MINT` line parser — tolerate logging noise, timeout-with-clear-error) is welcome.

3. **Target acquisition.**
   - Chrome mode (default): `getChromeTarget()` (admin key) → `{ wcId }`. Audit drives the chrome's 4 states on that wcId.
   - Guest mode (`--target=<substr>`): `enumerateTabs()` → find the tab whose `url` includes the substr → its `wcId`. Use a jar key (or admin). **Caveat:** `goldfinch://settings` is the *internal* session — the eval tool refuses it even for admin (legs 1-2), so it cannot be audited via `evaluate`. The old CDP path could. See Edge Cases for disposition.

4. **Axe inject + run** (replace `runAxe` `:237-253` internals, keep its shape):
   - `const axeSource = readFileSync(node_modules/axe-core/axe.min.js)` (unchanged, `:262`).
   - Per state: `await callTool(client, 'injectScript', { wcId, script: axeSource })` then **immediately** `await callTool(client, 'evaluate', { wcId, expression: 'axe.run(document, ' + JSON.stringify(opts) + ').then(r => ({ violations: r.violations }))' })`. `evaluate` auto-awaits the Promise and returns JSON (legs 1-2). Disable `nested-interactive` in `opts` as today. Collect `v.nodes.map(n => n.target.flat(Infinity).join(' '))` from the returned violations (unchanged).
   - **Chrome main-world caveat (verify):** the chrome state-driving functions (`togglePanel`/`togglePrivacy`/`openLightbox`) must be callable via `evaluate(chromeWcId, 'togglePanel(true)')`. `executeJavaScript` runs in the page's main world (contextIsolation isolates the preload, not injected page JS), so they should be reachable exactly as the old `Runtime.evaluate` reached them — but confirm live, since it's load-bearing for the 4-state sweep.

5. **State driving** — keep `main()`'s sequence (`:256-301`): navigate/setup → `runAxe('base-chrome')` → `togglePanel(true)` → `runAxe('media-panel')` → `togglePrivacy(true)` → `runAxe('privacy-panel')` → `openLightbox({...})` → `runAxe('lightbox')`, aggregating into `allViolations`. Each `togglePanel`/etc. is now an `evaluate(chromeWcId, '<fn call>')`.
   - **[design-review] Navigation MUST stay the chrome `navigate()` global via `evaluate`, NOT the `navigate` MCP drive tool.** The old script (`:275`) calls the chrome renderer's `navigate(fixtureUrl)` global (which opens a guest tab from the chrome shell) and then audits the **chrome** wcId. The `navigate` MCP drive tool navigates a *guest tab by wcId* — different semantics, wrong target. Use `evaluate(chromeWcId, 'navigate(' + JSON.stringify(fixtureUrl) + ')')`. (`togglePanel`/`togglePrivacy`/`openLightbox`/`navigate` are all top-level `function` decls in `src/renderer/renderer.js`, loaded as a classic script → `window` globals reachable in the main world by `executeJavaScript`; confirmed by the reviewer, verify live.)
   - The existing fixed `sleep`/settle waits (e.g. the old `:275` 2500ms) are transport-orthogonal — keep them as-is (hardening to a readiness probe is out of scope; note if you change anything).

6. **Baseline diff / report / exit code** — **carry over unchanged** (`:86-117` ACCEPTED, `:304-347` partition+report+exit). This is the gate's contract; do not alter matching logic, the allowlist entries, or the exit-code rule.

7. **Docs.**
   - Script header: replace the `npm run dev:debug` / `:9222` prerequisite (`:18`, `:32-34`) with the new recipe (`dev:automation` + `GOLDFINCH_AUTOMATION_DEV_MINT=1` + `GOLDFINCH_AUTOMATION_ADMIN=1`, or the self-spawn note).
   - `docs/mcp-automation.md`: add a short **"Dogfooding / dev key acquisition"** recipe (the `AUTOMATION_DEV_MINT` stdout mechanism) — it is currently undocumented (this is the natural home now that a shipped script depends on it).
   - `CLAUDE.md` / README: if either points at `dev:debug` for a11y, repoint to `dev:automation`. **Do NOT remove `dev:debug` / `:9222`** — leg 6.

## Edge Cases
- **`goldfinch://settings` guest audit no longer possible via `evaluate`** (internal-session exclusion, legs 1-2). The old CDP path could audit it. **Disposition (decide + record):** the chrome shell's settings *area* is audited as part of the chrome renderer states where applicable; a standalone settings-guest a11y audit via the eval tool is out of reach by design. If a settings a11y gate is needed, it's a separate concern (note it; don't hack around the internal exclusion). Confirm the current gate doesn't actually depend on a `--target=goldfinch://settings` run for its pass.
- **No display / headless** — the Electron app won't render; `capturePage`/paint-dependent reads fail, and axe on an unpainted DOM may differ. The a11y gate is inherently live (it always was). If the implementer has no display, defer AC5's live run to the verify/HAT leg and record that; still land the code + unit/lint/typecheck.
- **Child-process lifecycle (if self-contained spawn):** ensure the spawned Electron is killed on every exit path (audit pass, audit fail, exception, SIGINT) — no orphaned Electron. Use a `finally`/signal-handler teardown.
- **Port in use / `GOLDFINCH_MCP_PORT`** — honor it for both the spawned app and the client endpoint so they rendezvous on the same port.
- **`AUTOMATION_DEV_MINT` line parsing** — match the exact prefix; tolerate other stdout noise (electron logging) around it. If the line never appears within a timeout, fail with a clear error ("automation dev-mint not observed — is `--automation-dev` + `GOLDFINCH_AUTOMATION_DEV_MINT=1` set?").

## Files Affected
- `scripts/a11y-audit.mjs` — rewritten transport/target/auth; audit logic + baseline preserved.
- `scripts/lib/mcp-client.mjs` (new, preferred) — shared authenticated MCP client helper (or inline into a11y-audit + reuse in leg 4).
- `docs/mcp-automation.md` — dev key-acquisition recipe.
- `CLAUDE.md` / `README.md` — repoint any a11y-via-`dev:debug` mention to `dev:automation` (do not remove `:9222`).
- `package.json` — `a11y` script unchanged unless the launch model needs args; update its comment/usage if needed.
- (No new unit tests strictly required — the script is a live gate — but if the helper is extracted, a small unit test of `callTool` unwrapping / key-line parsing is welcome.)

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:** *(commit deferred to flight end per `/agentic-workflow`.)*

- [x] All acceptance criteria verified (AC5 live, or deferred-to-verify with rationale)
- [x] Tests passing (`npm test` + typecheck + lint)
- [x] Update flight-log.md with leg progress entry (launch-model decision + live a11y result or deferral)
- [x] Set this leg's status to `landed`
- [x] Check off this leg in flight.md
