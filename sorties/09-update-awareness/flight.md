# Sortie: Update awareness — a "Check now" button and an update dot on the kebab

**Status**: landed

> Architect design review 2026-11-17: **approve with changes**, incorporated — `checkNow` shares `runCheck` by making it return its outcome and moving the on/off test to its callers; `lastCheck` is emitted on every completion, not through `apply()`; the gap tolerates a clock that steps backward; the dot is applied in the closures that already hold `window`, not in the module-level setter; the kebab keeps its accessible name "More" and gains a description; "Last checked" shows a clock time, so it never goes stale; the state says whether checking is possible at all; the work is two legs plus the walk, with the controller moved verbatim before anything is added to it.

## Charter

### Outcome
The operator can see at a glance in the main window that an update is waiting, and can ask Goldfinch to check for one whenever they like.

### Why Now
At Mission 23 Flight 3's acceptance walk (2026-11-17) the operator noted "we are missing an indicator in the app that shows an impending update, we can add that later", and then asked for a "Check now" button. The update check itself shipped in v0.19.16.

### Success Criteria
- [ ] When a newer release exists, the kebab (⋮) button shows a dot; when none does, it shows none. The dot appears and clears without a restart, in every window.
- [ ] Settings → About has a "Check now" button that asks GitHub once — even with automatic checks turned off — and schedules nothing afterwards.
- [ ] Beside it, a short result: "Checking…", then "You're up to date", "Version X is available" or "Couldn't check — try again later"; and a "Last checked" line that is always shown.
- [ ] Nothing about what the app believes or sends changes: one validated stable version number from GitHub; no cookie, referrer or app version in the request.

### Constraints
- `src/renderer/renderer.js` gains no lines (1,504 of a 1,505-line budget); the evaluate seam stays at 41.
- "Check now" cannot be used to hammer GitHub: one request in flight at a time and a minimum gap between checks.
- Automation keys gain nothing beyond what they can already do.

Operator answers at chartering (2026-11-17): the indicator is a **dot on the kebab button** (not a new toolbar icon); "Check now" **works as a one-off when automatic checks are off**; the result is **a short inline line plus "Last checked"**. Charter agreed: "looks good".

---

## Pre-Flight

### Objective

Extend the shipped update check with an on-demand check and a glanceable indicator, without widening what it trusts or sends, and — while the About block is being reworked anyway — give its controller the unit seam the Flight 3 debrief asked for (recommendation 3).

### Open Questions

- [x] Indicator form, check-now-when-off, feedback form — operator answers above.
- [x] **Minimum gap between checks** — Flight Director default: **30 seconds** since the last completed check of any kind. A press inside the gap answers `too-soon` and the page keeps showing the last result. (GitHub allows 60 unauthenticated requests an hour per address; a scheduled check is one a day.)
- [x] **Does a one-off result persist while automatic checks are off?** The notice (and so the dot and the kebab item) persists until the next check, a restart, or the setting going from on to off (which clears the notice, as today). `lastCheck` survives the toggle and is cleared only by a restart. Nothing is persisted to disk.
- [x] **What does the page show when a check is aborted** (setting turned off, quit, timeout)? "Couldn't check — try again later." — the page answer is `failed`; `lastCheck` is left as it was.
- [x] **Which clock for the gap?** The wall clock, clamped: if the clock reads earlier than the last check, the gap counts as elapsed.
- [x] **Can the page know checking is impossible before pressing?** Yes: the state gains `canCheck`.

### Design Decisions

