# Leg: address-bar-chips-and-lock

**Status**: completed
**Flight**: [Settings Page Shell + Address-Bar Chips](../flight.md)

## Objective
Add an address-bar chip in `#address-wrap` that reflects the active tab — an **internal-page identity chip**
on `goldfinch://` and a **web-page site-info chip** (connection + origin) on `http(s)` — and **lock
internal-tab navigation** so a web URL entered in a `goldfinch://` tab opens a new normal tab instead of
navigating the internal tab, with the internal tab's address bar read-only.

## Context
- **DD4 — chip reflecting the active tab.** Add a chip element in `#address-wrap` (`src/renderer/index.html`,
  the `<div id="address-wrap">` holding `#address`), **left of** the address input. Its state tracks the
  active tab's URL: **internal-page chip** on `goldfinch://` (a "Goldfinch"/secure-internal identity
  indicator — the Flight-4 Known-Issue chip) and **web-page site-info chip** on `http(s)` (a
  lock/connection indicator + the origin). Updated wherever `els.address.value` is synced today:
  `activateTab` (`renderer.js:activateTab`, the `els.address.value = tab.url` line), the `did-navigate`
  handler `onNav` (`renderer.js` — `els.address.value = tab.url`), and the `did-navigate-in-page` handler
  (same).
- **DD4 a11y.** The chip is a `<button>` — the axe rule actually guarded is **`button-name`** (a button
  needs a discernible accessible name), satisfied by the `aria-label`. (The `region` finding on
  `#address-wrap` fires on the *container* node, which is already in the pinned `ACCEPTED` allowlist; adding
  a labelled child does NOT add a new `region` node — so no new allowlist entry is needed, but the chip
  MUST be labelled in both states or `button-name` fires NEW.) Neutral glyphs (not the brand accent —
  window-controls convention); `type="button"` (matches every non-submit button in `index.html`).
- **DD6 — internal-tab navigation lock.** In `navigate(input)` (`renderer.js:navigate`), make the
  internal-vs-web decision **after `toUrl(input)`** (`renderer.js:toUrl`), not on raw input. Identify the
  active internal tab via `tab.container.id === 'internal'` (set in `createTab` for the trusted internal
  branch) or `tab.container.partition === window.goldfinch.internalPartition`. If the active tab is internal
  and the resolved URL is a web URL → open a **new normal tab** (`createTab(url)`, the untrusted/web branch
  — `isSafeTabUrl` admits `http(s)`) instead of `loadURL`-ing it into the internal webview; the internal tab
  stays on `goldfinch://settings`. The internal tab's address bar is **read-only** (shows the internal URL
  non-editably).
- **Lock doesn't break trusted paths.** Trusted Settings-open (`createTab(..., {trusted:true})`), `reload`
  (`els.reload` → `webview.reload()`), and back/forward (`webview.goBack/goForward`) do **NOT** route
  through `navigate()` — only the address-Enter handler (`els.address` keydown → `navigate(els.address.value)`)
  does. So the lock only affects address-bar entry. Confirmed against current code.
- **`did-navigate-in-page` coordination.** In-page anchor nav on the settings shell (leg 3) fires
  `did-navigate-in-page`, which rewrites `els.address.value` to `goldfinch://settings/#startup` etc. The
  read-only internal display + the chip must stay coherent: the chip stays the **internal** chip for any
  `goldfinch://…#fragment` (confirm `isInternalPageUrl` treats a fragmented internal URL as internal), and
  the read-only address shows the internal URL (fragment included is fine).
- **Scope boundary.** This leg builds the chip **element + state-tracking + the lock + read-only bar**. The
  chip's **click behavior** — the web chip's site-info popup and the internal chip's static "secure page"
  note — is **leg 5** (DD5). In this leg the chip is a labelled `<button>`; its click is wired in leg 5.
  (Legs are batched into one flight-review commit, so the not-yet-clickable chip never lands on its own.)
- **Security boundary.** This is **UX hardening only**. The security-critical internal-bridge origin-check
  stays **Flight 6**. This leg does NOT touch the internal preload bridge or `isSafeTabUrl`.

## Inputs
- `src/renderer/index.html` — `#address-wrap` containing `#address` input.
- `src/renderer/renderer.js` — `activateTab`, `onNav`/`did-navigate`/`did-navigate-in-page` handlers,
  `navigate`, `toUrl`, `createTab` (internal branch sets `tab.container = { id:'internal', … }`),
  `window.goldfinch.internalPartition`, `isInternalPageUrl` (from `src/shared/url-safety.js`, exposed on the
  renderer global).
