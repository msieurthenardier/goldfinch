# Flight: Closed-Tab Stack and Reopen

**Status**: landed
**Mission**: [First-Class Tab Management](../../mission.md)

## Contributing to Criteria

- [x] (keyboard half) A recently closed tab can be reopened (keyboard and menu), restoring
      its address, its cookie-jar assignment, and — where the platform
      supports it — its back/forward history; the reopen stack is bounded
      and survives nothing it shouldn't (burner tabs are never captured, so
      a burner can never be resurrected). *(behavior-test-backed — new
      `closed-tab-reopen` spec)*
- Partial groundwork for the session-restore criterion (the persistence
  layer is designed to be shared; restore itself is Flight 9).

---

## Pre-Flight

### Objective

Give Goldfinch a bounded closed-tab stack and `Ctrl+Shift+T` reopen — the
binding deliberately reserved since M05 finally lands. Closing a
persist-jar-backed tab captures `{url, title, jar id, navigation history}`
onto a bounded main-process stack; `Ctrl+Shift+T` (all three capture
points) pops the most recent entry and reopens it in its original jar with
its back/forward history restored via `navigationHistory.restore()`.
Burner and internal tabs are structurally never captured (positive
persist-jar allowlist — the history-recorder idiom). The stack is
in-memory this flight, with its record shape designed for the
session-restore flight to persist later.

### Open Questions

- [x] In-memory or persisted? → **In-memory this flight.** Rationale:
      "reopen recently closed" is a within-session affordance in every
      mainstream browser's core loop; cross-restart resurrection is the
      session-restore flight's territory (mission criterion groups it
      there), and persisting nav-history blobs to disk raises
      privacy-surface questions (pageState opacity) better decided
      alongside restore's setting gate. The record shape + a
      `serializeEntry()` seam are designed now so Flight 9 persists
      without rework. (Mission Open Question resolved: stack depth N=25,
      Chrome-parity ballpark, constant memory.)
- [x] Jar deleted between close and reopen? → Reopen falls back to the
      default jar with the address preserved (never resurrect a dead jar id;
      never silently drop the reopen). Announced via the existing
      `#tab-status` region.
- [x] Is reopen guest-forwardable / internal-forwardable? → **Yes, both**
      (same navigation-neutral class as tab cycling; an internal page must
      not trap the operator away from reopen). NOT repeat-safe (single-shot
      semantics — holding the chord must not machine-gun the stack; the
      existing auto-repeat guard applies, i.e. `isRepeatSafeAction` stays
      false for it — its `tab-*` prefix doesn't match `reopen-closed-tab`,
      no change needed).
