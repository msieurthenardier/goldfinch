# Leg: hat-claude-artifacts

**Status**: ready
**Flight**: [Partitioned-cookie-aware third-party isolation](../flight.md)

## Objective
The operator verifies, by hand in their signed-in dev profile on the sortie build, that real claude.ai artifacts work with Shields fully on (charter criterion 1, live). They also walk the restart-to-apply UI and the items automation couldn't reach.

## Context
- Interactive HAT: the operator performs each step, and the Flight Director guides one step at a time and fixes issues inline (fix vs feature gate per agentic-workflow).
- Carried in from Legs 01–02 (flight log):
  - live Storage Access (Leg 01 AC10, struck from automation);
  - settings-note placement;
  - duplicate notes when the master is off;
  - "Turns on after restart" vs the DD4 copy;
  - the panel turn-on direction;
  - live focus retention;
  - the packaged AppImage Restart now (DD11).
- Pre-evidence: on 2026-10-06 the operator confirmed a Claude Code artifact link works on the branch build and fails on prod.

## Verification Steps (one at a time)
1. **claude.ai artifact, Shields fully on.** Relaunch the operator's dev instance (`npm run dev:automation`, port 49708) on commit `31be656`. Confirm in the privacy panel: isolation on, no restart pending, claude.ai not paused. Open 2–3 real claude.ai artifacts (including https://claude.ai/artifact/51jpj1RcXp18MehEQAteWs and one with images). Expected: each renders fully, with no "browser isn't supported" and no broken images.
2. **Privacy panel on an artifact tab.** Expected: the isolate row shows no count (partitioned-only frames are never counted); copy and layout are acceptable.
3. **Panel turn-off → Restart now.** Turn isolation off in the panel. Expected: "Stays on until restart", count still shown, "Restart now" appears. Then Restart now → Restart Goldfinch. Expected: the app closes and reopens in the signed-in profile with tabs restored, and the artifact still works.
4. **Panel turn-on direction.** Turn isolation back on in the panel. Expected: "Turns on after restart" plus Restart now. Restart. Expected: isolation is in force again and the artifact still works.
5. **Master switch and pause copy.** Turn the master Shields switch off: is the master note, plus the isolate note, acceptable or redundant? Then turn it back on. Pause Shields on a site: "Applies browser-wide" under isolation. Then resume.
6. **Settings page copy and placement.** On `goldfinch://settings` → Privacy & Shields, toggle isolation off, look at where the notes and Restart now sit, then toggle it back (no restart needed if nothing is pending). Decide whether the placement is acceptable.
7. **Focus retention.** With the panel open on a busy page (e.g. a news site), Tab to Restart now (or the isolate switch) and wait about 10 s while the page loads. Expected: focus stays put.
8. **Storage Access, live.** Serve the 3P-cookies fixture (FD starts it). With isolation on, open `https://127.0.0.1:{fx}/a/embed` and click **Request storage access** in the lower frame. Expected: `rejected:NotAllowedError`. Optionally note whether the panel's Permissions lists it.
9. **One other cookie-heavy embed** of the operator's choosing (e.g. an embedded video, comments widget or SSO). Expected: it works, or any breakage is explained by blocking unpartitioned cookies (acceptable per DD5).
10. **Packaged AppImage Restart now.** `npm run dist` (FD builds), run the AppImage, turn isolation off, then Restart now → Restart Goldfinch. Expected: the AppImage relaunches (the DD11 `APPIMAGE` `execPath`).

## Acceptance Criteria
- [ ] Steps 1–10 confirmed by the operator, or each failure fixed inline (re-verified), or dispositioned by the operator.

## Completion
When all steps pass, update artifacts and commit (FD).

## HAT Findings

### HAT-F1: "Reload to apply" shows only when needed (FEATURE, operator choice, 2026-10-06)
**Observation (step 3):** the always-visible "Reload to apply" button in the Shields card is confusing next to the restart-to-apply copy. The operator chose: show it only after a change that needs a reload, until the page is reloaded.