- Settings shell (leg 3) live at `goldfinch://settings` with anchor sections.

## Outputs
- A chip `<button>` in `#address-wrap` reflecting the active tab (internal vs web state, both `aria-label`led).
- A central chip-update function called from every address-sync site.
- The internal-tab navigation lock in `navigate()` + a read-only address bar for internal tabs.

## Acceptance Criteria
- [ ] A chip `<button>` exists in `#address-wrap`, **left of** `#address`, carrying an `aria-label` in
  **both** states (e.g. internal: "Secure Goldfinch page"; web: "Site information, {origin}"). Neutral
  glyphs (not the brand accent).
- [ ] A single update function (e.g. `updateAddressChip(tab)`) sets the chip state from the active tab's URL:
  **internal** state when `isInternalPageUrl(tab.url)` (incl. `goldfinch://settings/#fragment`), **web**
  state (connection/lock glyph + origin host) when `http(s)`. It is called from **`activateTab`**, the
  **`did-navigate`** (`onNav`) handler, and the **`did-navigate-in-page`** handler — everywhere
  `els.address.value` is synced — so the chip never goes stale on activate or navigation.
- [ ] **Exactly one** chip presentation per tab type (no both-shown / none-shown state); a brand-new
  `about:blank`/empty tab shows a sensible default (web/neutral, not a crash).
- [ ] **Internal-tab navigation lock**: in `navigate()`, after `toUrl(input)`, if the active tab is internal
  (`tab.container.id === 'internal'` / partition === `internalPartition`) and the resolved URL is a web URL,
  call `createTab(resolvedUrl)` (new normal tab) and do **NOT** `loadURL` into the internal webview; the
  internal tab stays on its `goldfinch://` URL. Non-internal tabs keep the existing behavior exactly.
- [ ] **Read-only internal address bar**: when an internal tab is active, `#address` is `readOnly` (shows
  the internal URL, not editable); when a web tab is active, `#address` is editable as today. The read-only
  state is applied wherever the chip/address is synced (activate + navigation).
- [ ] Trusted Settings-open, reload, and back/forward still work on the internal tab (they bypass
  `navigate()`); anchor-section nav within settings still updates the read-only display + keeps the internal
  chip (the `did-navigate-in-page` path).
- [ ] **No new a11y violations** (DD4): the chip button is labelled in both states; `npm run a11y` (chrome)
  intent is clean vs the pinned baseline (live run in leg 7).
- [ ] `npm run lint`, `npm run typecheck`, `npm test` green.

## Verification Steps
- `npm run lint && npm run typecheck && npm test` — green.
- Read `index.html`: chip `<button>` present in `#address-wrap`, left of `#address`, with `aria-label`.
- Read `renderer.js`: `updateAddressChip` called from `activateTab` + both nav handlers; the lock branch in
  `navigate()` is **after** `toUrl`; the read-only toggle is applied on activate + nav.
- **Deferred to leg 7 (live)**: open Settings (internal chip shows; address read-only); open a web tab
  (web chip shows origin; address editable); type a web URL in the internal tab + Enter → a NEW normal tab
  opens to it, internal tab unchanged, tab count +1; anchor-nav in settings keeps the internal chip and
  updates the read-only URL; `npm run a11y` clean.

## Implementation Guidance

1. **Add the chip element** to `#address-wrap` in `index.html`, before `#address`:
   `<button id="address-chip" class="addr-chip" type="button" aria-label="Site information"></button>`
   (the label is updated dynamically per state). Style it in `styles.css` with neutral glyphs (a
   lock/shield-ish glyph for web, a Goldfinch/secure mark for internal) — NOT the brand accent. Give the
   **read-only address** a subtle CSS cue (e.g. `#address[readonly]` a slightly different bg) so a sighted
   user sees it's non-editable rather than a dead editable field. **Register the chip in the `els` map**
   (`renderer.js`, the `els` object near the top) — `addressChip: document.getElementById('address-chip')`
   — matching the established element-reference convention; don't reach for `getElementById` ad hoc.

2. **Write `updateAddressChip(tab)`** in `renderer.js`: if `!tab` or empty/`about:blank` URL → the **web/
   neutral** default state (chip shown, address editable — NOT hidden, NOT a crash); if
   `isInternalPageUrl(tab.url)` → internal state (set `data-state="internal"`, glyph, `aria-label="Secure
   Goldfinch page"`); else parse the origin (`new URL(tab.url).host`) → web state (`data-state="web"`,
   connection glyph, `aria-label="Site information, {host}"`, optionally show the host text). Guard URL
   parsing in try/catch (`new URL('')` throws → fall to the neutral default).

