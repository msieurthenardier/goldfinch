# Flight Debrief: Multi-Window Shell, Part 1

**Date**: 2026-07-15
**Flight**: [Multi-Window Shell, Part 1](flight.md)
**Status**: landed
**Duration**: 2026-07-14 – 2026-07-15 (five legs; one HIGH-severity blocker
plus fix-cycle; flight-end review clean, no fix cycle)
**Legs Completed**: 5 of 5

## Outcome Assessment

### Objectives Achieved

The single-window shell is a window registry. Per-window chrome/tab state,
three named routing classes enforced site-by-site across a fresh ~30-site
census, and a lifecycle split where closing one of N windows never quits and
closing the last does. "Move to new window" landed as the first cross-window
operation, re-parenting the LIVE guest view — the page keeps its state, with
address, cookie jar, and navigation history intact and the same `wcId`
adopted in the target strip. The closed-tab stack went global-tagged with
whole-window capture at `close`. The 46-spec singular-window audit shipped as
committed F7 input.

Scope held: overlay MULTI-instance conversion, capture semantics, and
automation multi-window semantics stay in F7 — F6 ships a roaming-singleton
interim so a second window is fully usable. Nothing that was deferred leaked
into this flight, and nothing planned for this flight slipped out of it.

### Mission Criteria Advanced

- Tabs move into a new window with identity intact; the source strip closes
  ranks. First cross-window operation — F8's tear-off/drag lands on this
  shell.
- Multiple windows with correct lifecycle; each window has a fully functional
  strip, chrome, and menus.
- F5's deferred "move to new window" context-menu item closed here.

## What Went Well

**The spike gate paid for itself, and then some.** DD1 returned a hard GO
with margin, and every downstream decision cites a specific spike finding as
evidence rather than assuming one — DD5's primary path, DD7's roam-not-
recreate, DD8's accessor. The close-and-recreate fallback stayed dormant, but
that is what cheap insurance looks like: the flight was shippable regardless
of the spike's verdict. The spike also discovered that WSLg's focus APIs are
effectively broken — which is why DD8's last-focused accessor is load-bearing
rather than a nicety.

