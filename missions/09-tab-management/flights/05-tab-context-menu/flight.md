# Flight: Tab Context Menu

**Status**: completed
**Mission**: [First-Class Tab Management](../../mission.md)

## Contributing to Criteria

- [ ] Right-click (and the keyboard context-menu path) on a tab opens a
      tab-scoped menu — close, close others, close to the right, duplicate,
      move to new window, reopen closed tab — rendered from the same
      menu-overlay sheet as every other chrome menu, with its keyboard
      contract intact; middle-click on a tab closes it. *(middle-click
      landed F1; "move to new window" is deferred to the multi-window
      flights per the mission flight list — the criterion completes there;
      behavior-test-backed — new `tab-context-menu` spec)*
- [x] Completes the reopen criterion's **menu half** (SC5 — F4's DD3
      deferral). *(Witnessed: `tab-context-menu` steps 8–9 — menu reopen
      incl. the mid-strip positional case and the empty-stack omission.)*

---

## Pre-Flight

### Objective

Give every tab a context menu, rendered from the menu-overlay sheet like
all chrome menus: right-click (or the Context-Menu key / Shift+F10 on a
focused tab) opens Close / Close other tabs / Close tabs to the right /
Duplicate / Reopen closed tab, anchored at the tab. Reopen reuses Flight
4's dispatch chain verbatim and is omitted when the stack is empty.
Duplicate copies address + jar + navigation history (nearly free via the
F4 restore seam). "Move to new window" is deliberately absent until the
multi-window flight adds it to this same model.

### Open Questions

- [x] Duplicate semantics? → **Address + jar + nav history** (mission open
      question resolved): a new `tab-history-snapshot` invoke returns the
      LIVE tab's `getAllEntries()`/`getActiveIndex()`, and duplicate calls
      the existing `createTab(url, sameJar, {restoreHistory, insertAt:
      sourceIndex+1})` — Chrome parity (duplicates carry history, land
      beside the source).
- [x] Do close-others / close-right captures hit the closed-tab stack? →
      **Yes, deliberately** (each is a real close through the capturing
      path; Chrome behaves the same — reopen restores them LIFO one at a
      time). Note in the spec.
- [x] Disabled-item rendering for empty-stack reopen? → **Omitted-only
      (design review verified: renderMenu has NO disabled-interactive-item
      shape — only item/separator/note)**. The model omits `tab:reopen-
      closed` at `stackSize === 0`; a `closedTabStackSize()` bridge (tiny
      invoke over the existing `closedTabStack.size()`) feeds the model.
- [x] Duplicate at a single tab? → Available (Chrome parity) — deliberate;
      only close-others/close-right have count/position omission rules.
- [x] F4 debrief's hand-mirror timing question → **does not apply this
      flight** (design review traced it): the classifier pair is untouched
      — Context-Menu key lives in its own bespoke handler and
      `reopen-closed-tab` already exists in both files from F4. The
      BACKLOG item proceeds on its own maintenance track.
- [x] Keyboard invocation path? → Context-Menu key / Shift+F10 while a tab
      is focused in the strip (the toolbar-Unpin double-fire lesson
      applies: a focused tab + Context-Menu key fires BOTH contextmenu and
      keydown — dedupe like the pin buttons do). Escape-only focus return
      to the invoking tab (captured returnFocus), matching page-context.

### Design Decisions

**DD1 — Pure model module: `src/shared/tab-context-model.js`**
(`tabContextModel({tabId, isLastTab, tabsToRight, stackSize})` → typed
item array), ids namespaced `tab:*` (`tab:close`, `tab:close-others`,
`tab:close-right`, `tab:duplicate`, `tab:reopen-closed`) per the
page-context-model vocabulary. Rules: `close-others` omitted when the tab
is the only tab; `close-right` omitted when none to its right;
`reopen-closed` omitted when `stackSize === 0` (omitted-only — the sheet
has no disabled-item shape). Unit-tested offline.

