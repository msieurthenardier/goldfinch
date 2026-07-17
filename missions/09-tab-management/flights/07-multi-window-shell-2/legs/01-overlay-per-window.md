# Leg: overlay-per-window

**Status**: completed
**Flight**: [Multi-Window Shell, Part 2](../flight.md)

## Objective

Extract the find-overlay cluster into an Electron-free `createFindOverlayManager(deps)` factory, instantiate it and the existing sheet manager **once per window** into the registry record's `findOverlay`/`sheet` slots, delete the DD7 roaming machinery (the `getAttachedWindow() === X` conditioning, the cross-window attachment resolves, the shared `lastGuestBounds` slot), relocate overlay **destruction** from `before-quit` to per-window `close`, and land the DD8 destroyed-window tripwire (`onWindowClosed` wrapper + ESLint rule + source-scan test) — with **no intended single-window behavior change**.

## Context

### The decisions this leg executes

- **DD5** — Per-window overlay instances; the roaming machinery is DELETED; overlay destruction moves to per-window `close`.
- **DD8** — Destroyed-window tripwire: land the wrapper AND the lint AND a source-scan test.

Everything else in F7 (DD1/DD2/DD3/DD4/DD6/DD7/DD9) belongs to legs 2–4. **Do not** add timeout guards to `capturePage` (DD7 → leg 2), **do not** touch `enumerateTabs`/`getChromeTarget`/`captureWindow` semantics (DD1/DD3 → leg 3), **do not** rewrite specs (leg 4).

### Why this is a wiring change plus one extraction (S8)

The two "roaming singletons" are wildly asymmetric (flight-log S8):

- **The sheet** is *already* `createMenuOverlayManager(deps)` with **zero module-scope state** — every var is per-instance closure state (`src/main/menu-overlay-manager.js:105-117`). Instantiating it N times is pure wiring in `main.js`.
- **The find overlay** is 8 raw module vars + 8 functions across `src/main/main.js:291-514` (~224 lines), ~30 call sites, **no module at all**. It must be extracted first, and `menu-overlay-manager.js` is the line-for-line template (CLAUDE.md's Overlay-view pattern 4: Electron-free, injected-deps).

### Why destruction must move (DD5, review pass-1 H1)

F6 *deliberately* destroys the roaming singletons at `before-quit` (`src/main/main.js:3421-3431`) because per-window `close` only **detaches** (`:1183`, `:1187`). Under per-window instances that leaks **two `WebContentsView`s per closed window for the app's lifetime** — the exact leak class F6 fixed for the chrome wc (`:1206-1221`) — and a registry-iterating quit hook **cannot reach them**, because `registry.remove(winId)` already ran at `closed` (`:1209`).

Rulings already made (do not re-litigate — DD5 records the evidence):

- `close` is the hook; `closed` **cannot** work (`win.contentView` is needed to detach, and destroyed-window access throws).
- `before-quit` retains **NO** overlay role. `app.quit()` closes every window, so every window gets `close`. Leaving a registry-iterating teardown in `before-quit` would run *first* and double-destroy.
- The **F8 DD5 find-before-sheet ordering pin travels** (`:3424-3428`) and appends naturally — `close` already runs find-session-close → `hideFindOverlay` → `closeMenuOverlay('teardown')` in that order (`:1180-1187`).
- `win.destroy()` has **no call sites in the repo**, so `:1162`'s "destroy fires no close" caveat has no live caller.
- A sheet-originated quit does **not** destroy the sheet inside its own dispatch — "Exit" routes sheet → main (`:726`) → chrome (`:741`) → `appQuit()` (`:2400`); the chrome is always the sender.
- Residual accepted: `close` is cancellable, so a future `preventDefault` would leave a live window with dead overlays. F6 already accepted this shape for guests (`:1195`).

### Learnings from the flight log that shape this leg

- **S9** — `lastGuestBounds` (`main.js:309`) is any-window-polluted at the **write** (`:2812`, `:2861`, both unconditional). DD7 fixed only the read (`:419-422`). The **concept survives as per-instance state** — `menu-overlay-manager.js:109` already does exactly this. Only the *sharing* dies.
- **S6** — the `onWindowClosed` wrapper's retrofit surface is **one already-correct site** (`main.js:1206-1221`, which already uses the captured `winId` at `:1209`). Its value is **prospective**, not a bug fix. Verified again at leg design: `grep "\.on('closed'" src/` → exactly 1 hit.
- **S5** — the F6 debrief's ESLint selector is **wrong as written**; the recon's empirically-verified corrected form (14-case fixture, `Linter.verify`) is in the flight log's ESLint paragraph. **The `>` child combinator is load-bearing.** Use the recorded selector **verbatim**.
- **DD8's withdrawn claim** — an earlier draft justified DD8 by DD5's relocation. That is **false**: `close` is pre-teardown (the window is alive) and `onWindowClosed` wraps `closed`. The two halves of this leg are independent; do not couple them.

### `multi-window-shell` is a PLANNED RED from this leg

**`multi-window-shell` is explicitly OUT of this leg's invariant set.** DD5 falsifies it *here*, at leg 1:

- its Preconditions pin the roaming singleton — `tests/behavior/multi-window-shell.md:80-86` ("ONE sheet serves every window");
- its step 4 asserts "**zero per-window overlay instances**" — `tests/behavior/multi-window-shell.md:124`.

Both become false the moment this leg lands. **Do not run it as a gate, do not "fix" it, do not treat its failure as a regression.** It is rewritten once, in leg 4, when DD1+DD2+DD5 are all landed. This leg's only obligation is to **record it in the flight log as a planned red** (AC13).

## Inputs

What must be true before this leg runs:

- Branch `flight/7-multi-window-2`, clean, at `b607411` (or later on the same branch).
- `src/main/menu-overlay-manager.js` (347 lines) — `createMenuOverlayManager(deps)`, zero module-scope state.
- `test/unit/menu-overlay-manager.test.js` (780 lines) — the unit-net template.
- `test/unit/broadcast-invariant.test.js` (285 lines) — the source-scan house pattern (`maskComments` + `findMatchingBracket` + registration-site extraction + marker check).
- `src/main/window-registry.js` — record created at `:61-75`, shape `{win, chromeView, tabViews, activeTabWcId, noBootTab, bootConfigServed, pendingChromeSends}` (`:63-71`). **No `findOverlay`/`sheet` slots** (F6 designed them at F6 `flight.md:142-144`, never landed).
- `src/main/main.js` — 3461 lines; find cluster `:291-514`; sheet construction + IPC `:516-757`; `grabWindow` `:798-939`; `createWindow` `:1069-1264`; quit hooks `:3421-3439`.
- `src/main/find-overlay-geometry.js` — `computeFindOverlayBounds` (pure, 50 lines). **Unchanged by this leg.**
- `eslint.config.mjs` — 99 lines, flat, 8 blocks, **no `no-restricted-syntax`**.
- Test baseline: **1715/1715, 13 suites**. `npm test` = `node --test test/unit/*.test.js`.

## Outputs

- **New**: `src/main/find-overlay-manager.js` — `createFindOverlayManager(deps)`, Electron-free.
- **New**: `test/unit/find-overlay-manager.test.js` — the unit net.
- **New**: `test/unit/window-closed-invariant.test.js` — the DD8 source-scan tripwire.
- **Modified**: `src/main/main.js` — find cluster removed; both managers instantiated per window; ~30 find call sites + 9 sheet conditioning sites rewired; destruction relocated to `close`; `onWindowClosed` landed; `before-quit` loses its overlay role.
- **Modified**: `src/main/window-registry.js` — record gains `findOverlay`/`sheet` slots (+ typedef).
- **Modified**: `eslint.config.mjs` — `no-restricted-syntax` rule.
- **Unchanged (pinned)**: `src/main/menu-overlay-manager.js`, `test/unit/menu-overlay-manager.test.js`, `src/main/find-overlay-geometry.js`.

## Acceptance Criteria

### The extraction

- [x] **AC1** — `src/main/find-overlay-manager.js` exists and exports `createFindOverlayManager(deps)`. It is **Electron-free**: `grep -c "require('electron')" src/main/find-overlay-manager.js` → `0`. It mirrors the `menu-overlay-manager.js` shape: lazy singleton, destroyed-recreate guard, `render-process-gone` self-teardown, at-most-one pending-init queue (latest wins), `syncBounds` store-always/apply-while-visible, `isVisible()`.
- [x] **AC2** — main.js's find cluster is gone. `grep -nE '^let (overlayView|overlayVisible|findOverlayAttachedWin|lastGuestBounds|findOverlayTabWcId|findOverlayLastQueryText|overlayReady|pendingOverlayInit)' src/main/main.js` → **0 hits** (all eight module vars from the flight log's Overlay census).
- [x] **AC3** — `grep -n 'findOverlayAttachedWin\|lastGuestBounds' src/main/main.js` → **0 hits**. The shared module slot is deleted; the concept survives as per-instance state inside `find-overlay-manager.js` (mirroring `menu-overlay-manager.js:109`).

