# Behavior Test: MCP transport enforces the opt-in + per-key auth gate

**Slug**: `mcp-auth-gating`
**Status**: active
**Created**: 2026-06-14
**Last Run**: 2026-06-14-13-20-52 (pass — FD-driven machine-read)

## Intent

Verify SC8's **authentication half** in the running app: the Goldfinch MCP surface is **off by default** (no request is honored until the operator opts in by enabling automation) and, once enabled, is **per-key gated** — a request is admitted only when it carries a valid `Authorization: Bearer <key>` that resolves to a known identity (a per-jar key or, when its env gate is set, the admin key). Every other Bearer shape — missing, wrong/garbage, empty (`Bearer ` with no token) — and every request while the surface is disabled draws a bare **401** before any MCP/session routing. The admin tier is **inert unless `GOLDFINCH_AUTOMATION_ADMIN` is set in the launching environment**: the admin key resolves to no identity (→ 401) when the env var is unset, and is accepted only on a relaunch with it set.

This needs a behavior test rather than a unit test because the contract is the **wiring of the gate ahead of the SDK on the real Node HTTP listener** — that `resolveIdentity` reads the live settings store per request, that a null identity becomes a pre-routing 401 (mirroring the origin guard's bare 403), and that the `GOLDFINCH_AUTOMATION_ADMIN` env presence is read at process start. The unit suite (`automation-auth.test.js`, the gate's `validateKey`) covers key validation and identity resolution in isolation with stubbed settings; this spec exercises the gate end to end over the loopback transport, with a key **really minted by the running app** and presented on a real client transport.

**Guard-first ordering (composition with SC7).** The SC7 Origin/Host guard runs **FIRST** on every request: a bad-origin request is **403 regardless of key** (covered by the sibling `mcp-loopback-origin-guard` spec). This spec is the **401 key half** — every request below is sent from loopback with no hostile Origin/Host, so the origin guard passes and the **auth gate** is the decisive verdict. A reader must not read a 401 here as an origin verdict, nor a 403 there as an auth verdict; the two gates are independent and ordered (403 origin → 401 auth → routing).

**Scope honesty (read before running).** Off-by-default and accepted-after-enable **cannot** be witnessed in a single run: the enable/mint apparatus (see Preconditions) flips `automationEnabled = true` at boot, so once a run is minted, the off-state is gone for that process. The spec is therefore structured as **two runs** — **Run A** (launched WITHOUT the mint env) observes the 401-while-disabled; **Run B** (launched WITH the mint env) observes acceptance + the per-key rejections. The admin-on assertion is a **third, env-gated relaunch** (`GOLDFINCH_AUTOMATION_ADMIN` set) — an operator-checkable precondition / variant, never a mid-run mutation (the env var is read at process start).

## Preconditions

- **Apparatus — the enable/mint helper (EXISTS; landed in Flight 4).** The enable/mint apparatus this spec relies on is an **env-gated auto-mint-to-stdout in `main.js`** that is **already built** — `shouldAutoMint(argv, env)` gates it on the exact `--automation-dev` token **AND** the env var **`GOLDFINCH_AUTOMATION_DEV_MINT=1`** (deliberately distinct from `--automation-dev` so the off-state is still observable in a no-mint launch):
  - When `shouldAutoMint(argv, env)` is true, the app calls `enableAndMintJarKey(jarId, settings, jars)` (and `mintAdminKey(settings)` when `GOLDFINCH_AUTOMATION_ADMIN` is set), flips `automationEnabled = true`, and **prints `{ key, adminKey }` ONCE to stdout** (`adminKey` is `null` when the admin gate is unset).
  - `enableAndMintJarKey` / `mintAdminKey` live in `src/main/automation/mcp-server.js`; the auto-mint-to-stdout wrapper that calls them at boot landed in Flight 4. No new apparatus is needed to run this spec.
  - The Executor **captures the printed key (and adminKey) from stdout at launch** and presents it on the client transport. The plaintext is **shown once** — capture it at mint time.
