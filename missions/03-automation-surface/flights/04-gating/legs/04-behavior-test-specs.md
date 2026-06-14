# Leg: behavior-test-specs

**Status**: completed
**Flight**: [Gating — opt-in + key auth + audit](../flight.md)

## Objective
Author two behavior-test specs — `mcp-auth-gating` (SC8 auth gate: off-by-default, opt-in, valid-key-accepted, missing/wrong-key/empty-Bearer rejected, admin inert unless env-set) and `mcp-jar-scoping` (SC8 confinement: a jar key enumerates/drives only its jar; cross-jar / internal / burner refused; scoping authority is the resolved session; an env-set admin key sees all jars + the internal tab + `captureWindow`) — matching the in-house Flight-3 spec style. **Specs only — they are RUN in the next leg (`verify-integration`).** Authoring docs, not code.

## Context
- **DD10** — behavior tests are the SC8 acceptance; author `mcp-auth-gating` + `mcp-jar-scoping` this flight, run them in `verify-integration`. SC8 is a real-environment security property across the transport + engine — the Witnessed apparatus is the right gate.
- **FD scope decision (Leg 02, flight-log):** "admin sees all + the chrome" for THIS flight = admin enumerates all jars' guest tabs + the internal `goldfinch://settings` tab, can drive/observe any of them, and `captureWindow` (whole-window composite, which *includes* the chrome). It does **NOT** mean driving the chrome renderer (`mainWindow.webContents`) — its wcId is structurally undiscoverable via `listTabs()` (deferred to Flight 6). **The `mcp-jar-scoping` admin assertion MUST be written to this re-scoped capability, or it is unsatisfiable.**
- **In-house style (match it):** see `tests/behavior/mcp-loopback-origin-guard.md` and `tests/behavior/mcp-drive-end-to-end.md` (both Flight 3). Required sections per `.flightops/ARTIFACTS.md`: Intent (with paradigm justification), Preconditions (operator-checkable), Observables Required (with apparatus per observable), Steps (Zephyr two-column Action | Expected Result; an **Active-precondition probe** as Step 1 that halts if unmet), Out of Scope, Variants. Use **scope-honesty caveats** where coverage is partial and `[mixed-frame]` markers where an action's observable lives in a different frame than its verdict — exactly as the Flight-3 specs do.

### Codebase ground truth (verified 2026-06-14)
- Apparatus baseline (from Flight-3 specs): app launched via **`npm run dev:automation`** (`electron . --no-sandbox --automation-dev`; NO `--remote-debugging-port`); MCP server on **`127.0.0.1:7777/mcp`**; MCP client = the SDK client / `scripts/mcp-example-client.mjs` / a Claude Code MCP session. The `chrome-devtools` MCP is **disqualified** (launches its own browser → false pass).
- **NEW gating substrate (this flight, landed/uncommitted):** the surface is **off by default** (`automationEnabled=false`) and **key-gated** (`Authorization: Bearer <key>`). Keys are per-jar (`automationKeyHashes`) + an env-gated admin key (`automationAdminKeyHash`, requires `GOLDFINCH_AUTOMATION_ADMIN`). The dev **enable+mint** path is the `automation:dev-enable-mint` IPC (gated on `isMcpAutomationEnabled(process.argv)`), returning plaintext key(s) once via the IPC return value (`{ key, adminKey }`). Jar-scoping refuses cross-jar wcIds (`automation: out-of-jar`), the internal session (`automation: internal-session`), burner tabs (not enumerable / not drivable), and `captureWindow` for jar keys (`automation: admin-only`).
- **Apparatus GAP — RESOLVED mechanism (design-review confirmed, FD decision):** the enable+mint IPC (`automation:dev-enable-mint`) is **genuinely unreachable** by any external harness today — it's `ipcMain.handle` locked to `mainWindow.webContents`, no preload bridge wrapper exposes it, and the chrome renderer runs `contextIsolation:true`/`nodeIntegration:false` (so even a DevTools console can't invoke it). An external HTTP MCP client never touches the IPC bus, and a standalone `scripts/*.mjs` can't reach a running app's IPC. **Mechanism decided: an env-gated auto-mint-to-stdout in `main.js`** — at startup, gated on `isMcpAutomationEnabled(process.argv)` **AND a NEW env var `GOLDFINCH_AUTOMATION_DEV_MINT=1`** (distinct from `--automation-dev` so the off-state is still observable in a no-mint launch), mint a jar key (and the admin key when `GOLDFINCH_AUTOMATION_ADMIN` is set), flip `automationEnabled=true`, and **print `{ key, adminKey }` once to stdout**. The Executor captures the printed key at launch and presents it as `Authorization: Bearer`. **This helper is a CODE change → it is NOT built in this leg (specs only). It is a flagged `verify-integration` prerequisite** (build the auto-mint-to-stdout there, then run the specs). Both specs' preconditions name this mechanism precisely.
- Jars: persistent jars are `default`/`personal`/`work`/`banking` (`jars.js`); burner jars are renderer-only (`burner:N`). Staging multi-jar tabs is done via the Goldfinch UI's jar/container switcher (real-environment setup step).

