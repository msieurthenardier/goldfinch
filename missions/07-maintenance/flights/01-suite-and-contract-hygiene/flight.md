# Flight: Suite & Contract Hygiene

**Status**: landed
**Mission**: [Codebase Health — 2026-07-11 Maintenance](../../mission.md)

## Contributing to Criteria

- [x] Suite wall-clock under ~1.5s via timer mocks (criterion 2) — 958ms
- [x] `{ok:false, error}` uniform on both jar data channels (criterion 3)

---

## Pre-Flight

### Objective

Two independent quick wins: mock the real timers that make one test file ~80%
of suite wall-clock, and standardize the jar data-channel failure contract
before history adds callers to it.

### Open Questions

N/A — concrete fixes from maintenance findings 2 and 4.

### Design Decisions

N/A (maintenance flight; fix strategies fixed by the report).

### Prerequisites

- [x] Maintenance report 2026-07-11 findings 2 and 4 (evidence + strategy)

### Pre-Flight Checklist

N/A — maintenance flights skip Pre-Flight (no open questions for concrete
fixes).

---

## In-Flight

### Technical Approach

**Leg 1 — timer mocks (finding 2).** `test/unit/automation-find.test.js`:
three tests are 91% of the file's ~5s cost — two real-timer retry-exhaustion
tests (2502ms, 1560ms) and one explicit `await new Promise(r => setTimeout(r,
520))` (line 198), plus ~3 smaller timeout-fallback tests (~100ms each).
Convert to `node:test` MockTimers (built-in, dependency-free). The retry
timers live in the automation engine's find-retry logic — if the timer calls
aren't already injectable, add a clock seam via the existing injected-deps
convention (do NOT reach for a mocking library; the codebase is
zero-runtime-dep by policy). Measured expectation: suite ~5.2s → ~1.1s.
Coverage must not thin: the retry-exhaustion semantics (attempt counts,
backoff ordering, caller-opts reuse) stay asserted, just on mocked time.

**Leg 2 — result-contract symmetry (finding 4).** `src/main/jar-ipc.js`:
`handleClearData` (line ~166) returns bare `{ok:false}` on every failure
branch (malformed payload, unknown jar, empty/invalid classes, unknown class
id, session-call catch line ~189); `handleWipe` carries `error` on exactly one
branch (line ~211). Standardize `{ok: false, error: string}` on EVERY failure
branch of both handlers, with stable, discriminable error strings (the
established `automation: <code>`-style discipline is the house precedent for
discriminable failure text — mirror the idiom, not the literal prefix).
Update the unit truth tables (`test/unit/jar-ipc.test.js`) to pin each
branch's error string. NO renderer change (jars.js's static `failNote`
behavior is spec'd by M06 F4 and HAT-approved; a `result.error` display is
out of scope). Broadcast-order and fail-closed semantics unchanged.

### Checkpoints

- [x] CP1: suite internal duration < 1.5s, all retry semantics still pinned,
      1283+ tests green — measured 958ms, 1283/1283
- [x] CP2: every failure branch of both handlers unit-pinned with an `error`
      string; typecheck/lint green

### Adaptation Criteria

**Divert if**: MockTimers can't drive the engine's retry path without
distorting what's asserted (would need a real design pass on the engine's
clock seam).

**Acceptable variations**: exact error-string wording; clock-seam shape.

### Legs

- [x] `timer-mocks` — finding 2 (CP1)
- [x] `result-contract` — finding 4 (CP2)

---

## Post-Flight

### Completion Checklist

- [x] All legs completed
- [x] Tests passing (1283/1283, internal duration 958ms; typecheck + lint
      green; verified independently by the flight Reviewer)
- [x] Documentation updated (N/A confirmed — CLAUDE.md describes the
      channels' fail-closed semantics, not the failure return shape; no doc
      references suite timing)

### Verification

- `time npm test` before/after (wall + internal duration)
- `node --test test/unit/jar-ipc.test.js` truth tables green
- Full gates: suite, typecheck, lint
