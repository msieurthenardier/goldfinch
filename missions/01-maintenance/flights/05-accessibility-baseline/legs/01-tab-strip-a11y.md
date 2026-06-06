# Leg: tab-strip-a11y

**Status**: completed
**Flight**: [Accessibility — Keyboard & Screen-Reader Baseline](../flight.md)

## Objective
Make the tab strip keyboard- and screen-reader-operable: a `tablist`/`tab` ARIA structure with roving tabindex, arrow/Home/End/Delete key navigation scoped to the strip, a focusable close `<button>` with a title-tracking accessible name, and a visible focus indicator on tabs (F22).

## Context
- Flight **DD1** defines the model: `role="tablist"` on `#tabs`; each `.tab` becomes `role="tab"` with `aria-selected` + roving tabindex (selected `0`, others `-1`); **automatic activation** (arrows move focus *and* activate, wrapping); Home/End jump; **Delete/Backspace closes** the focused tab; close affordance is a `<button>` with `aria-label="Close tab: {title}"`; `aria-keyshortcuts="Delete"` for discoverability.
- **DD1 couplings (mandatory):** scope the key handler to the strip elements, **NOT `document`** (two `document`-level keydown listeners already exist — lightbox `renderer.js:641`, shortcuts `renderer.js:1283` — a `document` arrow/Delete handler would hijack `#address` typing and `<webview>` focus); assign each `<webview>` an `id` so `aria-controls` can reference it; update the close button's `aria-label` on `page-title-updated`, not once at creation.
- **DD4:** renderer is whole-codebase `@ts-check`'d, `sourceType:"script"` — budget for `HTMLElement`/`HTMLButtonElement` casts on new DOM access; leg ACs include `npm test` + `npm run typecheck` + `npm run lint` clean.
- This is leg 1 of 5; no prior legs. The `tab-keyboard-operability` behavior-test spec was authored during planning (`tests/behavior/tab-keyboard-operability.md`, `draft`); its live run is deferred to the `verify-a11y` leg, not this leg.

## Inputs
- `src/renderer/renderer.js` — current tab code: `createTab` (`:132-182`), `closeTab` (`:184-196`), `activateTab` (`:198-212`), webview creation (`:137-143`), `page-title-updated` handler (`:239-243`).
- `src/renderer/index.html` — `<div id="tabs"></div>` (`:15`).
- `src/renderer/styles.css` — `.tab` (`:54-66`), `.tab.active` (`:67-69`), `.tab .tab-close` (`:81-93`); **no `:focus-visible` rule anywhere**.
- Tooling present: `npm test` (node --test, 147 passing), `npm run typecheck` (tsc, 0 errors), `npm run lint` (eslint flat, 0).

## Outputs
- `#tabs` is a `tablist`; every tab is a `role="tab"` with correct ARIA + roving tabindex; each webview has an id; close is a named `<button>`; the strip is keyboard-operable; tabs show a visible focus ring.
- All offline gates (`npm test`, `npm run typecheck`, `npm run lint`) green.

## Acceptance Criteria
- [x] `#tabs` carries `role="tablist"` and an accessible name (e.g. `aria-label="Open tabs"`) — set in `src/renderer/index.html:15`.
- [x] Each tab button is created with `role="tab"`, `aria-selected` (string `"true"`/`"false"`), a roving `tabindex` (active tab `0`, all others `-1`), `aria-controls` referencing its webview's `id`, `aria-keyshortcuts="Delete"`, and `aria-label` set to the page title (updated on title change).
- [x] Each `<webview>` is created with a unique `id` (e.g. `webview-${id}`) that its tab's `aria-controls` points to.
- [x] The close affordance is a `<button class="tab-close">` (not a `<span>`) with `tabindex="-1"` and `aria-label="Close tab: {title}"`, where `{title}` tracks the page title via the `page-title-updated` handler.
- [x] The decorative favicon `<img class="tab-fav">` has `alt=""`.
- [x] `activateTab` sets `aria-selected` + roving `tabindex` on every tab (exactly one tab `aria-selected="true"` and `tabindex="0"` at all times).
- [x] A `keydown` handler is attached to **`els.tabs`** (the strip), not `document`: `ArrowRight`/`ArrowLeft` move focus and activate the adjacent tab (wrapping); `Home`/`End` activate first/last; `Delete`/`Backspace` close the focused tab. After each, focus lands on a `role="tab"` element (never `<body>`); the window is never left with zero tabs.
- [x] Mouse behavior is unchanged: clicking a tab activates it; clicking the close button closes that tab (no regression).
- [x] A visible focus indicator is rendered for a focused tab — a `.tab:focus-visible` rule with an outline ≥3:1 against the tab background (e.g. `outline: 2px solid var(--accent)`). (A `.tab-close:focus-visible` rule is included as defensive styling, but the close button is `tabindex="-1"` so it is not keyboard-focusable — this AC is satisfied by the *tab* focus ring, which the behavior test asserts.)
- [x] `npm test` (147 pass), `npm run typecheck` (0 errors), `npm run lint` (0 problems) all clean.

