# Leg: site-info-popup

**Status**: landed
**Flight**: [Settings Page Shell + Address-Bar Chips](../flight.md)

## Objective
Wire the address-bar chip's click: the **web** chip opens a `menuController`-registered **site-info popup**
(origin + connection + a `tab.privacy` summary + a "Site settings →" link into Shields); the **internal**
chip shows a static "secure Goldfinch page" note. No real settings controls (Flight 6).

## Context
- **DD5 — site-info popup from the web chip.** Clicking the **web** chip opens a small popup populated from
  the **existing per-tab data**: origin + connection (`http`/`https`) + a compact summary from `tab.privacy`
  (**trackers blocked** via `tab.privacy.net.trackers.blocked`, **permissions count** via
  `tab.privacy.permissions.length`) + a **"Site settings →"** action that opens the existing Shields/privacy
  panel (`togglePrivacy(true)`). The **internal** chip's click shows a static "You're viewing a secure
  Goldfinch page" note (no site data, no "Site settings" link).
- **`tab.privacy.net` is `null` until the debounced `privacy-net` IPC arrives** (`blankPrivacy()` returns
  `{ net: null, fp: {…}, permissions: [], cookies: null }`). The popup MUST render gracefully from
  `net === null` — show `0` / "—" for the tracker count, **not crash**. A freshly-opened site (e.g.
  example.com) legitimately summarizes to `0 trackers`; the behavior test accepts `0`/empty as a valid pass.
- **DD7 — the popup is NOT a `role=menu`.** It's origin/connection text + a "Site settings →" link, so it
  does **not** consume the Arrow/Home/End roving contract and must **not** be contorted into a `role=menu`.
  It registers with the shared `menuController` for the **open/close/mutual-exclusion/outside-dismiss** half
  (which `register` already provides — leg 1) plus its **own minimal local keydown** (Escape + Tab close +
  focus-return). Because leg-1's controller menu-keydown guards `if (!entry.items) return`, registering the
  popup **without** an `items` getter means the controller's roving keydown correctly no-ops for it — the
  popup supplies its own keydown.
- **Controller wiring recap (leg 1).** `menuController.register({ trigger, menu, onOpen, onClose })` now
  attaches a trigger-keydown (Enter/Space/ArrowDown → open; with `preventDefault` suppressing the synthetic
  click) and a menu-keydown (no-op without `items`). So registering the chip as `trigger` gives keyboard-
  open for free; the chip's mouse `click` handler toggles like the kebab does
  (`if (menuController.current === popupEntry) close else open`).
- **Chip is unwired today (leg 4).** Leg 4 built the chip element + state + the lock; its click is wired
  here. One popup element serves both states — `onOpen` builds content from the **active tab** (internal
  note vs web summary).
- **Scope/security boundary.** UX only. Does NOT touch the internal preload bridge or `isSafeTabUrl`
  (Flight 6). Does NOT reimplement Shields — the popup is a thin summary + a link into the existing panel.

## Inputs
- `src/renderer/index.html` — `#address-wrap` with `#address-chip` (leg 4) and `#address`.
- `src/renderer/renderer.js` — `menuController` (with leg-1 `register` attaching keydown), `isInternalTab`,
  `isInternalPageUrl`, `activeTab()`, `tab.privacy` (`{ net, fp, permissions, cookies }`, `net` nullable),
  `togglePrivacy(force)` (opens Shields when `true`), `positionKebabMenu` (pattern for anchoring a popup
  under a trigger), `escapeHtml`.
- Leg-4 chip states (`data-state="internal"|"web"|<none>`).

## Outputs
- A `#site-info-popup` element in the chrome, registered with `menuController`.
- The chip's click handler (toggle), the popup's `onOpen`/`onClose` + content builder, its position helper,
  and its own Escape/Tab keydown.

## Acceptance Criteria
- [ ] A `#site-info-popup` element exists in the chrome (hidden by default), `role="dialog"` +
  `aria-label="Site information"` (**not** `role="menu"`, **no** `aria-modal` — non-modal), and
  `tabindex="-1"` so it can receive focus in **both** states (the internal state has no focusable child).