- [x] Does the action fit `dispatchChromeAction`? → Yes, with a
      renderer-orchestrated two-invoke chain (design-review CORRECTION of
      the draft's main-constructs-renderer-adopts shape, which has no
      analog in this codebase — all tab construction is renderer-initiated;
      even popups route back through the renderer's `createTab`). DD2
      defines the corrected wiring.
- [x] Where does a reopened tab land in the strip? → Its ORIGINAL visual
      position (Chrome parity; ruling at design review): `tabClose` gains an
      optional `stripIndex`, the entry stores it, and `createTab` gains an
      optional `insertAt` honored via `commitTabMove` (F2 machinery).
- [ ] `navigationHistory.restore()` live fidelity — **pre-leg-1 spike**
      (the F2/F3 debrief rule): round-trip `getAllEntries()` → in-memory
      hold → `restore()` on a fresh `WebContentsView`, confirm back/forward
      work and `pageState` survives. Divert path: reopen restores
      URL+jar only (the mission criterion's "where the platform supports
      it" clause).

### Design Decisions

**DD1 — The stack is a pure, main-process-owned module:
`src/shared/closed-tab-stack.js`** (ESM, unit-tested): `push(entry)`,
`pop()`, `peek()`, `size()`, bounded at `MAX_ENTRIES = 25` (oldest evicted),
entries `{url, title, jarId, navEntries, navIndex, closedAt}`. Pure data
structure — no Electron; main.js owns the singleton instance and the
capture/reopen wiring. A `toJSON()`/`fromJSON()` seam (designed, unused
this flight) is the Flight-9 persistence hook.
- Rationale: pure module = offline unit net (the house pattern);
  main-process ownership because capture happens at `tab-close` (main
  already has the `webContents` for `getAllEntries()`) and reopen
  constructs views (main-only).
- Trade-off: in-memory only this flight (see Open Questions).

**DD2 — Capture at main `tab-close`; reopen is RENDERER-ORCHESTRATED
(design-review correction: the draft's "main re-creates, renderer adopts"
wiring does not exist — ALL tab construction is renderer-initiated via
`createTab` → `tab-create` invoke; even popups route back through the
renderer's `createTab`).**

*Capture*: the existing `ipcMain.on('tab-close')` handler captures BEFORE
`destroy()` (and before `tabViews.delete`) — resolve the tab's partition
against `jars.list()` (the history-recorder positive-allowlist idiom;
burner/internal partitions structurally match nothing), then
`navigationHistory.getAllEntries()` + `getActiveIndex()` + title + url →
`push`. Wrapped in try/catch (capture must never break close). The
renderer's `tabClose(wcId)` call gains an optional `stripIndex` arg
(additive) — the tab's visual position from `orderedTabIds()` at close
time — stored on the entry for positional reopen (ruling: Chrome restores
a reopened tab at its ORIGINAL strip position, and `commitTabMove` makes
that cheap).

*Reopen chain* (two invokes, deliberately — `tab-create` keeps its shape
and gains ONE optional field):
1. `keydownToAction` gains `Ctrl+Shift+T` → `reopen-closed-tab` — RETIRING
   the reservation. Lockstep, called out preemptively: (a)
   `keydown-action.test.js` null-pin flips to the action; (b)
   `guest-forward-allowlist.test.js`'s pins INVERT (the existing test
   asserts both kinds NOT-forwardable — both flip to true, and
   `reopen-closed-tab` joins BOTH `WEB_CHROME_ACTIONS` and
   `INTERNAL_CHROME_ACTIONS`); (c) `sheet-accelerator.js` has NO dedicated
   pin — `'T'` sits in the shifted-chords negative loop
   (sheet-accelerator.test.js:86-91): pull `'T'` out of the loop, add a
   dedicated `Ctrl+Shift+T → {scope:'chrome', action:'reopen-closed-tab'}`
   test, and place the mapper branch BEFORE the unshifted `t`/new-tab match
   (the Ctrl+Shift+I/P shift-disambiguation-first pattern).
   `isRepeatSafeAction('reopen-closed-tab')` stays false by prefix (pin it).
2. `dispatchChromeAction` case calls a new `window.goldfinch.tabReopen()`
   bridge (invoke; + `renderer-globals.d.ts` entry per the preload-bridge
   declare rule). Main's `ipcMain.handle('tab-reopen')` pops the stack and
   returns `{url, title, partition?, stripIndex, navEntries, navIndex,
   jarFallback}` or `null` (empty stack → renderer no-ops silently).
   `partition` is the entry's original jar's partition IF that jar still
   exists (resolved main-side against `jars.list()`); otherwise omitted and
   `jarFallback: true` (explicit flag — ruling — so the renderer knows to
   announce). Main re-validates `isSafeTabUrl(entry.url)` before returning
   (defense-in-depth, two-point-boundary parity — ruling).
3. The renderer resolves the container exactly like popups do:
   `inheritFromPartition(partition, containers)` → `createTab(url,
   container, { trusted: false, restoreHistory: {entries, index},
   insertAt: stripIndex })` — the existing fallback chain (`container ||
   resolveNewTabContainer(...) || makeBurner()`) handles the jar-fallback
   case with zero new resolution code (and never touches the partition-less
   BURNER sentinel). On `jarFallback`, announce via `#tab-status`.
   `createTab` gains the two optional fields: `insertAt` → after append,
   `commitTabMove(id, clamp(insertAt))`; `restoreHistory` rides the
   `tab-create` payload.
4. `tab-create` (main) branches at its tail — design-review race fix: when
   the payload carries `restoreHistory`, SKIP `loadURL(url)` entirely and
   call `navigationHistory.restore({entries, index})` instead
   (`restore()` triggers its own load; two competing navigations otherwise).
   Pass `index` explicitly — omitting it loads the newest entry, silently
   wrong for a tab that had navigated back. Use the captured title as the
   initial strip title (no "New tab" flash).

- Security: the stack holds persist-jar URLs/titles/nav entries in
  main-process memory only; `tab-reopen` returns them only to the chrome
  (same trust domain as every `window.goldfinch` bridge); URL re-validated;
  nothing reaches web content beyond a normal tab construction.
- Window-close capture is out of scope (single window; multi-window
  flights revisit).

**DD3 — Menu affordance deferred to the context-menu flight.** The mission
criterion says "keyboard and menu"; the tab context menu (Flight 5) owns
the "Reopen closed tab" menu item and will reuse the same IPC. This flight
lands the keyboard path + the stack; the criterion stays open until F5
completes the menu half. (Recorded so the criterion isn't prematurely
checked.)

**DD4 — Verification: new `closed-tab-reopen` behavior spec** — close a
jar tab (✕/Delete), Ctrl+Shift+T reopens it: same URL, same jar (probe via
`enumerateTabs` jarId), back/forward restored (navigate the tab twice
before closing; after reopen, goBack lands on the prior page — the
LIVE-fidelity check); stack order (close A then B; reopen yields B then A);
bound behavior (unit-tested, spec spot-checks the no-op on empty stack with
a delivery positive control); burner exclusion (close a burner tab;
Ctrl+Shift+T does NOT resurrect it — reopens the most recent PERSIST entry
or no-ops, and the burner's URL appears nowhere); internal exclusion
(close a settings tab; not captured); jar-deleted fallback (delete the jar
between close and reopen → reopens in default jar, announcement present).
Apparatus: existing tools only (act: pressKey/click/openTab/closeTab +
kebab route for settings; observe: enumerateTabs jarId+url, evaluate,
readAxTree, goBack via the automation nav op for the history check — both
axes audited; nav ops exist: goBack/goForward are on the 29-tool surface).
- Unit net: `closed-tab-stack.test.js` (bound/evict/order/peek/empty,
  toJSON/fromJSON round-trip); classifier/allowlist/sheet pins flip for the
  retired reservation; `isRepeatSafeAction('reopen-closed-tab')` pinned
  false.

### Prerequisites

- [x] Flights 1–3 landed (branch stacks on flight/3).
- [x] `navigationHistory` API surface confirmed present (mission-design
      Architect probe); LIVE fidelity is the pre-leg-1 spike (gate).
- [x] Persistence/burner idioms located: `downloads-store.js` (discipline
      exemplar — not needed this flight but the toJSON seam mirrors it),
      `history-recorder.js` positive allowlist (the burner-exclusion
      reference).
- [x] Behavior apparatus unchanged; goBack/goForward ops available for the
      history-fidelity check.

### Pre-Flight Checklist

- [x] All open questions resolved (spike is the one gate, scheduled first)
- [x] Design decisions documented
- [x] Prerequisites verified
- [x] Validation approach defined
- [x] Legs defined

---

## In-Flight

### Technical Approach

Spike first (gate). Then pure module + unit net; then capture wiring in
main's `tab-close`; then the reopen chain (classifier → dispatch → `tab-reopen` invoke → main
pops/returns the entry → renderer `createTab` with restoreHistory/insertAt →
main restores in `tab-create`) with the reservation retired
in lockstep across both classifier files and all pin sites; then the spec +
verify leg. Main-process footprint: the capture block, the `tab-reopen`
IPC, and the stack singleton — no session changes, no new privileged
surface.

### Checkpoints

- [x] Spike verdict recorded (restore fidelity live) — PASS, no divert.
- [x] Stack unit suite green; reservation pins flipped everywhere in one
      change.
- [x] Reopen works live from all three capture points; jar fallback works.
- [x] `closed-tab-reopen` spec passes (9/9); a11y + suites green. (Formal
      Witnessed run + a11y sweep is `verify-integration`'s scope — Leg 2's
      live-check exercised every spec row informally and all passed; the
      spec itself stays `draft`/`Last Run: never` until that leg runs it.)

### Adaptation Criteria

**Divert if**:
- Spike shows `restore()` unusable on fresh views (crash, blank, broken
  back/forward) → reopen restores URL+jar only; DD2 narrows; the criterion's
  platform clause absorbs it. Record as a flight-log decision.

**Acceptable variations**:
- Stack depth (25 default; any bound 10–50 with rationale).
- Whether reopen focuses the address bar or the page (default: match
  new-tab behavior).
- Announcement copy.

### Legs

> Tentative; planned one at a time.

- [x] `restore-spike-and-stack` — the spike (gate), `closed-tab-stack.js` +
      unit net, capture wiring with the positive allowlist. **Landed.**
- [x] `reopen-chain` — classifier/allowlist/sheet lockstep (+ reservation
      retirement), dispatch case, `tab-reopen` IPC, main re-create+restore,
      jar fallback + announcement, `closed-tab-reopen` spec authored,
      BACKLOG entries from the F3 debrief added (hand-mirror unification,
      KEY_MAP PgDn/PgUp, isRepeatSafeAction scope note). **Landed.**
- [x] `verify-integration` — run the spec; a11y; suites; fix loop.

---

## Post-Flight

### Completion Checklist

- [x] All legs completed
- [ ] Code merged (PR — stacks on flight/3)
- [x] Tests passing
- [x] Documentation updated (CLAUDE.md keyboard map + a closed-tab-stack
      note; README shortcut row; docs/mcp-automation.md untouched — no new
      ops)

### Verification

- New `tests/behavior/closed-tab-reopen.md` passes.
- `npm run a11y` green; suites green.
- Reservation retirement complete: no `Ctrl+Shift+T`-reserved comments or
  null-pins remain (grep-AC).
