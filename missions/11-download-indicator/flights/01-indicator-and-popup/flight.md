# Flight: Top-Bar Download Indicator + Downloads Popup

**Status**: in-flight
**Mission**: [Top-Bar Download Visibility](../../mission.md)

## Contributing to Criteria

- [ ] Persistent indicator visible while a download is active or recently completed; hidden when idle.
- [ ] Indicator conveys live state accessibly (label updates, not animation/color alone).
- [ ] Activating the indicator opens a popup listing current and recent downloads.
- [ ] Popup rows: open a completed file, reveal it in folder; in-progress rows show progress, not openable.
- [ ] Popup offers a way to open the full `goldfinch://downloads` page.
- [ ] Open/reveal never trust a renderer-supplied path — resolved main-side by download id.
- [ ] Indicator is app-scoped: present on any tab (incl. internal), independent of toolbar pins.
- [ ] `npm run a11y` passes for the new button + popup; existing behavior tests unaffected.

---

## Pre-Flight

### Objective

Add a persistent, app-scoped download indicator button to the top bar (`#tabstrip`, immediately
left of `#window-controls`) that reflects live download state, and a sheet-hosted popup listing
current and recent downloads with per-row open / reveal-in-folder actions and a link to the full
downloads page. The feature rides the existing `download-progress` / `download-done` broadcasts for
its data and the existing menu-overlay sheet for its popup, and adds a narrow, id-resolved
chrome-trust IPC pair for the file actions.

### Open Questions

- [x] Popup live vs. snapshot-at-open? → **snapshot-at-open, close-then-act** (see DD2).
- [x] Reuse `info-popup` template or add a new one? → **new `downloads` template** (see DD3).
- [x] Does reveal need id-resolution too, or is the existing path-trusting handler acceptable? →
      **reveal also resolves by id** (see DD4); the popup never calls the legacy path-trusting handler.
- [x] Idle-visibility / eviction policy? → **DD5** sets a concrete default, flagged HAT-tunable.

### Design Decisions

**DD1 — Placement: top bar, left of `#window-controls`, `no-drag`, app-scoped.**
The `#downloads-indicator` button is inserted into `#tabstrip` as a sibling immediately before
`#window-controls` (which sits after the `#tabstrip-drag` flex spacer, `styles.css:163`). `#tabstrip`
is a `-webkit-app-region: drag` region, so the button MUST opt out with `-webkit-app-region: no-drag`,
mirroring `.win-ctrl` (`styles.css:87`) and `#new-tab`. **Precedent: `#automation-indicator`**
(`index.html:99`) is the existing app-scoped, `hidden`-until-active, explicitly-non-pinnable badge
button — reuse its hidden/badge/non-pinnable CSS and self-managed `.hidden` pattern
(`styles.css:1205,1280-1320`) so the two app-scoped indicators stay visually consistent.
- Rationale: downloads are app-scoped; the window controls are the app-scoped, always-present chrome.
  Placing the button there resolves the app-scoped/tab-scoped tension by *location* — it never touches
  `toolbarPins` / `applyToolbarPins` / the unpin context menu / the Appearance-pins controller, so the
  tab-scoped toolbar invariant stays intact and no exception is needed.
- Trade-off: the button does not live with the other page-affordance buttons; users look top-right, not
  in the toolbar row. This is the intended app-scoped semantics (mirrors mainstream browsers).
- It is NOT `disabled` on internal tabs — downloads aren't tied to the active tab.

**DD2 — Popup is snapshot-at-open, close-then-act (not live).**
The menu-overlay sheet is presentation-only: it renders once from the channel-3 model, has one-shot
activation (exactly one `activated`/`dismissed` per open token, first send wins), and has *no
main→sheet push channel* by design (`menu-overlay.js` header). A live-updating popup would break that
invariant. So the popup renders the download list captured at open time; in-progress rows show the
progress snapshot from that instant; activating any row closes the sheet, then the chrome performs the
action.
- Rationale: preserves the sheet's presentation-only invariant and the "no new tracking IPC" constraint.
- Trade-off: a download's progress does not animate *inside* an open popup. Persistent live feedback
  lives in the **button** (which the chrome updates directly, DD5), which is the glanceable surface that
  matters; the popup is a transient action surface, re-opened for a fresh snapshot.

