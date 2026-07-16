# Flight Log: Tear-off and Cross-Window Drag

**Flight**: [08-tearoff-cross-window-drag](./flight.md)
**Mission**: [First-Class Tab Management](../../mission.md)

## Summary

_(Flight in planning — recon complete; spec design-reviewed ×2 and `approve with changes` applied; ready to execute.)_

> **Log hygiene note (F7 debrief carry).** F7's Summary line read "flight in planning"
> for the *entire flight* and was only corrected at flight end. This line is updated at
> each phase transition, not at landing.

---

## Reconnaissance Report

> ### ⚠️ CORRECTION BLOCK — read before trusting any citation below
>
> **Design review pass 1 audited every citation in this report and the spec. ~20 of ~60
> line citations are stale or wrong; two `electron.d.ts` quotes were invented; three
> counts are wrong; one headline claim is inverted.** The report's **reasoning and
> behavioral claims held up almost entirely** — the failures are concentrated in the
> **instruments**.
>
> **This body is NOT rewritten.** An inspection record is a snapshot; rewriting it would
> destroy the evidence of how the errors entered. Corrections are listed here and the
> **spec is authoritative**.
>
> | Claim below | Correction (verified at source) |
> |---|---|
> | B1: "kills mission transport candidates **1 and 3**" | **INVERTED.** The mission's candidates are *pointer tracking + IPC handshake* / *HTML5 drag + custom MIME* / *screen-coordinate hit-testing on drop*. **DD1 IS the first; DD3 IS the third.** F8 forecloses the **HTML5-drag** one. What the probe kills is the **main-side `screen` module as a coordinate source** — a sub-mechanism, not a candidate. **The mission never numbers them**: "1 and 3" is an ordinal invented over prose — the enumeration-over-proxy failure this flight exists to prosecute. |
> | B4/A-notes: the windowId boundary at `window-census.js:79-81` | **WRONG FILE, cited 3× in the draft spec.** The sentence lives at **`main.js:270`** and **`automation/tabs.js:63`**. `window-census.js:79-81` is about `lastFocused` fallback. Worse: **`window-census.js` EMITS `windowId`** on every census row. And it is an **AUTHORITY** rule (anti-double-count in census aggregation), **not confidentiality** — `tab-move-to-new-window` already returns `{ok, windowId}` **to the chrome renderer**, and `renderer-globals.d.ts` declares it. → DD8 reversed. |
> | B5: three cancelDrag paths at `:1495`, `:3783`, `:3812` | **All three wrong, and the set is incomplete.** `:1495` is the **Escape** handler; resize is `:1500`. Real `cancelDrag()` call sites: **seven** — `createTab` (`:1251`), pointercancel (`:1487`), Escape (`:1495`), resize (`:1500`), `closeTab` (`:1505`), `adopt-tab` (`:3781`), `tab-moved-away` (`:3815`). *(verified 2026-07-15)* |
> | B6: "bare `null` for **5** distinct reasons" | **4 `return null` sites** (`!source`, `!p`, the 3-condition entry guard, `size<=1`) carrying **6 conditions**. Two cited lines were `const` assignments. |
> | B4: "`Ctrl+N` = a new **empty** window" | **FALSE.** `createWindow()` defaults `noBootTab = false` → it **boots a home tab**. The conclusion (Ctrl+N doesn't *move* a tab) survives; the premise doesn't. |
> | B1: `electron.d.ts` "Not supported on Wayland (Linux)" for the DIP converters | **FABRICATED QUOTE** — *and this correction was itself wrong; re-corrected at pass 2.* **`screenToDipPoint`** says it **returns the point passed in with no changes** (*identity degradation* — which fits the silent-failure thesis **better** than the invented quote). **`dipToScreenPoint` says only "Not currently supported on Wayland" — no identity clause**; its Wayland behavior is **undocumented**, and the spec no longer guesses. Also: *"Not supported on Wayland (Linux)"* occurs **6 times** in `electron.d.ts`; "only `getCursorScreenPoint` carries that phrase" is true only **within the `screen` interface**. **This is the third recursion of the pattern in this lineage: a fabricated quote, convicted by a correction that fabricated a different one.** |
> | B12: `main.js:2767-2768` = the `focus()`/`noteFocus` pair | **`:2766`.** Dangerous: `raiseWindowForTab` contains the **identical pair**, so a reader concludes the handler routes through the helper — **it inlines**. Any change to raise semantics made in the helper silently misses the move path. |
> | "`grep -n "F8" src/main/main.js` → **16** hits" | **17.** And "zero signal" overstates — two are real ordering pins. "None about **this** invariant" is correct. |
> | A3: all three stale-header specs read *"First run of this spec (was: never)"* | **Only two.** `page-context-menu` reads *"First run of this **draft** spec on native `WebContentsView`"* and is **`partial`**, not pass. **A uniform quote asserted over a non-uniform set — proxy substitution committed in the paragraph convicting the debrief of proxy substitution.** The AC27 numbers are all correct; the quote is not. |
> | A3/DD12: "the five specs" as the universe | **The set itself was a proxy.** `b2d3afc` re-pointed **14** specs; **12** have no post-F7 run. The debrief's five was its **leg-1 deferral subset**. The draft corrected the list's *membership* while accepting its *derivation* — **the same substitution, one level up.** → DD12 re-derived. |
> | A6: the leaked wrapper is 2 lines in `legs/02` | **Three more instances**, unrecorded: `missions/03-automation-surface/flights/08-production-gating-and-isolation/flight.md:181-182` and `.../flight-log.md:155`. → the scan is vindicated beyond its own claim. |
> | "`maskComments`+`findMatchingBracket` duplicated **verbatim**" | `findMatchingBracket` is byte-identical; `maskComments` is **code-identical, text-divergent**. Extraction premise survives; "verbatim" was unverified. |
> | B2 `renderer.js:1358`; B9 "a **constant** ~16/10px **matching** M05 F8's ~11-17px" | Typedef is `:1360`. B9's 10px falls **outside** 11-17, and "constant" is asserted from a **single probe**. Substance (no `startY`; the margin exists) holds. |
> | DD7's serialization hazard | **Real but inert here** — the adopt payload has no array and no Map, and under `payload.index === undefined` both serializations read identically. "Rigor-shaped, not rigorous." → DD7 now names the discriminator. |

Two independent recon passes ran before any spec text existed: one verifying the **F7
debrief's action items** against current code (Phase 1b), one **interrogating the code
surface** F8 must build on. Both are read-only. Both found the upstream artifact wrong
in ways that change F8's design.

### Part A — F7 debrief action items (Phase 1b classification)

| # | Item | Classification | Evidence | Recommendation |
|---|------|---------------|----------|----------------|
| A1 | DD1 sync delete/set invariant | **confirmed-live** (all 3 sub-points) | (a) `grep -n "synchron" src/main/main.js` → 12 hits, **none at the handler**; the comment at `main.js:2752-2755` describes mechanics only. (b) **No test requires `main.js`** (`grep -rl "require.*main/main" test/` → 0); `move-tab-payload.test.js` covers only the pure validator. (c) `main.js:2711` — `ipcMain.handle('tab-move-to-new-window', (event, payload) => {` is **sync**, zero `await`/`async` in body `2711-2782`; pair at **`2756-2757`** | Leg 1. Venue already exists — see A-notes |
| A2 | Leg 2's AC7 | **confirmed-live** | `grep -c "require('electron')" src/main/capture-timeout.js` → **`1`**. Match is `capture-timeout.js:20`, a **comment**: `// ELECTRON-FREE by construction (no require('electron')):`. AC checked `[x]` at `legs/02-live-defect-fixes.md:145` claiming "→ **0**" | Leg 1. Not satisfiable naively — mask comments |
| A3 | AC27 — the five specs | **drifted — DEBRIEF WRONG** | All 5 specs and their `runs/` dirs exist **with genuine run logs**. "3 have never run" is true only of stale `Last Run:` **headers** | Leg 6, re-scoped — see A-notes |
| A4 | `multi-window-shell` folded errata | **already-satisfied** (folding) / **confirmed-live** (re-run) | Both folded: `multi-window-shell.md:198`+`:204` now read `evaluate(T2/R2, "history.length")`; V1 at `:253` names sheet wcIds. Header `:6-9` = `partial`, names the owed re-run | Leg 6. Spec text needs no edit |
| A5 | `renderer.js` kebab count | **confirmed-live**; cited lines **accurate** | `renderer.js:250` `// APG menu-button: role="menu" popup with four static role="menuitem" items` / `:251` `// (Settings, Downloads, Print…, Exit)`. `kebabModel` `:385-392` → **6** ids: `new-window, settings, downloads, jars, print, exit` | Leg 1. Missing: `new-window`, `jars` |
| A6 | Leaked tool-call wrapper | **confirmed-live** | `legs/02-live-defect-fixes.md` is 673 lines; `:672` = `</content>`, `:673` = `</invoke>` | Leg 1. Delete 2 lines |
| A7 | DD7 blur gap | **needs-human-recheck** | Ruling rests on **two independent** premises (`flight-log.md:1066-1076`; `multi-window-automation.md:137-147`). F8 defeats **premise 1 only** | Leg 2 spike verdict V7 — see A-notes |
| A8 | `getAttachedWindow`/`crossWindow` | **confirmed-live**; **zero production call sites** | `getAttachedWindow` defined `menu-overlay-manager.js:343`; `grep -c getAttachedWindow src/main/main.js` → **`0`**; kept alive by 5 assertions in `menu-overlay-manager.test.js:686,696,734,770,776`. `crossWindow`: 3 sites, all internal (`:248,262,275`) | **Not F8.** Maintenance — see A-notes |
| A9 | `wc -l src/main/main.js` | **already-satisfied** (number accurate) | **3517** | Per-leg budgets set off 3517 (DD11) |

#### A-notes — where the debrief is wrong, and where it is righter than it knows

**A3 is the flight's first finding, and it is an instance of F7's own root cause.**
The debrief asserts *"3 have never run at all."* **Every one of the five has a genuine
run log on disk.** Exactly three specs carry `Last Run: never` **headers** —
`internal-tab-menus`, `page-context-menu`, `tab-surface-geometry` — and each of those
three has a real 2026-07-08 run log whose Summary reads *"First run of this spec (was:
never)."* The run happened; the header was never updated.