- [ ] `#address-chip` carries `aria-haspopup="dialog"` (ARIA 1.2 — matches how the kebab/container triggers
  declare `aria-haspopup="menu"`).
- [ ] Clicking the chip **toggles** the popup via `menuController` (open if closed, close if open),
  **left-anchored under the chip** (`left = chipRect.left`, `top = chipRect.bottom + 4` — NOT right-anchored
  like the kebab). Keyboard-open works too (Enter/Space on the focused chip — via leg-1's controller trigger
  keydown).
- [ ] **Web state**: the popup shows the **origin/host**, the **connection** (`HTTPS`/`HTTP`), a
  **trackers-blocked** count from `tab.privacy.net.trackers.blocked` (**`0` when `net` is `null`** — no
  crash), a **permissions** count from `tab.privacy.permissions.length`, and a **"Site settings →"** action
  that closes the popup and calls `togglePrivacy(true)` (opens the existing Shields panel).
- [ ] **Internal state**: the popup shows a **static note** ("You're viewing a secure Goldfinch page" or
  similar) with **no site data and no "Site settings" link**.
- [ ] Content is built in `onOpen` from the **active tab** (`activeTab()` / its `data-state`), so the popup
  always reflects the current tab; `escapeHtml` is used for any interpolated host text.
- [ ] **Registered with `menuController` WITHOUT an `items` getter** — it gets open/close/mutual-exclusion/
  outside-dismiss + the no-op roving keydown; it adds its **own** keydown: **Escape** and **Tab** close the
  popup and **return focus to the chip**.
- [ ] **Mutual exclusion**: opening the popup closes any open kebab/container menu and vice-versa (free via
  the shared controller); outside-click and window-blur dismiss it (free via the controller's pointerdown/
  blur listeners).
- [ ] **a11y**: the popup and the "Site settings →" control are labelled/operable; no new WCAG A/AA
  violations (intent — live `npm run a11y` in leg 7).
- [ ] `npm run lint`, `npm run typecheck`, `npm test` green.

## Verification Steps
- `npm run lint && npm run typecheck && npm test` — green.
- Read `renderer.js`: popup registered via `menuController.register` (no `items`); chip click toggles;
  `onOpen` branches on internal vs web; web path reads `tab.privacy.net?.trackers?.blocked ?? 0` and
  `tab.privacy.permissions.length`; "Site settings →" calls `togglePrivacy(true)`; popup keydown handles
  Escape/Tab + chip focus-return.
- Read `index.html`: `#site-info-popup` present, `role="dialog"` + `aria-label`, hidden by default.
- **Deferred to leg 7 (live)**: web tab → click chip → popup shows origin/connection/summary; fresh site
  shows `0 trackers` gracefully; "Site settings →" opens Shields + closes popup; internal tab → chip → static
  note (no site data); Escape/outside-click/blur dismiss; mutual-exclusion with kebab/container; a11y clean.

## Implementation Guidance

1. **Add `#site-info-popup`** to `index.html` (near the other chrome popups / in the toolbar area):
   `<div id="site-info-popup" class="site-info-popup hidden" role="dialog" aria-label="Site information" tabindex="-1"></div>`
   (content injected in `onOpen`; `tabindex="-1"` lets the container take focus in the internal state).
   Also add `aria-haspopup="dialog"` to `#address-chip` in `index.html`. Style in `styles.css` (small card,
   neutral palette, anchored under the chip; reuse the kebab/container menu visual language).

2. **Register the popup** with `menuController` (no `items` getter):
   ```
   const siteInfoEntry = menuController.register({
     trigger: els.addressChip,
     menu: els.siteInfoPopup,
     onOpen() { buildSiteInfo(activeTab()); els.siteInfoPopup.classList.remove('hidden');
                positionSiteInfoPopup();
                // focus the "Site settings →" button if present (web), else the container (internal)
                const btn = els.siteInfoPopup.querySelector('button, a');
                (btn || els.siteInfoPopup).focus(); },
     onClose() { els.siteInfoPopup.classList.add('hidden'); }
   });
   function closeSiteInfo() { menuController.close(siteInfoEntry); }   // distinct thin wrapper
   ```
   `positionSiteInfoPopup()` anchors **left-aligned** under the chip:
   `const r = els.addressChip.getBoundingClientRect(); popup.style.top = r.bottom + 4 + 'px';
   popup.style.left = r.left + 'px'; popup.style.right = 'auto';` (do NOT copy the kebab's right-anchoring —
   the chip is on the left of the address row).