**DD3 — New `downloads` menu-overlay template (not an overload of `info-popup`).**
`info-popup` (used by `site-info`) collects all `action` items into a single footer `.si-actions` bar
(`menu-overlay.js` `renderPopup`) — it cannot host **per-row** action pairs. Each download row needs two
actions (open the file, reveal in folder) bound to *that* row. So a new `downloads` template is added:
its own `menuController` entry + node, a `TEMPLATES['downloads'] = 'downloads'` registry entry,
`NODE_OF_ENTRY` registration, a branch in the `onInit` dispatch, and a `renderDownloads()` that emits a
row list (per-row filename button + folder-icon button) plus a footer "Open downloads page" action.
`menu-overlay.html` needs **no** change — every template builds its node in JS and appends to
`#menu-root` (design-review confirmed).
- Rationale: the row-with-two-actions shape is genuinely new; forcing it into `info-popup` would distort
  that template's single-action-footer contract and its focus model.
- The new template mirrors `info-popup`'s **chrome-popup focus/dismissal regime**: the node carries
  **`role="dialog"`** with an `aria-label` (matching `info-popup`, `menu-overlay.js:247`); local keydown
  owns Escape/Tab; it's registered through the shared `menuController` so global outside-click/blur
  dismissal applies uniformly — with roving/tab among the row buttons rather than a single focused action.
  The **trigger button therefore carries `aria-haspopup="dialog"`** (not `"menu"`) so the button
  attribute, the template role, and the behavior-test assertion agree. (This corrects issue #103's casual
  `aria-haspopup="menu"`: a container of rows-with-two-buttons is a dialog, not an ARIA menu.)
- **Row activations dispatch by download *id*, not positional index**: `dl:open:<id>` / `dl:folder:<id>`
  / `dl:page`. The chrome-side accumulator (DD5) mutates continuously (progress ticks, eviction), so a
  positional index captured at open could point at a different row by click time. The download id is the
  authoritative main-side key and is mutation-immune (ids are persisted-monotonic, no reuse —
  `downloads-store.js`), making the "vanished → validated no-op" contract trivial. (This refines the
  `sug:<i>`/`spell:<i>` index precedent, which is safe only because those lists are frozen snapshots.)
