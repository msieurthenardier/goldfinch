# Squawk 0072: Vault fill icon click dismisses outside-click-closing login panels

**Status**: completed
**Type**: defect
**Severity**: grounding
**Reported**: 2026-09-14
**Completed**: 2026-09-14

## Report

On a site whose sign-in form lives in a drawer/modal that dismisses on any
pointer-down outside itself, clicking the vault lock icon closes the drawer
before the picker/fill round-trip lands, so the password field is gone by fill
time and nothing is filled.

Reproduced live on Domino's (`https://www.dominos.com/#!/customer/login/`):
Sign In → enter email → Continue → the "Finish signing in" drawer shows the
password field → focus it (icon appears) → click the icon → the drawer collapses
and the picker/unlock sheet opens over a page with no password field.

Root cause: the decorative lock icon is appended to `document.body`, OUTSIDE the
drawer subtree. The drawer's dismiss-on-outside-pointerdown handler runs in the
CAPTURE phase and treats the icon click as an outside click. Stopping propagation
at the icon does not help (verified live — the page's handler runs first).
Appending the icon INTO the anchor field's `parentElement` (positioned relative
to the nearest non-static ancestor) keeps the drawer open and lands the icon at
the identical pixel position (icon rect 1348,188,16,16 for field rect
1032,180,336,32 — byte-identical to the current body placement).

## Evidence

- `src/preload/vault-fill-icon.js:placeVaultIcons` — `const parent = doc.body || doc.documentElement;` … `parent.appendChild(icon);` — the icon always lands on `<body>`.
- `src/preload/vault-fill-icon.js:positionIcon` — `rect.top + (win.scrollY || 0)` — body-relative coordinates; with an in-tree anchor the offsets must be relative to the nearest positioned ancestor (walked via `getComputedStyle` — an `<svg>` has no `offsetParent`), subtracting that ancestor's `clientTop`/`clientLeft`.
- Live probe (MCP `evaluate`, wcId 12, 2026-09-14): synthetic pointerdown→click on the body-level icon → `pwStillPresent: false`; same sequence on the password field → `true`; same sequence on the icon re-parented into the field's `<label>` → `true`, drawer open, icon rect unchanged.
- `test/unit/vault-fill-icon.test.js` — fake-document harness; no test pins the icon's parent today.

## Corrective Action

`src/preload/vault-fill-icon.js`'s `placeVaultIcons` now appends the decorative
lock icon into the FOCUSED FIELD'S OWN `parentElement` instead of unconditionally
onto `document.body`. `positionIcon` gained an `ancestor` parameter: when the icon
is placed in-tree, a new `nearestPositionedAncestor(startEl)` helper walks up from
the field's parent via `window.getComputedStyle(el).position !== 'static'`
(stopping at `body`/`documentElement` without checking either — reaching either
means "no positioned ancestor") and, if found, `positionIcon` computes offsets
relative to that ancestor's border box (`getBoundingClientRect()` minus
`clientTop`/`clientLeft`) using the exact formula from the squawk's live probe.
Two fallbacks preserve the pre-fix behavior exactly where in-tree placement isn't
possible or verifiable: (1) a field with no `parentElement` still appends to
`doc.body || doc.documentElement`; (2) when `window.getComputedStyle` isn't a
function (only a hand-rolled test double lacks it — every real `Window` has it),
placement falls back to body-relative append AND the original scroll-relative math
wholesale, not a half-migrated in-tree-append-with-wrong-math state. No other
behavior changed: `isIconOnlyMutation` still keys on the icon nodes via the
`iconNodes` WeakSet (parent-agnostic, unaffected), `setVaultLocked`'s rebuild-drop
path (`icon.remove()`) is DOM-API-agnostic to the current parent, and
`scheduleIconPlacement`/focus-gating/`isFieldVisible`'s honeypot rule are
untouched.

