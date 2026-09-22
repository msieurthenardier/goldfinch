# Leg: goldfinch-badge

**Status**: completed
**Flight**: [The In-Field Affordance](../flight.md)

## Objective

Replace the generic padlock in the injected vault icon (all three kinds: login, card,
identity) with the Goldfinch mark plus a lock-state overlay. The mark is an inline-SVG
goldfinch head on a gold disc, shown in BOTH lock states. A small padlock in the
bottom-right corner (closed/amber when locked, open/green when unlocked) carries the
state. The icon is built whole in `buildVaultLockIcon` and rebuilt whole on a lock-state
change, and its attribute-set pin is unchanged.

## Context

- Flight DD9 (the mark in both states plus a lock overlay; built whole and rebuilt
  whole — never mutated in place, per the `isIconOnlyMutation` single-node rule; one
  `<svg>` root; children are presentational shapes only; the root attribute keys stay
  exactly `aria-label, data-locked, focusable, height, role, viewBox, width, data-goldfinch-vault-lock`;
  accessible names are unchanged per kind; no emoji and no fetched images).
- The Flight Director drafts the SVG (below), and the operator approves or iterates it
  at the HAT (operator ruling). This leg ships the FD draft.
- **Risk tier: LOW.** It is one pure builder function plus its tests, and the security
  pins (attribute set, accessible name, no fetch) are unchanged. There is no design
  review, and the flight-end Reviewer covers it.
- **Sequencing:** Leg 3 also edits `src/preload/vault-fill-icon.js` (`onIconClick`'s
  gesture payload). This leg touches only `buildVaultLockIcon` (and the controller's
  chip styling if needed), so it runs AFTER Leg 3 lands.

## The FD draft (verified rendered at 16/32/96 px on light and dark fields)

Rendered with the project's own Electron (offscreen `capturePage`) inside the existing
near-white chip, on a white field and a `#1e1e1e` field. At 16 px the gold disc, the
black cap, the red mask and the beak read as the mark, and the overlay's colour plus its
shackle shape carry lock state. The overlay is enlarged slightly from the first draft
for 16 px legibility. `viewBox="0 0 24 24"`. The child order and shapes are below; the
colours are fixed fills except the overlay, which uses `currentColor` (set by the
controller: `COLOR_LOCKED` `#b06000`, `COLOR_UNLOCKED` `#137333`, unchanged):

```
<circle cx="12" cy="12" r="10.5" fill="#E8B83A"/>                                  disc
<path d="M5.6 9.4 C6.6 4.9 11.4 3.2 15.6 4.6 C19.4 5.9 21.4 9.8 20.2 14.2
         C19.2 11.4 17 9.3 14.3 8.8 C11.2 8.3 8.4 8.6 5.6 9.4 Z" fill="#141414"/>   black cap
<path d="M5.6 9.4 C8.2 8.5 11.2 8.4 13.4 9.3 C13.8 11.6 12.6 13.9 10.4 15.4
         C9.2 13.4 7.6 12.1 5.8 11.6 Z" fill="#D7222B"/>                            red mask
<path d="M5.8 9.5 L1.2 11.2 L5.9 12.3 Z" fill="#E8B83A" stroke="#141414"
      stroke-width="0.7" stroke-linejoin="round"/>                                 beak
<circle cx="10.2" cy="10.4" r="1.15" fill="#141414"/>                              eye
<circle cx="18.2" cy="18.2" r="5.6" fill="#ffffff"/>                               overlay backing
<path d="LOCKED: M16.4 17.6 V15.9 a1.8 1.8 0 0 1 3.6 0 V17.6
         UNLOCKED: M16.4 17.6 V15.9 a1.8 1.8 0 0 1 3.6 0" fill="none"
      stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>            shackle
<rect x="14.8" y="17.4" width="6.8" height="5" rx="1.1" fill="currentColor"/>      lock body
```

(The rendered reference PNG is in the FD scratchpad and is not committed.) Any
proportion tweak the Developer needs for crisp 16 px rendering is fine. It must keep
this structure: the disc, the cap, the mask, the beak, the eye, the overlay backing, the
shackle, and the lock body.

## Acceptance Criteria

- [ ] AC1: `buildVaultLockIcon(doc, locked, kind)` builds the SVG above, all via
      `createElementNS(SVG_NS, …)` + `setAttribute` (no `innerHTML`, no `<image>`, no
      `<use href>`, no external reference, no `<text>`/emoji). Every child is a
      `circle`/`path`/`rect` with only geometry/paint attributes (`cx cy r d x y width height rx fill stroke stroke-width stroke-linecap stroke-linejoin`).
