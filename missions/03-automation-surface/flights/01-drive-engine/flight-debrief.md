# Flight Debrief: Drive Engine (input / nav / tabs)

**Date**: 2026-06-13
**Flight**: [Drive Engine (input / nav / tabs)](flight.md)
**Status**: completed
**Duration**: 2026-06-13 (single session, `/agentic-workflow`)
**Legs Completed**: 6 of 6 autonomous (optional `hat-and-alignment` not run, by operator decision)

## Outcome Assessment

### Objectives Achieved

The native main-process **drive engine** — the *act* half of the automation surface — was built and
verified end to end. It navigates a tab, delivers trusted input (click / type / scroll / key), and
manages tab lifecycle (open / close / enumerate / activate), targeting **both** the chrome renderer
and guest `<webview>` contents, addressing tabs by `webContentsId`, under a foreground-to-act model.
Delivered as `src/main/automation/{resolve,tabs,nav,input,engine}.js` + `src/shared/automation-dev.js`
+ a chrome-renderer `window.__goldfinchAutomation` hook + a dev-gated invocation seam, with 137 new
unit tests and an FD-driven live smoke.

### Mission Criteria Advanced

- **SC1** (navigate), **SC2** (trusted input), **SC5** (manage tabs) — the *capability* is delivered
  and live-verified. Per the mission's interim-verification note these are *behavior-test-backed* only
  once the Flight 3 transport exists (migration in Flight 6); this flight advances them, does not close
  them. No mission SC checkbox is ticked yet (correctly).
- The hard constraints this flight had to honor were all upheld: native `webContents` implementation
  (no `--remote-debugging-port` path), no hostile-URL bypass (DD6), and the internal-session exclusion
  as the load-bearing control while ungated (DD5).

### Checkpoints

All six In-Flight checkpoints met: engine module + resolution + internal-session exclusion;
tab lifecycle via the renderer hook; native navigation with re-applied URL safety; trusted input on
chrome + a foregrounded guest; dev seam wired + live smoke; full unit suite + typecheck + lint green.

## What Went Well

- **Per-leg design review caught the highest-value class of bug.** Leg 4's `sendInputEvent` shape gaps
  — `mouseWheel` missing `canScroll: true` (Electron silently drops the scroll) and `mouseDown`/`mouseUp`
  missing the `buttons` bitmask — are *well-formed-but-silently-wrong* errors that unit tests cannot
  catch (a unit test validates the shape the builder emits, not whether Electron acts on it). They were
  fixed pre-implementation and then **confirmed correct by the Leg 6 live smoke**. This design-review →
  precise-spec → live-smoke chain is the flight's strongest methodology result.
- **The Electron-free pure-core + injected-deps pattern extended cleanly** to all four engine modules,
  with `engine.js` the single Electron-bound glue / automation entry point. This is now unambiguously
  the codebase's main-process module convention (third application after `internal-ipc.js` /
  `settings-store.js`).
- **DD5 held under the most demanding test.** The live smoke's AC7 step proved the internal
  `goldfinch://settings` guest is both absent from `enumerateTabs` AND rejected (`internal-session`)
  when its `wcId` is supplied directly to nav/input — the bypass path an enumerate filter alone would
  leave open is closed.
- **Both input spikes resolved with no recipe change.** The Leg-4 starting recipe actuated a real guest
  control and the coordinate space was confirmed guest-viewport-relative — the design-review's
  event-shape corrections were the substantive work; the live smoke was confirmation, not course-correction.
- **Test growth without cost.** +137 tests (358 total, 0 fail / 0 skip), wall-clock flat at ~0.22s
  because `node --test` parallelizes file-level suites.

## What Could Be Improved

### Process
- **Leg 4 ran on a single design-review pass despite substantive (event-shape) changes.** Defensible —
  the changes were the reviewer's own exact prescriptions and Leg 6's live smoke was the definitive
  backstop (and validated them) — but recorded as a conscious deviation from the "re-review if
  substantive" guidance, for traceability.

### Technical
- **Stale "Pending Leg 6 live confirmation" comments in `src/main/automation/input.js`** (module header,
  `mouseClickEvents` JSDoc) are now outdated — Leg 6 confirmed the recipe works as-built and coordinates
  are guest-viewport-relative. They should be updated to record the confirmed finding before Flight 2
  builds on top. *(Action item — not done in this debrief, which is documentation-only.)*
