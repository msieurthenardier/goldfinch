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

---

### Leg 1

**`01-dd1-pin-and-test-helper` — landed.** Suite **1833 → 1841 (N = 8)**; lint, typecheck
green (each run standalone). `src/main/main.js` **+8 lines, exactly at budget, comment
only, zero lines removed, zero executable change**. No file was ever mutated on disk.

#### Phase 0 audit — every AC verified implementable before any code

The FD folded design-review pass 2 into implementation and asked for an implementability
audit first. **No AC was undischargeable.** Every claim the leg asked me to re-verify held:

| claim | verdict |
|---|---|
| AC1(a) `findMatchingBracket` bodies byte-identical, docstrings differ | **HOLDS** — 503 bytes each, identical |
| AC1(b) `maskComments` docstrings differ | **HOLDS** |
| AC1(c) `maskComments` bodies differ by exactly two inline comments | **HOLDS** — and mechanically: the copies differ by exactly **81 bytes** = `// closing quote` (17) + `// the newline itself…` (64). Exactly two, nothing else. |
| AC5(a) anchor occurs exactly once across masked `src/main/**` | **HOLDS** — masked+quoted = **1** |
| AC8's six readings | **ALL SIX re-measured, hold exactly** — naive 1/1/1, masked 0/0/1 |
| AC10 regex blind spot latent | **HOLDS** — `grep -cE "/\[[^]]*['\"]" src/main/main.js` → 0 (and the grep exits 1: the footgun, live) |
| AC3 implementable via maskComments + findMatchingBracket | **YES** — prototyped against real source before writing |
| all `.replace()` mutation targets exist and are unique | **YES** — 1 occurrence each |

**One near-miss worth recording.** AC5(a)'s "measured: 1" is true only for the **quoted**
anchor and/or under masking. The **naive bare** substring reads **2** across `src/main/**` —
`move-tab-payload.js:8` mentions the channel in prose. An implementer anchoring on the bare
substring without masking would have had the vacuity guard fail on the real tree. The pin
uses the quoted anchor **and** masks, so it is doubly protected.

