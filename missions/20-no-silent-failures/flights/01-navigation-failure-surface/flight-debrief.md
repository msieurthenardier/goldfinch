# Flight Debrief: The Failure Surface and Navigation Errors

**Date**: 2026-09-15
**Flight**: [The Failure Surface and Navigation Errors](flight.md)
**Status**: landed → completed (2026-09-15)
**Duration**: 2026-09-15 (planning) – 2026-09-15 (landed; one day, one session)
**Legs Completed**: 3 of 3 (2 autonomous + the operator-elected HAT)

## Outcome Assessment

### Objectives Achieved

Every failed top-frame navigation now gets an explanatory, retryable surface,
and the mission's one hard-to-reverse decision — how a tab with no page to
show presents that surface — is made and shipped: a chrome-owned panel in the
guest slot over a hidden guest, under one two-axis visibility/focus invariant
(`applyGuestVisibility`) enforced at every app-side show/focus site. Main
records the failure on the tab's registry entry, keeps the intended address
authoritative for the census, session snapshot, and closed-tab reopen, and
pushes one owner-routed `tab-load-failure`. The chrome renders the panel
(address, app-authored reason, `NAME (code)`, Retry), marks the strip, syncs
the address bar, and reports `loadState`/`loadError` in the census.
Certificate failures reach the same surface with certificate copy — the floor
Flight 2 will specialise. PR #215 is ready for review.

Verified by the Witnessed spec `navigation-failure-surface` (9/9 judged
checkpoints, run `2026-09-15-15-01-54`), 4565 unit tests (+96 over the
flight), all four gates, and an operator HAT (9 of 10 steps pass).

### Mission Criteria Advanced

- **Met**: criterion 1 (no empty document on a failed navigation; retry) and
  criterion 2 (failure visible from the strip; address bar keeps the intended
  address) — checked off in `mission.md`.
- **Partially met**: criterion 10 — text-only rendering and the census
  `loadState` half are done; the "keyboard-operable" half is **open on issue
  #216** (HAT H7: after a typed navigation fails, the chrome loses OS focus
  and keyboard focus is stranded).
- **Floor laid for criterion 3** (certificate failures no longer fail blank).

## What Went Well

- **Spike-first paid for itself three times.** Leg 1's live spike settled the
  four Electron premises before any design-bearing code, narrowed DD4 to its
  real target (snapshot and closed-tab capture, not the push), and caught
  `ERR_UNSAFE_PORT` on the fixture port — so the classifier gained a kind and
  the spec moved to a real refused port before the Witnessed run.
- **The multi-layer net caught what each layer is blind to.** Unit tests
  pinned every link; the Witnessed run caught two cross-consumer
  inconsistencies the unit layer structurally cannot see (stale address bar on
  programmatic re-navigation; census title lagging the strip) and both were
  fixed before the flight-end review; the HAT then caught the one thing no
  automation could — real OS focus.
- **Design reviews caught real omissions before code.** The `context.js`
  `IDS` entry (the controller would have thrown at construction), the
  fake-DOM harness selector list that would have silently nulled the new
  strip span, the move-path show site missing from the invariant, the title
  clobber race, and the error-commit clear guard.
- **Architecture held.** The controller is a faithful second instance of the
  welcome-surface shape; `tab-entry-url.js` and the shared `failedTabTitle`
  are small in-pattern additions; the invariant helper is grep-pinned (zero
  bare `setVisible(true)` on a guest remains).
- **Live rig findings were routed to durable homes** — the crew file's
  apparatus notes (mirrored networking, the composite artifact, the transient
  capture refusal, the buffered fixture banner, `hasFocus` under automation),
  two squawks, the spec's revised preconditions.
- **Test suite health**: 4565/4565, 0 skipped, wall-clock 4.97 s — flat to
  slightly faster than the M18/M19 band (5.2–5.8 s) despite +96 tests; the
  same five slowest suites (vault family + navigation-controller) recur
  across all three recent debriefs; this flight's files run 60–85 ms each.

## What Could Be Improved

### Process

- **An apparatus anomaly sat beside the real defect for a whole Witnessed run
  and was filed as a rig limitation.** `document.hasFocus()` read `false` on
  every automation check of the keyboard row; the run passed on a11y-tree
  evidence and the ring absence was pushed to the HAT. That was the correct
  verdict under the spec as written, but the anomaly should have been an
  escalation trigger, not a footnote — it was the symptom of #216.
- **Line-budget arithmetic is manual and was wrong twice** (estimated +14 →
  actual +22 → +23). Prettier expands every `function` declaration to three
  lines and the leg's itemization omitted the `tab-controller.js` deps growth.
  A leg that touches `renderer.js` should measure a Prettier-formatted draft,
  not count by hand — or plan the extraction up front.
- **The keyboard row's F6 probe was non-discriminating by construction**
  (focus was already on the heading); it took an Orchestrator addendum to make
  it a real test. Spec revised.
- **The Prerequisites under-anticipated rig facts** discovered live (mirrored
  networking never refuses `127.0.0.1`; the composite paints hidden guests;
  no OS focus under automation). The spike's scope was the engine's failure
  events, not the full set of rig premises the acceptance run depended on.

### Technical

- **`renderer.js` is at zero headroom (1858/1858).** Flight 2's interstitial
  and override UI will need glue; the next touch pays for an extraction, not a
  bump. The natural seam: the guest-slot surface projection (welcome,
  load-failure, soon the interstitial and the crash page all need the same
  show/hide/wrapper-function shape).