- [ ] AC2: The root attribute set is byte-identical to today: the pinned-key tests
      (`vault-fill-icon.test.js` ~line 378 and the identity AC13/AC14 pin at ~line 580)
      pass UNMODIFIED. The accessible names per kind and lock state are unchanged, as
      are the `data-locked` marker and `width`/`height` 16.
- [ ] AC3: Lock state is carried by the overlay shackle. When locked it ends `…V17.6`
      (both legs reach the body); when unlocked, the right leg lifts free. The shackle
      is identified in tests as the `path` whose `stroke` is `currentColor`, not "the
      first path". Re-target the existing shackle test (~line 160–172) by RENAMING and
      adjusting it, not by deleting it: the first `path` is now the bird's cap. Keep
      its assertions' intent: closed reaches the body, open lifts free.
- [ ] AC4: The mark children (disc, cap, mask, beak, eye) are IDENTICAL between the
      locked and unlocked builds. Add a test comparing their serialized attributes; the
      mark never changes with state. Only the shackle differs.
- [ ] AC5: `setVaultLocked` still rebuilds whole (no in-place mutation). The existing
      rebuild/`isIconOnlyMutation` tests pass unmodified. Add no new mutation path.
- [ ] AC6: The chip styling in the controller (`s.color`, `s.background`) is unchanged
      unless 16 px legibility demands a tweak. Any change is recorded in the flight log
      and must keep the "reads on light AND dark fields" property (the near-white chip).
- [ ] AC7: All three kinds use the same builder (card and identity included): one test
      builds each kind in each state and asserts the structural child list
      (`circle, path, path, path, circle, circle, path, rect`).
- [ ] AC8: The picker's own padlock row glyph (`vault-picker-template.js`
      `buildCredentialIcon`) and the toolbar `#vault-indicator` glyph are OUT of scope
      and unchanged.
- [ ] AC9: The module header comment and the `buildVaultLockIcon` JSDoc are updated to
      describe the mark plus overlay. CLAUDE.md gets a one-line mention in the Password
      vault pattern (the in-field icon is the Goldfinch mark with a lock overlay, the
      attribute pin unchanged). `docs/vault.md` is updated if it describes the icon's
      look.
- [ ] AC10: `npm test`, lint, typecheck and format:check are green, and the preload
      bundle builds.

## Verification Steps

- `node --test test/unit/vault-fill-icon.test.js`, with `git diff` on that file
  showing the two attribute-pin tests untouched and the shackle test renamed rather than
  deleted.
- `timeout 600 npm test && npm run lint && npm run typecheck && npm run format:check`.
- Legibility at 16 px in both states, on light and dark fields, for all three kinds is
  judged by eye at the HAT (DD12). Optionally re-render with an offscreen Electron
  `capturePage` for the flight log. Write any such scratch script outside the repo.

## Implementation Guidance

1. Rewrite `buildVaultLockIcon`'s child construction; keep the root attribute block
   verbatim.
2. Re-target the shackle test and add the AC4/AC7 tests.
3. Update the comments and docs. Run format.

## Edge Cases

- **Page CSS targeting `svg path`** (hostile or just global styles such as
  `path { fill: red }`): the explicit `fill`/`stroke` presentation attributes lose to
  author CSS. Today's padlock has the same exposure, so this is not a regression and
  is out of scope. Do not add inline `style` attributes to children (it would widen
  what the page can read nothing of, but it is a new pattern). Note it in the flight
  log as a known limit.
- **Forced-colors / high-contrast mode:** the fixed fills may be overridden, and the
  accessible name still carries state. This is acceptable.

## Files Affected

- `src/preload/vault-fill-icon.js`: `buildVaultLockIcon` and comments
- `test/unit/vault-fill-icon.test.js`: the shackle test re-targeted, plus new tests
- `CLAUDE.md`, and `docs/vault.md` if it describes the icon

---

## Post-Completion Checklist

- [ ] All acceptance criteria verified
- [ ] Tests passing; bundle builds
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `landed`

## Citation Audit

Checked 2026-09-22:
- `vault-fill-icon.js`: `buildVaultLockIcon` (49–95), `COLOR_LOCKED`/`COLOR_UNLOCKED`
  (26–27), the chip styling (~327–330), `setVaultLocked` (~347), `isIconOnlyMutation`
  (~402)
- `vault-fill-icon.test.js`: the attribute pins (~378, ~580) and the shackle test
  (~160–172, which reads the FIRST `path`, hence AC3's re-target)

All present. Line numbers may shift slightly after Leg 3's edits to `onIconClick`.
