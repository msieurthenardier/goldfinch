# Behavior Test: Multi-window automation semantics — enumerateWindows discovery, all-windows census, per-window sheets, the DD6 raise/no-raise pair

**Slug**: `multi-window-automation`
**Status**: active
**Created**: 2026-07-15
**Last Run**: 2026-07-15-21-57-41 — **PASS 9/9, no repairs** (full fresh re-run; promoted `draft` →
`active`) — [run log](multi-window-automation/runs/2026-07-15-21-57-41.md). Two sheets visible at once
in two windows with **distinct** wcIds, confirmed on pixels; mid-boot caught at +18ms (`booted:false`
with the adopted tab already in `tabViews` while the census returned **zero** rows for it); the DD6
raise/no-raise pair varying **only the op**. Variant 1 (`findVisible`/`findWcId` symmetry) **PASS**;
variant 2 (raise-only) **INCONCLUSIVE** — its already-active precondition is an unbacked boolean
contradicted by the last recorded adjacent state, so **that sub-case remains unbanked**; the fix is to
record a pre-state snapshot as every main-table row already does.

> **Run 1** (2026-07-15-21-15-43) was 9/9 product-green but surfaced **four errata**, folded per
> first-run discipline — [run log](multi-window-automation/runs/2026-07-15-21-15-43.md). The sharp one:
> **step 2's original row was UNFALSIFIABLE** — `serialize` is `JSON.stringify`, which silently drops an
> array's non-index own properties, so a plain array and one carrying `incomplete` are the **same bytes**
> and no MCP client could ever fail that row. It now asserts only what the wire can measure and cites
> `test/unit/automation-tabs.test.js:721` for the rest.
> **⚠️ Step 1's absence claim has the SAME shape and is not yet caveated.** `JSON.stringify` also drops
> `undefined`-valued keys, so "`sheetWcId` ABSENT" is wire-unfalsifiable in the strict own-property
> sense. It is **not** a false-pass — the undiscriminated alternative has zero product consequence (both
> read `undefined` at every consumer) and the strict half **is** pinned in-process by
> `test/unit/window-census.test.js` against a product that assigns conditionally — but the row should say
> so. Note **step 5 carries the measurable form**: W2's `sheetWcId` going **absent → present** is a
> transition the wire CAN see, and that is what actually licenses "absent means never created".

## Intent

Verify the M09 Flight 7 automation surface as **real, multi-window behavior**: `enumerateWindows` as
the single discovery primitive, resolving every window's chrome and overlay wcIds **exactly** — the
guess-and-check discovery it replaced is gone, and this spec never performs one (DD2); `enumerateTabs` as an
**all-windows census** whose every row carries a `windowId`, with `booted` as its completeness signal
(DD1); `captureWindow({windowId})` routing per window with an **unchanged wire shape** (DD3/DD4);
**two menu sheets open simultaneously in two windows** — impossible under F6's roaming singleton by
construction (DD5); and the **DD6 raise/no-raise asymmetry** — an act on window B's background tab
**raises** B, while a `readDom` on it does **not**. This needs a behavior test rather than a unit test
because every property is a fact about **live, multiple `BaseWindow`s and their real overlay views**:
the unit suite pins the census builder, the picker, and the refusals in isolation and never observes a
second window actually booting, a second sheet actually materializing, or a real window actually
coming forward. (Flight 7 DD1/DD2/DD3/DD4/DD5/DD6; the headline spec for the flight.)

## Preconditions

- **Apparatus — admin MCP surface.** Goldfinch running via
  `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation`. At launch the
  app prints `AUTOMATION_DEV_MINT { "key": "...", "adminKey": "..." }` to stdout — capture the
  `adminKey`. **Reference the admin key via an env var only — NEVER paste it into a command literal.**
