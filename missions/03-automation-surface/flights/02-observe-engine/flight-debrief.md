# Flight Debrief: Observe Engine (screenshot / DOM / a11y)

**Date**: 2026-06-13
**Flight**: [Observe Engine (screenshot / DOM / a11y)](flight.md)
**Status**: landed
**Duration**: 2026-06-13 (single session — planning carried in; execution + live verification same day)
**Legs Completed**: 6 of 6

## Outcome Assessment

### Objectives Achieved

The native main-process **read half** of the automation surface is built and live-verified. `src/main/automation/observe.js` adds, on the foreground tab and targeting both the chrome renderer and guest `<webview>`s:
- `captureScreenshot` (foreground-first for guests, base64 PNG, injectable paint-settle) + `captureWindow` (whole window — chrome + composited guest);
- `readDom` via `executeJavaScript` → full-fidelity `{url,title,html}`;
- `readAxTree` via in-process `webContents.debugger` (`attach('1.3')` → `Accessibility.enable` → `getFullAXTree` → `detach()` in `finally`) — the engine's **only** debugger use, with a synchronous single-client lock and a clean returned `debugger-unavailable` refusal.

All four ops are wired into `engine.js`'s dispatch and auto-exposed through the existing dev seam (no `main.js` edit). The surface stays ungated (no release until Flight 4).

### Mission Criteria Advanced

- **SC3** (read DOM + accessibility tree) and **SC4** (screenshot) — the **native read capability** is delivered and live-confirmed. Per the mission's interim-verification note, the *behavior-test backing* for SC3/SC4 lands with the Flight-3 transport (the attach half) and the Flight-6 spec migration; this flight advances but does not close them.
- Resolved the flight's chief live unknown: `webContents.debugger.attach('1.3')` + `Accessibility.enable` + `getFullAXTree` **works on a guest `webContents` on Electron ^42** (163-node tree on google.com), and `enable`-before-`getFullAXTree` is the required sequence.

### Checkpoints

All six flight checkpoints met (scaffold+screenshot, DOM, a11y, engine+docs, live smoke, guided HAT). The HAT's DevTools-conflict checkpoint was met in substance (refusal contract confirmed) but its *specific trigger* was apparatus-limited — see Deviations.

## What Went Well

- **Flight-1 conventions transferred cleanly.** All three guest-facing ops reuse the `resolveContents`/`classifyContents`/`activate` core and the `input.js actOn` resolve→activate→**re-resolve**→act discipline verbatim. No new resolution or security logic; the injected-deps / electron-free-at-top / `// @ts-check` style is uniform.
- **Per-leg design review caught two real spec defects before any code was written** — the DD2 `a11y-audit.mjs` mis-citation (it uses CDP `Runtime.evaluate` to bypass CSP, the opposite of `executeJavaScript`) and the DD8 throw-vs-return contradiction (DD says "returns," leg-list bullet said "thrown"). Both were resolved at design time and recorded as Decisions.
- **The a11y debugger lifecycle is exhaustively unit-tested.** 14 cases cover the happy path (attach `'1.3'`, enable-before-tree ordering, detach-in-finally, lock release), empty-tree-is-success, attach-throw refusal (no detach, lock released), the concurrent-lock refusal (deferred-promise technique), sendCommand-error propagation, and detach-throws-must-not-mask in *both* directions. The counter-backed `fromId` re-resolve proof is a genuine behavioral assertion, not a mock check.
- **DD6 internal-session exclusion held live** for all three observe ops (settings guest excluded from `enumerateTabs` *and* directly-supplied internal wcId thrown) — the load-bearing security property while the surface is ungated.
- **Two Flight-1 debrief carry-forwards closed** on the shared automation surface (stale `input.js` comments refreshed; `CLAUDE.md` Automation section added).
- **Honest verification.** The DD8 apparatus confound (surfaced by the operator) was recorded as a limitation rather than papered over with a false "pass."

## What Could Be Improved

