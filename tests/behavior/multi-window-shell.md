# Behavior Test: Multi-window shell — New Window, move-to-new-window re-parent, lifecycle

**Slug**: `multi-window-shell`
**Status**: active
**Created**: 2026-07-15
**Last Run**: 2026-07-15-05-54-21 — pass (9/9, run 2; run 1 surfaced three spec errata, folded — see runs/) — [run log](multi-window-shell/runs/2026-07-15-05-54-21.md)

> **REWRITTEN 2026-07-15 (M09 F7 leg 4) — this spec was a PLANNED RED from F7 leg 1 until now.**
> Three F7 decisions falsified it, and each is discharged here at the assertion that carried it:
> - **DD5 — per-window overlay instances.** The roaming singleton is **deleted**. This spec is where
>   the roaming sheet was *named* ("ONE sheet serves every window"), so its rewrite is the corpus's
>   clearest statement that DD5 landed: each window owns its own sheet, and step 4's *"zero per-window
>   overlay instances"* **inverts**.
> - **DD2 — `enumerateWindows` is the single discovery primitive.** The id-space walk and its
>   all-windows skip set are **deleted**, not re-pointed: the sheet resolves exactly, per window.
> - **DD1 — `enumerateTabs` is an ALL-WINDOWS census** with `windowId` on every row. Every
>   *"window-N-scoped"* census assertion (steps 3, 5, 6, 7) becomes an explicit **filter by
>   `windowId`**. Step 2's census is **DD1-safe** (only one window exists at that point, so the
>   all-windows census and the window census are the same set) — only its skip-set clause goes.
>
> Also folded: step 8 now pins the **`ERR_ABORTED` history-entry count** (read off step 2's own
> commit-settle gate), and the pre-registered **two-menus-open-at-once variant is a real step** — it
> was *"impossible under the F6 roaming interim by design"* and F7 makes it the definitive per-window
> proof.

## Intent

Verify the M09 Flight 6 multi-window shell (flight DD2/DD3/DD4/DD5/DD7/DD8) as real,
multi-`BaseWindow` behavior — invisible to the unit suite, which pins the registry, the move
payload rules, the capture/pop rules, and the manager attachment logic in isolation, never the
LIVE path: a second window minted through the real classifier (`Ctrl+N` → `keydownToAction` →
`dispatchChromeAction` → `window-create`), its chrome addressable and drivable as a second live
`WebContentsView` document, **each window owning its own menu sheet instance** (M09 F7 DD5 — the F6
roaming singleton is retired; two menus can now be open at once, which the F6 interim made impossible
by construction),
**move-to-new-window as a true RE-PARENT** — the moved tab keeps its `wcId` (THE discriminator
between the spike-selected re-parent path and the close-and-recreate fallback; DD1 verdict GO),
its cookie jar, and its live navigation history across the window swap — with the source strip
closing ranks and the target window booting NO home tab (DD5 `noBootTab`); the DD3 lifecycle
split live: closing one of N windows never quits the app (the main process stays responsive —
the exact failure mode of the F6 fix-cycle hang), the closed window's chrome is destroyed
(refused as a dead wcId), the whole-window closed-tab capture pushes the dying window's persist
tabs so a survivor's `Ctrl+Shift+T` restores them LIFO-appended (DD4 append sentinel), and
closing the LAST window quits cleanly (non-darwin), no wedge, no second-signal nudge.
Focus-follow is asserted through the **deterministic last-focused accessor retarget** (DD8:
seeded at window create and at the move op's programmatic focus), never OS focus. (Flight DD1
spike verdicts 1/3/4; DD2 routing class 3 is exercised implicitly — the moved tab's title/nav
events land in the target chrome the strip reads.)

## Preconditions

- **Apparatus — admin MCP surface**, identical to `tab-context-menu.md`'s. Goldfinch is running
  via `npm run dev:automation` with `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1`.
  At launch, the app prints `AUTOMATION_DEV_MINT { "key": "...", "adminKey": "..." }` to stdout —
  capture the `adminKey` (env-var reference only; never paste the key into a command literal).
  **Record the Electron main pid at launch** — Step 9's quit-on-last assertion reads it.
- **Port (load-bearing for every URL below) — pin-if-free, else free-fallback.** Try pinning the
  listen port via `GOLDFINCH_MCP_PORT`. If the launch fails to bind it, relaunch **without** the
  env pin — the server free-falls to the next available port and prints it (and a fresh
  `AUTOMATION_DEV_MINT`) to stdout. Read the actually-bound port from that output and reuse it in
  every SDK call below.
