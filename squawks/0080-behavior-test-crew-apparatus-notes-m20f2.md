# Squawk 0080: Behavior-test crew file — four apparatus facts from the M20 F2 acceptance run

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-16
**Completed**: —

## Report

The `tls-trust-surface` Witnessed run (2026-09-16) rediscovered four rig
facts live that belong in `.flightops/agent-crews/behavior-tests-execution.md`'s
"Project Apparatus Notes (goldfinch)" so the next crew spawn needs no
hand-added instruction: (1) `pressKey` `Enter` on the chrome wcId activates
the address bar's keydown listener but does NOT activate a focused
`<button>` (no `char`/keypress event) — a keyboard row that ends in a button
activation needs a by-eye check or `evaluate .click()`; (2) the `navigate`
drive op returns `isError: true` with the net error text for a TLS-blocked
load — the tab STATE (census) is the observable, not the op's result;
(3) census `security` settles one push AFTER `loadState` flips to `ok`
(`tab-did-navigate` then `tab-security`) — read chip/census only after two
consecutive stable reads; (4) a transient read is evidence: save it under its
own ordinal suffix, never overwrite the settled read.

## Evidence

- `tests/behavior/tls-trust-surface/runs/2026-09-16-04-59-20.md` — Orchestrator
  Notes "Apparatus findings"; checkpoints 9 (timing) and 15 (Enter on Advanced).

## Corrective Action

_(written at completion)_ Four bullets in the apparatus notes, each with the
run-log citation; no prompt-block change.

## Verification

Re-read the crew file; the next Witnessed run's Executor cites them.

## Sign-Off

_(written at completion)_