### Per-window instantiation

- [x] **AC4** — `src/main/window-registry.js`'s `create()` seeds `findOverlay: null` and `sheet: null` on the record, and the `WindowRecord` typedef carries both slots. `test/unit/window-registry.test.js` passes **unmodified** (its shape test asserts field-by-field, not exact-key equality — verified at leg design).
- [x] **AC5** — `createWindow` (`src/main/main.js:createWindow`) constructs **both** managers per window and assigns them to `record.findOverlay` / `record.sheet` immediately after `registry.create(...)`. Each manager's deps close over **that window's** record/handles — never `registry.getLastFocused()`.
- [x] **AC6** — `grep -c 'getAttachedWindow' src/main/main.js` → **0**. All nine DD7 sites from the flight-log census are gone: `:558`, `:735`, `:893`, `:1187`, `:1235`, `:2574`, `:2743`, `:2821`, `:2868`.
- [x] **AC7** — `grep -n 'const menuOverlay = createMenuOverlayManager' src/main/main.js` → **0 hits** (no module-scope sheet singleton survives).

### Destruction relocation

- [x] **AC8** — Per-window `close` is the **sole** overlay-destruction site. In the `close` handler (`src/main/main.js` — `win.on('close', ...)`):
  - destruction sits **ABOVE** the `if (!rec) return` early-return (`:1155-1156`) and does **not** reach the managers through `registry.get(...)` — it uses the `createWindow` closure refs (the class-1b create-closure pattern `sendToOwnChrome` at `:1145-1148` already establishes);
  - the ordering is **find before sheet** (the F8 DD5 pin, traveling from `:3424-3428`);
  - both managers' `teardown()` run — the views are destroyed, not merely detached.
- [x] **AC8b** — **The record path fails safe across the `close`→`closed` gap.** Immediately after the teardown calls, the `close` handler nulls both record slots (`rec.findOverlay = null; rec.sheet = null;`), so a torn-down manager is never reachable through `registry.get(...)` in the window's dying interval. Every owner-resolved call site is **null-tolerant** — `grep -n 'rec\.sheet\.\|rec\.findOverlay\.\|owner\.sheet\.\|owner\.findOverlay\.\|grabRec\.sheet\.\|grabRec\.findOverlay\.' src/main/main.js` → every hit uses `?.` or sits behind an explicit null check. This is what keeps the two access paths from diverging: **the closure path tears down, the record path is nulled in the same breath.** See Edge Cases → "The `close`→`closed` gap".
- [x] **AC9** — `app.on('before-quit', ...)` (`src/main/main.js:3421-3439`) contains **no overlay role**: `grep -A20 "app.on('before-quit'" src/main/main.js | grep -c 'teardownFindOverlayView\|menuOverlay\|findOverlay\|\.sheet\.'` → **0**. `downloadsManager?.flushInterrupted()` and `mcpServer?.stop()` survive untouched.

### DD8 tripwire

- [x] **AC10** — `onWindowClosed(win, handler)` exists, captures the window's id at **registration** time, and passes only captured primitives to `handler`. The one existing `closed`-class registration (`src/main/main.js:1206` — `win.on('closed', () => {`) is converted to use it.
- [x] **AC11** — `eslint.config.mjs` carries a `no-restricted-syntax` rule using the flight log's empirically-verified selector **verbatim** (the `>` child combinator is load-bearing — see S5). `npm run lint` exits **0** on the converted tree.
- [x] **AC12** — A source-scan tripwire test exists (`test/unit/window-closed-invariant.test.js`) in the `broadcast-invariant.test.js` house pattern: it derives its inventory **from the source itself** (never a hand-kept list) and fails on a new violating site without anyone editing it.

  **DD8's mechanism question is RESOLVED at leg design — the answer is Tier 1 (registration-site exclusivity), and the implementer does not re-derive it.** The test asserts: *`src/main/**` contains ZERO raw `.on('closed'` / `.once('closed'` registrations outside `onWindowClosed`'s own definition.* Both other forms are **retired**:
  - the **positive** form ("every `.on('closed')` callback reads only captured primitives") needs scope resolution, which marker-matching cannot express — retired as infeasible, exactly as the flight's Open Question predicted;
  - the **negative** form (scan callback bodies for `win.`) is defeated by the same aliasing as the lint (`const w = win`, `helper(win)`, `rec.win`) — retired as strictly weaker than Tier 1.

  Tier 1 is stronger than both: banning the *registration shape* cannot be evaded by aliasing, and it forces the wrapper DD8 names "the primary net" rather than merely policing what a callback reads. It is also fully supported by the existing house toolkit and carries **no false-positive risk** — verified at leg design and confirmed by the leg design review: `mcp-server.js` uses Node's `'close'` throughout and **never** `'closed'` (the two conventions differ by exactly one character), and `grep -rn "\.on('closed'" src/` → **exactly 1 hit**, so post-conversion source passes with a **zero-entry allowlist**.

  The AC is met when the test:
  1. **fails** against a synthetic violating fixture (an inline string, in-test — not real source), and
  2. **passes** against current `src/` with zero allowlist entries, and
  3. its resolution is **recorded in the flight log** (AC15) — closing the flight's open question in Tier 1's favour.

  See Implementation Guidance step 9. **Do not** re-open the ladder; **do not** assert an unmeetable property.

### The invariant AC (the load-bearing one)

