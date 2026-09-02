# Leg: Behavior Spec + HAT

**Status**: completed
**Flight**: [Compromise-Mode Rotation](../flight.md)
**Type**: interactive (HAT) — no autonomous implementation cycle

## Objective

Finalize the `compromise-mode-rotation` behavior spec against the shipped
surfaces (leg-4 handoff strings/ids), run it hybrid-witnessed, and pass a
guided HAT: a real rotation on the dev profile, operator at the controls.
The flight does not land while the behavior test fails (or a failure is
explicitly accepted by the operator with disposition recorded).

## Acceptance Criteria

- [x] AC1: Spec finalized (draft → active) with exact shipped strings and
      observables; step table complete per the draft skeleton
- [x] AC2: `/behavior-test compromise-mode-rotation` passes (hybrid
      witnessed; run log committed per ARTIFACTS.md)
- [x] AC3: Guided HAT passed — both entry lock states, reuse-rejection
      probe, branch switch, single recovery reveal, completion card,
      negative replay of captured old material; operator satisfied
- [x] AC4: Any HAT fixes ride the inline protocol (fix-vs-feature gate;
      multi-surface fixes get a design-review pass)

## Session Steps

1. Prerequisites: dev app running with fresh keys (done at leg start);
   **MCP re-auth by operator** (`/mcp` → reconnect goldfinch-development —
   the live client does not re-read .mcp.json mid-session; anomaly
   logged); dev vault set up with known password + jar vaults + items +
   a minted access key (for the sever probes)
2. Spec finalization pass (Flight Director, from leg-4 handoff strings)
3. `/behavior-test compromise-mode-rotation`
4. Guided HAT walk (operator)
5. Close-out: run log committed, leg landed, flight → landed, PR ready