> The debrief consulted the **header** (a proxy) instead of the **`runs/` directory**
> (the artifact) — **the exact proxy substitution it diagnoses, committed in the
> section that diagnoses it.** F7's unifying rule applies to itself: a `Last Run:`
> header reads `never` whether or not the spec ran. Discrimination zero.

`kebab-menu` proves headers drift generally: its header says `2026-06-07-10-42-52`,
but two later logs exist (`2026-06-16` pass, `2026-07-08` **partial**).

**And the list of five is wrong.** `tab-surface-geometry` was **never re-pointed**:
`git show --stat b2d3afc -- tests/behavior/tab-surface-geometry.md` → **empty**;
`grep -c enumerateWindows` → **0**; last touched `30387ea` (2026-07-08, F5). **Only
four specs were re-pointed.** The fifth was listed by association.

The accurate statement is the flight log's own, at `flight-log.md:2001`: *"their
`Last Run` headers are all pre-F7."*

> **0 of 5 have never run. 5 of 5 have no post-F7 run. 4 of 5 were re-pointed.**

This is what AC27 actually owes, and it is what DD12 scopes.

**A1 — the pin the debrief says always drifts is, right now, accurate.**
`main.js:2756-2757` **is** exactly the delete/set pair, because `git diff b2d3afc..HEAD
-- src/main/main.js` is **empty** — main.js is byte-unchanged since F7 landed. **This
is a trap, not a reprieve**: the first F8 edit above line 2756 re-drifts it. It is also
the precise reason leg 1 lands before any leg that edits main.js.

