# Squawk 0081: CLAUDE.md — name the per-tab pushed-state rules M20 F2 learned

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-16
**Completed**: —

## Report

Mission 20 Flight 2 paid for five findings (F1, F3, F4, F5 and the DD7
channel split) that reduce to rules no CLAUDE.md section yet states:
(a) a NEW per-tab state gets its OWN owner-routed push channel — never ride
an existing push whose chrome handler has unrelated side effects
(`tab-security` vs `tab-did-navigate`); (b) an indicator never claims a state
main has not pushed — no scheme-derived or default guess before the push
(`updateAddressChip`, F4); (c) the controller that stores a pushed state
refreshes its own rendered consumer (`onTabSecurity` → `updateAddressChip`,
F3; the focus-guarded value write vs the chip update, F1); (d) a cached
observation never outranks an in-band decision for the same commit
(`deriveSecurityState`, F5) and the verify-proc observer is hostname-keyed
(Electron's request has no port); (e) any state-changing sheet→main channel
carries the FOUR named guards — sender identity, token freshness, current
menuType, business gate (`menu-overlay:cert-override-proceed`, after the
`bookmarks-overflow` three-guard precedent). They belong in the "TLS trust" /
"Chrome indicators" / "Menu-overlay sheet" sections as numbered rules.

## Evidence

- `missions/20-no-silent-failures/flights/02-tls-trust/flight-debrief.md`
  (Key Learnings; Recommendation 1).
- `src/renderer/chrome/site-security-controller.js` `onTabSecurity`;
  `src/renderer/chrome/navigation-controller.js` `updateAddressChip`;
  `src/shared/site-security.js` `deriveSecurityState`;
  `src/main/register-overlay-ipc.js` the proceed handler's guard comment.

## Corrective Action

_(written at completion)_ Docs only — one bullet per rule in the named
sections, citing the file:symbol that embodies it.

## Verification

Read pass; `npm run format:check`.

## Sign-Off

_(written at completion)_
