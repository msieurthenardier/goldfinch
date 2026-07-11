# Behavior Test: Deleting a keyed jar revokes its automation key live

**Slug**: `jar-key-revocation-on-delete`
**Status**: active
**Created**: 2026-07-11
**Last Run**: 2026-07-11-05-12-54 (pass 5/5 — first run; delete→revocation→401 chain live-witnessed with rename positive control and an in-run 401-vs-404 negative control)

## Intent

Verify the automation stakeholder's degradation guarantee end to end: when a jar
that holds a minted automation key is **deleted**, the key stops being admitted —
the next request on a previously-working live MCP session is rejected at the
auth layer (HTTP 401), and a fresh connect with the same key is rejected too.
Conversely, **rename does not degrade** the key (identity is bound to the jar
id/partition, which rename never mutates) — the same live session keeps working
across a rename, so the test can tell "revoked by delete" from "any lifecycle
change kills sessions."

This needs a behavior test rather than a unit test because the property under
test is the composition across live components: `handleRemove`'s delete
composition calls `revokeJarKey` (unit-backed), the revocation persists to
settings, and the HTTP layer's **per-request re-validation** — which
deliberately does NOT tear down live sessions (the sessions Map is untouched;
see mcp-server.js's revokeJarKey notes) — must reject the very next request on
a transport that was mid-conversation when the jar died. That "admitted →
mutated by a real user path → next request 401s" sequence only exists in the
running app. The mission's own Open Questions named this scenario; both
`jar-delete-closes-tabs` and `jar-data-controls` list it Out of Scope.

**Scope honesty**: the jar is deleted via the chrome apparatus calling
`window.goldfinch.jarsRemove` — the same composition the management page's
delete button invokes (the page's confirm UI itself is HAT-verified, F3/F4, and
the page DOM is not automatable by design). This spec verifies the
delete→revocation→401 chain, not the page's button.

## Preconditions

- **FRESH SCRATCH STAGE (destructive test — load-bearing safety rule)**: this
  spec DELETES the `personal` jar. Launch against a scratch
  `--user-data-dir` (the Flight-4 fresh-stage convention), NEVER the
  operator's real profile. A fresh stage also guarantees the seeded
  `personal`/`work` registry and `personal` holding the default flag.
- **Mint apparatus (EXISTS — same as `mcp-jar-scoping`/`mcp-auth-gating`)**:
  launch via `npm run dev:automation` with **both** `GOLDFINCH_AUTOMATION_DEV_MINT=1`
  and `GOLDFINCH_AUTOMATION_ADMIN=1` (both keys mint in the same launch —
  main.js prints `{ key, adminKey }` once to stdout, `AUTOMATION_DEV_MINT`-prefixed).
  `key` is the **resolved-default jar's** key (the identity under test);
  `adminKey` drives the chrome apparatus (design-review correction:
  `getChromeTarget`/`evaluate` are **admin-only** — scope.js:168 throws
  `automation: admin-only` for jar identities, and `jar-delete-closes-tabs`'s
  own precondition requires the admin key for exactly this reason). The admin
  key is APPARATUS here, never an assertion target.
- **Verify (or set) the default flag before launch (load-bearing)**: the mint
  targets the resolved-default jar, and this spec deletes that jar. Confirm
  `personal` holds the flag (set via `jarsSetDefault` if a prior run moved it).
  Deleting `personal` mid-test moves the flag per the store invariant — expected
  and harmless here (`work` or Burner inherits; not asserted).
- **Port pinned**: `GOLDFINCH_MCP_PORT` exported once (default `49707`); every
  URL below uses it.
- **Client attach**: SDK client (`StreamableHTTPClientTransport` to
  `http://127.0.0.1:$GOLDFINCH_MCP_PORT/mcp`) with
  `Authorization: Bearer <key>` via `requestInit.headers` (the
  `connectClient(key)` pattern). `curl` available for raw-status probes.
- **Chrome apparatus**: the goldfinch MCP's `getChromeTarget` + `evaluate`
  calling the `window.goldfinch.jars*` preload wrappers (the
  `jar-delete-closes-tabs` staging pattern) for rename/delete mutations —
  driven with the **admin** Bearer (admin-only ops; see Mint apparatus above).
  Keep the two identities on separate client transports: jar `key` for the
  session under test, `adminKey` for mutations.
- **Staged tab**: at least one web tab open in the `personal` jar (a fresh
  stage's boot tab qualifies) so enumerate has something to list.
- **Idle-session pruning hazard (first-run learning)**: the server prunes idle
  StreamableHTTP sessions. The fixture is "the same live session across five
  steps" — keep inter-step latency low, and hold the live transports in a
  long-lived daemon process (the proven pattern: per-step calls reach the
  daemon over a local control port while the MCP sessions live on in-process;
  session continuity is then verifiable via stable `mcp-session-id`s). An
  apparatus-side admin session lost to pruning is repairable by reconnecting
  (admin is apparatus-only); losing the JAR-KEY fixture session mid-run makes
  step 4's SDK half ambiguous (see step 4's rejection-shape note).
- **Apparatus disqualification**: `chrome-devtools` MCP does NOT qualify
  (launches its own browser). Not the `:9222` CDP path.

## Observables Required

- mcp (tool results over the loopback transport — `enumerateTabs` arrays on the
  live session; measured via the SDK client with the Bearer header)
- http (raw response status on the revoked key — measured via `curl` POST to
  `/mcp`; the 401 is an HTTP-layer observable, distinct from an admitted
  request's in-band `isError`)
- browser (chrome-apparatus mutations: `jarsRename`/`jarsRemove` results, and
  the staged tab — measured via the goldfinch MCP chrome target)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **Setup + admitted-identity probe.** Launch via `npm run dev:automation` with `GOLDFINCH_AUTOMATION_DEV_MINT=1` AND `GOLDFINCH_AUTOMATION_ADMIN=1`, `GOLDFINCH_MCP_PORT` pinned; capture the printed `key` and `adminKey`. Stage one `personal` web tab via the UI. Connect the SDK client with `Authorization: Bearer <key>` (the JAR key); `initialize`; call `enumerateTabs`. Connect a SECOND client with the `adminKey` (apparatus only). | Both keys were printed (non-null). The jar-key `initialize` succeeds and `enumerateTabs` returns an array listing the staged `personal` tab; the admin client connects. **Halt if any of these fail — preconditions not met.** The jar-key live session is the fixture every later step measures against. |
| 2 | **Rename does NOT degrade the key (positive control).** Via the ADMIN client's chrome apparatus (`getChromeTarget` + `evaluate`), call `window.goldfinch.jarsRename({ id: 'personal', name: 'Keyed Jar' })`. Then, on the SAME jar-key live session from step 1 (no reconnect), call `enumerateTabs` again. | The rename resolves with the **updated container record** (`{ id, name, color, partition }` — name changed, id/partition unchanged; first-run correction: the API returns the record, not an `ok` envelope — the unchanged id/partition is itself the mechanism evidence). The jar-key session's `enumerateTabs` still **succeeds**, same staged tab listed (key identity rides the jar id/partition, which rename never mutates — no revocation, no session teardown). This pins that the step-4 rejection is caused by DELETE specifically, not by any jar mutation. |
| 3 | **Delete the keyed jar (the real user-path composition).** Via the ADMIN client's chrome apparatus, call `window.goldfinch.jarsRemove({ id: 'personal' })`. | The remove resolves `{ ok: true, wiped: true, ... }` (the delete composition ran: wipe + revoke + broadcast — `handleRemove` calls `revokeJarKey` in the same synchronous handler). The staged `personal` tab closes (the F3 orphan sweep — already pinned by `jar-delete-closes-tabs`, observed here only as context, not judged). |
| 4 | **[mixed-frame] Next request on the live session is rejected at the auth layer.** On the SAME live session from step 1, call `enumerateTabs`. Additionally probe the raw status: `curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:$GOLDFINCH_MCP_PORT/mcp -H "Authorization: Bearer <key>" -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":99,"method":"tools/list"}'`. | The live session's call **fails at the transport/auth layer** (the SDK surfaces an error; it is NOT an admitted in-band `isError` result with an `automation: <code>` — admission itself is refused). The curl probe returns **`401`**. **Rejection shape note (first-run learning)**: the auth rejection is HTTP **401 with an EMPTY body** — explicitly distinct from the server's session-routing rejection (HTTP 404 with a JSON-RPC `-32000` "No valid session" body), which is what an idle-pruned session under a still-VALID key draws. If the SDK failure surfaces as the 404 shape, that is the pruning confound, not revocation — rerun with tighter step pacing. (The auth gate is pre-routing — `resolveIdentity` runs before session lookup — so a revoked key 401s even on a pruned session; the session-independent curl probe disambiguates regardless.) Per-request re-validation rejected a session that was working two steps ago — the revocation is live, with no app restart and no session teardown needed. `[mixed-frame]` — justification: the SDK error proves the live-session experience; the raw `401` pins WHERE it was rejected (auth layer, not tool layer) — the distinction is the property under test. |
| 5 | **Fresh connect with the revoked key is refused.** Build a NEW SDK client/transport with the same `Bearer <key>`; attempt `initialize`. | `initialize` **fails** (transport-level auth rejection; 401). The revoked key admits nothing — neither surviving sessions (step 4) nor new ones. |

## Out of Scope

- **The management page's delete-confirm UI** — HAT-verified (F3 step 5, F4 step 6); page DOM is not automatable by design (F4 DD9).
- **Tab-closure on delete** — pinned by `jar-delete-closes-tabs` (5/5, twice); observed in step 3 as context only.
- **Key minting/gating UX** — `automation-key-gating` and `mcp-auth-gating` own the toggle/mint/revoke-button surfaces and the general auth gate.
- **Admin-key degradation** — the admin key IS staged (it drives the chrome apparatus) but is never an assertion target: it is not jar-bound, so jar deletion has nothing to degrade on it. Its continued function after step 3 is incidental apparatus health, not a judged expectation.
- **Audit-ring recording of the 401s** — separate concern (audit legs).

## Variants (optional)

- Could later add a mid-session **manual revoke** (settings-page Revoke button)
  variant asserting the same 401-next-request semantics — same re-validation
  path; deferred until a flight touches that surface.
