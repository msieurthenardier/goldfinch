# Behavior Test: Tear-off by drag, and the keyboard cross-window move

**Slug**: `tab-tearoff`
**Status**: draft
**Created**: 2026-07-15
**Last Run**: 2026-07-16-04-08-49 — **partial** (first run; **PRODUCT GREEN on all 9 checkpoints**,
Witnessed with an independent Validator) — [run log](tab-tearoff/runs/2026-07-16-04-08-49.md).
**The tear-off's identity triple is measured and DD2 holds**: T2 kept `wcId 4` and jar `work`
across the re-parent (only `windowId` changed 1→2), `history.length` stayed **2**, and
`goBack` landed on page 2 with **both** committed markers. **No `'Move canceled'` on either
success path.** The keyboard cross-window move (rows 8–9) is green, including DD8's
stale-window refusal.
**Filed `partial`, NOT `pass`** — **two spec-instrument errata were folded during the run**
(the recorder multiplies without a `disconnect()`; row 5 claimed three independent
refutations where there are two). **Neither is a product defect** — the product announces
exactly once, proved by calibration and by a single-observer timestamp — **but the spec did
not run clean as written.** **A clean re-run of the folded spec is OWED at this spec's next
touch — owner: the next flight to touch tear-off or the tab strip (F9 by default; F10 if it
walks this spec first).** Promote `draft` → `active` only on that clean run.

> **⚠ RE-SCOPED (2026-07-17, M09 F11 Leg 4): the owed clean re-run now covers ONLY the
> SURVIVING rows — 8, 8a, 9, and the HIGH-1 displaced-menu block.** F11 replaced the whole
> pointer-drag layer with native HTML5 DnD (DD3), which `dragPointer` cannot drive — **rows
> 3–7 are permanently unrunnable as written** (dead instrument, not a product change of the
> behaviors they asserted) and are marked SUPERSEDED in place below, each with its successor
> in `cross-window-drag.md`. The keyboard instrument (rows 8/8a/9, HIGH-1) is unaffected.
> The 2026-07-16 run history above stays intact as provenance of what WAS measured under the
> pointer layer. **Re-run provisioning note:** the surviving chain's fixture premises must be
> re-derived at run time — old row 4's tear-off is what minted W2, so a re-run mints its
> second window through a live door instead (the tab context menu's `Move to new window`, or
> the kebab New Window path), and row 8's menu-caption parenthetical (which cites superseded
> row 5's `goBack`) is historical — the row already demands the caption be resolved live.
> Promote `draft` → `active` on a clean run of this surviving scope.

**⚠ ROW 8a WAS ADDED AT F8's FLIGHT-END REVIEW AND HAS NEVER RUN.** The 9-checkpoint verdict
above is the **first run's** and is **not** a verdict on it — row count is now **10**. It covers a
HIGH defect the flight-end review found by reading source: the target's **outgoing** tab stayed
`active: true` and `setVisible(true)` after an adopt into an **EXISTING** window. **Every row
above missed it, and the reason is structural** — rows 3–7 tear off into a **fresh** window
(`activeTabWcId === null`, so there is no outgoing tab to displace), and row 8, the one row that
*does* drive the existing-window path, asserted the **moved** tab's identity and never asked what
became of the tab it displaced. **The fix and the row land together; the row's first reading is
owed with the clean re-run above.**