- [ ] **AC13** — **Single-window behavior is byte-identical.** The flight's enumerated invariant set passes **UNMODIFIED** — no spec file edited, no step relaxed:

  `menu-overlay` · `menu-dismissal` · `kebab-menu` · `internal-tab-menus` · `page-context-menu` · `tab-context-menu` · `find-overlay-geometry` · `tab-surface-geometry`

  **`multi-window-shell` is NOT in this set and is KNOWINGLY RED from this leg.** DD5 falsifies its "ONE sheet serves every window" precondition (`tests/behavior/multi-window-shell.md:80-86`) and its "zero per-window overlay instances" expected result (`:124`). Record it as a **planned red** (AC15); do not run it as a gate; do not fix it (leg 4 rewrites it).

- [x] **AC14** — `src/main/menu-overlay-manager.js` and `test/unit/menu-overlay-manager.test.js` are **byte-unchanged**: `git diff --stat b607411 -- src/main/menu-overlay-manager.js test/unit/menu-overlay-manager.test.js` → **empty**. (Grep-AC convention, CLAUDE.md:91.) The sheet half of DD5 is a *wiring* change in main.js only — see Edge Cases → "The sheet manager's attachment internals".

### Records and hygiene

- [x] **AC15** — The flight log carries a leg-1 **landing** entry.

  > **Already logged at design time — do NOT re-litigate or duplicate.** The log's existing `### Leg 1: overlay-per-window — designed (2026-07-15)` entry (written by the design review, append-only per house convention) already records: DD8's open question closed in Tier 1's favour; `multi-window-shell` as a planned red; the `close`→`closed` gap and its fix; the three census corrections. **Append a landing entry; do not edit that one.**

  The landing entry records only what landing can know:
  - (a) **main.js's line count at landing** (AC17) — the baseline is 3461;
  - (b) the **AC18 smoke's four probe counts** (baseline → +2 → +4 → back to +2);
  - (c) the **AC13 invariant-set result** — all 8 green and unmodified, with `multi-window-shell` confirmed **not run** (planned red, per the design entry);
  - (d) **DD8 Tier 1 as-built** — a one-line confirmation that the mechanism landed as designed, or a deviation entry if anything forced a change (the ladder is closed; a deviation here is a real finding, not a re-derivation);
  - (e) anything the conversion surfaced that the design missed — the honest place for it, given this flight's standing pattern of census errors.
- [x] **AC16** — `npm test` green with **≥ 1715** passing (the new suites add to the baseline; nothing regresses). `npm run typecheck` clean. `npm run lint` clean.
- [x] **AC17** — **main.js's line count at landing is RECORDED** (`wc -l src/main/main.js`). Baseline 3461. This is a **checkpoint, not a pass/fail gate** — the flight's net target of **≤ 3461** is judged at flight end, and **leg 1 alone is not judged against it** (leg 3 adds op wiring). If it misses, record the number and let the maintenance flight inherit it. F6's failure was having *no* number, not missing one.
- [x] **AC18** — **One real window close through the app's own path** is exercised and recorded (see Verification Steps → Live smoke). Mandatory per the F6 debrief's standing lesson: any leg touching a native `close`/`closed`-class event must exercise a real close in its own smoke checklist — not deferred. This leg relocates destruction *into* the close path.

## Verification Steps

### Offline

```bash
# AC1 — Electron-free
grep -c "require('electron')" src/main/find-overlay-manager.js          # → 0

# AC2/AC3 — the cluster and the shared slot are gone
grep -nE '^let (overlayView|overlayVisible|findOverlayAttachedWin|lastGuestBounds|findOverlayTabWcId|findOverlayLastQueryText|overlayReady|pendingOverlayInit)' src/main/main.js   # → no hits
grep -n 'findOverlayAttachedWin\|lastGuestBounds' src/main/main.js       # → no hits

# AC6/AC7 — the roaming machinery is gone
grep -c 'getAttachedWindow' src/main/main.js                             # → 0
grep -n 'const menuOverlay = createMenuOverlayManager' src/main/main.js  # → no hits

# AC9 — before-quit has no overlay role
sed -n '/app.on(.before-quit./,/^});/p' src/main/main.js                 # → inspect: no overlay calls

# AC10 — the wrapper is the only closed-class registration
grep -rn "\.on('closed'\|\.once('closed'" src/                           # → only inside onWindowClosed's definition

# AC14 — the sheet manager is byte-unchanged
git diff --stat b607411 -- src/main/menu-overlay-manager.js test/unit/menu-overlay-manager.test.js   # → empty

# AC16
npm test && npm run typecheck && npm run lint

# AC17
wc -l src/main/main.js                                                   # → RECORD the number
```

### AC8 — destruction ordering, by inspection

Read the `close` handler top-to-bottom and confirm, in order: (1) the closed-tab capture block, (2) **overlay destruction — find manager first, sheet manager second — ABOVE the `if (!rec) return`**, (3) the per-tab destroy loop. Confirm the destruction references the `createWindow` closure's manager variables, **not** `rec.findOverlay` / `rec.sheet` (which are unreachable on the `!rec` path — this is the whole point of the ruling).

### AC12 — the tripwire actually trips

- Run the new suite: it passes on current source.
- Confirm the in-test synthetic-violation case fails classification (the `broadcast-invariant.test.js:255-285` idiom — synthetic strings, never real source mutation).
- **Manual sanity (not committed)**: temporarily add a violating `closed` registration to `main.js`, re-run the suite, confirm it **fails**, then revert. Record the result in the flight log.

### AC11 — the lint rule fires correctly

