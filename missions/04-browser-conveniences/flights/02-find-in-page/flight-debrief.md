# Flight Debrief: Find in Page

**Date**: 2026-06-19
**Flight**: [Find in Page](flight.md)
**Status**: landed
**Duration**: 2026-06-18 (planning + legs) – 2026-06-19 (live verification + landing)
**Legs Completed**: 3 of 3 autonomous (`find-bar-ui`, `find-mcp-tools`, `verify-integration`) + the optional `hat-and-alignment` HAT

## Outcome Assessment

### Objectives Achieved

The flight delivered find-in-page on both surfaces: a renderer-side floating find bar (`Ctrl+F`,
live `n/m`, `Enter`/`Shift+Enter` stepping, `Esc`/`✕` close + focus-restore, per-tab restore,
internal-tab no-op, lightbox guard) and the `findInPage`/`stopFindInPage` automation tools (surface
24 → 26). Unit suite **834 green** (lint + typecheck clean); a11y gate clean; SC4 HAT-confirmed; SC8
stepping/warm parity live-verified against the running app. Shipped on PR #59 / commit `9180e92`.

The headline outcome is that the **behavior test did its job**: it caught a real architectural defect
(the MCP find returned `{0,0}` for present terms) that two design reviews and a green unit suite all
missed — because the unit tests faked the `found-in-page` emitter. That triggered the flight's
pre-authorized Adaptation Criterion and a mid-flight rebuild (Deviation D1).

### Mission Criteria Advanced

- **SC4 — Find in page**: met (HAT-confirmed on WSLg via Enter; live-incremental-search degraded on
  WSLg only — documented known issue, macOS-pending).
- **SC8 — Agent parity (part)**: `findInPage`/`stopFindInPage` discoverable + invocable, jar-scoped +
  internal-guarded; stepping/warm finds return true counts. Cold-first-find `{0,0}` on WSLg is the
  documented known issue.

All flight checkpoints met. SC2/SC2-style "macOS confirmed later" disposition now also applies to the
find cold path.

## What Went Well

- **The behavior test paid for itself.** A green unit suite + two "approve-with-changes" design
  reviews all certified a design (DD4 main-side event-wrap) that does not work in reality. Only the
  live Witnessed run surfaced it. This is the strongest validation yet of the behavior-test layer for
  real-environment Electron behavior.
- **The flight's Adaptation Criteria contained the correct escape hatch.** Although the *trigger* was
  mis-framed (renderer-event unreliability vs. main-event non-delivery), the *fallback* it
  pre-authorized — route the find through the renderer — was exactly the fix. The diversion was
  in-bounds, not a re-plan.
- **DD1/DD2/DD3/DD5 held cleanly** — the renderer find bar landed in leg 1 with no adaptation; the
  design-review fixes (no-post-close-flash guard, backgrounded-tab `did-navigate` semantics, the
  `zoom-changed` send model) were all correct.
- **Leg boundaries held under stress.** The leg-2 rebuild happened entirely within leg 2 without
  disturbing leg 1 or leg 3.
- **The a11y state-driver earned its keep immediately** — building the 5th `find-bar` driver as a
  leg-3 deliverable exposed a real serious violation (`#find-count` `aria-prohibited-attr`) that was
  then fixed.
- **The deviation inadvertently improved parity.** The renderer-routed find shares ONE Chromium find
  session between the UI bar and the MCP tools — the last-writer-wins parity DD1 aimed for, better
  than DD4's two-independent-sessions design.

## What Could Be Improved

### Process