**DD1 — "Check now" is one main-side operation with one answer.** A new internal channel `internal-update-check-now` (`internal` class, through `registerInternalHandler`; ignores every argument; no reveal-gate call — no secret, no key, no caller-chosen value). **Shape (from the design review):** `runCheck()` returns a promise of its outcome, stored on the in-flight record synchronously before its first `await`; the "automatic checks are on" test moves out of `runCheck` into its two callers (the timer and `setEnabled(true)`). The outcome comes from the record's own `abortedBy`, never from `run === mine` (after an abort `run` is already null). `apply()` and its guard are unchanged. Nothing may be awaited between the gap test and `run = mine`, so two Settings pages pressing at once cannot start two requests. It calls a new `checkNow()` on the checker, which, in this order:
- answers `unavailable` when the checker is inert (an unpackaged build with no override) or stopped;
- **joins** a check already in flight — scheduled or on demand — and answers with its outcome, even inside the gap;
- answers `too-soon` with `retryAt` (wall clock) inside 30 seconds of the last completed check — failed counts as completed, aborted does not; a clock earlier than that check counts as elapsed. **The gap binds `checkNow` only**: turning the setting on still checks at once, as it does today;
- works whether automatic checks are on or off;
- otherwise runs exactly the existing request (`runCheck`'s fetch, headers, limits and validation are unchanged — no second code path) and answers `newer`, `current`, or `failed` (every failure code and `aborted` collapse to `failed` for the page; the trace keeps the precise code);
- never arms, re-arms or cancels the daily timer.
A scheduled check and a check-now share one in-flight slot (the timer firing during a check-now finds it busy and drops, as today). `setEnabled(false)` still aborts whatever is in flight — the pressing page then gets `failed` — and clears the notice. Turning the setting on while a check-now runs starts no second request. Accepted: a check-now with the setting off that finds a newer version shows the notice, the Download now button, the kebab item and the dot for the rest of the session even though automatic checks are off — the operator asked.

**DD2 — The state records the last check, and whether checking is possible.** `getState()` gains `lastCheck: { at: number, outcome: 'newer' | 'current' | 'failed' } | null` (wall-clock milliseconds from an injected clock) and `canCheck: boolean` (false when inert or stopped). `lastCheck` is set when any check — scheduled or on demand — completes or fails, and **`emit()` is called unconditionally at that point**, not through `apply()` (which returns early when `available` has not changed — so a `current` after a `current` would otherwise never reach a page). An aborted check does not update it. It survives a setting toggle and is cleared by a restart. Broadcast through the existing `update-state-changed` push so every window and Settings page agrees. Additive to the leg-05 contract; existing fields unchanged.

**DD3 — Settings → About.** A secondary "Check now" button `#about-check-now`, a result line `#about-check-result`, and a "Last checked" line `#about-last-checked`, placed under the version and notice block and above the "Check for new versions" row, in the layout walk fix 1 established. Copy, single-sourced in `update-notice-model.js` (pure, table-tested): "Checking…"; "You're up to date."; "Version X.Y.Z is available."; "Couldn't check — try again later."; for `too-soon` the line keeps the last result; "Last checked at <locale time>" (with the date when not today) from `lastCheck.at` and an injected `now` for the today test — a clock time, not "N minutes ago", so it never goes stale while the page is open and needs no refresh timer — or "Not checked yet". The button is disabled while the page's own press is in flight and whenever `canCheck` is false (with the line "Checking isn't available in this build."). `too-soon`: the button stays enabled and the result line keeps the last result. The checkbox note keeps its current text. Every string is fixed copy or main-validated; `textContent` only.
- **The About controller moves to its own module with injected dependencies** (`src/renderer/pages/settings-about-controller.js`, copying `vault-filter-controller.js`'s export shape so `node --test` can load it): `createAboutController({ document, bridge, model, downloadResultHint, now, … })`. It imports **nothing** from `src/shared/` itself — `settings.js` passes `updateNoticeModel` and `downloadResultHint` in (CLAUDE.md: page controllers take shared pure functions as injected deps). Needs its flat `internal-page-map.js` route, the flat import in `settings.js` (with `// @ts-ignore` before the `} from` line), and its `eslint.config.mjs` module-list entry; check whether `settings-page-shared-scripts.test.js` covers modules imported by `settings.js` and pin the route if it does not. **Moved verbatim first**, with its unit tests, before anything is added to it — the whole IIFE moves together (`hintOverride` and its key, `checkKnown`, `checkPushSeen`, the settings subscription; the planning rule's TDZ check applies). Justified by the Flight 3 debrief (recommendation 3) and by the new states being untestable inside an IIFE; it is the leg's riskiest step and is reviewed as such.

**DD4 — The dot lives in the chrome without touching `renderer.js`.** `overlay-menus.js` already holds the update state for the kebab: the module-level `setKebabUpdateState` (called directly by its tests, whose fake `window` has no `document`) and, inside `createChromePageActions` (constructed once per chrome with `window`, after `#kebab` exists in the static markup), the push handler and the boot read. **The dot is applied in those two closures**, through a small `applyKebabDot(window, state)` guarded by `window?.document?.getElementById?.('kebab')` — never inside the module-level setter. It decides from `updateNoticeModel(state).showNotice` (no second validation): it toggles the class `update-waiting` on `#kebab`, sets `title` to "More — update available" (back to "More"), and points `aria-describedby` at a visually hidden `#kebab-update-note` added to `index.html` whose text is "Update available" or empty. **`aria-label` stays "More"**, so nothing that finds the button by its name changes. Styled in `src/renderer/styles.css` as an absolutely positioned pseudo-element dot (no layout change; not the count `.tb-badge`), visible in both themes; it must not trip `toolbar-focus-ring-pin.test.js`'s scan of `#kebab` rules. Each window's chrome subscribes on its own, and a recovered chrome re-runs boot, so every window updates by itself. The kebab menu's "Update available" item is unchanged.

**DD5 — What stays the same.** The request, its headers, its validation, the release-page and download channels, the kebab item, the daily schedule, and the Download-now path are untouched. Automation reach: an admin key that evaluates script in the Settings page can press "Check now" — at most one request per 30 seconds, revealing nothing it cannot already read through `update:get-state`; stated in `docs/mcp-automation.md`.

**DD6 — Contracts** (the behavior spec reads them): channel `internal-update-check-now` (one new row in `CHANNEL_CLASS`; every pinned count — `ipc-gate-invariant.test.js`, CLAUDE.md — moves by one); bridge `window.goldfinchInternal.updateCheckNow()` → `{ outcome, retryAt? }` (internal preload and `renderer-globals.d.ts`); state fields `lastCheck` and `canCheck`; ids `about-check-now`, `about-check-result`, `about-last-checked`, `kebab-update-note`; the class `update-waiting` on `#kebab`. Additions to Flight 3's DD9 contracts; nothing renamed.

### Prerequisites

- [x] v0.19.16 released with the update check, Settings About and the kebab item (`567a2a5`).
- [x] The `update-notice` behavior spec and its fixture exist and pass (run `tests/behavior/update-notice/runs/2026-11-17-23-53-08.md`).
- [x] For the acceptance walk: a way to show the operator the dot on an installed build — a release candidate below the current stable (`v0.19.16-rc.1`) is offered v0.19.16 by the real endpoint, as in Flight 3. Needs the operator's go to tag.

### Pre-Flight Checklist

- [x] Architect design review incorporated.
- [x] Operator go.

---

## In-Flight

### Technical Approach

Two implementation legs and a walk. Leg 01 is main-side and testable on its own; leg 02 moves the About controller verbatim first, then adds to it, then adds the dot. Each leg's live smoke runs behind the dead proxy and exercises every existing apparatus primitive (census, windows, capture, evaluate, …) against the new state.

### Checkpoints

- After leg 02: the `update-notice` spec, extended, passes when run by the Flight Director.
- Before the walk: the operator's go to tag a candidate.

### Adaptation Criteria

**Divert if**: the dot cannot be added without a line in `renderer.js` (then extract first, never compact), or "Check now" needs a second request code path.
**Acceptable variations**: the time format of "Last checked"; whether "Check now" sits beside or under the notice buttons.

### Legs

1. `check-now-main-side` — DD1, DD2, DD5 and DD6's main half: `runCheck` returning its outcome, `checkNow`, `lastCheck`, `canCheck`, the channel and its table row, the bridge and typings, unit tests (every row named in Verification), docs, live smoke through the bridge. *Tier: high* (a new privileged channel; the checker's state machine).
2. `about-controller-and-dot` — DD3, DD4: the About controller moved verbatim with tests, then Check now, the result and "Last checked" lines; the model's copy; the kebab dot; the spec's new rows; live smoke. *Tier: high* (a shared settings page; the chrome toolbar).
3. `hat-and-alignment` *(interactive)* — the operator sees the dot and uses "Check now" on an installed candidate.

