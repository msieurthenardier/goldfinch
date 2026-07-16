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
**⚠ ROW 8a WAS ADDED AT F8's FLIGHT-END REVIEW AND HAS NEVER RUN.** The 9-checkpoint verdict
above is the **first run's** and is **not** a verdict on it — row count is now **10**. It covers a
HIGH defect the flight-end review found by reading source: the target's **outgoing** tab stayed
`active: true` and `setVisible(true)` after an adopt into an **EXISTING** window. **Every row
above missed it, and the reason is structural** — rows 3–7 tear off into a **fresh** window
(`activeTabWcId === null`, so there is no outgoing tab to displace), and row 8, the one row that
*does* drive the existing-window path, asserted the **moved** tab's identity and never asked what
became of the tab it displaced. **The fix and the row land together; the row's first reading is
owed with the clean re-run above.**

> ## ⚠️ THIS SPEC DOES NOT VERIFY CROSS-WINDOW DRAG, AND THAT IS DELIBERATE
>
> **F8 does not ship the cross-window drag gesture** (flight RE-SCOPED banner, DD16, and
> the flight log's *Flight Director Rulings on Leg 2*). The mission criterion *"a tab
> **dragged** from one window's strip into another window's strip moves there"* goes
> **UNSATISFIED**. This spec does not paper over that.
>
> **And it must not, because a cross-window drag test on this rig WOULD PASS.** The leg-2
> transport spike measured two facts that combine into a trap:
> 1. **Electron's window coordinates on this rig are a cached fiction** — `setPosition` is
>    a no-op, a real OS move fires no event, a virgin window is **born 363px wrong**, and
>    `screenX ≡ getBounds.x − 16` (two proxies of one value, which is why the recon probe
>    "passed": an instrument cannot discriminate against itself).
> 2. **Chromium never clips injected coordinates to the view bounds** (V5, POSITIVE).
>
> So a synthetic cross-window drag **runs and goes GREEN** while driving the handoff
> through **fiction-space that a real human misses by 1353px**. **A passing test over a
> broken feature is worse than no test** — it promotes an S1 silent success into the
> regression net, which is exactly what this project already shipped once
> (`multi-window-shell` passed 9/9 over a real cross-window `activateTab` bug for an
> entire flight).
>
> **If a future author finds they can make a cross-window drag row pass here, that is the
> hazard, not the win.** Real OS pointer delivery across window bounds is **V1 → HAT**.
> The next transport spike must measure against a **second instrument** (Win32
> `GetWindowRect` over WSLg's RAIL surface), because Electron's coordinate self-reports
> are **not falsifiable from inside Electron**. The unmeasured alternative is the
> mission's **candidate 2** (HTML5 drag with a custom MIME), where the **browser** owns
> the transport and no app-level global coordinate exists — foreclosed by omission at
> design time, never measured.
>
> **What DOES cross windows in F8 is the KEYBOARD move**, and rows 8–9 verify it. That is
> the mission criterion's surviving substance and the only live proof of it.

## Intent

Verify the two tab-movement gestures **F8 actually ships**, on live windows:

1. **Tear-off by drag** (rows 3–7) — dragging a tab out of the strip and releasing it
   makes the tab **its own new window**, decided entirely from **window-local coordinates**
   (DD16: `e.clientX/Y` against the strip's own `getBoundingClientRect()`; nothing reads
   `screenX`, `win.getBounds()`, `getPosition`, or the `screen` module). This is precisely
   **why tear-off survived the spike that killed cross-window drop** — it never needed a
   shared coordinate space.
2. **The keyboard cross-window move** (rows 8–9) — the tab context menu's flat
   `Move to window "…"` items keyed by `windowId` (DD8).

**The load-bearing assertion in both is IDENTITY (DD2 — the mission's ABSOLUTE
constraint): the moved tab is the SAME live `webContents`, never destroyed and recreated.**
Same `wcId`, same jar, **live history**. Nothing else in this flight proves it — legs 3 and
4 pinned the code's *shape* and honestly declined the runtime readings, because this repo
has **no DOM or main-process harness** (bare `node --test`, no jsdom; `main.js` is never
executed, only read). **This spec is the flight's only instrument for DD2**, which is why
it exists rather than a unit test: `removeChildView` → `addChildView` across two real
`BaseWindow`s, with a live guest's history surviving the re-parent, is not expressible
offline.

It also verifies what DD5 demands of the **refusal** paths — sole-tab and internal-tab
drags are **refused and ANNOUNCED**, with the tab left at its origin — and the
**accessibility bug the design review caught**: **no `'Move canceled'` announcement on the
SUCCESS path** (row 4).

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

- **`announceTabStatus` NEVER CLEARS — and that is why rows 4/8 install a RECORDER.**
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
- **`dragPointer` paces its moves** (`steps` default 12, `stepDelayMs` default 4ms).
  **An unpaced synchronous burst gets coalesced by Chromium down to essentially first +
  last**, starving the zone model of intermediate reads. Do not set `stepDelayMs: 0`.
- **`e.buttons` is 0 on every synthetic `pointermove` after the down** (DD9, carried).
  **Any handler gating on `e.buttons` will not fire under test.** F8's drag does not gate
  on it; this is recorded so a future change that adds such a gate fails **loudly** here
  rather than passing vacuously.

### THE ONE THING THIS SPEC'S TEAR-OFF ROWS DO **NOT** PROVE — named, not glossed

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
  - `dragPointer` — the gesture. Viewport-relative, into the **chrome** wcId.
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
| 2 | **Provision the fixture and SEED LIVE HISTORY — the identity baseline.** `openTab(page1Url, 'work')` → **T1**; `navigate(T1, page4Url)`. `openTab(page2Url, 'work')` → **T2**; `navigate(T2, page3Url)`. `openTab(page5Url, 'work')` → **T3**. **Poll** `evaluate(T2, "history.length")` until it reads **2** (see the gate note). Read `evaluate(T1, "history.length")`, and the census. Record T1's and T2's **`wcId`** and **`jarId`**. | W1 holds the boot tab + **T1, T2, T3**, every one `jarId: 'work'`, `windowId: W1`, titles pairwise distinct. **`evaluate(T2, "history.length")` → exactly `2`** (page 2, then page 3) and **`evaluate(T1, "history.length")` → exactly `2`** (page 1, then page 4). ⇒ **this is the BEFORE half of the identity reading** — rows 5 and 8 assert these same numbers *after* a re-parent, and a baseline not recorded here is a claim that cannot be made there. **⚠ COMMIT-SETTLE GATE (`ERR_ABORTED`), inherited from `multi-window-shell` step 2 and load-bearing:** an immediate `navigate` **races the first page's uncommitted load, aborts it, and leaves a 1-entry history**. A `length` of **1** here is that race — **not** a product defect. **Poll to `2` before proceeding; if it will not settle, STOP** — every later identity claim rests on this number, and a run that proceeds from a 1-entry history proves nothing about history survival. |
| 3 | **THE ZONE MODEL'S CONTROL: the SAME gesture from the SAME point to the SAME `x` — and ONLY the drop `y` differs. In-strip drags still REORDER (F2, unchanged).** Read the strip rect, the guest slot's top, and the tab rects from the chrome DOM: `evaluate(C1, "JSON.stringify({strip: document.querySelector('#tabstrip').getBoundingClientRect().toJSON(), guestTop: document.querySelector('#webviews').getBoundingClientRect().top, tabs: [...document.querySelectorAll('#tabstrip .tab')].map(el => ({id: el.dataset.id, r: el.getBoundingClientRect().toJSON()}))})")`. **`dragPointer(C1, from: <T2's rect center>, to: {x: <T3's rect `right` − 2 — call this DROP_X>, y: <T2's rect center y — inside the strip>})`.** Re-read the strip's DOM order and the census. | **T2 REORDERS within W1 — it does NOT tear off.** The strip's DOM order changes (T2 now sits **after** T3); `enumerateWindows()` **still returns exactly ONE row** (no new window); T2's `windowId` is **still W1** and its **`wcId` is unchanged**. ⇒ **the reorder half of the zone model is intact, and this row is row 4's NEGATIVE CONTROL**: rows 3 and 4 issue the *same* op on the *same* tab from the *same* start point **to the same `DROP_X`**, and differ in **exactly one variable — the drop `y`** (row 3 inside the strip's rect, row 4 outside it). Without this row, row 4's tear-off cannot be attributed to the y-axis rather than to "any drag now tears off". *(Leg 3 changed the arm threshold from `Math.abs(dx)` to `Math.hypot(dx, dy)` — `tab-reorder.md` owns that regression in full; this row is the same-run control, not a duplicate of it.)* **⚠ WHY `right − 2` AND NOT T3's CENTER — `dropIndexFromPointer` IS STRICT.** It increments on `pointerX > midpoint` (`tab-order.js`), so a drop **exactly on** T3's center x lands **ON the tie**, does **not** count T3, and yields T2's **existing** index ⇒ **no reorder at all**, and the row would fail as a **spec artifact**. Worse, it would be a **coin flip**: `dragEvents` **rounds** intermediate moves (`input.js`) and the zone is decided by the **last pointermove**, not the `mouseUp` — so the outcome would hinge on whether T3's center x happens to carry a fractional part ≥ 0.5. Dropping strictly **past** the midpoint (and still `≤ strip.right`, so the zone stays `reorder`) makes the row deterministic. *(Ties resolve toward "before" **by design** — `classifyDragPoint` treats the strip rect as inclusive on all four edges for the same reason: the conservative side is the one that does **not** move the user's tab.)* Corroborate on rendered state: `captureScreenshot(C1)` + `readAxTree(C1)` show the reordered strip. |
| 4 | **TEAR-OFF BY DRAG — the flight's gesture. Install the announcement recorder FIRST.** `evaluate(C1, "window.__gfAnn = []; new MutationObserver((rs) => { for (const r of rs) for (const n of r.addedNodes) window.__gfAnn.push(n.textContent); }).observe(document.querySelector('#tab-status'), {childList: true, characterData: true, subtree: true}); '__gfAnn-armed'")`. Re-read the strip rect. **`dragPointer(C1, from: <T2's rect center>, to: {x: <DROP_X — THE SAME x as row 3>, y: <BELOW the strip's `bottom` and ABOVE `guestTop` — the chrome-owned band; see the V1 note in Preconditions>})`.** Then `enumerateWindows()`, `enumerateTabs()`, and `evaluate(C1, "window.__gfAnn")`. | **A NEW WINDOW EXISTS**: `enumerateWindows()` returns **TWO** rows. Record the new one as **W2** / **C2**. **The source strip CLOSES RANKS**: W1's census rows no longer include T2, the remaining tabs are contiguous, and W1 has a sane active tab. **AND THE ANNOUNCEMENT SEQUENCE IS EXACTLY `['Tab moved to a new window']`** — **`'Move canceled'` DOES NOT APPEAR.** ⇒ **the accessibility bug the design review caught is absent** (DD6: `tab-moved-away` reaches the source *before* the invoke reply, so a `cancelDrag()` on the success path would announce a **false** `'Move canceled'` to a screen-reader user, against the mission's constraint that accessibility contracts may only be **extended**). **This is a MEASUREMENT, not a dead instrument, *because the success string is in that same array, captured by that same recorder, during that same gesture*** — and it is why the row asserts the **whole sequence** rather than the final value: **the live region never clears**, so the bug's own ordering (`'Move canceled'` then overwritten by the success string) would make a final-value read report **success and miss it**. **⚠ THE RECORDER READS EACH MUTATION RECORD'S `addedNodes`, NOT the live `textContent` — AND THAT IS THE WHOLE POINT.** A callback that re-reads `textContent` would **coalesce**: MutationObserver delivers a **batch** per microtask checkpoint, so two announcements in one checkpoint would produce **ONE** push of the **final** value — **silently reinstating the exact final-value blindness this recorder exists to defeat**, and destroying this row's positive control (an array reading `['Tab moved to a new window']` could then mean *"both fired and coalesced"*). `textContent =` replaces children, so **every** announcement lands as an `addedNodes` text node and per-record reading is total. *(Caught at the pre-run premise audit. DD6's own ordering probably separates the deliveries anyway — but that is an **inference about timing, not a guarantee**, and a control that rests on one is not a control.)* Corroborate on pixels: `captureScreenshot(C1)` shows the strip **without** T2; `captureScreenshot(C2)` shows the new window's strip **with** it. |
| 5 | **THE IDENTITY READING — DD2's claim and the mission's ABSOLUTE constraint. NOTHING ELSE IN THIS FLIGHT PROVES IT.** From the census, read T2's row. Then `evaluate(T2, "history.length")` — **before** the `goBack`, so the count is unperturbed. Then `goBack(T2)`; then **POLL** `readDom(T2)` until the marker reads the expected page, with a timeout (see the settle gate). | **T2 carries the SAME `wcId` it was recorded with in row 2** — the number is **unchanged** across the tear-off ⇒ **the live `webContents` was RE-PARENTED, never destroyed and recreated** (`removeChildView` → `addChildView`). Its **`windowId` is now W2** (and only that changed). **`jarId` is still `'work'`** ⇒ the jar identity travelled with the tab, and the jar pill in W2's chrome renders it. **`evaluate(T2, "history.length")` → still exactly `2`** — the number from row 2, carried through the re-parent ⇒ **live history survived**. **`goBack(T2)` then lands on `Fixture Page 2 — tabstrip`**, positively identified by `readDom(T2)` finding **both** committed markers (`<h1 id="marker">` echoing that title **and** `<p id="body-marker">`). ⇒ **destroy-and-recreate is refuted on TWO independent observables — the unchanged `wcId` and the live history — either of which it would break.** **⚠ THE JAR LEG REFUTES NOTHING, AND SAYING OTHERWISE WOULD BE THIS SPEC'S OWN OVERCLAIM.** *(Folded at the first run, 2026-07-16-04-08-49: the row previously claimed **three** independent observables. It is **two**.)* A tab **destroyed and recreated in the same partition** would read `jarId: 'work'` **identically** — the jar reading is **not** a discriminator against recreation. It earns its place for a **different** mission constraint (*"a tab keeps its jar identity through the move"*, which a re-parent into the wrong session **would** break), and it is asserted **as that**, never as evidence of re-parenting. **The count of independent refutations is two; do not inflate it.** **⚠ `goBack` ALONE WOULD PROVE NOTHING and must not be substituted for this triple:** `wc.goBack()` is a **silent no-op with no back history** and returns `{"ok":true}` **either way** — *identical readings on a live history and a dead one*. The **count** is what makes the landing falsifiable, and the **marker read** is what makes the count more than a number. *(This is `getHistory`'s lesson from F7, applied to the op next door.)* **⚠ COMMIT-SETTLE GATE ON THE `goBack`, and it is row 2's gate applied where row 2 forgot to apply it:** `goBack` **returns before the back navigation commits**, so an *immediate* `readDom` can still read the **OUTGOING** page (`Fixture Page 3`) and fail the marker clause for a **purely timing** reason. **POLL `readDom(T2)` until the marker reads `Fixture Page 2 — tabstrip`, with a timeout. A timeout expiry IS a real fail; an un-polled first read is not evidence either way.** *(Caught at the pre-run premise audit: the spec learned this at row 2 and then did not carry it next door.)* **This row discharges leg 3's AC11 and leg 4's AC7.** |
| 6 | **SOLE-TAB tear-off is REFUSED and ANNOUNCED, and the tab STAYS (DD5).** Install the **per-record** recorder in **W2's** chrome (the same `evaluate` as row 4, against **C2**). W2 holds **only T2**. Read W2's strip rect and `#webviews` top. `dragPointer(C2, from: <T2's rect center in W2>, to: {x: <T2's center x + 40, to clear the 5px arm threshold>, y: <below W2's strip, above its `guestTop`>})`. Then `enumerateWindows()`, `enumerateTabs()`, `evaluate(C2, "window.__gfAnn")`. | **NO third window** — `enumerateWindows()` still returns **TWO** rows. **T2 is STILL IN W2, at its origin index, with its `wcId` unchanged.** **The recorder captured exactly `['Cannot move the only tab to a new window']`** ⇒ **the refusal is ANNOUNCED, not silent** — DD5's core demand (*"no bare nulls, no silent deaths"*; the inherited handler had **four `return null` sites** carrying **six conditions**, and the renderer **ignored the return entirely** — correct for a menu item that can be **omitted** at build time, **wrong for a drag**, which the user physically performs and which cannot be omitted). **A refusal is ANNOUNCED, NOT ANIMATED**: `clearDragVisuals()` runs at `pointerup` exactly as today and `commitTabMove` is simply not called, so **the tab is already at its origin before any reply lands** — assert the origin index, and do **not** expect a snap-back animation. *(The rationale that actually applies here is the tear-off one — a sole-tab tear-off is a **no-op window swap**. The inherited "never leave the source at zero tabs" reason is **false for a cross-window adopt** and F8 refuses that case for a **different** measured reason; see Out of Scope.)* |
| 7 | **INTERNAL-TAB tear-off is REFUSED and ANNOUNCED (DD5).** In **W1**, open Settings **through the REAL kebab path** — `click(C1, <kebab rect center>)`, resolve W1's sheet from `enumerateWindows().sheetWcId`, click the **Settings** item — so `goldfinch://settings` opens in its own internal-session tab → **S**. Re-arm the **per-record** recorder against C1. Re-read W1's strip rects and `guestTop` **from the chrome DOM**. `dragPointer(C1, from: <S's rect center>, to: {x: <S's center x + 40, to clear the 5px arm threshold>, y: <below W1's strip, above `guestTop`>})`. Then `enumerateWindows()`, the chrome-DOM strip order, and `evaluate(C1, "window.__gfAnn")`. | **No new window**; **S is still in W1 at its origin index** in the strip's DOM order. **The recorder's LAST entry is `'This tab cannot be moved to a new window'`** ⇒ internal/trusted tabs are refused **and announced** — app-UI pages never move between windows. ⇒ together with row 6, **both refusal conditions the move core can reach on the tear-off path are announced** (`no-target` is **unreachable** from tear-off, which always creates its own destination; `no-tab` is a vanished-tab race this spec does not provoke). **⚠ INSTRUMENT NOTE — read S's presence from the CHROME DOM, not from a guest read.** The gesture and the observable both live in the **chrome** (`dragPointer` targets **C1**; S's guest wcId is never touched), so the internal-session guard is not engaged and no row here depends on it. `enumerateTabs()` **does** list S at the **admin** tier — the engine is built `{ allowInternal: true }` (`engine.js`), and `internal-session-exclusion.md`'s "internal is filtered from enumeration" is a **JAR-tier** claim, a different tier with a different answer. It is corroboration here, never the primary read. *(Do not "fix" this row by driving S's guest: `evaluate`/`navigate`/`goBack` on the internal session are refused **even for admin** by op-local guards.)* |
| 8 | **THE KEYBOARD CROSS-WINDOW MOVE — the mission criterion's SURVIVING SUBSTANCE, and the only live proof of it (AC3).** In **W1**, re-arm the **per-record** recorder against C1. Read T1's rect. **Right-click T1** — the REAL path: `click(C1, <T1's rect center>, button: 'right')` — never a synthesized IPC. Resolve W1's sheet from `enumerateWindows().sheetWcId` (**lazy — absent until first open**; poll briefly). Read the sheet's items (`readAxTree(<sheetWcId>)` + `evaluate(<sheetWcId>, …)` for item rects). **Click the `Move to window "…"` item** naming W2. Then `enumerateTabs()`, `evaluate(T1, "history.length")`, `goBack(T1)`, **POLL** `readDom(T1)` to settle, `evaluate(C1, "window.__gfAnn")`. | The menu carries **exactly ONE** `Move to window "…"` item (W2 is the only other window), captioned from **W2's active tab title** — **⚠ RESOLVE THAT CAPTION LIVE, DO NOT ASSUME IT: row 5's `goBack(T2)` left W2's active tab on `Fixture Page 2 — tabstrip`, NOT Page 3.** *(Caught at the pre-run audit — the caption is a live read off the target's active tab, so an earlier row's navigation changes it.)* — and **`Move to new window` is still present** alongside it (DD8 put them in the same section; F6's item is not displaced). **After the click: T1's `windowId` is W2**, and — **the identity triple again, through the OTHER door** — its **`wcId` is UNCHANGED** from row 2, its **`jarId` is still `'work'`**, `evaluate(T1, "history.length")` → still **`2`**, and `goBack(T1)` lands on **`Fixture Page 1 — tabstrip`** with **both** markers present. **The recorder's sequence contains `'Tab moved to another window'` and NOT `'Move canceled'`** ⇒ the success-path announcement bug is absent on this path too — **and DD6 names this path as the WORST case for it**, because main sends `tab-moved-away` to the source *before the handler returns*. ⇒ **a tab moves A→B keeping jar identity and page state.** **This is the mission's cross-window substance, delivered by KEYBOARD — and it does NOT satisfy the criterion whose subject is the DRAG.** Corroborate on pixels: `captureScreenshot(C1)`/`captureScreenshot(C2)`. |
| 8a | **THE DISPLACED TAB — an adopt into an EXISTING window must leave exactly ONE active tab there. Read the census, do NOT look at the screen.** No new gesture: this row re-reads the state row 8 just produced. `enumerateTabs()`, and report **every** row whose `windowId` is **W2**, each with its `wcId` and its `active` flag verbatim. | **W2 returns EXACTLY TWO rows — T2 and T1 — and EXACTLY ONE of them has `active: true`: T1**, the tab row 8 moved in. **T2 — W2's active tab until row 8 displaced it — now reads `active: false`.** ⇒ the target's outgoing tab was deactivated **and** hidden by the move itself. **⚠ THE FAILING READING IS `TWO` ACTIVE ROWS, AND IT IS THE ONE THIS ROW EXISTS FOR.** `moveTabIntoWindow` **pre-sets** `target.activeTabWcId` to the moved tab. `tab-set-active` is the **only other** place that hides an outgoing guest, and its hide-old branch is gated on `owner.activeTabWcId !== wcId` — so by the time the adopt round-trip (`adopt-tab` → `onAdoptTab` → `activateTab` → `tab-set-active`) arrives, that guard is **already false**, the branch is **skipped**, and the displaced tab keeps `active: true` **and** `setVisible(true)` **behind** the moved one. The move core must therefore hide it **itself, synchronously, before the pre-set** — it cannot delegate to a round-trip whose guard it has already disarmed. **⚠ THIS ROW'S INSTRUMENT IS THE CENSUS, AND PIXELS ARE NOT AN ACCEPTABLE SUBSTITUTE — that is precisely how the first run missed this.** The stale guest sits **directly behind** the moved tab and, at equal window sizes, is **completely covered** by it: `captureScreenshot(C2)` is **byte-identical** whether the bug is present or not ⇒ **discrimination zero**. `active` in `enumerateTabs` is a **real observable** (`automation/tabs.js` maps `active: !!t.active` off the record) and is the only instrument here that can fail. **Do not add a screenshot to this row to make it feel corroborated.** **⚠ WHY THIS ROW CARRIES ITS OWN POSITIVE CONTROL:** the reading is not the bare count **one** — it is the **pair** `{T1: true, T2: false}` **from a single call**. Both values appear, so the flag is provably not stuck-true; a row asserting only "one active tab" against a window holding **one** tab would pass on an instrument that always returns `true`. This is why the row runs **after** row 8 (W2 holds two tabs) and never before it. **⚠ EXCLUSIVE TO THE EXISTING-WINDOW PATH — do not "cover" it with a tear-off row.** A move-created target is a `noBootTab` window whose `activeTabWcId` is **`null`**, so the hide-old branch is vacuous there and rows 3–7 are **structurally unable** to fail this way. Only rows 8/8a reach it. |
| 9 | **STALE-WINDOW REFUSAL — a window closing between menu build and dispatch (AC3, DD8/DD5).** In **W1**, right-click **T3** and resolve the sheet; **confirm the `Move to window "…"` item for W2 is rendered**. **Then close W2 WITHOUT touching the open menu**: `evaluate(C2, "window.goldfinch.windowClose()")` (the REAL sender-resolved `window-close` IPC). Poll `enumerateWindows()` until **W2 is gone**. **Then click the still-rendered `Move to window "…"` item.** Then `enumerateTabs()` and `evaluate(C1, "window.__gfAnn")`. | **T3 IS NOT MOVED** — it stays in **W1 at its origin index**, `wcId` unchanged, and **no window is created**. **The recorder's last entry is `'That window is no longer open — the tab was not moved'`** ⇒ **the refusal is announced**, and the stale request **refuses rather than re-pointing at a survivor**. ⇒ **this is DD8's whole reversal, measured.** The renderer echoes back the **`windowId`** main built into the item id; main re-resolves it through `registry.get()` and refuses on `null`. **The ordinal scheme the design review reversed could not do this**: to resolve an ordinal at dispatch, main must either **rebuild the list** (a closed window shortens it, so the ordinal silently means a **DIFFERENT window** — the exact mis-target it existed to forbid) or **retain the map** (a cache, which it also forbade). **The authority rule holds on its own terms**: the renderer's echoed `windowId` is a **request**, never a claim of ownership. **⚠ PRECONDITION THIS ROW ACTUALLY DEPENDS ON — verify, do not assume:** the open sheet must **survive** W2's close. Per-window dismissal scoping (F7 DD5) says W1's sheet is unaffected by anything happening to W2, and the `move-targets-changed` push updates a renderer-side **cache** that the **already-rendered** menu does not re-read. **If the menu is dismissed or the item vanishes, the row's scenario was never reached — record it as UNREACHED-AS-SPECIFIED and DO NOT report it as a pass or a fail.** |