- **Fresh scratch profile** (`XDG_CONFIG_HOME` pointed at an empty directory): deterministic jar
  seed (Personal default + Work) AND a provably empty closed-tab stack — Step 8's LIFO
  assertions depend on knowing exactly what the stack holds.
- **Admin MCP client** (SDK `StreamableHTTPClientTransport`, `Authorization: Bearer <adminKey>`)
  on `127.0.0.1:$GOLDFINCH_MCP_PORT/mcp`. Admin is required: chrome documents and the sheet are
  non-tab wcIds (admin-tier only), and `getChromeTarget` is admin-only.
- **Fixture pages — the committed `tabstrip` set**, `tests/behavior/fixtures/tabstrip/`
  (`page1.html` .. `page6.html`, titled `Fixture Page 1 — tabstrip` .. `Fixture Page 6 — tabstrip`;
  that directory's README pins the content and the serve command). Serve it **from that directory**
  via `python3 -m http.server 8000`, reachable at `http://127.0.0.1:8000/pageN.html`. **This spec
  uses pages 1–4.** Confirm pairwise-distinct titles via `readAxTree` before relying on tab
  identity. **Read order matters (first-run erratum, RESTATED for DD6 — the ops split now):
  `readAxTree` and `captureScreenshot` are still foreground-first and ACTIVATE a background tab;
  `readDom` and `evaluate` no longer do (M09 F7 DD6). So the hazard is now specific to
  `readAxTree`/`captureScreenshot`: read background tabs with those first and end on the tab the
  next step expects active (or re-activate it). A `readDom`/`evaluate` read is order-safe.**
- **Boot-state bracket (F6 leg-2 carry — MANDATORY).** Snapshot `enumerateTabs()` IMMEDIATELY
  after connecting, before any setup lull, and again immediately after each window mint (Steps
  1, 3, 5) — any later census drift must be attributable to a spec action, not to stray input
  into a live idle window on the WSLg desktop (the leg-2 two-boot-tabs contamination lesson).
- **DD9 spec-authoring constraint (design-review M3) — window-2/3 work is raw-wcId ONLY.**
  Every action on and observation of a non-first window goes through **admin raw-wcId ops
  exclusively** (`evaluate`/`readDom`/`readAxTree`/`pressKey`/`click`/`navigate`/`goBack`/
  `goForward`/`captureScreenshot` against explicit wcIds). Screenshots stay **per-wcId
  `captureScreenshot`** — the safe default, and this spec's only pixel instrument.
  **No OS-focus reliance anywhere** (WSLg: programmatic `win.focus()` is a no-op and
  `getFocusedWindow()` goes stale — spike verdict 4; never assert `document.hasFocus()`/`isFocused()`).
  > **Why `captureScreenshot` and not `captureWindow` — restated for the post-F7 world.** The original
  > reason was that `captureWindow`'s **desktopCapturer best-size-match heuristic could capture the
  > WRONG of two similar windows**. **M09 F7 DD4 deleted that heuristic** — `captureWindow({windowId})`
  > now binds the capture by window **identity** (`getMediaSourceId`), so the old rationale no longer
  > describes the code. **But the constraint stands, for a different and still-live reason:** this rig
  > is **Wayland**, where the whole `desktopCapturer` branch is **skipped** (recon S2), so the identity
  > bind **never executes here** and the mis-pick fix is **not reproducible on this rig at all**. A step
  > asserting the fix would pass **vacuously**. Per-wcId `captureScreenshot` therefore remains the
  > default, and **this spec claims nothing about the mis-pick fix** — it is unit-scoped
  > (`capture-source-picker.test.js`) and HAT-scoped. `captureWindow`'s multi-window routing is asserted
  > in `multi-window-automation.md`, which is explicit about proving **routing, not the mis-pick**.
- **Accessor semantics (DD8 interim — load-bearing for window discovery).**
  `getChromeTarget`/`enumerateTabs`/`openTab` resolve the **main-tracked LAST-FOCUSED window**
  — seeded at window create and at the move op's programmatic focus, membership-validated with
  a first-record fallback when the last-focused window is closed. The spec USES this
  deterministically: a fresh mint retargets the accessor to the NEW window (that is how each
  new chrome wcId is discovered — no probe needed for chromes), and every subsequent action on
  a previously-discovered window is pinned to its recorded raw wcId.
- **`enumerateTabs` is an ALL-WINDOWS census; every row carries `windowId` (M09 F7 DD1).** It is
  **not** window-scoped and **not** accessor-scoped — one call returns every tab in the app, each row
  stamped with its owning window, ordered by registry insertion order (window 1's rows first), then
  each window's own creation order. **This inverts the pre-F7 premise this spec was written on.**
  Consequences the steps below depend on:
  - **To assert "window N's tabs", FILTER the census by `windowId`** — never read a bare count and
    call it a window's. An unfiltered count is an *app* count, and once a second window exists the
    two differ.
  - Resolve each window's `windowId` from **`enumerateWindows()`** (below), which is also how a row's
    `windowId` is interpreted.
  - **A mid-boot window contributes ZERO rows** (its chrome has not served `window-boot-config` yet).
    `enumerateWindows().booted` is the completeness discriminator — an absent census is *"not booted
    yet"*, not *"no tabs"*. This is why Step 3's boot bracket polls until the census settles.
- **Window + overlay discovery — `enumerateWindows()` (M09 F7 DD2), the single discovery primitive.**
  One row per open window: `{ windowId, chromeWcId, booted, activeTabWcId, lastFocused, sheetWcId?,
  sheetVisible, findWcId?, findVisible }`, derived live from the registry with zero cached state.
  **Admin-only**, like `getChromeTarget` — this spec is already admin. It is how this spec resolves
  every window's chrome, every window's sheet, and each window's `windowId` for census filtering.
- **Chrome documents drive like the tab-context-menu chrome.** Each window's chrome runs
  `renderer.js`: the evaluate-reachable seam (`openKebabOverlay`, strip reads) and the
  `window.goldfinch` bridge (`windowClose()` — the REAL sender-resolved `window-close` IPC) are
  available via `evaluate(<chrome wcId>, …)` on ANY window's chrome at the admin tier.
- **Sheet wcId discovery — PER-WINDOW instances, resolved by `enumerateWindows` (M09 F7 DD5 + DD2).**
  **Each window owns its own sheet.** There is no roaming singleton, no attachment, and no walk:
  `enumerateWindows()`'s row for a window carries that window's **`sheetWcId`** and **`sheetVisible`**.
  Take the row, read the id — exact, per window.
  > **This precondition is where the roaming singleton was named, so state plainly what changed.**
  > F6's DD7 interim had **ONE sheet serving every window**, attaching to the requesting window at show
  > time — which is why this spec previously had to discover it by guessing across an id-space while
  > excluding every known wcId from *all* windows. **DD5 deleted that machinery.** A per-window
  > instance **is** its own scope: no attachment record, no conditioning check, no exclusion list. The
  > guess-and-check discovery is not re-pointed — it is **gone**, and so is the "reads activate a
  > background tab" hazard that shaped it (M09 F7 DD6: `readDom`/`evaluate` no longer raise).
  - **`sheetWcId` is ABSENT until that window's sheet is first created** (lazy — a window that never
    opens a menu never pays for one). Absent means *"never created"*, not *"lookup failed"*. Resolve
    a window's sheet **after** its first menu open.
  - **Judge open/closed on `sheetVisible`, never on id presence** — a present id means "instantiated",
    which includes "instantiated but hidden".
- **Menu open is synchronous (M09 F6 DD6)** — the tab-context model builds from the push-fed
  stack-size cache; a short poll after each open/dismiss covers cross-view IPC latency only.
- **Item activation via coordinate click** (F8 Leg-3 lesson): activate sheet menu items via
  `click(sheetWcId, x, y)` at the item's rect center; `pressKey(sheetWcId, 'Escape')` dismisses.
- **`Ctrl+N` is lowercase-only in the classifier** (`keydownToAction`: `new-window` — app-level
  like new-tab, never lightbox-gated; `Ctrl+Shift+N` deliberately unassigned): send
  `pressKey(C1, 'n', ['control'])`, not `'N'` with shift.
- **Adopt handshake is asynchronous (DD5/H1).** The move-created window's chrome boots, serves
  `window-boot-config`, then receives the queued `adopt-tab`. Post-move reads poll briefly
  (short interval, few-second budget) before judging the target strip.
- **Apparatus disqualification:** the `chrome-devtools` MCP does **NOT** qualify (launches its
  own browser). The apparatus is the SDK admin MCP client over
  `127.0.0.1:$GOLDFINCH_MCP_PORT`, app launched via `npm run dev:automation`.

## Observables Required

- mcp (admin MCP tools, measured via the admin MCP client): `getChromeTarget` as the **accessor
  observable** (which window the surface is bound to — the focus-follow proxy); **`enumerateTabs` as
  the ALL-WINDOWS census** (`windowId` per row — filter it to assert any single window's tabs);
  **`enumerateWindows` as the topology primitive** (per-window `windowId`/`chromeWcId`/`booted`/
  `sheetWcId`/`sheetVisible` — window discovery, sheet resolution, boot completeness, and the
  two-menus observable); `evaluate`/`readDom`/`readAxTree` on chrome wcIds (strip census, tab rects,
  kebab aria, `windowClose()` dispatch), each window's own sheet wcId (menu items/rects), and guest
  wcIds; `openTab`/`navigate`/`goBack`/`goForward` for tab
  lifecycle + history setup/fidelity; `pressKey` for `Ctrl+N`, `Ctrl+Shift+T`, and sheet
  Escape; `click` (right-button tab-context trigger, left for item activation); **per-wcId
  `captureScreenshot`** for rendered-pixel corroboration (never `captureWindow` — see
  Preconditions); dead-wcId refusals (`evaluate` on a destroyed chrome) as the M4
  chrome-destroy observable.
- shell (measured via Bash): the Electron main **process liveness** (recorded launch pid) for
  Step 7/8's app-alive and Step 9's quit-on-last assertions; MCP endpoint reachability
  (answers vs connection-refused vs hang) as the main-process-responsive observable.

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **Active-precondition probe + boot bracket.** Connect the admin MCP client; `tools/list`; `getChromeTarget()` → record **C1**. IMMEDIATELY `enumerateTabs()` (boot-state bracket — before any setup lull). | `tools/list` **includes** (presence-checked) `getChromeTarget`, `evaluate`, `readDom`, `readAxTree`, `enumerateTabs`, `openTab`, `navigate`, `goBack`, `goForward`, `pressKey`, `click`, `captureScreenshot`. `getChromeTarget()` returns `{ wcId, kind: 'chrome', url }` (numeric — **C1**). `enumerateTabs()` lists **exactly one** tab — the boot home tab **D** (default jar). If not, halt. |
| 2 | **Setup (window 1).** Confirm the jar seed (`evaluate(C1, "window.goldfinch.jarsList()")` → Personal + Work only; stack provably empty — fresh boot). `openTab(page1Url, 'work')` → **T1**; `openTab(page2Url, 'work')` → **T2**; **COMMIT-SETTLE GATE (first-run erratum — the immediate navigate races page 2's uncommitted load, ERR_ABORTED, leaving a 1-entry history): poll `evaluate(T2, "document.title")` for the page-2 title BEFORE navigating**; then `navigate(T2, page3Url)` and **poll `evaluate(T2, "history.length")` until it reads `2` — this gate is load-bearing for Steps 6 and 8's history-fidelity claims**. *(**Instrument erratum, folded 2026-07-15-22-21-56.** This gate previously named `getHistory(T2)`. **`getHistory` structurally cannot do this**: it is M08 F5's **jar-confined visits reader** — `getHistory(jarId: string, {query,limit,before})` → `{jarId, visits}` — so `getHistory({wcId})` is refused `bad-args — jarId required` on **every** run, and `getHistory({jarId:'work'})` returns a jar-wide visit log across all work tabs with no per-tab count. A gate that refuses identically whether or not the defect occurred **discriminates nothing**. `index`/`canGoBack` were dropped too: **no op on this surface exposes them** — `canGoBack` exists only as an internal guard inside `nav.js`'s `goBack`. `evaluate(wcId, "history.length")` is the real observable, and it reads `1` under `ERR_ABORTED`.)* Record window 1's census (D, T1, T2 — wcIds, DOM strip order via `evaluate(C1, …)`). | `enumerateTabs()`: D + T1 + T2, fixture tabs `jarId: 'work'`, **T2 active** at page 3. *(Only one window exists at this point, so the all-windows census and window 1's census are the same set — this assertion is unaffected by DD1 and stands exactly as written. Record each row's `windowId` anyway: it is window 1's, and later steps filter on it.)* |
| 3 | **New Window via the real classifier.** `pressKey(C1, 'n', ['control'])` (lowercase — see Preconditions). Poll `getChromeTarget()` for a NEW wcId (transiently `url:""` while the chrome document loads — poll past it); record **C2**. Boot-bracket window 2: **poll `enumerateWindows()` until window 2's row reads `booted: true`, then `enumerateTabs()` until its window-2 rows SETTLE at one tab** (a mid-boot window contributes **zero** rows by design — DD1; `booted` is the discriminator, so an empty census here is "not booted yet", not "no tabs"). `captureScreenshot(C2)`. Re-read window 1's strip via `evaluate(C1, …)` (raw-wcId — C1 is no longer the accessor's chrome). | A second window exists: `getChromeTarget()` returns **C2 ≠ C1** — the accessor retargeted because window create SEEDS last-focused (the deterministic focus-follow observable; no OS-focus read). `enumerateWindows()` now returns **TWO rows**; record window 2's `windowId` (**W2**) and window 1's (**W1**). **`enumerateTabs()` is an ALL-WINDOWS census (DD1): FILTER it by `windowId`.** Rows with `windowId === W2`: **exactly one** — a fresh boot home tab **B2**, default jar (the Ctrl+N path boots its home tab exactly like first launch). Rows with `windowId === W1`: still **D, T1, T2** — window 1 untouched. *(The unfiltered census now holds FOUR tabs; a bare count is an app count and asserts nothing about either window. The census carries both windows in one array — window 1's rows first, registry insertion order.)* `captureScreenshot(C2)` renders a complete chrome — strip with one tab, toolbar, address bar [render-correct]. Corroborate window 1 independently via `evaluate(C1, …)`, which still reports D, T1, T2 — the DOM strip read and the `windowId`-filtered census agree. |
| 4 | **Window 2's OWN menu sheet (DD5).** Before opening: `enumerateWindows()` — record that window 2's row has **`sheetWcId` ABSENT** (lazy: never created). Then `evaluate(C2, "openKebabOverlay(0)")` (the evaluate seam — window 2's own chrome document). `enumerateWindows()` again: resolve window 2's **`sheetWcId`** (record **S2**) — an exact resolve, no walk. Read the menu via `evaluate(S2, …)` + `readAxTree(S2)`; read the kebab trigger's `aria-expanded` via `evaluate(C2, …)`. Dismiss: `pressKey(S2, 'Escape')`; re-read both. | **Window 2 has its OWN sheet instance.** Before the open, window 2's `sheetWcId` is **absent** and `sheetVisible` is **false**; after it, the row carries a numeric **S2** with `sheetVisible: true` — *the lazy per-window instance materialized on first show, in the window that asked for it*. **S2 renders the kebab menu in window 2**: `role="menuitem"` items with **"New window" FIRST** (the model: New window, Settings, Downloads, Cookie jars, Print…, Exit), `readAxTree(S2)` shows `role="menu"` with focus on the first item; window 2's kebab trigger carries `aria-expanded="true"`. On Escape the menu hides (`sheetVisible: false`) and `aria-expanded` resets to `"false"` on **C2**. **A second window has fully working menus via its OWN overlay instance** — *(this assertion INVERTED at M09 F7 DD5: it previously read "zero per-window overlay instances", which is precisely the roaming-singleton property DD5 deleted. Window 1's sheet is a different instance with a different wcId — the Variant below opens both at once and reads two distinct ids.)* |
| 5 | **Move-to-new-window — the SAME-wcId discriminator.** Re-read window 1's tab rects (`evaluate(C1, …)`). `click(C1, x, y, { button: 'right' })` at **T2**'s rect center (T2 = window 1's active tab — deliberately: the moved-away active-tab branch is the harder path). Resolve **window 1's OWN sheet** from `enumerateWindows()` (its row's `sheetWcId`, record **S1** — a **different instance** from window 2's S2, materialized by this open). Poll the menu open on **S1**; confirm the item list INCLUDES **Move to new window**; `click(S1, x, y)` on it. Poll `getChromeTarget()` for a third wcId **C3**; poll `enumerateWindows()` for a third row (record **W3**) and `enumerateTabs()` (adopt handshake — see Preconditions). Re-read window 1's strip via `evaluate(C1, …)`. | The tab-context menu rendered on **window 1's own sheet S1** — **`S1 ≠ S2`**, the two windows hold distinct sheet instances *(under F6's roaming interim this was the same wcId attaching to window 1; DD5 makes them separate views)* — and includes the **Move to new window** row. A THIRD window exists: `getChromeTarget()` → **C3 ∉ {C1, C2}** — focus followed the moved tab via the move op's **programmatic last-focused seed** (deterministic retarget; the compositor may never deliver a real focus event under WSLg). **Filter the all-windows census by `windowId === W3`** (DD1): **EXACTLY ONE** row, whose **`wcId` === T2's original wcId** — **the re-parent discriminator: same live `webContents`, no destroy/recreate** (a NEW wcId here means the close-and-recreate fallback ran — FAIL, the spike-gated primary path regressed); `url` page 3, `jarId: 'work'` (jar intact — the full container object rode the adopt payload), `active: true`. **NO boot tab** in window 3 (`noBootTab` suppression — exactly one row for W3, not two). *(Poll until W3's row reads `booted: true` before judging its census: a mid-boot window contributes zero rows, so an empty W3 filter is "not booted yet", not "the move lost the tab" — DD1.)* Source closed ranks: rows with `windowId === W1` are exactly **D, T1**, corroborated by `evaluate(C1, …)`'s strip, with a sane active tab (one of D/T1 — the `activeViewWcId` clear + next-activation fallback; window 1 is not left headless). |
| 6 | **Live history + a working strip in the move-created window.** `goBack(T2)`; poll `readDom(T2)`/`enumerateTabs()`. Then `goForward(T2)`. `captureScreenshot(T2)` and `captureScreenshot(C3)`. Then `openTab(page4Url, 'work')` → **T3** (the accessor is window 3 — the open lands there). | `goBack` on the **same wcId** lands on **page 2** — the tab's LIVE navigation history survived the re-parent (nothing was snapshotted/restored; this is the same engine history, hence the same-wcId pin matters); `goForward` returns to page 3. `captureScreenshot(T2)` renders page-3 content composited in the new window [render-correct]; `captureScreenshot(C3)` shows a strip with the moved tab (page-3 title, work jar dot). **Filter the census by `windowId === W3`** (DD1): **T3** appears there — rows **T2 + T3, T3 active** — the move-created window's strip is fully functional (tab creation, activation), and window 3 now holds TWO persist-jar tabs in insertion order T2, T3 (Step 8's whole-window fixture). *(This row's census was window-scoped before F7 and is filtered now; the unfiltered census at this point spans three windows.)* |
| 7 | **Close one of N — the app survives and the dead chrome is destroyed.** `evaluate(C2, "window.goldfinch.windowClose()")` (the REAL sender-resolved `window-close` IPC on window 2). Poll: `evaluate(C1, "1+1")`, `getChromeTarget()`, `enumerateTabs()`, `evaluate(C2, "1")`, and the shell-side pid liveness. | The app stays **ALIVE** and the MCP surface **keeps answering** (`evaluate(C1, "1+1")` → 2; the recorded pid still running) — closing one of N windows neither quits nor wedges the main process (the F6 fix-cycle's pre-fix failure mode was a permanent event-loop starvation exactly here). Within the poll budget, `evaluate(C2, "1")` is REFUSED as a dead/unknown wcId (`no-such-contents` class) — the closed window's chrome `webContents` was destroyed (the deferred destroy at `closed`, leg-4 M4). The accessor is UNCHANGED: `getChromeTarget()` still returns **C3** (window 3 stayed last-focused; membership validation evicts only closed windows), `enumerateWindows()` now returns **two rows** (W2's is gone — the closed window leaves the registry), and the census filtered by `windowId === W3` still lists **T2 + T3**. (Bookkeeping for Step 8: window 2's boot tab **B2** was a persist-jar tab, so its whole-window capture pushed ONE entry — the stack now holds [B2].) |
| 8 | **Whole-window capture → reopen in the survivor (LIFO, appended).** `evaluate(C3, "window.goldfinch.windowClose()")` (window 3 dies with persist tabs T2, T3 in insertion order). Poll `getChromeTarget()`. Then, in window 1: `pressKey(C1, 'T', ['control', 'shift'])`; poll `enumerateTabs()` + the DOM strip order (`evaluate(C1, …)`). Then a second `pressKey(C1, 'T', ['control', 'shift'])`; re-poll. **Then, BEFORE going back, read `evaluate(R2, "history.length")` and assert its ENTRY COUNT (see the gate below).** Then `goBack` on the second reopened tab. | App alive, MCP answering; T2/T3 refused as dead wcIds. `getChromeTarget()` **falls back to C1** — the last-focused record (window 3) is gone, so the membership-validated first-record fallback fires (deterministic, no OS focus). The stack now holds [B2, T2, T3] (window 3's tabs captured at its `close` event in **tabViews insertion order**, so T3 pushed last). First reopen: a **NEW wcId** **R1** (reopen is capture-based recreate — contrast the Step-5 same-wcId pin) at **page 4** (T3's entry — LIFO top), `jarId: 'work'`, **APPENDED at the strip's END** (DOM order D, T1, R1 — the DD4 append sentinel: a whole-window entry's `windowId` can never match the invoking window, so `stripIndex` is never honored). Second reopen: **R2** at **page 3** (T2's entry), appended after R1 (D, T1, R1, R2) — reverse-insertion-order LIFO across a whole-window capture. **HISTORY-ENTRY COUNT GATE (`ERR_ABORTED`) — assert the COUNT before the page:** `evaluate(R2, "history.length")` reports **exactly `2`** (page 2, page 3). **A count of 1 here is the `ERR_ABORTED` failure, named.** *(**Instrument erratum, folded 2026-07-15-22-21-56** — same defect as Step 2's gate: this named `getHistory(R2)`, which **cannot** read per-tab navigation history (it is a jar-confined **visits** reader requiring `jarId: string`) and refuses `bad-args` on every run regardless of the defect — so the gate **discriminated nothing**, which is precisely the failure it was added to prevent. `index`/`canGoBack` dropped: unobservable on this surface by any op. Measured live at the 2026-07-15-22-21-56 run: `evaluate(R2,"history.length")` = **2**, and `goBack(R2)` → page 2 — **the behavior the gate protects is correct**; only its instrument was wrong.)* **Context for the count:** Step 2's commit-settle gate exists because an immediate `navigate` races page 2's uncommitted load, aborts it, and leaves T2 with a **1-entry** history — and this capture carries whatever history T2 actually had. *Read this expected count off Step 2's gate, which polls T2 to `length === 2, index 1` — it is the same history, carried through the re-parent and the whole-window capture.* Without this gate an `ERR_ABORTED`-shortened history surfaces only as a confusing "goBack landed on page 3, expected page 2" **page mismatch**, misattributed to the capture or the reopen; with it, it fails loudly as a **count mismatch** pointing straight at Step 2's gate. **Only then:** `goBack(R2)` lands on **page 2** — the capture carried T2's FULL `navEntries` (readable at the window's `close` event — spike verdict 3), not just the URL. (B2's home-tab entry remains stacked, unexercised — ordering is already proven.) |
| 9 | **Quit-on-last unchanged (non-darwin).** `evaluate(C1, "window.goldfinch.windowClose()")` (the LAST window). Shell-side: poll the recorded Electron main pid and the MCP endpoint. | The app **QUITS cleanly**: `window-all-closed` → quit (non-darwin, unchanged by F6). The main process **exits within ~10 s on its own** — no wedge, no second-signal nudge (the pre-fix close-path hang also poisoned this quit path), and the MCP endpoint stops accepting with **connection-refused/reset, not a hang**. Exit is orderly (downloads flush / MCP stop / store close ride the existing quit hooks — no crash output in the launch log beyond known WSLg platform noise). |

## Out of Scope

- **The L4 sole-tab divergence (HAT)** — closing the adopted sole tab in a move-created window
  leaves the window ALIVE with a fresh home tab (`closeTab`'s else-createTab branch; Chrome
  would close the window). Live-confirmed at leg 4, accepted this flight, HAT-list carry — not
  asserted here.
- **Blur/menu interplay across windows via real OS focus** — undrivable on this rig (WSLg delivers no
  blur to an unfocused-window stimulus; spike verdict 4). **What replaced the mechanism this bullet
  used to cite (M09 F7 DD5):** the *attachment conditioning* is **gone** — DD5 deleted the
  `getAttachedWindow() === win` checks outright, because a per-window instance **is** its own scope;
  there is nothing left to condition, so there is nothing left to unit-pin. The **drivable** half of
  the property is now asserted directly, as a real step: the **two-menus variant** (V1/V2 above) opens
  both windows' sheets and shows that dismissing window 1's leaves window 2's open — **per-window
  dismissal scoping**, exactly the property the roaming singleton could not have had. **The OS-blur
  half is an ACCEPTED PERMANENT GAP for this mission** — not a HAT ticket: this project's only desktop
  is WSLg, so a non-WSLg pin would have no venue to run in. See `multi-window-automation.md`'s Out of
  Scope for the gap's exact mechanism and the ruling that recorded it.
- **`captureWindow` multi-window semantics** — **F7 LANDED them** (DD3/DD4: an optional `windowId`,
  identity-bound, wire shape unchanged). They are asserted in **`multi-window-automation.md`**, which
  owns that surface; this spec still deliberately never calls `captureWindow` and uses per-wcId
  `captureScreenshot` throughout (see the DD9 constraint in Preconditions). *(Re-scoped M09 F7 leg 4
  from "F7 owns" — F7 is done; the pointer now names the spec that holds the assertions rather than a
  flight that has landed.)*
- **DD4's `captureWindow` mis-pick fix** — **never claimed live, here or anywhere**: this rig is
  Wayland, so the `desktopCapturer` branch is skipped and the identity bind never executes (recon S2).
  Unit-scoped (`capture-source-picker.test.js`) + HAT-scoped.
- **Sub-17ms mid-swap composite states** — below both capture rigs' sampling floor (spike
  residual); the re-parent's mid-motion visual bar was judged on rendered pixels at the leg-1
  spike; inter-frame motion stays HAT territory (the F9 lesson).
- **Tear-off / drag-out of a tab to create a window** — F8 on this shell.
- **Per-window closed-tab reopen parity with Chrome** — deliberately divergent (ONE global
  stack, windowId-tagged; DD4 documented divergence). This spec asserts the F6 contract, not
  Chrome parity.
- **macOS parity** (incl. darwin dock-resident lifecycle at quit-on-last) — carried to the
  mission's later HAT flight, per the existing convention.

## Variants

### TWO MENUS OPEN AT ONCE — the definitive per-window proof (M09 F7 DD5)

**Run after Step 4, while windows 1 and 2 are both live.** This was pre-registered at authoring as
*"impossible under the F6 roaming interim by design"* and is now a **real step with a real
observable**: F7's DD2 added `sheetVisible` **precisely so this variant has one**.

| # | Actions | Expected Results |
|---|---------|------------------|
| V1 | With both windows live, open the kebab in **window 1**: `evaluate(C1, "openKebabOverlay(0)")`. Then open the kebab in **window 2**: `evaluate(C2, "openKebabOverlay(0)")` — **open window 2's LAST and read immediately** (any action that dismisses one collapses the observable; see the note below). `enumerateWindows()`. | **BOTH rows report `sheetVisible: true`, with TWO DISTINCT `sheetWcId`s** (window 1's ≠ window 2's). ⇒ **The roaming singleton is retired.** Under F6 this was impossible *by construction*: ONE sheet attached to the requesting window at show time, so opening window 2's menu **tore down window 1's** — one sheet cannot be visible in two windows. Two simultaneously-visible, distinctly-identified sheets is the property only per-window instances can have. Corroborate on pixels: `captureScreenshot(<window 1's sheetWcId>)` and `captureScreenshot(<window 2's sheetWcId>)` each render **their own** open menu. *(**Erratum folded 2026-07-15-22-21-56**: this named `captureScreenshot(C1)`/`(C2)` — the **chrome** wcIds — which cannot show the menu. That follows necessarily from what this very row asserts: a per-window sheet is **its own `WebContentsView` with its own wcId**, so the chrome's per-wcId capture cannot contain it. Measured: `captureScreenshot(C1)` renders window 1's chrome with **no menu**. Still per-wcId, so the DD9 no-`captureWindow` constraint holds.)* |
| V2 | **Per-window dismissal scoping.** With both menus open, dismiss **window 1's only**: `pressKey(<window 1 sheetWcId>, 'Escape')`. `enumerateWindows()`. | Window 1: `sheetVisible: false`. **Window 2: `sheetVisible: true` — UNAFFECTED.** ⇒ dismissal is scoped to the window that owns the sheet. A roaming singleton could not express this: there was only one sheet to dismiss. |

> **Fragility (read before running).** Both sheets must **stay** open for V1 to be readable — a stray
> click, a tab-switch, or an Escape delivered to the wrong wcId collapses it to one. Open window 2's
> menu **last** and call `enumerateWindows()` **immediately**, before any other action.
>
> **This is not speculative — it has been measured.** The F7 leg-3 smoke read both windows reporting
> `sheetVisible: true` with distinct `sheetWcId`s. *(Assert **distinctness**, not any particular ids:
> the wcIds observed in that smoke were incidental to that run and are not a contract.)*
>
> **Out of scope for this variant — the OS-blur half.** Whether a real OS blur of window 1 dismisses
> its menu is **not asserted**: WSLg delivers no blur to a scripted stimulus (F6 spike verdict 4). V2
> asserts **per-window dismissal scoping**, which is a real and distinct property, via a scripted
> Escape. See `multi-window-automation.md`'s Out of Scope for the full disposition of the blur gap.
