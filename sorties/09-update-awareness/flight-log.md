# Flight Log: Update awareness

**Sortie**: [Update awareness](flight.md)

## Flight Director Notes

- 2026-11-17 — Qualified as a sortie, criteria checked out loud: one outcome (glanceable update state plus an on-demand check, both driving the same state); one cluster of decisions (the indicator's form and the check's behaviour); one implementation leg plus a walk; no new subsystem. No active mission covers it (Mission 23's flights are complete). Branch `sortie/09-update-awareness` from `567a2a5` (v0.19.16).
- 2026-11-17 — Operator answers: "Dot on the kebab button"; "Yes, as a one-off" (Check now works with automatic checks off); "Short inline result". Charter agreed: "looks good".
- 2026-11-17 — Flight Director defaults recorded as open-question answers: a 30-second minimum gap; a one-off result persists in memory until the next check, a restart or a setting toggle. Folded in from the Flight 3 debrief (recommendation 3): the About controller is extracted with injected dependencies, because this sortie rewrites it anyway. Not folded in: moving download matching out of the registrar (separate, untouched surface).

- 2026-11-17 — Architect design review: approve with changes — two high (the shape of `checkNow` against `runCheck`; `lastCheck` must be emitted outside `apply()`), six medium, two low; all incorporated in one cycle. Flight Director answers to its six questions: an aborted check shows "Couldn't check" and leaves `lastCheck`; `lastCheck` survives a toggle, not a restart; the gap uses the wall clock, clamped; the state gains `canCheck`; the route pin for an imported-only module is checked in the leg; the kebab keeps `aria-label` "More" and gains a description, and "Last checked" shows a clock time (no refresh timer). Re-checked against the sortie gate: still one outcome and one cluster; the work is now **two legs plus the walk**, within the soft limit, with the controller moved verbatim before anything is added. Status `ready`.

- 2026-11-17 — Operator: "/mission-control:agentic-workflow sortie 09". Sortie `in-flight`. Crew file `leg-execution.md` loaded (Developer and Reviewer on Sonnet). Three legs.
- 2026-11-17 — Leg 01 `check-now-main-side` designed, tier **high** (the checker's state machine; a new privileged channel). Developer design review spawned.
- 2026-11-17 — Leg 01 design review: approve with changes (four medium, four low), incorporated as the leg's amendments — the join mechanism spelled out, an aborted check is always aborted, `lastCheck.at` is completion time, one emit per completion, the existing tests that must change named, the smoke sequenced around the dev build's first check. Flight Director answer: the gap applies after a scheduled check too. Leg `ready`; Developer spawned.

- 2026-11-17 — Leg 01 `[LAND:leg]` accepted: all nine criteria met, 7,269 tests passing, `renderer.js` unchanged; live smoke through the bridge behind the dead proxy, loopback only. Unit-only by design: two pages pressing at once; the daily timer's due time.
- 2026-11-17 — Flight Director design change for leg 02, from leg 01's smoke: a `too-soon` answer gets its own line ("Checked moments ago — try again in a few seconds.") instead of leaving the last result unchanged — a press that visibly does nothing reads as broken. Overrides sortie DD3's "keeps the last result" for that one case. Leg 02 sent for design review against leg 01 as built.
- 2026-11-17 — Leg 02 design review: approve with changes (three medium, two low), incorporated as the leg's amendments — the dot needs a positioned button; `.sr-only` sibling for the note; the spec's rows go before the relaunch step; the route closure test already covers the import; a mechanical check after the verbatim move. Flight Director answers: "Last checked" shows beside a failure (intended); the dot clears whenever the notice clears. Leg `ready`; Developer spawned.
- 2026-11-18 — Code review of legs 01–02 (Reviewer, Sonnet; uncommitted work only): **`[HANDOFF:confirmed]`**, nothing blocking; gates green (7,297 passing). Its one count finding was wrong — CLAUDE.md already states 211 rows — and needs no action; the other two notes are pre-existing or reasoned. Leg 02's accessible-name fix ("Download now — version X", WCAG label-in-name) was found by the leg's own a11y run and fixed before the review. Behavior spec `update-notice` running in parallel.
- 2026-11-18 — Spec `update-notice`: **pass, 14/14**, a11y no new violation (run log `tests/behavior/update-notice/runs/2026-11-18-02-07-22.md`). Leg 02 marked `landed` by the Flight Director. Two product findings from the Validator carried to the walk as look-and-feel fixes: the Check now result repeats the notice word for word when a newer version is found; the result line goes stale after a later check from elsewhere (a toggle) — it should clear when `lastCheck` moves past this page's own answer.

## Leg Entries

### Leg 01 — check-now-main-side

- Status: landed (not committed). `runCheck()` is now `guard -> record -> mine.promise = execute(mine)`; it returns the outcome code and a call while one runs joins that promise. The "automatic checks on" test moved to the timer callback and `setEnabled(true)`. An aborted run is always `aborted` (a late 200 after `setEnabled(false)` included). `lastCheck` is set before `apply()` (now returning whether it emitted); one emit per completion. `checkNow()` order: unavailable, join, too-soon, fresh check.
- Existing tests changed: `update-check.test.js` "newer ... second identical answer" renamed and re-asserted (a repeat emits once, for `lastCheck`); three `getState()` deep-equals gained `lastCheck` / `canCheck`. `register-update-ipc.test.js` "four channels" is now five; `setup()` takes a `checkNow` spy. `ipc-gate-invariant.test.js` 211 / internal 77.
- New unit cases: check-now off / on (timer untouched), request options on both paths, inert / stopped, join of a timer-started check, two presses, gap and its 30 000 ms boundary, gap after scheduled / failed / aborted, backward clock, every failure code, timeout, `setEnabled(false)` and `stop()` and `setEnabled(true)` during a check-now, newer with checks off, `lastCheck` emit on current-after-current and survival over a toggle; registrar: zero-argument call, copy, web tab refused, throw / rejection / default answer `unavailable`.
- Smoke (dev mode, fixture, dead proxy, scratch HOME / XDG_CONFIG_HOME, `connectAutomation`, admin `evaluate` in a `goldfinch://settings` tab):

| Step | Observation |
|---|---|
| boot, +32 s, press A (setting on) | `newer`, 1 request after reset, `lastCheck` `newer` in `updateGetState()` |
| press B at once | `too-soon` with `retryAt`, request count unchanged |
| +31 s, press C | `newer`, one more request |
| setting off, press D 30 s after C's check (my timing) | `too-soon`, 0 requests |
| 60 s idle, setting off | 0 requests |
| fixture `http-500`, press E (setting off) | `failed`, 1 request, `lastCheck.outcome` `failed`; press at once: `too-soon` |
| turn setting on | one immediate request (gap binds check-now only); `lastCheck` `failed` |
| setting off, +31 s, fixture `higher`, press G | `newer`, 1 request; 60 s later still 1 |
| enumerateWindows / enumerateTabs / readDom / readAxTree / captureScreenshot / captureWindow on that tab | all answered |

  Output trace showed only the expected `newer` / `http-500` / `disabled` lines. Nothing left the machine (loopback fixture, dead proxy). Teardown by recorded pids; ports 8237 / 49731 free.
- Gates: `npm test` 7269 pass 0 fail; typecheck, lint, format:check clean; `renderer.js` untouched, only `renderer-globals.d.ts` under `src/renderer/`.
- For leg 02: a push no longer implies `available` changed.

### Leg 02 — about-controller-and-dot

- Status: in-flight (implemented, not committed; the spec run, AC6, is the Flight Director's).
- **Verbatim move checkpoint (before any new behaviour)**: the About IIFE's body became `createAboutController({ document, window, bridge, updateNoticeModel, downloadResultHint })` in `src/renderer/pages/settings-about-controller.js` (no import of its own; `settings.js` constructs it with `window.goldfinchInternal`; route, `eslint.config.mjs` entry, `internal-page-map.test.js` list). `npm test` 7269 pass / 0 fail and `npm run lint` clean were recorded at that point, before step two. The nine AC2 cases were written against the verbatim move and passed before `checkNowView`, the markup or the controller additions existed. `internal-page-route-closure.test.js` already walks `settings.js`'s imports, so no new pin was needed.
- Step two: pure `checkNowView(state, pressing, lastAnswer, now, fmt)` (+ `CHECK_NOW_COPY`) beside `updateNoticeModel`; Check now markup (`#about-check-now`, `#about-check-result`, `#about-last-checked`), CSS (gaps ride the later element); controller: in-flight flag, no-argument call, rejection or odd answer reads `failed`, focus handed back after the answer, `renderCheck()` at the end of `render()` so every push refreshes Last checked.
- Kebab: `applyKebabDot(window, state)` in `overlay-menus.js`, called from the two `createChromePageActions` closures only; `#kebab-update-note` is a `.sr-only` sibling (the page's existing utility); `#kebab.update-waiting` / `::after` in `styles.css`.
- **Defect caught in my own work**: the first insert of the dot CSS used `str.replace('.icon-btn:hover {', …)` and landed inside `#newtab-pill .icon-btn:hover {` (the first match). The live probe showed `#kebab` `position: static` and no dot in the captured window; fixed (rules now sit before the top-level `.icon-btn:hover`), and a source-scan case in `overlay-menus.test.js` now pins the rules as top-level and the preceding text as a closed rule.
- Smoke (dev mode, fixture first, dead proxy, scratch HOME / XDG_CONFIG_HOME, `connectAutomation`, real clicks at the element rectangles; fixture `/__log` counts since `/__reset`):

| Step | Observation |
|---|---|
| boot check (`newer`), chrome DOM | `#kebab` class `icon-btn update-waiting`, title `More — update available`, aria-label `More`, described by `kebab-update-note` (text `Update available`), rect 32 x 32 at (1357, 47.5) |
| Settings tab initial | `#about-check-now` visible / enabled, `#about-check-result` hidden (`display: none`), `#about-last-checked` `Last checked at 8:01 PM`; the result and last-checked carry no `role`, no `aria-live` |
| press 1 (setting on, 32 s after boot) | 1 request; result `Version 0.19.17 is available.` |
| press 2 at once | 0 further requests; result `Checked moments ago — try again in a few seconds.`; Last checked unchanged |
| checkbox off (real click) | notice hidden; `#kebab` class `icon-btn`, title `More`, note empty, rect 32 x 32; ::after computed `none`; 0 requests |
| press 3, off, fixture `equal` (after gap) | 1 request; `You're up to date.`; notice stays hidden; `Last checked at 8:02 PM` |
| press 4, off, `http-500` | 1 request; `Couldn't check — try again later.`; Last checked 8:02 PM (set by the failed check) |
| press 5, off, `higher` | 1 request; `Version 0.19.17 is available.`; notice visible; dot on; checkbox unchecked; 0 requests in the next 5 s |
| after the CSS fix: chrome `location.reload()` | boot read re-applied the dot (`position: relative`, ::after 7 px absolute, rect 32 x 32); (the dev chrome reload also dropped the open Settings tab — outside this leg) |
| enumerateWindows / enumerateTabs / readDom / readAxTree (267 nodes, `Check now` present) / captureScreenshot / captureWindow | all answered |

  Output trace: `newer, newer, disabled, current, http-500, newer`. a11y (`npm run a11y -- --target=goldfinch://settings`, Check now result showing, notice showing): one finding, `label-content-name-mismatch` on `#about-update-download` (its `aria-label` `Download version <x>` vs visible `Download now`) — pre-existing leg `update-download` markup carried over verbatim, not a node this leg added; no finding on any new id. Screenshots: `about-check-now.png` and `toolbar-dot.png` in the session's `s09-shots` directory. Teardown by recorded pids; ports 8237 / 8238 / 49741 free; scratch removed.
- Spec: `tests/behavior/update-notice.md` gains rows 10-12 (Check now with checks off + the dot on both windows; with checks on + a press inside the gap; the dot clearing when the setting is turned off); old 10 / 11 are now 13 / 14; step 3 gains the three ids; Preconditions gain the 30-second-gap and kebab-button notes; Out of Scope says the kebab **menu** is by-eye. The header's run tally is untouched.
- Gates: `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check` clean; `src/renderer/renderer.js` byte-identical (1,504 lines), seam 41.

### Leg 02 a11y fix
- 2026-11-17 — `downloadAriaLabel` is now `Download now — version <x>` (begins with the visible text, WCAG 2.5.3); the model test and step 3 of `tests/behavior/update-notice.md` updated; the old name survives only in a past run log, left as history. `View release notes for version <x>` begins with its visible text; `#about-check-now` carries no `aria-label`.
- Gates: format, `npm test`, typecheck, lint, format:check run after the change (see report).

### Walk-prep fixes

Two look-and-feel fixes to Settings -> About's Check now result line, from the behavior-spec Validator (operator-approved).

- **Duplicate line.** A `newer` answer's result line now reads `Found a newer version — see above.` (`CHECK_NOW_COPY.newer` in `update-notice-model.js`) instead of repeating the notice. The `isStableVersion(available)` guard stays (no claim once the notice has cleared); the notice text is unchanged. Updated `update-notice-model.test.js`, `settings-about-controller.test.js`, `docs/updates.md`, CLAUDE.md and `tests/behavior/update-notice.md` row 10.
- **Stale result.** `settings-about-controller.js` ties the page's last answer to a check by `lastCheck.at` (`answerAt`; `adoptFrom` covers an answer that arrives before its own push, a too-soon/unavailable/rejected answer binds to the `at` already on record). A push with a different `at` clears it; so does the notice going from showing to not showing (setting turned off). A new press clears the old answer first. Four new controller tests: own push after, own push before, too-soon then later check, setting off.
- Live (dev mode, fixture, dead proxy): press -> `Found a newer version — see above.`; second press -> `Checked moments ago…`; setting off and on -> result line hidden. Gates: test, typecheck, lint, format:check pass.
