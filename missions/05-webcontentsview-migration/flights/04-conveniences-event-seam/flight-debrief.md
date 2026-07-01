# Flight Debrief: Conveniences & Event-Seam Re-architecture

**Date**: 2026-06-30
**Flight**: [Conveniences & Event-Seam Re-architecture](flight.md)
**Status**: landed
**Duration**: 2026-06-26 (planned) → 2026-06-30 (landed)
**Legs Completed**: 4 of 5 (Legs 1, 2, 3, 5 completed; Leg 4 DEFERRED — apparatus)

## Outcome Assessment

### Objectives Achieved

The flight finished the event-seam migration and proved conveniences parity on the native view surface —
reshaped from the mission's "budgeted as a rewrite" framing once reconnaissance found Flight 3 had already
re-homed nearly every seam. Delivered:

- **Find re-home (Leg 1):** the dead Deviation-D1 `<webview>` injection deleted; the `findInPage`/
  `stopFindInPage` MCP ops re-homed to operate on the guest `webContents`'s `found-in-page` event,
  correlated by Electron `requestId`, with the cold-start retry ported. Fixed a latent pre-existing bug
  (the post-activate re-resolve was discarded). Unit test rewritten from injection-string assertions to a
  23-test event-listener model — a net coverage-quality gain.
- **Active-view consolidation (Leg 2):** `visibleWebTabWcId` → single `activeViewWcId` concept +
  `isWebTab()`/`isInternalTab()` predicate across 14 decision sites; not-ready branches collapsed;
  substrate-guard audit recorded.
- **Docs & spec cleanup (Leg 3):** CLAUDE.md `<webview>` → WebContentsView sweep + freeze-frame /
  `capture-active-guest` / `INTERNAL_PARTITION` notes; drifted `farbling-correctness.md` citation + stale
  comments corrected.
- **HAT (Leg 5):** all steps pass; surfaced + fixed a real Flight-3 find-focus regression inline.

### Mission Criteria Advanced

- **SC4** (conveniences parity + event-seam re-home) — **accepted via the HAT** for this landing. Formal
  Witnessed-corpus + a11y verification is DEFERRED (apparatus; see below).
- **SC6 (partial)** — the `findInPage`/`stopFindInPage` MCP ops are code-complete on the view surface;
  live match-count re-verify is deferred with the corpus.

Not all checkpoints were met: the convenience-corpus checkpoint is deferred. Value delivered is real and
merged (`mission/05`, `main` untouched).

## What Went Well

- **Reconnaissance earned its keep.** Walking every debrief-cited item against current code reshaped a
  "rewrite"-budgeted flight into its true small shape (`find.js` the lone live seam) — avoiding wasted
  leg churn on already-satisfied items.
- **Design-review-before-execution caught load-bearing errors at planning** (DD1 narrowing; DD2 reframe;
  the DD4 apparatus correction making `readDom` of `#webviews backgroundImage` the authoritative freeze
  tell and demoting WSLg-fallback `captureWindow` pixels to corroborating). All held up.
- **Find re-home is architecturally clean** — consistent with every other automation op (resolve →
  guard → act on `wc`), electron-free, `requestId`-correlated for concurrent finds; the MAX-retry-resolves
  -`last` fix improved on the old spin-until-timeout behavior.
- **Test quality improved, not just changed.** Old find tests asserted injected *code strings*; the new
  suite exercises runtime behavior (correlation, cold-start re-issue, timeout fallback, listener hygiene,
  internal-refusal-before-activate). 947/947, 0 skipped.
- **The HAT did exactly its job** — it surfaced the find-focus regression that was invisible to both the
  unit suite and the automated apparatus, and the inline fix + operator re-verify was proportionate.
- **Spike-before-build paid off.** The overlay-find-bar idea was de-risked by an *in-goldfinch* spike
  (green) rather than building blind; the standalone spike's inconclusive WSLg result validated doing
  compositing spikes in-goldfinch, not standalone.
- **Disciplined scope control** — the overlay re-architecture was spun out to Flight 7 with a proven
  spike + reviewed design rather than ballooning Flight 4's landing.