**Also verified rather than inherited**: `grep -c "F8" src/main/main.js` → **17** (the
spec's number, confirmed before I repeated it in a committed file).

#### Two things the leg got WRONG — found by measuring its own claims

**1. "Four recorded line numbers for the pair are all wrong" — FALSE. Three were.**
Four *distinct* values were recorded across F7's artifacts: `2699-2700` (flight.md),
`2639-2640` (leg 2's "correction"), `2712-2713` (leg 3), `2756-2757` (the debrief). The
pair sat at **exactly 2756/2757** at this leg's start — **the fourth citation was
CORRECT.** The leg asserting that four unverified citations were all wrong did not verify
its own count. That is this flight's signature failure, in the leg written to end it, and
the **fourth artifact in this lineage** caught doing it (after the flight spec's ~20 stale
citations, DD5's "5 reasons" over 4 sites, and DD12's "14 re-pointed").

**The true argument is stronger than the overstated one.** This leg's own 8-line comment
pushed the pair to **2764/2765**, invalidating the one citation that was right. A line
number is not wrong because authors are careless — it is wrong because **the next edit
above it moves it**, and leg 1 is the proof. This vindicates the flight's prerequisite that
**leg 1 land before any leg edits `main.js`**: the first edit above the pair re-drifts every
line-anchored citation, and leg 1 *is* that first edit.

**2. AC6's rationale for masking — FALSE, with discrimination ZERO on the real tree.**
The leg justified the mask on the grounds that AC7's comment "says the word `await`" and
"would trip this leg's own test". **Measured**: swapping `maskComments` for the identity
function and re-running the pin against the real `src/main/**` yields an **IDENTICAL
reading** (anchors 1, async false, pair true, awaitBetween false). Both premises fail —
AC7's comment sits **above** the delete, outside the `delete..set` slice the pin inspects,
and `move-tab-payload.js` spells the channel in **backticks**, which the quoted anchor never
matches.

This is **the same defect shape as AC2's cut instrument** (both readings equal ⇒
undischargeable by DD10's own rule) — this time in the AC written to *justify* the mask.
**AC6 itself still discharges**: its stated instrument is a *synthetic* source, and that
reading does discriminate. It is the *rationale* that was unverified.
**The mask is KEPT** on the honest ground — free, house idiom, and protective against
leg-4-plausible edits (a comment *between* the pair naming `await`; a quoted channel mention
in prose). The pin's header **records that masking is defensive, not currently
load-bearing**, rather than repeating the claim. A pin that overstates its own instrument is
the defect this leg exists to prevent.

#### DD10 — BOTH readings, every mutation. All committed as tests, all in-memory.

Every mutation is applied to an in-memory copy of the **real** `main.js` (`readFileSync` →
`.replace(...)` → scan the string). **No file is ever written.** Each mutation asserts it
actually applied — a no-op `.replace()` would "discharge" vacuously.

| AC | mutation of the real source | real reading | mutated reading | discriminates |
|---|---|---|---|---|
| **AC2** | prepend **40 blank lines** | handler @ line **2711**, pair found, 0 violations | handler @ line **2751** (+40), pair **still found**, 0 violations | **YES** — a line-anchored pin loses the pair; this one does not |
| **AC3** | `(event, payload) =>` → `async (event, payload) =>` | `asyncCallback` **false**, **0** violations | `asyncCallback` **true**, **1** violation naming the handler | **YES** |
| **AC3′** | `queueChromeSend(target, async () => [… await …])` | `asyncCallback` false, **0** violations | `asyncCallback` **still false**, **0** violations | **YES — by design.** A nested async thunk is *not* a suspension point of the handler. This is the false positive the cut AC5 generated, pinned as a test so a future widening re-breaks it. |
| **AC4** | `async` on callback **AND** `await Promise.resolve();` between the statements, **together** | `awaitBetween` **false**, **0** violations | `awaitBetween` **true**, **2** violations | **YES** — and the mutated state is **REACHABLE** (asserted: it parses). `await` alone in a sync callback is a SyntaxError. |
| **AC5(a)** | rename channel → `'tab-move-to-other-window'` | anchors **1** | anchors **0**, no registration found | **YES** — the net asserts `anchors === 1`, so a rename fails loudly rather than passing on nothing |
| **AC5(b)** | delete `source.tabViews.delete(p.wcId);` | `pairFound` **true** | `pairFound` **false**, anchor **still 1**, violations **still 0** | **YES — this is leg 4's shape in miniature.** An unguarded pin would find the anchor, scan an empty body, find no `await`, and **PASS**. The guard is what makes it fail. |
| **AC6** | comment-wrapped registration vs. the same text uncommented | commented → anchors **0**, no handler | uncommented → anchors **1**, **2** violations | **YES** (synthetic — see above: the real tree does not exercise the mask) |

#### AC1 — extraction proven by byte-identity, not by "the suites still pass"

The helper was assembled **programmatically** from the two suites' text, so byte-identity is
mechanical rather than a claim about careful retyping:

| extracted | vs `broadcast-invariant` | vs `window-closed-invariant` |
|---|---|---|
| `maskComments` | **BYTE-IDENTICAL** | differs by **81 bytes** (exactly the two inline comments) |
| `findMatchingBracket` | **BYTE-IDENTICAL** | **BYTE-IDENTICAL** |
| `collectSources` | *(not present)* | **BYTE-IDENTICAL** |

**Ruling on the three divergences** (recorded in the helper header, per AC1):
- **(c) `maskComments`'s BODY**: broadcast-invariant's survives **byte-for-byte**. It is the
  original (M06 F4 L1); both inline comments explain genuinely non-obvious branches; the
  later transcription dropped them and gained nothing. **Byte-identity against BOTH was not
  available** — the copies disagree — so it was **ruled, not assumed**.
- **(a) `findMatchingBracket`'s DOCSTRING**: broadcast-invariant's survives — it states the
  precondition and the *reason* for string-skipping; window-closed's carried neither.
- **(b) `maskComments`'s DOCSTRING**: **merged and made caller-neutral.** Broadcast's was
  more complete but named *its own* callers ("registration-site regexes", "marker checks"),
  which is wrong in a shared toolkit. The load-bearing invariant both stated — *output is the
  same length, so masked indices are valid offsets into the original* — is kept verbatim.

**Baselines held exactly**: `window-closed-invariant` **8/8**, `broadcast-invariant` **6/6**.
Both now import the helper and carry no local copy.

**AC10 — the regex-literal blind spot is RECORDED, not fixed**, in the helper header (AC1's
docstring ruling was the natural home). A regex with an odd number of quote chars (`/['"]/`)
inverts quote parity and disables masking for the rest of the file. Latent today (→ 0), fails
**loud** not silent, and **neither original docstring mentioned it** — which matters because
**leg 4 adds code to `main.js`**.

#### AC8 — F7's AC7 corrected at BOTH sites

Both line numbers re-verified before editing, and both anchored on **text**, not number:
- **line 145** (the AC, checked `[x]` claiming naive → **0**; it returns **1**, matching the
  file's own ELECTRON-FREE header *comment*). **The verdict was right and the instrument was
  wrong** — the harder failure to see, since the helper *is* Electron-free.
- **line 236** (the verification command block) — **replaced with a masked command that
  actually runs** (verified: prints 0/0/1). Fixing only the AC would have left **the failing
  command live in the runbook** — the identical half-fix the debrief's "delete 2 lines" would
  have made.

`engine.js` is the **genuine positive control**: a real `require('electron')` that the masked
reading still catches (**1**), proving the mask does not simply blank everything.

#### Notes for leg 4

- **The pin will FAIL when you factor the move core out.** That is designed, not a
  regression: AC5(b)'s guard fires on the missing pair. **Re-anchor the pin to the pair's new
  home — do not delete it.** The test's failure message says so.
- The pin scans **all of `src/main/**`**, so a move core in a new module is already in scope.
- **Do not write a regex literal with an odd number of quote chars into `main.js`** (see the
  helper header) — it would silently disable masking downstream.
- The pair is now at **2764/2765**. It will move again the moment you touch anything above
  it. **Do not cite it by line.**

### Leg 2 — Transport Spike

**Status**: landed. Eight verdicts recorded. **Zero lines of `src/` written.** Probe scripts
lived in a scratch dir outside the repo and are deleted. Rig: fresh scratch profile
(`--user-data-dir` outside the repo → `…-dev` per `init-profile.js`), bind-probed port
(`ss -ltn` never consulted as an authority), admin key read from the app log **in-process**
and never crossing a shell literal. Electron **42.6.1**, `--ozone-platform=wayland`
confirmed in `process.argv`, `getPrimaryDisplay()` = `{0,0,2560,1440}` scale **1**.

> **Everything below is scoped to WSLg RAIL unless it says otherwise.** It is NOT
> generalized to native Wayland. Where the Electron typings make a Wayland-wide claim, that
> is flagged as *documented, not measured here*.

#### Apparatus — two instruments the flight did not know it had, and one it needed

1. **MCP SDK client, admin tier** (`scripts/lib/mcp-client.mjs` + `StreamableHTTPClientTransport`),
   exactly as `a11y-audit.mjs` and the F7 run logs drive it. Gives `getChromeTarget`,
   `enumerateWindows`, `evaluate`, `pressKey`.
2. **Main-process Node inspector — NEW APPARATUS.** `enumerateWindows` exposes **no bounds**,
   so **V3/V4/V6 are unmeasurable over MCP at all**. Launching with `--inspect=<port>` exposes
   the Electron **browser process** as an inspector target (`electron/js2c/browser_init`);
   `Runtime.evaluate` over that socket reads `BaseWindow`/`screen` live. No prior run log uses
   this. **The flight spec assumed V3/V4/V6 were measurable and never said with what.**
3. **Win32 interop via `powershell.exe` — the independent instrument, and the one that breaks
   this leg open.** WSLg RAIL surfaces each Goldfinch window as a **real Win32 window**
   (`cls=RAIL_WINDOW`, `title=Goldfinch (Ubuntu)`), so `GetWindowRect`/`MoveWindow`/
   `SetForegroundWindow`/`SetCursorPos`/`SendInput` read and drive **real OS state** from
   outside Electron entirely. **Every DD10 discrimination below rests on it.** Without a
   second instrument, Electron's coordinate reads are self-consistent and unfalsifiable.

*Instrument bugs found and fixed before any verdict was drawn (recorded because each one
first produced a confident wrong reading):* `Write-Output` inside an `EnumWindows` delegate
never reaches the pipeline — the first enumeration printed **nothing at all, not even
Explorer**, which reads identically to "no such windows exist"; `INPUT` must be **40 bytes**
on x64 (a 48-byte struct makes `SendInput` a silent no-op — the cursor simply never moves).

---

#### THE CENTRAL FINDING — Electron's window coordinates on this rig are a cached fiction

`setPosition` is a **no-op**. `getBounds`/`getPosition`/`window.screenX` return **the value
Electron last recorded for itself**, never the compositor's truth. Three placements, one
independent witness:

| `setPosition(A, …)` | Electron `getBounds(A)` | **Real Win32 RAIL rect** |
|---|---|---|
| `(300,250)` | `{x:300,y:250,w:1400,h:900}` | `x=454 y=257` |
| `(500,350)` | `{x:500,y:350,w:1400,h:900}` | `x=454 y=257` *(unmoved)* |
| `(900,200)` | `{x:900,y:200,w:1400,h:900}` | `x=454 y=257` *(unmoved)* |

**Discrimination on my own instrument, both directions, same run** — a frozen rect and a dead
reader read identically:
- `Ctrl+N` → a **third** `RAIL_WINDOW` appeared (`9634850`), Electron count `2 → 3`. The reader
  tracks creation.
- Win32 `MoveWindow(9634850 → 200,120)` → rect **changed to `x=200 y=120`**. The reader varies.

So the frozen readings are real. And the converse holds:

- After that **real** OS move, Electron `getBounds(w3)` still read **`{x:580,y:270}`** and
  renderer `window.screenX` still read **564**. **Electron never noticed.**
- A **real** OS move fires **no Electron event at all** — not `move`, not `resize`
  (listeners installed on all three windows; `global.__blur` drained empty).
- Electron reported `isMinimized() === false` for a window Win32 reported `IsIconic === True`.

**Fiction vs reality, all windows restored, RAIL↔Electron mapping proven by `SetForegroundWindow`
→ which Electron window fires `focus` (w1=`917554`, w2=`524566`, w3=`9634850`):**

| win | Electron `getBounds.x` | renderer `screenX` | **real Win32 x** | offset |
|---|---|---|---|---|
| w1 | 900 | 884 | **422** | +462 |
| w2 | 1400 | 1384 | **107** | +1277 |
| w3 | 580 | 564 | **640** | −76 |

**A virgin window — minted by `Ctrl+N`, never touched by `setPosition` — diverges at birth:**
Electron `getBounds` `{x:580,y:270}`, renderer `screenX` **564**, **real Win32 `x=927 y=248`**
⇒ **−363px at birth**. The fiction is not "correct until you disturb it."

**And every `Ctrl+N` window gets the SAME fictional origin**: w3 and w4 both report
`getBounds → {x:580,y:270}` while really sitting at `x=640` and `x=927`.

---

#### V1 (GATE) — out-of-window `pointermove` **and** `pointerup` to the source

**Verdict: `UNMEASURED` — real-OS half. Synthetic half POSITIVE.**

- **Synthetic half (measured, positive)**: during an **active button-down drag session** armed
  on a real `.tab`, the source chrome renderer receives `pointermove` at coordinates far
  outside its own viewport — `1400, 1500, 2000, 3000, −200` — **exact values**, and receives
  **`pointerup` at `x=2400`**, which **cleared the drag** (`.tab.dragging` → absent). On the
  synthetic path there is **no stuck-drag outcome**.
- **Real-OS half: UNMEASURED, with the reason.** No available injector delivers real OS pointer
  input to a WSLg RAIL surface. Both instruments were built, proven to move the real cursor,
  and still delivered nothing:
  - `SetCursorPos` sweep across window 3's **chrome strip** (cursor read back at `(1100,160)`;
    `WindowFromPoint(1100,160)` → **`9634850 cls=RAIL_WINDOW`**, i.e. verifiably over our
    window) → **0 pointermove, 0 pointerdown, 0 pointerup**, including a real
    `mouse_event` LEFTDOWN/UP click.
  - `SendInput` (corrected 40-byte `INPUT`; `sent=1`; cursor **verifiably tracked** to
    `(900,300)` then `(1100,160)`) → **0 events**.
  - **Discrimination, same listener, same run**: synthetic `sendInputEvent` → **8 moves**
    (`{cx:300,cy:28,tr:true}` …). The listener is alive. *(An earlier run where the control
    ALSO read 0 was discarded, not reported — a run whose control fails is not evidence.)*
- **Why this is `UNMEASURED` and not negative**: the operator drives this app with a mouse
  daily, so real pointer input demonstrably reaches these windows. **The instrument is the
  limitation, not the platform.** WSLg input arrives over the RDP channel from the Windows-side
  client; injected input in the Windows session is not forwarded into it. Reporting V1-negative
  here would trigger a **mission-level re-opening** off a broken instrument.
- **Falsifier**: any injector that moves the real cursor AND produces a renderer `pointermove`
  over a single window would make V1's real half measurable. None found.
- **Scope**: WSLg RAIL. **Prior (NOT measured, do not cite as evidence)**: Wayland's `wl_pointer`
  **implicit grab** keeps motion flowing to the client that received the button-press, with
  surface-local coordinates that may be negative or beyond the surface — which would predict
  V1-positive on native Wayland. **This is a hypothesis for HAT, not a reading.**
- **`renderer.js`'s capture comment is measured FALSE (bonus).** It claims capture *"retargets
  subsequent events to the dragged tab's own element regardless of where the cursor visually
  sits."* With the drag armed, **`hasPointerCapture()` returned `false` on every event**, the
  `.tab` element's own listener received **nothing**, and `e.target` was **`platform-linux`**
  (the root) — the document-level listeners are the only reason the drag works at all. The leg
  said *"it is the hypothesis, not the evidence."* It is now a **refuted** hypothesis.
- **DD9's carried apparatus fact CONFIRMED**: `e.buttons === 0` on **every** synthetic
  `pointermove`, even when `buttons:1` is passed to `sendInputEvent`.

#### V2 — is `screenX + clientX` globally consistent across two windows?

**Verdict: POSITIVE as specified — and the verdict is a FALSE POSITIVE. V2 has ZERO
discrimination against the failure this rig actually has.**

- **Reading (as the leg specifies it)**: `delta_renderer === delta_main`, twice.
  - A`(100,100)` B`(1000,400)`: `delta_main = [900,300]`, `delta_renderer = [900,300]` ✓
  - A`(300,250)` B`(1400,550)`: `delta_main = [1100,300]`, `delta_renderer = [1100,300]` ✓
  - `screenX` tracked every `setPosition`: A `84 → 284` (+200), B `984 → 1384` (+400),
    `screenY` +150 both.
  - **CSD margin measured `[16,10]` on BOTH windows at BOTH placements** — DD1's corollary said
    *"probed once at ~16/10px; do not treat the exact value as established."* It is now four
    readings across two windows: **exactly `[16,10]`** on this rig.
- **Why the PASS is worthless**: `screenX` and `getBounds` are **not independent**.
  `screenX === getBounds.x − 16` identically. V2 compares **two proxies of one cached value**
  and cannot fail. It is *the same proxy-substitution failure this flight has diagnosed three
  times*, now built into a verdict.
- **The question V2 was meant to ask — is the space GLOBALLY consistent? — answers NO**, via the
  independent instrument: the fiction↔real offsets are **+462 / +1277 / −76**, and the
  **pairwise relative offsets do not agree with reality**:
  `w1→w2: delta_fiction=500, delta_real=−315` ⇒ **815px wrong**;
  `w1→w3: −320 vs +218` ⇒ **538px wrong**; `w2→w3: −820 vs +533` ⇒ **1353px wrong**.
- **Falsifier (met)**: an independent witness showing `screenX` disagreeing with real geometry.
- **Consequence**: **V2 cannot serve as V8's positive control** (see V8).

#### V3 — `screen.getCursorScreenPoint()` → `{0,0}`?

**Verdict: CONFIRMED, fully discriminated.**

| independent Win32 cursor | Electron `getCursorScreenPoint()` |
|---|---|
| `{x:80,y:707}` (as found) | `{x:0,y:0}` |
| `{x:1500,y:850}` | `{x:0,y:0}` |
| `{x:300,y:200}` | `{x:0,y:0}` |

- **Discrimination**: the independent instrument **varied** across three positions; Electron's
  reading **never moved off the origin**. The `screen` module is **not dead** —
  `getPrimaryDisplay().bounds` = `{0,0,2560,1440}`, `scaleFactor: 1` in the same call.
- **The mapping-independent argument** (so this does not depend on Windows↔Wayland offsets):
  `{0,0}` is a **single point**, and the three physical positions are **distinct**; any
  injective mapping sends them to three distinct points. **At most one reading can be correct;
  at least two are wrong.** It never throws.
- **`screenToDipPoint({1234,567})` → `{1234,567}`** (identity — matches the typings).
- **`dipToScreenPoint({1234,567})` → `{1234,567}`** — identity **too**. The leg says its Wayland
  behavior is undocumented and must not be assumed to mirror its sibling. **It mirrors it here
  — but this reading is `UNDISCRIMINATED` and I will not claim more**: `scaleFactor === 1`, so
  **identity is also the CORRECT answer**. A working converter and an identity-degraded
  converter read **identically** at scale 1. Discriminating it needs a `scaleFactor ≠ 1` rig
  (`--force-device-scale-factor=2`), which was **not run** — it changes the rig under every
  other verdict. **Recorded as undischarged, not as a pass.**
- **Scope**: WSLg RAIL. The `{0,0}` is consistent with the documented Wayland behavior.
- **Ruling**: DD1's ban on the `screen` module as a coordinate source is **upheld**.

#### V4 (GATE) — `getBounds()` hit-test, THREE readings

**Verdict: the three readings as literally specified all PASS. The mechanism is NEGATIVE in
substance. V4-as-specified is a FALSE POSITIVE — and it is a *different* false positive from
the one DD3 was written to catch.**

Raw `getBounds()`: `w1 {x:300,y:250,w:1400,h:900}`, `w2 {x:1400,y:550,w:1400,h:900}`.

| reading | point | result | |
|---|---|---|---|
| 1 | inside B `(2100,1000)` | **`{hit:2}`** = B | PASS |
| 2 | empty desktop `(50,50)` | **`{hit:null}`** | PASS |
| 2 | empty desktop `(100,1300)` | **`{hit:null}`** | PASS |
| 2 | empty desktop `(2000,100)` | **`{hit:null}`** | PASS |
| 3 | inside A `(1000,700)` | **`{hit:1}`** = A | **PASS — different records** |

*(My first reading-2 attempt used `(2500,1400)`, which is **inside** B's `x[1400..2800)`
`y[550..1450)` — a **probe error**, not a rig failure, corrected before any verdict was drawn.
Recorded because "empty desktop" is not a self-evident coordinate.)*

**Why the PASS does not discharge the gate:**
- **Reading 3 only passes because `setPosition` gave the windows distinct FICTIONAL origins.**
  The rects it resolved against are fabrications: those two windows were really at
  `x=454` and `x=422` — **overlapping**, not 1100px apart.
- **In the DEFAULT state, reading 3 FAILS.** Every `Ctrl+N` window is born at
  `getBounds → {x:580,y:270}`. Measured: **w3 and w4 both report `{x:580,y:270}`** while really
  at `x=640` and `x=927`. Two records, **identical origins** ⇒ **DD3's identical-origins guard
  refuses** ⇒ cross-window drag never resolves. **This is the default outcome of the default
  user action (open a second window, drag a tab).** Not an edge case.
- **Directly measured, the DD3 ambiguity case**: with both windows at `getBounds {x:300,y:250}`,
  the naive hit-test of `(1000,700)` resolved to **`{hit:1}` — the FIRST record**, exactly
  DD3's documented degradation 2. **The guard is necessary and correct.** It is also, on this
  rig, **permanently engaged**.
- **The failure DD3 does NOT catch**: DD3 guards `identical origins → refuse`. Here origins are
  **distinct and plausible** (after any `setPosition`), so the guard **never trips** — and the
  rects are still wrong by **538–1353px**. A real drag resolves the **wrong window, silently**.
  **DD3's own words for degradation 2 — *"a false positive that looks exactly like a working
  feature"* — describe a failure mode DD3 cannot see.**
- **Falsifier (met)**: an independent witness showing `getBounds` ≠ real geometry.
- **Scope**: WSLg RAIL. The typings' Wayland note (`{x:0,y:0}`) is **documented, not observed
  here** — this rig returns a **cached echo** instead. Both are "not the real position"; the
  echo is **strictly more dangerous** because it is plausible.

#### V5 (GATE) — `sendInputEvent` cross-window drive; does Chromium CLIP injected coords?

**Verdict: POSITIVE. Coordinates are NOT clipped. DD9's named falsifier is measured FALSE —
but its stated mechanism is wrong, and it omits a load-bearing precondition.**

Viewport width **1400**. Both directions, one run, same listeners:

| mode | in-bounds | out-of-bounds |
|---|---|---|
| **no drag session** | `[200,700,1399]` → delivered **exactly** | `[1400,1500,2000,3000,−200]` → **`[]` — dropped entirely** |
| **active drag session** (button down on `.tab`, armed) | `[800,1399]` → delivered | `[1400,1500,2000,3000,−200]` → **all delivered, exact** |
| **active drag session** | — | `pointerup @ x=2400` → **delivered**, drag **cleared** |

- **Discrimination**: an in-bounds injection reads back its **exact** `x` in the same run
  (`200→200`, `700→700`, `1399→1399`), so a null out-of-bounds reading is not a broken injector.
- **Boundary is exact**: injected `[1396,1397,1398,1399,1400,1401,1402,1450]` → delivered
  `[1396,1397,1398,1399]`. `x < 1400` passes; `x ≥ 1400` drops.
- **Nothing is ever CLIPPED.** The behavior is **binary**: delivered with the exact value, or
  not delivered at all. DD9's falsifier — *"`e.clientX` reads ≤ viewport width"* — **never
  happens**; `e.clientX` is never a clipped value.
- **DD9's precondition, unstated in the spec**: `x:2000` yields `e.clientX = 2000` **only during
  an active button-down drag session** (Chromium's implicit mouse capture routes without
  hit-testing). With the button up, the same injection is **silently dropped**. DD9 asserts the
  `x:2000` result unconditionally. It is conditionally true — and the condition happens to hold
  for F8's drag.
- **Negative x works too** (`−200`, `−900` delivered exactly) ⇒ a window to the **left** is
  reachable on the synthetic path.
- **Falsifier**: an out-of-bounds injection reading back `≤ 1400`. Never observed.
- **Scope**: Chromium 42 input routing; not WSLg-specific.

#### V6 — `setPosition` placement, READ BACK

**Verdict: NEGATIVE. `setPosition` is a no-op, and the read-back DD4 mandates LIES.**

- **Read-back (the reading DD4 asks for)**: requested `(100,100)` → `getPosition()` **`[100,100]`**;
  requested `(1000,400)` → **`[1000,400]`**. **Exact match. This is the trap.**
- **Independent witness, same run**: the real RAIL rects **did not move** across three
  placements (`x=454 y=257` throughout, while Electron reported `300,250 → 500,350 → 900,200`).
- **DD4 says *"reads the position back rather than assuming the call worked."* The read-back
  cannot detect the failure — it reads the same cached value `setPosition` just wrote.** DD10's
  own rule, applied to DD4's own instrument, was **not satisfiable by DD4's own method**. This
  is the leg's sharpest methodological result: **a read-back is not a second reading unless it
  comes from a second instrument.**
- **Scope**: WSLg RAIL. DD4 already scopes placement as WSLg-only and **cosmetic-only**, so this
  costs the flight **nothing in correctness** — tear-off still moves the tab. But **the AC as
  written cannot be discharged honestly**, and would have been ticked green.
- **Falsifier (met)**: an independent witness showing no real movement.

#### V7 — does DRAG-DRIVEN activation deliver real OS blur where SCRIPTED `focus()` does not?

**Verdict: the drag-driven case is `UNMEASURED` (no real pointer). But the premise underneath
the F7 debrief's gloss is REFUTED: WSLg DOES deliver real OS blur. The gap is rig-reachable —
without a drag.**

Listeners on all three windows (`blur`/`focus`/`move`), drained between stimuli:

| stimulus | Electron events |
|---|---|
| **scripted `win.focus()`** (w1, then w2) | **`[]` — nothing** |
| `SetForegroundWindow(9634850)` while **already** foreground | `[]` *(no-op stimulus — no discrimination; discarded)* |
| `minimize()` + `restore()` (w1) | `[]` |
| **`hide()` + `show()` (w2)** | **`blur` w3, `focus` w2** |
| **`SetForegroundWindow(917554)`** (real OS activation) | **`blur` w2, `focus` w1** |
| **`SetForegroundWindow(9634850)`** | **`blur` w1, `focus` w3** |
| **`SetForegroundWindow(524566)`** | **`blur` w3, `focus` w2** |

- **Discrimination (exactly what the leg demands)**: the blur listener **fires** — for
  `hide/show` and for **real OS activation**. A silent listener is ruled out. In the same run,
  **scripted `win.focus()` fires nothing.**
- **F6 spike verdict 4 is CONFIRMED *with its qualifier intact***: *"WSLg delivers no OS blur
  **to a scripted stimulus**."* Measured true for `win.focus()`.
- **The F7 debrief's gloss — *"WSLg has no OS blur, and it's the only desktop"* (platform-
  permanent) — is MEASURABLY FALSE.** WSLg delivers `blur` **and** `focus` for a genuine OS
  activation. The leg's instruction not to inherit the gloss was correct, and the gloss would
  have been inherited into DD13's retirement ruling.
- **What is still UNMEASURED**: whether a **drag-driven** activation specifically delivers blur.
  That needs a real pointer (V1's blocker). **Recorded as unmeasured — not inferred.**
- **But the flight's open question — *"Does cross-window drag make the DD7 blur gap rig-
  reachable?"* — is answered NO/moot in a better way than expected: the gap is reachable
  ALREADY, by `SetForegroundWindow` or `hide()/show()`, with no drag and no F8 at all.** The
  ruling's structural premise is not what needed defeating.
- **Scope**: WSLg RAIL, Electron 42.6.1.

#### V8 (GATE, ordered after V2) — does crossing `#tabstrip-drag` hand the gesture to the OS?

**Verdict: `UNMEASURED`. The positive control FAILED, so the null reading proves nothing —
and BOTH of the flight's specified instruments for V8 are invalid.**

| arm | `screenX` before/during/after | **real RAIL rect** before/during/after |
|---|---|---|
| **(a) CONTROL — press-and-drag STARTING on `#tabstrip-drag`** (`app-region: drag`) | `564 / 564 / 564` | `x=200 y=120` / **unchanged** / **unchanged** |
| **(b) V8 — arm on `.tab` (`no-drag`), then cross `#tabstrip-drag`** at x=359, 509, 709 | `564 / 564 / 564` | `x=200 y=120` / **unchanged** / **unchanged** |

- **The control (a) did not move the window either.** A synthetic `sendInputEvent` **cannot**
  trigger `-webkit-app-region` at all — the OS window-move is decided by the **browser process**
  hit-testing **real OS input**, which `sendInputEvent` bypasses by construction. **Instrument
  discrimination: zero.** (b)'s null is therefore uninterpretable. **This is exactly the failure
  V8 was written to avoid, arriving one level up: the spec discriminated the *reading* and not
  the *stimulus*.**
- **`window.screenX` is independently disqualified as V8's instrument**, and **V2 cannot be its
  positive control.** V2 shows only that `screenX` tracks **programmatic** moves. Measured here:
  `screenX` **does not track a real OS window move** (RAIL `200,120 → 640,300`; `screenX`
  **564 → 564**). So even **with** a real pointer, an OS-taken gesture would leave `screenX`
  **unchanged** — reading **identically** to "the OS didn't take it". **The flight's specified
  V8 discrimination is unsatisfiable via `screenX`.** *(The RAIL rect is a valid instrument —
  proven to vary — and is what a future V8 must use.)*
- **The prediction stands unrefuted, and DD15's PREMISE is measurably FALSE.** DD15 says
  *"`#tabstrip-drag` … **inherits `-webkit-app-region: drag`** from the strip."* Computed styles,
  same run:

  | element | computed `-webkit-app-region` |
  |---|---|
  | `#tabstrip` | **`drag`** |
  | **`#tabstrip-drag`** | **`none`** — *not* `drag` |
  | `.tab` | `no-drag` |
  | `#newtab-pill` | `no-drag` |
  | `.win-ctrl` | `no-drag` |
  | `body` | `none` |
  | **fresh `<div>` appended inside `#tabstrip`** | **`none`** |

  **The probe `<div>` is the discrimination**: a brand-new child of the strip computes `none`,
  proving **`-webkit-app-region` does not inherit** in Chromium 42.
- **DD15's CONCLUSION nevertheless survives** — for a different reason than it states. Chromium
  builds draggable regions by walking the layout tree: `drag` **adds** an element's rect,
  `no-drag` **subtracts** it, `none` **contributes nothing**. `#tabstrip`'s own rect is
  `(1,1,1398×38)` and **spans the spacer's area** (`309..1257`). So the slack **is** an OS drag
  region — via **the parent's rect**, not by inheritance. **The hazard is real; the mechanism in
  the DD is wrong.**
- **This matters for the contingent fix.** DD15 proposes a *"`no-drag` toggle"* to suppress the
  region. Toggling the spacer to **`no-drag`** would work (it **subtracts**). Reasoning from the
  DD's stated mechanism — *"remove the inherited `drag`"*, i.e. setting it to `none` — would
  **do nothing**, because the parent's rect still covers it. **The mechanism error is
  load-bearing for the very fix the DD proposes.**
- **DD15's mitigation reasoning is also wrong on this rig**: it says an OS move fires **`'move'`,
  not `'resize'`**, so the resize→`cancelDrag` guard never trips. Measured: a real OS move fires
  **nothing at all** — no `move`, no `resize` — **and `screenX`/`getBounds` never update.** The
  hazard DD15 names (*`screenX` changes mid-gesture → the global point drifts*) **cannot occur
  here**; the real hazard is the exact inverse and worse: **the window really moves and the
  renderer's coordinate space silently never learns.**
- **Falsifier**: a stimulus that moves the RAIL rect via the app-region path. None found
  synthetically; needs HAT.

---

### Leg 2 — Rulings on the four gates

> Per the flight's **Adaptation Criteria**. Stated decisively; the re-scope decision itself is
> the FD's/operator's, but the verdicts admit only one honest reading.

**V1 (GATE) — `UNMEASURED`. Legs 3-5 CANNOT be unblocked by leg 2, and V1 is NOT leg 2's to
answer.**
The flight designates V1 *"the flight's gate"* whose negative is *"a mission-level re-opening"*
— while **DD9 already concedes the apparatus cannot measure it** (*"What it CANNOT do: prove a
real OS pointer delivers `pointermove` … → V1, then HAT"*). **That is circular**: V1 is assigned
to a leg whose only apparatus the spec itself declares insufficient, and leg 2 is told to
measure it anyway. Confirmed empirically — no injector reaches WSLg's RDP input path.
**Ruling: V1 is a HAT item, not a spike verdict. Reassign it.** Do **not** record V1-negative
and do **not** trigger the mission-level re-opening on this evidence.

**V4 (GATE) — NEGATIVE. Cross-window drop by real gesture does NOT proceed as designed. The
flight re-scopes.**
DD3's mechanism rests on `getBounds()` reporting real geometry. It does not — it reports a
cached echo diverging from truth by **−363px at birth** and **538–1353px** in relative terms.
Two consequences, both fatal to the design as written:
1. **Default state**: every `Ctrl+N` window is born at `{x:580,y:270}` ⇒ **identical origins** ⇒
   **DD3's guard refuses every cross-window drop**. The feature is dead-on-arrival for the
   default user action — the guard is right, and permanently engaged.
2. **After any `setPosition`**: origins become distinct-and-plausible ⇒ **the guard never
   trips** ⇒ the hit-test resolves the **wrong window silently**. **This is the S1 silent-success
   class the flight exists to prevent, and DD3 cannot detect it.**
Per Adaptation Criteria: *"V4 negative → cross-window drop degrades to tear-off (DD3). Same
re-scope."* **Ruling: apply it.** The flight lands **tear-off + the keyboard path**; cross-window
drag-to-adopt is **not buildable on DD1+DD3 on this rig**. The mission criterion *"A tab
**dragged** from one window's strip into another window's strip moves there"* goes
**UNSATISFIED**, and the mission must say so. *(Note: the Adaptation Criteria route this
re-scope through V1-negative and reach it via V4 only for the drop half. It arrives anyway —
through the coordinate authority, which no gate was watching.)*
**DD1 must be re-opened, not just DD3.** DD1 bans the `screen` module for returning a silent
`{0,0}` and installs `window.screenX` as *"the only coordinate authority."* **`window.screenX`
is the same class of defect** — a plausible, silently-wrong global coordinate, and *worse* than
`{0,0}` because `{0,0}` is obviously wrong on sight. **DD1's replacement fails DD1's own test.**
A source-scan test banning `screen` while blessing `screenX` pins the wrong symbol.

**V5 (GATE) — POSITIVE. Leg 6's synthetic path is technically alive — and MUST NOT be used to
claim cross-window coverage.**
Coordinates are not clipped; `x:2000` and `x:−200` deliver exactly during an armed drag, and
`pointerup` out of bounds is delivered. So DD9's V5-negative branch does **not** fire and the
resolve/adopt path **is** synthetically drivable.
**But the ruling is the opposite of the relief it looks like.** Because DD1's space is a
fiction, a synthetic test drives a **fiction-space handoff**: it injects `x:2000`, the renderer
computes `screenX(564) + 2000`, main hit-tests **fictional** rects, and the tab lands in window
B. **Green.** Meanwhile a human performing the same gesture misses by up to 1353px. **A passing
`tab-tearoff-cross-window` cross-window assertion would be an S1 silent success promoted into
the regression net — a test that certifies a feature no user can perform.**
**Ruling: leg 6 must NOT assert the cross-window half on the synthetic path.** Under the
re-scope the spec covers **tear-off only** and says so in its own text — the same outcome the
Adaptation Criteria assign to V5-**negative**, reached via V4 instead. **V5-positive does not
rescue leg 6.**

**V8 (GATE) — `UNMEASURED`. Leg 3 must NOT build DD15's `no-drag` suppression.**
The Adaptation Criteria fire the suppression only on **V8 positive**. V8 is not positive — it is
unmeasured, because the control failed. Per the leg (*"the prediction does not discharge the
verdict"*), the prediction is **not** discharged either — it is simply **unrefuted**, and its
premise (`.tab` is `no-drag`) is **measured true**. **Ruling: do not pre-build it** — this is
what leg 3's instruction already says, and nothing found here overturns it. **But correct DD15's
mechanism** (`#tabstrip-drag` computes **`none`**, `-webkit-app-region` **does not inherit**;
the region comes from `#tabstrip`'s own rect) **before anyone implements the fix from the DD's
stated reasoning**, and **re-anchor a future V8 on the RAIL rect, not `screenX`.**

---

### Leg 2 — artifact errors found (each measured, not argued)

1. **DD9 / V1 are circular.** DD9 states the apparatus cannot prove real-OS pointer delivery;
   the flight nonetheless makes V1 *"the flight's gate"* and assigns it to leg 2. **V1 is not
   answerable by any leg of this flight.** HAT owns it.
2. **DD15's premise is false.** `#tabstrip-drag` computes `-webkit-app-region: none`; the
   property **does not inherit** (probe `<div>` → `none`). The conclusion survives via the
   parent's rect; **the mechanism — and therefore the proposed fix's reasoning — does not.**
3. **DD15's `'move'`-not-`'resize'` mitigation is false on this rig.** A real OS move fires
   **nothing**, and `screenX`/`getBounds` never update. The named hazard is unreachable; the
   real one is its inverse.
4. **V2 is a false-positive-by-construction.** It compares `screenX` against `getBounds`, which
   are the **same cached value ±16**. It cannot fail, and it cannot serve as V8's control. The
   flight (DD15) explicitly designates it V8's positive control — **that designation is unsound**.
5. **DD4's read-back cannot discharge DD4's own AC.** `setPosition` is a no-op whose read-back
   returns the cached write. **A read-back is not a second reading unless it is a second
   instrument** — DD10's rule, which DD4 believes it is honoring.
6. **DD1's corollary is now established**: the CSD margin is **exactly `[16,10]`**, four readings,
   two windows, two placements — *and it is the least important thing about DD1*, since the
   value it offsets is fiction.
7. **DD1's own ban logic is inconsistent** — `screen` is banned for silent `{0,0}`; `screenX` is
   enthroned while exhibiting the same defect class more dangerously.
8. **`renderer.js`'s pointer-capture comment is false** (`hasPointerCapture() === false`
   throughout an armed drag; `e.target` = the root, not the tab). The drag works **only**
   because the listeners are document-level. The comment states the opposite as fact.
9. **The flight never named an instrument for V3/V4/V6.** `enumerateWindows` exposes no bounds;
   they are unmeasurable over MCP. The `--inspect` main-process channel is **new apparatus**
   this leg had to invent.
10. **DD12's `Last Run: never` scrub is unaffected by anything here** — noted only to confirm
    leg 2 touched no behavior specs.

### Flight Director Rulings on Leg 2 — THE FLIGHT RE-SCOPES

**The spike's verdict is adopted in full, and it invalidates DD1 and DD3.** This is the
adaptation the spec designed for (V4-negative), fired on measured evidence.

> **`window.screenX` is a cached fiction, and DD1 is the defect it banned the `screen`
> module for.**
>
> DD1 banned `screen.getCursorScreenPoint()` because it returns `{0,0}` **silently** —
> the S1 silent-success class. It then adopted `window.screenX + e.clientX` **on a recon
> probe that compared Electron's numbers only against Electron's other numbers.** The
> spike brought a **second instrument** (Win32 `GetWindowRect` over the WSLg RAIL
> surface) and the premise collapsed: `setPosition` is a **no-op**; a **real** OS move
> fires **no event** and leaves `getBounds` unchanged; a virgin `Ctrl+N` window is
> **born 363px wrong**.
>
> **`{0,0}` is obviously wrong on sight. `564` is not.** DD1 replaced a loud fiction
> with a quiet one and called it a fix — **the exact upgrade-to-silence that DD1's own
> rationale identifies as the worst outcome**, committed in the DD that identifies it.
>
> **The root cause is nameable and it is this flight's thesis:** every coordinate reading
> in recon and in DD1 came from **one instrument's self-report**. `screenX ≡ getBounds.x
> − 16` — V2 compared two proxies of a single value and **could not fail**. An
> instrument cannot discriminate against itself. **A read-back is not a second reading
> unless it is a second instrument** — and that sentence is the flight's most portable
> product.

**Gate rulings (adopting the spike's, with the FD's reasons stated):**

- **V4 NEGATIVE ⇒ cross-window DROP is not buildable on this transport.** Not "it
  degrades" — **DD3's guard cannot see its own failure.** Default state: all origins
  identical → the guard refuses **every** drop. After any `setPosition`: origins are
  distinct **and plausible and wrong** → the guard **never trips** and main adopts into
  the wrong window **silently**. DD3's identical-origins guard was designed against the
  documented `{0,0}` failure; the **actual** failure is plausible-but-fictional
  coordinates, which no guard over that instrument can detect.
- **V1 UNMEASURED, and the spec was CIRCULAR — the FD's error.** DD9 concedes the
  apparatus cannot drive a real cross-window pointer, and the spec then made V1 *"the
  flight's gate."* **A gate the flight has already declared unmeasurable is not a gate.**
  The spike's evidence is that the **instrument** is the limit, not the platform (the
  operator drags a mouse daily). **V1 goes to HAT. The mission-level re-opening does NOT
  fire on V1** — it fires on V4.
- **V5 POSITIVE — and it does NOT rescue leg 6. This is the spike's sharpest finding.**
  Coordinates are never clipped, so a synthetic cross-window drag **runs and goes
  green** — **driving a handoff through fiction-space while a human misses by 1353px.**
  A passing test over a broken feature: **an S1 silent success promoted into the
  regression net**, which is strictly worse than no test. **Leg 6's spec covers tear-off
  only, and says so.**
- **V8 UNMEASURED (control failed) ⇒ leg 3 must NOT build DD15's suppression.** The
  prediction stands unrefuted and its `.tab`/`no-drag` premise measured **true**.
- **V7 REFUTES the F7 debrief's gloss on measured evidence.** **WSLg DOES deliver real OS
  blur** (`SetForegroundWindow` → blur+focus fired). F6's *"to a scripted stimulus"*
  qualifier is **confirmed as the true scope**; the debrief's *"WSLg has no OS blur, and
  it's the only desktop"* is **false**. **The DD7 blur gap is already rig-reachable, and
  was before F8 existed** — the accepted-gap ruling rested on a premise that a
  ten-minute probe with a second instrument would have refuted at any point in F7.
  → mission known issue; DD13's coupling now has its verdict.

**Artifacts the spike found wrong (all four are the FD's):**

1. **DD9/V1 circular** — a gate assigned to a leg the same spec says cannot measure it.
2. **DD15's mechanism is false.** `#tabstrip-drag` computes `-webkit-app-region: none` —
   **it does not inherit** (probed: a child `<div>` reads `none`). The *conclusion*
   survives via the parent's rect; **the mechanism does not — and the proposed `no-drag`
   fix's reasoning depended entirely on the inheritance.** A fix aimed at a mechanism
   that isn't there.
3. **DD15's `'move'`-not-`'resize'` hazard is unreachable** — a real OS move fires
   **nothing at all**. The named hazard cannot occur; **its inverse is the real one**
   (the app never learns it moved).
4. **DD15 designated V2 as V8's control** — and V2 is **false-positive-by-construction**.
   A control that cannot fail is not a control.
5. **`renderer.js`'s pointer-capture comment is FALSE** — `hasPointerCapture()` reads
   **false throughout**; `e.target` is the root. **F2's drag works only because the
   listeners are document-level**, not because capture retargets anything. The leg
   artifact warned *"do not read it as an answer to V1 — it is the hypothesis"*; the
   spike measured it and the hypothesis was **not even true of itself**. → product
   comment correction, leg 3.

**THE RE-SCOPE — F8 lands tear-off + keyboard; cross-window DRAG is deferred with a
measured reason.**

**Tear-off survives intact, and needs no global coordinates at all.** "Did the pointer
leave the strip?" is a **window-local** question (`e.clientY` against the strip's own
rect). Nothing in tear-off reads `screenX`, `getBounds`, or `screen`. DD4's placement was
already ruled **cosmetic-only**, and V6 merely confirms it doesn't work — the tab still
moves. **The keyboard cross-window move survives too**: menu → `windowId` → main, zero
coordinates. So the mission's *substance* for cross-window movement — a tab moves from A
to B keeping jar identity and page state — **ships in F8 by keyboard.**

**What does NOT ship: the cross-window DRAG gesture.** The mission criterion reads *"A tab
**dragged** from one window's strip into another window's strip moves there"* — the drag
is the subject, so **that criterion goes UNSATISFIED and the mission must say so.**

> **The deferral is NOT "cross-window drag is impossible." It is: the chosen transport is
> dead, and the alternative was foreclosed without measurement.**
>
> The mission named three candidates. F8 adopted candidate 1 (pointer tracking + IPC) and
> candidate 3 (screen-coordinate hit-testing) — **both of which need app-level global
> coordinates, and both are now dead on this rig for one shared reason.** F8 foreclosed
> **candidate 2 (HTML5 drag with a custom MIME) — and the spec never gave a reason. It
> was foreclosed by omission**, and the correction block called the inversion out without
> noticing that the foreclosed candidate had no argument against it either.
>
> **Candidate 2 is the only one that never needs app-level coordinates, because the
> BROWSER owns the transport.** `dragstart` in window A, `drop` in window B — Chromium
> carries the payload and does the hit-testing itself, in real OS space, with no
> `screenX` anywhere. **Whether Electron delivers that across two `BaseWindow`s is
> unmeasured**, and it is exactly the spike that should run next.
>
> **F8's contribution to that question is the instrument**, not the answer: any future
> transport spike must verify against a **second instrument** (RAIL/Win32), because this
> flight has now proven that Electron's coordinate self-reports are unfalsifiable from
> inside Electron.

**Revised leg plan** (legs 3+4 merge — with no hit-test and no globals, leg 4's substance
was the hit-test):

- ~~Leg 3 `03-drag-zone-model`~~ + ~~Leg 4 `04-drop-resolution`~~ → **Leg 3
  `03-tearoff-by-drag`** (zone model on window-local coordinates + drop-commit + main-side
  create). **No DD15 suppression. No hit-test. No `screenX`.**
- Leg 5 → **Leg 4 `04-keyboard-cross-window-move`**, unchanged in substance.
- Leg 6 → **Leg 5 `05-verification`**, scoped to tear-off; **the new spec must state that
  cross-window drag is unverified and why** (V5's green-over-fiction hazard).

**DD1 and DD3 are struck** and replaced by **DD16** (below). **DD15 is struck** — its
mechanism, its hazard, and its control were each independently refuted.

---

### Leg 3 — `03-tearoff-by-drag`

**Status: landed.** Tear-off by drag ships on window-local coordinates only (DD16). No
`screenX`, no `getBounds` on a window, no `screen` module, no hit-test. DD15's suppression
was not built; DD1/DD3/DD15 were treated as struck throughout.

#### Phase 0 — audit of the leg's premises, before any code

Every factual claim the leg makes was checked against source first. **All five hold** —
this is the first artifact in the flight's lineage that audited clean.

| Claim | Verdict | Reading |
|---|---|---|
| **Seven** `cancelDrag()` call sites | **TRUE** | `createTab`, `pointercancel`, Escape, `resize`, `closeTab`, `adopt-tab`, `tab-moved-away`. Naive `grep -c "cancelDrag()"` reads **10** (7 calls + the definition + 2 prose mentions) — the over-count shape that put "three" in the flight draft. Masked + definition-excluded → **7**. |
| `drag` has `startX`, no `startY` | **TRUE** | `grep -c startY` → **0**; `grep -c startX` → **3** |
| Displacement is transform-only; `slotRects` snapshotted once in `armDrag` | **TRUE** | `applyDragDisplacement` writes only `style.transform`; `armDrag` is the sole `slotRects` assignment |
| `'tab-move-to-new-window'` handler synchronous; leg 1's pin passes | **TRUE** | `(event, payload) => {`, no `async`/`await`. Pin: **8/8 pass** at leg start |
| **AC8's premise**: factoring the core out WILL fail leg 1's vacuity guard | **TRUE** | Simulated in-memory before writing code: `pairFound` true → **false**. **Leg 1's guard is NOT broken.** |

#### AC8 — the pin's before/after readings

**BEFORE re-anchoring**, run against the factored `main.js`, leg 1's pin **FAILED 4 of 8**:

```
not ok 1 - no suspension point separates the tabViews delete from the set in tab-move-to-new-window
  the source.tabViews.delete(…) / target.tabViews.set(…) pair is no longer inside the
  'tab-move-to-new-window' callback (delete found: false, set found: false, in order: false).
  If the move core was factored out, RE-ANCHOR THIS PIN to the pair's new home — do not
  delete this test. The invariant did not move.
```

**This is leg 1's design working, not a regression.** An unguarded pin would have found an
anchor with an empty body and passed silently at the exact moment the invariant was most
exposed. **AFTER re-anchoring** to `moveTabIntoNewWindow`: **11/11 pass**, and the `async`
and `await`-between mutations **still fail it** (both assert the mutated reading fires).
A third guard `(c)` was added — the channel must still *reach* the core, so a pin anchored
on a function no handler calls cannot pass. Its mutation (handler stops calling the core,
pair intact, no await) passes guards (a) and (b) and is caught only by (c).

#### DD10 — both readings, every mutation AC

| AC | Instrument | Real | Mutated | Discriminates |
|---|---|---|---|---|
| AC1 | masked `require('electron')` on the zone module | **0** | **1** (electron import) | yes |
| AC1 | masked `screenX\|getBounds\|getPosition\|screen\.` | **0** | **1** (`window.screenX` read) | yes |
| AC1 control | **unmasked** same grep on the real, pure file | **1** | — | **the mask is load-bearing: naive → 1 on prose alone** |
| AC3 | zone at (250,22) vs (250,120), same x | `reorder` idx 1 | `tearOff` | **y changes the answer** |
| AC3 | zone index ≡ `dropIndexFromPointer` ∀ x ∈ [0,800] step 5, ∀ draggedIndex | identical | — | F2 contract intact |
| AC4 | layout-property writes in the drag section | **0** | **1** (`style.width='0px'`) | yes |
| AC4 | layout declarations in `.tab.detaching` CSS | **0** | **1** (`width: 0`) | yes — the JS scan cannot see a class-delivered reflow |
| AC5 | `await`/`async` in the `pointerup` listener | **0** | — | `drag = null` is synchronous |
| AC7 | masked, definition-excluded `cancelDrag()` calls | **7** | **8** (eighth site added) | yes |
| AC7 | naive `grep -c "cancelDrag()"` | **10** | — | **discrimination zero — the draft's error reproduced** |
| AC8 | leg 1's pin vs factored `main.js` | **8/8 → 4/8 FAIL** | 11/11 after re-anchor | yes |
| AC10 | bare `return null;` in the move core | **0** | **1** (sole-tab → null) | yes |
| DD16 | banned coordinate sources across `src/**` | **0** | **1** | yes |

#### Budgets (DD11)

| File | Limit | Actual | |
|---|---|---|---|
| `src/main/main.js` | net **+40** | **+40** (3525 → 3565) | **within, exactly** |
| `src/shared/tab-drag-zone.js` | **120** | **98** | within |
| `src/renderer/renderer.js` | net **+90** | **+117** | **OVER by 27 — reported, not silently taken** |

**The renderer overage is real and I could not close it honestly.** Trimmed from **+177**
to **+117** (58 lines of prose cut). The residue is **66 lines of code and 51 of comment**.
At the F2 drag section's own measured comment:code density of **0.44**, 66 code lines
budget to ~+100; this leg sits at **0.77**. The excess is concentrated in three blocks that
each document a decision a reader would otherwise re-litigate or silently break: DD6's
narrowing (below), AC12's capture correction, and the two-axis threshold defect. **Cutting
them would meet the number by deleting the reasoning.** FD ruling requested: accept +117,
or take a specific block out.

#### Artifacts found wrong

1. **DD16's coordinate ban, read literally, forbids working code.** DD16 says nothing may
   read *"`screenX`, `getBounds`, `getPosition`"*. `src/main/main.js` has **five**
   `view.getBounds()` calls, all predating F8 — and **one of them is inside the move core
   this leg factored** (`const guestBounds = entry.view.getBounds()`, the guest geometry
   seed). They are not the hazard: a `WebContentsView`'s bounds are **window-local**,
   expressed against its own window's content view, and never cross a window boundary.
   What the spike refuted was **`win.getBounds()` / `win.getPosition()`** — a window's
   *origin in screen space*. The DD conflates the two under one identifier. The `src/**`
   ban is therefore pinned at **window-level reads**, and the narrowing is recorded at the
   test rather than taken silently. **Had it been enforced as written, the ban would have
   failed against the flight's own working code.**
2. **DD6's invalidation rule, applied as written, silences the outcome DD5 requires.**
   DD6: *"Any strip mutation (`adopt-tab`, `tab-moved-away`, `closeTab`) clears it."* But a
   tear-off's **own success** arrives as `tab-moved-away` for the pending tab — main sends
   it **before the handler returns**, so it lands **before** the invoke resolves. Clearing
   there makes the drop's own reply read as stale and **no announcement fires on the
   success path** — which is exactly AC6's requirement, defeated by DD6's own cache
   contract. **Narrowed**: strip mutations of a *different* tab clear it; the pending tab's
   own removal does not. DD6's stated worry (*"nothing could ever clear it"*) is unreachable
   regardless — `invoke` always settles and the `.then` always clears.
3. **`pendingDrop`'s `tabId` had no reader until the narrowing gave it one.** ESLint caught
   this: with `dropSeq` as the freshness test, `pendingDrop` was **assigned and never read**
   — dead state that AC5 nonetheless mandates. The narrowing in (2) is what makes both
   fields live (`dropSeq` → freshness, `tabId` → the mutation guard). Worth recording: the
   AC required a structure whose only honest justification arrived from fixing a different
   defect.
4. **F2's arm threshold cannot arm a tear-off, and no artifact says so.** `pointermove`
   gated on `Math.abs(dx) < DRAG_ARM_THRESHOLD_PX` — complete while the only outcome was a
   horizontal reorder, **fatal for tear-off**: a straight-down drag holds `dx` at 0, so the
   gesture never arms and the tab can never leave the strip. The leg names `startY` and the
   zone model but not the threshold that gates both. Changed to `Math.hypot(dx, dy)` —
   strictly more permissive, so every gesture that armed before still arms.

#### Instrument gap — named, not papered over

**AC4, AC5 (rect reading), AC6, AC10 and AC11 ask for RUNTIME readings this leg cannot
take.** They specify a fresh `getBoundingClientRect()` on a sibling, `announceTabStatus`
observed on a refusal, `orderedTabIds()` before/after, `goBack` working. **This repo has no
DOM test harness**: `npm test` is bare `node --test` over `test/unit/*.test.js`, there is no
jsdom or happy-dom, and `main.js` is never executed by a test — only read as text. The leg
also puts behavior specs **out of scope** (leg 5 owns them). So those readings **were not
taken**, and `test/unit/tab-drag-invariants.test.js` says so in its own header rather than
implying coverage it lacks. What it pins instead is the **code shape** each runtime claim
rests on — transform-only writes in JS *and* in the `.detaching` CSS rule, synchronous
`drag = null`, no bare `return null` in the core, a total outcome→message map. **That is a
weaker property, honestly stated. The runtime half is owed to leg 5** and belongs in its
spec: AC11 (same `wcId`, jar intact, live history) is entirely a behavior-test claim and
nothing here touches it.

#### Also

- **AC12 discharged**: the pointer-capture comment claimed capture retargets events to the
  dragged tab. The spike measured `hasPointerCapture()` **false throughout** with `e.target`
  the root. Corrected to what was measured — the listeners are document-level and that is
  the entire mechanism. The `setPointerCapture` call is left in place (harmless; removing it
  is a separate change with its own surface) and the comment now says nothing depends on it.
- **AC2**: `git diff src/shared/tab-order.js` → **empty**. Its 24 tests pass unchanged.
- **AC9**: the menu path narrows the core's discriminated result back to F6's bare `null`,
  which its renderer ignores and `renderer-globals.d.ts` declares. `adopt-tab` still carries
  no index (append). Behavior unchanged.
- **A self-caught overclaim**: the re-anchored pin's mask test was first written asserting
  that `main.js`'s new JSDoc would inflate an unmasked reading. **It does not** — the
  assertion failed on the real file (unmasked and masked both read 3). The claim was
  composed, not measured; the measurement is what is committed, and the mask is kept on
  leg 1's honest ground (free, house idiom, protective) rather than a dramatic one.
- **Gates**: `npm test` **1867 pass / 0 fail** (was 1841 — **+26**); `npm run lint` clean;
  `npm run typecheck` clean. **`npm run a11y` DID NOT RUN** — it needs a live GUI instance
  and an automation admin key (`GOLDFINCH_MCP_ADMIN_KEY`), which this session has no
  apparatus for. It exits 1 on the missing key, **not on a violation**. Recorded as **not
  run**, not as green. Owed before the flight lands.
- `git status --porcelain`: no mutation artifacts. Every DD10 mutation was in-memory.

### Flight Director Rulings on Leg 3

- **`renderer.js` +117 vs a +90 budget: ACCEPTED, and the budget's UNIT was wrong.**
  DD11's purpose is to stop a leg **absorbing scope invisibly**. This leg did the
  opposite: it trimmed +177 → +117 and **stopped and reported**, which is exactly the
  behavior DD11 exists to produce. The residue is **66 code + 51 comment** — 66 lines for
  a zone model, `pendingDrop`, and a threshold fix is lean, and the comment ratio (0.77 vs
  F2's 0.44) is carrying **three measured corrections** that would otherwise be lost.
  **The defect is mine: I budgeted TOTAL lines when the thing I care about is CODE
  lines.** A total-line budget taxes exactly the documentation this flight's whole thesis
  says to write. → DD11 refinement for the debrief.
- **DD16's ban was too wide, and the leg is right — my error.** DD16 banned `getBounds`
  outright. `main.js` has **five `view.getBounds()`** calls, one **inside the move core**
  (the guest geometry seed). Those are **window-local view rects**; the fiction is
  **`win.getBounds()`**, the screen origin. **I conflated a view's rect with a window's
  origin because they share a method name** — *asserting a property from an op's NAME
  rather than its receiver*, which is F7 recommendation 3 with a new receiver-shaped
  variant. **Narrowing accepted**: the ban is on **window-level** origin reads.
- **DD6's invalidation rule was self-defeating, and the leg is right.** *"Any strip
  mutation clears `pendingDrop`"* — but **a tear-off's own success arrives as
  `tab-moved-away` BEFORE the reply lands**, so the drop's own reply would read stale and
  **nothing would announce on success**. DD6's rule would have defeated **AC6, the AC
  written to fix the announcement bug the design review caught.** Narrowed to
  **different-tab** mutations. *(DD6's stated worry — a stale reply acting on the wrong
  tab — is unreachable anyway: `invoke` always settles.)* **Third time a mitigation I
  composed was aimed at an unreachable hazard while creating a reachable one.**
- **Leg 3's guard (c) is an improvement on leg 1 and is adopted.** Leg 1 pinned (a) the
  anchor exists and (b) the pair is inside it. Leg 3 found the gap: **a mutation where
  the handler stops CALLING the core passes both** — pair intact, no await, anchor
  present — and is caught only by **(c) the channel must still reach the core.** Leg 1's
  vacuity guard fired exactly as designed (**4 of 8 failed**, naming the missing pair);
  guard (c) is what the design didn't anticipate.
- **The instrument gap is named, not papered over — and this is the leg's best judgment
  call.** AC4, AC5's rect reading, AC6, AC10, and AC11 ask for **runtime** readings.
  **This repo has no DOM harness** (bare `node --test`, no jsdom; `main.js` is never
  executed, only read). Those readings **were not taken.** The leg pinned the **code
  shape** each rests on and **said so in the test header rather than implying coverage**.
  **AC11 (the torn-off tab keeps wcId/jar/history) is entirely leg 5's** — it is DD2's
  claim and the mission's absolute constraint, and **nothing in this leg proves it.**
  > **I wrote five ACs whose instrument does not exist in this repo.** The leg spec
  > demanded runtime readings from a leg that can only read source. That is the
  > **observability half of the `/flight` premise audit** — *"can the apparatus OBSERVE,
  > through an existing surface, everything the acceptance criteria must assert?"* —
  > skipped at leg design, surfacing exactly where the skill warns it will: as a
  > mid-flight scramble. The leg handled it correctly by **declining to claim** the
  > readings; a worse implementer would have asserted the code shape and ticked the AC.
- **`npm run a11y` DID NOT RUN, and the reason matters.** It needs a live GUI + admin key
  and **exits 1 on the MISSING KEY, not on a violation** — so a red exit code here means
  *"no instrument"*, not *"a11y is broken"*, and an unwary reader would take it for a
  violation. **Discrimination zero between "not configured" and "failing."** Recorded as
  **owed before the flight lands** (leg 5 has the live rig). → maintenance item: the a11y
  script should exit distinguishably.

---

### Leg 4 — `04-keyboard-cross-window-move`

**Status: landed.** The cross-window move ships by keyboard-reachable menu: flat
"Move to window …" items keyed by `windowId`, over leg 3's move core, with the
stale-window refusal via `registry.get`. No coordinate anywhere. **This carries the
mission criterion's surviving substance** (the criterion's *gesture* stays unsatisfied —
leg 2's re-scope).

#### Phase 0 — audit of the leg's premises, before any code

**DD8 is CORRECT in every particular, and this is the second artifact in the flight's
lineage to audit clean.** Both design reviews converged on it without writing the code;
the code agrees with them.

| Claim | Verdict | Reading |
|---|---|---|
| The *"never learns windowId"* sentence lives in **`main.js` + `automation/tabs.js`**, NOT `window-census.js` | **TRUE** | `main.js:270`, `automation/tabs.js:63`. Zero hits in `window-census.js` |
| It is an **AUTHORITY** rule about **census aggregation**, not confidentiality | **TRUE** | `tabs.js:63`: *"THE REGISTRY IS THE OWNERSHIP AUTHORITY… that filter is what makes a double-count STRUCTURALLY IMPOSSIBLE across N non-atomic round-trips"*. DD8's quote is **verbatim**, not paraphrased |
| `window-census.js` **emits** `windowId` | **TRUE** | `window-census.js:102`, `windowId: rec.win.id` on every row |
| `tab-move-to-new-window` **returns** `{ok, windowId}` to the chrome renderer | **TRUE** | `return r.ok ? r : null` over `{ ok: true, windowId: target.win.id }` |
| `renderer-globals.d.ts` **declares** it | **TRUE** | `Promise<{ ok: boolean; windowId: number } \| null>` |
| Leg 3's move core exists, is **synchronous**, pinned with guards (a)(b)(c) | **TRUE** | `function moveTabIntoNewWindow(source, p) {`, no `async`/`await`. Pin **11/11** at leg start |
| `tab-context-model.js` omits at `!isLastTab && !isInternal` (**both**) | **TRUE** | verbatim at the `tab:move-new-window` site |

**One undercount, immaterial to the ruling:** DD8 names **two** homes for the sentence;
there are **three** — `automation/engine.js:58` carries *"stamps windowId from the REGISTRY
(the renderer never learns it)"*. All three are census aggregation and **none** is chrome
IPC, so the third site **strengthens** DD8 rather than qualifying it.

#### AC3 was NOT expressible as the leg specified it — found in Phase 0, fixed before code

The leg's Outputs put the **window-list builder in `main.js`**. AC3 requires mutating the
registry **between build and dispatch** and reading the result. **`main.js` is never
executed by any test** — `grep -rn "require(...main/main...)" test/` → **no matches**; it is
only ever read as *text* (leg 3's finding, re-measured, unchanged). A builder there could
be inspected, never *run*: AC3's mutation would have been undischargeable, and the honest
move would have been to assert code shape and tick it — the exact failure the FD praised
leg 3 for refusing.

**Fix, taken before writing code:** the builder is a pure, Electron-free
`src/main/move-targets.js` — the **`window-census.js` precedent exactly** (duck-typed over
records, zero state, `main.js` keeps a one-line seam). AC3 is now run against the **real**
`createWindowRegistry`, and it **discriminates**:

> build → user picks window **B** → **B closes** → windowId-keyed dispatch: `registry.get`
> → **null** ⇒ **refuse**. Ordinal-keyed dispatch on a rebuilt list → **C**, a *different*
> window, silently. **The two readings disagree. That disagreement is the whole reason the
> ordinal scheme was deleted**, and it is now a committed test rather than a design claim.

#### The leg is SILENT on delivery, and that was the real design gap

The leg says *"main sends `{windowId, label}[]`"* and never says **how** it reaches a
renderer whose menu opener is **synchronous**. This is not free: **F6 DD6 deliberately
DELETED the async opener** (*"the F5 async opener, its cross-type stale-resolve edge, and
the tabCtx.tabId re-check guard are all deleted with the await"*). An invoke at open time
would have **reverted a shipped DD** — not a leg's call to make.

**Taken: the F6 DD6 push-cache precedent**, `closed-tab-stack-changed`'s exact shape —
per-record payloads (each chrome gets the list with **its own window excluded**), a
`move-targets` boot-seed invoke, and pushes at the four sites that change a caption
(window create, window remove, active-tab change, active tab's title change).

**Why a cache is safe HERE, and it is DD8's own logic paying out:** only the **LABEL** is
cached. The `windowId` is re-resolved through `registry.get` and re-validated against the
sender's record at dispatch, so a **missed invalidation degrades to a stale caption** —
visible, cosmetic, self-healing on the next push — and **cannot mis-target**. An
ordinal-keyed list with a missed invalidation would move the tab into the **wrong window**.
The windowId-over-ordinal reversal is what makes the cache cheap to reason about.

#### DD10 — both readings, every mutation AC

| AC | Instrument | Real | Mutated | Discriminates |
|---|---|---|---|---|
| AC1 | `buildMoveTargets`, 1 window | **0** targets | 3 windows → **2** | yes |
| AC1 | `tabContextModel`, `moveTargets: []` | **0** items | 2 targets → **2** items | yes |
| AC1 | asked from **B** rather than A | **A, C** | — | the SOURCE is excluded, not `records[0]` |
| AC2 | **masked** `require('electron')` on `tab-context-model.js` | **0** | **1** (import added) | yes |
| AC2 control | **unmasked**, same grep, real file | **0** | — | **the mask is NOT load-bearing here — measured, not assumed** |
| AC3 | build → pick B → B closes → `registry.get(picked)` | **null** ⇒ refuse | ordinal-keyed → **C** | **yes — the readings disagree** |
| AC3 | records reordered `[A,C,B]` | ordinal 0 → **C** | built id still → **B** | yes |
| AC4 | `registry.get(closedId)` | **null** | live → the record | yes |
| AC5 | source from `event.sender`, real `main.js` | **1** | payload-as-source → **0** | yes |
| AC5 | destination via `registry.get(wantedId)` | **1** | cached-target → **0** | yes |
| AC5 | distinct `payload.*` reads in the handler | **`['payload.windowId']`** | — | the payload requests; it never claims |
| AC5 | **masked** `payload.windowId` | **2** | **unmasked → 3** | **yes — the mask IS load-bearing here** |
| AC6 | core reason union, read off `main.js` | `no-tab, internal, sole-tab, no-target` | — | `no-target` is leg 4's addition |
| AC8 | `git diff --stat` on the LOCKSTEP PAIR | **empty** | — | no chord added; the pin is not engaged |
| AC9 | `grep -c tab:move-new-window` | **3** before → **4** after | — | both ≥1; the F5/F6 path is not re-invented |
| AC10 | `npm run typecheck` | **green** | declared `windowId: string` → **`TS2322` at renderer.js(737,11)** | yes |
| pin | leg 1/3's synchrony pin vs the renamed core | **11/11 → 9/11 FAIL** | 11/11 after re-anchor | yes |

**Every mutation was in-memory or reverted. `git status --porcelain` carries no mutation
artifact** (the one file mutation — the `.d.ts` AC10 reading — was backed up and restored;
`grep -c "windowId: string"` → **0**).

#### THREE independently-anchored scans fired on one rename, and none was silent

The core gained a third caller that does **not** create its target, so it was generalized
over `resolveTarget` and renamed `moveTabIntoNewWindow` → **`moveTabIntoWindow`** (the old
name becomes a lie the moment the target stops always being new). **The pair never moved** —
leg 4 deliberately kept it inside one synchronous function rather than factoring a second
time — so guard (b) was untouched. What fired:

1. **`move-tab-synchrony.test.js` guard (a)** — **9 of 11 failed**, naming the missing anchor.
2. **`tab-drag-invariants.test.js`'s AC10 scan** — *"the move core is gone — re-anchor this
   scan"*. A **separate** anchor on the same subject, and it refused to scan an empty string
   and report a comfortable zero bare nulls.
3. **`tab-drag-invariants.test.js`'s `dragSection`** — *"the drag section bounds moved"*, when
   the message-map merge renamed its closing landmark.

**All three re-anchored; none deleted.** The anchor count is bumped **3 → 4** (1 definition +
menu, tear-off, cross-window), which the pin's own message invites once the new call site is
checked. **This is the leg-1 design's third consecutive loud catch, and the second in a row
where the guard mattered more than the assertion.**

#### Artifacts found wrong / decisions worth recording

1. **The leg's Outputs are wrong about the builder's home** (`main.js`) — it makes AC3
   undischargeable. Corrected to a pure module; see above. **The leg spec repeated the
   observability half of the premise audit that leg 3's FD ruling already flagged**: it
   demanded a reading the named instrument cannot take. Third leg running.
2. **The leg omits the delivery mechanism entirely**, and the obvious reading (invoke at
   open) silently reverts F6 DD6. Recorded rather than taken.
3. **`push-cache.js` was `number`-typed** and could not hold the target list — the typecheck
   gate says so. Widened to `@template T`; **behavior unchanged** and still pinned by
   `push-cache.test.js`.
4. **Two files the leg's Outputs do not name had to change**: `chrome-preload.js` (the
   bridge — a renderer cannot invoke a channel with no bridge) and `push-cache.js`. Neither
   is scope creep; both are unavoidable and were missing from the leg.
5. **A self-caught overclaim, the leg-3 tradition.** `move-authority.test.js`'s mask test was
   first written asserting masked `payload.windowId` → **1**. It **failed on the real file**:
   the one guard expression reads the field **twice** (`typeof payload.windowId === 'number'
   ? payload.windowId : null`). Masked **2**, unmasked **3**. The claim was composed from what
   the code ought to look like; **2 is what it looks like**, and the measurement is what is
   committed.
6. **A second self-caught overclaim, and it changed the code.** Leg 4 first wrote a *second*
   outcome→message map beside leg 3's, justified in its own comment as *"the reason vocabulary
   overlaps but every message differs"*. **Held against the two drafts, that is false** — they
   are the same sentences over a different destination. Merged into one `moveOutcomeMessage(
   result, dest)`, which is the argument **the move core itself makes one screen up** (share
   ONE move, not two transcriptions). The invariants pin is correspondingly **one** scan
   instead of two that could drift. *(It also brought `renderer.js` from +34 to +23 against a
   +25 budget — but the merge is right on its own terms; the budget is how it got noticed.)*
7. **The a11y audit hook would have audited a menu missing leg 4's item type.**
   `openTabContextMenuForAudit` builds a *representative synthetic* model, and the live
   move-target cache is **empty in a one-window app** — so an audit reading it would render no
   "Move to window …" item and report **clean on a menu that does not contain the thing being
   audited**. Seeded with a synthetic target. **Leg 5 runs `a11y`; it now exercises the shape.**
8. **A refused cross-window move must not close the source's find session.** The target is
   resolved and refused **in the handler** (`registry.get` is a pure lookup with no side effect
   to defer), *before* the core runs — the core's `resolveTarget` thunk exists so that the two
   **creating** callers cannot orphan an empty window behind a refused move.

#### Instrument gap — named, not papered over (leg 3's precedent, upheld by the FD)

**AC4, AC5 and AC6 specify RUNTIME readings this leg cannot take, and AC7 is explicitly
leg 5's.** *"Live target → moves"*, *"tab unmoved"*, *"→ refused"*, *"`announceTabStatus`
called"*, *"index in `orderedTabIds()` unchanged"* — every one needs a DOM or main harness.
**This repo has neither**: `npm test` is bare `node --test`, no jsdom, and `main.js` is never
executed. **Those readings were NOT taken and the ACs are NOT ticked.** What is pinned
instead is the **structure** each rests on — the sender-resolved source, the registry-resolved
destination, the single-field payload read, and an outcome map **total by construction** with
both call sites going through it. That is a weaker property, honestly stated. **AC7 (same
`wcId`, jar intact, live history) is untouched by this leg — it is DD2's claim and the
mission's absolute constraint, and nothing here proves it.**

#### Budgets (DD11 — CODE lines, comments excluded, per the leg-3 refinement)

Measured against a **reconstructed leg-3 baseline** (legs 1–3 are uncommitted, so
`git diff HEAD` would have billed leg 4 for their lines). The reconstruction is
**validated**: it lands `main.js` at exactly **3565** lines, the leg artifact's stated
leg-3 end state.

| File | Limit | Actual (net CODE) | | net comment |
|---|---|---|---|---|
| `src/main/main.js` | **≤ +45** | **+32** | within | +97 |
| `src/shared/tab-context-model.js` | **≤ +30** | **+5** | within | +23 |
| `src/renderer/renderer.js` | **≤ +25** | **+24** | within (was +34 → merged the duplicate map) | +43 |
| `src/main/move-targets.js` | (new) | **31** | — | 66 |

#### Gates

- `npm test` — **1892 pass / 0 fail** (leg 3 landed **1867** — **+25**)
- `npm run lint` — clean
- `npm run typecheck` — clean
- **`npm run a11y` DID NOT RUN** — deliberately, per the FD's leg-3 ruling: it needs a live
  GUI + admin key and **exits 1 on the MISSING KEY, not on a violation**, so its red is
  uninformative here. **Not run ≠ green.** Leg 5 owns it with the live rig, and the audit
  hook now renders the item for it.
- `git status --porcelain` — no mutation artifacts.

### Flight Director Rulings on Leg 5 Part A

- **The 16 stale-DATE headers → F10, not F8.** The leg was right to stop. Several carry
  **hand-curated verdicts** (`mcp-jar-scoping`: *"Supersedes the 2026-06-14 partial"*;
  `settings-shell`: *"12/12"*), and a sweep timestamp **destroys information** a human
  wrote. F10 re-runs every mission spec with the operator, so it writes each header true
  **with a real verdict attached** — the only way to fix these without loss. The leg's
  suggested preserving form is adopted: `**Last Run**: <newest> (<verdict>). Prior clean
  full run: <old> (<verdict>).`
- **The unowned obligation is the FD's, and the leg was right to refuse it.** *"F8 must
  record in the mission that it added 11 specs to F10's walk"* sat in the leg's **Out of
  Scope** with no AC anywhere — **a deferral that created no obligation in any target**,
  which is precisely F7 recommendation 5's rule (*"deferrals must create an AC in the
  target leg"*) broken by the flight that adopted it. **An unowned deferral is exactly
  how AC27 reached this flight.** The FD records it directly (below).
- **Mission Known Issues was EMPTY** while this flight's own log had already ruled
  *"→ mission known issue"* for V7's blur gap. Recorded by the FD, with the a11y item the
  leg added.

**Three findings from Part A that outrank the work it was asked to do:**

1. **DD12's scan instrument was itself a proxy — the recursion's fifth generation.**
   DD12 enumerated 10 specs carrying `Last Run: never`. **`toolbar-pins` has no `Last
   Run` field at all**, over a genuine passing run. **A grep for the value `never`
   structurally cannot find a missing header.** DD12 measured the specs it could see with
   an instrument blind to the worse case — *"a `never` header is at least honest about
   its ignorance; an absent one isn't there to be wrong."*
2. **The true drift is 28 of 48 specs, not 11.** The `never` sub-class is *"merely the
   greppable tip."* DD12 corrected the debrief's five → its own 10-12 and stopped where
   its grep stopped. **Every correction in this lineage has been bounded by the
   instrument that found it**, and none has said so.
3. **AC8 committed the error it diagnoses, in its own title — the FD's, third
   generation.** AC8 is headed **"REPO-WIDE"** and instructs *"Scan `missions/**`."*
   **Four leaked lines live outside `missions/**`** (`tests/behavior/`). F7 scoped the
   scrub to **one file**; the FD widened it to `missions/**` and **called that
   repo-wide**. Since it is an **apparatus failure mode** — it recurs wherever a long file
   is written — spec files were always in scope. **Each generation widened the scope and
   re-asserted completeness at the new boundary.** True total: **9 lines / 6 files**, all
   scrubbed, re-scan clean.

> **The unifying lesson, and F8's second portable product** (after *"a read-back is not a
> second reading unless it is a second instrument"*):
>
> **Every correction inherits its predecessor's blind spot unless it changes
> instruments.** Five generations — F7's debrief (read a header), F8's recon (read the
> debrief), the spec's correction block (read the recon), DD12 (grepped a value), AC8
> (scanned a directory) — each *fixed the content* its predecessor got wrong **while
> keeping the instrument that made the error possible**, and each then **asserted
> completeness at its own instrument's boundary.** The word "repo-wide" over a
> `missions/**` scan is the purest form: the scope claim and the scope are in the same
> sentence, and they disagree.

---

### Leg 5 Part B

**Scope: AC1–AC6** (AC7–AC12 were Part A's). **All six discharged.** Four behavior runs, each
Witnessed with an **independent** Validator judging every checkpoint.

| Spec | Verdict | Filing |
|---|---|---|
| **`tab-tearoff`** (NEW) | **9/9 PASS** | **`partial`** — 2 spec-instrument errata folded mid-run; clean re-run OWED |
| **`multi-window-shell`** (F7's owed re-run) | **9/9 + both variants PASS** | **`partial`** — erratum 2 residue; **V1/V2-only** re-run OWED |
| **`tab-reorder`** (F2 regression net) | **8/9 PASS**, Step 4 **INCONCLUSIVE** | **`partial`** — Step 4 cannot fail |
| **`tab-context-menu`** | **10/10 PASS, no repairs** | **`pass`** |

#### The readings legs 3 and 4 could not take — DD2 is MEASURED

> **T2 kept `wcId 4` and jar `work` across the tear-off; only `windowId` changed (1→2).
> `history.length` held at 2, and `goBack` (polled, 52ms) landed on page 2 with BOTH committed
> markers. T1 repeated the triple through the KEYBOARD door (`wcId 3`, jar intact, history 2,
> `goBack` → page 1).** `multi-window-shell` step 5 corroborated independently: the moved tab kept
> **wcId 4** where a recreate would have minted ≥10 — **step 8's reopens mint 11 and 12 on that very
> path, so each is the other's control.**

**Leg 3's AC11 and leg 4's AC7 are discharged.** **No `'Move canceled'` on either success path** —
including the keyboard path **DD6 names as the worst case** for it.

**DD2's refutation is TWO independent observables, not three — my overclaim, caught by the
Validator.** A tab recreated **in the same partition** reads `jarId: 'work'` identically, so **the jar
leg refutes nothing about recreation**; it discharges a *different* mission constraint. Folded.

#### AC2 — the negative held, and the honest gap is wider than the flight admitted

The spec states the cross-window-drag gap **and its measured reason** in its own text and verifies
**no** subset of it. **But the flight's *"tear-off (single-window) remains fully verifiable either
way"* is an OVERCLAIM** — the same species F8 exists to prevent — and the spec now records the
correction: `dragPointer` injects into the chrome's webContents, so it is delivered **regardless of
what native surface is over the drop point**. Whether a **real** pointer dragged **over a guest's
native surface** keeps delivering to the chrome renderer is **V1's question at a shorter distance,
and V1 is UNMEASURED (→ HAT)**. **Mitigation, and it is why row 4's drop point is what it is**: the
release lands in the **chrome-owned band** between the strip's bottom and the guest's top, where the
synthetic and real paths **coincide**. Measured live: **band = y ∈ (39, 89), 50px, non-empty.**

#### The pre-run premise audit is the leg's main methodology result

**Before any checkpoint ran**, the Executor and the independent Validator **each** audited the draft
`tab-tearoff` against source and returned **six** defects — every one of which would have produced an
uninterpretable result. Two were found **independently by both**. Highlights:

- **`el.dataset.tabId` does not exist** (the renderer writes `dataset.id`). `JSON.stringify` drops
  undefined-valued keys ⇒ **every tab returns unidentifiable while the rects stay correct** — the
  rows would have *looked* live and identified nothing.
- **The recorder as drafted re-read `textContent`**, so a batched MutationObserver delivery pushes
  **one final value** — **silently reinstating the exact final-value blindness it exists to defeat**,
  and destroying row 4's positive control.
- **Row 3 dropped exactly ON `dropIndexFromPointer`'s strict-`>` tie** ⇒ no reorder ⇒ **failure as a
  spec artifact**, non-deterministically (sub-pixel: `dragEvents` rounds, and the zone is decided by
  the last `pointermove`).
- **"Only `y` differs" was literally unsatisfiable** (`hypot(dx,dy) < 5` forbids dx=dy=0) — fixed by
  giving rows 3/4 a **common `DROP_X`**, making the control **true rather than aspirational**.

**These were pre-first-run corrections to a `draft` spec = AUTHORING, not drift** — and they are
**not** why `tab-tearoff` filed `partial`. **The two errata found DURING the run are.**

#### Why three of four specs filed `partial` — and the distinction that separates the fourth

**The recurring shape, and it is now this flight's second most portable product:**

> **An instrument's TARGET gets repaired while its DISCRIMINATION is never examined.**

- **`tab-tearoff`**: my recorder never `disconnect()`s, so **N arms ⇒ N observers ⇒ N pushes per
  single announcement** (×4 by step 8). Rows 4/6 read `EXACTLY ['…']` **only by luck** — each was the
  first arm on its chrome. **Proved instrument-not-product two ways**: calibration against a known
  stimulus (`probeMultiplier`, **re-probed per step, never carried forward**), and a single-observer
  timestamp — **one observer logs one record; a real double-announce logs two.** *(And the real
  masking hazard is the **DEDUP**, not the multiplier: collapsing consecutive identicals cannot tell
  1 real announcement from 2 — **final-value blindness one layer up**.)*
- **`multi-window-shell`**: **erratum 2 was folded by NAMING and never by MEASURING.** F7 moved the
  pixel clause from the chrome wcIds (**vacuity-by-ABSENCE** — showed no menu) to the sheet wcIds and
  landed on **vacuity-by-INDISTINGUISHABILITY**: captures are **byte-identical** across the two
  sheets (`md5 d9e34c95…`), **and a HIDDEN sheet captures fine** ⇒ **it could not fail.** Deleted.
- **`tab-reorder` Step 4**: reads `window.screenX` → **564** — **the exact value this flight's spike
  proved a cached fiction** against the Win32/RAIL witness. Its WSLg hatch fires only on *"a constant
  placeholder (e.g. always 0)"* — **calibrated to the wrong tell: the failure is FROZEN, not ZERO.**
  **`{0,0}` is obviously wrong on sight; `564` is not** — this flight's thesis, arriving in a spec
  written before it, and *scoring a hard PASS on a literal reading.*
- **`tab-context-menu` filed `pass`**, and the Validator's distinction is why:
  > **A coverage gap OF a spec** (a property no row claims) **is not a nothing-discriminating clause
  > WITHIN it** (a row that claims a property and cannot fail). **The first is an honest boundary;
  > the second is a false witness.**

#### Two gaps found by reading artifacts against each other — neither is visible from one file

1. **NOBODY owns the `Math.hypot` arm threshold.** `tab-reorder`'s only drag holds y constant
   (`dy=0` ⇒ `hypot(dx,0) ≡ abs(dx)`); **`tab-tearoff`'s rows 3/4 share a common `DROP_X`** (`dx≠0`
   ⇒ arms under `abs` too — **the very device that makes them a clean control blinds them to the
   threshold**); and **no unit test references `hypot` or `DRAG_ARM_THRESHOLD_PX`**. ⇒ **the
   straight-down case (`dx=0, dy>5`) that `renderer.js` names as the REASON for the change is
   unfalsified by the entire suite.** `tab-tearoff` **claimed `tab-reorder` owned it** — corrected.
   **An ownership gap where each spec believed the other held it.** → **unit test, owner F9.**
2. **DD8's coverage is a CROSS-SPEC pair.** `tab-context-menu` holds the **absence** side (one window
   ⇒ item omitted) — **unfalsifiable alone**: it reads identically whether the gate works, the
   `move-targets` push is broken, or **the DD8 loop was never written.** `tab-tearoff` row 8 holds
   the **presence** side. **Neither covers DD8 alone; together they do.** Recorded in **both** files.

#### What is OWED, scoped — with owners

| Debt | Scope | Owner |
|---|---|---|
| `tab-tearoff` clean re-run | full spec (stays `draft` until it passes) | next flight touching tear-off/the strip — **F9** by default |
| `multi-window-shell` | **V1/V2 ONLY.** Steps 1–9 are **PROVEN and owe nothing** | **F9** (F10 if it walks first) |
| `tab-reorder` Step 4 | re-instrument against a **second instrument** (Win32/RAIL) **or delete** and record as unverifiable. **Do NOT fix the hatch's zero-test — the tell is *frozen*, not *zero*** | **F9** |
| `Math.hypot` threshold | a **unit** test (`dx=0,dy=6` arms; `dx=0,dy=4` does not) — **not** another live drag | **F9** |

#### FD errors, recorded

1. **I ordered `multi-window-shell`'s variants "after the main table" — step 9 QUITS the app, so that
   slot cannot exist.** Re-run as a variant sub-run on a fresh rig (the Validator ruled the two-rig
   split **sound**: the variant is **state-scoped, not process-scoped**). **The Validator declined to
   let me file it as purely my error** — the section's in-band *"Run after Step 4"* contradicts its
   out-of-band position after a quitting step 9, so **it is unrunnable in document order**. Same
   defect class as the errata: shape disagreeing with content.
2. **I briefed both crews that "chrome and sheet targets never activate." The sheet is NOT chrome** —
   `isChromeContents` covers only *registered* chrome, so the sheet classifies **`'guest'`** and
   **does** enter the activate branch. It is safe only because `chromeForTab(sheetWcId)` → null ⇒
   `activateTab` returns `false`. **Same conclusion, different mechanism — and the mechanism matters**,
   because the safety rests on the **overlay branch**, not on classification. Both crews corrected me
   and then **confirmed it empirically**.
3. **I leaned `pass` on `multi-window-shell`; the Validator filed `partial` over me, and was right.**
4. **I proposed accepting `tab-tearoff` step 9's first `UNREACHED-AS-SPECIFIED`.** The Validator read
   both files and showed it was a **script bug** (`itemAfter.w` where the rect is `itemAfter.r.w`;
   `undefined > 0` is always false) — **attempt 1's own evidence refutes its stated reason.**
   > **An escape hatch that fires on a false negative is MORE dangerous than no hatch**, because
   > `UNREACHED` reads as a clean non-result rather than a defect. **Had it stood, DD8's reversal
   > would have been filed as environmentally unreachable.** A run must **evidence the hatch's own
   > trigger**, not merely assert it.

#### Rig notes

- **The WSL2 blind spot reproduced live, unprompted**: ports **49760/49761/49762/49770** bind-probed
  **TAKEN** while `ss -ltn` **saw nothing on them at all.** The precondition is now demonstrated, not
  cited.
- A **pre-existing `:8000`** server was already serving the **committed** `tests/behavior/fixtures/tabstrip/`
  set — **used read-only, never stopped**, which let `multi-window-shell` run at its **written**
  fixture port with **no deviation at all**.
- `tab-reorder` and `tab-context-menu` ran **concurrently** on separate rigs/profiles with **no
  cross-talk** (`sendInputEvent` injects per-webContents; `lastFocused` is main-side tracked).
- **Admin keys by env-var reference only, never a literal. Zero operator-identity leaks across 118
  evidence files.** All evidence ephemeral, outside the project tree, **uncommitted**.

---

### Flight-End Review Fixes

**Scope**: 1 HIGH + 4 lesser findings from the flight-end Reviewer. **Every claim was
re-verified against source before acting on it** — the standing rule for this lineage, and it
earned its keep: **one finding was wrong in the direction that matters**, and it was wrong by
reproducing this flight's own diagnosed failure class.

#### HIGH 1 — CONFIRMED against source, and fixed. Two `active: true` tabs after a move into an EXISTING window

**Verified, not inherited.** `moveTabIntoWindow` pre-sets `target.activeTabWcId = p.wcId`
(main.js, right after the delete/set pair). `ipcMain.on('tab-set-active')` is the **only** other
place that hides an outgoing guest, and its hide-old branch is gated on
`owner.activeTabWcId !== null && owner.activeTabWcId !== wcId`. By the time the adopt round-trip
(`adopt-tab` → `onAdoptTab` → `activateTab` → `tab-set-active`) arrives, that guard is **already
false** — so the branch is skipped, the displaced tab keeps `active: true`, and its view stays
`setVisible(true)` behind the moved one. `enumerateTabs` reports **TWO** `active: true` rows for
the target window (`automation/tabs.js`: `active: !!t.active`). **The core disarmed the very
guard it was delegating to.**

**Why the whole flight missed it, and the shape is worth keeping:**

| Instrument | Why it could not fail |
|---|---|
| Unit tests | **`main.js` is never executed by any test.** Measured: `grep -rl "require.*main/main" test/` → **exit 1, zero files.** |
| `tab-tearoff` rows 3–7 | Tear-off targets a **`noBootTab`** window — `activeTabWcId === null`, so there **is** no outgoing tab. **Structurally unable to fail this way.** |
| `tab-tearoff` row 8 (the one row that *does* drive the path) | It asserted the **moved** tab's identity triple and **never asked what became of the tab it displaced.** |
| Pixels (`captureScreenshot`) | At equal window sizes the moved tab **completely covers** the stale guest ⇒ **byte-identical capture either way — discrimination zero.** |

> **A row that drives the defective path is not coverage of it.** Row 8 ran the exact gesture,
> passed honestly, and asserted the wrong half. **The gap was never in which path was driven —
> it was in which observable was read**, and no amount of re-running row 8 would have found it.

**The fix** reads the outgoing entry **before** the overwrite and hides it **synchronously**:

- **Stays synchronous.** No `await` introduced; the delete/set pair's adjacency is untouched, so
  `move-tab-synchrony.test.js`'s between-slice is unaffected. **The pin still passes 11/11**, and
  its `async`/`await-between` mutations still fail it.
- **Guarded with `isDestroyed()`** before touching the webContents — an uncaught throw here
  wedges the Wayland close path permanently with zero output (the F6 leg-4 root cause). The
  `active` flag is corrected **either way**: it is main-side state and outlives its view.
- **`prevActive !== entry`** guards the (unreachable) self-move; `target !== source` is already
  refused upstream and a wcId lives in exactly one record.

**The regression net is a BEHAVIOR row, and here is the honest reason.** `main.js` is unreachable
from a unit test (measured above), and `moveTabIntoWindow` is module-private in a file that
requires `electron` at the top level. **So the source-scan option was available and was refused**:
pinning the shape of the fix would assert that the lines exist, not that the window reports one
active tab — *and that is this flight's diagnosed failure class, in the fix for a defect that
class produced.* Added **`tab-tearoff` row 8a** (new; row count **9 → 10**) against the real
observable:

- **Reading**: after row 8's adopt into W2, `enumerateTabs()` filtered to W2 returns **exactly two
  rows**, **exactly one** with `active: true` — **T1** — and **T2 reads `active: false`**.
- **The failing reading is `2`**, which is precisely what the un-fixed core produces.
- **The row carries its own positive control**: the assertion is the **pair**
  `{T1: true, T2: false}` **from a single call**, not the bare count *one*. Both values appear, so
  the flag is provably not stuck-true. A row asserting "one active tab" against a window holding
  **one** tab would pass on an instrument that always returns `true` — which is why 8a runs
  **after** row 8 and never before it.
- **The row forbids a screenshot** and says why: pixels are byte-identical across the bug.
- **UNRUN, and the spec's header now says so** in its own text — the 9-checkpoint verdict is the
  first run's and is not a verdict on 8a. **Its first reading is owed with the clean re-run
  already booked to F9.** *(The fix ships on source reasoning; the row is the falsifier, and
  filing it as green without running it would be the same lie in a new place.)*

#### MEDIUM 2 — CONFIRMED, and the miss is worse than the Reviewer measured

`BANNED_RE` enumerated **spellings** where DD16 bans a **hazard**. Widened to
`\bscreenX\b|\bscreenY\b|\bwin\.getBounds\(\)|\bwin\.getPosition\(\)|\bscreen\.` —
`\b` matches after `.` and after whitespace alike, so `window.screenX`, `e.screenX` and bare
`screenX` all fall to **one token**, and the module ban is on `screen.` rather than three of its
members.

**Both readings, measured on the real `renderer.js` — old regex vs new, same masked source:**

| Mutation at the real site | OLD | NEW |
|---|---|---|
| *(real file, no violation)* | 0 | **0** |
| `e.screenX, e.screenY` — **the predicted reintroduction** | **0 — MISSED** | **2** |
| bare `screenX + e.clientX` (no `window.` prefix) | **0 — MISSED** | **1** |
| `screen.getPrimaryDisplay()` | **0 — MISSED** | **1** |
| `screen.getDisplayNearestPoint()` | **0 — MISSED** | **1** |
| `window.screenX` — *the easy case* | 1 | 1 |

**The old regex caught exactly one spelling: the one its own mutation control used.** Its "both
directions" reading demonstrated discrimination **only where it could not fail** — this flight's
thesis, in the guard written to enforce it.

**The mutation control is extended to `e.screenX` at the REAL site** — `renderer.js`'s
`pointermove` handler, feeding `classifyDragPoint`, where `e` is already in scope and `e.clientX`
(the **allowed** window-local read) sits **on the same line**. A one-word edit that reads entirely
natural. A second control covers the module ban via `screen.getCursorScreenPoint()`.

**False positives: MEASURED, not assumed** (the scan is masked, so prose mentions are invisible).
Masked hits across `src/**` for every new alternative → **0**. `renderer.js`, `tab-drag-zone.js`
and `renderer/pages/jars.js` each name these words **in comments only** — all masked out.

#### MEDIUM 3 — CONFIRMED. The deferral had no mission-level entry

`flight.md` ended *"Mission-level entry required."* and nothing was ever written. The criterion
sat as a bare `[ ]` — **indistinguishable from *not yet reached*.** Fixed at both places:

- **The criterion** now carries the deferral inline: attempted at F8, transport measured dead,
  **the drag is the criterion's subject** so it stands **UNSATISFIED** — while recording that the
  A→B move with jar identity and page state **does** ship by keyboard. *"Do not schedule this as
  ordinary pending work."*
- **A Known Issues entry** (matching the a11y entry's form) records what a bare `[ ]` destroys:
  the transport was refuted by a **second instrument** (Win32/RAIL vs Electron's self-report);
  **candidates 1 and 3 are dead for ONE shared reason** — both need app-level global coordinates —
  **so their deaths are not independent evidence**; and **candidate 2 (HTML5 drag with a custom
  MIME) was foreclosed by omission and never measured**, which matters because it is **the only
  candidate needing no app-level coordinate at all — the browser owns the transport** — and is
  therefore **structurally immune to the failure that killed the other two.** **Owner: a future
  flight, gated on an HTML5-drag spike** that must use a second instrument and return an explicit
  **GO/NO-GO**. *A NO-GO is a real outcome; planning the drag again on an unmeasured transport is
  not.*

> **F9's planner would have read an ordinary pending checkbox with no signal a spike was owed** —
> two states, one reading, on the artifacts of the flight whose thesis that is.

#### LOW 4 — CONFIRMED that leg 3 contradicts its log. **But the Reviewer's tick list is WRONG, and wrong in this flight's own failure class.**

The Reviewer directed: *"the flight log explicitly discharges AC1, AC2, AC3, **AC4**, **AC5**,
AC7, AC8, AC9, **AC10**, AC12 **with both readings**."* **It does not.** The log's *Instrument
gap* section — 40 lines below the DD10 table — and the **FD's own ruling on leg 3** both say the
opposite, in as many words:

> *"AC4, AC5's rect reading, AC6, AC10, and AC11 ask for **runtime** readings. **Those readings
> were not taken.** The leg pinned the **code shape** each rests on and **said so in the test
> header rather than implying coverage**."*

**The Reviewer read the DD10 table and stopped there.** The table's AC4/AC5/AC10 rows are
**code-shape** readings — real→mutated on layout writes, `await` in `pointerup`, bare
`return null`. They are **not** the readings those ACs specify. **Ticking them would be pinning
the code shape and calling it covered — the exact thing the Reviewer's own HIGH 1 forbids**, and
the sixth generation of *"every correction inherits its predecessor's blind spot unless it changes
instruments"*: the fix-list was derived from **one table** rather than from the record.

**Applied instead — a uniform, stated tick discipline** (added to the leg's AC preamble): *an AC is
ticked only where the readings **the AC itself specifies** were taken **by this leg**.*

| | ACs | Why |
|---|---|---|
| **Ticked** | **AC1, AC2, AC3, AC7, AC8, AC9, AC12** | The AC's own readings, taken by leg 3, both directions where it asks for them. |
| **Open — PARTIAL, runtime half never taken by ANYONE** | **AC4, AC5** | Code shape pinned with both readings; the **fresh-`getBoundingClientRect()`-vs-`slotRects`** reading needs a DOM harness this repo does not have. **Leg 5 did not take it either** — no `tab-tearoff` row compares a live rect to the snapshot. **Genuinely owed.** |
| **Open — PARTIAL, runtime half taken by LEG 5** | **AC10** | Code shape here; `tab-tearoff` rows 6/7 took the stated refusal+announcement+origin-index readings. |
| **Open — runtime, discharged by LEG 5** | **AC6, AC11** | Per the Reviewer's instruction and leg 4's convention: the box stays open in the leg that could not take the reading, with a pointer to the leg that did. |
| **Open — PARTIAL** | **AC13** | Three of four gates green; **`npm run a11y` DID NOT RUN** (needs a live GUI + admin key; **exits 1 on the missing key, not on a violation**). **Not run ≠ green.** The Reviewer's list omitted AC13 entirely. |

**Net**: 7 ticked, not 10. **AC4 and AC5 are the ones the Reviewer would have had us tick on a
weaker instrument than the AC names** — and they are now the flight's only genuinely unowned
verification debt.

#### LOW 5 — CONFIRMED. Both stale counts fixed, and the historical one preserved

- **`guard (a) FAILS a renamed core…`**: the message said `anchors === 3`; the net asserts **4**
  (leg 4 bumped it for the DD8 cross-window call site). **The assertion was right and its own
  failure message was lying about it** — a message read only on failure, when it is least
  checkable. Corrected to 4.
- **The mask test's header** *"same anchor count of 3"* is **genuine leg-3 history** sitting above
  assertions that read 4. **Marked historical rather than rewritten**, with the reason stated: it
  narrates a reading **taken at leg 3**, and silently restating the number would report a
  measurement at an arity that did not exist when it was made. **The equal-readings FINDING carries
  forward; the arity it was observed at does not** — and the assertions below it re-measure at 4.

#### Gates (each STANDALONE)

| Gate | Result |
|---|---|
| `npm test` | **1892 pass / 0 fail** — baseline **1892**, **delta 0** |
| `npm run lint` | clean |
| `npm run typecheck` | clean |
| `npm run a11y` | **NOT RUN, deliberately** — it exits 1 on a missing key, not on a violation (mission Known Issue). Not run ≠ green. |

**The delta is 0 and that is CORRECT, not a missing net** — every new assertion landed **inside**
existing test cases (the DD16 ban's two new mutation controls; the synchrony pin's message), and
`node --test` counts **cases**, not assertions. `tab-drag-invariants.test.js`: **10/10**, same 10
cases, three more mutations inside the DD16 one. **The HIGH-1 net is `tab-tearoff` row 8a and is
deliberately NOT a unit test** — see above.

**Nothing committed.** No mutation artifacts: every reading was in-memory. `git diff` scanned for
operator-identity leaks (`/home/`, `/Users/`, username) → **zero**.
