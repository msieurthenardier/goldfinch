# Leg: sheet-nofocus-and-template

**Status**: completed
**Flight**: [Address-Bar Suggestions](../flight.md)

## Objective

Give the menu-overlay machinery its non-focusing open path (flight DD2)
and the `suggestions` sheet template (flight DD1), plus the widened Ch2
reason allowlist (flight DD5 amendment) — manager unit pins included; no
renderer/omnibox wiring yet (leg 3).

## Contract

1. **`src/main/menu-overlay-manager.js`**:
   - `deliverInit(payload)`: gate the `view.webContents.focus?.()` call on
     `!payload.noFocus` (payload flag passes through Ch1 untouched —
     recon-verified; the pendingInit queue flushes the SAME payload
     object, so the flag survives the lazy-load race). **Add
     `noFocus?: boolean` to the `MenuOpenPayload` typedef** *(design
     review, HIGH — checkJs fails on the property access otherwise; the
     typedef is file-local, no cross-file consumers)*.
   - `openMenu`: call `hideFindOverlay()` only when the sheet was not
     already open — reuse the `currentMenu` truthiness already computed
     at the top as `wasOpen` *(design review: equivalent to
     visible-before-show, keeps the distinction in one place)*.
   - Unit pins (`test/unit/menu-overlay-manager.test.js`): `noFocus: true`
     init delivers WITHOUT focusing (and the existing no-flag pins stay
     green — verify, don't rewrite); find-hide fires once across a
     same-menuType model-replace sequence, and again after a close +
     re-open.
2. **`src/main/main.js`** — Ch2 (`menu-overlay:close`) handler: replace
   the `toggle|superseded` coercion with an explicit allowlist —
   `['toggle','superseded','escape','blur','navigation','input-empty',
   'activated']` (mirror the Ch5 SHEET_DISMISS_REASONS style; unknown →
   'superseded' fallback as today). Widen the two type pins:
   `chrome-preload.js` `menuOverlayClose` reason type and
   `renderer-globals.d.ts`. *(flight DD5 HIGH amendment)*
   Downstream-verified at design review: every reason consumer
   (focusChrome escape/activated-only; restoreFindOverlay's
   tab-lifecycle skip set; the Ch7 chrome handler; refocus maps)
   tolerates the new strings. Note: `navigation`/`input-empty` are NOT
   in restoreFindOverlay's skip set — a find session on the active tab
   may be re-shown after a suggestion navigates; pre-existing generic
   logic, accepted (HAT judges the feel). No main.js unit suite exists
   (repo convention — Ch5's coercion is likewise untested); the AC is
   inspection + leg-4 live behavior.
3. **`src/renderer/menu-overlay.js`** — register `suggestions` template.
   **Registration is FOUR-PART** *(design review, HIGH — the onInit
   dispatcher is a hardcoded if/else-if chain whose ELSE branch is
   input-dialog and FOCUSES; a registry entry alone silently falls into
   it)*: (a) a new DOM node + `menuController.register(...)` entry (the
   info-popup shape), (b) an entry in `NODE_OF_ENTRY`, (c) a NEW
   `else if (template === 'suggestions')` dispatch branch, (d) the
   `TEMPLATES` JSDoc `@type` union widened with `'suggestions'`
   (typecheck fails otherwise). Also refresh the file-header comment
   (three templates → four). Template details:
   - NO `items` getter (roving no-ops — info-popup precedent); `onOpen`
     focuses NOTHING.
   - Renders from `model`: a `role="listbox"` container
     (`aria-label "Address suggestions"`), one `role="option"` row per
     `model.items[i]` (`{ primary, secondary }` — both rendered via
     `textContent`), `aria-selected` + a `.selected` class on
     `model.selectedIndex` (may be -1 = none), an optional
     `model.emptyNote` string rendered as the note style when items is
     empty.
   - Row click → `sendActivatedOnce({ id: 'sug:' + i })` then
     `menuController.close(suggestionsEntry)` — the exact idiom of the
     menu/info-popup templates (one-shot guard + token auto-injection;
     NEVER the raw preload sendActivated) *(design review)*.
   - Own keydown: NONE — the sheet never has focus in this template's
     regime; Escape/typing live in the chrome. **Corrected claim**
     *(design review)*: a no-items entry gets ZERO controller Escape
     handling and we add none — if a pointer click gives the sheet
     native focus, Escape there is a true no-op; recovery is
     blur/outside-click/model-replace only. Accepted, documented.
   - Position: honor the standard anchor mechanics (`alignLeft` + `y`
     clamp) — no template-specific positioning code.
   - Styling (`menu-overlay.css`): listbox panel matching the menu
     panel's chrome (tokens), option rows with primary/secondary type
     scale, `.selected` highlight, max-width, ellipsis overflow.
4. **Registration**: the `TEMPLATES` registry entry is LOAD-BEARING
   (fallback is the FOCUSING `menu` template — flight DD2). Add a comment
   at the registry noting the suggestions template must never focus.

## Acceptance Criteria

- [x] Manager: noFocus gate + first-open-only find-hide, with the named
      unit pins; ALL existing manager pins green unmodified.
- [x] Ch2 allowlist widened + both type pins updated; existing callers
      (`toggle`) unaffected.
- [x] Template registered, renders per contract (textContent-only,
      listbox semantics, sug:<i> activation, no focus anywhere in its
      code path).
- [x] `npm test` / typecheck / lint green; suite ~1s.
- [x] Grep-AC: `grep -n "\.focus(" src/renderer/menu-overlay.js` hits
      contain NO suggestions-template lines.

## Files Affected

- `src/main/menu-overlay-manager.js`,
  `test/unit/menu-overlay-manager.test.js`
- `src/main/main.js` (Ch2 handler)
- `src/preload/chrome-preload.js`, `src/renderer/renderer-globals.d.ts`
  (reason type widening)
- `src/renderer/menu-overlay.js`, `src/renderer/menu-overlay.css`

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed`
- [x] Do NOT commit

## Citation Audit

All seams recon/Architect-verified this flight (deliverInit sole focus
site; show() never focuses — pinned test; Ch1 raw passthrough; Ch2
coercion at main.js:547-551; TEMPLATES fallback; info-popup no-items
precedent; sanitizeActivatedValue 24-char cap forcing index dispatch).
