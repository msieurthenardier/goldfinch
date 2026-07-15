# Flight: Multi-Window Shell, Part 2

**Status**: ready
**Mission**: [First-Class Tab Management](../../mission.md)

## Contributing to Criteria

- [ ] With several windows open, closing one leaves the others fully
      functional; **per-window surfaces (find, menus, active-tab state) never
      cross-talk between windows**. *(F6 landed close-one-of-N and the
      lifecycle; F7 lands the per-window surfaces — the roaming-singleton
      interim is the last cross-talk source. Behavior-test-backed: new
      `multi-window-automation` spec + the rewritten `multi-window-shell`.)*
- [ ] Agentic platforms driving Goldfinch: the automation surface
      (`enumerateTabs`, foreground-to-act, capture) keeps working as windows
      multiply; **multi-window semantics are decided deliberately, not by
      accident**. *(Mission stakeholder commitment; the six decisions the F6
      audit enumerates land here.)*
- [x] *(Recon retirement)* `tab-context-menu` step 3's stale enumeration —
      **already-satisfied**: updated by FD ruling at the F6 leg-5 re-run
      (`tests/behavior/tab-context-menu.md:120`) and re-ran green 10/10 the
      same day (`2026-07-15-06-05-04`). The audit's "2 stale-enumeration rows"
      (`docs/behavior-specs-single-window-audit.md:199`) is **1**:
      `kebab-menu.md` only.

---

## Pre-Flight

### Objective

Retire every interim F6 shipped. The find overlay and menu sheet become true
per-window instances (deleting the DD7 roaming attachment machinery rather than
extending it, and relocating overlay *destruction* to per-window close); the
automation surface gets deliberate multi-window semantics — an all-windows
`enumerateTabs` carrying `windowId`, a first-class `enumerateWindows` discovery
op that retires the probe walk, and a window discriminator on
`getChromeTarget`/`captureWindow`; two live defects recon found in shipped F6
code are fixed (cross-window activate silently no-ops; five unguarded
`capturePage` awaits can wedge a request forever); and the behavior-spec corpus
is realigned. F8 (tear-off/cross-window drag) inherits this surface; nothing
here depends on F8.

### Recon (Phase 1b digest — full fact base in the flight log)

Recon verified all eight cited items against current code and produced ten
surprises; two review passes then spot-checked the load-bearing ones
(S1/S2/S3/S4/S6/S8/S9/S10 **confirmed**) and corrected three. What reshapes
this flight:

- **S1 — `activateTab` and the whole foreground-to-act contract silently no-op
  across windows.** In no source artifact. `resolveContents` is all-windows (F6
  widened it), but dispatch goes via `executeInRenderer` → the **last-focused**
  chrome (`engine.js:72-76`), whose `activateTabByWcId` searches **its own
  document's tabs Map** (`renderer.js:3603-3608`), misses a window-B tab, and
  returns `false` — **discarded** at `input.js:235`, `observe.js:126,195`. Acts
  on a window-B tab proceed against an **unraised, background** guest and
  report success.
- **S3 — five unguarded `capturePage` awaits** (`observe.js:132`;
  `main.js:857,858,889,895`); a detached-but-live view passes every
  `isDestroyed()` guard and hangs forever.
- **S8 — the two "roaming singletons" are wildly asymmetric.**
  `menu-overlay-manager.js` is **already** `createMenuOverlayManager(deps)` with
  **zero** module-scope state — instantiating it N times is a *wiring change*
  that **deletes** the nine DD7 conditioning checks. The find overlay is 8 raw
  module vars + 8 functions across `main.js:291-514`, ~30 call sites, **no
  module at all** — extract first. F6 designed the registry record slots
  (`{…, findOverlay?, sheet?}`) and never landed them
  (`window-registry.js:63-71`).
- **S2 — the `captureWindow` mis-pick is not reproducible on the dev rig.**
  `main.js:814-815` skips the whole `desktopCapturer` branch under Wayland;
  `dev:automation` selects Wayland. The heuristic (`:826-834`) is **dead code on
  the operator's platform**; any spec step asserting the mis-pick passes
  vacuously.
- **S5 — the F6 debrief's ESLint selector is wrong as written** (verified on a
  14-case fixture: as a bare descendant match it also matches the `win.on`
  callee, firing on every registration including the correct one). The
  corrected form uses a `>` child combinator. See DD8.

**Three recon/design facts the reviews corrected, all folded below:**

