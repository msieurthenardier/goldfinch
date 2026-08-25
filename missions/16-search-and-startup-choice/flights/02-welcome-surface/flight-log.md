# Flight Log: The Welcome Surface

**Flight**: [The Welcome Surface](flight.md)

## Summary

Planning as of 2026-08-24. Two autonomous legs planned; deferred-commit model (single review + commit after the last leg).

---

## Reconnaissance Report

Source items verified against `main` at `ab349ea` (Flight 1 merged), 2026-08-24. No retirements proposed; the operator accepted the classifications during flight planning.

| Item | Classification | Evidence | Recommendation |
|---|---|---|---|
| Squawk 0005 — `homePageCache` never boot-seeded | confirmed-live | `src/renderer/chrome/window-controller.js:127` seeds only `searchEngine`; `src/renderer/renderer.js:492` `setHomePage` still coalesces `\|\| HOMEPAGE` | Claimed by DD4 |
| Three `\|\| HOMEPAGE` coalescing sites | drifted → confirmed-live | now `renderer.js:49`, `:492`, `:1549` (mission cited 48/478/1534) | Claimed by DD4 |
| `toUrl`'s `\|\| 'google'` site | confirmed-live | `src/renderer/chrome/navigation-controller.js:105` | Claimed by DD3/DD4 |
| Mission KI — `openSiteSettingsTab()` reuses any internal tab | confirmed-live | `src/renderer/chrome/overlay-menus.js:118` `.find(isInternalTab)`; zero unit coverage | Claimed by DD10 |
| Mission KI — `settings.js` truthy home-page guard | confirmed-live, two sites | `src/renderer/pages/settings.js:133` (load) and `:152` (broadcast) | Claimed by DD6 |
| Squawk 0006 — `search-engine-upgrade` step 2 premise | confirmed-live | fails only because of 0005; true as authored once DD4 lands | Claimed by DD5 — re-run closes it, no re-authoring |
| Squawk 0003 — broadcast-invariant detection half by substring | confirmed-live, latent | `test/unit/broadcast-invariant.test.js:60-61`; no helper wraps `settings.set` today | Out of scope — this flight adds no settings key and its one new write handler uses the detected direct shape (DD1); turnaround squawk |
| Squawk 0007 — `search-engine-preference` step 6 apparatus | confirmed-live | spec/doc only | Out of scope; recommended turnaround before this flight's acceptance gate |
| Squawk 0008 — crew-file apparatus facts | confirmed-live | doc only | Out of scope; recommended turnaround before this flight's acceptance gate |
| Census find — `INTERNAL_JAR_NAMES` has no `vault` entry | confirmed-live, new | `src/renderer/chrome/tab-controller.js:46` falls back to `'Settings'` for a Vault tab | Not this flight's surface — logged as squawk 0009 |
| Mission Flight-2 framing — "a new internal page is a three-allowlist change" and the list of specs to claim | superseded by DD1 | no internal origin is added | Preserved in the mission as commentary; specs recorded as not engaged in DD11 |

---

## Leg Progress

*(none yet)*

---

## Decisions

### Flight design review (planning, 2026-08-24)
**Context**: `/flight` Phase 5b — Architect review of the spec against `main` at `ab349ea`.
**Cycle 1**: approve with changes. DD1 (chrome-owned viewless welcome tab, not an internal page) verified to the line — writable address bar via the empty-url branch, bookmarks bar per jar, `navigate()` never takes the internal early-return, bookmark clicks already funnel through `navigate()`, snapshot/closed-tab exclusion is architectural absence, the chrome-bridge write shape is caught by the broadcast-invariant net, no internal-page invariant touched. Findings incorporated: **[high]** DD8 reversed — every cross-window move path is keyed on a live `wcId`, so a viewless tab is refused today; the flight adopts the refusal and omits the dead move items from the tab-context menu instead of building viewless transfer. **[medium]** `welcome-home-routing` step 5 re-authored to the `openNewTab(makeBurner())` chrome seam (the container menu is a non-automatable sheet). **[medium]** DD3 gains the single `openWelcomeTab` constructor so `sel:search` never special-cases `createTab(null)`. **[medium]** DD3 gains the mission's length cap (`PENDING_QUERY_MAX = 2048`, positive-control test). **[low]** DD7 gains viewless-tab affordance hygiene (nav buttons, toolbar buttons, tab-context move items) and the guest-slot layout note; DD5 notes the test-rename volume; leg design must re-check two test files the review could not reach.
**Cycle 2** (targeted pass on the revised DDs): approve with changes. Confirmed sound: DD8's guards refuse viewless cross-window transfer independently at four layers; the tab-context-model gate belongs at the model as a caller-computed param (mirrors `isInternal`); DD3's constructor placement and `sel:search` rewiring fit the factory-deps pattern; `updateNavButtons` self-corrects on wcId arrival; `makeBurner` is in the closed set. Incorporated: **[high]** the toolbar-button hygiene is extracted into `applyToolbarAffordances(tab)` and re-run in the wcId-arrival continuation (gating it in `activateTab` alone would have left ordinary tabs' Media/Shields/DevTools buttons disabled after their view arrived), with a positive-control test; **[medium]** leg 1 explicitly publishes `openNewTab` in the `evaluate` closed set with an FD-ruling comment; **[low]** DD8 notes the `dragstart` guard also refuses same-window mouse reorder; DD3 notes the cap is pre-encode; DD5 says count the renames. Two cycles reached — design review closed; the three low notes are recorded, not re-reviewed.

*(runtime decisions recorded here during execution)*

---

### Flight Director Notes

*(populated by `/agentic-workflow`)*
