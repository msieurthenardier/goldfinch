# Leg: verify-integration

**Status**: completed
**Flight**: [Settings key management + automation UI](../flight.md)

## Objective
Verify the flight end to end and reconcile the moved default port: run the `settings-automation` behavior test (CDP), complete the `mcp-jar-scoping` full live run (flip it from `partial` → pass), reconcile the stale `7777` + stale "auto-mint not-yet-built" references in the scoped docs/specs, and confirm the full static gate suite is green. (DD7)

## Context
- **DD7**: run `settings-automation` (the leg-5 spec, CDP `:9222`); complete the Flight-4 `mcp-jar-scoping` full live run — the new jars UI is the apparatus that finally lets the operator stage tabs across jars + a burner + the settings tab, so the cross-jar/internal/burner refusals become stageable live (flips that run log from `partial` → pass). Pin the port with `GOLDFINCH_MCP_PORT` for the run so the client URL is deterministic regardless of the new default.
- **Stale-spec reconciliation (HIGH, DD7 + prerequisites)**: `mcp-jar-scoping.md` and `mcp-auth-gating.md` (a) frame the auto-mint-to-stdout as a not-yet-built `verify-integration` prerequisite — it **landed in F4**, so that wording is stale; and (b) hardcode `http://127.0.0.1:7777/mcp` — reconcile to the pinned `GOLDFINCH_MCP_PORT` / the new default `49707`. Reconcile **before** running `mcp-jar-scoping`.
- This leg is FD-orchestrated verification + a deterministic doc/spec reconciliation. The reconciliation + static gates are mechanical (a Developer does them); the live runs are FD-driven (mission behavior-test mode: FD-driven with cited machine-read evidence) and require the GUI/CDP apparatus + operator tab-staging.

## Scope of the 7777 reconciliation
**Reconcile to the new default `49707` (and note `GOLDFINCH_MCP_PORT` pins runs):**
- `docs/mcp-automation.md` — Default URL, port-override default, the `/mcp` example, the `.mcp.json` snippet. **Also add the Flight-5 Settings controls** (the opt-in toggle, configurable port + live address display + bind-status, the connect hint) — this is the flight's doc deliverable.
- `CLAUDE.md` — the automation-section "default port 7777".
- `README.md` — the `127.0.0.1:7777` mention.
- `scripts/mcp-example-client.mjs` — the `|| 7777` default.
- `tests/behavior/mcp-auth-gating.md` + `tests/behavior/mcp-jar-scoping.md` — the hardcoded `7777` URLs **and** the stale "auto-mint helper … does NOT exist yet / to be built in the next leg (`verify-integration`)" notes (the apparatus landed in F4 — restate as present/landed).

**Leave as-is (out of scope / not the default):**
- `test/unit/automation-origin-guard.test.js` — `7777` is a port-agnostic loopback sample for the guard logic, not the bind default; changing it is pure churn.
- `src/main/automation/origin-guard.js` comments — illustrative port-stripping examples (port-agnostic).
- `test/unit/automation-mcp-server.test.js:13` — a stale "dev instance on 7777" comment; OPTIONAL trivial fix to `49707` (allowed, not required).
- The other F1–F3 behavior specs (`foreground-to-act`, `observe-refusal-contract`, `internal-session-exclusion`, `devtools-cdp-conflict`, `mcp-drive-end-to-end`, `mcp-loopback-origin-guard`) still reference `7777`; **deferred to Flight 6** (the spec-migration flight that moves them all onto the new surface). Recorded, not silently skipped.
- `.mcp.json` — the standing `goldfinch` `:7777` http entry was already removed in the working tree. **Keep it removed**: the surface is off-by-default (no server to reach in a normal session), so a standing entry produces perpetual failed connection attempts. The Settings UI + `docs/mcp-automation.md` now show the live address + a copy + a `.mcp.json` snippet (at `49707`) for a consumer that opts in. Document this in the docs.

