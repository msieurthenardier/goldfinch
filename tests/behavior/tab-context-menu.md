# Behavior Test: Tab context menu

**Slug**: `tab-context-menu`
**Status**: active
**Created**: 2026-07-14
**Last Run**: 2026-07-15-06-05-04 — pass (10/10, F6 flight-end regression incl. the Move-to-new-window row deltas) — [run log](tab-context-menu/runs/2026-07-15-06-05-04.md)

## Intent

Verify the M09 Flight 5 tab context menu (flight DD1/DD2/DD4) as real, cross-view behavior —
invisible to the pure unit suite, which pins only `tabContextModel`'s omission rules in isolation,
not the LIVE path: a trusted right-click on a tab button (chrome DOM) firing the `contextmenu`
handler, the synchronous model build (from the push-fed stack-size cache since M09 F6 — the
`closed-tab-stack-size` invoke is the boot seed only), the sheet render (`#sheet-menu[data-menu-type="tab-context"]`, aria-label "Tab menu"), and
the channel-6 dispatch bodies acting on the tab id CAPTURED at open. Specifically: right-click (the
pointer half of the trigger contract) opens the menu for a **background** tab **without activating
it** (menu open ≠ activation); `tab:close` closes the captured tab, not the active one; the batch
closes are **ordered sweeps** (`tab:close-others` / `tab:close-right` — the anchor becomes the
active tab, Chrome parity, and `closeTab`'s next-tab fallback never cascades mid-sweep — asserted
via exact end-state); `tab:duplicate` yields a same-jar, same-URL tab inserted **beside the
source** WITH navigation history (`goBack` proves it — the F4 fidelity check reused);
`tab:reopen-closed` restores a **mid-strip** close at its original position among its neighbors
(the F4 spec-polish rider — F4's own run could only exercise last-position reopens); items are
**omitted, never disabled**, per the model rules (empty stack → no reopen item; single tab → no
close-others/close-right); and Escape returns focus to the **invoking tab** (the captured
`returnFocus`), not the address bar or the sheet. (Flight DD1, DD2, DD4.)

## Preconditions

- **Apparatus — admin MCP surface**, identical to `closed-tab-reopen.md`'s. Goldfinch is running
  via `npm run dev:automation` with `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1`.
  At launch, the app prints `AUTOMATION_DEV_MINT { "key": "...", "adminKey": "..." }` to stdout —
  capture the `adminKey`.
- **Port (load-bearing for every URL below) — pin-if-free, else free-fallback.** Try pinning the
  listen port via `GOLDFINCH_MCP_PORT`. If the launch fails to bind it, relaunch **without** the
  env pin — the server free-falls to the next available port and prints it (and a fresh
  `AUTOMATION_DEV_MINT`) to stdout. Read the actually-bound port from that output and reuse it in
  every SDK call below.
- **Fresh scratch profile** (`XDG_CONFIG_HOME` pointed at an empty directory), so the jar seed is
  deterministic (Personal default + Work, no other jars) AND the closed-tab stack starts
  provably empty — the Step-3 empty-stack omission check depends on **no tab having been closed
  yet this launch** (the stack is an in-memory main-process singleton, no persistence — F4 DD1).
- **Admin MCP client** (SDK `StreamableHTTPClientTransport`, `Authorization: Bearer <adminKey>`)
  on `127.0.0.1:$GOLDFINCH_MCP_PORT/mcp`. Admin is required: a jar key cannot `getChromeTarget`
  (the tab strip is chrome DOM — every right-click and tab-rect read targets the chrome `wcId`)
  and cannot resolve the sheet's wcId (non-tab wcIds resolve only at the admin tier).
- **Fixture pages — the committed `tabstrip` set**, `tests/behavior/fixtures/tabstrip/`
  (`page1.html` .. `page6.html`, titled `Fixture Page 1 — tabstrip` .. `Fixture Page 6 — tabstrip`;
  that directory's README pins the content and the serve command). Serve it **from that directory**
  via `python3 -m http.server 8000`, reachable at `http://127.0.0.1:8000/pageN.html`. **This spec
  uses pages 1–5.** Confirm pairwise-distinct titles via `readAxTree` before relying on tab
  identity.
- **Three targets — chrome, sheet, guests.** The right-click fires on the **chrome** `wcId`
  (**C**, via `getChromeTarget()`) at a tab button's coordinates; the **rendered menu** lives on
  the **sheet** `wcId` (probed) as `#sheet-menu[data-menu-type="tab-context"]`; history fidelity
  reads (`goBack`) target **guest** `wcId`s (`enumerateTabs`).
- **Tab-button coordinates come from the chrome DOM, not pixels.** Read
  `evaluate(C, "[...document.querySelectorAll('.tab')].map(el => ({id: el.dataset.id, rect:
  el.getBoundingClientRect().toJSON()}))")` and right-click at a rect's center — deterministic,
  and robust to strip reflow between steps (re-read after every strip mutation; F1's
  shrink-to-fit means rects move whenever the tab count changes).
- **Sheet wcId discovery — `enumerateWindows` (M09 F7 DD2).** The sheet is a per-window
  `WebContentsView`, never in `enumerateTabs`. Resolve it **exactly**: `enumerateWindows()` returns one
  row per window carrying `sheetWcId` and `sheetVisible` — take this window's row and read `sheetWcId`.
  **Admin-only**, which this spec already is. The sheet is lazy, so **`sheetWcId` is absent until the
  first menu open** — resolve it after Step 3's open, not before.
- **Menu open is synchronous (M09 F6 DD6 — wording updated; the pre-F6 opener was async).**
  `openTabContextMenu` builds its model from the push-fed stack-size cache
  (`closed-tab-stack-changed` broadcasts; the `closedTabStackSize()` invoke survives as the boot
  seed only), so channel-1 fires in the same tick as the right-click — the first sheet read after
  a right-click may already show the menu. The Steps' short poll (short interval, ~1 s budget)
  after each right-click is retained as **cross-view robustness only** (the right-click → main →
  sheet round-trip is still asynchronous IPC), not as an async-model-build wait; never judge menu
  ABSENCE from a single immediate read.
- **Sheet DOM persists after close** (lazy singleton — the established sheet fact): "menu closed"
  is judged by `#sheet-menu` carrying the `hidden` class (or pixels via `captureWindow()`), never
  by DOM absence.
- **Item activation nuance (F8 Leg-3 lesson):** `pressKey(sheetWcId, 'Enter')` on a focused sheet
  menuitem does NOT synthesize the DOM click a real Enter does — activate items via
  `click(sheetWcId, x, y)` at the item's rect center (read the rects via `evaluate(sheetWcId, …)`
  on the `#sheet-menu [role=menuitem]` nodes). Real-keyboard item activation is HAT-covered.
- **The right-click premise is PROVEN, not assumed.** `click(C, x, y, { button: 'right' })` at a
  tab coordinate delivers a trusted right-button click that fires the chrome's DOM `contextmenu`
  handler — verified live at Leg 1 (the flight's designated premise check; the strip is chrome
  DOM, so the DOM event is the whole path — no main-side `context-menu` forwarding is involved,
  unlike the page context menu).
- **Keyboard trigger (Context-Menu key / Shift+F10) — APPARATUS GAP, documented like
  `tab-cycling.md`'s PageDown/PageUp precedent.** The `pressKey` MCP tool's key-name resolver
  (`src/main/automation/input.js`'s `KEY_MAP`) recognizes neither `ContextMenu` nor `F10` —
  calling either throws `automation: unknown key …` today (confirmed at Leg 1). This is a gap in
  the **automation surface itself**, not a product defect, and a synthetic `KeyboardEvent`
  dispatch would NOT substitute (Chromium only auto-synthesizes the native `contextmenu` event
  from TRUSTED input). The product path is structurally shared with the shipped, HAT-verified
  toolbar-pin-button mechanism — one `contextmenu` listener per tab covers both invocation paths,
  plus the keydown catch-all's `target.closest('.tab')` exclusion gate (no parallel listener) —
  and the gate/classifier halves are unit-covered. So this spec exercises the **pointer** trigger
  only; the literal Menu-key/Shift+F10 press is **HAT-scoped**, and extending `KEY_MAP` is the
  same small automation-surface follow-up the PgDn/PgUp gap already motivates.
- **Apparatus disqualification:** the `chrome-devtools` MCP does **NOT** qualify (launches its
  own browser). The apparatus is the SDK admin MCP client over
  `127.0.0.1:$GOLDFINCH_MCP_PORT`, app launched via `npm run dev:automation`.

## Observables Required

- mcp (admin MCP tools on the chrome `wcId`, the probed sheet `wcId`, and guest `wcId`s, measured
  via the admin MCP client): `evaluate` for tab rects/DOM order/focus reads (chrome) and menu-item
  text/rects/`hidden`/`data-menu-type` reads (sheet); `readAxTree(sheetWcId)` for the rendered
  menu's roles/names (`role="menu"` "Tab menu", `menuitem`s, separators); `enumerateTabs` for
  guest wcIds, urls, `jarId`s, and the `active` flag (the menu-open-≠-activation and
  sweep-end-state observable); `click` (right-button for the trigger, left for item activation);
  `pressKey` for Escape; `openTab`/`closeTab`/`navigate`/`goBack` for tab lifecycle, history
  setup, and the duplicate-fidelity read; `captureWindow` for open/closed corroboration.
- shell (precondition probe: `tools/list`, `getChromeTarget` — measured via the MCP client).

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **Active-precondition probe.** Connect the admin MCP client; call `tools/list`; then `getChromeTarget()`. | `tools/list` **includes** (presence-checked) `getChromeTarget`, `evaluate`, `click`, `pressKey`, `enumerateTabs`, `readAxTree`, `openTab`, `closeTab`, `navigate`, `goBack`, `captureWindow`. `getChromeTarget()` returns `{ wcId, kind: 'chrome', url }` with a numeric `wcId` (record as **C**). If not, halt. |
| 2 | **Setup.** Confirm the fresh-profile jar seed (`evaluate(C, "window.goldfinch.jarsList()")` → Personal + Work only) and that NO tab has been closed yet this launch (nothing has — fresh boot, Step 3 depends on it). Open four Work-jar fixture tabs: `openTab(page1Url, 'work')` → **T1**, then **T2** (page 2), **T3** (page 3), **T4** (page 4). Read the strip's tab rects + ids via `evaluate(C, …)`; record the DOM order (boot default tab **D** first, then T1–T4) and each tab's rect. | Five tabs in the strip (D, T1, T2, T3, T4 in DOM order); `enumerateTabs()` shows the four fixture tabs with `jarId: 'work'`, **T4 active** (last opened). Rects recorded for coordinate right-clicks. |
| 3 | **Right-click opens on a BACKGROUND tab — items per model rules; menu open ≠ activation.** `click(C, x, y, { button: 'right' })` at **T2**'s rect center (T2 is background — T4 is active). Poll for the sheet (probe its wcId now — first open this run), then read `#sheet-menu` (`evaluate(sheetWcId, …)` + `readAxTree(sheetWcId)`). Re-read `enumerateTabs()`. | The sheet shows `#sheet-menu` un-hidden with `data-menu-type="tab-context"`, aria-label **"Tab menu"**, and `role="menuitem"` items EXACTLY (order pinned): **Close**, **Close other tabs**, **Close tabs to the right**, **Duplicate**, **Move to new window** *(row added M09 F6 DD5 — enumeration updated by FD ruling at the F6 leg-5 re-run; separator sits between the close section and Duplicate)* — and **NO "Reopen closed tab"** (the stack is empty — first omission check, rule-driven not blanket). `readAxTree` shows `role="menu"` with focus on the first item. `enumerateTabs()` still reports **T4 active** — right-clicking a background tab opened ITS menu **without activating it**. Dismiss via `pressKey(sheetWcId, 'Escape')` (refocus assertion deferred to Step 10); confirm `#sheet-menu` re-hidden. |
| 4 | **`tab:close` acts on the CAPTURED tab.** Right-click background **T2** again (re-read rects first). Poll the menu open, read the menu-item rects on the sheet, and `click(sheetWcId, x, y)` on **Close**. Poll `enumerateTabs()`. | **T2** is gone (its URL absent from `enumerateTabs()`); every other tab survives; **T4 is STILL active** — the dispatch acted on the tab id captured at open, never `activeTab()`. (The stack now holds T2 — Work is a persist jar, so menu closes capture, deliberately: Chrome parity, flight open-question ruling.) Strip order now D, T1, T3, T4. |
| 5 | **Ordered-sweep `tab:close-others` — anchor activated first.** Re-read rects. Right-click background **T3** (active is T4). Activate **Close other tabs** (coordinate click on the sheet item). Poll `enumerateTabs()` and the chrome DOM order. | End state EXACT: `enumerateTabs()` lists **only T3** among the fixture tabs (D, T1, T4 all closed — each captured to the stack), with **T3 `active: true`** — the anchor became the active tab (Chrome parity; the sweep activated the anchor FIRST because the active tab was among the targets, so `closeTab`'s own next-tab fallback never fired mid-sweep — no other tab was ever left activated, which the end-state pins: any mid-sweep fallback cascade would have left a NON-anchor tab active or created a spurious new tab; assert `enumerateTabs()` has exactly one entry and the DOM strip exactly one `.tab`). |
| 6 | **Ordered-sweep `tab:close-right` — survivors exact.** Rebuild: `openTab(page1Url, 'work')` → **N1**, `openTab(page2Url, 'work')` → **N2** (strip: T3, N1, N2; N2 active). Re-read rects. Right-click **T3** (leftmost, background). Activate **Close tabs to the right**. Poll `enumerateTabs()`. | Survivors EXACT: only **T3** remains (`enumerateTabs()` single entry, DOM strip single `.tab`); N1 and N2 both closed (both captured); **T3 `active: true`** (the active tab N2 was among the targets → anchor activated first). |
| 7 | **`tab:duplicate` — same jar, same URL, inserted beside the source, history carried.** Give **T3** history: `navigate(T3wcId, page5Url)` (T3: page3 → page5, 2 entries, index 1). Open `openTab(page1Url, 'work')` → **N3** (strip: T3, N3; N3 active). Re-read rects. Right-click background **T3**. Activate **Duplicate**. Poll `enumerateTabs()` for a new wcId (**DUP**) at page 5's URL; read the chrome DOM order. | **DUP** appears with `url` = page 5 and `jarId` = `work` (same jar — the source tab's own container, burner-included rule), inserted at DOM position **1** — directly BESIDE the source (strip order T3, DUP, N3 — `insertAt: sourceIndex+1`), and active (duplicate activates — the flight's default). `goBack(DUPwcId)` then re-`enumerateTabs()`: **DUP**'s url is now **page 3** — the SOURCE tab's prior history entry, proving the `tab-history-snapshot` → `restoreHistory` chain carried real navigation history, not just the current URL (the F4 fidelity check reused). `goForward` returns DUP to page 5. |
| 8 | **Menu `tab:reopen-closed` — the MID-STRIP row (F4 spec-polish rider).** Strip is T3, DUP, N3 — DUP is mid-strip with neighbors BOTH sides. `closeTab(DUPwcId)` (drives the same capture path a ✕-click does — the F4-proven apparatus fact); confirm DUP gone, stack top = DUP (most recent close). Re-read rects. Right-click **T3**. The menu now INCLUDES **Reopen closed tab** (stack non-empty — the omission rule's positive flip). Activate it. Poll `enumerateTabs()` and the DOM order. | A new tab appears at page 5's URL, `jarId` `work`, at DOM position **1** — BETWEEN T3 and N3, its original mid-strip position among its original neighbors (NOT appended at the end — the positional-reopen assertion F4's own run could not distinguish from append). The menu closed on activation. |
| 9 | **Omission states — single tab.** Reduce to one tab: right-click the reopened tab and activate **Close other tabs** (reuses Step 5's proven body; leaves exactly the reopened tab, active). Re-read rects. Right-click the SOLE remaining tab. Read the menu items. | Items EXACTLY: **Close**, **Duplicate**, **Reopen closed tab** (the stack is non-empty from Step 9's own sweep — reopen present is the positive control proving Step 3's absence was the empty-stack RULE, not a blanket omission) — **NO "Close other tabs"** (only tab) and **NO "Close tabs to the right"** (none to its right). Separators sit only between populated sections (never leading/trailing). Dismiss via Escape. |
| 10 | **Escape refocus to the invoking tab.** `openTab(page1Url, 'work')` → **N4** (2 tabs; N4 active). Re-read rects. Right-click the OTHER (background) tab. Poll the menu open. `pressKey(sheetWcId, 'Escape')`. Read `evaluate(C, "document.activeElement?.closest('.tab')?.dataset.id")` and re-read `enumerateTabs()` + `#sheet-menu`'s hidden state. | `#sheet-menu` is hidden (dismissed, reason `escape`). The chrome's `document.activeElement` resolves to the **invoking tab's** `.tab` element (its `dataset.id` matches the right-clicked tab) — the captured `returnFocus`, escape-only, page-context parity — NOT the address bar, NOT `<body>`. **N4 is still the active tab** (refocus moved DOM focus only; no activation side-effect). |

## Out of Scope

- **The literal Context-Menu key / Shift+F10 press** — apparatus gap (`KEY_MAP` lacks
  `ContextMenu`/`F10`; see Preconditions). The trigger is structurally the shipped
  toolbar-pin-button mechanism plus a unit-covered catch-all gate extension; the real-key press is
  HAT-scoped, mirroring `tab-cycling.md`'s PageDown/PageUp carve-out.
- **Mid-sweep transient pixels** (a doomed tab flashing active for a frame during a batch close) —
  the ordered-sweep design makes the cascade structurally impossible and the end-state assertions
  in Steps 5–6 pin the observable contract; inter-frame motion is exactly what discrete captures
  cannot catch (the F9 lesson) — HAT territory, not automatable here.
- **Real-keyboard item activation on the sheet** (Enter on a focused menuitem) — the established
  sheet apparatus nuance; covered by HAT and the shared menu-controller unit net.
- **Model omission-rule combinatorics** — fully pinned by `tab-context-model.test.js`; this spec
  exercises each rule once live (empty stack, single tab, none-to-right via Step 6's anchor being
  rightmost-after-sweep is implicit) rather than re-enumerating the truth table.
- **"Move to new window"'s ACTION semantics** — the row's PRESENCE/omission is asserted in
  Steps 3/9 (added M09 F6 DD5; enumeration updated by FD ruling), but activating it — the
  re-parent move itself — is `multi-window-shell.md`'s subject, not this spec's.
- **Middle-click close** — landed F1, pinned by `responsive-tab-strip.md`/F1 checks; untouched by
  this flight.
- **macOS parity** — carried to the mission's later HAT flight, per the existing convention.

## Variants (optional)

- N/A for the initial authoring. Once `KEY_MAP` gains `ContextMenu`/`F10`, add a keyboard-trigger
  variant: focus a tab (chrome-side), send the real key, and re-run Steps 3 + 10's assertions —
  including the double-fire dedupe (exactly ONE menu opens, the TAB menu, never a doubled generic
  Inspect menu).
