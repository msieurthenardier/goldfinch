# Flight Debrief: Main-Process Wiring — Fullscreen, Auth Challenges, Inline PDF

**Date**: 2026-07-27
**Flight**: [Main-Process Wiring](flight.md)
**Status**: landed
**Duration**: 2026-07-27 (single-session autonomous run)
**Legs Completed**: 4 of 4

## Outcome Assessment

### Objectives Achieved

All four silent web-compat failures are wired: HTML5 fullscreen (window-record mode gating the bounds pipeline), HTTP basic auth (exactly-once challenge store + chrome sheet + zeroized channel + `vaultAnswerAuth`), client certificates (kind extension on the same store + picker sheet + TLS fixture tooling), inline PDF (`plugins: true` + frame-scoped id-pinned carve-out, premise-checked live). Single batched commit `b2b12fd` (68 files, +6197/−62); draft PR #141. Gates at close: 2993/2993 tests, lint, typecheck; independent flight-wide Reviewer `[HANDOFF:confirmed]`.

### Mission Criteria Advanced

All Flight-1 mission criteria are implemented and unit-pinned, but **none can be checked off** until the deferred verification bundle runs live: `web-compat-fullscreen`, `web-compat-basic-auth` (incl. the agent path), `web-compat-client-cert` (needs `libnss3-tools`), `web-compat-pdf`, vault-login re-run. Cause: the session's MCP identity is jar-scoped; every chrome-visibility observable needs admin-only `captureWindow`/`enumerateWindows`. The FD's refusal to weaken specs to fit the deficient apparatus is judged correct by both interviews — the specs encode the right observables; the session identity fell short.

## What Went Well