## Acceptance Criteria
- [ ] **AC1** — `docs/mcp-automation.md`, `CLAUDE.md`, `README.md`, and `scripts/mcp-example-client.mjs` show the new default `49707` (no stale `7777` as "the default"); `docs/mcp-automation.md` additionally documents the Flight-5 Settings controls (toggle, configurable port + live address + bind-status, connect hint) and the `.mcp.json` snippet at `49707`.
- [ ] **AC2** — `tests/behavior/mcp-auth-gating.md` + `mcp-jar-scoping.md`: the stale "auto-mint … does NOT exist yet / to be built in `verify-integration`" wording is corrected to reflect that the auto-mint-to-stdout apparatus **landed in F4** (present, not a prerequisite); the hardcoded `7777` URLs are reconciled to the pinned `GOLDFINCH_MCP_PORT` (with the new default noted). No behavioral step semantics changed — only the apparatus framing + the port.
- [ ] **AC3** — Static gates green: `npm test` (full unit suite), `npm run typecheck`, `npm run lint`.
- [ ] **AC4** — `settings-automation` behavior test run (CDP `:9222`): the UI control steps (toggle, address/port/bind-status, key generate/rotate/revoke show-once, admin gating) pass; a run log is written at `tests/behavior/settings-automation/runs/{ts}.md`; the spec's `Last Run`/`Status` are updated. Live-session steps may record `partial` if a session can't be staged (deferred to `mcp-jar-scoping`).
- [ ] **AC5** — `mcp-jar-scoping` full live run completed (the new jars UI stages the cross-jar/burner/internal/settings tabs): the cross-jar `out-of-jar`, internal `internal-session`, burner-unautomatable, and admin-sees-all refusals are exercised live; the F4 `partial` run is flipped to a `pass` run log. (If the operator accepts any residual as a known issue, record the disposition in the run log + flight log per the skill.)
- [ ] **AC6** — The reconciliation + run logs are committed (a fresh commit, no amend of the legs-1–5 commit), and the flight log records the run outcomes + the reconciliation.

## Verification Steps
- AC1/AC2: `grep -rn "7777" docs/mcp-automation.md CLAUDE.md README.md scripts/mcp-example-client.mjs tests/behavior/mcp-auth-gating.md tests/behavior/mcp-jar-scoping.md` shows only intentional/contextual mentions (new default `49707` present); the stale "does NOT exist yet" notes are gone from the two specs.
- AC3: `npm test && npm run typecheck && npm run lint` clean.
- AC4/AC5: the run logs under `tests/behavior/{slug}/runs/` with cited machine-read evidence; verdicts recorded.

## Implementation Guidance
1. **Reconciliation first** (deterministic, before the runs): a Developer edits the scoped docs/specs per AC1/AC2. Keep behavioral step semantics intact in the specs — change only the apparatus framing (auto-mint landed) and the port references. Re-run the static gates (AC3).
2. **Then the live runs** (FD-driven): pin `GOLDFINCH_MCP_PORT` for determinism. Run `settings-automation` via the CDP `:9222` apparatus; stage a live session via the dev auto-mint seam for the indicator/viewer steps where possible. Run `mcp-jar-scoping` with the operator staging tabs across `personal`/`work` + a burner + the settings tab via the new jars UI. Write run logs; cite machine-read evidence (evidence dir is ephemeral, outside the tree, per ARTIFACTS.md).
3. **Commit** the reconciliation + run logs as a new commit (no amend).

## Edge Cases
- **Live session / cross-jar staging not possible in the run environment** → `settings-automation` records the live-session steps `partial` (UI steps still pass); `mcp-jar-scoping` halts per its own precondition gates. The operator decides disposition (accept-as-known-issue vs block) — recorded in the run log + flight log per the skill's behavior-test-as-acceptance rule.
- **A failing behavior test is an unmet acceptance criterion** → the leg does not land while a test fails unless the operator explicitly accepts the failure as a known issue (disposition recorded).

## Files Affected
- `docs/mcp-automation.md`, `CLAUDE.md`, `README.md`, `scripts/mcp-example-client.mjs` — 7777 → 49707 + Flight-5 controls doc.
- `tests/behavior/mcp-auth-gating.md`, `tests/behavior/mcp-jar-scoping.md` — stale-prereq + port reconciliation.
- `tests/behavior/settings-automation.md` — `Last Run`/`Status` after the run.
- `tests/behavior/settings-automation/runs/{ts}.md`, `tests/behavior/mcp-jar-scoping/runs/{ts}.md` — run logs.

---

## Post-Completion Checklist

- [ ] Reconciliation done; static gates green
- [ ] `settings-automation` run (run log + verdict)
- [ ] `mcp-jar-scoping` full live run (flips `partial` → pass; run log)
- [ ] Update flight-log.md with run outcomes + reconciliation
- [ ] Set this leg's status to `completed`
- [ ] Check off `verify-integration` in flight.md
- [ ] Commit (fresh commit, no amend)
