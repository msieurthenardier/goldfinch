# Leg: verify-tab-surface-hat — Guided HAT for the tab surface (security-first)

**Status**: completed
**Flight**: [Tab Surface](../flight.md)

> **Interactive HAT / alignment leg.** Verifies the migrated tab surface (web + internal tabs as
> `WebContentsView`s) against the mission's render-correctness + trust-identity criteria. Run by the
> Flight Director directly (live MCP + operator on-screen), security-identity checks FIRST. Issues found
> were fixed inline. Full per-checkpoint evidence is in the flight log under the **Leg 5 HAT** entries.

## Objective

Confirm, on the running app, that: (1) the byte-exact partition trust boundary still excludes/​confines
the automation surface; (2) the MCP surface drives the view surface end-to-end; (3) internal pages
behave correctly as opaque views (menus, freeze, geometry); (4) the core render-correctness behaviors
hold on screen (tab switch / panel-resizes-guest); (5) a11y stays green. Fix regressions inline.

## Verification approach (operator decision: pragmatic live smoke)

The security-identity spec `internal-session-exclusion` self-defers to Flight 6 and needs an
internal-`wcId` readback apparatus that doesn't exist on the MCP surface; `mcp-jar-scoping` and the
drive corpus are runnable. Operator chose a **pragmatic live smoke**: verify what the live MCP surface +
operator eyes can attest now, lean on unit tests + the Flight-1 farble spike for the rest, and honor the
spec's own Flight-6 deferral for the formal Witnessed run. (See flight-log Leg-5 HAT for the rationale +
the AskUserQuestion record.)

## Acceptance Criteria (all met — see Verification Results)

- [x] **AC1 — Security gate (run FIRST).** Internal session excluded from `enumerateTabs` (live);
  internal `wcId` rejected at resolve time (unit-tested, `automation-resolve`); jar key sees only its own
  jar (live); `captureWindow` → `admin-only` for a jar key (live); `openTab` foreign jar → `out-of-jar`
  (live). The byte-exact `INTERNAL_PARTITION` carries the trust + jar boundary onto the views.
- [x] **AC2 — MCP drives the view surface end-to-end.** `openTab`/`navigate`/`goBack`/`goForward`/
  `reload`/`setZoom`/`getZoom`/`readDom`/`readAxTree` all succeed on a migrated web view (live).
- [x] **AC3 — Internal pages behave as views.** `goldfinch://settings`/`downloads` load with real
  content, bridge persists settings, back/forward disabled (Leg-3 HAT); kebab/container menus, freeze,
  and window/panel resize all work on internal tabs after the inline fixes (operator-confirmed).
- [x] **AC4 — Render-correctness (on screen).** Tab switch shows the right page at the right bounds;
  the side panel resizes the guest and restores; window/panel resize tracks (operator-confirmed).
- [x] **AC5 — a11y green.** `npm run a11y` → 0 new violations (run repeatedly across the HAT); the
  audit exercises `#page-context-menu`.
- [x] **AC6 — Static gates.** `typecheck` 0, `lint` 0, `npm test` 951/951 throughout.
- [x] **AC7 — Issues fixed inline or logged.** Three regressions fixed (below); two WSLg-class issues
  logged as operator-accepted known issues.

## Verification Results

**Security gate (live MCP, jar-scoped key) — PASS:** enumerate excludes internal + confined to own jar;
`captureWindow` admin-gated; `openTab` foreign-jar refused (`out-of-jar`). Resolve-time internal
rejection covered by `automation-resolve` unit tests. (`internal-session-exclusion` formal Witnessed run
deferred to Flight 6 per the spec's own header.)

**MCP drive corpus — PASS:** full drive/observe verb set on a web view (navigate/history/reload/zoom/
DOM/AX all OK).

**Regressions found & fixed inline (all Leg-3 class — internal tabs became opaque views, invalidating
web-only assumptions; the Leg-3 check hadn't exercised menus/resize *while on* an internal tab):**
1. Kebab/container menus occluded on internal tabs → generalized `freezeGuest`/`unfreezeGuest` to the
   active view (web or internal); `capture-active-guest` now captures internal for the still (safe —
   chrome-only freeze helper; Reviewer-confirmed).
2. White flash on freeze → decode the still before hiding the live view + `#webviews` background
   `#fff`→`var(--bg)`.
3. Internal views didn't resize with window/panel → dropped the web-only `!t.trusted` guard in
   `sendActiveBounds`.

**Known issues logged (operator-accepted, non-blocking, WSLg-class — not flight blockers):**
- Tiny residual menu-open blip on internal tabs (WSLg native-view compositing artifact; CSS white
  already removed).
- Maximize: the window reaches only ~bottom 2/3 of the screen (WSLg/Weston window-frame placement;
  standard `mainWindow.maximize()`, no size constraints — would be correct on macOS/Windows).

**Flight-end Reviewer:** `[HANDOFF:confirmed]` on all uncommitted HAT fixes (security of the
`capture-active-guest` change verified; no web-tab or trust-model regressions).

## Files (HAT inline fixes)

- `src/renderer/renderer.js` — `freezeGuest`/`unfreezeGuest` generalized; `sendActiveBounds` geometry
  guard; decode-before-hide.
- `src/main/main.js` — `capture-active-guest` captures the active view (internal included).
- `src/renderer/styles.css` — `#webviews` background `#fff`→`var(--bg)`.

## Post-Completion Checklist

- [x] AC1–AC7 met (live + operator on-screen + Reviewer-confirmed)
- [x] Flight log updated (per-checkpoint HAT results, the three fixes, the two logged known issues)
- [x] Leg status `completed`
