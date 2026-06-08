# Leg: hat-and-alignment

**Status**: completed
**Flight**: [Settings Page Shell + Address-Bar Chips](../flight.md)

## Objective
Guided human acceptance test of the live shell, chips, popup, and internal-tab lock — feel/alignment pass
with inline fixes for anything the operator flags.

## Outcome
**PASS** (operator-confirmed). The Flight Director drove the running app on `:9222`; the operator judged the
subjective feel and surfaced three issues, all fixed inline and re-verified live:

1. **Shields "Connection" said "Not secure — HTTP" on internal tabs** — contradicted flight 5's own chip
   ("Secure Goldfinch page"). Fixed: the privacy-panel Connection block special-cases `isInternalPageUrl`
   → "Secure — Goldfinch page" (`renderer.js`). (`goldfinch://` is registered `{ secure: true }`.)
2. **Shields "Cookies" stuck on "Loading…"** — pre-existing race: `fetchCookies()` early-returns when
   `tab.wcId` is null (before the webview `dom-ready`) and never retried. Fixed: the `dom-ready` handler
   re-runs `fetchCookies()` when the Shields panel is open on the active tab (`renderer.js`). Operator chose
   to fix in-flight rather than defer to Flight 6.
3. **Address-bar lock should be semantic** (operator alignment, in scope per the flight's "chip glyphs tuned
   at HAT" open question) — green **closed** lock for HTTPS, red **broken** lock for HTTP. Fixed:
   `updateAddressChip` sets `data-secure` + a security-aware `aria-label` ("…, not secure" for http);
   `styles.css` colors the glyph green (`#6dff8f`)/red (`#ff6b6b`) and renders an ajar shackle for insecure.
   Not color-alone — shape (closed vs broken) + the `aria-label` text also differentiate (WCAG 1.4.1).

All three re-verified live (reload-from-disk + CDP reads + screenshot) and operator-confirmed. Offline gates
stayed green (182/182) after each fix.

## Confirmed live (subjective + functional)
- Shell reads as a settings area; sidenav + 5 titled sections legible; brand styling right.
- Internal chip = green secure diamond; address bar read-only on the Settings tab (the lock).
- Web chip = green closed lock (HTTPS) / red broken lock (HTTP); site-info popup shows origin/connection/
  `tab.privacy` summary + "Site settings →" → Shields.
- Shields Connection + Cookies correct on internal tabs (the two fixes above).

---

## Post-Completion Checklist
- [x] Guided HAT performed with the operator; subjective feel accepted
- [x] All flagged issues fixed inline + re-verified live
- [x] Offline gates green after fixes (182/182)
- [x] Flight log updated (HAT + the three fixes)
- [x] Status `completed`; flight lands