- **The AC0 spike probed the wrong channel.** Leg 1 specified a WSLg spike for the *renderer-side*
  `<webview>` `found-in-page` event (DD1's path, which works) but never specified a spike for the
  *main-process* `webContents` event (DD4's path, which doesn't fire). The spike that would have
  caught the defect at design time was never gated. Future `<webview>`-guest event ops need a
  delivery-frame spike on the *main-side* path specifically.
- **Six fix iterations + ~8 app restarts** to land D1 — costly because main-process code does not
  hot-reload and each restart mints fresh keys (dropping the session MCP connection). A standing
  fixed-key dev launch (persisted keystore + known port) would have cut the loop time substantially.
- **Cross-jar behavior-test step 7 was not executable** (a jar-scoped key can't obtain a foreign
  jar's `wcId` through the surface). This is the **third** instance of the same apparatus limitation
  (after Flight 1's `page-zoom` step 7 and `print-to-pdf` step 3) — it is now a systematic gap, not a
  one-off.

### Technical

- **Cold-start retry loop is unverified WSLg-specific debt.** The injected script's 3 s timeout +
  500 ms retry (resolve-only-on-`matches>0`) makes a genuine **no-match** query take up to ~3 s on
  *every* platform, including ones where the cold quirk may not exist. Needs a macOS gate: if the cold
  quirk is absent there, drop the retry (or shrink the timeout) for the no-match path.
- **The injected-code string is outside the static-analysis perimeter.** `find.js`'s ~30-line IIFE
  lives in a template literal — invisible to lint/typecheck/refactor tools. The `new Function(code)`
  parse-guard test mitigates syntax regressions, but semantic bugs inside the string (wrong variable,
  wrong event field) are only catchable live.
- **`closeFind` and the `onNav` inline invalidation are partially duplicated** — a small refactor to
  a shared `cancelFind(tab, {restoreFocus})` helper would remove the maintained parallelism.
- **Test metrics**: `npm test` 834 pass / 0 fail / 0 skipped, ~0.93 s, 12 suites; lint + typecheck
  clean; no flakes. vs Flight 1 debrief (803 pass, ~0.89 s): **+31 tests, +~40 ms** — accounted for by
  20 new `automation-find.test.js` cases + the mid-flight parse-guard / resolve-on-nonzero regression
  guards. No slowdowns, growing skip lists, or flakes. Healthy.

### Documentation

- The **renderer-route pattern is only documented in `find.js`'s header comment.** A future op author
  comparing `zoom.js`/`print.js`/`find.js` will see `find.js` diverge structurally with no shared
  doc. `docs/mcp-automation.md` should gain a short "ops that observe `<webview>` events" note.
- **`#main { position: relative }`** is the anchoring dependency for `#find-bar` but the property site
  could use a one-line comment so a future refactor doesn't read it as dead code.
- The `find-in-page.md` spec records step 7's apparatus gap in a parenthetical but doesn't mark the
  step row itself as non-executable.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| **D1 — MCP find rebuilt to route through the chrome renderer's `<webview>` tag** (supersedes DD4's main-side event-wrap) | `found-in-page` is never delivered to a main-process `webContents` for `<webview>` guests — only to the renderer-side DOM element | **Yes** — codify the delivery-frame spike (below) and document the renderer-route as the standard pattern for `<webview>` event-observing ops |
| Cold-start resolve-on-`matches>0` + retry loop | WSLg cold `<webview>` emits `finalUpdate:true, matches:0` before the real count; fresh `findNext:false` doesn't report on a cold guest | **No** (provisional) — re-evaluate on macOS; likely a WSLg-only workaround to shrink/remove there |
| `#main { position: relative }` added (not in spec) | Containing block for the absolutely-positioned `#find-bar` overlay | No — necessary consequence of the layout choice |
| AC0 spike deferred to HAT | Spawned agent couldn't drive the live GUI | No — but the "spawned agent says so explicitly rather than silently skipping" precedent is good |

## Key Learnings

1. **A fake that models what the docs say cannot catch where the docs are wrong.** The leg-2 unit
   tests verified the *correct protocol against the wrong channel*: "given a `found-in-page` on `wc`,
   the op resolves" — true, but Electron never delivers that event to `wc` for `<webview>` guests.
   Logic-level fakes are necessary but insufficient for novel platform-event paths; a live spike or
   behavior-test step against the *real* channel is the only thing that catches a delivery-frame
   error.
2. **`<webview>` guest event delivery is a topological exception.** Every pre-existing automation op
   (`zoom`, `print`, `scroll`, `readAxTree`) acts on main-process `webContents` and works — a strong,
   misleading prior. Certain Chromium events (`found-in-page`, and likely selection/paint-timing
   events) are delivered ONLY to the renderer-side `<webview>` element.
3. **WSLg is not authoritative for rendering-pipeline-event behavior.** The cold-start quirk and the
   step-3 1-match fragility are both WSLg artifacts. The automation surface, DOM reads, screenshots,
   and most drive ops are fine on WSLg; the narrow exception is the *rendering-event-observation
   class*, which should be macOS-authoritative.
4. **The behavior-test apparatus cannot execute jar-boundary steps** that need a foreign jar's
   `wcId` — three flights running. This is an apparatus design gap, not a per-spec author error.

## Recommendations

1. **Codify a `<webview>` event-delivery spike as a flight-design checklist item** (Critical):
   *"If an automation op observes a `webContents` event on a `<webview>` guest main-side, spike the
   delivery frame (5 min, running app: a main-side `wc.on(event)` listener + a renderer-side
   `wv.addEventListener(event)` listener, trigger, observe which fires) BEFORE specifying the
   event-wrap. Main-process delivery is not guaranteed to match renderer-side delivery; a code review
   and a fake-emitter unit test cannot catch this."* Add to the flight skill's design guidance.
2. **Document the renderer-route pattern in `docs/mcp-automation.md`** (Important): a short
   "ops that observe `<webview>` events use `chromeContents.executeJavaScript` on the tag, not a
   main-side `webContents` listener" section, cross-referencing `find.js`.
3. **Gate the cold-start retry on a macOS run** (Important): confirm whether the cold-first-find
   `{0,0}` reproduces on macOS; if not, drop/shrink the retry so a genuine no-match doesn't pay up to
   ~3 s. Track under the mission Known Issue.
4. **Fix the behavior-test jar-boundary apparatus gap** (Important, cross-flight): update the
   behavior-test AUTHORING guidance to mark jar-isolation steps as unit-only (or design an
   out-of-band foreign-`wcId` fixture). This is now the third occurrence.
5. **Adopt a `[macOS-authoritative]` annotation for live gates** on rendering-event-observation ops
   (Minor): WSLg runs stay as smoke; the pass/fail call for cold-path / rendering-dependent steps
   defers to macOS — make it a first-class planning concept rather than a per-flight discovery.

## Action Items

- [ ] Add the `<webview>` event-delivery spike checklist item to the flight-design skill guidance (Rec 1).
- [ ] Add the "ops that observe `<webview>` events" section to `docs/mcp-automation.md` (Rec 2).
- [ ] On the next macOS session, confirm the find cold-start behavior + no-match latency; shrink/remove the retry if the quirk is WSLg-only (Rec 3; mission Known Issue).
- [ ] Update behavior-test AUTHORING guidance for jar-boundary step executability (Rec 4) — sweep into the next maintenance leg.
- [ ] Annotate `find-in-page.md` step 7 row as non-executable (apparatus gap) and add the `#main { position: relative }` anchoring comment (Minor; next time the files are touched).
- [ ] Carry forward the still-open Flight-1 action item ("correct the stale leg-04 CLAUDE.md note") into the next maintenance pass.