3. **Write `applyAddressEditable(tab)`** (or fold into `updateAddressChip`): set
   `els.address.readOnly = isInternalPageUrl(tab.url)` so internal tabs are read-only, web tabs editable.
   **`readOnly` blocks only user keyboard input — programmatic `els.address.value = …` assignments still
   work** even when `readOnly` is true, so the existing `onNav`/`did-navigate-in-page` syncs need **no**
   `readOnly` toggling-off; do not add any.

4. **Call both** from `activateTab` (next to `els.address.value = tab.url`), from `onNav` (the
   `did-navigate` handler), and from the `did-navigate-in-page` handler — every place the address is synced.

5. **The lock in `navigate()`**: after `const url = toUrl(input)`, add:
   ```
   const t = activeTab();
   if (t && isInternalTab(t)) {            // tab.container.id === 'internal' || partition === internalPartition
     if (!isInternalPageUrl(url)) {        // a web URL typed into the settings tab
       createTab(url);                     // open a NEW normal tab (untrusted/web branch)
       return;                             // leave the internal tab on goldfinch://
     }
     return;                               // don't let an internal tab free-navigate even to internal URLs via the bar
   }
   t.webview.loadURL(url).catch(...);      // existing behavior for normal tabs
   ```
   Add a small `isInternalTab(tab)` helper. Keep the existing `loadURL`/`setAttribute('src')` fallback for
   the normal path.
   - **Web-tab path unchanged**: when `t` is not internal, it falls through to the existing `loadURL` — no
     change. (If a user types `goldfinch://…` into a *web* tab, `toUrl` passes it through and `loadURL`
     fails silently — no handler on the default partition. That's **existing behavior**, not addressed
     until Flight 6; do not add a web-tab guard here.)
   - **Internal-URL-via-bar is a deliberate silent no-op**: typing a `goldfinch://` URL into the settings
     tab's (read-only) bar can't really happen since the bar is `readOnly`; the inner `return` is a
     belt-and-suspenders guard. The address reverts to the current URL on blur — silent no-op is the
     intended UX (no feedback element is in scope this leg).

6. **a11y**: ensure the chip button always has a non-empty `aria-label` (both states); do not add any other
   unlabelled interactive node inside `#address-wrap`.

## Edge Cases
- **`about:blank` / empty / new tab**: `new URL('')` throws — guard; show a neutral default chip, address
  editable.
- **`isInternalPageUrl` on fragmented URLs**: **Confirmed** — `isInternalPageUrl('goldfinch://settings/#startup')`
  returns `true` (the WHATWG URL parser puts the fragment in `.hash`, not `.pathname`). **No normalization
  and no change to `isInternalPageUrl` is needed** — do not touch that security-sensitive predicate. The
  chip stays internal across anchor nav.
- **Read-only flicker on anchor nav**: `did-navigate-in-page` rewrites `els.address.value`; re-applying
  `readOnly = true` there is idempotent — fine.
- **Lock + `toUrl` producing an internal-looking URL**: `toUrl` never yields `goldfinch://` from typical
  input (it prefixes `https://` or a search URL), so the web-branch reroute is the realistic path; the
  internal-URL branch in the lock is a belt-and-suspenders guard.
- **Do NOT widen `isSafeTabUrl`** or touch the internal preload bridge — out of scope (Flight 6).
- **The chip click does nothing yet** — leg 5 wires the popup (web) and static note (internal). Don't add a
  placeholder handler that conflicts with leg 5; leaving it unwired is correct for this leg.

## Files Affected
- `src/renderer/index.html` — add `#address-chip` button inside `#address-wrap`, before `#address`.
- `src/renderer/styles.css` — chip styling (neutral glyphs, both states).
- `src/renderer/renderer.js` — `updateAddressChip` + read-only toggle + `isInternalTab` helper + the
  `navigate()` lock; call the updater from `activateTab` + both nav handlers.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:** *(commit deferred to the flight-level review)*

- [ ] All acceptance criteria verified (offline; live behavior deferred to leg 7)
- [ ] Tests passing (offline gates)
- [ ] Update flight-log.md with leg progress entry (note chip-click behavior is leg 5; lock + read-only bar
  landed here)
- [ ] Set this leg's status to `landed` (commit deferred)
- [ ] Check off this leg in flight.md
- [ ] Do NOT commit; do NOT signal `[HANDOFF:review-needed]`
