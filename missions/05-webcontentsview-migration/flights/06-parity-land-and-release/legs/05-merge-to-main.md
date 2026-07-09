# Leg: merge-to-main

**Status**: completed
**Flight**: [Parity Sweep, Mission Landing & v0.6.0 Release](../flight.md)

## Objective
Land Mission 05 to `main` — parity proven, `main` stays shippable.

## Done (2026-07-09, operator-gated)
- Merged `flight/06-parity-land-and-release` → `mission/05-webcontentsview-migration` (`cdc84a2`, `--no-ff`).
- Merged `mission/05` → **`main`** (`761aec0`, `--no-ff`: "Land Mission 05 (WebContentsView Migration) — v0.6.0").
- `npm test` **1065/1065** on merged `main`; pushed `18470bc..761aec0`.
- Build-only CI dry-run (`workflow_dispatch` on `main`, run `29022790272`) **green on all 3 platforms** before the tag.

## Acceptance
- [x] `main` at 0.6.0, parity proven, tests green, dry-run green; pushed.
