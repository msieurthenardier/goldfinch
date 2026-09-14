# Mission Debrief: Browser Credential Import

**Date**: 2026-09-14
**Mission**: [Browser Credential Import](mission.md)
**Status**: completed
**Duration**: 2026-09-08 (planning) → 2026-09-14 (both flights landed + debriefed)
**Flights Completed**: 2 of 2 (Flight 3 alignment optional, not taken — flow judged settled)

## Outcome Assessment

### Success Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| Logins arrive from a browser export | met | Chrome (F1) + Edge (F2), each HAT-verified end-to-end on a real export |
| Nothing lands without a destination choice | met | destination modal + native confirm; Replace/Merge for a non-empty target |
| Re-importing does not duplicate | met | content-identity dedupe `(canonicalOrigin, username)`; double-import HAT idempotent (0 imported) |
| Unmappable / degenerate rows handled | met | taxonomy: federated→no-password, malformed, non-web-origin (android://), field-too-long; `blocklist` reserved, correctly dormant |
| Reports its outcome per entry | met | imported / duplicate / changed / unmappable(reason) / failed counts |
| Never machine-driven, incl. admin | met | native dialog has no automation surface; payload never serialized to the page; native confirm commit-gate; boundary tests |
| goldfinch writes no plaintext to disk | met | Buffer read, zeroize-on-every-exit, byte-scan test; HAT S12 grep of the real profile found zero |
| The Chromium family comes in on the same path | met | Edge verified byte-identical to Chrome (planning + live HAT); generalized guidance |
| Docs tell the new truth | met | `docs/vault.md` + CLAUDE.md, Chrome then Chromium |

### Overall Outcome

The mission delivered its stated outcome in full: the operator can bring saved
logins out of Chrome and Edge into the vault, choosing where each import lands,
with a per-entry report and no goldfinch-authored plaintext on disk. The
operator judged the mission complete — the flow was settled at Flight 1, so the
optional alignment flight was not needed, and other Chromium browsers
(Brave/Opera/Vivaldi) are deferred to real demand rather than speculatively
built. The **mechanism itself was the mission's most consequential decision**,
and it was made by evidence, not assumption: a Windows-first App-Bound-Encryption
gate at planning tested the obvious "read the browser's database directly" path
against the operator's real profiles, found it adversarial/infostealer-shaped on
the platform that matters, and chose browser-mediated export instead. The
**payment-card scope was correctly deferred** at planning (browser exports don't
reach cards) and routed to a possible future direct-read flight — a scoped
deferral, not a gap.

## Flight Summary

| Flight | Status | Key Outcome |
|--------|--------|-------------|
| F1 — Chrome Password Import | completed | The whole pipeline: RFC-4180 parser, Chrome-row adapter + taxonomy + caps, content-identity dedupe, the gated `importLogins` batch op, the zeroizing held-payload store, the native-dialog automation boundary, the vault-page import UI + squawk 0063. |
| F2 — Chromium Family Breadth | completed | Edge verified byte-identical → generalized to the Chromium family (copy + docs, no source picker); the M18 F3 `vault.js` restore-modal extraction paid down (2820→2102, budget 2150) as the flight's leg 1. |

## What Went Well

- **Evidence-first design, applied at every level.** The ABE finding chose the
  mission's mechanism; a real Chrome export shaped Flight 1; a real Edge export
  (inspected header-first, then live-HAT-confirmed) collapsed Flight 2 from a
  divert-risk "family breadth" flight into copy-and-docs. Verifying one real
  artifact before committing to a design was the single biggest risk-and-schedule
  win of the mission.
- **The design-review layers repeatedly caught real defects before code** — the
  circular-require, the un-spyable write, the `pendingNotice` ReferenceError, two
  missed invariants files, the six-site state coupling. And the independent
  flight-end Reviewer caught the one real logic defect the leg ACs missed (the
  intra-file dedupe bypass on an empty destination).
- **Clean, correctly-bounded architecture.** A new browser-import substrate
  (parser→adapter→dedupe→commit, all main-side, dialog-gated) kept deliberately
  separate from M18's id-keyed restore, and a three-controller vault-page
  decomposition over a thin `vault.js`. Ownership boundaries are documented in
  the code, not implied.
- **Orchestration calibrated well.** The operator reported no surprises and that
  the level of autonomy was right — the layered reviews, autonomous legs,
  independent reviewers, and two guided HATs ran without oversight friction.

## What Could Be Improved

- **The real-boot internal-page smoke check is the mission's headline unclosed
  gap.** Named in BOTH flight debriefs, it still has no owning squawk or
  maintenance slot. Source-scan review is blind to the two defect classes the
  mission actually hit — runtime ES-module resolution (F1's missing `burner.js`
  route) and CSS cascade-origin (F1's `.vault-field[hidden]`) — and F2's
  854-line restore move was guarded against a rendering regression only by one
  operator's single HAT pass. This needs a design, not a third deferral.
- **Debt named at two consecutive debriefs slipped to the third flight.** The
  `vault.js` extraction was named in M18 F3, then M19 F1, and only paid in M19
  F2 — and bundled onto a feature flight by operator ruling, which worked only
  because leg 1 got full flight-grade rigor. An auto-escalation rule (name it
  twice → it's a leg in the next flight) would remove the reliance on that.
- **The citation audit is not a trustworthy backstop.** The same class of
  source-scan-pin miss slipped past three checks in F2 (Architect review, leg
  review, then the green bar caught it). "Run the affected suite" belongs inside
  the citation-audit step.
- **FD operational slips cluster at the leg-to-HAT handoff** (F1's WSLg restart,
  F2's errant `git checkout`, both recovered with no loss) — a friction a
  decoupled refactor flight would have avoided.

## Lessons Learned

- **Technical**: a stateful wrapper being correct is not proven by testing the
  pure function it wraps — an AC must exercise every branch through the call
  site (the dedupe-bypass lesson). A behavior-preserving move needs a
  move-not-rewrite diff verification, not new unit tests; on a no-DOM-harness
  page the real regression risk is rendering, which only a HAT covers.
- **Process**: verify an empirical premise against a real artifact before
  designing around it — cheap, and it eliminated whole risk axes twice.
- **Domain**: browser-mediated export is the only cross-platform credential
  path (ABE forecloses direct read on Windows); Chrome and Edge exports are
  byte-identical, so "source" is undetectable and must be operator-declared or
  omitted, never faked.

## Methodology Feedback

- **Codify "verify against a real artifact before designing"** as a named
  planning-phase step, not an implicit Architect-validation lesson.
- **Auto-escalate debt named at two consecutive debriefs** into the next
  flight's leg list.
- **Fold "run the affected test suite" into the citation-audit step** rather
  than treating the green bar as a fallback.
- The mission/flight/leg hierarchy plus the risk-tiered design reviews and the
  guided HATs worked well for a security-sensitive, operator-only feature — the
  HAT in particular was the right instrument for the un-unit-testable (real
  keyboard, render, on-disk-plaintext absence).

## Reusable Patterns

- The **injected-deps page-controller extraction** (create*Controller(deps),
  closure-owned state via getter/loader, a single-purpose injected callback for
  a secondary coupling) — now three instances; a canonical getter-shape contract
  is squawk 0070.
- The **held-plaintext-payload zeroizing store** as a sibling (not a shared
  factory) of the restore hold store — the one deliberate duplication, with the
  reasoning documented in-file.
- The **native-dialog automation boundary** (initiation + payload-never-serialized
  + native confirm) — but a future keyring-based direct-read source needs its
  OWN boundary argument, not this one inherited.

## Action Items

- [ ] **Real-boot internal-page smoke check** — design + land it (open across
      both flight debriefs, no owning artifact yet). Highest-value carry-forward;
      belongs in the next maintenance-flight cycle.
- [ ] Squawk **0069** — line budget for `vault-restore-controller.js` (open).
- [ ] Squawk **0070** — document the page-controller pattern + reconcile the
      getter-shape drift (open).
- [ ] Adopt the two methodology rules above (verify-real-artifact; auto-escalate
      twice-named debt) — carry into the next mission's planning.
- [ ] Deferred, not planned: a Linux/macOS **direct-read** enhancement — it can
      reuse `planLogins`/`importLogins` as-is but needs a new ingest module
      (`Web Data` SQLite + OS keyring unwrap) and a freshly-reasoned admin-tier
      boundary; flag at that mission's planning that DD5/DD13 does NOT transfer.
- [ ] Payment cards — reachable only via the direct-read path above; stays out
      of scope until then.