**DD2 — Trigger + sheet wiring on the established page-context pattern.**
`contextmenu` on tab buttons (chrome DOM; preventDefault) + the
Context-Menu-key/Shift+F10 keyboard path for a focused tab →
`openOverlayMenu('tab-context', model, anchor, …)` with the standard
channel 1–7 protocol; the chrome's channel-6 dispatch validates every id
and acts on the TAB ID captured at open (TOCTOU — vanished tab → no-op).
Design-review rulings folded in verbatim:
- **Batch closes are ORDERED SWEEPS** (the onJarWiped/refreshOpenTabJars
  idiom — this codebase's twice-fixed activation-flicker class):
  `tab:close-others`/`tab:close-right` snapshot the targets, activate the
  ANCHOR tab FIRST if the active tab is among the targets (ruling: the
  anchor becomes active — Chrome parity), then closeTab each (each
  captures to the stack — deliberate; Chrome does the same). Never let
  closeTab's own next-tab fallback cascade mid-sweep.
- **Keyboard target = `document.activeElement?.closest('.tab')?.dataset.id`**
  (the strip keydown handler's own idiom) — NEVER `activeTab()`; focused
  and active tabs diverge after keyboard reorder.
- **The Context-Menu-key integration point is the EXISTING catch-all**
  (renderer.js ~842-860): extend its exclusion gate with
  `target.closest('.tab')` so a focused tab opens the TAB menu, not a
  doubled generic Inspect menu — do not add a parallel keydown listener.
- **Chrome-side registration is named work**: an `overlayMenus['tab-context']`
  entry (page-context shape: `ariaTarget: () => null`, escape-only refocus
  via a captured returnFocus) + a module-scoped `tabCtx` capture object
  ({tabId, returnFocus}) parallel to `pageCtx`; plus the sheet's
  `MENU_LABELS['tab-context']` entry (without it the sheet's aria-label
  falls back to the raw menuType string — a real a11y nit). The generic
  'menu' template needs NO registration (TEMPLATES fallback).
- Other actions: `tab:close` → the existing closeTab path (captures);
  `tab:duplicate` → the history-snapshot invoke + createTab with
  restoreHistory + `insertAt: sourceIndex+1` (title seeded from the
  renderer's own `tab.title` — no round-trip); `tab:reopen-closed` → **the
  existing `dispatchChromeAction('reopen-closed-tab')` case** (dispatch
  reuse — the embedded decisions ride along free).
Escape-only refocus to the invoking tab (captured returnFocus), no
aria-expanded (transient trigger — page-context parity). Middle-click
close is already live (F1) — untouched.

**DD3 — Two tiny main-side invokes, chrome-trust-domain:**
`tab-history-snapshot` (wcId → `{entries, index}` from the live
webContents; web tabs only — internal/dead → null) and
`closed-tab-stack-size` (→ number). Bare `ipcMain.handle` (chrome bridge
pattern), + preload bridges + d.ts entries per the declare rule. No new
privileged surface (both return data the chrome already receives through
other flows).

**DD4 — Verification: new `tab-context-menu` behavior spec** — open via
right-click (rect-derived coordinate click with `button:'right'` — verify
the click tool forwards right-button and that the chrome contextmenu
handler fires from trusted right-click; a spike-level check at leg start)
AND via Context-Menu key on a focused tab; items present/omitted per model
rules (axtree on the sheet); close/close-others/close-right act correctly
(counts + survivors verified); duplicate yields a same-jar same-URL tab
beside the source WITH history (goBack works — the F4 fidelity check
reused); reopen-closed from the menu restores the last close (and the
item is absent/disabled at empty stack); Escape returns focus to the
invoking tab; a mid-strip reopen row (the F4 spec-polish rider: close a
mid-strip tab, reopen via the MENU, verify position among neighbors —
kills two birds). Doc grep-AC (F4 debrief rule, first application): the
leg adding the menu carries `grep` ACs for README (context-menu row) and
CLAUDE.md (menu note).

### Prerequisites

- [x] Flights 1–4 landed (stacks on flight/4).
- [x] page-context-model + sheet channel protocol current (CLAUDE.md
      sections read; the sheet hosts multi-template menus).
- [x] F4's tabReopen dispatch case + restoreHistory/insertAt seams live.
- [x] Right-click delivery premise (design review + leg-start check): the
      `click` tool's `button:'right'` fires the chrome's contextmenu
      handler (guest right-click goes through main's context-menu event —
      but the STRIP is chrome DOM, so the DOM contextmenu event is the
      path; sendInputEvent right-click should synthesize it — cheap check).

### Pre-Flight Checklist

- [x] All open questions resolved (disabled-vs-omitted verified at review)
- [x] Design decisions documented
- [x] Prerequisites verified (one cheap premise check delegated)
- [x] Validation approach defined
- [x] Legs defined

---

## In-Flight

### Technical Approach

Model module + unit net first; then trigger/sheet/dispatch wiring + the
two invokes; then the spec + verify leg. Chrome renderer + two bare
handlers; no session/guest changes. renderer.js growth expected ~60–80
lines (watch item stands; the F6 module-split decision is next flight).

### Checkpoints

- [x] Model unit suite green (omission rules).
- [x] Menu opens live from both trigger paths; all actions correct.
      *(pointer path live-verified + Witnessed; the literal
      ContextMenu/F10 keypress is a KEY_MAP apparatus gap — structurally
      verified, HAT-scoped.)*
- [x] `tab-context-menu` spec passes; a11y sweep green — **the audit's
      SHEET_STATES gains a `tab-context` entry + an
      `openTabContextMenuForAudit()` hook** (mirrors
      openPageContextMenuForAudit; representative tab with items-to-right
      and non-empty stack so all five items render). FD RULING: this hook
      is an approved addition to the renderer's closed-set globalThis seam
      (a11y-audit consumer group). Suites green.

### Adaptation Criteria

**Divert if**: trusted right-click cannot reach the chrome contextmenu
handler (apparatus AND product path both fail) → keyboard-only automated
coverage + HAT for pointer path; new DD.

**Acceptable variations**: item order/copy; disabled vs omitted for the
empty-stack reopen (per the sheet template's actual capability); whether
duplicate focuses the new tab (default: yes, it's an activation — Chrome
parity).

### Legs

> Tentative; planned one at a time.

- [x] `menu-model-and-wiring` — model + unit net, triggers (pointer +
      keyboard incl. double-fire dedupe), sheet template registration,
      channel-6 dispatch, the two invokes, doc grep-ACs.
- [x] `verify-integration` — right-click premise check, `tab-context-menu`
      spec authored + run (PASS 10/10 first run), a11y (sheet-state list
      check), suites.

---

## Post-Flight

### Completion Checklist

- [x] All legs completed
- [ ] Code merged (PR opened, stacks on flight/4 — operator merges)
- [x] Tests passing (1646/1646; lint + typecheck + a11y green)
- [x] Documentation updated (README context-menu note; CLAUDE.md menu
      hosted-surfaces list + tab-strip section; review fix cycle also
      refreshed the seam count, sheet-state enumeration, escape-only
      phrasing, and docs/renderer-menu.md consumer list)

### Verification

- New `tests/behavior/tab-context-menu.md` passes (incl. the mid-strip
  menu-reopen row).
- `npm run a11y` green (with the sheet-state question resolved); suites
  green.
