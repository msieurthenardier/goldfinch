# Leg: behavior-test-specs

**Status**: completed
**Flight**: [Settings key management + automation UI](../flight.md)

## Objective
Author the `settings-automation` behavior-test spec (CDP-`:9222` apparatus, DD3) that drives the Automation settings UI built in legs 2–4 — enable toggle, live address + port config + bind-status, key generate/rotate/revoke show-once, env-gated admin controls, and the activity indicator + audit viewer — so leg 6 can run it as the flight's UI acceptance test. The existing `mcp-jar-scoping` spec is reused (not re-authored) for the cross-jar/session live run.

## Context
- **DD3**: the Flight-5 settings UI behavior test drives `goldfinch://settings` via the existing `dev:debug` + CDP-at-`:9222` apparatus (the `settings-shell`/`settings-controls` precedent). `Runtime.evaluate` against the settings guest target both **acts** (click toggle, fill port, click generate/copy/revoke) and **observes** (read the rendered address, bind-status, show-once field, jars list, indicator/viewer DOM). No test-only seam needed.
- **DD7**: also fold completing the Flight-4 `mcp-jar-scoping` full live run into leg 6 — but that spec already exists; this leg only **authors `settings-automation`**. (The `mcp-jar-scoping` stale-7777 / stale-auto-mint-prereq reconciliation is a leg-6 task, per DD7 + the flight prerequisites.)
- This is artifact authoring (a `.md` spec), not source code. The deliverable is `tests/behavior/settings-automation.md`. Spec format is canonical in `.flightops/ARTIFACTS.md` (Behavior Test — Spec) and modeled on `tests/behavior/settings-shell.md`.
- **Behavior-test mode** (mission decision): FD-driven runs with cited machine-read evidence are the accepted standard; the two-agent Witnessed pattern remains available at the operator's election for the first run. Leg 6 chooses.

## Inputs
- The Automation settings UI from legs 2–4, with these stable DOM ids (the spec asserts against them):
  - Toggle: `#automation-enabled`, helper `#automation-enabled-note`.
  - Status/address: `#automation-status`, `#automation-address`, `#automation-copy-address`.
  - Port: `#automation-port`, `#automation-port-save`, `#automation-find-port`, `#automation-port-note`, message `#automation-message`.
  - Keys: `#automation-jars` (per-jar rows with a mint button + a revoke button), `#automation-key-reveal` (hidden), `#automation-key-value`, `#automation-key-copy`.
  - Admin: `#automation-admin` (hidden unless `adminEnabled`), `#automation-admin-status`, `#automation-admin-mint`, `#automation-admin-revoke`.
  - Activity: `#automation-active-sessions`, `#automation-activity-log`.
  - Chrome indicator: `#automation-indicator`, `#automation-indicator-badge`.
