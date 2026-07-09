# Leg: automation-mcp-corpus

**Status**: completed
**Flight**: [Cross-View Keyboard Bridge & Admin-Wired Parity Sweep](../flight.md)

> **Outcome (2026-07-08): SC6 automation parity PASS, Validator CONFIRMED.** 4 clean PASS (loopback-origin,
> drive-end-to-end, foreground-to-act, auth-gating) + 2 PASS-on-triage (automation-key-gating & settings-automation
> — the FAIL was a `goldfinch-dev` vs `goldfinch` profile-mismatch false alarm; DD9 intact) + 2 apparatus-limits
> (devtools-cdp-conflict, observe-refusal Step 2 — CDP refusal is macOS-authoritative, DD8). No regressions, no
> source changes. Follow-ups (debrief/Leg 6): DD9 OFF-branch positive-witness re-run; pin profile read to
> `goldfinch-dev`; spec-drift fixes. Details in flight log.

## Objective
Certify SC6 — full MCP automation parity on the native `WebContentsView` surface: every guest-addressing drive
+ observe + eval/devtools tool works end-to-end over the loopback transport, and the auth/origin/key gates hold.

## Context
- SC6 is the mission's named acceptance for this flight. The corpus below is the benchmark.
- Apparatus: admin-wired instance on `GOLDFINCH_MCP_PORT=8899` (Leg-1 recipe). Evidence-hygiene upgrade
  (flight-log Decision): persist raw `isError`/JSON payloads per load-bearing assertion.

## Specs (this leg)
- `mcp-drive-end-to-end` — the 12 drive + 4 observe + chrome-discovery tools, end-to-end, non-self-referential.
- `mcp-auth-gating` — every request needs a valid Bearer key; the gate rejects without one.
- `mcp-loopback-origin-guard` — the SC7 Origin/Host guard; only loopback.
- `automation-key-gating` — key mint/enable gating in the live-broadcast surface.
- `settings-automation` — the automation settings surface (internal `goldfinch://settings`).
- `foreground-to-act` — foreground-to-act capture semantics for drive ops.
- `observe-refusal-contract` — the observe-tools' documented refusal shapes (debugger-unavailable etc.).
- `devtools-cdp-conflict` — the F9 eval/devtools tools; CDP-conflict handling.

## Acceptance Criteria
- [ ] All eight specs PASS on the new surface (or a failure is triaged: real regression → fix-and-rerun; spec
  drift → recorded; apparatus-limit → recorded/deferred).
- [ ] Per-spec run logs under `tests/behavior/{slug}/runs/{ts}.md`; raw payloads in the ephemeral evidence dir.
- [ ] SC6 acceptance called: automation parity holds, no drift.

## Files Affected
- `tests/behavior/{slug}/runs/*.md`. Source fixes only if a real regression surfaces.

---

## Post-Completion Checklist
- [ ] Eight specs run; verdicts recorded with raw-payload evidence
- [ ] Flight log updated (results + any regressions)
- [ ] Leg status → `landed` (no commit — batch-commit at flight end)
- [ ] Check off in flight.md
