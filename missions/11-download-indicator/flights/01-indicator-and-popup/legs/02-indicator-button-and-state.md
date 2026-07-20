# Leg: indicator-button-and-state

**Status**: completed
**Flight**: [Top-Bar Download Indicator + Downloads Popup](../flight.md)

## Objective

Add the `#downloads-indicator` top-bar button (mirroring `#automation-indicator`) plus a pure
accumulator reducer and a chrome controller that subscribes to the existing `download-progress` /
`download-done` broadcasts and drives the button's visibility, active/recent state, badge count, and
accessible label.

## Context

- Flight DD1: app-scoped button in `#tabstrip`, immediately left of `#window-controls`, `no-drag`, NOT
  pinnable, NOT disabled on internal tabs. The existing **`#automation-indicator`** (`index.html:99`) is
  the precedent to mirror: a `<button class="icon-btn hidden">` with a `.tb-glyph` SVG + a `.tb-badge`
  span, self-managing `.hidden`/state classes via a pure model — never touched by `applyToolbarPins`.
- Flight DD5: the chrome keeps no recent-completed list today. This leg introduces that state: an
  **in-flight** map keyed by download id (fed by `download-progress`) + a **recent-completed** list (fed
  by `download-done`, cap 25, evict oldest). Visibility: `inFlight.size > 0 || (recent.length > 0 &&
  !acknowledged)`. Acknowledgment is on popup **open** (Leg 3 calls `acknowledge()`); a new completion
  after ack resets `acknowledged = false`. A 5-minute idle timeout after the last completion is a
  fallback that also hides + clears.
- The download events are **additive** `ipcRenderer.on` subscriptions (`chrome-preload.js:146-147 —
  "onDownloadProgress: (cb) => ipcRenderer.on('download-progress', (_e, data) => cb(data))"`), so this
  controller subscribes **independently** alongside the existing toast subscriber in
  `media-controller.js:591,607` — both fire; no conflict, no change to the toast.
- Pattern to mirror: the pure `buildAutomationIndicatorModel` → `renderAutomationIndicator()` split
  (`privacy-controller.js:213`). The reducer is pure (no DOM, no timers — expiry via an injected `now`),
  unit-tested; the controller applies its model to the DOM.