**Why in-tree placement over `stopPropagation`**: the squawk's live probe on
Domino's established that the drawer's dismiss-on-outside-pointerdown handler runs
in the CAPTURE phase, which fires and can act BEFORE any listener on the icon
itself (including a `stopPropagation` there) gets a chance to run — stopping
propagation at the icon is structurally too late for a capture-phase ancestor
listener. Moving the icon OUT of `document.body` and INTO the field's own subtree
makes the click a click ON the drawer's own subtree, so the drawer's own
same-subtree-click check (whatever internal predicate it uses to decide "outside")
no longer fires the dismiss at all — no propagation-order dependency, no assumption
about the page's own listener order.

## Verification

- `timeout 300 npm test` — 4438/4438 pass (0 fail), including the two new
  `vault-fill-icon.test.js` cases and the full existing suite (`vault-card-icon.test.js`
  unaffected, still green — confirms `findAllCardFields`'s card anchors share the
  same in-tree/fallback logic transparently since they route through the same
  `placeVaultIcons`/`positionIcon`).
- `timeout 120 npm run lint` — clean, no output/errors.
- `timeout 300 npm run typecheck` — clean, no output/errors.
- `npm run format` — reformatted only the new test file's quote style (double vs
  escaped-single around an apostrophe in a test description); `npm run format:check`
  — "All matched files use Prettier code style!".
- New pinning test added: "the icon is inserted inside the focused field's parent
  element, not `<body>`, and positioned relative to the nearest positioned
  ancestor" (`test/unit/vault-fill-icon.test.js`) — builds a fake parent chain
  (field → static `innerDiv` → `position:relative` `positionedDiv` → body) with a
  fake `window.getComputedStyle`, and asserts (a) the icon is NOT a child of
  `doc.body` and IS a child of `innerDiv`, and (b) `top`/`left` match the squawk's
  formula exactly (`186px`/`1345px` for the fixture's numbers). A companion test
  pins the `window.getComputedStyle`-absent fallback: the icon lands on `<body>`
  with the untouched scroll-relative math, even though the field has an in-tree
  `parentElement`. All pre-existing tests in `vault-fill-icon.test.js` and
  `vault-card-icon.test.js` pass UNMODIFIED — their fixtures never set
  `field.parentElement`, so they exercise the (unchanged) body-fallback path,
  matching the squawk's "fall back to appending to body as today" requirement.
- Live-probe evidence cited from the squawk (not re-verified live in this pass,
  since MCP automation was unavailable in this environment — `goldfinch-dev`
  connection timed out): the squawk's own measurement (icon rect `1348,188,16,16`
  for field rect `1032,180,336,32`, ancestor effectively at page origin) matches
  this implementation's formula algebraically — with `ancestorRect.top/left = 0`
  and `clientTop/clientLeft = 0`, `top = 180 + (32-16)/2 = 188` and
  `left = 1032 + 336 - 20 = 1348`, exactly the squawk's cited pixels.

## Sign-Off

**Reviewer**: independent Reviewer (Sonnet), scoped to the diff
**Verdict**: confirmed — independently re-ran the green bar (4438/4438), lint,
typecheck, and format:check; traced the placement math (padding-box offset via
`clientTop`/`clientLeft`, no `scrollY` in-tree, scroll-relative fallback correct
against the initial containing block), the re-parenting/prune path, the
`isIconOnlyMutation` parent-agnostic classification, and the trust model
(decorative, secret-free, `isTrusted`-gated — unchanged). Two non-blocking
observations recorded as candidates for future squawks, not folded in: (1) the
ancestor walk keys on `position` only — `transform`/`filter`/`will-change`/
`contain` also establish containing blocks; (2) an in-tree icon can be clipped
by an intermediate `overflow:hidden` or stacking context on some sites.
**Commit**: `squawk/0072: anchor the vault fill icon inside the field's parent`
on branch `squawk/0072-vault-icon-outside-click-dismiss`
