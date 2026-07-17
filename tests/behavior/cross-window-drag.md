# Behavior Test: Cross-window tab drag on the native HTML5-DnD transport

**Slug**: `cross-window-drag`
**Status**: draft
**Created**: 2026-07-17
**Last Run**: never — **this spec has NOT run.** First run is owed to the operator's keyed
gauntlet (carried from F10, extended at F11 Leg 4 to include this spec and the re-scoped
`tab-tearoff` re-run). Promote `draft` → `active` only on that first clean run.

> ## ⚠️ THE GESTURE IS THE OPERATOR'S. THE MEASUREMENT IS THE APPARATUS'S. NEITHER SUBSTITUTES FOR THE OTHER.
>
> As of M09 F11 (DD3, unified rewrite) every tab drag — reorder, tear-off, cross-window — is
> **native HTML5 DnD**. Two consequences govern this spec's apparatus, and both are recorded
> facts, not design taste:
>
> 1. **Synthetic pointer injection cannot drive the native drag loop.** `dragPointer` /
>    `sendInputEvent` do not initiate a native HTML5 drag (recorded at F11 Leg 2; the precise
>    mechanism — whether a synthetic sequence fires `dragstart` before dying — is **inferred,
>    not measured**, and this spec does not overclaim it). A `dragPointer` row against the tab
>    strip is a **dead instrument that fails**, which is why the old `tab-tearoff` /
>    `tab-reorder` drag rows are superseded and point here.
> 2. **⚠ FORBIDDEN — the synthetic-`DragEvent` green-wash (the live successor of
>    `tab-tearoff`'s old false-pass trap).** The DnD handlers ARE drivable by a fabricated
>    `DragEvent`/`DataTransfer` dispatched via `evaluate`: a fabricated `drop` on `#tabs`
>    carrying the identity MIME fires the **REAL** `tab-adopt-by-drop` IPC and goes **GREEN
>    with no OS transport exercised** — a passing test over an unexercised transport. This
>    project already shipped that failure class once (`multi-window-shell` passed 9/9 over a
>    real cross-window `activateTab` bug for an entire flight), and the old `tab-tearoff`
>    banner's doctrine carries forward verbatim: **if a future author finds they can make a
>    gesture row here pass without a human hand on the mouse, that is the hazard, not the
>    win.** The flight-11 log forbids the synthetic `DragEvent` explicitly.
>
> **Therefore this spec is HAT-apparatus:** every gesture Action is marked **`OPERATOR:`** —
> the Orchestrator **pauses** at each one and asks the operator to perform the physical drag
> and confirm (the run-skill's operator touch-point mechanism). The Executor **NEVER attempts
> the gesture** — not with `dragPointer`, not with a synthetic `DragEvent`. The Executor is
> **observe-only** (`enumerateWindows` / `enumerateTabs` / history reads / rendered state) plus
> non-gesture provisioning (opening tabs, real menu clicks); the Validator judges.

## Intent

Verify **mission criterion 8** on the real transport: *a tab dragged from one window's strip
into another window's strip moves there, keeping its cookie-jar identity and its page state.*
The load-bearing assertion is **IDENTITY (DD2, the mission's ABSOLUTE constraint)**: the moved
tab is the SAME live `webContents` — same `wcId`, same jar, **live history** — never destroyed
and recreated. This spec asserts the identity triple on **both** drag doors (the cross-window
drop, row 1, and the tear-off to desktop, row 3 — the latter inherits the tear-off DD2 coverage
that died with `tab-tearoff`'s superseded rows 4–5). It also verifies the same-window reorder
as the zone model's **negative control** (row 2), the F10 L3 sole-tab **consolidation** (row 4),
and the two still-live **refusal** arms — refused AND announced, never silent (row 5).

This needs a behavior test with a human gesture because the observable under test is the **OS
drag transport itself** — cross-`BaseWindow` delivery of a native drag session — which no
in-process instrument can exercise (see the banner) and no unit test can express. Handler logic
is unit-pinned elsewhere (`tab-adopt-by-drop.test.js`, `tab-drag-invariants.test.js`); the
gesture is owed to a witnessed live run.

## Preconditions

- **Backend — X11, and that is load-bearing (DD5, as CORRECTED at the criterion-8 HAT).**
  Launch:
  `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation -- --ozone-platform=x11`
  (dev-launch passes the caller flag through). Under WSLg **Wayland** (the daily-driver
  default) the compositor cancels the drag on leaving the **SOURCE SURFACE** — the
  cross-window gesture **does not exist** on this rig under Wayland, overlapping windows or
  not (the target never receives the drag; the source gets a stale-coordinate `dragend`).
  The gesture is verified on X11; packaged native targets are expected full-parity.
- **⚠ X11 + `--automation-dev` is a FIRST-TIME PAIRING on this rig.** Every prior keyed
  automation run was Wayland. Treat apparatus surprises as unmeasured environment, not
  product signal, until reproduced. **And X11 carries the M05 F8 first-click-swallow quirk**
  (the defect Wayland was adopted to fix): the first physical click after launch may be
  swallowed. Have the operator spend one throwaway click on a neutral surface before row 1 —
  **a swallowed first click is the environment, not a product regression.**
- **Apparatus — admin MCP surface (SDK client over Bash) + the operator's hand.** At launch
  the app prints `AUTOMATION_DEV_MINT { "key": "...", "adminKey": "..." }` — capture the
  `adminKey`. **Reference the admin key via an env var ONLY — NEVER paste it into a command
  literal, never print a key-bearing stream** (standing discipline; an F6 executor leaked
  one). There is no registered `goldfinch` MCP and there never was — drive the surface with a
  Node script over the loopback HTTP transport; `scripts/mcp-example-client.mjs` is the
  template (SDK imported by absolute `dist/esm` path). The `chrome-devtools` MCP does **NOT**
  qualify (it launches its own browser — the standing false-pass trap).
- **Port — BIND-PROBE, never `ss`** (`ss` cannot see WSL2 ports held by Windows-side
  listeners; measured at F7 and F8). Pin via `GOLDFINCH_MCP_PORT`; on bind failure relaunch
  without the pin and read the actually-bound port from the fresh `AUTOMATION_DEV_MINT`.
- **Fresh scratch profile** (`XDG_CONFIG_HOME` at an empty directory); leave any live sibling
  Goldfinch untouched.
- **Fixture pages — the committed `tabstrip` set** (`tests/behavior/fixtures/tabstrip/`,
  pages 1–4 here), served from that directory via `python3 -m http.server <port>` (a
  pre-existing server on 8000 is not yours). The `<h1 id="marker">`/`<p id="body-marker">`
  markers are CONTRACT; do not regenerate the pages.
- **Fixture provisioning (Executor, before row 1 — no gestures):** boot bracket first
  (`enumerateWindows()` + `enumerateTabs()` immediately on connect). Then in the boot window
  **W1** (chrome **C1**): `openTab(page1Url, 'work')` → **T1**, `navigate(T1, page4Url)`;
  `openTab(page2Url, 'work')` → **T2**, `navigate(T2, page3Url)`. **Poll each tab's
  `evaluate(wcId, "history.length")` to exactly `2` before proceeding (the commit-settle /
  `ERR_ABORTED` gate carried from `multi-window-shell`)** — a 1-entry history is the race, not
  a defect, and every identity claim below rests on these baseline numbers. Mint a second
  window **W2** (chrome **C2**) through a **real UI door** (the kebab menu's New Window item,
  via `click` — `multi-window-shell` owns that lifecycle; here it is provisioning). Record
  W1/C1/W2/C2 and T1/T2's `wcId` + `jarId` as the BEFORE half of the identity readings.
- **The announcement recorder discipline (carried errata from `tab-tearoff`, Erratum 1):**
  the channel is the `#tab-status` sr-only live region, which **never clears** — a final-value
  read cannot falsify an absence claim. Every arm therefore installs a `MutationObserver` that
  (a) **disconnects any prior observer first** (`window.__gfObs?.disconnect()`, then re-create
  onto `window.__gfObs`), (b) pushes **each mutation record's `addedNodes` text**, never a
  re-read of `textContent` (per-record, not final-value — coalescing reinstates the blindness
  the recorder exists to defeat), and (c) **CALIBRATES**: fire one known stimulus into the
  live region, count the pushes, record `probeMultiplier` — measured per arm, never carried
  forward. Never cite a deduplicated/collapsed array as "the announcement sequence".

## Observables Required

- **mcp (admin SDK client over Bash):** `enumerateWindows` (window topology — a new window
  exists or it does not; windows close or they do not), `enumerateTabs` (the identity
  observable: `wcId`/`jarId`/`windowId`/`active` per tab), `evaluate` (history counts, strip
  DOM order, the announcement recorder), `goBack` + `readDom` (live-history landing, positively
  identified by the fixture markers — `goBack`'s `{"ok":true}` alone proves nothing),
  `openTab`/`navigate`/`click` (provisioning + real menu paths). **`dragPointer` is NOT used
  against the tab strip** (see the banner). `captureScreenshot`/`readAxTree` on **chrome**
  wcIds only (guest targets activate-and-raise — they would mutate the state under test).
- **operator (the gesture):** every `OPERATOR:` action is a physical mouse drag performed
  live by the operator on the X11 session, confirmed back to the Orchestrator.
- **shell:** launch, fixture server, port bind-probe, pid liveness.

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **CROSS-WINDOW DROP — criterion 8's gesture.** Executor: arm the recorder on **BOTH** chromes (C1 and C2 — disconnect-then-arm + calibrate, per Preconditions); read T1's baseline row from the census. **OPERATOR: press and hold on T1 in W1's strip, drag out of W1, across bare desktop, onto W2's strip, and release between W2's tabs. Confirm the release.** Executor: `enumerateWindows()`, `enumerateTabs()`, `evaluate(T1, "history.length")`, `goBack(T1)`, **POLL** `readDom(T1)` to settle, read both recorders. | **T1's census row: `windowId` is now W2 — and the IDENTITY TRIPLE holds: `wcId` UNCHANGED from provisioning** (the live `webContents` was re-parented, never destroyed and recreated), **`jarId` still `'work'`**, **`history.length` still exactly `2`**, and `goBack(T1)` lands on `Fixture Page 1 — tabstrip` with **both** committed markers (`readDom`, polled — a timeout expiry is a real fail; an un-polled first read is not evidence). Still **exactly TWO** windows. W1's strip **closes ranks** (T1 gone, remaining rows contiguous, sane active tab). **THE ANNOUNCE SPLIT: C2's recorder (per-record, ÷ its calibrated multiplier) contains `'Tab moved to this window'` — the TARGET announces. C1's recorder contains NO entry for this gesture — in particular NO `'Move canceled'`.** The source's own tear-off dispatch reads `no-tab` and is **SUPPRESSED** (`renderer.js` `requestTearOff`: a `no-tab` with the tab already gone is the adopted-elsewhere signature; the target owns the authoritative reply — and the other reconciliation ordering, `tab-moved-away` silently clearing the live session, is silent at the source too). Corroborate on pixels: `captureScreenshot(C1)`/`captureScreenshot(C2)`. |
| 2 | **SAME-WINDOW REORDER — the zone model's NEGATIVE CONTROL.** Executor: read W2's strip DOM order + tab rects from C2; re-arm C2's recorder. **OPERATOR: in W2, drag a tab horizontally past a sibling tab's midpoint and release INSIDE the strip.** Executor: re-read the strip DOM order, `enumerateWindows()`, `enumerateTabs()`, C2's recorder. | **The strip's DOM order changes; NOTHING ELSE does**: still exactly TWO windows, every tab's `windowId` and `wcId` unchanged. C2's recorder contains `'Tab moved to position N of M'` (the in-window reorder announce). ⇒ the same physical gesture, differing only in **where it releases**, still reorders in-strip — row 1's move is attributable to the cross-window release point, not to "any drag now moves tabs between windows" (unchanged F2-contract behavior under the F11 drag layer). |
| 3 | **TEAR-OFF TO DESKTOP — and the identity triple asserted at THIS door too.** Executor: re-arm C1's recorder; read T2's baseline census row. **OPERATOR: press and hold on T2 in W1's strip, drag out of W1, and release over BARE DESKTOP — not over any Goldfinch window. Confirm.** Executor: `enumerateWindows()`, `enumerateTabs()`, `evaluate(T2, "history.length")`, `goBack(T2)`, **POLL** `readDom(T2)`, C1's recorder. | **A THIRD window exists** — record it as **W3** (chrome **C3**), holding **only T2**, spawned at the true release point (placement itself is not asserted — see Out of Scope). **The identity triple, through the tear-off door** (this row inherits the DD2 coverage of `tab-tearoff`'s superseded rows 4–5): T2's **`wcId` UNCHANGED**, **`jarId` still `'work'`**, **`history.length` still `2`**, `goBack(T2)` lands on `Fixture Page 2 — tabstrip` with both markers. W1 closes ranks. C1's recorder: `'Tab moved to a new window'` and **NO `'Move canceled'`** (the success-path false-cancel bug stays absent under the native layer). **Row chain: W3 — a sole-tab window — is row 4's fixture.** |
| 4 | **SOLE-TAB DRAG INTO AN EXISTING WINDOW CONSOLIDATES — and CLOSES the source (F10 L3).** Executor: re-arm C1's recorder (C1 is the TARGET chrome this time). **OPERATOR: drag T2 — W3's only tab — out of W3 and release on W1's strip. Confirm.** Executor: poll `enumerateWindows()` until W3 is gone; `enumerateTabs()`; C1's recorder. | **T2 is adopted into W1** (`windowId` W1, `wcId` still unchanged, jar intact) **and W3 IS GONE** — the census returns exactly TWO windows (W1, W2): the adopt path allows the sole tab (`allowSoleTab`, the F10 L3 consolidation core), empties the source, and **closes it** (Chrome parity — source disposed, no home-tab boot on the emptied strip). C1 (the target) announces `'Tab moved to this window'`. ⇒ consolidation is a live door of the SAME move core, and the sole-tab refusal in row 5 is specific to the **new-window** destination, not to sole tabs as such. |
| 5 | **THE REFUSAL ARMS — refused AND ANNOUNCED, tab stays (inherited from `tab-tearoff`'s superseded rows 6–7; both arms still-live product code, `renderer.js` `moveOutcomeMessage` ~1729).** *(a — sole-tab tear-off)* Executor: via the REAL tab context menu (right-`click` on T1, resolve the sheet, click `Move to new window`), move T1 into a fresh window **W4** (chrome **C4**) — provisioning through the still-live F8 door, no gesture. Arm C4's recorder. **OPERATOR: drag T1 — W4's only tab — out of W4 and release over BARE DESKTOP. Confirm.** Executor: `enumerateWindows()`, `enumerateTabs()`, C4's recorder. *(b — internal tab)* Executor: in W1 open Settings through the REAL kebab path (`click` the kebab, resolve the sheet from `enumerateWindows().sheetWcId`, click Settings) → internal tab **S**; arm C1's recorder; read W1's strip order. **OPERATOR: drag S out of W1 and release over BARE DESKTOP. Confirm.** Executor: `enumerateWindows()`, the strip DOM order, C1's recorder. | *(a)* **NO new window is created** — the census still shows W1/W2/W4; **T1 is still W4's tab, at its origin index, `wcId` unchanged**; C4's recorder captured **`'Cannot move the only tab to a new window'`** ⇒ the sole-tab tear-off refusal is **announced, not silent** (a refusal is announced, NOT animated — the tab never left its slot; do not expect a snap-back). *(b)* **No new window; S is still in W1 at its origin index**; C1's recorder's last entry is **`'This tab cannot be moved to a new window'`** ⇒ internal/trusted tabs never move between windows, and the refusal reaches the screen-reader user. Both arms ride the same live `moveOutcomeMessage` map the drags in rows 1–4 ride — silence is not an outcome (DD5 doctrine, carried). |

**Row conventions:** one row = one logical checkpoint. **`OPERATOR:` marks a physical gesture
— the Orchestrator pauses, the operator performs and confirms, the Executor never attempts it**
(banner). Every recorder arm is disconnect-then-arm + per-record `addedNodes` + calibrate
(Preconditions); announcement assertions are over the **sequence**, never the final value (the
live region never clears). Identity is always the **triple** — unchanged `wcId`, unchanged
`jarId`, live history proven by the **pair** of a count and a marker-identified `goBack`
landing (`goBack`'s `{"ok":true}` alone has discrimination zero). Window identity is read from
`enumerateWindows`, never inferred from OS focus. Rendered-state captures target **chrome**
wcIds only. Rows chain: row 3's new window is row 4's fixture; judge them in order.

## Out of Scope

- **The keyboard/menu cross-window move, the displaced-tab census (8a), and the displaced-menu
  block (HIGH-1)** — `tab-tearoff.md`'s surviving rows 8/8a/9 + HIGH-1 own them (keyboard
  instrument, unaffected by the F11 drag rewrite). The keyboard path is also the **Wayland-rig
  alternative** for moving tabs between windows (DD5).
- **Wayland behavior of this gesture — none exists to test, by measurement (DD5, corrected).**
  Under WSLg Wayland the drag dies at the source surface; the visible outcomes (silent cancel
  or edge tear-off, depending on where the cursor left) are compositor artifacts,
  app-unfixable, and deliberately not asserted. Do not author Wayland rows.
- **Escape-cancel mid-drag** — unavailable under ozone-wayland (DD5 extension: the native drag
  loop owns input); under X11 an Escape aborts into `dragend` and the geometric gate governs
  (an Escape in the tear-off zone tears off — a known limitation of the pure-geometric
  disambiguation, recorded in the F11 log). Operator-observational only; no row.
- **Tear-off / new-window PLACEMENT** — cosmetic by standing ruling; the only instruments that
  could read it back are the cached coordinate fictions the F8 spike discredited.
- **Reorder's full regression surface and the click model** — `tab-reorder.md` (live steps) and
  the unit suite own them; row 2 here is a same-run control, not a substitute.
- **Multi-window lifecycle** (New Window minting, close-one-of-N, quit-on-last) —
  `multi-window-shell.md` owns it; this spec uses the kebab door only as provisioning.
- **`dragPointer` for NON-tab drags** — still a valid instrument (in-page drags); nothing here
  deprecates the op itself, only its use against the native-DnD tab strip.

## Variants (optional)

- **Release target within the strip:** row 1 releases between W2's tabs; a release on a tab
  button vs the strip's gap both deliver (probe2 measured `dragover` over both the app-region
  band and the no-drag button; the drop target is `#tabs`). Promote to a row only if a live
  run ever shows a difference.
- **Packaged-native full-parity run** (Windows/macOS/Linux, no WSLg RAIL) — expected
  Chrome-parity everywhere including Wayland-free desktop release; unverifiable on this rig,
  owed to a packaged-build gauntlet if one is ever stood up.
