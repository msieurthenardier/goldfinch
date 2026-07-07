# Flight: Cross-View Keyboard Bridge & Admin-Wired Parity Sweep

**Status**: ready
**Mission**: [WebContentsView Migration](../../mission.md)

## Contributing to Criteria
- [ ] **SC6** — Automation (MCP) parity, no drift: every guest-addressing MCP tool works end-to-end;
  auth/origin gating, jar scoping, observe/act/find/nav/devtools ops all hold, proven on the new surface.
- [ ] **SC4** — Conveniences parity, *formal* net: the deferred Witnessed convenience corpus + `npm run a11y`
  (Flight 4 accepted SC4 via HAT and deferred the formal net on the apparatus-wiring blocker; this flight closes it).
- [ ] **SC5 (part)** — Privacy & trust preserved: the apparatus-gated security specs (internal-session
  exclusion, jar scoping, farbling, scheme guard) re-verified live on the native view surface.
- [ ] **Mission Known Issue** — Multi-`WebContentsView` chrome↔guest keyboard/focus bridging (F8 HAT): resolved
  in full (all three gaps), unblocking corpus runs that cross the chrome/guest boundary.

> **F5/F6 boundary (operator decision, DD1):** Flight 5 drains *everything that needs the live admin-wired
> apparatus* — the MCP automation corpus (SC6), the deferred convenience corpus + a11y (SC4), and the
> apparatus-gated privacy/trust specs (SC5). Flight 6 stays lean: the everyday **browsing / tab-strip /
> chrome-UI** corpus (SC3), the **macOS** build-readiness gate, and the **merge to `main`**.

---

## Pre-Flight

### Objective
Land the cross-view keyboard/focus fix that today blocks driving the corpus, then — in a **provably
admin-wired** session — run the full apparatus-gated behavior-test corpus on the native `WebContentsView`
surface, fixing any regressions, to certify automation parity (SC6), the formal conveniences net + a11y
(SC4), and the apparatus-gated trust model (SC5). This is the verification-heavy flight that Flight 4's
Leg-4 deferral and the mission's "automation parity sweep" both point at; its one genuine code deliverable
is the multi-view keyboard bridge, which must land first because the broken bridge blocks corpus runs.

### Open Questions
- [x] **Is an admin-wired venue available, or is standing one up the first leg?** → **Leg 1 stands it up +
  wiring litmus** (DD2). Resolved (operator).
- [x] **How much of the keyboard bridge to fix?** → **Full fix, all three gaps** (DD3). Resolved (operator).
- [x] **How to verify the keyboard fix?** → **New `chrome-guest-keyboard-nav` Witnessed spec** (DD4). Resolved.
- [x] **F4 housekeeping / terminology drift?** → **Fold the small items; park the sweep** (DD5). Resolved.
- [ ] **WSLg `{0,0}` find cold-start under `WebContentsView`** — does the M04 cold-start quirk still
  reproduce on the native surface? Answered when `find-in-page` runs (the defensive retry is already ported,
  F4 Leg 1); update `find-in-page.md` with the observed result.
- [ ] **Do any specs need a *functional* surface update (not just terminology)?** Expectation: **none** — the
  corpus drives by `wcId` through the MCP client, which survives the migration; `sendToHost` appears in zero
  specs. Confirmed spec-by-spec as each runs; any genuine functional dependency surfaced becomes in-flight work.
- [ ] **Ctrl+L on internal `goldfinch://` tabs** (leg-design). All current guest branches sit inside the
  `!__goldfinchInternal` guard (`main.js:997`), so a Ctrl+L branch added there stays dead on internal tabs.
  Intended default: Ctrl+L should focus the address bar on **both** web and internal tabs (it's a chrome-level
  accelerator, not a guest feature) — so the capture must live where it also fires for internal tabs (outside
  that guard, or via the renderer-keydown fallback path). Resolve at the keyboard-bridge leg.
- [ ] **Deterministic guest→chrome Tab target** (leg-design). After Tab leaves the guest, which chrome control
  receives focus, and does the handoff move **OS** focus to the chrome view (so the Step-6 chrome Tab-wrap
  operates on a genuinely focused chrome)? Pin at leg design.

### Design Decisions

**DD1 — Flight boundary: the automation/conveniences/trust cluster, gated on this flight's keyboard fix.**
F5 = SC6 (automation) + SC4 (conveniences + a11y) + SC5-apparatus (trust). F6 = the SC3 browsing / tab-strip /
chrome-UI corpus + macOS + merge.
- Rationale: the split is **thematic** (automation/conveniences/trust vs. everyday browsing/tab/chrome-UI) and
  keyed to **this flight's keyboard-bridge deliverable** — the F5 corpus is where the deferred F4 work lives and
  is the natural place to land alongside the fix. Note (corrected from an earlier draft): F6's corpus **also**
  requires the admin-wired apparatus (its specs use `getChromeTarget`/`captureWindow` — e.g. `core-browsing-shields`,
  `responsive-tab-strip`, `settings-shell`), so this is *not* "the only flight that needs the apparatus." The
  discriminator is theme + fix-dependency, not apparatus-need.