## What Could Be Improved

### Process

- **Apparatus premise needs a third axis: WIRING.** Leg 4 was blocked not because the apparatus didn't
  exist, but because the in-loop session's `mcp__goldfinch__*` client was **jar-authed and wired to a
  pre-existing, unrelated instance** (`enumerateTabs` showed a foreign `work`-jar tab) — so the
  admin-only observables (`getChromeTarget`, `captureWindow`) were refused despite a correctly-launched
  flight-4 instance with a valid admin key. The flight's design audited the apparatus on *act* and
  *observe* axes but not *wiring*. **Recommendation (methodology):** for any leg gated on the behavior-test
  apparatus, add an explicit pre-leg **apparatus-wiring litmus** to the prerequisites — confirm before any
  Witnessed run that a litmus op proves the client is bound to *this* instance at the required auth tier
  (e.g. `getChromeTarget()` returns a chrome wcId; `enumerateTabs()` lists *this* instance's tabs, not a
  foreign session's). If it fails, the leg parks rather than silently pivoting.

### Technical

- **Verification gaps (not code debt) carried forward:** the two new specs (`tab-surface-geometry`,
  `internal-tab-menus`) have never run; `npm run a11y` has not run since the Leg-2 changes; the WSLg
  cold-start `{0,0}` question for `findInPage` under `WebContentsView` is unanswered (retry ported
  defensively regardless). All close when the deferred corpus runs.
- **`renderer.js` has no unit tests (pre-existing structural gap).** The Leg-2 consolidation — 14 sites,
  tracker lifecycle, the intentional behavior delta — was verified only by the HAT + substrate-guard
  audit. This is the same unit-untestable view-layer boundary the Flight-3 debrief named; the HAT is the
  correct gate, but the `tab-surface-geometry`/`internal-tab-menus` specs are the formal net once run.
- **Residual rapid-click step coalescing** in the find buttons — inherent Chromium `findInPage` async,
  documented, intentionally not over-engineered. Upstream cause noted should users report flaky stepping.
- **Inset find bar is a short-lived design** — Flight 7's overlay replaces it; any interim find-bar edits
  should be written refactor-aware (overlay needs a different focus/IPC/close-on-freeze model).

### Documentation

- **Two CLAUDE.md conventions emerged worth recording:** (1) the `getChromeContents()?.focus()`-before-
  `send()` rule for any `before-input-event` branch routing a keyboard-input-expecting IPC to the chrome
  (cross-referenced at `main.js:585`/`:1637`; Flight 7 will need its overlay analog); (2) use
  `isWebTab()`/`isInternalTab()` for renderer tab-type decisions — never read `.trusted` directly.
- **Promote the `captureWindow` WSLg-fallback behavior + the readDom-authoritative / captureWindow-
  corroborating apparatus hierarchy into the behavior-test AUTHORING guide**, so future spec authors don't
  re-derive the DD4 design-review discovery.
- Minor: `renderer.js:1093` carries a stale "Leg 4 removes will-attach-webview / webviewTag" comment
  (historical to F3, reads as future intent) — housekeeping for a future docs pass.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| Leg 4 formal corpus → HAT as SC4 acceptance | In-loop MCP apparatus jar-authed against a foreign instance (admin observables refused) | The pivot, no; the **apparatus-wiring pre-leg gate** that would have caught it, YES |
| Overlay find bar built? No — spun to Flight 7 | Design review: flight-sized + needs-rework; spike proved feasibility | Yes — "spike to de-risk, then spin a proven idea into its own flight rather than grow a landing" |
| In-goldfinch (not standalone) compositing spike | Standalone Electron spike mis-rendered under WSLg GPU init; in-goldfinch used the real path | Yes — compositing spikes for this codebase run in-goldfinch |
| Find-focus fix added during the HAT | Genuine Flight-3 regression invisible to units/apparatus; HAT-surfaced | The focus-then-send pattern, yes (document in CLAUDE.md) |

## Key Learnings

- **The apparatus has three axes, not two: act, observe, and *wiring* (instance + auth tier).** A
  correctly-launched instance + a valid key is not enough if the session's MCP client points elsewhere.
- **The HAT is the correct gate for view-layer behavior the unit suite cannot reach** — it earned its
  place by catching the find-focus regression.
- **Spike-before-build on WebContentsView compositing pays off, and in-goldfinch beats standalone** on
  this WSLg stack.
- **macOS gap widened:** the find-focus fix and the `activeViewWcId` behavior delta are now also
  unverified on macOS, alongside the F3 freeze-frame architecture — the Flight-6 macOS gate should add the
  find-bar focus path and the internal→new-tab transition as explicit HAT steps. If the overlay primitive
  proves clean on macOS, it is the *freeze-frame menu* approach that should be reconsidered, not the overlay.

## Recommendations

1. **Run the deferred Leg-4 corpus + a11y in an admin-wired session** — first act of the next working
   session, before Flight 5 planning. Order: two new specs (gating) → nine-spec convenience corpus →
   `npm run a11y`. The `find-in-page` Witnessed run is where the WSLg cold-start question gets answered.
2. **Add an apparatus-wiring litmus as a standard pre-leg gate** for behavior-test legs (a `/flight` +
   `/leg` prerequisite, and a note in behavior-test AUTHORING) — confirm the MCP client is bound to *this*
   instance at the required auth tier before any Witnessed run.
3. **Record the two emergent conventions in CLAUDE.md** — the focus-then-send rule and the
   `isWebTab()`/`isInternalTab()` decision idiom.
4. **Open Flight 7 planning from the Flight-7 seed's five rework points** (count delivery path B; the
   IPC channel set; the freeze/find-open ordering constraint — overlay-hide must live in `unfreezeGuest`,
   not the `guestFrozen`-gated bounds handler; focus retargeting to the overlay; per-tab restore) **plus
   the Architect's catch: gate overlay *visibility* on `isInternalTab(activeTab())`**, not just its find
   routing.