**Classified as a FEATURE** (new behavior and state), so it gets a scoped design review before implementation. One surface (the privacy panel); no main or IPC change.

**Design:**
- **Which changes are reload-affecting:** `enabled`, `block`, `strip`, `farble`, and `pausedSites`. These are network or page-load strategies that apply to new loads. `isolate` is **not** one: it's restart-to-apply and keeps its own restart UI.
- **Stale flag per tab:** when the Shields config changes in any reload-affecting key, set `tab.privacy.reloadStale = true` on **every open web tab**, because the change is global. The diff runs in `privacy-controller.js`'s `onShieldsChanged` handler plus the local `setShield`/`toggleSitePause` result, comparing the previous `shieldsConfig` with the new one. That covers changes made from the panel and from `goldfinch://settings` alike. Internal and viewless tabs are skipped (`isWebTab`).
- **Clearing:** `renderer.js` already replaces `tab.privacy` with `blankPrivacy()` on every navigation or reload of that tab, so the flag clears itself. **No `renderer.js` change** (budget).
- **Display:** in `shields-section.js`, the footer "Reload to apply" button is visible only when the active tab is a web tab and `activeTab().privacy.reloadStale === true`; otherwise it is hidden (`hidden` class, patched in place). The restart foot note ("Cookie isolation changes need a restart") is unchanged and independent.
- **No pause pre-mark:** pausing a site marks every web tab, not just that site's; it's a cheap over-approximation and is kept.
- **Tests:** unit tests in `privacy-controller.test.js` / the shields-section tests:
  - the button is hidden at boot;
  - it shows after a `block` toggle (panel and `shields-changed` paths);
  - it does **not** show after an `isolate`-only change;
  - it clears when the tab's `privacy` object is replaced, simulating navigation;
  - it is per-tab: a tab opened after the change isn't stale;
  - internal tabs are never stale;
  - patch-in-place identity is kept.
- **CLAUDE.md:** a one-clause addition to the existing Shields UI bullet.

**HAT-F1 design review (Developer, 2026-10-06): approve with changes. Incorporated (authoritative):**
1. **Predicate:** a tab is mark- and show-eligible iff `isWebTab(t) && t.wcId != null && t.privacy`. Welcome/viewless tabs are never marked (their reload would no-op).
2. **One centralized `applyShieldsConfig(next)` helper** in `privacy-controller.js`. All four assignment sites route through it: the boot `shieldsGet` `.then`, `onShieldsChanged`, `setShield` and `toggleSitePause`. The helper:
   - diffs the previous and next config on `enabled`/`block`/`strip`/`farble`, plus `pausedSites` by sorted-content equality;
   - does **not** mark when the previous config is `null` (boot);
   - marks every eligible tab in `ctx.tabs`;
   - then assigns.

   Double arrival (local result plus broadcast) is a no-op the second time.
3. **`shields-section.js`:** `patch()` gains a `reloadStale` boolean, computed in `patchShields` from the active tab with the predicate above, and toggles the reload button with `setHidden(reloadBtn, !state.reloadStale)`. It is patched in place.
4. **`onReload`:** after `tabNavigate reload`, set `t.privacy.reloadStale = false` and call `renderPrivacy()`, so the button hides immediately.
5. **Shape:** add `reloadStale: false` to `blankPrivacy()` in `privacy-controller.js`.
6. **Accepted over-approximations:**
   - a mid-load change is cleared by the commit;
   - toggling a setting off then on leaves the tab stale;
   - pausing a site marks all eligible tabs.
7. **Tests** (the harness `ctx` gains `tabs: new Map([...])`):
   - the proposed list;
   - a welcome tab is never marked;
   - an identical re-broadcast doesn't mark;
   - a `pausedSites` array that is fresh but equal doesn't mark;
   - the boot resolve doesn't mark;
   - a change while the panel is collapsed shows the button after opening;
   - a non-active tab's mark is shown on switch;
   - an `isolate`-only change (through both `setShield` and the broadcast) doesn't mark.