Related: `grep -n "F8" src/main/main.js` → **16 hits, none about this invariant** (all
M05/M06-era flight 8s: menu overlay sheet, DD4/DD5/DD12). An F8 implementer grepping
`F8` gets 16 false positives and zero signal. The pin must anchor on the handler's
**string literal**, never a line number and never a flight tag.

**A1 + A2 share a ready-made venue, already in the repo.**
`test/unit/broadcast-invariant.test.js` (M06 F4 L1) and
`test/unit/window-closed-invariant.test.js` (M09 F7 L1) are self-deriving **source-scan**
tests over `src/main/**` that extract handler bodies bracket-balanced **from the
registration site**, and — decisively — `maskComments()` the source before any regex
(`broadcast-invariant.test.js:69`, `window-closed-invariant.test.js:66`). That is
simultaneously the synchrony pin's natural shape **and** AC7's exact fix, already
written and passing.

The masked-grep discrimination was measured **in both directions**: `observe.js:16` is
a **comment** (`// ELECTRON-FREE at top (no require('electron')):`), `engine.js:7` is
**code** (`const { webContents, session } = require('electron');`). Naive `grep -c`
reads **1 on both** — discrimination **zero**. Masking splits them **0 / 1**.
`capture-timeout.js:20` is a comment, so masked → **0**, and AC7 becomes true as
written.

> **Caveat that makes leg 1 a refactor, not an addition**: `maskComments` +
> `findMatchingBracket` are **duplicated verbatim across the two test files**, not
> shared. An F8 synchrony pin would be **copy #3**. Extract to a test helper first.

**A7 — the accepted-gap ruling rests on TWO independent premises; F8 defeats one.**

1. **Structural**: guarded and unguarded forms are behaviorally identical in a
   single-window rig — *"there is no third case with one window"*
   (`flight-log.md:1069-1071`). No single-window run can distinguish them **even on a
   platform that delivered real blur**.
2. **Platform**: *"WSLg delivers no OS blur **to a scripted stimulus**"* (F6 spike
   verdict 4), and WSLg is the operator's only desktop.

F8's two-window open handoff demolishes **premise 1 only**. Premise 2 is independent
and still binding. So cross-window drag does **not** automatically make the gap
rig-reachable. The open question is narrow and empirical → spike verdict **V7**.

> **The debrief's gloss drops a load-bearing qualifier.** Its deviation table reads
> *"WSLg has no OS blur, and it's the only desktop"* — dropping **"to a scripted
> stimulus"**, which the flight log carries at both `:1072` and `:1415`. The gloss
> reads platform-permanent; the underlying verdict is narrower, and
> `flight-log.md:1414-1416` explicitly speculates a real human alt-tab *would* deliver
> blur. **Inheriting the gloss is the error the debrief warns against.**