- **Port (load-bearing for every URL below).** Runs pin the listen port with **`GOLDFINCH_MCP_PORT`** for determinism (new default is `49707`). Every `127.0.0.1:$GOLDFINCH_MCP_PORT` below resolves to the pinned port; export it once at launch and reuse it in all curl/SDK calls.
- **How the key attaches to the client (load-bearing).** The minted plaintext is presented as an `Authorization: Bearer <key>` header on the **SDK client transport**, via `requestInit.headers`:
  ```js
  const port = process.env.GOLDFINCH_MCP_PORT || 49707; // pinned per run; new default 49707
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${port}/mcp`),
    { requestInit: { headers: { Authorization: `Bearer ${key}` } } }
  );
  ```
  (the `connectClient(key)` pattern). The header rides every request the transport sends (`initialize`, `tools/call`, the SSE GET). For the raw-shell rejection probes (missing / wrong / empty Bearer), `curl -H 'Authorization: …'` against `http://127.0.0.1:$GOLDFINCH_MCP_PORT/mcp` measures the bare HTTP status directly — those need no SDK handshake (the 401 is pre-routing).
- **Run A (off-by-default):** Goldfinch launched via `npm run dev:automation` (`electron . --no-sandbox --automation-dev`) **WITHOUT** `GOLDFINCH_AUTOMATION_DEV_MINT` — so the auto-mint helper does NOT run, `automationEnabled` stays `false`, and nothing is printed to stdout. The MCP server is up on `127.0.0.1:$GOLDFINCH_MCP_PORT/mcp` (the origin/transport layer is independent of the auth toggle).
- **Run B (opt-in + per-key):** Goldfinch relaunched via `npm run dev:automation` **WITH `GOLDFINCH_AUTOMATION_DEV_MINT=1`** in the environment — the helper enables the surface, mints a jar key (e.g. for `personal`), and prints `{ key, adminKey }`. `GOLDFINCH_AUTOMATION_ADMIN` is **UNSET** in Run B (so the admin tier is inert and `adminKey` is `null`).
- **Run C (admin env-set — relaunch-gated variant):** Goldfinch relaunched via `npm run dev:automation` with **BOTH** `GOLDFINCH_AUTOMATION_DEV_MINT=1` **AND** `GOLDFINCH_AUTOMATION_ADMIN=1` — the helper additionally mints the admin key and prints a non-null `adminKey`. The env var is read at process start; admin-off (Run B) vs admin-on (Run C) are **separate launches**, never a mid-run toggle.
- `curl`, Bash, and an MCP client (the SDK client, `scripts/mcp-example-client.mjs` adapted to pass the Bearer header, or a Claude Code MCP session) are available.
- **Apparatus disqualification:** the `chrome-devtools` MCP does **NOT** qualify — it launches its own browser and never touches this server (false pass). The apparatus is the SDK client / `curl` over `127.0.0.1:$GOLDFINCH_MCP_PORT`, app launched via `npm run dev:automation`. This is **not** the `:9222` CDP path (`dev:debug` does not start the MCP server).

## Observables Required

