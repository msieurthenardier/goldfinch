# Flight Debrief: Per-Jar History Store

**Date**: 2026-07-13
**Flight**: [Per-Jar History Store](flight.md)
**Status**: landed
**Duration**: 2026-07-12 (single-day flight)
**Legs Completed**: 4 of 4 (`store-core`, `recorder-and-wiring`, `history-ipc`, `verify-integration`)

## Outcome Assessment

### Objectives Achieved

Landed the mission's storage substrate and recording pipeline: an indexed,
Electron-free `node:sqlite` history store (`src/main/history-store.js`), a
navigation recorder with the DD4/DD5 decision gates
(`src/main/history-recorder.js`), the twin-registered read/mutate IPC surface
(`src/main/history-ipc.js`), and the `main.js` wiring (boot open, hourly prune,
`will-quit` close, `did-navigate`/`page-title-updated` → recorder). Full API
round-trip, cross-jar isolation, FTS5 injection safety, retention + orphan GC,
corrupt-file quarantine-and-recreate, and same-timestamp cursor paging are all
unit-pinned. The `history-recording` behavior test passed 8/8 live (recording,
title backfill, pushState capture, burner exclusion, internal-page exclusion,
restart survival).

### Mission Criteria Advanced

- **"Visits are recorded (address, title, time) and survive restart"** — closed
  this flight (behavior-test-backed, 8/8).
- **"Burner and internal pages never produce records"** — closed this flight
  (positive-allowlist gate; 8/8 confirmed zero rows).
- **"Jar isolation holds for history on every surface"** — the web-page/structural
  half is seeded here (origin-gated internal twins, unit-pinned); the address-bar
  and automation halves close in Flights 4 and 5.

## What Went Well

- **The store API proved a durable seam.** All ten Flight-1 method signatures
  survived untouched into Flights 4 and 6 — `suggest`, `listByPage`, and
  `pruneOneJar` were added purely additively with zero substrate or signature
  change. The zero-runtime-dependency `node:sqlite` ruling (DD1) paid off, and
  the "jar-keyed, now-injected, Electron-free store" shape let downstream flights
  extend it without rework (exactly as DD10 predicted).
