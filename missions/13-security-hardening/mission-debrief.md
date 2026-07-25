# Mission Debrief: Web-Content Security Hardening

**Date**: 2026-07-25
**Mission**: [Web-Content Security Hardening](mission.md)
**Status**: completed
**Duration**: 2026-07-24 – 2026-07-25 (autonomous, single operator directive)
**Flights Completed**: 3 of 3

## Outcome Assessment

### Success Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| Web-guest renderer OS-sandboxed (finding 1) | **met** | `sandbox:true` on web guests + 2 overlays; `/proc` diff confirmed live (NoNewPrivs:1, +1 seccomp filter, distinct userns). Chrome view deferred (tracked Known Issue). |
| Three preload capabilities work after sandboxing | **met** (with residual) | Farbling + media scan verified live under sandbox; both preload-init `sendSync` round-trips return. Vault fill/capture full UI round-trip under sandbox not re-exercised (Known Issue #2). |
| Permission positive-allowlist (finding 2) | **met** | Deny-list→allowlist inverted; invented permission denies (unit-pinned); privacy-permission push preserved. |
| No page-controlled URL fetched outside owning jar; CSP pinned (finding 3) | **met** | Favicons→data: URLs (jar-session fetch); media→`goldfinch-media:` proxy; CSP tightened + pinned (chrome + 3 overlays). Behavior test `cross-jar-fetch-isolation` passes; zero cross-jar carry. |
| Chrome-trust IPC sender validation + tab-navigate URL gate (finding 4) | **met** | `requireChrome`/`ownsTab` across unguarded channels; branched `tab-navigate` URL gate; cross-window refusal unit-pinned. |
| Subframe + redirect nav guards; every webContents guarded (finding 5) | **met** | `will-frame-navigate`/`will-redirect` on guests + `web-contents-created` catch-all with the `__goldfinchNavGuarded` latch; live smoke confirms browsing + DevTools unaffected. |
| Vault-capture ignores synthetic submits (finding 6) | **met** | `isTrusted` guard added; comment covers spurious-offer + update-disposition. |
| CLAUDE.md posture record current | **met** | Updated per-flight; fixed 2 pre-existing stale claims (`sendToHost`, "opposite" isolation wording). |
| Regression net green at mission end | **met** | 2840 tests, lint, typecheck all green. |

### Overall Outcome

The mission achieved its stated outcome: **all six audit findings from issue #131 are closed** — five fixed, and finding 6 hardened beyond the accepted-tradeoff the audit would have permitted. A hostile page in a Goldfinch tab is now contained as the threat model promises: renderer compromise stays in the OS sandbox, unknown permissions deny by default, the chrome can no longer be used as a cross-jar linkability side channel, and the internal IPC surface refuses callers it can't identify.

**Important shipping-state caveat**: at debrief time the work is "landed" in Flight Control terms but **not yet merged to `main`** — it lives on a stacked-branch PR chain (#135 ← #136 ← #137), and **issue #131 remains OPEN**. Nothing has reached users yet. The mission's success criteria are satisfied against the flight branches; the issue should close only once #137 lands on `main`.

## Flight Summary

| Flight | Status | Key Outcome |
|--------|--------|-------------|
| 01 Cross-jar fetch isolation | landed | Favicon data:-URL conversion + `goldfinch-media:` proxy protocol; CSP tightening; default-session purge. Leak confirmed live pre-fix, closed post-fix. |
| 02 Renderer OS sandbox | landed | Web guests + overlays → `sandbox:true` via the repo's first build-time transform (esbuild preload bundle). OS sandbox confirmed active via `/proc`. |
| 03 Policy + IPC hardening | landed | Permission allowlist; IPC sender validation; nav guards; vault isTrusted. Two would-be regressions caught pre-implementation by design review. |

## What Went Well

1. **The design-review gate earned its keep — repeatedly.** It caught multiple HIGH-severity regressions *before* implementation: the `tab-navigate` unconditional-`isSafeTabUrl` break of internal-tab "Site settings" nav (Flight 3), the `will-frame-navigate` `(event, url)` arg-shape bug that would have `preventDefault`'d every navigation and broken browsing wholesale (Flight 3), the `beforeBuild`-vs-`beforePack` electron-builder footgun (Flight 2), and the `encodeURIComponent` CSS-escaping error in DD2's rationale (Flight 1). It also *empirically retired* Flight 2's central risk by confirming the WSL2 sandbox engages before implementation started.
2. **Architectural discipline held under pressure.** Three flights of shortcuts-available and the house rules survived: `app-lifecycle.js` stayed zero-`require()` (deps threaded from `main.js`); the Electron-free injected-deps module style held for `favicon-fetch.js`/`media-proxy-handler.js`; new trust surfaces reused existing structural patterns (`goldfinch-media:` mirrors the `goldfinch://` "trust by no-handler-exists" model) rather than inventing parallel ones. The `RENDERER_LINE_BUDGET` guard fired and was handled correctly rather than special-cased.
3. **Live verification was rigorous and honest.** Each flight's real-environment claims were proven, not asserted: the cross-jar leak was confirmed with a cookie-lineage fixture pre- and post-fix; the OS sandbox with a `/proc/status` seccomp diff; the nav guards with an actual http-subframe load + DevTools open. Where a live check couldn't be done headlessly (gesture-gated permissions, cross-scheme redirect), the flight log said so plainly instead of overclaiming.

## What Could Be Improved

### Process
- **The two-phase leg pattern (build/verify infra, then flip) worked, but the FD carried a lot of live-verification load directly** rather than always routing through the Witnessed `/behavior-test` orchestration. That was a reasonable autonomy call for deterministic filesystem/DOM observables, but it means some acceptance evidence lives in FD-authored run logs rather than independent Executor/Validator runs. For the one flight where a behavior test existed (`cross-jar-fetch-isolation`), the full Witnessed run is the stronger artifact.
- **Parallel-leg execution needed a manual flight-log write-race workaround** (Leg 2 was told not to touch the shared log; the FD wrote its entry). Fine once, but a recurring parallel-leg pattern wants a cleaner convention (per-leg log fragments, or a designated single writer).

### Technical
- **The `__goldfinchNavGuarded` latch ordering is comment-pinned, not test-pinned.** A future `await` inserted before the latch-set line in `wireGuestContents` would silently reopen the race the review flagged. Worth a regression test asserting the latch is set before the first navigation event can fire.
- **The permission-union asymmetry comment** (Electron 43's request/check handlers take different string sets, bridged by one shared allowlist `Set`) is a "don't "fix" this apparent bug" landmine — worth a linked test name so it survives refactors.
- **`npm test`/`npm start` now silently rebuild the preload bundle every invocation** (via `pretest`/`prestart`). Cheap for today's 3-file graph; unmonitored if the graph grows (no build-time gate or cache).

### Documentation
- CLAUDE.md was kept current per-flight (a strength) — worth making that an explicit per-flight habit, not a mission-end checklist item, since it also surfaced two pre-existing stale claims.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| Fixture port 8123→8231 | 8123 occupied by an unrelated local process | No — situational |
| DD3 proxy-playback fallback NOT invoked | Live smoke showed Electron 43 has no `protocol.handle` seek limitation | n/a — the early smoke probe (verify-before-build) is the standardizable lesson |
| FD-driven acceptance vs full Witnessed run (Flight 1 AC9) | Deterministic observables + warm apparatus + autonomous run | Partially — document when FD-direct is acceptable vs when a Witnessed run is required |

## Key Learnings

- **For a mechanical/security-hardening mission with narrow, well-understood scope, the design-review gate can carry the weight an alignment flight normally would.** This mission ran with no alignment flight (per operator directive) and it worked — the review caught more pre-implementation regressions than an interactive session likely would have. Validated pattern for this mission *shape*, not a universal rule.
- **Verify-before-build on the risky premise pays for itself.** Flight 2's empirical sandbox check and Flight 1/2's early smoke probes turned "central risk" into "retired risk" before any implementation was built on the unverified assumption.
- **Introduce a first-of-its-kind build transform by making it invisible to every quality tool in one pass and regenerating at every entry point** — the gitignored-regenerated bundle had zero drift surface by construction.

## Recommendations

1. **Merge the stack first (135→136→137), then close #131 against `main` HEAD.** This is the literal first post-debrief action — the mission's value isn't realized until the code ships, and an unmerged stack accrues rebase risk.
2. **Close the vault-round-trip-under-sandbox gap (Known Issue #2)** via a quick re-run of the existing vault behavior specs under `sandbox:true` — cheap (a re-run, not new authoring), and vault is the highest-value trust boundary. Do it before/early in the next vault-touching mission.
3. **Build the `tab-scheme-guard` fixture's missing vectors** (subframe self-nav + a real cross-scheme 302) so steps 14-15 can actually run — this is the single highest-value live gap, since a wrongly-refused legitimate cross-scheme redirect was Flight 3's one plausible live regression and was only reasoned about, never exercised.

## Action Items

- [ ] Merge PR stack #135 → #136 → #137 to `main` in order (human decision — see Methodology Feedback).
- [ ] Close issue #131 once #137 lands on `main` (not before).
- [ ] Add a regression test pinning the `__goldfinchNavGuarded` latch-before-first-navigation ordering.
- [ ] Re-run vault fill/capture behavior specs under `sandbox:true` to close Known Issue #2.
- [ ] Extend the `tab-scheme-guard` fixture with a subframe self-nav vector + a cross-scheme 302 endpoint; then run the extended spec.
- [ ] Consider a small future flight for the deferred chrome-view sandbox flip (low urgency; bundle with a chrome-preload refactor).
- [ ] Add a linked-test-name or second comment guarding the permission-union shared-`Set` from a "fix the asymmetry" refactor.

## Methodology Feedback

- **Stacked-branch autonomous execution outran the merge/close step.** Flight Control's flight-lifecycle ("landed"/"completed") is decoupled from VCS reality (merged to `main`) and issue-tracker reality (issue closed). For an autonomous multi-flight mission, the methodology should make explicit that "mission completed" ≠ "shipped" — merging the stack and closing the tracked issue are human-gated actions the FD should surface as pending, not silently leave. This debrief does surface it; worth encoding as a standard mission-completion checklist item.
- **Parallel-leg flight-log write contention** wants a convention (per-leg log fragments or a single designated writer) so it's not re-solved ad hoc each time.
- **The "verify the risky premise before building on it" step** (empirical sandbox check, early media-seek smoke) is worth promoting from an ad-hoc FD move to a named pattern in the flight-design guidance — it repeatedly converted a flight's headline risk into a retired one at low cost.