- Apparatus: `npm run dev:debug` (CDP `:9222`) + `scripts/cdp-driver.mjs`; the auto-mint-to-stdout dev seam (`--automation-dev` + `GOLDFINCH_AUTOMATION_DEV_MINT=1`) for staging a live session; `tests/behavior/settings-shell.md` as the convention model.
- `tests/behavior/mcp-jar-scoping.md` — reused as-is by leg 6 (not edited here beyond leg-6's reconciliation).

## Outputs
- `tests/behavior/settings-automation.md` — a complete, runnable behavior-test spec.

## Acceptance Criteria
- [ ] **AC1** — `tests/behavior/settings-automation.md` exists and conforms to the ARTIFACTS.md Behavior-Test spec format: title, `**Slug**: settings-automation`, `**Status**: draft`, `**Created**`, `**Last Run**: never`, Intent, Preconditions, Observables Required, a Steps table (Action | Expected Result), Out of Scope, and (optional) Variants.
- [ ] **AC2** — The Intent explains why this is a behavior test (real-environment cross-process UI: a guest webview on a privileged scheme driven via CDP, the chrome-renderer indicator, a live MCP session) rather than a unit test, and names the criteria it backs (SC9 self-service key management; SC10 visible half — indicator + viewer; SC8 toggle UI).
- [ ] **AC3** — Preconditions match the CDP `:9222` apparatus (NOT the `chrome-devtools` MCP, which launches its own browser → false pass), call out the dev-mint seam for staging a live session (`--automation-dev` + `GOLDFINCH_AUTOMATION_DEV_MINT=1`, pin the port with `GOLDFINCH_MCP_PORT` for determinism), and note the admin-tier steps require `GOLDFINCH_AUTOMATION_ADMIN` set.
- [ ] **AC4** — The Steps cover, each with observable Expected Results referencing the real DOM ids: (a) probe + open settings + locate `#automation`; (b) enable toggle flips `automationEnabled` (read-back via the setting / a second observation); (c) address renders `http://127.0.0.1:{port}/mcp` and `#automation-status` reflects bind reality; (d) port field shows the pending `automationPort`, an out-of-range value shows the inline error and does not persist, a valid value saves, "find free port" populates + saves; (e) a per-jar **Generate** shows the one-time key in `#automation-key-reveal` + Copy works, the jar row flips to "key set"; **Rotate** replaces it; **Revoke** clears the row to "no key"; (f) the show-once key is NOT re-fetchable (after refresh the reveal is empty); (g) admin block hidden without the env gate, present with it (generate/rotate/revoke + show-once); (h) with a live session staged, `#automation-indicator` shows + names the jar (and distinguishes admin) and `#automation-active-sessions` lists it + `#automation-activity-log` shows actions; empty-state when no session.
- [ ] **AC5** — Steps use the row conventions (multi-action/multi-expectation rows allowed; setup rows with empty Expected; `[a11y]` markers where relevant). Live-session steps (h) are written so they can degrade to `partial` if staging a session isn't possible in the run environment, with a note that the cross-jar/admin/burner session matrix is covered by `mcp-jar-scoping` (leg 6) — `settings-automation` need not duplicate it.
- [ ] **AC6** — Out of Scope names what this spec does NOT verify: the MCP transport/auth internals (covered by `mcp-auth-gating`/`mcp-loopback-origin-guard`), the cross-jar scoping matrix (`mcp-jar-scoping`), and live-rebind on port change (next-launch by design). Links the related specs.
- [ ] **AC7** — The spec is internally consistent (no hardcoded port — uses `{port}`/`GOLDFINCH_MCP_PORT`; host always `127.0.0.1`) and references only DOM ids that actually exist in the leg-2–4 implementation (verified in design review against `settings.html`/`settings.js`/`index.html`).

## Verification Steps
- AC1–AC7: read-through + the design-review cross-check against the implemented `settings.html`/`settings.js`/`renderer.js`/`index.html` ids. (The spec is *run* in leg 6; this leg only authors it.)
- `grep -n "7777" tests/behavior/settings-automation.md` returns nothing (no hardcoded port).

## Implementation Guidance
1. Model the file on `tests/behavior/settings-shell.md` (same headings, same row style, same precondition framing).
2. Status `draft`, Last Run `never` (first run is leg 6, which flips it).
3. Keep each step's Expected Result an **observable** (a DOM value read via CDP, a setting read-back, a screenshot/a11y read) — not an internal assertion.
4. For the live-session steps, describe staging via the dev-mint seam + a loopback MCP `initialize` (or the Flight-3 example client) using the minted Bearer at the pinned port; mark them degradable to `partial`.
5. Do NOT edit `mcp-jar-scoping.md` here (leg 6 reconciles it).

## Edge Cases
- **Live session cannot be staged in the run environment** → steps (h) record `partial`/`inconclusive` with a note pointing at `mcp-jar-scoping`; the UI-only steps (a–g) still fully verify SC9 + SC8 + the empty-state of SC10's viewer.
- **Admin env gate unset during the run** → the admin steps (g) verify the block is *hidden* (the negative case); the positive admin path is exercised when `GOLDFINCH_AUTOMATION_ADMIN` is set (leg-6 run launches with it for the admin matrix).
- **Port pinned** via `GOLDFINCH_MCP_PORT` for the run so the rendered address is deterministic regardless of the new default.

## Files Affected
- `tests/behavior/settings-automation.md` — new behavior-test spec (the sole deliverable).

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] Spec authored and design-reviewed for selector accuracy
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `landed` (commit deferred to Phase 2d)
- [ ] Do NOT check off the leg in flight.md (deferred to batched commit)
- [ ] Do NOT commit per-leg