## Verification Steps
- `grep -n 'role="tablist"' src/renderer/index.html` → present on `#tabs`.
- `grep -n "setAttribute('role', 'tab')\|aria-selected\|aria-controls\|aria-keyshortcuts\|tabIndex" src/renderer/renderer.js` → role/state/roving wiring present in `createTab`/`activateTab`.
- `grep -n "els.tabs.addEventListener('keydown'" src/renderer/renderer.js` → keydown scoped to the strip (and **no** new `document.addEventListener('keydown'` for tab nav).
- `grep -n "tab-close" src/renderer/renderer.js` → `document.createElement('button')` (or button markup) for close, with `aria-label`.
- `grep -n ':focus-visible' src/renderer/styles.css` → at least `.tab:focus-visible`.
- `npm run typecheck` → `0 errors`. `npm run lint` → exit 0. `npm test` → 147 pass / 0 fail.
- Deferred to `verify-a11y`: `/behavior-test tab-keyboard-operability` (live keyboard/AT run).

## Implementation Guidance

1. **`index.html` (`:15`)** — change `<div id="tabs"></div>` to `<div id="tabs" role="tablist" aria-label="Open tabs"></div>`.

2. **`createTab` — webview id (`renderer.js:137-143`).** When the webview is created, set `webview.id = \`webview-${id}\``.

