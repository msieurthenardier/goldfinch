# Squawk 0005: `homePageCache` is never boot-seeded — new windows fall back to hardcoded Google

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-08-11
**Completed**: 2026-08-25

## Report

In any window opened after launch, Ctrl+T / burner / new-jar tabs open the hardcoded `HOMEPAGE` constant (Google) instead of the user's configured home page, until some unrelated `settings-changed` broadcast happens to land in that window.

Reproduce: set the home page to `https://example.com` in Settings, open a new window (Ctrl+N), press Ctrl+T in it — the tab opens Google, not example.com.

Found by M16 Flight 1 design review (2026-08-11), which nearly propagated the same shape into the new `searchEngineCache` (see flight.md DD4). `CLAUDE.md`'s home-page-caching description states the cache is seeded by the boot `settingsGet` — it is not; that correction is scheduled in M16 F1 leg 1.

## Evidence

- `src/renderer/renderer.js:47-48` — `homePageCache` initialised to the `HOMEPAGE` constant; only writer is `setHomePage` (`renderer.js:478`), reached solely from the live `settings-changed` handler (`window-controller.js:130-131`). No synthetic replay at listener registration; no boot broadcast.
- `src/renderer/renderer.js:~1500-1534` — the one boot-time `settingsGet('homePage')` feeds only the first `createTab(url || HOMEPAGE)`; it never touches the cache.
- Contrast the correct seeding idiom in the same file: `window-controller.js:89` (`toolbarPins`), `window-controller.js:120` (`bookmarksBarEnabled`).

## Corrective Action

Fixed by M16 Flight 2 leg 1 (DD4, cache unification): `src/renderer/chrome/window-controller.js` now boot-seeds `homePageCache` with `window.goldfinch.settingsGet('homePage').then(setHomePage)` — the same idiom as `toolbarPins`/`bookmarksBarEnabled` and the `searchEngine` seed beside it — so every window has the configured home page before any broadcast lands. The three `|| HOMEPAGE` coalescing sites and the `HOMEPAGE` literal are gone; every new-tab site resolves through `openNewTab(container)`, which routes an unset home page to the welcome surface instead of a hardcoded fallback.

Original expected shape: boot-seed via `settingsGet('homePage').then(setHomePage)` per the `toolbarPins` idiom — but see deferral: M16 Flight 2 rewrites the three `|| HOMEPAGE` coalescing sites and must fix or subsume this seeding as part of that design. Do not fix standalone while that flight is pending.

## Verification

- `test/unit/window-controller.test.js` — "homePage is boot-seeded via an explicit settingsGet, before any broadcast (squawk 0005 closed)".
- `test/unit/homepage-literal-scan.test.js` — no `HOMEPAGE`/`google.com` literal remains in `src/renderer/` outside `src/shared/search-engines.js`.
- Observed live: `welcome-home-routing` run `2026-08-25-02-45-35` step 10 (boot window's first Ctrl+T after a clean relaunch opens the configured home page) and `search-engine-upgrade` run `2026-08-25-03-16-36` step 2 (the row that failed on this defect on 2026-08-24 now passes as authored).

## Sign-Off

**Reviewer**: Reviewer agent (independent, no knowledge of the implementers' reasoning) — Mission 16 Flight 2 flight-end review, one round, 2026-08-25
**Verdict**: confirmed
**Commit**: `flight/02: The Welcome Surface — viewless welcome tab, search handoff, unset-by-default` on `flight/02-welcome-surface` (the flight-end commit; PR number recorded in the flight debrief)

Reviewer independently ran the suite (3763/3763, ~3.3 s), typecheck and lint clean, and traced the corrective action against the diff. Closed by observation on `welcome-home-routing` (2026-08-25, 10/10): after a clean relaunch the boot window's first Ctrl+T honored the configured home page — `homePageCache` is now seeded from the boot `settingsGet('homePage')` and `HOMEPAGE` is gone (`test/unit/homepage-literal-scan.test.js` pins its absence).

---

## Deferral

**Reason**: M16 Flight 2 rewrites the exact surface (`renderer.js:48`, `:478`, `:1534` coalescing sites and unset-home-page routing); a standalone fix now would be churned or contradicted by that design. Recorded in mission 16's Known Issues with the instruction that Flight 2 must fix or subsume the seeding, not inherit the gap.

**Revisit trigger**: M16 Flight 2 planning — the flight's design must claim this squawk (fix or subsume); if Flight 2 is descoped or the mission aborts, complete this standalone instead.