3. **`buildSiteInfo(tab)`** — branch on `isInternalTab(tab)` / `isInternalPageUrl(tab.url)`:
   - **internal** → inject the static secure-page note (no data, no link).
   - **web** → host = `new URL(tab.url).host` (try/catch); connection from the URL protocol; trackers =
     `tab.privacy?.net?.trackers?.blocked ?? 0`; permissions = `tab.privacy?.permissions?.length ?? 0`;
     render these + a **"Site settings →"** `<button class="text-btn">` (a `<button>`, **not** an `<a>` —
     it runs JS, so an `<a href="#">` would be a dead/axe-flagged link) whose handler is `closeSiteInfo();
     togglePrivacy(true);`. Use `escapeHtml` on the host.

4. **Chip click** — wire `els.addressChip.addEventListener('click', …)` to toggle:
   `if (menuController.current === siteInfoEntry) menuController.close(siteInfoEntry); else
   menuController.open(siteInfoEntry);` (mirrors the kebab click). This is the click handler leg 4
   intentionally left off.

5. **Popup keydown** — `els.siteInfoPopup.addEventListener('keydown', …)`: on **Escape** or **Tab** →
   `e.preventDefault(); closeSiteInfo(); els.addressChip.focus();` (Tab closes + returns focus, per DD5).
   Do NOT add Arrow/Home/End roving (not a menu). **IMPLEMENTATION TRAP**: leg-1's controller menu-keydown
   early-returns on `!entry.items`, so it will NOT handle Escape/Tab for this popup even though those
   branches exist in the controller — the popup's **own** keydown listener is the ONLY thing that closes it
   on Escape/Tab. Both must `preventDefault`. (Since the button is focused on open, one Tab press closes +
   returns to the chip — conventional.)

6. **Register the chip in `els`** is already done (leg 4: `els.addressChip`); add
   `siteInfoPopup: document.getElementById('site-info-popup')` to `els`.

## Edge Cases
- **`tab.privacy.net === null`** (pre-IPC, or fresh site): tracker count renders `0`, never throws — use
  optional chaining + `?? 0`.
- **`about:blank` / unparseable URL on the web chip**: `new URL('')` throws — guard; show a minimal popup
  (origin "—", connection unknown) rather than crashing. (Realistically the chip is in neutral state then.)
- **Internal chip has no "Site settings"** — don't render the link or the privacy summary for internal.
- **Double-open**: leg-1's controller trigger-keydown `preventDefault`s the synthetic click, and the click
  handler toggles — same pattern as the kebab; confirm Enter doesn't open-then-immediately-close.
- **Focus return**: after "Site settings →" opens Shields, `togglePrivacy(true)` manages its own focus; the
  popup just closes first. After Escape/Tab, focus returns to the chip.
- **No `role=menu`** — keep it `role="dialog"`; do not add `role="menuitem"` to the link.

## Files Affected
- `src/renderer/index.html` — add `#site-info-popup`.
- `src/renderer/styles.css` — popup styling.
- `src/renderer/renderer.js` — register popup entry, `buildSiteInfo`, `positionSiteInfoPopup`,
  `closeSiteInfo`, chip click handler, popup keydown; add `els.siteInfoPopup`.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:** *(commit deferred to the flight-level review)*

- [ ] All acceptance criteria verified (offline; live behavior deferred to leg 7)
- [ ] Tests passing (offline gates)
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `landed` (commit deferred)
- [ ] Check off this leg in flight.md
- [ ] Do NOT commit; do NOT signal `[HANDOFF:review-needed]`