- `npm run lint` → 0 on the converted tree.
- **Manual sanity (not committed)**: add `win.on('closed', () => console.log(win.id))` to `createWindow`, re-run `npm run lint`, confirm it **errors**, then revert. This proves the `>` child combinator survived transcription (S5's exact failure mode was a selector that fired on *every* registration, including correct ones).

### AC13 — the invariant set

Run each spec via `/behavior-test {slug}` and confirm green, **with no edit to any spec file**:

`menu-overlay` · `menu-dismissal` · `kebab-menu` · `internal-tab-menus` · `page-context-menu` · `tab-context-menu` · `find-overlay-geometry` · `tab-surface-geometry`

If a spec needs an edit to pass, that is a **regression**, not a spec problem — the leg's premise is byte-identical single-window behavior. Escalate rather than editing.

**Do not run `multi-window-shell`.** It is a planned red (AC13/AC15).

### AC18 — Live smoke: one real window close (MANDATORY)

Apparatus: `npm run dev:automation` + the canonical id-space probe walk (`scripts/a11y-audit.mjs:212-235` — skip set from `enumerateTabs` + chrome, walk ids 1..64). Observable: **the addressable non-tab wcId count returns to baseline** (F6's M4 idiom).

| # | Action | Expected |
|---|--------|----------|
| 1 | Launch `dev:automation`. Probe-walk the id space. | Record **baseline** non-tab addressable wcIds (window 1's chrome; overlays not yet constructed — they are lazy). |
| 2 | In window 1, open the kebab menu, then Esc. Open find (Ctrl+F), then Esc. | Window 1's sheet + find views now exist. Probe walk → **baseline + 2**. |
| 3 | Kebab → **New window**. In window 2, open the kebab menu, then Esc. Open find, then Esc. | Window 2's own sheet + find views exist. Probe walk → **baseline + 4**. **This alone falsifies the roaming singleton** — two sheets exist simultaneously. |
| 4 | Close **window 2** via its own window-control close button (the app's own `window-close` IPC → `win.close()` path — **not** `app.quit()`, not a kill). | Window 1 stays fully functional. Probe walk → **back to baseline + 2**. Window 2's two overlay wcIds are **no longer addressable** — destroyed, not leaked. Window 1's two are **still addressable** and its menus/find still work. |
| 5 | In window 1, open the kebab menu and find again. | Both still work — closing window 2 destroyed only window 2's instances. |

Step 4 is the leg's headline observable: it proves the relocation (no leak) **and** the per-window scoping (window 1 unaffected) in one close. Record the four counts in the flight log.

> Not in scope for this smoke: the two-menus-open-*simultaneously* proof is leg 4's headline (it needs DD2's `sheetVisible` to read cleanly). Step 3's probe count is the cheap leg-1 stand-in.

## Implementation Guidance

> **Unit-test exemption.** This leg's main.js wiring half is **unit-test-exempt** — `main.js` is not unit-testable (Electron-bound, no offline harness; this is why CLAUDE.md's pure-module pattern exists at all). The unit net covers the **extracted module** (AC1/AC11-net); the wiring half leans on the **invariant set** (AC13) + the **live smoke** (AC18) + the **source-scan tripwire** (AC12). Do not attempt to unit-test `createWindow`. Do not let the exemption soften AC13 or AC18 — they are the substitute, not a formality.

### 1. Read the template completely first

Read `src/main/menu-overlay-manager.js` end-to-end (347 lines) before writing a line. It is the **line-for-line** template. Its header comment block (`:1-62`) documents each dep and each lifecycle contract; the new module's header should be its structural sibling.

Then read `test/unit/menu-overlay-manager.test.js` (780 lines) — the new module's net mirrors its fakes (`makeFakeView` `:13-48`, `makeFakeContentView` `:50-…`) and its test-name discipline (one behavior per test, contract named in the title).

### 2. Design `createFindOverlayManager(deps)`

Map the flight log's Overlay census (`main.js:291-514`) onto per-instance closure state:

| main.js module var (line) | → manager closure state | Template analogue |
|---|---|---|
| `overlayView` `:299` | `view` | `menu-overlay-manager.js:105` |
| `overlayVisible` `:301` | `visible` | `:106` |
| `overlayReady` `:325` | `ready` | `:107` |
| `lastGuestBounds` `:309` | `lastGuestBounds` (**per-instance**) | `:109` — S9's fix is exactly this |
| `findOverlayTabWcId` `:313` | `sessionTabWcId` | `:111` (`currentMenu`'s analogue) |
| `findOverlayLastQueryText` `:322` | `lastQueryText` | *(no analogue — find-specific)* |
| `pendingOverlayInit` `:329` | `pendingInit` | `:113` |
| `findOverlayAttachedWin` `:307` | **DELETED** | see below |

**The attachment record does NOT survive for find.** DD5: "a per-window instance *is* its own scope." The window is fixed at construction, so inject `getContentView: () => win.contentView` and the "never re-resolve at hide" invariant (the F4 review's named defect) holds **by construction** — there is no other window to re-resolve to. Do not port `findOverlayAttachedWin`, and do not port `showFindOverlay`'s cross-window detach branch (`main.js:431-433`) — it is dead under per-window instances.

Suggested dep surface (mirror the template's injection discipline — every live Electron handle injected):

```js
createFindOverlayManager({
  getContentView,        // () => this window's contentView
  createOverlayView,     // () => WebContentsView (all Electron construction stays in main.js)
  getActiveGuestBounds,  // () => Bounds | null — THIS record's live active-guest bounds
  computeBounds,         // computeFindOverlayBounds (pure; injected so the module stays testable)
  getTabContents,        // (wcId) => wc | null
  isTabInThisWindow,     // (wcId) => boolean — rec.tabViews.has(wcId)
  notifyChrome,          // (channel, payload) => void — THIS window's chrome (class 1b)
})
```

Suggested returned API (the template's `:324-344` shape, minus `getAttachedWindow`):

`ensureView` · `show` · `hide` · `openSession(wcId, findText)` · `closeSession({refocusGuest})` · `syncBounds(rounded)` · `teardown` · `isVisible()` · `isReady()` · `getView()` · `getSessionTabWcId()` · `isSessionActive(wcId)` · `query(...)` *(the `find-overlay:query` body's session-state half — see step 5)*

`getView()` is **required**: `main.js:684`-analogue sender checks, the capture layering at `:888-890`, and leg 3's DD2 `findWcId` all read it.

**Cache freshness contract for `lastGuestBounds`** (per-instance): source of truth = this window's active guest's bounds. Rebuild trigger = **invalidation event** — `tab-set-bounds` on the active tab calls `syncBounds`. Max staleness = one bounds event. The show path additionally does a **per-call fetch** via `getActiveGuestBounds()` and falls back to `lastGuestBounds` only when the record has no live active guest — this is exactly today's `:419-422` behavior, preserved. S9's bug was the *shared write*, which per-instance state structurally eliminates.

### 3. Port the eight functions

Port `main.js:334-514` verbatim in behavior, one function at a time, adjusting only the state references:

- `teardownFindOverlayView` `:334-352` → `teardown()` (template `:139-157`)
- `ensureFindOverlayView` `:355-401` → `ensureView()` (template `:162-194`) — keep the destroyed-recreate guard (`:358-363`) and the `render-process-gone` self-teardown (`:390-392`); the `did-finish-load` pending-init flush (`:376-385`) maps to the template's `:173-185`
- `showFindOverlay` `:407-439` → `show()` (template `:206-214`) — **minus** the owner-routing resolve (`:412`) and the cross-window detach (`:431-433`); keep the `computeBounds` null-guard (`:423-427`)
- `hideFindOverlay` `:443-451` → `hide()` (template `:222-227`) — visibility-gated `removeChildView`, never `setVisible(false)`-only
- `deliverOverlayInit` `:456-460` → private `deliverInit()` (template `:129-133`)
- `openFindOverlaySession` `:464-495` → `openSession()` — keep the web-tab-only refusal (`:468`), the AC6e re-focus-without-re-seed branch (`:469-476`), and the defensive retarget (`:477-483`)
- `closeFindOverlaySession` `:502-514` → `closeSession()` — keep the `refocusGuest` contract (`:497-501`) exactly
- `isFindOverlayActive` `:314` → `isSessionActive(wcId)`

**Keep every comment.** The find cluster's comments encode earned lessons (the HAT-1 `findNext` inversion at `:314-321`, the AC5 refocus contract at `:497-501`, the AC7 crash-recovery rationale at `:386-389`). They travel with the code.

### 4. Land the registry slots

In `src/main/window-registry.js`:
- Extend the `WindowRecord` typedef (`:28-36`) with `findOverlay: any` and `sheet: any` (structurally typed — the registry stays Electron-free and must not import either manager's type).
- Seed both to `null` in `create()`'s record literal (`:63-71`).
- Document them in the module header (`:4-22`) as **main.js-assigned** — the registry is Electron-free and cannot construct managers.

`test/unit/window-registry.test.js` passes unmodified (verified at leg design: its shape test at `:30-43` asserts field-by-field, and `:70`/`:75`'s `deepEqual` compares the same object identities).

### 5. Rewire main.js — the two access paths

**This is the subtlety that makes the leg work.** Every manager is reachable two ways, and the choice is not stylistic:

- **`createWindow`'s closure refs** — used by the **lifecycle handlers** (`close`, `blur`). These must **not** go through `registry.get(...)`, because AC8 requires destruction to sit above `if (!rec) return`. This is the established class-1b create-closure pattern (`sendToOwnChrome`, `:1145-1148`).
- **`rec.findOverlay` / `rec.sheet`** — used by every **owner-resolved IPC handler** (registered once at module scope, resolving the record from the sender/wcId).

Site-by-site conversion (the flight log's census + the ~30 find call sites):

| Site | Today | Becomes |
|---|---|---|
| `:558` | `menuOverlay.getAttachedWindow()` → `attRec` | `createSheetView` becomes **per-window** (closes over `record`); `accelRec` **is** that record |
| `:606` | `menuOverlay.closeMenuOverlay('superseded')` | the closure's sheet manager |
| `:684` | `isSheetSender` via `menuOverlay.getView()` | **reverse lookup** — see step 6 |
| `:695-703` | `menuOverlay.openMenu(payload, {...})` | `rec.sheet.openMenu(payload, {...})` (sender-resolved; `rec` from `getWindowForChrome`) |
| `:714-718` | `menuOverlay.closeMenuOverlay(...)` | `rec.sheet.closeMenuOverlay(...)` |
| `:726-742` | `menuOverlay.getAttachedWindow()` → route ch6 | the **sheet-sender's** record → its own chrome |
| `:748-753` | `menuOverlay.closeMenuOverlay(...)` | the sheet-sender's record's manager |
| `:888-890` | `overlayVisible && overlayView && findOverlayAttachedWin === grabWin` | `grabRec.findOverlay.isVisible()` + `.getView()` |
| `:893` | `menuOverlay.isVisible() && getAttachedWindow() === grabWin` | `grabRec.sheet.isVisible()` |
| `:1180-1187` | find-close + `hideFindOverlay` + conditioned sheet close | **destruction** — see step 7 |
| `:1235` | `if (getAttachedWindow() === win) closeMenuOverlay('blur')` | closure sheet manager, **unconditional** (`closeMenuOverlay` is idempotent when no menu is open — template `:294`) |
| `:1640` | `isFindOverlayActive(wcId) && overlayView` | `registry.getWindowForGuest(wcId)?.findOverlay` |
| `:2560` | `wcId === findOverlayTabWcId` | `owner.findOverlay.isSessionActive(wcId)` |
| `:2573`, `:2577` | `findOverlayAttachedWin === owner.win` | `owner.findOverlay.hide()` — **unconditional** (hide is idempotent, template `:223`) |
| `:2574` | `getAttachedWindow() === owner.win` | `owner.sheet.closeMenuOverlay('tab-close')` — unconditional |
| `:2668-2672` | find-session close on move | `managerFor(source.win)` — **DD5's named conversion site, do not lose it**: "the session is bound to the source window and does not survive the move" |
| `:2743` | `getAttachedWindow() === owner.win` | `owner.sheet.closeMenuOverlay('tab-hide')` — unconditional |
| `:2801-2813` | find switch-away/restore + `lastGuestBounds = rounded` | `owner.findOverlay.*`; the `owner.tabViews.has(findOverlayTabWcId)` guard (`:2801`) is now **structural** — the instance only knows its own window's session |
| `:2821-2832` | `sheetAttachedHere` conditioning ×3 | `owner.sheet.*` — the conditioning disappears; `syncBounds` stores-always regardless |
| `:2861-2868` | `lastGuestBounds = rounded` + two conditioned syncs | `owner.findOverlay.syncBounds(rounded)` + `owner.sheet.syncBounds(rounded)` |
| `:2888-2891` | `openFindOverlaySession(wcId, ...)` | `registry.getWindowForGuest(wcId)?.findOverlay.openSession(...)` |
| `:2902-2911` | `find-overlay:close` sender check | **reverse lookup** — see step 6 |
| `:2930-2946` | `find-overlay:query` sender check + session state | **reverse lookup** — see step 6 |
| `:3429-3431` | the three quit-hook overlay lines | **DELETED** (AC9) |

> **Why dropping the `=== owner.win` conditioning is safe, not a behavior change**: under per-window instances the compare is *always true when the instance has an open menu/session and null otherwise*, and every guarded call is already idempotent-when-inactive (`closeMenuOverlay` `:294`, `hide` `:223`). The check becomes redundant, not load-bearing. This is precisely why DD5 says the conversion **deletes** the checks rather than converting them.

### 6. The sender-identity reverse lookups (NOT enumerated in the flight spec — read this)

Three IPC handlers today compare `event.sender` against a **single global view**. They are registered once at module scope and cannot close over a record, so under N instances each needs a **reverse lookup** to find which window's manager owns the sender:

- `isSheetSender(event)` `:683-686` — `menuOverlay.getView()`
- `find-overlay:close` `:2902-2904` — `overlayView.webContents`
- `find-overlay:query` `:2930-2931` — `overlayView.webContents`

Add two small module-scope helpers alongside the existing registry reverse lookups (the `getWindowForChrome` / `getWindowForGuest` idiom, `window-registry.js:129-148`):

```js
// The record whose SHEET view's webContents IS this sender (identity compare —
// the same discipline as the sender-identity IPC checks). Null when no match.
function recordForSheetSender(sender) { /* iterate registry.records() */ }
function recordForFindSender(sender) { /* iterate registry.records() */ }
```

These live in **main.js** (they touch live `webContents` identity and the manager instances, which the Electron-free registry must not know about). Each must tolerate a null/destroyed view on any record.

This is real work the flight's site census did not itemize — budget for it, and note that a sender that matches **no** record must be **dropped** (the established discipline: `chromeForAttachment`'s gone-attachment drop, `:626-633`, "never re-routed — cross-window token spaces collide").

### 7. Relocate destruction (AC8)

In `createWindow`, keep the two managers in closure scope:

```js
const record = registry.create({ win, chromeView, noBootTab });
const winId = win.id;
const findOverlay = createFindOverlayManager({ /* deps closing over win/record */ });
const sheet = createMenuOverlayManager({ /* deps closing over win/record */ });
record.findOverlay = findOverlay;
record.sheet = sheet;
```

Then in `win.on('close', ...)`, **above** `const rec = registry.get(win.id); if (!rec) return;` (`:1155-1156`):

```js
win.on('close', () => {
  // Overlay DESTRUCTION (F7 DD5): the SOLE destruction site. Above the !rec
  // early-return — a fail-open path must not leak two WebContentsViews per
  // closed window (review pass-1 H1). Reached via the create closure, NOT
  // registry.get(): on the !rec path there is no record to reach them through.
  // The F8 DD5 ORDERING PIN travels here from before-quit: find BEFORE sheet —
  // the find teardown nulls the session, so the sheet's teardown-reason
  // find-restore naturally no-ops.
  findOverlay.teardown();
  sheet.closeMenuOverlay('teardown');
  sheet.teardown();

  const rec = registry.get(win.id);
  // Null the record slots in the SAME breath as the teardown (leg-1 design
  // review): the record stays reachable via registry.get() until `closed`
  // (:1209) and the chrome wc stays alive until its deferred destroy
  // (:1217-1220), so an owner-resolved IPC arriving in that gap would other-
  // wise call ensureView() on a torn-down manager and RECONSTRUCT a view onto
  // the dying window — a leak nothing tears down, since `close` fires once.
  // Nulling makes the record path fail safe; the closure path above already
  // tore down. Both paths, one breath.
  if (rec) {
    rec.findOverlay = null;
    rec.sheet = null;
  }
  if (!rec) return;
  // … existing closed-tab capture, per-tab destroy loop …
});
```

Then **delete** the old `:1180-1187` detach block (its find-session close, `hideFindOverlay`, and conditioned sheet close are all subsumed by the teardowns above) and **delete** `:3429-3431` from `before-quit`.

**Every owner-resolved call site must be null-tolerant** (AC8b). Use `owner.findOverlay?.hide()` / `rec.sheet?.openMenu(...)` etc., or an explicit null check — this matches the codebase's existing owner-resolve-returns-null → early-return discipline, and the two sender reverse-lookups from step 6 must skip records whose slot is null.

Note `win.contentView` is still readable here — `close` is **pre-teardown** (F6 spike verdict 3; the window is alive), which is exactly why `closed` cannot host this.

**Two stale comments must be rewritten** — both describe the scheme this leg inverts, and both will read as actively wrong post-leg:
- `src/main/main.js:1150-1153` — the Lifecycle-split comment directly above `win.on('close', ...)`, whose last sentence reads "Overlay DESTRUCTION moved to the quit hooks (before-quit) with the F8 DD5 ordering pin traveling along." The pin now travels **back**. Rewrite it to describe `close` as the sole destruction site.
- `src/main/main.js:3422-3428` — the `before-quit` block comment carrying the same F6 DD3 rationale. Delete it with the three lines it explains.

### 8. Land `onWindowClosed` (AC10)

```js
/**
 * Register a `closed` handler that CANNOT reach through a destroyed window.
 * The window's id is captured at REGISTRATION time (the window is alive here);
 * the handler receives only that primitive. A destroyed-BaseWindow property
 * access throws, and an uncaught throw inside the native `closed` emission
 * aborts the listener chain AND permanently wedges the Wayland close path with
 * zero error output (the F6 leg-4 fix-cycle root cause; CLAUDE.md:21).
 * @param {Electron.BaseWindow} win
 * @param {(winId: number) => void} handler
 */
function onWindowClosed(win, handler) {
  const winId = win.id;
  win.on('closed', () => handler(winId));
}
```

Convert the one existing site (`:1206-1221`) — it is **already correct** (it uses the captured `winId` at `:1209`), so this is a **prospective-insurance** conversion, not a bug fix (S6). The `chromeView` capture at `:1217` is a view handle, not a `win.*` read — it travels unchanged.

Place it at module scope near `createWindow`. Do not put it in `window-registry.js` (wrong home — the registry is a record store) and do not build a module for three lines.

### 9. The DD8 source-scan tripwire — the mechanism is RESOLVED (AC12)

**Build Tier 1: registration-site exclusivity.** The ladder is closed — see AC12 for why the positive and negative forms are retired. Do not re-derive it.

Assert: *`src/main/**` contains ZERO raw `.on('closed'` / `.once('closed'` registrations outside `onWindowClosed`'s own definition.*

Mechanism, straight from the house pattern:
1. `maskComments` the source (`broadcast-invariant.test.js:69-118`) so a registration-shaped mention inside a comment can't trip it (the `:278-285` precedent).
2. Bracket-balance `onWindowClosed`'s own function body out of the masked text (`findMatchingBracket` `:131-150`) — that one definition is the sanctioned registration.
3. Regex-scan the remainder for `.on('closed'` / `.once('closed'`. Any hit is a violation, labelled with its offset.

Post-conversion this passes with a **zero-entry allowlist** — mirror `broadcast-invariant.test.js:52-58`'s empty-by-design allowlist and its `:246-248` "the allowlist is empty" pin.

Include the `:223-225` sanity idiom **adapted to this test's shape**: the assertion there ("expected dozens of registrations") guards against an extraction that silently scans zero sites. Here the expected count is *zero violations*, so a vacuous pass looks identical to a real one — instead assert that `onWindowClosed`'s definition **was found and excised** (i.e. the bracket-balance located exactly one sanctioned registration), so a rename or refactor that breaks the excision fails loudly rather than passing vacuously. Also port the `:255-285` synthetic-fixture tests for the scan's own logic.

**No false-positive risk** (verified at leg design, confirmed by the leg design review): `src/main/automation/mcp-server.js` uses Node's `'close'` event throughout and **never** `'closed'`. The two conventions differ by exactly one character — scan for `'closed'` only, and do not "helpfully" widen the regex to catch `'close'`.

### 10. Land the ESLint rule (AC11)

Add a `no-restricted-syntax` entry to the `src/main/**` block in `eslint.config.mjs` (the block at `files: ['src/main/**', …]`, which today carries only `no-unused-vars`). Use the flight log's **empirically-verified** selector **verbatim** — copy it, do not retype it, do not "simplify" it:

```
CallExpression[callee.property.name=/^(on|once)$/][arguments.0.value='closed'] > :matches(ArrowFunctionExpression, FunctionExpression) MemberExpression[object.name='win']
```

**The `>` child combinator is load-bearing** (S5): as a bare descendant match it also matches the `win.on` **callee**, firing on every registration — including the correct one at `:1206-1221`. The recon verified this on a 14-case fixture via `Linter.verify`: 7 findings, 4 false positives. Pair it with a message naming CLAUDE.md's destroyed-window rule and pointing at `onWindowClosed`.

### 11. Write the unit net (AC1)

Mirror `test/unit/menu-overlay-manager.test.js`'s structure. Its fakes (`makeFakeView` `:13-48`, `makeFakeContentView` `:50+`) port nearly verbatim. Cover, at minimum, the template's own contract list — these are the behaviors the extraction must not silently drop:

- lazy singleton: repeated shows create the view exactly once (`:87`)
- show applies stored bounds → `addChildView` → `setVisible(true)`, in that order (`:100`)
- show without stored bounds skips `setBounds` (`:120`)
- show with a null contentView is a **state-preserving** no-op — `visible` must NOT flip (`:135`)
- hide before any show is a no-op; hide removes the child once; second hide no-ops (`:163`, `:168`)
- hide never uses `setVisible(false)`-only (`:177`)
- `syncBounds` while visible re-applies 1:1; while hidden only stores (`:193`, `:202`)
- destroyed webContents → ensure/show rebuilds a fresh view (`:222`)
- `render-process-gone` → teardown so the next show rebuilds (`:235`)
- teardown destroys the wc, resets state, later show recreates (`:254`); teardown-while-hidden doesn't `removeChildView` (`:274`); teardown-when-never-shown is safe (`:283`)
- `did-finish-load` flips readiness; teardown resets it (`:292`)
- pending-init: queued before load, delivered once on load, **latest wins**; a close before load clears the seed so a stale seed never fires (`:382`, `:402`)

Plus the find-specific contracts with no sheet analogue:

- `openSession` refuses **trusted/internal** and destroyed targets (`main.js:468`)
- re-open on the already-targeted tab **re-focuses without re-seeding** init (AC6e — `:469-476`; re-init would wipe the user's typed text)
- a session open for a **different** tab closes the old one first (`:477-483`)
- `closeSession({refocusGuest})`: `stopFindInPage('clearSelection')` always; `focus()` **only** when `refocusGuest` (the AC5 contract, `:497-501`)
- the **HAT-1 `findNext` inversion**: same text + step ⇒ `findNext:false`; changed text ⇒ `findNext:true`; empty text ⇒ no engine call and `lastQueryText` reset (`:2938-2946`). This is the single most-regressed contract in the overlay's history (CLAUDE.md's Overlay-view pattern 1 — carried silently as "faithful parity" for two migrations). Pin it hard.
- **per-instance isolation**: two manager instances share **nothing** — a `syncBounds` on A never moves B's view, and A's session never appears in B (this is S9's fix, and the whole point of the leg; the shared-slot bug is unrepresentable once the state is closure-local, but pin it so a future refactor to module scope fails loudly).

## Edge Cases

- **`!rec` at close.** `registry.remove` runs at `closed`, so `!rec` at `close` is a fail-open defensive path (double-close, or a close racing an unusual teardown). Destruction above the guard is what makes it non-leaking. **Do not** "simplify" by moving destruction below it.
- **The `close`→`closed` gap (AC8b) — a GENUINE gap this leg fixes, not an accepted one.** Reviewer question 1, answered so leg 2 doesn't re-litigate: the interval was **not** deliberately accepted; it is an artifact of the two-access-path design and is closed here. Between `close` and `closed` the record is still reachable (`registry.remove` runs at `:1209`) and the chrome `webContents` is still alive (its destroy is deferred to `setImmediate` at `:1217-1220`). So a chrome-sender IPC arriving in that window — `menu-overlay:open` (`:695-703`) or `find-overlay:open` (`:2888-2891`), both resolving via `getWindowForChrome(event.sender)` — would resolve `rec`, call `openMenu`/`openSession` on a **torn-down** manager, hit `ensureView()` with `view === null`, and **reconstruct a fresh view onto the dying window's `contentView`**. `close` fires once, so nothing would ever tear that down: precisely the leak class DD5 exists to fix, reintroduced through the back door. Narrow, but this codebase is automation-driven (an MCP `evaluate`/`click` can race a synthetic close against an in-flight IPC to the same window), and the house treats analogous TOCTOU gaps as real — DD7's post-await re-check ruling in this very flight. **Nulling the slots (AC8b) closes it**; a null-tolerant call site then no-ops exactly like any other failed owner resolve.
- **The sheet's OWN senders cannot reach through the gap** — reviewer question 2, confirmed against the code rather than assumed. `menu-overlay:activated` (`:726`) and `menu-overlay:dismissed` (`:748`) are both gated on `isSheetSender(event)`, which requires a live `getView()`. `teardown()` destroys the webContents **synchronously** (`menu-overlay-manager.js:147-149`) and nulls `view` (`:151`) — so post-teardown `getView()` returns `null`, the reverse lookup matches no record, and the message is dropped. `find-overlay:query` (`:2930-2931`) is identically gated on the overlay's own view identity. **The synchronous destroy in `close` fully closes the sheet/overlay-sender vector**; AC8b's nulling is what closes the remaining **chrome**-sender vector. The two fixes are complementary, not redundant.
- **The sheet manager's attachment internals.** Under per-window instances, `menu-overlay-manager.js`'s `attachment` record always holds *this* window, and its `crossWindow` branch (`:248`, `:262-265`) becomes structurally unreachable. **Leave it.** AC14 pins the module and its 780-line test byte-unchanged: the flight scoped the sheet half as a *wiring change* (S8, and the Technical Approach counts main.js deltas only), gutting it would force deleting/inverting the **nine** DD7 tests at `:680`, `:689`, `:699`, `:709`, `:720`, `:744`, `:753`, `:763`, `:773`, and the machinery is inert-not-wrong. `getAttachedWindow()` survives on the manager's API **unread by main.js** — AC6 grep-pins main.js, not the module. Retiring it belongs to leg 3 (once DD2 settles the sheet's public read surface) or the maintenance flight. **Record this as a leg-1 note in the flight log** so leg 3 inherits it rather than rediscovering it.
- **`createSheetView` becomes per-window.** Its `before-input-event` accelerator handler (`:544-613`) reads `getAttachedWindow()` at `:558` to resolve `accelRec`. Under per-window it closes over its own `record` — `accelRec` **is** that record, and `attRec || registry.getLastFocused()` (`:560`) collapses to the closure. Keep the `isDestroyed()` guards on the chrome resolve (`:561-563`).
- **Lazy stays lazy.** Managers are constructed eagerly per window (they are closures — cheap); their **views** stay lazy, created on first show, exactly as today. A window that never opens a menu or find pays nothing. Do **not** call `ensureView()` at window create. DD2's "an absent id means never created" (leg 3) depends on this.
- **Sheet/find senders match no record.** A reverse lookup that misses (view destroyed, record removed mid-flight) must **drop** the message — never fall back to another window's manager. Established discipline: `chromeForAttachment`'s gone-attachment drop (`:626-633`).
- **A find session on a tab that moves windows.** `:2668-2672` already closes the session on move ("bound to the source window; does not survive the move"). Under per-window this becomes `source.findOverlay.closeSession(...)` — DD5 names it explicitly as a conversion site not to lose.
- **`restoreFindOverlay` at window close.** The sheet's DD5 close hook re-shows find iff the session targets the active tab. At close, the find teardown runs **first** and nulls the session, so the restore naturally no-ops — this is the ordering pin's *purpose*, not an accident. Preserve the order and the comment explaining it (`:658-662`).
- **`app.quit()` with N windows.** Every window gets `close`, so every window destroys its own overlays. `before-quit` doing nothing overlay-wise is correct **because** of this — it is not an omission.
- **The `before-quit` block's other work.** `downloadsManager?.flushInterrupted()` and `mcpServer?.stop()` (`:3437-3438`) stay. Delete only the three overlay lines (`:3429-3431`) and rewrite the block comment (`:3422-3428`) — the F8 DD5 ordering-pin note travels to the `close` handler with the code.

## Files Affected

- `src/main/find-overlay-manager.js` — **NEW**. `createFindOverlayManager(deps)`; Electron-free; ~224 lines ported from `main.js:291-514` + the query/session half.
- `src/main/main.js` — find cluster (`:291-514`) removed; both managers per-window in `createWindow`; ~30 find + 9 sheet sites rewired (null-tolerant); two sender reverse-lookups added; destruction relocated into `close` + the record slots nulled there (AC8b); `onWindowClosed` added; `before-quit` (`:3429-3431`) loses its overlay role; **two stale comments rewritten** (`:1150-1153` lifecycle-split, `:3422-3428` before-quit).
- `src/main/window-registry.js` — `WindowRecord` typedef (`:28-36`) + `create()` record literal (`:63-71`) gain `findOverlay`/`sheet`; module header documents them as main.js-assigned.
- `eslint.config.mjs` — `no-restricted-syntax` added to the `src/main/**` block.
- `test/unit/find-overlay-manager.test.js` — **NEW**. Mirrors `menu-overlay-manager.test.js`.
- `test/unit/window-closed-invariant.test.js` — **NEW**. The DD8 source-scan tripwire.
- **PINNED UNCHANGED**: `src/main/menu-overlay-manager.js`, `test/unit/menu-overlay-manager.test.js` (AC14), `src/main/find-overlay-geometry.js`, `test/unit/window-registry.test.js` (AC4), every spec in the AC13 invariant set.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing (`npm test` ≥ 1715; `npm run typecheck`; `npm run lint`)
- [ ] The AC13 invariant set run green, **unmodified** (8 specs)
- [ ] The AC18 live smoke run, with the four probe counts recorded
- [ ] **APPEND** a leg-1 **landing** entry to flight-log.md — do **not** edit the existing `Leg 1 — designed` entry (append-only; it already carries the DD8 resolution, the planned red, the gap, and the census corrections). Record per AC15:
  - [ ] **main.js's line count at landing** (baseline 3461; flight net target ≤ 3461 judged at flight end, not here)
  - [ ] the **AC18 smoke's four probe counts**
  - [ ] the **AC13 invariant-set result** (8 green + unmodified; `multi-window-shell` not run)
  - [ ] **DD8 Tier 1 as-built** — landed as designed, or a deviation entry
  - [ ] anything the conversion surfaced that the design missed
- [ ] Set this leg's status to `completed` (in this file's header)
- [ ] Check off this leg in flight.md
- [ ] Commit all changes together (code + artifacts) — subject `flight/7: {description}`, trailer `Mission: 09`

---

## Citation Audit

19 code-location citations verified against current code at leg design time (`b607411`). All **OK** — no drift found:

- `src/main/main.js:291-514` (find cluster), `:299/:301/:307/:309/:313/:322/:325/:329` (the eight module vars), `:334/:355/:407/:443/:456/:464/:502` (the eight functions), `:516-757` (sheet), `:888-895` (capture layers), `:1069-1264` (createWindow), `:1155-1156` (`const rec` / `if (!rec) return`), `:1180-1187` (detach block), `:1206-1221` (`closed`), `:3421-3439` (before-quit) — all confirmed by direct read.
- The nine `getAttachedWindow` sites (`:558`, `:735`, `:893`, `:1187`, `:1235`, `:2574`, `:2743`, `:2821`, `:2868`) — confirmed exact by `grep -n 'getAttachedWindow' src/main/main.js` → 9 hits at precisely those lines.
- `src/main/menu-overlay-manager.js:105-117`, `:109`, `:139-157`, `:162-194`, `:206-214`, `:222-227`, `:294`, `:324-344` — confirmed.
- `src/main/window-registry.js:63-71` (record literal), `:28-36` (typedef), `:129-148` (reverse lookups) — confirmed; **no `findOverlay`/`sheet` slots present**, as the flight asserts.
- `test/unit/broadcast-invariant.test.js:69-118` (`maskComments`), `:131-150` (`findMatchingBracket`), `:165` (`REGISTRATION_RE`), `:171-191`, `:223-225`, `:246-248`, `:255-285` — confirmed.
- `test/unit/menu-overlay-manager.test.js` — 780 lines confirmed; the cited test lines (`:87`…`:773`) confirmed by test-name grep.
- `src/main/main.js` line count **3461** — confirmed by `wc -l`, matching the flight log's Sizes paragraph.

**One citation corrected against the flight's own text** (recorded, not silently fixed): the flight and recon describe all nine sites as "`getAttachedWindow() === X` conditioning checks." Verified: **seven** are `=== X` comparisons (`:893`, `:1187`, `:1235`, `:2574`, `:2743`, `:2821`, `:2868`); **two** are bare attachment *resolves* — `:558` (`const attWin = menuOverlay.getAttachedWindow()`, the accelerator's window resolve) and `:735` (the channel-6 routing capture). Those two are **converted** (to the per-window closure / the sheet-sender's record), not merely deleted. AC6 is therefore written as `grep -c 'getAttachedWindow' src/main/main.js` → 0, which covers both classes honestly and is not weakened by the mislabel.

**The planned-red falsification citations, verified independently** (AC13 rests on them, so they were not taken on the flight spec's word): `tests/behavior/multi-window-shell.md:80-86` reads "ONE sheet serves every window, attaching to the requesting window at show time" — the roaming-singleton precondition DD5 falsifies; `:124` (step 4's Expected Results) ends "A second window has fully working menus with **zero per-window overlay instances**" — the expected result DD5 inverts. Both confirmed verbatim. The spec is correctly classified as a planned red from this leg.

**Two citations verified as claimed but worth flagging** (checked because an AC depends on them):
- `test/unit/window-registry.test.js:30-43` asserts the record shape **field-by-field**, not by exact-key deep-equality — so AC4's new slots break nothing. Confirmed by read.
- `grep -rn "\.on('closed'\|\.once('closed'" src/` → **exactly 1 hit** (`main.js:1206`), confirming S6's "scope = 1 site" and making Tier 1's zero-allowlist source-scan feasible.

### Post-review addenda (leg design review, 2026-07-15)

The review returned **approve-with-changes**, independently confirming every code citation above, the 7-compares/2-resolves correction, the `.on('closed'` census, the sender-identity sweep (the three in step 6 are the only three), the find-before-sheet ordering pin, AC13's achievability (all 8 invariant-set specs grepped — none depends on roaming attachment), and AC4's registry-shape reachability. Three findings folded in; **one was a citation error of mine**:

- **CORRECTED — a count error in my own Edge Cases.** I wrote "the 8 DD7 tests at `:680-773`." There are **nine**: `test/unit/menu-overlay-manager.test.js:680, 689, 699, 709, 720, 744, 753, 763, 773` (confirmed by `grep -c "^test('DD7"` → 9). Fixed in Edge Cases and now cited line-by-line rather than as a range-plus-count. Noted for the debrief: this flight has a **standing pattern of count errors** — the recon's probe-walk 7-vs-10 (review H2), the audit's "2 stale rows" vs 1 (S7), the "nine conditioning checks" mislabel (7+2), and now this. Ranges stated with a count invite it; enumerate instead.
- **NEW — `main.js:1150-1153`** verified stale: its last sentence reads "Overlay DESTRUCTION moved to the quit hooks (before-quit) with the F8 DD5 ordering pin traveling along," directly above `win.on('close', ...)` — describing the exact scheme this leg inverts. Added to guidance step 7 and Files Affected.
- **NEW — `menu-overlay-manager.js:147-151`** verified: `wc.destroy()` is **synchronous** and `view = null` follows immediately, which is what closes the sheet-sender vector in the `close`→`closed` gap (reviewer question 2, now answered in Edge Cases rather than left implicit).
- **NEW — `src/main/automation/mcp-server.js`** verified to use Node's `'close'` throughout, never `'closed'` — no false-positive risk for Tier 1's scan. Recorded in guidance step 9 with an explicit "do not widen the regex to `'close'`" warning, since the conventions differ by one character.
