# Flight 2: Popup & Opener Ruling + Implementation

**Status**: planning
**Mission**: [Web Compatibility — Silent Failures Become Working Features](../../mission.md)

## Contributing to Criteria

- [ ] A popup-based OAuth sign-in completes end to end against the local fixture (opener relationship, result delivery, self-close) *(behavior-test-backed)*
- [ ] The popup handling approach is recorded as a human-approved design ruling with a per-contents parity checklist
- [ ] Script-opened popups are visible to the automation surface (`enumerateTabs`/`enumerateWindows`)
- [ ] Live GitHub OAuth witnessed run — **delivered in Flight 3 (HAT)**, not here
- [ ] No regression of mission-13 posture

## Pre-Flight

### Objective

Decide — with the human — how goldfinch handles script-opened popups, then implement the approved ruling so the OAuth popup pattern works end to end with full guest-discipline parity (auth challenges, census, nav guards, self-close) for whatever form popups take.

### Open Questions

- [ ] **THE gate**: which proposal option — see [popup-proposal.md](popup-proposal.md) (recommendation: Option A, popup-as-adopted-tab). **Human ruling required before any implementation.**
- [x] Does Electron 43's `createWindow` override preserve a live opener with WebContentsView-hosted contents? → YES, by adopting `options.webContents` (spike-verified; see flight log)
- [x] Is the popup's session controllable? → NO — automatically the opener's session; `partition` overrides silently ignored (spike-verified)
- [ ] Genuine-popup detection details (features/named-target heuristic edge cases) → leg design, post-ruling
- [ ] Chrome/tab-strip adoption channel shape → leg design, post-ruling

### Design Decisions

**DD1 — Popup ruling**: *pending human approval of the proposal.* The approved option becomes this DD verbatim, with the proposal's parity checklist as the leg acceptance skeleton.

**DD2 — Adopt-hook taboo (unconditional, whatever the ruling)**: if the `createWindow` path is used, it must return `options.webContents` and nothing else — returning any other contents permanently wedges the opener renderer with no error (spike-observed). Source-scan pin required.

**DD3 — Scope guard (proposal-shared, review-hardened)**: only genuine popup requests (window `features` present, or named non-`_blank` target) with an `isSafeTabUrl`-passing URL from a **non-internal** opener take the new path; internal openers, unsafe URLs, and plain `target=_blank` keep deny(-and-convert). The catch-all deny (`app-lifecycle.js:126`) stays for non-guest surfaces. Rationale: the adopt path bypasses the renderer `createTab` gate — single-point enforcement must carry the full predicate.

**DD4 — Apparatus (debrief carry-forward; shape assumes Option A — re-derive if B)**: the fixture OAuth behavior spec's observables are page-DOM + census reads (no window-level captures required) — runnable under a jar-scoped identity **if** the instance binding is verified current (stale-instance check per the maintenance-queued `docs/mcp-automation.md` note). The live-provider run stays in Flight 3.

**DD5 — Renderer budget pre-decision (debrief carry-forward)**: the adoption UI is expected to reuse existing tab-strip machinery with no new sheet; if leg design discovers a new sheet or a >trivial `renderer.js` addition, the renderer.js extraction happens **first** — no third budget ratchet.

### Prerequisites

- [x] Flight 1 landed (challenge store, `guardFrameNav`, fullscreen mode — the parity rows popups must satisfy; its mission criteria close at Flight 3)
- [x] Spike premise check complete and recorded (flight log)
- [ ] **Human ruling on the proposal** — blocks everything below
- [ ] Renderer budget: chrome/tab-strip adoption UI may touch `renderer.js` — the debrief's extraction recommendation may be triggered; decide at leg design

### Pre-Flight Checklist

- [ ] Ruling approved and recorded as DD1
- [ ] Legs defined post-ruling
- [x] Premise verified
- [x] Proposal authored

---

## In-Flight

### Technical Approach

Post-ruling. Anticipated (Option A): the adopt hook in `guest-wiring.js`'s `setWindowOpenHandler` path + a popup-adoption seam in `register-tab-ipc.js`/chrome; legs sized at the decision seams (adoption mechanics + parity wiring; fixture spec + census). Sequential legs, single writer on this log, batched commit per the standing workflow.

### Legs

> Defined after the human ruling. Tentative: `popup-adoption` (hook, registration, teardown, parity wiring), `oauth-fixture-verification` (fixture endpoints + behavior spec + census assertions).

---

## Post-Flight

### Completion Checklist

- [ ] All legs completed
- [ ] Tests passing (full gates)
- [ ] Documentation updated
- [ ] Deferred items handed to Flight 3 (live GitHub run)

### Verification

- Behavior spec (new): `web-compat-oauth-popup` against the fixture — opener handle, token delivery, self-close, census visibility
- Unit: adopt-hook taboo pin, teardown matrix, parity-row cases in the existing store/fullscreen/guard matrices
