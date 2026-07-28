# Flight 2: Popup & Opener Ruling + Implementation

**Status**: landed
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

- [x] **THE gate**: which proposal option → **Option B (real BrowserWindow popups), human-ruled 2026-07-28** — see [popup-proposal.md](popup-proposal.md) and DD1.
- [x] Does Electron 43's `createWindow` override preserve a live opener with WebContentsView-hosted contents? → YES, by adopting `options.webContents` (spike-verified; see flight log)
- [x] Is the popup's session controllable? → NO — automatically the opener's session; `partition` overrides silently ignored (spike-verified)
- [ ] Genuine-popup detection details (features/named-target heuristic edge cases) → leg design
- [ ] Popup registry shape + census wire format; sheet copy for popup-attributed challenges → leg design

### Design Decisions

**DD1 — Popup ruling (HUMAN-APPROVED 2026-07-28): Option B — real `BrowserWindow` popups.** Genuine popup requests (per DD3's predicate) return `{action:'allow', overrideBrowserWindowOptions}`; the popup is a native floating window with a live opener (spike-verified: handle, bidirectional postMessage, opener's jar session automatic). The human accepted B's stated cost: parity is re-implemented, not inherited. Sub-decisions:
- **DD1a — Popup registry, census, AND addressability**: popups register in a main-side popup registry keyed to the opener's WindowRecord (created on `did-create-window`, removed on `closed`). `enumerateWindows` gains popup entries; `enumerateTabs` gains popup-contents rows under the same jar-visibility rules as tabs. **Addressability** (design review): the DD8 defense-in-depth gate (`resolve.js:141` `isTabViewWcId` refusal) must widen to a popup-registry-aware predicate so jar keys can *drive* popups they can see (`click`/`typeText`/`vaultFill` etc.), honoring the three-place-registration discipline `scope.js` pins. Admin/jar tier semantics preserved.
- **DD1b — Challenge routing (store-contract change, not a routing-ladder addition)**: three code walls named by design review, all in scope: (1) routing — popup challenges enqueue on the **opener's** WindowRecord; (2) **eligibility** — `presentNext`'s `c.wcId === activeTabWcId` test gains a popup rule: a popup challenge is eligible when its **opener tab** is the window's active tab; (3) **presentation** — resolve the **opener's** chrome (`chromeForTab(popup)` misses by construction); plus (4) a popup-destroyed → resolve-cancel trigger (the `notifyTabClosed` analogue). Prompts present on the opener window's sheet with a popup marker in the copy. The store matrix gains popup cases for every bucket.
- **DD1c — Guest discipline on popup contents**: `wireGuestContents`-equivalent wiring; `guardNav` trio + `guardFrameNav` wrapper; **latch timing gets its own in-leg premise check** (the spike observed latch safety in the adopt hook, NOT under plain allow/`did-create-window`; losing the race would hand the popup the *wider* non-guest `ALLOWED_NONGUEST_SCHEMES` shape — pre-ruled fallback: if `did-create-window` proves too late, latch in the `web-contents-created` catch-all keyed off a pending-popup registry entry created synchronously in the window-open handler). Popup **HTML fullscreen** delegates to Electron's native BrowserWindow handling (`htmlFullscreen` module not involved; assert non-interference). Popup **history records under the opener's jar** (it is real browsing in that jar; wire the recorder in popup wiring).
- **DD1d — Close discipline & preload**: inject the guest preload via `overrideBrowserWindowOptions.webPreferences.preload` and extend the `guest-window-close` handler to recognize popup wcIds (destroy the popup's BrowserWindow) — the spike proved the shim otherwise no-ops silently. The in-leg premise check covers the **full webPreferences posture** in the exact allow+override combination: preload honored, `contextIsolation:false` (farbling main-world requirement), `sandbox:true`, `nodeIntegration:false` (partition is known-ignored).
- **DD1e — Persistence**: popup windows are transient — excluded from session snapshot/restore and closed-tab capture (structurally free under B: popups never enter `tabViews`; pin it anyway).
- **DD1f — Opener-window close (FD ruling)**: popups **close with their opener's window** this flight — orphan re-keying (dead WindowRecord, dangling census rows, unroutable challenges) is complexity without a mission payoff; OAuth popups are transient by nature. Divergence from mainstream browsers documented; revisit at HAT if it grates. Teardown order: cancel popup challenges → destroy popup windows → window teardown proceeds.
- The proposal's parity checklist becomes the leg acceptance skeleton, with every "bought by registry membership" row converted to explicit implementation + pin.

**DD2 — Adopt-hook taboo (unconditional, whatever the ruling)**: if the `createWindow` path is used, it must return `options.webContents` and nothing else — returning any other contents permanently wedges the opener renderer with no error (spike-observed). Source-scan pin required.

**DD3 — Scope guard (proposal-shared, review-hardened)**: only genuine popup requests (window `features` present, or named non-`_blank` target) with an `isSafeTabUrl`-passing URL from a **non-internal** opener take the new path; internal openers, unsafe URLs, and plain `target=_blank` keep deny(-and-convert). The catch-all deny (`app-lifecycle.js:126`) stays for non-guest surfaces. Rationale: the adopt path bypasses the renderer `createTab` gate — single-point enforcement must carry the full predicate.

**DD4 — Apparatus (re-derived for Option B)**: the fixture OAuth behavior spec's core observables remain page-DOM reads (opener `#result` token, popup self-close via the opener handle's `.closed`) — jar-scoped-runnable. The census assertions (`enumerateWindows` popup entries) are **admin-tier** — that portion joins the Flight 3 admin-keyed bundle if the session key is jar-scoped at run time. Instance binding verified current before any live evidence is trusted. The live-provider run stays in Flight 3.