- **Two minor, documented type seams**: the `@ts-ignore` on `window.__goldfinchAutomation` in
  `renderer.js` (dynamic Window property; a `.d.ts` global augmentation would be cleaner) and the
  `Promise<boolean>`→`Promise<void>` cast in `engine.js` (`activateTab`'s result is unused by `actOn`).
  Both load-bearing until a small cleanup; neither is a defect.
- **The dev seam is real production-code that must be excised at Flight 3** — both the
  `ipcMain.handle('automation:dev-invoke', …)` block in `main.js` and the `automationDevInvoke` spread
  in `chrome-preload.js` (plus the `automation-dev.js` module + its 17 tests if the gate isn't reused).

### Documentation
- `CLAUDE.md` does not yet document the architectural facts a Flight-2/3 developer needs: (a)
  `src/main/automation/` as the engine home; (b) the `executeJavaScript` main→renderer command/read
  path and *why* (no `ipcRenderer.handle`); (c) the foreground-to-act contract + the `actOn`
  stale-handle re-resolve discipline; (d) `webContentsId` as the canonical automation handle; (e) the
  **"no release until Flight 4"** ungated-surface invariant. *(Action item.)*

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| `openTab` dom-ready **race guard** (attach listener → re-check `tab.wcId` immediately) — not in the original plan | dom-ready can fire before the Promise body runs, missing the listener | **Yes** — standard pattern for any renderer hook resolving on an async completion event |
| `actOn` **re-resolves the `webContents` after `await activate(wcId)`** | the pre-activate handle can go stale across the async activate; re-resolving also re-applies the DD5 guard post-activation | **Yes** — standard for any async-interleaved act sequence |
| Leg 6 **FD-driven** (not subagent-spawned) | headed GUI + iterative spike judgment is ill-suited to a batch subagent; matches the M02 "FD-driven runs with cited machine-read evidence" standard | Situational — correct for live-GUI verification legs |

## Key Learnings

- **Event-shape / wire-protocol correctness requires live verification even when unit tests pass.** The
  `canScroll`/`buttons` corrections were invisible to unit tests. For protocol-shaped work (CDP, native
  input events, IPC payloads), pair shape unit tests with a live smoke — the unit test pins the builder,
  the smoke pins that the platform acts on it.
- **`executeJavaScript` is a general main→renderer command/read mechanism**, not just a tab-ops
  workaround — Flight 2's DOM reads will reuse it, and the `window.__goldfinchAutomation` hook is the
  consolidated renderer-side extension point.
- **Strict `=== true` on session markers is a cross-module discipline** (`internal-ipc.js` + `resolve.js`);
  the deferred session-type registry must carry the same discipline when built.

## Recommendations

1. **Flight 2 must design the single-CDP-client resolution up front.** The observe engine needs
   `webContents.debugger` (`Accessibility.getFullAXTree` has no pure-JS path), but DD8 was forced by the
   cdp-driver occupying the single CDP-client slot during the smoke. Decide the stance
   (detach-on-demand / single-client lock / clear refusal vs DevTools-open) AND distinguish the two
   debugger uses: **admin-key debugger-on-internal** (the a11y tree of `goldfinch://settings` — the
   most-guarded capability) vs **jar-key debugger-on-guest**. Prefer `capturePage()` (debugger-free) for
   whole-window screenshots; reserve the debugger for what `capturePage()` can't do.
2. **Update `CLAUDE.md`** with the five automation architecture facts above, especially the
   no-release-until-Flight-4 invariant (CLAUDE.md is the primary developer-entry doc).
3. **Refresh the stale `input.js` "Pending Leg 6" comments** to the confirmed findings.
4. **Flight 3's spec must carry an explicit dev-seam-removal checklist** citing the two change sites
   (`main.js` handler + `chrome-preload.js` spread) and the `automation-dev.js`/test disposition; the
   transport must not widen the boundary (the chrome-renderer-only identity check is the precedent; the
   production equivalent is loopback bind + Origin/Host allow-list).
5. **Flight 4 must layer jar-scoping onto — not replace — `resolveContents`.** The `=== true` internal
   exclusion stays load-bearing after gating; jar-key scope enforcement (a presenting key may only see/
   drive its own jar's tabs) is a new step inserted around resolve. This is also where the **deferred
   session-type registry** (`WeakMap<Session, type>`, DD5) comes due — Flight 4/5 introduces the
   automation/jar session category that triggers it.

## Skill Effectiveness

- **Mission / Flight / Leg hierarchy worked well.** Dense, prescriptive leg specs paid off — the
  prescriptiveness is what let the design reviews catch the silently-wrong event shapes, and the
  pure-AC (offline-testable) vs live-AC (Leg 6) split kept each leg's acceptance gate within an
  autonomous agent's reach.
- **One spec gap**: Leg 5 did not foresee the `Promise<boolean>`/`Promise<void>` typecheck friction at
  the `activateTab → activate` injection boundary — the only real implementation surprise across six
  legs, and a minor one. Future legs wiring functions with differing return-type expectations across an
  injected-callback boundary should note the expected `void`-discard.
- **`/agentic-workflow` batch model** (design-review per leg; single code review + commit at the end)
  fit this flight cleanly — six legs, no escalations, no second design-review cycle needed, one
  confirmed code review.

## Action Items
- [ ] Update `CLAUDE.md`: `src/main/automation/` engine home; `executeJavaScript` main→renderer
  rationale; foreground-to-act + `actOn` stale-handle re-resolve; `webContentsId` canonical handle; the
  no-release-until-Flight-4 invariant. *(Carry into Flight 2 or a maintenance pass.)*
- [ ] Refresh stale "Pending Leg 6 live confirmation" comments in `src/main/automation/input.js` to the
  confirmed recipe/coordinate findings.
- [ ] Flight 2 spec: resolve the single-CDP-client conflict + the admin-debugger-on-internal vs
  jar-debugger-on-guest split before implementing observe.
- [ ] Flight 3 spec: dev-seam-removal checklist (`main.js` handler + `chrome-preload.js` spread +
  `automation-dev.js`/test disposition).
- [ ] Flight 4 spec: jar-scoping around `resolveContents` + the session-type registry decision.