- **THE APPARATUS IS A HAND-ROLLED SDK CLIENT OVER BASH — IT IS NOT A REGISTERED MCP.** This is the
  premise that has actually bitten: an F7 leg-1 Executor **falsely blocked after zero tool calls**
  because it scanned for a registered `goldfinch` MCP, found none, and concluded the apparatus was
  missing. **There is no registered MCP and there never was.** Drive the surface by running a small
  Node script via **Bash** that speaks MCP over the loopback HTTP transport —
  **`scripts/mcp-example-client.mjs` is the working template; copy it.** The SDK must be imported by
  **absolute `dist/esm` path** (the runner sits outside the package tree and ESM ignores `NODE_PATH`).
  *(`.mcp.json` ships an empty `mcpServers` map by design — off-by-default. Its emptiness is not a
  fault to repair; it is the contract.)*
- **Apparatus disqualification:** the `chrome-devtools` MCP does **NOT** qualify — it launches its own
  browser and never touches this app (the standing Goldfinch false-pass trap).
- **Port.** Pin the listen port via `GOLDFINCH_MCP_PORT` (default `49707`); if the bind fails, relaunch
  **without** the pin — the server free-falls to the next free port and prints it with a fresh
  `AUTOMATION_DEV_MINT`. Read the actually-bound port from that output and reuse it everywhere.
- **Admin is required.** `enumerateWindows` and `getChromeTarget` are **admin-only**; a jar key is
  refused `automation: admin-only`. Non-tab wcIds (chrome, sheet) resolve only at the admin tier.
- **Fresh scratch profile** (`XDG_CONFIG_HOME` at an empty directory): deterministic jar seed
  (Personal default + Work) and a provably empty closed-tab stack.