- **Full chrome-side wiring surface** (design-review completeness — all in Leg 3): (a) a
  `overlayMenus['downloads']` **state entry** (`renderer.js` state map) — `overlayMenuClient.open`
  early-returns `false` without it — with `ariaTarget: fixedTriggerMenu(() => els.downloadsIndicator)` so
  `aria-expanded` flips on open/close (`overlay-menus.js:51,79`); (b) button `click`/keydown →
  `overlayTriggerClick('downloads', …)` (kebab pattern, `renderer.js:433`); (c) an `openDownloadsOverlay()`
  opener building the model + a right-aligned anchor via `rightSheetAnchor(webviewsRect, buttonRect)`
  (kebab precedent); (d) a `case 'downloads':` in `dispatchOverlayActivation` (`renderer.js`); (e) a
  `downloadsIndicator: 'downloads-indicator'` entry in the `IDS` map (`chrome/context.js`); (f) an entry
  in the CLOSED-SET `globalThis` audit seam (`renderer.js:1176-1199`) — `openDownloadsOverlayForAudit`,
  mirroring `openTabContextMenuForAudit`. **FD ruling (recorded here so Leg 3 doesn't stall): the audit
  seam addition is approved, scoped solely to the `npm run a11y` sweep, matching the tab-context
  precedent.** Leg 3 restates this ruling in the flight log.
- Trade-off: one more template + its chrome-state wiring. Bounded — every piece has a one-file precedent.

**DD4 — File actions resolve `savePath` main-side by id; new chrome-trust IPC pair.**
Add two plain `ipcMain.handle`s — `open-downloaded-file` and `reveal-downloaded-file` — each taking a
numeric download **id**, resolving `savePath` via the manager (`manager.listAll().find(e => e.id === id)`,
the exact resolver the internal `internal-downloads-action` open/show bodies use,
`register-download-ipc.js:131,159-165`), then calling `shell.openPath` / `shell.showItemInFolder`.
Extract the id→record resolution into a shared helper so trust-domain logic is not forked. Preload
exposes `openDownloadedFile(id)` / `revealDownloadedFile(id)` on `window.goldfinch`.
- **`open-downloaded-file` gates on `state === 'completed'`, not merely `savePath` non-null.** An
  in-flight record already carries a `savePath` (set pre-register, `register-download-ipc.js:91-93`), so
  opening by id must first confirm the record is terminally completed — otherwise an open-by-id on an
  in-progress id would launch a partially-written file. This enforces "never openable until complete" at
  the trust boundary itself, not only in the UI that disables the row.
- Rationale: honors the non-negotiable trust boundary — the renderer never supplies a path. Reveal is
  included because today's chrome-trust `show-item-in-folder` (`register-download-ipc.js:80`) trusts a
  renderer path; the popup must not use it.
- Trade-off: the legacy path-trusting `show-item-in-folder` remains for the existing toast caller
  (`media-controller.js`) — out of scope to remove here. Logged as a known consideration, not widened.
- These are `ipcMain.handle` (chrome-trust), NOT `registerInternalHandler` (internal-origin-locked) —
  the popup lives in the chrome, not the internal session.

**DD5 — Chrome-side accumulator is new state; concrete idle policy (HAT-tunable).**
The chrome keeps no recent-completed list today (toast nodes are transient). A new chrome controller
maintains: an **in-flight** map keyed by download id (`{filename, received, total, paused, state}`, fed
by `download-progress`) and a **recent-completed** list (fed by `download-done`, capped at the last 25,
oldest evicted). Button visibility predicate: visible iff `inFlight.size > 0 || (recent.length > 0 &&
!acknowledged)`.
Default idle policy: acknowledgment fires on popup close (once the user has opened and dismissed the
popup they have seen the recent list), then the button hides as soon as `inFlight` reaches 0.
_(Refined during Leg 3 design from the original acknowledge-on-open — see flight-log Decisions "DD5
refinement"; acknowledge-on-open would hide the trigger under its own open popup.)_ A new completion after acknowledgment resets `acknowledged = false` (there is
something new to surface). As a fallback for users who never open the popup, a 5-minute idle timeout
after the last completion also hides the button and clears recent.
- Rationale: acknowledge-on-open sidesteps the close-reason ambiguity flagged in design review — channel-7
  close fires for many reasons (`superseded`, `blur`, `tab-switch`, `activated`, `escape`), and keying
  acknowledgment off those would hide the button on an incidental tab-switch or clear it when the user
  merely clicked a row. Open is an unambiguous "I've seen it" signal.
- Trade-off / knob: the 25-cap, the 5-minute fallback, and acknowledge-on-open are the most subjective
  choices — explicitly earmarked for tuning in the HAT leg.
- The reducer over these events is extracted pure (mirroring the `downloads-payload.js` extraction
  pattern) so visibility, eviction, `acknowledged` transitions, and the aria-label string are
  unit-testable without the DOM.
- **Leg 2 also exposes a test seam that force-shows the button** (injects a synthetic recent entry /
  forces the visibility predicate), mirroring the `devtools-button` a11y precedent — Leg 3's a11y sweep
  consumes it to audit the button's static labeling while idle-hidden (see Verification).

**DD6 — Verification apparatus (behavior test): goldfinch MCP admin key.**
The observable UI lives in the **chrome** (the button) and the **menu-overlay sheet** (the popup) — NOT
the internal `goldfinch://downloads` page (which automation cannot read; see `downloads-surface.md`).
Both surfaces are reachable by the **admin** key: **act** — `navigate` a web tab to the existing
download fixture to fire a real `will-download`, and drive the chrome button via `getChromeTarget`
(admin-only); **observe** — read the chrome DOM/AX for the button's visibility + `aria-label`, and the
sheet document (wcId via `enumerateWindows`) for the popup rows. Both axes are proven feasible by the
existing a11y audit (`scripts/a11y-audit.mjs`), which drives and reads those exact chrome + sheet targets,
and by `downloads-surface.md`, which triggers the fixture download. The external side effects of
`shell.openPath` / `showItemInFolder` (launching an app / file manager) are **not** cleanly observable —
those are asserted by the HAT leg, not the behavior test.

### Prerequisites

- [x] `download-progress` / `download-done` broadcasts flowing to the chrome
      (`register-download-ipc.js:109,117`; `chrome-preload.js:146-147`) — verified in viability review.
- [x] Menu-overlay sheet + `chromePointToSheet` anchoring available
      (`menu-overlay.js`; `src/renderer/chrome/overlay-menus.js:14`) — verified.
- [x] Downloads manager resolves `savePath` by id in main (`downloads-manager.js` `listAll()`;
      `register-download-ipc.js:131`) — verified.
- [x] `npm run a11y` runnable, sweeps chrome + sheet states (`scripts/a11y-audit.mjs`; `package.json:18`).
- [x] Download-trigger fixture present (`tests/behavior/fixtures/downloads/download-fixture.bin`) for the
      behavior test; silent default-save in effect.

### Pre-Flight Checklist
- [x] All open questions resolved
- [x] Design decisions documented
- [x] Prerequisites verified
- [x] Validation approach defined (a11y gate + HAT + draft behavior test `download-indicator`)
- [x] Legs defined

---

## In-Flight

### Technical Approach

Three feature-slice legs, then a guided HAT leg:

1. **Trust-boundary IPC first** (Leg 1) — the id-resolved open/reveal handlers + preload bridges, with a
   shared resolver and unit tests. No UI dependency; the popup will consume these.
2. **Button + chrome-side state** (Leg 2) — the `#downloads-indicator` element, the pure accumulator
   reducer (unit-tested), and the controller that wires broadcasts → button visibility/state/aria-label.
3. **Popup** (Leg 3) — the new `downloads` sheet template + `renderDownloads()`, the full chrome-side
   wiring (DD3: state entry, trigger, opener + anchor, dispatch, IDS + audit seam), channel-4 id-dispatch
   to the Leg-1 bridges and `openDownloads()`, plus **all** `a11y-audit.mjs` sweep changes — the
   `sheet:downloads` popup state, a chrome state that force-shows the button (via the Leg-2 seam), and
   extending the sweep's hardcoded dismiss/closed node-id arrays for the new template node.

Legs 1 and 2 are independent; Leg 3 depends on both. Filenames are untrusted strings — rendered via
`textContent` only, never markup. Row activations use namespaced, **id-dispatched** ids
(`dl:open:<id>` / `dl:folder:<id>` / `dl:page`), validated at dispatch (vanished / not-completed → no-op).

### Checkpoints
- [ ] Leg 1: open/reveal by id work from a scratch caller; unit tests green; renderer path never trusted.
- [ ] Leg 2: button appears/animates on a live download and reflects a recently-completed state; hidden
      when idle; accumulator reducer unit tests green.
- [ ] Leg 3: clicking the button opens the popup listing current + recent; rows open/reveal; in-progress
      rows disabled; footer opens `goldfinch://downloads`; `npm run a11y` passes.

### Adaptation Criteria

**Divert if**:
- The menu-overlay sheet cannot host per-row action pairs even with a new template (would force a
  main→sheet push channel or a non-sheet popup) — re-plan the popup surface.
- Chrome-side id→record resolution proves unavailable to a chrome-trust handler (it should not — the
  manager runs in main).

**Acceptable variations**:
- Exact idle-visibility policy, cap, and timeout (DD5) tuned during HAT.
- Icon/animation treatment of the button's active/recent states (visual detail).
- Whether the `sheet:downloads` a11y state needs a curated allowlist entry (depends on whether the
  popup raises the same transient-region advisory as the other sheet menus).

### Legs

- [x] `chrome-trust-file-actions` — id-resolved `open-downloaded-file` / `reveal-downloaded-file`
      handlers + preload bridges, shared resolver, unit tests.
- [x] `indicator-button-and-state` — `#downloads-indicator` top-bar button (mirror `#automation-indicator`)
      + pure accumulator reducer (visibility / eviction / `acknowledged` / aria-label) + controller wiring
      broadcasts → button state, plus the force-show test seam for the a11y sweep.
- [x] `downloads-popup` — new `downloads` sheet template (`role="dialog"`) + full chrome-side wiring
      (state entry, trigger, opener+anchor, id-dispatch, IDS map, audit seam) + all `a11y-audit.mjs` sweep
      changes (`sheet:downloads` state, button-visible chrome state, dismiss/closed node-id arrays).
- [ ] `hat-and-alignment` *(optional)* — guided HAT session: exercise the flow in the real app, tune the
      idle/visual policy, fix issues until the operator is satisfied.

---

## Post-Flight

### Completion Checklist
- [ ] All legs completed
- [ ] Code merged
- [ ] Tests passing (`npm test` unit + `npm run a11y`)
- [ ] Documentation updated (CLAUDE.md if the button/popup warrant a chrome-affordance note)

### Verification

- **Unit**: accumulator reducer (visibility, eviction, aria-label) and the id→record resolver.
- **Accessibility**: `npm run a11y` — button labeled/operable in the chrome sweep; new `sheet:downloads`
  state labeled/operable.
- **Behavior (real-environment)**: draft spec [`download-indicator`](../../../../tests/behavior/download-indicator.md)
  — indicator appears on a live download, popup lists current + recent with correct filenames and
  disabled in-progress rows, footer navigates to `goldfinch://downloads`; apparatus = goldfinch MCP admin
  key (DD6). Activated/run during the HAT leg.
- **HAT**: hands-on confirmation of open/reveal external effects (app / file-manager launch) and the
  subjective idle/visual policy.