### Process
- **DD↔leg-bullet consistency is a spec-review gap.** The throw-vs-return contradiction lived *inside the flight spec* (a DD disagreeing with a leg-list bullet). It was caught at leg-design review, but the ideal catch point is flight design. Add a lightweight pre-execution pass that cross-checks semantic commitments in leg bullets against the authoritative DD section.
- **No leg-recovery clause for "file already exists."** Leg 1's first implementation attempt was interrupted by an infrastructure/access error after `observe.js` was written but before tests. Recovery worked (the next agent validated the file against the AC and kept it), but the leg spec didn't anticipate the case. A general methodology note — "if a to-be-created file already exists, validate against AC before regenerating" — would make recovery deterministic.

### Technical
- **`captureScreenshot` opts-spread footgun.** `engine.js`: `observe.captureScreenshot(wcId, { ...deps(), ...opts })` lets any `opts` key silently override injected deps (`fromId`/`chromeContents`). A comment guards it, but nothing enforces it. **Resolve before Flight 3 solidifies the API** — restructure so `delayMs`/`waitForPaint` are a separate named third argument rather than merged into the deps bag.
- **`READ_DOM_SNIPPET` two-sources-of-truth.** The module-private snippet is mirrored byte-for-byte in the test as `EXPECTED_READ_DOM_SNIPPET`. Failure mode is a loud test failure (not a silent bug), so the risk is bounded — but it adds a maintenance touchpoint. Either export the const for test-only import, or assert the snippet's behavioral properties instead of its exact text.
- **Structurally untested branches:** `defaultWaitForPaint`'s `did-stop-loading` (mid-navigation) fallback, `captureWindow`/`readDom` post-resolve failures (`capturePage`/`executeJavaScript` rejecting), and that `delayMs` actually reaches `waitForPaint` through the engine spread. All require either an Electron runtime or a small extra fake; none block landing.

### Documentation
- `CLAUDE.md` Automation section is in place and prose-only (no flight-scoped DD numbers — appropriately durable). No further doc gaps for this flight. The `backendNodeId`/`frameId` stale-on-detach caveat is documented in JSDoc and should become an explicit **design constraint in the Flight-3 spec** for any action-by-a11y-handle feature.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| `debugger-unavailable` is a **returned** discriminated object, not a thrown error | DD8 vs leg-list bullet contradiction; resolved in favor of DD8 — a busy debugger is an *expected operational condition*, not a programmer/security error (those still throw via `resolveContents`) | **Yes** — adopt "operational-condition → return discriminated result; programmer/security error → throw" as the engine-wide contract |
| DD2 precedent re-cited from `a11y-audit.mjs` to `engine.js:35` | The audit script uses CDP `Runtime.evaluate` to bypass CSP — the opposite mechanism of `executeJavaScript` | Audit "cites-as-precedent" claims in DDs for *mechanism* fidelity, not just outcome similarity |
| `defaultWaitForPaint` fixed-delay-primary / `did-stop-loading`-fallback branching | Implementation refinement (Acceptable Variation) — the common case is an already-loaded foreground guest with no load event to await | No — leg-local judgment, correctly within the divert envelope |
| **DD8 DevTools-conflict live test did NOT trigger — apparatus-limited** | The dev seam is only reachable over `--remote-debugging-port`, which puts Chromium in multi-session CDP mode and relaxes the one-client-per-contents exclusivity the test assumes; DevTools-open + in-process attach both succeeded. Confounded by construction. **Operator disposition: land; defer real-conflict verification to the Flight-3 transport.** | N/A — the *finding* is the lesson: a live conflict test driven over a CDP port can't observe CDP-exclusivity behavior |

## Key Learnings