**A8 — retirement is cleanly sized and the code is already structurally dead.**
`createMenuOverlayManager` is called once per window (`main.js:1143`), stored at
`record.sheet` (`:1186`). The **only** `openMenu` call site is `main.js:562`:
`rec.sheet.openMenu(payload, { contentView: rec.win.contentView, win: rec.win, bounds })`
— an instance is **always** handed its own window's contentView. So
`attachment.contentView !== nextAtt.contentView` (`:248`) is **always false**: the
`if (crossWindow && visible && view)` branch at `:262` is **unreachable**, and
`!wasOpen || crossWindow` at `:275` reduces to `!wasOpen`. `getAttachedWindow` is
production-dead (0 main.js reads), kept alive **only by its own 5 unit assertions** —
the "green tests over unreachable code" convergence named at `flight-log.md:1420`.

**Ruled out of F8** (DD13): retiring it deletes the tests that make the blur gap *look*
covered, so it must be paired with V7's ruling — not done silently, and not by a flight
whose hands are already full.

### Part B — code interrogation (the surface F8 builds on)

Fourteen surprises, ranked by cost-if-missed. Every claim below was read from source or
probed live; none is inferred from a name (F7 recommendation 3).

1. **`screen.getCursorScreenPoint()` returns `{x:0, y:0}` — silently, always, never
   throws** on this project's canonical Wayland dev rig. Probed live on Electron
   42.6.1 + `--ozone-platform=wayland`. `screenToDipPoint`/`dipToScreenPoint` are
   **identity pass-throughs**. The shipped typings say so (`electron.d.ts:11953`,
   `:11975`, `:11933`) — *"Not supported on Wayland (Linux)."*
   **This kills the mission's transport candidates 1 and 3** (`mission.md:219-222`) and
   is this codebase's own **S1 silent-success failure class**: a plausible-looking
   `Point`, passing naive unit tests, wrong 100% of the time live.
   **Mitigation proven**: renderer-side `window.screenX + e.clientX` is globally
   consistent across windows — two windows moved by the same delta reported
   `delta_renderer === delta_main` = `[1100,600]`.
2. **The F2 drag has no Y-axis and no boundary logic whatsoever.** `drag` carries
   `startX` and **no `startY`** (`renderer.js:1358`); the threshold is `Math.abs(dx)`
   (`:1457-1460`); `dropIndexFromPointer(slotRects, pointerX, draggedIndex)`
   (`tab-order.js:107`) takes **one scalar**. Drag 4000px down → same index as 0px.
   **"Beyond the strip" does not exist even in embryo**, and the pure model has no
   place to put it without a signature change.
3. **The behavior-test apparatus cannot drive a cross-window drag.**
   `dragEvents(from,to,steps)` (`input.js:172`) → `actOn(wcId, events, deps)` (`:228`)
   → `wc.sendInputEvent(ev)` (`:241`) — synthetic events into **ONE webContents**.
   The mission marks cross-window drag *"(behavior-test-backed)"* (`mission.md:128-130`)
   — **that premise does not hold today.** → DD9.
4. **No keyboard equivalent for move-to-new-window exists. None.** `Ctrl+N` =
   `new-window` = a new **empty** window (`keydown-action.js:107` → `main.js:2431`).
   Zero move bindings in `keydown-action.js` / `sheet-accelerator.js`. **F6 shipped
   move-to-new-window pointer/menu-only — the mission's keyboard-parity constraint was
   not applied to it.** And **no "move to window N" concept exists anywhere** — no
   numbering, no picker, no targeting. It collides with F7's deliberate boundary: the
   renderer *"is authoritative only for url/title/jarId and **NEVER learns
   windowId**"* (`window-census.js:79-81`). → DD3, DD8.
5. **`adopt-tab` and `tab-moved-away` both call `cancelDrag()` on arrival**
   (`renderer.js:3783`, `:3812`), and `window.addEventListener('resize', () => { if
   (drag) cancelDrag(); })` (`:1495`) cancels too. **The existing move plumbing
   actively destroys live drags** — a cross-window drop routed through these channels
   kills the gesture that caused it. → DD6.
6. **`tab-move-to-new-window` hard-refuses the two cases tear-off most needs**:
   `source.tabViews.size <= 1` (`main.js:2722`) refuses the sole-tab move;
   `entry.trusted` (`:2721`) refuses internal tabs. Returns **bare `null` for 5 distinct
   reasons** (`:2712/2714/2721/2722`) vs `{ok:true, windowId}` on success — and the
   renderer **ignores the return entirely** (`renderer.js:708`). Correct for a *menu
   item* that can be omitted (`tab-context-model.js:64` omits at `isLastTab`);
   **undefined behavior for a drag, which cannot be omitted** — the user physically
   performs it and must get a defined outcome. → DD5.
7. **`adopt-tab` carries no index; the target always appends and activates**
   (`renderer.js:3801`, `buildStripRecord`). **Drop-at-position-N is unrepresentable**
   in the current payload — the wire shape must widen, not just be called. → DD7.