- **The probe-walk set is 10, not 7 — the audit was right, the recon wrong.**
  The recon counted only specs matching the sheet by its `menu-overlay.html`
  URL and missed four identifying it by *markup*. Pass 2 verified all 11
  independently: `internal-tab-menus:42-47`, `kebab-menu:67-72`,
  `menu-dismissal:55-58`, `menu-overlay:48-50`, `page-context-menu:59-61`,
  `tab-context-menu:61-62`, `omnibox-suggestions:43-44,59`,
  `tab-cycling:39-42`, `closed-tab-reopen:99`, `find-overlay-geometry:62-67`,
  + `multi-window-shell:80-86`. (Near-miss, not a 12th:
  `tab-surface-geometry.md:60` probes conditionally — leg 4 glances at it.)
- **DD1's original privacy rationale was factually wrong** (see DD1).
- **DD1's `incomplete` marker was itself wrong** — it broke at the jar facade
  and duplicated a signal DD2 already carries (see DD1).

### Open Questions

- [x] **Does the mission's "enumerate spans all windows" default survive the F6
      interim?** → **Yes** — DD1.
- [x] **Overlay discovery mechanism** → DD2 (`enumerateWindows`).
- [x] **`getChromeTarget` arity / `captureWindow` signature** → DD3.
- [x] **Foreground-to-act under N windows** → DD6, now ruled for **all eight**
      activate sites via a stated predicate (pass 2: the original ruled two and
      left `evaluate` — which every probe walk runs on — unstated).
- [x] **Capture-vs-re-parent race** → DD7.
- [x] **`BaseWindow.getMediaSourceId()` in Electron 42?** → **RESOLVED: it
      EXISTS.** `electron.d.ts:2809`, inside `class BaseWindow` (`:2113`),
      Electron `^42.6.1` (`package.json:73`); verified independently by both
      review passes. DD4 takes the exact-identity branch; the title+bounds
      fallback is **deleted from the design**. (Note `:2805-2807`: the id is an
      X11 `Window` on Linux — reachable only on the non-Wayland path, exactly
      where the buggy heuristic lives. Consistent with S2.)
- [x] **Mid-boot windows in the census** → DD1: a mid-boot window contributes
      zero rows; `enumerateWindows().booted` is the discriminator. No marker on
      `enumerateTabs`.
- [ ] **Can DD8's source-scan test assert its POSITIVE form** ("every
      `.on('closed')` callback reads only captured primitives") **without a
      hand-kept capture list?** Pass 1's read: probably not — that needs scope
      resolution, not the marker-matching `broadcast-invariant.test.js` does.
      **Leg 1 proves the mechanism or falls back to the negative form** and says
      so in the log. A mechanism question, not a decision — DD8's shape holds
      either way, and the **wrapper** is the primary net regardless.

### Design Decisions

