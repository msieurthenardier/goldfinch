# Flight Debrief: Production gating re-architecture + dev-profile isolation + port free-fallback

**Date**: 2026-06-17
**Flight**: [Production gating re-architecture + dev-profile isolation + port free-fallback](flight.md)
**Status**: landed
**Duration**: 2026-06-17 (single-day orchestration: design → batch-implement → review → live-verify)
**Legs Completed**: 7 of 8 (legs 1–7; leg 8 HAT skipped — operator decision, covered by leg 7 live verification)

## Outcome Assessment

### Objectives Achieved
The flight moved the automation surface from a dev-flag-gated harness to a **production posture**: the Settings `automationEnabled` toggle is now the **sole bind gate** (launch + live), enablement is **human-only** (one persisted writer — the origin-checked toggle IPC), `--automation-dev` is a **dev-only force-bind** (no-op when packaged) via an in-memory **dev-enable override**, dev runs are **profile-isolated** (`~/.config/goldfinch-dev`), the **admin env tier works on the packaged binary**, and the listen port has a **launch-time free-fallback** (dev env-strict, else free). The CLAUDE.md / `docs/mcp-automation.md` security narrative was rewritten to match. All of this was **live-verified on a real `npm run pack` build** (see Verification in the flight log).

### Mission Criteria Advanced
- **SC8** (off-by-default / opt-in / key-gated) — *upgraded* from a dev-harness posture to a production posture: the shipped binary's toggle is the real human bind gate. Met + live-verified.
- **SC6 / SC11** — *unblocked* on the real binary: a real 3rd-party MCP client drove the toggle-bound packaged surface end-to-end (SC6), so dogfooding and external drives no longer require a dev-flagged launch. (SC11's remaining dogfooding/`:9222`-removal work is F9.)
- **Resolved 3 mission Known Issues** (production gating re-arch, dev/installed profile bleed, MCP port conflict) — all marked resolved in `mission.md`; two-instance coexistence + dev-profile isolation live-verified.

### Checkpoints
All In-Flight checkpoints met except the two that were operator-deferred/skipped along with leg 8 (flip-OFF live unbind on the packaged build; DD9 live behavior test) — both covered by unit tests + code review; see Deviations.

## What Went Well

- **Pre-flight Architect review paid for itself.** The five HIGH/MEDIUM corrections incorporated into the leg specs *before* implementation (net-new bind/unbind wiring vs "infra reuse"; the dev-enable override for the auth gate; bound-port capture; call-site `!app.isPackaged` gating; the renderer-copy AC) were each load-bearing — shipping the naive design would have produced a cold packaged build that never binds and a dev surface that 401s everything. No design-review cycle exceeded one round.
- **The security invariant was independently verified, not asserted.** A blind Reviewer pass walked the human-only-enable invariant to ground (`grep` proving one persisted writer; the dev-enable override `!app.isPackaged`-gated at every call site and never waiving the Bearer key). The leg-3 auth-override unit tests include the critical negative (override-on + missing/invalid key → 401).
- **Live verification was high-quality and FD-driven.** Real packaged build, `ss` listener table for bind/unbind, byte-identical sha256 on the installed profile for isolation, real free-port fallback (49707→49708), env-strict hard-fail with the mode-aware message, and **SC6 end-to-end via a real 3rd-party MCP client**.
- **Clean leg shapes.** The leg-2/leg-3 split kept the toggle-binds wiring and the human-only-enable/override changes scoped separately; the confirm-only leg 4 was the right shape for a no-code security audit; the FD-driven leg 7 divided GUI actions (operator) from machine-read evidence (FD) well.
- **Test posture stayed green throughout** — 715 → 722 → 726 → 732 across the batch; typecheck + lint clean; no flakes.

## What Could Be Improved

### Process
- The **SC8-spec semantic caveat** (`mcp-auth-gating.md`'s "off-by-default" observability shifts in dev under the override) was discovered at leg-3 *design review*, not at flight design. It was handled correctly (spec updated + prominent flight-log note), but flight design should **audit the existing behavior-spec set for premises a boundary move invalidates** as a planning step.
- **Leg 8 (HAT) was skipped**, so a few live checks rolled off. Sound given leg 7's evidence — but the flip-OFF live unbind on a packaged build is a genuine (small) verification gap.

### Technical
- **DD9 mint-button gating has zero machine coverage.** It is a security-UX property ("surface off → can't provision credentials") tested only by `automation-key-gating.md`, which is an authored draft that has not been run. Highest-priority uncovered property.
- **`applyAutomationEnabledChange` is not unit-tested** (Electron-coupled) and **does not serialize against itself** — it serializes against the `rebinding` chain (port-save vs flip), but two rapid toggle flips have no mutual exclusion. Safe today (the auth gate is the real authority), but should be closed before external-consumer exposure (F10).
- **Dev-profile isolation's ordering invariant** (`setPath` before any `getPath('userData')` consumer) is protected only by human review — no repeatable test would catch a future store that reads `userData` at module scope.
- Minor: a **stale staging JSDoc** in `automation-dev.js` (the "leg 2 passes… leg 3 swaps…" narrative) now describes history, not the settled state; and `resolvePort`'s `honorEnv: true` default is a latent foot-gun for a future caller that forgets to pass `!app.isPackaged`.

### Documentation
- The security narrative rewrite (DD7) was clean and complete (completeness grep returned nothing). No doc debt. F10 should document the fixed-port-on-packaged guidance (Settings `automationPort`, not env) for external consumers.

## Test Metrics

| Flight | Tests | Δ | Wall-clock |
|--------|-------|---|-----------|
| F3 | 478 | — | ~341 ms |
| F4 | 590 | +112 | ~665 ms |
| F5 | 613 | +23 | ~745 ms |
| F6 | 650 | +37 | ~807–835 ms |
| F7 | 709 | +59 | ~774 ms |
| **F8** | **732** | **+23** | **~897 ms** |

732 pass / 0 fail / 0 skipped, 24 suites, no flakes; typecheck + lint clean. The ~123 ms rise over F7 traces to `automation-mcp-server.test.js` gaining real-loopback-socket strict/fallback `start()` integration tests — expected growth from real-transport coverage, consistent with the F6 debrief's "socket tests set the floor" note, not a regression.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| Dev-enable override emerged (not in original DD3) | Removing the auto-enable side-effect while force-binding left the dev surface 401ing (auth gate checks the *persisted* value) | **Yes** — the pure-module injection pattern (`devEnableOverride: () => …`, `honorEnv: !app.isPackaged`) is now a demonstrated, reusable shape |
| Leg-2/leg-3 split | Architect recommendation — toggle-binds wiring and human-only-enable/override are logically separable | Yes — split boundary-moves into "wiring" + "policy" legs |
| Leg 8 HAT skipped | Operator judged leg 7's live evidence (incl. SC6) sufficient | Case-by-case — sound when the FD-driven verify is strong; record the carried items |
| SC8-spec caveat found at leg-3 review | Boundary move changed a landed spec's premise; not audited at flight design | Lesson — audit the behavior-spec set at flight design when moving a boundary |
| Operator profile reset done during leg-7 cleanup (not a formal pre-leg step) | Practical — the FD did a surgical settings.json reset on operator authorization | Fine as-is |

## Key Learnings
- A "this is just infra reuse" design framing is a smell on a boundary move — the Architect's net-new-wiring correction (DD2) was the difference between a working and a non-binding packaged build.
- Gating a security-UX control on the **persisted** value (DD9), not the effective/bound state, is what made the contract **testable in dev** while faithfully mirroring production — a reusable insight for any dev/prod-divergent UI gate.
- FD-driven live verification with a real packaged build + a real external MCP client produced higher-confidence evidence than a scripted HAT would have, and surfaced the platform-agnostic items that can safely defer.

## Recommendations
1. **Run `automation-key-gating.md` + `settings-activity-viewer.md` as the first act of F9's pre-flight** — they are authored drafts and are the highest-value uncovered properties (DD9 security-UX + the renderer-in-guest seam). Both are runnable in `dev:automation` today.
2. **Serialize `applyAutomationEnabledChange` against itself** (mirror the `rebinding` promise-chain) before F10 exposes the surface to external consumers.
3. **Add an ordering-invariant test for the `userData` redirect** (assert no `getPath('userData')` consumer precedes `setPath` in `whenReady`) — the F7 `INTERNAL_PAGES` lesson applies; protect it from a future module-scope reader.
4. **F10 verify leg must include a Windows-specific dev-profile-isolation + flip-OFF-unbind check** — `app.isPackaged === true` has only been live-verified on Linux/WSL; the `\`-separator path handling and OS socket teardown are unconfirmed on Windows.
5. **Low-effort cleanups**: rewrite the stale `automation-dev.js` staging JSDoc to the settled state; add a `resolvePort` JSDoc warning that main-process callers must pass `honorEnv: !app.isPackaged`.

## Action Items
- [ ] F9 pre-flight: run `automation-key-gating` + `settings-activity-viewer` behavior tests (live run logs)
- [ ] F9/F10: serialize `applyAutomationEnabledChange` against concurrent toggle flips
- [ ] F9: add the `userData`-redirect ordering-invariant test
- [ ] F10: Windows packaged-build verification (dev-profile isolation, flip-OFF unbind, admin-on-prod, DD9) + fixed-port-on-packaged docs for external consumers
- [ ] Cleanup (any flight touching automation): stale `automation-dev.js` JSDoc + `resolvePort` `honorEnv` doc-warning
