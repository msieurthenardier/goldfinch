# Leg: Compromise-Mode Flow Prototype

**Status**: completed
**Flight**: [Alignment — Vault Flows Prototyping](../flight.md)
**Type**: interactive (alignment) — no autonomous implementation cycle

## Objective

Prototype the compromise-mode flow end-to-end in the live app on
`scratch/m18-alignment` (built by spawned Developer increments, clicked
through by the operator), iterating until the operator rules the four
binding decisions. Calibrate first on the real machinery (dev vault:
rotate-recovery, fresh-adopt) before building stubs.

## Acceptance Criteria

Binary and observable; all are session outcomes, not implementation tasks:

- [ ] AC1: Operator has walked the real rotate-recovery and fresh-adopt
      flows on the dev vault (calibration; zero prototype cost)
- [ ] AC2: A stubbed compromise-mode flow is clickable end-to-end: master-key
      kebab entry → confirm surface → step-up sheet → (fake) completion
      report → recovery→admin one-time sheet chain driven with fake keys
      (CP1)
- [ ] AC3: The four binding rulings are recorded in the flight log, each
      with rationale and a screenshot (OS capture for sheet states, per
      DD5): entry point & naming; confirm/step-up composition & wording
      direction; revoked-key aftermath surface; completion-report shape &
      chain handoff (CP2)
- [ ] AC4: Any observation outside the binding four is logged as
      non-binding for Flight 2/3 design

## Session Steps (guided, one at a time)

1. Prerequisites check: dev app launches (`npm run dev:automation`,
   mint-once discipline per flight prerequisites), dev vault set up with
   known password, admin-tier MCP attach confirmed, operator acks the
   OS-screenshot evidence mechanism (DD5)
2. Calibration pass (AC1) — real flows, notes into the log
3. Developer spawn: scratch branch + stub increment 1 (kebab action +
   confirm surface — page-side, cheap reload loop)
4. Operator click-through + iterate on confirm/entry (rule OQ1, OQ2)
5. Developer spawn: stub increment 2 (step-up composition + completion
   report + fake-key chain trigger — batched, relaunch loop)
6. Operator click-through + iterate (rule OQ3, OQ4)
7. Record rulings + screenshots in flight log (AC3, AC4)

## Verification

The flight log's Rulings section contains all four rulings with rationale
and screenshot references; the operator states the compromise-mode flow is
ruled. No code merged anywhere.

## Citation Audit (2026-09-01)

Anchors verified by flight design review 2026-08-31 against current code:
`vault.js:1066` (`buildMasterKeySection` kebab), `vault-stepup-template.js`
(`lede` re-label seam), `register-overlay-ipc.js:118-133` (stash-then-chain,
never touches the store beyond autolock suppression), `main.js:839-855`
(stash store). `main` unchanged since (commit 763eeb5).
