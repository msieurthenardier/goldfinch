# Squawk 0005: `homePageCache` is never boot-seeded — new windows fall back to hardcoded Google

**Status**: deferred
**Type**: defect
**Severity**: routine
**Reported**: 2026-08-11
**Completed**: —

## Report

In any window opened after launch, Ctrl+T / burner / new-jar tabs open the hardcoded `HOMEPAGE` constant (Google) instead of the user's configured home page, until some unrelated `settings-changed` broadcast happens to land in that window.

Reproduce: set the home page to `https://example.com` in Settings, open a new window (Ctrl+N), press Ctrl+T in it — the tab opens Google, not example.com.

Found by M16 Flight 1 design review (2026-08-11), which nearly propagated the same shape into the new `searchEngineCache` (see flight.md DD4). `CLAUDE.md`'s home-page-caching description states the cache is seeded by the boot `settingsGet` — it is not; that correction is scheduled in M16 F1 leg 1.

## Evidence

- `src/renderer/renderer.js:47-48` — `homePageCache` initialised to the `HOMEPAGE` constant; only writer is `setHomePage` (`renderer.js:478`), reached solely from the live `settings-changed` handler (`window-controller.js:130-131`). No synthetic replay at listener registration; no boot broadcast.
- `src/renderer/renderer.js:~1500-1534` — the one boot-time `settingsGet('homePage')` feeds only the first `createTab(url || HOMEPAGE)`; it never touches the cache.
- Contrast the correct seeding idiom in the same file: `window-controller.js:89` (`toolbarPins`), `window-controller.js:120` (`bookmarksBarEnabled`).

## Corrective Action

*(written at completion)*

Expected shape: boot-seed via `settingsGet('homePage').then(setHomePage)` per the `toolbarPins` idiom — but see deferral: M16 Flight 2 rewrites the three `|| HOMEPAGE` coalescing sites and must fix or subsume this seeding as part of that design. Do not fix standalone while that flight is pending.

## Verification

*(written at completion — one unit test on the boot-seeding call, plus the reproduce steps above)*

## Sign-Off

*(written at completion)*

---

## Deferral

**Reason**: M16 Flight 2 rewrites the exact surface (`renderer.js:48`, `:478`, `:1534` coalescing sites and unset-home-page routing); a standalone fix now would be churned or contradicted by that design. Recorded in mission 16's Known Issues with the instruction that Flight 2 must fix or subsume the seeding, not inherit the gap.

**Revisit trigger**: M16 Flight 2 planning — the flight's design must claim this squawk (fix or subsume); if Flight 2 is descoped or the mission aborts, complete this standalone instead.