- http (HTTP response **status code** from the MCP server — measured via `curl -s -o /dev/null -w '%{http_code}'` for the raw Bearer-shape probes; the auth gate's verdict is the status: 401 = rejected at the gate, not-401 = passed the gate into the SDK)
- mcp (the SDK client's handshake + tool-call results over the loopback transport — `initialize` success/failure and an `enumerateTabs` result/`isError` for the accepted-key check — measured via the MCP client connected with the Bearer header)
- shell (stdout capture of the minted `{ key, adminKey }` at launch; curl exit/status — measured via Bash)

## Steps

### Run A — off by default (launched WITHOUT `GOLDFINCH_AUTOMATION_DEV_MINT`)

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **Active-precondition probe.** Confirm the app was launched WITHOUT the mint env: there is **no** `{ key, adminKey }` line on the launch stdout. Then probe the server with a benign loopback request that should pass the origin guard but carry no key: `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$GOLDFINCH_MCP_PORT/mcp` (curl auto-sends loopback `Host`, no `Origin`, no `Authorization`). | No mint line was printed (surface confirmed OFF: `automationEnabled` is `false`). The status is **401** — the gate rejected a keyless request while the surface is disabled. (It is the **auth** 401, not the origin 403: the request is loopback with no hostile Origin/Host, so SC7's guard passed and the auth gate is the verdict.) **If a mint line WAS printed, or a bare keyless loopback request returns anything other than 401, halt — Run A's off-state preconditions are not met (the surface is enabled).** |
| 2 | **Off-by-default: a fabricated Bearer is still 401 while disabled.** `curl -s -o /dev/null -w '%{http_code}' -H 'Authorization: Bearer deadbeef-not-a-real-key' http://127.0.0.1:$GOLDFINCH_MCP_PORT/mcp`. | The status is **401**. Even a syntactically valid `Bearer <token>` is rejected because `resolveIdentity` returns `null` when `settings.get('automationEnabled') !== true` — the surface does **nothing** until opted in. This is the off-by-default property: the key gate is moot while disabled; the request never reaches session routing. |

### Run B — opt-in + per-key gate (relaunched WITH `GOLDFINCH_AUTOMATION_DEV_MINT=1`, `GOLDFINCH_AUTOMATION_ADMIN` unset)

| # | Actions | Expected Results |
|---|---------|------------------|
| 3 | **Capture the minted key (precondition for this run).** Relaunch via `npm run dev:automation` with `GOLDFINCH_AUTOMATION_DEV_MINT=1`. Read the single `{ key, adminKey }` line printed to stdout at launch; record the plaintext jar `key`. | A `{ key, adminKey }` line was printed exactly once; `key` is a non-empty plaintext string (the minted `personal`-jar key); `adminKey` is **`null`** (Run B has `GOLDFINCH_AUTOMATION_ADMIN` unset, so no admin key is minted). The surface is now enabled (`automationEnabled = true`). **If no key was printed, halt — the mint apparatus did not run.** |
| 4 | **Valid jar key accepted.** Construct the SDK client transport with `requestInit: { headers: { Authorization: \`Bearer ${key}\` } }` (the captured Run-B key), `connect()` (performs `initialize`), then call the benign `enumerateTabs`. | `initialize` **succeeds** (the handshake completes — not 401, the gate admitted the request and routing opened a session bound to the `personal` identity). `enumerateTabs` returns a JSON-text **array** result and is **NOT `isError` for auth reasons** (it returns the jar's tab listing; an empty `[]` is still a valid success). This is the opt-in + valid-key accepted property: a real minted key on the transport completes the handshake and a benign tool call. |
| 5 | **Missing key → 401.** With the surface still enabled, send a request carrying **no** `Authorization` header: `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$GOLDFINCH_MCP_PORT/mcp`. | The status is **401**. `parseBearer` returns `''` (no header), so `resolveIdentity` returns `null` → bare 401. Enabling the surface does **not** drop the key requirement — a keyless request is still rejected. |
| 6 | **Wrong / garbage key → 401.** `curl -s -o /dev/null -w '%{http_code}' -H 'Authorization: Bearer totally-wrong-garbage-key' http://127.0.0.1:$GOLDFINCH_MCP_PORT/mcp`. | The status is **401**. The token is well-formed but resolves to no identity (`validateKey` matches no jar hash and no admin hash), so `resolveIdentity` returns `null` → 401. A valid Bearer shape with a non-matching token is rejected. |
| 7 | **Empty Bearer (no token) → 401.** `curl -s -o /dev/null -w '%{http_code}' -H 'Authorization: Bearer ' http://127.0.0.1:$GOLDFINCH_MCP_PORT/mcp` (the scheme with an empty token). | The status is **401**. `parseBearer` returns `''` for `Bearer ` with no token (`parts[1]` is absent / empty), so `resolveIdentity` returns `null` → 401. A present-but-tokenless `Authorization` header is treated as no key. |
| 8 | **Admin key is INERT while `GOLDFINCH_AUTOMATION_ADMIN` is unset.** Run B was launched with the admin env **unset**, so `adminKey` was `null` (no admin key exists). Construct any plausible admin-shaped Bearer (there is no real admin key to present in this run, so use the Run-B jar `key` as a stand-in proxy and ALSO a fabricated admin-like token): `curl -s -o /dev/null -w '%{http_code}' -H 'Authorization: Bearer admin-shaped-but-no-admin-tier' http://127.0.0.1:$GOLDFINCH_MCP_PORT/mcp`. | The status is **401** — there is no admin tier to authenticate against (`mintAdminKey` returned `null` because the gate was unset, so `automationAdminKeyHash` is unset, and `validateKey` is called with `adminEnabled: false`). The admin tier **does not exist** unless the env var was set at launch. (Acceptance of a real admin key is Run C, below — a relaunch-gated variant.) |

### Run C — admin tier accepted (relaunched WITH `GOLDFINCH_AUTOMATION_DEV_MINT=1` AND `GOLDFINCH_AUTOMATION_ADMIN=1`)

| # | Actions | Expected Results |
|---|---------|------------------|
| 9 | **Relaunch with the admin gate set; capture the admin key.** Relaunch via `npm run dev:automation` with **both** `GOLDFINCH_AUTOMATION_DEV_MINT=1` and `GOLDFINCH_AUTOMATION_ADMIN=1`. Read the `{ key, adminKey }` line; record the non-null `adminKey`. | A `{ key, adminKey }` line was printed with a **non-null** `adminKey` (the admin tier now exists because the env var was set at process start). **If `adminKey` is `null`, halt — the admin env gate was not honored at launch.** |
| 10 | **Admin key accepted (env-set).** Construct the SDK client transport with `requestInit: { headers: { Authorization: \`Bearer ${adminKey}\` } }` (the captured Run-C admin key), `connect()`, then call `enumerateTabs`. | `initialize` **succeeds** and `enumerateTabs` is **NOT `isError` for auth reasons** — the admin key resolves to the `admin` identity (`validateKey` called with `adminEnabled: true` matches `automationAdminKeyHash`) and the gate admits it. This is the admin-inert-unless-env-set property's positive half: the **same** admin-key shape that was 401 in Run B (env unset) is accepted here (env set), with the only difference being the launch environment. |

## Out of Scope

- **SC7 transport / origin / host / bind half.** The 403 Origin/Host guard runs FIRST and is covered by `mcp-loopback-origin-guard` — a bad-origin request is 403 regardless of key. This spec is the **401 key half** only; every request here is loopback with no hostile Origin/Host so the origin guard passes and the auth gate is the verdict. The guard-first ordering is stated in Intent.
- **Jar confinement / cross-jar / internal-session / burner / admin-sees-all + captureWindow.** What an *accepted* identity may then see and drive (jar scoping, the admin capability tier) is the SC8 **confinement half**, covered by the sibling `mcp-jar-scoping` spec. This spec stops at the gate: "admitted vs 401", not "what the admitted key can do".
- **Audit trail (DD8).** That accepted/refused calls are recorded in the in-memory audit ring + broadcast is a separate concern (the audit-data leg / its own coverage), not asserted here.
- **Per-request live toggle-off / mid-session revoke.** The gate re-resolves identity per request, so a toggle-off or revoke 401s the next request on a live session; exercising that live mutation needs an in-app toggle path not reachable via the auto-mint apparatus, so it is **unit-backed** (`automation-auth` / the per-request gate read) rather than behavior-tested here. Stated plainly so the coverage is not over-read.

## Variants (optional)

- **Run C is itself the env-set admin variant** of Run B's Step 8 (the only difference is `GOLDFINCH_AUTOMATION_ADMIN` at launch). It is written as a numbered run rather than a separate variant because it shares the Run-B/Run-C mint apparatus and is the positive counterpart to an in-scope negative assertion.
- Could later parametrize Steps 5–7 over additional malformed `Authorization` shapes (wrong scheme `Basic …`, duplicated header, leading/trailing whitespace) once `parseBearer`'s edge handling is the focus — those edges are presently **unit-backed** by `parseBearer`'s tests.