- **Risk-tiered leg design review earned its cost on all four legs**: DD4's wrong event object (app-level, not session-level), leg 02's `!isMenuOpen()` eligibility case (a real data-loss bug — re-present would model-replace a dismiss-locked one-time-key sheet), leg 03's ledger-first ordering (every cert selection would otherwise cancel itself), leg 04's wrapper-replaces-registration shape — all caught pre-code. Implementation deviations from design-reviewed guidance across four legs: zero.
- **DD5's three-outcome premise check** is the flight's best methodological moment: enumerated outcomes with pre-made FD rulings (including "don't land unexercised security code"), run live before the risky code, falsified two pieces of Electron folklore (viewer is a guest subframe, not a separate webContents; plugins-absent PDFs show a dead viewer, they don't download), and surfaced an environment fact the spec needed (downloads dir = `$HOME` under WSL).
- **Per-leg citation audits** kept four sequential legs honest against a mutating tree (caught e.g. the `tab-navigate` gate drifting `:690`→`:715`).
- **Test discipline**: +153 meaningfully behavioral tests; two comment-only invariants became executable source-scan pins (latch ordering; single-callback-site); the store matrix runs parametrically over both challenge kinds (65 tests).
- **Security surfaces held**: zeroized channel cloned byte-for-byte; credentials provably absent from channel-4/MCP results/audit logs/page DOM; the TLS bypass switch literal exists only in the dev-launch helper (source-pinned).
- Mission-13 carry-forwards all landed (latch pin, permission-Set comment guard, 302 endpoint, vault re-run disposition) — the carry-forward bundling rule worked.

## What Could Be Improved

### Process

- **DD7 (apparatus) failed in practice**: the pre-flight probe verified *liveness* (`enumerateTabs` responds), not *capability* (key tier per observable) or *provenance* (which instance the binding reaches). Three anomalies accumulated: jar-vs-admin tier gap; session MCP bound to a stale pre-edit instance (~30 min forensic cost, nearly false premise evidence); `captureWindow` timing out while a prompt holds a load. Future flights: the apparatus audit must enumerate each spec's observables against the session identity's **tier** and verify **instance identity** after any relaunch.
- Branch-start baseline gate should include `npm run a11y` — the pre-existing M12 sheet-sweep breakage would have surfaced at flight start, not mid-leg-02.
- Batched-commit artifact hygiene drifted (leg checkboxes, duplicate heading) until reviewers caught it — a mechanical flight-close artifact lint would catch this class.

### Technical

- **renderer.js budget ratcheted twice** (1701→1735→1766, ~+32 lines/sheet; file sits one line under its ceiling again). Extraction is now scheduled debt: do it before the next sheet-adding flight (Flight 2 may add popup UI) rather than paying a third bump.
- **a11y sheet sweep un-runnable since M12** (secret-sheet hardening refuses the audit's own driver). Two new sheets shipped with offline structural pins as compensation — honest but weaker than an axe pass. Needs an FD/security ruling (e.g. dev-only `!app.isPackaged` audit affordance); above leg authority.
- `ALLOWED_NONGUEST_SCHEMES`'s PDF-viewer comment is now empirically stale (the viewer renders as a guest subframe) — confirm the allowance isn't a dead wide grant, or update the comment.

### Documentation

- The stale-MCP-instance identity check belongs in `docs/mcp-automation.md` (currently only in the flight log).
- Lifecycle vocabulary: leg headers say `landed` while checklists say "set to `completed`" — agree on what "landed at batched-commit time" means for leg files.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| Behavior runs deferred without per-leg re-attempt (AC said "attempted") | Apparatus gap proven session-wide by leg-01 abort; re-attempts were deterministic ceremony | Yes — spec/flight prerequisites must name the required MCP key tier up front |
| Leg-04 premise check driven via sanctioned SDK-client path, not session MCP | Session MCP bound to a stale instance in an unreachable namespace | Yes — instance-identity verification before trusting live evidence |
| In-leg strictness additions (carve-out non-internal-guest; unconditional move force-exit) | Tightenings within the DD envelope | Yes — tightening-within-envelope needs no re-review |
| Legs 3→4 split at flight design review | Client-cert carried its own risk profile (TLS bypass, NSS mutation, state-machine extension) | Yes — split validated by execution |

## Key Learnings

1. **Premise checks with pre-made rulings per outcome** convert unknown-architecture risk into a cheap decision table — and pre-ruling the "code turns out unnecessary" branch prevents dead security relaxations from landing by momentum.
2. **Apparatus audits have three axes**: can it act, can it observe, and *is the session identity permitted to* — the third axis was this flight's blind spot (DD7 audited only the first two).
3. **Additive optional observer deps** (`onClosed`, `onExited` — no-op default, threaded at composition root) let new modules observe existing lifecycles without coupling; two uses this flight, both clean.
4. **Per-window challenge keying** (no token maps; the per-record manager carries identity) absorbed the second challenge kind for free and will absorb popup-multiplied windows the same way.
5. Live-evidence coverage at close is uneven by design: pdf effectively verified live, basic-auth strongly smoked, client-cert seam-only, **fullscreen zero** — and fullscreen is exactly the "DOM correct ≠ render correct" class unit tests cannot pin. HAT must verify it first.

## Recommendations

1. **Run the five-item deferred bundle in an admin-keyed session** (`GOLDFINCH_AUTOMATION_ADMIN=1`-style launch, endpoint registered for the Executor), ordered: fullscreen → basic-auth + vaultAnswerAuth + vault-login → client-cert (install `libnss3-tools`, run the import helper) → pdf. Until then mission criteria stay legitimately unchecked. **The mission's Flight 3 (Alignment/HAT) should be marked non-optional** — it now carries the only path to closing most Flight-1 criteria.
2. **Flight 2 must treat the per-contents parity checklist as grown by four rows** this flight created: challenge routing (unregistered popup guests silently cancel auth prompts — recreating the exact silent-failure class this mission kills), sheet presence (challenges hold forever without an owning sheet), fullscreen mode seeding/exit edges, and the `guardFrameNav` + `plugins` webPreferences shape. This is a strong architectural argument for hosting popup contents inside the existing registry/WebContentsView machinery.
3. **Flight 2's popup proposal should be grounded in a live premise check** (DD5's template): verify empirically whether Electron 43's `setWindowOpenHandler` create-window override preserves a live `window.opener` with WebContentsView-hosted contents, and what the returned contents' lifecycle looks like — before the human reviews the proposal.
4. **Schedule renderer.js extraction** before the next sheet-adding work; **resolve the a11y-sweep security ruling**; **add the PDF-viewer premise to the Electron-bump standing tax** (re-run the premise check on major bumps, beside the existing `node:sqlite` precedent).
5. Re-baseline the outgrown M07-era suite-duration criterion consciously (2993 tests @ ~2.8 s internal; count is the trustworthy metric, wall-clock is parallelism-noisy).

## Action Items

- [ ] HAT/admin-keyed session: run the deferred bundle (order above); install `libnss3-tools` first for client-cert
- [ ] Mark mission Flight 3 non-optional (owns the deferred bundle) — done in mission.md as part of this debrief
- [ ] Flight 2 pre-flight: live `setWindowOpenHandler`/opener premise check before the proposal goes to the human
- [ ] Flight 2 design: four new parity-checklist rows (challenge routing, sheet presence, fullscreen mode, nav-guard/plugins shape)
- [ ] Maintenance queue: renderer.js extraction; a11y sheet-sweep ruling; `ALLOWED_NONGUEST_SCHEMES` comment refresh; stale-instance check → `docs/mcp-automation.md`
- [ ] Electron-bump standing tax: re-run the PDF premise check on major bumps

## Test Suite Timing

2993 pass / 0 fail / 0 skipped, no flakes; 187 files; runner-internal ~2815 ms (`node --test`, parallelism-noisy — count is the comparable metric). Prior baselines: M12 close 2689 (~2100–2390 ms), M13 close 2840. Slowest tests all pre-existing (scrypt derivation 516 ms, session-log monotonic-id 566 ms); this flight added no slow-test class. M13's preload-rebuild watch item measured at ~0.04 s — still negligible.