- **Fixture pages — the committed `tabstrip` set**, `tests/behavior/fixtures/tabstrip/`
  (`page1.html` .. `page6.html`, titled `Fixture Page 1 — tabstrip` .. `Fixture Page 6 — tabstrip`;
  that directory's README pins the content and the serve command). Serve it **from that directory**
  via `python3 -m http.server 8000`, reachable at `http://127.0.0.1:8000/pageN.html`. **This spec
  uses pages 1 and 2.** Confirm pairwise-distinct titles before relying on tab identity.
  **The markers are CONTRACT, not decoration:** every page carries `<h1 id="marker">` (echoing the
  title) and `<p id="body-marker">`. Step 8 identifies its `readDom` target by those ids — a DOM
  read that reaches the body proves the read worked on a background-window guest, which is the
  substance of DD6. Do not regenerate these pages from this prose: **use the committed set**, whose
  README pins exactly what a run may depend on.
- **Boot bracket (MANDATORY).** Snapshot `enumerateTabs()` **and** `enumerateWindows()`
  **IMMEDIATELY on connect**, before any setup lull — a later census drift must be attributable to a
  spec action, not to stray input into a live idle window on the WSLg desktop.
- **No OS-focus reliance.** WSLg poisons the focus APIs: programmatic `win.focus()` is a no-op and
  `getFocusedWindow()` goes stale (F6 spike verdict 4). `lastFocused` is **main-side tracked, not an
  OS-focus claim** — read it as such; never assert `document.hasFocus()`/`isFocused()` for window
  identity.
- **"BACKGROUND TAB" — DEFINED, because the word carries two readings and only one is DD6's.**
  In this spec, **a background tab is a tab whose OWNING WINDOW IS NOT LAST-FOCUSED** —
  read `lastFocused` off `enumerateWindows()`. It is **NOT** "a tab that is not the active tab
  within its own window" (`active: false` in the census). The two come apart constantly: a tab can
  be its window's active tab while that window sits behind another.
  **DD6/S1's substance is the window sense**: the dispatch bug was that a cross-window act went to
  the **last-focused** window's chrome instead of resolving the target tab's **owning** window at
  event time — it is the owning window not being last-focused that made the bug observable, and the
  raise is the fix. The within-window sense is irrelevant to it.
  *(Folded at the first-run errata pass: rows 7–8 said "a background tab in window 2" with the term
  undefined, and the setup provisioned no tab that satisfied the within-window reading at all.)*

## Observables Required

- **mcp (admin SDK client over Bash — the apparatus above):**
  - `enumerateWindows` — window topology: `windowId`, `chromeWcId`, `booted`, `activeTabWcId`,
    `lastFocused`, `sheetWcId?`, `sheetVisible`, `findWcId?`, `findVisible`.
  - `enumerateTabs` — the all-windows census, `windowId` per row.
  - `getChromeTarget` — **the raise observable** (which window the surface is bound to).
  - `captureWindow` — image content per window; refusals.
  - `readDom` — the no-raise op's read.
  - `activateTab` — the raise op; its **return value** (a named refusal, never a discarded `false`).
  - `pressKey` — sheet Escape delivery.
- **browser / rendered pixels** — `captureScreenshot(wcId)` for per-window rendered corroboration.

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **Connect + boot bracket.** Connect the admin client (SDK-over-Bash — see Preconditions). `enumerateWindows()` immediately. | **Exactly ONE row**: `booted: true`, `lastFocused: true`, a **numeric** `chromeWcId`; **`sheetWcId` and `findWcId` ABSENT**; `sheetVisible: false`, `findVisible: false`. ⇒ **"absent ⇒ never created" holds live** — the overlays are lazy, and an absent id is a *meaning*, not a failed lookup. Record this window's `windowId` as **W1**. |
| 2 | **The census is an array, stamped.** `enumerateTabs()`. Then `openTab(page1Url, 'work')` → **T**. `enumerateTabs()` again. | **The result parses as an ARRAY** — `Array.isArray` on the parsed wire value is `true`; it indexes and `.filter()`s normally. **Every row carries a `windowId`** (= **W1**), alongside `{ wcId, url, title, jarId, active }`. **T** appears with `jarId: 'work'`. ⇒ DD1 rejected an `{tabs, incomplete}` **wrapper** precisely because the jar facade does `(await engine.enumerateTabs()).filter(...)`; a wrapper would break every consumer, and **that IS measurable here — a wrapper parses as an object, not an array.** **⚠ DO NOT assert "no own properties beyond indices" over the wire — THE WIRE CANNOT DISCRIMINATE IT.** The MCP adapter serializes with `JSON.stringify` (`mcp-tools.js`'s `serialize`), and **`JSON.stringify` silently drops an array's non-index own properties**: an array carrying `.incomplete` stringifies **byte-identically** to the plain array, so no MCP client can ever fail that row — it would report "plain" against a fully broken product. That half of DD1's shape contract is pinned where it IS measurable, in-process: **`test/unit/automation-tabs.test.js:721`** (*"the return is a PLAIN ARRAY with no own properties beyond indices"*), which carries a genuine positive control — it sets `marked.incomplete = [2]`, asserts the pin **rejects** it, and asserts explicitly that `Array.isArray` alone **cannot** catch it. *(Folded at the first-run errata pass: the original row demanded the own-properties assertion here, where it is unfalsifiable. The reason is recorded so a future author does not helpfully re-add it.)* |
| 3 | **`booted` as the completeness signal — the mid-boot window.** Open the tab-context menu on **T** via the **REAL** menu (right-click **T**'s rect on the chrome; resolve the sheet from `enumerateWindows().sheetWcId` — **never a synthesized IPC**), then activate **Move to new window**. **From the moment the click returns, poll `enumerateWindows()` + `enumerateTabs()` TIGHTLY.** | A poll catches window 2 with **`booted: false`** **AND** `enumerateTabs()` returning **ZERO rows for window 2** — *even though T is already in that window's `tabViews`*. Then `booted` flips **true** and T appears with `windowId` = window 2's. ⇒ `booted` is the census's completeness discriminator: an empty census for a live window means **"not booted yet"**, not "no tabs". Record window 2's `windowId` as **W2**. **⚠ ESCAPE HATCH (MANDATORY): the mid-boot state is a narrow timing window. If it is NEVER caught, record a SAMPLING LIMIT and DO NOT CLAIM THE OBSERVABLE** — do not report a miss as a pass, and do not report it as a failure of `booted`. The unit pin (`booted: false` ⇒ zero rows, positive-controlled) is the fallback evidence. |
| 4 | **The all-windows census, both windows in one array — then PROVISION window 2's second tab.** With T settled in window 2: `enumerateTabs()` (judge the census claim on THIS read, before the open below). **Then**: `openTab(page2Url, 'work')` → **U**. The accessor is window 2 (the move-created window is last-focused), so the open lands there — **CONFIRM, do not assume**: re-read `enumerateTabs()` and check `U.windowId === W2`. *(If U landed in W1, `activateTab(<T>)` to re-baseline the accessor to window 2, close U, and retry — do not proceed with U in the wrong window.)* | **Rows from BOTH windows in ONE array**, each carrying its **own** `windowId` — window **W1**'s rows **first** (registry insertion order), then **W2**'s. Filtering by `windowId` partitions the census exactly: W1's rows are the original tabs, W2's is **T**. ⇒ the census spans the app, and `windowId` is what makes a per-window question answerable. **After the open**: **U** carries `windowId` = **W2** and is **`active: true`** in window 2; **T** is now **`active: false`** there. ⇒ **window 2 now holds TWO tabs, and this is a SETUP obligation, not a claim** — rows 7–8 act on **T**, and without U provisioned here, T would be its window's only (hence active) tab, leaving the within-window reading of "background" unsatisfiable and the rows' precondition unreachable. *(Folded at the first-run errata pass: steps 1–4 previously placed exactly ONE tab in window 2 — active there — so rows 7–8's "a background tab in window 2" named a tab the spec never created.)* |
| 5 | **TWO SHEETS OPEN AT ONCE — the definitive per-window proof (DD5).** Open the kebab in **window 1**, then open the kebab in **window 2** — **open window 2's LAST, and call `enumerateWindows()` IMMEDIATELY** (any action that dismisses one collapses the observable). | **BOTH rows report `sheetVisible: true`, with TWO DISTINCT `sheetWcId`s.** ⇒ **the roaming singleton is retired.** Under F6 this was impossible **by construction**: ONE sheet attached to the requesting window at show time, so opening window 2's menu tore down window 1's — one sheet cannot be visible in two windows at once. *(Assert **distinctness** of the two ids, never any particular values — the specific wcIds are incidental to a run and are not a contract.)* Corroborate on pixels: `captureScreenshot` of each window's chrome renders **its own** open menu. |
| 6 | **DD7 blur — per-window sheet dismissal scoping.** With both sheets still open: `pressKey(<window 1's sheetWcId>, 'Escape')`. `enumerateWindows()`. | Window 1: **`sheetVisible: false`**. Window 2: **`sheetVisible: true` — UNAFFECTED.** ⇒ **per-window dismissal scoping** — dismissal reaches only the window that owns the sheet. This is exactly the property the roaming singleton **could not have had**: there was only ever one sheet to dismiss. *(The **OS-blur** half of DD7 is **NOT** claimed here and is **NOT** claimed anywhere — see Out of Scope for the gap and its ruling.)* |
| 7 | **DD6 RAISE — and the POSITIVE CONTROL for step 8.** **Re-baseline the accessor to window 1**: act on a window-1 tab, then **confirm** `getChromeTarget().wcId` **is** window 1's `chromeWcId` (the act's own raise is what seeds `lastFocused`). **T** is now background in **both** senses — its window (W2) is not last-focused, and it is `active: false` within W2 (U holds active, from step 4). `getChromeTarget().wcId` → **record**. Then **`activateTab(T)`**. `getChromeTarget().wcId` again. | `activateTab` returns **`true`** — **not** a discarded `false`, **not** a throw. `getChromeTarget().wcId` **FLIPS to window 2's `chromeWcId`**. ⇒ the cross-window act **raised the owning window** *(the S1 fix: dispatch resolves the tab's owning window at event time instead of going to the last-focused chrome, where it used to silently no-op and report success)*. **This row is the same-run POSITIVE CONTROL for row 8: it demonstrates that `getChromeTarget` CAN report a raise, with this instrument, in this run.** Judge this row **BEFORE** row 8. |
| 8 | **DD6 NO-RAISE — an absence claim, controlled by row 7. SAME TAB, SAME PRECONDITION, ONLY THE OP DIFFERS.** **Restore row 7's exact precondition**: `activateTab(U)` — returning **T** to `active: false` within W2 (this also raises W2, which is why the next action is mandatory). **Re-baseline the accessor to window 1** again (act on a window-1 tab; **confirm** `getChromeTarget().wcId` is window 1's). **T** is again background in both senses. `getChromeTarget().wcId` → record. Then **`readDom(T)` — the SAME tab row 7 acted on**. `getChromeTarget().wcId` again. | `readDom` returns **T's live DOM** — identify it positively: the `Fixture Page 1 — tabstrip` title, `<h1 id="marker">`, and `<p id="body-marker">` (the committed fixture's pinned markers). The read **works on a background-window guest**, which is the substance of the change — **AND `getChromeTarget().wcId` is UNCHANGED**. ⇒ **no raise.** **This is a MEASUREMENT, not an instrument failure, *because row 7 showed this same instrument reporting a raise in this same run*.** Without row 7 judged first, "the wcId didn't change" is indistinguishable from "the instrument reports nothing" — an absence confirmed by an instrument never shown able to report presence. *(DD6's predicate: an op that needs **rendered output** raises; an op that reads **live JS/DOM state** does not. Making a read steal the operator's foreground would be a worse bug than the one being fixed.)* *(Folded at the first-run errata pass: in run 1, row 7's `activateTab` left its target active, so row 8 was driven onto a DIFFERENT tab — the pair varied **tab and op** where it must vary **only op**. Restoring the precondition via U is what makes the op the sole variable.)* |
| 9 | **`captureWindow({windowId})` — routing, and the named refusal.** `captureWindow()` (no arg); `captureWindow({ windowId: <W2> })`; `captureWindow({ windowId: 999999 })`. | The first two return **normal image content** — the **WIRE SHAPE IS UNCHANGED** (a bare image content block, parsed positionally; **no `windowId` field was bolted onto the return**). The no-arg call captures the **last-focused** window; the `windowId` call captures **W2** — verifiable by the distinct fixture titles rendered in the pixels. The third is refused **`automation: no-such-window`** — a **named** refusal, never a silent fall-back to some other window. **⚠ NOTE: this proves the `windowId` param ROUTES. It proves NOTHING about DD4's mis-pick fix** — this rig is Wayland, so `desktopCapturer` is skipped entirely and the identity bind **never executes** (recon S2). **Do not record this row as DD4 evidence.** |

**Row conventions:** one row = one logical checkpoint. **Row 7 must be judged before row 8** — row 8 is
an absence claim and row 7 is its same-run positive control on the same instrument. Row 3's absence
(zero rows for a mid-boot window) carries a mandatory sampling-limit escape hatch rather than a claim.
Window identity is always read from `enumerateWindows`, never inferred from OS focus.
**Rows 7 and 8 are a CONTROLLED PAIR: same tab (T), same precondition, one variable — the op.** Row 8
restores row 7's precondition before acting precisely so the pair differs in nothing else; a run that
lets the two rows act on different tabs has **not** tested the DD6 asymmetry, it has tested two
unrelated things. "Background" is defined in Preconditions — **the owning window is not last-focused** —
and both rows also hold the within-window sense (`active: false`), so neither reading can be blamed for
a result.

## Out of Scope

- **OS-level blur delivery across windows — AN ACCEPTED PERMANENT GAP FOR THIS MISSION (FD ruling,
  M09 F7 leg 4). Not a HAT ticket.**
  - **The gap, stated exactly so a future maintainer can discharge it deliberately:** F7 leg 1 deleted
    the `if (menuOverlay.getAttachedWindow() === win)` guard in favour of an unconditional per-window
    `sheet.closeMenuOverlay('blur')`. The deleted guard's own comment names the **only** scenario that
    exercises it: **opening a menu in window B is killed by window A's in-flight blur — the two-window
    open handoff.** The two forms are **behaviorally identical in a single-window rig** (menu open ⇒
    the guard is true ⇒ both close; no menu ⇒ the guard fails and the unguarded call no-ops ⇒ same
    observable) — *there is no third case with one window* — so **no single-window run can distinguish
    them, even on a platform that delivered a real blur.**
  - **Why it is not claimed live:** **WSLg delivers no OS blur to a scripted stimulus** (F6 spike
    verdict 4).
  - **Why it is not pinned to a non-WSLg desktop:** this project's only desktop **is** WSLg — the
    mission's Environment Requirements say so. A non-WSLg HAT ticket would have **no venue to run in**,
    making it precisely the failure this flight named: **an unqualified HAT item that silently cannot
    run.** Recording an honest permanent gap is preferable to filing a ticket that can never be
    discharged.
  - **What IS asserted instead:** step 6's **per-window dismissal scoping** — a real, distinct property
    on the same machinery, drivable on this rig, and one the roaming singleton could not have had.
- **DD4's `captureWindow` mis-pick fix** — **never claimed live** (recon S2: the rig is Wayland, the
  `desktopCapturer` branch is dead code here, and any step asserting the fix would pass **vacuously**).
  Unit-scoped (`capture-source-picker.test.js`) + HAT-scoped.