## Inputs
- `key-model-and-gate`, `jar-scoping-and-admin`, `audit-data` landed (the gate, scoping, admin tier, refusal codes all exist).
- The Flight-3 specs as style templates.

## Outputs
- `tests/behavior/mcp-auth-gating.md` — new spec.
- `tests/behavior/mcp-jar-scoping.md` — new spec.
- (If needed) a documented note in each spec's Preconditions naming the enable/mint apparatus, and — if a helper is required — a flagged prerequisite for `verify-integration`.

## Acceptance Criteria
- [x] **`tests/behavior/mcp-auth-gating.md`** exists, status `draft` (per the ARTIFACTS spec lifecycle; `verify-integration` flips it to `active` on first green run, or the author sets `active` if house convention — match the Flight-3 specs, which are `active`). Conforms to the ARTIFACTS spec format (all required sections). Steps cover, each as an observable HTTP/MCP result:
  - **Off-by-default (Run A — launched WITHOUT the mint env, surface stays off):** a request bearing a fabricated Bearer → **401** (the surface does nothing until opted in). Because the auto-mint helper flips `automationEnabled=true` at boot, off-by-default and accepted-after-enable **cannot** be witnessed in one run — structure as **two runs / a variant**: Run A (no mint env) observes the 401-while-disabled; Run B (mint env set) observes acceptance.
  - **Opt-in + valid jar key accepted (Run B — launched WITH the mint env):** an MCP client presenting the minted jar key (captured from stdout) as `Authorization: Bearer <key>` on the client transport completes `initialize` and a benign tool call (e.g. `enumerateTabs`) succeeds (not 401, not `isError` for auth reasons).
  - **Missing key → 401**, **wrong/garbage key → 401**, **empty `Authorization: Bearer ` (no token) → 401**.
  - **Admin inert unless env-set:** with `GOLDFINCH_AUTOMATION_ADMIN` **unset**, presenting the admin key → **401** (the admin tier does not exist); a Variant or paired run with the env **set** shows the admin key accepted. (Note the env toggle requires an app relaunch — structure the spec so this is an operator-checkable precondition/variant, not a mid-run mutation.)
  - **Composition with the origin guard (note, not necessarily a step):** the 403 origin guard runs FIRST; a bad-origin request is 403 regardless of key (covered by `mcp-loopback-origin-guard`); this spec is the **401 key half**. State the guard-first ordering in Intent/Out-of-Scope.