---

## Post-Flight

### Completion Checklist

- [x] All legs completed
- [ ] Code merged
- [x] Tests passing
- [x] Documentation updated

### Verification

- **Unit**: `checkNow` table (on, off, inert, stopped, joins an in-flight check inside the gap, too-soon with `retryAt`, a clock stepped backward, each outcome, aborted → `failed`, the daily timer untouched, the request's options and headers unchanged on both paths, setting turned on during a check-now — one request, setting turned off during it — aborted and notice cleared); `lastCheck` set and emitted by scheduled and on-demand checks including `current` after `current`, not by an aborted one, kept across a toggle; `canCheck`; registrar on a real gate (web frame refused; arguments ignored); the model's copy and relative-time table with an injected clock; the extracted controller against a fake DOM; the kebab class and accessible name following the state; `renderer.js` byte-identical.
- **Behavior spec `update-notice`** gains rows: Check now with automatic checks on (one request, result line, "Last checked" updates); with them off (one request, nothing scheduled — no further request for the wait); a second press inside the gap (no request, `too-soon`, the last result kept); the kebab button's class and accessible name read from the chrome DOM with and without a newer release (the kebab **menu** stays by-eye; the **button** is chrome DOM and observable).
- **By eye, at the walk**: the dot's look in both themes; the About block's layout; Check now on an installed build.
