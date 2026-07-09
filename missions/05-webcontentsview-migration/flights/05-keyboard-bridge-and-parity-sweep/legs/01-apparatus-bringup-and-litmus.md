# Leg: apparatus-bringup-and-litmus

**Status**: completed
**Flight**: [Cross-View Keyboard Bridge & Admin-Wired Parity Sweep](../flight.md)

> **Outcome (2026-07-08): litmus GREEN.** Admin-wired instance stood up; `getChromeTarget` → numeric chrome
> wcId (admin scope honored), `enumerateTabs` → this-instance tabs only (no foreign jar). **Deviation:** default
> port 49707 is Hyper-V-reserved on this WSL2 rig (`bind()`→`EADDRINUSE` while `ss` shows it free) → pinned
> `GOLDFINCH_MCP_PORT=8899`. Full recipe + evidence in the flight log (Leg Progress / Decisions / Deviations).

## Objective
Stand up a clean, admin-wired flight-5 Goldfinch instance and **prove** the MCP client is bound to *this*
instance at admin tier — the hard gate (DD2) that must be green before any Witnessed corpus run.

## Context
- **DD2 (the F4 Leg-4 blocker).** Flight 4's convenience corpus deferred not because the apparatus didn't
  exist but because the session's MCP client was jar-authed to a *foreign, pre-existing* instance
  (`enumerateTabs` showed a stray `work`-jar tab), so admin observables (`getChromeTarget`, `captureWindow`)
  were refused against a correctly-launched instance with a valid key. This leg operationalizes the
  apparatus-**wiring** axis (act / observe / **wiring**) into an explicit litmus.
- Interactive/environment leg — no source changes. The output is a recorded launch recipe + a green litmus in
  the flight log; the gate is proven live, not by code.
- Admin tier is env-gated: the admin key matches **only** when the process is launched with
  `GOLDFINCH_AUTOMATION_ADMIN=1` **and** an admin key has been minted (`docs/mcp-automation.md` §Authentication).

## Inputs
- Flight branch `flight/05-keyboard-bridge-and-parity-sweep` checked out; plan committed.
- **No foreign Goldfinch instance** running that the client could bind to instead (operator-confirmed cleared).
- The MCP listen port free (`GOLDFINCH_MCP_PORT`, default `49707`).
- `scripts/lib/mcp-client.mjs` present (`connectAutomation` reads `GOLDFINCH_MCP_ADMIN_KEY`; `callTool`/`unwrap`).

## Outputs
- A running admin-wired flight-5 instance (dev profile, MCP surface bound on the loopback transport).
- The exact **launch recipe** recorded in the flight log for reuse by the corpus legs (and F6).
- A **green wiring litmus** recorded in the flight log: `getChromeTarget()` → this instance's chrome `wcId`;
  `enumerateTabs()` → this instance's tabs, **no foreign jar**.

## Acceptance Criteria
- [ ] The app launches admin-wired via `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation`; the `AUTOMATION_DEV_MINT {"key":…,"adminKey":…}` line prints a **non-null `adminKey`**.
- [ ] With `GOLDFINCH_MCP_ADMIN_KEY=<adminKey>`, an MCP client connects and `initialize` succeeds.
- [ ] `getChromeTarget()` returns a **numeric chrome `wcId`** (admin scope honored — NOT the `automation: admin-only` refusal).
- [ ] `enumerateTabs()` lists **this instance's** tabs only — **no foreign jar** (e.g. no stray `work`-jar tab). A fresh instance may list just its default tab(s); the check is "these are *ours*."
- [ ] Launch recipe + litmus result recorded in the flight log.

## Verification Steps
- **Port free**: confirm nothing is already listening on `$GOLDFINCH_MCP_PORT` before launch.
- **Mint line**: capture the `AUTOMATION_DEV_MINT` line from the launch stdout; confirm `adminKey` is non-null.
- **Admin litmus** (via `scripts/lib/mcp-client.mjs`): `connectAutomation()` with `GOLDFINCH_MCP_ADMIN_KEY` set →
  `callTool(client, 'getChromeTarget')` returns a numeric wcId (not `{automation:'admin-only'}`), and
  `callTool(client, 'enumerateTabs')` returns an array with no foreign-jar entry.
- **Park-on-fail**: if any check fails (admin refusal, foreign jar, no mint), the leg **parks** and the corpus
  legs do not start — record the failure mode in the flight log rather than silently pivoting (the F4 lesson).

## Implementation Guidance
Interactive — the Flight Director guides the operator one step at a time:
1. **Pre-flight**: verify the MCP port is free and no foreign Goldfinch is bound.
2. **Launch (admin-wired)**: `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 [GOLDFINCH_MCP_PORT=<port>] npm run dev:automation`; note the printed `adminKey` (and `jarKey`).
3. **Export keys**: `GOLDFINCH_MCP_ADMIN_KEY=<adminKey>` (admin/chrome), `GOLDFINCH_MCP_KEY=<jarKey>` (jar/guest).
4. **Run the litmus**: connect via `connectAutomation()` and call `getChromeTarget` + `enumerateTabs`; judge per the acceptance criteria.
5. **Record**: write the recipe + litmus result to the flight log; on green, mark the leg `completed` and proceed to Leg 2. On red, park and escalate.

## Edge Cases
- **Admin gate unset**: launching without `GOLDFINCH_AUTOMATION_ADMIN=1` mints no admin key → `getChromeTarget` 401s. Re-launch with the flag.
- **Port in use**: a stale/foreign instance holds the port → the new server can't bind or the client hits the old one. Kill the stale process (the F4 foreign-instance failure), re-launch.
- **GUI under WSLg**: the window must actually come up (native views); a headless/crashed launch fails the litmus at connect.

## Files Affected
- _(none — environment/gate leg; no source changes.)_ Records into `flight-log.md`.

---

## Post-Completion Checklist
- [ ] Litmus green (all acceptance criteria met) OR parked with failure mode recorded
- [ ] Launch recipe + litmus result appended to flight-log.md
- [ ] Set this leg's status to `completed` (gate passed) or record the park
- [ ] Check off this leg in flight.md
- [ ] (No commit yet — deferred to end-of-flight review per the agentic-workflow batch-commit model)