8. **`createWindow` has no position option** (`main.js:1018` — only `contentSize` and
   `noBootTab`), and the handler never positions the new window. **"New window appears
   at the cursor" has zero support.** `setPosition`/`getPosition` **do work here**
   (probed: `[880,420]`, honored, `'move'` fires) but **contradict the shipped
   typings**, which say they must not on Wayland (`electron.d.ts:2845` — *"On Wayland,
   this method will return `[0,0]`"*). Almost certainly WSLg-RAIL-specific (each window
   is a real Win32 window). **Do not generalize beyond WSLg.** → DD4, V4/V6.
9. **Renderer `screenX` and main `getPosition` disagree by a constant ~16px/~10px CSD
   shadow margin** (probed: `84,90` vs `100,100`) — matching M05 F8's logged *"~11-17px
   wayland shadow margin"* (`missions/05-.../08-menu-overlay-sheet/flight-log.md:1409`).
   **Any design mixing main-side and renderer-side coordinates is silently off by the
   margin.** → DD1 (single coordinate authority).
10. **Jar identity is preserved by the LIVE RE-PARENT, not by the payload.**
    `main.js:2747-2748` — same `webContents`, same session/partition. The payload's
    `container.partition` only rebuilds the renderer-side **pill**. A designer reading
    the wire shape would think jar identity travels in it; **it does not**. Corollary:
    **the mission's destroy-and-recreate fallback (`mission.md:214-217`) would LOSE jar
    identity** — it is effectively foreclosed for F8. → DD2.
11. **The registry field is `sheet`, not `menuOverlay`** (`window-registry.js:35-45`,
    nine fields), and **both `sheet` and `findOverlay` can be null on a LIVE record**
    (nulled at `close`, record removed at `closed`). Every F8 read must be null-tolerant.
12. **Programmatic `win.focus()` fires no focus event under WSLg** — every raise pairs
    with `registry.noteFocus(id)` (`main.js:2767-2768`, `raiseWindowForTab` `:299-305`).
    And **`lastFocused` ≠ `focused`**: `window-census.js:83-87` refuses the OS-focus
    claim deliberately. **F8 cannot ask "which window is the pointer over?" via focus** —
    the codebase has no OS-focus truth.
