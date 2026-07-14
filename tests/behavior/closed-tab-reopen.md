# Behavior Test: Closed-tab stack and reopen (Ctrl+Shift+T)

**Slug**: `closed-tab-reopen`
**Status**: active
**Created**: 2026-07-14
**Last Run**: 2026-07-14-21-48-13

## Intent

Verify the M09 Flight 4 closed-tab stack + `Ctrl+Shift+T` reopen chain (flight DD1/DD2) as
real, multi-`WebContentsView` behavior — invisible to the pure unit suite, which pins only the
capture-shape, classifier/allowlist/mapper decisions, and the stack's own bound/order in
isolation, not the LIVE round-trip through main's capture (`tab-close`), the renderer-
orchestrated reopen chain (`tabReopen()` → `createTab()` → `tab-create`'s restore branch), and
`navigationHistory.restore()` against a fresh `WebContentsView`. Specifically: a reopened tab
restores its URL, its original cookie-jar assignment, and — confirmed live via the pre-leg-1
spike — its back/forward history, landing at its ORIGINAL strip position; the reopen fires
identically from all three chrome-shortcut capture points (chrome keydown, guest
`before-input-event`, menu-overlay sheet accelerator forwarding — the SAME three points
`tab-cycling.md` exercises for tab-cycle/jump); an empty stack is a silent no-op; burner and
internal tabs are structurally never captured, so a burner can never be resurrected; and a jar
deleted between close and reopen falls back to the resolved default jar with an announcement.
(Flight DD1, DD2, DD4.)

## Preconditions

- **Apparatus — admin MCP surface**, identical to `tab-cycling.md`'s. Goldfinch is running via
  `npm run dev:automation` with `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1`.
  At launch, the app prints `AUTOMATION_DEV_MINT { "key": "...", "adminKey": "..." }` to stdout —
  capture the `adminKey`.
- **Port (load-bearing for every URL below) — pin-if-free, else free-fallback.** Try pinning the
  listen port via `GOLDFINCH_MCP_PORT`. If the launch fails to bind it, relaunch **without** the
  env pin — the server free-falls to the next available port and prints it (and a fresh
  `AUTOMATION_DEV_MINT`) to stdout. Read the actually-bound port from that output and reuse it in
  every SDK call below.
- **Fresh scratch profile** (`XDG_CONFIG_HOME` pointed at an empty directory), so the jar seed is
  deterministic: Personal (default) + Work, no other jars (the same precondition
  `jar-delete-closes-tabs.md` and `new-tab-default-routing.md` rely on) — needed for the
  jar-deleted-fallback row, which deletes the Work jar mid-run.
- **Admin MCP client** (SDK `StreamableHTTPClientTransport`, `Authorization: Bearer <adminKey>`)
  on `127.0.0.1:$GOLDFINCH_MCP_PORT/mcp`. Admin is required: a jar key cannot `getChromeTarget`
  (drive the chrome renderer) or open a `goldfinch://` internal tab.
- **Fixture pages** — reuse the `fixtures-tabstrip` set (`Fixture Page 1 — tabstrip` ..
  `Fixture Page N — tabstrip`, distinct titles), served locally via
  `python3 -m http.server 8000` from the fixture directory, reachable at
  `http://127.0.0.1:8000/pageN.html` (the same fixture set + port convention
  `downloads-surface.md`/`omnibox-suggestions.md` use). Only 3 pages are needed (history-fidelity
  needs 2 navigations); confirm pairwise-distinct titles via `readAxTree` before relying on tab
  identity.
- **Input delivered as trusted events** via the MCP tools (`pressKey(wcId, name, modifiers)`,
  `click`), and tab lifecycle via `openTab`/`closeTab`/`navigate`/`goBack`/`goForward` (admin
  tier) — `closeTab` drives the SAME `closeTabByWcId` → renderer `closeTab()` → `tabClose` IPC
  path a real ✕-click does (confirmed at Leg 1's live capture-wiring check), so it is a legitimate
  way to populate the closed-tab stack, not a bypass.
- **The evaluate-reachable dogfooding seam** (`src/renderer/renderer.js`'s FD-approved
  `globalThis` republish block) exposes `createTab`/`makeBurner` by name for `evaluate(C, …)` —
  the SAME mechanism `popup-jar-inheritance.md`/`jar-data-controls.md` use — needed for the
  burner-exclusion row (automation's `openTab` cannot mint a burner tab; burner containers are
  never in the `containers` list `openTab`'s `jarId` resolves against).
- **The app boots with one default tab already open** (apparatus fact, carried from
  `tab-reorder.md`/`tab-cycling.md`) — the closed-tab stack itself starts EMPTY on every fresh
  launch (in-memory, main-process-owned singleton, no persistence this flight — DD1), which is
  what makes the empty-stack no-op row cheap to exercise: run it FIRST, before any tab has been
  closed.
- **Reopen is asynchronous** (renderer-orchestrated two-invoke chain: `tabReopen()` invoke → pops
  the stack → `createTab()` → `tab-create` invoke →, when restoring, `navigationHistory.restore()`
  → its own `did-finish-load`). Every post-reopen read below polls `enumerateTabs()` (short
  interval, few-second budget) rather than reading immediately after the keypress.
- **Menu-overlay sheet dismissal timing differs from `tab-cycling.md`'s.** Cycling among
  EXISTING tabs closes the sheet synchronously (`tab-set-active` fires in the same tick,
  `reason: 'tab-switch'`). Reopen instead calls `createTab()`, whose synchronous `activateTab()`
  runs with `wcId` still `null` (brand-new-tab path, `renderer.js`) — main's `tab-set-active`
  close-family hook does not fire until the async `tab-create` invoke resolves. So the sheet-open
  row's menu-close assertion is polled, not instantaneous.
- **Apparatus disqualification:** the `chrome-devtools` MCP does **NOT** qualify (launches its
  own browser). The apparatus is the SDK admin MCP client over
  `127.0.0.1:$GOLDFINCH_MCP_PORT`, app launched via `npm run dev:automation`.

## Observables Required

- mcp (admin MCP tools on the chrome `wcId`, guest `wcId`s, and the probed sheet `wcId`, measured
  via the admin MCP client): `evaluate` for DOM order/tab-title-by-index numeric reads and the
  `createTab`/`makeBurner` dogfooding-seam calls. `readAxTree` for tab titles/selected-state.
  `enumerateTabs` for guest wcIds, urls, and `jarId`s (admin listings include the internal tab).
  `pressKey` for every accelerator (`['control', 'shift']`). `openTab`/`closeTab`/`navigate`/
  `goBack`/`goForward` for tab lifecycle and history setup/fidelity. `click` for guest-focus setup
  and the kebab-menu trigger. `captureWindow` for the sheet-open/closed corroboration.
- shell (precondition probe: `tools/list`, `getChromeTarget` — measured via the MCP client).

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **Active-precondition probe.** Connect the admin MCP client; call `tools/list`; then `getChromeTarget()`. | `tools/list` **includes** (presence-checked) `getChromeTarget`, `evaluate`, `pressKey`, `enumerateTabs`, `click`, `readAxTree`, `openTab`, `closeTab`, `goBack`, `goForward`. `getChromeTarget()` returns `{ wcId, kind: 'chrome', url }` with a numeric `wcId` (record as **C**). If not, halt. |
| 2 | **Empty-stack no-op — positive control.** Immediately after boot (before any tab has been closed — the stack starts empty every launch, DD1), record the FULL `enumerateTabs()` list and the DOM tab-title order (`evaluate(C, …)`). From chrome focus, `pressKey(C, 'T', ['control', 'shift'])`. Wait briefly, then re-read both. | `enumerateTabs()` and the DOM order are **byte-identical before and after** (explicit equality check, not just "no crash" — the project's no-hijack convention) — no tab was created, none closed, nothing activated. The empty stack silently no-ops. |
| 3 | **Setup.** Confirm the fresh-profile jar seed (`evaluate(C, "window.goldfinch.jarsList()")` → Personal + Work only). Open a Work-jar tab at fixture page 1 (`openTab(page1Url, 'work')` → wcId **W**). `navigate(W, page2Url)`; `navigate(W, page3Url)` (2 navigations → 3 history entries, index 2, `canGoBack` true). Record **W**'s DOM tab-title index (`evaluate(C, …)`, call it **P**) and confirm via `enumerateTabs()` that **W**'s `jarId` is `work` and `url` is page 3. | Jar seed confirmed. **W** is a 3-entry-history Work-jar tab at page 3, DOM position **P** recorded, ready to close. |
| 4 | **Chrome-focus reopen — full fidelity (url + jar + history + position).** `closeTab(W)`. Confirm via `enumerateTabs()` that **W** is gone. From chrome focus, `pressKey(C, 'T', ['control', 'shift'])`. Poll `enumerateTabs()` for a new wcId (**W2**) at page 3's URL. | **W2** appears with `url` = page 3, `jarId` = `work` (jar preserved), at DOM tab-title index **P** (original position preserved — `insertAt`/`commitTabMove`, DD2 step 3). `goBack(W2)` then re-`enumerateTabs()`: `url` is now page 2 (history restored — `canGoBack` was true, the LIVE-fidelity check). `goForward(W2)` returns to page 3. |
| 5 | **Guest-delivered reopen — the strongest capture-point case.** Open a second Work-jar tab at page 1 (wcId **G-src**), `navigate(G-src, page2Url)`. `closeTab(G-src)`. `click` into a **different**, currently-foreground-after-close tab's body so its guest wcId (**G**) holds OS focus (confirm via `readAxTree(G)` or `evaluate(G, "document.hasFocus()")`). `pressKey(G, 't', ['control', 'shift'])` — delivered INTO the guest, not the chrome. Poll `enumerateTabs()`. | A new tab appears at page 2's URL (the entry **G-src** captured), `jarId` `work` — proving the guest `before-input-event` capture point forwards `reopen-closed-tab` via the generalized chrome-class forwarder (guest never handles it natively; classifies via the SAME `keydownToAction`/allowlist path as chrome focus). |
| 6 | **Sheet-open reopen (menu-overlay capture point).** Open a third Work-jar tab at page 1 (wcId **S-src**). `closeTab(S-src)`. Open the kebab menu (`click` its trigger). Probe the sheet's wcId per the established technique (`readDom`, skipping every `enumerateTabs` wcId and **C**). Confirm the menu is open (`captureWindow()`). `pressKey(sheetWcId, 'T', ['control', 'shift'])`. Poll `enumerateTabs()` for the new tab AND poll `captureWindow()`/`readAxTree(sheetWcId)` for menu-closed. | A new tab appears at page 1's URL (the **S-src** entry), `jarId` `work`. The menu **closes** (asynchronously — see Preconditions; `captureWindow()` eventually shows no menu, driven by the `tab-set-active` close-family hook once the reopened tab's wcId arrives) — a single keypress both dismisses the menu and reopens the tab. |
| 7 | **Burner exclusion.** `evaluate(C, "createTab('http://127.0.0.1:8000/page4.html', makeBurner())")` (the FD-approved dogfooding seam — `openTab` cannot mint a burner). Confirm via `enumerateTabs()` a new tab with `jarId` matching `burner-<n>` and `url` page 4 (wcId **B**). `closeTab(B)`. From chrome focus, `pressKey(C, 'T', ['control', 'shift'])`. Poll `enumerateTabs()`. | The reopened tab (if any — depends on what else is on the stack at this point) is **NOT** page 4: `enumerateTabs()`'s full url list contains page 4's URL **NOWHERE** after this step (burner never pushed onto the stack in the first place — the positive persist-jar allowlist at capture, DD2 — so it can never be popped). If the stack was otherwise empty, this row is a repeat of Step 2's no-op (also valid: still proves the burner was never captured). |
| 8 | **Internal exclusion.** Open `goldfinch://settings` via the trusted chrome route (kebab → Settings) — **NOT** `openTab`, which refuses non-http(s) — then `enumerateTabs()` (admin) to record its wcId **I**. `closeTab(I)` (admin `closeTab` resolves internal contents when `allowInternal` is forwarded — confirmed at Leg 1's live check). From chrome focus, `pressKey(C, 'T', ['control', 'shift'])`. Poll `enumerateTabs()`. | The reopened tab (if any) is **NOT** `goldfinch://settings`: no tab in the post-reopen `enumerateTabs()` list has that URL, and no tab reports `jarId: 'internal'` beyond whatever internal tab may still be independently open. The internal tab was never captured (positive persist-jar allowlist — the internal partition structurally fails it). |
| 9 | **Jar-deleted fallback.** Open a Work-jar tab at page 5 (wcId **F**). `closeTab(F)`. Confirm via `enumerateTabs()` that **F** is gone. Via the chrome apparatus, `evaluate(C, "window.goldfinch.jarsRemove({id:'work'})")` — deleting the Work jar (any OTHER Work tabs left open close too, per `jar-delete-closes-tabs.md`'s existing contract; irrelevant here since **F** is already closed and only the stack ENTRY, not a live tab, is at stake). From chrome focus, `pressKey(C, 'T', ['control', 'shift'])`. Poll `enumerateTabs()` and read `#tab-status` (`readAxTree(C)` or `evaluate(C, "document.getElementById('tab-status').textContent")`). | A new tab appears at page 5's URL, but its `jarId` is **NOT** `work` (the jar no longer exists) — it resolves to whatever `jarsGetDefault()` now reports (Personal, or Burner if Personal was also removed — not the case here). The `#tab-status` region's text is non-empty and mentions the fallback (the `jarFallback` announcement, DD2 step 3) — confirming the reopen never silently drops the tab and never resurrects a dead jar id. |

## Out of Scope

- **Auto-repeat (a held `Ctrl+Shift+T`)** — the classifier's `isRepeatSafeAction('reopen-closed-tab')`
  stays `false` by prefix (pinned at the unit level); a held-key repeat-suppression spot-check is
  a HAT-scoped manual check, not automated here (mirrors `tab-cycling.md`'s own carve-out for
  auto-repeat).
- **Stack bound (25 entries, oldest-evicted) and `toJSON`/`fromJSON` round-trip** — fully pinned
  by `closed-tab-stack.test.js`; not re-verified live (would require closing 26+ tabs, expensive
  for no additional live-only risk).
- **Reopen menu affordance** — deferred to the context-menu flight (flight DD3); this spec covers
  the keyboard path only.
- **`navigationHistory.restore()`'s general fidelity limits** (e.g. very large `pageState`
  blobs, non-http(s) history entries) — the pre-leg-1 spike already confirmed full fidelity for
  the shapes this flight produces; not re-probed here.
- **Multi-window** — out of scope per the flight (single window this mission).
- **macOS parity** — carried to the mission's later HAT flight, per the existing convention.

## Variants (optional)

- N/A for the initial authoring. A future variant could interleave a jar-scoped (non-admin)
  automation key to confirm reopen behaves identically for a non-privileged driver, once the
  automation surface exposes a reopen-equivalent op (today the chord is chrome-UI-only, matching
  new-tab/close-tab's own automation posture).
