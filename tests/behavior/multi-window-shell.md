# Behavior Test: Multi-window shell — New Window, move-to-new-window re-parent, lifecycle

**Slug**: `multi-window-shell`
**Status**: active
**Created**: 2026-07-15
**Last Run**: 2026-07-15-05-54-21 — pass (9/9, run 2; run 1 surfaced three spec errata, folded — see runs/) — [run log](multi-window-shell/runs/2026-07-15-05-54-21.md)

## Intent

Verify the M09 Flight 6 multi-window shell (flight DD2/DD3/DD4/DD5/DD7/DD8) as real,
multi-`BaseWindow` behavior — invisible to the unit suite, which pins the registry, the move
payload rules, the capture/pop rules, and the manager attachment logic in isolation, never the
LIVE path: a second window minted through the real classifier (`Ctrl+N` → `keydownToAction` →
`dispatchChromeAction` → `window-create`), its chrome addressable and drivable as a second live
`WebContentsView` document, the roaming menu sheet serving both windows (DD7 interim),
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
- **Fixture pages** — reuse the `fixtures-tabstrip` set (`Fixture Page 1 — tabstrip` ..
  `Fixture Page N — tabstrip`, distinct titles), served locally via
  `python3 -m http.server 8000` from the fixture directory, reachable at
  `http://127.0.0.1:8000/pageN.html`. Four pages are used; confirm pairwise-distinct titles via
  `readAxTree` before relying on tab identity. **Read order matters (first-run erratum): the
  eval/read ops are foreground-first — readAxTree on a background tab ACTIVATES it. Read
  background tabs first and end on the tab the next step expects active (or re-activate it).**
- **Boot-state bracket (F6 leg-2 carry — MANDATORY).** Snapshot `enumerateTabs()` IMMEDIATELY
  after connecting, before any setup lull, and again immediately after each window mint (Steps
  1, 3, 5) — any later census drift must be attributable to a spec action, not to stray input
  into a live idle window on the WSLg desktop (the leg-2 two-boot-tabs contamination lesson).
- **DD9 spec-authoring constraint (design-review M3) — window-2/3 work is raw-wcId ONLY.**
  Every action on and observation of a non-first window goes through **admin raw-wcId ops
  exclusively** (`evaluate`/`readDom`/`readAxTree`/`pressKey`/`click`/`navigate`/`goBack`/
  `goForward`/`captureScreenshot` against explicit wcIds). Screenshots are **per-wcId
  `captureScreenshot` — NEVER `captureWindow`** (its desktopCapturer best-size-match heuristic
  can capture the WRONG of two similar windows; its WSLg fallback composites only the
  accessor-resolved record). **No OS-focus reliance anywhere** (WSLg: programmatic
  `win.focus()` is a no-op and `getFocusedWindow()` goes stale — spike verdict 4; never assert
  `document.hasFocus()`/`isFocused()`).
- **Accessor semantics (DD8 interim — load-bearing for window discovery).**
  `getChromeTarget`/`enumerateTabs`/`openTab` resolve the **main-tracked LAST-FOCUSED window**
  — seeded at window create and at the move op's programmatic focus, membership-validated with
  a first-record fallback when the last-focused window is closed. The spec USES this
  deterministically: a fresh mint retargets the accessor to the NEW window (that is how each
  new chrome wcId is discovered — no probe needed for chromes), and every subsequent action on
  a previously-discovered window is pinned to its recorded raw wcId. `enumerateTabs` is
  **window-scoped** (the accessor window's tabs), not an app census.
- **Chrome documents drive like the tab-context-menu chrome.** Each window's chrome runs
  `renderer.js`: the evaluate-reachable seam (`openKebabOverlay`, strip reads) and the
  `window.goldfinch` bridge (`windowClose()` — the REAL sender-resolved `window-close` IPC) are
  available via `evaluate(<chrome wcId>, …)` on ANY window's chrome at the admin tier.
- **Sheet wcId discovery — roaming singleton (DD7 interim), two-window-safe probe walk.** ONE
  sheet serves every window, attaching to the requesting window at show time; probe its wcId
  once, after Step 4's first menu open (`evaluate(id, "location.href")` returning
  `menu-overlay.html` identifies it). **Skip every KNOWN tab wcId from ALL windows (the
  recorded censuses — `enumerateTabs` alone is window-scoped and no longer a sufficient skip
  set) and every chrome wcId** — the eval ops are foreground-first; probing a background tab
  activates it.
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