- **Reused house patterns rather than inventing:** directory-injected store
  (settings/downloads precedent), `createHistoryRecorder` factory (mirrors
  `createMenuOverlayManager`), twin-registered IPC (`jar-ipc.js` extract-don't-fork).
- **Robustness patterns worth reusing:** corrupt-file quarantine-and-recreate
  (incl. `-wal`/`-shm` siblings), every recorder store call try/catch-wrapped so a
  store hiccup can never break navigation, and store-side FTS5 input sanitization
  that closes the operator-injection throw class before user text reaches a MATCH.
- **Restraint in wiring:** the store opens as a sibling call after
  `initProfileAndStores` rather than widening its unit-pinned 4-store signature,
  preserving the profile-order ordering invariant; the `will-quit` close seam was
  a considered addition with recorded rationale.

## What Could Be Improved

### Process

- **The leg specs as first-drafted were not implementation-ready; the design-review
  gate carried the load.** Three of four leg design reviews returned "approve with
  changes" with HIGH findings, and all three of the substantive ones were
  *silent-failure* design defects — not implementation slips — that spec-faithful
  unit tests would have pinned green (see Key Learnings). Zero implementation
  deviations resulted *because* the review caught them first.
- **"Re-review skipped because the fixes were reviewer-prescribed and live-verified"
  recurred three times.** Efficient, and reasonable per-instance, but it concentrates
  correctness on a single review pass. Worth naming as a standing trade-off rather
  than a silent default.

### Technical

- **The main.js recording wire has no CI regression net.** By explicit leg-2 design,
  the boot-open/prune/close and the `did-navigate`/`page-title-updated` → recorder
  glue are verified only by the `history-recording` behavior test (8/8, live), which
  is not in CI and — per the local-only-behavior-test convention — is not a committed
  baseline. If someone drops a `historyRecorder?.handleNavigation(...)` call, nothing
  in `npm test` catches it. This is the flight's single largest regression exposure.
- **`pruneExpired` couples a per-jar cutoff with a global orphan sweep.** That
  coupling forced Flight 6 to add a separate `pruneOneJar`, because a naive
  single-jar `pruneExpired({[jarId]: days})` would treat every other jar as an
  orphan and wipe its history. A cleaner Flight-1 split (cutoff-only vs. cutoff+GC)
  would have anticipated the retention-edit consumer.
- **Speculative IPC read-channel shapes are a gamble.** DD9 registered read channels
  before their consumers existed; `history-list` (cursor-paged) was removed outright
  in Flight 6 and replaced by `history-page` (offset/numbered) once the real
  History-panel consumer chose numbered paging. The *store* API was the safe thing to
  anticipate; the *IPC read ergonomics* were not.
- **Two `history-changed` broadcasts fire per single visit** (record + title backfill).
  DD7 accepted the noise; carried into Flight 3 (which debounces panel-side).

### Documentation

- CLAUDE.md gained a thorough History-store section this flight. Recommend a
  one-line cross-link promoting the corrupt-file-quarantine + live-handle-singleton +
  injected-dir combination as the canonical reusable `node:sqlite` store template.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| DD3 tokenizer amended `tokenchars '-._/:'` → default `unicode61` at leg-1 review | The custom tokenchars made a whole URL one FTS token, defeating the flight's own prefix-search AC — caught by a live probe | No (defect fix); yes to the live-probe review habit |
| `retentionDays` seeding corrected to enumerate 4 assembly sites | Fresh-install/legacy-seed jars bypass `validateContainers()`; an `undefined` retention reaches `pruneExpired` as a `NaN` cutoff that binds silently and matches zero rows | Yes — audit seed/validation bypass paths whenever a field is added |
| Leg-1 paging SQL `?` + `?1` mix → distinct `?1/?2/?3` | SQLite collapses bare `?` and `?1` onto one bound slot | Yes — keep the numbered-placeholder discipline (recurred across the mission) |
| Leg-4 split into Developer half (scale probe + docs) + FD half (behavior test) | Clean division for verify-only legs | Yes — reusable pattern for `verify-integration` legs |

## Key Learnings

- **The design-review live-probe gate is mandatory for storage-engine and
  validation/seed legs.** Every HIGH finding on this flight was a plausible-but-wrong
  silent failure (broken search; zero-row retention prune) that a unit test written
  against the buggy spec would have happily confirmed. Human/agent code-reading alone
  would likely have missed them; the *live probe* is what caught them.
- **Anticipate the store API, not the IPC read shape.** Jar-keyed store methods
  survived three flights; a speculative read channel did not.
- **`node:sqlite` is experimental — treat it as a standing tax, not a one-time risk.**
  It emits `ExperimentalWarning` and its API may shift; every Electron major bump
  (42→43 already backlogged) owes a store-suite re-run as a first-class migration cost.

## Recommendations

1. **Add a thin integration/smoke test for the main.js recording wire** (assert
   `handleNavigation` is invoked from the `did-navigate` guard with the threaded
   partition) to reduce sole reliance on the non-CI behavior test.
2. **Track the `node:sqlite` experimental-API tax as a live routine-maintenance
   item** — the 42→43 Electron bump owes a store-suite re-run.
3. **Promote the reusable `node:sqlite` store template** (quarantine + live-handle
   singleton + injected dir + injected `now`) in CLAUDE.md's patterns section.
4. **When designing prune/sweep APIs, keep targeted operations separate from global
   sweeps** — combined methods are footguns for single-target callers.
5. **Confirm the `enumerateTabs` doc/behavior divergence was reconciled in Flight 5**
   (it lists internal `goldfinch://` tabs for admin, contradicting its "non-internal"
   description).

## Action Items

- [ ] Add a smoke/integration test asserting the `did-navigate` → `handleNavigation`
      wire exists (reduce the pipeline's non-CI regression exposure).
- [ ] Add a routine-maintenance ledger item: re-run the history store suite on the
      next Electron major bump (42→43).
- [ ] CLAUDE.md: cross-link the reusable `node:sqlite` store template one-liner.
- [ ] Verify (in the Flight 5 debrief) that the `enumerateTabs` "non-internal"
      description was corrected.