- **Verification apparatus can confound the property under test.** The single most important learning: because the only way to reach the engine live is over `--remote-debugging-port`, *every* live invocation this flight carried a CDP connection — so the CDP-single-client-conflict behavior (the exact thing DD8's live test wanted to observe) was unobservable. The `attach-failed` refusal stays unit-tested (authoritative for the code path) and the `locked` refusal is live-confirmed; the *trigger* must be re-verified under the Flight-3 transport, which has no port. The mission's CDP-single-client Open Question is **reframed and deferred**, not resolved.
- **The injected-deps + foreground-to-act + re-resolve shape is now proven across read and write ops** (input + all three observe ops). It is the universal template for any future tab-targeted op.
- **The synchronous `Set` lock (check+add with no `await` between) is the correct exclusive-resource shape**, and has a clean upgrade path to a `Map<wcId, Promise>` if a future flight wants concurrent-read coalescing instead of a `locked` refusal.

### Test Metrics (this run, 2026-06-13)

- Full suite `node --test test/unit/*.test.js`: **391 tests / 391 pass / 0 fail / 0 skip / 0 todo**, wall-clock **~140–160 ms** (two back-to-back runs, no flakes). `observe.js` suite alone: 33 pass / ~48 ms. `npm run typecheck` clean; `npm run lint` clean.
- **Delta vs Flight 1 debrief** (358 total at Flight-1 close): **+33** this flight — 10 (screenshot/window) + 9 (DOM) + 14 (a11y); legs 4–6 added no unit tests (wiring/integration only). Wall-clock *dropped* (~220 ms → ~150 ms) — attributable to `node --test` running the now-14 test files concurrently rather than a linear measure; not a real speedup of any single suite. No new skips, no flakes, no failures introduced.

## Recommendations

1. **Resolve the `captureScreenshot` opts-spread footgun before Flight 3 exposes the engine API** — separate `delayMs`/`waitForPaint` from the injected-deps bag so an over-supplied `opts` can't silently replace live Electron handles.
2. **Flight 3 must not re-introduce `--remote-debugging-port`** (its CI/smoke harness drives via the new loopback transport), and its integration verification must include the **genuine** DevTools-conflict test: open DevTools on a tab → `readAxTree` → confirm the `attach-failed` refusal. This closes the mission's CDP-single-client Open Question without the apparatus confound.
3. **Add a flight-design consistency pass** that cross-checks leg-list bullets against the authoritative DD section for semantic contradictions (the throw-vs-return issue would have been caught at flight design, not leg design).
4. **Make the `backendNodeId`/`frameId` stale-on-detach caveat an explicit Flight-3 design constraint** — action-by-a11y-handle needs a re-attach + re-query round trip; snapshot IDs from a prior `readAxTree` are stale.
5. **Standardize the "operational-condition → return discriminated result; error → throw" contract** engine-wide, and have the Flight-3 transport decide *consistently* whether a returned refusal maps to a structured MCP error or a first-class tool result (documented, not silently swallowed).

## Action Items

- [ ] **Flight 3**: restructure `captureScreenshot`/`readAxTree` opts so caller-tunable params are a named argument, not a deps-bag spread (rec. 1).
- [ ] **Flight 3**: run the real DevTools-conflict test under the loopback transport (no `--remote-debugging-port`) and record whether `attach-failed` triggers; update the mission CDP-single-client Open Question with the result (rec. 2).
- [ ] **Flight 3 planning**: **draft the Witnessed behavior-test specs** (foreground-to-act, internal-session exclusion, the refusal contract, the DevTools conflict) during Flight-3 planning — do not wait for Flight 6 (operator decision, 2026-06-13). Flight 6 remains the migration/run target; this stops the spec debt accumulating across Flights 1→2→3.
- [ ] **Flight 3 spec**: capture the `backendNodeId`/`frameId` stale-on-detach caveat as a design constraint for action-linking (rec. 4).
- [ ] **Methodology** (mission-control): add a flight-design DD↔leg-bullet consistency check (rec. 3) and a leg "file-already-exists → validate against AC" recovery clause. *(Cross-repo — for the mission-control skills, not goldfinch.)*
- [ ] **Tech-debt (low, optional)**: resolve the `READ_DOM_SNIPPET` two-sources-of-truth (export-for-test or behavioral assertion); add the structurally-untested-branch coverage when next touching `observe.js`.
