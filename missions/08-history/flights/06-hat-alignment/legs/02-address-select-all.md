# Leg: address-select-all

**Status**: completed
**Flight**: [HAT & Alignment](../flight.md)

## Objective

Ruling R1: clicking into the address bar when it already holds a URL
selects the whole text (browser convention), so typing replaces rather
than appends.

## Context

- HAT step 2 (F4 omnibox) surfaced this; operator ruled "yes, select-all
  on focus" (flight-log Decisions R1).
- `focus-address` (Ctrl+L) ALREADY does `els.address.focus()` +
  `els.address.select()` (`renderer.js:2839-2841`) — so the keyboard path
  is correct; only the MOUSE-click focus path misses it.
- The address `<input>` is `els.address` (`renderer.js:36`); it is set
  `readOnly` on internal `goldfinch://` tabs (`updateAddressChip`,
  ~renderer.js:1118-1148); it has `input`/`blur`/`keydown` listeners for
  the omnibox suggestions controller (F4) — the fix must not disturb them.

## Change (single surface — renderer.js only)

Add the standard "select-all on first click" pattern to `els.address`: a
`mousedown` listener that, when the input is NOT already the active
element (i.e. the click is what's focusing it) and NOT readOnly,
`preventDefault()`s the default cursor-placement, then programmatically
`focus()` + `select()`. Subsequent clicks while already focused fall
through to normal cursor placement (do nothing / don't preventDefault),
so the operator can still click-to-position after the initial select.

Sketch:
```js
els.address.addEventListener('mousedown', (e) => {
  if (els.address.readOnly) return;              // internal tabs: leave alone
  if (document.activeElement === els.address) return; // already focused → normal cursor placement
  e.preventDefault();
  els.address.focus();
  els.address.select();
});
```
Place it near the other `els.address` listeners (input/blur/keydown block,
~renderer.js:1315+). No CSS, no other files.

## Acceptance Criteria

- [x] First mouse click into a populated address bar selects the whole
      URL (typing replaces it); a second click places the cursor normally.
      (Implemented per Change section; live verification deferred to the
      `hat-reverification` leg.)
- [x] Ctrl+L behavior unchanged (still focus + select) — untouched, the
      `focus-address` handler (`renderer.js:2839-2841`) was not modified.
- [x] Internal-tab (readOnly) address bar unaffected — no select-all,
      no interference — the listener's first line returns early on
      `els.address.readOnly`.
- [x] The omnibox suggestions controller is undisturbed: typing after the
      select still drives suggestions; blur/keydown/Escape unchanged —
      the `input`/`blur`/`keydown` listeners were not modified, only a
      new `mousedown` listener was added ahead of them.
- [x] `npm test` / `npm run typecheck` / `npm run lint` green (no unit
      suite covers this DOM behavior — gates are the static nets;
      verification is the HAT re-walk in the closing leg).

## Verification Steps

- Gates green. Live behavior is re-verified in the `hat-reverification`
  leg (click address bar → whole URL selected).

## Files Affected

- `src/renderer/renderer.js` — one `mousedown` listener on `els.address`.

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed`
- [x] Do NOT commit (flight-level review + commit after the last
      autonomous leg)