**DD1 — `enumerateTabs` spans ALL windows; every row carries `windowId`. The
REGISTRY is the ownership authority; the renderer is authoritative only for
per-tab fields. The return stays a PLAIN ARRAY.** Main assembles the census
from N per-chrome round-trips (one `executeInRenderer` per registered, booted
chrome) and **filters each window's returned rows to that record's own
`tabViews` membership** (`rec.tabViews.has(wcId)`), stamping `windowId` from the
registry — the renderer never learns it. Rows are ordered by registry insertion
order, then each window's existing `listTabs` creation order. Jar-tier filtering
by resolved session is unchanged (`scope.js:145-157`). **A mid-boot window
(`bootConfigServed === false`) contributes zero rows; `enumerateWindows().booted`
is the completeness discriminator.**
- Rationale: honors the mission's stated default (`mission.md:211-212`) — a
  stakeholder commitment the recon found no reason to contradict. It is the only
  option that *fixes* the five count-precondition specs (they mean "all tabs in
  the app") rather than restating them, and it makes the probe-walk skip set
  correct by construction.
- **No `incomplete` marker (pass-2 HIGH — the original design broke).** The
  planned `{tabs, incomplete}` wrapper breaks the jar facade outright
  (`scope.js:150-152` does `(await engine.enumerateTabs()).filter(...)` →
  `tabs.filter is not a function`, and `mcp-jar-scoping.md:60` pins "returns a
  JSON-text **array**"); an array-with-own-property is **silently dropped** by
  `Array.prototype.filter`, which does not copy own properties — a jar caller
  would under-read with no signal, the exact failure the marker existed to
  prevent. And `incomplete: [windowId]` at the jar tier is a **cross-tenant
  leak**: it names windows a jar identity may hold no tabs in, contradicting
  the established doctrine (`scope.js:186-193` admin-refuses `getDownloadsList`
  because "an app-level cross-jar view is an admin capability … new tools must
  not widen the surface's reach"). **DD2's `booted` already carries the signal**
  at the admin tier where topology belongs — so `enumerateTabs` keeps its array
  shape (no consumer breaks, no facade rewrite, no `mcp-jar-scoping` churn), and
  a caller needing a total census polls `enumerateWindows()` until every
  `booted` is true. This is honest rather than lossy: an un-booted window's
  renderer genuinely has no tabs yet. The one real gap it leaves — a
  **move-created window's adopted tab is in `rec.tabViews` before its chrome
  boots**, so it is invisible for that interval — is exactly what `booted`
  exists to disclose, and is documented in `docs/mcp-automation.md` by leg 3.
- **Atomicity (pass-1 HIGH), and it is stronger than first argued.** N
  sequential round-trips have no snapshot, so in principle a tab moving A→B
  between reads could appear in **both** and B→A in **neither**.
  Registry-authoritative ownership makes duplicates **structurally impossible**.
  Pass 2 then verified the drop side is *currently unreachable*:
  `main.js:2699-2700` is `source.tabViews.delete(...)` / `target.tabViews.set(...)`
  as **adjacent synchronous statements** inside a fully synchronous handler, so
  no round-trip can interleave into the gap; and the pre-dom-ready case is
  already handled (`renderer.js:3570` reports `wcId: null` until dom-ready and
  `tabs.js:43` already drops those). **DD1 trades a double-count for nothing.**
- **F8 CONSTRAINT (pass-2 fresh finding — record it here, not only in
  Adaptation Criteria).** That guarantee rests entirely on the synchronous
  delete/set adjacency. **F8's cross-window drag MUST preserve it.** If F8
  introduces any await between the delete and the set (a drop animation, an
  async adopt barrier, a target-window boot wait), DD1 silently degrades from
  "structurally impossible" to "reachable drop" — and a *missing* tab is far
  quieter than the duplicate it replaced.
- **Trade-off**: N round-trips cost latency (N is 1–3 in practice), and
  completeness now takes a second op. Accepted.
- **Rationale correction (pass-1 MEDIUM — the original was factually wrong).**
  The rejected census-in-main option (b) was rejected on the stated grounds that
  burner `jarId` is "privacy-model-bearing". **It is not.** `scope.js:145-157`
  filters **by resolved session, never the renderer-reported `t.jarId`** (its own
  comment says so), and a burner is **already dropped** at the jar tier by
  session identity. Option (b)'s real cost is **admin-tier observability** of
  burner tabs, not privacy. Choice (a) stands — observability is what the specs
  consume, and (b) additionally requires growing `tabViews`' entry shape
  (`main.js:2481`) — but the recorded reason must be the true one.

**DD2 — `enumerateWindows()`: one new admin-only op, the flight's single
discovery primitive.** Returns per window: `{windowId, chromeWcId, booted,
activeTabWcId, lastFocused, sheetWcId?, sheetVisible, findWcId?, findVisible}`.
Lands in `engine.js` beside `getChromeTarget` (`:124-128` is the template) with
an injected accessor; refusal mirrors `scope.js:181-184`'s `admin-only`.
- Rationale: the **cheapest of the six owed decisions, and it retires the probe
  walk for all 11 specs** (canonical implementation: `a11y-audit.mjs:212-235`).
  It supplies the `windowId` vocabulary DD1/DD3 need and the `booted`
  completeness signal DD1 relies on, so one op discharges four of the audit's
  six items.
- **Zero new state, zero staleness (pass-2 suggestion — the strongest argument
  for the op, so state it).** Every field derives at call time from
  `registry.records()` (insertion order), `bootConfigServed`, `activeTabWcId`,
  and the two managers' `isVisible()`. Nothing to cache, no rebuild trigger,
  nothing to invalidate.
- **Shape rulings:** `booted` exposes `bootConfigServed`
  (`window-registry.js:33`, set false at `:69`, record created at `:72` *before*
  boot) — without it a mid-boot window is indistinguishable from a booted-empty
  one (`activeTabWcId: null` in both). `sheetVisible`/`findVisible` are separate
  from the ids because a **present** id conflates "visible" with "instantiated
  but hidden" — `menu-overlay-manager.js:332` (`isVisible: () => visible`) is the
  source, and the find overlay has the equivalent already (`main.js:301`
  `overlayVisible`), free after DD5's extraction. **Without them leg 4's
  two-menus variant has no observable.** An absent id means "never created"
  (lazy — DD5). Named **`lastFocused`, not `focused`** (pass-2 suggestion): it
  maps to `getLastFocused()` (`window-registry.js:116-121`), the WSLg-poisoned
  accessor — `focused` would read as an OS-focus claim this codebase
  deliberately refuses to make.
- Trade-off: +1 tool (29 → 30) across four declaration sites. Accepted — the
  count guard (`automation-mcp-server.test.js:26`) makes that drift loud.
- Rejected: `getChromeTargets()` (plural) — enumerates chromes only, leaving
  overlay discovery unsolved and the probe walk alive.

**DD3 — `getChromeTarget({windowId?})` and `captureWindow({windowId?})`:
optional discriminator; omitted = last-focused (F6's accessor, kept).** Both
return shapes gain `windowId`.
- Rationale: back-compatible by construction — all 33 `getChromeTarget` and 26
  `captureWindow` specs keep passing unmodified within a single-window run. F6's
  last-focused accessor stays the ownerless default per the debrief's Rec 3:
  WSLg focus-API poisoning is a platform fact, so an OS-focus read would regress
  determinism.
- Trade-off: an optional param is a weaker contract — a caller can forget it.
  Accepted: requiring `windowId` breaks 59 spec-classifications at once for no
  behavioral gain.

**DD4 — `captureWindow` binds by window IDENTITY via `getMediaSourceId()`.**
Delete the best-size-match scoring (`main.js:826-834`); bind the
`desktopCapturer` source to the resolved record's own `win.getMediaSourceId()`.
No fallback branch — the premise resolved.
- Rationale: "capture *a* window that happens to be the same size" is not a
  contract, and the exact identity is on the record.
- Trade-off (**S2, load-bearing**): the buggy branch is **dead code on the dev
  rig**. The fix is **unit-tested against an extracted pure picker; the
  cross-platform half is HAT/operator-scoped** — no leg AC may claim live proof
  of a fix the rig cannot reproduce. Mirror of CLAUDE.md's rig-attribution
  warning: here the rig *hides* the defect.

**DD5 — Per-window overlay instances; the roaming machinery is DELETED; and
overlay DESTRUCTION moves to per-window `close`.** Extract the find-overlay
cluster (`main.js:291-514`) into `createFindOverlayManager(deps)` mirroring
`menu-overlay-manager.js` line-for-line (lazy singleton, destroyed-recreate
guard, `render-process-gone` self-teardown, pending-init queue, `syncBounds`
store-always/apply-while-visible). Instantiate both managers per window; store
in the registry record's `findOverlay`/`sheet` slots — **the slots F6 designed
and never landed**. Delete the nine `getAttachedWindow() === X` conditioning
checks and the cross-window attachment records (a per-window instance *is* its
own scope). `lastGuestBounds`'s **shared module slot becomes per-instance
state** — the concept survives, the sharing does not (S9: any-window-polluted at
the write, `main.js:2812`,`:2861`; DD7 fixed only the read).
- **Destruction relocation (pass-1 HIGH — the original design leaked).** F6
  *deliberately* destroys the roaming singletons at `before-quit`
  (`main.js:3421-3431`) because per-window close only **detaches** (`:1183`,
  `:1187`). Under per-window instances that leaks **two `WebContentsView`s per
  closed window for the app's lifetime** — the leak class F6 fixed for the
  chrome wc (`:1210-1220`) — and a registry-iterating quit hook **cannot reach
  them**, since `registry.remove(winId)` already ran at `closed` (`:1209`).
  **Rulings (pass 2):** `close` is the right hook — `closed` cannot work
  (`win.contentView` is needed to detach, and destroyed-window access throws).
  **`before-quit` retains NO overlay role**; per-window `close` is the **sole**
  destruction site (`app.quit()` closes every window, so every window gets
  `close`; leaving a registry-iterating teardown in `before-quit` would run
  *first* and double-destroy). The **F8 DD5 find-before-sheet ordering pin
  travels** (`:3424-3428`) and appends naturally — `close` already runs
  find-session-close → `hideFindOverlay` → `closeMenuOverlay('teardown')` in
  that order (`:1180-1187`). **Destruction must sit ABOVE the handler's
  `if (!rec) return` early-return (`main.js:1155-1156`)** or the leak returns via
  a fail-open path. Two verified non-issues, recorded so leg 1 doesn't
  re-litigate: (a) `win.destroy()` has **no call sites in the repo**, so the
  `:1162` "destroy fires no close" caveat has no live caller; (b) a
  sheet-originated quit does **not** destroy the sheet inside its own dispatch —
  "Exit" routes sheet → main (`:726`) → **chrome** (`:741`) → `appQuit()`
  (`:2400`), so the chrome is always the sender. Residual accepted: `close` is
  cancellable, so a future `preventDefault` (F9 restore is the plausible
  candidate) would leave a live window with dead overlays — F6 already accepted
  this shape for guests (`:1195`), so DD5 is consistent with the house pattern.
- Rationale: the asymmetry (S8) makes the sheet nearly free and the find overlay
  the real work; extraction is required regardless and is the house pattern with
  a 780-line test exemplar (`menu-overlay-manager.test.js`) to copy. **The
  conversion is a net simplification of main.js** — 22 `menuOverlay.` sites
  collapse to ~13 `managerFor(win)` lookups, nine conditioning checks disappear,
  ~224 lines leave for the new module.
- Trade-off: N sheet/find `WebContentsView`s cost memory per window. Accepted —
  they stay **lazy** (created on first show, as today), so a window that never
  opens a menu never pays. (Consequence: `enumerateWindows` reports an absent
  overlay id for such a window — DD2's "never created".)
- Named conversion site not to lose: `main.js:2668-2672` already closes the find
  session on move ("the session is bound to the source window and does not
  survive the move") → becomes `managerFor(source.win)`.

**DD6 — Cross-window acts route to the OWNING window's chrome. The raise is
governed by a stated predicate, ruled for ALL EIGHT activate sites.** Activate
dispatch resolves the tab's owning window at event time via F6's
`getChromeForTab` (`window-registry.js:156-159`, the established class-1b
routing) instead of `executeInRenderer`'s last-focused chrome. `activateTab`'s
boolean stops being discarded: a `false` becomes a **named refusal**, never a
silent no-op.

> **Predicate: an op that needs RENDERED OUTPUT raises the owning window; an op
> that reads live JS/DOM state does not.**

| Site | Op | Raises? |
|---|---|---|
| `observe.js:126` | `captureScreenshot` | **yes** — pixels |
| `observe.js:282` | `readAxTree` | **yes** — the AX tree is a rendered artifact; `observe.js:239-240` already documents "a contents that has not rendered an AX tree yet" returning `[]`, so backgrounding plausibly changes the result, and `npm run a11y` is a flight checkpoint |
| `print.js:40` | `printToPDF` | **yes** — awaits `waitForPaint` after activate; same rendered-output logic as capture |
| `find.js:102` | `findInPage` | **yes** — keeps current behavior; match highlighting is UI-bearing and changing it is unmotivated here |
| `input.js:235` | `click` | **yes** — explicit act |
| `input.js:265` | `typeText` (paced) | **yes** — explicit act |
| `input.js:368` | `activateTab` and the explicit-act group | **yes** — the act *is* the raise |
| `observe.js:195` | `readDom` | **no** — `executeJavaScript` (`:200`); works fine on a background guest |
| `observe.js:342` | `evaluate` | **no** — `executeJavaScript`, same as `readDom` |

- Rationale: S1 is a correctness fix to shipped code, not a preference — the
  current path acts on an unraised, unrendered surface and reports success. But
  foreground-to-act is a **capture** contract that got applied to reads by
  symmetry, and that symmetry does not survive N windows: making a read steal
  the operator's foreground is a worse bug than the one being fixed. **Pass 2
  found the original DD ruled only 2 of these 8 and left `evaluate` — the op
  every probe walk and every cross-window drive runs on — unstated**; a wrong
  guess there would have silently changed leg 4's probe semantics.
- Side-effect worth naming: with `evaluate` no longer raising, the probe walk's
  foreground-first hazard **disappears** — which does not make DD2 moot (the
  walk is still an O(64) guess with a window-scoped skip set), but does mean
  legs 1–3 keep a *safer* walk than they have today.
- Trade-off: raising window B on an explicit act is a visible side-effect the
  caller did not request. Accepted for acts — it *is* the contract
  `foreground-to-act` already pins for tabs, restated at window scope. The
  read/act asymmetry is now an explicit contract line rather than an accident.

**DD7 — Every `capturePage` await is timeout-guarded.** All five sites
(`observe.js:132`; `main.js:857,858,889,895`) get a bounded race returning a
named error.
- **Precedent, precisely scoped (pass-2 MEDIUM — the original overstated it).**
  `find.js:106,155` is the in-repo precedent for the **timeout budget** (3000ms)
  and a `done`-guarded settle — **and nothing more**. Its semantics are the
  *opposite* of what DD7 needs: on timeout it does `finish(last)` where
  `last = {activeMatchOrdinal: 0, matches: 0}` (`:122`), i.e. **resolves with a
  benign zero-match success**. Copying that into capture would yield a silent
  benign result — the exact silent-success class S1/DD6 exists to eliminate. The
  mechanism also differs: find.js wraps an **event-listener** flow in a Promise
  constructor, whereas `capturePage()` is an **unrejectable promise you must
  `Promise.race`**. So: borrow the budget and the guard; the race + named
  rejection is **new**, and find.js's benign-settle semantics are explicitly
  **not** carried.
- **Layer-degradation ruling (pass-2 Q5).** A timeout on an **overlay layer**
  (`main.js:889`, `:895`) **drops that layer and logs it** — matching the
  composite's existing tolerance for a failed layer (`:918`'s
  `.then(…, function() { return null; })` already drops one silently). A timeout
  on the **chrome or guest** capture (`:857`, `:858`) **hard-refuses** — those
  are the capture. This keeps a slow menu from failing an otherwise-good window
  capture while never returning a silently-empty one.
- **Post-await attachment re-check, restated for the post-DD5 world.** The
  current gates (`main.js:888`, `:893`) are synchronous checks in front of an
  unbounded await — a TOCTOU (a `hideFindOverlay()` in between detaches
  mid-capture). Those two gates are **among the nine DD5 deletes**, so the
  re-check is written against the **per-window instance's own
  visibility/attachment**, not `=== grabWin`. The TOCTOU survives DD5 (hiding a
  per-window instance mid-await still detaches it), so the re-check is still
  required.
- Rationale: `resolveContents` (`resolve.js:98-140`) proves a view *live*, never
  *attached*; a detached-but-live view passes every guard and hangs forever.
  With S1 in play, a `captureWindow` racing a `tab:move-new-window` is a
  plausible **live hang on shipped F6 code**.
- Trade-off: a timeout can fire on a merely-slow capture, turning a slow success
  into a failure. Accepted with a generous bound; the refusal names the cause.

**DD8 — Destroyed-window tripwire: land the wrapper AND the lint AND a
source-scan test.** `onWindowClosed(win, handler)` captures at registration time;
the ESLint `no-restricted-syntax` rule uses the recon's **empirically-verified**
selector (flight log — the `>` child combinator is load-bearing); a self-deriving
source-scan test in the `broadcast-invariant.test.js` house pattern backs both.
- Rationale: the F6 debrief already said the wrapper is *"the primary mitigation
  and the lint is the **complement**"* (`flight-debrief.md:251-257`) — so the
  debrief **already knew** the defeat an earlier draft of this DD cited as new
  evidence, and "overrides the debrief" overstated a conflict that isn't there.
  The recon already produced the corrected selector; `eslint.config.mjs` has no
  `no-restricted-syntax` today, so landing it is ~4 lines. With the source-scan
  test alongside as the real net, skipping a cheap complementary layer isn't
  justified. **Land all three.**
- **Withdrawn claim (pass-2 MEDIUM).** An earlier draft justified DD8 by DD5's
  destruction relocation ("the handler must not reach through a destroyed
  window"). **That is false**: destruction moves to **`close`, which is
  pre-teardown** (recon census; F6 spike verdict 3) — the window is alive — and
  `onWindowClosed` wraps **`closed`**, so it doesn't apply to a `close`-time
  handler at all. DD8 stands on its own merits (S6 prospective insurance, ~4
  lines of lint, the house source-scan pattern); the "why now" is F7's
  N-multiplied per-window lifecycle surface generally, not DD5 specifically.
- **Mechanism risk (Open Question):** the source-scan's *positive* form ("reads
  only captured primitives") is **not** a marker-matching property —
  `broadcast-invariant.test.js` works by scanning for literal strings, whereas
  this needs scope resolution. Leg 1 proves the mechanism or falls back to the
  negative form (defeated by aliasing exactly like the lint — which is why the
  **wrapper** is the primary net). The AC must not assert an unmeetable
  property.
- Scope honesty (S6): the wrapper converts **one already-correct site**
  (`main.js:1206-1221`). Its value is prospective.

**DD9 — Pin the op SCHEMA shape, not just the op count** (S10). Extend
`automation-mcp-tools.test.js`'s existing schema pin (`:8`) to the
observe/chrome tools' `inputSchema`, so DD3's `windowId` param cannot land while
`docs/mcp-automation.md:391` ("All 29 tools below match `mcp-tools.js` exactly")
silently lies. The count guard (`EXPECTED_TOOL_COUNT = 29`) already catches
DD2's +1.
- Rationale: discharges the F5 debrief's count-drift item ("tooling, not more
  review") in the form the recon proved is needed. The five **prose** pins of
  "29" (`mcp-tools.js:577`, `mcp-server.js:358`,
  `docs/mcp-automation.md:19,:391`, `CLAUDE.md:448`) stay unguarded — a doc
  grep-AC in leg 4 covers them.

### Prerequisites

- [x] F6 landed and committed (`21a5182`, `2800abb`); `flight/7` stacks on
      `flight/6-multi-window-1`.
- [x] The audit exists and is committed — **treated as dated** (S7); leg 4
      re-verifies its rows. Its probe-walk count of 10 was right; the recon's 7
      was wrong.
- [x] Registry record slots `findOverlay?`/`sheet?` are designed (F6
      `flight.md:142-144`) — leg 1 lands them.
- [x] `BaseWindow.getMediaSourceId()` confirmed present (`electron.d.ts:2809`),
      verified twice.
- [x] `getChromeForTab` exists today (`window-registry.js:156-159`) — DD6's
      routing needs no new primitive.
- [x] **Apparatus — act axis**: driving a second window's chrome and overlays by
      raw wcId at the admin tier is proven live (F6 `multi-window-shell` 9/9).
- [x] **Apparatus — observe axis** (both axes audited per house rule): every new
      AC's read path exists. `enumerateWindows` is the read path for per-window
      overlay identity **and visibility** (DD2's `sheetVisible` — without which
      the two-menus variant has no observable) **and for census completeness**
      (`booted`); per-wcId `captureScreenshot` reads overlay pixels **without**
      `captureWindow` (F6's DD9 constraint, still in force); `enumerateTabs`'s
      `windowId` is read directly; S1's fix observes as a **named refusal instead
      of a discarded `false`**, plus the raised window's census.
      **The one criterion with no rig read path is DD4's mis-pick fix (S2) —
      explicitly unit-scoped + HAT-scoped, never claimed live.**

### Pre-Flight Checklist

- [x] All open questions resolved (DD4's premise closed at review; DD1's
      mid-boot question closed by DD2's `booted`) or reduced to a named leg-1
      mechanism proof (DD8)
- [x] Design decisions documented with rationale and trade-offs
- [x] Prerequisites verified (not assumed) — apparatus audited on both axes
- [x] Validation approach defined (below)
- [x] Legs defined

---

## In-Flight

### Technical Approach

Leg 1 is a structural conversion with **no intended behavior change**: extract
the find overlay to a factory, instantiate both managers per window into the
registry record, delete the roaming machinery, relocate destruction to
per-window close. It carries F6's proven invariant idiom — **the menu/find spec
set passes UNMODIFIED** — which is what makes a conversion this size safe to
land in one leg. Leg 2 fixes the two live defects (S1, S3): shipped-code bugs
with **no tool-schema change**, independently verifiable, which must not wait
behind an API redesign. Leg 3 redefines the automation surface on top of
per-window overlays (DD2 needs the record slots leg 1 creates). Leg 4 realigns
the spec corpus and proves the whole thing.

**`multi-window-shell` is knowingly RED from leg 1 to leg 4** (pass-2 HIGH). Its
Preconditions pin the roaming singleton (`:80-86` "ONE sheet serves every
window") and step 4 asserts "**zero per-window overlay instances**" (`:124`) —
**DD5 falsifies it at leg 1**, one leg before DD1 falsifies its censuses
(`:74-75`, `:123`, `:125`, `:127`). The audit gave it no cover (it excluded the
spec by design, `audit:5-6`). It is therefore **explicitly OUT of leg 1's
invariant set**, and each leg's log records it as a **planned red, not a
regression**. It is rewritten once, in leg 4, when DD1+DD2+DD5 are all landed —
splitting the rewrite earlier buys nothing.

**Leg 1's invariant set, enumerated** (pass-2 suggestion — an unenumerated
invariant is one judgment call from being satisfied vacuously): `menu-overlay`,
`menu-dismissal`, `kebab-menu`, `internal-tab-menus`, `page-context-menu`,
`tab-context-menu`, `find-overlay-geometry`, `tab-surface-geometry`. **Not**
`multi-window-shell`.

**main.js numeric target (F6 debrief carry): net ≤ 3461 lines** — leg 1 removes
~224 (find cluster) and nine conditioning checks while *adding* per-window
wiring and the destruction relocation; leg 3 adds op wiring. **Record per-leg**
— the target is the flight's net; leg 1 alone must not be judged against it. A
checkpoint, not an AC: if it misses, the log records the number and the
maintenance flight inherits it. F6's failure was having *no* number, not missing
one.

### Checkpoints

- [ ] Leg 1: the enumerated invariant set passes **unmodified**.
- [ ] Leg 1: closing one of N windows destroys that window's two overlay views
      (no leak) — observable as a webContents count returning to baseline (F6's
      M4 idiom).
- [ ] Leg 2: `activateTab` on a window-B tab raises window B; `readDom` on one
      does **not** (the DD6 asymmetry).
- [ ] Leg 2: a `capturePage` on a detached view **refuses within the bound**
      instead of hanging.
- [ ] Leg 4: two menus open simultaneously in two windows — the definitive proof
      the roaming singleton is retired (impossible under F6 by design).
- [ ] main.js line count recorded at each leg's landing.

### Adaptation Criteria

**Divert if**:
- DD5's extraction reveals the find overlay's main.js coupling is not separable
  behind injected deps (i.e. `menu-overlay-manager.js` is not actually a usable
  template) — re-plan the leg boundary before writing the conversion.
- DD1's registry-authoritative filter proves unable to express a legitimate tab
  state — escalate rather than widening the filter silently. *(Defensive only:
  pass 2 verified the "tab in no window's `tabViews`" state is currently
  unreachable — see DD1.)*

**Acceptable variations**:
- DD8's source-scan mechanism (positive vs negative form) — a leg-1 finding.
- The exact refusal-shape strings, so long as `admin-only` stays distinct from
  `out-of-jar` (`mcp-jar-scoping`/`mcp-auth-gating` pin them).
- Leg 4's spec-edit ordering within the audit's stated sequence.

### Legs

> Tentative; planned one at a time.

- [ ] `overlay-per-window` — **HIGH risk** (structural conversion of a
      unit-test-exempt surface + a lifecycle relocation). DD5 + DD8: extract
      `createFindOverlayManager`; instantiate both managers per window into the
      registry record's `findOverlay`/`sheet` slots; delete the nine DD7
      conditioning checks, the cross-window attachment records, and
      `lastGuestBounds`'s shared slot; **relocate overlay destruction to
      per-window `close`** (sole site; above the `!rec` early-return; ordering
      pin travels; `before-quit` keeps no overlay role); land `onWindowClosed` +
      the ESLint rule + the source-scan tripwire (proving its mechanism). Unit
      net mirroring `menu-overlay-manager.test.js`. **Invariant AC: the
      enumerated set above passes UNMODIFIED.**
- [ ] `live-defect-fixes` — **HIGH risk.** *(Re-tiered from MEDIUM at pass 2:
      "no API change" was the wrong frame — there is no **tool-schema** change,
      but this leg changes the shared automation surface's **observable
      contract**: `activateTab` starts refusing where it silently succeeded, and
      `readDom` stops raising. Schema-stable and contract-breaking is precisely
      the S10 failure mode DD9 exists to catch — carried knowingly.)*
      DD6's routing fix + named refusal + the eight-site raise predicate; DD7's
      five timeout guards, the layer-degradation rule, and the two post-await
      re-checks. Independently verifiable; no dependency on legs 3–4 (verified:
      `getChromeForTab` exists today, and the five capture sites are independent
      of DD2/DD3).
- [ ] `automation-window-semantics` — **HIGH risk** (shared interface with
      external consumers). DD1/DD2/DD3/DD4/DD9: all-windows `enumerateTabs` with
      `windowId` + registry-authoritative ownership; `enumerateWindows`; the
      `windowId` param on `getChromeTarget`/`captureWindow`; the
      `getMediaSourceId` picker (pure, unit-tested); the schema-shape pin. Docs
      rewritten (`docs/mcp-automation.md:356-384` is F7's to replace), including
      the mid-boot adopted-tab disclosure (DD1). **Re-point `a11y-audit.mjs`'s
      `findSheetWcId` in this leg** — its `enumerateTabs`-failure fallback walks
      unfiltered (`:212-221`) and `npm run a11y` is a flight checkpoint; it
      cannot move earlier because it re-points onto `enumerateWindows`, which
      this leg creates.
- [ ] `spec-realignment-and-verify` — **MEDIUM risk**. Re-verify the audit's
      dated rows (S7); `kebab-menu.md` full-body refresh (the ONE genuinely owed
      row); **`multi-window-shell` FULL rewrite** (DD5 + DD2 + DD1 all falsify
      it — see Technical Approach), incl. its pre-registered two-menus variant
      and the step-8 `ERR_ABORTED` count; re-point the **10** probe-walk specs
      to `enumerateWindows` (nine onto `sheetWcId`, `find-overlay-geometry` onto
      `findWcId` — DD2's find half ships with exactly one caller; glance at
      `tab-surface-geometry.md:60`'s conditional probe); restate the 5
      count-precondition specs against the all-windows census; author + run
      `multi-window-automation`; regression set; `npm run a11y`; doc grep-ACs.

---

## Post-Flight

### Completion Checklist

- [ ] All legs completed
- [ ] Code merged (PR opened, stacks on flight/6 — operator merges)
- [ ] Tests passing
- [ ] Documentation updated (`docs/mcp-automation.md` multi-window section
      rewritten from interim to final; CLAUDE.md find-overlay + routing +
      op-count sections; the audit annotated as discharged)

### Verification

- New `tests/behavior/multi-window-automation.md` passes — the flight's headline
  spec: `enumerateWindows` discovery (no probe walk), all-windows
  `enumerateTabs` with `windowId`, `booted` as the completeness signal,
  `captureWindow({windowId})`, **two sheets open simultaneously in two windows**
  (impossible under F6's roaming interim — the definitive per-window proof, read
  via DD2's `sheetVisible`), and the DD6 pair: activating window B's background
  tab from window A **raises** window B, while `readDom` on one does **not**.
- `multi-window-shell` **rewritten** and re-run green, with its pre-registered
  two-menus variant. Knowingly red legs 1–4 (see Technical Approach).
- The enumerated invariant set passes **unmodified** at leg 1, then re-points at
  leg 4.
- `npm run a11y` green (its `findSheetWcId` re-pointed in leg 3); suites green;
  `EXPECTED_TOOL_COUNT` 29 → 30 in lockstep with the docs (DD9's schema pin +
  the leg-4 doc grep-AC).
- **Not claimed live** (S2): the `captureWindow` mis-pick fix — unit-tested
  against the extracted picker, HAT/operator-scoped cross-platform.