5. **Promote the `captureWindow` WSLg-fallback / `readDom`-authoritative apparatus hierarchy into the
   behavior-test AUTHORING guide.**

## Action Items

- [ ] Run the deferred convenience corpus (`tab-surface-geometry` + `internal-tab-menus` gating, then the
  9-spec corpus) + `npm run a11y` in a session wired admin@flight-4; record run logs; answer the WSLg
  cold-start question and update `find-in-page.md` accordingly.
- [ ] Add an apparatus-wiring litmus pre-leg gate to behavior-test-gated legs (methodology — `/flight`,
  `/leg`, behavior-test AUTHORING).
- [ ] CLAUDE.md: add the focus-then-send rule + the `isWebTab()`/`isInternalTab()` convention.
- [ ] Plan **Flight 7 (floating overlay find bar)** via `/flight` from the Flight-7 seed + the rework
  points (incl. overlay-visibility gating on internal tabs).
- [ ] Behavior-test AUTHORING: document the `captureWindow` WSLg-fallback caveat + the readDom-authoritative
  apparatus hierarchy.
- [ ] Housekeeping: fix the stale `renderer.js:1093` `will-attach-webview`/`webviewTag` comment; optional
  unit test for `stopFindInPage` on a destroyed handle.
- [ ] Flight-6 macOS gate: add find-bar focus path + internal→new-tab transition as HAT steps.

## Test Metrics (baseline for future flights)

- `npm test`: **947/947 pass**, 0 fail, 0 skipped, ~5.1 s wall-clock. `npm run typecheck` clean;
  `npm run lint` clean.
- **Delta from Flight 3 (951/951):** −4, **intentional, not lost coverage.** The find unit test was
  rewritten injection-model → event-model (27 → 23 tests); the 4 removed tests asserted properties of the
  now-deleted injection architecture (two `new Function(code)` parse guards, two `chromeContents`-missing
  guards). The new suite *adds* runtime-behavior tests the old string-assertion suite couldn't express.
  The other 924 tests are unchanged (flight touched only `find.js`, `renderer.js`, comments).
- `npm run a11y`: NOT run (live gate; deferred with the Leg-4 corpus).