- Trade-off: a large flight (a fix + a wide sweep). Managed by clustering the corpus into thematic legs,
  each of which fixes the regressions it surfaces. The keyboard-bridge leg is apparatus-*independent*
  (HAT/unit-verifiable) so it can land even if the wiring litmus is slow to go green.

**DD2 — Apparatus-wiring litmus is a hard Leg-1 gate (the third apparatus axis).** Flight 4's Leg 4 failed
not on *act* or *observe* but on **wiring**: the session's `mcp__goldfinch__*` client was jar-authed to a
*foreign, pre-existing* instance (`enumerateTabs` showed a stray `work`-jar tab), so admin observables were
refused against a correctly-launched instance with a valid key. Before any Witnessed run, a litmus must
prove the client is bound to *this* instance at the required auth tier: `getChromeTarget()` returns this
instance's chrome `wcId`, and `enumerateTabs()` lists *this* instance's tabs (no foreign jar). Fail → the
leg parks; it does not silently pivot.
- Rationale: this is the single failure that sank the prior attempt; it is a static, checkable fact.
- Trade-off: none material — the litmus is seconds of cost.

**DD3 — Full three-gap keyboard bridge (scoped to the named gaps, not the whole accelerator union).** The
mission Known Issue (F8 HAT) names three gaps: (a) Tab can't leave the guest (no cross-view traversal); (b)
Ctrl+L is dead when a guest has focus — absent from the guest `before-input-event` set (`src/main/main.js:998`,
which today captures F12 / Ctrl+±0 / Ctrl+P / Ctrl+F / Ctrl+J / Ctrl+Shift+I but **not** Ctrl+L or Tab,
verified); (c) chrome Tab-order doesn't cycle. Two distinct mechanisms:
- **(b) Ctrl+L** — the accelerator-forwarding half **does** reuse the DD13 primitive: `src/shared/sheet-accelerator.js`
  already maps `l → focus-address` (chrome scope), forwarded via `getChromeContents()?.send(...)` (`main.js:402`)
  into the renderer's `dispatchChromeAction`/`focus-address` (`renderer.js:2318,2351`). Add a Ctrl+L branch to the
  guest handler that forwards on the same path. **Scope narrowed:** fix only the named gap (Ctrl+L), NOT the full
  chrome union — capturing Ctrl+R would seize the guest's native reload (ownership change), out of scope here.
- **(a) Tab handoff** — a **guest-specific** mechanism, NOT the shared mapper: `sheetAcceleratorAction` deliberately
  returns `null` for Tab (`sheet-accelerator.js:47`) so APG keys stay with a live menu sheet; **do not edit that
  module for Tab**. Add a separate guest→chrome focus handoff.
- **(c) chrome Tab-wrap** — chrome-renderer focus-order fix so Tab cycles without stranding focus on `<body>`.
- **OS-focus is load-bearing (not just DOM focus).** Forwarding `focus-address` only runs `els.address.focus()`
  (DOM focus, `renderer.js:2352`); for the address bar to actually *accept typing*, the chrome `WebContentsView`
  must hold **OS** keyboard focus, which currently sits in the guest. The handoff must call
  `getChromeContents().focus()` (the **focus-then-send rule**, F4) — the sheet's chrome branch (`main.js:399`)
  does **not** call `.focus()` and is therefore *not* a copyable template for this; copying it verbatim ships a
  focused-but-untypeable address bar. Acceptance includes address-bar *typeability*, not just DOM focus.
- Rationale: DD13 is a tested in-repo template for the accelerator-forwarding half; the Tab handoff and OS-focus
  are the genuinely new bits.
- Trade-off: cross-view focus routing is a render/focus-layer boundary the unit suite can't fully reach; the new
  Witnessed spec (DD4) is the net, and the pure mapper change is additionally unit-tested.

**DD4 — New `chrome-guest-keyboard-nav` Witnessed spec is the regression net.** Cross-view focus/traversal is
invisible to unit tests (view-layer) and to settled-frame captures; a dedicated Zephyr-style spec run under
the Witnessed pattern is the durable net. Authored as a draft in this planning; run in the keyboard-bridge
leg. The pure mapper extension is *additionally* unit-tested (extends the existing `sheet-accelerator` tests).