**Row conventions:** one row = one logical checkpoint. **Rows 3 and 4 are a CONTROLLED PAIR
— same op, same tab, same start point, same drop `x` (`DROP_X`); the ONLY variable is the
drop `y`**, which is what moves the point from **inside** the strip's rect to **outside** it.
A run that lets them differ in anything else has not tested the zone model. **⚠ Note what
this pair CANNOT be, so a future author does not "tighten" it into something unrunnable: the
drag must move in `x` to ARM AT ALL** — `Math.hypot(dx, dy) < DRAG_ARM_THRESHOLD_PX` (=5)
means a gesture holding **both** `dx = 0` and `dy = 0` never arms. Holding `DROP_X` **common
to both rows** is what makes "only y differs" **literally true** rather than aspirational.
*(The pre-run audit caught this: an earlier draft dropped row 3 at T3's center and row 4 at
T2's center — differing in **both** coordinates while the convention text claimed one.)*
**Row 2 must be judged before
rows 5 and 8** — it is the *before* half of the identity readings, and a claim that a number
survived a re-parent is unmakeable without the number. **Row 4's announcement assertion is
over the SEQUENCE, never the final value** — the live region never clears, and the bug's own
ordering hides it from a final-value read. Every rendered-state capture targets a **chrome
wcId**, never a guest: `captureScreenshot`/`readAxTree` **activate and raise** guest targets
and would mutate the very state under test. Window identity is always read from
`enumerateWindows`, never inferred from OS focus.

## Out of Scope

- **CROSS-WINDOW DRAG — NOT VERIFIED, BY RULING. See the banner at the top of this spec.**
  Not shipped in F8 (RE-SCOPED at leg 2 on measured evidence); its mission criterion is
  **UNSATISFIED**; and a synthetic test of it **would pass over a broken feature**, which
  is strictly worse than no test. **Real OS pointer delivery across window bounds: V1 →
  HAT.** The next spike must use a **second instrument** (Win32 `GetWindowRect` over RAIL)
  and should measure the **unmeasured candidate 2** (HTML5 drag with a custom MIME), where
  the browser owns the transport and no app-level global coordinate exists.
- **A real OS pointer dragged over a GUEST's native surface** — V1's single-window
  analogue, **unmeasured → HAT**. Row 4 deliberately releases in the **chrome-owned band**
  where the synthetic and real paths coincide, so no row here depends on it. **The flight's
  *"tear-off remains fully verifiable either way"* is an overclaim; this is the correction.**
- **Cross-window adopt of a SOLE tab** — F8 refuses it, for a reason **row 6's rationale
  does not cover**: the source's `tab-moved-away` handler ends `if (next) activateTab(next);
  else createTab()`, so **an emptied strip boots a fresh, unrequested home tab**. Window A
  would survive holding a home tab — neither Chrome parity (which closes A) nor obviously
  right. **Source-window disposal on tab exhaustion is a separate design question F8 does
  not open.** Recorded as a **Chrome-parity gap for the mission**, not tested here.
- **Tear-off window PLACEMENT** — DD4, **cosmetic-only by ruling**: `setPosition` is a
  **measured no-op on this rig** (V6). Placement is **never correctness** — the tab still
  moves. No row asserts where the new window lands, and **none should**: the only
  instruments that could read it back are the cached fictions DD16 bans.
- **`tab-reorder`'s full regression surface** — `tab-reorder.md` owns the F2 drag contract
  and the keyboard reorder. Row 3 is a **same-run control**, not a substitute.
- **⚠ THE `Math.hypot` ARM THRESHOLD IS OWNED BY NOBODY, AND THIS SPEC PREVIOUSLY CLAIMED
  OTHERWISE.** *(Corrected at the 2026-07-16-06-33-26 `tab-reorder` run, which measured it.)*
  This line used to say `tab-reorder.md` owns *"the `Math.hypot` arm threshold"*. **It does
  not, and neither does this spec, and neither does the unit suite** — **an ownership gap
  where each spec believed the other held it, which is exactly how a change ships
  unfalsified.**
  - Leg 3 changed the arm test from `Math.abs(dx)` to **`Math.hypot(dx, dy)`**, and
    `renderer.js` names the reason: **a straight-DOWN gesture (`dx = 0`, `dy > 5`)** must
    arm, and under `abs(dx)` it never would.
  - **`tab-reorder`'s only drag holds `y` constant ⇒ `dy = 0` ⇒ `Math.hypot(dx, 0) ≡
    Math.abs(dx)`** — it cannot distinguish the new threshold from the old.
  - **This spec's rows 3 and 4 deliberately share a common `DROP_X`**, so **both carry
    `dx ≠ 0` and would arm under `abs` too.** The very device that makes rows 3/4 a clean
    control is what blinds them to the threshold.
  - **No unit test references `hypot` or `DRAG_ARM_THRESHOLD_PX`**
    (`tab-drag-invariants.test.js` pins call-site arity and layout-neutrality, not
    threshold behavior).
  - ⇒ **The exact case the change was made for is unfalsified by the entire suite.** The
    cheap fix is a **unit** test over the threshold predicate (`dx=0, dy=6` arms;
    `dx=0, dy=4` does not) — **not** another live drag. **Recorded as owed; it is not
    silently this spec's.**
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