- **The OS compositor actually raising window B.** `getChromeTarget` reads main's `getLastFocused()`,
  **which the raise itself seeds.** Steps 7/8 prove the **main-side raise contract** — the dispatch
  routes to the owning window and the accessor retargets — and **never** that a real compositor brought
  a window forward on screen. *(F7 leg-2 HONESTY NOTE, carried verbatim: do not let a reader infer more
  than the rig gave.)*
- **Tear-off / cross-window drag** — `cross-window-drag.md` owns the native-DnD drag gestures
  (M09 F11, operator-performed) and `tab-tearoff.md`'s surviving rows own the keyboard move
  (F8); nothing here depends on either. *(Pointer updated at F11 Leg 4 — this line used to say
  "F8 owns it".)*
- **`multi-window-shell`'s lifecycle and re-parent surface** (New Window minting, move-as-re-parent,
  close-one-of-N, quit-on-last, whole-window closed-tab capture) — **that spec owns it.** This spec
  uses a move only as the cheapest way to mint a second window with a known tab in it.
- **Jar-tier behavior of these ops** — `mcp-jar-scoping.md` owns the facade; this spec is admin-tier
  throughout.

## Variants (optional)

- **`findVisible` / `findWcId` symmetry:** repeat step 1's lazy-absence reading and step 5's
  two-at-once reading for the **find overlay** (`findWcId`/`findVisible`) — open find in both windows
  and confirm two distinct `findWcId`s with both `findVisible: true`. The find overlay is the same
  per-window instance shape as the sheet (DD5 extracted it into `find-overlay-manager.js` mirroring
  `menu-overlay-manager.js`), so the property should hold identically. `find-overlay-geometry.md` owns
  the find overlay's geometry; this variant would assert only its per-window topology.
- **RAISE-ONLY: `activateTab` on a tab that is ALREADY ACTIVE in a non-focused window — the harder
  case, and the one nothing currently asks for.** After row 7, **T** is active within W2. Re-baseline
  the accessor to window 1 (act on a window-1 tab; confirm). Then `activateTab(T)` — a tab that is
  **already its window's active tab**, in a window that is **not last-focused**. Assert
  `getChromeTarget().wcId` **FLIPS to W2's `chromeWcId`** anyway, and `activateTab` returns `true`.
  **Why this is the sharp case:** here the within-window activation is a **no-op** — the tab is
  already active — so **the raise is the ONLY work left to do**. An implementation that early-returns
  on "already active" would skip the raise and **still return `true`**, passing rows 7–8 unchanged
  while silently failing the operator: the act reports success and the window never comes forward.
  That is the S1 defect's exact signature (*"it used to silently no-op and report success"*) surviving
  in the one sub-case the main table cannot see, because row 7 always acts on a tab that is **not**
  yet active and so cannot distinguish "raised because it activated" from "raised unconditionally".
  Promote to a real row if it ever fails — it is a variant only because DD6's contract does not
  explicitly rule on the already-active sub-case, so a red here is a **spec/contract question for the
  FD**, not an automatic product bug.
