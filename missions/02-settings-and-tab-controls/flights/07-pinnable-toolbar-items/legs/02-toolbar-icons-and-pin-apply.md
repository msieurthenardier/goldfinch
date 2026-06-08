# Leg: toolbar-icons-and-pin-apply

**Status**: landed
**Flight**: [Pinnable Toolbar Items (Media + Shields)](../flight.md)

## Objective
Convert the Media and Shields toolbar controls from **text** buttons to **icon + count-badge** buttons, and
make the chrome **show/hide** each per its `toolbarPins` state (read at startup + live on `settings-changed`),
with keyboard shortcuts unaffected.

## Context
- **DD2.** `#toggle-media` (`Media (N)`) and `#toggle-privacy` (`Shield (N)`) become icon buttons with a small
  count badge; unpinned → the button is hidden; pinned → shown. Both default pinned (DD1), so default UX is
  preserved.
- **WCAG 1.4.1 (preserve):** the Shields `(N)` count is today the **non-color cue** that reinforces the red
  `.alert` state (state not conveyed by color alone). The **badge must keep carrying the count** so this holds.
- **Shortcuts are independent:** `Ctrl+M`/`Ctrl+Shift+P` are a chrome `document` keydown (`renderer.js` ~1861)
  calling `togglePanel`/`togglePrivacy` — **not** the button's click — so hiding the button leaves the
  shortcut working (the operator's "unpinned keeps its shortcut"). **No change to the keydown handler.**
- **Read path:** the chrome reads pins via the Flight-6 `window.goldfinch.settingsGet('toolbarPins')` (now
  load-normalized to a full object — leg 1) and re-applies on the existing `window.goldfinch.onSettingsChanged`
  subscription (extend it; it currently only updates `homePageCache`).
- **+ DD5 debt:** add the `isInternalTab` cross-reference comment (renderer.js is touched here).

## Inputs
- `src/renderer/index.html` — `#toggle-media` (`.text-btn` + `<span id="media-count">Media</span>`),
  `#toggle-privacy` (`.text-btn` + `<span id="privacy-count">Shield</span>`).
- `src/renderer/renderer.js` — `renderMedia` (`els.mediaCount.textContent = 'Media (N)'`), `renderPrivacy`
  (`els.privacyCount.textContent = 'Shield (N)'` + `els.togglePrivacy.classList.toggle('alert', n>0)`), the
  `window.goldfinch.onSettingsChanged` handler, `els.toggleMedia`/`els.togglePrivacy`/`els.mediaCount`/
  `els.privacyCount`, `isInternalTab` + the `createTab` trusted set-site (`id:'internal'`).
- `src/renderer/styles.css` — `.icon-btn` (the target style), `.text-btn`, `.alert`.

## Outputs
- Icon + count-badge Media/Shields buttons; an `applyToolbarPins(pins)` chrome function; pins applied at
  startup + on `settings-changed`. The `isInternalTab` comment.

## Acceptance Criteria
- [ ] `#toggle-media`/`#toggle-privacy` (`index.html`) are **icon buttons** with an **icon glyph** + a small
  **count badge** child (the badge keeps the `id="media-count"`/`id="privacy-count"` so `renderMedia`/
  `renderPrivacy` keep their element refs). **Icon = a monochrome Unicode character (matching the existing
  icon-btns `◀▶⟳⋮`) OR a CSS pseudo-element glyph in `styles.css`** — **NOT inline `<svg>`** (DD2 operator
  decision; the chrome `index.html` CSP `default-src 'self'; style-src 'self' 'unsafe-inline'; …`). The glyph
  element is decorative (`aria-hidden="true"`); the accessible name comes from the button's `aria-label`. The
  **count badge** also carries `aria-hidden="true"` (the count lives in the button's `aria-label`, so the
  badge must not double-announce). Keep `aria-expanded`. (Exact glyphs HAT-tunable.)
- [ ] **`renderMedia`/`renderPrivacy`** set the **badge** to the bare count (e.g. `String(n)`), **hide it at
  0** (`.hidden` class), and set a **dynamic `aria-label`** carrying the count — `els.toggleMedia`:
  `n ? 'Media, ' + n + ' items' : 'Media'`; `els.togglePrivacy`: `n ? 'Shields, ' + n + ' blocked' : 'Shields'`.
  **`els.togglePrivacy.classList.toggle('alert', n > 0)` is preserved**, and the badge-carries-the-count
  comment (WCAG 1.4.1 non-color cue) is kept/updated.
- [ ] **`applyToolbarPins(pins)`** sets `els.toggleMedia.classList.toggle('hidden', !pins.media)` and
  `els.togglePrivacy.classList.toggle('hidden', !pins.shields)`. Called at **startup** (`window.goldfinch
  .settingsGet('toolbarPins').then(applyToolbarPins)`, with a `.catch` no-op) and from the **existing**
  `onSettingsChanged` handler (extend it: `if (all && all.toolbarPins) applyToolbarPins(all.toolbarPins)` —
  keep the `homePageCache` update).
- [ ] **Keyboard shortcuts unaffected** — the `Ctrl+M`/`Ctrl+Shift+P` `document` keydown handler is NOT
  changed; toggling visibility does not gate it (so an unpinned panel still opens via its shortcut).
- [ ] **Focus-restoration guard (new edge case):** `togglePanel`/`togglePrivacy` restore focus to
  `els.toggleMedia`/`els.togglePrivacy` when the panel closes — but if that button is **unpinned/hidden**
  (`display:none`), `.focus()` is a silent no-op and focus is stranded on `<body>`. Guard each:
  `if (!els.toggleMedia.classList.contains('hidden')) els.toggleMedia.focus();` (else leave focus where it is
  / a safe anchor). Applies to both panels.
- [ ] **Styling** (`styles.css`): the icon buttons match the toolbar's `.icon-btn` visual language; the badge
  is legible (small, positioned, e.g. a corner badge); the **`.alert` state styles the icon/badge red** (the
  alert visual moves with the button — don't lose it). `:focus-visible` ring preserved.
- [ ] **+ DD5:** a comment at `isInternalTab` notes its `tab.container.id === 'internal'` check is set at the
  `createTab` trusted branch (cross-reference, so the two stay in sync).
- [ ] `npm run lint`, `npm run typecheck`, `npm test` green (221 — no new unit tests; the toolbar render/apply
  is verified live in leg 7).

## Verification Steps
- `npm run lint && npm run typecheck && npm test` — green.
- Code read: icon buttons + badge (refs preserved); `renderMedia`/`renderPrivacy` update badge + aria-label +
  keep `.alert`; `applyToolbarPins` called at startup + from `onSettingsChanged`; the keydown handler is
  untouched; `.alert` CSS on the icon button; `isInternalTab` comment present.
- **Deferred to leg 7 (live + screenshot, before the HAT):** icons render legibly with the badge; pinned →
  shown, unpinned → hidden; Ctrl+M / Ctrl+Shift+P still open an unpinned panel; a11y clean.

## Implementation Guidance
1. **index.html**: restructure the two buttons to `class="icon-btn"` (drop `.text-btn`) with an icon-glyph
   element (`aria-hidden="true"`) + the count-badge `<span id="media-count"/#privacy-count" class="tb-badge
   hidden" aria-hidden="true">`. Keep `title`, `aria-expanded`; add an initial `aria-label`
   ("Media"/"Shields"). Glyph = **monochrome Unicode or a CSS pseudo-element** (NOT inline `<svg>` — DD2).
2. **renderMedia / renderPrivacy**: badge = bare count + `.hidden` toggle at 0; dynamic `aria-label`; keep
   `.alert` toggle on `#toggle-privacy`; keep/refresh the WCAG-1.4.1-count comment.
3. **applyToolbarPins(pins)** + the startup `settingsGet('toolbarPins').then(...)` + extend `onSettingsChanged`.
4. **styles.css**: `.tb-badge` styling + `.alert` on the icon button (red icon/badge); ensure the icon-btn +
   badge read on `--bg-3`. **Note:** the existing `#toggle-privacy.alert` rule has a `border-color` line that
   becomes **vestigial** on `.icon-btn` (no border) — the `background`/`color` still render the red state;
   leave a comment, and verify at leg 7 that the small (32px) red icon button + badge reads clearly (consider
   a badge-specific accent rather than the whole button going red if it's muddy).
5. **isInternalTab comment** (DD5).
6. **Focus-restoration guards** in `togglePanel`/`togglePrivacy` (per the AC above).

## Edge Cases
- **Both unpinned**: both icons hidden — only the kebab remains in that toolbar region; acceptable (re-pin from
  settings / shortcuts still work).
- **Badge at 0**: hidden (no `(0)`); aria-label drops the count.
- **`.alert` must move with the button** — verify the red state still shows on the icon/badge, not lost in the
  text→icon restructure.
- **Don't gate the shortcut** on visibility — `togglePanel`/`togglePrivacy` must still run when the button is
  hidden.
- **settingsGet at startup** resolves async — a `.catch(()=>{})` keeps boot safe; default-pinned means the
  buttons are visible by default in the HTML (so no flash-of-hidden).

## Files Affected
- `src/renderer/index.html` — icon + badge buttons.
- `src/renderer/renderer.js` — badge/aria-label render; `applyToolbarPins` + startup + onSettingsChanged;
  isInternalTab comment.
- `src/renderer/styles.css` — `.tb-badge` + `.alert`-on-icon styling.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:** *(commit deferred to the flight-level review)*

- [ ] All acceptance criteria verified (offline; live render + screenshot deferred to leg 7)
- [ ] Tests passing (offline gates)
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `landed` (commit deferred)
- [ ] Check off this leg in flight.md
- [ ] Do NOT commit; do NOT signal `[HANDOFF:review-needed]`
