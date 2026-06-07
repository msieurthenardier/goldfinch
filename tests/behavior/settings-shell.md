# Behavior Test: Settings page shell + address-bar chips

**Slug**: `settings-shell`
**Status**: draft
**Created**: 2026-06-07
**Last Run**: never

## Intent
Verify that `goldfinch://settings` presents a **recognizable, accessible settings shell** (persistent
left section-nav + titled sections + placeholder content) and that the **address-bar chips** behave
correctly — an internal-page identity chip on `goldfinch://`, a web-page site-info chip + popup on
`http(s)` (summarizing existing per-tab data), and the **internal-tab navigation lock** (a web URL typed
in a `goldfinch://` tab opens a new normal tab rather than navigating the internal tab). This needs a
behavior test rather than a unit test because the assertions are real-environment, cross-process UI
observations: the shell renders inside a `<webview>` guest on a privileged scheme, the chip lives in the
chrome renderer and reflects the active tab, and the lock is a navigation-routing behavior visible only
in the running app. SC6 (recognizable shell) and SC8 (keyboard + a11y) are exactly this shape.

## Preconditions
- Goldfinch running via `npm run dev:debug` (CDP `:9222`); `scripts/cdp-driver.mjs` reaches it. **Not**
  the `chrome-devtools` MCP (it launches its own browser → false pass).
- The build includes the served `settings.css` (+ optional `settings.js`) and the chip/popup/lock code.
- A reachable web page for the web-chip + lock checks (e.g. `https://example.com/`).
- **Guest-reachability probe** (belt-and-suspenders): after opening Settings, confirm the
  `goldfinch://settings` guest is attachable for DOM reads (it surfaced in the flat CDP `/json` list in
  Flight-4 live runs; if a build ever changes that, fall back to `Target.getTargets`/`setAutoAttach`).

## Observables Required
- browser (rendered guest DOM of `goldfinch://settings` — the `<nav>` links, the titled `<section>`s and
  their `<h2>`s, `aria-current`; the chrome renderer's chip element + popup; tab set + partitions —
  measured via `scripts/cdp-driver.mjs` / node-CDP attach to the renderer **and** the guest target;
  screenshot + a11y tree primary, DOM reads supplementary)
- shell (precondition probes: `:9222` reachable, cdp-driver eval — measured via Bash)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Probe: `node scripts/cdp-driver.mjs eval '1+1'`; confirm a renderer target at `:9222`. | Returns `2`; a Goldfinch renderer (index.html) target is present. Else halt. |
| 2 | Open Settings via the kebab (⋮ → Settings), or the identical trusted path `createTab('goldfinch://settings', null, {trusted:true})` — note which. Wait for load. | A tab opens to `goldfinch://settings`; the active webview's partition is `goldfinch-internal`; the address bar shows the internal URL. |
| 3 | Attach to the `goldfinch://settings` guest; read its `<nav>` links and `<section>`/`<h2>` set; screenshot. | The guest renders a **persistent left section-nav** with the 5 links (Appearance, Privacy & Shields, On startup / Home page, Downloads, About) and **5 titled `<section>`s** each with an `<h2>` + placeholder content. Recognizable as a settings area. |
| 4 | In the guest, move keyboard focus to a section nav link (Tab to it) and activate it (Enter). | Focus reaches the nav link (visible focus ring); activating it moves to the corresponding section (the target `<section>`/`<h2>` is scrolled into view / focused). Section nav is keyboard-operable. `[a11y]` |
| 5 | (Setup) Run `npm run a11y -- --target=goldfinch://settings` against the open shell. | (empty — judged in step 6) |
| 6 | Read the guest-target a11y result. | **No NEW violations** vs the pinned `ACCEPTED` baseline — the shell introduces no new WCAG A/AA violations. `[a11y]` |
| 7 | Confirm the **internal-page identity chip**: with the Settings tab active, read the chip element in the chrome `#address-wrap`. | An internal-page identity chip is shown (a "Goldfinch"/secure-internal indicator), distinct from the web-page chip; it is NOT a web origin/lock. |
| 8 | Open a normal web tab to `https://example.com/` and activate it; read the chip in `#address-wrap`. | A **web-page site-info chip** is shown (a connection/lock indicator + the origin `example.com`), distinct from the internal chip. |
| 9 | Click the web chip; read the popup element + its text. | A site-info **popup** opens showing the origin + connection (https) + a compact summary derived from the tab's existing privacy data (trackers blocked / permissions count) + a **"Site settings →"** action. *(A freshly-opened site legitimately summarizes to `0 trackers` / empty; `tab.privacy.net` is null until the ~350ms `privacy-net` IPC arrives — `0`/"—"/empty is a valid pass, the popup must not be blank/crashed.)* |
| 10 | Activate the popup's "Site settings →" action; observe the chrome. | The existing **Shields/privacy panel** opens for the site (the popup is a thin entry point, not a duplicate). The popup closes. |
| 11 | **Internal-tab lock**: re-activate the `goldfinch://settings` tab; type a web URL (`https://example.com/`) into the address bar and press Enter (or invoke `navigate('https://example.com/')` while the internal tab is active — note which). | A **new normal tab** opens to `https://example.com/` (partition `persist:goldfinch`); the **internal Settings tab stays on `goldfinch://settings`** (its webview did NOT navigate to the web URL). The tab count increased by one. |
| 12 | Dismiss the site-info popup by clicking elsewhere / pressing Escape (if still open) and confirm the shared menu-dismiss behavior. | The popup closes on outside-click / Escape (it routes through the shared `menuController`); focus returns appropriately. `[a11y]` |

**Row conventions**: `[a11y]`-marked rows are accessibility-relevant. Step 11's lock is the UX half of the
Flight-4 internal-tab finding — it does NOT assert the security origin-check (that's Flight 6).

## Out of Scope
- **Wiring real settings controls** (Shields toggles, home page) — placeholder content only this flight
  (SC7 / Flight 6).
- **The security origin-check** of the internal bridge (Flight 6) — step 11 verifies the *navigation
  lock* (UX), not that a web page can't reach privileged IPC.
- The `goldfinch://` boundary vectors — covered by `tab-scheme-guard` (run as a regression).

## Variants (optional)
- N/A for the draft. Could later parametrize the section set or add a tabbed-navigation variant.
