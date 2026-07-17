# Behavior Test: Keyboard tab cycling and position jumps

**Slug**: `tab-cycling`
**Status**: active
**Created**: 2026-07-14
**Last Run**: 2026-07-14-19-47-08

## Intent

Verify keyboard tab cycling (`Ctrl+Tab`/`Ctrl+Shift+Tab`, `Ctrl+PageDown`/`Ctrl+PageUp`) and
position jumps (`Ctrl+1`..`Ctrl+8`, `Ctrl+9`=last) work as GLOBAL chrome shortcuts — from all
three capture points (chrome keydown, guest `before-input-event`, menu-overlay sheet
accelerators) — and follow the tab strip's VISUAL (DOM) order, including after a keyboard
reorder. This needs a behavior test because it is a real multi-`WebContentsView` capture-point
and focus-routing property of the *running* app (which view receives the key, whether it is
forwarded, whether the address bar's value is synced on activation) — invisible to the pure
unit suite, which pins only the classifier/allowlist/mapper decisions in isolation, not the
live routing through three independently-wired capture points. (M09 Flight 3 DD1–DD4.)

## Preconditions

- **Apparatus — admin MCP surface.** Goldfinch is running via `npm run dev:automation` with
  `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1`. At launch, the app prints
  `AUTOMATION_DEV_MINT { "key": "...", "adminKey": "..." }` to stdout — capture the `adminKey`.
- **Port (load-bearing for every URL below) — pin-if-free, else free-fallback.** Try pinning the
  listen port via `GOLDFINCH_MCP_PORT`. If the launch fails to bind it, relaunch **without** the
  env pin — the server free-falls to the next available port and prints it (and a fresh
  `AUTOMATION_DEV_MINT`) to stdout. Read the actually-bound port from that output and reuse it in
  every SDK call below.
- **How the admin key attaches to the client (load-bearing).** Connect an admin MCP client (SDK
  `StreamableHTTPClientTransport`, `Authorization: Bearer <adminKey>`) on
  `127.0.0.1:$GOLDFINCH_MCP_PORT/mcp`. This spec requires the **admin** key: a jar key is refused
  `getChromeTarget` and cannot drive the chrome renderer.
- **Drive the renderer (chrome UI) AND individual guest tabs.** `getChromeTarget()` returns the
  chrome `wcId` directly (record as **C**). `enumerateTabs()` lists guest `wcId`s (web + internal)
  by creation order (NOT visual order — see the tab-reorder spec's own Out of Scope note; this
  spec addresses tabs by `wcId`, never by enumerate-position).
- **The menu-overlay sheet is a separate, non-enumerated per-window `WebContentsView` — resolve it
  via `enumerateWindows()`** (M09 F7 DD2; see `menu-overlay.md`'s Observables note): its per-window
  row carries `sheetWcId` and `sheetVisible`. Take this window's row and drive/read that wcId. The op
  is **admin-only**, which this spec already requires. **`sheetWcId` is absent until the sheet's first
  open** (it is lazy) — resolve it at the sheet-open step, not before.
- **Input delivered as trusted events** via the MCP tools (`pressKey(wcId, name[, modifiers])`,
  `click(wcId, x, y)`, `typeText(wcId, text)`) — only trusted events fire the renderer's real
  handlers, the guest `before-input-event` capture, and the sheet's accelerator forwarding.
  `pressKey` modifier arrays are used as `['control']` and `['control', 'shift']`.
- **Numeric geometry/state reads are the primary observable (M09 F1 DD4 convention, carried
  forward).** Admin-tier `evaluate(wcId, expression)` for DOM order (`[...document.querySelectorAll('#tabs .tab')].map(t => ({id: t.dataset.id, selected: t.getAttribute('aria-selected')}))`),
  the address bar's live value (`document.getElementById('address').value`), and guest scroll
  position (`window.scrollY`). `readAxTree(wcId)` for tab titles/selected-state as a second,
  independent read. `captureWindow()` corroborates rendered truth (menu open/closed, focus ring).
- **Fixture-distinctness probe** (folded into Step 2): the committed `tabstrip` set,
  `tests/behavior/fixtures/tabstrip/` — six distinct static pages `page1.html` .. `page6.html`
  titled `Fixture Page 1 — tabstrip` .. `Fixture Page 6 — tabstrip` (that directory's README pins
  the content and the serve command). Serve it **from that directory** via
  `python3 -m http.server 8000`, reachable at `http://127.0.0.1:8000/pageN.html`. **This spec uses
  all six — it is the set's largest consumer and the reason the set has six pages.** Confirm
  pairwise-distinct titles via `readAxTree` before relying on tab identity for any later step.
  *(Corrected at the M09 F7 leg-4 errata fold: this line previously said the set was "the same
  fixture set `tab-reorder.md` uses". It is not — `tab-reorder` names no shared set and titles its
  pages `Tab1..Tab5`.)*
- **Active precondition probe** (Step 1): confirm `tools/list` includes (presence-checked, not an
  exact count) `getChromeTarget`, `evaluate`, `pressKey`, `enumerateTabs`, `click`, `readAxTree`.
- **Apparatus disqualification:** the `chrome-devtools` MCP does **NOT** qualify (launches its own
  browser, never touches this app). The apparatus is the SDK admin MCP client over
  `127.0.0.1:$GOLDFINCH_MCP_PORT`, app launched via `npm run dev:automation`.
- **The app boots with one default tab already open** (apparatus fact, carried from
  `tab-reorder.md`) — do not assume "open six tabs" yields exactly six. Record the ACTUAL DOM
  order/count after opening the fixture tabs in Step 2 and word every later step in terms of the
  observed order/count (e.g. "the digit equal to the actual tab count"), never a hardcoded total.
- **Auto-repeat and mid-drag interplay are NOT covered here** (see Out of Scope) — this spec
  exercises single, discrete key presses only.

## Observables Required

- mcp (admin MCP tools on the chrome `wcId`, guest `wcId`s, and the probed sheet `wcId`, measured
  via the admin MCP client): `evaluate` for DOM order/address-value/scroll-position numeric
  reads. `readAxTree` for tab titles/selected-state. `enumerateTabs` for guest wcIds and internal-
  tab discovery. `pressKey` for every accelerator in this spec (`['control']` /
  `['control', 'shift']` modifier arrays). `click`/`typeText` for setup and the address-replace
  check. `captureWindow` for the sheet-open/closed corroboration.
- shell (precondition probe: `tools/list` and `getChromeTarget` — measured via the MCP client or
  Bash).

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **Active-precondition probe.** Connect the admin MCP client; call `tools/list`; then call `getChromeTarget()`. | `tools/list` **includes** (presence-checked) `getChromeTarget`, `evaluate`, `pressKey`, `enumerateTabs`, `click`, `readAxTree`. `getChromeTarget()` returns `{ wcId, kind: 'chrome', url }` with a **numeric** `wcId` (record as **C**). If not, halt — preconditions not met. |
| 2 | Open the **six** tab-strip fixture pages (Fixture Page 1..6) as new tabs — in addition to whatever default tab the app booted with. Confirm pairwise-distinct titles via `readAxTree(C)`. Record the ACTUAL resulting DOM order (`evaluate(C, …)`, `.tab` `dataset.id` sequence — call its length **N**, do not assume a fixed value) and each tab's guest `wcId` (`enumerateTabs()`). | Titles are pairwise distinct — halt and fix the fixture if any two collide. Baseline DOM order (length **N**) and the wcId-to-tab-id mapping are recorded for every later step. (setup row) |
| 3 | **Chrome-focus cycling + address-replace semantics.** Activate the DOM-position-1 tab. Click the address bar (`els.address`) and `typeText(C, "in-progress-edit")` — do NOT press Enter (an unsubmitted, in-progress edit). Record the active tab. `pressKey(C, 'Tab', ['control'])`. Then read the address bar's live value (`evaluate(C, "document.getElementById('address').value")`) and the newly-active tab (`readAxTree(C)` / `enumerateTabs()`). | The active tab advances to the DOM-position-2 tab (proving cycling works with focus in the address bar — the global-scope claim). The address bar's value is now the **new active tab's real URL** — NOT `"in-progress-edit"` — proving `activateTab()`'s unconditional address sync **replaces** an in-progress edit exactly as Chrome does (design-review correction: the spec must assert the replace, not a "keeps its text" premise). |
| 4 | **Guest-delivered cycling — the strongest capture-point case + focus re-arm (L2/T3).** `click` into a **different**, currently-background tab's body so its guest wcId (**G**) holds OS focus (confirm via `evaluate(G, "document.hasFocus()")` or `readAxTree`). Record **G_next** = the guest wcId of the DOM-successor of **G**'s tab (from the Step 2 mapping / `enumerateTabs()`). `pressKey(G, 'Tab', ['control'])` — delivered INTO the guest, not the chrome. Then read `evaluate(G_next, "document.hasFocus()")` **and** `evaluate(G, "document.hasFocus()")`. | The active tab cycles to the DOM-successor of **G**'s tab (`readAxTree(C)` / `enumerateTabs()` selected-state) — proving the guest `before-input-event` capture point forwards `Ctrl+Tab` via the generalized chrome-class forwarder (the guest never handled it natively). **AND the INCOMING guest holds OS focus:** `evaluate(G_next, "document.hasFocus()") === true` while `evaluate(G, "document.hasFocus()") === false` — the L2/T3 re-arm: because focus was in the page (the outgoing guest **G** held it), `tab-set-active` re-focuses the newly-active guest, so keyboard routing survives the switch (subsequent guest-forwarded chords keep landing). This is the REAL observable — note MCP `pressKey` injects via `sendInputEvent`-by-wcId, which BYPASSES OS focus routing, so a "second chord with no click" step would forward regardless of the bug; asserting the incoming guest's `hasFocus()` is what actually distinguishes fixed from broken. The two-consecutive-chords-no-click framing is the MANUAL HAT reading (real OS focus), not this automated step. |
| 5 | **Guest scroll-suppression (Ctrl+Tab, standing in for PgDn/PgUp — see apparatus note below).** Click into a background guest tab's body (wcId **G2**); confirm `evaluate(G2, "window.scrollY")` reads `0`. `pressKey(G2, 'Tab', ['control'])`. Re-read `window.scrollY` on **G2** and the active tab. | `Ctrl+Tab` cycles the active tab forward — AND `evaluate(G2, "window.scrollY")` is **still `0`** afterward, proving the guest never saw a raw, unforwarded key event that could scroll the page (`preventDefault` suppressed it). This stands in for the `PageDown`/`PageUp` scroll-suppression case per the apparatus note below — `dispatchChromeAction` treats `'tab-next'`/`'tab-prev'` identically regardless of which key produced them, so this exercises the same dispatch path. |
| 6 | **Jumps: first / actual-last / out-of-range no-op (positive control) / `tab-jump-last`.** From chrome focus: `pressKey(C, '1', ['control'])` → record active tab. If **N** ≤ 8, `pressKey(C, String(N), ['control'])` → record active tab. Record the active tab, then `pressKey(C, String(N+1), ['control'])` (only if **N**+1 ≤ 9 — an out-of-range digit) → record active tab again (**positive control**: an explicit before/after equality check, not just "no crash"). Finally activate the DOM-position-1 tab again, then `pressKey(C, '9', ['control'])`. | `Ctrl+1` activates the DOM-position-1 tab. `Ctrl+<N>` (if ≤8) activates the DOM-position-**N** tab — the actual last tab in the current order. The out-of-range `Ctrl+<N+1>` press leaves the active tab **UNCHANGED** (before == after, verified by direct comparison — Chrome-parity: a jump beyond the tab count does nothing). `Ctrl+9` (`tab-jump-last`) activates the DOM-position-**N** tab regardless of starting position — confirming `tab-jump-last` resolves to "the actual last tab" independently of whichever digit also happens to reach it. |
| 7 | **Wrap at both ends.** From the DOM-position-**N** (last) tab active, `pressKey(C, 'Tab', ['control'])`. Then from the DOM-position-1 tab active, `pressKey(C, 'Tab', ['control', 'shift'])`. | `Ctrl+Tab` from the last tab **wraps** to the DOM-position-1 tab (not a no-op, not an error). `Ctrl+Shift+Tab` from the first tab **wraps** to the DOM-position-**N** (last) tab. |
| 8 | **Post-reorder visual-order jump (pinned prediction) — F2 integration.** Focus into the tab strip (`pressKey(C, 'Tab')` until a tab is focused) and land focus on the DOM-position-2 tab. `pressKey(C, 'ArrowRight', ['control', 'shift'])` (the existing keyboard-reorder chord — moves it one slot right, to DOM-position-3). Re-read the DOM order (`evaluate(C, …)`) — this is the **pinned prediction** for what a jump to position 3 should now activate (the tab that moved into that slot). Then `pressKey(C, '3', ['control'])`. | The reorder moves the tab exactly one slot (confirmed by the DOM-order re-read, matching the reorder model's own one-slot rule — see `tab-reorder.md`). `Ctrl+3` then activates the tab the DOM-order re-read predicts is now at position 3 — **not** whichever tab held position 3 before the reorder — proving jumps resolve against `orderedTabIds()` (VISUAL order), not a stale or creation-order snapshot. |
| 9 | **Sheet-open cycle.** Open the kebab menu (`click` its trigger in the chrome). Probe for the sheet's wcId per the Preconditions technique. Confirm the menu is open (`captureWindow()`, `readAxTree` on the sheet wcId). Record the active tab. `pressKey(sheetWcId, 'Tab', ['control'])`. | The menu **closes** (`captureWindow()` shows no menu; the sheet's dismissal fires via the existing `tab-switch` close reason — no new plumbing per DD3) **and** the active tab switches to the DOM-successor of the tab that was active when the menu opened (`readAxTree(C)` / `enumerateTabs()`) — a single keypress both dismisses the menu and cycles the tab, matching Chrome-parity menu-then-shortcut behavior. |
| 10 | **Internal-tab cycle.** Open `goldfinch://settings` via the trusted chrome route (kebab → Settings) — **NOT** `openTab`, which refuses non-http(s) — then `enumerateTabs()` (admin) to record its wcId **I**. With **I** active, click into its body so it holds focus, then `pressKey(I, 'Tab', ['control'])`. Then re-activate **I** (click its strip tab) and `pressKey(I, '1', ['control'])`. | `Ctrl+Tab` delivered while the internal `goldfinch://settings` tab holds focus cycles the active tab away from **I** to its DOM-successor (`readAxTree(C)` / `enumerateTabs()`) — an internal page must not trap the operator (DD2). `Ctrl+1` similarly jumps away from **I** to the DOM-position-1 tab, proving jumps forward on the internal guest kind too, not just cycling. |
| 11 | **Single-tab wrap — harmless self-activate (design-review note).** Close every tab down to exactly **one** (repeated `Delete`/✕-click; confirm via `enumerateTabs()` returning a single entry). Record that tab's id and its `selected` state (should already be `true` — the never-zero invariant). `pressKey(C, 'Tab', ['control'])`. | The **same** tab remains the sole tab and remains `selected: true` — cycling with one tab open is a harmless `activateTab(sameId)` re-add with **no visible change**. **This row's expected result IS "nothing changed"** — read it as a PASS, not as evidence the keypress was silently swallowed; the wrap is real (mod the single-tab degenerate case), it just has no observable effect when there is nowhere else to go. |

**Row conventions:** one row = one checkpoint; Step 2 is pure setup. Step 6's out-of-range check is
a positive control (explicit before/after equality) per the project's no-hijack pattern. Step 11's
"nothing changed" result is the CORRECT outcome, called out explicitly so a Witnessed run doesn't
misjudge it as a failed action.

## Out of Scope

- **`Ctrl+PageDown`/`Ctrl+PageUp` live delivery — APPARATUS GAP, discovered at Leg 1 live-check.**
  The `pressKey` MCP tool's key-name resolver (`src/main/automation/input.js`'s `KEY_MAP`) does
  not currently recognize `PageDown`/`PageUp` (its known set is `Tab, Enter, Escape, Space,
  ArrowRight, ArrowLeft, ArrowDown, ArrowUp, Home, End, Delete, Backspace, ShiftTab`, or a single
  letter/digit) — calling `pressKey(wcId, 'PageDown', ['control'])` throws `automation: unknown
  key PageDown` today. This is a gap in the **automation surface itself**, not a product defect:
  `keydownToAction`/`sheetAcceleratorAction` both map `PageDown`/`PageUp` identically to
  `Tab`/`Shift+Tab` (`'tab-next'`/`'tab-prev'`), pinned by the unit suite, and `dispatchChromeAction`
  dispatches on the resulting action string only — it cannot distinguish which key produced it.
  Step 5 above substitutes `Ctrl+Tab` for the scroll-suppression check on that basis. Extending
  `KEY_MAP` to add `PageDown`/`PageUp` is a small, self-contained follow-up to the automation
  surface (`src/main/automation/input.js` + its `mcp-tools.js` description string) — noted for a
  future maintenance pass, not this flight's Files Affected list.
- **AltGr / shifted-digit i18n behavior** (`Ctrl+Alt+7` → must NOT jump; shifted digits on AZERTY
  → must still jump) is fully pinned by the unit suite (`keydown-action.test.js`,
  `sheet-accelerator.test.js`) — this apparatus has no way to switch the OS keyboard layout live,
  so it is not re-verified here.
- **Auto-repeat (a held `Ctrl+Tab`) cycling repeatedly** — the leg's Edge Cases ruling is
  intentional (no `isAutoRepeat` guard, matching Chrome), but `pressKey` issues discrete presses;
  a held-key repeat is a HAT-scoped manual check, not automatable over this apparatus.
- **Keyboard cycle mid-pointer-drag** — the leg's Edge Cases ruling (the drag continues on its
  captured tab; only the active tab changes) is a single live spot-check per the leg, not an
  automated step here — `dragPointer` is one atomic call with no way to interleave a `pressKey`
  mid-gesture (same apparatus limit `tab-reorder.md` documents for cancel-restore).
- **Lightbox-open cycling** — pinned at the unit level (`keydownToAction`'s NOT-lightbox-gated
  mapping); not re-verified live here.
- **macOS parity** — carried to the mission's later HAT flight, per the existing convention
  (`chrome-guest-keyboard-nav.md`).

## Variants (optional)

- N/A for the initial authoring. A future variant could re-run Steps 6/8 at a pathological tab
  count (9+, forcing `tab-jump-last` to diverge from every reachable digit) to characterize the
  digit/last distinction more sharply.
