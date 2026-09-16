# Squawk 0081: CLAUDE.md — name the per-tab pushed-state rules M20 F2 learned

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-16
**Completed**: 2026-09-16

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

Docs only, in CLAUDE.md's existing dense voice — one bullet per rule, each
citing the file:symbol that embodies it, placed in the section a reader would
already be looking at:

- **"Chrome indicators (pure decision models)"** — new bullet "Per-tab
  pushed-state routing rules (M20 F2, `security`)" stating (a) a new per-tab
  state gets its own owner-routed push channel, never riding a push whose
  chrome handler has unrelated side effects (`tab-security` vs
  `tab-did-navigate`, `guest-wiring.js`'s `did-navigate` handler); (b) an
  indicator never claims a state main has not pushed (`navigation-controller.js`'s
  `updateAddressChip` renders `NONE` for unpushed/unrecognized `tab.security`,
  never a scheme guess); (c) the controller that stores a pushed state
  refreshes its own rendered consumer in the same handler
  (`site-security-controller.js`'s `onTabSecurity` → `updateAddressChip`;
  `load-failure-controller.js`'s `onTabLoadFailure` updates the chip
  unconditionally, guarding only the address-VALUE write behind
  `document.activeElement`).
- **"TLS trust"** — new bullet "Cached vs in-band, same commit" stating (d)
  `deriveSecurityState` (`src/shared/site-security.js`) checks the
  navigation's own `certOverride` stamp before the observer's cached verdict,
  and the verify-proc observer (`cert-observer.js`) is hostname-keyed
  (Electron's verify `Request` has no port) — two https origins on one
  hostname with different ports share a cache slot; the overridden path never
  reads it; a trusted page's viewer on such a host may show the most recently
  verified certificate (accepted gap).
- **"Menu-overlay sheet"**, beside the existing Hardening bullet — new bullet
  "Four-guard decision channels" stating (e) any state-changing sheet→main
  channel carries four named guards in order — sender identity
  (`recordForSheetSender`), open-token freshness, `current.menuType`, business
  gate — with `menu-overlay:cert-override-proceed` (`register-overlay-ipc.js`)
  as the exemplar extending the `bookmarks-overflow` three-guard precedent,
  and a note that a read-only/low-stakes channel (`bookmark-edit-submit`) is
  not that precedent.

No code changed; every rule was verifiable as already true against the cited
code (`onTabSecurity`, `updateAddressChip`, `deriveSecurityState`,
`cert-observer.js`'s header comment, the `cert-override-proceed` handler, and
`onTabLoadFailure`'s focus-guarded value write), so the scope gate did not
trigger.

## Verification

- `npm run format` — no changes to any tracked file other than the three new
  bullets already written into CLAUDE.md (git status confirmed no other file
  touched).
- `npm run format:check` — passes ("All matched files use Prettier code
  style!"). Note: `.prettierignore` lists `*.md`, so CLAUDE.md is NOT
  Prettier-formatted/checked by this gate — the pass is real but does not
  validate CLAUDE.md's prose/formatting, only that no other tracked file
  drifted.
- `grep -n "cert-override-proceed\|never claims a state\|own owner-routed
  push\|hostname" CLAUDE.md` — shows all three new bullets' lines (four hits:
  the two new bullets plus the two pre-existing TLS-trust lines that already
  used those phrases/citations).

## Sign-Off

**Reviewer**: Reviewer agent (Sonnet), batch review of squawks 0078–0081, 2026-09-16
**Verdict**: confirmed — corrective action correct, complete, confined to the reported surface; 4784/4784, lint/typecheck/format clean
**Commit**: `squawk: turnaround 2026-09-16` on `squawk/turnaround-2026-09-16`
