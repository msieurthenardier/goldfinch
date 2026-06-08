# Leg: site-settings-rewire

**Status**: completed
**Flight**: [Pinnable Toolbar Items (Media + Shields)](../flight.md)

## Objective
Rewire the site-info popup's **"Site settings →"** to open the **settings page** (Privacy & Shields section)
instead of the slide-out panel, reusing an open settings tab if present; and apply defensive `escapeHtml` in
`buildSiteInfo`.

## Context
- **DD4.** The slide-out Shields panel is now optional/pinnable, so "Site settings →" should go to the
  canonical destination — `goldfinch://settings/#privacy`. The current `.si-settings-btn` handler
  (`renderer.js` `buildSiteInfo`) does `closeSiteInfo(); togglePrivacy(true);`. Change the second call to
  open/focus the settings page at `#privacy`.
- **Confirmed (Flight-7 design):** `isInternalPageUrl('goldfinch://settings/#privacy')` is true (the predicate
  checks `pathname`, ignores the hash) — so the **trusted** `createTab` path accepts it and the page native-
  anchors to `#privacy`. **Reuse** an open settings tab via `[...tabs.values()].find(isInternalTab)` →
  `webview.loadURL('goldfinch://settings/#privacy')` + `activateTab(tab.id)` (loadURL bypasses the address-bar
  `navigate()` lock — that's fine; the URL is internal anyway). Else `createTab('goldfinch://settings/#privacy',
  null, { trusted: true })`.
- **DD5 (defensive escaping).** In `buildSiteInfo`, `host` + `connection` are already `escapeHtml`'d; the
  `trackers`/`permissions` are numbers interpolated raw. Wrap them in `escapeHtml(String(...))` for uniform
  defense-in-depth (nominal — they're `?? 0` numbers — but makes the pattern consistent and future-proof if a
  field ever becomes a string).

## Inputs
- `src/renderer/renderer.js` — `buildSiteInfo` (the popup builder + the `.si-settings-btn` click handler that
  calls `togglePrivacy(true)`); `isInternalTab`; `isInternalPageUrl`; `createTab` (trusted branch);
  `activateTab`; the `tabs` Map; `escapeHtml`; `closeSiteInfo`.

## Outputs
- The "Site settings →" handler opens/focuses `goldfinch://settings/#privacy`.
- Defensive `escapeHtml` on the popup's count fields.

## Acceptance Criteria
- [ ] The `.si-settings-btn` click handler does `closeSiteInfo();` then opens the settings page at the Privacy
  section: **reuse** an existing internal tab — `const existing = [...tabs.values()].find(isInternalTab); if
  (existing) { existing.webview.loadURL('goldfinch://settings/#privacy').catch(() => {}); activateTab(existing
  .id); } else { createTab('goldfinch://settings/#privacy', null, { trusted: true }); }` — **not**
  `togglePrivacy(true)`. (`.catch(()=>{})` mirrors the existing `navigate()` `loadURL` pattern; activate-then-
  the-async-`did-navigate-in-page`-fires ordering is intentional — the tab is already active when the chip
  re-syncs.)
- [ ] The slide-out privacy panel is **no longer opened** by "Site settings →".
- [ ] **Defensive escaping**: the `trackers` and `permissions` interpolations in `buildSiteInfo` are wrapped
  `escapeHtml(String(trackers))` / `escapeHtml(String(permissions))` (host/connection stay escaped).
- [ ] No other behavior changes to `buildSiteInfo` (internal-tab static note unchanged; the web summary fields
  unchanged except the escaping).
- [ ] `npm run lint`, `npm run typecheck`, `npm test` green (221 — no new unit tests; the open-settings flow is
  behavior-tested live in leg 7).

## Verification Steps
- `npm run lint && npm run typecheck && npm test` — green.
- Code read: the handler opens `goldfinch://settings/#privacy` (reuse-or-create) and no longer calls
  `togglePrivacy(true)`; counts are `escapeHtml(String(...))`.
- **Deferred to leg 7 (live):** web tab → web chip → "Site settings →" → a `goldfinch://settings#privacy` tab
  is active (the slide-out does NOT open); the Privacy & Shields section is in view.

## Implementation Guidance
1. In `buildSiteInfo`, change the `.si-settings-btn` click handler's `togglePrivacy(true)` to the reuse-or-
   create open of `goldfinch://settings/#privacy` (per the AC). Keep `closeSiteInfo()` first.
2. Wrap the two count interpolations in `escapeHtml(String(...))`.

## Edge Cases
- **Existing internal tab already on `#privacy`**: `loadURL` to the same-with-fragment is harmless (in-page
  anchor); `activateTab` focuses it.
- **`loadURL` vs the nav lock**: calling `webview.loadURL` directly bypasses the address-bar `navigate()` lock
  (intended — the URL is internal). Don't route this through `navigate()`.
- **No focus-stranding** (this opens/focuses a tab, not a panel) — the leg-2 guard doesn't apply.
- Do NOT remove `togglePrivacy` itself (the Shields panel button still uses it) — only this call site changes.

## Files Affected
- `src/renderer/renderer.js` — `buildSiteInfo`: the "Site settings →" handler + defensive escaping.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:** *(commit deferred to the flight-level review)*

- [ ] All acceptance criteria verified (offline; live open-settings flow deferred to leg 7)
- [ ] Tests passing (offline gates)
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `landed` (commit deferred)
- [ ] Check off this leg in flight.md
- [ ] Do NOT commit; do NOT signal `[HANDOFF:review-needed]`