- [x] **`tests/behavior/mcp-jar-scoping.md`** exists, conforms to the format. Steps cover:
  - **Setup:** stage tabs in ≥2 persistent jars (e.g. `personal` + `work`) and (for the burner assertion) one burner tab, plus the internal `goldfinch://settings` tab open. (Real-environment setup via the UI; a setup row with no judgment per the ARTIFACTS row conventions.)
  - **Jar key enumerates only its jar:** a `personal` jar key's `enumerateTabs` lists only `personal` tabs — not `work`, not burner, not internal.
  - **Cross-jar drive refused:** the `personal` key targeting a `work` tab's wcId → `isError` `automation: out-of-jar`.
  - **Internal-session refused for jar keys:** the `personal` key targeting the internal settings tab's wcId → `automation: internal-session` (absolute for jar keys).
  - **Burner unautomatable:** a burner tab is absent from the jar key's enumerate and refused on drive.
  - **Scoping authority is the resolved session, not the renderer `jarId`:** assert this is the property under test in Intent; if it cannot be staged live (forcing a renderer-jarId/session mismatch needs instrumentation), add a **scope-honesty caveat** stating it is **unit-backed** (the Leg-2 unit tests cover the spoof both directions) and the behavior test covers the observable confinement. Do not over-claim.
  - **Admin (env-set) sees all + internal + captureWindow:** with `GOLDFINCH_AUTOMATION_ADMIN` set and the admin key, `enumerateTabs` lists **at minimum every persistent jar's tabs + the internal `goldfinch://settings` tab**; a drive/observe on a tab in any jar and on the internal tab succeeds; `captureWindow` returns an image. A **jar key's** `captureWindow` → `automation: admin-only`. (Per the FD scope decision: NOT "drives the chrome renderer".) **Phrase admin enumerate positively ("at minimum …"); do NOT assert a negative for admin (admin's engine has `allowInternal:true`, so it also sees burners — confine the burner-exclusion assertion to the JAR-KEY rows, where it holds).** The admin run is a **second relaunch** (env-gated) — two specs total per DD10, so `mcp-jar-scoping` carries both the jar-key and admin runs as relaunch-gated variants.
  - Use `[mixed-frame]` where a refusal verdict (MCP `isError`) is paired with a no-side-effect cross-check, mirroring `mcp-loopback-origin-guard` Step 7.
- [x] **Preconditions are genuinely operator-checkable** — both specs name the exact enable/mint apparatus (resolving the GAP above) and the env-var relaunch requirement for the admin runs. No hand-waved "assume a key exists."
- [x] **No source changes** — this leg authors **markdown specs only**. (Any helper script the apparatus needs is flagged as a `verify-integration` prerequisite, not built here, unless trivial and clearly test-only — prefer flagging.)
- [x] **Specs lint/parse** — they render as valid markdown and follow the two-column table shape; `npm run lint`/`typecheck` unaffected (no code). Sanity-check by reading against the ARTIFACTS format.

## Verification Steps
- Read both specs against `.flightops/ARTIFACTS.md` "Behavior Test — Spec" format and the two Flight-3 specs — every required section present, steps are operator-performable, expected results are observable.
- Confirm the admin assertion matches the FD re-scope (sees-all + internal + captureWindow, not drives-chrome).
- Confirm the enable/mint precondition is concrete and reachable (or a `verify-integration` prerequisite is explicitly flagged).

## Implementation Guidance
1. Pattern-match `mcp-loopback-origin-guard.md` (security/refusal style, scope-honesty, `[mixed-frame]`) and `mcp-drive-end-to-end.md` (MCP-client apparatus, Active-precondition probe) closely.
2. Resolve the enable/mint apparatus first (read Leg-1's `automation:dev-enable-mint` + `scripts/`); write the precondition to the real mechanism. If a helper is needed, flag it for `verify-integration` (don't build it here).
3. For `mcp-auth-gating`, lead with an Active-precondition probe (server up on 7777; surface confirmed OFF before enable). Order the steps so the off-by-default 401 is observed **before** the enable step.
4. For `mcp-jar-scoping`, the multi-jar + internal + burner setup is a real-environment setup row; the assertions are MCP-client observations. Keep the admin-env runs as a relaunch-gated precondition/variant.
5. Be scope-honest about anything not stageable live (the session-vs-jarId spoof) — cite the Leg-2 unit coverage.

## Edge Cases
- **Env-var relaunch:** `GOLDFINCH_AUTOMATION_ADMIN` is read at process start; admin-on vs admin-off are **separate runs / a variant**, not a mid-run toggle. The spec must not pretend to flip it live.
- **Off-by-default must be observed pre-enable:** once the dev mint flips `automationEnabled=true`, the off-state is gone for that run — observe the 401-while-disabled before enabling (or in a separate run).
- **Burner staging:** burners are ephemeral; the setup must create one and note it won't survive a relaunch.
- **Key show-once:** the minted plaintext is returned once; the spec must capture it at mint time for the Bearer header.

## Files Affected
- `tests/behavior/mcp-auth-gating.md` — new.
- `tests/behavior/mcp-jar-scoping.md` — new.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing (N/A — no code; specs parse/read correctly)
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `completed` (in this file's header)
- [ ] Check off this leg in flight.md
- [ ] If final leg of flight: (not final)
  - [ ] Update flight.md status to `landed`
  - [ ] Check off flight in mission.md
- [ ] Commit all changes together (code + artifacts)

> **Orchestration note:** Under `/agentic-workflow`, the Developer does NOT commit and does NOT signal `[COMPLETE:leg]`. Author the specs, update the flight log, set status to `landed`, signal `[HANDOFF:review-needed]`. Review + commit are batched at flight end.