**Design review caught real design gaps before code existed.** Pass 1 found
DD2 missing its third routing class entirely, DD7's find-overlay having no
closure seam (the AC's original wording pattern-matched a construction that
didn't exist), and DD8 resting on a focused-window accessor that WSLg would
have made untestable. Leg 4's own review surfaced three HIGHs — the adopt
readiness barrier, the payload shape, the re-parent geometry gap — each of
which would have shipped as a live cross-window bug.

**Risk-tiering worked exactly as designed.** Splitting leg 2 out at review
isolated the HIGH-risk state-machine conversion from leg 3's comparatively
mechanical stack tagging; leg 3 tiered LOW, skipped per-leg review, and
landed with zero deviations against its DDs. Worth stating plainly: the
flight's defining bug came out of the leg that got the *most* scrutiny, not
the one that got less. The triage logic is sound; what failed is the review
*method*, not the tiering (see Key Learnings).

**DD7's attachment tracking fixed a defect it wasn't sent to fix.** The
retrofit — record `{contentView, win}` at show, remove from *that* at
hide/teardown, never re-resolve — corrected a latent bug in the *pre-F6*
single-window manager, which already re-resolved at hide time. The interim
quietly improved code it didn't have to touch.

**Blocker discipline held.** The stop rule was honored — no mechanism was
improvised under pressure. Leg 4 stopped with implementation and every
feature check complete, and the hang was handed to a dedicated fix-cycle that
root-caused it properly.

**Debt was closed inside the flight.** The chrome-webContents leak was
flagged in leg 2, deferred deliberately, and actually fixed in leg 4
(`setImmediate` deferred destroy at `closed`, verified back to baseline).
Tracked, then closed — not just logged.

**Spec discipline distinguished conversion from change.** Leg 2's
"specs unmodified" invariant proved the conversion was behavior-identical.
Legs 3–4 then deliberately changed designed composition, and the FD ruled the
affected specs stale-by-design and updated them rather than re-running against
knowingly-stale Expected Results (which would have manufactured a false FAIL)
or silently passing them (worse). `multi-window-shell` got first-run
discipline: run 1 was product-green but surfaced three spec errata, errata
were folded, and a FULL fresh re-run returned 9/9 with no repairs.

## What Could Be Improved

### Process

**The spike asked nine questions and missed the one that mattered.** DD1
verified exhaustively that *guest* webContents and `navigationHistory` are
alive and readable at `close` and `closed` — but never asked the adjacent
question about the **container BaseWindow itself**: is `win.id` safely
readable from inside `win`'s own `closed` handler? That is the exact boundary
DD3's "closed: record removal" implementation had to cross, and the spike was
already instrumenting `close`/`closed` handlers on a throwaway harness, so it
was a natural next probe. The generalizable form: *for every handler
registered on a `close`/`closed`-emitting native object, what does the handler
read from the emitter, and is that read valid given the emitter's own
destruction timing?*

**Prose review cannot catch implementation-fidelity defects.** All three
review passes (flight ×2, leg-2 ×2) operate on intent before code exists.
DD3 says "closed: record removal only" — which says nothing about how the
record is keyed or what the handler reads to key it. Every finding those
reviews produced (F1–F9, H1–H3, M1–M5) is in the "design is incomplete"
register. "Line 1209 will throw" is not reachable from that register. This is
a structural limit, not a competence gap, and it means the flight-end code
review is the layer actually positioned for this class — currently one broad
pass at the very end of a two-day flight.

**A Deviations entry went stale and nobody revisited it.** It records main.js
at "+~170 lines, 2994 → 3166" from leg 2; the landed file is 3461. Legs 3–4
added their own main.js growth and the entry was never updated. Deviations
entries written mid-flight need a flight-end truing pass.

### Technical

**main.js is now the file that renderer.js was when we scheduled its split.**
main.js grew 2994 → 3461 (+467, ~15.6%) against a leg-2 goal of holding flat
via the registry extraction; renderer.js grew 3768 → 3923 (accurately
predicted at ~100–150). renderer.js's split was deferred to a post-mission
maintenance flight — the right call, since bundling it into the mission's two
highest-risk flights would compound risk — but main.js at 3461 is now larger
than the 3768-line renderer was when *its* size triggered a scheduled split,
and main.js never had a numeric growth target at all. It needs its own split
assessment, on the same footing as the renderer's.

**The debt lives exactly where the tests can't go.** DD2's "pure where
practicable; Electron wiring stays in main.js" is a sound trade, but it means
all lifecycle-timing correctness sits in the one layer structurally exempt
from unit tests. The headline bug is a direct, concrete cost of that split —
`window-registry.js` is pure and well-tested and never touches a live
`BaseWindow`; the defect was in the wiring that calls it. The corollary the
project should adopt: the wiring boundary needs *disproportionate* live-smoke
coverage precisely because it is unit-test-exempt.

**Interim debt, carried deliberately**: DD7's roaming-singleton overlay and
DD8's accessor are both explicitly F7's to convert. `kebab-menu.md` remains
STALE-ENUMERATION (pre-existing drift from a pre-F6 flight, compounded by this
flight's new row) and owes a full-body refresh before its next run.

### Verification

**No smoke test closed a window until leg 4.** Legs 2 and 3 ran live MCP
smoke sessions that exercised many IPC paths, but teardown was always a
targeted kill by pid — never the app's own `win.close()`. So the exact
lifecycle sequence leg 2 restructured went unexercised end-to-end for two
legs, on the flight's HIGH-risk M05-scale conversion. None of the leg-2
regression triple closes a window in its normal flow either. The verification
design implicitly treated "does closing a window still work" as incidental on
precisely the leg where that assumption was least warranted. Deferring the
full `close-one-of-N` spec to leg 5 was defensible sequencing; the absence of
even a crude "call the real close IPC and confirm the process doesn't hang"
check during legs 2–3 was not.

**The bug's only observable is process liveness.** Zero error output
anywhere — the throw happens inside a native→JS emission Electron swallows.
No console line, no exception, no rejected promise for any unit, a11y, or
behavior test to observe. The discriminating signals the fix-cycle actually
used (pid liveness, "does the MCP endpoint still answer", the dead chrome
refused as `no-such-contents`) are behavior-test observables by nature. It is
now pinned — `multi-window-shell` step 7 drives the real sender-resolved IPC
and polls liveness — but reactively, after the fact.

### Documentation

CLAUDE.md (window-registry architecture, the three routing classes, the
lifecycle split, and the destroyed-window rule), README (New Window, Move to
new window), and docs/mcp-automation.md (interim focused-window note) were all
refreshed and independently verified accurate against the code, including
spot-checked line references. Nothing missing was found. Open doc debt is
`kebab-menu.md`'s stale enumeration and the `ERR_ABORTED` expected count owed
to `multi-window-shell` step 8.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| `classifyContents` widening touched four files beyond leg 2's list | An identity-compare against ONE injected chrome cannot recognize N chromes — a necessary consequence of a correct call, not scope creep | Yes — census-driven predicate threading is the pattern |
| main.js grew (+467) instead of holding flat | Registry extraction didn't offset legs 3–4 wiring growth; no numeric target was ever set | No — schedule the split instead, and set targets |
| `getActiveTabContents` deleted from main.js | Dead once the accessor changed | Yes — retire dead accessors in lockstep |
| Leg 3 extracted two pure modules beyond its file list | The house pure-module pattern applied on sight | Yes — already the convention; applied 4× this flight |
| FD ruled two ACTIVE specs stale-by-design and updated them | Legs 3–4 changed designed composition; re-running against knowingly-stale Expected Results manufactures false FAILs | Yes — the conversion-vs-change distinction is the rule |
| Leg 4 stopped at the blocker rather than improvising a mechanism | Stop rule | Yes — it worked; the fix-cycle then root-caused it properly |

## Key Learnings

**"No exception thrown" ≠ "event loop alive."** This is a sibling to the
project's existing native-surface invariant, "DOM correct ≠ render correct" —
and it deserves the same standing. A throw inside a native→JS callback can be
swallowed whole, taking the process with it and leaving no trace in any log.

**The forensics were correct and still pointed the wrong way.** All seven of
leg 4's exclusions were true — close-handler body, teardown suite, framing,
platform, apparatus were all genuinely innocent. The no-op *close*-handler run
still hung because the defect was in the *closed* handler, and the throw
itself manufactured the "`closed` never fires" evidence by aborting the
listener chain before any late-registered breadcrumb could observe it. A
defect that fabricates evidence against its own location will defeat
exclusion-based debugging; what broke the deadlock was differential bisect
against a control worktree at HEAD — a technique this flight used twice
successfully (also for the stray-tab anomaly triage) and which is worth
codifying by name.

**A rule is not enough — make the class unrepresentable.** The Decisions
section now codifies "never dereference `win.*` inside `closed`-or-later
handlers." But the registry's API was *already* correct — `remove(winId)`
takes a primitive, not a window object. The gap was never the registry's
design; it was the raw-Electron-event boundary that calls it. A wrapper that
captures at registration time, while the window is alive, and hands the
callback only primitives makes the mistake unwritable rather than merely
forbidden:

```js
function onWindowClosed(win, handler) {
  const id = win.id;            // captured while alive
  win.on('closed', () => handler(id));   // `win` never reaches the handler
}
```

This rule has already slipped past a two-pass flight review, a two-pass leg
review, a full unit suite, and three passing behavior specs — once. F7 adds
*more* per-window lifecycle surface (N-multiplied overlay show/hide/teardown),
so there is no structural reason to expect prose-rule adherence to hold better
next time, particularly under agent-driven implementation where this rule
competes with a long list of other house rules.

**Targeted-kill teardown is a smoke-rig shortcut that hides the lifecycle
surface.** Fine for speed; proven to conceal exactly what two consecutive
HIGH-risk legs were built around.

**Test metrics — wall-clock flat, count reconciles exactly.** 1715/1715 pass,
13 suites, 0 fail / 0 skipped / 0 todo, ~1.11s internal duration, no flakes.
That is +69 tests against F5's 1646, attributable leg by leg: leg 2 +13, leg 3
+20, leg 4 +36, leg 5 +0 — reconciles to the line. Wall-clock has now held in
the ~1.1s band across F4 (1640), F5 (1646), and F6 (1715); the heavy suites
re-timed consistent with F5 (`automation-mcp-server` 809ms vs ~846ms,
`downloads-store` 613ms vs ~593ms, `history-store` 408ms vs ~506ms — run-to-run
variance, not regression), and every new suite this flight is sub-100ms. This
independently corroborates the M06 F3 finding that Node process-startup across
~73 files dominates wall-clock, not test count.

## Recommendations

1. **Land the `onWindowClosed`-style wrapper, plus a lint check, before or
   during F7.** The wrapper makes the class unrepresentable; an ESLint
   `no-restricted-syntax` selector matching `win.*` member access inside a
   `.on('closed', …)` body catches violations where the wrapper isn't used.
   The wrapper is the primary mitigation and the lint is the complement — the
   lint alone is defeatable by indirection through a helper, and the current
   prose rule alone has already been proven insufficient. Keep the rule as the
   interim code-review checklist item, not the permanent solution.
2. **Any leg whose DDs or ACs touch a native `close`/`closed`-class event must
   exercise one real close through the app's own path in its OWN smoke
   checklist** — not deferred to a later leg's spec. Extend the existing
   leg-design apparatus-premise habit (already used for keyboard/pointer) with
   the question: *does this leg's surface include closing or destroying
   something?*
3. **F7 starts from the audit doc, not a re-derived sweep.**
   `docs/behavior-specs-single-window-audit.md` already enumerates the five
   decisions F7 owes (enumerateTabs scope, getChromeTarget arity, captureWindow
   discriminator, overlay discovery, foreground-to-act restatement) against
   the specs each affects. F7 should also: extend DD7's proven
   attachment-tracking pattern rather than re-deriving it; KEEP DD8's
   membership-validated last-focused accessor as the ownerless default (WSLg
   focus poisoning is a platform fact, not an F6 artifact); and timeout-guard
   any capture that can race a re-parent (leg-1's `capturePage`-never-resolves
   finding).
4. **Schedule the main.js split assessment alongside the renderer's** in the
   post-mission maintenance flight, with explicit numeric targets for both.
   main.js has now passed the size that triggered the renderer's split and has
   never had a target.
5. **Mission debrief carries** (methodology, for `/mission-debrief`): prose
   design review's structural blindness to implementation-fidelity defects —
   consider whether HIGH-risk legs touching native lifecycle warrant a
   lightweight code-level pass immediately after landing rather than only at
   flight end; differential-bisect-against-HEAD-control-worktree as a named
   technique; the pure-module/wiring-boundary pattern with its
   disproportionate-smoke corollary; Executors bracket boot state before any
   setup lull; executor key hygiene (env-var reference only, never a command
   literal); flight-end truing pass for mid-flight Deviations entries.

## Action Items

- [ ] `onWindowClosed` wrapper + ESLint `no-restricted-syntax` check for
      destroyed-window derefs (F7 leg 0 or maintenance flight).
- [ ] F7 design: read the audit doc first; the five owed decisions; roaming
      singleton → per-window instances; capture timeout guard; keep DD8's
      accessor.
- [ ] Adopt the real-close smoke step + the "does this leg close/destroy
      something?" leg-design question.
- [ ] `kebab-menu.md` full-body enumeration refresh — owed BEFORE its next
      run (currently header-annotated STALE-ENUMERATION).
- [ ] `multi-window-shell` step 8: codify the expected `navigationHistory.restore
      rejected: ERR_ABORTED` count (deterministic, once per run, end states
      correct — benign-with-carry; HAT eye).
- [ ] Tooling note: the port-pin "in use despite ss-free" launch-script quirk
      (2/2 reproducible).
- [ ] Maintenance flight: main.js + renderer.js split assessment with numeric
      targets.
- [ ] Mission debrief: the methodology carries in Recommendation 5.
