# Squawk 0088: MCP `evaluate` is a silent no-op in some builds

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-09-18
**Completed**: —

## Report

`evaluate` returns `{"ok":true}` while the evaluated code never runs. No error, no
rejection — a caller cannot tell, which is the worst possible shape for this.

Three observations that do not yet agree, which is why this is logged rather than
fixed:

1. Against the operator's **installed 0.16.5** build: `evaluate` set a DOM
   attribute, and a following `readDom` confirmed the attribute was absent.
   `readDom`'s `selector` / `maxLength` arguments also appeared to be ignored.
2. Mission 21 Flight 1's **Leg 2 spike** explicitly verified `evaluate` WORKS in a
   dev build from source (a `1+41 → 42` sanity check before relying on it).
3. Flight 1's **Leg 3 live probe** then observed `evaluate` as a silent no-op on a
   genuine `npm run dev:automation` dev-build launch — contradicting (2).

## Evidence

- Observation (1), this session: `evaluate` with
  `document.documentElement.setAttribute('data-probe-marker','alive')` resolved
  `{"ok":true}`; a subsequent `readDom` showed `data-probe-marker` absent.
- Observations (2) and (3) are recorded in
  `missions/21-saving-not-just-filling/flights/01-the-save-moment/flight-log.md`
  (Leg 2 findings; Leg 3 progress entry).

## Disposition

**Left OPEN, not completed in the 2026-09-19 turnaround.** It fails squawk
qualification criterion 2 (*no design decisions — the fix approach is obvious, or
discoverable in one read pass*): the cause is unknown and the evidence is
self-contradictory, so the next step is a deliberate reproduction across packaged
and dev builds, not a fix. Completing it would mean growing an investigation inside
a squawk, which is what the gate exists to prevent.

Worth noting for whoever picks it up: the fix may be as much about **failing
loudly** as about the underlying cause. A silent no-op on an automation primitive
is a defect independent of why the evaluation is dropped.

## Corrective Action

*(written at completion)*

## Verification

*(written at completion)*

## Sign-Off

*(written at completion)*