- **Leg-content note (FD refinement of the flight's split):** the `context.js` `IDS` entry for the button
  moves into THIS leg (the button's id registration travels with the button's markup); Leg 3 consumes
  `els.downloadsIndicator`. The remaining Leg-3 wiring in DD3 (overlay state entry, trigger, opener,
  dispatch, audit seam) stays in Leg 3.

## Inputs

- Leg 1 landed: `window.goldfinch.openDownloadedFile(id)` / `revealDownloadedFile(id)` exist (consumed in
  Leg 3, not here).
- `src/renderer/index.html` — `#tabstrip` contains `#tabstrip-drag` (`:29`) then `#window-controls`
  (`:30`); insert the new button between them.
- `src/renderer/chrome/context.js` — `IDS` map (`:4`) + `createChromeContext` builds `els` from it.
- `src/renderer/chrome/privacy-controller.js:213 — "function renderAutomationIndicator()"` — the
  model→DOM apply precedent (hidden toggle, class reset, badge text/hidden, aria-label).
- `src/renderer/renderer.js:289-324` — where controllers are constructed
  (`createMediaController` / `createPrivacyController` / …).
- `src/renderer/styles.css:1280-1320` — the `#automation-indicator` visual/badge CSS block to mirror.

## Outputs

- `index.html`: `#downloads-indicator` button (+ badge span) in `#tabstrip` before `#window-controls`.
- `context.js`: `downloadsIndicator` / `downloadsIndicatorBadge` added to `IDS`.
- `styles.css`: `#downloads-indicator` styles (glyph, badge, active/recent state, `no-drag`).
- `src/renderer/chrome/downloads-indicator-model.js` (new): pure reducer + view-model deriver.
- `src/renderer/chrome/downloads-controller.js` (new): `createDownloadsController({ els, goldfinch })`.
- `renderer.js`: controller instantiated, stored as `downloadsController` for Leg 3.
- `test/unit/downloads-indicator-model.test.js` (new): reducer unit tests.

## Acceptance Criteria

- [x] `#downloads-indicator` is a `<button class="icon-btn hidden" type="button">` in `#tabstrip`,
      inserted immediately before `#window-controls`, carrying `aria-haspopup="dialog"`,
      `aria-expanded="false"`, an accessible `aria-label` (e.g. "Downloads"), a `.tb-glyph` download icon,
      and a `#downloads-indicator-badge` span. It is styled `-webkit-app-region: no-drag`.
- [x] The button is NOT referenced by `toolbarPins` / `applyToolbarPins` / the unpin context menu / the
      Appearance-pins settings controller (verify by grep — it must remain app-scoped like
      `#automation-indicator`).
- [x] `context.js` `IDS` includes `downloadsIndicator: 'downloads-indicator'` and
      `downloadsIndicatorBadge: 'downloads-indicator-badge'`.
- [x] A pure module `downloads-indicator-model.js` exports a reducer over `{ type: 'progress'|'done'|
      'acknowledge'|'expire', ... }` events and a `deriveModel(state)` returning at least
      `{ visible, active, activeCount, recentCount, ariaLabel }`, implementing DD5 exactly:
      progress upserts inFlight; done removes from inFlight and prepends to recent (cap 25, evict oldest);
      `visible = inFlight.size > 0 || (recent.length > 0 && !acknowledged)`; `acknowledge` sets
      `acknowledged = true`; a `done` after acknowledgment resets `acknowledged = false`; `expire` (given a
      `now` past the 5-min window with no in-flight) clears recent and hides.
- [x] `createDownloadsController({ els, goldfinch })` subscribes to `goldfinch.onDownloadProgress` /
      `onDownloadDone`, feeds the reducer, and re-renders the button from `deriveModel` (toggle `.hidden`,
      set an active/animated class while `active`, set/clear the badge count, update `aria-label` to convey
      downloading / count / recently-completed state — **state via label, not color/animation alone**).
- [x] The controller schedules the 5-minute idle-timeout expire (resettable on new activity) and exposes
      `acknowledge()`, `getSnapshot()` (the current in-flight + recent list for Leg 3's model), `isVisible()`,
      and a `forceShowForAudit()` seam that injects a synthetic recent entry / forces the visible state
      (consumed by Leg 3's a11y sweep, mirroring the `devtools-button` a11y precedent).
- [x] The controller is instantiated in `renderer.js` next to the other controllers and retained as
      `downloadsController`.
- [x] The existing download toast still functions (both subscribers coexist) — no change to
      `media-controller.js`.
- [x] `npm test` passes, including a new `downloads-indicator-model.test.js` covering the DD5 transitions.

## Verification Steps

- `npm test` — all green, including `downloads-indicator-model.test.js`.
- `grep -n "downloads-indicator" src/renderer/index.html` — button present in `#tabstrip` before
  `#window-controls`.
- `grep -rn "downloads-indicator\|downloadsIndicator" src/renderer/**/toolbar*` and the pins code — the
  button is NOT wired into `toolbarPins` / `applyToolbarPins`.
- `grep -n "createDownloadsController" src/renderer/renderer.js` — instantiated.
- Manual (deferred to HAT): start a download → button appears + animates; on completion → recent state;
  idle → hides.

## Implementation Guidance

1. **Markup** (`index.html`): insert between `#tabstrip-drag` (`:29`) and `#window-controls` (`:30`),
   mirroring `#automation-indicator` (`:99`) but with a download glyph:
   ```html
   <button id="downloads-indicator" class="icon-btn hidden" type="button"
           title="Downloads" aria-label="Downloads" aria-haspopup="dialog" aria-expanded="false">
     <svg class="tb-glyph" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
       <path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>
     </svg>
     <span id="downloads-indicator-badge" class="tb-badge hidden" aria-hidden="true"></span>
   </button>
   ```
   Add an HTML comment like the automation one noting it is app-scoped and NOT pinnable.

2. **`no-drag` CSS** (`styles.css`): `#tabstrip` is a drag region; add a rule giving `#downloads-indicator`
   `-webkit-app-region: no-drag` (mirror how `#new-tab` / `.win-ctrl` opt out). Add a visual block mirroring
   the `#automation-indicator` block (`:1280-1320`): glyph sizing, `.tb-badge` position, and an active/recent
   state class (e.g. `.downloads-active` with a subtle animation and `.downloads-recent` accent). Keep the
   idle-hidden via the shared `.hidden` class.

3. **IDS** (`context.js`): add `downloadsIndicator: 'downloads-indicator', downloadsIndicatorBadge:
   'downloads-indicator-badge'` to the `IDS` object.

4. **Pure reducer** (`downloads-indicator-model.js`): keep it DOM-free and timer-free. Suggested shape:
   ```js
   export function initialState() {
     return { inFlight: new Map(), recent: [], acknowledged: false, lastCompletionAt: null };
   }
   export function reduce(state, event) { /* returns a new state per DD5 */ }
   export function deriveModel(state) {
     const active = state.inFlight.size > 0;
     const visible = active || (state.recent.length > 0 && !state.acknowledged);
     const activeCount = state.inFlight.size;
     const recentCount = state.recent.length;
     return { visible, active, activeCount, recentCount, ariaLabel: /* see below */ };
   }
   ```
   - `progress`: upsert `inFlight[d.id] = { filename, received, total, paused, state }`.
   - `done`: delete `inFlight[d.id]`; prepend `{ id, filename, state, savePath }` to `recent`; truncate to
     25; `lastCompletionAt = event.now`; `acknowledged = false`.
   - `acknowledge`: `acknowledged = true`.
   - `expire` (`{ now }`): if `inFlight.size === 0` and `now - lastCompletionAt >= 5*60*1000`, clear
     `recent` and reset `acknowledged`.
   - `ariaLabel`: active → e.g. `"Downloading — N in progress"` (or a paused variant); else recent → e.g.
     `"Downloads — N recently completed"`; else `"Downloads"`. Convey state in words.

5. **Controller** (`downloads-controller.js`): `createDownloadsController({ els, goldfinch })` holds a
   mutable `state` (from `initialState()`), subscribes:
   ```js
   goldfinch.onDownloadProgress((d) => { state = reduce(state, { type: 'progress', d }); render(); scheduleExpiry(); });
   goldfinch.onDownloadDone((d) => { state = reduce(state, { type: 'done', d, now: Date.now() }); render(); scheduleExpiry(); });
   ```
   - `render()` applies `deriveModel(state)` to `els.downloadsIndicator` (toggle `.hidden`, set active class,
     badge count via `els.downloadsIndicatorBadge`, `aria-label`) — model→DOM like `renderAutomationIndicator`.
   - `scheduleExpiry()` (re)arms a single `setTimeout` for 5 min that dispatches `{ type: 'expire', now }`.
   - `acknowledge()` → `state = reduce(state, { type: 'acknowledge' }); render();`
   - `getSnapshot()` → returns the ordered list Leg 3 renders (in-flight first, then recent), each item
     `{ id, filename, state, received?, total?, paused? }`.
   - `isVisible()` → `deriveModel(state).visible`.
   - `forceShowForAudit()` → injects a synthetic completed entry into `recent` and renders (test seam).

6. **Wire in `renderer.js`** near the other controllers (`:289-324`):
   `downloadsController = createDownloadsController({ els, goldfinch: window.goldfinch });`
   (declare `let downloadsController;` alongside the others; retained for Leg 3).

7. **Tests** (`downloads-indicator-model.test.js`): cover — progress makes visible+active with badge 1;
   two progress events for the same id keep one inFlight entry; done moves to recent, inFlight shrinks,
   still visible (unacked recent); acknowledge hides once inFlight empty; a done after acknowledge resets
   visibility (new item to show); 26 dones evict to 25 newest; expire past 5 min with no inFlight clears;
   expire before 5 min or with inFlight does nothing; ariaLabel strings for active / recent / idle.

## Edge Cases

- **`done` for an id never seen in progress** (fast/silent download) → still prepends to `recent`; inFlight
  delete is a no-op. Button shows recent state.
- **Non-completed `done`** (`state !== 'completed'`, `savePath` null) → still a recent entry (shows a
  failed/cancelled state); Leg 3 will render it non-openable. Do NOT crash on null savePath.
- **Badge count semantics**: show in-flight count while active; when idle-but-recent, either hide the badge
  or show recent count — pick one and reflect it in `aria-label` (recommend: badge = active count, hidden
  when 0; recent state conveyed by class + label).
- **Focus while hidden**: never programmatically `.focus()` the button while `.hidden` (Leg 3's refocus
  path must guard on `isVisible()`); this leg simply must not auto-focus it.

## Files Affected

- `src/renderer/index.html` — new button in `#tabstrip`.
- `src/renderer/chrome/context.js` — IDS entries.
- `src/renderer/styles.css` — button styles + `no-drag`.
- `src/renderer/chrome/downloads-indicator-model.js` (new) — pure reducer.
- `src/renderer/chrome/downloads-controller.js` (new) — controller.
- `src/renderer/renderer.js` — instantiate controller.
- `test/unit/downloads-indicator-model.test.js` (new) — reducer tests.

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Tests passing (`npm test`)
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed` (in this file's header — per the flight-end-commit workflow; `completed` is set at flight close)
- [ ] Check off this leg in flight.md
- [ ] (Not final leg — no flight-level transition here)
- [ ] Changes staged for the single flight-end commit (do NOT commit per-leg under this workflow)