3. **`createTab` — tab button (`renderer.js:160-177`).** After `btn.dataset.id = id`, add:
   - `btn.setAttribute('role', 'tab');`
   - `btn.setAttribute('aria-selected', 'false');` (activateTab will correct it)
   - `btn.tabIndex = -1;` (roving; activateTab promotes the active one to 0)
   - `btn.setAttribute('aria-controls', \`webview-${id}\`);`
   - `btn.setAttribute('aria-keyshortcuts', 'Delete');`
   - `btn.setAttribute('aria-label', 'New tab');` (the tab's accessible name; updated on title change — using `aria-label` avoids messy name concatenation from the title span + close button)
   - In the `innerHTML`, **preserve the leading `${dot}`** (the non-default-jar colored dot, `:164-167`), give the favicon `alt=""`, and make close a button: `\`${dot}<img class="tab-fav hidden" alt="" /><span class="tab-title">New tab</span><button class="tab-close" tabindex="-1" aria-label="Close tab: New tab">✕</button>\``.
   - Update the click handler to use `.closest('.tab-close')` so a click on the button (or its text) still routes to `closeTab`: `if (/** @type {HTMLElement} */ (e.target).closest('.tab-close')) { closeTab(id); return; }`.

4. **`activateTab` (`renderer.js:203-207`)** — inside the `for (const t of tabs.values())` loop, after the existing class toggles add:
   - `t.btn.setAttribute('aria-selected', String(isActive));`
   - `t.btn.tabIndex = isActive ? 0 : -1;`

5. **`page-title-updated` handler (`renderer.js:239-243`)** — alongside the existing `.tab-title` textContent + `btn.title` updates, add:
   - `const name = e.title || tab.url;`
   - `tab.btn.setAttribute('aria-label', name);`
   - `const close = /** @type {HTMLButtonElement|null} */ (tab.btn.querySelector('.tab-close')); if (close) close.setAttribute('aria-label', \`Close tab: ${name}\`);`

6. **Strip keyboard handler** — add a `focusTab(id)` helper and a `keydown` listener on `els.tabs` (place near the existing tab wiring, e.g. after the `els.newTab`/`els.newTabMenu` listeners ~`:354-358`). Reference insertion order via `[...tabs.keys()]`:
   ```js
   function focusTab(id) {
     const t = tabs.get(id);
     if (t && t.btn) /** @type {HTMLElement} */ (t.btn).focus();
   }
   els.tabs.addEventListener('keydown', (e) => {
     const ids = [...tabs.keys()];
     if (!ids.length) return;
     // Cast the closest() RESULT (Element|null) to HTMLElement so `.dataset` typechecks —
     // `.closest()` returns Element regardless of receiver, and `.dataset` is HTMLElement-only.
     const cur =
       /** @type {HTMLElement|null} */ (document.activeElement?.closest('.tab'))?.dataset.id || activeTabId;
     const idx = Math.max(0, ids.indexOf(cur));
     if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
       e.preventDefault();
       const next = ids[(idx + (e.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length];
       activateTab(next);
       focusTab(next);
     } else if (e.key === 'Home' || e.key === 'End') {
       e.preventDefault();
       const next = e.key === 'Home' ? ids[0] : ids[ids.length - 1];
       activateTab(next);
       focusTab(next);
     } else if (e.key === 'Delete' || e.key === 'Backspace') {
       e.preventDefault();
       closeTab(cur);
       const now = activeTab();
       if (now && now.btn) focusTab(now.id);
     }
   });
   ```
   (`closeTab` already activates a sibling — or creates a new tab if none remain — so `activeTab()` after it is the correct focus target.)

7. **`styles.css`** — add focus-visible styling near `.tab` (`:54-93`):
   ```css
   .tab:focus-visible,
   .tab .tab-close:focus-visible {
     outline: 2px solid var(--accent);
     outline-offset: -2px;
   }
   ```
   And neutralize default `<button>` chrome on the close control by extending `.tab .tab-close` (`:81-89`) with `background: transparent; border: none; padding: 0; font: inherit; color: var(--fg-dim); cursor: pointer;` (preserving its current size/centering). Keep the existing `.tab .tab-close:hover` rule.

## Edge Cases
- **Single tab**: arrows wrap to the same tab (visible no-op); `Delete` on the last tab triggers `closeTab`'s existing `createTab()` path — window never reaches zero tabs; focus the freshly-created tab.
- **Close button is `document.activeElement` when Delete pressed**: `document.activeElement.closest('.tab')` still resolves the owning tab id, so Delete closes the right tab.
- **Arrow key while the close button (tabindex -1) is focused**: the `els.tabs` handler still catches the bubbled event; `cur` resolves via `closest('.tab')`.
- **No global hijack**: because the handler is on `els.tabs`, arrows/Delete typed in `#address` or while a `<webview>` holds focus do not reach it (verified by behavior-test Step 8 in the verify leg).
- **`@ts-check`**: `document.activeElement` is `Element|null`; `closest` returns `Element|null`; `.dataset` requires an `HTMLElement` cast. `querySelector('.tab-close')` returns `Element|null` → cast to `HTMLButtonElement|null`. Use the cast forms shown above; do not add `@ts-expect-error`.

## Cross-Leg Note: axe `nested-interactive` (for leg 2 + verify)
This leg deliberately nests a focusable close `<button tabindex="-1">` inside the `role="tab"` element (a focusable widget). axe-core's `nested-interactive` rule (WCAG 4.1.2, best-practice) flags focusable descendants of widget-role elements — so the **full** axe sweep at `verify-a11y` will likely report it. This is an **accepted, documented exception**: the maintenance finding F22 explicitly mandates a focusable named close `<button>`, the behavior test (Step 6) asserts it, and a close-button-inside-tab is the industry-standard browser pattern (Delete on the focused tab is the primary keyboard path; the button is pointer/AT-element-nav). **Action for leg 2**: when standing up `scripts/a11y-audit.mjs`, exclude `nested-interactive` from the rule set with an inline comment citing this rationale (leg 2's scoped subset — `button-name`/`label`/aria-validity — doesn't include it anyway; this is about the full/verify sweep). Do not restructure the tab to satisfy the rule — it would break `aria-required-children` (tablist→tab) or drop the mandated focusable close button.

## Files Affected
- `src/renderer/index.html` — `#tabs` gains `role="tablist"` + `aria-label`.
- `src/renderer/renderer.js` — `createTab` (webview id, tab ARIA, button close, alt=""), `activateTab` (aria-selected + roving tabindex), `page-title-updated` (name sync), new `els.tabs` keydown handler + `focusTab` helper.
- `src/renderer/styles.css` — `.tab:focus-visible` / `.tab-close:focus-visible`; `.tab-close` button reset.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified
- [x] Tests passing (`npm test` + `npm run typecheck` + `npm run lint`)
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed` (in this file's header) — flight-level commit promotes to `completed`
- [ ] Check off this leg in flight.md
- [ ] (Not the final leg — no flight-level status change)
- [ ] Commit handled at the deferred flight-level review/commit (per `/agentic-workflow`), not per-leg

## Citation Audit
7 citations verified against current code at leg design time — all `OK`, consistent with the flight's post-recon Technical Approach: `renderer.js:137-143` (webview creation), `:160-177` (tab button), `:198-212` (activateTab, loop `:203-207`), `:239-243` (page-title-updated), `:354-357` (newTab/newTabMenu listeners), `index.html:15` (#tabs), `styles.css:54-93` (`.tab`/`.tab-close`, no `:focus-visible` present).