> ## CROSS-WINDOW DRAG NOW SHIPS AND IS VERIFIED ELSEWHERE — AND THE FALSE-PASS DOCTRINE BELOW HAS A LIVE SUCCESSOR
>
> *(Rewritten 2026-07-17 at M09 F11 Leg 4. The banner this replaces declared cross-window
> drag deliberately unverified; its world is gone, but its findings and its doctrine are
> preserved below — historical where superseded, ACTIVE where it still bites.)*
>
> **The current truth:** F11 shipped the cross-window drag gesture on **native HTML5 DnD**
> (DD3 — the unified rewrite: one native gesture for reorder + tear-off + cross-window; the
> pointer machinery this spec's rows 3–7 drove is REMOVED). **Mission criterion 8 is
> SATISFIED** — the operator witnessed the full gesture live on X11 (flight-11 log,
> criterion-8 HAT): a tab dragged from window A's strip onto a non-overlapping window B's
> strip moved there, same `wcId`, jar intact, live history. The old banner's "candidate 2
> (HTML5 drag with a custom MIME) — foreclosed by omission at design time, never measured"
> **WAS measured at F11** (probes 2–10 + the wayland relaunch of probe10) and is what
> shipped: the **browser** owns the transport and no app-level global coordinate exists,
> exactly as the old banner reasoned. **DD5 (corrected):** on this WSLg rig the gesture is
> **X11-only** — Wayland cancels the drag at the source surface — with packaged native
> targets expected full-parity; the keyboard move (rows 8–9, still THIS spec's) is the
> Wayland-rig alternative.
>
> **Verification of the drag lives in `cross-window-drag.md` (HAT-apparatus: the operator
> performs each gesture; the Executor is observe-only).** Rows 3–7 below are SUPERSEDED in
> place — `dragPointer` cannot drive the native drag loop (recorded at F11 Leg 2; the
> precise mechanism is inferred, not measured), so those rows are **dead instruments that
> would FAIL** — the opposite failure mode from the trap below, and just as corrosive left
> looking runnable.
>
> **HISTORICAL — the fiction-coordinate findings (F8 leg-2 spike), preserved because they
> are WHY the successor spec is HAT-apparatus:** on this rig Electron's window coordinates
> are a cached fiction (`setPosition` a no-op, a real OS move fires no event, a virgin
> window born 363px wrong, `screenX ≡ getBounds.x − 16` — two proxies of one value), and
> Chromium never clips injected coordinates to view bounds (V5). So a synthetic
> pointer-injected cross-window drag **would have run GREEN through fiction-space a real
> human misses by 1353px**. **A passing test over a broken feature is worse than no test**
> — this project shipped that failure class once (`multi-window-shell` passed 9/9 over a
> real cross-window `activateTab` bug for an entire flight). Electron's coordinate
> self-reports are not falsifiable from inside Electron; the real transport had to be
> measured by a human hand, and now it is.
>
> **⚠ ACTIVE — THE SUCCESSOR TRAP, carried forward in the spirit of the old warning: the
> synthetic-`DragEvent` green-wash.** The pointer-injection trap above is dead, but the
> native-DnD handlers ARE drivable by a fabricated `DragEvent`/`DataTransfer` dispatched
> via `evaluate` — a fabricated `drop` on `#tabs` carrying the identity MIME fires the
> **REAL** `tab-adopt-by-drop` IPC and goes **GREEN with no OS transport exercised**. The
> flight-11 log forbids it explicitly, and the old doctrine transfers verbatim: **if a
> future author finds they can make a cross-window drag row pass without a human hand on
> the mouse, that is the hazard, not the win.**
>
> **What survives in THIS spec is the KEYBOARD move** — rows 8, 8a, 9 and the HIGH-1
> displaced-menu block. That instrument (`click`/`pressKey` on real menus) is unaffected
> by the drag rewrite and remains live coverage.

## Intent

**Live scope (post-F11): the keyboard cross-window move** (rows 8–9) — the tab context
menu's flat `Move to window "…"` items keyed by `windowId` (DD8) — plus the displaced-tab
census (row 8a) and the displaced-menu block (HIGH-1).

**The load-bearing assertion is IDENTITY (DD2 — the mission's ABSOLUTE constraint): the
moved tab is the SAME live `webContents`, never destroyed and recreated.** Same `wcId`,
same jar, **live history**. Row 8 remains the keyboard door's only live instrument for it —
this repo has **no DOM or main-process harness** (bare `node --test`, no jsdom; `main.js`
is never executed, only read), so `removeChildView` → `addChildView` across two real
`BaseWindow`s, with a live guest's history surviving the re-parent, is not expressible
offline. **The DRAG doors' identity coverage moved to `cross-window-drag.md`** (its row 1,
the cross-window drop; its row 3, the tear-off — inheriting superseded rows 4–5's DD2
reading), along with the drag-path refusal announcements (its row 5, inheriting superseded
rows 6–7). Row 8's sequence-recorder still proves **no `'Move canceled'` on the keyboard
success path**.

*(HISTORICAL — the original intent, F8:)* rows 3–7 verified **tear-off by pointer drag**,
decided entirely from window-local coordinates (DD16: `e.clientX/Y` against the strip's own
`getBoundingClientRect()`) — which is precisely why tear-off survived the F8 spike that
killed pointer-based cross-window drop: it never needed a shared coordinate space. F11
replaced that pointer machinery with native HTML5 DnD (no arm threshold, browser-owned
transport), so those rows' instrument is dead; the behaviors they asserted live on and are
covered by the successor spec.

## Preconditions

- **Apparatus — admin MCP surface.** Goldfinch running via
  `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation`
  (Wayland). At launch the app prints `AUTOMATION_DEV_MINT { "key": "...", "adminKey": "..." }`
  to stdout — capture the `adminKey`. **Reference the admin key via an env var ONLY —
  NEVER paste it into a command literal.** (An F6 executor leaked one.)
- **THE APPARATUS IS A HAND-ROLLED SDK CLIENT OVER BASH — IT IS NOT A REGISTERED MCP.**
  An F7 leg-1 Executor **falsely blocked after zero tool calls** because it scanned for a
  registered `goldfinch` MCP, found none, and concluded the apparatus was missing.
  **There is no registered MCP and there never was.** Drive the surface with a small Node
  script run via **Bash** that speaks MCP over the loopback HTTP transport —
  **`scripts/mcp-example-client.mjs` is the working template; copy it.** Import the SDK by
  **absolute `dist/esm` path** (the runner sits outside the package tree; ESM ignores
  `NODE_PATH`). *(`.mcp.json` ships an empty `mcpServers` map **by design** — off-by-default.
  Its emptiness is the contract, not a fault to repair.)*
- **Apparatus disqualification:** the `chrome-devtools` MCP does **NOT** qualify — it
  launches its own browser and never touches this app (the standing Goldfinch false-pass
  trap).
- **Port — BIND-PROBE, never `ss`.** **`ss -ltn` CANNOT see WSL2 ports held by
  Windows-side listeners** — port 49717 read *free* to `ss` and was `EADDRINUSE` on bind
  (measured live at F7's `multi-window-shell` run and again at F8 leg 5A). **A bind probe
  is the only authoritative free-port instrument on this rig.** Pin via
  `GOLDFINCH_MCP_PORT`; if the bind fails, relaunch **without** the pin — the server
  free-falls to the next free port and prints it with a fresh `AUTOMATION_DEV_MINT`. Read
  the actually-bound port from that output and reuse it everywhere.
- **A live sibling Goldfinch may hold the default profile's port. LEAVE IT UNTOUCHED** —
  use a **fresh scratch profile** (`XDG_CONFIG_HOME` at an empty directory): deterministic
  jar seed (Personal default + Work) and a provably empty closed-tab stack.
- **Fixture pages — the committed `tabstrip` set**, `tests/behavior/fixtures/tabstrip/`
  (`page1.html` .. `page6.html`, titled `Fixture Page 1 — tabstrip` .. `Fixture Page 6 —
  tabstrip`; that directory's README pins the content and the serve command). **This spec
  uses pages 1–5.** Serve **from that directory** via `python3 -m http.server <port>`.
  **A pre-existing `http.server` on 8000 is NOT yours — leave it and use another port.**
  The markers are **CONTRACT, not decoration**: every page carries `<h1 id="marker">`
  (echoing the title) and `<p id="body-marker">`. **Do not regenerate these pages from this
  prose — use the committed set.** Every page declares `<meta charset="utf-8">`, which is
  **load-bearing** (the titles carry an em-dash; a prior run served them charset-less and
  the mojibake rode into a title-distinctness read).
- **Admin is required.** `enumerateWindows` and `getChromeTarget` are **admin-only**
  (`scope.js`); a jar key is refused `automation: admin-only`. Non-tab wcIds (chrome,
  sheet) resolve **only** at the admin tier — and a jar key is refused **every** window's
  chrome by the widened chrome-exclusion, not by the internal-session rule (those are two
  distinct guards with two distinct refusal strings; do not conflate them).
- **Boot bracket (MANDATORY).** Snapshot `enumerateTabs()` **and** `enumerateWindows()`
  **IMMEDIATELY on connect**, before any setup lull — a later census drift must be
  attributable to a spec action, not to stray input into a live idle window on the WSLg
  desktop.
- **No OS-focus reliance.** WSLg poisons the focus APIs: programmatic `win.focus()` is a
  no-op and `getFocusedWindow()` goes stale (F6 spike verdict 4). `lastFocused` is
  **main-side tracked, not an OS-focus claim** — read it as such.

### The instruments this spec uses, and why each is the one it is

> **Never assert an op's behavior from its NAME — read its signature.** F7 lost its marquee
> gate to `getHistory`, which *sounds* like a per-tab navigation-history op and is actually
> a **jar-confined visits reader** (`getHistory(jarId: string, {query,limit,before})` →
> `{jarId, visits}`); as written it refused `bad-args` on **every** run and so
> **discriminated nothing** — the exact defect class the gate was added to prevent. The
> following premises were re-audited against source before this spec's first run.

- **History is read with `evaluate(wcId, "history.length")`, NEVER with `getHistory`, and
  NEVER with `goBack` alone.** `goBack` calls Electron's `wc.goBack()`, which is a **silent
  no-op when there is no back history**, and returns `undefined` → serializes to
  `{"ok":true}`. **`goBack` returning `{"ok":true}` therefore proves NOTHING** — it is the
  same reading on a live history and on a dead one. **Discrimination zero.** Live history is
  proven by the **pair**: a count (`history.length` → 2) *and* a `goBack` that lands on a
  **different, positively-identified fixture page**.
- **The announcement channel is the `#tab-status` sr-only live region**
  (`role="status" aria-live="polite"` in the chrome DOM) — this is the **accessibility
  contract**, i.e. what a screen-reader user actually perceives. It is rendered state for
  that user, not internal state.
> ### ⚠ ERRATUM 1, folded at the first run (2026-07-16-04-08-49) — THE RECORDER MULTIPLIES, AND THE ARM MUST `disconnect()` FIRST
>
> **The spec said "re-arm the recorder" at rows 6/7/8/9 and never said to disconnect the
> previous one.** A `MutationObserver` observing a live node is **kept alive by the
> registration itself** — not garbage-collected for want of a JS reference — and the
> callback's `window.__gfAnn.push(...)` is a **dynamic** lookup, so every prior observer
> keeps pushing into whatever array the name currently binds. **N arms ⇒ N live observers
> ⇒ N pushes per SINGLE announcement.** Measured live: C1 reached a **×4** multiplier by
> step 8.
>
> **Rows 4 and 6 read `EXACTLY ['…']` — and that was TRUE ONLY BY LUCK**, because each
> happened to be the first arm on its own chrome (C1 at row 4, C2 at row 6). **Rows 7/8/9
> read the same string N times.** The literal "exactly" wording is **wrong as written** for
> any row after the first arm on a given chrome.
>
> **THE FIX: the arm must disconnect any prior observer before observing** — e.g. keep the
> observer on `window.__gfObs`, call `window.__gfObs?.disconnect()` at the top of every
> arm, then re-create. **And the arm must CALIBRATE**: fire one known stimulus into the
> live region, count the pushes, and record that as the multiplier (`probeMultiplier`) —
> **measured per step, never carried forward.**
>
> **WHAT THIS ERRATUM DOES NOT TOUCH — the absence claim is SOUND.** Multiplication
> **duplicates; it cannot mask.** Every observer receives every record, so a
> `'Move canceled'` would have appeared **N ≥ 1** times — interleaved
> (`[MC,TM,MC,TM,…]`) if same-checkpoint, blocked (`[MC×4, TM×4]`) if not. **It appeared
> ZERO times.** Rows 4 and 8's core finding stands on its own evidence.
>
> **⚠ AND THE REAL MASKING HAZARD IS THE DEDUP, NOT THE MULTIPLIER — do not "fix" the
> multiplier by collapsing the array.** Folding *consecutive identical* strings makes
> **1 real announcement indistinguishable from 2 identical ones** (2 × 4 observers = 8
> consecutive identical pushes → collapses to ONE), **reinstating the final-value blindness
> this recorder exists to defeat, one layer up.** A collapsed array must **NEVER** be
> cited as "the announcement sequence". **The two safe primitives are: `rawPushCount ÷
> calibrated multiplier`, and a single dedicated observer that timestamps each record**
> (one observer sees each mutation exactly once, so a genuine double-announce logs **two**
> timestamps — which is what proved this erratum was the instrument and not the product).

- **`announceTabStatus` NEVER CLEARS — and that is why the recorder rows install a
  RECORDER** *(live: row 8; historical: superseded row 4, whose drag-path bug signature —
  a buggy drag-cancel announcing `'Move canceled'` then being overwritten — is described
  below in its F8 vocabulary; the doctrine transfers unchanged to the keyboard path and to
  `cross-window-drag.md`)*.
  Audited: it is a bare `els.tabStatus.textContent = text` with **no timeout and no
  expiry**; the text persists until the next announcement overwrites it. **So a final-value
  read cannot falsify the `'Move canceled'` absence claim.** The bug the design review
  caught has this exact signature: `tab-moved-away` reaches the source **before** the
  invoke reply lands, so a buggy `cancelDrag()` would announce `'Move canceled'` and then
  be **overwritten** by `'Tab moved to a new window'` — **a final-value read would report
  the success string and MISS the bug.** Rows 4/8 therefore install a `MutationObserver` on
  `#tab-status` (via `evaluate` on the chrome wcId, main-world, before the gesture) that
  appends **every** announcement to an array in order, and assert on the **whole
  sequence**. **The success announcement in that same array is the same-row POSITIVE
  CONTROL for the absence**: if the array reads exactly `['Tab moved to a new window']`,
  the recorder was installed, live, and capturing **during that exact gesture** — so the
  absence of `'Move canceled'` is a **measurement**, not a dead instrument.
- **`captureScreenshot` and `readAxTree` ACTIVATE AND RAISE — but only for GUEST targets.**
  Audited (`observe.js`): a guest target is `activate(wcId)`-ed before capture, which
  **raises its owning window** (F7 DD6). **Screenshotting a background tab would mutate
  both "which tab is active" and "which window is focused" — the very state this spec
  measures.** **Chrome targets never activate.** Every rendered-state capture in this spec
  therefore targets a **chrome wcId**, which is also where the observable lives (the tab
  strip is chrome DOM). `readDom` and `evaluate` never activate.
- **Serialization.** The MCP boundary is `JSON.stringify` (`serialize` in `mcp-tools.js`),
  which **silently drops `undefined`-valued keys and an array's non-index own properties**
  — making some absence assertions **structurally unfalsifiable**. Audited for this spec:
  `sheetWcId`/`findWcId` are **conditionally assigned** in `window-census.js`, so their
  absence **is** wire-discriminable; `windowId`, `booted`, `activeTabWcId` (`?? null`), and
  `lastFocused` are **always** assigned. **No row here rests on an unfalsifiable absence.**
  *(One latent edge, recorded so a future author does not lean on it: `chromeWcId` is
  assigned **unconditionally** as `rec.chromeView?.webContents?.id`, so a missing chrome
  view would drop the key exactly as a conditional absence would. This spec never asserts
  `chromeWcId` presence as a wire invariant.)*
- *(HISTORICAL — pointer-injection instrument notes for the superseded rows 3–7; the rows
  that used them are dead instruments as of F11, and no live row here issues a
  `dragPointer` or depends on synthetic `pointermove` delivery.)* **`dragPointer` paces its
  moves** (`steps` default 12, `stepDelayMs` default 4ms; an unpaced burst coalesces to
  essentially first + last) and **`e.buttons` is 0 on every synthetic `pointermove` after
  the down** (DD9). Both facts remain true of the op — which stays valid for NON-tab drags
  — but the tab strip's drag layer is native HTML5 DnD (F11), which synthetic pointer
  injection cannot drive, and the pointer handlers these notes guarded no longer exist.

### THE ONE THING THE SUPERSEDED TEAR-OFF ROWS DID **NOT** PROVE — HISTORICAL (F11 dissolved the question)

> **HISTORICAL (2026-07-17, F11 Leg 4).** This whole section reasoned about the gap between
> a **synthetic** chrome-injected drag and a **real OS pointer** — a gap that existed only
> because rows 3–7's instrument was injection. Under F11's native DnD the drag layer is not
> injectable at all, and the successor spec's instrument IS the real OS gesture (operator,
> `cross-window-drag.md`), so the synthetic/real divergence this section mitigated no longer
> has a synthetic side. Preserved because the V1 question it named (real pointer delivery
> over a guest's native surface) was answered by the criterion-8 HAT the honest way — a
> human hand on the mouse — and because the chrome-band reasoning documents why old row 4's
> drop point was specified as it was.

> **The flight says *"Tear-off (single-window) remains fully verifiable either way."* That
> is an OVERCLAIM, and it is the same species this flight exists to prevent.** It is
> recorded here rather than inherited.

The chrome view **fills the window at `{x:0, y:0, width, height}`** (`main.js`); each guest
is a **separate native surface** stacked on top at a slot offset below the toolbar.
`dragPointer(<chrome wcId>, …)` **injects directly into the chrome's webContents**, so the
chrome renderer receives the whole gesture **regardless of what native surface is visually
on top of the drop point**.

- **What that does NOT compromise:** the **coordinates are truthful**. Unlike the
  cross-window case, a window-local `clientX/clientY` is exactly what a real pointer at
  that spot would produce. There is **no fiction-space here** — which is the whole reason
  tear-off is testable at all and cross-window drag is not.
- **What remains unproven:** whether a **real OS pointer**, held down on a tab and dragged
  **over a guest's native surface**, keeps delivering `pointermove`/`pointerup` to the
  **chrome** renderer. **This is V1's question at a shorter distance, and V1 is UNMEASURED
  (→ HAT).** F2's reorder drag never leaves the strip, so no existing evidence covers it.
  If delivery breaks, the drag simply never completes and a human sees nothing happen —
  a **loud** failure, not a silent wrong-window adopt, but still one this spec cannot see.
- **The mitigation, and it is why row 4's drop point is specified the way it is:** row 4
  releases in the **band below the strip and ABOVE the guest's top edge** — a region the
  **chrome view owns outright, with no guest surface over it**. There, the synthetic path
  and the real human path **coincide**, and the row's claim is sound without appeal to V1.
  **A deeper drop, over a guest surface, is what stays unproven** — and this spec does not
  make one and does not claim one.
- **The band's instrument, named — and VERIFIED NON-EMPTY, which is what makes the
  mitigation real rather than rhetorical.** The guest's top edge is the chrome renderer's
  own guest slot: **`document.querySelector('#webviews').getBoundingClientRect().top`**
  (main sizes each guest from that slot's bounds — `main.js`, *"the chrome view fills the
  window at 0,0"*). The chrome's layout is `#tabstrip` → `#toolbar` → `#webviews`, so
  **the entire toolbar sits inside the band** and the drop region is comfortably
  non-degenerate. *(Both the instrument and the non-emptiness were established at the
  pre-run premise audit; the row previously asserted the band without naming a way to
  measure it — a mitigation whose own precondition was unchecked.)*

## Observables Required

- **mcp (admin SDK client over Bash — the apparatus above):**
  - `enumerateWindows` — window topology: `windowId`, `chromeWcId`, `booted`,
    `activeTabWcId`, `lastFocused`, `sheetWcId?`, `sheetVisible`. **The tear-off's primary
    observable: a new window either exists or it does not.**
  - `enumerateTabs` — the all-windows census; every row carries `windowId`, `wcId`,
    `jarId`, `title`, `active`. **The identity observable (same `wcId`, same `jarId`, new
    `windowId`) and the strip-membership observable.**
  - `evaluate` — `history.length` (live history); the strip's DOM rects; the announcement
    recorder; `window.goldfinch.windowClose()`.
  - ~~`dragPointer` — the gesture. Viewport-relative, into the **chrome** wcId.~~
    *(SUPERSEDED, F11 — the drag rows are dead instruments; no live row here drags. The
    gestures live in `cross-window-drag.md`, operator-performed.)*
  - `click` — the real right-click that opens the tab context menu; the real click that
    activates a menu item.
  - `readDom` — positive page identification after `goBack` (the fixture's `<h1 id="marker">`
    / `<p id="body-marker">`). **Never activates.**
  - `openTab` / `navigate` — fixture provisioning and history seeding.
- **browser / rendered pixels** — `captureScreenshot(<chrome wcId>)` and
  `readAxTree(<chrome wcId>)` for rendered-state corroboration of the strip and the menu.
  **Chrome targets only** — see the activation hazard above.
- **shell** — launch, the fixture server, port bind-probe, pid liveness.

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **Connect + boot bracket.** Connect the admin client (SDK-over-Bash — see Preconditions). `enumerateWindows()` and `enumerateTabs()` **immediately**. | **Exactly ONE window row**: `booted: true`, `lastFocused: true`, a **numeric** `chromeWcId`; **`sheetWcId` ABSENT** (the overlay is lazy; absence is a *meaning*, and it is wire-discriminable — `window-census.js` assigns it conditionally). The census holds only the boot tab. Record this window's `windowId` as **W1** and its `chromeWcId` as **C1**. ⇒ a clean rig, attributable from here on. |
| 2 | **Provision the fixture and SEED LIVE HISTORY — the identity baseline.** `openTab(page1Url, 'work')` → **T1**; `navigate(T1, page4Url)`. `openTab(page2Url, 'work')` → **T2**; `navigate(T2, page3Url)`. `openTab(page5Url, 'work')` → **T3**. **Poll** `evaluate(T2, "history.length")` until it reads **2** (see the gate note). Read `evaluate(T1, "history.length")`, and the census. Record T1's and T2's **`wcId`** and **`jarId`**. | W1 holds the boot tab + **T1, T2, T3**, every one `jarId: 'work'`, `windowId: W1`, titles pairwise distinct. **`evaluate(T2, "history.length")` → exactly `2`** (page 2, then page 3) and **`evaluate(T1, "history.length")` → exactly `2`** (page 1, then page 4). ⇒ **this is the BEFORE half of the identity reading** — row 8 asserts these same numbers *after* a re-parent (superseded row 5 used to as well), and a baseline not recorded here is a claim that cannot be made there. **⚠ COMMIT-SETTLE GATE (`ERR_ABORTED`), inherited from `multi-window-shell` step 2 and load-bearing:** an immediate `navigate` **races the first page's uncommitted load, aborts it, and leaves a 1-entry history**. A `length` of **1** here is that race — **not** a product defect. **Poll to `2` before proceeding; if it will not settle, STOP** — every later identity claim rests on this number, and a run that proceeds from a 1-entry history proves nothing about history survival. |
| 3 | **⛔ SUPERSEDED (F11 Leg 4 — dead instrument: the drag layer is native HTML5 DnD, which `dragPointer` cannot drive; this row would FAIL as written, not measure. Successor: `cross-window-drag.md` row 2, the operator-performed in-strip reorder control. Do not run. Kept as historical record.)** **THE ZONE MODEL'S CONTROL: the SAME gesture from the SAME point to the SAME `x` — and ONLY the drop `y` differs. In-strip drags still REORDER (F2, unchanged).** Read the strip rect, the guest slot's top, and the tab rects from the chrome DOM: `evaluate(C1, "JSON.stringify({strip: document.querySelector('#tabstrip').getBoundingClientRect().toJSON(), guestTop: document.querySelector('#webviews').getBoundingClientRect().top, tabs: [...document.querySelectorAll('#tabstrip .tab')].map(el => ({id: el.dataset.id, r: el.getBoundingClientRect().toJSON()}))})")`. **`dragPointer(C1, from: <T2's rect center>, to: {x: <T3's rect `right` − 2 — call this DROP_X>, y: <T2's rect center y — inside the strip>})`.** Re-read the strip's DOM order and the census. | **T2 REORDERS within W1 — it does NOT tear off.** The strip's DOM order changes (T2 now sits **after** T3); `enumerateWindows()` **still returns exactly ONE row** (no new window); T2's `windowId` is **still W1** and its **`wcId` is unchanged**. ⇒ **the reorder half of the zone model is intact, and this row is row 4's NEGATIVE CONTROL**: rows 3 and 4 issue the *same* op on the *same* tab from the *same* start point **to the same `DROP_X`**, and differ in **exactly one variable — the drop `y`** (row 3 inside the strip's rect, row 4 outside it). Without this row, row 4's tear-off cannot be attributed to the y-axis rather than to "any drag now tears off". *(Leg 3 changed the arm threshold from `Math.abs(dx)` to `Math.hypot(dx, dy)` — `tab-reorder.md` owns that regression in full; this row is the same-run control, not a duplicate of it.)* **⚠ WHY `right − 2` AND NOT T3's CENTER — `dropIndexFromPointer` IS STRICT.** It increments on `pointerX > midpoint` (`tab-order.js`), so a drop **exactly on** T3's center x lands **ON the tie**, does **not** count T3, and yields T2's **existing** index ⇒ **no reorder at all**, and the row would fail as a **spec artifact**. Worse, it would be a **coin flip**: `dragEvents` **rounds** intermediate moves (`input.js`) and the zone is decided by the **last pointermove**, not the `mouseUp` — so the outcome would hinge on whether T3's center x happens to carry a fractional part ≥ 0.5. Dropping strictly **past** the midpoint (and still `≤ strip.right`, so the zone stays `reorder`) makes the row deterministic. *(Ties resolve toward "before" **by design** — `classifyDragPoint` treats the strip rect as inclusive on all four edges for the same reason: the conservative side is the one that does **not** move the user's tab.)* Corroborate on rendered state: `captureScreenshot(C1)` + `readAxTree(C1)` show the reordered strip. |
| 4 | **⛔ SUPERSEDED (F11 Leg 4 — dead instrument: native HTML5 DnD; `dragPointer` cannot initiate the drag. Successor: `cross-window-drag.md` row 3, the operator-performed tear-off to desktop — which also inherits row 5's identity triple. Do not run. Kept as historical record; its recorder discipline lives on in the successor spec and rows 8/9.)** **TEAR-OFF BY DRAG — the flight's gesture. Install the announcement recorder FIRST.** `evaluate(C1, "window.__gfAnn = []; new MutationObserver((rs) => { for (const r of rs) for (const n of r.addedNodes) window.__gfAnn.push(n.textContent); }).observe(document.querySelector('#tab-status'), {childList: true, characterData: true, subtree: true}); '__gfAnn-armed'")`. Re-read the strip rect. **`dragPointer(C1, from: <T2's rect center>, to: {x: <DROP_X — THE SAME x as row 3>, y: <BELOW the strip's `bottom` and ABOVE `guestTop` — the chrome-owned band; see the V1 note in Preconditions>})`.** Then `enumerateWindows()`, `enumerateTabs()`, and `evaluate(C1, "window.__gfAnn")`. | **A NEW WINDOW EXISTS**: `enumerateWindows()` returns **TWO** rows. Record the new one as **W2** / **C2**. **The source strip CLOSES RANKS**: W1's census rows no longer include T2, the remaining tabs are contiguous, and W1 has a sane active tab. **AND THE ANNOUNCEMENT SEQUENCE IS EXACTLY `['Tab moved to a new window']`** — **`'Move canceled'` DOES NOT APPEAR.** ⇒ **the accessibility bug the design review caught is absent** (DD6: `tab-moved-away` reaches the source *before* the invoke reply, so a `cancelDrag()` on the success path would announce a **false** `'Move canceled'` to a screen-reader user, against the mission's constraint that accessibility contracts may only be **extended**). **This is a MEASUREMENT, not a dead instrument, *because the success string is in that same array, captured by that same recorder, during that same gesture*** — and it is why the row asserts the **whole sequence** rather than the final value: **the live region never clears**, so the bug's own ordering (`'Move canceled'` then overwritten by the success string) would make a final-value read report **success and miss it**. **⚠ THE RECORDER READS EACH MUTATION RECORD'S `addedNodes`, NOT the live `textContent` — AND THAT IS THE WHOLE POINT.** A callback that re-reads `textContent` would **coalesce**: MutationObserver delivers a **batch** per microtask checkpoint, so two announcements in one checkpoint would produce **ONE** push of the **final** value — **silently reinstating the exact final-value blindness this recorder exists to defeat**, and destroying this row's positive control (an array reading `['Tab moved to a new window']` could then mean *"both fired and coalesced"*). `textContent =` replaces children, so **every** announcement lands as an `addedNodes` text node and per-record reading is total. *(Caught at the pre-run premise audit. DD6's own ordering probably separates the deliveries anyway — but that is an **inference about timing, not a guarantee**, and a control that rests on one is not a control.)* Corroborate on pixels: `captureScreenshot(C1)` shows the strip **without** T2; `captureScreenshot(C2)` shows the new window's strip **with** it. |
| 5 | **⛔ SUPERSEDED (F11 Leg 4 — downstream of row 4: it reads the state row 4's dead-instrument gesture produced, so it dies with it. Successor: `cross-window-drag.md` row 3 asserts this same identity triple — unchanged `wcId`, same jar, live history via count + marker-identified `goBack` — at the tear-off door; its row 1 asserts it at the cross-window-drop door. Do not run. Kept as historical record — the two-not-three refutation-count erratum and the `goBack`-proves-nothing doctrine below remain the reference statement, and row 8 still applies them live.)** **THE IDENTITY READING — DD2's claim and the mission's ABSOLUTE constraint. NOTHING ELSE IN THIS FLIGHT PROVES IT.** From the census, read T2's row. Then `evaluate(T2, "history.length")` — **before** the `goBack`, so the count is unperturbed. Then `goBack(T2)`; then **POLL** `readDom(T2)` until the marker reads the expected page, with a timeout (see the settle gate). | **T2 carries the SAME `wcId` it was recorded with in row 2** — the number is **unchanged** across the tear-off ⇒ **the live `webContents` was RE-PARENTED, never destroyed and recreated** (`removeChildView` → `addChildView`). Its **`windowId` is now W2** (and only that changed). **`jarId` is still `'work'`** ⇒ the jar identity travelled with the tab, and the jar pill in W2's chrome renders it. **`evaluate(T2, "history.length")` → still exactly `2`** — the number from row 2, carried through the re-parent ⇒ **live history survived**. **`goBack(T2)` then lands on `Fixture Page 2 — tabstrip`**, positively identified by `readDom(T2)` finding **both** committed markers (`<h1 id="marker">` echoing that title **and** `<p id="body-marker">`). ⇒ **destroy-and-recreate is refuted on TWO independent observables — the unchanged `wcId` and the live history — either of which it would break.** **⚠ THE JAR LEG REFUTES NOTHING, AND SAYING OTHERWISE WOULD BE THIS SPEC'S OWN OVERCLAIM.** *(Folded at the first run, 2026-07-16-04-08-49: the row previously claimed **three** independent observables. It is **two**.)* A tab **destroyed and recreated in the same partition** would read `jarId: 'work'` **identically** — the jar reading is **not** a discriminator against recreation. It earns its place for a **different** mission constraint (*"a tab keeps its jar identity through the move"*, which a re-parent into the wrong session **would** break), and it is asserted **as that**, never as evidence of re-parenting. **The count of independent refutations is two; do not inflate it.** **⚠ `goBack` ALONE WOULD PROVE NOTHING and must not be substituted for this triple:** `wc.goBack()` is a **silent no-op with no back history** and returns `{"ok":true}` **either way** — *identical readings on a live history and a dead one*. The **count** is what makes the landing falsifiable, and the **marker read** is what makes the count more than a number. *(This is `getHistory`'s lesson from F7, applied to the op next door.)* **⚠ COMMIT-SETTLE GATE ON THE `goBack`, and it is row 2's gate applied where row 2 forgot to apply it:** `goBack` **returns before the back navigation commits**, so an *immediate* `readDom` can still read the **OUTGOING** page (`Fixture Page 3`) and fail the marker clause for a **purely timing** reason. **POLL `readDom(T2)` until the marker reads `Fixture Page 2 — tabstrip`, with a timeout. A timeout expiry IS a real fail; an un-polled first read is not evidence either way.** *(Caught at the pre-run premise audit: the spec learned this at row 2 and then did not carry it next door.)* **This row discharges leg 3's AC11 and leg 4's AC7.** |
| 6 | **⛔ SUPERSEDED (F11 Leg 4 — dead instrument: native HTML5 DnD. Successor: `cross-window-drag.md` row 5, arm (a) — the sole-tab tear-off refusal, operator-performed; the refusal arm itself is still-live product code. Do not run. Kept as historical record.)** **SOLE-TAB tear-off is REFUSED and ANNOUNCED, and the tab STAYS (DD5).** Install the **per-record** recorder in **W2's** chrome (the same `evaluate` as row 4, against **C2**). W2 holds **only T2**. Read W2's strip rect and `#webviews` top. `dragPointer(C2, from: <T2's rect center in W2>, to: {x: <T2's center x + 40, to clear the 5px arm threshold>, y: <below W2's strip, above its `guestTop`>})`. Then `enumerateWindows()`, `enumerateTabs()`, `evaluate(C2, "window.__gfAnn")`. | **NO third window** — `enumerateWindows()` still returns **TWO** rows. **T2 is STILL IN W2, at its origin index, with its `wcId` unchanged.** **The recorder captured exactly `['Cannot move the only tab to a new window']`** ⇒ **the refusal is ANNOUNCED, not silent** — DD5's core demand (*"no bare nulls, no silent deaths"*; the inherited handler had **four `return null` sites** carrying **six conditions**, and the renderer **ignored the return entirely** — correct for a menu item that can be **omitted** at build time, **wrong for a drag**, which the user physically performs and which cannot be omitted). **A refusal is ANNOUNCED, NOT ANIMATED**: `clearDragVisuals()` runs at `pointerup` exactly as today and `commitTabMove` is simply not called, so **the tab is already at its origin before any reply lands** — assert the origin index, and do **not** expect a snap-back animation. *(The rationale that applies here is the tear-off one — a sole-tab tear-off to a **new** window is a **no-op window swap**, so it stays refused. Consolidating a sole tab into an **existing** window is the useful case and now ships, M09 F10 L3 — but that is a different path; row 6's tear-off behavior is unchanged.)* |
| 7 | **⛔ SUPERSEDED (F11 Leg 4 — dead instrument: native HTML5 DnD. Successor: `cross-window-drag.md` row 5, arm (b) — the internal-tab refusal, operator-performed; the refusal arm itself is still-live product code. Do not run. Kept as historical record.)** **INTERNAL-TAB tear-off is REFUSED and ANNOUNCED (DD5).** In **W1**, open Settings **through the REAL kebab path** — `click(C1, <kebab rect center>)`, resolve W1's sheet from `enumerateWindows().sheetWcId`, click the **Settings** item — so `goldfinch://settings` opens in its own internal-session tab → **S**. Re-arm the **per-record** recorder against C1. Re-read W1's strip rects and `guestTop` **from the chrome DOM**. `dragPointer(C1, from: <S's rect center>, to: {x: <S's center x + 40, to clear the 5px arm threshold>, y: <below W1's strip, above `guestTop`>})`. Then `enumerateWindows()`, the chrome-DOM strip order, and `evaluate(C1, "window.__gfAnn")`. | **No new window**; **S is still in W1 at its origin index** in the strip's DOM order. **The recorder's LAST entry is `'This tab cannot be moved to a new window'`** ⇒ internal/trusted tabs are refused **and announced** — app-UI pages never move between windows. ⇒ together with row 6, **both refusal conditions the move core can reach on the tear-off path are announced** (`no-target` is **unreachable** from tear-off, which always creates its own destination; `no-tab` is a vanished-tab race this spec does not provoke). **⚠ INSTRUMENT NOTE — read S's presence from the CHROME DOM, not from a guest read.** The gesture and the observable both live in the **chrome** (`dragPointer` targets **C1**; S's guest wcId is never touched), so the internal-session guard is not engaged and no row here depends on it. `enumerateTabs()` **does** list S at the **admin** tier — the engine is built `{ allowInternal: true }` (`engine.js`), and `internal-session-exclusion.md`'s "internal is filtered from enumeration" is a **JAR-tier** claim, a different tier with a different answer. It is corroboration here, never the primary read. *(Do not "fix" this row by driving S's guest: `evaluate`/`navigate`/`goBack` on the internal session are refused **even for admin** by op-local guards.)* |
| 8 | **THE KEYBOARD CROSS-WINDOW MOVE — the mission criterion's SURVIVING SUBSTANCE, and the only live proof of it (AC3).** In **W1**, re-arm the **per-record** recorder against C1. Read T1's rect. **Right-click T1** — the REAL path: `click(C1, <T1's rect center>, button: 'right')` — never a synthesized IPC. Resolve W1's sheet from `enumerateWindows().sheetWcId` (**lazy — absent until first open**; poll briefly). Read the sheet's items (`readAxTree(<sheetWcId>)` + `evaluate(<sheetWcId>, …)` for item rects). **Click the `Move to window "…"` item** naming W2. Then `enumerateTabs()`, `evaluate(T1, "history.length")`, `goBack(T1)`, **POLL** `readDom(T1)` to settle, `evaluate(C1, "window.__gfAnn")`. | The menu carries **exactly ONE** `Move to window "…"` item (W2 is the only other window), captioned from **W2's active tab title** — **⚠ RESOLVE THAT CAPTION LIVE, DO NOT ASSUME IT: row 5's `goBack(T2)` left W2's active tab on `Fixture Page 2 — tabstrip`, NOT Page 3.** *(Caught at the pre-run audit — the caption is a live read off the target's active tab, so an earlier row's navigation changes it.)* — and **`Move to new window` is still present** alongside it (DD8 put them in the same section; F6's item is not displaced). **After the click: T1's `windowId` is W2**, and — **the identity triple again, through the OTHER door** — its **`wcId` is UNCHANGED** from row 2, its **`jarId` is still `'work'`**, `evaluate(T1, "history.length")` → still **`2`**, and `goBack(T1)` lands on **`Fixture Page 1 — tabstrip`** with **both** markers present. **The recorder's sequence contains `'Tab moved to another window'` and NOT `'Move canceled'`** ⇒ the success-path announcement bug is absent on this path too — **and DD6 names this path as the WORST case for it**, because main sends `tab-moved-away` to the source *before the handler returns*. ⇒ **a tab moves A→B keeping jar identity and page state.** **This is the mission's cross-window substance, delivered by KEYBOARD — and it does NOT satisfy the criterion whose subject is the DRAG.** Corroborate on pixels: `captureScreenshot(C1)`/`captureScreenshot(C2)`. |
| 8a | **THE DISPLACED TAB — an adopt into an EXISTING window must leave exactly ONE active tab there. Read the census, do NOT look at the screen.** No new gesture: this row re-reads the state row 8 just produced. `enumerateTabs()`, and report **every** row whose `windowId` is **W2**, each with its `wcId` and its `active` flag verbatim. | **W2 returns EXACTLY TWO rows — T2 and T1 — and EXACTLY ONE of them has `active: true`: T1**, the tab row 8 moved in. **T2 — W2's active tab until row 8 displaced it — now reads `active: false`.** ⇒ the target's outgoing tab was deactivated **and** hidden by the move itself. **⚠ THE FAILING READING IS `TWO` ACTIVE ROWS, AND IT IS THE ONE THIS ROW EXISTS FOR.** `moveTabIntoWindow` **pre-sets** `target.activeTabWcId` to the moved tab. `tab-set-active` is the **only other** place that hides an outgoing guest, and its hide-old branch is gated on `owner.activeTabWcId !== wcId` — so by the time the adopt round-trip (`adopt-tab` → `onAdoptTab` → `activateTab` → `tab-set-active`) arrives, that guard is **already false**, the branch is **skipped**, and the displaced tab keeps `active: true` **and** `setVisible(true)` **behind** the moved one. The move core must therefore hide it **itself, synchronously, before the pre-set** — it cannot delegate to a round-trip whose guard it has already disarmed. **⚠ THIS ROW'S INSTRUMENT IS THE CENSUS, AND PIXELS ARE NOT AN ACCEPTABLE SUBSTITUTE — that is precisely how the first run missed this.** The stale guest sits **directly behind** the moved tab and, at equal window sizes, is **completely covered** by it: `captureScreenshot(C2)` is **byte-identical** whether the bug is present or not ⇒ **discrimination zero**. `active` in `enumerateTabs` is a **real observable** (`automation/tabs.js` maps `active: !!t.active` off the record) and is the only instrument here that can fail. **Do not add a screenshot to this row to make it feel corroborated.** **⚠ WHY THIS ROW CARRIES ITS OWN POSITIVE CONTROL:** the reading is not the bare count **one** — it is the **pair** `{T1: true, T2: false}` **from a single call**. Both values appear, so the flag is provably not stuck-true; a row asserting only "one active tab" against a window holding **one** tab would pass on an instrument that always returns `true`. This is why the row runs **after** row 8 (W2 holds two tabs) and never before it. **⚠ EXCLUSIVE TO THE EXISTING-WINDOW PATH — do not "cover" it with a tear-off row.** A move-created target is a `noBootTab` window whose `activeTabWcId` is **`null`**, so the hide-old branch is vacuous there and rows 3–7 are **structurally unable** to fail this way. Only rows 8/8a reach it. |
| 9 | **STALE-WINDOW REFUSAL — a window closing between menu build and dispatch (AC3, DD8/DD5).** In **W1**, right-click **T3** and resolve the sheet; **confirm the `Move to window "…"` item for W2 is rendered**. **Then close W2 WITHOUT touching the open menu**: `evaluate(C2, "window.goldfinch.windowClose()")` (the REAL sender-resolved `window-close` IPC). Poll `enumerateWindows()` until **W2 is gone**. **Then click the still-rendered `Move to window "…"` item.** Then `enumerateTabs()` and `evaluate(C1, "window.__gfAnn")`. | **T3 IS NOT MOVED** — it stays in **W1 at its origin index**, `wcId` unchanged, and **no window is created**. **The recorder's last entry is `'That window is no longer open — the tab was not moved'`** ⇒ **the refusal is announced**, and the stale request **refuses rather than re-pointing at a survivor**. ⇒ **this is DD8's whole reversal, measured.** The renderer echoes back the **`windowId`** main built into the item id; main re-resolves it through `registry.get()` and refuses on `null`. **The ordinal scheme the design review reversed could not do this**: to resolve an ordinal at dispatch, main must either **rebuild the list** (a closed window shortens it, so the ordinal silently means a **DIFFERENT window** — the exact mis-target it existed to forbid) or **retain the map** (a cache, which it also forbade). **The authority rule holds on its own terms**: the renderer's echoed `windowId` is a **request**, never a claim of ownership. **⚠ PRECONDITION THIS ROW ACTUALLY DEPENDS ON — verify, do not assume:** the open sheet must **survive** W2's close. Per-window dismissal scoping (F7 DD5) says W1's sheet is unaffected by anything happening to W2, and the `move-targets-changed` push updates a renderer-side **cache** that the **already-rendered** menu does not re-read. **If the menu is dismissed or the item vanishes, the row's scenario was never reached — record it as UNREACHED-AS-SPECIFIED and DO NOT report it as a pass or a fail.** |

**Row conventions:** one row = one logical checkpoint. **Row 2 must be judged before
row 8** — it is the *before* half of the identity reading, and a claim that a number
survived a re-parent is unmakeable without the number. **Every announcement assertion (rows
8, 9) is over the SEQUENCE, never the final value** — the live region never clears, and a
bug's own ordering hides it from a final-value read. Every rendered-state capture targets a
**chrome wcId**, never a guest: `captureScreenshot`/`readAxTree` **activate and raise**
guest targets and would mutate the very state under test. Window identity is always read
from `enumerateWindows`, never inferred from OS focus.

*(HISTORICAL — conventions of the superseded rows 3–7, kept as record: rows 3 and 4 were a
CONTROLLED PAIR — same op, same tab, same start point, same drop `x` (`DROP_X`); the only
variable the drop `y`, which moved the point from inside the strip's rect to outside it —
and the pair had to move in `x` at all because the pointer layer's arm test was
`Math.hypot(dx, dy) < DRAG_ARM_THRESHOLD_PX` (=5). **Neither the threshold nor the pointer
arm exists anymore** — F11 retired `shouldArm`/`DRAG_ARM_THRESHOLD_PX` outright (native DnD
owns arming), so do not resurrect this prose as a live constraint. The zone-model control
survives as `cross-window-drag.md` row 2, operator-performed.)*

**⚠ RESIDUAL COVERAGE OWED (HIGH-1, NEVER RUN) — the DISPLACED MENU, sibling to row 8a.**
The same pre-set of `target.activeTabWcId` that row 8a pins disarms **one** `tab-set-active`
guard gating **two** effects: the outgoing-tab hide (8a) **and**
`owner.sheet?.closeMenuOverlay('tab-switch')`. So an adopt into an existing window **that has
its OWN menu open** must close that menu; without the mirror the round-trip's `tab-set-active`
instead hits `else if (owner.sheet?.isMenuOpen()) owner.sheet.show()` and **re-shows W2's
stale menu** at the moved tab's freshly-synced bounds (its active guest changed underneath
it). **This does NOT slot into the linear row 8→9 chain** — it needs its OWN menu-open setup
on the target, and mutating W2's tab population mid-chain would wedge row 9. A future run must
build it in ISOLATION: two windows; open a menu ON W2 (`click(C2, <a W2 tab center>, button:
'right')`, poll `enumerateWindows()` until **W2's `sheetVisible` is `true`**); then move a W1
web tab into W2 by row 8's keyboard path; then re-read `enumerateWindows()` and **assert W2's
`sheetVisible` is now `false`**. **Instrument is the census `sheetVisible`, never a
screenshot** — same as 8a, the stale menu sits over the moved guest and pixels can't
discriminate it. **Exclusive to the existing-window path** (a move-created target has no menu
to displace). The STRUCTURAL fix (stop pre-setting `target.activeTabWcId`) is F9's; until then
the move core mirrors the close synchronously, right where it mirrors 8a's hide.

## Out of Scope

- **CROSS-WINDOW DRAG — NOW SHIPS (M09 F11, native HTML5 DnD) AND IS VERIFIED ELSEWHERE:
  `cross-window-drag.md` owns the gesture** (HAT-apparatus — operator-performed, criterion 8
  witnessed live on X11; see the banner). *(HISTORICAL: this bullet used to rule the drag
  NOT VERIFIED — F8 did not ship it, and a synthetic pointer test would have passed over a
  broken feature through fiction-space. The candidate-2 measurement the old text demanded
  happened at F11 and is what shipped. The banner preserves the full doctrine, including
  its ACTIVE successor: the synthetic-`DragEvent` prohibition.)*
- *(HISTORICAL — dissolved by F11.)* **A real OS pointer dragged over a GUEST's native
  surface** — V1's single-window analogue, unmeasured while superseded row 4's instrument
  was injection into the chrome (the row released in the chrome-owned band where the
  synthetic and real paths coincide, so no row depended on it; *"tear-off remains fully
  verifiable either way"* was an overclaim, corrected here). The criterion-8 HAT and the
  successor spec's operator gesture ARE the real pointer path, so the question is no longer
  a coverage gap of this spec.
- **Cross-window adopt of a SOLE tab into an EXISTING window — NOW SHIPS (M09 F10 L3),
  no longer out of scope.** F8 refused it and recorded source-window disposal as *"a
  separate design question F8 does not open"*; **F10 L3 opens and resolves it.** A sole tab
  may now consolidate into another existing window via **Move to window …** — the
  `tab-move-to-window` path passes `allowSoleTab: true`, `moveTabIntoWindow` empties the
  source and **closes it** (Chrome parity, source disposed), and the source renderer's
  `tab-moved-away` handler **no longer boots a home tab** on an empty strip (the
  `else createTab()` arm was DELETED — an empty strip now means main is closing the window,
  so booting a tab would race a `tab-create` into a closing window). **This is verified by
  the F10 L3 runtime pass, not here** — and since F11 the consolidation also has a DRAG
  door, covered by `cross-window-drag.md` row 4. The sole-tab **tear-off / new-window**
  refusal (still a no-op window swap, still refused) was superseded row 6's assertion; its
  successor is `cross-window-drag.md` row 5, arm (a).
- **Tear-off window PLACEMENT** — DD4, **cosmetic-only by ruling**: `setPosition` is a
  **measured no-op on this rig** (V6). Placement is **never correctness** — the tab still
  moves. No row asserts where the new window lands, and **none should**: the only
  instruments that could read it back are the cached fictions DD16 bans.
- **`tab-reorder`'s full regression surface** — `tab-reorder.md` owns the keyboard reorder
  and the click model (its own pointer-drag step is superseded the same way this spec's
  rows 3–7 are). The live in-strip reorder control is `cross-window-drag.md` row 2;
  superseded row 3 here was the old same-run control, never a substitute.
- **The arm threshold — RESOLVED, then RETIRED: it no longer exists.** *(HISTORICAL: this
  bullet used to record that the `Math.hypot(dx, dy)` arm threshold was owned by NOBODY —
  an ownership gap where this spec, `tab-reorder.md`, and the unit suite each believed
  another held it, corrected at the 2026-07-16-06-33-26 `tab-reorder` run. F9 then
  discharged the debt properly — `shouldArm(dx, dy)` extracted to `tab-drag-zone.js` with
  unit tests falsifying the straight-down case both directions.)* **F11 then RETIRED
  `shouldArm`/`DRAG_ARM_THRESHOLD_PX` and their tests outright** — native HTML5 DnD owns
  arming, there is no threshold predicate in the product anymore, and no spec should claim
  or seek one. Kept as the record of an ownership-gap lesson, not as live scope.
- **`tab-context-menu`'s full item set / roving focus / dismissal** — `tab-context-menu.md`
  owns them. Rows 8–9 assert only the `Move to window …` items DD8 adds.
  > **⚠ DD8's COVERAGE IS A CROSS-SPEC PAIR, AND NEITHER HALF WORKS ALONE. Do not delete
  > either half without reading the other.** *(Established at the 2026-07-16-06-33-26
  > `tab-context-menu` run.)*
  > - **This spec (row 8) owns the PRESENCE side**: with a second window open, **exactly
  >   one** `Move to window "…"` item, captioned **live** from the target's active tab.
  > - **`tab-context-menu.md` owns the ABSENCE side**: at **one** window the item is
  >   **omitted entirely** — no header, no note, no empty submenu.
  > - **Absence alone is UNFALSIFIABLE**: at one window, "no such item" reads **identically**
  >   whether the omission gate works, the `move-targets` seed/push is broken, or **the DD8
  >   loop was never written at all**. **Presence is what gives absence its meaning**, and
  >   presence lives *here*. Read in isolation, each file looks like it covers DD8 and
  >   neither does.
- **`multi-window-shell`'s lifecycle surface** (New Window minting, close-one-of-N,
  quit-on-last, whole-window closed-tab capture) — **that spec owns it.** Row 9 uses
  `windowClose()` only as the cheapest way to make a target window stale.
- **The DD7 OS-blur gap** — V7 measured that **WSLg DOES deliver real OS blur**
  (`SetForegroundWindow` → blur+focus fired), refuting the F7 debrief's gloss that *"WSLg
  has no OS blur"*. **The gap is rig-reachable and was before F8 existed.** It is a
  **mission known issue**; no row here claims it.

## Variants (optional)

*(Both variants below belonged to the superseded drag rows and are HISTORICAL here — if
either is ever wanted live, it is a `cross-window-drag.md` variant, operator-performed. The
`classifyDragPoint`/`dropIndexFromPointer` tie-break facts they cite remain true and remain
unit-pinned in `tab-drag-zone.test.js`/`tab-order.test.js`.)*

- **Tear-off of a tab dragged out through the strip's SIDE edge** rather than its bottom.
  `classifyDragPoint` treats the rect as **inclusive on all four edges** and returns
  `tearOff` for a point outside on **any** edge, so a left/right exit should behave
  identically to row 4's downward one. Promote to a real row if it ever fails — it is a
  variant only because the bottom exit is the gesture a user actually performs.
- **A pointer released exactly ON the strip's boundary.** Ties resolve **toward the strip**
  (`reorder`) deliberately: the conservative side of this decision is the one that does
  **not** move the user's tab to another window, and `dropIndexFromPointer` resolves its own
  midpoint ties the same way, so the two agree at their boundaries. A variant rather than a
  row because it asserts a **tie-break**, and `tab-drag-zone.test.js` already pins it
  offline where the boundary is exact and a live rect's sub-pixel rounding cannot blur it.