**DD5 — Fold the small F4 housekeeping; park the terminology sweep.** In F5: add the two F4-surfaced CLAUDE.md
conventions (the focus-then-send rule; the `isWebTab()`/`isInternalTab()` decision idiom) and fix the stale
`will-attach-webview` comments (`renderer.js:956`, `internal-preload.js:4`, `settings-store.js:64`). **Parked
for F6 / end-of-mission maintenance:** the repo-wide `<webview>`→`WebContentsView` terminology sweep across
~15 behavior specs and the `webview-preload.js` header (the mission's named maintenance item). These are
prose/terminology, not functional — no spec routes find via the dead element (`sendToHost`: zero hits).

**DD6 — Security-critical specs run early.** Per the mission constraint, `internal-session-exclusion` and
`mcp-jar-scoping` (the byte-exact partition-identity guards) run in the first corpus leg — a silent drift here
breaks either the internal trust boundary or MCP jar-scoping.

**DD7 — Apparatus premise audited on all three axes.** *Act:* the MCP drive tools (`openTab`/`navigate`/
`click`/`typeText`/`pressKey`/…) + the F9 `evaluate` tool over the loopback Streamable-HTTP transport (`npm run
dev:automation`, `GOLDFINCH_MCP_PORT` pinned). *Observe:* `readDom`/`readAxTree`/`captureScreenshot`/
`captureWindow` + `scripts/a11y-audit.mjs`. *Wiring:* the Leg-1 litmus (DD2). The `chrome-devtools` MCP does
**not** qualify — it launches its own browser (false pass against a non-Goldfinch process).

### Prerequisites
- [ ] **Admin-wired flight-5 instance** launched via `npm run dev:automation` with a valid admin key; **no
  foreign Goldfinch instance** running that the MCP client could bind to instead (the F4 failure mode).
  *Proven by the Leg-1 litmus, not assumed.*
- [ ] **`GOLDFINCH_MCP_PORT`** pinned (default `49707`) and exported once at launch; reused in all client/curl
  calls. Check it and the mcp-drive fixture port (`8090`) for conflicts with anything already running.
- [ ] Flight branch `flight/05-keyboard-bridge-and-parity-sweep` cut off `mission/05-webcontentsview-migration`
  (not `main`); working tree clean.
- [ ] `npm test` / `npm run typecheck` / `npm run lint` green at flight start (F4 baseline: 947/947).
- [ ] MCP client available (`scripts/mcp-example-client.mjs` or the SDK client); mcp-drive fixture servable
  from `tests/behavior/fixtures/mcp-drive-end-to-end/`.

### Pre-Flight Checklist
- [ ] All open questions resolved (two remain answered-on-run: find cold-start, per-spec functional-update check)
- [ ] Design decisions documented
- [ ] Prerequisites verified (esp. the wiring litmus — DD2)
- [ ] Validation approach defined (Witnessed corpus + a11y + unit tests + new keyboard-nav spec)
- [ ] Legs defined

---

## In-Flight

### Technical Approach
Land the keyboard bridge first (it gates corpus runs that cross the chrome/guest boundary), then sweep the
apparatus-gated corpus in security-first order, fixing regressions as they surface.

1. **Bring-up + wiring litmus (gate).** Launch the admin-wired instance; prove the MCP client is bound to
   *this* instance at admin tier (DD2). Record the exact launch recipe in the flight log for reuse.
2. **Cross-view keyboard bridge (code).** Extend the guest `before-input-event` capture set to the chrome
   accelerator union + guest→chrome Tab handoff + chrome Tab-wrap, on the DD13 primitive; unit-test the mapper
   extension; run the new `chrome-guest-keyboard-nav` Witnessed spec.
3. **Security + gating specs.** Run the trust-boundary guards early (`internal-session-exclusion`,
   `mcp-jar-scoping`) plus the two never-run gating specs (`tab-surface-geometry`, `internal-tab-menus`) and the
   remaining apparatus-gated privacy specs (`farbling-correctness`, `tab-scheme-guard`).
4. **Automation / MCP corpus (SC6).** The `mcp-*` suite + `automation-key-gating`, `settings-automation`,
   `foreground-to-act`, `observe-refusal-contract`, `devtools-cdp-conflict`.
5. **Conveniences corpus (SC4).** The F4-deferred set: `find-in-page` (answer the WSLg cold-start question and
   update the spec), `page-zoom`, `print-to-pdf`, `downloads-surface`, `page-context-menu`, `spellcheck`,
   `kebab-menu`, `menu-dismissal`.
6. **a11y + housekeeping.** `npm run a11y`; fold the F4 CLAUDE.md conventions and stale-comment fixes (DD5).

Each corpus run writes a committed run log (`tests/behavior/{slug}/runs/{ts}.md`); evidence stays in the
ephemeral `/tmp/behavior-tests/…` path (never committed). Regressions found are fixed in-leg on the guest/view
surface; any spec found to have a genuine *functional* `<webview>` dependency (not expected) is updated as
in-scope migration work.

### Checkpoints
- [ ] Wiring litmus green — client provably bound to this instance at admin tier (DD2)
- [ ] Keyboard bridge landed: all three gaps closed; `chrome-guest-keyboard-nav` Witnessed PASS; mapper units green
- [ ] Security + gating specs PASS (trust boundary + jar-scoping intact on the new surface)
- [ ] MCP automation corpus PASS (SC6)
- [ ] Convenience corpus PASS + find WSLg cold-start question answered & `find-in-page.md` updated (SC4)
- [ ] `npm run a11y` green (SC4 formal net)
- [ ] F4 housekeeping folded (CLAUDE.md conventions + stale comments)

### Adaptation Criteria

**Divert if**:
- The wiring litmus cannot be made green (no provably-bound admin session) — park the corpus legs; the
  keyboard-bridge leg may still proceed (it is HAT/unit-verifiable), but SC4/SC6 formal closure waits.
- A corpus run surfaces a *structural* regression (not a spec-terminology issue) that is larger than an in-leg
  fix — log it, and split it to its own flight rather than growing this landing (the F4/F7 discipline).

**Acceptable variations**:
- Re-clustering which specs run in which leg as the precise corpus is enumerated at leg-planning time.
- Answering the find cold-start question either way (retry stays as defensive belt-and-suspenders regardless).
- Pulling a settings-surface spec into F5 or leaving it to F6 based on whether it needs the admin apparatus.

### Legs

> **Note:** Tentative; legs are planned one at a time as the flight progresses. The corpus is clustered so each
> leg fixes the regressions it surfaces. Precise per-spec assignment is enumerated at the first corpus leg.

- [ ] `apparatus-bringup-and-litmus` — launch the admin-wired flight-5 instance; run + record the wiring litmus (DD2). **Hard gate.**
- [ ] `cross-view-keyboard-bridge` — full three-gap fix on the DD13 primitive; mapper unit tests; run the new `chrome-guest-keyboard-nav` Witnessed spec.
- [ ] `security-and-gating-specs` — `internal-session-exclusion`, `mcp-jar-scoping`, `tab-surface-geometry`, `internal-tab-menus`, `farbling-correctness`, `tab-scheme-guard`; fix regressions.
- [ ] `automation-mcp-corpus` — `mcp-drive-end-to-end`, `mcp-auth-gating`, `mcp-loopback-origin-guard`, `automation-key-gating`, `settings-automation`, `foreground-to-act`, `observe-refusal-contract`, `devtools-cdp-conflict`; fix regressions (SC6).
- [ ] `conveniences-corpus` — `find-in-page` (+ answer WSLg cold-start, update spec), `page-zoom`, `print-to-pdf`, `downloads-surface`, `page-context-menu`, `spellcheck`, `kebab-menu`, `menu-dismissal`; fix regressions (SC4).
- [ ] `a11y-and-housekeeping` — `npm run a11y`; fold F4 CLAUDE.md conventions + fix stale `will-attach-webview` comments (DD5).
- [ ] `hat-and-alignment` *(optional)* — guided HAT over the keyboard bridge + any surface that surprised the corpus.

---

## Post-Flight

### Completion Checklist
- [ ] All legs completed (or explicitly parked with rationale in the flight log)
- [ ] Keyboard bridge merged; mission Known Issue marked resolved
- [ ] Full apparatus-gated corpus PASS with committed run logs; regressions fixed
- [ ] `npm run a11y` green; `npm test` / `typecheck` / `lint` green
- [ ] `find-in-page.md` updated with the observed WSLg cold-start result
- [ ] F4 housekeeping folded; CLAUDE.md conventions recorded
- [ ] Merged to `mission/05-webcontentsview-migration` (`main` untouched)

### Verification
- **SC6**: the `mcp-*` + automation corpus PASS end-to-end over the loopback transport on the view surface.
- **SC4 (formal)**: the convenience corpus PASS + `npm run a11y` green — closing the F4 HAT-only acceptance.
- **SC5 (part)**: `internal-session-exclusion` + `mcp-jar-scoping` + `farbling-correctness` + `tab-scheme-guard`
  PASS — trust model intact on the native surface.
- **Keyboard bridge**: `chrome-guest-keyboard-nav` Witnessed PASS (all three gaps) + mapper unit tests; mission
  Known Issue closed. macOS parity for the fix carried to the **F6 macOS gate** (add cross-view Tab + Ctrl+L-from-guest
  as HAT steps — per the F4 debrief's macOS-gate-widening note).