13. **`sheet-accelerator.js` hand-mirrors `keydown-action.js`** — an explicit LOCKSTEP
    PIN (`keydown-action.js:105-106`, mirrored `sheet-accelerator.js:106-110`). Every
    F8 chord lands in **both** files in the same change. Also: **`Ctrl+Shift+N` is
    deliberately unassigned** (Chrome's incognito chord, `keydown-action.js:104`) — the
    obvious tear-off chord is **pre-refused**.
14. **`#tabstrip-drag` (`index.html:29`, `styles.css:162`) is a `flex:1` spacer
    inheriting the strip's `-webkit-app-region: drag`** — an **OS window-move region a
    torn-off tab must cross**, and OS drag regions do not deliver pointer events to the
    renderer. Tabs themselves are correctly `no-drag` (`styles.css:59-62`) — the
    mission is verified correct on that point (`mission.md:88-91`).

Apparatus fact worth carrying (`tests/behavior/tab-reorder.md:51`): *"A live drag also
holds `e.buttons === 0` on every `pointermove` after the down"* — **any F8 handler
gating on `e.buttons` will not fire under test.**

---

## Flight Director Notes

### Recon rulings (pre-spec)

- **Both recon passes are adopted in full.** Neither was asked to fix anything and
  neither did; the tree was clean at both exits.
- **The Part-A A3 finding is promoted to a Key Learning candidate for the debrief.**
  The F7 debrief committing proxy substitution *in the section diagnosing proxy
  substitution* is the strongest available evidence for that debrief's own thesis, and
  it was found by applying that thesis. Recorded here at recon time so the debrief
  cannot claim it as a discovery of its own.
- **A8 (`getAttachedWindow` retirement) is ruled OUT of F8**, against the debrief's
  suggestion that it is "maintenance." It is maintenance — but retiring it deletes the
  five tests that make the DD7 blur gap *look* covered, so it is coupled to V7's
  verdict. F8 records the coupling (DD13) and hands both to maintenance with the
  coupling named. Doing it here would be scope creep into a flight already at its
  upper leg bound.
- **The `screen`-module finding (B1) is treated as SETTLED EVIDENCE, not a hypothesis.**
  It was probed live on this rig with recorded values, which is the premise-audit the
  `/flight` skill requires before locking a DD on an empirical premise. V3 re-confirms
  it inside the flight's own rig rather than trusting a recon transcript — but DD1 does
  not wait on V3 to be written down.
- **F7 recommendation 5's new HIGH trigger is adopted**: *a leg that authors the
  flight's assertions is HIGH-risk.* That makes **leg 6 HIGH** even though it writes no
  product code. Under F7's tiering it would have been LOW ("just verification") — and
  F7's leg 4, which authored the `getHistory` gate, is exactly the leg that shipped the
  flight's worst defect.
- **The FD leaked a `</content>` tool-call wrapper into the tail of this very log while
  writing the recon report — item A6's exact defect, committed by the artifact that
  enumerates A6 as debt to scrub.** Caught on the next read and scrubbed before any
  commit. Recorded rather than quietly fixed: A6 was filed as a one-off cosmetic slip
  of leg 2's implementer, and it reproduced within an hour under a different author who
  had **just read the item**. It is not a slip; it is a **failure mode of the writing
  apparatus** (a long Write whose payload ends adjacent to its own closing tag), and
  knowing the author has read the warning does not prevent it. **Leg 1 therefore adds a
  repo-wide scan for leaked wrappers in `missions/**` rather than deleting two lines**
  — the scrub the debrief asked for would have left this instance live.

### Design Review Pass 1 — `needs rework` (5 high, 4 medium)

Two reviewers ran in parallel with different lenses: an **Architect** (design soundness,
state reachability, cache contracts, sizing) and an **adversarial fact-checker** (every
citation, count, and API claim against real source). **They converged independently on
DD8, the cancel paths, and the refusal count** — convergence from different lenses is
what made those findings unarguable rather than opinions.

**The finding that matters most is about the spec, not the design.** The reviewer's
summary: *"The artifact reasoned from source and then **wrote down proxies** — line
numbers, remembered quotes, prose counts — without re-reading them against the artifact.
Its own DD10 rule was applied to the code under test and **not to the instrument the
spec itself is made of.**"*

> **The FD wrote the spec's digest from the RECON TRANSCRIPT, not from the code. A recon
> report is a proxy for the source.** The recon agents cited `renderer.js:1495` for the
> resize→cancelDrag path; it is the Escape handler. The FD copied it, and then
> **instructed leg 3 to assert against it** — which would have produced a test that
> passes while pinning the wrong invariant, leaving the path DD6 actually needs unpinned.
> This is F7's root cause reproducing one level up, in the flight designed to prevent it,
> under an author who had just written the rule down.
>
> **Structural response, not a resolution:** the spec now **anchors on symbols and string
> literals, not line numbers** (the header convention). The rule leg 1 imposes on the
> DD1 pin is imposed on the spec that mandates it. Reducing the citation surface is the
> fix; "be more careful" is not.

**Design changes forced by the review** (each is a reversal, not a polish):

- **DD8 reversed — the ordinal machinery is deleted.** It protected a boundary that does
  not exist on this surface. The "renderer never learns windowId" sentence lives in
  `main.js`/`automation/tabs.js` (not `window-census.js`, cited 3× in the draft) and is
  an **authority** rule for census aggregation, not confidentiality. The chrome renderer
  is **already handed `windowId`** by the exact handler F8 is factoring, and
  `renderer-globals.d.ts` declares it. Worse, the scheme **manufactured the
  unreachability DD5 forbids**: resolving an ordinal at dispatch requires either
  rebuilding the list (a closed window shortens it → the ordinal silently means a
  *different* window — the mis-target it forbade) or retaining the map (**a cache**, which
  it also forbade). Echoing `windowId` makes refusal trivial: `registry.get()` → null.
- **DD5/DD6 were in direct contradiction, and the success path carried a real
  accessibility bug.** No cancel collision exists **today** only because `pointerup` is
  **fully synchronous** and nulls `drag` before any IPC reply lands. DD5's snap-back
  requires state to survive the round-trip → all **seven** cancel paths go live → and
  because the handler sends `tab-moved-away` **before it returns**, the source would fire
  `cancelDrag()` → `announceTabStatus('Move canceled')` **on a successful cross-window
  move**. A false screen-reader announcement, against the mission's
  extend-only-accessibility constraint. **`pendingDrop`, distinct from `drag`, is now the
  DD.** The FD would have shipped this.
- **DD15 added.** Recon flagged `#tabstrip-drag` (the OS window-move region a torn-off
  tab must cross) as surprise B14; **the spec referenced it zero times.** It is on the
  critical path and can corrupt DD1 silently: an OS window-move changes `window.screenX`
  **mid-gesture**, and fires `'move'`, not `'resize'` — so the existing resize guard never
  trips. → V8.
- **DD12 re-derived.** See the correction block: the draft corrected the debrief's list
  membership while accepting its derivation. 14 re-pointed, 12 unrun. **F8 runs 4 and
  names the other 11 with an owner (F10, which exists to walk them)** rather than
  pretending to a carry it cannot absorb.
- **DD6 gains transform-only as a constraint.** "Siblings close ranks" via width collapse
  would reflow the strip and silently invalidate the `slotRects` snapshot on
  drag-back-into-strip — wrong indices, no cancel, no error.
- **DD5's sole-tab ruling split per case.** The existing guard's "no-op window swap"
  rationale is true for tear-off and **false for cross-window adopt** (a real merge;
  Chrome does it). Both still refuse in F8 — but cross-window adopt now refuses on **its
  own stated ground** (it makes the source window's destruction an outcome of a drag,
  coupling the gesture to the quit-on-last chain), not by inheriting a rationale that
  doesn't apply.
- **DD7 corrected downward.** The serialization hazard is **real but inert here** — the
  payload has no array and no Map, and `payload.index === undefined` reads identically
  across both boundaries. The audit is kept (a negative result is a result, and F7
  recommendation 2 asks for the audit) but it now **names the discriminator** instead of
  dramatizing a hazard it never evaluated.
- **V1 must record `pointerup`, not just `pointermove`.** DD5 claims every outcome is
  defined; a **pointer-lost outcome** was missing. Broken capture → `drag` never clears →
  a stuck drag with the tab frozen mid-gesture.
- **The V1-negative adaptation overclaimed.** The draft said the keyboard path "satisfies
  the criterion's substance." The mission criterion reads *"A tab **dragged** …"* — the
  drag **is** the subject. Under V1-negative it goes **unsatisfied** and needs a
  mission-level re-opening, not only a HAT ruling.

**Rulings upheld against the review's own probing:**

- **Sizing: six legs, upheld.** Legs 2-5 are one mutually-entailed decision cluster, and
  the mission constraint *couples* leg 5 rather than bundling it. The reviewer's
  observation is the decisive one: **the FD's own proposed cut is exactly the V1-negative
  adaptation outcome**, already encoded as an empirical gate at leg 2 — so pre-cutting
  spends the option value of V1-positive for nothing.
- **Leg 1 HIGH: upheld, with the tier's real rationale supplied by the review.** Not
  "it's a refactor" — a subtly broken `maskComments` **passes vacuously**, silently
  retiring two architectural pins while staying green. The repo's highest-consequence
  failure shape.
- **Leg composition changed**: the artifact debt (wrapper scan, kebab comment, AC27
  record, stale headers) moved from leg 1 → leg 6. Leg 1 was six chores sharing an
  *origin* ("inherited debt"), not a decision. Both legs are now coherent slices; leg
  count unchanged.
- **Leg 5 downgraded HIGH → MEDIUM** once DD8 collapsed: it no longer crosses an
  architectural boundary.

**Credit where the method worked**: every substantive *behavioral* claim held under audit
— the sync handler, no `startY`, jar identity riding the live re-parent, `crossWindow`
unreachable, the nine registry fields, 3517 lines, and **both accusations against the F7
debrief**. The recon's reasoning was sound; only its instruments were not.

### Design Review Pass 2 — `approve with changes` (3 new high, 4 medium, 4 low)

**Disposition of pass 1's nine: 7 fixed, 1 fixed-but-introduced-a-new-issue, 1 NOT
fixed.** The reviewer verified each fix **at the artifact** rather than accepting the
rework's claims — DD8's reversal, the seven cancel sites, and DD12's re-derivation were
all independently re-derived from source.

**Leg 1 is GO and unblocked.** Every premise verified independently: `maskComments`
code-identical/text-divergent (diffed — two comment-only divergences), `findMatchingBracket`
byte-identical, `grep -c "F8"` → 17, `main.js` byte-unchanged since `b2d3afc`,
`capture-timeout.js:20` a comment. The changes below block **legs 3, 4, and 6 only**.

**The three new HIGH issues — all introduced by the rework:**

- **N1 — DD3's correctness rested on an unprobed API carrying the same documented
  failure the spec discussed only as cosmetic.** `getBounds()` — the hit-test mechanism —
  carries the **same Wayland `{x:0,y:0}` note** as `getPosition`. The spec cited that note
  for `getPosition`/`setPosition` (DD4, *cosmetic*) and never for `getBounds` (DD3,
  *correctness*). **Recon probed `getPosition`, not `getBounds`: the evidence for the
  primary mechanism was inference.**
  **And the named degradation was the wrong shape.** The documented failure makes every
  window report origin `{0,0}` → every in-bounds point resolves to the **first record** →
  **silent wrong-window adopt**. A false **positive**, uncovered by "resolves no window →
  tear-off", and squarely the S1 class the flight exists to prevent. Fixed: the
  identical-origins **refusal** guard (ruled: refuse, not degrade — a visible refusal
  beats a silent wrong-window adopt), and **V4 gains a third reading** — two windows at
  known-different positions must resolve to **different** records. The first two readings
  both pass under an all-`{0,0}` hit-test.
- **N2 — `pendingDrop` was an undeclared cache: the exact category error pass 1 hunted,
  arriving through the door the pass-1 fix opened.** DD6 stated as a *virtue* that no
  `cancelDrag()` path touches it — consequence: **nothing could ever clear it**, since all
  seven sites are gated `if (drag)` and `cancelDrag()` early-returns on `!drag`. And the
  reviewer found the sharp edge: `armDrag` snapshots via `getBoundingClientRect()`, **which
  includes CSS transforms** — so a persisted detach visual would make a second drag capture
  displaced rects and compute **silently wrong indices**, the identical failure DD6's
  transform-only constraint exists to prevent, reachable because a tear-off round-trips
  through `createWindow`. Fixed: `{dropSeq, tabId}`, **no visual state**, monotonic
  discard, strip-mutation invalidation, staleness made *unobservable* rather than
  time-bounded.
- **N3 — V5 was a gate in DD9's own text and appeared in neither the gate list nor the
  Adaptation Criteria.** Classic revised-vs-unrevised drift: the rewrite added V8 to
  Adaptation Criteria and never back-filled V5. Under V5-negative leg 6's spec cannot
  verify the cross-window half **at all** and the story collapses to HAT.

**The pass-1 issue that was NOT fixed — and the finding of this review:**

> **DD5's sole-tab cross-window rationale was factually false.** The draft refused the
> case because it *"makes the source window's destruction an outcome of a drag gesture,
> coupling the drag to the quit-on-last chain."* **That mechanism provably does not
> fire**: the source's `tab-moved-away` handler ends `if (next) activateTab(next); else
> createTab()` — an emptied strip **boots a fresh home tab**. There is no
> `tabViews.size === 0` → close anywhere in `main.js`; the quit chain is never engaged.
> **Pass 1 flagged this DD for inheriting an inapplicable rationale, and the rework
> replaced it with a false one.** The ruling (refuse) survives on the true ground — the
> source would boot an *unrequested* home tab, and source-window disposal on tab
> exhaustion is a separate design question — but the reason had to be **measured, not
> composed.**
>
> **This is the flight's pattern at its purest.** Told that a rationale was wrong, the FD
> supplied a *replacement* rationale with the same defect: plausible, unverified,
> composed from what sounded architecturally serious. **Being told your reason is wrong
> does not make the next reason right.** The correction of an unverified claim is a new
> claim, and it needs the same instrument.

**Two more instances of the same recursion, both caught here:**

- **The correction block's own `electron.d.ts` correction was wrong.** It convicted recon
  of a fabricated quote and then attributed to **both** DIP converters an identity clause
  only `screenToDipPoint` carries; `dipToScreenPoint`'s Wayland behavior is
  **undocumented**. **A fabricated quote, convicted by a correction that fabricated a
  different one.** Third recursion in this lineage.
- **DD12's "3 stale headers" was a residue of the universe DD12 had just rejected** — a
  count computed over the superseded five, whose membership had already shifted (recon's
  three included `tab-surface-geometry`, which DD12 itself establishes was never
  re-pointed; the real third is `foreground-to-act`). Repo-wide the number is **10**.
  **Re-deriving the universe while carrying a count computed over the old one** is the
  same substitution surviving its own correction. Leg 6's scrub is now repo-wide, and
  recon's A3 thesis is *stronger* at 10 than at 3.

**Rulings taken from the review:**

- **DD3 ambiguity → refuse, not degrade.** A typings-conformant platform loses
  cross-window drag with a **visible refusal**; the alternative is a silent wrong-window
  adopt. Product call, taken deliberately.
- **The detach visual does NOT persist across the round-trip.** `clearDragVisuals()` runs
  at `pointerup` as today; `commitTabMove` is simply not called for an out-of-strip drop,
  so the tab is already home and **a refusal is announced, not animated**. This resolves
  the reviewer's question 1 and is what defuses N2's transform hazard at the root rather
  than managing it.
- **V8 is predicted NEGATIVE and DD15's suppression is contingent work.**
  `-webkit-app-region` decides at **pointerdown**, and the drag arms on a `no-drag` `.tab`.
  Recorded so leg 3 doesn't pre-build suppression it won't need — **the prediction does
  not discharge the verdict.**
- **V8 needs V2 as its positive control**, and leg 2 now orders them: a `window.screenX`
  that never updates reads identically to "the OS didn't take the gesture" —
  discrimination zero, this flight's own named failure.
- **Leg 4 must keep the factored move core synchronous — and it drags leg 1's pin with
  it.** Leg 1 anchors on the *handler*; **factoring is precisely the edit that moves the
  delete/set pair into a helper**, at which point an unguarded pin finds an anchor with no
  pair in it and **passes on an empty body** — retiring itself exactly when the code it
  protects is most exposed. Leg 1's pin therefore carries a **vacuity guard** asserting the
  pair *was found*, so leg 4's factoring **fails loudly** and forces a re-anchor. F7's
  own `window-closed-invariant.test.js` uses this idiom; F8 inherits it deliberately.
- **DD12's F10 handoff: legitimate, not scope-dumping** (reviewer's independent ruling).
  The decisive instrument was measured, not argued: `menu-overlay`,
  `find-overlay-geometry`, and `menu-dismissal` each carry **4** `enumerateWindows`
  references in the spec and **0** in their latest run log, while `multi-window-shell`
  carries 14 and 1 — **the instrument varies in both directions on the real artifact**, so
  those runs provably predate their re-point. **F8 must still record in the mission that
  it added 11 specs to F10's walk** — F10 covers them by construction, but the mission
  never says F8 put them there.

**Credit, verified rather than assumed**: the reviewer checked whether the spec's
citation convention was *followed* or merely *declared* — and found the DDs do cite
symbols and literals as promised, with residual line numbers confined to the log's
correction table, where they belong (it is an inspection record). **The convention is
real.**
