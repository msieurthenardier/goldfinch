# Leg: verify-integration

**Status**: completed
**Flight**: [Gating — opt-in + key auth + audit](../flight.md)

## Objective
Live acceptance for the auth core: build the `verify-integration` prerequisite (the env-gated auto-mint-to-stdout dev affordance), confirm the full headless gate suite is green, then run the two SC8 behavior tests (`mcp-auth-gating`, `mcp-jar-scoping`) and confirm the load-bearing refusals (bad-key, cross-jar, internal-session, burner, non-loopback) and revoke/toggle-off-kills-live-session.

## Context
- **DD10** — the two behavior tests are the SC8 acceptance; they **run** in this leg. The mission's accepted standard (M02 debrief) is **FD-driven runs with cited machine-read evidence**; the two-agent Witnessed pattern is available at the operator's election for high-stakes specs (SC8 qualifies).
- **Prerequisite (from Leg 04 design review):** the dev enable+mint IPC is unreachable by an external harness. This leg **builds** the env-gated **auto-mint-to-stdout** affordance in `main.js` (gated on `isMcpAutomationEnabled(process.argv)` + `GOLDFINCH_AUTOMATION_DEV_MINT=1`; calls the landed `enableAndMintJarKey`/`mintAdminKey`; flips `automationEnabled`; prints `{ key, adminKey }` once to stdout) so the specs are runnable.
- All prior legs landed; the headless suite already covers the auth/scoping/admin/revoke properties at unit+integration level (571+ tests). This leg adds the **live** real-environment confirmation across the transport + GUI.

## Inputs
- Legs 1–4 landed (gate, scoping, admin, audit, the two specs).
- A GUI display (WSLg `DISPLAY=:0`), `scripts/mcp-example-client.mjs`, `curl`, the MCP SDK.

## Outputs
- `src/main/main.js` — the auto-mint-to-stdout affordance (the only code change this leg).
- A unit test for the auto-mint gating (only fires under both gates) if cleanly testable.
- Behavior-test run logs at `tests/behavior/{slug}/runs/{ts}.md` (committed); evidence at the ephemeral `/tmp/behavior-tests/goldfinch/...` (never committed).
- Updated spec `Last Run` stamps.
- Flight-log entry with results + evidence paths.

## Acceptance Criteria
- [ ] **Auto-mint affordance built** — `main.js` prints `{ key, adminKey }` once to stdout at startup **only** when `isMcpAutomationEnabled(process.argv)` AND `GOLDFINCH_AUTOMATION_DEV_MINT=1`; mints the admin key only when `GOLDFINCH_AUTOMATION_ADMIN` is also set; flips `automationEnabled=true`. Inert otherwise (no print, no enable) — so a plain `dev:automation` launch still observes off-by-default. Reuses the landed `enableAndMintJarKey`/`mintAdminKey`.
- [ ] **Full headless gates green** — `npm test` (all unit + integration, incl. the auth/scoping/admin/audit/revoke suites), `npm run typecheck`, `npm run lint` all clean. Paste the summary.
- [ ] **`mcp-auth-gating` run** — executed live (FD-driven machine-read or Witnessed). Confirms: off-by-default 401 (no-mint launch), valid jar key accepted (mint launch), missing/wrong/empty-Bearer 401, admin inert unless `GOLDFINCH_AUTOMATION_ADMIN` set. Run log written; verdict recorded.
- [ ] **`mcp-jar-scoping` run** — executed live. Confirms: jar key enumerates only its jar; cross-jar drive → `out-of-jar`; internal drive by jar key → `internal-session`; burner unautomatable; jar `captureWindow` → `admin-only`; admin (env-set) sees all + internal + `captureWindow`. Run log written; verdict recorded.
- [ ] **Non-loopback / origin** — already behavior-tested by `mcp-loopback-origin-guard` (Flight 3) + unit; confirm guard-first ordering still holds with the auth gate composed (a bad-origin request is 403 regardless of key). Note, don't re-run the whole origin spec unless cheap.
- [ ] **Revoke/toggle-off kills live session** — confirmed (headless integration already asserts it; optionally re-confirm live). Recorded.
- [ ] **Dispositions recorded** — any spec step that can't be staged live (e.g. session-vs-jarId spoof) is recorded with its unit-backing, per scope-honesty. A failing live step is an unmet SC8 criterion: investigate + fix in a new commit + re-run, OR record an operator-accepted known-issue disposition with the run-log path.

## Verification Steps
- Run the gates; launch goldfinch via `dev:automation` (no mint) and confirm 401-while-disabled; relaunch with `GOLDFINCH_AUTOMATION_DEV_MINT=1`, capture the key, drive the gate assertions via the MCP example client + curl; stage jars for the scoping run; relaunch with `GOLDFINCH_AUTOMATION_ADMIN` for the admin run.
- Write run logs; cite evidence paths.

## Implementation Guidance
1. Build the auto-mint affordance first (small `main.js` addition at the MCP-start block). Add a focused unit test for the double-gate predicate if it factors cleanly.
2. Run the full headless gates — must be green before live runs.
3. Drive the live runs. Given GUI + multi-jar staging + env relaunches, FD-driven machine-read verification (curl + `scripts/mcp-example-client.mjs` with the Bearer key, evidence captured) is the accepted standard; elect the Witnessed `/behavior-test` runs for either spec at the operator's discretion (SC8 is high-stakes).
4. Write the run logs at the canonical path; stamp `Last Run` in each spec.

## Edge Cases
- **GUI launch in this environment** — WSLg display present; if the Electron app cannot launch headlessly, surface to the operator (the live runs need their session).
- **Env-relaunch sequencing** — off-by-default (no mint), jar-key run (mint), admin run (mint + admin env) are separate launches; don't conflate.
- **Evidence hygiene** — screenshots/snapshots go to the ephemeral evidence dir, never committed (PII + bloat).

## Files Affected
- `src/main/main.js` — auto-mint-to-stdout affordance.
- (maybe) `test/unit/*` — auto-mint gating unit test.
- `tests/behavior/mcp-auth-gating.md`, `tests/behavior/mcp-jar-scoping.md` — `Last Run` stamps.
- `tests/behavior/{slug}/runs/{ts}.md` — run logs.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing (full headless gates + behavior runs)
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `completed` (in this file's header)
- [ ] Check off this leg in flight.md
- [ ] If final leg of flight: (the optional `hat-and-alignment` follows; treat as final autonomous leg)
- [ ] Commit all changes together (code + artifacts)

> **Orchestration note:** Under `/agentic-workflow`, behavior tests are run by the Flight Director (via `/behavior-test` or FD-driven machine-read), not by a spawned Developer. The auto-mint helper IS code → a Developer builds it (no commit). Review + commit are batched at flight end.