- mcp (admin MCP tools, measured via the admin MCP client): `getChromeTarget` +
  `enumerateTabs` as the **accessor observables** (which window the surface is bound to — the
  focus-follow proxy) and per-window tab censuses; `evaluate`/`readDom`/`readAxTree` on chrome
  wcIds (strip census, tab rects, kebab aria, `windowClose()` dispatch), the probed sheet wcId
  (menu items/rects), and guest wcIds; `openTab`/`navigate`/`goBack`/`goForward` for tab
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
| 2 | **Setup (window 1).** Confirm the jar seed (`evaluate(C1, "window.goldfinch.jarsList()")` → Personal + Work only; stack provably empty — fresh boot). `openTab(page1Url, 'work')` → **T1**; `openTab(page2Url, 'work')` → **T2**; **COMMIT-SETTLE GATE (first-run erratum — the immediate navigate races page 2's uncommitted load, ERR_ABORTED, leaving a 1-entry history): poll `evaluate(T2, "document.title")` for the page-2 title (or `getHistory(T2)` length 1 committed) BEFORE navigating**; then `navigate(T2, page3Url)` and **poll `getHistory(T2)`/history length === 2 (index 1, `canGoBack`) — this gate is load-bearing for Steps 6 and 8's history-fidelity claims**. Record window 1's census (D, T1, T2 — wcIds, DOM strip order via `evaluate(C1, …)`). | `enumerateTabs()`: D + T1 + T2, fixture tabs `jarId: 'work'`, **T2 active** at page 3. Known-wcId skip set recorded (feeds the Step-4 probe walk). |
| 3 | **New Window via the real classifier.** `pressKey(C1, 'n', ['control'])` (lowercase — see Preconditions). Poll `getChromeTarget()` for a NEW wcId (transiently `url:""` while the chrome document loads — poll past it); record **C2**. Boot-bracket window 2: **poll `enumerateTabs()` until the boot census SETTLES at one tab** (an immediate read can return `[]` pre-dom-ready — first-run erratum), before any other setup action. `captureScreenshot(C2)`. Re-read window 1's strip via `evaluate(C1, …)` (raw-wcId — C1 is no longer the accessor's chrome). | A second window exists: `getChromeTarget()` returns **C2 ≠ C1** — the accessor retargeted because window create SEEDS last-focused (the deterministic focus-follow observable; no OS-focus read). `enumerateTabs()` (now window-2-scoped) lists **exactly one** tab — a fresh boot home tab **B2**, default jar (the Ctrl+N path boots its home tab exactly like first launch). `captureScreenshot(C2)` renders a complete chrome — strip with one tab, toolbar, address bar [render-correct]. Window 1 untouched: `evaluate(C1, …)` still reports D, T1, T2 — proving `enumerateTabs`'s window-scoping from both sides (accessor reads W2; raw-wcId reads W1). |
| 4 | **Window-2 roaming menu (DD7).** `evaluate(C2, "openKebabOverlay(0)")` (the evaluate seam — window 2's own chrome document). Probe the sheet wcId **S** (walk skipping D/T1/T2/B2 + C1 + C2 — the ALL-windows skip set). Read the menu via `evaluate(S, …)` + `readAxTree(S)`; read the kebab trigger's `aria-expanded` via `evaluate(C2, …)`. Dismiss: `pressKey(S, 'Escape')`; re-read both. | The ONE sheet (record **S** — used again in Step 5) renders the kebab menu **in window 2**: `role="menuitem"` items with **"New window" FIRST** (the F6 kebab model: New window, Settings, Downloads, Cookie jars, Print…, Exit), `readAxTree(S)` shows `role="menu"` with focus on the first item; window 2's kebab trigger carries `aria-expanded="true"`. On Escape the menu hides and `aria-expanded` resets to `"false"` on **C2** (channel-7 routed to the ATTACHMENT window's chrome — window 2, not window 1). A second window has fully working menus with zero per-window overlay instances. |
| 5 | **Move-to-new-window — the SAME-wcId discriminator.** Re-read window 1's tab rects (`evaluate(C1, …)`). `click(C1, x, y, { button: 'right' })` at **T2**'s rect center (T2 = window 1's active tab — deliberately: the moved-away active-tab branch is the harder path). Poll the menu open on **S**; confirm the item list INCLUDES **Move to new window**; `click(S, x, y)` on it. Poll `getChromeTarget()` for a third wcId **C3**; poll `enumerateTabs()` (adopt handshake — see Preconditions). Re-read window 1's strip via `evaluate(C1, …)`. | The tab-context menu rendered on the SAME sheet **S** (roaming — now attached to window 1) and includes the F6 row. A THIRD window exists: `getChromeTarget()` → **C3 ∉ {C1, C2}** — focus followed the moved tab via the move op's **programmatic last-focused seed** (deterministic retarget; the compositor may never deliver a real focus event under WSLg). `enumerateTabs()` (window-3-scoped) lists **EXACTLY ONE** tab whose **`wcId` === T2's original wcId** — **the re-parent discriminator: same live `webContents`, no destroy/recreate** (a NEW wcId here means the close-and-recreate fallback ran — FAIL, the spike-gated primary path regressed); `url` page 3, `jarId: 'work'` (jar intact — the full container object rode the adopt payload), `active: true`. **NO boot tab** in window 3 (`noBootTab` suppression — exactly one tab, not two). Source closed ranks: `evaluate(C1, …)` strip is exactly **D, T1**, with a sane active tab (one of D/T1 — the `activeViewWcId` clear + next-activation fallback; window 1 is not left headless). |
| 6 | **Live history + a working strip in the move-created window.** `goBack(T2)`; poll `readDom(T2)`/`enumerateTabs()`. Then `goForward(T2)`. `captureScreenshot(T2)` and `captureScreenshot(C3)`. Then `openTab(page4Url, 'work')` → **T3** (the accessor is window 3 — the open lands there). | `goBack` on the **same wcId** lands on **page 2** — the tab's LIVE navigation history survived the re-parent (nothing was snapshotted/restored; this is the same engine history, hence the same-wcId pin matters); `goForward` returns to page 3. `captureScreenshot(T2)` renders page-3 content composited in the new window [render-correct]; `captureScreenshot(C3)` shows a strip with the moved tab (page-3 title, work jar dot). **T3** appears in window 3's census (T2 + T3, T3 active) — the move-created window's strip is fully functional (tab creation, activation), and window 3 now holds TWO persist-jar tabs in insertion order T2, T3 (Step 8's whole-window fixture). |
| 7 | **Close one of N — the app survives and the dead chrome is destroyed.** `evaluate(C2, "window.goldfinch.windowClose()")` (the REAL sender-resolved `window-close` IPC on window 2). Poll: `evaluate(C1, "1+1")`, `getChromeTarget()`, `enumerateTabs()`, `evaluate(C2, "1")`, and the shell-side pid liveness. | The app stays **ALIVE** and the MCP surface **keeps answering** (`evaluate(C1, "1+1")` → 2; the recorded pid still running) — closing one of N windows neither quits nor wedges the main process (the F6 fix-cycle's pre-fix failure mode was a permanent event-loop starvation exactly here). Within the poll budget, `evaluate(C2, "1")` is REFUSED as a dead/unknown wcId (`no-such-contents` class) — the closed window's chrome `webContents` was destroyed (the deferred destroy at `closed`, leg-4 M4). The accessor is UNCHANGED: `getChromeTarget()` still returns **C3** (window 3 stayed last-focused; membership validation evicts only closed windows) and `enumerateTabs()` still lists T2 + T3. (Bookkeeping for Step 8: window 2's boot tab **B2** was a persist-jar tab, so its whole-window capture pushed ONE entry — the stack now holds [B2].) |
| 8 | **Whole-window capture → reopen in the survivor (LIFO, appended).** `evaluate(C3, "window.goldfinch.windowClose()")` (window 3 dies with persist tabs T2, T3 in insertion order). Poll `getChromeTarget()`. Then, in window 1: `pressKey(C1, 'T', ['control', 'shift'])`; poll `enumerateTabs()` + the DOM strip order (`evaluate(C1, …)`). Then a second `pressKey(C1, 'T', ['control', 'shift'])`; re-poll. Then `goBack` on the second reopened tab. | App alive, MCP answering; T2/T3 refused as dead wcIds. `getChromeTarget()` **falls back to C1** — the last-focused record (window 3) is gone, so the membership-validated first-record fallback fires (deterministic, no OS focus). The stack now holds [B2, T2, T3] (window 3's tabs captured at its `close` event in **tabViews insertion order**, so T3 pushed last). First reopen: a **NEW wcId** **R1** (reopen is capture-based recreate — contrast the Step-5 same-wcId pin) at **page 4** (T3's entry — LIFO top), `jarId: 'work'`, **APPENDED at the strip's END** (DOM order D, T1, R1 — the DD4 append sentinel: a whole-window entry's `windowId` can never match the invoking window, so `stripIndex` is never honored). Second reopen: **R2** at **page 3** (T2's entry), appended after R1 (D, T1, R1, R2) — reverse-insertion-order LIFO across a whole-window capture. `goBack(R2)` lands on **page 2** — the capture carried T2's FULL `navEntries` (readable at the window's `close` event — spike verdict 3), not just the URL. (B2's home-tab entry remains stacked, unexercised — ordering is already proven.) |
| 9 | **Quit-on-last unchanged (non-darwin).** `evaluate(C1, "window.goldfinch.windowClose()")` (the LAST window). Shell-side: poll the recorded Electron main pid and the MCP endpoint. | The app **QUITS cleanly**: `window-all-closed` → quit (non-darwin, unchanged by F6). The main process **exits within ~10 s on its own** — no wedge, no second-signal nudge (the pre-fix close-path hang also poisoned this quit path), and the MCP endpoint stops accepting with **connection-refused/reset, not a hang**. Exit is orderly (downloads flush / MCP stop / store close ride the existing quit hooks — no crash output in the launch log beyond known WSLg platform noise). |

## Out of Scope

- **The L4 sole-tab divergence (HAT)** — closing the adopted sole tab in a move-created window
  leaves the window ALIVE with a fresh home tab (`closeTab`'s else-createTab branch; Chrome
  would close the window). Live-confirmed at leg 4, accepted this flight, HAT-list carry — not
  asserted here.
- **Blur/menu interplay across windows via real OS focus** — undrivable on this rig (WSLg
  delivers no blur to an unfocused-window stimulus; spike verdict 4). The attachment
  conditioning is unit-pinned and the cross-window menu-supersede behavior was proven at the
  leg-4 live check; the real-blur flavor is HAT-scoped (leg-4 pre-authorization).
- **`captureWindow` multi-window semantics** — F7 owns (this spec deliberately never calls it;
  see Preconditions and `docs/behavior-specs-single-window-audit.md`).
- **Sub-17ms mid-swap composite states** — below both capture rigs' sampling floor (spike
  residual); the re-parent's mid-motion visual bar was judged on rendered pixels at the leg-1
  spike; inter-frame motion stays HAT territory (the F9 lesson).
- **Tear-off / drag-out of a tab to create a window** — F8 on this shell.
- **Per-window closed-tab reopen parity with Chrome** — deliberately divergent (ONE global
  stack, windowId-tagged; DD4 documented divergence). This spec asserts the F6 contract, not
  Chrome parity.
- **macOS parity** (incl. darwin dock-resident lifecycle at quit-on-last) — carried to the
  mission's later HAT flight, per the existing convention.

## Variants (optional)

- N/A for the initial authoring. When F7 lands per-window overlay instances and multi-window
  automation semantics, re-point Step 4's probe walk (and add a two-menus-open-at-once variant
  — impossible under the F6 roaming interim by design).