**DD5 — Renderer budget pre-decision (debrief carry-forward)**: the adoption UI is expected to reuse existing tab-strip machinery with no new sheet; if leg design discovers a new sheet or a >trivial `renderer.js` addition, the renderer.js extraction happens **first** — no third budget ratchet.

### Prerequisites

- [x] Flight 1 landed (challenge store, `guardFrameNav`, fullscreen mode — the parity rows popups must satisfy; its mission criteria close at Flight 3)
- [x] Spike premise check complete and recorded (flight log)
- [x] **Human ruling on the proposal** — Option B, 2026-07-28
- [x] Renderer budget: DD5 pre-decision — popup-attributed sheet copy is expected to be a template-model tweak, not a new sheet; if leg design finds otherwise, extraction first

### Pre-Flight Checklist

- [x] Ruling approved and recorded as DD1
- [x] Legs defined
- [x] Premise verified
- [x] Proposal authored

---

## In-Flight

### Technical Approach

Option B: `setWindowOpenHandler` returns allow+override for DD3-qualifying requests (`guest-wiring.js:89` site); `did-create-window` registers the popup in a new main-side popup registry (Electron-free DI module) keyed to the opener's record; popup contents get guest-discipline wiring (DD1c) and preload (DD1d); challenge routing gains the popup→opener resolution (DD1b); census tools gain popup rows (DD1a); persistence exclusion (DD1e). Legs sized at decision seams: popup mechanics + discipline, then census/challenge parity + fixture verification. Sequential legs, single log writer, batched commit per the standing workflow.

### Legs

- [x] `popup-windows` — handler predicate, registry, wiring, preload+close discipline, teardown, persistence exclusion (landed 2026-07-28)
- [x] `popup-parity-and-fixture` — census rows, challenge routing to opener sheet, addressability widening, OAuth fixture endpoints + behavior spec (landed 2026-07-28)

---

## Post-Flight

### Completion Checklist

- [ ] All legs completed
- [ ] Tests passing (full gates)
- [ ] Documentation updated
- [ ] Deferred items handed to Flight 3 (live GitHub run)

### Verification

- Behavior spec (new): `web-compat-oauth-popup` against the fixture — opener handle, token delivery, self-close, census visibility (census portion admin-tier per DD4)
- Unit: **no-`createWindow`-override pin at the allow site** (B's sharper inverse of the adopt-hook taboo), popup registry/teardown matrix incl. DD1f order, store popup cases for every bucket, addressability-predicate cases (jar key drives popup / refuses foreign-jar popup), latch + webPreferences premise results recorded in the flight log