- **The H7 focus reassert is speculative code that did not fix the defect it
  targets.** Kept because harmless and unit-pinned (6 cases), but it must not
  be mistaken for a fix; #216 still needs a main-side focus/blur trace.
- **A second hand-rolled fake-DOM harness** (`load-failure-controller.test.js`
  lifts `FakeElement`/`FakeClassList` rather than importing
  `tab-controller.test.js`'s, which is not exported). Worth extracting before
  a third controller test needs it.
- **F3 (double `GET` on Retry)** did not reproduce in isolation; cause
  unconfirmed (most likely a timing race in that run's interleaving). Not a
  squawk; recorded for the next Retry-touching flight.

### Documentation

- The "chrome panel in the guest slot" pattern now has two instances and a
  third and fourth coming; it deserves a named CLAUDE.md pattern beside
  "Overlay-view patterns" (mechanism, the two-axis invariant, the projection
  order in `activateTab`, the frozen-contract convention, what the census
  sees) instead of two long per-surface bullets.
- The census title contract on failed rows landed in `docs/mcp-automation.md`;
  the `loadState` enum's planned growth is documented there and in the model.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| Checkpoint 1 rerun on `127.0.0.2`; every `{P}`/`{Q}` URL substituted | WSL2 mirrored networking silently drops SYNs to unbound `127.0.0.1` ports — no refusal ever lands | Yes — spec preconditions now require a refusing loopback host with a curl precheck; crew-file note |
| Chrome-view `captureScreenshot` used as the rendered observable instead of `captureWindow` | The Wayland composite paints the hidden guest over the panel (squawk 0075) | Yes — for chrome-DOM surfaces; the composite only for a visible guest |
| `RENDERER_LINE_BUDGET` 1850 → 1858 rather than a divert | Extraction boundary intact; overage is Prettier expansion of the required wrapper functions | No — next touch extracts |
| `effectiveUrl` made order-independent (substitutes on any `chrome-error:` live URL) | The error commit's `did-navigate` order was unknown at design; spike later showed it never fires | Yes — the defensive form costs nothing |
| `unsafe-port` kind added to the model | Port 1 is on Chromium's restricted list | Yes (acceptable variation) |
| Failure-push handler also writes `tab.url` and syncs the address bar | `did-navigate` never fires for a failed load, so a re-navigated open tab kept its old address | Yes — DD6 now reads this way |
| H7 logged as #216 instead of continued diagnosis | Operator ruling at the HAT; time-boxed | — |

## Key Learnings

- **Model the engine as a focus actor.** The invariant enumerated every
  app-side `setVisible`/`focus` site and missed that navigation start itself
  can move OS focus. Any future hidden-guest state (Flight 2's interstitial,
  Flight 3's crash page) must be designed against a measured focus trace, not
  an enumeration of the app's own calls.
- **Automation can't see OS focus; a false `hasFocus()` is a red flag, not a
  limitation.** Treat it as a mandatory escalation in the crew protocol.
- **Cross-consumer consistency is the unit layer's blind spot** (address bar
  vs. record, strip vs. census). The Witnessed run is the right net for it —
  and its spec rows should assert every consumer of a piece of state, not one.
- **Measure, don't estimate, anything a formatter decides** (line budgets).
- **Session restore is a free regression probe**: the dev profile restored the
  smoke sessions' failed tabs at their intended addresses and they failed
  honestly — DD4's snapshot substitution, observed for free at every launch.

## Recommendations

1. **Diagnose #216 with a main-side `webContents` focus/blur trace before
   Flight 2 builds the interstitial on the same hidden-guest surface** — an
   interstitial is a keyboard-reachable security decision point; do not
   inherit a known stranded-focus model. Operator ruling today: it stays a
   Known Issue; it should be the first item at Flight 2's planning table.
2. **Extract the guest-slot surface projection before adding a third
   surface** — `renderer.js` is at zero headroom; the shared show/hide/
   wrapper-function shape across welcome, load-failure, and the coming
   interstitial/crash panels is the extraction seam.
3. **Close squawk 0075 before Flight 3's acceptance run** (its crash surface
   hides the guest the same way) and **squawk 0074 before Flight 2's a11y
   states** (so "zero new findings" becomes a green gate).
4. **Add "a false `document.hasFocus()` under automation is an escalation
   trigger" to the behavior-test crew protocol**, and make focus-probe rows
   start from a different element by construction.
5. **Name the chrome-panel-in-the-guest-slot pattern in CLAUDE.md** and
   extract a shared fake-DOM test harness before the third instance.

## Action Items

- [ ] #216 — focus/blur trace + fix; first item at Flight 2 planning (Known
      Issue on Mission 20; operator: leave as Known Issue for now)
- [ ] Guest-slot surface projection extraction — plan as Flight 2's first leg
      or a maintenance leg (design work; not a squawk)
- [ ] Squawk 0075 (`captureWindow` paints hidden guests) — before Flight 3's
      Witnessed run
- [ ] Squawk 0074 (`#bookmarks-bar` a11y region) — before Flight 2's a11y
      states
- [ ] Crew-protocol note: false `hasFocus()` = escalation trigger — logged as
      **squawk 0076**
- [ ] CLAUDE.md: name the guest-slot panel pattern — operator declined a
      squawk; fold into Flight 2's docs step when the third instance lands
- [ ] Shared fake-DOM test harness extraction (servicing — squawk candidate)
- [ ] F3 double `GET` on Retry — unconfirmed; re-check at the next
      Retry-touching flight
